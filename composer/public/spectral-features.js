// Simple spectral features, written by hand on an AnalyserNode's data: the
// "Web Audio alone" side of the audio comparison (T26), and the versions the
// composer would use if a pattern comes to need them. Spectra are linear
// magnitudes, one per FFT bin from 0 Hz to just below Nyquist; `magnitudes`
// converts getFloatFrequencyData's decibels.

export function magnitudes(decibels, target = new Float32Array(decibels.length)) {
  for (let i = 0; i < decibels.length; ++i)
    target[i] = Number.isFinite(decibels[i]) ? 10 ** (decibels[i] / 20) : 0;
  return target;
}

const binHz = (spectrum, sampleRate) => sampleRate / 2 / spectrum.length;

// The spectrum's centre of mass in Hz: its brightness. 0 for silence.
export function centroid(spectrum, sampleRate) {
  let sum = 0, weighted = 0;
  for (let i = 0; i < spectrum.length; ++i) {
    sum += spectrum[i];
    weighted += spectrum[i] * i;
  }
  return sum > 0 ? weighted / sum * binHz(spectrum, sampleRate) : 0;
}

// Geometric over arithmetic mean of the magnitudes: near 1 for noise, near 0
// for a few tones. 0 for silence.
export function flatness(spectrum) {
  let logSum = 0, sum = 0;
  for (const value of spectrum) {
    logSum += Math.log(value + 1e-12);
    sum += value;
  }
  return sum > 0 ? Math.min(1, Math.exp(logSum / spectrum.length) / (sum / spectrum.length)) : 0;
}

// The frequency in Hz below which `share` of the magnitude lies. 0 for silence.
export function rolloff(spectrum, sampleRate, share = 0.85) {
  let total = 0;
  for (const value of spectrum) total += value;
  if (total <= 0) return 0;
  let running = 0;
  for (let i = 0; i < spectrum.length; ++i) {
    running += spectrum[i];
    if (running >= total * share) return (i + 1) * binHz(spectrum, sampleRate);
  }
  return sampleRate / 2;
}

// How much the spectrum rose since `previous`: the mean of the increases in
// magnitude, bin by bin. Falls are ignored, so onsets stand out.
export function flux(spectrum, previous) {
  let sum = 0;
  for (let i = 0; i < spectrum.length; ++i)
    sum += Math.max(0, spectrum[i] - previous[i]);
  return sum / spectrum.length;
}

// The share of adjacent samples that change sign; a sine of f Hz gives about
// 2f / sampleRate.
export function zeroCrossingRate(samples) {
  let crossings = 0;
  for (let i = 1; i < samples.length; ++i)
    if ((samples[i - 1] < 0) !== (samples[i] < 0)) ++crossings;
  return samples.length > 1 ? crossings / (samples.length - 1) : 0;
}

// Onsets from flux by the composer's own beat rule (updateBeat in audio.js):
// a value 1.3 times its running average, at most one in 0.22 s, with a floor
// that ignores silence. For the audio comparison (T26), which asks whether
// flux finds beats better than bass jumps do. Call once a frame; returns
// whether this frame is an onset.
export class FluxOnsets {
  constructor(floor = 1e-5) {
    this.floor = floor;
    this.average = 0;
    this.last = -Infinity;
  }

  update(value, dt, seconds) {
    this.average += (value - this.average) * Math.min(1, dt * 2.5);
    if (value > this.floor && value > this.average * 1.3 && seconds - this.last > 0.22) {
      this.last = seconds;
      return true;
    }
    return false;
  }
}

// Where in a band the spectrum rose since `previous`: the centre of mass of
// the increases between bins `start` and `end`, on a log scale of frequency,
// 0 at the bottom of the band and 1 at the top. 0.5 when nothing rose.
export function riseCentre(spectrum, previous, start, end) {
  let sum = 0, weighted = 0;
  const low = Math.log(Math.max(1, start)), span = Math.log(Math.max(2, end) / Math.max(1, start));
  for (let i = start; i < end; ++i) {
    const rise = spectrum[i] - previous[i];
    if (rise <= 0) continue;
    sum += rise;
    weighted += rise * (Math.log(Math.max(1, i)) - low) / span;
  }
  return sum > 0 ? Math.min(1, Math.max(0, weighted / sum)) : 0.5;
}

// The share of the spectrum's magnitude that lies between bins `start` and
// `end`. 0 for silence.
export function bandShare(spectrum, start, end) {
  let total = 0, inside = 0;
  for (let i = 0; i < spectrum.length; ++i) {
    total += spectrum[i];
    if (i >= start && i < end) inside += spectrum[i];
  }
  return total > 0 ? inside / total : 0;
}

const medianOf = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// Hits (onsets) in a flux value that sits on a busy background, such as the
// high band under a steady hi-hat (T30). A value is a hit when it exceeds the
// median of the last `window` seconds by `k` median absolute deviations, is
// above `floor`, and comes at least `gap` seconds after the last hit. The
// median rather than the mean, and the deviation rather than a ratio, so that
// a run of hits and a loud master do not raise the bar as the beat rule's
// 1.3-times-the-average does (T26). Call once a frame; returns the hit's
// strength, 0.25 at the threshold rising to 1 at eight times it, or 0. A
// frame that other tests have ruled out (`eligible` false) still counts
// towards the median but cannot be a hit, nor start the gap.
export class HitDetector {
  constructor({ window = 1, k = 3, floor = 1e-6, gap = 0.04 } = {}) {
    Object.assign(this, { window, k, floor, gap });
    this.reset();
  }

  reset() {
    this.times = [];
    this.values = [];
    this.last = -Infinity;
  }

  update(value, seconds, eligible = true) {
    while (this.times.length && this.times[0] < seconds - this.window) {
      this.times.shift();
      this.values.shift();
    }
    let strength = 0;
    if (this.values.length >= 4) {
      const median = medianOf(this.values);
      const deviation = medianOf(this.values.map((v) => Math.abs(v - median)));
      const threshold = Math.max(this.floor, median + this.k * deviation);
      if (eligible && value > threshold && seconds - this.last >= this.gap) {
        this.last = seconds;
        strength = Math.min(1, 0.25 + Math.log2(value / threshold) / 4);
      }
    }
    this.times.push(seconds);
    this.values.push(value);
    return strength;
  }
}
