import assert from 'node:assert/strict';
import test from 'node:test';
import { MomentaryLoudness, kWeightingCoefficients } from '../public/loudness.js';

// Momentary loudness (T61), against the standard's own figures.

const near = (a, b, tolerance, label) => assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} against ${b}`);

test('the K-weighting filters match the standard\'s 48 kHz coefficients', () => {
  const [shelf, highPass] = kWeightingCoefficients(48000);
  [1.53512485958697, -2.69169618940638, 1.19839281085285].forEach((v, i) => near(shelf.b[i], v, 1e-9, `shelf b${i}`));
  [-1.69065929318241, 0.73248077421585].forEach((v, i) => near(shelf.a[i + 1], v, 1e-9, `shelf a${i + 1}`));
  [-1.99004745483398, 0.99007225036621].forEach((v, i) => near(highPass.a[i + 1], v, 1e-8, `high-pass a${i + 1}`));
});

function sine(hz, amplitude, seconds, sampleRate = 48000) {
  return Float32Array.from({ length: Math.round(seconds * sampleRate) },
    (_, n) => amplitude * Math.sin(2 * Math.PI * hz * n / sampleRate));
}

test('a full-scale 997 Hz sine reads -3.01 LUFS, and each halving of amplitude takes 6.02 dB off', () => {
  const meter = new MomentaryLoudness(48000);
  meter.push(sine(997, 1, 1));
  near(meter.lufs, -3.01, 0.05, 'full scale');
  const half = new MomentaryLoudness(48000);
  half.push(sine(997, 0.5, 1));
  near(meter.lufs - half.lufs, 6.02, 0.05, 'halved');
});

test('the same sound handed over in small pieces reads the same', () => {
  const samples = sine(997, 0.25, 1);
  const whole = new MomentaryLoudness(48000), pieces = new MomentaryLoudness(48000);
  whole.push(samples);
  for (let i = 0; i < samples.length; i += 1600) pieces.push(samples.subarray(i, i + 1600));
  near(pieces.lufs, whole.lufs, 0.02, 'pieces');
});

test('the ear\'s weighting: bass counts for less than the mids, and the top for a little more', () => {
  const read = (hz) => { const m = new MomentaryLoudness(48000); m.push(sine(hz, 0.5, 1)); return m.lufs; };
  assert.ok(read(50) < read(997) - 1.5, `50 Hz ${read(50)} against ${read(997)}`);
  assert.ok(read(8000) > read(997) + 2, `8 kHz ${read(8000)} against ${read(997)}`);
});

test('silence is -Infinity and only the last 400 ms counts', () => {
  const meter = new MomentaryLoudness(48000);
  assert.equal(meter.lufs, -Infinity);
  meter.push(sine(997, 1, 1));
  for (let i = 0; i < 30; ++i) meter.push(new Float32Array(1600));
  assert.ok(meter.lufs < -80, `${meter.lufs}`);
});
