import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TAP_UNITS, TEMPO_DEFAULTS, TapTempo, TempoTracker, changeAllowed, reversingPosition, tempoSettings,
} from '../public/tempo.js';

// Runs the tracker at 60 frames a second, feeding beats at the given times.
function run(tracker, beats, until, settings = TEMPO_DEFAULTS, from = 0) {
  const pending = [...beats];
  const frames = [];
  for (let frame = Math.round(from * 60); frame <= until * 60; ++frame) {
    const now = frame / 60;
    while (pending.length && pending[0] <= now) tracker.onBeat(pending.shift());
    frames.push(tracker.update(now, settings));
  }
  return frames;
}
const every = (seconds, count, start = 0, jitter = () => 0) =>
  Array.from({ length: count }, (_, i) => start + i * seconds + jitter(i));

test('tempo settings validate and default to detection with no waiting', () => {
  assert.deepEqual(tempoSettings(), TEMPO_DEFAULTS);
  assert.deepEqual(TEMPO_DEFAULTS, { mode: 'auto', source: 'bass', manualBpm: 120, quantize: 'off', tap: 'beat' });
  assert.equal(tempoSettings({ mode: 'manual', manualBpm: 90 }).source, 'bass',
    'settings saved before beat sources existed keep the original detector');
  assert.equal(tempoSettings({ source: 'flux' }).source, 'flux');
  assert.throws(() => tempoSettings({ source: 'drums' }), /beat source/);
  assert.equal(tempoSettings({ mode: 'manual', manualBpm: 90, quantize: 'bar' }).tap, 'beat',
    'settings saved before tap tempo existed take a tap as a beat');
  assert.equal(tempoSettings({ tap: 'bar' }).tap, 'bar');
  assert.throws(() => tempoSettings({ tap: 'phrase' }), /tap unit/);
  assert.equal(tempoSettings({ quantize: 'bar', manualBpm: 90 }).manualBpm, 90);
  assert.throws(() => tempoSettings({ mode: 'tap' }), /tempo mode/);
  assert.throws(() => tempoSettings({ quantize: 'phrase' }), /quantize/);
  assert.throws(() => tempoSettings({ manualBpm: 10 }), /between/);
  assert.throws(() => tempoSettings(null), /options object/);
});

test('steady beats are detected, with jitter and missed beats tolerated', () => {
  for (const bpm of [80, 100, 120, 128, 140, 174]) {
    const tracker = new TempoTracker();
    const jitter = (i) => ((i * 7919) % 11 - 5) / 1000;   // up to 5 ms either way
    // Stop while the beats are still coming; five seconds of silence drops the lock.
    const state = run(tracker, every(60 / bpm, 40, 0.5, jitter), 0.5 + 39 * 60 / bpm).at(-1);
    assert.equal(state.detected, true, `${bpm} BPM locks`);
    assert.ok(Math.abs(state.bpm - bpm) < bpm * 0.02, `${bpm} BPM detected as ${state.bpm.toFixed(1)}`);
  }
  // Every fifth beat missing.
  const gappy = new TempoTracker();
  const beats = every(0.5, 60, 0.5).filter((_, i) => i % 5 !== 4);
  const state = run(gappy, beats, 30).at(-1);
  assert.ok(Math.abs(state.bpm - 120) < 3, `gappy 120 BPM detected as ${state.bpm.toFixed(1)}`);
});

test('half-time and double-time onsets fold into a usable tempo', () => {
  const slow = new TempoTracker();
  assert.ok(Math.abs(run(slow, every(1, 20, 0.5), 20).at(-1).bpm - 120) < 3, 'one onset per two beats at 120');
  const fast = new TempoTracker();
  assert.ok(Math.abs(run(fast, every(0.25, 80, 0.5), 20).at(-1).bpm - 120) < 3, 'two onsets per beat at 120');
});

test('the beat position runs forwards smoothly and falls into step with the onsets', () => {
  const tracker = new TempoTracker();
  const beats = every(0.5, 80, 0.37);
  const frames = run(tracker, beats, 40);
  for (let i = 1; i < frames.length; ++i)
    assert.ok(frames[i].position >= frames[i - 1].position, 'never runs backwards');
  // Late on, each onset should land close to a whole beat.
  const late = new TempoTracker();
  const pending = [...beats];
  const errors = [];
  for (let frame = 0; frame <= 40 * 60; ++frame) {
    const now = frame / 60;
    while (pending.length && pending[0] <= now) {
      if (now > 25) errors.push(Math.abs(late.position - Math.round(late.position)));
      late.onBeat(pending.shift());
    }
    late.update(now);
  }
  assert.ok(Math.max(...errors) < 0.12, `worst phase error ${Math.max(...errors).toFixed(3)} beats`);
  // About two beats a second at 120 BPM.
  assert.ok(Math.abs(frames.at(-1).position - frames.at(-601).position - 20) < 0.5);
});

test('beat and bar flags fire once per beat and once per four beats', () => {
  const tracker = new TempoTracker();
  const frames = run(tracker, [], 10, { ...TEMPO_DEFAULTS, mode: 'manual', manualBpm: 120 });
  assert.equal(frames.filter(frame => frame.newBeat).length, 20);
  assert.equal(frames.filter(frame => frame.newBar).length, 5);
  assert.ok(frames.every(frame => !frame.newBar || frame.newBeat));
  assert.equal(frames.at(-1).detected, false);
  assert.deepEqual([changeAllowed('off', frames[1]), changeAllowed('beat', frames[1]), changeAllowed('bar', frames[1])],
    [true, false, false]);
  const bar = frames.find(frame => frame.newBar);
  assert.ok(changeAllowed('bar', bar) && changeAllowed('beat', bar));
});

test('manual tempo is used until locked, always in manual mode, and again after the beat is lost', () => {
  const tracker = new TempoTracker();
  const manual = { mode: 'auto', manualBpm: 90, quantize: 'off' };
  assert.equal(tracker.update(0, manual).bpm, 90);
  const frames = run(tracker, every(0.5, 30, 0.5), 15, manual);
  assert.ok(Math.abs(frames.at(-1).bpm - 120) < 3);
  assert.equal(tracker.update(15.1, { ...manual, mode: 'manual' }).bpm, 90, 'manual mode ignores detection');
  // Silence: detection is dropped after five seconds without an onset.
  const after = run(tracker, [], 25, manual, 15.2).at(-1);
  assert.equal(after.detected, false);
  assert.equal(after.bpm, 90);
  const position = after.position;
  assert.ok(tracker.update(26, manual).position > position, 'the position keeps running at the manual tempo');
});

test('irregular onsets do not produce a lock', () => {
  const tracker = new TempoTracker();
  const times = [0.3, 0.71, 1.52, 1.9, 2.95, 3.3, 4.6, 5.05, 5.9, 7.2, 7.6, 8.9];
  assert.equal(run(tracker, times, 10).at(-1).detected, false);
});

// Runs a tracker at a manual 120 BPM (2 s per bar) with features given by bar.
function runBars(levelForBar, bars) {
  const tracker = new TempoTracker();
  const settings = { ...TEMPO_DEFAULTS, mode: 'manual', manualBpm: 120 };
  const changesAt = [], beatsInto = [];
  let last;
  for (let frame = 0; frame <= bars * 120; ++frame) {
    const now = frame / 60;
    const bar = Math.floor(now / 2);
    last = tracker.update(now, settings, levelForBar(bar));
    if (last.newChange) {
      changesAt.push(last.bar);
      beatsInto.push(last.position - last.bar * 4);
    }
  }
  return { changesAt, beatsInto, last, tracker };
}
const level = (bass, mid = 0.3, treble = 0.2) => ({ bass, mid, treble });

test('a section change is detected on the bar where the energy shifts', () => {
  // 16 bars of full beat, an 8-bar breakdown with no bass, then the drop.
  const { changesAt, beatsInto } = runBars(bar => (bar < 16 ? level(0.8) : bar < 24 ? level(0.05) : level(0.9, 0.6, 0.5)), 40);
  assert.ok(beatsInto.every(beats => beats < 1.1), 'within about a beat of the shift');
  assert.deepEqual(changesAt, [16, 24], 'noticed within the bar where each shift happens');
  // Steady music with small wobbles is not a change.
  const steady = runBars(bar => level(0.7 + 0.03 * Math.sin(bar)), 30);
  assert.deepEqual(steady.changesAt, []);
});

test('changes are at least four bars apart, and one is declared after 32 bars without any', () => {
  // The energy flips every bar; only every fourth bar may count.
  const flipping = runBars(bar => level(bar % 2 ? 0.9 : 0.1), 20);
  for (let i = 1; i < flipping.changesAt.length; ++i)
    assert.ok(flipping.changesAt[i] - flipping.changesAt[i - 1] >= 4);
  assert.ok(flipping.changesAt.length >= 3);
  const flat = runBars(() => level(0.5), 70);
  assert.deepEqual(flat.changesAt, [32, 64]);
  assert.equal(flat.last.changes, 2);
  assert.ok(flat.last.barsSinceChange < 8);
});

test('the change clock turns round at each change and never jumps', () => {
  const tracker = new TempoTracker();
  const settings = { ...TEMPO_DEFAULTS, mode: 'manual', manualBpm: 120 };
  let previous = 0, turned = 0, direction = 1;
  for (let frame = 0; frame <= 40 * 120; ++frame) {
    const bar = Math.floor(frame / 120);
    const state = tracker.update(frame / 60, settings, bar < 16 ? level(0.8) : bar < 24 ? level(0.05) : level(0.9));
    const step = state.changeClock - previous;
    assert.ok(Math.abs(step) < 0.05, 'moves a frame at a time');
    if (step !== 0 && Math.sign(step) !== direction) { turned++; direction = Math.sign(step); }
    previous = state.changeClock;
  }
  assert.equal(turned, 2, 'reversed once per detected change');
});

test('a reversing position runs forwards then back, phrase by phrase', () => {
  assert.equal(reversingPosition(0, 16), 0);
  assert.equal(reversingPosition(10, 16), 10);
  assert.equal(reversingPosition(16, 16), 16);
  assert.equal(reversingPosition(20, 16), 12);
  assert.equal(reversingPosition(32, 16), 0);
  assert.equal(reversingPosition(40, 16), 8);
  for (let i = 1; i < 2000; ++i)
    assert.ok(Math.abs(reversingPosition(i / 20, 16) - reversingPosition((i - 1) / 20, 16)) < 0.051, 'no jumps');
});

test('changes can wait for 4 or 8 bars or for a change in the music', () => {
  const bar = (number, newChange = false) => ({ newBeat: true, newBar: true, bar: number, newChange });
  assert.equal(changeAllowed('phrase4', bar(8)), true);
  assert.equal(changeAllowed('phrase4', bar(9)), false);
  assert.equal(changeAllowed('phrase8', bar(8)), true);
  assert.equal(changeAllowed('phrase8', bar(12)), false);
  assert.equal(changeAllowed('phrase4', { ...bar(8), newBar: false }), false, 'only as the bar begins');
  assert.equal(changeAllowed('change', bar(5, true)), true);
  assert.equal(changeAllowed('change', bar(8)), false);
  assert.equal(tempoSettings({ quantize: 'change' }).quantize, 'change');
});

test('taps give the tempo they beat out, as beats or as bars', () => {
  const taps = new TapTempo();
  assert.equal(taps.tap(10), null, 'one tap is not a tempo');
  assert.equal(taps.tap(10.5), 120);
  // Unsteady taps are averaged over the run.
  assert.equal(taps.tap(10.98), 122);
  assert.equal(taps.tap(11.52), 118);
  assert.equal(taps.tap(12.0), 120);
  // A long gap starts a new run.
  assert.equal(taps.tap(15), null);
  assert.equal(taps.tap(15.4), 150);

  // The same hand speed, tapping once a bar, is four times the tempo.
  const bars = new TapTempo();
  assert.equal(bars.tap(0, 4), null);
  assert.equal(bars.tap(2, 4), 120);
  assert.equal(bars.tap(4, 4), 120);
  // A bar at a slow tempo is a long wait, and still the same run.
  assert.equal(bars.tap(9, 4), 80);
  // Changing what a tap stands for starts again.
  assert.equal(bars.tap(9.5, 1), null);
  assert.equal(bars.tap(10, 1), 120);
  assert.deepEqual(TAP_UNITS.map(unit => [unit.id, unit.beats]), [['beat', 1], ['bar', 4]]);
});

test('tapped tempi stay in range and follow a change of pace', () => {
  const fast = new TapTempo();
  fast.tap(0);
  assert.equal(fast.tap(0.1), 240);
  const slow = new TapTempo();
  slow.tap(0);
  assert.equal(slow.tap(1.9), 40);
  const changing = new TapTempo();
  for (let i = 0; i < 8; ++i) changing.tap(i * 0.5);
  let bpm;
  for (let i = 1; i <= 8; ++i) bpm = changing.tap(3.5 + i * 0.4);
  assert.equal(bpm, 150, 'only the last eight taps count');
  const stuck = new TapTempo();
  stuck.tap(5);
  assert.equal(stuck.tap(5), null, 'two taps at once are not a tempo');
});

// Runs the tracker on the manual tempo with taps at the given times, and
// returns the beat position as it stood at each tap.
function tapAlong(tapTimes, beatsPerTap, until) {
  const tracker = new TempoTracker();
  const settings = { ...TEMPO_DEFAULTS, mode: 'manual', manualBpm: 120 };
  const pending = [...tapTimes], atTaps = [];
  let previous = 0;
  for (let frame = 0; frame <= until * 60; ++frame) {
    const now = frame / 60;
    const state = tracker.update(now, settings);
    assert.ok(state.position >= previous, 'the position never runs backwards');
    previous = state.position;
    while (pending.length && pending[0] <= now) {
      atTaps.push(state.position);
      tracker.tap(pending.shift(), beatsPerTap);
    }
  }
  return atTaps;
}
const offBeat = (position, unit) => Math.abs(position / unit - Math.round(position / unit)) * unit;

test('taps pull the beat into step while the manual tempo is in charge', () => {
  // Taps every half second (120 BPM), 0.15 s after the clock's own beats.
  const beats = tapAlong(every(0.5, 12, 0.15), 1, 7);
  assert.ok(offBeat(beats[0], 1) > 0.25, 'the first tap finds the clock out of step');
  for (const position of beats.slice(3)) assert.ok(offBeat(position, 1) < 0.05, `beat at ${position}`);

  // Taps every bar, 0.7 s (1.4 beats) after the clock's own bar lines.
  const bars = tapAlong(every(2, 8, 0.7), 4, 17);
  assert.ok(offBeat(bars[0], 4) > 1, 'the first tap finds the bar line elsewhere');
  for (const position of bars.slice(3)) assert.ok(offBeat(position, 4) < 0.1, `bar at ${position}`);
});

test('taps do not fight a tempo detected from the audio', () => {
  const tracker = new TempoTracker();
  const frames = [];
  const beats = every(0.5, 40, 0.1);
  for (let frame = 0; frame <= 20 * 60; ++frame) {
    const now = frame / 60;
    while (beats.length && beats[0] <= now) tracker.onBeat(beats.shift());
    if (frame % 37 === 0) tracker.tap(now);
    frames.push(tracker.update(now, TEMPO_DEFAULTS));
  }
  const last = frames[frames.length - 1];
  assert.ok(last.detected);
  assert.equal(tracker.tapPending, 0);
});
