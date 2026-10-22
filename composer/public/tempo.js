// Tempo tracking. Beat onsets from the audio analyser give an estimate of
// the tempo, and a beat position that runs at that tempo and is nudged into
// step with the onsets. Everything that moves "on the beat" reads the
// position, so it keeps going smoothly between onsets and through gaps.

export const BPM_RANGE = [40, 240];
export const TEMPO_DEFAULTS = { mode: 'auto', source: 'bass', manualBpm: 120, quantize: 'off', tap: 'beat' };
// Where detected beats come from (see updateBeat in audio.js): the menu's
// name, a short label for the readout, and the tag the info overlay shows
// while that source is in charge.
export const BEAT_SOURCES = [
  { id: 'bass', name: 'Bass jumps (the original detector)', label: 'bass jumps', tag: 'BAS' },
  { id: 'flux', name: 'Spectral flux, timed within the frame', label: 'spectral flux', tag: 'FLX' },
  { id: 'essentia', name: 'Essentia (loads 2.8 MB; first tempo after 10 s of audio)', label: 'Essentia', tag: 'ESS' },
];
export const TEMPO_MODES = [
  { id: 'auto', name: 'Detect from the audio (manual tempo until locked)' },
  { id: 'manual', name: 'Always use the manual tempo' },
];
export const QUANTIZE = [
  { id: 'off', name: 'Change at any time' },
  { id: 'beat', name: 'Wait for the next beat' },
  { id: 'bar', name: 'Wait for the next bar (4 beats)' },
  { id: 'phrase4', name: 'Wait for the next 4 bars (16 beats)' },
  { id: 'phrase8', name: 'Wait for the next 8 bars (32 beats)' },
  { id: 'change', name: 'Wait for a change in the music' },
];
export const BEATS_PER_BAR = 4;
// What one tap of the tap tempo stands for.
export const TAP_UNITS = [
  { id: 'beat', name: 'A beat', beats: 1 },
  { id: 'bar', name: 'A bar (4 beats)', beats: BEATS_PER_BAR },
];

// Section changes. Dance music adds or removes parts on phrase boundaries,
// so each beat's average energy in the bass, mids and treble is compared
// with the beats before it; a large enough shift, far enough from the last
// one, counts as a change. Working a beat at a time means a change is
// noticed within one beat of happening.
const CHANGE_THRESHOLD = 0.3;
const MIN_BEATS_BETWEEN_CHANGES = 16;
// With nothing detected for this long a change is declared anyway, so
// things waiting for one are not held for ever.
const MAX_BEATS_BETWEEN_CHANGES = 128;
const BANDS = ['bass', 'mid', 'treble'];

// A position that runs forwards for `phraseBeats`, back for the next
// `phraseBeats`, and so on: a clock for movement that reverses every phrase.
export function reversingPosition(position, phraseBeats) {
  const phrase = Math.floor(position / phraseBeats), into = position - phrase * phraseBeats;
  return phrase % 2 === 0 ? into : phraseBeats - into;
}

export function tempoSettings(value = TEMPO_DEFAULTS) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Tempo settings must be an options object.');
  const result = { ...TEMPO_DEFAULTS, ...value };
  if (!TEMPO_MODES.some(mode => mode.id === result.mode)) throw new Error(`Unknown tempo mode: ${result.mode}`);
  if (!BEAT_SOURCES.some(source => source.id === result.source)) throw new Error(`Unknown beat source: ${result.source}`);
  if (!QUANTIZE.some(choice => choice.id === result.quantize)) throw new Error(`Unknown tempo quantize: ${result.quantize}`);
  if (!Number.isFinite(result.manualBpm) || result.manualBpm < BPM_RANGE[0] || result.manualBpm > BPM_RANGE[1])
    throw new Error(`Manual tempo must be between ${BPM_RANGE[0]} and ${BPM_RANGE[1]} BPM.`);
  if (!TAP_UNITS.some(unit => unit.id === result.tap)) throw new Error(`Unknown tap unit: ${result.tap}`);
  return { mode: result.mode, source: result.source, manualBpm: result.manualBpm, quantize: result.quantize, tap: result.tap };
}

// Tap tempo: the tempo a run of taps is beating out. A tap stands for one
// beat or for a whole bar; taps too far apart to be the same run start a
// new one.
const TAP_HISTORY = 8;
const TAP_RESET_SECONDS_PER_BEAT = 2;

export class TapTempo {
  constructor() {
    this.taps = [];
    this.beatsPerTap = 1;
  }

  // Records a tap at `seconds` and returns the tempo in whole BPM, or null
  // until the run has two taps.
  tap(seconds, beatsPerTap = 1) {
    const last = this.taps[this.taps.length - 1];
    if (beatsPerTap !== this.beatsPerTap || (last !== undefined &&
        (seconds <= last || seconds - last > TAP_RESET_SECONDS_PER_BEAT * beatsPerTap)))
      this.taps = [];
    this.beatsPerTap = beatsPerTap;
    this.taps.push(seconds);
    if (this.taps.length > TAP_HISTORY) this.taps.shift();
    if (this.taps.length < 2) return null;
    const bpm = 60 * beatsPerTap * (this.taps.length - 1) / (seconds - this.taps[0]);
    return Math.round(Math.min(BPM_RANGE[1], Math.max(BPM_RANGE[0], bpm)));
  }
}

// Tempi are folded into this range, so a detector that fires on every other
// beat, or twice per beat, still gives a usable tempo.
const FOLD = [70, 180];
const HISTORY = 24;
const TOLERANCE = 0.05;
const LOST_AFTER_SECONDS = 5;
// Estimates from a source that gives the tempo directly (live Essentia,
// every 2 s over the last 10 s) once moved the clock with every one, so a
// change of texture made it jump (measured in docs/findings.md, "Tempo
// through whole tracks"). Now, once locked, an
// estimate within ESTIMATE_TOLERANCE of the tempo, or of double or half it,
// agrees and only eases it; one that disagrees changes the tempo only when
// ESTIMATES_TO_CHANGE in a row agree with each other. Estimates are folded
// into FOLD, as onset intervals are, so a first lock or a breakdown at half
// tempo is not then held there by the estimates at the true tempo agreeing
// with it at double.
export const ESTIMATES_TO_CHANGE = 3;
const ESTIMATE_TOLERANCE = 0.04;
// The ratios at which one tempo agrees with another: the same, double or
// half; and, where 3:2 readings count as agreeing too (`threeTwoAgrees`),
// 2/3 and 3/2, which trap's triplet hats and half-time feel give
// (docs/findings.md, "Tempo through whole tracks").
const OCTAVES = [1, 2, 0.5];
const WITH_THREE_TWO = [...OCTAVES, 2 / 3, 3 / 2];
// The ratio of `bpm` to `of` among `ratios`, within the tolerance, or null.
const octaveRatio = (bpm, of, ratios = OCTAVES) =>
  ratios.find((ratio) => Math.abs(bpm / (of * ratio) - 1) <= ESTIMATE_TOLERANCE) ?? null;

export class TempoTracker {
  constructor() {
    this.estimatesToChange = ESTIMATES_TO_CHANGE;
    // Whether an estimate at 2/3 or 3/2 of the tempo agrees with it.
    this.threeTwoAgrees = false;
    this.reset();
  }

  reset() {
    this.candidate = null;
    this.candidateCount = 0;
    this.intervals = [];
    this.lastBeat = null;
    this.lastUpdate = null;
    this.detectedBpm = null;
    this.confidence = 0;
    this.position = 0;
    this.pending = 0;
    this.tapPending = 0;
    // Whole beats to move the bar line by, from a downbeat the operator marked
    // (markDownbeat), taken in over the next frames as the phase is.
    this.barPending = 0;
    this.detected = false;
    this.newBeat = false;
    this.newBar = false;
    this.bpm = TEMPO_DEFAULTS.manualBpm;
    // Section-change detection.
    this.beatSums = [0, 0, 0];
    this.beatFrames = 0;
    this.reference = null;
    this.beatsSinceChange = 0;
    this.changes = 0;
    this.newChange = false;
    // A beat clock that turns round at every change.
    this.changeClock = 0;
    this.changeDirection = 1;
  }

  // Called as each beat ends: was it different enough from the ones before?
  endBeat() {
    this.beatsSinceChange++;
    let changed = this.beatsSinceChange >= MAX_BEATS_BETWEEN_CHANGES;
    if (this.beatFrames > 0) {
      const beat = this.beatSums.map(sum => sum / this.beatFrames);
      if (this.reference) {
        const total = (values) => values.reduce((sum, value) => sum + value, 0);
        const shift = total(beat.map((value, i) => Math.abs(value - this.reference[i])));
        const scale = Math.max(0.05, total(this.reference), total(beat));
        if (shift / scale > CHANGE_THRESHOLD && this.beatsSinceChange >= MIN_BEATS_BETWEEN_CHANGES) changed = true;
      }
      // After a change the new section is the thing to compare against;
      // otherwise the reference follows the music slowly.
      this.reference = changed || !this.reference ? beat :
        this.reference.map((value, i) => value * 0.85 + beat[i] * 0.15);
    }
    this.beatSums = [0, 0, 0];
    this.beatFrames = 0;
    if (changed) {
      this.changes++;
      this.beatsSinceChange = 0;
      this.changeDirection = -this.changeDirection;
    }
    return changed;
  }

  get locked() {
    return this.detectedBpm !== null;
  }

  // Records a beat onset at `seconds`. Every onset counts towards the tempo;
  // with `pullPhase` false it does not pull the position towards it, for
  // onsets that may fall between beats, such as hi-hats.
  onBeat(seconds, pullPhase = true) {
    if (this.lastBeat !== null) {
      const interval = seconds - this.lastBeat;
      if (interval > 0.2 && interval < 2.5) {
        let bpm = 60 / interval;
        while (bpm < FOLD[0]) bpm *= 2;
        while (bpm > FOLD[1]) bpm /= 2;
        this.intervals.push(bpm);
        if (this.intervals.length > HISTORY) this.intervals.shift();
        this.estimate();
      }
    }
    this.lastBeat = seconds;
    // Ask for the position to be pulled towards the nearest whole beat.
    if (this.locked && pullPhase) this.pending = Math.round(this.position) - this.position;
  }

  // An estimate from a source that gives the tempo directly (Essentia):
  // `bpm` heard over a window ending at `seconds`, with a beat `lastBeat`
  // seconds before that end (null if none), and a confidence from 0 to 1. It
  // replaces the onset intervals, keeps the lock alive as an onset does, and
  // pulls the position towards that beat. The first estimate locks the tempo;
  // after that it eases or holds, as ESTIMATES_TO_CHANGE says. `support`, a
  // tempo from elsewhere (spectral flux, with AudioAnalyzer.fluxVeto), can
  // stop a change: one goes ahead only if the support agrees with the new
  // tempo or no longer agrees with the old.
  setEstimate(seconds, bpm, lastBeat, confidence, support = null) {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    let folded = bpm;
    while (folded < FOLD[0]) folded *= 2;
    while (folded > FOLD[1]) folded /= 2;
    const heard = Math.min(BPM_RANGE[1], Math.max(BPM_RANGE[0], folded));
    const agreeing = this.threeTwoAgrees ? WITH_THREE_TWO : OCTAVES;
    const ratio = this.detectedBpm === null ? null : octaveRatio(heard, this.detectedBpm, agreeing);
    if (this.detectedBpm === null) {
      this.detectedBpm = heard;
      this.candidate = null;
    } else if (ratio !== null) {
      // Agrees, in this octave or another: follow it smoothly, keep the octave.
      this.detectedBpm = this.detectedBpm * 0.7 + (heard / ratio) * 0.3;
      this.candidate = null;
    } else {
      // A different tempo: only once enough estimates in a row agree on it.
      if (this.candidate !== null && octaveRatio(heard, this.candidate) !== null) this.candidateCount += 1;
      else this.candidateCount = 1;
      this.candidate = heard;
      const vetoed = Number.isFinite(support) && octaveRatio(heard, support) === null &&
        octaveRatio(this.detectedBpm, support) !== null;
      if (this.candidateCount >= this.estimatesToChange && !vetoed) {
        this.detectedBpm = heard;
        this.candidate = null;
      }
    }
    this.confidence = Math.max(0, Math.min(1, confidence));
    this.intervals = [];
    this.lastBeat = seconds;
    if (Number.isFinite(lastBeat) && this.lastUpdate !== null) {
      // The position at the time of that beat, at the clock's present tempo.
      const position = this.position - (this.lastUpdate - (seconds - lastBeat)) * this.bpm / 60;
      this.pending = Math.round(position) - position;
    }
  }

  // Pulls the position towards the nearest whole beat, as an onset does,
  // without counting towards the tempo: for onsets heard while the tempo comes
  // from elsewhere (Essentia).
  alignTo() {
    if (this.locked) this.pending = Math.round(this.position) - this.position;
  }

  // A tempo and bar line from the operator (the Monitor's nudge, "Send to the
  // tracker"; Anjin, 2026-10-20: nudge "and send that info to the beat
  // tracker vs taking over as the beat tracker"): taken as the detected
  // tempo, so the tracker carries on following the music from there. The
  // hold keeps it until estimates agree on another (ESTIMATES_TO_CHANGE);
  // the onset intervals are filled with it, so onsets move it only once most
  // of the recent ones disagree; and the position is pulled, over the next
  // frames, so a bar starts at `barStart` (seconds).
  hint(seconds, bpm, barStart) {
    let folded = bpm;
    while (folded < FOLD[0]) folded *= 2;
    while (folded > FOLD[1]) folded /= 2;
    // Where the clock will be at `barStart`, at its present tempo.
    const since = this.lastUpdate === null ? 0 : barStart - this.lastUpdate;
    const position = this.position + since * this.bpm / 60;
    this.detectedBpm = folded;
    this.confidence = 1;
    this.candidate = null;
    this.candidateCount = 0;
    this.intervals = Array(HISTORY).fill(folded);
    this.lastBeat = seconds;
    this.pending = Math.round(position / BEATS_PER_BAR) * BEATS_PER_BAR - position;
    this.barPending = 0;
  }

  // The operator marks a downbeat at `seconds`: the first beat of a bar (
  // Anjin, 2026-10-20: "should also be able to tag downbeats... that helps
  // identify bars"). While a tempo is detected, only which beat is the first
  // moves, by whole beats (from two back to one on), so the beats' timing
  // stays the tracker's and a press a little early or late does not move
  // it; on the manual tempo the press sets the bar line, as a tap marking a
  // bar does.
  markDownbeat(seconds) {
    if (!this.detected) {
      this.tap(seconds, BEATS_PER_BAR);
      return;
    }
    const since = this.lastUpdate === null ? 0 : seconds - this.lastUpdate;
    const beat = Math.round(this.position + this.barPending + since * this.bpm / 60);
    let shift = -(((beat % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR);
    if (shift < -2) shift += BEATS_PER_BAR;
    this.barPending += shift;
  }

  // A tap from the user at `seconds` marks a beat, or the first beat of a
  // bar: asks for the position to be pulled towards the nearest one. It acts
  // while the manual tempo is in charge, when there are no onsets to follow.
  tap(seconds, beatsPerTap = 1) {
    const since = this.lastUpdate === null ? 0 : Math.max(0, seconds - this.lastUpdate);
    const position = this.position + since * this.bpm / 60;
    this.tapPending = Math.round(position / beatsPerTap) * beatsPerTap - position;
  }

  // The tempo most of the recent intervals agree on.
  estimate() {
    const values = this.intervals;
    if (values.length < 4) return;
    let best = [];
    for (const candidate of values) {
      const agree = values.filter(value => Math.abs(value - candidate) <= candidate * TOLERANCE);
      if (agree.length > best.length) best = agree;
    }
    this.confidence = best.length / values.length;
    if (best.length < 4 || this.confidence < 0.5) return;
    const bpm = best.reduce((sum, value) => sum + value, 0) / best.length;
    // Follow small drifts smoothly; jump for a real change of tempo.
    this.detectedBpm = this.detectedBpm !== null && Math.abs(bpm - this.detectedBpm) < this.detectedBpm * 0.08 ?
      this.detectedBpm * 0.7 + bpm * 0.3 : bpm;
  }

  // Advances the beat position to `seconds`. `settings` chooses between the
  // detected and the manual tempo, and `features` is the analyser's current
  // { bass, mid, treble } for change detection. Returns the state for this
  // frame.
  update(seconds, settings = TEMPO_DEFAULTS, features = null) {
    const dt = this.lastUpdate === null ? 0 : Math.min(0.5, Math.max(0, seconds - this.lastUpdate));
    this.lastUpdate = seconds;
    if (this.lastBeat !== null && seconds - this.lastBeat > LOST_AFTER_SECONDS) {
      // No onsets for a while: the music stopped or lost its beat.
      this.detectedBpm = null;
      this.candidate = null;
      this.confidence = 0;
      this.intervals = [];
      this.pending = 0;
    }
    const detected = settings.mode === 'auto' && this.locked;
    this.bpm = detected ? this.detectedBpm : settings.manualBpm;
    const advance = dt * this.bpm / 60;
    // Close the gap to the onsets, or to the user's taps while the manual
    // tempo is in charge, gradually and never running backwards.
    const gap = detected ? 'pending' : 'tapPending';
    const correction = Math.max(-advance * 0.5, Math.min(advance * 0.5, this[gap]));
    this[gap] -= correction;
    if (detected) this.tapPending = 0;
    // A marked downbeat moves the bar line at the same pace.
    const barCorrection = detected ? Math.max(-advance * 0.5, Math.min(advance * 0.5, this.barPending)) : 0;
    this.barPending = detected ? this.barPending - barCorrection : 0;
    this.detected = detected;
    const before = this.position;
    this.position += advance + correction + barCorrection;
    this.newBeat = Math.floor(this.position) !== Math.floor(before);
    this.newBar = Math.floor(this.position / BEATS_PER_BAR) !== Math.floor(before / BEATS_PER_BAR);
    this.changeClock += (advance + correction + barCorrection) * this.changeDirection;
    if (features) {
      BANDS.forEach((band, i) => { this.beatSums[i] += features[band] ?? 0; });
      this.beatFrames++;
    }
    this.newChange = this.newBeat && this.endBeat();
    return this.state(detected);
  }

  state(detected = this.locked) {
    return {
      bpm: this.bpm, detected, confidence: this.confidence, position: this.position,
      phase: this.position - Math.floor(this.position),
      beatInBar: Math.floor(this.position) % BEATS_PER_BAR,
      newBeat: this.newBeat, newBar: this.newBar,
      // Bars are counted from wherever the tracker started.
      bar: Math.floor(this.position / BEATS_PER_BAR),
      newChange: this.newChange, changes: this.changes,
      barsSinceChange: Math.floor(this.beatsSinceChange / BEATS_PER_BAR),
      changeClock: this.changeClock,
    };
  }
}

// Whether a change that has come due may happen on this frame.
export function changeAllowed(quantize, tempo) {
  if (quantize === 'beat') return tempo.newBeat;
  if (quantize === 'bar') return tempo.newBar;
  if (quantize === 'phrase4') return tempo.newBar && tempo.bar % 4 === 0;
  if (quantize === 'phrase8') return tempo.newBar && tempo.bar % 8 === 0;
  if (quantize === 'change') return tempo.newChange;
  return true;
}
