import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOTSAVE_DEFAULTS, LOOK_KEYS, entryParams, hotsaveName, hotsaveSettings, lookOf, lookSettings,
} from '../public/look.js';
import { playlistEntry, playlistSettings, unusedPlaylistId } from '../public/playlist.js';
import { SPARKLE_DEFAULTS } from '../public/sparkle.js';
import { SPECTRUM_DEFAULTS } from '../public/spectrum-plot.js';

// What a playlist entry keeps beyond patterns, mixer and shapes, and Hotsave.

const look = {
  hue: 0.25, speed: 1.5, paletteId: 'original', paletteCycle: false, keyColours: true, flockCount: null,
  auroraDotSize: 2.5, sparkles: { ...SPARKLE_DEFAULTS, enabled: true }, spectrumOptions: SPECTRUM_DEFAULTS,
};
const ids = ['plasma', 'tunnel'];
const entry = (extra = {}) => ({
  patternId: 'plasma', seconds: 30, mixer: { enabled: false, patternId: 'tunnel', mode: 'add', amount: 0.5 }, ...extra,
});

test('a look keeps every look setting, checked against the controls\' ranges', () => {
  assert.deepEqual(Object.keys(lookSettings(look)), LOOK_KEYS);
  assert.deepEqual(lookOf({ ...look, brightness: 0.8, gamma: 2, fps: 30, host: 'x' }), look,
    'brightness, gamma, frame rate and the panel are left out');
  for (const [key, bad] of [['hue', 1.5], ['speed', -1], ['paletteId', 'nope'], ['paletteCycle', 1],
    ['keyColours', 'yes'], ['flockCount', 0], ['flockCount', 2.5], ['auroraDotSize', 40]])
    assert.throws(() => lookSettings({ ...look, [key]: bad }), undefined, `${key} ${bad}`);
  assert.throws(() => lookSettings({ ...look, sparkles: { ...SPARKLE_DEFAULTS, amount: 2 } }));
  assert.equal(lookSettings({ ...look, flockCount: undefined }).flockCount, null);
});

test('pattern parameters in an entry keep the patterns that exist and the plain values', () => {
  assert.deepEqual(entryParams({ plasma: { scale: 4, on: true, mode: 'b', bad: {} }, gone: { x: 1 } }, ids),
    { plasma: { scale: 4, on: true, mode: 'b' } });
  assert.throws(() => entryParams([]));
  assert.throws(() => entryParams({ plasma: 3 }, ids));
});

test('entries keep a look and parameters when they have them, and old entries stay as they were', () => {
  const full = playlistEntry(entry({ look, params: { plasma: { scale: 4 } } }), ids);
  assert.deepEqual(full.look, lookSettings(look));
  assert.deepEqual(full.params, { plasma: { scale: 4 } });
  const old = playlistEntry(entry(), ids);
  assert.equal('look' in old, false);
  assert.equal('params' in old, false);
  // Through the playlist settings and back, as when saved and loaded.
  const saved = JSON.parse(JSON.stringify(playlistSettings({ lists: [{ id: 'p', name: 'P', entries: [full, old] }] }, ids)));
  assert.deepEqual(playlistSettings(saved, ids).lists[0].entries, [full, old]);
});

test('Hotsave takes one letter or digit, not the tap tempo key, and a playlist id or none', () => {
  assert.deepEqual(hotsaveSettings(), HOTSAVE_DEFAULTS);
  assert.deepEqual(hotsaveSettings({ key: 'H' }), { key: 'h', playlistId: null });
  assert.deepEqual(hotsaveSettings({ key: '7', playlistId: 'playlist-2' }), { key: '7', playlistId: 'playlist-2' });
  for (const key of ['t', 'T', 'd', 'D', 'ab', '', ' ', '/', 'ArrowLeft'])
    assert.throws(() => hotsaveSettings({ key }), undefined, `key ${JSON.stringify(key)}`);
  assert.throws(() => hotsaveSettings({ key: 'd' }), /marks the downbeat/);
  assert.throws(() => hotsaveSettings({ playlistId: 3 }));
});

test('a Hotsave entry is named for the time, and a new playlist gets an unused id', () => {
  assert.equal(hotsaveName(new Date(2026, 9, 16, 9, 5, 7)), 'Hotsave 09:05:07');
  assert.equal(unusedPlaylistId([{ id: 'playlist-1' }, { id: 'playlist-3' }]), 'playlist-2');
  assert.equal(unusedPlaylistId([]), 'playlist-1');
});
