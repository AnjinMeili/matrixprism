// Playlists of looks. Each entry records layer A's pattern, the mixer state
// (layer B's pattern, blend and amount), both layers' transforms (shape and
// region), and how long to show it. Entries saved since 2026-10-16 also keep
// the look settings and each layer's pattern parameters (look.js); older
// entries without them leave those as they are when shown.
import { mixerSettings } from './mixer.js';
import { shapeSettings } from './shape.js';
import { entryParams, lookSettings } from './look.js';

export const ENTRY_SECONDS = [1, 3600];
export const DEFAULT_SECONDS = 30;
export const MAX_ENTRIES = 200;
export const MAX_PLAYLISTS = 50;

const text = (value, fallback, limit = 80) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback;

// Validates one entry. `patternIds` lists the patterns that exist.
export function playlistEntry(value, patternIds = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Playlist entry must be an options object.');
  if (typeof value.patternId !== 'string' || (patternIds && !patternIds.includes(value.patternId)))
    throw new Error(`Unknown playlist pattern: ${value.patternId}`);
  const seconds = value.seconds ?? DEFAULT_SECONDS;
  if (!Number.isFinite(seconds) || seconds < ENTRY_SECONDS[0] || seconds > ENTRY_SECONDS[1])
    throw new Error(`Playlist entry time must be between ${ENTRY_SECONDS[0]} and ${ENTRY_SECONDS[1]} seconds.`);
  const entry = {
    name: text(value.name, ''),
    patternId: value.patternId,
    seconds,
    mixer: mixerSettings(value.mixer, patternIds),
    shapes: { a: shapeSettings(value.shapes?.a), b: shapeSettings(value.shapes?.b) },
  };
  if (value.look !== undefined) entry.look = lookSettings(value.look);
  if (value.params !== undefined) entry.params = entryParams(value.params, patternIds);
  return entry;
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
    return {
      id, name: text(list.name, `Playlist ${index + 1}`),
      entries: list.entries.map(entry => playlistEntry(entry, patternIds)),
    };
  });
  for (const key of ['loop', 'shuffle']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw new Error(`Playlist ${key} must be boolean.`);
  }
  return {
    lists: result,
    activeId: result.some(list => list.id === value.activeId) ? value.activeId : result[0]?.id ?? null,
    loop: value.loop ?? true,
    shuffle: value.shuffle ?? false,
  };
}

// A short description for the entry list.
export function describeEntry(entry, patternName = id => id) {
  const parts = [patternName(entry.patternId)];
  if (entry.mixer.enabled)
    parts.push(`+ ${patternName(entry.mixer.patternId)} (${entry.mixer.mode} ${Math.round(entry.mixer.amount * 100)}%)`);
  const shaped = ['a', 'b'].filter(layer => (layer === 'a' || entry.mixer.enabled) &&
    (entry.shapes[layer].shape !== 'normal' || entry.shapes[layer].region !== 'full'));
  if (shaped.length) parts.push(`· shaped ${shaped.map(layer => layer.toUpperCase()).join(' and ')}`);
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

  remainingSeconds(now) {
    if (!this.playing) return 0;
    return Math.max(0, this.entries[this.index].seconds - (now - this.changedAt) / 1000);
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
