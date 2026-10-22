import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SECONDS, PlaylistPlayer, describeEntry, playlistEntry, playlistSettings } from '../public/playlist.js';
import { MIXER_DEFAULTS } from '../public/mixer.js';
import { SHAPE_DEFAULTS } from '../public/shape.js';

const ids = ['plasma', 'bars', 'tunnel'];
const entry = (patternId, seconds = 10, extra = {}) => ({ patternId, seconds, ...extra });

test('entries hold layer A, the mixer state for layer B, and both transforms', () => {
  assert.deepEqual(playlistEntry({ patternId: 'bars' }, ids), {
    name: '', patternId: 'bars', seconds: DEFAULT_SECONDS,
    mixer: MIXER_DEFAULTS, shapes: { a: SHAPE_DEFAULTS, b: SHAPE_DEFAULTS },
  });
  const full = playlistEntry({
    name: '  Opening  ', patternId: 'bars', seconds: 45,
    mixer: { enabled: true, patternId: 'tunnel', mode: 'add', amount: 1 },
    shapes: { a: { shape: 'inside-out', region: 'centre', width: 0.4 }, b: { region: 'outer', width: 0.4 } },
  }, ids);
  assert.equal(full.name, 'Opening');
  assert.equal(full.mixer.patternId, 'tunnel');
  assert.equal(full.shapes.a.shape, 'inside-out');
  assert.equal(full.shapes.b.region, 'outer');
  assert.throws(() => playlistEntry({ patternId: 'missing' }, ids), /playlist pattern/);
  assert.throws(() => playlistEntry({ patternId: 'bars', seconds: 0 }, ids), /time/);
  assert.throws(() => playlistEntry({ patternId: 'bars', mixer: { mode: 'nope' } }, ids), /blend mode/);
  assert.throws(() => playlistEntry({ patternId: 'bars', shapes: { a: { outline: 'star' } } }, ids), /outline/);
  assert.throws(() => playlistEntry(null, ids), /options object/);
});

test('playlist settings validate lists, ids and the active playlist', () => {
  assert.deepEqual(playlistSettings(undefined, ids), { lists: [], activeId: null, loop: true, shuffle: false });
  const settings = playlistSettings({
    lists: [{ id: 'one', name: 'Show', entries: [entry('bars')] }, { entries: [] }],
    activeId: 'gone', shuffle: true,
  }, ids);
  assert.equal(settings.activeId, 'one', 'a missing active id falls back to the first playlist');
  assert.equal(settings.lists[1].id, 'playlist-2');
  assert.equal(settings.lists[1].name, 'Playlist 2');
  assert.equal(settings.shuffle, true);
  assert.throws(() => playlistSettings({ lists: [{ id: 'x', entries: [] }, { id: 'x', entries: [] }] }), /Duplicate/);
  assert.throws(() => playlistSettings({ lists: [{ id: 'x' }] }), /entries/);
  assert.throws(() => playlistSettings({ lists: [], loop: 'yes' }), /boolean/);
  assert.throws(() => playlistSettings({ lists: [{ id: 'x', entries: [entry('missing')] }] }, ids), /playlist pattern/);
});

test('descriptions name both layers, the blend and any transforms', () => {
  const names = { plasma: 'Plasma', bars: 'Bars', tunnel: 'Tunnel' };
  const name = id => names[id];
  assert.equal(describeEntry(playlistEntry({ patternId: 'bars' }), name), 'Bars');
  assert.equal(describeEntry(playlistEntry({
    patternId: 'bars', mixer: { enabled: true, patternId: 'tunnel', mode: 'add', amount: 0.75 },
    shapes: { a: { region: 'centre' }, b: { shape: 'outside-in' } },
  }), name), 'Bars + Tunnel (add 75%) · shaped A and B');
  // Layer B's transform is not mentioned while the mixer is off.
  assert.equal(describeEntry(playlistEntry({ patternId: 'bars', shapes: { b: { region: 'outer' } } }), name), 'Bars');
});

test('player advances by each entry\'s own time, loops, and stops at the end otherwise', () => {
  const list = [entry('plasma', 10), entry('bars', 5), entry('tunnel', 20)].map(e => playlistEntry(e, ids));
  const player = new PlaylistPlayer();
  assert.equal(player.playing, false);
  assert.equal(player.tick(0), null);
  assert.equal(player.start(list, 1000).patternId, 'plasma');
  assert.equal(player.playing, true);
  assert.equal(player.tick(10999), null);
  assert.equal(player.remainingSeconds(6000), 5);
  assert.equal(player.tick(11000).patternId, 'bars');
  assert.equal(player.tick(15999), null);
  assert.equal(player.tick(16000).patternId, 'tunnel');
  assert.equal(player.tick(36000).patternId, 'plasma', 'loops to the start');
  assert.equal(player.skip(37000).patternId, 'bars', 'skip moves on at once');
  assert.equal(player.remainingSeconds(37000), 5);

  const once = new PlaylistPlayer();
  once.start(list, 0, { loop: false, index: 2 });
  assert.equal(once.tick(19999), null);
  assert.equal(once.tick(20000), null);
  assert.equal(once.playing, false, 'a non-looping playlist stops after its last entry');

  assert.equal(new PlaylistPlayer().start([], 0), null);
  const single = new PlaylistPlayer();
  single.start([list[0]], 0);
  assert.equal(single.tick(10000), null, 'a single looping entry just stays');
  assert.equal(single.playing, true);
});

test('shuffle never repeats the current entry, and edits are picked up while playing', () => {
  const list = [entry('plasma', 1), entry('bars', 1), entry('tunnel', 1)].map(e => playlistEntry(e, ids));
  let draws = 0;
  const player = new PlaylistPlayer(() => (draws++ % 2 ? 0.99 : 0));
  player.start(list, 0, { shuffle: true });
  let previous = player.index;
  for (let step = 1; step <= 20; ++step) {
    player.tick(step * 1000);
    assert.notEqual(player.index, previous);
    previous = player.index;
  }
  player.update(list.slice(0, 1));
  assert.equal(player.index, 0, 'the position is kept inside a shortened playlist');
  player.update([]);
  assert.equal(player.playing, false, 'emptying the playlist stops it');
});
