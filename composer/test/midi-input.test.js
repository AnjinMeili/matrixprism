import assert from 'node:assert/strict';
import test from 'node:test';
import { MIDI_DEFAULTS, MidiInput, MidiMap, describeBinding, midiSettings, parseMessage } from '../public/midi-input.js';

// MIDI buttons for the beat (T64), on messages made by hand: no device here.

const noteOn = (channel, note, velocity = 100) => [0x90 | channel, note, velocity];
const cc = (channel, number, value) => [0xb0 | channel, number, value];

test('only a note on with velocity or a controller change can press a button', () => {
  assert.deepEqual(parseMessage(noteOn(2, 36)), { kind: 'note', channel: 2, number: 36, value: 100 });
  assert.equal(parseMessage(noteOn(0, 36, 0)), null, 'a note on at velocity 0 is a note off');
  assert.equal(parseMessage([0x80, 36, 64]), null);
  assert.equal(parseMessage([0xf8]), null, 'MIDI clock is ignored');
  assert.equal(parseMessage([0xe0, 0, 64]), null, 'pitch bend is ignored');
  assert.deepEqual(parseMessage(cc(15, 64, 127)), { kind: 'cc', channel: 15, number: 64, value: 127 });
  assert.equal(parseMessage(null), null);
});

test('a learned pad marks the downbeat at the time it was pressed, and nothing else does', () => {
  const heard = [], learned = [];
  const map = new MidiMap({}, (action, seconds) => heard.push([action, seconds]), (action, binding) => learned.push([action, binding]));
  map.handle(noteOn(0, 36), 1);
  assert.deepEqual(heard, [], 'nothing is bound yet');
  map.learn('downbeat');
  map.handle(noteOn(9, 40), 2);
  assert.deepEqual(learned, [['downbeat', { kind: 'note', channel: 9, number: 40 }]]);
  assert.deepEqual(heard, [], 'learning does not act');
  map.handle(noteOn(9, 40), 3.25);
  map.handle(noteOn(9, 41), 4);
  map.handle(noteOn(8, 40), 5);
  assert.deepEqual(heard, [['downbeat', 3.25]]);
});

test('a second action cannot share a pad: learning it takes the pad from the first', () => {
  const map = new MidiMap({ downbeat: { kind: 'note', channel: 0, number: 36 } });
  map.learn('tap');
  map.handle(noteOn(0, 36), 1);
  assert.deepEqual(map.bindings, { tap: { kind: 'note', channel: 0, number: 36 } });
});

test('a controller presses on rising through 64, once, and again after it has fallen', () => {
  const heard = [];
  const map = new MidiMap({ tap: { kind: 'cc', channel: 0, number: 64 } }, (action) => heard.push(action));
  for (const value of [0, 127, 127, 100, 0, 127]) map.handle(cc(0, 64, value), 0);
  assert.equal(heard.length, 2);
  for (const value of [10, 40, 63]) map.handle(cc(0, 64, value), 0);
  assert.equal(heard.length, 2, 'a knob turned low does not press');
});

test('forget unbinds', () => {
  const heard = [];
  const map = new MidiMap({ tap: { kind: 'note', channel: 0, number: 1 } }, (a) => heard.push(a));
  map.forget('tap');
  map.handle(noteOn(0, 1), 0);
  assert.deepEqual(heard, []);
});

test('settings keep only notes and controllers on channels, and say what they are', () => {
  assert.deepEqual(midiSettings(), MIDI_DEFAULTS);
  const kept = midiSettings({ bindings: { downbeat: { kind: 'note', channel: 9, number: 36, extra: 1 } } });
  assert.deepEqual(kept.bindings.downbeat, { kind: 'note', channel: 9, number: 36 });
  assert.throws(() => midiSettings({ bindings: { dance: { kind: 'note', channel: 0, number: 1 } } }), /Unknown MIDI action/);
  assert.throws(() => midiSettings({ bindings: { tap: { kind: 'note', channel: 16, number: 1 } } }), /not a note/);
  assert.throws(() => midiSettings({ bindings: { tap: { kind: 'note', channel: 0, number: 128 } } }), /not a note/);
  assert.throws(() => midiSettings([]), /options object/);
  assert.equal(describeBinding({ kind: 'note', channel: 9, number: 36 }), 'Note 36 (C2), channel 10');
  assert.equal(describeBinding({ kind: 'note', channel: 0, number: 60 }), 'Note 60 (C4), channel 1');
  assert.equal(describeBinding({ kind: 'cc', channel: 0, number: 64 }), 'Controller 64, channel 1');
  assert.equal(describeBinding(undefined), 'Not set');
});

test('the browser\'s inputs all feed the map with page-clock times, and the page says when there is no MIDI', async () => {
  const heard = [];
  const map = new MidiMap({ downbeat: { kind: 'note', channel: 0, number: 36 } }, (a, t) => heard.push([a, t]));
  const pad = { name: 'Pad', onmidimessage: null };
  const access = { inputs: new Map([['a', pad]]), onstatechange: null };
  const input = new MidiInput(map, { requestAccess: async () => access });
  assert.equal(input.status, 'Not connected');
  assert.match(await input.connect(), /Listening to Pad/);
  pad.onmidimessage({ data: noteOn(0, 36), timeStamp: 12500 });
  assert.deepEqual(heard, [['downbeat', 12.5]]);
  // A device plugged in later is picked up.
  const second = { name: 'Other', onmidimessage: null };
  access.inputs.set('b', second);
  access.onstatechange();
  second.onmidimessage({ data: noteOn(0, 36), timeStamp: 13000 });
  assert.equal(heard.length, 2);
  assert.match(input.status, /Pad, Other/);

  const none = new MidiInput(map, { requestAccess: null });
  assert.equal(none.supported, false);
  assert.match(none.status, /no Web MIDI/);
  assert.match(await none.connect(), /no Web MIDI/);
  const denied = new MidiInput(map, { requestAccess: async () => { throw new Error('denied'); } });
  assert.match(await denied.connect(), /not allowed: denied/);
});
