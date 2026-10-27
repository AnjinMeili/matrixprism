// What a playlist entry keeps beyond the patterns, mixer and shapes
// (playlist.js), so that showing it puts back everything that made the look:
// the look settings below and each layer's pattern parameters (params.js).
// And Hotsave: a key that adds the look on screen to a playlist.
//
// Brightness, gamma and frame rate are left out: they suit the panel, not
// the look.
import { PALETTES } from './palettes.js';
import { SPARKLE_DEFAULTS, sparkleSettings } from './sparkle.js';
import { SPECTRUM_DEFAULTS, spectrumOptions } from './spectrum-plot.js';

export const LOOK_KEYS = ['hue', 'speed', 'paletteId', 'paletteCycle', 'keyColours', 'flockCount', 'auroraDotSize',
  'sparkles', 'spectrumOptions'];
// Their values before anyone changes them, as in the composer's own defaults.
export const LOOK_DEFAULTS = {
  hue: 0, speed: 1, paletteId: 'original', paletteCycle: false, keyColours: false, flockCount: null,
  auroraDotSize: null, sparkles: SPARKLE_DEFAULTS, spectrumOptions: SPECTRUM_DEFAULTS,
};

const number = (value, name, low, high) => {
  if (!Number.isFinite(value) || value < low || value > high)
    throw new Error(`Look ${name} must be between ${low} and ${high}.`);
  return value;
};
const bool = (value, name) => {
  if (typeof value !== 'boolean') throw new Error(`Look ${name} must be true or false.`);
  return value;
};

// Validates a saved look. Throws on a value out of range; the ranges are the
// controls' own.
export function lookSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('A look must be an options object.');
  if (!PALETTES.some((palette) => palette.id === value.paletteId))
    throw new Error(`Unknown palette: ${value.paletteId}`);
  const flockCount = value.flockCount ?? null;
  if (flockCount !== null && !(Number.isInteger(flockCount) && flockCount >= 1 && flockCount <= 256))
    throw new Error('Look flock count must be automatic or a whole number from 1 to 256.');
  const auroraDotSize = value.auroraDotSize ?? null;
  if (auroraDotSize !== null) number(auroraDotSize, 'dot size', 1, 32);
  return {
    hue: number(value.hue, 'hue', 0, 1),
    speed: number(value.speed, 'speed', 0, 3),
    paletteId: value.paletteId,
    paletteCycle: bool(value.paletteCycle, 'palette cycle'),
    keyColours: bool(value.keyColours, 'key colours'),
    flockCount,
    auroraDotSize,
    sparkles: sparkleSettings(value.sparkles),
    spectrumOptions: spectrumOptions(value.spectrumOptions),
  };
}

// The look settings out of the composer's settings.
export const lookOf = (settings) => Object.fromEntries(LOOK_KEYS.map((key) => [key, settings[key]]));

// Validates an entry's pattern parameters: by pattern id, each a set of
// values that are numbers, bools or strings. Patterns not in `patternIds`
// are dropped; values are checked against each pattern's declaration when
// the entry is shown (params.js), so they are only checked for type here.
export function entryParams(value, patternIds = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Saved pattern parameters must be an options object.');
  const result = {};
  for (const [id, values] of Object.entries(value)) {
    if (patternIds && !patternIds.includes(id)) continue;
    if (!values || typeof values !== 'object' || Array.isArray(values))
      throw new Error(`Saved parameters for ${id} must be an options object.`);
    result[id] = Object.fromEntries(Object.entries(values).filter(([, v]) =>
      (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean' || typeof v === 'string'));
  }
  return result;
}

// Hotsave: the key that saves the look on screen, the playlist it goes to
// (null: a playlist called Hotsave, made on first use), and what it saves
// (T73): the pair on air, Left, Right, or the whole quad. Add current look
// and Replace with current look save the same.
export const HOTSAVE_SCOPES = ['onAir', 'left', 'right', 'quad'];
export const HOTSAVE_DEFAULTS = { key: 's', playlistId: null, scope: 'onAir' };
export const HOTSAVE_PLAYLIST_NAME = 'Hotsave';
// Keys the page already uses: T taps the tempo.
// Keys the composer uses itself, and what for.
export const RESERVED_KEYS = ['t', 'd'];
const RESERVED_FOR = { t: 'it taps the tempo', d: 'it marks the downbeat' };

export function hotsaveSettings(value = HOTSAVE_DEFAULTS) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Hotsave settings must be an options object.');
  const result = { ...HOTSAVE_DEFAULTS, ...value };
  const key = typeof result.key === 'string' ? result.key.toLowerCase() : '';
  if (!/^[a-z0-9]$/.test(key)) throw new Error('The Hotsave key must be one letter or digit.');
  if (RESERVED_KEYS.includes(key)) throw new Error(`${key.toUpperCase()} is taken: ${RESERVED_FOR[key]}.`);
  if (result.playlistId !== null && typeof result.playlistId !== 'string')
    throw new Error('The Hotsave playlist must be a playlist id.');
  if (!HOTSAVE_SCOPES.includes(result.scope)) throw new Error(`Hotsave saves one of: ${HOTSAVE_SCOPES.join(', ')}.`);
  return { key, playlistId: result.playlistId, scope: result.scope };
}

// The name of an entry saved by Hotsave: when it was saved.
export function hotsaveName(date) {
  const two = (n) => String(n).padStart(2, '0');
  return `Hotsave ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
