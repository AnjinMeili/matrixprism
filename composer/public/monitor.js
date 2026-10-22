// The Monitor view: a running picture of the beat clock and the tempo, kept
// whatever pattern is showing, and a log of them to download, for judging
// and tuning the beat sources (T28).
//
// - A Beat Graph (beat-graph.js), fed every frame, so the music folded by
//   the clock's bar builds up behind any pattern. Its bars are the ones the
//   Beat Graph pattern shows, so the pattern starts with them.
// - A tempo trace: the last three minutes of BPM, bright while detected and
//   grey while manual, with a tick for each onset.
// - A log, while recording: ten rows a second of the tempo, the clock and the
//   audio, with the high-band hits (T30), downloadable as CSV.
// - Nudging (beat-fold.js): the sound kept by time, folded at a tempo and bar
//   line of one's own instead of the clock's, history and all, until the
//   pattern stands still; then it can be handed to the clock.

import { BeatGraph } from './beat-graph.js';
import { FoldedHistory, SoundTrace } from './beat-fold.js';
import { BPM_RANGE } from './tempo.js';

// How often the folded picture is drawn again while nudging, in seconds.
const FOLD_STEP = 0.1;
// How far behind the present the live input's flux is placed, in seconds, so
// readings that reach the page late (flux-worklet.js sends them every 10 ms)
// are not missed.
const FLUX_DELAY = 0.08;

const TRACE_SECONDS = 180;
const TRACE_STEP = 0.5;
const LOG_STEP = 0.1;
// About an hour of rows at ten a second.
const LOG_LIMIT = 36000;

// Whether a step that was last due at `last` is due again at `seconds`. The
// next is due a step after the last was due, not after the frame that took
// it, so the rate holds at frame rates that do not divide it; a gap of more
// than a step starts afresh. Returns the time it was due, or null.
function due(last, seconds, step) {
  if (seconds - last < step - 1e-6) return null;
  return seconds - last < 2 * step ? last + step : seconds;
}

export const LOG_COLUMNS = ['seconds', 'source', 'bpm', 'detected', 'confidence', 'beat_position',
  'onsets', 'bass', 'mid', 'treble', 'level', 'flux', 'high_hits', 'high_rate', 'air', 'key', 'key_by'];

// Who says the key is what it is, for the log: the detector, the detector
// holding its last, or the operator (chosen, or locked whatever the music says).
export function keySource(key) {
  return !key ? '' : key.chosen || (key.held ? 'held' : 'detector');
}

// One row of the log as CSV text.
export function csvRow(values) {
  return values.map((value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',');
}

export class TempoMonitor {
  // `history` is the bar history the graph shows (beat-graph.js); app.js
  // passes the one the Beat Graph pattern shows too.
  constructor(width = 256, height = 192, history = null) {
    this.graph = new BeatGraph(width, height, history);
    this.width = width;
    this.height = height;
    this.rgb = null;
    // The sound by time, and the graph folded from it while nudging; `nudge`
    // is { bpm, anchor } then (a bar starts at `anchor` seconds), else null.
    this.sound = new SoundTrace();
    this.folded = new FoldedHistory(this.sound, { rows: height, bars: Math.ceil(width / 2) });
    this.foldGraph = new BeatGraph(width, height, this.folded);
    this.nudge = null;
    this.lastFold = -Infinity;
    // The clock's recent positions, [seconds, position], to place the live
    // input's flux readings at their own times (FLUX_DELAY behind).
    this.positions = [];
    this.lastFlux = 0;
    // [seconds, bpm, detected] every TRACE_STEP, and onset times.
    this.trace = [];
    this.onsets = [];
    this.lastTrace = -Infinity;
    this.recording = false;
    this.rows = [];
    this.lastLog = -Infinity;
    this.onsetsSinceRow = 0;
    this.highHitsSinceRow = 0;
    this.started = null;
  }

  // Called every frame. `seconds` is the frame's time; `tempo` the tracker's
  // state; `audio` the analyser; `source` the Beat from setting's id.
  update(seconds, tempo, audio, source) {
    this.started ??= seconds;
    this.positions.push([seconds, tempo.position]);
    while (this.positions.length > 2 && this.positions[1][0] < seconds - 1) this.positions.shift();
    // With a live input the graphs fold its spectral flux (audio.js,
    // flux-worklet.js), each reading at its own time, a moment behind; with
    // the simulated signal, the waveform's loudness, now.
    const at = seconds - FLUX_DELAY;
    const flux = audio.takeFlux?.(at) ?? null;
    if (flux?.length) this.lastFlux = flux[flux.length - 1];
    const frame = flux ? { beatPosition: this.positionAt(at), audioTime: at, hue: 0, spectrum: audio.spectrum,
      wave: audio.wave, flux: flux.length ? flux : Float32Array.of(this.lastFlux), feeder: this }
      : { beatPosition: tempo.position, audioTime: seconds, hue: 0, spectrum: audio.spectrum, wave: audio.wave };
    // While it is fed flux, the history takes frames from here only: the Beat
    // Graph pattern's own frames, at the present, would cross these.
    this.graph.history.feeder = flux ? this : null;
    // The clock's graph goes on building, for the Beat Graph pattern.
    this.rgb = this.graph.renderFrame(frame);
    this.sound.feed(frame);
    if (this.nudge) {
      if (seconds - this.lastFold >= FOLD_STEP) {
        this.lastFold = seconds;
        this.folded.fold(this.nudge.bpm, this.nudge.anchor);
        this.foldGraph.painted = null;
        this.foldRgb = this.foldGraph.draw();
      }
      this.rgb = this.foldRgb ?? this.rgb;
    }
    const onset = audio.features.beat === 1;
    if (onset) {
      this.onsets.push(seconds);
      ++this.onsetsSinceRow;
    }
    while (this.onsets.length && this.onsets[0] < seconds - TRACE_SECONDS) this.onsets.shift();
    this.highHitsSinceRow += audio.features.highHits ?? 0;
    const traceDue = due(this.lastTrace, seconds, TRACE_STEP);
    if (traceDue !== null) {
      this.lastTrace = traceDue;
      this.trace.push([seconds, tempo.bpm, tempo.detected]);
      while (this.trace.length && this.trace[0][0] < seconds - TRACE_SECONDS) this.trace.shift();
    }
    const logDue = this.recording ? due(this.lastLog, seconds, LOG_STEP) : null;
    if (logDue !== null) {
      this.lastLog = logDue;
      const f = audio.features;
      this.rows.push(csvRow([seconds - this.started, source, tempo.bpm, tempo.detected ? 1 : 0, tempo.confidence,
        tempo.position, this.onsetsSinceRow, f.bass, f.mid, f.treble, f.level, audio.flux,
        this.highHitsSinceRow, f.highRate, f.air, audio.key?.camelot.label ?? '', keySource(audio.key)]));
      this.onsetsSinceRow = 0;
      this.highHitsSinceRow = 0;
      if (this.rows.length > LOG_LIMIT) this.rows.shift();
    }
  }

  // The clock's position at `seconds`, between the frames either side.
  positionAt(seconds) {
    const p = this.positions;
    let k = p.length - 1;
    while (k > 0 && p[k - 1][0] >= seconds) --k;
    if (k === 0) return p[0][1];
    const [t0, p0] = p[k - 1], [t1, p1] = p[k];
    return t1 > t0 ? p0 + (p1 - p0) * Math.min(1, Math.max(0, (seconds - t0) / (t1 - t0))) : p1;
  }

  // Starts nudging from the clock as it stands at `seconds`: its tempo, and its
  // bar line, so the picture does not move until a nudge.
  startNudge(seconds, tempo) {
    const bpm = tempo.bpm, beats = ((tempo.position % 4) + 4) % 4;
    this.nudge = { bpm, anchor: seconds - beats * 60 / bpm };
    this.lastFold = -Infinity;
  }

  // The start of the bar that holds `seconds`, at the nudged tempo.
  barStart(seconds) {
    const bar = 4 * 60 / this.nudge.bpm;
    return this.nudge.anchor + Math.floor((seconds - this.nudge.anchor) / bar) * bar;
  }

  // Changes the nudged tempo by `delta` BPM, keeping the bar playing now where
  // it is, so the newest bars stay put and the older ones lean.
  nudgeTempo(delta, seconds) {
    const anchor = this.barStart(seconds);
    const bpm = Math.round(Math.min(BPM_RANGE[1], Math.max(BPM_RANGE[0], this.nudge.bpm + delta)) * 100) / 100;
    this.nudge = { bpm, anchor };
    this.lastFold = -Infinity;
  }

  // Moves the bar line by `beats` (a fraction of a beat, either way).
  nudgePhase(beats) {
    this.nudge = { ...this.nudge, anchor: this.nudge.anchor + beats * 60 / this.nudge.bpm };
    this.lastFold = -Infinity;
  }

  // Back to the clock's own graph.
  followClock() {
    this.nudge = null;
    this.foldRgb = null;
  }

  // Onsets in the last `window` seconds, per minute.
  onsetsPerMinute(seconds, window = 10) {
    return this.onsets.filter((t) => t > seconds - window).length * 60 / window;
  }

  setRecording(on) {
    this.recording = on;
    if (on) this.onsetsSinceRow = this.highHitsSinceRow = 0;
  }

  clearLog() {
    this.rows = [];
  }

  csv() {
    return [LOG_COLUMNS.join(','), ...this.rows].join('\n') + '\n';
  }

  // Paints the Beat Graph into a canvas of the graph's size.
  drawGraph(canvas) {
    if (!this.rgb) return;
    const context = canvas.getContext('2d');
    const image = context.createImageData(this.width, this.height);
    for (let i = 0, j = 0; i < this.rgb.length; i += 3, j += 4) {
      image.data[j] = this.rgb[i];
      image.data[j + 1] = this.rgb[i + 1];
      image.data[j + 2] = this.rgb[i + 2];
      image.data[j + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }

  // Paints the tempo trace: BPM against time over the last three minutes,
  // on a scale that follows the tempos shown, with onsets as ticks below.
  drawTrace(canvas, seconds) {
    const context = canvas.getContext('2d');
    const { width, height } = canvas;
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    const plot = height - 12;
    const bpms = this.trace.map(([, bpm]) => bpm).filter(Number.isFinite);
    if (!bpms.length) return;
    const low = Math.floor(Math.min(...bpms) / 10) * 10 - 5;
    const high = Math.ceil(Math.max(...bpms) / 10) * 10 + 5;
    const x = (t) => width - (seconds - t) / TRACE_SECONDS * width;
    const y = (bpm) => plot - (bpm - low) / (high - low) * (plot - 4) - 2;
    context.font = '10px system-ui, sans-serif';
    context.fillStyle = '#556';
    for (let bpm = Math.ceil(low / 10) * 10; bpm <= high; bpm += 10) {
      context.fillRect(0, Math.round(y(bpm)), width, 1);
      context.fillText(String(bpm), 2, y(bpm) - 2);
    }
    for (let i = 1; i < this.trace.length; ++i) {
      const [t0, b0] = this.trace[i - 1], [t1, b1, detected] = this.trace[i];
      context.strokeStyle = detected ? '#5ad1ff' : '#666';
      context.lineWidth = detected ? 2 : 1;
      context.beginPath();
      context.moveTo(x(t0), y(b0));
      context.lineTo(x(t1), y(b1));
      context.stroke();
    }
    context.fillStyle = '#ffd25a';
    for (const t of this.onsets) context.fillRect(Math.round(x(t)), height - 8, 1, 6);
  }
}
