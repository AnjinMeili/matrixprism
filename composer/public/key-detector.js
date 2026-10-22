const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PROFILES = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

export function camelotKey(tonic, mode) {
  if (!Number.isInteger(tonic) || tonic < 0 || tonic > 11 || !['major', 'minor'].includes(mode))
    throw new Error('Camelot key needs a tonic from 0 to 11 and major or minor mode');
  const letter = mode === 'minor' ? 'A' : 'B';
  const number = ((tonic * 7 + (mode === 'minor' ? 4 : 7)) % 12) + 1;
  return { number, letter, label: `${number}${letter}`, hue: (number - 1) / 12 };
}

// The key at a Camelot number and letter (A minor, B major): camelotKey's
// inverse, for the Monitor's wheel.
export function keyAtCamelot(number, letter) {
  const minor = letter === 'A';
  const tonic = ((number - 1 - (minor ? 4 : 7) + 12) * 7) % 12;
  return { tonic, mode: minor ? 'minor' : 'major', name: `${NOTES[tonic]} ${minor ? 'minor' : 'major'}` };
}

// How long the music must clearly say another key before it replaces one the
// operator chose (a key the detector found itself needs one second).
export const CHOSEN_KEY_SECONDS = 8;

export function compatibleCamelotKeys({ number, letter }) {
  return [`${(number + 10) % 12 + 1}${letter}`, `${number % 12 + 1}${letter}`,
    `${number}${letter === 'A' ? 'B' : 'A'}`];
}

function centered(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const result = values.map(value => value - mean);
  const length = Math.hypot(...result);
  return result.map(value => length ? value / length : 0);
}

const TEMPLATES = Object.entries(PROFILES).flatMap(([mode, profile]) =>
  NOTES.map((note, tonic) => ({
    tonic, mode, name: `${note} ${mode}`,
    profile: centered(Array.from({ length: 12 }, (_, i) => profile[(i - tonic + 12) % 12])),
    camelot: camelotKey(tonic, mode),
    hue: camelotKey(tonic, mode).hue,
  })));

// Twelve pitch-class levels from a decibel spectrum: its peaks between 90 Hz
// and 2.1 kHz within 28 dB of the loudest, interpolated and summed by
// semitone, weighted by how close each is to being in tune.
export function spectrumChroma(decibels, sampleRate, fftSize) {
  const chroma = new Float64Array(12);
  let peak = -Infinity;
  for (const value of decibels)
    if (Number.isFinite(value)) peak = Math.max(peak, value);
  const threshold = Math.max(-70, peak - 28);
  const binHz = sampleRate / fftSize;
  for (let i = 2; i < decibels.length - 1; ++i) {
    const level = decibels[i];
    if (!Number.isFinite(level) || level < threshold ||
        level <= decibels[i - 1] || level < decibels[i + 1])
      continue;
    const frequency = i * binHz;
    if (frequency < 90 || frequency > 2100)
      continue;
    // Interpolate spectral peaks before assigning them to semitone classes.
    const left = decibels[i - 1], right = decibels[i + 1];
    const denominator = left - 2 * level + right;
    const offset = Number.isFinite(denominator) && denominator !== 0 ?
      Math.max(-0.5, Math.min(0.5, (left - right) / (2 * denominator))) : 0;
    const midi = 69 + 12 * Math.log2((i + offset) * binHz / 440);
    const nearest = Math.round(midi);
    const tuningWeight = Math.max(0, 1 - Math.abs(midi - nearest) / 0.5);
    chroma[((nearest % 12) + 12) % 12] +=
      10 ** ((level - peak) / 20) * tuningWeight;
  }
  return chroma;
}

export class KeyDetector {
  constructor() {
    this.reset();
  }

  reset() {
    this.clearEvidence();
    this.found = null;
    this.result = null;
  }

  // Forgets what has been heard, but not the last key that was found.
  clearEvidence() {
    this.chroma = new Float64Array(12);
    // How well each of the 24 keys fits what has been heard, by Camelot label
    // (the Monitor's wheel shows them); null until there is evidence.
    this.scores = null;
    this.evidenceSeconds = 0;
    this.silentSeconds = 0;
    this.candidate = null;
    this.candidateSeconds = 0;
  }

  // The last key found stands until another is found: through uncertainty and
  // silence it is still the result, marked as held and with no confidence. A
  // key the operator chose is not held: it is their call until replaced.
  heldKey() {
    if (this.found?.chosen) return this.found;
    return this.found ? { ...this.found, confidence: 0, held: true } : null;
  }

  // The operator's opinion of the key (the Monitor's wheel): it is the result
  // at once, and stands until the music clearly says another key for
  // CHOSEN_KEY_SECONDS, or, if `lock`, until the operator lets it go.
  choose(tonic, mode, lock = false) {
    const camelot = camelotKey(tonic, mode);
    this.found = { tonic, mode, name: `${NOTES[tonic]} ${mode}`, hue: camelot.hue, camelot,
      confidence: 1, held: false, chosen: lock ? 'locked' : 'chosen' };
    this.result = this.found;
    this.candidate = null;
    this.candidateSeconds = 0;
    return this.result;
  }

  // Lets the detector decide again: a chosen key is forgotten.
  release() {
    if (this.found?.chosen) {
      this.found = null;
      this.result = null;
    }
    return this.result;
  }

  update(decibels, sampleRate, fftSize, dt) {
    if (!(decibels instanceof Float32Array) || decibels.length !== fftSize / 2 ||
        !Number.isFinite(sampleRate) || sampleRate <= 0 ||
        !Number.isFinite(dt) || dt <= 0)
      throw new Error('Key detector needs a valid FFT spectrum, sample rate, and positive elapsed time');
    return this.addChroma(spectrumChroma(decibels, sampleRate, fftSize), dt);
  }

  // Adds `dt` seconds of twelve pitch-class levels, from spectrumChroma or
  // another source (the audio comparison, T26, tries Meyda's), and returns
  // the result. Any scale will do; all zero is silence.
  addChroma(chroma, dt) {
    if (chroma.length !== 12 || !Number.isFinite(dt) || dt <= 0)
      throw new Error('Key detector needs twelve chroma values and positive elapsed time');
    const total = chroma.reduce((sum, value) => sum + value, 0);
    const decay = Math.exp(-dt / 6);
    for (let i = 0; i < 12; ++i)
      this.chroma[i] = this.chroma[i] * decay + (total ? chroma[i] / total : 0) * (1 - decay);
    if (!total) {
      this.silentSeconds += dt;
      if (this.silentSeconds >= 2) {
        this.clearEvidence();
        this.result = this.heldKey();
      }
      return this.result;
    }
    this.silentSeconds = 0;
    this.evidenceSeconds += dt;
    const maximum = Math.max(...this.chroma);
    const classes = this.chroma.filter(value => value > maximum * 0.15).length;
    const observed = centered([...this.chroma]);
    const scores = TEMPLATES.map(template => ({
      ...template,
      score: template.profile.reduce((sum, value, i) => sum + value * observed[i], 0),
    })).sort((a, b) => b.score - a.score);
    this.scores = Object.fromEntries(scores.map((s) => [s.camelot.label, s.score]));
    const best = scores[0];
    const margin = best.score - scores[1].score;
    if (this.evidenceSeconds < 3 || classes < 4 || best.score < 0.6 || margin < 0.04) {
      this.candidate = null;
      this.candidateSeconds = 0;
      this.result = this.heldKey();
      return this.result;
    }
    if (this.candidate === best.name)
      this.candidateSeconds += dt;
    else {
      this.candidate = best.name;
      this.candidateSeconds = dt;
    }
    const chosen = this.found?.chosen;
    if (chosen && (chosen === 'locked' || best.name === this.found.name)) {
      // The operator's key stands; the music agreeing does not change it.
      this.result = this.found;
    } else if (this.candidateSeconds >= (chosen ? CHOSEN_KEY_SECONDS : 1)) {
      this.found = {
        tonic: best.tonic, mode: best.mode, name: best.name, hue: best.hue,
        camelot: best.camelot,
        confidence: Math.min(1, margin / 0.2) * Math.max(0, best.score),
        held: false,
      };
      this.result = this.found;
    } else if (this.result?.name !== best.name) {
      // Another key is being heard but has not lasted long enough to count.
      this.result = this.heldKey();
    }
    return this.result;
  }
}

// The key to show and to colour by. With `keepLast` off, a key that is only
// being held counts as no key, as it did before keys were held.
export function shownKey(result, keepLast) {
  return result && (keepLast || !result.held) ? result : null;
}

export function keyColourHue(manualHue, enabled, result, previousOffset, dt) {
  const target = enabled && result ? result.hue : 0;
  const difference = ((target - previousOffset + 1.5) % 1) - 0.5;
  const offset = (previousOffset + difference * (1 - Math.exp(-dt / 1.5)) + 1) % 1;
  return { offset, hue: (manualHue + offset) % 1 };
}
