// Spectral flux from every sample of the live input, in the audio thread, so
// none is missed between the page's frames (band-flux.js). The readings go to
// the page a few at a time, with the audio context's time at the end of the
// block that finished them; audio.js queues them for the Monitor's beat graph.
import { BandFlux } from './band-flux.js';

// Readings sent together: 2, 10 ms of sound.
const BATCH = 2;

class BandFluxProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.flux = new BandFlux(sampleRate);
    this.mono = new Float32Array(128);
    this.pending = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input?.length) return true;
    const frames = input[0].length;
    if (this.mono.length !== frames) this.mono = new Float32Array(frames);
    for (let i = 0; i < frames; ++i) {
      let sum = 0;
      for (const channel of input) sum += channel[i];
      this.mono[i] = sum / input.length;
    }
    for (const reading of this.flux.push(this.mono)) this.pending.push(reading);
    if (this.pending.length >= BATCH) {
      this.port.postMessage({ readings: Float32Array.from(this.pending), end: currentTime + frames / sampleRate });
      this.pending = [];
    }
    return true;
  }
}

registerProcessor('band-flux', BandFluxProcessor);
