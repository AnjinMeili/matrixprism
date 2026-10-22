import assert from 'node:assert/strict';
import test from 'node:test';
import { EVERY_SECONDS, EssentiaTempo, WINDOW_SECONDS, beatPhase, resample } from '../public/essentia-tempo.js';
import { ESTIMATES_TO_CHANGE, TEMPO_DEFAULTS, TempoTracker } from '../public/tempo.js';
import { AudioAnalyzer } from '../public/audio.js';

// The Essentia beat source (T28), with a stand-in for Essentia so these run
// without its WebAssembly.

function fakeEssentia(ticks, bpm = 120) {
  const calls = [];
  return {
    calls,
    arrayToVector: (array) => ({ array, deleted: false, delete() { this.deleted = true; } }),
    vectorToArray: (vector) => Float32Array.from(vector.values),
    RhythmExtractor2013(signal) {
      calls.push(signal);
      return { bpm, confidence: 3, ticks: { values: ticks, delete() {} } };
    },
  };
}

test('resampling keeps a ramp a ramp, at the new length', () => {
  const ramp = Float32Array.from({ length: 480 }, (_, i) => i / 480);
  const out = resample(ramp, 48000, 44100);
  assert.equal(out.length, 441);
  assert.ok(Math.abs(out[220] - 220 * (48000 / 44100) / 480) < 1e-6);
  assert.equal(resample(ramp, 44100, 44100), ramp);
});

test('the beat phase is the circular mean of every beat found', () => {
  // Beats every half second, the last 0.1 s before the end.
  const ticks = Array.from({ length: 19 }, (_, k) => 0.4 + k * 0.5);
  assert.ok(Math.abs(beatPhase(ticks, 10, 0.5) - 0.1) < 1e-9);
  // Beats a little either side of the same place in the cycle average to it,
  // even across the wrap from one beat to the next.
  const jittered = [9.98, 9.52, 8.98, 8.52];
  assert.ok(Math.abs(beatPhase(jittered, 10, 0.5) - 0) < 0.03 ||
    Math.abs(beatPhase(jittered, 10, 0.5) - 0.5) < 0.03);
  assert.equal(beatPhase([], 10, 0.5), null);
});

test('an estimate is due once ten seconds have arrived, then every two', () => {
  const essentia = fakeEssentia([9.9]);
  const tempo = new EssentiaTempo(essentia, 1000);
  const second = new Float32Array(1000).fill(0.5);
  for (let s = 1; s < WINDOW_SECONDS; ++s) {
    tempo.push(second);
    assert.equal(tempo.due, false, `not due after ${s} s`);
  }
  tempo.push(second);
  assert.equal(tempo.due, true);
  const result = tempo.estimate();
  assert.equal(result.bpm, 120);
  assert.ok(Math.abs(result.lastBeat - 0.1) < 1e-6);
  // Resampled to 44.1 kHz, and the vector handed back.
  assert.equal(essentia.calls[0].array.length, 44100 * WINDOW_SECONDS);
  assert.equal(essentia.calls[0].deleted, true);
  tempo.push(second);
  assert.equal(tempo.due, false);
  tempo.push(new Float32Array(1000 * (EVERY_SECONDS - 1)));
  assert.equal(tempo.due, true);
  // The window keeps only the last ten seconds, newest last.
  tempo.push(Float32Array.of(7));
  assert.equal(tempo.buffer[tempo.buffer.length - 1], 7);
});

test('estimates lock the tempo, keep it locked, and pull the beat into step', () => {
  const tracker = new TempoTracker();
  for (let n = 0; n <= 30; ++n) tracker.update(n / 30, TEMPO_DEFAULTS);
  assert.equal(tracker.locked, false);
  tracker.setEstimate(1, 128, 0.25, 0.6);
  assert.equal(tracker.detectedBpm, 128);
  assert.equal(tracker.confidence, 0.6);
  assert.notEqual(tracker.pending, 0, 'the beat 0.25 s ago is not where the clock has it');
  // With estimates every two seconds the lock holds; without, it lapses.
  let state;
  for (let n = 31; n <= 300; ++n) {
    if (n % 60 === 0) tracker.setEstimate(n / 30, 128, null, 0.6);
    state = tracker.update(n / 30, TEMPO_DEFAULTS);
  }
  assert.equal(state.detected, true);
  assert.equal(state.bpm, 128);
  for (let n = 301; n <= 500; ++n) state = tracker.update(n / 30, TEMPO_DEFAULTS);
  assert.equal(state.detected, false, 'no estimate for over five seconds');
  // Estimates are folded into 70 to 180 BPM, as onset intervals are; nonsense
  // is ignored.
  tracker.setEstimate(17, 400, null, 1);
  assert.equal(tracker.detectedBpm, 100);
  tracker.setEstimate(18, NaN, null, 1);
  assert.equal(tracker.detectedBpm, 100);
});

test('alignTo pulls the beat into step without touching the tempo', () => {
  const tracker = new TempoTracker();
  tracker.setEstimate(0, 120, null, 1);
  for (let n = 0; n <= 10; ++n) tracker.update(n / 30, TEMPO_DEFAULTS);
  const intervals = tracker.intervals.length;
  tracker.alignTo();
  assert.ok(Math.abs(tracker.pending) > 0);
  assert.equal(tracker.detectedBpm, 120);
  assert.equal(tracker.intervals.length, intervals);
});

test('while estimates are in charge, onsets give the pulse but not the tempo', () => {
  const audio = new AudioAnalyzer();
  audio.beatSource = 'essentia';
  audio.estimatesInCharge = true;
  audio.tempo.setEstimate(0, 128, null, 1);
  const bins = 1024;
  for (let n = 1; n < 300; ++n) {
    const t = n / 30, kick = n % 15 === 0;
    const fluxData = new Float32Array(bins).fill(kick ? -20 : -100);
    audio.analyse({ sampleRate: 48000, frequencyData: new Uint8Array(bins).fill(200),
      timeData: new Uint8Array(2048).fill(128), channels: null, readKeyData: null, fluxData }, 1 / 30, 1, t);
    if (n % 60 === 0) audio.tempo.setEstimate(t, 128, null, 1);
    audio.tempo.update(t, TEMPO_DEFAULTS);
  }
  assert.equal(audio.tempo.intervals.length, 0, 'onsets did not count towards the tempo');
  assert.equal(audio.tempo.detectedBpm, 128);
  assert.ok(audio.features.beat > 0, 'the pulse still follows onsets');
  // Flux's own tracker follows them, for the veto: a kick every 0.5 s.
  assert.ok(Math.abs(audio.fluxTempo.detectedBpm - 120) < 2, String(audio.fluxTempo.detectedBpm));
  // The veto is on by default; off, there is no support.
  assert.equal(audio.estimateSupport(), audio.fluxTempo.detectedBpm);
  audio.fluxVeto = false;
  assert.equal(audio.estimateSupport(), null);
});

test('once locked, estimates hold the tempo: octaves and strays do not move it, a real change takes three in a row', () => {
  const tracker = new TempoTracker();
  tracker.setEstimate(0, 128, null, 1);
  assert.equal(tracker.detectedBpm, 128, 'the first estimate locks at once');
  // Double and half count as agreeing, and keep the octave.
  tracker.setEstimate(2, 256, null, 1);
  tracker.setEstimate(4, 64, null, 1);
  assert.equal(tracker.detectedBpm, 128);
  // A small drift is eased in.
  tracker.setEstimate(6, 130, null, 1);
  assert.ok(tracker.detectedBpm > 128 && tracker.detectedBpm < 130, String(tracker.detectedBpm));
  const settled = tracker.detectedBpm;
  // One stray estimate, then back: no change.
  tracker.setEstimate(8, 171, null, 1);
  tracker.setEstimate(10, 128, null, 1);
  assert.ok(Math.abs(tracker.detectedBpm - settled) < 1, String(tracker.detectedBpm));
  // A real change: two are not enough, the third is.
  tracker.setEstimate(12, 140, null, 1);
  tracker.setEstimate(14, 140.5, null, 1);
  assert.ok(Math.abs(tracker.detectedBpm - 140) > 5, 'still the old tempo after two');
  tracker.setEstimate(16, 139.5, null, 1);
  assert.equal(tracker.detectedBpm, 139.5);
  // Estimates that disagree with each other never build up to a change.
  for (const [seconds, bpm] of [[18, 100], [20, 170], [22, 100], [24, 170]])
    tracker.setEstimate(seconds, bpm, null, 1);
  assert.equal(tracker.detectedBpm, 139.5);
});

test('how many estimates must agree can be set, for measuring', () => {
  const tracker = new TempoTracker();
  assert.equal(tracker.estimatesToChange, ESTIMATES_TO_CHANGE);
  tracker.estimatesToChange = 2;
  tracker.setEstimate(0, 128, null, 1);
  tracker.setEstimate(2, 140, null, 1);
  assert.equal(tracker.detectedBpm, 128);
  tracker.setEstimate(4, 140, null, 1);
  assert.equal(tracker.detectedBpm, 140);
});

test('estimates are folded into 70 to 180, so a first lock at half tempo is not held there', () => {
  const tracker = new TempoTracker();
  tracker.setEstimate(0, 64.5, null, 1);
  assert.equal(tracker.detectedBpm, 129, 'half tempo, doubled');
  tracker.setEstimate(2, 129, null, 1);
  assert.equal(tracker.detectedBpm, 129);
  // A breakdown read at half tempo agrees with the true tempo; it never
  // becomes a lock at half of it.
  for (let n = 2; n < 10; ++n) tracker.setEstimate(n * 2, 64.4, null, 1);
  assert.ok(Math.abs(tracker.detectedBpm - 129) < 0.5, String(tracker.detectedBpm));
});

test('with 3:2 agreeing, triplet readings ease the tempo instead of starting a change', () => {
  const tracker = new TempoTracker();
  tracker.setEstimate(0, 140, null, 1);
  for (let n = 1; n <= 5; ++n) tracker.setEstimate(n * 2, 93.3, null, 1);
  assert.ok(Math.abs(tracker.detectedBpm - 93.3) < 1e-9, 'off: five readings at 2/3 take over');
  const held = new TempoTracker();
  held.threeTwoAgrees = true;
  held.setEstimate(0, 140, null, 1);
  for (let n = 1; n <= 5; ++n) held.setEstimate(n * 2, 93.3, null, 1);
  assert.ok(Math.abs(held.detectedBpm - 140) < 0.5, String(held.detectedBpm));
  held.setEstimate(12, 210, null, 1);
  assert.ok(Math.abs(held.detectedBpm - 140) < 0.5, '3/2 of it agrees too');
});

test('a supporting tempo stops a change it does not share, and lets one through that it does', () => {
  const tracker = new TempoTracker();
  tracker.setEstimate(0, 140, null, 1);
  for (let n = 1; n <= 5; ++n) tracker.setEstimate(n * 2, 115, null, 1, 140);
  assert.equal(tracker.detectedBpm, 140, 'flux still at 140: no change');
  tracker.setEstimate(12, 115, null, 1, 115);
  assert.equal(tracker.detectedBpm, 115, 'flux at 115 too: the change goes ahead');
  // Support that agrees with neither does not stop it; nor does none.
  tracker.setEstimate(14, 150, null, 1, 100);
  tracker.setEstimate(16, 150, null, 1, 100);
  tracker.setEstimate(18, 150, null, 1, 100);
  assert.equal(tracker.detectedBpm, 150);
  for (const [t, bpm] of [[20, 128], [22, 128], [24, 128]]) tracker.setEstimate(t, bpm, null, 1, null);
  assert.equal(tracker.detectedBpm, 128);
});

test('the operator\'s tempo, sent to the tracker, is held against estimates at the old one while flux agrees', () => {
  const tracker = new TempoTracker();
  tracker.setEstimate(0, 140, null, 1);
  tracker.hint(2, 125, 3);
  assert.equal(tracker.detectedBpm, 125);
  // Flux, also told, backs the operator: the old tempo cannot come back.
  for (let n = 2; n <= 8; ++n) tracker.setEstimate(n * 2, 140, null, 1, 125);
  assert.equal(tracker.detectedBpm, 125);
  // Without that support, three in a row take it back, as for any change.
  tracker.setEstimate(18, 140, null, 1, null);
  assert.equal(tracker.detectedBpm, 140);
  // Estimates that agree with the operator only ease it.
  tracker.hint(20, 125, 21);
  tracker.setEstimate(22, 126, null, 1);
  assert.ok(Math.abs(tracker.detectedBpm - 125.3) < 0.01, String(tracker.detectedBpm));
});

test('with onsets, the operator\'s tempo holds until most recent onsets disagree, then the music wins', () => {
  const tracker = new TempoTracker();
  const onsets = (from, count, bpm) => { for (let k = 0; k < count; ++k) tracker.onBeat(from + k * 60 / bpm); return from + count * 60 / bpm; };
  let t = onsets(0, 12, 128);
  assert.ok(Math.abs(tracker.detectedBpm - 128) < 0.5);
  // A clearly different tempo (onsets within 5% count as the same tempo and
  // ease it, as they always have).
  tracker.hint(t, 150, t + 1);
  assert.equal(tracker.detectedBpm, 150);
  t = onsets(t + 60 / 128, 6, 128);
  assert.equal(tracker.detectedBpm, 150, 'a few onsets at the old tempo do not move it');
  onsets(t, 20, 128);
  assert.ok(Math.abs(tracker.detectedBpm - 128) < 0.5, `the music wins in the end: ${tracker.detectedBpm}`);
});

test('the operator\'s bar line: the clock\'s bars start there within a couple of seconds', () => {
  const tracker = new TempoTracker(), settings = { ...TEMPO_DEFAULTS };
  tracker.setEstimate(0, 120, null, 1);
  for (let n = 0; n <= 300; ++n) tracker.update(n / 60, settings);
  // A bar starting at 5.3 s, at 120: bars at 5.3 + 2k s.
  tracker.hint(5, 120, 5.3);
  for (let n = 301; n <= 600; ++n) {
    if (n % 120 === 0) tracker.setEstimate(n / 60, 120, null, 1);
    tracker.update(n / 60, settings);
  }
  // At 9.3 s, two bars on, the position is on a bar line.
  const atBar = tracker.position - (10 - 9.3) * 2;
  const off = ((atBar % 4) + 4) % 4;
  assert.ok(Math.min(off, 4 - off) < 0.05, `beats from a bar line at 9.3 s: ${Math.min(off, 4 - off)}`);
});

test('a marked downbeat moves the bar line by whole beats while detected, keeping the beats\' timing', () => {
  const settings = { ...TEMPO_DEFAULTS };
  const marked = new TempoTracker(), plain = new TempoTracker();
  for (const tracker of [marked, plain]) tracker.setEstimate(0, 120, null, 1);
  for (let n = 0; n <= 600; ++n) {
    const t = n / 60;
    // Onsets on the beat, which pull the phase (and would overwrite a phase
    // correction kept with it).
    if (n % 30 === 0) for (const tracker of [marked, plain]) tracker.onBeat(t);
    if (n === 100) {
      // At 1.67 s the clock is at beat 3.33: the fourth beat, which becomes
      // the first by moving one beat on.
      marked.markDownbeat(t);
    }
    for (const tracker of [marked, plain]) tracker.update(t, settings);
  }
  const diff = marked.position - plain.position;
  assert.ok(Math.abs(diff - 1) < 0.01, `moved ${diff} beats, expected one on`);
  assert.equal(marked.barPending, 0, 'taken in');
});

test('marked on the clock\'s third beat, that beat becomes the first; on the manual tempo the press sets the bar line', () => {
  const settings = { ...TEMPO_DEFAULTS };
  const tracker = new TempoTracker();
  tracker.setEstimate(0, 120, null, 1);
  for (let n = 0; n <= 60; ++n) tracker.update(n / 60, settings);
  // At 1 s, at 120, the clock is at beat 2 (the third beat of the bar).
  tracker.markDownbeat(1);
  assert.equal(tracker.barPending, -2);
  for (let n = 61; n <= 300; ++n) tracker.update(n / 60, settings);
  // Two seconds after the mark, four beats on: a bar line.
  const atMarkPlus2 = tracker.position - (5 - 3) * 2;
  assert.ok(Math.abs(atMarkPlus2 - Math.round(atMarkPlus2 / 4) * 4) < 0.05, `position at 3 s: ${atMarkPlus2}`);
  // On the manual tempo at 120, a press at 1.1 s (beat 2.2) sets a bar line
  // there: the clock is pulled 1.8 beats on, to beat 4.
  const manual = new TempoTracker(), manualSettings = { ...TEMPO_DEFAULTS, mode: 'manual', manualBpm: 120 };
  for (let n = 0; n <= 60; ++n) manual.update(n / 60, manualSettings);
  manual.markDownbeat(1.1);
  assert.ok(Math.abs(manual.tapPending - 1.8) < 0.05, String(manual.tapPending));
});
