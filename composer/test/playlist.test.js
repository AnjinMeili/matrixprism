import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SECONDS, PlaylistPlayer, describeEntry, entryLook, nextCuePlace, playlistEntry, playlistMatches, playlistSettings,
  trackName, trackOf,
} from '../public/playlist.js';
import { LOOK_DEFAULTS } from '../public/look.js';
import { MIXER_DEFAULTS } from '../public/mixer.js';
import { SHAPE_DEFAULTS } from '../public/shape.js';

const ids = ['plasma', 'bars', 'tunnel'];
const entry = (patternId, seconds = 10, extra = {}) => ({ patternId, seconds, ...extra });
// The pattern an entry shows first.
const shown = (value) => value && entryLook(value).inputs[0].patternId;

test('an entry saved before version 2 is read as a pair look, keeping what it held', () => {
  assert.deepEqual(playlistEntry({ patternId: 'bars' }, ids), {
    version: 2, name: '', seconds: DEFAULT_SECONDS,
    options: [{ moment: null, actions: [{
      kind: 'look', scope: 'pair',
      inputs: [{ patternId: 'bars', shape: SHAPE_DEFAULTS }, { patternId: MIXER_DEFAULTS.patternId, shape: SHAPE_DEFAULTS }],
      pair: { enabled: MIXER_DEFAULTS.enabled, mode: MIXER_DEFAULTS.mode, amount: MIXER_DEFAULTS.amount },
    }] }],
  });
  const full = playlistEntry({
    name: '  Opening  ', patternId: 'bars', seconds: 45,
    mixer: { enabled: true, patternId: 'tunnel', mode: 'add', amount: 1 },
    shapes: { a: { shape: 'inside-out', region: 'centre', width: 0.4 }, b: { region: 'outer', width: 0.4 } },
    look: LOOK_DEFAULTS, params: { bars: { gain: 2 } },
  }, ids);
  const look = entryLook(full);
  assert.equal(full.name, 'Opening');
  assert.equal(full.seconds, 45);
  assert.equal(look.inputs[1].patternId, 'tunnel');
  assert.equal(look.inputs[0].shape.shape, 'inside-out');
  assert.equal(look.inputs[1].shape.region, 'outer');
  assert.deepEqual(look.inputs[0].params, { gain: 2 });
  assert.equal(look.inputs[1].params, undefined, 'no saved settings: the input keeps its own when shown');
  assert.deepEqual(look.pair, { enabled: true, mode: 'add', amount: 1 });
  assert.deepEqual(look.shared, LOOK_DEFAULTS);
  // Read again, a version 2 entry is the same.
  assert.deepEqual(playlistEntry(JSON.parse(JSON.stringify(full)), ids), full);
  assert.throws(() => playlistEntry({ patternId: 'missing' }, ids), /playlist pattern/);
  assert.throws(() => playlistEntry({ patternId: 'bars', seconds: 0 }, ids), /time/);
  assert.throws(() => playlistEntry({ patternId: 'bars', mixer: { mode: 'nope' } }, ids), /blend mode/);
  assert.throws(() => playlistEntry({ patternId: 'bars', shapes: { a: { outline: 'star' } } }, ids), /outline/);
  assert.throws(() => playlistEntry(null, ids), /options object/);
});

test('version 2 entries hold options with moments, actions, and seconds or a place', () => {
  const pairLook = { kind: 'look', scope: 'pair', inputs: [{ patternId: 'plasma' }, { patternId: 'bars' }],
    pair: { enabled: true, mode: 'add', amount: 0.5 } };
  const cue = playlistEntry({
    version: 2, name: 'Drop', at: { marker: 'break', index: 2, bars: -8 },
    options: [{ moment: 'drop', actions: [pairLook, { kind: 'laser', show: 'spiral' }] }, { moment: 'drop', actions: [pairLook] }],
  }, ids);
  assert.deepEqual(cue.at, { marker: 'break', index: 2, bars: -8, beats: 0 });
  assert.equal(cue.seconds, undefined, 'a cue placed in bars has no seconds');
  assert.equal(cue.options.length, 2);
  assert.deepEqual(cue.options[0].actions[1], { kind: 'laser', show: 'spiral' }, 'an action of a later kind is kept');
  assert.equal(entryLook(cue).inputs[0].patternId, 'plasma');
  const v2 = (extra) => ({ version: 2, options: [{ actions: [pairLook] }], ...extra });
  assert.equal(playlistEntry(v2(), ids).seconds, DEFAULT_SECONDS);
  assert.equal(playlistEntry(v2(), ids).options[0].moment, null);
  assert.throws(() => playlistEntry(v2({ version: 3 }), ids), /version 3/);
  assert.throws(() => playlistEntry({ version: 2, options: [] }, ids), /options/);
  assert.throws(() => playlistEntry(v2({ options: [{ moment: 'chorus', actions: [pairLook] }] }), ids), /moment/);
  assert.throws(() => playlistEntry(v2({ options: [{ actions: [] }] }), ids), /actions/);
  assert.throws(() => playlistEntry(v2({ at: { marker: 'cue', bars: 4 } }), ids), /numbered/);
  assert.throws(() => playlistEntry(v2({ at: { marker: 'chorus' } }), ids), /marker/);
  assert.throws(() => playlistEntry(v2({ options: [{ actions: [{ ...pairLook, inputs: [{ patternId: 'gone' }, { patternId: 'bars' }] }] }] }), ids),
    /look pattern/);
  assert.throws(() => playlistEntry(v2({ options: [{ actions: [{ ...pairLook, scope: 'triple' }] }] }), ids), /scope/);
});

test('playlist settings validate lists, ids, the active playlist and the pair they play on', () => {
  assert.deepEqual(playlistSettings(undefined, ids), { lists: [], activeId: null, loop: true, shuffle: false, pair: 'left' });
  const settings = playlistSettings({
    lists: [{ id: 'one', name: 'Show', entries: [entry('bars')] }, { entries: [] }],
    activeId: 'gone', shuffle: true, pair: 'right',
  }, ids);
  assert.equal(settings.activeId, 'one', 'a missing active id falls back to the first playlist');
  assert.equal(settings.lists[1].id, 'playlist-2');
  assert.equal(settings.lists[1].name, 'Playlist 2');
  assert.equal(settings.shuffle, true);
  assert.equal(settings.pair, 'right');
  assert.throws(() => playlistSettings({ lists: [{ id: 'x', entries: [] }, { id: 'x', entries: [] }] }), /Duplicate/);
  assert.throws(() => playlistSettings({ lists: [{ id: 'x' }] }), /entries/);
  assert.throws(() => playlistSettings({ lists: [], loop: 'yes' }), /boolean/);
  assert.throws(() => playlistSettings({ lists: [], pair: 'middle' }), /Left or Right/);
  assert.throws(() => playlistSettings({ lists: [{ id: 'x', entries: [entry('missing')] }] }, ids), /playlist pattern/);
});

test('descriptions name both inputs, the blend, any transforms, the moment and the options', () => {
  const names = { plasma: 'Plasma', bars: 'Bars', tunnel: 'Tunnel', cells: 'Cells' };
  const name = id => names[id] ?? id;
  assert.equal(describeEntry(playlistEntry({ patternId: 'bars' }), name), 'Bars');
  assert.equal(describeEntry(playlistEntry({
    patternId: 'bars', mixer: { enabled: true, patternId: 'tunnel', mode: 'add', amount: 0.75 },
    shapes: { a: { region: 'centre' }, b: { shape: 'outside-in' } },
  }), name), 'Bars + Tunnel (add 75%) · shaped first and second');
  // The second input's transform is not mentioned while the pair shows the first alone.
  assert.equal(describeEntry(playlistEntry({ patternId: 'bars', shapes: { b: { region: 'outer' } } }), name), 'Bars');
  const quad = { kind: 'look', scope: 'quad',
    inputs: { a: { patternId: 'plasma' }, b: { patternId: 'bars' }, c: { patternId: 'tunnel' }, d: { patternId: 'cells' } },
    pairs: { left: {}, right: {} } };
  assert.equal(describeEntry(playlistEntry({ version: 2, options: [{ moment: 'drop', actions: [quad] }, { actions: [quad] }] }), name),
    'Whole quad: Plasma, Bars, Tunnel, Cells · drop · 2 options');
});

test('player advances by each entry\'s own time, loops, and stops at the end otherwise', () => {
  const list = [entry('plasma', 10), entry('bars', 5), entry('tunnel', 20)].map(e => playlistEntry(e, ids));
  const player = new PlaylistPlayer();
  assert.equal(player.playing, false);
  assert.equal(player.tick(0), null);
  assert.equal(shown(player.start(list, 1000)), 'plasma');
  assert.equal(player.playing, true);
  assert.equal(player.tick(10999), null);
  assert.equal(player.remainingSeconds(6000), 5);
  assert.equal(shown(player.tick(11000)), 'bars');
  assert.equal(player.tick(15999), null);
  assert.equal(shown(player.tick(16000)), 'tunnel');
  assert.equal(shown(player.tick(36000)), 'plasma', 'loops to the start');
  assert.equal(shown(player.skip(37000)), 'bars', 'skip moves on at once');
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

test('a cue list belongs to a track, is named by it, and is found by part of its name', () => {
  const settings = playlistSettings({ lists: [
    { id: 'c', name: 'ignored', track: { artist: '  Artist One ', title: 'Night Drive', isrc: 'usabc1234567', bpm: 124 },
      entries: [] },
    { id: 'p', name: 'Warm-up', entries: [] },
    { id: 'e', name: 'Empty track', track: { artist: '', title: '' }, entries: [] },
  ] }, ids);
  const [cue, plain, empty] = settings.lists;
  assert.equal(cue.name, 'Artist One – Night Drive');
  assert.deepEqual(cue.track, { artist: 'Artist One', title: 'Night Drive', isrc: 'USABC1234567', bpm: 124 });
  assert.equal('track' in plain, false);
  assert.equal('track' in empty, false, 'no artist and no title: an ordinary playlist');
  assert.equal(trackName({ artist: '', title: 'Solo' }), 'Solo');
  assert.ok(playlistMatches(cue, 'night'));
  assert.ok(playlistMatches(cue, ' ARTIST '));
  assert.ok(playlistMatches(plain, 'warm'));
  assert.ok(!playlistMatches(plain, 'night'));
  assert.ok(playlistMatches(plain, ''));
  assert.throws(() => trackOf({ artist: 'A', isrc: 'short' }), /ISRC/);
  assert.throws(() => trackOf({ artist: 'A', bpm: 9 }), /BPM/);
  // New cues go 16 bars after the last.
  assert.deepEqual(nextCuePlace([]), { marker: 'start', bars: 0, beats: 0 });
  assert.deepEqual(nextCuePlace([{ at: { marker: 'start', bars: 32, beats: 0 } }, { seconds: 10 }]),
    { marker: 'start', bars: 48, beats: 0 });
});
