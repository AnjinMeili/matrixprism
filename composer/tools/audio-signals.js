// Synthetic test signals for the audio comparison (T26), each with the answer
// it should give. The samples are generated here rather than by Web Audio, so
// a signal is the same in Node and in any browser, and noise comes from a
// seeded generator, so it is the same on every run.

export const SAMPLE_RATE = 48000;

// A seeded generator of numbers in [0, 1) (mulberry32).
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// A kick drum at `time`: a sine falling from 90 to 45 Hz, with a click.
function kick(samples, time, gain, noise) {
  const start = Math.round(time * SAMPLE_RATE);
  let phase = 0;
  for (let i = 0; i < 0.35 * SAMPLE_RATE && start + i < samples.length; ++i) {
    const t = i / SAMPLE_RATE;
    phase += 2 * Math.PI * (45 + 45 * Math.exp(-t * 30)) / SAMPLE_RATE;
    const click = t < 0.004 ? (noise() * 2 - 1) * 0.3 * (1 - t / 0.004) : 0;
    samples[start + i] += gain * (Math.exp(-t * 9) * Math.sin(phase) + click);
  }
}

// A snare at `time`: noise with a 180 Hz body.
function snare(samples, time, gain, noise) {
  const start = Math.round(time * SAMPLE_RATE);
  for (let i = 0; i < 0.2 * SAMPLE_RATE && start + i < samples.length; ++i) {
    const t = i / SAMPLE_RATE;
    samples[start + i] += gain * (0.6 * (noise() * 2 - 1) * Math.exp(-t * 25) +
      0.5 * Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 30));
  }
}

// A closed hi-hat at `time`: differenced noise, which leans to the treble.
function hat(samples, time, gain, noise) {
  const start = Math.round(time * SAMPLE_RATE);
  let last = 0;
  for (let i = 0; i < 0.05 * SAMPLE_RATE && start + i < samples.length; ++i) {
    const value = noise() * 2 - 1;
    samples[start + i] += gain * 0.5 * (value - last) * Math.exp(-i / SAMPLE_RATE * 80);
    last = value;
  }
}

// A burst of noise confined to `low` to `high` Hz at `time`: 40 sines spread
// in log frequency with random phases, decaying to a third in `decay`
// seconds. Hats, ticks and cymbals for the high-band hits (T30).
function burst(samples, time, gain, noise, low, high, decay) {
  const start = Math.round(time * SAMPLE_RATE);
  const length = Math.min(samples.length - start, Math.round(decay * 5 * SAMPLE_RATE));
  for (let k = 0; k < 40; ++k) {
    const step = 2 * Math.PI * low * (high / low) ** ((k + noise()) / 40) / SAMPLE_RATE;
    const phase = noise() * 2 * Math.PI;
    for (let i = 0; i < length; ++i)
      samples[start + i] += gain / 6 * Math.sin(phase + step * i) * Math.exp(-i / SAMPLE_RATE / decay);
  }
}

// Beat times from `first` to the end, at `bpm`, changing to `bpmAfter` (if
// given) at `changeAt` seconds.
function beatTimes(seconds, bpm, bpmAfter, changeAt, first = 0.1) {
  const beats = [];
  for (let t = first; t < seconds - 0.05;)
    beats.push(t), t += 60 / (bpmAfter && t >= changeAt ? bpmAfter : bpm);
  return beats;
}

// A kick on every beat. `swing` adds a softer kick two thirds of the way to
// the next beat; `bpmAfter` changes the tempo halfway through.
export function clickTrack({ bpm, seconds = 30, swing = false, bpmAfter = null, seed = 1 }) {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const noise = random(seed);
  const changeAt = seconds / 2;
  const beats = beatTimes(seconds, bpm, bpmAfter, changeAt);
  beats.forEach((time, i) => {
    kick(samples, time, 0.7, noise);
    if (swing && i + 1 < beats.length)
      kick(samples, time + (beats[i + 1] - time) * 2 / 3, 0.35, noise);
  });
  const tempo = bpmAfter ? [{ from: 0, bpm }, { from: changeAt, bpm: bpmAfter }] : [{ from: 0, bpm }];
  return { samples, truth: { beats, tempo, key: null } };
}

// A drum kit with no pitch: kick on beats 1 and 3, snare on 2 and 4, a
// hi-hat on every eighth. Its beat is every quarter; it has no key.
export function drums({ bpm, seconds = 30, seed = 2 }) {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const noise = random(seed);
  const beats = beatTimes(seconds, bpm, null, 0);
  beats.forEach((time, i) => {
    if (i % 2 === 0) kick(samples, time, 0.7, noise);
    else snare(samples, time, 0.5, noise);
    hat(samples, time, 0.3, noise);
    hat(samples, time + 30 / bpm, 0.2, noise);
  });
  // Every eighth has a hat, and so is a high-band hit (T30).
  const hits = beats.flatMap((time) => [time, time + 30 / bpm]).filter((time) => time < seconds - 0.05);
  return { samples, truth: { beats, tempo: [{ from: 0, bpm }], key: null, hits } };
}

// High-band patterns, each hit an answer to find (T30); `truth.hits` holds
// their times. Patterns:
//   sixteenths  a kick on every beat and closed hats (6-14 kHz) on every
//               sixteenth, the off-beats loudest;
//   offbeats    a kick on every beat and open hats (6-16 kHz) between the
//               beats only, so a hit at a kick is a kick heard as a hat;
//   places      ticks alternating low (4-6 kHz) and high (11-15 kHz) on the
//               eighths, with no kick; `truth.places` says which;
//   rolls       closed hats on every thirty-second, over a kick;
//   shaker      a quiet shaker (5-12 kHz) on every sixteenth, under chords.
export function highHits({ bpm, pattern, seconds = 20, seed = 5 }) {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const noise = random(seed);
  const beats = beatTimes(seconds, bpm, null, 0);
  const beat = 60 / bpm;
  const hits = [], places = [];
  if (pattern === 'shaker') samples.set(chords({ tonic: 0, mode: 'major', seconds }).samples);
  for (const time of beats) {
    if (pattern !== 'places' && pattern !== 'shaker') kick(samples, time, 0.7, noise);
    const steps = pattern === 'rolls' ? 8 : pattern === 'places' ? 2 : 4;
    for (let n = 0; n < steps; ++n) {
      const at = time + n * beat / steps;
      if (at >= seconds - 0.05) continue;
      if (pattern === 'sixteenths') burst(samples, at, [0.25, 0.15, 0.35, 0.15][n], noise, 6000, 14000, 0.02);
      else if (pattern === 'rolls') burst(samples, at, n % 2 ? 0.12 : 0.2, noise, 6000, 14000, 0.012);
      else if (pattern === 'offbeats') {
        if (n !== 2) continue;
        burst(samples, at, 0.3, noise, 6000, 16000, 0.08);
      } else if (pattern === 'places') {
        const high = n === 1;
        burst(samples, at, 0.25, noise, high ? 11000 : 4000, high ? 15000 : 6000, 0.03);
        places.push(high ? 'high' : 'low');
      } else if (pattern === 'shaker') burst(samples, at, 0.06, noise, 5000, 12000, 0.03);
      hits.push(at);
    }
  }
  return {
    samples,
    truth: { beats, tempo: [{ from: 0, bpm }], key: pattern === 'shaker' ? { tonic: 0, mode: 'major' } : null,
      hits, ...(pattern === 'places' ? { places } : {}) },
  };
}

const TRIADS = { major: [0, 4, 7], minor: [0, 3, 7] };
// I-IV-V-I in major and i-iv-V-i in minor: [root above the tonic, quality].
const PROGRESSIONS = {
  major: [[0, 'major'], [5, 'major'], [7, 'major'], [0, 'major']],
  minor: [[0, 'minor'], [5, 'minor'], [7, 'major'], [0, 'minor']],
};

// Chords in a key, two seconds each, with the root in the bass. Each note has
// five harmonics falling as 1/n.
export function chords({ tonic, mode, seconds = 16 }) {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const chordSeconds = 2;
  for (let c = 0; c * chordSeconds < seconds; ++c) {
    const [root, quality] = PROGRESSIONS[mode][c % 4];
    const pitch = (tonic + root) % 12;
    const notes = [36 + pitch, ...TRIADS[quality].map((step) => 60 + ((pitch + step) % 12))];
    const start = Math.round(c * chordSeconds * SAMPLE_RATE);
    const end = Math.min(samples.length, Math.round((c + 1) * chordSeconds * SAMPLE_RATE));
    for (const midi of notes) {
      const frequency = midiHz(midi);
      for (let i = start; i < end; ++i) {
        const t = (i - start) / SAMPLE_RATE;
        const envelope = Math.min(1, t / 0.01) * Math.exp(-t * 0.8);
        let value = 0;
        for (let h = 1; h <= 5; ++h)
          value += Math.sin(2 * Math.PI * frequency * h * t) / h;
        samples[i] += 0.08 * envelope * value;
      }
    }
  }
  return { samples, truth: { beats: null, tempo: null, key: { tonic, mode } } };
}

// A sine sweeping from `from` to `to` Hz evenly in log frequency.
export function sweep({ from = 30, to = 16000, seconds = 20, gain = 0.5 }) {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const ratio = Math.log(to / from);
  for (let i = 0; i < samples.length; ++i) {
    const t = i / SAMPLE_RATE;
    samples[i] = gain * Math.sin(2 * Math.PI * from * seconds / ratio * (Math.exp(t / seconds * ratio) - 1));
  }
  return { samples, truth: { beats: null, tempo: null, key: null, sweep: { from, to, seconds } } };
}

// Sweep frequency at `t` seconds.
export const sweepHz = ({ from, to, seconds }, t) => from * (to / from) ** (t / seconds);

// Noise confined to a band: 200 sines spread evenly in log frequency, with
// random phases and slight detuning, scaled to an RMS of `rms`.
export function bandNoise({ low, high, seconds = 6, rms = 0.2, seed = 3 }) {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const noise = random(seed);
  const count = 200;
  for (let k = 0; k < count; ++k) {
    const frequency = low * (high / low) ** ((k + noise()) / count);
    const phase = noise() * 2 * Math.PI;
    const step = 2 * Math.PI * frequency / SAMPLE_RATE;
    for (let i = 0; i < samples.length; ++i)
      samples[i] += Math.sin(phase + step * i);
  }
  let sumSquares = 0;
  for (const value of samples) sumSquares += value * value;
  const scale = rms / Math.sqrt(sumSquares / samples.length);
  for (let i = 0; i < samples.length; ++i) samples[i] *= scale;
  return { samples, truth: { beats: null, tempo: null, key: null, band: [low, high] } };
}

// A 1 kHz sine in steps of `stepSeconds` at each of `dbfs` in turn.
export function levelSteps({ dbfs = [-3, -6, -12, -18, -24, -30, -40], stepSeconds = 3 }) {
  const samples = new Float32Array(Math.round(dbfs.length * stepSeconds * SAMPLE_RATE));
  for (let i = 0; i < samples.length; ++i) {
    const step = Math.floor(i / (stepSeconds * SAMPLE_RATE));
    samples[i] = 10 ** (dbfs[step] / 20) * Math.sin(2 * Math.PI * 1000 * i / SAMPLE_RATE);
  }
  return { samples, truth: { beats: null, tempo: null, key: null, levels: { dbfs, stepSeconds } } };
}

// White noise at an RMS of `rms`, or silence at 0.
export function whiteNoise({ seconds = 15, rms = 0.2, seed = 4 }) {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const noise = random(seed);
  // Uniform noise on [-a, a] has an RMS of a / sqrt(3).
  for (let i = 0; i < samples.length; ++i) samples[i] = (noise() * 2 - 1) * rms * Math.sqrt(3);
  return { samples, truth: { beats: [], tempo: null, key: null } };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// The standard set, as [id, group, generator, options].
export function catalogue() {
  const list = [];
  for (let bpm = 70; bpm <= 180; bpm += 10)
    list.push([`click-${bpm}`, 'tempo', clickTrack, { bpm }]);
  for (const bpm of [90, 120, 150])
    list.push([`swing-${bpm}`, 'tempo', clickTrack, { bpm, swing: true }]);
  list.push(['change-120-128', 'tempo', clickTrack, { bpm: 120, bpmAfter: 128 }]);
  list.push(['change-100-140', 'tempo', clickTrack, { bpm: 100, bpmAfter: 140 }]);
  for (const bpm of [95, 125, 174])
    list.push([`drums-${bpm}`, 'tempo', drums, { bpm }]);
  for (const mode of ['major', 'minor'])
    for (let tonic = 0; tonic < 12; ++tonic)
      list.push([`chords-${NOTE_NAMES[tonic]}-${mode}`, 'key', chords, { tonic, mode }]);
  list.push(['silence', 'none', whiteNoise, { rms: 0 }]);
  list.push(['white-noise', 'none', whiteNoise, {}]);
  list.push(['sweep', 'bands', sweep, {}]);
  list.push(['noise-bass', 'bands', bandNoise, { low: 40, high: 200 }]);
  list.push(['noise-mid', 'bands', bandNoise, { low: 300, high: 1800 }]);
  list.push(['noise-treble', 'bands', bandNoise, { low: 2500, high: 11000 }]);
  list.push(['levels', 'bands', levelSteps, {}]);
  list.push(['hats-16ths-128', 'highs', highHits, { bpm: 128, pattern: 'sixteenths' }]);
  list.push(['hats-offbeat-124', 'highs', highHits, { bpm: 124, pattern: 'offbeats' }]);
  list.push(['hats-places-120', 'highs', highHits, { bpm: 120, pattern: 'places' }]);
  list.push(['hats-rolls-140', 'highs', highHits, { bpm: 140, pattern: 'rolls' }]);
  list.push(['shaker-chords-100', 'highs', highHits, { bpm: 100, pattern: 'shaker' }]);
  return list.map(([id, group, generate, options]) => ({ id, group, generate, options }));
}
