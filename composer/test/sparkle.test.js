import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SPARKLE_DEFAULTS, SPARKLE_HITS, SparkleField, keyTint, needsFeatures, sparkleHash, sparkleLife, sparkleLight,
  sparkleSettings, sparkleShare, sparkleWeight,
} from '../public/sparkle.js';

// Sparkles over every pattern (T30). The GLSL is compared with sparkleLight
// pixel by pixel in headless Chrome by `npm run check-sparkles`.

const on = (extra = {}) => ({ ...SPARKLE_DEFAULTS, enabled: true, ...extra });
const hit = (strength = 1, place = 0.5) => ({ highHits: 1, highStrength: strength, highPlace: place });

test('sparkle settings are checked, and saved settings with missing fields take the defaults', () => {
  assert.deepEqual(sparkleSettings(), SPARKLE_DEFAULTS);
  assert.deepEqual(sparkleSettings({ enabled: true }), { ...SPARKLE_DEFAULTS, enabled: true });
  assert.throws(() => sparkleSettings({ amount: 2 }), /amount/);
  assert.throws(() => sparkleSettings({ shape: 'heart' }), /shape/);
  assert.throws(() => sparkleSettings({ colour: 'plaid' }), /colour/);
  assert.throws(() => sparkleSettings({ enabled: 'yes' }), /boolean/);
  assert.throws(() => sparkleSettings([]), /object/);
  assert.equal(Object.hasOwn(sparkleSettings({ stray: 1 }), 'stray'), false);
});

test('length and density map to a life of 50 to 400 ms and up to 2% of pixels', () => {
  assert.equal(sparkleLife(0), 0.05);
  assert.ok(Math.abs(sparkleLife(1) - 0.4) < 1e-12);
  assert.equal(sparkleShare(0), 0);
  assert.equal(sparkleShare(1), 0.02);
});

test('the field keeps the last hits with their own seeds, and gives their ages', () => {
  const field = new SparkleField();
  field.add({ highHits: 0, highStrength: 0 }, 0);
  assert.equal(field.hits.length, 0);
  for (let n = 0; n < SPARKLE_HITS + 5; ++n) field.add(hit(0.5, n / 100), n * 0.1);
  assert.equal(field.hits.length, SPARKLE_HITS);
  assert.equal(field.hits[0].seed, 5);
  const u = field.uniforms(10, on(), 0.25, 0);
  // The newest hit, at 3.6 s, is 6.4 s old at 10 s.
  assert.ok(Math.abs(u.hits[(SPARKLE_HITS - 1) * 4] - 6.4) < 1e-5);
  assert.equal(u.hits[(SPARKLE_HITS - 1) * 4 + 1], 0.5);
  assert.ok(Math.abs(u.hits[(SPARKLE_HITS - 1) * 4 + 2] - 0.36) < 1e-6);
  assert.deepEqual(u.tint, keyTint(0.25));
  // Turned off, the amount is 0, and so is the twinkle.
  const off = field.uniforms(10, { ...on(), enabled: false }, 0, 0.5);
  assert.equal(off.sparkle[0], 0);
  assert.equal(off.air[0], 0);
});

test('the hash is spread evenly, and a hit lights about its share of the pixels, then fades', () => {
  let below = 0, total = 0;
  for (let y = 0; y < 192; ++y)
    for (let x = 0; x < 256; ++x) {
      const h = sparkleHash(x, y, 3);
      assert.ok(h >= 0 && h < 1);
      if (h < 0.1) ++below;
      ++total;
    }
  assert.ok(Math.abs(below / total - 0.1) < 0.01, `${below / total} below 0.1`);

  const field = new SparkleField();
  field.add(hit(1), 0);
  const settings = on({ shape: 'point', density: 1, twinkle: 0 });
  const count = (seconds) => {
    const u = field.uniforms(seconds, settings, 0, 0);
    let lit = 0, peak = 0;
    for (let y = 0; y < 192; ++y)
      for (let x = 0; x < 256; ++x) {
        const value = sparkleLight(x, y, u)[0];
        if (value > 0) ++lit;
        peak = Math.max(peak, value);
      }
    return { lit, peak };
  };
  const fresh = count(0);
  // 2% of 49,152 pixels is 983.
  assert.ok(Math.abs(fresh.lit - 983) < 100, `${fresh.lit} lit`);
  assert.ok(fresh.peak > 0.7 && fresh.peak <= 0.8, `peak ${fresh.peak}`);
  // After one life (115 ms at the default Length) the light has fallen to a third.
  const later = count(sparkleLife(settings.length));
  assert.ok(later.peak < fresh.peak * 0.4, `peak ${later.peak}`);
  // Long after, nothing.
  assert.equal(count(5).lit, 0);
});

test('lit pixels fall at random, with no stripes: pairs at small offsets are as common as chance', () => {
  // An arithmetic hash tried first passed the evenness test above but lit
  // pixels in diagonal stripes; this is the test it fails.
  const width = 256, height = 192, share = 0.02, seeds = [0, 1, 2, 3, 40, 41, 100, 288];
  let worst = 0, worstAt = null;
  const lit = seeds.map((seed) => {
    const grid = new Uint8Array(width * height);
    for (let y = 0; y < height; ++y)
      for (let x = 0; x < width; ++x) grid[y * width + x] = sparkleHash(x, y, seed) < share ? 1 : 0;
    return grid;
  });
  for (let dy = -4; dy <= 4; ++dy)
    for (let dx = -4; dx <= 4; ++dx) {
      if (!dx && !dy) continue;
      let pairs = 0, cells = 0;
      for (const grid of lit)
        for (let y = Math.max(0, -dy); y < height - Math.max(0, dy); ++y)
          for (let x = Math.max(0, -dx); x < width - Math.max(0, dx); ++x) {
            pairs += grid[y * width + x] & grid[(y + dy) * width + x + dx];
            ++cells;
          }
      const ratio = pairs / (cells * share * share);
      if (ratio > worst) [worst, worstAt] = [ratio, [dx, dy]];
    }
  assert.ok(worst < 1.5, `pairs at offset ${worstAt} are ${worst.toFixed(2)} times chance`);
  // Neighbouring seeds light different pixels.
  const shared = lit[0].reduce((sum, v, i) => sum + (v & lit[1][i]), 0);
  assert.ok(shared < width * height * share * share * 2, `${shared} pixels lit by both seeds`);
});

test('stars light their four neighbours dimmer, and the colours follow the setting', () => {
  const field = new SparkleField();
  field.add(hit(1, 1), 0);
  const u = field.uniforms(0, on({ density: 1, shape: 'star' }), 0, 0);
  let centre = null;
  for (let y = 1; y < 100 && !centre; ++y)
    for (let x = 1; x < 100 && !centre; ++x)
      if (sparkleHash(x, y, 0) < 0.02 && [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]
        .every(([dx, dy]) => sparkleHash(x + dx, y + dy, 0) >= 0.02)) centre = [x, y];
  const [x, y] = centre;
  const middle = sparkleLight(x, y, u)[0], beside = sparkleLight(x + 1, y, u)[0];
  assert.ok(beside > 0.25 * middle && beside < 0.45 * middle, `${beside} beside ${middle}`);
  assert.equal(sparkleLight(x + 1, y + 1, u)[0], 0);
  // Gold to ice: a hit at the top of the band is icy (more blue than red).
  const ice = sparkleLight(x, y, field.uniforms(0, on({ density: 1, colour: 'place' }), 0, 0));
  assert.ok(ice[2] > ice[0]);
  // White is grey-free.
  const white = sparkleLight(x, y, u);
  assert.ok(white[0] === white[1] && white[1] === white[2]);
});

test('the air twinkles a few pixels, more with more air, and none below the floor', () => {
  const field = new SparkleField();
  const pixels = (air, seconds = 3.3) => {
    const u = field.uniforms(seconds, on({ twinkle: 1 }), 0, air);
    const list = new Set();
    for (let y = 0; y < 192; ++y)
      for (let x = 0; x < 256; ++x) if (sparkleLight(x, y, u)[0] > 0) list.add(y * 256 + x);
    return list;
  };
  const lit = (air, seconds) => pixels(air, seconds).size;
  assert.equal(lit(0.05), 0);
  // 0.4% of the pixels, each lit for most of its period.
  const full = lit(0.6);
  assert.ok(full > 100 && full < 250, `${full} lit`);
  // Over half a period, most of the twinkling pixels have changed.
  const now = pixels(0.6, 3.3), soon = pixels(0.6, 3.6);
  const kept = [...now].filter((p) => soon.has(p)).length;
  assert.ok(kept < now.size / 2, `${kept} of ${now.size} still lit`);
});

// A picture, RGBA rows from the bottom: black with a white disc of radius 40
// at the centre of a 256 by 192 panel.
function disc() {
  const width = 256, height = 192, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; ++y)
    for (let x = 0; x < width; ++x) {
      const inside = Math.hypot(x - 128, y - 96) < 40 ? 255 : 0;
      pixels.set([inside, inside, inside, 255], (y * width + x) * 4);
    }
  return { width, height, pixels };
}

test('a faint edge or a dim shape gets no sparkles', () => {
  // A step of 20 levels (0.08 in brightness) is under the edge ramp's start.
  const width = 8, height = 8, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; ++y)
    for (let x = 0; x < width; ++x) pixels.set(x < 4 ? [0, 0, 0, 255] : [20, 20, 20, 255], (y * width + x) * 4);
  const faint = { width, height, pixels };
  assert.equal(sparkleWeight(3, 4, 1, faint), 0);
  assert.equal(sparkleWeight(6, 4, 2, faint), 0);
});

test('placed along edges, sparkles land on the outline of a shape; on bright shapes, inside it', () => {
  const frame = disc();
  assert.equal(sparkleWeight(10, 10, 0, frame), 1);
  assert.equal(sparkleWeight(10, 10, 1, frame), 0, 'no edge in flat black');
  assert.equal(sparkleWeight(128, 96, 1, frame), 0, 'no edge in flat white');
  assert.equal(sparkleWeight(168, 96, 1, frame), 3, 'on the rim, three times as likely as anywhere');
  assert.equal(sparkleWeight(128, 96, 2, frame), 2, 'white is bright');
  assert.equal(sparkleWeight(10, 10, 2, frame), 0);
  assert.equal(needsFeatures(on({ placement: 'edges' })), true);
  assert.equal(needsFeatures(on()), false);
  assert.equal(needsFeatures({ ...on({ placement: 'edges' }), enabled: false }), false);

  const field = new SparkleField();
  for (let n = 0; n < 8; ++n) field.add(hit(1), n * 0.001);
  const where = (placement) => {
    const u = field.uniforms(0.01, on({ placement, density: 1, shape: 'point', twinkle: 0 }), 0, 0);
    const distances = [];
    for (let y = 0; y < 192; ++y)
      for (let x = 0; x < 256; ++x)
        if (sparkleLight(x, y, u, frame)[0] > 0) distances.push(Math.hypot(x - 128, y - 96));
    return distances;
  };
  const edges = where('edges');
  assert.ok(edges.length > 20, `${edges.length} sparkles on the rim`);
  assert.ok(edges.every((d) => Math.abs(d - 40) < 2), 'every one within 2 pixels of the rim');
  const light = where('light');
  assert.ok(light.length > 100 && light.every((d) => d < 41), `${light.length} sparkles, all inside the disc`);
});
