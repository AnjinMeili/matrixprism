import assert from 'node:assert/strict';
import test from 'node:test';
import { PATTERNS } from '../public/patterns.js';
import {
  FOLLOW_SOURCES, changedParams, cleanFollows, followValue, followedValues, formatParam, paramProblems,
  paramUniforms, paramValue, paramValues, uniformValue,
} from '../public/params.js';

// Pattern parameters (T33 step 1): each pattern declares its own.

const pattern = {
  id: 'demo',
  params: [
    { id: 'scale', name: 'Scale', min: 0.5, max: 8, step: 0.1, default: 3 },
    { id: 'count', name: 'Count', min: 1, max: 12, step: 1, default: 6 },
    { id: 'grid', name: 'Grid', type: 'bool', default: true },
    { id: 'mode', name: 'Mode', type: 'choice', choices: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], default: 'a' },
  ],
};

test('every pattern declares its parameters soundly, with defaults on their steps', () => {
  const problems = PATTERNS.flatMap(paramProblems);
  assert.deepEqual(problems, []);
  for (const p of PATTERNS)
    for (const param of p.params ?? [])
      assert.equal(paramValue(param, param.default), param.default, `${p.id}.${param.id}`);
});

test('a shader pattern reads every parameter it declares, and none it does not', () => {
  for (const p of PATTERNS.filter((entry) => entry.glsl)) {
    const used = new Set(p.glsl.match(/\bp_[a-zA-Z0-9]+/g) ?? []);
    // A parameter marked `state` is read by the pattern's JavaScript state
    // (createState), not by its shader.
    const declared = new Set((p.params ?? []).filter((param) => !param.state).map((param) => `p_${param.id}`));
    assert.deepEqual([...used].sort(), [...declared].sort(), p.id);
  }
});

test('the shader patterns have parameters, except the test card', () => {
  const without = PATTERNS.filter((p) => p.glsl && !p.params?.length).map((p) => p.id);
  assert.deepEqual(without, ['panel-range']);
});

test('values are made valid: numbers clamped and stepped, bools and choices checked', () => {
  const [scale, count, grid, mode] = pattern.params;
  assert.equal(paramValue(scale, 3.04), 3);
  assert.equal(paramValue(scale, 0.3 + 0.1 * 3), 0.6, 'no float drift');
  assert.equal(paramValue(scale, 99), 8);
  assert.equal(paramValue(scale, -1), 0.5);
  assert.equal(paramValue(count, 6.6), 7);
  assert.equal(paramValue(scale, '4'), 3, 'not a number: the default');
  assert.equal(paramValue(scale, NaN), 3);
  assert.equal(paramValue(grid, false), false);
  assert.equal(paramValue(grid, 0), true);
  assert.equal(paramValue(mode, 'b'), 'b');
  assert.equal(paramValue(mode, 'c'), 'a');
});

test('saved values fill in over the defaults; only changes are kept', () => {
  assert.deepEqual(paramValues(pattern, { scale: 5, gone: 1 }), { scale: 5, count: 6, grid: true, mode: 'a' });
  assert.deepEqual(paramValues(pattern, null), { scale: 3, count: 6, grid: true, mode: 'a' });
  assert.deepEqual(paramValues({ id: 'none' }, { x: 1 }), {});
  assert.deepEqual(changedParams(pattern, { scale: 3, count: 7, grid: false, mode: 'nope' }), { count: 7, grid: false });
});

test('uniforms carry numbers as they are, bools as 0 or 1, choices as their index', () => {
  assert.equal(paramUniforms(pattern), 'uniform float p_scale;\nuniform float p_count;\nuniform float p_grid;\nuniform float p_mode;');
  const [scale, , grid, mode] = pattern.params;
  assert.equal(uniformValue(scale, 2.5), 2.5);
  assert.equal(uniformValue(grid, true), 1);
  assert.equal(uniformValue(grid, false), 0);
  assert.equal(uniformValue(mode, 'b'), 1);
});

test('values are shown with the decimals of their step', () => {
  const [scale, count, grid, mode] = pattern.params;
  assert.equal(formatParam(scale, 3), '3.0');
  assert.equal(formatParam(count, 6), '6');
  assert.equal(formatParam({ ...scale, step: 0.005 }, 0.085), '0.085');
  assert.equal(formatParam(grid, false), 'off');
  assert.equal(formatParam(mode, 'b'), 'B');
});

test('declaration faults are reported', () => {
  const bad = { id: 'bad', params: [
    { id: '1x', name: 'A', min: 0, max: 1, step: 0.1, default: 0 },
    { id: 'b', name: 'B', min: 1, max: 0, step: 0.1, default: 0 },
    { id: 'c', name: 'C', min: 0, max: 1, step: 0, default: 2 },
    { id: 'c', name: '', type: 'bool', default: 1 },
    { id: 'd', name: 'D', type: 'choice', choices: [{ id: 'x', name: 'X' }], default: 'y' },
    { id: 'e', name: 'E', type: 'colour', default: 0 },
  ] };
  assert.deepEqual(paramProblems(bad), [
    'bad.1x: id must be letters and digits, starting with a letter',
    'bad.b: min and max must be numbers, min below max',
    'bad.b: default 0 outside 1 to 0',
    'bad.c: step must be above 0',
    'bad.c: default 2 outside 0 to 1',
    'bad.c: declared twice',
    'bad.c: no name',
    'bad.c: default must be true or false',
    'bad.d: default is not one of the choices',
    'bad.e: unknown type colour',
  ]);
});

// Follows (#21): number settings that follow the music.

test('follows are kept for number settings only, valid, and only when they differ from Off at 50%', () => {
  assert.deepEqual(cleanFollows(pattern, {
    scale: { source: 'lows', amount: 0.33 },
    count: { source: 'off', amount: 0.5 },
    grid: { source: 'highs', amount: 1 },
    gone: { source: 'mids', amount: 1 },
  }), { scale: { source: 'lows', amount: 0.35 } });
  assert.deepEqual(followValue({ source: 'nonsense', amount: 7 }), { source: 'off', amount: 1 });
  assert.deepEqual(followValue({ source: 'key', amount: -0.01 }), { source: 'key', amount: 0 });
  assert.deepEqual(cleanFollows(pattern, 'junk'), {});
  // Off with another amount is kept, so the amount survives a reload.
  assert.deepEqual(cleanFollows(pattern, { scale: { source: 'off', amount: -0.5 } }), { scale: { source: 'off', amount: -0.5 } });
  // changedParams and paramValues carry them; with none there is no key.
  assert.deepEqual(changedParams(pattern, { follows: { scale: { source: 'beat', amount: 0.5 } } }),
    { follows: { scale: { source: 'beat', amount: 0.5 } } });
  assert.equal('follows' in paramValues(pattern, {}), false);
  assert.deepEqual(paramValues(pattern, { follows: { count: { source: 'bar', amount: 1 } } }).follows,
    { count: { source: 'bar', amount: 1 } });
});

test('a following setting moves from its resting point by source times amount times its range, within it', () => {
  const state = { audio: { bass: 0.5, mid: 1, treble: 0.25, level: 0, beat: 1, highHit: 0 }, beatPosition: 6, musicalKey: { camelot: { number: 4 } } };
  const values = paramValues(pattern, { scale: 3, follows: { scale: { source: 'lows', amount: 0.5 } } });
  // 3 + 0.5 x 0.5 x (8 - 0.5) = 4.875; the resting value is left alone.
  assert.equal(followedValues(pattern, values, state).scale, 4.875);
  assert.equal(values.scale, 3);
  const down = paramValues(pattern, { follows: { scale: { source: 'lows', amount: -0.5 } } });
  assert.equal(followedValues(pattern, down, state).scale, 3 - 1.875);
  // Held within the range.
  const far = paramValues(pattern, { scale: 7, follows: { scale: { source: 'mids', amount: 1 } } });
  assert.equal(followedValues(pattern, far, state).scale, 8);
  // Whole steps stay whole: 6 + 0.25 x 0.5 x 11 = 7.375, put on 7.
  const count = paramValues(pattern, { follows: { count: { source: 'highs', amount: 0.5 } } });
  assert.equal(followedValues(pattern, count, state).count, 7);
  // Key: Camelot 4 is 3/12 round; bar: beat 6 is half way through a bar.
  const key = paramValues(pattern, { scale: 0.5, follows: { scale: { source: 'key', amount: 1 } } });
  assert.equal(followedValues(pattern, key, state).scale, 0.5 + 0.25 * 7.5);
  const bar = paramValues(pattern, { scale: 0.5, follows: { scale: { source: 'bar', amount: 1 } } });
  assert.equal(followedValues(pattern, bar, state).scale, 0.5 + 0.5 * 7.5);
  // No key, no beat clock, no audio: the resting value.
  const quiet = followedValues(pattern, key, {});
  assert.equal(quiet.scale, 0.5);
  // Off follows nothing; with no follows the same object comes back.
  const off = paramValues(pattern, { follows: { scale: { source: 'off', amount: -1 } } });
  assert.equal(followedValues(pattern, off, state).scale, 3);
  const plain = paramValues(pattern, {});
  assert.equal(followedValues(pattern, plain, state), plain);
});

test('every follow source reads 0 to 1 from a frame\'s state', () => {
  const state = { audio: { bass: 0.2, mid: 0.4, treble: 0.6, level: 0.8, beat: 1, highHit: 0.3 }, beatPosition: -1, musicalKey: { camelot: { number: 12 } } };
  for (const source of FOLLOW_SOURCES.filter((entry) => entry.read)) {
    const reading = source.read(state);
    assert.ok(reading >= 0 && reading <= 1, `${source.id}: ${reading}`);
  }
  assert.equal(FOLLOW_SOURCES.find((entry) => entry.id === 'bar').read(state), 0.75);
  assert.equal(FOLLOW_SOURCES.find((entry) => entry.id === 'key').read(state), 11 / 12);
});
