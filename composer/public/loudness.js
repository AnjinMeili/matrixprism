// Momentary loudness in the EBU R128 / ITU-R BS.1770 sense (T61): the signal
// is K-weighted (a high shelf that lifts the top and a high-pass that drops the
// rumble, as the ear hears), squared and averaged over 400 ms, and given in
// LUFS. Written here from the standard's filter design; the coefficients are
// computed for any sample rate and match the standard's 48 kHz table.
// Mono: the sum of the channels is not taken, which is the standard's figure
// for a mono signal; for stereo it would add the channels' powers.

// A second-order section's coefficients, normalised so that a0 is 1.
function shelf(sampleRate) {
  const f0 = 1681.974450955533, gain = 3.999843853973347, q = 0.7071752369554196;
  const k = Math.tan(Math.PI * f0 / sampleRate);
  const vh = 10 ** (gain / 20), vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return {
    b: [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0],
    a: [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0],
  };
}

function highPass(sampleRate) {
  const f0 = 38.13547087602444, q = 0.5003270373238773;
  const k = Math.tan(Math.PI * f0 / sampleRate);
  const a0 = 1 + k / q + k * k;
  return { b: [1, -2, 1], a: [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0] };
}

export const kWeightingCoefficients = (sampleRate) => [shelf(sampleRate), highPass(sampleRate)];

// Momentary loudness of a stream of samples handed over in pieces. `push`
// takes the next samples in order; `lufs` is the last 400 ms's loudness, or
// -Infinity before any sound.
export class MomentaryLoudness {
  constructor(sampleRate, seconds = 0.4) {
    this.sections = kWeightingCoefficients(sampleRate);
    this.state = this.sections.map(() => [0, 0, 0, 0]); // x1, x2, y1, y2
    this.sampleRate = sampleRate;
    this.seconds = seconds;
    this.blocks = []; // [sum of squares, samples] per push
    this.total = [0, 0];
  }

  push(samples, gain = 1) {
    let sum = 0;
    for (let n = 0; n < samples.length; ++n) {
      let x = samples[n] * gain;
      for (let s = 0; s < this.sections.length; ++s) {
        const { b, a } = this.sections[s], z = this.state[s];
        const y = b[0] * x + b[1] * z[0] + b[2] * z[1] - a[1] * z[2] - a[2] * z[3];
        z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = y;
        x = y;
      }
      sum += x * x;
    }
    this.blocks.push([sum, samples.length]);
    this.total[0] += sum;
    this.total[1] += samples.length;
    const keep = this.seconds * this.sampleRate;
    while (this.blocks.length > 1 && this.total[1] - this.blocks[0][1] >= keep) {
      const [oldSum, oldCount] = this.blocks.shift();
      this.total[0] -= oldSum;
      this.total[1] -= oldCount;
    }
  }

  get lufs() {
    const mean = this.total[1] ? Math.max(0, this.total[0]) / this.total[1] : 0;
    return mean > 0 ? -0.691 + 10 * Math.log10(mean) : -Infinity;
  }
}
