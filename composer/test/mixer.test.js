import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLEND_GLSL, BLEND_MODES, COMPOSITE_GLSL, MIXER_DEFAULTS, blendModeIndex, blendPixel, compositePixel, mixerSettings,
} from '../public/mixer.js';
import { PATTERNS } from '../public/patterns.js';

const A = [0.8, 0.4, 0.1], B = [0.2, 0.6, 1.0];
const near = (actual, expected) => actual.forEach((value, i) =>
  assert.ok(Math.abs(value - expected[i]) < 1e-9, `${actual} versus ${expected}`));

test('mixer settings validate mode, amount and pattern, and default to off', () => {
  const ids = PATTERNS.map(pattern => pattern.id);
  assert.deepEqual(mixerSettings(undefined, ids), MIXER_DEFAULTS);
  assert.equal(MIXER_DEFAULTS.enabled, false);
  assert.deepEqual(mixerSettings({ enabled: true, amount: 1 }, ids),
    { ...MIXER_DEFAULTS, enabled: true, amount: 1 });
  assert.throws(() => mixerSettings({ mode: 'sparkle' }), /blend mode/);
  assert.throws(() => mixerSettings({ amount: 1.5 }), /amount/);
  assert.throws(() => mixerSettings({ amount: NaN }), /amount/);
  assert.throws(() => mixerSettings({ patternId: 'missing' }, ids), /mixer pattern/);
  assert.throws(() => mixerSettings({ enabled: 'yes' }), /boolean/);
  assert.throws(() => mixerSettings([]), /options object/);
});

test('blend modes have unique ids and the requested transitions and combines', () => {
  assert.equal(new Set(BLEND_MODES.map(mode => mode.id)).size, BLEND_MODES.length);
  for (const id of ['crossfade', 'equal-power', 'dip-to-black', 'average', 'add', 'screen',
    'multiply', 'lighten', 'darken', 'stencil', 'overlay'])
    assert.ok(blendModeIndex(id) >= 0, id);
  assert.throws(() => blendModeIndex('nope'), /blend mode/);
});

test('transitions run from layer A at 0 to layer B at 1', () => {
  for (const mode of BLEND_MODES.filter(mode => mode.kind === 'transition')) {
    near(blendPixel(mode.id, A, B, 0), A);
    near(blendPixel(mode.id, A, B, 1), B);
  }
  near(blendPixel('crossfade', A, B, 0.5), [0.5, 0.5, 0.55]);
  near(blendPixel('dip-to-black', A, B, 0.5), [0, 0, 0]);
  near(blendPixel('dip-to-black', A, B, 0.25), A.map(value => value / 2));
  // Equal power keeps the summed squared gains at one through the fade.
  const gains = blendPixel('equal-power', [1, 0, 0], [0, 1, 0], 0.5);
  assert.ok(Math.abs(gains[0] ** 2 + gains[1] ** 2 - 1) < 1e-9);
});

test('combine modes leave layer A untouched at 0 and apply fully at 1', () => {
  for (const mode of BLEND_MODES.filter(mode => mode.kind === 'combine'))
    near(blendPixel(mode.id, A, B, 0), A);
  near(blendPixel('average', A, B, 1), [0.5, 0.5, 0.55]);
  near(blendPixel('add', A, B, 1), [1, 1, 1]);
  near(blendPixel('screen', A, B, 1), [0.84, 0.76, 1]);
  near(blendPixel('multiply', A, B, 1), [0.16, 0.24, 0.1]);
  near(blendPixel('lighten', A, B, 1), [0.8, 0.6, 1]);
  near(blendPixel('darken', A, B, 1), [0.2, 0.4, 0.1]);
  near(blendPixel('overlay', A, B, 1), [0.68, 0.48, 0.2]);
  near(blendPixel('difference', A, B, 1), [0.6, 0.2, 0.9]);
  near(blendPixel('stencil', A, [1, 1, 1], 1), A);
  near(blendPixel('stencil', A, [0, 0, 0], 1), [0, 0, 0]);
  near(blendPixel('multiply', A, B, 0.5), [0.48, 0.32, 0.1]);
});

test('compositor GLSL has one branch per mode in index order', () => {
  assert.match(BLEND_GLSL, /vec3 blendLayers\(vec3 a, vec3 b, int mode, float t\)/);
  BLEND_MODES.forEach((mode, index) => {
    assert.ok(BLEND_GLSL.includes(`if (mode == ${index}) c = `), mode.id);
    assert.ok(BLEND_GLSL.includes(mode.glsl), mode.id);
  });
  assert.equal(BLEND_GLSL.split('{').length, BLEND_GLSL.split('}').length);
  assert.equal(BLEND_GLSL.split('(').length, BLEND_GLSL.split(')').length);
});

test('a layer limited to a region never blacks out the other layer', () => {
  for (const mode of BLEND_MODES) {
    for (const amount of [0, 0.5, 1]) {
      near(compositePixel(mode.id, A, B, amount, true, false), A);
      near(compositePixel(mode.id, A, B, amount, false, true), B);
      near(compositePixel(mode.id, A, B, amount, false, false), [0, 0, 0]);
      near(compositePixel(mode.id, A, B, amount, true, true), blendPixel(mode.id, A, B, amount));
    }
  }
  // Multiply against an absent layer used to give black.
  near(compositePixel('multiply', A, [0, 0, 0], 1, true, false), A);
  assert.match(COMPOSITE_GLSL, /vec3 compositeLayers\(vec4 a, vec4 b, int mode, float t\)/);
  assert.ok(COMPOSITE_GLSL.includes('float both = max(0.0, a.a + b.a - 1.0);'));
});

test('soft borders crossfade between opposite regions and fade a lone layer out', () => {
  // Opposite regions with the same softness: coverage adds up to one, there
  // is no overlap, and the result is a plain mix whatever the blend.
  for (const mode of BLEND_MODES) {
    for (const s of [0.1, 0.5, 0.8])
      near(compositePixel(mode.id, A, B, 1, 1 - s, s), A.map((value, c) => value * (1 - s) + B[c] * s));
  }
  // A soft-edged layer over one that covers everything: the blend fades in.
  near(compositePixel('multiply', A, B, 1, 0.25, 1),
    blendPixel('multiply', A, B, 1).map((value, c) => value * 0.25 + B[c] * 0.75));
  // A lone soft-edged layer fades to black.
  near(compositePixel('add', A, B, 1, 0.4, 0), A.map(value => value * 0.4));
  // Brightness never dips across a border between two equal layers.
  for (let i = 0; i <= 10; ++i)
    near(compositePixel('screen', A, A, 1, 1 - i / 10, i / 10), A);
});

test('an input trim leaves an untrimmed colour untouched and applies gamma then brightness', async () => {
  const { trimPixel } = await import('../public/mixer.js');
  const colour = [0.2, 0.5, 1];
  assert.equal(trimPixel(colour), colour, 'the same array, not a recomputed one');
  assert.equal(trimPixel(colour, 1, 1), colour);
  assert.deepEqual(trimPixel(colour, 0.5, 1), [0.1, 0.25, 0.5]);
  assert.deepEqual(trimPixel(colour, 1, 2).map((v) => +v.toFixed(6)), [0.04, 0.25, 1]);
  assert.deepEqual(trimPixel(colour, 0.5, 2).map((v) => +v.toFixed(6)), [0.02, 0.125, 0.5]);
});
