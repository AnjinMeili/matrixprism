// Randomizer: changes each layer's pattern and its attributes on separate
// timers, each waiting a random time between a minimum and a maximum.
import { BLEND_MODES } from './mixer.js';
import { OUTLINES, PULSE_BEATS, SHAPES, SPINS, SPIN_REVERSALS, REGIONS } from './shape.js';

// One independent timer per track. The quad mixer's Right pair, C and D,
// has its own (T16 step 6); `copies` is the Left track whose saved choice
// it takes when it has none of its own.
export const TRACKS = [
  { id: 'patternA', name: 'Layer A pattern' },
  { id: 'shapeA', name: 'Layer A shape and region' },
  { id: 'patternB', name: 'Layer B pattern', needsMixer: true },
  { id: 'shapeB', name: 'Layer B shape and region', needsMixer: true },
  { id: 'blend', name: 'Blend and amount', needsMixer: true },
  { id: 'patternC', name: 'Input C pattern', copies: 'patternA' },
  { id: 'shapeC', name: 'Input C shape and region', copies: 'shapeA' },
  { id: 'patternD', name: 'Input D pattern', needsRight: true, copies: 'patternB' },
  { id: 'shapeD', name: 'Input D shape and region', needsRight: true, copies: 'shapeB' },
  { id: 'blendRight', name: 'Right blend and amount', needsRight: true, copies: 'blend' },
  { id: 'colour', name: 'Hue shift and palette' },
  { id: 'media', name: 'Media Player file from the folder', needsMedia: true },
];

// What the waits count (Anjin, 2026-10-20: "the option for counting in
// seconds, bars, or beats"): seconds, or beats or bars of the tempo clock,
// which also moves spin and pulse. A wait in beats or bars is a whole number
// of them and ends on a beat or a bar line.
export const WAIT_UNITS = [
  { id: 'seconds', name: 'Seconds', beats: 0 },
  { id: 'beats', name: 'Beats', beats: 1 },
  { id: 'bars', name: 'Bars (4 beats)', beats: 4 },
];
export const WAIT_RANGE = [1, 3600];
export const RANDOMIZER_DEFAULTS = {
  enabled: false, unit: 'seconds', minWait: 15, maxWait: 60,
  tracks: Object.fromEntries(TRACKS.map(track => [track.id, true])),
};

const unitOf = (id) => WAIT_UNITS.find((unit) => unit.id === id);

// A wait for showing: "12 s", "1 beat", "3 bars".
export function waitLabel(amount, unit) {
  const n = Math.ceil(amount);
  return unit === 'seconds' ? `${n} s` : `${n} ${unit === 'beats' ? 'beat' : 'bar'}${n === 1 ? '' : 's'}`;
}

export function randomizerSettings(value = RANDOMIZER_DEFAULTS) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Randomizer settings must be an options object.');
  // Settings saved before the units counted their waits in seconds.
  const result = { ...RANDOMIZER_DEFAULTS, ...value,
    minWait: value.minWait ?? value.minSeconds ?? RANDOMIZER_DEFAULTS.minWait,
    maxWait: value.maxWait ?? value.maxSeconds ?? RANDOMIZER_DEFAULTS.maxWait };
  if (typeof result.enabled !== 'boolean') throw new Error('Randomizer enabled must be boolean.');
  if (!unitOf(result.unit)) throw new Error(`Unknown randomizer wait unit: ${result.unit}`);
  for (const key of ['minWait', 'maxWait']) {
    if (!Number.isFinite(result[key]) || result[key] < WAIT_RANGE[0] || result[key] > WAIT_RANGE[1])
      throw new Error(`Randomizer waits must be between ${WAIT_RANGE[0]} and ${WAIT_RANGE[1]}.`);
  }
  if (result.minWait > result.maxWait)
    throw new Error('Randomizer minimum wait must not be more than the maximum.');
  const tracks = {};
  for (const { id, copies } of TRACKS) {
    const on = value.tracks?.[id] ?? value.tracks?.[copies] ?? RANDOMIZER_DEFAULTS.tracks[id];
    if (typeof on !== 'boolean') throw new Error(`Randomizer track ${id} must be on or off.`);
    tracks[id] = on;
  }
  return { enabled: result.enabled, unit: result.unit, minWait: result.minWait, maxWait: result.maxWait, tracks };
}

// Keeps a deadline per track and reports which tracks are due. Deadlines are
// on the clock the waits count: milliseconds, or the tempo clock's beats.
export class Randomizer {
  constructor(random = Math.random) {
    this.random = random;
    this.due = new Map();
    this.unit = null;
  }

  reset() {
    this.due.clear();
  }

  // Starts these tracks' waits afresh from their next tick, as after a
  // channel's Reset, so it is left alone for a whole wait.
  restart(tracks) {
    for (const track of tracks) this.due.delete(track);
  }

  // The time on the waits' clock: `now` in milliseconds, or `beat`.
  static clock(settings, now, beat) {
    return settings.unit === 'seconds' ? now : beat;
  }

  // A new deadline from `at`: a random time in seconds, or a whole number of
  // beats or bars ending on a beat or a bar line.
  deadline(settings, at) {
    const { minWait, maxWait } = settings;
    const per = unitOf(settings.unit).beats;
    if (!per) return at + (minWait + this.random() * (maxWait - minWait)) * 1000;
    const count = minWait + Math.min(maxWait - minWait, Math.floor(this.random() * (maxWait - minWait + 1)));
    return (Math.floor(at / per) + count) * per;
  }

  // How long until a track next changes, in the waits' unit, or null if it
  // is not running.
  remaining(track, settings, now, beat) {
    if (!this.due.has(track)) return null;
    const left = this.due.get(track) - Randomizer.clock(settings, now, beat);
    const per = unitOf(settings.unit).beats;
    return Math.max(0, per ? left / per : left / 1000);
  }

  // Returns the ids of the tracks to change now. A track that has just been
  // switched on waits one interval before its first change, and tracks that
  // need the mixer are idle while it is off, as are those that need the
  // quad mixer's Right pair while `rightOn` says its mixing is off. The media
  // track is idle unless `mediaOn` says there is a folder to choose from and
  // somewhere to show it. `beat` is the tempo clock's position, for waits in
  // beats or bars. Changing the unit starts every wait afresh, and so does a
  // deadline further off than the longest wait, as when the tempo clock
  // starts again from 0.
  tick(now, settings, mixerOn, mediaOn = false, rightOn = false, beat = 0) {
    const changes = [];
    if (!settings.enabled) {
      this.reset();
      return changes;
    }
    if (settings.unit !== this.unit) {
      this.reset();
      this.unit = settings.unit;
    }
    const at = Randomizer.clock(settings, now, beat);
    const per = unitOf(settings.unit).beats;
    const longest = per ? (settings.maxWait + 1) * per : settings.maxWait * 1000;
    for (const track of TRACKS) {
      const running = settings.tracks[track.id] && (mixerOn || !track.needsMixer) &&
        (mediaOn || !track.needsMedia) && (rightOn || !track.needsRight);
      if (!running) {
        this.due.delete(track.id);
      } else if (!this.due.has(track.id) || this.due.get(track.id) - at > longest) {
        this.due.set(track.id, this.deadline(settings, at));
      } else if (at >= this.due.get(track.id)) {
        changes.push(track.id);
        this.due.set(track.id, this.deadline(settings, at));
      }
    }
    return changes;
  }
}

const pick = (random, list) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
const between = (random, low, high) => Math.round((low + random() * (high - low)) * 100) / 100;

// Any ready pattern other than the ones named in `avoid`.
export function randomPattern(patterns, avoid, random = Math.random) {
  const ready = patterns.filter(pattern => !pattern.isReady || pattern.isReady());
  const choices = ready.filter(pattern => !avoid.includes(pattern.id));
  const pool = choices.length ? choices : ready;
  return pool.length ? pick(random, pool) : null;
}

// Any entry of a media folder other than `current`, the one showing.
export function randomMedia(entries, current, random = Math.random) {
  const choices = entries.filter(entry => entry !== current);
  const pool = choices.length ? choices : entries;
  return pool.length ? pick(random, pool) : null;
}

// Blends the randomizer may pick. The ones left out can turn large parts of
// the picture black on their own: multiply, darken, stencil and overlay go
// dark wherever either pattern is dark (and most patterns are mostly dark),
// and dip to black is black at its half-way point.
export const RANDOM_BLENDS = ['crossfade', 'equal-power', 'average', 'add', 'screen', 'lighten', 'difference'];

// A blend whose amount keeps both layers in view.
export function randomBlend(random = Math.random) {
  const mode = pick(random, BLEND_MODES.filter(candidate => RANDOM_BLENDS.includes(candidate.id)));
  return { mode: mode.id, amount: mode.kind === 'transition' ? between(random, 0.3, 0.7) : between(random, 0.5, 1) };
}

// A shape for one layer. Regions are only chosen when `allowRegion` is set,
// so a single layer is never left covering just part of the panel.
export function randomShape(random = Math.random, allowRegion = true) {
  return {
    shape: pick(random, SHAPES).id,
    region: allowRegion ? pick(random, REGIONS).id : 'full',
    outline: pick(random, OUTLINES).id,
    width: between(random, 0.25, 0.9),
    height: between(random, 0.25, 0.9),
    proportional: random() < 0.5,
    // Half the time a hard border, otherwise some softness.
    edge: random() < 0.5 ? 0 : between(random, 0.05, 0.3),
    // Movement on the beat: most of the time a spin, a pulse, or both.
    spin: random() < 0.5 ? pick(random, SPINS) : 0,
    spinReverse: pick(random, SPIN_REVERSALS),
    pulse: random() < 0.5 ? between(random, 0.05, 0.35) : 0,
    pulseBeats: pick(random, PULSE_BEATS),
  };
}

// Makes sure the two layers between them cover the whole panel after
// `changed` has been given a new shape: 'a' or 'b', or for the quad mixer's
// Right pair 'c' or 'd' with `shapes` holding those two. If both layers are
// limited to regions, the other one is given the exact complement of the
// changed layer's area, keeping its own bend and movement.
export function coverPanel(shapes, changed) {
  const other = { a: 'b', b: 'a', c: 'd', d: 'c' }[changed];
  const mine = shapes[changed], theirs = shapes[other];
  if (mine.region === 'full' || theirs.region === 'full') return shapes;
  return {
    ...shapes,
    [other]: {
      ...theirs,
      region: mine.region === 'centre' ? 'outer' : 'centre',
      outline: mine.outline, width: mine.width, height: mine.height, proportional: mine.proportional,
      // The same softness, so the two fade into each other with no dip.
      edge: mine.edge,
    },
  };
}
