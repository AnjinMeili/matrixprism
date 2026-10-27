// MIDI buttons for the beat (T64): a pad or key on any MIDI device marks the
// downbeat or taps the tempo, so the composer's bars can be lined up with the
// music's by hand when no outside clock gives them. Some DJ software sends no
// MIDI clock (forum posts say djay Pro syncs by Ableton Link only; not checked
// against its current version), so the operator presses a pad on the first
// beat of a bar: TempoTracker.markDownbeat, the same as the D key.
//
// The device is any that the browser's Web MIDI shows: Chrome and Edge do;
// Safari does not (the page says so). A control is learned: press Learn, then
// the pad, and its note (or controller number) on its channel is bound to the
// action and kept in the saved settings. MIDI clock and every other message
// are ignored.

export const MIDI_ACTIONS = [
  { id: 'downbeat', label: 'Downbeat', help: 'Mark this moment as the first beat of the bar; the tempo stays the tracker\'s' },
  { id: 'tap', label: 'Tap', help: 'Tap the tempo, as the T key does' },
  // A cue list (T76), for a pad on the DJ's controller or the VJ's.
  { id: 'cueGo', label: 'Cue list: Go', help: 'Start the cue list chosen in the Playlist view on this downbeat, its first' },
  { id: 'cueNext', label: 'Cue list: Next', help: 'The next cue, on the next bar line' },
  { id: 'cueBack', label: 'Cue list: Back', help: 'The cue before, on the next bar line' },
  { id: 'cueHold', label: 'Cue list: Hold', help: 'Stop the cue list where it is, as when the DJ loops; press again to go on' },
];

export const MIDI_DEFAULTS = { bindings: {} };

const KINDS = ['note', 'cc'];

// A binding is { kind: 'note' | 'cc', channel: 0 to 15, number: 0 to 127 }.
export function midiSettings(value = MIDI_DEFAULTS) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('MIDI settings must be an options object.');
  const bindings = {};
  const given = value.bindings ?? {};
  if (typeof given !== 'object' || Array.isArray(given)) throw new Error('MIDI bindings must be an object.');
  for (const [action, binding] of Object.entries(given)) {
    if (!MIDI_ACTIONS.some((a) => a.id === action)) throw new Error(`Unknown MIDI action: ${action}`);
    if (!binding || !KINDS.includes(binding.kind) || !Number.isInteger(binding.channel) ||
        binding.channel < 0 || binding.channel > 15 || !Number.isInteger(binding.number) ||
        binding.number < 0 || binding.number > 127)
      throw new Error(`The MIDI binding for ${action} is not a note or controller on a channel.`);
    bindings[action] = { kind: binding.kind, channel: binding.channel, number: binding.number };
  }
  return { bindings };
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// "Note 36 (C2), channel 1"; middle C (60) is C4.
export function describeBinding(binding) {
  if (!binding) return 'Not set';
  const where = `channel ${binding.channel + 1}`;
  if (binding.kind === 'cc') return `Controller ${binding.number}, ${where}`;
  const name = NOTE_NAMES[binding.number % 12] + (Math.floor(binding.number / 12) - 1);
  return `Note ${binding.number} (${name}), ${where}`;
}

// What a message is, if it can press a button: a note on with velocity, or a
// controller change (its value is read by MidiMap for the rising edge).
export function parseMessage(data) {
  if (!data || data.length < 3) return null;
  const type = data[0] & 0xf0, channel = data[0] & 0x0f;
  if (type === 0x90 && data[2] > 0) return { kind: 'note', channel, number: data[1], value: data[2] };
  if (type === 0xb0) return { kind: 'cc', channel, number: data[1], value: data[2] };
  return null;
}

const same = (a, b) => a && b && a.kind === b.kind && a.channel === b.channel && a.number === b.number;

// Turns messages into actions by the bindings, and learns bindings.
export class MidiMap {
  constructor(bindings = {}, onAction = () => {}, onLearned = () => {}) {
    this.bindings = { ...bindings };
    this.onAction = onAction;
    this.onLearned = onLearned;
    this.learning = null;
    this.controllers = new Map();
  }

  // The next press binds to `action`; null cancels.
  learn(action) {
    this.learning = action;
  }

  forget(action) {
    delete this.bindings[action];
  }

  // `data` is the message's bytes, `seconds` its time on the page's clock.
  handle(data, seconds) {
    const message = parseMessage(data);
    if (!message) return;
    // A controller presses on rising through 64, so a knob or a held pedal
    // does not repeat.
    let pressed = true;
    if (message.kind === 'cc') {
      const key = `${message.channel}:${message.number}`;
      pressed = message.value >= 64 && (this.controllers.get(key) ?? 0) < 64;
      this.controllers.set(key, message.value);
    }
    if (!pressed) return;
    const binding = { kind: message.kind, channel: message.channel, number: message.number };
    if (this.learning) {
      const action = this.learning;
      this.learning = null;
      for (const other of Object.keys(this.bindings)) if (same(this.bindings[other], binding)) delete this.bindings[other];
      this.bindings[action] = binding;
      this.onLearned(action, binding);
      return;
    }
    for (const [action, bound] of Object.entries(this.bindings))
      if (same(bound, binding)) this.onAction(action, seconds);
  }
}

// The browser's MIDI inputs, all listened to, handing each message to a
// MidiMap with its time on the page's clock (a message's timeStamp is
// performance.now()'s, in milliseconds). `status` says what to show.
export class MidiInput {
  // `options.requestAccess` stands in for the browser's (null: none), for tests.
  constructor(map, options = {}) {
    this.map = map;
    this.options = options;
    this.access = null;
    this.names = [];
    this.status = this.supported ? 'Not connected' : 'This browser has no Web MIDI (Chrome and Edge do; Safari does not)';
  }

  // Looked up each time, so a page that replaces it later is believed.
  get request() {
    if ('requestAccess' in this.options) return this.options.requestAccess;
    const navigator = globalThis.navigator;
    return navigator?.requestMIDIAccess ? navigator.requestMIDIAccess.bind(navigator) : null;
  }

  get supported() {
    return !!this.request;
  }

  async connect() {
    if (!this.request) return this.status;
    try {
      this.access = await this.request({ sysex: false });
    } catch (error) {
      this.status = `MIDI was not allowed: ${error.message ?? error}`;
      return this.status;
    }
    this.access.onstatechange = () => this.attach();
    this.attach();
    return this.status;
  }

  attach() {
    this.names = [];
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (event) => this.map.handle(event.data, event.timeStamp / 1000);
      this.names.push(input.name);
    }
    this.status = this.names.length ? `Listening to ${this.names.join(', ')}` : 'Connected; no MIDI device found';
  }
}
