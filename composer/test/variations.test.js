// Variations (T72): the patterns that roll dice draw them from a seed, so a
// variation can be kept, saved with a look and brought back.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PATTERNS } from '../public/patterns.js';
import { NEW_SEED_MAX, SEED_MAX, VARIATION_PARAM, needsReseed, newSeed, seededRandom } from '../public/seed.js';
import { changedParams, followedValues, paramProblems, paramValue, paramValues } from '../public/params.js';
import { TME_PATTERNS } from '../public/patterns/mark-estes/index.js';
import { TmeAnimation } from '../public/patterns/mark-estes/runtime.js';

const rolling = PATTERNS.filter((pattern) => pattern.params?.some((param) => param.type === 'variation'));

test('a seeded generator repeats, carries its seed, and new seeds stay in range', () => {
  const a = seededRandom(1234), b = seededRandom(1234), c = seededRandom(1235);
  const draws = (random) => Array.from({ length: 5 }, () => random());
  const first = draws(a);
  assert.deepEqual(first, draws(b));
  assert.notDeepEqual(first, draws(c));
  assert.ok(first.every((value) => value >= 0 && value < 1));
  assert.equal(a.seed, 1234);
  assert.equal(newSeed(() => 0), 1);
  assert.equal(newSeed(() => 0.9999999999), NEW_SEED_MAX);
  for (let i = 0; i < 100; ++i) {
    const seed = newSeed();
    assert.ok(Number.isInteger(seed) && seed >= 1 && seed <= NEW_SEED_MAX);
  }
  assert.ok(NEW_SEED_MAX < SEED_MAX, 'a longer seed saved before still loads');
});

test('the patterns that roll dice carry a Variation, and nothing else does', () => {
  const groups = {};
  for (const pattern of rolling) groups[pattern.group ?? pattern.id.split('-')[0]] = (groups[pattern.group ?? pattern.id.split('-')[0]] ?? 0) + 1;
  // Not the Aurora, Fibonacci and Visualizer App patterns that never draw
  // from their generator (no draws in 60 seconds, measured).
  assert.equal(rolling.length, 112);
  assert.deepEqual(groups, { fire: 1, spectrum: 1, aurora: 5, electric: 1, radial: 1, 'Mark Estes': 94, AuroraDrop: 9 });
  for (const pattern of rolling) {
    assert.ok(pattern.createInstance, pattern.id);
    assert.deepEqual(paramProblems(pattern), [], pattern.id);
    assert.equal(pattern.params.filter((param) => param.type === 'variation').length, 1, pattern.id);
  }
  for (const pattern of PATTERNS.filter((each) => each.glsl))
    assert.ok(!pattern.params?.some((param) => param.type === 'variation'), `${pattern.id} is a shader, with no dice`);
});

test('a variation is saved only when kept, held in range, and never follows', () => {
  assert.equal(paramValue(VARIATION_PARAM, 48213), 48213);
  for (const bad of [-1, 0, 1.5, SEED_MAX + 1, '7', null])
    assert.equal(paramValue(VARIATION_PARAM, bad), 0, String(bad));
  const pattern = PATTERNS.find((each) => each.id === 'tme-14');
  assert.deepEqual(changedParams(pattern, paramValues(pattern, {})), {});
  const kept = changedParams(pattern, { ...paramValues(pattern, {}), variation: 777 });
  assert.deepEqual(kept, { variation: 777 });
  assert.equal(paramValues(pattern, kept).variation, 777);
  const values = { ...paramValues(pattern, kept), follows: { variation: { source: 'lows', amount: 1 } } };
  assert.equal(followedValues(pattern, values, { audio: { bass: 1 } }).variation, 777);
  assert.deepEqual(changedParams(pattern, values), { variation: 777 }, 'no follow is kept for it');
});

test('an instance is made afresh only for a kept variation other than its own', () => {
  assert.equal(needsReseed(5, {}), false);
  assert.equal(needsReseed(5, { variation: 0 }), false);
  assert.equal(needsReseed(5, { variation: 5 }), false);
  assert.equal(needsReseed(5, { variation: 6 }), true);
  assert.equal(needsReseed(5, null), false);
});

// Frames of a pattern from a seed, with sound so the audio patterns draw.
function framesHash(pattern, seed) {
  const animation = pattern.createInstance(48, 32, seededRandom(seed));
  const hash = createHash('sha1');
  const spectrum = new Uint8Array(256);
  for (let frame = 0; frame < 90; ++frame) {
    for (let i = 0; i < 256; ++i) spectrum[i] = Math.round(120 + 100 * Math.sin(i * 0.1 + frame * 0.3));
    const state = {
      time: frame / 30, auroraTime: frame / 30, audioTime: frame / 30, paletteId: 'original', auroraDotSize: null,
      flock: { count: 3 }, spectrumOptions: {}, hue: 0.3, spectrum, spectrumLeft: spectrum, spectrumRight: spectrum,
      wave: spectrum, audio: { bass: 0.6, mid: 0.4, treble: 0.3, level: 0.5, beat: frame % 15 === 0 ? 1 : 0 },
    };
    hash.update(animation.renderFrame(state, paramValues(pattern, {})));
  }
  return hash.digest('hex');
}

test('every pattern that rolls dice shows the same variation from the same seed', () => {
  const same = [];
  for (const pattern of rolling) {
    assert.equal(framesHash(pattern, 101), framesHash(pattern, 101), pattern.id);
    if (framesHash(pattern, 102) === framesHash(pattern, 101)) same.push(pattern.id);
  }
  // Two seeds give two variations, but for these, measured: Bounce's dice act
  // only with Spread above 0 or in silence, and Wave rolls between two looks
  // (two pictures from ten seeds), which seeds 101 and 102 share.
  assert.deepEqual(same, ['aurora-bounce', 'aurora-wave']);
});

test('a kept Mark Estes variation does not re-roll; a free one re-rolls from a seed it names', () => {
  const pattern = TME_PATTERNS.find((each) => each.number === 62);
  const roll = (t) => JSON.stringify([t.targetfps, t.bfade, t.wind, t.fancy, t.dot, t.dot2, t.adjunct, t.steper,
    t.shifty, t.flop, t.dwell]);
  const kept = new TmeAnimation(pattern, 64, 32, seededRandom(900));
  kept.applySettings({ variation: 900 });
  const before = roll(kept.runtime);
  kept.runtime.ms = kept.runtime.patternStart + kept.runtime.dwell;
  kept.runtime.step();
  assert.equal(roll(kept.runtime), before, 'kept: the same roll after the dwell');
  assert.equal(kept.seed, 900);

  const free = new TmeAnimation(pattern, 64, 32, seededRandom(900));
  free.applySettings({});
  free.runtime.ms = free.runtime.patternStart + free.runtime.dwell;
  free.runtime.step();
  assert.equal(free.runtime.counter, 0, 're-rolled');
  assert.notEqual(free.seed, 900);
  // The seed it now names brings that roll back in a new instance.
  const again = new TmeAnimation(pattern, 64, 32, seededRandom(free.seed));
  assert.equal(roll(again.runtime), roll(free.runtime));
});
