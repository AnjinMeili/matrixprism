import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioAnalyzer, SPECTRUM_BINS, onsetTime } from '../public/audio.js';
import { TEMPO_DEFAULTS } from '../public/tempo.js';

// The feature step on supplied analyser data (T26): no AudioContext here
// unless a test installs a stand-in.

const sampleRate = 48000;
const bins = 1024;
const fps = 30;

// A 2048-point analyser's frame, with the byte spectrum set by `level(hz)`
// and a sine of the given amplitude (in bytes about 128) as the waveform.
function frame(level, amplitude = 0, extra = {}) {
  const frequencyData = new Uint8Array(bins);
  for (let i = 0; i < bins; ++i)
    frequencyData[i] = level((i + 0.5) * sampleRate / 2 / bins);
  const timeData = new Uint8Array(2048);
  for (let i = 0; i < timeData.length; ++i)
    timeData[i] = Math.round(128 + amplitude * Math.sin(i * 2 * Math.PI * 64 / timeData.length));
  return { sampleRate, frequencyData, timeData, channels: null, readKeyData: null, ...extra };
}

// The log bin that covers `hz`, by the mapping in buildLogBins.
const logBin = (hz) => Math.floor(SPECTRUM_BINS * Math.log(hz / 30) / Math.log(16000 / 30));

const profiles = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

// An 8192-point decibel spectrum with the key's profile across three octaves.
function keySpectrum(tonic, mode) {
  const fft = new Float32Array(4096).fill(-100);
  for (let midi = 48; midi < 84; ++midi) {
    const bin = 440 * 2 ** ((midi - 69) / 12) * 8192 / sampleRate;
    const amplitude = profiles[mode][(midi - tonic + 120) % 12];
    for (let i = Math.floor(bin) - 1; i <= Math.ceil(bin) + 1; ++i)
      fft[i] = Math.max(fft[i], -30 + 20 * Math.log10(amplitude / 6.35) - 12 * (i - bin) ** 2);
  }
  return fft;
}

test('supplied analyser data gives bands, level, spectrum and waveform without an audio context', () => {
  const audio = new AudioAnalyzer();
  const features = audio.analyse(frame((hz) => (hz < 250 ? 255 : 0), 64), 1 / fps, 1, 0);
  assert.equal(features.bass, 1);
  // Neighbouring bands share their edge bin: bin 10 (234 to 258 Hz) is the
  // last of bass and the first of mid's 76.
  assert.ok(Math.abs(features.mid - 1 / 76) < 1e-12, `mid ${features.mid}`);
  assert.equal(features.treble, 0);
  // A sine of half full scale has an RMS of 0.354; level doubles it.
  assert.ok(Math.abs(features.level - Math.SQRT1_2) < 0.01, `level ${features.level}`);
  assert.equal(audio.spectrum[logBin(100)], 255);
  assert.equal(audio.spectrum[logBin(5000)], 0);
  assert.ok(Math.max(...audio.wave) >= 191 && Math.min(...audio.wave) <= 65);
  // No channel split: both sides show the mixed spectrum.
  assert.equal(audio.stereo, false);
  assert.deepEqual([...audio.spectrumLeft], [...audio.spectrum]);
  assert.deepEqual([...audio.spectrumRight], [...audio.spectrum]);
  assert.equal(audio.key, null);

  // Gain scales the spectrum and bands, and a new sample rate remaps the bins.
  audio.analyse(frame((hz) => (hz > 2000 && hz < 12000 ? 100 : 0)), 1 / fps, 2, 0.1);
  assert.ok(Math.abs(audio.features.treble - 200 / 255) < 0.02, `treble ${audio.features.treble}`);
  assert.equal(audio.spectrum[logBin(5000)], 200);
  const at441 = frame(() => 0, 0, { sampleRate: 44100 });
  at441.frequencyData[Math.floor(100 / 22050 * bins)] = 255;
  audio.analyse(at441, 1 / fps, 1, 0.2);
  assert.equal(audio.spectrum[logBin(100)], 255);
});

test('supplied left and right spectra are analysed separately', () => {
  const audio = new AudioAnalyzer();
  const left = frame(() => 200).frequencyData, right = frame(() => 40).frequencyData;
  audio.analyse(frame(() => 90, 0, { channels: [left, right] }), 1 / fps, 1, 0);
  assert.equal(audio.stereo, true);
  assert.equal(audio.spectrum[10], 90);
  assert.equal(audio.spectrumLeft[10], 200);
  assert.equal(audio.spectrumRight[10], 40);
  audio.analyse(frame(() => 90, 0, { channels: [left, new Uint8Array(bins)] }), 1 / fps, 1, 0.1);
  assert.equal(audio.stereo, false);
  assert.deepEqual([...audio.spectrumRight], [...audio.spectrumLeft]);
});

test('beats and tempo follow the supplied clock, not the wall clock', () => {
  const audio = new AudioAnalyzer();
  const kick = frame((hz) => (hz < 250 ? 255 : 20));
  const quiet = frame(() => 20);
  const onsets = [];
  let tempo;
  // Twenty seconds of 120 BPM, run far faster than real time.
  for (let n = 0; n < 20 * fps; ++n) {
    const seconds = n / fps;
    const features = audio.analyse(n % 15 < 2 ? kick : quiet, 1 / fps, 1, seconds);
    if (features.beat === 1) onsets.push(seconds);
    tempo = audio.tempo.update(seconds, TEMPO_DEFAULTS, features);
  }
  assert.equal(onsets.length, 40);
  onsets.forEach((seconds, i) => assert.ok(Math.abs(seconds - i / 2) < 1e-9, `onset ${i} at ${seconds}`));
  assert.equal(tempo.detected, true);
  assert.ok(Math.abs(tempo.bpm - 120) < 0.5, `bpm ${tempo.bpm}`);
});

test('supplied key data is read at most every tenth of a second and finds the key', () => {
  const audio = new AudioAnalyzer();
  const decibels = keySpectrum(7, 'minor');
  let reads = 0;
  const supplied = frame(() => 0, 0, {
    keyFftSize: 8192,
    readKeyData: () => { reads++; return decibels; },
  });
  for (let n = 0; n < 6 * fps; ++n)
    audio.analyse(supplied, 1 / fps, 1, n / fps);
  assert.ok(reads >= 45 && reads <= 60, `${reads} reads in 6 seconds`);
  assert.equal(audio.key?.tonic, 7);
  assert.equal(audio.key.mode, 'minor');
});

test('the live input and the same data supplied directly give the same result', async (t) => {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  // Every analyser of the stand-in context reports the data for frame `n`.
  let n = 0;
  const bytes = (data, channel) => {
    for (let i = 0; i < data.length; ++i)
      data[i] = (i * 7 + n * 13 + channel * 50) % 256 * (i < 300 ? 1 : 0.2);
  };
  const wave = (data) => {
    for (let i = 0; i < data.length; ++i) data[i] = 128 + Math.round(90 * Math.sin(i * 0.05 + n));
  };
  const decibels = keySpectrum(2, 'major');
  class Analyser {
    constructor() { this.fftSize = 2048; this.channel = -1; }
    get frequencyBinCount() { return this.fftSize / 2; }
    getByteFrequencyData(data) { bytes(data, this.channel); }
    getByteTimeDomainData(data) { wave(data); }
    getFloatFrequencyData(data) { data.set(decibels.subarray(0, data.length)); }
    getFloatTimeDomainData(data) { data.fill(0); }
  }
  class Context {
    constructor() { this.sampleRate = sampleRate; }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return new Analyser(); }
    createChannelSplitter() { return { connect(analyser, channel) { analyser.channel = channel; } }; }
    close() {}
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [] }) },
  } });
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Context });
  t.after(() => {
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
    if (oldContext) Object.defineProperty(globalThis, 'AudioContext', oldContext);
    else delete globalThis.AudioContext;
  });

  const live = new AudioAnalyzer();
  await live.startDevice('input');
  const supplied = new AudioAnalyzer();
  const fill = (data, channel) => { bytes(data, channel); return data; };
  for (n = 0; n < 7 * fps; ++n) {
    const seconds = 100 + n / fps;
    live.update(1 / fps, 1.5, seconds);
    const timeData = new Uint8Array(2048);
    wave(timeData);
    supplied.analyse({
      sampleRate,
      frequencyData: fill(new Uint8Array(bins), -1),
      timeData,
      channels: [fill(new Uint8Array(bins), 0), fill(new Uint8Array(bins), 1)],
      // The live input's unsmoothed analyser, as the stand-in reports it.
      fluxData: decibels.slice(0, bins),
      keyFftSize: 8192,
      readKeyData: () => decibels,
    }, 1 / fps, 1.5, seconds);
    assert.deepEqual(live.features, supplied.features, `features at frame ${n}`);
    assert.deepEqual([...live.spectrum], [...supplied.spectrum]);
    assert.deepEqual([...live.spectrumLeft], [...supplied.spectrumLeft]);
    assert.deepEqual([...live.spectrumRight], [...supplied.spectrumRight]);
    assert.deepEqual([...live.wave], [...supplied.wave]);
    assert.deepEqual(live.key, supplied.key);
  }
  assert.ok(live.key, 'the key was found on both');
  live.stop();
});

test('an onset is timed within the frame, to the block where the energy rises', () => {
  const timeData = new Uint8Array(2048).fill(128);
  for (let i = 1500; i < 2048; ++i) timeData[i] = i % 2 ? 228 : 28;
  const at = onsetTime(timeData, 1 / 30, 10, 48000);
  // The burst began 548 samples before the frame's time; blocks are 64 samples.
  assert.ok(Math.abs(at - (10 - 548 / 48000)) <= 64 / 48000, `onset at ${at}`);
  // Nothing new rises: the onset is put at the frame's time.
  assert.equal(onsetTime(new Uint8Array(2048).fill(128), 1 / 30, 10, 48000) <= 10, true);
});

test('the flux source finds the tempo where the bass band is full, free of the frame rate steps', () => {
  // 125 BPM: a beat every 0.48 s, which at 30 fps is 14.4 frames, so beats
  // timed to the frame alone read 128.6. The bass band is full throughout,
  // as in mastered dance music, so the bass rule hears nothing.
  const run = (beatSource) => {
    const audio = new AudioAnalyzer();
    audio.beatSource = beatSource;
    const beats = Array.from({ length: 60 }, (_, k) => 0.1 + k * 0.48);
    let b = 0;
    for (let n = 1; n <= 25 * fps; ++n) {
      const t = n / fps;
      let kick = null;
      while (b < beats.length && beats[b] <= t) kick = beats[b++];
      const fluxData = new Float32Array(bins).fill(-100);
      const timeData = new Uint8Array(2048).fill(128);
      if (kick !== null) {
        fluxData.fill(-20, 0, 40);
        const from = Math.max(0, 2048 - Math.round((t - kick) * sampleRate));
        for (let i = from; i < 2048; ++i) timeData[i] = i % 2 ? 228 : 28;
      }
      audio.analyse({ ...frame(() => 255), timeData, fluxData }, 1 / fps, 1, t);
      audio.tempo.update(t);
    }
    return audio.tempo.detectedBpm;
  };
  const flux = run('flux');
  assert.ok(Math.abs(flux - 125) < 0.5, `flux source: ${flux}`);
  assert.equal(run('bass'), null, 'the bass rule hears no beat');
});

test('spectral features follow brightness and flatness, and fall to 0 in silence (T60)', () => {
  const run = (decibels, waveform = 64) => {
    const audio = new AudioAnalyzer();
    for (let n = 0; n < 2 * fps; ++n)
      audio.analyse(frame(() => 0, waveform, { fluxData: decibels }), 1 / fps, 1, n / fps);
    return audio.features;
  };
  const tone = (hz) => {
    const data = new Float32Array(bins).fill(-120);
    data[Math.round(hz / (sampleRate / 2 / bins))] = -20;
    return data;
  };
  const dark = run(tone(300)), bright = run(tone(5000));
  assert.ok(bright.centroid > dark.centroid + 0.4, `centroid ${dark.centroid} to ${bright.centroid}`);
  assert.ok(bright.rolloff > dark.rolloff + 0.4, `rolloff ${dark.rolloff} to ${bright.rolloff}`);
  assert.ok(dark.flatness < 0.3, `a tone is not flat: ${dark.flatness}`);
  assert.ok(run(new Float32Array(bins).fill(-40)).flatness > 0.9, 'noise is flat');
  for (const value of Object.values(({ ...run(new Float32Array(bins).fill(-Infinity), 0) })))
    assert.ok(Number.isFinite(value));
  const silent = run(new Float32Array(bins).fill(-Infinity), 0);
  assert.deepEqual([silent.centroid, silent.flatness, silent.rolloff, silent.zcr], [0, 0, 0, 0]);
  // Without an unsmoothed spectrum the features stay at 0.
  assert.equal(new AudioAnalyzer().analyse(frame(() => 200, 64), 1 / fps, 1, 0).centroid, 0);
});

test('loudness follows the K-weighted level of the newest samples (T61)', () => {
  const run = (amplitude, hz = 997) => {
    const audio = new AudioAnalyzer();
    const waveform = Float32Array.from({ length: 2048 }, (_, n) => amplitude * Math.sin(2 * Math.PI * hz * n / sampleRate));
    for (let n = 0; n < 2 * fps; ++n)
      audio.analyse(frame(() => 0, 0, { floatTimeData: waveform }), 1 / fps, 1, n / fps);
    return audio.features;
  };
  // The waveform repeats every frame, so only whole cycles keep it continuous:
  // 997 Hz over 1600 samples is not whole, so allow a small error.
  const loud = run(0.1), quiet = run(0.05), silent = run(0);
  assert.ok(Math.abs(loud.lufs - -23.01) < 0.5, `lufs ${loud.lufs}`);
  assert.ok(Math.abs(loud.lufs - quiet.lufs - 6.02) < 0.5, `halving ${loud.lufs - quiet.lufs}`);
  assert.ok(loud.loudness > quiet.loudness && quiet.loudness > 0 && loud.loudness < 1);
  assert.equal(silent.loudness, 0);
  assert.equal(silent.lufs, -100);
  // Without a float waveform the reading stays at silence.
  assert.equal(new AudioAnalyzer().analyse(frame(() => 0, 64), 1 / fps, 1, 0).loudness, 0);
});
