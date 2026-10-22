// Tempo from Essentia.js (T28, the Essentia beat source): its
// RhythmExtractor2013 run on the last ten seconds of the input. Shared by
// the live worker (essentia-worker.js) and the audio comparison, so what is
// measured is what runs. Essentia is AGPL-3.0; see vendor/essentia/NOTICE.md.

export const WINDOW_SECONDS = 10;
export const EVERY_SECONDS = 2;
// RhythmExtractor2013 takes no sample rate and expects 44.1 kHz.
const ESSENTIA_RATE = 44100;

// Essentia's WebAssembly build, ready to use. An Emscripten build is either
// a module object that finishes starting on its own or a factory to call.
export async function loadEssentia(base = '/vendor/essentia/') {
  const { EssentiaWASM } = await import(`${base}essentia-wasm.es.js`);
  const { default: Essentia } = await import(`${base}essentia.js-core.es.js`);
  let module = EssentiaWASM;
  if (typeof module === 'function') module = await module();
  else if (!module.calledRun)
    await new Promise((resolve) => {
      const previous = module.onRuntimeInitialized;
      module.onRuntimeInitialized = () => { previous?.(); resolve(); };
    });
  return new Essentia(module);
}

// Where the beat falls, as seconds before `end` (from 0 to one beat), from
// beat times in seconds and the beat's length: the circular mean of each
// beat's place in the beat's cycle, so every beat found counts, not only
// the last, which a beat tracker places with the least certainty. Null with
// no beats.
export function beatPhase(ticks, end, period) {
  let x = 0, y = 0;
  for (const tick of ticks) {
    const angle = 2 * Math.PI * ((end - tick) / period);
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  if (!ticks.length || Math.hypot(x, y) < 1e-9) return null;
  const turn = Math.atan2(y, x) / (2 * Math.PI);
  return (turn - Math.floor(turn)) * period;
}

// `samples` resampled from `from` Hz to `to` Hz by linear interpolation.
export function resample(samples, from, to) {
  if (from === to) return samples;
  const out = new Float32Array(Math.floor(samples.length * to / from));
  const step = from / to;
  for (let i = 0; i < out.length; ++i) {
    const x = i * step, j = Math.floor(x), f = x - j;
    out[i] = samples[j] * (1 - f) + (samples[Math.min(samples.length - 1, j + 1)] ?? 0) * f;
  }
  return out;
}

export class EssentiaTempo {
  // `essentia` from loadEssentia; `sampleRate` of the samples pushed.
  constructor(essentia, sampleRate) {
    this.essentia = essentia;
    this.sampleRate = sampleRate;
    this.buffer = new Float32Array(Math.round(WINDOW_SECONDS * sampleRate));
    this.filled = 0;
    // Samples pushed since the last estimate.
    this.since = 0;
  }

  // Adds mono samples, the newest last.
  push(samples) {
    const n = this.buffer.length;
    if (samples.length >= n) {
      this.buffer.set(samples.subarray(samples.length - n));
    } else {
      this.buffer.copyWithin(0, samples.length);
      this.buffer.set(samples, n - samples.length);
    }
    this.filled = Math.min(n, this.filled + samples.length);
    this.since += samples.length;
  }

  // Whether a full window has arrived and an estimate is due.
  get due() {
    return this.filled === this.buffer.length && this.since >= EVERY_SECONDS * this.sampleRate;
  }

  // Runs RhythmExtractor2013 on the window: { bpm, confidence, lastBeat },
  // where lastBeat is where the beat falls, in seconds before the window's
  // end (beatPhase over all the beats it found), or null if it found none.
  estimate() {
    this.since = 0;
    const signal = this.essentia.arrayToVector(resample(this.buffer, this.sampleRate, ESSENTIA_RATE));
    try {
      const r = this.essentia.RhythmExtractor2013(signal, 208, 'multifeature', 40);
      const ticks = this.essentia.vectorToArray(r.ticks);
      for (const name of ['ticks', 'estimates', 'bpmIntervals']) r[name]?.delete?.();
      return {
        bpm: r.bpm, confidence: r.confidence,
        lastBeat: r.bpm > 0 ? beatPhase(ticks, WINDOW_SECONDS, 60 / r.bpm) : null,
      };
    } finally {
      signal.delete();
    }
  }
}
