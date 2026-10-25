import assert from 'node:assert/strict';
import test from 'node:test';
import { SPECTRUM_FLOCK_PARAMS, SpectrumFlock } from '../public/spectrum-flock.js';

// Spectrum Flock (spectrum-flock.js): birds that listen to one frequency each.

function seeded(seed = 1) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const defaults = Object.fromEntries(SPECTRUM_FLOCK_PARAMS.map((p) => [p.id, p.default]));
const sampleRate = 48000;

// A spectrum with a patch of sound a third of an octave wide at each of the
// given Hz, at `db`; a single bin would be diluted in a band's mean.
function patch(data, hz, db) {
  const from = Math.round(hz * 2 ** (-1 / 6) * 8192 / sampleRate), to = Math.round(hz * 2 ** (1 / 6) * 8192 / sampleRate);
  for (let i = from; i <= to; ++i) data[i] = db;
}
function input(tones, on, db = -20) {
  const data = new Float32Array(4096).fill(-100);
  if (on) for (const hz of tones) patch(data, hz, db);
  return { data, fftSize: 8192, sampleRate };
}

function fly(tones, { seconds = 10, params = {} } = {}) {
  const flock = new SpectrumFlock(48, 48, seeded());
  const speeds = {};
  // End a few frames into a pulse, when the tones sound.
  const frames = seconds * 30 + 4;
  for (let n = 0; n < frames; ++n) {
    // The tones pulse twice a second.
    const on = n % 15 < 7;
    flock.renderFrame({ auroraTime: n / 30, spectrumInput: input(tones, on), audio: {} }, { ...defaults, ...params });
    if (n === frames - 1) for (const bird of flock.birds) speeds[bird.frequency] = Math.hypot(bird.vx, bird.vy);
  }
  return { flock, speeds };
}

test('a frame is a full panel of RGB, and silence leaves the birds dim', () => {
  const flock = new SpectrumFlock(32, 32, seeded());
  const out = flock.renderFrame({ auroraTime: 0, spectrumInput: input([], false), audio: {} }, defaults);
  assert.equal(out.length, 32 * 32 * 3);
  const flock2 = new SpectrumFlock(32, 32, seeded());
  for (let n = 0; n < 60; ++n) flock2.renderFrame({ auroraTime: n / 30, spectrumInput: input([], false), audio: {} }, defaults);
  assert.ok(Math.max(...flock2.out) < 80, 'dim without sound');
  assert.ok(Math.max(...flock2.out) > 0, 'still visible');
});

test('birds spread evenly by octave from 40 Hz to 16 kHz', () => {
  const flock = new SpectrumFlock(32, 32, seeded());
  const f = flock.birds.map((b) => b.frequency);
  assert.ok(Math.abs(f[0] - 40) < 1e-6 && Math.abs(f[f.length - 1] - 16000) < 1e-6);
  const ratios = f.slice(1).map((v, i) => v / f[i]);
  assert.ok(Math.max(...ratios) - Math.min(...ratios) < 1e-9);
});

test('a bird flies faster when its frequency sounds than a bird whose frequency does not', () => {
  const heardHz = 1000;
  const { flock, speeds } = fly([heardHz]);
  const frequencies = Object.keys(speeds).map(Number);
  const near = frequencies.reduce((a, b) => Math.abs(Math.log(b / heardHz)) < Math.abs(Math.log(a / heardHz)) ? b : a);
  const far = frequencies.filter((f) => Math.abs(Math.log2(f / heardHz)) > 3);
  assert.ok(far.length > 5);
  const farMean = far.reduce((s, f) => s + speeds[f], 0) / far.length;
  assert.ok(speeds[near] > farMean * 1.5, `near ${speeds[near]} against far ${farMean}`);
  assert.equal(flock.birds.length, defaults.birds);
});

test('a quiet pitch moves its bird as much as a loud one, against its own range', () => {
  const loud = fly([200]).speeds, quiet = (() => {
    const flock = new SpectrumFlock(48, 48, seeded());
    for (let n = 0; n < 304; ++n) {
      // 5 kHz, 40 dB quieter than the loud case, pulsing 20 dB.
      flock.renderFrame({ auroraTime: n / 30, spectrumInput: input([5000], true, n % 15 < 7 ? -60 : -80), audio: {} }, defaults);
    }
    return Object.fromEntries(flock.birds.map((b) => [b.frequency, b.level]));
  })();
  const level = (map, hz) => map[Object.keys(map).map(Number).reduce((a, b) => Math.abs(Math.log(b / hz)) < Math.abs(Math.log(a / hz)) ? b : a)];
  assert.ok(level(quiet, 5000) > 0.3, `quiet pitch level ${level(quiet, 5000)}`);
  assert.ok(Object.keys(loud).length > 0);
});

test('the count follows the Birds setting and the panel stays in range', () => {
  const flock = new SpectrumFlock(24, 16, seeded());
  flock.renderFrame({ auroraTime: 0, spectrumInput: null, audio: {} }, { ...defaults, birds: 20 });
  assert.equal(flock.birds.length, 20);
  for (let n = 0; n < 200; ++n) flock.renderFrame({ auroraTime: n / 30, spectrumInput: input([500], true), audio: { beat: n % 15 === 0 ? 1 : 0 } }, defaults);
  for (const bird of flock.birds) assert.ok(bird.x >= 0 && bird.x < 24 && bird.y >= 0 && bird.y < 16);
});

test('Size scales the birds, and they still swell with the sound', () => {
  const lit = (size, on) => {
    const flock = new SpectrumFlock(48, 48, seeded());
    // Sound pulses (a steady tone has no range to swell within); the last
    // frame, 63, falls inside a pulse.
    for (let n = 0; n < 64; ++n)
      flock.renderFrame({ auroraTime: n / 30, spectrumInput: input([500, 3000], on && n % 15 < 7), audio: {} },
        { ...defaults, size, trail: 0 });
    return flock.out.reduce((count, v) => count + (v > 20 ? 1 : 0), 0);
  };
  assert.ok(lit(2, false) > lit(1, false) * 1.5, `${lit(1, false)} to ${lit(2, false)}`);
  assert.ok(lit(1, true) > lit(1, false), 'sound enlarges birds');
});

// Runs a mode for `frames` frames of pulsing sound at `tones`, ending in a pulse.
function run(mode, tones, { frames = 154, width = 48, height = 48, params = {} } = {}) {
  const flock = new SpectrumFlock(width, height, seeded());
  for (let n = 0; n < frames; ++n)
    flock.renderFrame({ auroraTime: n / 30, spectrumInput: input(tones, n % 15 < 7), audio: {} },
      { ...defaults, mode, ...params });
  return flock;
}

test('Springs: masses sit in a row by pitch, swing up with their sound and settle back without it', () => {
  const flock = run('springs', [1000]);
  const xs = flock.birds.map((b) => b.x);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), 'in order of pitch, left to right');
  const heard = flock.birds.reduce((a, b) => Math.abs(Math.log(b.frequency / 1000)) < Math.abs(Math.log(a.frequency / 1000)) ? b : a);
  const far = flock.birds.find((b) => b.frequency > 8000);
  assert.ok(heard.offset > 0.1, `heard mass at ${heard.offset}`);
  assert.ok(Math.abs(far.offset) < 0.02, `far mass at ${far.offset}`);
  // With the sound gone, the swing dies away.
  for (let n = 0; n < 120; ++n)
    flock.renderFrame({ auroraTime: 5.2 + n / 30, spectrumInput: input([], false), audio: {} }, { ...defaults, mode: 'springs' });
  assert.ok(Math.abs(heard.offset) < 0.03, `settled to ${heard.offset}`);
});

test('Gather: the swarm goes to the pitch that sounds, low to the left and high to the right', () => {
  const centre = (tones) => {
    const flock = run('gather', tones, { frames: 300, width: 96 });
    return flock.birds.reduce((s, b) => s + b.x, 0) / flock.birds.length;
  };
  const low = centre([100]), high = centre([8000]);
  assert.ok(high > low + 15, `low ${low}, high ${high}`);
});

test('Plate: sand settles where the plate is still, on the nodal lines the sound draws', () => {
  const flock = run('plate', [300, 700, 2000, 5000], { frames: 450, width: 64, height: 64 });
  const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;
  const driving = flock.driving();
  const at = mean(flock.grains.map((g) => flock.plateField(g.x / 64, g.y / 64, driving)));
  const random = seeded(7);
  const anywhere = mean(Array.from({ length: 600 }, () => flock.plateField(random(), random(), driving)));
  assert.ok(at < anywhere * 0.5, `grains ${at} against anywhere ${anywhere}`);
});

test('every mode draws a full panel, and changing mode keeps the members', () => {
  const flock = new SpectrumFlock(32, 24, seeded());
  for (const mode of ['flock', 'springs', 'gather', 'plate', 'flock']) {
    const out = flock.renderFrame({ auroraTime: flock.time + 0.1, spectrumInput: input([500], true), audio: {} }, { ...defaults, mode });
    assert.equal(out.length, 32 * 24 * 3);
    assert.equal(flock.birds.length, defaults.birds);
  }
});

test('Size by sound: at 0 the members keep one size whatever they hear, at 1 they swell with it, in every mode', () => {
  const lit = (mode, swell, sound) => {
    const flock = new SpectrumFlock(48, 48, seeded());
    // Sound pulses; the last frame, 63, falls inside a pulse.
    for (let n = 0; n < 64; ++n)
      flock.renderFrame({ auroraTime: n / 30, spectrumInput: input([500, 3000], sound && n % 15 < 7), audio: {} },
        { ...defaults, mode, swell, trail: 0 });
    return flock.out.reduce((count, v) => count + (v > 20 ? 1 : 0), 0);
  };
  for (const mode of ['flock', 'springs', 'gather']) {
    const heard = lit(mode, 1, true), silent = lit(mode, 1, false);
    assert.ok(heard > silent, `${mode}: ${silent} to ${heard} with swell 1`);
  }
  // A lone bird at swell 0 covers the same pixels loud or quiet.
  const area = (level) => {
    const flock = new SpectrumFlock(48, 48, seeded());
    flock.renderFrame({ auroraTime: 0, spectrumInput: null, audio: {} }, { ...defaults, birds: 8, swell: 0, trail: 0 });
    flock.birds.forEach((b, i) => { b.level = i === 0 ? level : 0; b.x = 24; b.y = 24; });
    flock.birds.slice(1).forEach((b) => { b.x = -100; b.y = -100; });
    return flock.draw({ ...defaults, swell: 0, trail: 0, mode: 'flock' }).reduce((c, v) => c + (v > 20 ? 1 : 0), 0);
  };
  assert.equal(area(0), area(1), 'the same size loud or quiet');
  // Cymatics: grains where the plate shakes hard are bigger with swell.
  const grainArea = (swell) => {
    const flock = run('plate', [300, 700, 2000, 5000], { frames: 200, width: 64, height: 64, params: { swell, trail: 0 } });
    return flock.out.reduce((c, v) => c + (v > 20 ? 1 : 0), 0);
  };
  assert.ok(grainArea(1) > grainArea(0), `cymatics ${grainArea(0)} to ${grainArea(1)}`);
});
