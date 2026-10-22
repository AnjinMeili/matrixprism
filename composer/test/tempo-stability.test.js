import assert from 'node:assert/strict';
import test from 'node:test';
import { tempoSteadiness } from '../tools/audio-scores.js';

test('a steady series on the reference is right all the time it is locked, with no jumps', () => {
  const s = tempoSteadiness([[0, null], [10, 128], [20, 128.4], [30, 127.8]], 100, 128);
  assert.equal(s.locked, 0.9);
  assert.equal(s.right, 0.9);
  assert.equal(s.octave, 0);
  assert.deepEqual(s.jumps, []);
  // The first ten seconds, before it locked, are the longest stretch off.
  assert.deepEqual(s.longestOff, { seconds: 10, from: 0 });
});

test('jumps to 4/3 and to double are counted, timed and told apart', () => {
  const s = tempoSteadiness([[0, 128], [40, 170.7], [60, 128], [80, 256]], 100, 128);
  assert.equal(s.right, 0.6);
  assert.equal(s.octave, 0.2);
  assert.ok(Math.abs(s.other - 0.2) < 1e-9);
  assert.deepEqual(s.jumps.map(([t]) => t), [40, 60, 80]);
  assert.deepEqual(s.longestOff, { seconds: 20, from: 40 });
});

test('small drifts are not jumps; without a reference the series is measured against its own typical tempo', () => {
  const s = tempoSteadiness([[0, 125], [30, 126], [60, 127], [90, 140]], 100);
  assert.equal(s.reference, 126);
  assert.equal(s.jumps.length, 1, 'only 127 to 140 is more than 8%');
  assert.equal(s.right, 0.9);
  assert.deepEqual(s.longestOff, { seconds: 10, from: 90 });
});

test('a series that never locks is all off, and a lost lock between counts against it', () => {
  assert.deepEqual(tempoSteadiness([[0, null]], 60, 120), {
    reference: 120, typical: null, locked: 0, right: 0, octave: 0, other: 0, jumps: [],
    longestOff: { seconds: 60, from: 0 },
  });
  const s = tempoSteadiness([[0, 120], [20, null], [40, 120]], 60, 120);
  assert.ok(Math.abs(s.locked - 2 / 3) < 1e-9);
  assert.deepEqual(s.jumps, [], 'losing the lock and finding the same tempo again is not a jump');
});
