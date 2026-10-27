// The cue-list clock (T76): cues in bars from Go, Next and Back on the bar
// line, Hold, and seeking without the cues passed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BEATS_PER_BAR, CueClock, cueBeat } from '../public/cue-clock.js';

// Cues at bars 1, 3 and 5 of the track (beats 0, 8, 16), and one placed by a
// marker the clock does not know yet.
const PLACES = [0, 8, 16, null];
// Steps the clock from `from` to `to` in quarter beats, collecting what
// changes and on which beat.
function run(clock, from, to) {
  const shown = [];
  for (let beat = from; beat <= to + 1e-9; beat += 0.25) {
    const index = clock.tick(beat);
    if (index !== null) shown.push([index, beat]);
  }
  return shown;
}

test('a cue is placed in bars and beats from the start; other markers wait', () => {
  assert.equal(BEATS_PER_BAR, 4);
  assert.equal(cueBeat({ marker: 'start', bars: 3, beats: 2 }), 14);
  assert.equal(cueBeat({ marker: 'mixOut', bars: -8, beats: 0 }), null);
  assert.equal(cueBeat(undefined), null);
});

test('Go makes the beat the track\'s start, and each cue shows when the track reaches it', () => {
  const clock = new CueClock(PLACES);
  assert.equal(clock.playing, false);
  assert.equal(clock.tick(100), null, 'nothing before Go');
  clock.go(100.1);
  assert.equal(clock.origin, 100, 'to the nearest beat');
  assert.deepEqual(run(clock, 100, 125), [[0, 100], [1, 108], [2, 116]]);
  const status = clock.status(117.5);
  assert.deepEqual(status, { bar: 5, beat: 2, current: 2, next: null, beatsToNext: null, held: false, waiting: false });
  assert.deepEqual(clock.status(105).next, 1);
  clock.stop();
  assert.equal(clock.playing, false);
  // Before the beat clock has a position, Go starts nothing.
  clock.go(undefined);
  assert.equal(clock.playing, false);
  clock.go(NaN);
  assert.equal(clock.status(1), null);
});

test('Next and Back land on the track\'s next bar line, and the cues after follow from there', () => {
  const clock = new CueClock(PLACES);
  clock.go(0);
  assert.deepEqual(run(clock, 0, 1), [[0, 0]]);
  // Next at beat 1.5: the cue at track beat 8 shows on the bar line at beat 4.
  clock.next(1.5);
  assert.equal(clock.status(2).waiting, true);
  assert.deepEqual(run(clock, 1.75, 4), [[1, 4]]);
  // The clock moved on 4 beats: the cue at 16 now comes at beat 12.
  assert.deepEqual(run(clock, 4.25, 13), [[2, 12]]);
  // Back at 13: the previous cue, at the bar line at 16.
  clock.back(13);
  assert.deepEqual(run(clock, 13.25, 16), [[1, 16]]);
  // Next past the last cue does nothing; Back before the first stays on it.
  clock.next(16.5);
  clock.next(16.75);
  const late = new CueClock(PLACES);
  late.go(0);
  late.tick(0);
  late.back(1);
  assert.deepEqual(run(late, 1.25, 4), [], 'already on the first cue');
});

test('Hold stops the track, as when the DJ loops; Release goes on from there', () => {
  const clock = new CueClock(PLACES);
  clock.go(0);
  assert.deepEqual(run(clock, 0, 6), [[0, 0]]);
  clock.hold(6);
  assert.deepEqual(run(clock, 6.25, 30), [], 'held at beat 6: no cue while the loop runs');
  assert.equal(clock.status(30).held, true);
  assert.equal(clock.status(30).bar, 2);
  clock.release(30);
  // Two beats from 6 to the cue at 8.
  assert.deepEqual(run(clock, 30.25, 33), [[1, 32]]);
  // Next during a hold ends it and lands on the bar line.
  clock.hold(33);
  clock.next(40);
  assert.equal(clock.status(40).held, false);
});

test('Seek shows only the cue in force where it lands, not those passed', () => {
  const clock = new CueClock([0, 4, 8, 12, 16]);
  clock.go(0);
  run(clock, 0, 1);
  clock.seek(1, 14);
  assert.deepEqual(run(clock, 1.25, 4), [[3, 4]], 'lands at track beat 14: only the cue at 12');
  assert.deepEqual(run(clock, 4.25, 6), [[4, 6]], 'then the cue at 16, two beats on');
  // Equal places keep their order: the later one is in force.
  const same = new CueClock([0, 0]);
  same.go(0);
  assert.deepEqual(run(same, 0, 1), [[1, 0]]);
});
