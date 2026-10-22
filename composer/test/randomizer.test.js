import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RANDOM_BLENDS, RANDOMIZER_DEFAULTS, Randomizer, TRACKS, coverPanel, randomBlend, randomMedia, randomPattern,
  randomShape,
  WAIT_UNITS, randomizerSettings, waitLabel,
} from '../public/randomizer.js';
import { mixerSettings } from '../public/mixer.js';
import { shapeSettings } from '../public/shape.js';

// remaining() in seconds needs only the unit.
const SECONDS = { unit: 'seconds' };

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test('randomizer settings validate times and tracks, and default to off', () => {
  assert.deepEqual(randomizerSettings(), RANDOMIZER_DEFAULTS);
  assert.equal(RANDOMIZER_DEFAULTS.enabled, false);
  assert.deepEqual(TRACKS.map(track => track.id), ['patternA', 'shapeA', 'patternB', 'shapeB', 'blend',
    'patternC', 'shapeC', 'patternD', 'shapeD', 'blendRight', 'colour', 'media']);
  const settings = randomizerSettings({ enabled: true, minWait: 5, maxWait: 5, tracks: { blend: false } });
  assert.equal(settings.tracks.blend, false);
  assert.equal(settings.tracks.patternA, true);
  assert.throws(() => randomizerSettings({ minWait: 30, maxWait: 10 }), /minimum/);
  assert.throws(() => randomizerSettings({ minWait: 0 }), /between/);
  assert.throws(() => randomizerSettings({ tracks: { patternA: 'yes' } }), /on or off/);
  assert.throws(() => randomizerSettings([]), /options object/);
});

test('each track changes on its own timer, within the minimum and maximum', () => {
  const settings = randomizerSettings({ enabled: true, minWait: 10, maxWait: 30 });
  const randomizer = new Randomizer(seeded(1));
  assert.deepEqual(randomizer.tick(0, settings, true), [], 'nothing changes the moment it is switched on');
  const last = Object.fromEntries(TRACKS.map(track => [track.id, 0]));
  const gaps = Object.fromEntries(TRACKS.map(track => [track.id, []]));
  for (let now = 100; now <= 600000; now += 100) {
    for (const id of randomizer.tick(now, settings, true, true, true)) {
      gaps[id].push(now - last[id]);
      last[id] = now;
    }
  }
  for (const { id } of TRACKS) {
    assert.ok(gaps[id].length >= 15, `${id} changed ${gaps[id].length} times`);
    assert.ok(gaps[id].every(gap => gap >= 10000 && gap <= 30100), `${id} gaps ${Math.min(...gaps[id])}..${Math.max(...gaps[id])}`);
    assert.ok(new Set(gaps[id]).size > 5, `${id} waits vary`);
  }
  // Independent: the layers do not change at the same moments.
  assert.notDeepEqual(gaps.patternA.slice(0, 5), gaps.patternB.slice(0, 5));
});

test('tracks pause when switched off, and layer B tracks idle while the mixer is off', () => {
  const settings = randomizerSettings({ enabled: true, minWait: 1, maxWait: 1 });
  const randomizer = new Randomizer(seeded(2));
  randomizer.tick(0, settings, false);
  assert.deepEqual(randomizer.tick(1000, settings, false), ['patternA', 'shapeA', 'patternC', 'shapeC', 'colour']);
  assert.equal(randomizer.remaining('patternB', SECONDS, 1000), null);
  assert.equal(randomizer.remaining('patternA', SECONDS, 1500), 0.5);
  // Turning the mixer on starts layer B's timers from now.
  assert.deepEqual(randomizer.tick(2000, settings, true), ['patternA', 'shapeA', 'patternC', 'shapeC', 'colour']);
  assert.deepEqual(randomizer.tick(3000, settings, true).sort(),
    TRACKS.filter(track => !track.needsMedia && !track.needsRight).map(track => track.id).sort());
  const onlyA = randomizerSettings({ ...settings, tracks: Object.fromEntries(TRACKS.map(t => [t.id, t.id === 'patternA'])) });
  assert.deepEqual(randomizer.tick(4000, onlyA, true), ['patternA']);
  assert.deepEqual(randomizer.tick(5000, randomizerSettings({ ...settings, enabled: false }), true), []);
  assert.equal(randomizer.remaining('patternA', SECONDS, 5000), null, 'switching off clears every timer');
});

test('the quad mixer\'s Right has its own timers; D\'s and its blend idle while Right\'s mixing is off', () => {
  const settings = randomizerSettings({ enabled: true, minWait: 1, maxWait: 1 });
  const randomizer = new Randomizer(seeded(6));
  randomizer.tick(0, settings, false);
  assert.ok(randomizer.tick(1000, settings, false).includes('patternC'), 'C changes with Right\'s mixing off');
  assert.equal(randomizer.remaining('patternD', SECONDS, 1000), null);
  assert.equal(randomizer.remaining('blendRight', SECONDS, 1000), null);
  // Turning Right's mixing on starts D's and the blend's timers from now,
  // whatever Left's mixer is doing.
  assert.deepEqual(randomizer.tick(2000, settings, false, false, true).filter(id => /D$|Right$/.test(id)), []);
  assert.deepEqual(randomizer.tick(3000, settings, false, false, true).filter(id => /D$|Right$/.test(id)),
    ['patternD', 'shapeD', 'blendRight']);
  assert.ok(!randomizer.tick(4000, settings, false, false, true).includes('patternB'), 'Left\'s B stays idle');
});

test('restarting tracks gives them a whole wait from their next tick, the others carrying on', () => {
  const settings = randomizerSettings({ enabled: true, minWait: 10, maxWait: 10 });
  const randomizer = new Randomizer(seeded(7));
  randomizer.tick(0, settings, true, false, true);
  randomizer.restart(['patternC', 'shapeC']);
  assert.equal(randomizer.remaining('patternC', SECONDS, 9000), null);
  randomizer.tick(9000, settings, true, false, true);
  assert.equal(randomizer.remaining('patternC', SECONDS, 9000), 10, 'a whole wait from the reset');
  assert.equal(randomizer.remaining('patternD', SECONDS, 9000), 1, 'D keeps its own');
  const due = randomizer.tick(10000, settings, true, false, true);
  assert.ok(due.includes('patternD') && !due.includes('patternC') && !due.includes('shapeC'));
});

test('saved randomizer settings give Right the choices they held for Left', () => {
  const saved = randomizerSettings({ enabled: true, tracks: { patternA: false, shapeB: false, blend: false } });
  assert.equal(saved.tracks.patternC, false);
  assert.equal(saved.tracks.shapeD, false);
  assert.equal(saved.tracks.blendRight, false);
  assert.equal(saved.tracks.shapeC, true);
  assert.equal(saved.tracks.patternD, true);
  // Once Right has its own choice, it keeps it.
  const own = randomizerSettings({ ...saved, tracks: { ...saved.tracks, patternC: true } });
  assert.equal(own.tracks.patternA, false);
  assert.equal(own.tracks.patternC, true);
});

test('random choices are valid and avoid what is already showing', () => {
  const random = seeded(3);
  const patterns = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'empty', isReady: () => false }];
  for (let i = 0; i < 100; ++i) {
    const pattern = randomPattern(patterns, ['a'], random);
    assert.ok(['b', 'c'].includes(pattern.id));
    assert.doesNotThrow(() => mixerSettings({ ...randomBlend(random), patternId: 'x' }));
    const blend = randomBlend(random);
    assert.ok(blend.amount >= 0.3 && blend.amount <= 1);
    assert.doesNotThrow(() => shapeSettings(randomShape(random)));
    assert.equal(randomShape(random, false).region, 'full');
  }
  assert.equal(randomPattern([{ id: 'a' }], ['a'], random).id, 'a', 'falls back when there is no alternative');
  assert.equal(randomPattern([], [], random), null);
  const regions = new Set(), shapes = new Set();
  for (let i = 0; i < 200; ++i) {
    const shape = randomShape(random);
    regions.add(shape.region);
    shapes.add(shape.shape);
  }
  assert.equal(regions.size, 3);
  assert.equal(shapes.size, 3);
});

test('random blends leave out the ones that black the picture out', () => {
  const random = seeded(4), seen = new Set();
  for (let i = 0; i < 400; ++i) seen.add(randomBlend(random).mode);
  assert.deepEqual([...seen].sort(), [...RANDOM_BLENDS].sort());
  for (const dark of ['multiply', 'darken', 'stencil', 'overlay', 'dip-to-black'])
    assert.ok(!seen.has(dark), dark);
});

test('random shapes always leave the panel covered by one layer or the other', () => {
  const random = seeded(5);
  const covered = (shapes) => {
    const { a, b } = shapes;
    if (a.region === 'full' || b.region === 'full') return true;
    return a.region !== b.region && a.outline === b.outline && a.width === b.width &&
      a.height === b.height && a.proportional === b.proportional;
  };
  let shapes = { a: shapeSettings(), b: shapeSettings() }, complements = 0;
  for (let i = 0; i < 500; ++i) {
    const layer = random() < 0.5 ? 'a' : 'b';
    const before = shapes[layer === 'a' ? 'b' : 'a'];
    shapes = coverPanel({ ...shapes, [layer]: shapeSettings(randomShape(random)) }, layer);
    assert.ok(covered(shapes), JSON.stringify(shapes));
    const after = shapes[layer === 'a' ? 'b' : 'a'];
    // The other layer keeps its own bend and movement.
    assert.equal(after.shape, before.shape);
    assert.equal(after.spin, before.spin);
    assert.doesNotThrow(() => shapeSettings(after));
    if (shapes.a.region !== 'full' && shapes.b.region !== 'full') complements++;
  }
  assert.ok(complements > 50, 'side-by-side layouts still turn up');
  // The same for C and D on the quad mixer's Right.
  let right = { c: shapeSettings(), d: shapeSettings() };
  for (let i = 0; i < 200; ++i) {
    const input = random() < 0.5 ? 'c' : 'd';
    right = coverPanel({ ...right, [input]: shapeSettings(randomShape(random)) }, input);
    assert.deepEqual(Object.keys(right).sort(), ['c', 'd']);
    assert.ok(covered({ a: right.c, b: right.d }), JSON.stringify(right));
  }
});

test('the media track only runs while there is a folder to choose from', () => {
  const settings = randomizerSettings({ enabled: true, minWait: 1, maxWait: 1 });
  const randomizer = new Randomizer(seeded(3));
  randomizer.tick(0, settings, false);
  assert.equal(randomizer.remaining('media', SECONDS, 0), null);
  assert.ok(!randomizer.tick(1000, settings, false).includes('media'));
  // Its wait starts when media becomes available.
  assert.ok(!randomizer.tick(2000, settings, false, true).includes('media'));
  assert.ok(randomizer.tick(3000, settings, false, true).includes('media'));
  assert.ok(!randomizer.tick(4000, settings, false, false).includes('media'));
  const off = randomizerSettings({ ...settings, tracks: { media: false } });
  randomizer.tick(5000, off, false, true);
  assert.ok(!randomizer.tick(6000, off, false, true).includes('media'));
});

test('a random media file is a different one where the folder has another', () => {
  const entries = ['a.gif', 'b.mp4', 'c.png'].map(path => ({ path }));
  const random = seeded(4);
  const seen = new Set();
  let current = null;
  for (let i = 0; i < 200; i++) {
    const next = randomMedia(entries, current, random);
    assert.notEqual(next, current);
    seen.add(current = next);
  }
  assert.equal(seen.size, 3);
  assert.equal(randomMedia([entries[0]], entries[0], random), entries[0]);
  assert.equal(randomMedia([], null, random), null);
});

test('waits count in seconds, beats or bars; saved waits in seconds carry over', () => {
  assert.deepEqual(WAIT_UNITS.map((unit) => unit.id), ['seconds', 'beats', 'bars']);
  const old = randomizerSettings({ enabled: true, minSeconds: 20, maxSeconds: 40 });
  assert.equal(old.unit, 'seconds');
  assert.equal(old.minWait, 20);
  assert.equal(old.maxWait, 40);
  assert.equal(old.minSeconds, undefined, 'saved under the new names only');
  assert.throws(() => randomizerSettings({ unit: 'minutes' }), /unit/);
  assert.equal(waitLabel(11.2, 'seconds'), '12 s');
  assert.equal(waitLabel(1, 'beats'), '1 beat');
  assert.equal(waitLabel(2.5, 'bars'), '3 bars');
});

test('a wait in beats or bars is a whole number of them, ending on a beat or a bar line', () => {
  for (const [unit, per] of [['beats', 1], ['bars', 4]]) {
    const settings = randomizerSettings({ enabled: true, unit, minWait: 2, maxWait: 4 });
    const randomizer = new Randomizer(seeded(8));
    const due = { patternA: [] };
    let last = null;
    randomizer.tick(0, settings, false, false, false, 0.3);
    for (let beat = 0.3; beat < 400; beat += 0.05) {
      if (randomizer.tick(0, settings, false, false, false, beat).includes('patternA')) {
        due.patternA.push(beat);
        if (last !== null) {
          const gap = Math.round((beat - last) / per);
          assert.ok(gap >= 2 && gap <= 4, `${unit}: ${gap} between changes`);
        }
        last = beat;
        // On the line: no more than one step of the clock after it.
        assert.ok(beat - Math.floor(beat / per) * per < 0.051, `${unit}: changed at ${beat}`);
      }
    }
    assert.ok(due.patternA.length > 20, `${unit}: ${due.patternA.length} changes`);
    // The time left is in the unit.
    const left = randomizer.remaining('patternA', settings, 0, last + 0.5 * per);
    assert.ok(left > 0 && left <= 4, `${unit}: ${left} left`);
  }
});

test('changing the unit, or the beat clock going back, starts the waits afresh', () => {
  const beats = randomizerSettings({ enabled: true, unit: 'beats', minWait: 8, maxWait: 8 });
  const randomizer = new Randomizer(seeded(9));
  randomizer.tick(0, beats, false, false, false, 100);
  assert.equal(randomizer.remaining('patternA', beats, 0, 100), 8);
  // The clock starts again from 0: the wait is taken from there.
  randomizer.tick(0, beats, false, false, false, 0);
  assert.equal(randomizer.remaining('patternA', beats, 0, 0), 8);
  const seconds = randomizerSettings({ ...beats, unit: 'seconds' });
  randomizer.tick(5000, seconds, false, false, false, 3);
  assert.equal(randomizer.remaining('patternA', seconds, 5000, 3), 8);
});
