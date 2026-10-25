import { AudioAnalyzer, VOICE_PROCESSING, processingLeftOn } from './audio.js';
import { TempoMonitor } from './monitor.js';
import { SHARED_BAR_HISTORY } from './beat-graph.js';
import { PATTERNS } from './patterns.js';
import { Renderer } from './renderer.js';
import { keyColourHue, compatibleCamelotKeys, shownKey, keyAtCamelot } from './key-detector.js';
import { drawKeyWheel, segmentAt } from './key-wheel.js';
import { PALETTES } from './palettes.js';
import { SPECTRUM_DEFAULTS, spectrumOptions } from './spectrum-plot.js';
import { bindSpectrumControls } from './spectrum-controls.js';
import { overlaySettings } from './overlays.js';
import { bindOverlayControls } from './overlay-controls.js';
import {
  MEDIA_FITS, MediaSource, directoryFiles, media, mediaEntries, rememberMediaFile, recallMediaFile,
  forgetMediaFile, rememberMediaFolder, recallMediaFolder, forgetMediaFolder,
} from './media.js';
import {
  EDGE_RANGE, OUTLINES, PULSE_BEATS, PULSE_RANGE, REGIONS, SHAPES, SHAPE_DEFAULTS, SIZE_RANGE, SPINS,
  SPIN_REVERSALS, pulseBeatsName, shapeSettings, spinName, spinReverseName,
} from './shape.js';
import {
  BEAT_SOURCES, QUANTIZE, TAP_UNITS, TEMPO_DEFAULTS, TEMPO_MODES, TapTempo, changeAllowed, tempoSettings,
} from './tempo.js';
import { DEFAULT_SECONDS, MAX_ENTRIES, PlaylistPlayer, playlistSettings, unusedPlaylistId } from './playlist.js';
import { SendLimiter, receiverKey, receiverProfile, receiverSettings } from './receivers.js';
import { MIDI_ACTIONS, MIDI_DEFAULTS, MidiInput, MidiMap, describeBinding, midiSettings } from './midi-input.js';
import { HOTSAVE_DEFAULTS, HOTSAVE_PLAYLIST_NAME, hotsaveName, hotsaveSettings, lookOf } from './look.js';
import {
  RANDOMIZER_DEFAULTS, Randomizer, TRACKS, WAIT_UNITS, coverPanel, randomBlend, randomMedia, randomPattern, randomShape,
  randomizerSettings, waitLabel,
} from './randomizer.js';
import { bindPlaylistControls } from './playlist-controls.js';
import { BLEND_MODES, MIXER_DEFAULTS, blendModeIndex, mixerSettings } from './mixer.js';
import { describeVersion } from './version.js';
import { SPARKLE_COLOURS, SPARKLE_DEFAULTS, SPARKLE_PLACEMENTS, SPARKLE_SHAPES, sparkleLife, sparkleSettings } from './sparkle.js';
import { applyServerConfig } from './server-config.js';
import { changedParams } from './params.js';
import {
  defaultLook, inputSettings, masterSettings, pairSettings, quadFromSettings, quadSettings,
  resetInput as resetQuadInputTo, resetPair as resetQuadPairTo, swapLook, swappedInputs, wholeLook,
} from './quad.js';
import { QUAD_LAYOUT, layoutSettings } from './layout.js';
import { buildQuadView } from './quad-view.js';
import { helpPopover } from './help.js';
import { buildParamControls } from './param-controls.js';
import { PreviewRecorder } from './recording.js';

const STORAGE_KEY = 'matrix-companion-settings';
const READOUT_INTERVAL_MS = 250;
const DEFAULTS = {
  host: '',
  width: 256,
  height: 192,
  ddpPort: 4048,
  patternId: 'plasma',
  audioSource: 'simulated',
  gain: 1.5,
  brightness: 0.8,
  gamma: 1.0,
  speed: 1.0,
  hue: 0,
  fps: 30,
  autoCycle: false,
  cycleSeconds: 30,
  fadeSeconds: 2,
  blackOnStop: true,
  flockCount: null,
  auroraDotSize: null,
  keyColours: false,
  keyHold: true,
  keyLock: false,
  paletteId: 'original',
  paletteCycle: false,
  spectrumOptions: SPECTRUM_DEFAULTS,
  // Each pattern's own parameters that differ from its defaults (params.js),
  // by pattern id.
  patternParams: {},
  overlays: { enabled: true, elements: [] },
  view: 'patterns',
  mixer: MIXER_DEFAULTS,
  mediaFit: 'cover',
  silenceMode: 'standin',
  shapes: { a: SHAPE_DEFAULTS, b: SHAPE_DEFAULTS },
  playlists: { lists: [] },
  randomizer: RANDOMIZER_DEFAULTS,
  tempo: TEMPO_DEFAULTS,
  sparkles: SPARKLE_DEFAULTS,
  hotsave: HOTSAVE_DEFAULTS,
  midi: MIDI_DEFAULTS,
  // The most frames a second sent to the receiver in use (null: every frame
  // drawn), and each receiver's brightness, gamma and limit by host
  // (receivers.js).
  maxFps: null,
  receivers: {},
};

const $ = (id) => document.getElementById(id);

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const auroraDotSize = Object.hasOwn(saved, 'auroraDotSize') ? saved.auroraDotSize : saved.flockDotSize ?? null;
    delete saved.flockDotSize;
    return { ...DEFAULTS, ...saved, auroraDotSize };
  } catch {
    return { ...DEFAULTS };
  }
}

const settings = loadSettings();
settings.patternParams = cleanPatternParams(settings.patternParams);
// Each receiver's settings, checked before anything uses them; any dropped
// are named once the page is up (bindMatrixControls).
const { receivers: savedReceivers, dropped: droppedReceivers } = receiverSettings(settings.receivers);
settings.receivers = savedReceivers;
try {
  settings.maxFps = receiverProfile({ maxFps: settings.maxFps }).maxFps;
} catch {
  settings.maxFps = null;
}
Object.assign(settings, settings.receivers[receiverKey(settings.host)] ?? {});
// The quad mixer (T16): four inputs, two pairs and the master (quad.js). A,
// B and Left come from the one-pair settings (pattern, mixer, shapes,
// Pattern settings), which every view edits; C, D, Right, the master, each
// input's brightness and gamma, the layout and the default look are kept
// here.
try {
  settings.quad = quadFromSettings(settings, PATTERNS);
} catch {
  settings.quad = quadSettings({}, PATTERNS);
}
try {
  settings.quadLayout = layoutSettings(settings.quadLayout ?? QUAD_LAYOUT);
} catch {
  settings.quadLayout = layoutSettings(QUAD_LAYOUT);
}
try {
  settings.defaultLook = settings.defaultLook ? wholeLook(settings.defaultLook, PATTERNS) : null;
} catch {
  settings.defaultLook = null;
}

function syncQuad() {
  const quad = settings.quad;
  if (!quad) return;
  const mixer = settings.mixer ?? {};
  const params = settings.patternParams ?? {};
  for (const [id, patternId, shape] of [['a', settings.patternId, settings.shapes?.a],
    ['b', mixer.patternId ?? quad.inputs.b.patternId, settings.shapes?.b]]) {
    quad.inputs[id] = { ...quad.inputs[id], patternId, params: params[patternId] ?? {}, shape: shape ?? quad.inputs[id].shape };
  }
  quad.pairs.left = { enabled: !!mixer.enabled, mode: mixer.mode ?? quad.pairs.left.mode,
    amount: mixer.amount ?? quad.pairs.left.amount };
}
// The quad mixer's A, B and Left are copied in from the one-pair settings,
// which today's views edit, before each save (syncQuad).
const saveSettings = () => {
  syncQuad();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

const audio = new AudioAnalyzer();
// Recording and going live both hold the matrix size, the receiver and the
// audio input; only one runs at a time.
function syncCaptureControls() {
  const recordingBusy = recording.busy, liveBusy = live.busy;
  $('record').disabled = liveBusy || (recordingBusy && recording.state !== 'recording');
  $('go-live').disabled = !liveAvailable || recordingBusy || (liveBusy && live.state !== 'recording');
  for (const id of ['recording-encoder', 'live-size', 'live-width', 'live-height', 'width', 'height', 'detect', 'host', 'receiver-list', 'audio-source', 'audio-retake'])
    $(id).disabled = recordingBusy || liveBusy;
}
let liveAvailable = false;
const recording = new PreviewRecorder((result) => {
  $('record').textContent = result.state === 'recording' ? 'Stop recording' : 'Record';
  document.querySelector('.recording-bar').dataset.state = result.state;
  syncCaptureControls();
  const labels = { idle: 'Not recording', starting: 'Starting recording...', recording: 'Recording',
    stopping: 'Saving captured media...', finalizing: 'Encoding MP4...' };
  $('recording-status').textContent = result.state === 'saved' ? `Saved: ${result.file}`
    : result.state === 'error' ? `Recording failed: ${result.error}${result.directory ? ` (${result.directory})` : ''}`
    : `${labels[result.state] ?? result.state}${result.width ? ` - ${result.width}x${result.height}` : ''}`;
  $('recording-download').hidden = result.state !== 'saved';
  if (result.state === 'saved') $('recording-download').href = `/api/recordings/${result.id}/file`;
});
const live = new PreviewRecorder((result) => {
  $('go-live').textContent = result.state === 'recording' ? 'Stop live' : 'Go live';
  document.querySelector('.live-group').dataset.state = result.state;
  syncCaptureControls();
  const labels = { idle: 'Not live', starting: 'Going live...', recording: 'LIVE', stopping: 'Ending the stream...',
    finalizing: 'Ending the stream...', saved: 'The stream has ended' };
  $('live-status').textContent = result.state === 'error' ? `Live failed: ${result.error}`
    : `${labels[result.state] ?? result.state}${result.outWidth && result.state !== 'saved' ? ` - ${result.outWidth}x${result.outHeight}` : ''}`;
}, '/api/live', 12 * 3600 * 1000);
// The Monitor view's beat graph, tempo trace and log; fed every frame.
const monitor = new TempoMonitor(256, 192, SHARED_BAR_HISTORY);
let renderer;

const view = {
  pattern: PATTERNS.find((p) => p.id === settings.patternId) || PATTERNS[0],
  previousPattern: null,
  fadeStart: 0,
  time: 0,
  auroraTime: 0,
  lastSwitch: performance.now(),
  lastFrame: performance.now(),
  lastReport: performance.now(),
  rendered: 0,
  sent: 0,
  lastReadout: -Infinity,
  layer: null,
  keyHueOffset: 0,
  // Fades under way in the quad mixer.
  masterFade: null,
  pairFades: {},
  lastTempo: null,
  // The last Downbeat or Tap press: { kind, beat the tracker had, until }.
  pressed: null,
  paletteElapsed: 0,
};

const link = {
  socket: null, open: false, streaming: false, pendingStart: false, resume: false, reconnecting: false,
  // Why the display's size could not be read before this stream, if it could not.
  sizeWarning: '',
};

// A passing message, such as a Hotsave's, cleared after a few seconds.
let noticeTimer = null;
function showNotice(message) {
  $('notice').textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').textContent = ''; }, 4000);
}

function showError(message) {
  $('error').textContent = message || '';
}

function setStatus(text, kind) {
  const status = $('status');
  status.textContent = text;
  status.className = `pill ${kind || ''}`;
}

// ---------- receivers ----------

// Holds sending to the receiver's most frames a second.
const sendLimiter = new SendLimiter();

// Keeps the receiver in use's brightness, gamma and limit as they change.
function rememberReceiver() {
  const key = receiverKey(settings.host);
  if (!key) return;
  try {
    settings.receivers[key] = receiverProfile({
      brightness: settings.brightness, gamma: settings.gamma, maxFps: settings.maxFps,
    });
  } catch {
    // A value out of range is not kept; the controls hold it within range.
    return;
  }
  saveSettings();
}

// Takes up the settings kept for the receiver now chosen. One not seen
// before starts from the settings in use, and keeps them from then on.
function switchReceiver() {
  const profile = settings.receivers[receiverKey(settings.host)];
  if (profile) Object.assign(settings, profile);
  for (const id of ['brightness', 'gamma']) {
    $(id).value = settings[id];
    $(id).dispatchEvent(new Event('input'));
  }
  $('max-fps').value = settings.maxFps ?? '';
  sendLimiter.reset();
  rememberReceiver();
  receiverNote();
  renderReceiverList();
}

// What the last search found: receivers on the network (/api/receivers),
// and for each known receiver what it reported (/api/info), or null if it
// did not answer. Undefined until the first search.
const receiverSearch = { found: [], known: undefined, error: '' };

// Looks for receivers: asks the network, and each known receiver for its
// size, at the same time.
async function findReceivers() {
  $('receiver-status').textContent = 'Looking for receivers…';
  const known = Object.keys(settings.receivers);
  const [found, ...probes] = await Promise.allSettled([
    fetch('/api/receivers').then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      return body.receivers;
    }),
    ...known.map((key) => readMatrixSize(key)),
  ]);
  receiverSearch.found = found.status === 'fulfilled' ? found.value : [];
  receiverSearch.error = found.status === 'rejected' ? found.reason.message : '';
  receiverSearch.known = Object.fromEntries(known.map((key, i) =>
    [key, probes[i].status === 'fulfilled' ? probes[i].value : null]));
  renderReceiverList();
}

// The Receiver menu: known receivers with what they reported, then any found
// on the network that are not known yet.
function renderReceiverList() {
  const select = $('receiver-list');
  if (!select) return;
  const known = Object.keys(settings.receivers);
  const state = receiverSearch.known;
  const knownGroup = document.createElement('optgroup');
  knownGroup.label = 'Known';
  for (const key of known) {
    const info = state?.[key];
    const note = state === undefined || !(key in state) ? 'not checked' : info ?
      `online${info.name ? `, ${info.name}` : ''}, ${info.width}×${info.height}` : 'not answering';
    knownGroup.append(new Option(`${key} (${note})`, key));
  }
  const isKnown = (receiver) => known.includes(receiverKey(receiver.host)) || known.includes(receiverKey(receiver.address));
  const newOnes = receiverSearch.found.filter((receiver) => !isKnown(receiver));
  const foundGroup = document.createElement('optgroup');
  foundGroup.label = 'Found on the network';
  for (const receiver of newOnes) {
    const label = `${receiver.name || receiver.host} (${[receiver.host, receiver.address].filter(Boolean).join(', ')})`;
    foundGroup.append(new Option(label, receiver.host || receiver.address));
  }
  select.replaceChildren(new Option('Choose a receiver…', ''),
    ...(known.length ? [knownGroup] : []), ...(newOnes.length ? [foundGroup] : []));
  select.value = known.includes(receiverKey(settings.host)) ? receiverKey(settings.host) : '';
  if (state !== undefined) {
    const online = known.filter((key) => state[key]).length;
    $('receiver-status').textContent = receiverSearch.error ?
      `Could not search the network (${receiverSearch.error}). ${online} of ${known.length} known receivers answered.` :
      `${receiverSearch.found.length} found on the network, ${newOnes.length} of them new; ` +
      `${online} of ${known.length} known receivers answered.`;
  }
}

function receiverNote() {
  $('receiver-note').textContent = settings.host ?
    `Brightness and gamma are kept for ${settings.host}, with its frames a second on the Setup view.` :
    'Brightness and gamma are kept for each receiver once a host is set on the Setup view.';
}

// ---------- server link ----------

function connect() {
  const socket = new WebSocket(`ws://${location.host}/stream`);
  socket.binaryType = 'arraybuffer';
  link.socket = socket;
  socket.onopen = async () => {
    link.open = true;
    $('connection').textContent = 'server: connected';
    $('connection').className = 'pill ok';
    // A restarted server may name another receiver on its command line.
    if (link.reconnecting) await loadServerConfig();
    link.reconnecting = false;
    // Pick the stream back up after a composer server restart.
    if (link.resume) {
      link.resume = false;
      startStreaming();
    }
  };
  socket.onclose = () => {
    link.open = false;
    link.reconnecting = true;
    if (link.streaming || link.pendingStart) {
      stopStreaming(false);
      link.resume = true;
    }
    $('connection').textContent = 'server: disconnected — retrying';
    $('connection').className = 'pill bad';
    setTimeout(connect, 1500);
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'target' && link.pendingStart) {
      link.pendingStart = false;
      link.streaming = true;
      showError(link.sizeWarning);
      updateStreamButton();
    } else if (message.type === 'error') {
      showError(message.message);
      if (link.pendingStart) {
        link.pendingStart = false;
        updateStreamButton();
      }
    } else if (message.type === 'stats') {
      view.serverStats = message;
    }
  };
}

function updateStreamButton() {
  const button = $('stream');
  const active = link.streaming || link.pendingStart;
  button.textContent = link.pendingStart ? 'Connecting…' : active ? 'Stop streaming' : 'Start streaming';
  button.classList.toggle('live', active);
  if (link.streaming)
    setStatus(`streaming to ${settings.host} at ${settings.width}×${settings.height}`, 'live');
  else if (!link.pendingStart)
    setStatus('idle');
}

async function startStreaming() {
  if (!link.open) {
    showError('Composer server is not connected.');
    return;
  }
  if (!settings.host) {
    showError('Enter the matrix host first.');
    return;
  }
  if (link.pendingStart)
    return;
  link.pendingStart = true;
  updateStreamButton();
  // Always read the display's size before streaming (Anjin, 2026-10-15):
  // frames of the wrong size are drawn wrongly or not at all. If it cannot be
  // read, stream at the size set, and say so.
  const host = settings.host;
  link.sizeWarning = '';
  try {
    const found = await readMatrixSize(host);
    if (found.width !== settings.width || found.height !== settings.height)
      applyMatrixSize(found.width, found.height);
  } catch (error) {
    link.sizeWarning = `Could not read the display size of ${host} (${error.message}); ` +
      `streaming at ${settings.width}×${settings.height} as set.`;
  }
  // Stopped, or disconnected, while the size was being read.
  if (!link.pendingStart || !link.open)
    return;
  link.socket.send(JSON.stringify({
    type: 'target',
    host: settings.host,
    port: settings.ddpPort,
    width: settings.width,
    height: settings.height,
  }));
}

function stopStreaming(sendBlack) {
  link.resume = false;
  if (sendBlack && link.streaming && link.open)
    link.socket.send(new Uint8Array(settings.width * settings.height * 3));
  link.streaming = false;
  link.pendingStart = false;
  updateStreamButton();
}

// The display's size and name from the receiver's /json/info, through the
// server: { width, height, name }. Throws if it cannot be read.
async function readMatrixSize(host) {
  const response = await fetch(`/api/info?host=${encodeURIComponent(host)}`);
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function detectSize() {
  if (!settings.host) {
    showError('Enter the matrix host first.');
    return;
  }
  showError('');
  $('detect').textContent = 'Detecting…';
  try {
    const body = await readMatrixSize(settings.host);
    applyMatrixSize(body.width, body.height);
    setStatus(`found ${body.name || settings.host}: ${body.width}×${body.height}`, 'ok');
  } catch (error) {
    showError(`Detect failed: ${error.message}`);
  } finally {
    $('detect').textContent = 'Detect size';
  }
}

function applyMatrixSize(width, height) {
  if ((recording.busy || live.busy) && (width !== settings.width || height !== settings.height)) {
    $('width').value = settings.width;
    $('height').value = settings.height;
    showError('Stop recording or the live stream before changing the matrix dimensions.');
    return;
  }
  const wasStreaming = link.streaming;
  if (wasStreaming)
    stopStreaming(false);
  settings.width = width;
  settings.height = height;
  $('width').value = width;
  $('height').value = height;
  renderer.setSize(width, height);
  updateFlockControls();
  saveSettings();
  if (wasStreaming)
    startStreaming();
}

// ---------- patterns ----------

function selectPattern(pattern) {
  if (pattern === view.pattern)
    return;
  view.previousPattern = settings.fadeSeconds > 0 ? view.pattern : null;
  view.fadeStart = performance.now();
  view.pattern = pattern;
  view.lastSwitch = performance.now();
  settings.patternId = pattern.id;
  saveSettings();
  renderPatternButtons();
}

// Puts a pattern on A at once, with no crossfade from the one before, as a
// swap needs to keep the picture.
function cutToPattern(pattern) {
  view.previousPattern = null;
  if (pattern === view.pattern)
    return;
  view.pattern = pattern;
  view.lastSwitch = performance.now();
  settings.patternId = pattern.id;
  saveSettings();
  renderPatternButtons();
}

// Auto cycle passes over patterns with nothing to show, such as an empty
// media player, and over the ones chosen by hand only, such as the test card;
// stepping by hand still reaches them.
function stepPattern(direction, automatic = false) {
  let index = PATTERNS.indexOf(view.pattern);
  for (let tries = 0; tries < PATTERNS.length; ++tries) {
    index = (index + direction + PATTERNS.length) % PATTERNS.length;
    const pattern = PATTERNS[index];
    if (!automatic || !(pattern.manualOnly || (pattern.isReady && !pattern.isReady())))
      break;
  }
  selectPattern(PATTERNS[index]);
}

function renderPatternButtons() {
  const grid = $('patterns');
  if (!grid.children.length) {
    let group;
    for (const pattern of PATTERNS) {
      // Patterns that name a group sit under a heading of their own.
      if (pattern.group !== group) {
        group = pattern.group;
        if (group) {
          const heading = document.createElement('h3');
          heading.className = 'pattern-group';
          heading.textContent = group;
          grid.appendChild(heading);
        }
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = pattern.name;
      button.title = pattern.audio;
      button.dataset.id = pattern.id;
      button.addEventListener('click', () => selectPattern(pattern));
      grid.appendChild(button);
    }
  }
  for (const button of grid.querySelectorAll('button'))
    button.setAttribute('aria-pressed', String(button.dataset.id === view.pattern.id));
  $('pattern-help').textContent = `${view.pattern.name}: ${view.pattern.audio}`;
  // A mixed-in layer uses the same pattern settings, so show its panels too.
  const layer = mixerLayer();
  for (const group of ['flock', 'aurora', 'spectrum', 'media']) {
    $(`${group}-controls`).hidden = !view.pattern.controls?.includes(group) &&
      !layer?.pattern.controls?.includes(group);
  }
  renderParamControls(layer);
}

// The Pattern settings panel: the parameters each pattern declares for
// itself (params.js), for the pattern showing and for the mixer's layer B
// when that is another pattern. Rebuilt only when those patterns change, so a
// slider is not replaced while it is dragged.
function renderParamControls(layer) {
  const shown = [view.pattern, layer?.pattern].filter((pattern, i, all) =>
    pattern?.params?.length && all.indexOf(pattern) === i);
  const key = shown.map((pattern) => pattern.id).join(' ');
  if (key === view.paramKey) return;
  view.paramKey = key;
  const fields = $('param-fields');
  fields.replaceChildren();
  $('param-controls').hidden = !shown.length;
  for (const pattern of shown) {
    // Its Reset brings the channels showing it back to just the pattern, as
    // on the Mixer: A, and B while Left mixes; which, at the click.
    const inputs = () => ['a', 'b'].filter((id) => (id === 'a' ? view.pattern : view.layer?.pattern)?.id === pattern.id);
    buildParamControls(fields, pattern, settings.patternParams[pattern.id], (next) => {
      if (Object.keys(next).length) settings.patternParams[pattern.id] = next;
      else delete settings.patternParams[pattern.id];
      saveSettings();
    }, shown.length > 1 ? `${pattern === view.pattern ? 'Layer A' : 'Layer B'}: ${pattern.name}` : '', {
      label: 'Reset to just the pattern',
      title: 'Back to just the pattern, unmodified, on the layer showing it: its settings, shape, region, area, ' +
        'border, spin, pulse, brightness, gamma and hue',
      run: () => inputs().forEach(resetQuadInput),
    });
  }
}

// Saved pattern parameters, kept only for patterns that still exist and
// only where they differ from the defaults.
function cleanPatternParams(saved) {
  const clean = {};
  if (saved && typeof saved === 'object') {
    for (const pattern of PATTERNS) {
      const changed = changedParams(pattern, saved[pattern.id]);
      if (Object.keys(changed).length) clean[pattern.id] = changed;
    }
  }
  return clean;
}

// ---------- media ----------

// The folder the randomizer chooses media from: its name, its image and
// video files, and the one showing if it came from here.
const folder = { name: '', entries: [], current: null };
let mediaLoads = 0;

const mediaInfo = () => { $('media-info').textContent = media.describe(); };

function folderInfo() {
  const count = folder.entries.length;
  $('media-folder-info').textContent = !folder.name ? 'No folder chosen' :
    `${folder.name} · ${count} image and video ${count === 1 ? 'file' : 'files'}`;
  $('media-random').disabled = count === 0;
  $('media-folder-clear').disabled = !folder.name;
}

// Decodes a file and then puts it in place of the current media, so the old
// picture stays up meanwhile. Returns false if a later load overtook this
// one, and throws if the file cannot be decoded.
async function loadMedia(file) {
  const turn = ++mediaLoads;
  const next = new MediaSource();
  await next.load(file);
  if (turn !== mediaLoads) {
    next.clear();
    return false;
  }
  media.adopt(next);
  mediaInfo();
  return true;
}

// Shows another file from the folder. One the browser cannot decode is
// dropped from the folder and another is tried.
async function loadRandomMedia() {
  for (let tries = 0; tries < 5; ++tries) {
    const entry = randomMedia(folder.entries, folder.current);
    if (!entry)
      return;
    try {
      if (await loadMedia(entry.file))
        folder.current = entry;
      return;
    } catch (error) {
      showError(`${entry.path} failed to load: ${error.message}`);
      folder.entries = folder.entries.filter((other) => other !== entry);
      folderInfo();
    }
  }
}

function setMediaFolder(name, entries) {
  folder.name = name;
  folder.entries = mediaEntries(entries);
  folder.current = null;
  folderInfo();
  if (folder.entries.length)
    loadRandomMedia();
  else
    showError(`No image or video files were found in ${name}.`);
}

// True while the Media Player is on a layer and there is another file to
// change to.
function mediaShuffles() {
  const right = settings.quad.pairs.right.enabled ? ['c', 'd'] : ['c'];
  return folder.entries.length > 1 &&
    [view.pattern, view.layer?.pattern, ...right.map((id) => findPattern(settings.quad.inputs[id].patternId))]
      .some((pattern) => pattern?.controls?.includes('media'));
}

function bindMediaControls() {
  const load = async (file, remember) => {
    $('media-info').textContent = 'Loading…';
    try {
      if (await loadMedia(file)) {
        folder.current = null;
        showError('');
        // Keeping the file is a convenience; playback does not depend on it.
        if (remember)
          rememberMediaFile(file).catch(() => {});
      }
    } catch (error) {
      showError(`Media failed to load: ${error.message}`);
    }
    mediaInfo();
  };
  for (const [value, text] of MEDIA_FITS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    $('media-fit').appendChild(option);
  }
  if (!MEDIA_FITS.some(([value]) => value === settings.mediaFit))
    settings.mediaFit = DEFAULTS.mediaFit;
  $('media-fit').value = settings.mediaFit;
  $('media-fit').addEventListener('change', () => {
    settings.mediaFit = $('media-fit').value;
    saveSettings();
  });
  $('media-file').addEventListener('change', () => {
    const file = $('media-file').files[0];
    if (file)
      load(file, true);
  });
  $('media-clear').addEventListener('click', () => {
    ++mediaLoads;
    media.clear();
    folder.current = null;
    $('media-file').value = '';
    forgetMediaFile().catch(() => {});
    mediaInfo();
  });

  // A directory handle can be kept for the next visit; where the browser has
  // no folder picker, a folder input lists the files for this visit only.
  let remembered = null;
  const reopen = (handle) => {
    remembered = handle;
    $('media-folder-reopen').hidden = !handle;
    if (handle)
      $('media-folder-reopen').textContent = `Reopen folder ${handle.name}`;
  };
  const openHandle = async (handle) => {
    $('media-folder-info').textContent = 'Reading folder…';
    try {
      setMediaFolder(handle.name, await directoryFiles(handle));
      showError('');
    } catch (error) {
      showError(`Folder could not be read: ${error.message}`);
      folderInfo();
    }
  };
  $('media-folder').addEventListener('click', async () => {
    if (!window.showDirectoryPicker) {
      $('media-folder-input').click();
      return;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'read' });
    } catch {
      return;   // The picker was dismissed.
    }
    reopen(null);
    rememberMediaFolder(handle).catch(() => {});
    openHandle(handle);
  });
  $('media-folder-input').addEventListener('change', () => {
    const files = [...$('media-folder-input').files];
    if (!files.length)
      return;
    const path = (file) => file.webkitRelativePath || file.name;
    setMediaFolder(path(files[0]).split('/')[0], files.map((file) => ({ path: path(file), file })));
  });
  $('media-folder-reopen').addEventListener('click', async () => {
    const handle = remembered;
    if (await handle.requestPermission({ mode: 'read' }) !== 'granted')
      return;
    reopen(null);
    openHandle(handle);
  });
  $('media-folder-clear').addEventListener('click', () => {
    folder.name = '';
    folder.entries = [];
    folder.current = null;
    $('media-folder-input').value = '';
    reopen(null);
    forgetMediaFolder().catch(() => {});
    folderInfo();
  });
  $('media-random').addEventListener('click', loadRandomMedia);
  folderInfo();

  // The single saved file shows straight away. A remembered folder takes
  // over if the browser still allows it to be read, and otherwise waits for
  // the Reopen button, because asking for permission needs a click.
  recallMediaFile().then((file) => file && !folder.name && load(file, false)).catch(() => {});
  recallMediaFolder().then(async (handle) => {
    if (!handle || folder.name)
      return;
    if (await handle.queryPermission({ mode: 'read' }) === 'granted')
      openHandle(handle);
    else
      reopen(handle);
  }).catch(() => {});
}

// ---------- playlists ----------

const player = new PlaylistPlayer();
let playlistPanel = null;

let spectrumPanel = null;

// The patterns showing: layer A's, and layer B's when the mixer is on.
function shownPatternIds(patternId, mixer) {
  return [patternId, ...(mixer.enabled ? [mixer.patternId] : [])];
}

// The look on screen now, as a playlist entry: the patterns, mixer and
// shapes, the look settings (look.js) and each shown pattern's parameters.
function currentLook() {
  const params = {};
  for (const id of shownPatternIds(view.pattern.id, settings.mixer))
    params[id] = settings.patternParams[id] ?? {};
  return {
    name: '', patternId: view.pattern.id, seconds: DEFAULT_SECONDS,
    mixer: settings.mixer, shapes: settings.shapes, look: lookOf(settings), params,
  };
}

// Shows the look settings in their controls after they were changed from
// outside them, as by a playlist entry. Each control's own handler is run, so
// its readout and anything that follows from it are brought up to date.
function syncLookControls() {
  const fire = (id, type, set) => {
    set($(id));
    $(id).dispatchEvent(new Event(type));
  };
  fire('hue', 'input', (input) => { input.value = settings.hue; });
  fire('speed', 'input', (input) => { input.value = settings.speed; });
  fire('pattern-palette', 'change', (select) => { select.value = settings.paletteId; });
  fire('palette-cycle', 'change', (box) => { box.checked = settings.paletteCycle; });
  fire('key-colours', 'change', (box) => { box.checked = settings.keyColours; });
  updateFlockControls();
  syncSparkleControls();
  spectrumPanel?.set(settings.spectrumOptions);
  audio.configurePlot(settings.spectrumOptions.fftSize, audio.plotEnabled);
}

// Puts a playlist entry on screen: layer A crossfades as for any pattern
// change, and the mixer and both shapes switch with it.
function applyLook(entry) {
  const pattern = PATTERNS.find((p) => p.id === entry.patternId);
  if (!pattern)
    return;
  settings.mixer = mixerSettings(entry.mixer, PATTERNS.map((p) => p.id));
  settings.shapes = { a: shapeSettings(entry.shapes.a), b: shapeSettings(entry.shapes.b) };
  // Entries saved before looks were kept have neither; what is set stays.
  if (entry.params) {
    for (const id of shownPatternIds(entry.patternId, settings.mixer)) {
      const changed = changedParams(PATTERNS.find((p) => p.id === id), entry.params[id]);
      if (Object.keys(changed).length) settings.patternParams[id] = changed;
      else delete settings.patternParams[id];
    }
    // Rebuild Pattern settings even if the patterns are the same.
    view.paramKey = null;
  }
  if (entry.look) {
    Object.assign(settings, entry.look);
    syncLookControls();
  }
  selectPattern(pattern);
  updateMixerControls();
  saveSettings();
}

function activePlaylist() {
  return settings.playlists.lists.find((list) => list.id === settings.playlists.activeId) ?? null;
}

const playlistOptions = () => ({ loop: settings.playlists.loop, shuffle: settings.playlists.shuffle });

// Validates, stores and applies edited playlist settings.
function commitPlaylists(next) {
  settings.playlists = playlistSettings(next, PATTERNS.map((pattern) => pattern.id));
  // Edits to the playlist that is playing take effect without a restart.
  if (player.playing)
    player.update(activePlaylist()?.entries ?? [], playlistOptions());
  saveSettings();
  renderHotsaveControls();
}

// Hotsave: adds the look on screen, with everything that makes it, to the
// Hotsave playlist as a new entry named for the time. The playlist is made
// on first use, or again if it was deleted. What is playing carries on.
function hotsave() {
  try {
    let next = settings.playlists;
    let list = next.lists.find((each) => each.id === settings.hotsave.playlistId);
    if (!list) {
      list = { id: unusedPlaylistId(next.lists), name: HOTSAVE_PLAYLIST_NAME, entries: [] };
      next = { ...next, lists: [...next.lists, list] };
    }
    if (list.entries.length >= MAX_ENTRIES)
      throw new Error(`the playlist "${list.name}" is full, at ${MAX_ENTRIES} entries.`);
    const entry = { ...currentLook(), name: hotsaveName(new Date()) };
    commitPlaylists({
      ...next, lists: next.lists.map((each) => each.id === list.id ? { ...list, entries: [...list.entries, entry] } : each),
    });
    settings.hotsave = { ...settings.hotsave, playlistId: list.id };
    saveSettings();
    playlistPanel?.refresh();
    renderHotsaveControls();
    showNotice(`Hotsaved "${entry.name}" to the playlist "${list.name}", entry ${list.entries.length + 1}.`);
  } catch (error) {
    showError(`Hotsave failed: ${error.message}`);
  }
}

// The Hotsave panel's playlist menu: each playlist, or a new one.
function renderHotsaveControls() {
  const select = $('hotsave-playlist');
  if (!select) return;
  const known = settings.playlists.lists.some((list) => list.id === settings.hotsave.playlistId);
  select.replaceChildren(
    new Option(`A new playlist called ${HOTSAVE_PLAYLIST_NAME}`, ''),
    ...settings.playlists.lists.map((list) => new Option(list.name, list.id)));
  select.value = known ? settings.hotsave.playlistId : '';
}

// MIDI buttons for the downbeat and tap (midi-input.js, T64): learned pads,
// kept in the settings. Chrome and Edge only; the page says so elsewhere.
const midiActions = { downbeat: (seconds) => markDownbeat(seconds), tap: (seconds) => tapTempo(seconds) };
let midi = null;

function renderMidiControls() {
  $('midi-status').textContent = midi.input.status;
  $('midi-connect').hidden = !midi.input.supported || !!midi.input.access;
  for (const { id } of MIDI_ACTIONS) {
    const learning = midi.map.learning === id;
    document.querySelector(`[data-midi-learn="${id}"]`).textContent = learning ? 'Press a pad…' : 'Learn';
    $(`midi-binding-${id}`).textContent = describeBinding(midi.map.bindings[id]);
  }
}

function bindMidiControls() {
  try {
    settings.midi = midiSettings(settings.midi);
  } catch (error) {
    showError(`Saved MIDI settings were invalid: ${error.message} Restored the defaults.`);
    settings.midi = midiSettings();
  }
  const save = () => {
    settings.midi = { bindings: { ...midi.map.bindings } };
    saveSettings();
    renderMidiControls();
  };
  const map = new MidiMap(settings.midi.bindings, (action, seconds) => midiActions[action](seconds), save);
  midi = { map, input: new MidiInput(map) };
  $('midi-connect').addEventListener('click', async () => {
    await midi.input.connect();
    renderMidiControls();
  });
  for (const { id } of MIDI_ACTIONS) {
    document.querySelector(`[data-midi-learn="${id}"]`).addEventListener('click', () => {
      map.learn(map.learning === id ? null : id);
      renderMidiControls();
    });
    document.querySelector(`[data-midi-forget="${id}"]`).addEventListener('click', () => {
      map.forget(id);
      save();
    });
  }
  renderMidiControls();
  // Listening again where the browser already allows it, without asking.
  navigator.permissions?.query({ name: 'midi' }).then((permission) => {
    if (permission.state === 'granted' && settings.midi.bindings && Object.keys(settings.midi.bindings).length)
      midi.input.connect().then(renderMidiControls);
  }).catch(() => {});
}

function bindHotsaveControls() {
  try {
    settings.hotsave = hotsaveSettings(settings.hotsave);
  } catch (error) {
    showError(`Saved Hotsave settings were invalid: ${error.message} Restored the defaults.`);
    settings.hotsave = hotsaveSettings();
  }
  const key = $('hotsave-key');
  key.value = settings.hotsave.key.toUpperCase();
  key.addEventListener('change', () => {
    try {
      settings.hotsave = hotsaveSettings({ ...settings.hotsave, key: key.value });
      showError('');
      saveSettings();
    } catch (error) {
      showError(error.message);
    }
    key.value = settings.hotsave.key.toUpperCase();
  });
  $('hotsave-playlist').addEventListener('change', () => {
    settings.hotsave = { ...settings.hotsave, playlistId: $('hotsave-playlist').value || null };
    saveSettings();
  });
  $('hotsave-now').addEventListener('click', hotsave);
  renderHotsaveControls();
}

function bindPlaylistPanel() {
  const patternIds = PATTERNS.map((pattern) => pattern.id);
  try {
    settings.playlists = playlistSettings(settings.playlists, patternIds);
  } catch (error) {
    showError(`Saved playlists were invalid: ${error.message} Starting with none.`);
    settings.playlists = playlistSettings(undefined, patternIds);
  }
  playlistPanel = bindPlaylistControls($('playlist-fields'), {
    get: () => settings.playlists,
    commit: commitPlaylists,
    currentLook,
    show: applyLook,
    play: (index) => {
      const entry = player.start(activePlaylist()?.entries ?? [], performance.now(), { ...playlistOptions(), index });
      if (entry)
        applyLook(entry);
    },
    stop: () => player.stop(),
    skip: () => {
      const entry = player.skip(performance.now());
      if (entry)
        applyLook(entry);
    },
    player,
    now: () => performance.now(),
    patternName: (id) => PATTERNS.find((pattern) => pattern.id === id)?.name ?? id,
    showError,
  });
}

// ---------- tempo ----------

function changeTempo(next) {
  try {
    settings.tempo = tempoSettings({ ...settings.tempo, ...next });
    showError('');
    saveSettings();
  } catch (error) {
    showError(error.message);
  }
  $('tempo-mode').value = settings.tempo.mode;
  $('tempo-source').value = settings.tempo.source;
  $('tempo-manual').value = settings.tempo.manualBpm;
  audio.setBeatSource(settings.tempo.source);
}

const beatSource = () => BEAT_SOURCES.find((source) => source.id === settings.tempo.source);

// Tap tempo, from the Mixer's Tap button or the T key. Each tap pulls the
// beat, or the bar line, into step; two or more set the manual tempo and put
// it in charge.
const taps = new TapTempo();

// The operator marks the downbeat: this moment is the first beat of a bar
// (TempoTracker.markDownbeat); the tempo stays the tracker's.
// `at` is the press's time on the page's clock when it is known better than
// now, as a MIDI message's is (the controls call these with nothing).
const pressTime = (at) => (typeof at === 'number' ? at : performance.now() / 1000);

function markDownbeat(at) {
  const seconds = pressTime(at);
  // Say which beat the tracker had at the press: beat 1 means it was lined up
  // already, anything else is how far it moves (Monitor).
  view.pressed = { kind: 'Downbeat', beat: view.lastTempo ? view.lastTempo.beatInBar + 1 : null, until: seconds + 4 };
  audio.tempo.markDownbeat(seconds);
}

function tapTempo(at) {
  const seconds = pressTime(at);
  view.pressed = { kind: 'Tap', beat: view.lastTempo ? view.lastTempo.beatInBar + 1 : null, until: seconds + 2 };
  const { beats } = TAP_UNITS.find((unit) => unit.id === settings.tempo.tap);
  audio.tempo.tap(seconds, beats);
  const bpm = taps.tap(seconds, beats);
  if (bpm !== null)
    changeTempo({ mode: 'manual', manualBpm: bpm });
}

function bindTempoControls() {
  try {
    settings.tempo = tempoSettings(settings.tempo);
  } catch (error) {
    showError(`Saved tempo settings were invalid: ${error.message} Restored defaults.`);
    settings.tempo = tempoSettings();
  }
  audio.setBeatSource(settings.tempo.source);
  const change = changeTempo;
  for (const [id, key, choices] of [['tempo-mode', 'mode', TEMPO_MODES], ['tempo-source', 'source', BEAT_SOURCES],
    ['tempo-quantize', 'quantize', QUANTIZE]]) {
    for (const choice of choices) {
      const option = document.createElement('option');
      option.value = choice.id;
      option.textContent = choice.name;
      $(id).appendChild(option);
    }
    $(id).value = settings.tempo[key];
    $(id).addEventListener('change', () => change({ [key]: $(id).value }));
  }
  $('tempo-manual').value = settings.tempo.manualBpm;
  $('tempo-manual').addEventListener('change', () => {
    if ($('tempo-manual').checkValidity())
      change({ manualBpm: Number($('tempo-manual').value) });
    else
      showError('Manual tempo must be a whole number from 40 to 240 BPM.');
  });
}

// While the Essentia source is chosen but not yet in charge, why not.
const ESSENTIA_STATES = {
  loading: 'loading Essentia', waiting: 'Essentia waiting for 10 s of audio',
  running: 'Essentia has not found a beat',
};
function essentiaNote() {
  if (settings.tempo.source !== 'essentia' || settings.tempo.mode === 'manual') return '';
  if (audio.mode !== 'device') return ' (Essentia needs a live input)';
  const status = audio.essentiaStatus;
  return status === 'off' ? '' : ` (${ESSENTIA_STATES[status] ?? status})`;
}

function tempoReadout(tempo) {
  $('tempo-readout').textContent = `${Math.round(tempo.bpm)} BPM · ` +
    (tempo.detected ? `detected from ${beatSource().label} (${settings.tempo.source === 'essentia' ?
      `confidence ${Math.round(tempo.confidence * 100)}%` : `${Math.round(tempo.confidence * 100)}% of recent beats agree`})` :
      settings.tempo.mode === 'manual' ? 'manual' : `manual until a steady beat is heard${essentiaNote()}`) +
    ` · beat ${tempo.beatInBar + 1} of 4 · ${tempo.barsSinceChange} bars since the music last changed`;
}

// ---------- randomizer ----------

const randomizer = new Randomizer();

// Patterns the randomizer may choose now: not the ones chosen by hand only,
// and not ones that would draw nothing because there is no audio for them.
function randomCandidates() {
  const silent = audio.mode === 'none';
  return PATTERNS.filter((pattern) => !pattern.manualOnly && (!silent ||
    !(pattern.needsAudio || (pattern.audioReactive && settings.silenceMode === 'quiet'))));
}

// Applies the changes that have come due, one per track.
function applyRandomChanges(tracks) {
  // A lone layer limited to a region leaves the rest of the panel black; this
  // can be left over from when the mixer was on.
  if (settings.randomizer.enabled && settings.randomizer.tracks.shapeA && !settings.mixer.enabled &&
      settings.shapes.a.region !== 'full') {
    settings.shapes = { ...settings.shapes, a: shapeSettings({ ...settings.shapes.a, region: 'full' }) };
    quad.view?.refresh();
    saveSettings();
  }
  // The same for C on the quad mixer's Right while its mixing is off.
  const right = settings.quad.pairs.right;
  if (settings.randomizer.enabled && settings.randomizer.tracks.shapeC && !right.enabled &&
      settings.quad.inputs.c.shape.region !== 'full')
    setQuadInput('c', { shape: { ...settings.quad.inputs.c.shape, region: 'full' } });
  if (!tracks.length)
    return;
  const patternIds = PATTERNS.map((pattern) => pattern.id);
  const candidates = randomCandidates();
  const showing = [view.pattern.id, settings.mixer.patternId,
    settings.quad.inputs.c.patternId, settings.quad.inputs.d.patternId];
  // A layer that turns to the Media Player gets a new file from the folder,
  // as does the media track's own timer.
  let newMedia = false;
  for (const track of tracks) {
    if (track === 'patternA') {
      const pattern = randomPattern(candidates, showing);
      if (pattern)
        selectPattern(pattern);
      newMedia ||= !!pattern?.controls?.includes('media');
    } else if (track === 'patternB') {
      const pattern = randomPattern(candidates, showing);
      if (pattern)
        settings.mixer = mixerSettings({ ...settings.mixer, patternId: pattern.id }, patternIds);
      newMedia ||= !!pattern?.controls?.includes('media');
    } else if (track === 'patternC' || track === 'patternD') {
      const pattern = randomPattern(candidates, showing);
      if (pattern)
        setQuadInput(track === 'patternC' ? 'c' : 'd', { patternId: pattern.id });
      newMedia ||= !!pattern?.controls?.includes('media');
    } else if (track === 'shapeC' || track === 'shapeD') {
      // As for A and B: C and D between them cover the panel.
      const input = track === 'shapeC' ? 'c' : 'd';
      const shapes = coverPanel({
        c: settings.quad.inputs.c.shape, d: settings.quad.inputs.d.shape,
        [input]: shapeSettings(randomShape(Math.random, right.enabled)),
      }, input);
      for (const id of ['c', 'd'])
        if (shapes[id] !== settings.quad.inputs[id].shape) setQuadInput(id, { shape: shapes[id] });
    } else if (track === 'blendRight') {
      setQuadPair('right', randomBlend());
    } else if (track === 'media') {
      newMedia = true;
    } else if (track === 'blend') {
      settings.mixer = mixerSettings({ ...settings.mixer, ...randomBlend() }, patternIds);
    } else if (track === 'shapeA' || track === 'shapeB') {
      const layer = track === 'shapeA' ? 'a' : 'b';
      // Keep the whole panel covered: if both layers end up with regions,
      // the other layer takes the complement of this one's area.
      settings.shapes = coverPanel({
        ...settings.shapes,
        [layer]: shapeSettings(randomShape(Math.random, settings.mixer.enabled)),
      }, layer);
    } else if (track === 'colour') {
      settings.hue = Math.round(Math.random() * 100) / 100;
      settings.paletteId = PALETTES[Math.floor(Math.random() * PALETTES.length)].id;
      view.paletteElapsed = 0;
      $('hue').value = settings.hue;
      $('hue-value').textContent = `${Math.round(settings.hue * 360)}°`;
      $('pattern-palette').value = settings.paletteId;
    }
  }
  if (newMedia)
    loadRandomMedia();
  updateMixerControls();
  saveSettings();
}

function randomizerStatus() {
  const now = performance.now();
  $('randomizer-status').textContent = !settings.randomizer.enabled ? '' :
    player.playing ? 'Paused while a playlist plays' :
      TRACKS.map((track) => [track, randomizer.remaining(track.id, settings.randomizer, now, view.beatPosition)])
        .filter(([, left]) => left !== null)
        .map(([track, left]) => `${track.name}: ${waitLabel(left, settings.randomizer.unit)}`).join(' · ');
}

// Changes the randomizer's settings from the Playlist view or the quad
// mixer's panes, and keeps both in step.
function changeRandomizer(next) {
  try {
    settings.randomizer = randomizerSettings({ ...settings.randomizer, ...next });
    showError('');
    saveSettings();
  } catch (error) {
    showError(error.message);
  }
  $('randomizer-enabled').checked = settings.randomizer.enabled;
  $('randomizer-min').value = settings.randomizer.minWait;
  $('randomizer-max').value = settings.randomizer.maxWait;
  $('randomizer-unit').value = settings.randomizer.unit;
  for (const track of TRACKS)
    $(`randomizer-${track.id}`).checked = settings.randomizer.tracks[track.id];
  quad.view?.refresh();
}

function bindRandomizerControls() {
  try {
    settings.randomizer = randomizerSettings(settings.randomizer);
  } catch (error) {
    showError(`Saved randomizer settings were invalid: ${error.message} Restored defaults.`);
    settings.randomizer = randomizerSettings();
  }
  $('randomizer-enabled').checked = settings.randomizer.enabled;
  $('randomizer-enabled').addEventListener('change', () => changeRandomizer({ enabled: $('randomizer-enabled').checked }));
  for (const [id, key] of [['randomizer-min', 'minWait'], ['randomizer-max', 'maxWait']]) {
    $(id).value = settings.randomizer[key];
    $(id).addEventListener('change', () => {
      if ($(id).checkValidity())
        changeRandomizer({ [key]: Number($(id).value) });
      else
        showError('Randomizer waits must be whole numbers from 1 to 3600.');
    });
  }
  $('randomizer-unit').replaceChildren(...WAIT_UNITS.map((unit) => new Option(unit.name, unit.id)));
  $('randomizer-unit').value = settings.randomizer.unit;
  $('randomizer-unit').addEventListener('change', () => changeRandomizer({ unit: $('randomizer-unit').value }));
  for (const track of TRACKS) {
    const label = document.createElement('label');
    label.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = `randomizer-${track.id}`;
    box.checked = settings.randomizer.tracks[track.id];
    box.addEventListener('change', () =>
      changeRandomizer({ tracks: { ...settings.randomizer.tracks, [track.id]: box.checked } }));
    label.append(box, track.name);
    $('randomizer-tracks').appendChild(label);
  }
}

// ---------- layer shape ----------

// A and B's shapes from saved settings; the Mixer's panes show and change
// them (quad-view.js).
function loadShapeSettings() {
  const saved = settings.shapes && typeof settings.shapes === 'object' ? settings.shapes : {};
  settings.shapes = {};
  for (const layer of ['a', 'b']) {
    try {
      settings.shapes[layer] = shapeSettings(saved[layer]);
    } catch (error) {
      showError(`Saved layer shape was invalid: ${error.message} Restored defaults.`);
      settings.shapes[layer] = shapeSettings();
    }
  }
}

// ---------- mixer ----------

// The second layer for the renderer, or null while the mixer is off.
function mixerLayer() {
  const mixer = settings.mixer;
  if (!mixer.enabled)
    return null;
  const pattern = PATTERNS.find((p) => p.id === mixer.patternId);
  return pattern ? {
    pattern, mode: blendModeIndex(mixer.mode), amount: mixer.amount, shape: settings.shapes.b,
  } : null;
}

// After the one-pair mixer or a shape changes: the layer for the renderer,
// the Patterns view's buttons and the Mixer's panes.
function updateMixerControls() {
  view.layer = mixerLayer();
  renderPatternButtons();
  quad.view?.refresh();
}

// The one-pair mixer, which is the quad mixer's Left: B, the blend, the amount.
function changeMixer(next) {
  settings.mixer = mixerSettings({ ...settings.mixer, ...next }, PATTERNS.map((pattern) => pattern.id));
  updateMixerControls();
  saveSettings();
}

// The one-pair mixer from saved settings.
function loadMixerSettings() {
  const patternIds = PATTERNS.map((pattern) => pattern.id);
  try {
    settings.mixer = mixerSettings(settings.mixer, patternIds);
  } catch (error) {
    showError(`Saved mixer settings were invalid: ${error.message} Restored defaults.`);
    settings.mixer = mixerSettings(undefined, patternIds);
  }
  updateMixerControls();
}

// ---------- audio ----------

async function populateAudioInputs() {
  const select = $('audio-source');
  const inputs = await AudioAnalyzer.listInputs().catch(() => []);
  select.innerHTML = '';
  const add = (value, label) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  };
  add('none', 'None (patterns only)');
  add('simulated', 'Simulated 120 BPM');
  inputs.forEach((input, index) =>
    add(`device:${input.deviceId}`, input.label || `Audio input ${index + 1}`));
  if ([...select.options].some((option) => option.value === settings.audioSource))
    select.value = settings.audioSource;
  else
    select.value = 'none';
}

async function selectAudioSource(value) {
  if (recording.busy || live.busy) {
    $('audio-source').value = settings.audioSource;
    showError('Stop recording or the live stream before changing the audio input.');
    return;
  }
  showError('');
  try {
    if (value === 'simulated') {
      audio.startSimulated();
    } else if (value.startsWith('device:')) {
      await audio.startDevice(value.slice('device:'.length));
      // Device labels are only revealed after permission is granted.
      settings.audioSource = value;
      await populateAudioInputs();
    } else {
      audio.stop();
    }
    settings.audioSource = value;
  } catch (error) {
    audio.stop();
    settings.audioSource = 'none';
    $('audio-source').value = 'none';
    showError(`Audio input failed: ${error.message}`);
  }
  saveSettings();
}

// The line under the meter: channels, the voice processing the browser
// applied, and whether the browser has muted or stopped the input.
function audioInputHint() {
  if (audio.mode === 'none') return '';
  if (audio.mode === 'simulated') return 'Simulated stereo signal';
  if (audio.inputState === 'muted')
    return 'Muted by the browser: another page is using this input. ' +
      'Safari lets one page use it at a time.';
  if (audio.inputState === 'ended')
    return 'The input has stopped: the device was removed or the browser closed it.';
  const channels = audio.stereo ? 'Stereo input: left and right analysed separately' :
    'Mono input: the same spectrum is used for left and right';
  const applied = audio.inputSettings ?? {};
  if (!VOICE_PROCESSING.some(([name]) => name in applied)) return channels;
  const leftOn = processingLeftOn(applied);
  return `${channels} · ${leftOn.length ? `the browser left ${leftOn.join(', ')} on` : 'voice processing off'}`;
}

function drawMeter(features) {
  const canvas = $('meter');
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  const bars = audio.spectrum.length;
  const barWidth = (width - 60) / bars;
  context.fillStyle = '#5ad1ff';
  for (let i = 0; i < bars; ++i) {
    const h = (audio.spectrum[i] / 255) * height;
    context.fillRect(i * barWidth, height - h, Math.max(1, barWidth), h);
  }
  const bands = [['B', features.bass, '#ff7a59'], ['M', features.mid, '#ffd166'],
    ['T', features.treble, '#7ef0a8'], ['♪', features.beat, '#ffffff']];
  bands.forEach(([, value, color], i) => {
    context.fillStyle = color;
    const h = value * height;
    context.fillRect(width - 56 + i * 14, height - h, 10, h);
  });
}

// ---------- controls ----------

// `after` runs after each change, as for settings kept per receiver.
function bindRange(id, key, format, after = null) {
  const input = $(id);
  const output = $(`${id}-value`);
  input.value = settings[key];
  const update = () => {
    settings[key] = Number(input.value);
    if (output)
      output.textContent = format(settings[key]);
    saveSettings();
    after?.();
  };
  input.addEventListener('input', update);
  update();
}

function updateFlockControls() {
  const automaticCount = settings.flockCount === null;
  const automaticDot = settings.auroraDotSize === null;
  $('flock-count-auto').checked = automaticCount;
  $('flock-count').value = settings.flockCount ?? Math.min(256, Math.max(1, Math.floor(settings.width / 3)));
  $('aurora-dot-auto').checked = automaticDot;
  const diameter = settings.auroraDotSize ?? (settings.width === 32 && settings.height === 32 ? 1 :
    Math.max(1, Math.min((settings.width - 1) / 31, (settings.height - 1) / 31) * 0.8));
  $('aurora-dot').value = diameter;
  $('aurora-dot-value').textContent = automaticDot ? 'Automatic' : `${diameter.toFixed(1)} px`;
}

function bindPanelControls() {
  try {
    settings.overlays = overlaySettings(settings.overlays);
  } catch (error) {
    showError(`Saved overlays were invalid: ${error.message} Restored an empty overlay layer.`);
    settings.overlays = overlaySettings();
  }
  bindOverlayControls($('overlay-fields'), settings.overlays, next => {
    settings.overlays = next;
    saveSettings();
  }, showError);
  try {
    settings.spectrumOptions = spectrumOptions(settings.spectrumOptions);
  } catch (error) {
    showError(`Saved spectrum settings were invalid: ${error.message} Restored defaults.`);
    settings.spectrumOptions = spectrumOptions();
  }
  spectrumPanel = bindSpectrumControls($('spectrum-fields'), settings.spectrumOptions, next => {
    audio.configurePlot(next.fftSize, audio.plotEnabled);
    settings.spectrumOptions = next;
    saveSettings();
  }, showError);
}

function bindMatrixControls() {
  if (droppedReceivers.length)
    showError(`Saved settings for ${droppedReceivers.join(', ')} were invalid and were dropped.`);
  rememberReceiver();
  receiverNote();
  $('receiver-list').addEventListener('change', () => {
    if (!$('receiver-list').value) return;
    $('host').value = $('receiver-list').value;
    $('host').dispatchEvent(new Event('change'));
  });
  $('receiver-find').addEventListener('click', findReceivers);
  renderReceiverList();
  $('host').value = settings.host;
  $('host').addEventListener('change', () => {
    settings.host = $('host').value.trim();
    saveSettings();
    switchReceiver();
  });
  $('max-fps').value = settings.maxFps ?? '';
  $('max-fps').addEventListener('change', () => {
    try {
      const text = $('max-fps').value.trim();
      settings.maxFps = receiverProfile({ maxFps: text === '' ? null : Number(text) }).maxFps;
      showError('');
    } catch (error) {
      showError(error.message);
    }
    $('max-fps').value = settings.maxFps ?? '';
    sendLimiter.reset();
    saveSettings();
    rememberReceiver();
  });
  $('ddp-port').value = settings.ddpPort;
  $('ddp-port').addEventListener('change', () => {
    settings.ddpPort = Number($('ddp-port').value) || DEFAULTS.ddpPort;
    saveSettings();
  });
  $('width').value = settings.width;
  $('height').value = settings.height;
  const sizeChanged = () => {
    const width = Math.round(Number($('width').value));
    const height = Math.round(Number($('height').value));
    if (width > 0 && height > 0 && width * height <= 1024 * 1024)
      applyMatrixSize(width, height);
  };
  $('width').addEventListener('change', sizeChanged);
  $('height').addEventListener('change', sizeChanged);

  $('detect').addEventListener('click', detectSize);
  $('record').addEventListener('click', async () => {
    if (recording.state === 'recording') await recording.stop();
    else {
      if (audio.context) await audio.context.resume().catch(() => {});
      await recording.start($('preview'), audio.stream, $('recording-encoder').value);
    }
  });
  window.addEventListener('pagehide', () => { recording.abandon(); live.abandon(); });
  $('live-size').addEventListener('change', () => { $('live-custom').hidden = $('live-size').value !== 'custom'; });
  $('go-live').addEventListener('click', async () => {
    if (live.state === 'recording') await live.stop();
    else {
      const [outWidth, outHeight] = $('live-size').value === 'custom'
        ? [Number($('live-width').value), Number($('live-height').value)]
        : $('live-size').value.split('x').map(Number);
      if (audio.context) await audio.context.resume().catch(() => {});
      await live.start($('preview'), audio.stream, 'software', { outWidth, outHeight });
    }
  });
  fetch('/api/live').then((response) => response.json()).then(({ available }) => {
    liveAvailable = available;
    if (!available) $('live-status').textContent = 'Set YOUTUBE_STREAM_KEY to go live';
    syncCaptureControls();
  }).catch(() => {});
  $('stream').addEventListener('click', () => {
    if (link.streaming || link.pendingStart)
      stopStreaming(settings.blackOnStop);
    else
      startStreaming();
  });
  $('black-on-stop').checked = settings.blackOnStop;
  $('black-on-stop').addEventListener('change', () => {
    settings.blackOnStop = $('black-on-stop').checked;
    saveSettings();
  });
}

function bindAudioControls() {
  if (!['standin', 'quiet'].includes(settings.silenceMode))
    settings.silenceMode = DEFAULTS.silenceMode;
  $('silence-mode').value = settings.silenceMode;
  $('silence-mode').addEventListener('change', () => {
    settings.silenceMode = $('silence-mode').value;
    saveSettings();
  });
  $('audio-source').addEventListener('change', (event) => selectAudioSource(event.target.value));
  $('audio-retake').addEventListener('click', () => selectAudioSource(settings.audioSource));
  $('key-colours').checked = settings.keyColours;
  $('key-colours').addEventListener('change', () => {
    settings.keyColours = $('key-colours').checked;
    saveSettings();
  });
  $('key-hold').checked = settings.keyHold;
  $('key-hold').addEventListener('change', () => {
    settings.keyHold = $('key-hold').checked;
    saveSettings();
  });
  // The operator's opinion of the key, clicked on the Monitor's wheel (
  // Anjin, 2026-10-20: "allow operator to click to select their opinion of
  // key on the wheel"; "no, this is 5A"): given to the detector, as Send to
  // the tracker gives it the tempo, or held whatever the music says.
  $('key-lock').checked = settings.keyLock;
  $('key-lock').addEventListener('change', () => {
    settings.keyLock = $('key-lock').checked;
    saveSettings();
    if (audio.key?.chosen) audio.chooseKey(audio.key.tonic, audio.key.mode, settings.keyLock);
    showKey();
  });
  const wheel = $('monitor-key-wheel');
  const segment = (event) => {
    const box = wheel.getBoundingClientRect();
    return segmentAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height, 1);
  };
  wheel.addEventListener('click', (event) => {
    const at = segment(event);
    if (!at) return;
    const { tonic, mode } = keyAtCamelot(at.number, at.letter);
    audio.chooseKey(tonic, mode, settings.keyLock);
    showKey();
  });
  wheel.addEventListener('mousemove', (event) => {
    const at = segment(event);
    wheel.style.cursor = at ? 'pointer' : '';
    wheel.title = at ? `${at.number}${at.letter} ${keyAtCamelot(at.number, at.letter).name}: click to choose` : '';
  });
  $('key-detect').addEventListener('click', () => {
    audio.releaseKey();
    showKey();
  });
  bindRange('gain', 'gain', (v) => `${v.toFixed(2)}×`);
}

// The Sparkles panel (sparkle.js): an effect over every pattern.
function bindSparkleControls() {
  try {
    settings.sparkles = sparkleSettings(settings.sparkles);
  } catch (error) {
    showError(`Saved sparkle settings were invalid: ${error.message} Restored defaults.`);
    settings.sparkles = sparkleSettings();
  }
  const change = (key, value) => {
    settings.sparkles = sparkleSettings({ ...settings.sparkles, [key]: value });
    saveSettings();
  };
  $('sparkle-enabled').addEventListener('change', () => change('enabled', $('sparkle-enabled').checked));
  for (const [key, format] of Object.entries(SPARKLE_FORMATS)) {
    const input = $(`sparkle-${key}`), output = $(`sparkle-${key}-value`);
    input.addEventListener('input', () => {
      change(key, Number(input.value));
      output.textContent = format(settings.sparkles[key]);
    });
  }
  for (const [key, options] of SPARKLE_MENUS) {
    const select = $(`sparkle-${key}`);
    select.replaceChildren(...options.map(({ id, label }) => new Option(label, id)));
    select.addEventListener('change', () => change(key, select.value));
  }
  // An info pane beside each setting's name (Anjin, 2026-10-20: "perhaps
  // pop up info panes detailing").
  for (const [key, [name, text]] of Object.entries(SPARKLE_HELP)) {
    const label = $(`sparkle-${key}`).closest('label');
    const words = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    words.after(helpPopover(text, name));
  }
  syncSparkleControls();
}

// What each sparkle setting does, for its info pane (sparkle.js has the rules).
const SPARKLE_HELP = {
  enabled: ['sparkles', 'Each hit in the high band, 4 to 16 kHz (hi-hats, shakers, cymbals), sets off a scatter of ' +
    'points that flash and fade, and a faint twinkle follows how much treble there is between hits. Drawn once, ' +
    'over the final mix out of the Main, before Gamma and Brightness and under the overlays.'],
  amount: ['Amount', 'How bright all the sparkle light is, the flashes and the twinkle alike. 0% turns them off.'],
  density: ['Density', 'How many pixels each hit lights: up to 2% of the panel at 100%, rising steeply, so 50% ' +
    'lights about a quarter of that. A stronger hit lights more.'],
  length: ['Length', 'How long a flash takes to fade to a third of its light, from 50 to 400 ms. It flickers as it fades.'],
  twinkle: ['Twinkle with the air', 'A faint shimmer between hits that follows the air: how much of the sound ' +
    'is in the high band, smoothed over about a third of a second. Below an air of 0.1 there is none; it reaches ' +
    'this setting\'s full strength at 0.5 (a typical dance track sits near 0.3). At most a few pixels in a ' +
    'thousand, each fading in and out over 0.6 s at half a flash\'s brightness. 0% leaves only the flashes.'],
  shape: ['Shape', 'Points are single pixels. Stars add a faint cross of four neighbours, at about a third of the ' +
    'centre\'s light.'],
  colour: ['Colour', 'White; Key colour, a pastel of the main hue, which follows the musical key when Key colours ' +
    'is on; or Gold to ice, by where in 4 to 16 kHz the hit rose: gold for lower hats and shakers, ice blue for ' +
    'high cymbals.'],
  placement: ['Placement', 'Where sparkles land: anywhere; along edges and curves in the picture; or on its ' +
    'bright shapes; or across the panel by pitch, each hit in the columns at where in 4 to 16 kHz it rose, low ' +
    'on the left and high on the right. Faint features count for nothing, and each placement is weighted to give ' +
    'about as many sparkles as Anywhere.'],
};

const SPARKLE_FORMATS = {
  amount: (v) => `${Math.round(v * 100)}%`,
  density: (v) => `${Math.round(v * 100)}%`,
  length: (v) => `${Math.round(sparkleLife(v) * 1000)} ms`,
  twinkle: (v) => `${Math.round(v * 100)}%`,
};
const SPARKLE_MENUS = [['shape', SPARKLE_SHAPES], ['colour', SPARKLE_COLOURS], ['placement', SPARKLE_PLACEMENTS]];

// Shows the Sparkles settings in their controls.
function syncSparkleControls() {
  $('sparkle-enabled').checked = settings.sparkles.enabled;
  for (const [key, format] of Object.entries(SPARKLE_FORMATS)) {
    $(`sparkle-${key}`).value = settings.sparkles[key];
    $(`sparkle-${key}-value`).textContent = format(settings.sparkles[key]);
  }
  for (const [key] of SPARKLE_MENUS) $(`sparkle-${key}`).value = settings.sparkles[key];
}

function bindLookControls() {
  bindRange('brightness', 'brightness', (v) => `${Math.round(v * 100)}%`, rememberReceiver);
  bindRange('gamma', 'gamma', (v) => v.toFixed(2), rememberReceiver);
  bindRange('speed', 'speed', (v) => `${v.toFixed(2)}×`);
  bindRange('hue', 'hue', (v) => `${Math.round(v * 360)}°`);
  bindRange('fps', 'fps', (v) => `${v} fps`);
}

function bindPatternControls() {
  updateFlockControls();
  $('flock-count-auto').addEventListener('change', () => {
    settings.flockCount = $('flock-count-auto').checked ? null : Number($('flock-count').value);
    updateFlockControls();
    saveSettings();
  });
  $('flock-count').addEventListener('input', () => {
    if (!$('flock-count').checkValidity()) {
      showError('Flock count must be an integer from 1 to 256.');
      return;
    }
    settings.flockCount = Number($('flock-count').value);
    $('flock-count-auto').checked = false;
    showError('');
    saveSettings();
  });
  $('aurora-dot-auto').addEventListener('change', () => {
    settings.auroraDotSize = $('aurora-dot-auto').checked ? null : Number($('aurora-dot').value);
    updateFlockControls();
    saveSettings();
  });
  $('aurora-dot').addEventListener('input', () => {
    settings.auroraDotSize = Number($('aurora-dot').value);
    $('aurora-dot-auto').checked = false;
    updateFlockControls();
    saveSettings();
  });
  for (const palette of PALETTES) {
    const option = document.createElement('option');
    option.value = palette.id;
    option.textContent = palette.name;
    $('pattern-palette').appendChild(option);
  }
  $('pattern-palette').value = settings.paletteId;
  $('pattern-palette').addEventListener('change', () => {
    settings.paletteId = $('pattern-palette').value;
    view.paletteElapsed = 0;
    saveSettings();
  });
  $('palette-cycle').checked = settings.paletteCycle;
  $('palette-cycle').addEventListener('change', () => {
    settings.paletteCycle = $('palette-cycle').checked;
    view.paletteElapsed = 0;
    saveSettings();
  });
}

function bindCycleControls() {
  bindRange('cycle', 'cycleSeconds', (v) => `${v} s`);
  bindRange('fade', 'fadeSeconds', (v) => `${v} s`);
  $('auto-cycle').checked = settings.autoCycle;
  $('auto-cycle').addEventListener('change', () => {
    settings.autoCycle = $('auto-cycle').checked;
    view.lastSwitch = performance.now();
    saveSettings();
  });
}

function bindKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, select, textarea'))
      return;
    if (event.key === 'ArrowRight')
      stepPattern(1);
    else if (event.key === 'ArrowLeft')
      stepPattern(-1);
    else if (event.key.toLowerCase() === 't' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey)
      tapTempo();
    else if (event.key.toLowerCase() === 'd' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey)
      markDownbeat();
    else if (event.key.toLowerCase() === settings.hotsave.key && !event.repeat && !event.metaKey && !event.ctrlKey &&
        !event.altKey)
      hotsave();
  });
}

// Both views stay in the document so rendering, audio and streaming carry on
// while the other set of controls is shown.
function setView(view) {
  // The quad mixer took the name and place of the one-pair Mixer view
  // (Anjin, 2026-10-20: "so we only have one in the end").
  if (view === 'mixer') view = 'quad';
  const buttons = [...document.querySelectorAll('[data-view-button]')];
  if (!buttons.some((button) => button.dataset.viewButton === view))
    view = DEFAULTS.view;
  for (const section of document.querySelectorAll('[data-view]'))
    section.hidden = section.dataset.view !== view;
  for (const button of buttons)
    button.setAttribute('aria-pressed', String(button.dataset.viewButton === view));
  settings.view = view;
  // The quad mixer fills the window below the header, in place of the rest.
  document.body.classList.toggle('quad-mode', view === 'quad');
  if (view === 'quad') showQuadView();
}

// The Monitor view's readout and log controls.
function monitorReadout(tempo, seconds) {
  const source = beatSource();
  $('monitor-readout').textContent = `${Math.round(tempo.bpm * 10) / 10} BPM · ` +
    (tempo.detected ? `detected from ${source.label}, confidence ${Math.round(tempo.confidence * 100)}%` :
      `manual${settings.tempo.mode === 'manual' ? '' : ` until ${source.label} finds a steady beat${essentiaNote()}`}`) +
    ` · ${Math.round(monitor.onsetsPerMinute(seconds))} onsets a minute · beat ${tempo.beatInBar + 1} of 4` +
    ` · ${audio.features.highRate.toFixed(1)} high hits a second`;
  // The beat in the bar as four lights, beat 1 the accented one, and what the
  // last Downbeat or Tap press found.
  document.querySelectorAll('#beat-dots span').forEach((dot, i) => {
    dot.classList.toggle('on', i === tempo.beatInBar);
  });
  const pressed = view.pressed;
  $('press-note').textContent = pressed && seconds < pressed.until ? pressed.kind === 'Downbeat' ?
    (pressed.beat === 1 ? 'Downbeat pressed: it was beat 1 already' :
      `Downbeat pressed on beat ${pressed.beat}: the bars move to put it on 1`) :
    `Tap pressed on beat ${pressed.beat}` : '';
  const rows = monitor.rows.length;
  $('monitor-log-status').textContent = (monitor.recording ? 'Recording · ' : '') +
    `${rows} rows (${Math.round(rows / 10)} s) in the log`;
}

// Nudging the Monitor's beat graph (beat-fold.js): the first nudge starts
// from the clock as it stands.
function nudgeMonitor(apply) {
  const seconds = performance.now() / 1000;
  if (!monitor.nudge) {
    if (!view.lastTempo) return;
    monitor.startNudge(seconds, view.lastTempo);
  }
  apply(seconds);
  showNudge();
}

function showNudge() {
  const n = monitor.nudge;
  $('monitor-fold-bpm').textContent = n ? `Folded at ${n.bpm.toFixed(2)} BPM` : 'Following the clock';
  for (const id of ['monitor-follow', 'monitor-use', 'monitor-send']) $(id).disabled = !n;
}

// Gives the nudged tempo and bar line to the beat tracker, which carries on
// following the music from there (TempoTracker.hint), and goes back to
// following the clock. A manual tempo is handed back to detection first.
function sendNudgeToTracker() {
  const n = monitor.nudge;
  if (!n) return;
  if (settings.tempo.mode === 'manual') changeTempo({ mode: 'auto' });
  const seconds = performance.now() / 1000;
  audio.hintTempo(seconds, n.bpm, monitor.barStart(seconds) + 4 * 60 / n.bpm);
  monitor.followClock();
  showNudge();
  showNotice(`Sent ${n.bpm.toFixed(2)} BPM and the bar line to the beat tracker, which goes on following the music from there.`);
}

// Gives the nudged tempo and bar line to the clock, as the manual tempo, and
// goes back to following it.
function useNudgedTempo() {
  const n = monitor.nudge;
  if (!n) return;
  changeTempo({ mode: 'manual', manualBpm: n.bpm });
  // The next bar line, by the fold, is where the clock's bar should start.
  const seconds = performance.now() / 1000;
  const bar = 4 * 60 / n.bpm;
  audio.tempo.tap(monitor.barStart(seconds) + bar, 4);
  monitor.followClock();
  showNudge();
  showNotice(`The clock now runs at ${n.bpm.toFixed(2)} BPM, the manual tempo, with its bar line where you set it.`);
}

// A button that acts on the press, not the release, as a beat does; Enter
// and Space on it count as presses too.
function onPress(button, act) {
  button.addEventListener('pointerdown', (event) => {
    if (event.button === 0) act();
  });
  button.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
      event.preventDefault();
      act();
    }
  });
}

// The key's readouts and wheel on the Monitor view.
function showKey(key = shownKey(audio.key, settings.keyHold)) {
  $('musical-key').textContent = key ? `${key.name} / ${key.camelot.label} (${
    key.chosen === 'locked' ? 'your choice, kept whatever the music says' :
      key.chosen ? 'your choice, until the music clearly says another' :
        key.held ? 'last found, uncertain now' : `estimate ${Math.round(key.confidence * 100)}%`})` :
    audio.mode !== 'device' ? 'Select a live audio input' : 'Listening / uncertain';
  $('compatible-keys').textContent = key ?
    `Mix neighbours: ${compatibleCamelotKeys(key.camelot).join(', ')}` : 'No confident key yet';
  $('key-detect').disabled = !audio.key?.chosen;
  if (settings.view === 'monitor') drawKeyWheel($('monitor-key-wheel'), key, audio.keyDetector.scores);
}

// The Monitor's notes, as info panes beside each panel's name (Anjin,
// 2026-10-20: "move the info blocks on the monitor to popovers").
function monitorHelp() {
  for (const fieldset of document.querySelectorAll('[data-view="monitor"] fieldset')) {
    const notes = [...fieldset.querySelectorAll('p[data-help]')];
    if (!notes.length) continue;
    const legend = fieldset.querySelector('legend');
    legend.append(' ', helpPopover(notes.map((p) => p.textContent.replace(/\s+/g, ' ').trim()).join('\n\n'),
      legend.textContent.trim().toLowerCase()));
    for (const p of notes) p.remove();
  }
}

function bindMonitorControls() {
  monitorHelp();
  // Tap and Downbeat here too, beside the graph they line up (Anjin,
  // 2026-10-20: "add tap and down beat to the monitor as well").
  onPress($('monitor-tap'), tapTempo);
  onPress($('monitor-downbeat'), markDownbeat);
  for (const button of document.querySelectorAll('[data-nudge]'))
    button.addEventListener('click', () => nudgeMonitor((seconds) => monitor.nudgeTempo(Number(button.dataset.nudge), seconds)));
  for (const button of document.querySelectorAll('[data-phase]'))
    button.addEventListener('click', () => nudgeMonitor(() => monitor.nudgePhase(Number(button.dataset.phase))));
  $('monitor-follow').addEventListener('click', () => {
    monitor.followClock();
    showNudge();
  });
  $('monitor-use').addEventListener('click', useNudgedTempo);
  $('monitor-send').addEventListener('click', sendNudgeToTracker);
  showNudge();
  $('monitor-record').addEventListener('change', () => monitor.setRecording($('monitor-record').checked));
  $('monitor-clear').addEventListener('click', () => monitor.clearLog());
  $('monitor-download').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([monitor.csv()], { type: 'text/csv' }));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.download = `matrixprism-tempo-${stamp}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
}

function bindViewControls() {
  for (const button of document.querySelectorAll('[data-view-button]')) {
    button.addEventListener('click', () => {
      setView(button.dataset.viewButton);
      saveSettings();
    });
  }
}

function bindControls() {
  bindViewControls();
  loadShapeSettings();
  bindPlaylistPanel();
  bindHotsaveControls();
  bindMidiControls();
  bindRandomizerControls();
  bindTempoControls();
  bindMonitorControls();
  loadMixerSettings();
  bindMediaControls();
  bindPanelControls();
  bindMatrixControls();
  bindAudioControls();
  bindLookControls();
  bindSparkleControls();
  bindPatternControls();
  bindCycleControls();
  bindKeyboard();
  // The saved view last, once every setting it shows has been loaded and
  // checked: the Mixer reads them all when its panes are first built. The
  // host lives on Setup, so start there until one is configured.
  setView(settings.host ? settings.view : 'setup');
}

// ---------- main loop ----------

// ---------- quad mixer (T16) ----------

const QUAD_PREVIEW_MS = 100;
const QUAD_PREVIEW_WIDTH = 96;
const QUAD_FADE_TIMES = [0, 0.5, 1, 2, 4, 8, 10];
// Beats to wait for before the master's fade starts, by its Starts.
const QUANTIZE_BEATS = { off: 0, beat: 1, bar: 4, phrase4: 16, phrase8: 32 };
const quad = { view: null, lastPreview: -Infinity };
const findPattern = (id) => PATTERNS.find((pattern) => pattern.id === id);
const quadVisible = () => settings.view === 'quad' && !!quad.view;

function quadChanged() {
  saveSettings();
  quad.view?.refresh();
}

function quadInput(id) {
  syncQuad();
  return settings.quad.inputs[id];
}

// A and B go through the one-pair settings, as today's views change them;
// their brightness and gamma, and C and D, are the quad mixer's own.
function setQuadInput(id, changes) {
  try {
    const current = quadInput(id);
    const next = { ...current, ...changes };
    if (changes.patternId && changes.patternId !== current.patternId && !changes.params) next.params = {};
    if (id === 'a' || id === 'b') {
      if (changes.patternId && changes.patternId !== current.patternId) {
        if (id === 'a') selectPattern(findPattern(changes.patternId));
        else changeMixer({ patternId: changes.patternId });
      }
      if (changes.shape) {
        settings.shapes = { ...settings.shapes, [id]: shapeSettings(changes.shape) };
        view.layer = mixerLayer();
      }
      if (changes.params) {
        if (Object.keys(changes.params).length) settings.patternParams[next.patternId] = changes.params;
        else delete settings.patternParams[next.patternId];
        view.paramKey = null;
        renderPatternButtons();
      }
    }
    settings.quad.inputs[id] = inputSettings(next, PATTERNS);
    showError('');
  } catch (error) {
    showError(error.message);
  }
  quadChanged();
}

// Back to just the pattern, unmodified (Anjin, 2026-10-20: "Reset should
// include the modifiers like region, shape, movement"), and the randomizer's
// timers for this input start a whole wait afresh.
function resetQuadInput(id) {
  const input = quadInput(id);
  setQuadInput(id, { ...resetQuadInputTo(input), shape: SHAPE_DEFAULTS, params: {} });
  const name = id.toUpperCase();
  randomizer.restart([`pattern${name}`, `shape${name}`]);
}

function quadPair(id) {
  if (id === 'left') return { enabled: settings.mixer.enabled, mode: settings.mixer.mode, amount: settings.mixer.amount };
  return settings.quad.pairs.right;
}

function setQuadPair(id, changes, save = true) {
  try {
    if (id === 'left') {
      settings.mixer = mixerSettings({ ...settings.mixer, ...changes }, PATTERNS.map((pattern) => pattern.id));
      view.layer = mixerLayer();
      if (save) updateMixerControls();
    } else {
      settings.quad.pairs.right = pairSettings({ ...settings.quad.pairs.right, ...changes });
    }
  } catch (error) {
    showError(error.message);
  }
  if (save) quadChanged();
}

function resetQuadPair(id) {
  delete view.pairFades[id];
  setQuadPair(id, resetQuadPairTo());
}

function cutQuadPair(id, to) {
  delete view.pairFades[id];
  setQuadPair(id, { enabled: true, amount: to });
}

// A pair fades to whichever input it is further from, over the master's
// fade time.
function fadeQuadPair(id) {
  const pair = quadPair(id);
  const from = pair.enabled ? pair.amount : 0;
  view.pairFades[id] = { from, to: from < 0.5 ? 1 : 0, start: performance.now(),
    seconds: settings.quad.master.fadeSeconds };
  setQuadPair(id, { enabled: true, amount: from });
}

function setQuadMaster(changes) {
  try {
    settings.quad.master = masterSettings({ ...settings.quad.master, ...changes });
    // Moving the fader by hand ends a fade under way.
    if ('position' in changes) view.masterFade = null;
    showError('');
  } catch (error) {
    showError(error.message);
  }
  quadChanged();
}

// Fades the master across to whichever side it is further from, over the
// fade time, from the next beat, bar or phrase if its Starts says so.
function fadeQuadMaster() {
  const master = settings.quad.master;
  const unit = QUANTIZE_BEATS[master.fadeStart] ?? 0;
  view.masterFade = {
    from: master.position, to: master.position < 0.5 ? 1 : 0, seconds: master.fadeSeconds,
    startBeat: unit ? Math.floor(view.beatPosition / unit + 1) * unit : null, start: null,
  };
  quad.view?.refresh();
}

// Pair fades and the master's fade.
function advanceQuadFades(now) {
  for (const [id, fade] of Object.entries(view.pairFades)) {
    const done = fade.seconds <= 0 ? 1 : Math.min(1, (now - fade.start) / (fade.seconds * 1000));
    setQuadPair(id, { enabled: true, amount: fade.from + (fade.to - fade.from) * done }, false);
    if (done >= 1) {
      delete view.pairFades[id];
      setQuadPair(id, {});
    }
  }
  const fade = view.masterFade;
  if (fade) {
    if (fade.start === null && (fade.startBeat === null || view.beatPosition >= fade.startBeat)) fade.start = now;
    if (fade.start !== null) {
      const done = fade.seconds <= 0 ? 1 : Math.min(1, (now - fade.start) / (fade.seconds * 1000));
      settings.quad.master = { ...settings.quad.master, position: fade.from + (fade.to - fade.from) * done };
      if (done >= 1) {
        view.masterFade = null;
        quadChanged();
      }
    }
  }
}

// The look on screen as a whole look (quad.js), shared settings included.
function currentWholeLook() {
  syncQuad();
  return wholeLook({ ...settings.quad, shared: lookOf(settings) }, PATTERNS);
}

// Puts a whole look on screen: A, B and Left through the one-pair settings,
// the rest into the quad mixer, the shared settings into their controls. The
// master's look goes to the stream at once. With `cut`, A changes pattern
// at once rather than crossfading.
function applyWholeLook(look, { cut = false } = {}) {
  (cut ? cutToPattern : selectPattern)(findPattern(look.inputs.a.patternId));
  settings.mixer = mixerSettings({ ...settings.mixer, patternId: look.inputs.b.patternId, ...look.pairs.left },
    PATTERNS.map((pattern) => pattern.id));
  settings.shapes = { a: look.inputs.a.shape, b: look.inputs.b.shape };
  for (const id of ['a', 'b']) {
    const input = look.inputs[id];
    if (Object.keys(input.params).length) settings.patternParams[input.patternId] = input.params;
    else delete settings.patternParams[input.patternId];
  }
  settings.quad = quadSettings({ ...look }, PATTERNS);
  view.pairFades = {};
  view.masterFade = null;
  Object.assign(settings, look.shared);
  syncLookControls();
  view.layer = mixerLayer();
  view.paramKey = null;
  updateMixerControls();
  quadChanged();
}

// Swap: a pair's two inputs, or Left and Right ('master'), trade everything
// and the fader moves so the picture stays (quad.js, swapLook). Stateful
// patterns go with their inputs; a fade under way ends.
function swapQuad(which) {
  const look = swapLook(currentWholeLook(), which);
  for (const [x, y] of swappedInputs(which)) renderer?.swapInputs(x, y);
  applyWholeLook(look, { cut: true });
}

function resetQuadMaster() {
  applyWholeLook(defaultLook(settings.defaultLook, currentWholeLook(), PATTERNS));
  showNotice(settings.defaultLook ? 'Back to the saved default look.' : 'Back to plain patterns: no default look saved yet.');
}

function saveDefaultLook() {
  settings.defaultLook = currentWholeLook();
  saveSettings();
  showNotice('The look on screen is now the default that Reset main brings back.');
}

// Changes a shared setting through its own control, so everything that
// follows from it happens as when that control is used.
function setQuadShared(changes) {
  const fire = (id, type, set) => {
    set($(id));
    $(id).dispatchEvent(new Event(type));
  };
  if ('hue' in changes) fire('hue', 'input', (input) => { input.value = changes.hue; });
  if ('speed' in changes) fire('speed', 'input', (input) => { input.value = changes.speed; });
  if ('brightness' in changes) fire('brightness', 'input', (input) => { input.value = changes.brightness; });
  if ('gamma' in changes) fire('gamma', 'input', (input) => { input.value = changes.gamma; });
  if ('gain' in changes) fire('gain', 'input', (input) => { input.value = changes.gain; });
  if ('paletteId' in changes) fire('pattern-palette', 'change', (select) => { select.value = changes.paletteId; });
  if ('keyColours' in changes) fire('key-colours', 'change', (box) => { box.checked = changes.keyColours; });
  if ('sparklesOn' in changes) fire('sparkle-enabled', 'change', (box) => { box.checked = changes.sparklesOn; });
  if ('beatSource' in changes) fire('tempo-source', 'change', (select) => { select.value = changes.beatSource; });
  if ('tapUnit' in changes) changeTempo({ tap: changes.tapUnit });
  // Back to following the music.
  if (changes.followAudio) changeTempo({ mode: 'auto' });
  quad.view?.refresh();
}

function showQuadView() {
  if (quad.view) {
    quad.view.refresh();
    return;
  }
  quad.view = buildQuadView($('quad-layout'), settings.quadLayout, {
    patterns: PATTERNS,
    blendModes: BLEND_MODES,
    shapes: SHAPES,
    regions: REGIONS,
    // An input's shape beyond its bend and region, for the More popover.
    shapeOptions: {
      outlines: OUTLINES.map((outline) => ({ value: outline.id, label: outline.name })),
      spins: SPINS.map((bars) => ({ value: bars, label: spinName(bars) })),
      spinReversals: SPIN_REVERSALS.map((bars) => ({ value: bars, label: spinReverseName(bars) })),
      pulseBeats: PULSE_BEATS.map((beats) => ({ value: beats, label: pulseBeatsName(beats) })),
      sizeRange: SIZE_RANGE, edgeRange: EDGE_RANGE, pulseRange: PULSE_RANGE, defaults: SHAPE_DEFAULTS,
    },
    tapUnits: TAP_UNITS.map((unit) => ({ value: unit.id, label: unit.name })),
    waitUnits: WAIT_UNITS.map((unit) => ({ value: unit.id, label: unit.name })),
    waitLabel,
    // The sparkles' settings, wired by bindSparkleControls, for the Main's popover.
    sparklePanel: $('sparkle-controls'),
    palettes: PALETTES.map((palette) => ({ value: palette.id, label: palette.name })),
    beatSources: BEAT_SOURCES.map((source) => ({ value: source.id, label: source.name })),
    fadeTimes: QUAD_FADE_TIMES,
    fadeStarts: QUANTIZE.map((choice) => ({ value: choice.id, label: choice.name })),
    input: quadInput,
    setInput: setQuadInput,
    resetInput: resetQuadInput,
    pair: quadPair,
    setPair: setQuadPair,
    resetPair: resetQuadPair,
    cutPair: cutQuadPair,
    fadePair: fadeQuadPair,
    master: () => settings.quad.master,
    fading: () => !!view.masterFade,
    setMaster: setQuadMaster,
    fade: fadeQuadMaster,
    resetMaster: resetQuadMaster,
    swap: swapQuad,
    saveDefault: saveDefaultLook,
    shared: () => ({ hue: settings.hue, speed: settings.speed, paletteId: settings.paletteId,
      brightness: settings.brightness, gamma: settings.gamma, gain: settings.gain,
      keyColours: settings.keyColours, sparklesOn: settings.sparkles.enabled, beatSource: settings.tempo.source,
      tapUnit: settings.tempo.tap, tempoManual: settings.tempo.mode === 'manual' }),
    setShared: setQuadShared,
    tap: tapTempo,
    downbeat: markDownbeat,
    tempo: () => view.lastTempo ? `${Math.round(view.lastTempo.bpm)} BPM · beat ${view.lastTempo.beatInBar + 1} of 4` : '',
    output: () => ({ streaming: link.streaming || link.pendingStart, status: $('status').textContent }),
    toggleStream: () => $('stream').click(),
    hotsave,
    // The randomizer's settings, whether a playlist has paused it, and each
    // item's time to its next change in the waits' unit (null while it is
    // not running).
    randomizer: () => {
      const now = performance.now();
      return { ...settings.randomizer, paused: player.playing,
        remaining: Object.fromEntries(TRACKS.map((track) => [track.id,
          randomizer.remaining(track.id, settings.randomizer, now, view.beatPosition)])) };
    },
    setRandomizer: changeRandomizer,
    canEdit: (id) => id === 'a' || id === 'b',
    // A's page, which shows B's settings too while Left mixes.
    edit: () => setView('patterns'),
  });
}

// The quad mixer's parts of the render state (Renderer.render's `quad`).
// C and D are drawn only while they can be seen or reach the stream.
function quadFrame(previewDue) {
  const q = settings.quad;
  const master = q.master;
  const visible = quadVisible();
  // An input's own hue, turned by Key colours as the main's is; null to
  // follow the main's.
  const hue = (id) => {
    const own = q.inputs[id].hue;
    return own === null ? null : { hue: (own + view.keyHueOffset) % 1, manualHue: own };
  };
  const input = (id) => {
    const value = q.inputs[id];
    const pattern = findPattern(value.patternId);
    return pattern && { pattern, params: value.params, shape: value.shape, brightness: value.brightness, gamma: value.gamma,
      ...hue(id) };
  };
  const rightNeeded = visible || master.position > 0;
  const right = q.pairs.right;
  return {
    trims: { a: q.inputs.a, b: q.inputs.b },
    hues: { a: hue('a'), b: hue('b') },
    // B while Left's mixer is off: drawn for its preview, not mixed.
    b: visible && !view.layer ? input('b') : null,
    c: rightNeeded ? input('c') : null,
    d: rightNeeded ? input('d') : null,
    right: { mode: right.enabled ? blendModeIndex(right.mode) : -1, amount: right.amount },
    master: { mode: blendModeIndex(master.mode), position: master.position, blackout: master.blackout },
    submixes: visible && previewDue,
  };
}

// The quad view's monitors: Live every frame; the previews, spectrum and
// beat map ten times a second, from one small strip (readPreviews).
function drawQuadMonitors(now, frame, previewDue) {
  if (!quadVisible()) return;
  quad.view.drawLive(frame, settings.width, settings.height);
  if (!previewDue) return;
  quad.lastPreview = now;
  const names = ['a', 'b', 'c', 'd', 'left', 'right'];
  const tileHeight = Math.max(8, Math.round(QUAD_PREVIEW_WIDTH * settings.height / settings.width));
  // A and B's shapes are today's (settings.shapes); C and D's the quad mixer's.
  const inputs = settings.quad.inputs;
  const previewInputs = { ...inputs, a: { ...inputs.a, shape: settings.shapes?.a ?? inputs.a.shape },
    b: { ...inputs.b, shape: settings.shapes?.b ?? inputs.b.shape } };
  quad.view.drawPreviews(names, renderer.readPreviews(names, QUAD_PREVIEW_WIDTH, tileHeight, previewInputs),
    QUAD_PREVIEW_WIDTH, tileHeight);
  const spectrum = quad.view.canvases.spectrum;
  if (spectrum.offsetParent !== null) {
    const context = spectrum.getContext('2d');
    context.fillStyle = '#05070a';
    context.fillRect(0, 0, spectrum.width, spectrum.height);
    context.fillStyle = '#5ad1ff';
    const bars = audio.spectrum.length, width = spectrum.width / bars;
    for (let i = 0; i < bars; ++i) {
      const h = (audio.spectrum[i] / 255) * spectrum.height;
      context.fillRect(i * width, spectrum.height - h, Math.max(1, width), h);
    }
  }
  monitor.drawGraph(quad.view.canvases.beatMap);
}

function tick(now) {
  const dt = Math.min(0.1, (now - view.lastFrame) / 1000);
  view.lastFrame = now;
  if (view.contextLost)
    return;

  const spectrumActive = !!(view.pattern.spectrumPlot || view.previousPattern?.spectrumPlot ||
    view.layer?.pattern.spectrumPlot);
  audio.configurePlot(settings.spectrumOptions.fftSize, spectrumActive);
  const features = audio.update(dt, settings.gain, now / 1000);
  const key = shownKey(audio.key, settings.keyHold);
  // Text readouts change slowly; the frame loop also runs while hidden.
  const readout = now - view.lastReadout >= READOUT_INTERVAL_MS;
  if (readout) {
    view.lastReadout = now;
    playlistPanel?.status();
    randomizerStatus();
    $('audio-channels').textContent = audioInputHint();
    $('audio-retake').hidden = audio.mode !== 'device' || audio.inputState === 'live';
    showKey(key);
  }
  const colour = keyColourHue(settings.hue, settings.keyColours, key, view.keyHueOffset, dt);
  view.keyHueOffset = colour.offset;
  view.time += dt * settings.speed * (1 + features.level * 0.8);
  view.auroraTime += dt * settings.speed;
  if (settings.paletteCycle) {
    view.paletteElapsed += dt * settings.speed;
    if (view.paletteElapsed >= 10) {
      const index = PALETTES.findIndex(palette => palette.id === settings.paletteId);
      settings.paletteId = PALETTES[index < 2 || index === PALETTES.length - 1 ? 2 : index + 1].id;
      $('pattern-palette').value = settings.paletteId;
      view.paletteElapsed %= 10;
      saveSettings();
    }
  }

  // A playing playlist decides what is shown, in place of auto cycle.
  // The beat position moves each layer's spin and pulse. When changes are
  // set to wait, timers are only looked at as a beat or bar begins, so
  // whatever has come due happens on it.
  const tempo = audio.tempo.update(now / 1000, settings.tempo, features);
  monitor.update(now / 1000, tempo, audio, settings.tempo.source);
  if (settings.view === 'monitor') {
    monitor.drawGraph($('monitor-graph'));
    monitor.drawTrace($('monitor-trace'), now / 1000);
  }
  view.beatPosition = tempo.position;
  view.changeClock = tempo.changeClock;
  view.lastTempo = tempo;
  advanceQuadFades(now);
  if (readout) {
    tempoReadout(tempo);
    if (settings.view === 'monitor') monitorReadout(tempo, now / 1000);
    // A fault in the quad view must not stop the frames, and with them the
    // stream: it is shown, and the frame goes on.
    if (quadVisible()) {
      try {
        quad.view.refresh();
      } catch (error) {
        showError(`Mixer: ${error.message}`);
      }
    }
  }
  if (player.playing) {
    // The randomizer starts its waits afresh once the playlist stops.
    randomizer.reset();
    const entry = changeAllowed(settings.tempo.quantize, tempo) ? player.tick(now) : null;
    if (entry)
      applyLook(entry);
  } else if (changeAllowed(settings.tempo.quantize, tempo)) {
    applyRandomChanges(randomizer.tick(now, settings.randomizer, settings.mixer.enabled, mediaShuffles(),
      settings.quad.pairs.right.enabled, view.beatPosition));
    const randomA = settings.randomizer.enabled && settings.randomizer.tracks.patternA;
    if (!randomA && settings.autoCycle && now - view.lastSwitch > settings.cycleSeconds * 1000)
      stepPattern(1, true);
  }

  let mix = 1;
  if (view.previousPattern) {
    mix = settings.fadeSeconds > 0 ? (now - view.fadeStart) / (settings.fadeSeconds * 1000) : 1;
    if (mix >= 1) {
      view.previousPattern = null;
      mix = 1;
    }
  }

  const previewDue = quadVisible() && now - quad.lastPreview >= QUAD_PREVIEW_MS;
  let frame;
  try {
    frame = renderer.render({
      quad: quadFrame(previewDue),
      pattern: view.pattern,
      previousPattern: view.previousPattern,
      mix,
      layer: view.layer,
      shape: settings.shapes.a,
      beatPosition: view.beatPosition,
      changeClock: view.changeClock,
      time: view.time,
      auroraTime: view.auroraTime,
      previousTime: view.time,
      audio: features,
      audioTime: now / 1000,
      spectrum: audio.spectrum,
      spectrumLeft: audio.spectrumLeft,
      spectrumRight: audio.spectrumRight,
      wave: audio.wave,
      hue: colour.hue,
      manualHue: settings.hue,
      musicalKey: key,
      brightness: settings.brightness,
      gamma: settings.gamma,
      flock: { count: settings.flockCount },
      auroraDotSize: settings.auroraDotSize,
      mediaFit: settings.mediaFit,
      silenceMode: settings.silenceMode,
      paletteId: settings.paletteId,
      spectrumOptions: settings.spectrumOptions,
      patternParams: settings.patternParams,
      rawSpectrum: audio.plotInput,
      spectrumInput: audio.spectrumInput,
      overlays: settings.overlays,
      sparkles: settings.sparkles,
      overlayInfo: overlayInfo(tempo, key),
      wallTime: Date.now(),
    });
  } catch (error) {
    showError(`${view.pattern.name}: ${error.message}`);
    if (recording.busy) recording.fail(error);
    if (live.busy) live.fail(error);
    return;
  }
  recording.frame(audio.stream);
  live.frame(audio.stream);
  view.rendered += 1;
  drawQuadMonitors(now, frame, previewDue);
  const spectrumPattern = [view.pattern, view.layer?.pattern].find((p) => p?.spectrumPlot);
  if (readout && spectrumPattern) {
    const plot = renderer.animationFor(spectrumPattern);
    if (plot)
      $('spectrum-info').textContent = plot.describe(audio.plotInput, audio.mode === 'simulated');
  }
  if (!document.hidden)
    drawMeter(features);

  // Skip a frame rather than queueing if the local socket is backed up.
  // send() copies the bytes, so the renderer's buffer can be reused.
  // The receiver may take fewer frames than are drawn (receivers.js).
  if (link.streaming && link.open && sendLimiter.allow(now, settings.maxFps) &&
      link.socket.bufferedAmount < frame.length * 2) {
    link.socket.send(frame);
    view.sent += 1;
  }
}

// What the info overlay shows (see infoLines() in overlays.js).
function overlayInfo(tempo, key) {
  const server = view.serverStats || { frames: 0, packets: 0, errors: 0 };
  const layerB = settings.mixer.enabled ? PATTERNS.find((p) => p.id === settings.mixer.patternId) : null;
  return {
    tempo: { bpm: tempo.bpm, beat: tempo.beatInBar + 1, detected: tempo.detected, source: beatSource().tag },
    key: key && { camelot: key.camelot.label, name: key.name, held: key.held },
    patterns: [view.pattern.name, layerB?.name],
    frames: { streaming: link.streaming, sent: server.frames, rendered: view.renderedFps ?? 0 },
    packets: { packets: server.packets, errors: server.errors },
  };
}

function reportStats() {
  const now = performance.now();
  const seconds = (now - view.lastReport) / 1000;
  view.lastReport = now;
  const server = view.serverStats || { frames: 0, packets: 0, errors: 0 };
  let text = `render ${Math.round(view.rendered / seconds)} fps · ` +
    `sent ${Math.round(view.sent / seconds)} fps · ` +
    `DDP ${server.frames} frames/s, ${server.packets} packets/s`;
  if (server.errors)
    text += ` · ${server.errors} send errors (${server.lastError})`;
  $('stats').textContent = text;
  // Kept for the info overlay.
  view.renderedFps = Math.round(view.rendered / seconds);
  view.sentFps = Math.round(view.sent / seconds);
  view.rendered = 0;
  view.sent = 0;
}

// Fills the Version frame on the Setup view. A server started before the
// frame existed has no answer to give.
async function showVersion() {
  try {
    const response = await fetch('/api/version');
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`);
    $('version-info').textContent = describeVersion(await response.json());
  } catch {
    $('version-info').textContent =
      'The server did not report a version. Restart the composer server and reload this page.';
  }
}

// Takes the matrix host and DDP port named on the server's command line, once
// per server start (server-config.js), and shows them in the Matrix panel.
async function loadServerConfig() {
  try {
    const config = await (await fetch('/api/config')).json();
    const { settings: next, hostChanged } = applyServerConfig(settings, config, DEFAULTS.ddpPort);
    Object.assign(settings, next);
    saveSettings();
    if (hostChanged && $('host')) {
      $('host').value = settings.host;
      $('ddp-port').value = settings.ddpPort;
      switchReceiver();
    }
  } catch {
    // The UI still works with saved settings if the config endpoint fails.
  }
}

async function init() {
  try {
    renderer = new Renderer($('preview'));
  } catch (error) {
    showError(error.message);
    return;
  }
  await loadServerConfig();
  showVersion();
  renderer.setSize(settings.width, settings.height);
  // A GPU reset or long sleep discards every WebGL resource; rebuild the
  // renderer when the browser hands the context back.
  $('preview').addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    view.contextLost = true;
    if (recording.busy) recording.fail(new Error('Graphics context lost during recording'));
    if (live.busy) live.fail(new Error('Graphics context lost during the live stream'));
    showError('Graphics context lost; waiting for the browser to restore it.');
  });
  $('preview').addEventListener('webglcontextrestored', () => {
    try {
      renderer = new Renderer($('preview'));
      renderer.setSize(settings.width, settings.height);
      view.contextLost = false;
      showError('');
    } catch (error) {
      showError(`Could not restore graphics: ${error.message}`);
    }
  });
  bindControls();
  renderPatternButtons();
  await populateAudioInputs();
  if (settings.audioSource === 'simulated')
    audio.startSimulated();
  else if (settings.audioSource.startsWith('device:'))
    // Browsers may block audio until the page is clicked; retry on first click.
    selectAudioSource(settings.audioSource).then(() => {
      if (audio.context && audio.context.state === 'suspended')
        document.addEventListener('click', () => audio.context && audio.context.resume(), { once: true });
    });
  connect();
  findReceivers();
  setInterval(reportStats, 1000);
  const clock = new Worker(new URL('./frame-clock.js', import.meta.url));
  clock.onmessage = () => {
    try {
      tick(performance.now());
    } finally {
      // Acknowledge each tick so a stalled page cannot accumulate frames.
      clock.postMessage({ type: 'frame', fps: settings.fps });
    }
  };
  clock.onerror = (event) => {
    clock.terminate();
    stopStreaming(settings.blackOnStop);
    if (recording.busy) recording.fail(new Error('Frame clock stopped during recording'));
    if (live.busy) live.fail(new Error('Frame clock stopped during the live stream'));
    showError(`Frame clock failed: ${event.message}`);
  };
  clock.postMessage({ type: 'start', fps: settings.fps });
}

init();
