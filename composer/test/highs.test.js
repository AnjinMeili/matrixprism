import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioAnalyzer } from '../public/audio.js';
import { HitDetector, bandShare, riseCentre } from '../public/spectral-features.js';

// High-band hits, their place and the air (T30).

const sampleRate = 48000;
const bins = 1024;
const fps = 30;
const binHz = sampleRate / 2 / bins;

test('hits stand out from a busy background by the median and its deviation, one per gap', () => {
  const hits = new HitDetector();
  const found = [];
  for (let n = 0; n < 4 * fps; ++n) {
    // A wobbling background, with a spike every eighth frame.
    const value = 1 + 0.1 * Math.sin(n * 1.7) + (n % 8 === 0 ? 2 : 0);
    const strength = hits.update(value, n / fps);
    if (strength) found.push(n);
  }
  // The first spike comes before four values are in hand.
  assert.deepEqual(found, [8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112]);

  // Strength: 0.25 just over the threshold, 1 at eight times it.
  const steady = new HitDetector();
  for (let n = 0; n < 10; ++n) steady.update(1, n / fps);
  assert.ok(Math.abs(steady.update(1.0001, 10 / fps) - 0.25) < 0.001);
  assert.equal(steady.update(8, 20 / fps), 1);
  // Within the gap of the last hit, nothing.
  assert.equal(steady.update(50, 20 / fps + 0.03), 0);

  // A frame ruled out by other tests is no hit and does not start the gap.
  assert.equal(steady.update(50, 21 / fps, false), 0);
  assert.ok(steady.update(50, 21 / fps + 0.01) > 0);

  // Silence stays under the floor.
  const silent = new HitDetector();
  for (let n = 0; n < 30; ++n) assert.equal(silent.update(n % 5 === 0 ? 1e-8 : 0, n / fps), 0);
});

test('the rise centre says where in the band the spectrum rose, and the share how much lies there', () => {
  const previous = new Float32Array(bins), spectrum = new Float32Array(bins);
  assert.equal(riseCentre(spectrum, previous, 170, 683), 0.5);
  spectrum[171] = 1;
  assert.ok(riseCentre(spectrum, previous, 170, 683) < 0.01);
  spectrum[171] = 0;
  spectrum[682] = 1;
  assert.ok(riseCentre(spectrum, previous, 170, 683) > 0.99);
  // Falls are ignored.
  previous[300] = 5;
  assert.ok(riseCentre(spectrum, previous, 170, 683) > 0.99);

  const flat = new Float32Array(100).fill(1);
  assert.equal(bandShare(flat, 25, 50), 0.25);
  assert.equal(bandShare(new Float32Array(100), 25, 50), 0);
});

// A supplied frame with a flat byte spectrum and the decibel spectrum
// `decibels` on the unsmoothed analyser.
const frame = (decibels) => ({
  sampleRate, frequencyData: new Uint8Array(bins).fill(60), timeData: new Uint8Array(2048).fill(128),
  channels: null, fluxData: decibels, readKeyData: null,
});

// -80 dB everywhere, and `db` from `low` to `high` Hz.
function spectrum(low = 0, high = 0, db = -80) {
  const decibels = new Float32Array(bins).fill(-80);
  for (let i = 0; i < bins; ++i)
    if (i * binHz >= low && i * binHz < high) decibels[i] = db;
  return decibels;
}

test('a hat on every fourth frame gives a high hit each time, its place, its rate and the air', () => {
  const audio = new AudioAnalyzer();
  const hits = [], places = [];
  let strength = 0;
  for (let n = 0; n < 4 * fps; ++n) {
    // Alternating low and high hats, every fourth frame.
    const hat = n % 4 === 0;
    const high = n % 8 === 0;
    const f = audio.analyse(frame(hat ? spectrum(high ? 11000 : 4500, high ? 15000 : 6500, -40) : spectrum()),
      1 / fps, 1, n / fps);
    if (f.highHits) {
      hits.push(n);
      places.push([high, f.highPlace]);
      assert.equal(f.highHit, f.highStrength);
      strength = f.highStrength;
    }
  }
  // Every hat after the first four frames.
  assert.deepEqual(hits, Array.from({ length: 29 }, (_, i) => 4 + 4 * i));
  for (const [high, place] of places)
    assert.ok(high ? place > 0.7 : place < 0.3, `${high ? 'high' : 'low'} hat at ${place}`);
  // 30 frames a second, one in four: 7.5 a second.
  assert.equal(audio.features.highRate, 7.5);
  // Three frames (0.1 s) after the last hit, the pulse has fallen to a third.
  assert.ok(Math.abs(audio.features.highHit - strength * Math.exp(-1)) < 1e-9, `pulse ${audio.features.highHit}`);
  // A flat spectrum has half its bins, and so half its magnitude, in 4-16
  // kHz; the hats lift that.
  assert.ok(audio.features.air > 0.5 && audio.features.air < 0.7, `air ${audio.features.air}`);
});

test('a kick in the bass alone makes no high hit, and no unsmoothed analyser means none at all', () => {
  const audio = new AudioAnalyzer();
  for (let n = 0; n < 2 * fps; ++n) {
    const f = audio.analyse(frame(n % 15 === 0 ? spectrum(40, 160, -20) : spectrum()), 1 / fps, 1, n / fps);
    assert.equal(f.highHits, 0, `frame ${n}`);
  }
  const without = new AudioAnalyzer();
  for (let n = 0; n < fps; ++n) {
    const f = without.analyse({ ...frame(null), fluxData: null }, 1 / fps, 1, n / fps);
    assert.equal(f.highHits, 0);
    assert.equal(f.air, 0);
  }
});

test('the simulated signal has hats on the sixteenths', () => {
  const audio = new AudioAnalyzer();
  audio.startSimulated();
  let hits = 0;
  for (let n = 1; n <= 4 * fps; ++n) hits += audio.update(1 / fps, 1, n / fps).highHits;
  // 8 a second for 4 seconds, the first sixteenth (at 0) not counted.
  assert.equal(hits, 31);
  assert.equal(audio.features.highRate, 8);
});

test('at 60 fps a hat that rises over two frames is still a hit: the rise is taken over 30 ms', () => {
  // A steady -50 dB in the band; each hat climbs 3 dB a frame for two frames.
  // Against the frame before, each step is a rise of 0.41 of the level, short
  // of HIGH_RISE (0.5); against the spectrum two frames back, 1.0.
  const audio = new AudioAnalyzer();
  const rate = 60, hits = [];
  for (let n = 0; n < 3 * rate; ++n) {
    const step = n % 16;
    const db = step === 1 ? -47 : step === 2 ? -44 : step === 3 ? -47 : -50;
    const decibels = spectrum(4000, 16000, db);
    if (audio.analyse(frame(decibels), 1 / rate, 1, n / rate).highHits) hits.push(n);
  }
  // One hit per hat, on its second frame, once four frames are in hand.
  assert.deepEqual(hits, Array.from({ length: 11 }, (_, i) => 18 + 16 * i));
});
