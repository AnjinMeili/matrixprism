// What the beat graph could fold, and how clearly each shows the beat (
// Anjin, 2026-10-20: house has its timing in the kick; "drum and bass might
// have the timing up high, on a ride or high hat"). Each measure turns audio
// samples into readings at READING_RATE a second, as SoundTrace keeps them
// (beat-fold.js); `clarity` folds readings at a tempo and says how alike each
// bar is to the one before. Used by tools/fold-clarity.mjs; pure, so tested.

import { TRACE_RATE, bandFluxReadings } from '../public/beat-fold.js';

// The beat graph's own rate (beat-fold.js).
export const READING_RATE = TRACE_RATE;

// A second-order filter (the RBJ audio EQ cookbook), run over `samples`.
function biquad(samples, rate, type, frequency, q = Math.SQRT1_2) {
  const w = 2 * Math.PI * frequency / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'low') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (type === 'high') [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else [b0, b1, b2] = [alpha, 0, -alpha];
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; ++i) {
    const x = samples[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y;
    [x2, x1, y2, y1] = [x1, x, y1, y];
  }
  return out;
}

// RMS of each 1/READING_RATE s of `samples`.
function rmsReadings(samples, rate) {
  const step = rate / READING_RATE, count = Math.floor(samples.length / step);
  const out = new Float32Array(count);
  for (let r = 0; r < count; ++r) {
    let sum = 0;
    const from = Math.floor(r * step), to = Math.floor((r + 1) * step);
    for (let i = from; i < to; ++i) sum += samples[i] * samples[i];
    out[r] = Math.sqrt(sum / (to - from));
  }
  return out;
}

// The measures, each { name: [channel readings, ...] }: one channel, or one
// per band.
export const MEASURES = {
  // Loudness of the whole sound, as the beat graph folds it today.
  loudness: (s, rate) => [rmsReadings(s, rate)],
  // The same with the bass below 200 Hz taken out.
  'no bass': (s, rate) => [rmsReadings(biquad(biquad(s, rate, 'high', 200), rate, 'high', 200), rate)],
  // Low, mid and high, each its own channel.
  'three bands': (s, rate) => [
    rmsReadings(biquad(biquad(s, rate, 'low', 200), rate, 'low', 200), rate),
    rmsReadings(biquad(biquad(s, rate, 'low', 2000), rate, 'high', 200), rate),
    rmsReadings(biquad(biquad(s, rate, 'high', 2000), rate, 'high', 2000), rate),
  ],
  // Spectral flux: the rise in each of eight bands' log energy, summed; the
  // beat graph's own code (BandFlux in beat-fold.js).
  flux: (s, rate) => [bandFluxReadings(s, rate)],
};

// The readings of each channel folded at `bpm` into bars of `rows` rows from
// the start: an array of bars, each an array of channels, each `rows` means.
export function foldReadings(channels, bpm, rows = 48) {
  const bar = 4 * 60 / bpm * READING_RATE;
  const bars = Math.floor(channels[0].length / bar);
  return Array.from({ length: bars }, (_, b) => channels.map((readings) => {
    const out = new Float32Array(rows);
    for (let row = 0; row < rows; ++row) {
      const from = Math.floor((b + row / rows) * bar), to = Math.max(from + 1, Math.floor((b + (row + 1) / rows) * bar));
      let sum = 0;
      for (let i = from; i < to; ++i) sum += readings[i];
      out[row] = sum / (to - from);
    }
    return out;
  }));
}

// Pearson correlation of two arrays; 0 when either is flat.
function correlation(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; ++i) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; ++i) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

// How alike each bar is to the one before, folded at `bpm`: the mean, over
// pairs of bars and channels, of the correlation of their rows (so each band
// counts on its own scale). 1 when every bar is the same; near 0 when the
// fold does not line the music up.
export function clarity(channels, bpm, rows = 48) {
  const bars = foldReadings(channels, bpm, rows);
  let sum = 0, n = 0;
  for (let b = 1; b < bars.length; ++b)
    for (let c = 0; c < channels.length; ++c) {
      sum += correlation(bars[b][c], bars[b - 1][c]);
      ++n;
    }
  return n ? sum / n : 0;
}

// How much better the true tempo lines the bars up than one `off` away
// (1% by default), either way: the measure's contrast, which is what makes
// the right tempo stand out when nudging.
export function contrast(channels, bpm, off = 0.01) {
  const right = clarity(channels, bpm);
  return { right, contrast: right - Math.max(clarity(channels, bpm * (1 + off)), clarity(channels, bpm * (1 - off))) };
}
