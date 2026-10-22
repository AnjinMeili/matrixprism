import assert from 'node:assert/strict';
import test from 'node:test';
import { magnitudes, centroid, flatness, rolloff, flux, zeroCrossingRate, FluxOnsets }
  from '../public/spectral-features.js';
import { KeyDetector, spectrumChroma } from '../public/key-detector.js';
import { SAMPLE_RATE, bandNoise, catalogue, chords, clickTrack, levelSteps, random, sweep, sweepHz, whiteNoise }
  from '../tools/audio-signals.js';
import { beatScore, bpmSummary, bpmVerdict, changesPerMinute, correlation, keySummary, keyVerdict, lockTime,
  windowKeySummary, windowTempoSummary } from '../tools/audio-scores.js';
import { parseKey } from '../tools/beatport.mjs';

// The audio comparison's pieces that run outside the browser (T26).

const rms = (samples) => Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);

test('spectral features read a single tone, flat noise and silence as expected', () => {
  const tone = new Float32Array(1024);
  tone[100] = 1;
  const binHz = SAMPLE_RATE / 2 / 1024;
  assert.equal(centroid(tone, SAMPLE_RATE), 100 * binHz);
  assert.equal(rolloff(tone, SAMPLE_RATE), 101 * binHz);
  assert.ok(flatness(tone) < 1e-3);
  const flat = new Float32Array(1024).fill(0.5);
  assert.ok(Math.abs(flatness(flat) - 1) < 1e-6);
  assert.ok(Math.abs(rolloff(flat, SAMPLE_RATE) - 0.85 * SAMPLE_RATE / 2) <= binHz);
  const silent = new Float32Array(1024);
  assert.equal(centroid(silent, SAMPLE_RATE), 0);
  assert.equal(flatness(silent), 0);
  assert.equal(rolloff(silent, SAMPLE_RATE), 0);
  // Flux counts rises only.
  assert.equal(flux(flat, silent), 0.5);
  assert.equal(flux(silent, flat), 0);
  assert.deepEqual([...magnitudes(new Float32Array([0, -20, -Infinity]))], [1, 0.10000000149011612, 0]);
});

test('zero-crossing rate of a sine is twice its frequency over the sample rate', () => {
  const samples = new Float32Array(48000).map((_, i) => Math.sin(2 * Math.PI * 1000 * (i + 0.5) / 48000));
  assert.ok(Math.abs(zeroCrossingRate(samples) - 2000 / 48000) < 1e-4);
  assert.equal(zeroCrossingRate(new Float32Array([1, -1, 1, -1, 1])), 1);
});

test('test signals carry the answers they are scored against', () => {
  const { samples, truth } = clickTrack({ bpm: 120, seconds: 10 });
  assert.equal(samples.length, 10 * SAMPLE_RATE);
  assert.equal(truth.beats.length, 20);
  assert.ok(truth.beats.every((b, i) => Math.abs(b - (0.1 + i / 2)) < 1e-9));
  const change = clickTrack({ bpm: 100, bpmAfter: 140, seconds: 20 }).truth;
  assert.deepEqual(change.tempo, [{ from: 0, bpm: 100 }, { from: 10, bpm: 140 }]);
  assert.ok(Math.abs(change.beats.at(-1) - change.beats.at(-2) - 60 / 140) < 1e-9);
  assert.deepEqual(chords({ tonic: 9, mode: 'minor', seconds: 2 }).truth.key, { tonic: 9, mode: 'minor' });
  assert.equal(sweepHz({ from: 30, to: 16000, seconds: 20 }, 10), 30 * Math.sqrt(16000 / 30));
  assert.ok(Math.abs(rms(sweep({ seconds: 2 }).samples) - 0.5 / Math.SQRT2) < 0.01);
  assert.ok(Math.abs(rms(bandNoise({ low: 300, high: 1800, seconds: 1 }).samples) - 0.2) < 1e-4);
  assert.ok(Math.abs(rms(whiteNoise({ seconds: 2 }).samples) - 0.2) < 0.005);
  assert.ok(whiteNoise({ seconds: 1, rms: 0 }).samples.every((v) => v === 0));
  const steps = levelSteps({ dbfs: [-6, -20], stepSeconds: 1 }).samples;
  assert.ok(Math.abs(rms(steps.subarray(0, SAMPLE_RATE)) - 10 ** (-6 / 20) / Math.SQRT2) < 1e-3);
  // Seeded: the same signal every time.
  assert.deepEqual([random(5)(), random(5)()], [random(5)(), random(5)()]);
  const ids = catalogue().map((signal) => signal.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter((id) => id.startsWith('chords-')).length, 24);
});

test('beat scores match each detection to one true beat within the window', () => {
  const truth = [1, 2, 3, 4];
  assert.deepEqual(beatScore([1.02, 2.02, 3.02, 4.02], truth).f, 1);
  assert.ok(Math.abs(beatScore([1.02, 2.02, 3.02, 4.02], truth).offset - 0.02) < 1e-9);
  const late = beatScore([1.1, 2.1], truth);
  assert.equal(late.f, 0);
  assert.equal(late.offset, null);
  const partial = beatScore([1, 1.01, 3, 5], truth);
  assert.equal(partial.matched, 2);
  assert.equal(partial.precision, 0.5);
  assert.equal(partial.recall, 0.5);
  assert.equal(beatScore([], truth).f, 0);
});

test('BPM verdicts name octave and 3:2 errors, and lock time needs the BPM to stay right', () => {
  assert.equal(bpmVerdict(121, 120), 'right');
  assert.equal(bpmVerdict(128.6, 125), 'wrong');
  assert.equal(bpmVerdict(240, 120), 'double');
  assert.equal(bpmVerdict(60, 120), 'half');
  assert.equal(bpmVerdict(180, 120), 'three-two');
  assert.equal(bpmVerdict(80, 120), 'three-two');
  assert.equal(bpmVerdict(null, 120), 'none');
  const times = [0, 1, 2, 3, 4, 5];
  assert.equal(lockTime(times, [null, 120, 90, 120, 120, 120], 120), 3);
  assert.equal(lockTime(times, [120, 120, 120, 120, 120, 90], 120), null);
  assert.equal(lockTime(times, [120, 120, 120, 140, 140, 140], 140, 3), 3);
  assert.equal(lockTime(times, [120, 120, 120, 140, 140, 140], 120, 0, 3), 0);
});

test('key verdicts follow the Camelot wheel', () => {
  const a = { tonic: 9, mode: 'minor' };
  assert.equal(keyVerdict({ tonic: 9, mode: 'minor' }, a), 'exact');
  assert.equal(keyVerdict({ tonic: 4, mode: 'minor' }, a), 'fifth');
  assert.equal(keyVerdict({ tonic: 2, mode: 'minor' }, a), 'fifth');
  assert.equal(keyVerdict({ tonic: 0, mode: 'major' }, a), 'relative');
  assert.equal(keyVerdict({ tonic: 9, mode: 'major' }, a), 'parallel');
  assert.equal(keyVerdict({ tonic: 1, mode: 'minor' }, a), 'other');
  assert.equal(keyVerdict(null, a), 'none');
});

test('changes per minute count from the first value, and correlation handles constants', () => {
  assert.equal(changesPerMinute([0, 30, 60, 90], [null, 'a', 'a', 'b']), 1);
  assert.equal(changesPerMinute([0, 60], [null, null]), null);
  assert.equal(correlation([1, 2, 3], [2, 4, 6]), 1);
  assert.equal(correlation([1, 2, 3], [5, 5, 5]), null);
});

test('flux onsets follow the composer beat rule: a jump over the average, one per 0.22 s, above a floor', () => {
  const detector = new FluxOnsets();
  const onsets = [];
  // A spike every half second, and a smaller second spike 0.1 s after each.
  for (let n = 0; n < 300; ++n) {
    const t = n / 60;
    const phase = Math.round((t % 0.5) * 60);
    const value = phase === 0 ? 1e-3 : phase === 6 ? 8e-4 : 1e-5 * (1 + Math.sin(n));
    if (detector.update(value, 1 / 60, t)) onsets.push(Math.round(t * 1000));
  }
  assert.deepEqual(onsets, [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500]);
  const quiet = new FluxOnsets();
  assert.equal([0, 1, 2, 3].some((n) => quiet.update(n % 2 ? 5e-6 : 0, 1 / 30, n)), false);
});

test('the key detector takes chroma from its own spectrum step or from elsewhere alike', () => {
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  // D major, as twelve pitch-class levels.
  const chroma = Array.from({ length: 12 }, (_, i) => major[(i - 2 + 12) % 12]);
  const detector = new KeyDetector();
  let result = null;
  for (let i = 0; i < 60; ++i) result = detector.addChroma(chroma, 0.1);
  assert.equal(result.tonic, 2);
  assert.equal(result.mode, 'major');
  // Silence for two seconds clears the evidence but holds the key found.
  for (let i = 0; i < 25; ++i) result = detector.addChroma(new Array(12).fill(0), 0.1);
  assert.equal(detector.evidenceSeconds, 0);
  assert.equal(result.held, true);
  assert.throws(() => detector.addChroma([1, 2, 3], 0.1), /twelve chroma/);
  assert.throws(() => detector.addChroma(chroma, 0), /twelve chroma/);

  // update() is spectrumChroma followed by addChroma.
  const decibels = new Float32Array(4096).fill(-100);
  for (const hz of [146.8, 185, 220, 293.7]) decibels[Math.round(hz * 8192 / 48000)] = -20;
  const viaUpdate = new KeyDetector(), viaChroma = new KeyDetector();
  for (let i = 0; i < 60; ++i) {
    viaUpdate.update(decibels, 48000, 8192, 0.1);
    viaChroma.addChroma(spectrumChroma(decibels, 48000, 8192), 0.1);
  }
  assert.deepEqual(viaUpdate.result, viaChroma.result);
  assert.deepEqual([...viaUpdate.chroma], [...viaChroma.chroma]);
});

test('key and BPM series from real tracks are summarised by time', () => {
  // Nothing for 4 s, A minor claimed to 10 s and held to 30 (26 s), C major claimed to 40 and held to 50 (20 s).
  const series = [[0, null], [4, '9:minor'], [10, '9:minor:held'], [30, '0:major'], [40, '0:major:held']];
  const key = keySummary(series, 50);
  assert.deepEqual(key.most, { tonic: 9, mode: 'minor', held: false });
  assert.deepEqual(key.end, { tonic: 0, mode: 'major', held: true });
  assert.equal(key.first, 4);
  assert.equal(key.claimed, 16 / 50);
  assert.equal(key.changesPerMinute, 1.2);
  assert.deepEqual(keySummary([[0, null]], 60), { most: null, end: null, first: null, claimed: 0, changesPerMinute: 0 });
  // 120 for 10 s, 128 for 40 s, nothing for 10 s.
  const bpm = bpmSummary([[0, 120], [10, 128], [50, null]], 60, 128);
  assert.equal(bpm.typical, 128);
  assert.equal(bpm.verdict, 'right');
  assert.equal(bpm.rightShare, 40 / 60);
  assert.equal(bpmSummary([[0, null]], 60, 128).verdict, 'none');
});

test('dataset key labels parse, and anything but one major or minor key does not', () => {
  assert.deepEqual(parseKey('C# minor'), { tonic: 1, mode: 'minor' });
  assert.deepEqual(parseKey('Eb major'), { tonic: 3, mode: 'major' });
  assert.deepEqual(parseKey('A♯ maj'), { tonic: 10, mode: 'major' });
  assert.deepEqual(parseKey('G min'), { tonic: 7, mode: 'minor' });
  for (const label of ['X', 'F minor phrygian', 'C# minor | E major', 'B other', 'unknown', '', null])
    assert.equal(parseKey(label), null, label);
});

test('sliding-window results are summarised as they would be known live', () => {
  // Windows ending every 2 s: wrong twice, then right but for one unsure miss.
  const tempo = [[10, 90, 1.2], [12, 100, 1.0], [14, 128, 2.5], [16, 128.4, 2.6], [18, 140, 1.1], [20, 127.9, 2.4]];
  const t = windowTempoSummary(tempo, 128);
  assert.equal(t.share, 3 / 6);
  assert.equal(t.first, 14);
  assert.equal(t.afterFirst, 3 / 4);
  assert.equal(t.verdict, 'right');
  assert.equal(t.sureShare, 1);
  assert.equal(t.sureKept, 3 / 6);
  assert.equal(windowTempoSummary([], 128).first, null);
  // Key windows ending every 4 s over a minute.
  const key = [[20, 'A minor', 0.9], [24, 'C major', 0.6], [28, 'A minor', 0.85], [32, 'A minor', 0.8], [80, 'A minor', 0.7]];
  const k = windowKeySummary(key, { tonic: 9, mode: 'minor' }, parseKey);
  assert.equal(k.share, 4 / 5);
  assert.equal(k.verdict, 'exact');
  assert.equal(k.changesPerMinute, 2);
  assert.equal(k.claimed, 3 / 5);
  assert.equal(k.claimedExact, 1);
});
