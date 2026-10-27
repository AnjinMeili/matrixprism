// Spectrum Flock (T62): a flock in which every bird listens to one frequency.
//
// Each bird is given a pitch, spread evenly by octave from 40 Hz to 16 kHz,
// and a colour from red (low) to violet (high). Its amplitude, read from the
// spectrum by frequency (spectrum-bands.js) against that pitch's own recent
// range, so a bird in the quiet highs moves as much as one in the bass,
// sets how fast it flies, how big and bright it is. Birds flock by the usual
// three rules, cohesion, alignment and separation, but only with neighbours
// near in pitch (Kinship, in octaves): the flock sorts itself into groups by
// register, and a group swoops when its register sounds. A beat startles the
// whole flock. The panel wraps at its edges. Trails are the fading picture.
//
// Mode chooses what the members do with what they hear (all read the same
// array of the spectrum by frequency):
// - Flock: as above.
// - Springs: a row of masses on springs, in order of pitch; each is pushed
//   up by its frequency's sound and swings back, trailing a stem to the rest line.
// - Gather: the whole swarm is drawn to where the energy is: a point whose
//   place across the panel is the loudness-weighted mean pitch and whose
//   height follows how many frequencies sound; louder members are drawn harder
//   and orbit it, quiet ones drift.
// - Cymatics (id plate): a Chladni plate. Each member drives one vibration mode of a square
//   plate, by its frequency's sound; grains of sand skip about where the plate
//   shakes and settle on the nodal lines where it does not, so the music draws
//   the figures.
//
// The simulation steps at a fixed rate on the pattern clock (state.auroraTime,
// which Speed scales), and catches up at most a few steps after a stall. It is
// a demonstration of the spectrum as an array by frequency, which any pattern
// can read.

import { VARIATION_PARAM } from './seed.js';
import { RelativeBands, bandAt, logFrequencies } from './spectrum-bands.js';

const STEP_SECONDS = 1 / 40;
const MAX_STEPS = 4;
const LOW_HZ = 40, HIGH_HZ = 16000;
// Grains of sand on the Plate.
const GRAINS = 600;
// How many members drive the Plate at once.
const PLATE_MODES = 3;

export const SPECTRUM_FLOCK_PARAMS = [
  { id: 'mode', name: 'Mode', type: 'choice', default: 'flock',
    choices: [{ id: 'flock', name: 'Flock' }, { id: 'springs', name: 'Springs' },
      { id: 'gather', name: 'Gather' }, { id: 'plate', name: 'Cymatics' }],
    help: 'What the members do with what they hear: flock, swing on springs, gather where the energy is, or shake sand into cymatic figures on a Chladni plate' },
  { id: 'birds', name: 'Birds', min: 8, max: 128, step: 1, default: 48,
    help: 'How many members (birds, masses or modes); each listens to its own frequency, spread evenly from bass to treble' },
  { id: 'kinship', name: 'Kinship', min: 0.25, max: 4, step: 0.05, default: 1,
    help: 'Flock: how near in pitch (octaves) birds must be to flock together: low makes groups by register, high one flock' },
  { id: 'size', name: 'Size', min: 0.4, max: 4, step: 0.05, default: 1,
    help: 'How big each member is (and each grain of sand); it still swells with the sound at its frequency' },
  { id: 'swell', name: 'Size by sound', min: 0, max: 1, step: 0.05, default: 1,
    help: 'How much each member swells with the energy at its frequency: 0 keeps every one the same size, 1 swells it fully (sand grains swell where the plate shakes them)' },
  { id: 'trail', name: 'Trails', min: 0, max: 0.95, step: 0.01, default: 0.7,
    help: 'How long each member\'s trail lingers' },
  { id: 'music', name: 'Music', min: 0, max: 1, step: 0.05, default: 0.8,
    help: 'How much each frequency\'s sound drives its bird\'s speed, size and brightness' },
];

// Hue 0 to 1 to RGB 0 to 1.
function rgb(hue) {
  const channel = (n) => Math.min(1, Math.max(0, Math.abs(((hue * 6 + n) % 6) - 3) - 1));
  return [channel(0), channel(4), channel(2)];
}

export class SpectrumFlock {
  constructor(width, height, random = Math.random) {
    this.width = width;
    this.height = height;
    this.random = random;
    this.scale = Math.max(1, Math.min(width, height) / 32);
    this.out = new Uint8Array(width * height * 3);
    this.trail = new Float32Array(width * height * 3);
    this.birds = [];
    this.relative = null;
    this.time = null;
    this.carry = 0;
    this.lastBeat = 0;
    this.startle = 0;
    this.amplitude = [];
    this.grains = [];
    this.mode = 'flock';
    this.setCount(SPECTRUM_FLOCK_PARAMS.find((param) => param.id === 'birds').default);
  }

  // Birds are kept in order of pitch, so changing the count re-spreads them.
  setCount(count) {
    const hz = logFrequencies(count, LOW_HZ, HIGH_HZ);
    this.birds = hz.map((frequency, i) => {
      const old = this.birds[Math.round(i * (this.birds.length - 1) / Math.max(1, count - 1))];
      const angle = this.random() * Math.PI * 2;
      return {
        frequency, colour: rgb(i / count * 0.8),
        x: old?.x ?? this.random() * this.width, y: old?.y ?? this.random() * this.height,
        vx: old?.vx ?? Math.cos(angle), vy: old?.vy ?? Math.sin(angle), level: 0,
        offset: 0, swing: 0,
        // The plate mode this member drives: (n, m) half-waves, never equal.
        modeN: 1 + Math.floor(i / Math.max(1, count - 1) * 4.999),
        modeM: 1 + (Math.floor(i * 3 / Math.max(1, count - 1) * 5) % 5) + (i % 2),
      };
    });
    this.relative = new RelativeBands(count);
    this.amplitude = new Float32Array(count);
  }

  renderFrame(state, params = {}) {
    const p = { ...Object.fromEntries(SPECTRUM_FLOCK_PARAMS.map((param) => [param.id, param.default])), ...params };
    if (Math.round(p.birds) !== this.birds.length) this.setCount(Math.round(p.birds));
    const time = state.auroraTime ?? state.time ?? 0;
    if (this.time === null || time < this.time) {
      this.time = time;
      this.carry = 0;
    }
    const elapsed = time - this.time;
    if (p.mode !== this.mode) this.enter(p.mode);
    this.carry = Math.min(this.carry + elapsed, STEP_SECONDS * MAX_STEPS);
    this.time = time;
    // What each bird hears: its frequency's amplitude, and that against its
    // own recent range.
    const input = state.spectrumInput;
    this.birds.forEach((bird, i) => { this.amplitude[i] = bandAt(input, bird.frequency, 1 / 3); });
    const relative = this.relative.update(this.amplitude, elapsed > 0 ? elapsed : STEP_SECONDS);
    this.birds.forEach((bird, i) => { bird.level += (relative[i] - bird.level) * 0.5; });
    const beat = state.audio?.beat ?? 0;
    if (beat > 0.8 && this.lastBeat <= 0.8) this.startle = 1;
    this.lastBeat = beat;
    while (this.carry >= STEP_SECONDS) {
      this.carry -= STEP_SECONDS;
      this.step(p);
    }
    return this.draw(p);
  }

  // The shortest way from a to b on a panel that wraps, in x or y.
  wrap(d, size) {
    return d > size / 2 ? d - size : d < -size / 2 ? d + size : d;
  }

  stepFlock(p) {
    const { width: w, height: h, birds, scale } = this;
    const radius = Math.max(w, h) * 0.22, separate = 5 * scale;
    const sigma = p.kinship;
    this.startle *= 0.9;
    for (const bird of birds) {
      let cx = 0, cy = 0, ax = 0, ay = 0, sx = 0, sy = 0, weight = 0;
      for (const other of birds) {
        if (other === bird) continue;
        const dx = this.wrap(other.x - bird.x, w), dy = this.wrap(other.y - bird.y, h);
        const distance = Math.hypot(dx, dy);
        const octaves = Math.log2(other.frequency / bird.frequency);
        // Separation applies to all; the other two rules to near pitches.
        if (distance < separate && distance > 0) {
          sx -= dx / distance * (separate - distance);
          sy -= dy / distance * (separate - distance);
        }
        if (distance > radius) continue;
        const kin = Math.exp(-(octaves * octaves) / (2 * sigma * sigma));
        cx += dx * kin; cy += dy * kin;
        ax += other.vx * kin; ay += other.vy * kin;
        weight += kin;
      }
      let fx = sx * 0.35, fy = sy * 0.35;
      if (weight > 0) {
        fx += cx / weight * 0.004 + (ax / weight - bird.vx) * 0.08;
        fy += cy / weight * 0.004 + (ay / weight - bird.vy) * 0.08;
      }
      // A little wander, so a lone bird does not fly dead straight.
      const turn = (this.random() - 0.5) * 0.3;
      fx += -bird.vy * turn; fy += bird.vx * turn;
      bird.vx += fx; bird.vy += fy;
      // Speed follows what the bird hears, and a beat startles all of them.
      const heard = bird.level * p.music;
      const speed = scale * (0.25 + 1.6 * heard + 0.9 * this.startle * p.music) * STEP_SECONDS * 20;
      const current = Math.hypot(bird.vx, bird.vy) || 1;
      bird.vx = bird.vx / current * speed;
      bird.vy = bird.vy / current * speed;
      bird.x = (bird.x + bird.vx + w) % w;
      bird.y = (bird.y + bird.vy + h) % h;
    }
  }

  // Starts a mode: the members take their places for it.
  enter(mode) {
    this.mode = mode;
    const { width: w, height: h, birds } = this;
    this.trail.fill(0);
    birds.forEach((bird, i) => {
      bird.offset = 0;
      bird.swing = 0;
      if (mode === 'springs') {
        bird.x = (i + 0.5) / birds.length * w;
        bird.y = h / 2;
      }
    });
    if (mode === 'plate' && !this.grains.length)
      this.grains = Array.from({ length: GRAINS }, () => ({ x: this.random() * w, y: this.random() * h }));
  }

  step(p) {
    if (this.mode === 'springs') this.stepSprings(p);
    else if (this.mode === 'gather') this.stepGather(p);
    else if (this.mode === 'plate') this.stepPlate(p);
    else this.stepFlock(p);
  }

  // Masses in a row by pitch: pushed up by what they hear, pulled back by a
  // spring, slowed by damping, so each rings a little after its sound.
  stepSprings(p) {
    const { height: h, birds } = this;
    for (const bird of birds) {
      const push = bird.level * p.music * 90;
      bird.swing += (push - 60 * bird.offset - 6 * bird.swing) * STEP_SECONDS;
      bird.offset = Math.max(-0.5, Math.min(1, bird.offset + bird.swing * STEP_SECONDS));
      bird.y = h / 2 - bird.offset * h * 0.45;
    }
  }

  // The swarm is drawn to where the energy is.
  stepGather(p) {
    const { width: w, height: h, birds, scale } = this;
    let weight = 0, place = 0, sum = 0;
    birds.forEach((bird, i) => {
      const l = bird.level;
      weight += l;
      place += l * (i + 0.5) / birds.length;
      sum += l;
    });
    const target = {
      x: weight > 0.05 ? place / weight * w : w / 2,
      y: h * (0.85 - 0.7 * Math.min(1, sum / birds.length * 2.5)),
    };
    for (const bird of birds) {
      const dx = this.wrap(target.x - bird.x, w), dy = this.wrap(target.y - bird.y, h);
      const distance = Math.hypot(dx, dy) || 1;
      const pull = (0.02 + 0.5 * bird.level * p.music) * STEP_SECONDS * 20;
      // Pulled in, and swung sideways to orbit rather than pile up.
      bird.vx += (dx / distance * pull + -dy / distance * pull * 0.9 * bird.level) * 0.5;
      bird.vy += (dy / distance * pull + dx / distance * pull * 0.9 * bird.level) * 0.5;
      bird.vx += (this.random() - 0.5) * 0.08 * scale;
      bird.vy += (this.random() - 0.5) * 0.08 * scale;
      const limit = scale * (0.4 + 1.8 * bird.level * p.music);
      const speed = Math.hypot(bird.vx, bird.vy) || 1;
      if (speed > limit) { bird.vx *= limit / speed; bird.vy *= limit / speed; }
      bird.vx *= 0.97; bird.vy *= 0.97;
      bird.x = (bird.x + bird.vx + w) % w;
      bird.y = (bird.y + bird.vy + h) % h;
    }
  }

  // The members that drive the plate: the PLATE_MODES loudest. Many modes
  // added together shake everywhere; a few leave clean nodal lines.
  driving() {
    return [...this.birds].sort((a, b) => b.level - a.level).slice(0, PLATE_MODES);
  }

  // How hard the plate shakes at (x, y), 0 at its nodal lines: each driving
  // member adds the mode cos(n pi x) cos(m pi y) - cos(m pi x) cos(n pi y).
  plateField(x, y, driving = this.driving()) {
    let sum = 0;
    for (const bird of driving) {
      const n = bird.modeN, m = bird.modeM === bird.modeN ? bird.modeM + 1 : bird.modeM;
      sum += bird.level * (Math.cos(n * Math.PI * x) * Math.cos(m * Math.PI * y) -
        Math.cos(m * Math.PI * x) * Math.cos(n * Math.PI * y));
    }
    return Math.abs(sum);
  }

  stepPlate(p) {
    const { width: w, height: h, scale } = this;
    const gain = p.music, driving = this.driving();
    for (const grain of this.grains) {
      const shake = Math.min(1, this.plateField(grain.x / w, grain.y / h, driving) * gain * 2) ** 1.5;
      // Grains skip about in proportion to the shaking, and sit still at rest.
      grain.shake = shake;
      const jump = shake * 2.5 * scale;
      if (jump > 0.05) {
        grain.x = Math.min(w - 0.01, Math.max(0, grain.x + (this.random() - 0.5) * 2 * jump));
        grain.y = Math.min(h - 0.01, Math.max(0, grain.y + (this.random() - 0.5) * 2 * jump));
      }
    }
  }

  draw(p) {
    const { width: w, height: h, trail, out, scale } = this;
    const keep = p.trail;
    for (let i = 0; i < trail.length; ++i) trail[i] *= keep;
    if (this.mode === 'plate') {
      let r = 0, g = 0, b = 0, total = 0;
      for (const bird of this.birds) {
        r += bird.colour[0] * bird.level; g += bird.colour[1] * bird.level; b += bird.colour[2] * bird.level;
        total += bird.level;
      }
      const tint = total > 0.05 ? [r / total, g / total, b / total] : [0.5, 0.5, 0.5];
      const lift = [0, 1, 2].map((c) => 0.45 + 0.55 * tint[c]);
      for (const grain of this.grains) {
        const radius = Math.max(0, Math.round((p.size - 1) * scale * 0.5 + p.swell * (grain.shake ?? 0) * scale * 1.5));
        const x0 = Math.floor(grain.x), y0 = Math.floor(grain.y);
        for (let dy = -radius; dy <= radius; ++dy) {
          for (let dx = -radius; dx <= radius; ++dx) {
            const x = (x0 + dx + w) % w, y = (y0 + dy + h) % h, at = (y * w + x) * 3;
            for (let c = 0; c < 3; ++c) trail[at + c] = Math.max(trail[at + c], lift[c] * 0.9);
          }
        }
      }
      for (let i = 0; i < out.length; ++i) out[i] = Math.round(Math.min(1, trail[i]) * 255);
      return out;
    }
    for (const bird of this.birds) {
      const heard = bird.level * p.music;
      if (this.mode === 'springs') {
        // A stem from the rest line to the mass.
        const x = Math.min(w - 1, Math.floor(bird.x)), mid = Math.floor(h / 2), end = Math.round(bird.y);
        for (let y = Math.min(mid, end); y <= Math.max(mid, end); ++y) {
          const at = (Math.min(h - 1, Math.max(0, y)) * w + x) * 3;
          for (let c = 0; c < 3; ++c) trail[at + c] = Math.max(trail[at + c], bird.colour[c] * 0.35);
        }
      }
      // Between a steady size (what a half-loud member has) and one that follows
      // the sound, by Size by sound.
      const size = scale * p.size * (1.3 + (0.6 + 1.4 * heard - 1.3) * p.swell);
      const brightness = 0.18 + 0.82 * heard;
      const r = Math.ceil(size);
      const x0 = Math.round(bird.x), y0 = Math.round(bird.y);
      for (let dy = -r; dy <= r; ++dy) {
        for (let dx = -r; dx <= r; ++dx) {
          const d = Math.hypot(dx, dy);
          if (d > size) continue;
          const x = (x0 + dx + w) % w, y = (y0 + dy + h) % h;
          const at = (y * w + x) * 3, fade = brightness * (1 - 0.5 * d / size);
          for (let c = 0; c < 3; ++c) trail[at + c] = Math.max(trail[at + c], bird.colour[c] * fade);
        }
      }
    }
    for (let i = 0; i < out.length; ++i) out[i] = Math.round(Math.min(1, trail[i]) * 255);
    return out;
  }
}

export const SPECTRUM_FLOCK_PATTERN = {
  id: 'spectrum-flock',
  name: 'Spectrum Flock',
  audio: 'A flock in which every bird listens to one frequency: its speed, size and brightness follow that pitch, and birds flock with others near in pitch',
  audioReactive: true,
  controls: [],
  params: [...SPECTRUM_FLOCK_PARAMS, VARIATION_PARAM],
  createInstance: (width, height, random = Math.random) => new SpectrumFlock(width, height, random),
};
