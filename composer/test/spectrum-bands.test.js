import assert from 'node:assert/strict';
import test from 'node:test';
import { RAW_MAX_DB, RAW_MIN_DB, RAW_TEXELS, RelativeBands, amplitudeAt, bandAt, dbToUnit, logFrequencies,
  rawTexture } from '../public/spectrum-bands.js';

// The spectrum as an array by frequency (T62).

const sampleRate = 48000;
// A 2048-point spectrum (1024 bins of 23.4 Hz) with the given tones, in dB.
function spectrum(tones, fftSize = 2048, floor = -100) {
  const data = new Float32Array(fftSize / 2).fill(floor);
  for (const [hz, db] of tones) data[Math.round(hz * fftSize / sampleRate)] = db;
  return { data, fftSize, sampleRate };
}

test('decibels become 0 to 1 over the analysers\' range, and silence is 0', () => {
  assert.equal(dbToUnit(RAW_MIN_DB), 0);
  assert.equal(dbToUnit(RAW_MAX_DB), 1);
  assert.ok(Math.abs(dbToUnit((RAW_MIN_DB + RAW_MAX_DB) / 2) - 0.5) < 1e-12);
  assert.equal(dbToUnit(-Infinity), 0);
  assert.equal(dbToUnit(0), 1);
});

test('amplitudeAt reads by frequency, interpolating between bins', () => {
  const input = spectrum([[1000, -15]]);
  const bin = 1000 * 2048 / sampleRate;
  assert.equal(amplitudeAt(input, Math.round(bin) * sampleRate / 2048), 1);
  const between = amplitudeAt(input, (Math.round(bin) + 0.5) * sampleRate / 2048);
  assert.ok(Math.abs(between - 0.5 * 1) < 0.35, `${between}`); // half way up from a floor of 0
  assert.equal(amplitudeAt(input, 5000), 0);
  assert.equal(amplitudeAt(input, -10), 0);
  assert.equal(amplitudeAt(input, 30000), 0);
  assert.equal(amplitudeAt(null, 100), 0);
});

test('bandAt averages a slice of an octave, and falls back inside one bin', () => {
  const input = spectrum([[1000, -15], [1050, -15]]);
  assert.ok(bandAt(input, 1020, 1 / 3) > 0.05);
  assert.ok(bandAt(input, 1020, 1 / 3) < 1);
  assert.equal(bandAt(input, 5000, 1 / 3), 0);
  // At 60 Hz a third of an octave is under 14 Hz, narrower than a bin.
  const low = spectrum([[60, -15]]);
  assert.equal(bandAt(low, 60, 1 / 3), amplitudeAt(low, 60));
});

test('logFrequencies are spaced evenly by pitch', () => {
  const f = logFrequencies(5, 100, 1600);
  assert.deepEqual(f.map(Math.round), [100, 200, 400, 800, 1600]);
  assert.equal(logFrequencies(1)[0] > 40, true);
});

test('the shaders\' texture spans 0 Hz to Nyquist, keeping the loudest bin of a group', () => {
  const input = spectrum([[3000, -15]], 8192);
  const target = new Uint8Array(RAW_TEXELS);
  const nyquist = rawTexture(input, target);
  assert.equal(nyquist, 24000);
  const texel = Math.floor(3000 / nyquist * RAW_TEXELS);
  assert.ok(target[texel] === 255 || target[texel - 1] === 255 || target[texel + 1] === 255);
  assert.equal(target[texel + 20], 0);
  // A short spectrum (512 bins) still fills the texture's width.
  const short = spectrum([[3000, -15]], 1024);
  rawTexture(short, target);
  const at = Math.round(3000 / 24000 * RAW_TEXELS);
  assert.ok(target.slice(at - 12, at + 12).some((v) => v === 255), 'a short spectrum is spread over the whole texture');
  assert.equal(target[at + 100], 0);
  assert.equal(rawTexture(null, target), 24000);
  assert.ok(target.every((v) => v === 0));
});

test('relative bands put a quiet frequency and a loud one on the same footing', () => {
  const bands = new RelativeBands(2);
  let out;
  // Band 0 swings between 0.6 and 0.9, band 1 between 0.05 and 0.15, once a second.
  for (let n = 0; n < 300; ++n) {
    const high = (n % 30) < 4;
    out = bands.update([high ? 0.9 : 0.6, high ? 0.15 : 0.05], 1 / 30);
    if (n > 150 && n % 30 === 2) assert.ok(out[0] > 0.9 && out[1] > 0.9, `${out}`);
  }
  out = bands.update([0.6, 0.05], 1 / 30);
  assert.ok(out[0] < 0.1 && out[1] < 0.1, `${out}`);
  // A band with no range stays at 0 rather than amplifying noise.
  const flat = new RelativeBands(1);
  for (let n = 0; n < 100; ++n) out = flat.update([0.3 + 0.001 * (n % 2)], 1 / 30);
  assert.equal(out[0], 0);
});
