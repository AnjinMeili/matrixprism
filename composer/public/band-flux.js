// Spectral flux over eight bands, for the beat graph (beat-fold.js,
// monitor.js) and the audio thread (flux-worklet.js), so it imports nothing.
// Each band's log energy, how much it rose since the last reading, summed:
// measured as the clearest view of the beat in every genre, about three
// times the loudness the graph first folded
// (docs/findings.md, "What the beat graph should fold"). BandFlux takes full-rate
// samples as they come and gives a reading for each 1/TRACE_RATE s.

// Readings a second, as the beat graph keeps the sound (beat-fold.js).
export const TRACE_RATE = 200;
const FLUX_EDGES = [30, 100, 200, 400, 800, 1600, 3200, 6400, 16000];

// A band-pass filter (the RBJ audio EQ cookbook), run sample by sample.
class BandPass {
  constructor(rate, centre, q) {
    const w = 2 * Math.PI * centre / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    [this.b0, this.b1, this.b2] = [alpha / a0, 0, -alpha / a0];
    [this.a1, this.a2] = [-2 * cos / a0, (1 - alpha) / a0];
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  step(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export class BandFlux {
  constructor(rate) {
    this.rate = rate;
    this.filters = FLUX_EDGES.slice(0, -1).map((low, i) => {
      const high = FLUX_EDGES[i + 1], centre = Math.sqrt(low * high);
      return new BandPass(rate, centre, centre / (high - low));
    });
    this.sums = new Float64Array(this.filters.length);
    this.previous = null;
    // Samples taken in so far, and how many readings given.
    this.taken = 0;
    this.given = 0;
    this.inReading = 0;
  }

  // Takes in the next samples; returns the readings they complete.
  push(samples) {
    const out = [], step = this.rate / TRACE_RATE;
    for (let i = 0; i < samples.length; ++i) {
      const x = samples[i];
      for (let b = 0; b < this.filters.length; ++b) {
        const y = this.filters[b].step(x);
        this.sums[b] += y * y;
      }
      ++this.inReading;
      ++this.taken;
      if (this.taken >= Math.floor((this.given + 1) * step)) {
        let flux = 0;
        const levels = Array.from(this.sums, (sum) => Math.log(Math.sqrt(sum / this.inReading) + 1e-6));
        if (this.previous) levels.forEach((level, b) => { flux += Math.max(0, level - this.previous[b]); });
        this.previous = levels;
        out.push(flux);
        this.sums.fill(0);
        this.inReading = 0;
        ++this.given;
      }
    }
    return Float32Array.from(out);
  }
}

// The flux readings of a whole recording at `rate`.
export const bandFluxReadings = (samples, rate) => new BandFlux(rate).push(samples);
