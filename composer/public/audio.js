// Turns an audio input into values the shaders consume: a log-scaled
// spectrum, a waveform, band energies, overall level, and a decaying beat.
import { KeyDetector } from './key-detector.js';
import { TRACE_RATE as FLUX_RATE } from './band-flux.js';
import { TempoTracker } from './tempo.js';
import { FFT_SIZES } from './spectrum-plot.js';
import { FluxOnsets, HitDetector, bandShare, flux, magnitudes, riseCentre } from './spectral-features.js';

// When, within the samples that are new since the last frame, an onset most
// likely began: the start of the 64-sample block whose energy rose most over
// the block before it. `timeData` is the analyser's byte waveform, ending at
// `seconds`. Timing onsets this way, rather than at the frame, keeps the
// tempo from being tied to the frame rate.
export function onsetTime(timeData, dt, seconds, sampleRate) {
  const block = 64;
  const fresh = Math.min(timeData.length, Math.max(block, Math.round(dt * sampleRate)));
  const start = timeData.length - fresh;
  let best = -Infinity, at = timeData.length, previous = null;
  for (let b = Math.max(0, start - block); b + block <= timeData.length; b += block) {
    let energy = 0;
    for (let i = b; i < b + block; ++i) energy += ((timeData[i] - 128) / 128) ** 2;
    if (previous !== null && b >= start && energy - previous > best) {
      best = energy - previous;
      at = b;
    }
    previous = energy;
  }
  return seconds - (timeData.length - at) / sampleRate;
}

export const SPECTRUM_BINS = 256;
export const SPECTRUM_HISTORY_ROWS = 256;
export const SPECTRUM_HISTORY_RATE = 30;

export class SpectrumHistory {
  constructor() {
    this.data = new Uint8Array(SPECTRUM_BINS * SPECTRUM_HISTORY_ROWS);
    this.previous = new Uint8Array(SPECTRUM_BINS);
    this.nextRow = 0;
    this.lastSlot = null;
  }

  update(spectrum, seconds) {
    const slot = Math.floor(seconds * SPECTRUM_HISTORY_RATE);
    if (this.lastSlot !== null && slot <= this.lastSlot)
      return false;
    const count = this.lastSlot === null ? 1 :
      Math.min(SPECTRUM_HISTORY_ROWS, slot - this.lastSlot);
    for (let i = 0; i < count; ++i) {
      // Hold the last observation across missed samples, then record the new one.
      this.data.set(i === count - 1 ? spectrum : this.previous, this.nextRow * SPECTRUM_BINS);
      this.nextRow = (this.nextRow + 1) % SPECTRUM_HISTORY_ROWS;
    }
    this.previous.set(spectrum);
    this.lastSlot = slot;
    return true;
  }
}

const BANDS = {
  bass: [20, 250],
  mid: [250, 2000],
  treble: [2000, 12000],
};

// The band whose onsets make sparkles (T30): hi-hats, shakers, cymbals.
export const HIGH_BAND = [4000, 16000];
// Below the high band, the band a hit must outshine: a hit's rise in the
// high band, as a share of that band's level, must be HIGH_BRIGHTNESS times
// the same share here, so broadband transients such as kick clicks and
// snares are not taken for hats. Shares rather than raw rises, because music
// has far more energy here than above 4 kHz; this band's level is taken as at
// least the high band's, so that a near-silent band, whose share of any
// splash is huge, does not outshine every hat.
export const PRESENCE_BAND = [1000, 4000];
export const HIGH_BRIGHTNESS = 1.5;
// A hit's rise, as a share of the band's mean magnitude the frame before,
// must reach this, so the wobble inside a ringing cymbal is not a new hit.
export const HIGH_RISE = 0.5;
// The high band's rise is measured against the spectrum at least this long
// before: at 30 fps the frame before, at 60 the one before that. Against the
// frame before at 60 fps, a hat's rise was split across two frames and too
// many fell short of HIGH_RISE (0.58 of sixteenth hats found, against 0.86
// at 30 fps).
const HIGH_SPAN = 0.03;
// How long `highHit` takes to fall to a third, and the span `highRate` counts.
const HIGH_HIT_DECAY = 0.1;
const HIGH_RATE_SECONDS = 2;
// How quickly `air` follows the high band's share, in seconds.
const AIR_SECONDS = 0.3;

// The values each frame gives, before any input.
const silentFeatures = () => ({
  bass: 0, mid: 0, treble: 0, level: 0, beat: 0,
  highHit: 0, highHits: 0, highStrength: 0, highRate: 0, highPlace: 0.5, air: 0,
});

// The analyser only listens, so it should not touch the audio output. By
// default a context opens the system output device and asks it for small,
// low-latency buffers, which is a device-wide setting on macOS and can make
// other applications' playback stutter, especially over Bluetooth or a
// multi-output device. Ask for no output device at all where the browser
// supports that, and for relaxed buffering otherwise.
export function createAnalysisContext() {
  try {
    return new AudioContext({ latencyHint: 'playback', sinkId: { type: 'none' } });
  } catch {
    return new AudioContext({ latencyHint: 'playback' });
  }
}

// The most flux readings kept waiting (20 s); the Monitor takes them every frame.
const FLUX_QUEUE = 4000;

// The voice processing a browser may apply to an input, as named in its
// settings. Processing meant for calls flattens music dynamics, and on macOS
// it opens the input through the system's voice processing, which is not what
// a page that only listens should ask for.
export const VOICE_PROCESSING = [
  ['echoCancellation', 'echo cancellation'],
  ['noiseSuppression', 'noise suppression'],
  ['autoGainControl', 'gain control'],
  ['voiceIsolation', 'voice isolation'],
];

// What startDevice asks for: the one device chosen (never a fallback to
// another) with every kind of voice processing off. Browsers ignore names
// they do not know, such as voiceIsolation in older ones.
export function inputConstraints(deviceId) {
  const audio = {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    // Ask for both channels; mono devices still work.
    channelCount: { ideal: 2 },
  };
  for (const [name] of VOICE_PROCESSING)
    audio[name] = false;
  return { audio, video: false };
}

// The voice processing the browser left on despite being asked, from a
// track's getSettings(): an empty list when all of it is off. Names the
// browser does not report are not counted.
export function processingLeftOn(settings) {
  return VOICE_PROCESSING.filter(([name]) => settings?.[name] === true).map(([, label]) => label);
}

export class AudioAnalyzer {
  constructor() {
    this.spectrum = new Uint8Array(SPECTRUM_BINS);
    // Per-channel spectra for patterns that show left and right separately.
    // A mono source fills both with the same data and leaves `stereo` false.
    this.spectrumLeft = new Uint8Array(SPECTRUM_BINS);
    this.spectrumRight = new Uint8Array(SPECTRUM_BINS);
    this.stereo = false;
    this.channelAnalysers = null;
    this.wave = new Uint8Array(SPECTRUM_BINS).fill(128);
    this.features = silentFeatures();
    // High-band onsets (T30) and their times over the last two seconds.
    this.highDetector = new HitDetector();
    this.highTimes = [];
    // Recent unsmoothed spectra, { seconds, spectrum }, for HIGH_SPAN.
    this.highHistory = [];
    this.mode = 'none';
    this.context = null;
    this.stream = null;
    this.analyser = null;
    this.bassAverage = 0;
    this.lastBeatTime = -Infinity;
    this.beatSource = 'bass';
    // The Essentia source's worker and audio tap, while it runs; its state
    // for the readout: off, loading, waiting (for ten seconds of audio),
    // running, or an error message.
    this.essentia = null;
    this.essentiaStatus = 'off';
    // True while tempo estimates (tempo.setEstimate) are in charge of the
    // tempo: onsets then give the beat pulse only. Set by startEssentia, or by
    // a caller that supplies estimates itself, such as the audio comparison.
    this.estimatesInCharge = false;
    // While estimates are in charge, flux onsets still give a tempo of their
    // own here, and with `fluxVeto` it can stop a change of tempo that it
    // does not share (TempoTracker.setEstimate's support). On: measured to
    // halve the jumps again on top of the hold, with more of the time right
    // (docs/findings.md, "Tempo through whole tracks").
    this.fluxTempo = new TempoTracker();
    this.fluxVeto = true;
    this.fluxOnsets = new FluxOnsets();
    this.fluxSpectrum = null;
    this.fluxPrevious = null;
    this.flux = null;
    // Flux in the lowest bins (below about 165 Hz): kicks.
    this.lowFlux = null;
    this.lowFluxAverage = 0;
    this.lastKickTime = -Infinity;
    this.simTime = 0;
    this.keyDetector = new KeyDetector();
    // Beat onsets feed the tempo tracker; app.js advances it every frame.
    this.tempo = new TempoTracker();
    this.keyAnalyser = null;
    this.key = null;
    this.keyElapsed = 0;
    this.plotFftSize = 8192;
    this.plotData = new Float32Array(this.plotFftSize / 2).fill(-Infinity);
    this.plotAnalyser = null;
    this.plotSource = 0;
    this.plotEnabled = false;
    // The live input's track; whether it is 'live', or 'muted' or 'ended' by
    // the browser; and the settings the browser applied to it.
    this.inputTrack = null;
    this.inputState = null;
    this.inputSettings = null;
  }

  static async listInputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices)
      return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audioinput');
  }

  async startDevice(deviceId) {
    this.stop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      throw new Error('audio input needs http://localhost or https');
    this.stream = await navigator.mediaDevices.getUserMedia(inputConstraints(deviceId));
    this.watchInput(this.stream.getAudioTracks()[0]);
    this.context = createAnalysisContext();
    const source = this.context.createMediaStreamSource(this.stream);
    this.sourceNode = source;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -15;
    source.connect(this.analyser);
    if (this.context.createChannelSplitter) {
      const splitter = this.context.createChannelSplitter(2);
      source.connect(splitter);
      this.channelAnalysers = [0, 1].map((channel) => {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = this.analyser.fftSize;
        analyser.smoothingTimeConstant = this.analyser.smoothingTimeConstant;
        analyser.minDecibels = this.analyser.minDecibels;
        analyser.maxDecibels = this.analyser.maxDecibels;
        splitter.connect(analyser, channel);
        return analyser;
      });
      this.channelData = [0, 1].map(() => new Uint8Array(this.analyser.frequencyBinCount));
    }
    this.keyAnalyser = this.context.createAnalyser();
    this.keyAnalyser.fftSize = 8192;
    this.keyAnalyser.smoothingTimeConstant = 0;
    source.connect(this.keyAnalyser);
    this.plotAnalyser = this.context.createAnalyser();
    this.plotAnalyser.fftSize = this.plotFftSize;
    this.plotAnalyser.smoothingTimeConstant = 0;
    source.connect(this.plotAnalyser);
    // Unsmoothed, for spectral flux.
    this.fluxAnalyser = this.context.createAnalyser();
    this.fluxAnalyser.fftSize = 2048;
    this.fluxAnalyser.smoothingTimeConstant = 0;
    source.connect(this.fluxAnalyser);
    this.fluxDecibels = new Float32Array(this.fluxAnalyser.frequencyBinCount);
    this.keyFrequencyData = new Float32Array(this.keyAnalyser.frequencyBinCount);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    // What readDevice hands to analyse each frame; the arrays are refilled.
    this.deviceFrame = {
      sampleRate: this.context.sampleRate,
      frequencyData: this.frequencyData,
      timeData: this.timeData,
      channels: this.channelAnalysers ? this.channelData : null,
      fluxData: this.fluxDecibels,
      keyFftSize: this.keyAnalyser.fftSize,
      readKeyData: () => {
        this.keyAnalyser.getFloatFrequencyData(this.keyFrequencyData);
        return this.keyFrequencyData;
      },
    };
    this.mode = 'device';
    if (this.beatSource === 'essentia') this.startEssentia();
    this.startFlux();
  }

  // Spectral flux from every sample of the live input, worked out in the
  // audio thread (flux-worklet.js) so that none is missed between frames.
  // Readings wait in `fluxQueue` as [time on the page's clock, flux] for the
  // Monitor's beat graph (takeFlux); null without a live input, or where
  // the worklet cannot run, when the graph folds loudness instead.
  async startFlux() {
    const context = this.context;
    this.fluxQueue = null;
    try {
      await context.audioWorklet.addModule(new URL('./flux-worklet.js', import.meta.url));
      if (this.context !== context) return;
      const node = new AudioWorkletNode(context, 'band-flux', { numberOfOutputs: 1, outputChannelCount: [1] });
      const sink = context.createGain();
      sink.gain.value = 0;
      this.fluxQueue = [];
      node.port.onmessage = ({ data }) => {
        if (!this.fluxQueue) return;
        // The last reading ended at audio time `end`: as long ago, on the
        // page's clock, as the audio clock has moved on since.
        const end = performance.now() / 1000 - Math.max(0, context.currentTime - data.end), n = data.readings.length;
        data.readings.forEach((flux, i) => this.fluxQueue.push([end - (n - 1 - i) / FLUX_RATE, flux]));
        if (this.fluxQueue.length > FLUX_QUEUE) this.fluxQueue.splice(0, this.fluxQueue.length - FLUX_QUEUE);
      };
      // A node is only run if its output leads somewhere; this leads nowhere audible.
      this.sourceNode.connect(node);
      node.connect(sink);
      sink.connect(context.destination);
      this.fluxNodes = { node, sink };
    } catch {
      this.fluxQueue = null;
    }
  }

  stopFlux() {
    this.fluxQueue = null;
    try {
      this.fluxNodes?.node.disconnect();
      this.fluxNodes?.sink.disconnect();
    } catch {
      // Already gone with its context.
    }
    this.fluxNodes = null;
  }

  // The flux readings up to `until` (seconds on the page's clock), oldest
  // first, taken out of the queue; null when there is no flux to give.
  takeFlux(until) {
    if (!this.fluxQueue) return null;
    let n = 0;
    while (n < this.fluxQueue.length && this.fluxQueue[n][0] <= until) ++n;
    return Float32Array.from(this.fluxQueue.splice(0, n), ([, flux]) => flux);
  }

  // Follows the input track. A browser can mute it without the page asking:
  // Safari lets one page use the microphone at a time and mutes the others
  // (WebKit bug 223198), and a muted track stays muted until the page asks
  // for the input again.
  watchInput(track) {
    this.inputTrack = track ?? null;
    this.inputSettings = track ? track.getSettings() : null;
    this.inputState = !track ? null : track.readyState === 'ended' ? 'ended' : track.muted ? 'muted' : 'live';
    if (!track) return;
    track.onmute = () => { this.inputState = 'muted'; };
    track.onunmute = () => { this.inputState = 'live'; };
    track.onended = () => { this.inputState = 'ended'; };
  }

  // The operator's key, chosen on the Monitor's wheel (KeyDetector.choose),
  // and letting the detector decide again.
  chooseKey(tonic, mode, lock) {
    this.key = this.keyDetector.choose(tonic, mode, lock);
  }

  releaseKey() {
    this.key = this.keyDetector.release();
  }

  // The operator's tempo and bar line, sent from the Monitor's nudge
  // (TempoTracker.hint): to the tracker in charge, and to flux's own, so the
  // veto backs the operator's tempo rather than the one it replaced.
  hintTempo(seconds, bpm, barStart) {
    this.tempo.hint(seconds, bpm, barStart);
    this.fluxTempo.hint(seconds, bpm, barStart);
  }

  // The tempo that may stop a change of the estimates' tempo: flux's, while
  // `fluxVeto` is on and flux has one; otherwise null.
  estimateSupport() {
    return this.fluxVeto ? this.fluxTempo.detectedBpm : null;
  }

  // Chooses where beats come from (BEAT_SOURCES in tempo.js), starting or
  // stopping the Essentia worker as needed.
  setBeatSource(source) {
    this.beatSource = source;
    if (source === 'essentia' && this.mode === 'device') this.startEssentia();
    else if (source !== 'essentia') this.stopEssentia();
  }

  // Taps the live input for the Essentia worker (essentia-worker.js), which
  // loads Essentia (2.8 MB) and estimates the tempo every two seconds from the
  // last ten. Its estimates steer the tempo tracker.
  async startEssentia() {
    if (this.essentia || !this.context) return;
    const context = this.context;
    const run = { worker: null, node: null, sink: null };
    this.essentia = run;
    this.essentiaStatus = 'loading';
    this.estimatesInCharge = true;
    try {
      run.worker = new Worker(new URL('./essentia-worker.js', import.meta.url), { type: 'module' });
      run.worker.onmessage = ({ data }) => {
        if (this.essentia !== run) return;
        if (data.type === 'ready') this.essentiaStatus = 'waiting';
        else if (data.type === 'error') this.essentiaStatus = data.message;
        else if (data.type === 'estimate') {
          // The window ended at audio time `end`; on the frame clock that was
          // as long ago as the audio clock has moved on since.
          const seconds = performance.now() / 1000 - Math.max(0, context.currentTime - data.end);
          // Only the tempo: Essentia's beats on ten-second windows were found
          // up to a third of a beat out, so kicks set the phase (updateBeat).
          this.tempo.setEstimate(seconds, data.bpm, null, data.confidence / 5.32, this.estimateSupport());
          this.essentiaStatus = 'running';
        }
      };
      run.worker.onerror = (event) => { if (this.essentia === run) this.essentiaStatus = `Essentia failed: ${event.message}`; };
      run.worker.postMessage({ type: 'start', sampleRate: context.sampleRate });
      await context.audioWorklet.addModule(new URL('./pcm-capture-worklet.js', import.meta.url));
      if (this.essentia !== run || this.context !== context) return;
      run.node = new AudioWorkletNode(context, 'pcm-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
      run.node.port.onmessage = ({ data }) => run.worker.postMessage({ type: 'samples', ...data }, [data.samples.buffer]);
      // A node is only run if its output leads somewhere; this leads nowhere audible.
      run.sink = context.createGain();
      run.sink.gain.value = 0;
      this.sourceNode.connect(run.node);
      run.node.connect(run.sink);
      run.sink.connect(context.destination);
    } catch (error) {
      if (this.essentia === run) this.essentiaStatus = `Essentia failed: ${error.message}`;
    }
  }

  stopEssentia() {
    const run = this.essentia;
    this.essentia = null;
    this.essentiaStatus = 'off';
    this.estimatesInCharge = false;
    if (!run) return;
    run.worker?.terminate();
    try {
      run.node?.disconnect();
      run.sink?.disconnect();
    } catch {
      // Already gone with its context.
    }
  }

  startSimulated() {
    this.stop();
    this.mode = 'simulated';
    this.simTime = 0;
  }

  stop() {
    this.stopEssentia();
    this.stopFlux();
    if (this.inputTrack)
      this.inputTrack.onmute = this.inputTrack.onunmute = this.inputTrack.onended = null;
    this.inputTrack = null;
    this.inputState = null;
    this.inputSettings = null;
    if (this.stream)
      this.stream.getTracks().forEach((track) => track.stop());
    if (this.context)
      this.context.close();
    this.stream = null;
    this.context = null;
    this.analyser = null;
    this.keyAnalyser = null;
    this.plotAnalyser = null;
    this.fluxAnalyser = null;
    this.channelAnalysers = null;
    this.deviceFrame = null;
    this.fluxTempo = new TempoTracker();
    this.fluxOnsets = new FluxOnsets();
    this.fluxSpectrum = null;
    this.flux = null;
    this.lowFlux = null;
    this.lowFluxAverage = 0;
    this.lastKickTime = -Infinity;
    this.spectrumLeft.fill(0);
    this.spectrumRight.fill(0);
    this.stereo = false;
    this.plotData.fill(-Infinity);
    this.plotSource++;
    this.keyDetector.reset();
    this.key = null;
    this.keyElapsed = 0;
    this.mode = 'none';
    this.spectrum.fill(0);
    this.wave.fill(128);
    this.features = silentFeatures();
    this.highDetector.reset();
    this.highTimes = [];
    this.highHistory = [];
  }

  // Maps 256 output bins logarithmically across 30 Hz - 16 kHz so bass and
  // treble both get usable screen space. `count` is the number of FFT bins.
  buildLogBins(sampleRate, count) {
    const nyquist = sampleRate / 2;
    const low = Math.log(30);
    const high = Math.log(Math.min(16000, nyquist));
    const ranges = [];
    for (let i = 0; i < SPECTRUM_BINS; ++i) {
      const f0 = Math.exp(low + (high - low) * (i / SPECTRUM_BINS));
      const f1 = Math.exp(low + (high - low) * ((i + 1) / SPECTRUM_BINS));
      const b0 = Math.min(count - 1, Math.floor((f0 / nyquist) * count));
      const b1 = Math.min(count, Math.max(b0 + 1, Math.ceil((f1 / nyquist) * count)));
      ranges.push([b0, b1]);
    }
    return ranges;
  }

  bandEnergy(frequencyData, sampleRate, range) {
    const nyquist = sampleRate / 2;
    const count = frequencyData.length;
    const start = Math.max(0, Math.floor((range[0] / nyquist) * count));
    const end = Math.min(count, Math.ceil((range[1] / nyquist) * count));
    let sum = 0;
    for (let i = start; i < end; ++i)
      sum += frequencyData[i];
    return end > start ? sum / ((end - start) * 255) : 0;
  }

  // `seconds` is the frame's time, on the clock the tempo tracker is given.
  update(dt, gain, seconds = performance.now() / 1000) {
    if (this.mode === 'device')
      this.analyse(this.readDevice(), dt, gain, seconds);
    else {
      if (this.mode === 'simulated')
        this.updateSimulated(dt, gain);
      this.updateBeat(dt, seconds);
    }
    if (this.plotEnabled) this.updatePlot();
    return this.features;
  }

  // Reads the live input's analysers into the frame that analyse takes.
  readDevice() {
    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeData);
    this.channelAnalysers?.forEach((analyser, channel) =>
      analyser.getByteFrequencyData(this.channelData[channel]));
    this.fluxAnalyser.getFloatFrequencyData(this.fluxDecibels);
    return this.deviceFrame;
  }

  // The feature step: turns one frame of analyser data into the spectrum,
  // waveform, bands, level, beat and key. The live input supplies it through
  // readDevice; other callers, such as the audio comparison (T26), can
  // supply the same data from elsewhere. `frame` holds:
  //   sampleRate     of the audio analysed;
  //   frequencyData  byte spectrum of a 2048-point analyser (smoothing 0.55,
  //                  -90 to -15 dB), as getByteFrequencyData gives it;
  //   timeData       that analyser's byte waveform;
  //   channels       left and right byte spectra like frequencyData, or null
  //                  for a source with no channel split;
  //   fluxData       the decibel spectrum of an unsmoothed 2048-point analyser,
  //                  for spectral flux, or null (then the bass rule is used);
  //   readKeyData    null, or a function returning the decibel spectrum of an
  //                  8192-point analyser with no smoothing, called at most
  //                  every tenth of a second; with keyFftSize, its FFT size.
  // `seconds` is the frame's time on the tempo tracker's clock; offline,
  // it is the audio's own time.
  analyse(frame, dt, gain, seconds) {
    const { sampleRate, frequencyData, timeData } = frame;
    const count = frequencyData.length;
    if (this.logBins?.sampleRate !== sampleRate || this.logBins.count !== count)
      this.logBins = { sampleRate, count, ranges: this.buildLogBins(sampleRate, count) };
    this.logSpectrum(frequencyData, this.spectrum, gain);
    this.updateChannels(frame.channels, gain);
    const stride = timeData.length / SPECTRUM_BINS;
    let sumSquares = 0;
    for (let i = 0; i < SPECTRUM_BINS; ++i) {
      const sample = timeData[Math.floor(i * stride)];
      const centered = (sample - 128) * gain;
      this.wave[i] = Math.max(0, Math.min(255, 128 + centered));
      sumSquares += (centered / 128) ** 2;
    }
    this.features.level = Math.min(1, Math.sqrt(sumSquares / SPECTRUM_BINS) * 2);
    this.features.bass = Math.min(1, this.bandEnergy(frequencyData, sampleRate, BANDS.bass) * gain);
    this.features.mid = Math.min(1, this.bandEnergy(frequencyData, sampleRate, BANDS.mid) * gain);
    this.features.treble = Math.min(1, this.bandEnergy(frequencyData, sampleRate, BANDS.treble) * gain);
    this.keyElapsed += dt;
    if (frame.readKeyData && this.keyElapsed >= 0.1) {
      this.key = this.keyDetector.update(frame.readKeyData(), sampleRate,
        frame.keyFftSize, this.keyElapsed);
      this.keyElapsed = 0;
    }
    this.flux = null;
    this.lowFlux = null;
    if (frame.fluxData) {
      if (this.fluxSpectrum?.length !== frame.fluxData.length) {
        this.fluxSpectrum = new Float32Array(frame.fluxData.length);
        this.fluxPrevious = new Float32Array(frame.fluxData.length);
      }
      [this.fluxSpectrum, this.fluxPrevious] = [this.fluxPrevious, this.fluxSpectrum];
      magnitudes(frame.fluxData, this.fluxSpectrum);
      this.flux = flux(this.fluxSpectrum, this.fluxPrevious);
      const low = Math.max(1, Math.round(165 / (sampleRate / 2 / frame.fluxData.length)));
      this.lowFlux = flux(this.fluxSpectrum.subarray(0, low), this.fluxPrevious.subarray(0, low));
      const binHz = sampleRate / 2 / frame.fluxData.length;
      const start = Math.min(frame.fluxData.length - 1, Math.round(HIGH_BAND[0] / binHz));
      const end = Math.min(frame.fluxData.length, Math.round(HIGH_BAND[1] / binHz));
      const below = Math.round(PRESENCE_BAND[0] / binHz);
      const reference = this.highReference(seconds) ?? this.fluxPrevious;
      // Each band's mean level in the reference spectrum, and its rise since.
      const band = (from, to) => {
        let level = 0;
        for (let i = from; i < to; ++i) level += reference[i];
        return { level: level / (to - from),
          rise: flux(this.fluxSpectrum.subarray(from, to), reference.subarray(from, to)) };
      };
      const high = band(start, end), presence = band(below, start);
      high.relative = high.rise / Math.max(1e-9, high.level);
      presence.relative = presence.rise / Math.max(1e-9, presence.level, high.level);
      this.updateHighs(dt, seconds, high.rise, riseCentre(this.fluxSpectrum, reference, start, end),
        bandShare(this.fluxSpectrum, start, end),
        high.relative >= HIGH_BRIGHTNESS * presence.relative && high.relative >= HIGH_RISE);
      this.rememberSpectrum(seconds, this.fluxSpectrum);
    } else this.updateHighs(dt, seconds, null);
    this.updateBeat(dt, seconds, timeData, sampleRate);
    return this.features;
  }

  configurePlot(fftSize, enabled) {
    if (!FFT_SIZES.includes(fftSize)) throw new Error('Invalid spectrum FFT size.');
    this.plotEnabled = enabled;
    if (fftSize === this.plotFftSize) return;
    if (this.plotAnalyser) this.plotAnalyser.fftSize = fftSize;
    this.plotFftSize = fftSize;
    this.plotData = new Float32Array(fftSize / 2).fill(-Infinity);
  }

  get plotInput() {
    return { data: this.plotData, fftSize: this.plotFftSize,
      sampleRate: this.context?.sampleRate ?? 48000, source: this.plotSource };
  }

  updatePlot() {
    if (this.mode === 'device') {
      this.plotAnalyser.getFloatFrequencyData(this.plotData);
    } else if (this.mode === 'simulated') {
      const kick = Math.exp(-((this.simTime * 2) % 1) * 7);
      for (let i = 0; i < this.plotData.length; ++i) {
        const hz = i * 48000 / this.plotFftSize;
        const x = Math.log(Math.max(1, hz) / 30) / Math.log(16000 / 30);
        const shape = kick * Math.exp(-Math.max(0, x) * 9) +
          0.5 * Math.exp(-((x - 0.45) ** 2) * 40) * (0.65 + 0.35 * Math.sin(this.simTime * 5 + x * 60)) +
          0.3 * Math.exp(-((x - 0.8) ** 2) * 60) * (0.6 + 0.4 * Math.sin(this.simTime * 13 + x * 150));
        this.plotData[i] = -90 + 75 * Math.min(1, shape);
      }
    } else this.plotData.fill(-Infinity);
  }

  // Folds linear FFT bytes into the log-spaced display bins.
  logSpectrum(frequencyData, target, gain) {
    for (let i = 0; i < SPECTRUM_BINS; ++i) {
      const [b0, b1] = this.logBins.ranges[i];
      let peak = 0;
      for (let b = b0; b < b1; ++b)
        peak = Math.max(peak, frequencyData[b]);
      target[i] = Math.min(255, peak * gain);
    }
  }

  // `channels` is the left and right byte spectra, or null.
  updateChannels(channels, gain) {
    if (!channels) {
      this.spectrumLeft.set(this.spectrum);
      this.spectrumRight.set(this.spectrum);
      this.stereo = false;
      return;
    }
    this.logSpectrum(channels[0], this.spectrumLeft, gain);
    this.logSpectrum(channels[1], this.spectrumRight, gain);
    // A mono input leaves the second channel silent; show it on both sides.
    const silent = (data) => data.every((value) => value === 0);
    this.stereo = !silent(this.spectrumRight);
    if (!this.stereo && !silent(this.spectrumLeft))
      this.spectrumRight.set(this.spectrumLeft);
  }

  // A synthetic 120 BPM signal for trying audio patterns without an input.
  updateSimulated(dt, gain) {
    const before = this.simTime;
    this.simTime += dt;
    const t = this.simTime;
    const beatPhase = (t * 2) % 1;
    const kick = Math.exp(-beatPhase * 7);
    const swell = 0.5 + 0.5 * Math.sin(t * 0.7);
    for (let i = 0; i < SPECTRUM_BINS; ++i) {
      const x = i / SPECTRUM_BINS;
      const shape = kick * Math.exp(-x * 9) +
        0.45 * swell * Math.exp(-((x - 0.45) ** 2) * 40) * (0.6 + 0.4 * Math.sin(t * 5 + i * 0.3)) +
        0.25 * Math.exp(-((x - 0.8) ** 2) * 60) * (0.5 + 0.5 * Math.sin(t * 13 + i));
      this.spectrum[i] = Math.min(255, 255 * shape * gain);
      // The simulated right channel shares the kick but shifts the rest.
      const right = kick * Math.exp(-x * 9) +
        0.45 * (1 - swell) * Math.exp(-((x - 0.55) ** 2) * 40) * (0.6 + 0.4 * Math.sin(t * 4 + i * 0.25)) +
        0.25 * Math.exp(-((x - 0.7) ** 2) * 60) * (0.5 + 0.5 * Math.sin(t * 11 + i));
      this.spectrumLeft[i] = this.spectrum[i];
      this.spectrumRight[i] = Math.min(255, 255 * right * gain);
      this.wave[i] = 128 + 100 * Math.min(1, gain) *
        (0.6 * kick * Math.sin(i * 0.12 + t * 20) + 0.3 * swell * Math.sin(i * 0.5 - t * 9));
    }
    this.features.bass = Math.min(1, kick * gain);
    this.features.mid = Math.min(1, 0.5 * swell * gain);
    this.features.treble = Math.min(1, (0.25 + 0.2 * Math.sin(t * 13)) * gain);
    this.features.level = Math.min(1, (0.3 + 0.5 * kick) * gain);
    // Hats on every sixteenth, the off-beat eighths loudest, and an open hat
    // high in the band every second bar.
    const sixteenth = Math.floor(t * 8), previous = Math.floor(before * 8);
    const hit = sixteenth > previous;
    const accent = sixteenth % 4 === 2 ? 0.9 : sixteenth % 2 ? 0.35 : 0.55;
    const open = sixteenth % 32 === 30;
    this.updateHighs(dt, t, null, 0.5, 0);
    if (hit) {
      const f = this.features;
      f.highHits = 1;
      f.highStrength = Math.min(1, (open ? 1 : accent) * gain);
      f.highHit = Math.max(f.highHit, f.highStrength);
      f.highPlace = open ? 0.85 : 0.3 + 0.2 * ((sixteenth * 0.618) % 1);
      this.highTimes.push(t);
      f.highRate = this.highTimes.length / HIGH_RATE_SECONDS;
    }
    this.features.air = Math.min(1, (0.12 + 0.05 * Math.sin(t * 0.9)) * gain);
    this.stereo = true;
  }

  // The newest remembered spectrum at least HIGH_SPAN before `seconds`, or
  // null if there is none.
  highReference(seconds) {
    for (let i = this.highHistory.length - 1; i >= 0; --i)
      if (this.highHistory[i].seconds <= seconds - HIGH_SPAN + 1e-4) return this.highHistory[i].spectrum;
    return null;
  }

  // Keeps a copy of this frame's spectrum for highReference, dropping those
  // too old to be needed and reusing their arrays.
  rememberSpectrum(seconds, spectrum) {
    let spare = null;
    while (this.highHistory.length > 1 && this.highHistory[1].seconds <= seconds - HIGH_SPAN + 1e-4)
      spare = this.highHistory.shift().spectrum;
    if (spare?.length !== spectrum.length) spare = new Float32Array(spectrum.length);
    spare.set(spectrum);
    this.highHistory.push({ seconds, spectrum: spare });
  }

  // The high band's values for this frame (T30), from its flux, where in the
  // band that flux rose (riseCentre), the band's share of the spectrum, and
  // whether the rise was bright and large enough (HIGH_BRIGHTNESS, HIGH_RISE); or, with `highFlux`
  // null (no unsmoothed analyser), no hits and `air` fading.
  //   highHit       a pulse at each hit, set to its strength, then decaying;
  //   highHits      hits this frame (0 or 1), and highStrength their strength;
  //   highRate      hits a second over the last two seconds;
  //   highPlace     where in 4-16 kHz the last hit rose, 0 to 1;
  //   air           the band's share of the spectrum, smoothed.
  updateHighs(dt, seconds, highFlux, place = 0.5, share = 0, bright = true) {
    const f = this.features;
    const strength = highFlux === null ? 0 : this.highDetector.update(highFlux, seconds, bright);
    f.highHit *= Math.exp(-dt / HIGH_HIT_DECAY);
    f.highHits = strength > 0 ? 1 : 0;
    f.highStrength = strength;
    if (strength > 0) {
      f.highHit = Math.max(f.highHit, strength);
      f.highPlace = place;
      this.highTimes.push(seconds);
    }
    while (this.highTimes.length && this.highTimes[0] <= seconds - HIGH_RATE_SECONDS) this.highTimes.shift();
    f.highRate = this.highTimes.length / HIGH_RATE_SECONDS;
    f.air += (share - f.air) * Math.min(1, dt / AIR_SECONDS);
  }

  // Flags a beat from the chosen source: flux when it has a value this frame,
  // the bass rule otherwise (always for the simulated signal). Bass: the bass
  // band well above its recent average. `seconds` is the frame's time; with
  // `timeData`, a flux onset is timed within the frame (onsetTime). The time
  // is passed on to the tempo tracker. Flux also fires on hi-hats and
  // off-beats, so a flux onset pulls the beat's phase only if it is a kick
  // (the low bins' flux jumps by the same rule), or if no kick has been heard
  // for two seconds; every onset counts towards the tempo.
  updateBeat(dt, seconds, timeData = null, sampleRate = 48000) {
    const bass = this.features.bass;
    this.bassAverage += (bass - this.bassAverage) * Math.min(1, dt * 2.5);
    let onset = null, pullPhase = true;
    // With Essentia in charge of the tempo (it calls tempo.setEstimate), flux
    // onsets still give the beat pulse, and kicks still set the phase, but
    // they do not count towards the tempo.
    const feedTempo = !this.estimatesInCharge;
    if ((this.beatSource === 'flux' || this.beatSource === 'essentia') && this.flux !== null) {
      const kick = this.lowFlux > 1e-5 && this.lowFlux > this.lowFluxAverage * 1.3;
      this.lowFluxAverage += (this.lowFlux - this.lowFluxAverage) * Math.min(1, dt * 2.5);
      if (this.fluxOnsets.update(this.flux, dt, seconds)) {
        onset = timeData ? onsetTime(timeData, dt, seconds, sampleRate) : seconds;
        if (kick) this.lastKickTime = seconds;
        pullPhase = kick || seconds - this.lastKickTime > 2;
      }
    } else if (bass > 0.18 && bass > this.bassAverage * 1.3 && seconds - this.lastBeatTime > 0.22) {
      onset = seconds;
    }
    if (!feedTempo) this.fluxTempo.update(seconds);
    if (onset !== null) {
      this.features.beat = 1;
      this.lastBeatTime = seconds;
      if (feedTempo) this.tempo.onBeat(onset, pullPhase);
      else {
        this.fluxTempo.onBeat(onset, false);
        if (pullPhase) this.tempo.alignTo();
      }
    } else {
      this.features.beat *= Math.exp(-dt * 7);
    }
  }

}
