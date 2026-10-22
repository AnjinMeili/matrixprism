// Beat Graph: the music folded by the bar, after the beat graphs of BpmDj
// (Werner Van Belle, bpmdj.yellowcouch.org). Written here from the idea, not
// ported from BpmDj's code.
//
// Each column is one bar of the composer's beat clock, newest at the right,
// and runs from the bar's first beat at the top to its last at the bottom.
// A row's brightness is the sound's energy at that moment of the bar. When
// the clock keeps time with the music, the same moment of each bar lands on
// the same row, so kicks, snares and hats draw horizontal lines; when the
// clock's tempo is off, the lines slope, and when its phase is off they sit
// away from the beat guides. So it is also a live view of the beat clock.
//
// Energy comes from the waveform the analyser gives each frame (the last 2048
// samples, kept as 256): the part that is new since the last frame is spread
// over the rows its time covers. With the live input the Monitor gives each
// frame's spectral flux instead (`flux`, BandFlux in beat-fold.js), which
// shows the beat about three times as clearly in every genre measured
// (docs/findings.md, "What the beat graph should fold"). A row's colour comes from that frame's
// spectrum, as in BpmDj: its hue from where the energy sits, red for bass to
// blue for treble, turned by the hue setting; paler when many frequencies
// sound at once.
//
// Mastered music is loud and full nearly all the time, so each of these is
// scaled between the lowest and highest values of the bars just before:
// brightness shows which moments of the bar are loudest, and colour which
// lean to the bass or the treble, within the music playing now.

const BEATS_PER_BAR = 4;
const COLUMN_WIDTH = 2;
// The waveform covers 2048 samples; at 48 kHz, 42.7 ms. At 44.1 kHz it is
// 46.4 ms, which only shifts a row's slice of it slightly.
export const WAVE_SECONDS = 2048 / 48000;
// Faint marks for each beat, so alignment can be read.
const GUIDE = 22;
const SILENCE = new Uint8Array(256).fill(128);

function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return [r * 255, g * 255, b * 255];
}

// The shape of a 256-bin log spectrum, each from 0 to 1: `centre`, where its
// energy's centre lies (0 the lowest bin, 1 the highest), and `peaky`, 1 less
// its mean over its peak (0 when every bin is equal).
export function spectrumShape(spectrum) {
  let sum = 0, weighted = 0, peak = 0;
  for (let i = 0; i < spectrum.length; ++i) {
    sum += spectrum[i];
    weighted += spectrum[i] * i;
    if (spectrum[i] > peak) peak = spectrum[i];
  }
  if (!sum) return { centre: 0, peaky: 0 };
  return { centre: weighted / sum / (spectrum.length - 1), peaky: 1 - sum / spectrum.length / peak };
}

// The range of a measure over the bars just played, followed smoothly so one
// bar unlike the rest does not upset the next. Also used by beat-fold.js.
export class Range {
  constructor() {
    this.low = 0;
    this.high = 0;
    this.seen = false;
  }

  // Takes in the values of a finished bar.
  follow(values, filled) {
    let low = Infinity, high = -Infinity;
    values.forEach((v, i) => {
      if (!filled[i]) return;
      low = Math.min(low, v);
      high = Math.max(high, v);
    });
    if (high < low) return;
    this.low = this.seen ? this.low * 0.5 + low * 0.5 : low;
    this.high = this.seen ? this.high * 0.5 + high * 0.5 : high;
    this.seen = true;
  }

  // `value` placed in the range, from 0 to 1; `flat` when the range is empty.
  scale(value, flat) {
    const range = this.high - this.low;
    return range > 1e-4 ? Math.max(0, Math.min(1, (value - this.low) / range)) : flat;
  }
}

// The mean of `readings` from fraction `a` to `b` of their span (0 to 1).
export function readingsBetween(readings, a, b) {
  const n = readings.length;
  const from = Math.min(n - 1, Math.max(0, Math.floor(a * n))), to = Math.max(from + 1, Math.min(n, Math.ceil(b * n)));
  let sum = 0;
  for (let i = from; i < to; ++i) sum += readings[i];
  return sum / (to - from);
}

// RMS of the 256-byte waveform from sample `from` to `to`, 0 to 1.
export function rms(wave, from, to) {
  let sum = 0;
  for (let i = from; i < to; ++i) sum += ((wave[i] - 128) / 128) ** 2;
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

// The bars played so far, kept apart from any picture of them so that the
// Monitor's graph and the Beat Graph pattern show the same history: the
// pattern, when chosen, starts with every bar the Monitor has heard. Each bar
// is a column of `rows` rows, each row a colour before the hue setting is
// applied: hue, saturation and value, from 0 to 1. Finished bars do not
// change; `finished` counts them, so a picture knows how far to scroll.
export class BarHistory {
  constructor({ rows = 192, bars = 256 } = {}) {
    this.rows = rows;
    this.bars = bars;
    // A ring of `bars` columns; the newest, still being played, is at
    // `finished % bars`.
    this.columns = Array.from({ length: bars }, () => new Float32Array(rows * 3));
    this.finished = 0;
    // The newest bar's rows, kept until it is complete: energy, and the
    // spectrum's centre and peakiness.
    this.energy = new Float32Array(rows);
    this.centre = new Float32Array(rows);
    this.peaky = new Float32Array(rows);
    this.filled = new Uint8Array(rows);
    this.ranges = { energy: new Range(), centre: new Range(), peaky: new Range() };
    this.bar = null;
    this.position = null;
    this.time = null;
    this.feeder = null;
  }

  // The column of the bar `back` bars before the newest (0, the newest).
  column(back) {
    return this.columns[(((this.finished - back) % this.bars) + this.bars) % this.bars];
  }

  // Takes in one frame: the clock's beat position, the time, the waveform
  // and the spectrum. A frame already taken in, at the same time and
  // position, is ignored, so every picture of the history can feed it.
  feed(state) {
    // Taken from one feeder only while one is set (the Monitor, with flux).
    if (this.feeder && state.feeder !== this.feeder) return;
    const position = state.beatPosition / BEATS_PER_BAR, time = state.audioTime;
    // Without a clock there is nowhere to put the sound.
    if (!Number.isFinite(position) || !Number.isFinite(time)) return;
    if (time === this.time && position === this.position) return;
    const wave = state.wave ?? SILENCE, spectrum = state.spectrum ?? SILENCE;
    if (this.position === null || position < this.position || position - this.position > 1 ||
        !(time > this.time)) {
      // First frame, or the clock jumped: carry on from here, in a fresh bar
      // if it is another one.
      const bar = Math.floor(position);
      if (this.bar !== null && bar > this.bar) this.finishBars(bar - this.bar);
      else if (bar !== this.bar) {
        this.clearNewest();
        this.bar = bar;
      }
      this.position = position;
      this.time = time;
      return;
    }
    const { centre, peaky } = spectrumShape(spectrum);
    const elapsed = time - this.time;
    // The waveform's newest `elapsed` seconds are new since the last frame.
    const fresh = Math.max(1, Math.min(256, Math.round(256 * elapsed / WAVE_SECONDS)));
    const from = this.position;
    const rowsAt = (p) => (p - Math.floor(p)) * this.rows;
    // Walk the rows between the last position and this one, bar by bar.
    let p = from;
    while (p < position) {
      const bar = Math.floor(p);
      if (bar !== this.bar) this.finishBars(bar - this.bar);
      const end = Math.min(position, bar + 1);
      const r0 = Math.floor(rowsAt(p)), r1 = end === bar + 1 ? this.rows : Math.floor(rowsAt(end));
      for (let row = r0; row < r1; ++row) {
        // The part of the fresh samples this row's time covers.
        const a = (bar + row / this.rows - from) / (position - from);
        const b = (bar + (row + 1) / this.rows - from) / (position - from);
        const s0 = 256 - fresh + Math.max(0, Math.floor(a * fresh));
        const s1 = 256 - fresh + Math.min(fresh, Math.max(Math.floor(a * fresh) + 1, Math.ceil(b * fresh)));
        this.energy[row] = state.flux?.length ? readingsBetween(state.flux, a, b) :
          rms(wave, Math.min(255, s0), Math.min(256, s1));
        this.centre[row] = centre;
        this.peaky[row] = peaky;
        this.filled[row] = 1;
        this.colour(row);
      }
      p = end;
    }
    this.position = position;
    this.time = time;
  }

  // Sets a row of the newest bar's column from its measures, scaled by the
  // ranges of the bars just before.
  colour(row) {
    const { energy, centre, peaky } = this.ranges;
    const out = this.column(0);
    if (!energy.high) {
      out.fill(0, row * 3, row * 3 + 3);
      return;
    }
    const value = energy.scale(this.energy[row], 1);
    out[row * 3] = centre.scale(this.centre[row], 0.5) * 2 / 3;
    out[row * 3 + 1] = 0.35 + 0.65 * peaky.scale(this.peaky[row], 1);
    out[row * 3 + 2] = value * value;
  }

  clearNewest() {
    this.filled.fill(0);
    this.energy.fill(0);
    this.column(0).fill(0);
  }

  // Closes `count` bars and takes the ranges from the bar just played.
  finishBars(count) {
    for (const name of ['energy', 'centre', 'peaky']) this.ranges[name].follow(this[name], this.filled);
    // Bars skipped by a jump stay black.
    for (let i = 0; i < Math.min(count, this.bars); ++i) {
      ++this.finished;
      this.column(0).fill(0);
    }
    this.finished += Math.max(0, count - this.bars);
    this.filled.fill(0);
    this.energy.fill(0);
    this.bar += count;
  }
}

// A picture of a bar history at any size: each bar a column COLUMN_WIDTH
// pixels wide, newest at the right, its rows averaged or repeated to the
// picture's height, with the hue setting applied. Finished bars are painted
// once, with the hue of the time, and scrolled; all of them are painted when
// the picture is new. Without a history given it keeps one of its own, the
// size of the picture.
export class BeatGraph {
  constructor(width, height, history = null) {
    this.width = width;
    this.height = height;
    this.history = history ?? new BarHistory({ rows: height, bars: Math.ceil(width / COLUMN_WIDTH) });
    this.rgb = new Uint8Array(width * height * 3);
    // What is returned: the picture with the beat guides over it.
    this.out = new Uint8Array(width * height * 3);
    this.hue = 0;
    // The history's `finished` count when last painted.
    this.painted = null;
    // The history rows each picture row takes in: from rowFrom[y] to rowTo[y].
    const rows = this.history.rows;
    this.rowFrom = new Uint16Array(height);
    this.rowTo = new Uint16Array(height);
    for (let y = 0; y < height; ++y) {
      this.rowFrom[y] = Math.min(rows - 1, Math.floor(y * rows / height));
      this.rowTo[y] = Math.max(this.rowFrom[y] + 1, Math.floor((y + 1) * rows / height));
    }
  }

  renderFrame(state) {
    this.history.feed(state);
    this.hue = state.hue ?? 0;
    return this.draw();
  }

  // Paints the bar `back` bars before the newest into its column.
  paintBar(back) {
    const x0 = this.width - (back + 1) * COLUMN_WIDTH;
    if (x0 + COLUMN_WIDTH <= 0) return;
    const column = this.history.column(back);
    const rgb = [0, 0, 0];
    for (let y = 0; y < this.height; ++y) {
      rgb.fill(0);
      const from = this.rowFrom[y], to = this.rowTo[y];
      for (let row = from; row < to; ++row) {
        const value = column[row * 3 + 2];
        if (!value) continue;
        const c = hsv((column[row * 3] + this.hue) % 1, column[row * 3 + 1], value);
        for (let i = 0; i < 3; ++i) rgb[i] += c[i];
      }
      for (let i = 0; i < 3; ++i) rgb[i] /= to - from;
      for (let x = Math.max(0, x0); x < x0 + COLUMN_WIDTH; ++x) this.rgb.set(rgb, (y * this.width + x) * 3);
    }
  }

  // Brings the picture up to the history: scrolls by the bars finished since
  // the last frame and paints them, or paints every bar, then the newest.
  draw() {
    const visible = Math.min(this.history.bars, Math.ceil(this.width / COLUMN_WIDTH));
    const advanced = this.painted === null ? Infinity : this.history.finished - this.painted;
    if (advanced >= visible || advanced < 0) {
      this.rgb.fill(0);
      for (let back = 1; back < visible; ++back) this.paintBar(back);
    } else if (advanced > 0) {
      const shift = advanced * COLUMN_WIDTH, rowBytes = this.width * 3;
      for (let y = 0; y < this.height; ++y) {
        const start = y * rowBytes;
        this.rgb.copyWithin(start, start + shift * 3, start + rowBytes);
      }
      for (let back = 1; back <= advanced; ++back) this.paintBar(back);
    }
    this.paintBar(0);
    this.painted = this.history.finished;
    const out = this.out;
    out.set(this.rgb);
    for (let beat = 0; beat < BEATS_PER_BAR; ++beat) {
      const y = Math.floor(beat * this.height / BEATS_PER_BAR);
      for (let x = 0; x < this.width; ++x) {
        const i = (y * this.width + x) * 3;
        for (let c = 0; c < 3; ++c) out[i + c] = Math.max(out[i + c], GUIDE);
      }
    }
    return out;
  }
}

// The history the Monitor view feeds every frame and the Beat Graph pattern
// shows, so the pattern starts with the music heard so far.
export const SHARED_BAR_HISTORY = new BarHistory();

export const BEAT_GRAPH_PATTERN = {
  id: 'beat-graph', name: 'Beat Graph',
  audio: 'The music folded by the bar, after BpmDj: each column is one bar of the beat clock, so beats draw ' +
    'horizontal lines when the clock keeps time and sloping ones when it does not',
  audioReactive: true,
  needsAudio: true,
  controls: [],
  createInstance: (width, height) => new BeatGraph(width, height, SHARED_BAR_HISTORY),
};
