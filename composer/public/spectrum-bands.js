// The spectrum as an array by frequency, open to any pattern (T62).
//
// The input is what AudioAnalyzer.spectrumInput gives: `data`, one decibel
// reading per FFT bin from 0 Hz to just under Nyquist, `fftSize` and
// `sampleRate`. This module turns it into 0 to 1 amplitudes read by frequency
// in Hz, for JavaScript patterns; the renderer gives shaders the same values
// as a texture (`rawSpec` in the pattern prelude), by the same mapping.

// The decibel range that becomes 0 to 1, as the composer's own analysers use.
export const RAW_MIN_DB = -90;
export const RAW_MAX_DB = -15;

// Texels in the shaders' texture. A longer spectrum is reduced to this by
// keeping the largest reading of each group of bins.
export const RAW_TEXELS = 2048;

export const dbToUnit = (db) =>
  Number.isFinite(db) ? Math.min(1, Math.max(0, (db - RAW_MIN_DB) / (RAW_MAX_DB - RAW_MIN_DB))) : 0;

export const binHz = (input) => input.sampleRate / input.fftSize;

// The amplitude (0 to 1) at `hz`, interpolated between the bins either side.
// Bin i is centred on i * binHz; 0 outside the spectrum or with no input.
export function amplitudeAt(input, hz) {
  if (!input?.data?.length) return 0;
  const position = hz / binHz(input);
  if (position < 0 || position > input.data.length - 1) return 0;
  const i = Math.floor(position), f = position - i;
  const a = dbToUnit(input.data[i]);
  return f > 0 ? a + (dbToUnit(input.data[i + 1]) - a) * f : a;
}

// The mean amplitude over `octaves` wide, centred on `hz` on a log scale: for a
// part that listens to a pitch, not a bin. Narrower than a bin, it falls back
// to the interpolated reading.
export function bandAt(input, hz, octaves = 1 / 3) {
  if (!input?.data?.length) return 0;
  const low = hz * 2 ** (-octaves / 2), high = hz * 2 ** (octaves / 2);
  const step = binHz(input);
  const from = Math.ceil(low / step), to = Math.floor(high / step);
  if (to < from) return amplitudeAt(input, hz);
  let sum = 0, count = 0;
  for (let i = Math.max(0, from); i <= Math.min(input.data.length - 1, to); ++i, ++count)
    sum += dbToUnit(input.data[i]);
  return count ? sum / count : 0;
}

// `count` frequencies evenly spaced by pitch from `low` to `high` Hz.
export const logFrequencies = (count, low = 40, high = 16000) =>
  Array.from({ length: count }, (_, i) => low * (high / low) ** (count === 1 ? 0.5 : i / (count - 1)));

// The spectrum for the shaders' texture: RAW_TEXELS bytes, 0 to 255, over 0 Hz
// to Nyquist; returns the Nyquist frequency the texels span.
export function rawTexture(input, target = new Uint8Array(RAW_TEXELS)) {
  target.fill(0);
  const data = input?.data;
  if (!data?.length) return input?.sampleRate / 2 || 24000;
  // Bins per texel: over 1 for a long spectrum, under 1 for a short one, whose
  // bins then cover several texels.
  const group = data.length / RAW_TEXELS;
  for (let t = 0; t < RAW_TEXELS; ++t) {
    // Bins data[from..to) land on this texel.
    const from = Math.floor(t * group), to = Math.max(from + 1, Math.floor((t + 1) * group));
    let peak = 0;
    for (let i = from; i < Math.min(to, data.length); ++i) peak = Math.max(peak, dbToUnit(data[i]));
    target[t] = Math.round(peak * 255);
  }
  return input.sampleRate / 2;
}

// Each frequency's amplitude against its own recent range: a part high in the
// spectrum, where music is quieter, then moves as much as one in the bass.
// The ceiling follows the highest reading and falls back over `fallSeconds`;
// the floor follows the lowest and rises over the same time. `read` returns
// 0 to 1: how far the amplitude stands between them, 0 with no range yet.
export class RelativeBands {
  constructor(count, fallSeconds = 8, minimumRange = 0.08) {
    this.fallSeconds = fallSeconds;
    this.minimumRange = minimumRange;
    this.ceiling = new Float32Array(count);
    this.floor = new Float32Array(count).fill(1);
    this.out = new Float32Array(count);
  }

  update(amplitudes, dt) {
    const k = Math.min(1, dt / this.fallSeconds);
    for (let i = 0; i < this.out.length; ++i) {
      const a = amplitudes[i];
      this.ceiling[i] = a > this.ceiling[i] ? a : this.ceiling[i] + (a - this.ceiling[i]) * k;
      this.floor[i] = a < this.floor[i] ? a : this.floor[i] + (a - this.floor[i]) * k;
      const range = this.ceiling[i] - this.floor[i];
      this.out[i] = range < this.minimumRange ? 0 : Math.min(1, Math.max(0, (a - this.floor[i]) / range));
    }
    return this.out;
  }
}
