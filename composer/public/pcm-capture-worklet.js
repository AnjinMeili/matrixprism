// Copies the input's samples, mixed to mono, out of the audio thread in
// chunks of 4096 (about 85 ms at 48 kHz), each with the audio context's time
// at its last sample. For the Essentia beat source (essentia-worker.js).
const CHUNK = 4096;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(CHUNK);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input?.length) return true;
    const frames = input[0].length;
    for (let i = 0; i < frames; ++i) {
      let sum = 0;
      for (const channel of input) sum += channel[i];
      this.chunk[this.filled++] = sum / input.length;
      if (this.filled === CHUNK) {
        this.port.postMessage({ samples: this.chunk, end: currentTime + (i + 1) / sampleRate }, [this.chunk.buffer]);
        this.chunk = new Float32Array(CHUNK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
