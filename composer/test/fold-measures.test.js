import assert from 'node:assert/strict';
import test from 'node:test';
import { MEASURES, READING_RATE, contrast, foldReadings } from '../tools/fold-measures.js';

const RATE = 48000;

// Seeded noise, so the tests are the same every time.
function noise(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
}

// `seconds` of: a kick (60 Hz, 80 ms) on every beat at `kickBpm` if given,
// a closed hat (noise above the bass, 20 ms) every sixteenth at `hatBpm`, and
// if `bass`, a loud sine that changes pitch at random every half bar.
function track({ seconds = 30, kickBpm = null, hatBpm = null, hat = 0.15, bass = 0 }) {
  const out = new Float32Array(seconds * RATE), rand = noise();
  let phase = 0, pitch = 50;
  for (let i = 0; i < out.length; ++i) {
    const t = i / RATE;
    if (kickBpm) {
      const into = t % (60 / kickBpm);
      if (into < 0.08) out[i] += 0.8 * Math.sin(2 * Math.PI * 60 * into) * (1 - into / 0.08);
    }
    if (hatBpm) {
      const into = t % (15 / hatBpm);
      if (into < 0.02) out[i] += hat * rand() * (1 - into / 0.02);
    }
    if (bass) {
      if (i % Math.floor(RATE * 2 * 60 / (hatBpm ?? kickBpm)) === 0) pitch = 40 + 60 * Math.abs(rand());
      phase += 2 * Math.PI * pitch / RATE;
      out[i] += bass * Math.sin(phase);
    }
  }
  return out;
}

test('readings are taken READING_RATE times a second and fold into bars of rows', () => {
  const channels = MEASURES.loudness(track({ seconds: 8, kickBpm: 120 }), RATE);
  assert.equal(channels[0].length, 8 * READING_RATE);
  const bars = foldReadings(channels, 120, 48);
  assert.equal(bars.length, 4);
  assert.equal(bars[0][0].length, 48);
});

test('a kick and hats show clearly in every measure, and stand out from 1% off', () => {
  const samples = track({ kickBpm: 128, hatBpm: 128 });
  for (const [name, measure] of Object.entries(MEASURES)) {
    const { right, contrast: c } = contrast(measure(samples, RATE), 128);
    assert.ok(right > 0.8, `${name}: right ${right}`);
    assert.ok(c > 0.2, `${name}: contrast ${c}`);
  }
});

test('under a loud wandering bass, quiet hats show better without it than in plain loudness', () => {
  const samples = track({ hatBpm: 140, bass: 0.6 });
  const of = (name) => contrast(MEASURES[name](samples, RATE), 140).contrast;
  const loudness = of('loudness');
  assert.ok(of('no bass') > loudness + 0.2, `no bass ${of('no bass')} against loudness ${loudness}`);
  assert.ok(of('three bands') > loudness, `three bands ${of('three bands')} against loudness ${loudness}`);
});
