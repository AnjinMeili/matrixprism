import assert from 'node:assert/strict';
import test from 'node:test';
import { SPECTRUM_BINS, SPECTRUM_HISTORY_ROWS, SpectrumHistory } from '../public/audio.js';

const spectrum = (value) => new Uint8Array(SPECTRUM_BINS).fill(value);
const row = (history, age) => {
  const index = (history.nextRow - 1 - age + SPECTRUM_HISTORY_ROWS) % SPECTRUM_HISTORY_ROWS;
  return history.data.slice(index * SPECTRUM_BINS, (index + 1) * SPECTRUM_BINS);
};

test('history starts black and records all frequency bins without retaining input references', () => {
  const history = new SpectrumHistory();
  const input = Uint8Array.from({ length: SPECTRUM_BINS }, (_, i) => i);
  assert.equal(history.data.length, 256 * 256);
  assert.ok(history.data.every(value => value === 0));
  assert.equal(history.update(input, 0), true);
  assert.deepEqual(row(history, 0), input);
  assert.deepEqual(row(history, 1), spectrum(0));
  input.fill(0);
  assert.equal(row(history, 0)[255], 255);
});

test('history samples at 30 Hz rather than once per rendered frame', () => {
  for (const fps of [10, 30, 60]) {
    const history = new SpectrumHistory();
    for (let frame = 0; frame <= fps; ++frame)
      history.update(spectrum(20), frame / fps);
    assert.equal(history.nextRow, 31, `${fps} fps`);
    assert.deepEqual(row(history, 30), spectrum(20));
    assert.deepEqual(row(history, 31), spectrum(0));
  }
});

test('history wraps with newest and oldest samples in chronological order', () => {
  const history = new SpectrumHistory();
  for (let i = 0; i < 300; ++i)
    history.update(spectrum(i % 256), (i + 0.01) / 30);
  for (let age = 0; age < 256; ++age)
    assert.deepEqual(row(history, age), spectrum((299 - age) % 256));
});

test('missed slots hold the last sample and long stalls stay bounded', () => {
  const history = new SpectrumHistory();
  history.update(spectrum(100), 0);
  history.update(spectrum(200), 0.1);
  assert.deepEqual(row(history, 0), spectrum(200));
  for (let age = 1; age <= 3; ++age)
    assert.deepEqual(row(history, age), spectrum(100));
  history.update(spectrum(0), 3600);
  assert.deepEqual(row(history, 0), spectrum(0));
  assert.deepEqual(row(history, 255), spectrum(200));
  assert.equal(history.update(spectrum(50), 3600), false);
});

test('stereo capture analyses each channel and mirrors a mono input', async (t) => {
  const { AudioAnalyzer, SPECTRUM_BINS } = await import('../public/audio.js');
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const levels = { mono: 90, 0: 200, 1: 40 };
  const requested = [], contextOptions = [];
  class Analyser {
    constructor() { this.fftSize = 2048; this.channel = 'mono'; }
    get frequencyBinCount() { return this.fftSize / 2; }
    getByteFrequencyData(data) { data.fill(levels[this.channel]); }
    getByteTimeDomainData(data) { data.fill(128); }
    getFloatFrequencyData(data) { data.fill(-100); }
    getFloatTimeDomainData(data) { data.fill(0); }
  }
  class Context {
    constructor(options) { this.sampleRate = 48000; contextOptions.push(options); }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return new Analyser(); }
    createChannelSplitter(count) {
      assert.equal(count, 2);
      return { connect(analyser, channel) { analyser.channel = channel; } };
    }
    close() {}
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async (constraints) => {
      requested.push(constraints);
      const tracks = [{ stop() {}, muted: false, readyState: 'live', getSettings: () => ({ echoCancellation: false }) }];
      return { getTracks: () => tracks, getAudioTracks: () => tracks };
    } },
  } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  t.after(() => {
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
    if (oldContext) Object.defineProperty(globalThis, 'AudioContext', oldContext);
    else delete globalThis.AudioContext;
  });

  const analyzer = new AudioAnalyzer();
  await analyzer.startDevice('input');
  assert.deepEqual(requested[0].audio.channelCount, { ideal: 2 });
  assert.deepEqual(requested[0].audio.deviceId, { exact: 'input' }, 'only the input chosen is asked for');
  assert.equal(analyzer.inputState, 'live', 'the input track is followed');
  assert.deepEqual(analyzer.inputSettings, { echoCancellation: false });
  assert.deepEqual(contextOptions[0], { latencyHint: 'playback', sinkId: { type: 'none' } },
    'the analysis context does not open the audio output');
  analyzer.update(0.02, 1);
  assert.equal(analyzer.stereo, true);
  assert.equal(analyzer.spectrum[10], 90);
  assert.equal(analyzer.spectrumLeft[10], 200);
  assert.equal(analyzer.spectrumRight[10], 40);
  assert.equal(analyzer.spectrumLeft.length, SPECTRUM_BINS);

  // A mono device leaves the second channel silent.
  levels[1] = 0;
  analyzer.update(0.02, 1);
  assert.equal(analyzer.stereo, false);
  assert.deepEqual([...analyzer.spectrumRight], [...analyzer.spectrumLeft]);

  analyzer.stop();
  assert.ok(analyzer.spectrumLeft.every(value => value === 0));
  analyzer.startSimulated();
  analyzer.update(0.3, 1);
  assert.equal(analyzer.stereo, true);
  assert.notDeepEqual([...analyzer.spectrumRight], [...analyzer.spectrumLeft]);
});
