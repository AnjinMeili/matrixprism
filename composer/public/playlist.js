// Playlists of looks. An entry (version 2, T73) holds:
// - a name, and its timing: `seconds` to show it for, or (for cue lists,
//   T76, not yet used) `at`, a place in bars and beats from a marker;
// - its options: alternative looks for one moment, each with a moment tag
//   (intro, build, drop, break, outro, or null) and a list of actions. The
//   first option is the one shown; the others are kept for later (T76).
// - An action is a look for now (quad.js, lookAction): a pair, which loads
//   into either pair, or the whole quad. Laser and DMX actions are planned;
//   an action of a kind this version does not know is kept as it is and not
//   shown.
// Entries saved before version 2 held one pair's look (layer A's pattern, the
// mixer, both transforms, and since 2026-10-16 the look settings and
// parameters); they are read as a pair look, with what they lack left as it
// is on the pair they load into.
import { mixerSettings } from './mixer.js';
import { shapeSettings } from './shape.js';
import { entryParams } from './look.js';
import { lookAction } from './quad.js';

export const ENTRY_SECONDS = [1, 3600];
export const DEFAULT_SECONDS = 30;
export const MAX_ENTRIES = 200;
export const MAX_PLAYLISTS = 50;

export const ENTRY_VERSION = 2;
export const MOMENTS = ['intro', 'build', 'drop', 'break', 'outro'];
// Where a cue can be placed (T76): bars and beats from one of these.
export const MARKERS = ['start', 'mixOut', 'cue', 'break'];
export const MAX_OPTIONS = 8;
export const MAX_ACTIONS = 8;

const text = (value, fallback, limit = 80) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// An entry saved before version 2, as the pair look it held.
function migratedEntry(value, patternIds) {
  if (typeof value.patternId !== 'string' || (patternIds && !patternIds.includes(value.patternId)))
    throw new Error(`Unknown playlist pattern: ${value.patternId}`);
  const mixer = mixerSettings(value.mixer, patternIds);
  const params = value.params === undefined ? null : entryParams(value.params, patternIds);
  const input = (patternId, shape) => ({
    patternId, shape: shapeSettings(shape), ...(params?.[patternId] ? { params: params[patternId] } : {}),
  });
  const action = {
    kind: 'look', scope: 'pair',
    inputs: [input(value.patternId, value.shapes?.a), input(mixer.patternId, value.shapes?.b)],
    pair: { enabled: mixer.enabled, mode: mixer.mode, amount: mixer.amount },
    ...(value.look === undefined ? {} : { shared: value.look }),
  };
  return { name: value.name, seconds: value.seconds, options: [{ moment: null, actions: [action] }] };
}

// A place in a track (T76): bars and beats from a marker; a cue point or a
// break is numbered from 1.
function placeOf(value) {
  if (!isObject(value) || !MARKERS.includes(value.marker)) throw new Error('A place needs a known marker.');
  const bars = value.bars ?? 0, beats = value.beats ?? 0;
  if (!Number.isInteger(bars) || bars < -1024 || bars > 4096) throw new Error('A place\'s bars must be a whole number.');
  if (!Number.isInteger(beats) || beats < 0 || beats > 15) throw new Error('A place\'s beats must be 0 to 15.');
  const place = { marker: value.marker, bars, beats };
  if (value.marker === 'cue' || value.marker === 'break') {
    if (!Number.isInteger(value.index) || value.index < 1) throw new Error('A cue point or break is numbered from 1.');
    place.index = value.index;
  }
  return place;
}

function actionOf(value, patternIds) {
  if (!isObject(value) || typeof value.kind !== 'string' || !value.kind || value.kind.length > 32)
    throw new Error('An action needs a kind.');
  // A kind this version does not know (from a later one) is kept as it is.
  return value.kind === 'look' ? lookAction(value, patternIds) : JSON.parse(JSON.stringify(value));
}

function optionOf(value, patternIds) {
  if (!isObject(value)) throw new Error('An option must be an options object.');
  const moment = value.moment ?? null;
  if (moment !== null && !MOMENTS.includes(moment)) throw new Error(`Unknown moment: ${moment}`);
  if (!Array.isArray(value.actions) || !value.actions.length || value.actions.length > MAX_ACTIONS)
    throw new Error(`An option holds 1 to ${MAX_ACTIONS} actions.`);
  return { moment, actions: value.actions.map((action) => actionOf(action, patternIds)) };
}

// Validates one entry, reading one saved before version 2 as a pair look.
// `patternIds` lists the patterns that exist.
export function playlistEntry(value, patternIds = null) {
  if (!isObject(value)) throw new Error('Playlist entry must be an options object.');
  const source = value.version === undefined ? migratedEntry(value, patternIds) : value;
  if (source.version !== undefined && source.version !== ENTRY_VERSION)
    throw new Error(`Playlist entry version ${source.version} is not one this composer reads.`);
  if (!Array.isArray(source.options) || !source.options.length || source.options.length > MAX_OPTIONS)
    throw new Error(`An entry holds 1 to ${MAX_OPTIONS} options.`);
  const entry = { version: ENTRY_VERSION, name: text(source.name, '') };
  if (source.at !== undefined) entry.at = placeOf(source.at);
  if (source.seconds !== undefined || source.at === undefined) {
    const seconds = source.seconds ?? DEFAULT_SECONDS;
    if (!Number.isFinite(seconds) || seconds < ENTRY_SECONDS[0] || seconds > ENTRY_SECONDS[1])
      throw new Error(`Playlist entry time must be between ${ENTRY_SECONDS[0]} and ${ENTRY_SECONDS[1]} seconds.`);
    entry.seconds = seconds;
  }
  entry.options = source.options.map((option) => optionOf(option, patternIds));
  return entry;
}

// The look an entry shows: its first option's first look action, or null.
export const entryLook = (entry) => entry.options[0].actions.find((action) => action.kind === 'look') ?? null;

// A cue list (T76) is a playlist that belongs to a track: { artist, title },
// and where known `isrc` and `bpm`. Its name is the track's, "Artist –
// Title", and its entries are cues placed in bars from the track's start.
export function trackOf(value) {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) throw new Error('A cue list\'s track must be an options object.');
  const artist = text(value.artist, ''), title = text(value.title, '');
  if (!artist && !title) return null;
  const track = { artist, title };
  if (value.isrc !== undefined) {
    if (typeof value.isrc !== 'string' || !/^[A-Z0-9]{12}$/i.test(value.isrc)) throw new Error('An ISRC is 12 letters and digits.');
    track.isrc = value.isrc.toUpperCase();
  }
  if (value.bpm !== undefined) {
    if (!Number.isFinite(value.bpm) || value.bpm < 40 || value.bpm > 250) throw new Error('A track\'s BPM must be from 40 to 250.');
    track.bpm = value.bpm;
  }
  return track;
}

export const trackName = (track) => [track.artist, track.title].filter(Boolean).join(' – ');

// Whether a playlist's name, or its track's artist or title, holds `query`,
// ignoring case and spaces at the ends.
export function playlistMatches(list, query) {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return true;
  return [list.name, list.track?.artist, list.track?.title].some((part) => part?.toLowerCase().includes(wanted));
}

// Where a new cue goes: 16 bars after the last cue placed from the start,
// or the start for the first.
export function nextCuePlace(entries) {
  const bars = entries.filter((entry) => entry.at?.marker === 'start').map((entry) => entry.at.bars);
  return { marker: 'start', bars: bars.length ? Math.max(...bars) + 16 : 0, beats: 0 };
}

// A playlist id not yet in `lists`.
export function unusedPlaylistId(lists) {
  const used = new Set(lists.map(list => list.id));
  for (let n = 1; ; ++n) if (!used.has(`playlist-${n}`)) return `playlist-${n}`;
}

export function playlistSettings(value = {}, patternIds = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Playlist settings must be an options object.');
  const lists = value.lists ?? [];
  if (!Array.isArray(lists) || lists.length > MAX_PLAYLISTS)
    throw new Error(`There can be at most ${MAX_PLAYLISTS} playlists.`);
  const seen = new Set();
  const result = lists.map((list, index) => {
    if (!list || typeof list !== 'object' || !Array.isArray(list.entries) || list.entries.length > MAX_ENTRIES)
      throw new Error(`A playlist needs a list of at most ${MAX_ENTRIES} entries.`);
    const id = text(list.id, `playlist-${index + 1}`);
    if (seen.has(id)) throw new Error(`Duplicate playlist id: ${id}`);
    seen.add(id);
    const track = trackOf(list.track);
    return {
      id, name: track ? trackName(track) : text(list.name, `Playlist ${index + 1}`),
      ...(track ? { track } : {}),
      entries: list.entries.map(entry => playlistEntry(entry, patternIds)),
    };
  });
  for (const key of ['loop', 'shuffle']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw new Error(`Playlist ${key} must be boolean.`);
  }
  // The pair entries show on and play on (T73): Left, as before, or Right.
  const pair = value.pair ?? 'left';
  if (!['left', 'right'].includes(pair)) throw new Error('Playlists play on Left or Right.');
  return {
    lists: result,
    activeId: result.some(list => list.id === value.activeId) ? value.activeId : result[0]?.id ?? null,
    loop: value.loop ?? true,
    shuffle: value.shuffle ?? false,
    pair,
  };
}

// A short description for the entry list.
export function describeEntry(entry, patternName = id => id) {
  const look = entryLook(entry);
  const parts = [];
  if (!look) {
    parts.push('No look');
  } else if (look.scope === 'quad') {
    parts.push(`Whole quad: ${['a', 'b', 'c', 'd'].map((id) => patternName(look.inputs[id].patternId)).join(', ')}`);
  } else {
    const [first, second] = look.inputs;
    parts.push(patternName(first.patternId));
    if (look.pair.enabled)
      parts.push(`+ ${patternName(second.patternId)} (${look.pair.mode} ${Math.round(look.pair.amount * 100)}%)`);
    const shaped = ['first', 'second'].filter((name, i) => (i === 0 || look.pair.enabled) && look.inputs[i].shape &&
      (look.inputs[i].shape.shape !== 'normal' || look.inputs[i].shape.region !== 'full'));
    if (shaped.length) parts.push(`· shaped ${shaped.join(' and ')}`);
  }
  if (entry.options[0].moment) parts.push(`· ${entry.options[0].moment}`);
  if (entry.options.length > 1) parts.push(`· ${entry.options.length} options`);
  return parts.join(' ');
}

// Steps through a playlist on a caller-supplied clock in milliseconds.
export class PlaylistPlayer {
  constructor(random = Math.random) {
    this.random = random;
    this.stop();
  }

  stop() {
    this.entries = null;
    this.index = -1;
    this.changedAt = 0;
    this.loop = true;
    this.shuffle = false;
  }

  get playing() {
    return this.entries !== null;
  }

  // Begins at `index` and returns the entry to show, or null if the list is
  // empty.
  start(entries, now, { loop = true, shuffle = false, index = 0 } = {}) {
    if (!entries.length) {
      this.stop();
      return null;
    }
    this.entries = entries;
    this.loop = loop;
    this.shuffle = shuffle;
    this.index = Math.min(entries.length - 1, Math.max(0, index));
    this.changedAt = now;
    return this.entries[this.index];
  }

  // Picks up edits to the playlist that is playing without restarting it.
  update(entries, { loop = this.loop, shuffle = this.shuffle } = {}) {
    if (!this.playing) return;
    if (!entries.length) {
      this.stop();
      return;
    }
    this.entries = entries;
    this.loop = loop;
    this.shuffle = shuffle;
    this.index = Math.min(this.index, entries.length - 1);
  }

  // An entry placed in bars (a cue, T76) shows for the default time until
  // cue lists are built.
  remainingSeconds(now) {
    if (!this.playing) return 0;
    return Math.max(0, (this.entries[this.index].seconds ?? DEFAULT_SECONDS) - (now - this.changedAt) / 1000);
  }

  nextIndex() {
    const count = this.entries.length;
    if (this.shuffle && count > 1) {
      // Any entry but the current one.
      const step = 1 + Math.floor(this.random() * (count - 1));
      return (this.index + step) % count;
    }
    if (this.index + 1 < count) return this.index + 1;
    return this.loop ? 0 : -1;
  }

  // Moves on now, whatever time is left. Returns the new entry, or null when
  // a non-looping playlist has finished.
  skip(now) {
    if (!this.playing) return null;
    const next = this.nextIndex();
    if (next < 0) {
      this.stop();
      return null;
    }
    this.index = next;
    this.changedAt = now;
    return this.entries[next];
  }

  // Returns the entry to switch to when the current one's time is up.
  tick(now) {
    if (!this.playing || this.remainingSeconds(now) > 0) return null;
    const count = this.entries.length;
    // A one-entry looping playlist has nothing to change to.
    if (count === 1 && this.loop) {
      this.changedAt = now;
      return null;
    }
    return this.skip(now);
  }
}
