import assert from 'node:assert/strict';
import test from 'node:test';
import { FIBONACCI_PATTERNS } from '../public/fibonacci-patterns.js';
import { AURORA_PATTERNS } from '../public/aurora-patterns.js';
import { PALETTES, PatternPalette, gradientColour } from '../public/palettes.js';
import { GRADIENTS } from '../public/gradient-palettes.js';

function random() {
  let seed = 12345;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test('five Fibonacci adaptations render native buffers and animate at small, portrait and large sizes', () => {
  assert.deepEqual(FIBONACCI_PATTERNS.map(pattern => pattern.id),
    ['fibonacci-bloom', 'fibonacci-chase', 'electric-mandala', 'radial-fire', 'phyllotaxis-bloom']);
  for (const [width, height] of [[32, 32], [48, 96], [256, 192], [1, 1], [1, 96], [96, 2], [8, 8]]) {
    for (const pattern of FIBONACCI_PATTERNS) {
      const animation = pattern.createInstance(width, height, random());
      const first = animation.render(0).slice();
      for (let i = 1; i <= 10; ++i) animation.render(i / 10);
      assert.equal(animation.buffer.rgb.length, width * height * 3);
      assert.ok(animation.buffer.rgb.some(value => value > 0), `${pattern.id} ${width}x${height}`);
      assert.notDeepEqual(animation.buffer.rgb, first, `${pattern.id} animates`);
    }
  }
});

test('Fibonacci simulations and palette transitions are independent of output frame rate', () => {
  for (const pattern of FIBONACCI_PATTERNS) {
    const frames = [10, 30, 60].map(fps => {
      const animation = pattern.createInstance(64, 48, random());
      animation.setPalette('es_ocean_breeze_036_gp');
      animation.render(0);
      for (let i = 1; i <= fps * 3; ++i) animation.render(i / fps);
      return animation.buffer.rgb;
    });
    assert.deepEqual(frames[0], frames[1], `${pattern.id} 10 vs 30`);
    assert.deepEqual(frames[0], frames[2], `${pattern.id} 10 vs 60`);
  }
});

test('golden-angle geometry is native and dot size increases Fibonacci point coverage', () => {
  for (const pattern of FIBONACCI_PATTERNS.slice(0, 2)) {
    const a = pattern.createInstance(256, 192, random());
    const b = pattern.createInstance(256, 192, random());
    assert.equal(a.points.length, 768);
    assert.ok(a.points.every(p => p.x >= 0 && p.x < 256 && p.y >= 0 && p.y < 192));
    a.setDotSize(1);
    b.setDotSize(8);
    a.render(0);
    b.render(0);
    assert.ok(b.buffer.rgb.filter(v => v > 0).length > a.buffer.rgb.filter(v => v > 0).length);
  }
});

test('Mandala starts with eight-fold coordinate symmetry and Fire retains 32 heat bands', () => {
  const mandala = FIBONACCI_PATTERNS[2].createInstance(33, 33, random());
  mandala.rotationSpeed = 0;
  mandala.phase = 0;
  mandala.render(0);
  const pixel = (x, y) => mandala.buffer.rgb.slice((y * 33 + x) * 3, (y * 33 + x) * 3 + 3);
  assert.deepEqual(pixel(12, 8), pixel(8, 12));
  assert.deepEqual(pixel(12, 8), pixel(20, 24));
  const fire = FIBONACCI_PATTERNS[3].createInstance(64, 48, random());
  assert.equal(fire.heat.length, 32);
  fire.render(0);
  fire.render(1);
  assert.ok(fire.heat.some(value => value > 0));
  assert.deepEqual([...fire.buffer.rgb.slice(0, 3)], [0, 0, 0]);
});

test('all 33 gradients preserve original stop endpoints and interpolate channels', () => {
  assert.equal(GRADIENTS.length, 33);
  assert.equal(PALETTES.length, 35);
  assert.equal(new Set(PALETTES.map(palette => palette.id)).size, 35);
  for (const gradient of GRADIENTS) {
    assert.equal(gradient.stops[0], 0);
    assert.equal(gradient.stops.at(-4), 255);
    assert.deepEqual(gradientColour(gradient.stops, 0), gradient.stops.slice(1, 4));
    assert.deepEqual(gradientColour(gradient.stops, 255), gradient.stops.slice(-3));
  }
  assert.deepEqual(gradientColour([0, 0, 0, 0, 255, 255, 128, 64], 128), [128, 128 * 128 / 255, 128 * 64 / 255]);
});

test('palette selection blends, supports rapid changes and leaves original defaults unchanged', () => {
  const palette = new PatternPalette();
  const original = palette.colour(80);
  palette.set('Sunset_Real_gp');
  assert.deepEqual(palette.colour(80), original);
  palette.advance(1);
  const midpoint = palette.colour(80);
  assert.notDeepEqual(midpoint, original);
  palette.set('es_ocean_breeze_036_gp');
  assert.deepEqual(palette.colour(80), midpoint);
  palette.advance(2);
  assert.equal(palette.previous, null);
  assert.throws(() => palette.set('missing'), /Unknown pattern palette/);
  for (const pattern of [...AURORA_PATTERNS, ...FIBONACCI_PATTERNS]) {
    const animation = pattern.createInstance(32, 32, random());
    animation.setPalette('original');
    animation.render(0);
    const frames = animation.frames;
    animation.setPalette('Sunset_Real_gp');
    assert.equal(animation.frames, frames);
    animation.render(2);
    assert.ok(animation.buffer.rgb.some(value => value > 0), pattern.id);
  }
});

test('paused patterns freeze palette blending and original colours can be restored', () => {
  for (const pattern of [...AURORA_PATTERNS, ...FIBONACCI_PATTERNS]) {
    const a = pattern.createInstance(32, 32, random());
    a.render(0);
    a.setPalette('Sunset_Real_gp');
    const paused = a.render(0).slice();
    assert.deepEqual(a.render(0), paused);
    assert.equal(a.paletteState.mix, 0);
    a.render(1);
    assert.ok(a.paletteState.mix > 0 && a.paletteState.mix < 1);
    a.setPalette('original');
    a.render(2);
    a.render(3);
    assert.equal(a.paletteState.mix, 1);
    assert.equal(a.paletteState.id, 'original');
    assert.equal(a.paletteState.previous, null);
  }
});

test('Phyllotaxis Bloom keeps the original\'s byte arithmetic', () => {
  const pattern = FIBONACCI_PATTERNS.find(p => p.id === 'phyllotaxis-bloom');
  const animation = pattern.createInstance(64, 48, random());
  const calls = [];
  animation.dot = (point, hue, bri, sat) => calls.push([point.index, hue, bri, sat]);
  animation.draw(0);
  // fibIdx 0 at ms 0: hue 0; both waves sin8(0) = 128; scale8(128, 128) = 64,
  // plus the floor of 15 = 79; saturation 255 - scale8(79, 80) = 231.
  assert.deepEqual(calls[0], [0, 0, 79, 231]);
  // fibIdx 1: hue 98; wave1 sin8(5), wave2 sin8(8).
  assert.equal(calls[1][1], 98);
  // At 800 ms the hue has turned by 800 / 80 = 10.
  calls.length = 0;
  animation.draw(800);
  assert.equal(calls[0][1], 10);
  assert.equal(calls.length, animation.points.length);
});
