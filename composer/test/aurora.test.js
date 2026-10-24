import assert from 'node:assert/strict';
import test from 'node:test';
import { AURORA_PATTERNS } from '../public/aurora-patterns.js';
import {
  AURORA_SIZE, AuroraBuffer, sin8, cos8, quadwave8, inoise8, palette,
} from '../public/aurora-fastled.js';

function randomGenerator() {
  let seed = 12345;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const create = (id, random = randomGenerator()) =>
  AURORA_PATTERNS.find(pattern => pattern.id === `aurora-${id}`).createInstance(32, 32, random);
const pixel = (rgb, x, y) => rgb.slice((y * AURORA_SIZE + x) * 3, (y * AURORA_SIZE + x) * 3 + 3);
const hash = (bytes) => bytes.reduce((value, next) => Math.imul(value ^ next, 16777619) >>> 0, 2166136261);

test('ports exactly the 13 patterns in the pinned Aurora.ino playlist', () => {
  assert.deepEqual(AURORA_PATTERNS.map(pattern => pattern.id), [
    'aurora-attract', 'aurora-bounce', 'aurora-cube', 'aurora-flock',
    'aurora-flowfield', 'aurora-incremental-drift', 'aurora-incremental-drift-rose',
    'aurora-pendulum-wave', 'aurora-radar', 'aurora-spiral', 'aurora-spiro',
    'aurora-swirl', 'aurora-wave',
  ]);
});

test('FastLED byte primitives match independently compiled FastLED 3.5.0 C++ reference', () => {
  // FNV-1a golden values from all 256 phases and 10,000 16-bit noise inputs.
  assert.equal(hash(Array.from({ length: 256 }, (_, i) => sin8(i))), 4211814707);
  assert.equal(hash(Array.from({ length: 256 }, (_, i) => quadwave8(i))), 2856585349);
  assert.equal(hash(Array.from({ length: 10000 }, (_, i) =>
    inoise8(i * 137, i * 331 + 128, i * 73 + 255))), 3533201525);
  assert.deepEqual([sin8(0), sin8(64), sin8(128), sin8(192)], [128, 255, 128, 1]);
  assert.equal(cos8(0), 255);
  assert.deepEqual([
    inoise8(0, 0, 0), inoise8(128, 128, 128), inoise8(65535, 65535, 65535),
    inoise8(12345, 54321, 43210), inoise8(256, 128, 64),
  ], [128, 96, 128, 118, 84]);
});

test('RGB buffer preserves saturating addition, GFX clipping, line drawing, and FastLED fade', () => {
  const buffer = new AuroraBuffer();
  buffer.pixel(0, 0, [200, 100, 50]);
  buffer.pixel(0, 0, [100, 200, 50], true);
  assert.deepEqual([...pixel(buffer.rgb, 0, 0)], [255, 255, 100]);
  buffer.pixel(-1, 0, [255, 0, 0]);
  buffer.pixel(32, 0, [255, 0, 0]);
  buffer.pixel(0, 32, [255, 0, 0]);
  assert.equal(buffer.rgb.filter(value => value !== 0).length, 3);
  buffer.dim(254);
  assert.deepEqual([...pixel(buffer.rgb, 0, 0)], [254, 254, 99]);
  buffer.line(1, 1, 3, 3, [0, 255, 0]);
  for (let i = 1; i <= 3; ++i)
    assert.deepEqual([...pixel(buffer.rgb, i, i)], [0, 255, 0]);
});

test('lossy 2D blur spreads a dot while spiral stream clips off-screen pixels', () => {
  const buffer = new AuroraBuffer();
  buffer.pixel(16, 16, [255, 0, 0]);
  buffer.blur(172);
  assert.ok(pixel(buffer.rgb, 15, 16)[0] > 0);
  assert.ok(pixel(buffer.rgb, 16, 15)[0] > 0);
  assert.ok(pixel(buffer.rgb, 16, 16)[0] < 255);
  buffer.spiralStream(15, 15, 16, 128);
  assert.deepEqual([...pixel(buffer.rgb, 0, 0)], [0, 0, 0]);
});

test('Pendulum Wave uses original beat frequencies and palette, not an audio shader', () => {
  const animation = create('pendulum-wave');
  const rgb = animation.render(0);
  for (let x = 0; x < 32; ++x) {
    assert.deepEqual([...pixel(rgb, x, 16)], palette(x * 7));
    assert.deepEqual([...pixel(rgb, x, 15)], [0, 0, 0]);
  }
  assert.equal(animation.interval, 15);
});

test('Incremental Drift draws original concentric cosine/sine positions at phase zero', () => {
  const animation = create('incremental-drift');
  const rgb = animation.render(0);
  for (let i = 2; i < 16; ++i)
    assert.deepEqual([...pixel(rgb, 16 + i, 16)], palette((i - 2) * 15));
  assert.deepEqual([...pixel(rgb, 0, 0)], [0, 0, 0]);
});

test('Radar starts with a horizontal radial sweep and updates its phase after 25 ms', () => {
  const animation = create('radar');
  const rgb = animation.render(0);
  for (let offset = 0; offset < 16; ++offset)
    assert.deepEqual([...pixel(rgb, 31 - offset, 16)], palette(255 - offset * 16));
  animation.render(0.02);
  assert.equal(animation.theta, 0);
  animation.render(0.04);
  assert.equal(animation.theta, 2);
});

test('Attract and Bounce preserve upstream initial velocities and gravity updates', () => {
  const attract = create('attract', () => 0.5);
  assert.equal(attract.boids.length, 10);
  attract.render(0);
  assert.equal(attract.boids[0].x, 15.5);
  assert.equal(attract.boids[0].y, 31 - 5 / (16 * 16));
  const bounce = create('bounce', () => 0.5);
  assert.equal(bounce.boids.length, 32);
  bounce.render(0);
  assert.equal(bounce.boids[0].vy, 0.0125);
  assert.equal(bounce.boids[0].y, 4.0125);
  bounce.render(0.015);
  assert.equal(bounce.boids[0].vy, 0.025);
  assert.ok(Math.abs(bounce.boids[0].y - 4.0375) < 1e-12);
});

test('Cube preserves its mesh and Flow Field preserves its 50 ms update period', () => {
  const cube = create('cube');
  assert.equal(cube.vertices.length, 8);
  assert.equal(cube.faces.length, 6);
  assert.equal(cube.edges.length, 12);
  assert.equal(cube.interval, 20);
  assert.ok(cube.render(0).some(value => value > 0));
  const flow = create('flowfield');
  const before = flow.x;
  flow.render(0);
  flow.render(0.049);
  assert.equal(flow.x, (before + 1) & 65535);
  flow.render(0.05);
  assert.equal(flow.x, (before + 2) & 65535);
});

test('all ports retain trails and run identically at 10, 30, and 60 output fps', () => {
  for (const pattern of AURORA_PATTERNS) {
    const frames = [10, 30, 60].map((fps) => {
      const animation = pattern.createInstance(32, 32, randomGenerator());
      const first = animation.render(0).slice();
      for (let i = 1; i <= fps * 3; ++i)
        animation.render(i / fps);
      const rgb = animation.buffer.rgb;
      assert.equal(rgb.length, 32 * 32 * 3);
      assert.ok(rgb.some(value => value !== 0), `${pattern.id} must render`);
      assert.notDeepEqual(rgb, first, `${pattern.id} must animate`);
      return rgb;
    });
    assert.deepEqual(frames[0], frames[1], `${pattern.id}: 10 vs 30 fps`);
    assert.deepEqual(frames[0], frames[2], `${pattern.id}: 10 vs 60 fps`);
  }
});

test('pause, resume, re-selection, and invalid clock inputs do not corrupt state', () => {
  for (const pattern of AURORA_PATTERNS) {
    const animation = pattern.createInstance(32, 32, randomGenerator());
    const first = animation.render(10).slice();
    animation.render(10);
    assert.equal(animation.frames, 1);
    assert.deepEqual(animation.buffer.rgb, first, `${pattern.id}: paused frame`);
    animation.render(10.1);
    assert.ok(animation.frames > 1);
    const restarted = pattern.createInstance(32, 32, randomGenerator());
    assert.deepEqual(restarted.render(10.1), first, `${pattern.id}: fresh instance`);
    assert.throws(() => animation.render(NaN), /Aurora animation time/);
    assert.throws(() => animation.render(-1), /Aurora animation time/);
    assert.throws(() => animation.render(0), /Aurora animation time/);
    const before = animation.frames;
    animation.render(3600);
    assert.ok(animation.frames - before <= 67, `${pattern.id}: bounded resume`);
  }
});

test('all Aurora effects draw native frames rather than enlarged 32x32 blocks', () => {
  for (const pattern of AURORA_PATTERNS) {
    const animation = pattern.createInstance(256, 192, randomGenerator());
    const first = animation.render(0).slice();
    for (let i = 1; i <= 30; ++i)
      animation.render(i / 30);
    const { buffer } = animation;
    assert.equal(buffer.width, 256);
    assert.equal(buffer.height, 192);
    assert.equal(buffer.rgb.length, 147456);
    assert.notDeepEqual(buffer.rgb, first, `${pattern.id} must animate natively`);

    let detailedCells = 0;
    for (let y = 0; y < 192; y += 6) {
      for (let x = 0; x < 256; x += 8) {
        const origin = (y * 256 + x) * 3;
        let detailed = false;
        for (let dy = 0; dy < 6; ++dy) {
          for (let dx = 0; dx < 8; ++dx) {
            const index = ((y + dy) * 256 + x + dx) * 3;
            for (let c = 0; c < 3; ++c)
              detailed ||= buffer.rgb[index + c] !== buffer.rgb[origin + c];
          }
        }
        if (detailed) detailedCells++;
      }
    }
    assert.ok(detailedCells > 20, `${pattern.id} must have detail within former 8x6 blocks`);
  }
});

test('native simulations stay independent of output fps on rectangular panels', () => {
  for (const pattern of AURORA_PATTERNS) {
    const results = [10, 30, 60].map(fps => {
      const animation = pattern.createInstance(96, 64, randomGenerator());
      animation.render(0);
      for (let i = 1; i <= fps; ++i)
        animation.render(i / fps);
      return animation.buffer.rgb;
    });
    assert.deepEqual(results[0], results[1], `${pattern.id}: native 10 vs 30 fps`);
    assert.deepEqual(results[0], results[2], `${pattern.id}: native 10 vs 60 fps`);
  }
});

test('native dimensions support portrait, narrow, and greater-than-byte panels', () => {
  for (const [width, height] of [[48, 96], [320, 240], [1, 1], [1, 9], [9, 1]]) {
    for (const pattern of AURORA_PATTERNS) {
      const animation = pattern.createInstance(width, height, randomGenerator());
      animation.render(0);
      animation.render(0.1);
      const { buffer } = animation;
      assert.equal(buffer.rgb.length, width * height * 3);
      assert.ok(buffer.rgb.some(value => value > 0), `${pattern.id}: ${width}x${height}`);
    }
  }
  const wide = new AuroraBuffer(320, 240);
  wide.pixel(319, 239, [12, 34, 56]);
  assert.deepEqual([...wide.rgb.slice(-3)], [12, 34, 56]);
  assert.deepEqual([...wide.rgb.slice(0, 3)], [0, 0, 0]);
  for (const [width, height] of [[0, 32], [32, -1], [1.5, 32], [32, NaN]])
    assert.throws(() => new AuroraBuffer(width, height), /positive integers/);
});

test('native pendulum and wave draw continuous curves in every column or row', () => {
  for (const [width, height] of [[256, 192], [320, 240], [48, 96]]) {
    for (const id of ['aurora-pendulum-wave', 'aurora-wave']) {
      const animation = AURORA_PATTERNS.find(pattern => pattern.id === id)
        .createInstance(width, height, randomGenerator());
      animation.render(0);
      animation.render(0.8);
      const vertical = id === 'aurora-wave' && height > width;
      for (let i = 0; i < (vertical ? height : width); ++i) {
        let lit = false;
        for (let j = 0; j < (vertical ? width : height); ++j) {
          const index = (vertical ? i * width + j : j * width + i) * 3;
          lit ||= animation.buffer.rgb.subarray(index, index + 3).some(value => value > 0);
        }
        assert.ok(lit, `${id}: missing native ${vertical ? 'row' : 'column'} ${i}`);
      }
    }
  }
});

test('native soft geometry and scaled blur spread into adjacent pixels', () => {
  const buffer = new AuroraBuffer(65, 49);
  buffer.dot(32.5, 24, [255, 0, 0]);
  const red = (x, y) => buffer.rgb[(y * buffer.width + x) * 3];
  assert.equal(red(32, 24), 128);
  assert.equal(red(33, 24), 128);
  assert.equal(red(31, 24), 0);
  buffer.rgb.fill(0);
  buffer.line(5.25, 5.5, 58.75, 42.5, [255, 0, 0], false, 0.5);
  for (let x = 6; x < 59; ++x)
    assert.ok(Array.from({ length: 49 }, (_, y) => red(x, y)).some(value => value > 0));

  buffer.rgb.fill(0);
  buffer.pixel(32, 24, [255, 0, 0]);
  buffer.blur(172, 4, 3);
  for (let dx = -4; dx <= 4; ++dx)
    for (let dy = -3; dy <= 3; ++dy)
      assert.ok(red(32 + dx, 24 + dy) > 0, `blur must fill offset ${dx},${dy}`);
  assert.equal(red(27, 24), 0);
  assert.equal(red(32, 20), 0);
  assert.ok(red(32, 24) < 255);
});

test('rectangular spiral streams visit every native pixel only once', () => {
  const buffer = new AuroraBuffer(96, 64);
  buffer.rgb.fill(80);
  buffer.spiralStreamScaled(48, 32, 30, 20, 128, 3.25, 2.5);
  for (let y = 12; y <= 52; ++y)
    for (let x = 18; x <= 78; ++x)
      assert.equal(buffer.rgb[(y * 96 + x) * 3], 80, `unequal fading at ${x},${y}`);
  buffer.rgb.fill(0);
  buffer.pixel(68, 32, [255, 0, 0]);
  buffer.spiralStreamScaled(48, 32, 30, 20, 128, 3.25, 2.5);
  assert.ok(buffer.rgb[(29 * 96 + 68) * 3] > 0);
  assert.ok(buffer.rgb[(30 * 96 + 68) * 3] > 0);
  assert.equal(buffer.rgb[(28 * 96 + 68) * 3], 0);
});

test('flock options change exact bird count without restarting existing birds or trails', () => {
  const flock = create('flock');
  assert.equal(flock.boids.length, 10);
  flock.render(0);
  const first = flock.boids[0];
  const predator = flock.predator;
  const before = flock.buffer.rgb.slice();
  flock.setOptions({ count: 256, dotSize: 6 });
  assert.equal(flock.boids.length, 256);
  assert.equal(flock.boids[0], first);
  assert.equal(flock.predator, predator);
  assert.deepEqual(flock.buffer.rgb, before);
  assert.equal(flock.dotSize, 6);
  flock.render(0.02);
  flock.setOptions({ count: 1, dotSize: 1 });
  assert.equal(flock.boids.length, 1);
  assert.equal(flock.boids[0], first);
  flock.setOptions();
  assert.equal(flock.boids.length, 10);
  assert.equal(flock.dotSize, null);
  const large = AURORA_PATTERNS.find(pattern => pattern.id === 'aurora-flock')
    .createInstance(2048, 1, randomGenerator());
  assert.equal(large.boids.length, 256);
});

test('custom flock dots have the selected panel-pixel diameter even at 32x32', () => {
  for (const [width, height] of [[32, 32], [256, 192]]) {
    const flock = AURORA_PATTERNS.find(pattern => pattern.id === 'aurora-flock')
      .createInstance(width, height, randomGenerator());
    flock.setOptions({ count: 1, dotSize: 8 });
    const x = 15 * flock.scaleX, y = 15 * flock.scaleY;
    flock.trace(15, 15, 15, 15, [255, 0, 0]);
    const red = (px, py) => flock.buffer.rgb[(py * width + px) * 3];
    assert.ok(red(Math.round(x + 3), Math.round(y)) > 0);
    assert.equal(red(Math.round(x + 5), Math.round(y)), 0);
    flock.buffer.rgb.fill(0);
    flock.setOptions({ count: 1, dotSize: 1 });
    flock.trace(15, 15, 15, 15, [255, 0, 0]);
    assert.equal(red(Math.round(x + 3), Math.round(y)), 0);
  }
});

test('flock rejects invalid options without partially changing the simulation', () => {
  const flock = create('flock');
  for (const count of [0, 257, 1.5, NaN, Infinity, '10'])
    assert.throws(() => flock.setOptions({ count }), /Flock count/);
  for (const dotSize of [0, 33, NaN, Infinity, '4'])
    assert.throws(() => flock.setOptions({ count: 1, dotSize }), /Aurora dot diameter/);
  assert.equal(flock.boids.length, 10);
  assert.equal(flock.dotSize, null);
});

test('every Aurora port applies dot diameter to its rendered geometry at all resolutions', () => {
  for (const [width, height] of [[32, 32], [96, 64]]) {
    for (const pattern of AURORA_PATTERNS) {
      const small = pattern.createInstance(width, height, randomGenerator());
      const large = pattern.createInstance(width, height, randomGenerator());
      small.setDotSize(1);
      large.setDotSize(8);
      small.render(0);
      large.render(0);
      const lit = animation => animation.buffer.rgb.filter(value => value > 0).length;
      assert.ok(lit(large) > lit(small), `${pattern.id}: diameter must affect actual ${width}x${height} drawing`);
      assert.equal(small.frames, large.frames);
      const automatic = pattern.createInstance(width, height, randomGenerator());
      const reset = pattern.createInstance(width, height, randomGenerator());
      reset.setDotSize(8);
      reset.setDotSize(null);
      assert.deepEqual(reset.render(0), automatic.render(0), `${pattern.id}: automatic defaults preserved`);
    }
  }
});

test('Aurora diameter changes preserve state and reject invalid sizes', () => {
  for (const pattern of AURORA_PATTERNS) {
    const animation = pattern.createInstance(96, 64, randomGenerator());
    animation.render(0);
    const frame = animation.buffer.rgb.slice();
    animation.setDotSize(32);
    assert.equal(animation.frames, 1);
    assert.deepEqual(animation.buffer.rgb, frame);
    for (const size of [0, 33, NaN, Infinity, '4'])
      assert.throws(() => animation.setDotSize(size), /Aurora dot diameter/);
    assert.equal(animation.dotSize, 32);
    animation.render(0.1);
    assert.ok(animation.frames > 1);
  }
});

// Bounce's settings (T54): upstream, nothing puts energy back into the balls.
const FLOOR = 31;
const silence = { audio: {}, spectrum: new Uint8Array(256) };

// Runs Bounce for `seconds` from `from`, at 10 frames a second, and returns
// how high each ball got above the floor.
function bounceHeights(bounce, from, seconds, params, frame = () => silence) {
  const tops = bounce.boids.map(() => 0);
  for (let n = 1; n <= seconds * 10; ++n) {
    const time = from + n / 10;
    bounce.renderFrame({ auroraTime: time, ...frame(time) }, params);
    bounce.boids.forEach((boid, i) => { tops[i] = Math.max(tops[i], FLOOR - boid.y); });
  }
  return tops;
}

const ORIGINAL = { music: 0, keepAlive: false };

test('Bounce with Music at 0 and Keep bouncing off settles on the floor, as upstream', () => {
  const bounce = create('bounce');
  bounceHeights(bounce, 0, 300, ORIGINAL);
  assert.ok(Math.max(...bounceHeights(bounce, 300, 10, ORIGINAL)) < 0.5);
});

test('Bounce keeps bouncing in silence with Keep bouncing on', () => {
  const bounce = create('bounce');
  bounceHeights(bounce, 0, 300, {});
  const tops = bounceHeights(bounce, 300, 30, {});
  assert.ok(Math.min(...tops) > 5, `every ball relaunched: ${Math.min(...tops)}`);
});

test('each Bounce ball follows its own part of the spectrum, bass on the left', () => {
  const bounce = create('bounce');
  const params = { keepAlive: false };
  bounceHeights(bounce, 0, 300, params);
  const spectrum = new Uint8Array(256).fill(255, 0, 64);
  const tops = bounceHeights(bounce, 300, 3, params, () => ({ audio: {}, spectrum }));
  assert.ok(Math.min(...tops.slice(0, 8)) > 0.6 * FLOOR, 'the bass quarter rises');
  assert.ok(Math.max(...tops.slice(8)) < 0.5, 'the rest stays on the floor');
});

test('a beat kicks every Bounce ball, by the bass and Music', () => {
  const bounce = create('bounce');
  const params = { kicks: 'beat', music: 1, spread: 0, keepAlive: false };
  bounceHeights(bounce, 0, 300, params);
  const beatAt = (time) => ({ audio: { beat: time < 300.15 ? 1 : 0, bass: 1 }, spectrum: silence.spectrum });
  const tops = bounceHeights(bounce, 300, 3, params, beatAt);
  assert.ok(Math.min(...tops) > 0.9 * FLOOR, `every ball near the top: ${Math.min(...tops)}`);
});

test('a higher Gravity makes quicker bounces to the same height', () => {
  const landings = (gravity) => {
    const bounce = create('bounce');
    const params = { gravity, keepAlive: false };
    bounceHeights(bounce, 0, 300, params);
    const spectrum = new Uint8Array(256).fill(255, 0, 8);
    // Ten seconds at 100 frames a second, counting each turn from falling to rising.
    let count = 0, lastY = bounce.boids[0].y, falling = false;
    for (let n = 1; n <= 1000; ++n) {
      bounce.renderFrame({ auroraTime: 300 + n / 100, audio: {}, spectrum }, params);
      const y = bounce.boids[0].y;
      if (falling && y < lastY) ++count;
      if (y !== lastY) falling = y > lastY;
      lastY = y;
    }
    return count;
  };
  assert.ok(landings(4) > 1.5 * landings(1), `${landings(4)} landings against ${landings(1)}`);
});
