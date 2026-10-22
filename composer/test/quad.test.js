import assert from 'node:assert/strict';
import test from 'node:test';
import { PATTERNS } from '../public/patterns.js';
import { LOOK_DEFAULTS, lookSettings } from '../public/look.js';
import { SHAPE_DEFAULTS } from '../public/shape.js';
import {
  INPUT_DEFAULTS, INPUT_IDS, MASTER_DEFAULTS, PAIR_DEFAULTS, defaultLook, inputSettings, lookFromEntry, masterSettings,
  pairSettings, plainLook, quadFromSettings, quadSettings, resetInput, resetPair, swapLook, swappedInputs, swappedPair,
  wholeLook,
} from '../public/quad.js';
import { BLEND_MODES, blendPixel } from '../public/mixer.js';

// The quad mixer's model (T16): four inputs, two pairs, the master, whole looks.

test('with nothing saved: four plain inputs, both pairs showing their first input, the master on Left in Live mix', () => {
  const quad = quadSettings({}, PATTERNS);
  assert.deepEqual(Object.keys(quad.inputs), ['a', 'b', 'c', 'd']);
  for (const input of Object.values(quad.inputs)) assert.deepEqual(input, { ...INPUT_DEFAULTS, shape: SHAPE_DEFAULTS });
  assert.deepEqual(quad.pairs, { left: PAIR_DEFAULTS, right: PAIR_DEFAULTS });
  assert.equal(quad.pairs.left.enabled, false, 'B is not mixed in: A alone');
  assert.deepEqual(quad.master, MASTER_DEFAULTS);
  assert.equal(quad.master.position, 0, 'Left');
  assert.equal('gate' in quad.master, false, 'no Gated mode');
  assert.deepEqual(wholeLook({}, PATTERNS).shared, lookSettings(LOOK_DEFAULTS));
});

test('each input keeps its own Pattern settings, brightness and gamma, checked', () => {
  // Plasma on two inputs, set differently: settings are per input.
  const quad = quadSettings({ inputs: {
    a: { patternId: 'plasma', params: { scale: 5 }, brightness: 0.6, gamma: 2.2 },
    c: { patternId: 'plasma', params: { scale: 1.5, swell: 0.6 } },
  } }, PATTERNS);
  assert.deepEqual(quad.inputs.a.params, { scale: 5 });
  assert.deepEqual(quad.inputs.c.params, { scale: 1.5 }, 'only what differs from the defaults is kept');
  assert.equal(quad.inputs.a.brightness, 0.6);
  assert.equal(quad.inputs.c.brightness, 1);
  assert.equal(inputSettings({ gamma: 0.5 }, PATTERNS).gamma, 0.5, 'gamma below 1 lifts a dim pattern');
  for (const bad of [{ patternId: 'nope' }, { brightness: 1.2 }, { brightness: -0.1 }, { gamma: 0.4 }, { gamma: 3 },
    { params: [] }, { shape: { shape: 'triangle-ish' } }])
    assert.throws(() => inputSettings(bad, PATTERNS), undefined, JSON.stringify(bad));
  assert.throws(() => inputSettings('a'));
});

test('pairs and the master are checked against the blend table and their ranges', () => {
  assert.deepEqual(pairSettings({ enabled: true, mode: 'add', amount: 0.7 }), { enabled: true, mode: 'add', amount: 0.7 });
  for (const bad of [{ enabled: 1 }, { mode: 'blur' }, { amount: 1.5 }]) assert.throws(() => pairSettings(bad));
  assert.deepEqual(masterSettings({ position: 1, fadeStart: 'bar' }), { ...MASTER_DEFAULTS, position: 1, fadeStart: 'bar' });
  // Saved before Gated was removed: the gate is dropped, not refused.
  assert.deepEqual(masterSettings({ position: 1, gate: 'gated' }), { ...MASTER_DEFAULTS, position: 1 });
  for (const bad of [{ position: -0.1 }, { fadeSeconds: 11 }, { fadeStart: 'later' }, { blackout: 'no' },
    { mode: 'nope' }])
    assert.throws(() => masterSettings(bad), undefined, JSON.stringify(bad));
});

test('settings from before the quad mixer become Left; Right and the master take their defaults', () => {
  const old = {
    patternId: 'tunnel',
    mixer: { enabled: true, patternId: 'stars', mode: 'add', amount: 0.7 },
    shapes: { a: { ...SHAPE_DEFAULTS, shape: 'inside-out' }, b: { ...SHAPE_DEFAULTS, region: 'centre' } },
    patternParams: { tunnel: { speed: 2 }, stars: { layers: 3 }, plasma: { scale: 5 } },
  };
  const quad = quadFromSettings(old, PATTERNS);
  assert.equal(quad.inputs.a.patternId, 'tunnel');
  assert.deepEqual(quad.inputs.a.params, { speed: 2 });
  assert.equal(quad.inputs.a.shape.shape, 'inside-out');
  assert.equal(quad.inputs.b.patternId, 'stars');
  assert.deepEqual(quad.inputs.b.params, { layers: 3 });
  assert.equal(quad.inputs.b.shape.region, 'centre');
  assert.deepEqual(quad.pairs.left, { enabled: true, mode: 'add', amount: 0.7 });
  assert.deepEqual(quad.pairs.right, PAIR_DEFAULTS);
  assert.deepEqual(quad.inputs.c, { ...INPUT_DEFAULTS, shape: SHAPE_DEFAULTS });
  assert.deepEqual(quad.master, MASTER_DEFAULTS);
  // A fresh browser has none of it.
  assert.deepEqual(quadFromSettings({}, PATTERNS), quadSettings({}, PATTERNS));
  // Settings that already hold the quad mixer are only checked.
  const saved = { quad: { master: { position: 1 } }, patternId: 'tunnel' };
  assert.equal(quadFromSettings(saved, PATTERNS).master.position, 1);
  assert.equal(quadFromSettings(saved, PATTERNS).inputs.a.patternId, 'plasma');
});

// The look on screen in the entry tests: Right is busy, the master on Right.
function current() {
  return wholeLook({
    inputs: {
      a: { patternId: 'plasma', params: { scale: 5 }, brightness: 0.7 },
      b: { patternId: 'bars' },
      c: { patternId: 'tunnel', params: { speed: 3 } },
      d: { patternId: 'stars' },
    },
    pairs: { right: { enabled: true, mode: 'screen', amount: 0.4 } },
    master: { position: 1, fadeStart: 'bar' },
    shared: { ...LOOK_DEFAULTS, hue: 0.3 },
  }, PATTERNS);
}

test('a one-pair playlist entry loads into Left; Right, the master and unsaved shared settings stay', () => {
  const now = current();
  const entry = {
    name: 'Old', patternId: 'kaleido', seconds: 30,
    mixer: { enabled: true, patternId: 'cells', mode: 'difference', amount: 0.3 },
    shapes: { a: SHAPE_DEFAULTS, b: { ...SHAPE_DEFAULTS, region: 'centre' } },
  };
  const look = lookFromEntry(entry, now, PATTERNS);
  assert.equal(look.inputs.a.patternId, 'kaleido');
  assert.deepEqual(look.inputs.a.params, {}, 'a new pattern starts from its defaults');
  assert.equal(look.inputs.a.brightness, 0.7, 'the input keeps its trim');
  assert.equal(look.inputs.b.patternId, 'cells');
  assert.equal(look.inputs.b.shape.region, 'centre');
  assert.deepEqual(look.pairs.left, { enabled: true, mode: 'difference', amount: 0.3 });
  assert.deepEqual(look.inputs.c, now.inputs.c);
  assert.deepEqual(look.pairs.right, now.pairs.right);
  assert.deepEqual(look.master, now.master);
  assert.equal(look.shared.hue, 0.3, 'an entry without a look leaves the shared settings');
  // Same pattern, no saved parameters: the input's own stay.
  const same = lookFromEntry({ ...entry, patternId: 'plasma' }, now, PATTERNS);
  assert.deepEqual(same.inputs.a.params, { scale: 5 });
  // Since T38 an entry carries its look and parameters.
  const full = lookFromEntry({ ...entry, look: { ...LOOK_DEFAULTS, hue: 0.8 }, params: { kaleido: { segments: 9 } } },
    now, PATTERNS);
  assert.equal(full.shared.hue, 0.8);
  assert.deepEqual(full.inputs.a.params, { segments: 9 });
});

test('a quad entry is used whole', () => {
  const now = current();
  const saved = wholeLook({ inputs: { d: { patternId: 'cells' } }, master: { position: 0.5 } }, PATTERNS);
  const look = lookFromEntry({ quad: saved, shared: saved.shared }, now, PATTERNS);
  assert.deepEqual(look, saved);
});

test('the default look: plain patterns until one is saved, then the saved one, shared settings included', () => {
  const now = current();
  const plain = plainLook(now, PATTERNS);
  assert.deepEqual(INPUT_IDS.map((id) => plain.inputs[id].patternId), ['plasma', 'bars', 'tunnel', 'stars'],
    'each input keeps its pattern');
  for (const input of Object.values(plain.inputs)) {
    assert.deepEqual(input.params, {});
    assert.equal(input.brightness, 1);
    assert.deepEqual(input.shape, SHAPE_DEFAULTS);
  }
  assert.deepEqual(plain.pairs, { left: PAIR_DEFAULTS, right: PAIR_DEFAULTS });
  assert.deepEqual(plain.master, MASTER_DEFAULTS);
  assert.equal(plain.shared.hue, 0, 'shared settings back to their defaults');
  assert.deepEqual(defaultLook(null, now, PATTERNS), plain);
  const saved = wholeLook({ inputs: { a: { patternId: 'scope' } }, shared: { ...LOOK_DEFAULTS, speed: 2 } }, PATTERNS);
  assert.deepEqual(defaultLook(saved, now, PATTERNS), saved);
});

test('an input reset keeps its pattern with no effects; a pair reset shows its first input alone', () => {
  const now = current();
  assert.deepEqual(inputSettings(resetInput(now.inputs.a), PATTERNS),
    { ...INPUT_DEFAULTS, patternId: 'plasma', shape: SHAPE_DEFAULTS });
  assert.deepEqual(resetPair(), PAIR_DEFAULTS);
  assert.equal(resetPair().enabled, false);
});

// A pair's picture for one pixel: its first input alone while the second is
// not mixed in, else the blend (mixer.js's reference).
const pairPixel = (pair, first, second) => (pair.enabled ? blendPixel(pair.mode, first, second, pair.amount) : first);
const near = (x, y) => x.every((v, c) => Math.abs(v - y[c]) < 1e-9);
const PIXELS = [[[0.9, 0.2, 0.1], [0.1, 0.5, 0.8]], [[0, 0, 0], [1, 1, 1]], [[0.3, 0.7, 0.4], [0.6, 0.6, 0.05]]];

test('swapping a pair keeps the picture for every crossfade, at every position, and from its first input alone', () => {
  for (const mode of BLEND_MODES.filter((m) => m.kind === 'transition')) {
    for (const amount of [0, 0.1, 0.35, 0.5, 0.8, 1]) {
      for (const enabled of [true, false]) {
        const pair = { enabled, mode: mode.id, amount };
        const after = swappedPair(pair);
        for (const [x, y] of PIXELS)
          assert.ok(near(pairPixel(pair, x, y), pairPixel(after, y, x)), `${mode.id} at ${amount}, enabled ${enabled}`);
      }
    }
  }
  assert.deepEqual(swappedPair({ enabled: true, mode: 'crossfade', amount: 0.3 }), { enabled: true, mode: 'crossfade', amount: 0.7 });
});

test('a combine blend keeps its strength on a swap: the same picture at full strength only where the blend treats both alike', () => {
  const alike = ['average', 'add', 'screen', 'multiply', 'lighten', 'darken', 'difference'];
  for (const mode of BLEND_MODES.filter((m) => m.kind === 'combine')) {
    const pair = { enabled: true, mode: mode.id, amount: 1 };
    assert.deepEqual(swappedPair(pair), pair, 'the strength is kept');
    const same = PIXELS.every(([x, y]) => near(pairPixel(pair, x, y), pairPixel(pair, y, x)));
    assert.equal(same, alike.includes(mode.id), mode.id);
  }
  // One showing its first input alone shows the same after as a crossfade.
  const after = swappedPair({ enabled: false, mode: 'stencil', amount: 0.4 });
  assert.deepEqual(after, { enabled: true, mode: 'crossfade', amount: 1 });
});

test('a pair swap trades the two inputs whole; the other pair, its inputs and the master stay', () => {
  const quad = quadSettings({
    inputs: { a: { patternId: 'plasma', brightness: 0.5 }, b: { patternId: 'spectrum-tiles', gamma: 2 },
      c: { patternId: 'tunnel' }, d: { patternId: 'stars' } },
    pairs: { left: { enabled: true, mode: 'add', amount: 0.6 }, right: { enabled: true, mode: 'crossfade', amount: 0.25 } },
    master: { position: 0.25 },
  }, PATTERNS);
  const left = swapLook(quad, 'left');
  assert.deepEqual(left.inputs.a, quad.inputs.b);
  assert.deepEqual(left.inputs.b, quad.inputs.a);
  assert.deepEqual(left.pairs.left, { enabled: true, mode: 'add', amount: 0.6 });
  assert.deepEqual([left.inputs.c, left.inputs.d, left.pairs.right, left.master], [quad.inputs.c, quad.inputs.d, quad.pairs.right, quad.master]);
  const right = swapLook(quad, 'right');
  assert.deepEqual([right.inputs.c, right.inputs.d], [quad.inputs.d, quad.inputs.c]);
  assert.equal(right.pairs.right.amount, 0.75);
  assert.deepEqual(swapLook(swapLook(quad, 'right'), 'right'), quad, 'twice is back as it was');
  assert.deepEqual(swappedInputs('left'), [['a', 'b']]);
});

test('the master swap trades Left and Right whole, A with C and B with D, and moves a crossfading master across', () => {
  const look = wholeLook({
    inputs: { a: { patternId: 'plasma' }, b: { patternId: 'spectrum-tiles' }, c: { patternId: 'tunnel' }, d: { patternId: 'stars' } },
    pairs: { left: { enabled: true, mode: 'add', amount: 0.6 } },
    master: { position: 0.25, fadeSeconds: 4 },
  }, PATTERNS);
  const after = swapLook(look, 'master');
  assert.deepEqual([after.inputs.a, after.inputs.b, after.inputs.c, after.inputs.d],
    [look.inputs.c, look.inputs.d, look.inputs.a, look.inputs.b]);
  assert.deepEqual([after.pairs.left, after.pairs.right], [look.pairs.right, look.pairs.left]);
  assert.deepEqual(after.master, { ...look.master, position: 0.75 });
  assert.deepEqual(after.shared, look.shared, 'the shared settings stay');
  assert.equal(swapLook({ ...look, master: { ...look.master, mode: 'screen', position: 0.25 } }, 'master').master.position, 0.25,
    'a combine blend keeps its strength');
  assert.deepEqual(swapLook(after, 'master'), look, 'twice is back as it was');
  assert.deepEqual(swappedInputs('master'), [['a', 'c'], ['b', 'd']]);
});

test("an input's hue follows the main's (null) until it is given its own, 0 to 1", () => {
  assert.equal(quadSettings({}, PATTERNS).inputs.c.hue, null);
  assert.equal(inputSettings({ patternId: 'plasma', hue: 0.25 }, PATTERNS).hue, 0.25);
  for (const hue of [-0.1, 1.5, '0.5', Number.NaN])
    assert.throws(() => inputSettings({ patternId: 'plasma', hue }, PATTERNS), /hue/);
  const quad = quadSettings({ inputs: { a: { patternId: 'plasma', hue: 0.3 } } }, PATTERNS);
  assert.equal(swapLook(quad, 'left').inputs.b.hue, 0.3, 'a swap carries it');
  assert.equal(swapLook(quad, 'master').inputs.c.hue, 0.3);
  assert.equal(inputSettings(resetInput(quad.inputs.a), PATTERNS).hue, null, 'Reset follows the main again');
});
