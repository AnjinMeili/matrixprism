// The frame loop of the audio comparison (T26), shared by the synthetic
// signals (audio-compare.html) and real tracks (audio-tracks.html).
//
// Plays an AudioBuffer through an OfflineAudioContext with analysers set up as
// the composer's (see startDevice in audio.js), stops it every frame to read
// them, and runs the composer's own analysis on what was read, through
// AudioAnalyzer.analyse and its tempo tracker. Beside it: the hand-written
// spectral features, onsets from flux by the composer's beat rule with a tempo
// tracker of their own, and, if asked, Meyda's features (the same 2048
// samples) and Meyda's chroma (the key analyser's 8192 samples) through the
// composer's own key logic. Calls onFrame with each frame's values. Needs
// Meyda's browser build loaded as a global if either Meyda option is on.
// `gain` is the composer's Gain setting (1.5 by default there); `beatSource` is
// its Beat from setting (see BEAT_SOURCES in tempo.js). For the Essentia
// source, `essentia` is a loaded Essentia (loadEssentia in essentia-tempo.js),
// and its estimates are made from the samples heard so far, every two seconds,
// exactly as the live worker makes them.
import { AudioAnalyzer } from '/audio.js';
import { KeyDetector } from '/key-detector.js';
import { TEMPO_DEFAULTS, TempoTracker } from '/tempo.js';
import { magnitudes, centroid, flatness, rolloff, flux, zeroCrossingRate, FluxOnsets } from '/spectral-features.js';
import { EssentiaTempo } from '/essentia-tempo.js';

const MEYDA_FEATURES = ['rms', 'zcr', 'spectralCentroid', 'spectralFlatness', 'spectralRolloff',
  'loudness', 'perceptualSharpness', 'mfcc'];

// The first error each Meyda feature gave, by name.
export const meydaErrors = {};

function analyser(context, source, fftSize, smoothing) {
  const node = context.createAnalyser();
  node.fftSize = fftSize;
  node.smoothingTimeConstant = smoothing;
  source.connect(node);
  return node;
}

// Meyda keeps its settings and filter banks on the object it is called on,
// so each frame size gets its own.
function meyda(bufferSize, sampleRate) {
  const instance = Object.create(globalThis.Meyda);
  Object.assign(instance, { bufferSize, sampleRate, windowingFunction: 'hanning' });
  return instance;
}

const keyLabel = (key) => key ? `${key.tonic}:${key.mode}` : null;

export async function analyseBuffer(buffer, { fps = 30, gain = 1, beatSource = 'bass', essentia = null, estimatesToChange = null, threeTwoAgrees = false, fluxVeto = null, meydaFeatures = true,
  meydaChroma = true, onFrame }) {
  const sampleRate = buffer.sampleRate;
  const context = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, sampleRate);
  const source = context.createBufferSource();
  source.buffer = buffer;
  // The composer's analysers: bands, waveform and beat; and key.
  const main = analyser(context, source, 2048, 0.55);
  main.minDecibels = -90;
  main.maxDecibels = -15;
  const key = analyser(context, source, 8192, 0);
  // Unsmoothed, for the hand-written features.
  const raw = analyser(context, source, 2048, 0);
  // Offline, only what reaches the destination is rendered.
  const sink = context.createGain();
  sink.gain.value = 0;
  for (const node of [main, key, raw]) node.connect(sink);
  sink.connect(context.destination);

  const audio = new AudioAnalyzer();
  audio.beatSource = beatSource;
  // How many live Essentia estimates must agree to change the tempo (tempo.js),
  // when measuring other values than the composer's.
  if (estimatesToChange !== null) audio.tempo.estimatesToChange = estimatesToChange;
  // The two candidates after the hold (docs/findings.md, "Tempo through whole tracks").
  audio.tempo.threeTwoAgrees = threeTwoAgrees;
  // The veto as the composer has it, unless set.
  if (fluxVeto !== null) audio.fluxVeto = fluxVeto;
  let essentiaTempo = null, mono = null, pushed = 0;
  if (beatSource === 'essentia') {
    if (!essentia) throw new Error('The Essentia beat source needs a loaded Essentia.');
    essentiaTempo = new EssentiaTempo(essentia, sampleRate);
    audio.estimatesInCharge = true;
    mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; ++c) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < mono.length; ++i) mono[i] += data[i] / buffer.numberOfChannels;
    }
  }
  const frequencyData = new Uint8Array(1024), timeData = new Uint8Array(2048);
  const keyData = new Float32Array(4096);
  const decibels = new Float32Array(1024), wave = new Float32Array(2048);
  let spectrum = new Float32Array(1024), previous = new Float32Array(1024);
  let previousWave = new Float32Array(2048);
  const keyWave = new Float32Array(8192);
  const meyda2048 = meydaFeatures ? meyda(2048, sampleRate) : null;
  const meyda8192 = meydaChroma ? meyda(8192, sampleRate) : null;
  const meydaKey = new KeyDetector();
  const fluxOnsets = new FluxOnsets(), fluxTempo = new TempoTracker();
  const frame = {
    sampleRate, frequencyData, timeData, channels: null, fluxData: decibels, keyFftSize: 8192,
    readKeyData: () => { key.getFloatFrequencyData(keyData); return keyData; },
  };
  // Suspensions fall on 128-sample render quanta.
  const at = (n) => Math.ceil(n * sampleRate / fps / 128) * 128 / sampleRate;
  let n = 1, last = 0, failure = null;
  // An error inside a suspension would leave the render waiting for ever, so
  // it ends the loop, lets the render finish and is thrown afterwards.
  const step = () => {
    try {
      frameStep();
    } catch (error) {
      failure = error;
      context.resume();
    }
  };
  const frameStep = () => {
    const t = context.currentTime, dt = t - last;
    main.getByteFrequencyData(frequencyData);
    main.getByteTimeDomainData(timeData);
    raw.getFloatFrequencyData(decibels);
    raw.getFloatTimeDomainData(wave);
    let start = performance.now();
    if (essentiaTempo) {
      // The samples heard since the last frame, as the worklet would send them.
      const upTo = Math.min(mono.length, Math.round(t * sampleRate));
      essentiaTempo.push(mono.subarray(pushed, upTo));
      pushed = upTo;
      if (essentiaTempo.due) {
        const e = essentiaTempo.estimate();
        audio.tempo.setEstimate(t, e.bpm, null, e.confidence / 5.32, audio.estimateSupport());
      }
    }
    const features = audio.analyse(frame, dt, gain, t);
    const tempo = audio.tempo.update(t, TEMPO_DEFAULTS, features);
    const analyseMs = performance.now() - start;
    start = performance.now();
    [spectrum, previous] = [previous, spectrum];
    magnitudes(decibels, spectrum);
    const values = {
      t, bass: features.bass, mid: features.mid, treble: features.treble, level: features.level,
      onset: features.beat === 1 ? 1 : 0, bpm: audio.tempo.detectedBpm,
      clockBeat: tempo.newBeat && tempo.detected ? 1 : 0,
      key: keyLabel(audio.key), held: audio.key?.held ? 1 : 0,
      highHit: features.highHits, highStrength: features.highStrength, highPlace: features.highPlace,
      highRate: features.highRate, air: features.air,
      centroid: centroid(spectrum, sampleRate), flatness: flatness(spectrum),
      rolloff: rolloff(spectrum, sampleRate), flux: flux(spectrum, previous), zcr: zeroCrossingRate(wave),
    };
    values.featuresMs = performance.now() - start;
    values.analyseMs = analyseMs;
    values.fluxOnset = fluxOnsets.update(values.flux, dt, t) ? 1 : 0;
    if (values.fluxOnset) fluxTempo.onBeat(t);
    fluxTempo.update(t, TEMPO_DEFAULTS);
    values.fluxBpm = fluxTempo.detectedBpm;
    if (meyda2048) {
      // Its centroid is in bins and its zcr a count.
      start = performance.now();
      const m = meyda2048.extract(MEYDA_FEATURES, wave);
      values.meydaMs = performance.now() - start;
      Object.assign(values, {
        mRms: m.rms, mZcr: m.zcr / 2047, mCentroid: m.spectralCentroid * sampleRate / 2048,
        mFlatness: m.spectralFlatness, mRolloff: m.spectralRolloff, mLoudness: m.loudness.total,
        mSharpness: m.perceptualSharpness, mFlux: null,
      });
      try {
        values.mFlux = meyda2048.extract('spectralFlux', wave, previousWave);
        if (!Number.isFinite(values.mFlux)) throw new Error(`returned ${values.mFlux}`);
      } catch (error) {
        values.mFlux = null;
        meydaErrors.spectralFlux ??= String(error.message || error);
      }
      previousWave = wave.slice();
    }
    if (meyda8192) {
      key.getFloatTimeDomainData(keyWave);
      start = performance.now();
      const chroma = meyda8192.extract('chroma', keyWave);
      const found = meydaKey.addChroma(chroma.map((v) => Number.isFinite(v) ? v : 0), Math.max(1e-6, dt));
      values.chromaMs = performance.now() - start;
      values.mKey = keyLabel(found);
      values.mHeld = found?.held ? 1 : 0;
    }
    onFrame(values);
    last = t;
    ++n;
    if (at(n) < buffer.length / sampleRate) context.suspend(at(n)).then(step);
    context.resume();
  };
  context.suspend(at(n)).then(step);
  source.start();
  await context.startRendering();
  if (failure) throw failure;
}
