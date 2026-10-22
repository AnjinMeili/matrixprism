import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRE_COLOURS, FIRE_PARAMS, Fire2D } from '../public/fire.js';

// The Fire pattern's simulation (fire.js), on a seeded random source.

function seeded(seed = 1) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const defaults = Object.fromEntries(FIRE_PARAMS.map((p) => [p.id, p.default]));

// Runs a fire for `seconds` at `fps` and returns it.
function burn(params = {}, { seconds = 6, fps = 30, width = 32, height = 32, audio = {}, seed = 1 } = {}) {
  const fire = new Fire2D(width, height, seeded(seed));
  for (let n = 0; n <= seconds * fps; ++n) fire.renderFrame({ auroraTime: n / fps, audio }, { ...defaults, ...params });
  return fire;
}
// Mean heat of each row, bottom first.
const rows = (fire) => Array.from({ length: fire.height }, (_, y) =>
  fire.heat.subarray(y * fire.width, (y + 1) * fire.width).reduce((a, b) => a + b, 0) / fire.width);
const flameHeight = (fire) => {
  const r = rows(fire);
  let top = 0;
  r.forEach((v, y) => { if (v > 0.05) top = y; });
  return top;
};

test('the colours run from black through red, orange and yellow to white', () => {
  const at = (i) => [...FIRE_COLOURS.subarray(i * 3, i * 3 + 3)];
  assert.deepEqual(at(0), [0, 0, 0]);
  assert.deepEqual(at(255), [255, 255, 220]);
  const mid = at(110);
  assert.ok(mid[0] > 150 && mid[1] < mid[0] && mid[2] < 20, `red-orange: ${mid}`);
  for (let i = 1; i < 256; ++i) {
    const [r0, g0, b0] = at(i - 1), [r1, g1, b1] = at(i);
    assert.ok(r1 >= r0 && g1 >= g0 && b1 >= b0, `hotter is never darker, at ${i}`);
  }
});

test('nothing burns before time passes; then flames rise from the base, hottest low down', () => {
  const fire = new Fire2D(32, 32, seeded());
  assert.ok(fire.renderFrame({ auroraTime: 0 }, defaults).every((v) => v === 0));
  const lit = burn();
  const r = rows(lit);
  assert.ok(r[0] > 0.3, `the base burns: ${r[0].toFixed(2)}`);
  assert.ok(r[0] > r[10] && r[10] > r[25], `cooler as it rises: ${[0, 10, 25].map((y) => r[y].toFixed(2))}`);
  assert.ok(flameHeight(lit) >= 6 && flameHeight(lit) < 31, `flames reach part way up: ${flameHeight(lit)}`);
});

test('more cooling gives shorter flames; less sparking gives less fire', () => {
  assert.ok(flameHeight(burn({ cooling: 2.5 })) < flameHeight(burn({ cooling: 0.4 })));
  const total = (fire) => fire.heat.reduce((a, b) => a + b, 0);
  assert.ok(total(burn({ sparking: 0.1 })) < total(burn({ sparking: 0.9 })));
  assert.equal(total(burn({ sparking: 0 })), 0, 'no sparks, no fire');
});

test('wind leans the flames to its side', () => {
  // The lean: how far the pattern of heat a few rows up is shifted from the
  // pattern lower down, at the best match, averaged over many moments.
  const lean = (wind) => {
    const fire = new Fire2D(48, 32, seeded(3));
    let total = 0, samples = 0;
    for (let n = 0; n <= 300; ++n) {
      fire.renderFrame({ auroraTime: n / 30, audio: {} }, { ...defaults, wind, turbulence: 0 });
      if (n < 60 || n % 10) continue;
      const row = (y) => fire.heat.subarray(y * fire.width, (y + 1) * fire.width);
      const low = row(4), high = row(8);
      let best = 0, bestScore = -Infinity;
      for (let shift = -6; shift <= 6; ++shift) {
        let score = 0;
        for (let x = 8; x < fire.width - 8; ++x) score += low[x] * high[x + shift];
        if (score > bestScore) { bestScore = score; best = shift; }
      }
      total += best;
      ++samples;
    }
    return total / samples;
  };
  const right = lean(1), left = lean(-1), still = lean(0);
  assert.ok(right > 1 && left < -1 && Math.abs(still) < 1, `right ${right.toFixed(1)}, left ${left.toFixed(1)}, still ${still.toFixed(1)}`);
});

test('the bass and the beat feed the fire, as far as Music says', () => {
  const total = (fire) => fire.heat.reduce((a, b) => a + b, 0);
  const quiet = total(burn({ music: 1 }, { audio: { bass: 0, beat: 0 } }));
  const loud = total(burn({ music: 1 }, { audio: { bass: 1, beat: 0 } }));
  assert.ok(loud > quiet * 1.2, `bass: ${quiet.toFixed(0)} to ${loud.toFixed(0)}`);
  const deaf = total(burn({ music: 0 }, { audio: { bass: 1, beat: 0 } }));
  const still = total(burn({ music: 0 }, { audio: { bass: 0, beat: 0 } }));
  assert.equal(deaf, still, 'with Music at 0 the bass changes nothing');
});

test('it steps on the clock, not the frame rate, and does not run away after a stall', () => {
  const steps = (fps) => burn({}, { seconds: 4, fps }).steps;
  assert.ok(Math.abs(steps(30) - 200) <= 1 && Math.abs(steps(60) - 200) <= 1, `${steps(30)} and ${steps(60)} steps in 4 s`);
  const fire = new Fire2D(16, 16, seeded());
  fire.renderFrame({ auroraTime: 0 }, defaults);
  fire.renderFrame({ auroraTime: 30 }, defaults);
  assert.ok(fire.steps <= 5, `${fire.steps} steps after a 30 s stall`);
  fire.renderFrame({ auroraTime: 1 }, defaults);
  assert.ok(fire.steps <= 5, 'a clock that goes back starts afresh');
});

test('embers rise above the flames and die; none with Embers at 0', () => {
  const lit = burn({ embers: 1 });
  assert.ok(lit.embers.length > 0, 'some embers');
  assert.ok(lit.embers.every((e) => e.life > 0 && e.y < lit.height + 1));
  assert.equal(burn({ embers: 0 }).embers.length, 0);
});

test('a beat lifts the fire for a moment: hotter at once, as far as Music says', () => {
  // Two fires on the same seed, one given a beat: the level sent on that
  // frame, with the beat over without it.
  const jump = (music) => {
    const level = (beat) => {
      const fire = new Fire2D(32, 32, seeded(5));
      for (let n = 0; n <= 120; ++n) fire.renderFrame({ auroraTime: n / 30, audio: { bass: 0, beat: 0 } }, { ...defaults, music });
      return fire.renderFrame({ auroraTime: 121 / 30, audio: { bass: 0, beat } }, { ...defaults, music }).reduce((a, b) => a + b, 0);
    };
    return level(1) / level(0);
  };
  assert.ok(jump(1) > 1.1, `with Music at 1: ×${jump(1).toFixed(2)}`);
  assert.equal(jump(0), 1, 'with Music at 0 a beat changes nothing');
});

test('embers on a big panel are more, bigger and rise further', () => {
  const small = burn({ embers: 1 }, { width: 64, height: 32 });
  const big = burn({ embers: 1 }, { width: 256, height: 192, seconds: 4 });
  assert.equal(small.emberSize, 1);
  assert.equal(big.emberSize, 3);
  assert.ok(big.embers.length > small.embers.length * 2, `${small.embers.length} and ${big.embers.length}`);
  const rise = (fire) => fire.embers.reduce((a, e) => a + e.rise, 0) / fire.embers.length;
  assert.ok(rise(big) > rise(small) * 2, `rise ${rise(small).toFixed(2)} and ${rise(big).toFixed(2)} a step`);
});
