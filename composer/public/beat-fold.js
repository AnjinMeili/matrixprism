// Folding the sound heard so far at any tempo (Anjin, 2026-10-20: "a tempo
// nudge to the beat graph in the monitor page, that lets one change the tempo
// and rerender the beat graph, including with history. So one can nudge up
// and down until a pattern emerges").
//
// The Beat Graph's own history (BarHistory in beat-graph.js) keeps the sound
// already folded by the live clock, so it cannot be folded again. Here the
// sound is kept by time instead: SoundTrace holds the last minutes as
// readings at a fixed rate, and FoldedHistory folds them at a chosen tempo
// and bar line, at one constant tempo across the whole picture, as BpmDj's
// beat graphs do. It looks to a BeatGraph just like a BarHistory, so the same
// picture draws either.

import { Range, WAVE_SECONDS, readingsBetween, rms, spectrumShape } from './beat-graph.js';
import { TRACE_RATE } from './band-flux.js';

const BEATS_PER_BAR = 4;
// Readings a second (band-flux.js): at 140 BPM a bar of 192 rows takes about
// 9 ms a row.
export { TRACE_RATE };
// How much sound is kept.
export const TRACE_SECONDS = 600;
const SILENCE = new Uint8Array(256).fill(128);

// Spectral flux (band-flux.js), re-exported for the tools that measured it.
export { BandFlux, bandFluxReadings } from './band-flux.js';


// The sound by time: for each 1/TRACE_RATE s, its energy and the spectrum's
// centre and peakiness (beat-graph.js), taken from each frame's waveform and
// spectrum as the Beat Graph takes them. With the frame's flux readings
// (`flux`, BandFlux's for the time since the last frame), the energy is the
// flux instead: the live input has them, the simulated signal does not.
export class SoundTrace {
  constructor(seconds = TRACE_SECONDS) {
    this.size = Math.round(seconds * TRACE_RATE);
    this.energy = new Float32Array(this.size);
    this.centre = new Float32Array(this.size);
    this.peaky = new Float32Array(this.size);
    // Readings are kept for slots first to next - 1, by slot number
    // (Math.floor(time * TRACE_RATE)).
    this.first = null;
    this.next = null;
    this.time = null;
  }

  // Takes in one frame: { audioTime, wave, spectrum, flux }. A frame at or before
  // the last one is ignored; a gap of more than a second starts afresh.
  feed(state) {
    const time = state.audioTime;
    // Times before 0 (the Monitor places flux a moment behind, and the
    // page's clock starts at 0) are left out.
    if (!Number.isFinite(time) || time < 0) return;
    if (this.time === null || time - this.time > 1 || time < this.time) {
      this.time = time;
      this.first = this.next = Math.floor(time * TRACE_RATE);
      return;
    }
    if (time === this.time) return;
    const wave = state.wave ?? SILENCE;
    const { centre, peaky } = spectrumShape(state.spectrum ?? SILENCE);
    const elapsed = time - this.time;
    // The waveform's newest `elapsed` seconds are new since the last frame.
    const fresh = Math.max(1, Math.min(256, Math.round(256 * elapsed / WAVE_SECONDS)));
    const end = Math.floor(time * TRACE_RATE);
    for (let slot = this.next; slot < end; ++slot) {
      // The part of the fresh samples this slot's time covers.
      const a = Math.max(0, (slot / TRACE_RATE - this.time) / elapsed);
      const b = Math.min(1, ((slot + 1) / TRACE_RATE - this.time) / elapsed);
      const s0 = 256 - fresh + Math.floor(a * fresh);
      const s1 = 256 - fresh + Math.max(Math.floor(a * fresh) + 1, Math.ceil(b * fresh));
      const i = this.index(slot);
      this.energy[i] = state.flux?.length ? readingsBetween(state.flux, a, b) : rms(wave, Math.min(255, s0), Math.min(256, s1));
      this.centre[i] = centre;
      this.peaky[i] = peaky;
    }
    this.next = Math.max(this.next, end);
    this.first = Math.max(this.first, this.next - this.size);
    this.time = time;
  }

  // Where slot `slot` is kept in the ring.
  index(slot) {
    return ((slot % this.size) + this.size) % this.size;
  }

  // Whether slot `slot` holds a reading.
  has(slot) {
    return this.first !== null && slot >= this.first && slot < this.next;
  }
}

// The trace folded at `bpm` with a bar starting at `anchor` seconds: bars of
// `rows` rows, the newest the one that holds the trace's last reading,
// `bars` of them. Each row is the mean of the readings its time covers,
// coloured as the Beat Graph colours them, scaled by the ranges of the bars
// before it. It offers what a BeatGraph reads of a BarHistory: rows, bars,
// finished and column(back).
export class FoldedHistory {
  constructor(trace, { rows = 192, bars = 128 } = {}) {
    this.trace = trace;
    this.rows = rows;
    this.bars = bars;
    this.columns = Array.from({ length: bars }, () => new Float32Array(rows * 3));
    this.finished = 0;
    this.bpm = null;
    this.anchor = null;
  }

  // Folds again at `bpm`, with a bar starting at `anchor` (seconds, on the
  // trace's clock). Returns this.
  fold(bpm, anchor) {
    this.bpm = bpm;
    this.anchor = anchor;
    const trace = this.trace, rows = this.rows;
    for (const column of this.columns) column.fill(0);
    if (trace.next === null || !(bpm > 0)) return this;
    const barSeconds = BEATS_PER_BAR * 60 / bpm;
    const lastTime = (trace.next - 1) / TRACE_RATE;
    const newest = Math.floor((lastTime - anchor) / barSeconds);
    // `finished` counts bars from the anchor, so a picture scrolls as bars end.
    this.finished = newest;
    const ranges = { energy: new Range(), centre: new Range(), peaky: new Range() };
    const energy = new Float32Array(rows), centre = new Float32Array(rows), peaky = new Float32Array(rows);
    const filled = new Uint8Array(rows);
    // Oldest first, so each bar is scaled by the bars before it.
    for (let back = this.bars - 1; back >= 0; --back) {
      const start = anchor + (newest - back) * barSeconds;
      filled.fill(0);
      for (let row = 0; row < rows; ++row) {
        const s0 = Math.floor((start + row / rows * barSeconds) * TRACE_RATE);
        const s1 = Math.max(s0 + 1, Math.floor((start + (row + 1) / rows * barSeconds) * TRACE_RATE));
        let e = 0, c = 0, p = 0, n = 0;
        for (let slot = s0; slot < s1; ++slot) {
          if (!trace.has(slot)) continue;
          const i = trace.index(slot);
          e += trace.energy[i] ** 2;
          c += trace.centre[i];
          p += trace.peaky[i];
          ++n;
        }
        if (!n) continue;
        energy[row] = Math.sqrt(e / n);
        centre[row] = c / n;
        peaky[row] = p / n;
        filled[row] = 1;
      }
      const out = this.column(back);
      if (ranges.energy.seen) {
        for (let row = 0; row < rows; ++row) {
          if (!filled[row]) continue;
          const value = ranges.energy.scale(energy[row], 1);
          out[row * 3] = ranges.centre.scale(centre[row], 0.5) * 2 / 3;
          out[row * 3 + 1] = 0.35 + 0.65 * ranges.peaky.scale(peaky[row], 1);
          out[row * 3 + 2] = value * value;
        }
      }
      ranges.energy.follow(energy, filled);
      ranges.centre.follow(centre, filled);
      ranges.peaky.follow(peaky, filled);
    }
    return this;
  }

  // The column of the bar `back` bars before the newest (0, the newest).
  column(back) {
    return this.columns[(((this.finished - back) % this.bars) + this.bars) % this.bars];
  }
}
