import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FFT_SIZES, SPECTRUM_PRESETS, SpectrumPlot, spectrumOptions,
  frequencyBands, bandDecibels, spectrumCurve,
} from '../public/spectrum-plot.js';
import { AudioAnalyzer } from '../public/audio.js';
import { PATTERNS } from '../public/patterns.js';

const input = (db = -50, fftSize = 8192, sampleRate = 48000, source = 1) =>
  ({ data: new Float32Array(fftSize / 2).fill(db), fftSize, sampleRate, source });
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} versus ${b}`);

test('Spectrum Lab is registered and all presets/options are valid', () => {
  assert.equal(PATTERNS.find(p => p.id === 'spectrum-lab').spectrumPlot, true);
  for (const preset of Object.values(SPECTRUM_PRESETS)) assert.deepEqual(spectrumOptions(preset), preset);
  for (const invalid of [
    { layout: 'invalid' }, { bands: 'invalid' }, { fftSize: 3000 }, { count: 4.5 },
    { minHz: 1000, maxHz: 500 }, { floorDb: -15, ceilingDb: -90 },
    { slope: NaN }, { attack: -1 }, { release: Infinity }, { peaks: 1 }, { labels: null },
    { paletteId: 'missing' }, { gap: 1 }, null, [], 'invalid',
  ]) assert.throws(() => spectrumOptions(invalid));
  const plot = new SpectrumPlot(64, 32);
  const old = plot.options;
  assert.throws(() => plot.setOptions({ fftSize: 1023 }));
  assert.equal(plot.options, old, 'reject invalid changes atomically');
});

test('fractional octaves are anchored at 1 kHz with correct ratios and clipped edges', () => {
  for (const [bands, fraction] of [['octave', 1], ['third', 3], ['sixth', 6]]) {
    const options = spectrumOptions({ bands, minHz: 30, maxHz: 24000 });
    const result = frequencyBands(options, 44100);
    assert.ok(result.some(b => b.centre === 1000));
    near(result[0].low, 30);
    near(result.at(-1).high, 22050);
    for (let i = 1; i < result.length; ++i) {
      near(result[i].centre / result[i - 1].centre, 2 ** (1 / fraction));
      near(result[i].low, result[i - 1].high);
    }
    assert.deepEqual(frequencyBands({ ...options, count: 256 }, 44100), result);
  }
  for (const bands of ['log', 'linear']) {
    const result = frequencyBands(spectrumOptions({ bands, count: 32 }), 48000);
    assert.equal(result.length, 32);
    near(result[0].low, 30); near(result.at(-1).high, 16000);
  }
  assert.throws(() => frequencyBands(spectrumOptions({ minHz: 12000 }), 16000), /Nyquist/);
});

test('band detector uses weighted linear power and handles unresolved bands and silence', () => {
  for (const size of FFT_SIZES) {
    for (const sampleRate of [44100, 48000, 96000]) {
      const frame = input(-50, size, sampleRate);
      for (const band of frequencyBands(spectrumOptions({ bands: 'sixth' }), sampleRate))
        near(bandDecibels(frame.data, sampleRate, size, band, 'power'), -50);
    }
  }
  const data = new Float32Array(512).fill(-Infinity);
  data[10] = -20; data[11] = -40;
  const band = { low: 950, high: 1150 };
  near(bandDecibels(data, 102400, 1024, band, 'power'), 10 * Math.log10((0.01 + 0.0001) / 2));
  near(bandDecibels(data, 102400, 1024, band, 'peak'), -20);
  near(bandDecibels(data, 102400, 1024, { low: 1001, high: 1002 }, 'power'), -20);
  assert.equal(bandDecibels(data, 102400, 1024, { low: 5000, high: 6000 }, 'power'), -Infinity);
  data[10] = NaN;
  assert.throws(() => bandDecibels(data, 102400, 1024, band, 'power'), /FFT magnitude/);
});

test('slope compensation is dB per octave about 1 kHz, with separate analysis gain', () => {
  const plot = new SpectrumPlot(64, 32);
  plot.setOptions({ bands: 'octave', minHz: 300, maxHz: 3000, slope: 6, gainDb: 3 });
  plot.update(input(-50), 0);
  for (let i = 0; i < plot.bands.length; ++i)
    near(plot.levels[i], -47 + 6 * Math.log2(plot.bands[i].centre / 1000));
  plot.update(input(-Infinity), 2);
  assert.ok(plot.levels.every(v => Number.isFinite(v) && v >= -90));
});

test('attack/release and peak hold obey seconds, including exact post-hold fall time', () => {
  const plot = new SpectrumPlot(32, 32);
  plot.setOptions({ attack: 100, release: 200, peaks: false });
  plot.update(input(-90), 0);
  plot.update(input(-30), 0.1);
  near(plot.levels[0], -90 + 60 * (1 - Math.exp(-1)));
  const before = plot.levels[0];
  plot.update(input(-90), 0.3);
  near(plot.levels[0], before + (-90 - before) * (1 - Math.exp(-1)));
  plot.setOptions({ attack: 0, release: 0, hold: 800, fall: 24 });
  plot.update(input(-30, 8192, 48000, 2), 0);
  plot.update(input(-90, 8192, 48000, 2), 0.5);
  near(plot.peaks[0], -30);
  plot.update(input(-90, 8192, 48000, 2), 1.3);
  near(plot.peaks[0], -42);
  assert.throws(() => plot.update(input(-50, 8192, 48000, 2), 1), /backwards/);
});

test('ballistics and peaks are output-FPS independent and freeze on an unchanged clock', () => {
  const results = [10, 30, 60].map(fps => {
    const plot = new SpectrumPlot(64, 32);
    plot.setOptions({ attack: 50, release: 200, hold: 500 });
    plot.update(input(-30), 0);
    for (let i = 1; i <= 2 * fps; ++i) plot.update(input(-80), i / fps);
    const levels = [...plot.levels], peaks = [...plot.peaks];
    plot.update(input(-20), 2);
    assert.deepEqual([...plot.levels], levels);
    assert.deepEqual([...plot.peaks], peaks);
    return { levels, peaks };
  });
  for (const result of results.slice(1)) {
    result.levels.forEach((v, i) => near(v, results[0].levels[i]));
    result.peaks.forEach((v, i) => near(v, results[0].peaks[i]));
  }
});

test('smooth curves stay bounded between neighbours and interpolate exact band centres', () => {
  for (const values of [[0, 1, 0, 1, 0], [0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0], [0.5]]) {
    for (let i = 0; i < values.length; ++i) near(spectrumCurve(values, i, true), values[i]);
    for (let p = 0; p < values.length - 1; p += 0.01) {
      const i = Math.floor(p), v = spectrumCurve(values, p, true);
      assert.ok(v >= Math.min(values[i], values[i + 1]) - 1e-9 && v <= Math.max(values[i], values[i + 1]) + 1e-9);
    }
  }
});

test('every layout draws native buffers with curves, peaks, labels and tiny/portrait panels', () => {
  for (const [width, height] of [[1, 1], [1, 64], [64, 32], [48, 96], [256, 192]]) {
    for (const layout of ['bars', 'line', 'area', 'mirror', 'circle', 'spiral']) {
      for (const curve of ['linear', 'smooth']) {
        const plot = new SpectrumPlot(width, height);
        plot.setOptions({ layout, curve, paletteId: 'Sunset_Real_gp', attack: 0, release: 0 });
        const first = plot.render(0, input(-50)).slice();
        assert.equal(first.length, width * height * 3);
        assert.ok(first.some(v => v > 0), `${layout} ${width}x${height}`);
        const second = plot.render(0.1, input(-25));
        if (width > 1 && height > 1) assert.notDeepEqual(second, first, `${layout} reacts`);
      }
    }
  }
});

test('changes to layout preserve history while band/source/FFT changes reset incompatible data', () => {
  const plot = new SpectrumPlot(64, 32);
  plot.update(input(-30), 0);
  const levels = plot.levels;
  plot.setOptions({ layout: 'spiral', paletteId: 'fire_gp' });
  plot.update(input(-30), 0.1);
  assert.equal(plot.levels, levels);
  plot.setOptions({ bands: 'linear', count: 16 });
  plot.update(input(-60), 0.2);
  assert.equal(plot.levels.length, 16);
  assert.notEqual(plot.levels, levels);
  plot.update(input(-90, 4096, 44100, 2), 0.3);
  assert.ok(plot.peaks.every(v => v === -90));
  assert.throws(() => plot.render(NaN, input()), /valid raw FFT/);
});

test('configurable FFT data remains separate from legacy spectrum, waveform and key analysis', () => {
  const audio = new AudioAnalyzer();
  const legacy = audio.spectrum, wave = audio.wave, detector = audio.keyDetector;
  audio.startSimulated();
  for (const size of FFT_SIZES) {
    audio.configurePlot(size, true);
    audio.update(0.1, 1);
    assert.equal(audio.plotInput.data.length, size / 2);
    assert.equal(audio.plotInput.fftSize, size);
    assert.ok(audio.plotInput.data.every(Number.isFinite));
    assert.ok(audio.plotInput.data.some(v => v > -70));
    assert.equal(audio.spectrum, legacy);
    assert.equal(audio.wave, wave);
    assert.equal(audio.spectrum.length, 256);
    assert.equal(audio.keyDetector, detector);
  }
  assert.throws(() => audio.configurePlot(1000, true), /FFT size/);
  const source = audio.plotInput.source;
  audio.stop();
  assert.notEqual(audio.plotInput.source, source);
  assert.ok(audio.plotInput.data.every(v => v === -Infinity));
  assert.equal(audio.key, null);
});

test('live input connects an independent configurable analyser and clears it on stop', async t => {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const connected = [];
  let stopped = false, closed = false;
  class Analyser {
    constructor() { this.fftSize = 2048; }
    get frequencyBinCount() { return this.fftSize / 2; }
    getFloatFrequencyData(data) { data.fill(-80); data[Math.round(1000 * this.fftSize / 48000)] = -20; }
    getByteFrequencyData(data) { data.fill(64); }
    getByteTimeDomainData(data) { data.fill(128); }
  }
  class Context {
    constructor() { this.sampleRate = 48000; }
    createMediaStreamSource() { return { connect: node => connected.push(node) }; }
    createAnalyser() { return new Analyser(); }
    close() { closed = true; return Promise.resolve(); }
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped = true; } }], getAudioTracks: () => [] }) },
  } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  const audio = new AudioAnalyzer();
  t.after(() => {
    audio.stop();
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
    if (oldContext) Object.defineProperty(globalThis, 'AudioContext', oldContext);
    else delete globalThis.AudioContext;
  });
  audio.configurePlot(16384, true);
  await audio.startDevice('test-device');
  // Bands and beat, key, Spectrum Lab, and flux.
  assert.equal(connected.length, 4);
  assert.equal(audio.analyser.fftSize, 2048);
  assert.equal(audio.keyAnalyser.fftSize, 8192);
  assert.equal(audio.plotAnalyser.fftSize, 16384);
  assert.equal(audio.plotAnalyser.smoothingTimeConstant, 0);
  audio.update(0.1, 1);
  assert.equal(Math.max(...audio.plotData), -20);
  audio.configurePlot(32768, true);
  audio.update(0.1, 1);
  assert.equal(audio.plotData.length, 16384);
  assert.equal(audio.analyser.fftSize, 2048);
  assert.equal(audio.keyFrequencyData.length, 4096);
  assert.equal(audio.spectrum.length, 256);
  audio.stop();
  assert.ok(stopped && closed);
  assert.equal(audio.plotAnalyser, null);
  assert.ok(audio.plotData.every(v => v === -Infinity));
});

test('rectangular layouts draw octave frequency grid lines; polar layouts do not', () => {
  const gridColumns = (layout) => {
    const plot = new SpectrumPlot(128, 64);
    plot.setOptions({ layout, labels: false, peaks: false });
    const rgb = plot.render(0, input(-Infinity));
    let columns = 0;
    // Row 1 lies between the 10 dB lines, so only vertical lines reach it.
    // Lines are anti-aliased, so count runs of lit pixels rather than colours.
    for (let x = 0; x < 128; ++x)
      if (rgb[(128 + x) * 3 + 2] > 0 && (x === 0 || rgb[(128 + x - 1) * 3 + 2] === 0)) columns++;
    return columns;
  };
  for (const layout of ['bars', 'line', 'area', 'mirror'])
    assert.ok(gridColumns(layout) >= 5, layout);
  assert.equal(gridColumns('circle'), 0);
});
