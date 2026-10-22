import assert from 'node:assert/strict';
import test from 'node:test';
import { BarHistory, BeatGraph, SHARED_BAR_HISTORY, spectrumShape } from '../public/beat-graph.js';
import { PATTERNS } from '../public/patterns.js';

const width = 16, height = 64;
const quiet = new Uint8Array(256).fill(128);
const flat = new Uint8Array(256).fill(100);

// A waveform whose newest `fresh` samples are loud where `loud(i)` holds.
function wave(fresh, loud) {
  const w = new Uint8Array(256).fill(128);
  for (let i = 0; i < fresh; ++i) w[256 - fresh + i] = 128 + (loud(i) ? 100 : 2) * (i % 2 ? 1 : -1);
  return w;
}

// Runs the graph at 30 frames a second and 120 BPM (a bar every 2 s), with a
// loud moment at the start of each beat. Returns the last frame.
function run(graph, seconds, { bpm = 120, phase = 0 } = {}) {
  let frame;
  const fresh = Math.round(256 * (1 / 30) / (2048 / 48000));
  for (let n = 0; n <= seconds * 30; ++n) {
    const t = n / 30;
    // Loud for the first 50 ms after each beat of the music, which may be
    // offset from the clock by `phase` beats.
    const beatOf = (s) => ((s * 2 + phase) % 1 + 1) % 1;
    frame = graph.renderFrame({
      beatPosition: t * bpm / 60, audioTime: t, hue: 0, spectrum: flat,
      wave: wave(fresh, (i) => beatOf(t - (fresh - i) / fresh / 30) < 0.1),
    });
  }
  return frame;
}

// The frames `run` feeds, for feeding several graphs or a history alike.
function frames(seconds, { bpm = 120, from = 0 } = {}) {
  const fresh = Math.round(256 * (1 / 30) / (2048 / 48000));
  const out = [];
  for (let n = Math.round(from * 30); n <= seconds * 30; ++n) {
    const t = n / 30;
    const beatOf = (s) => ((s * 2) % 1 + 1) % 1;
    out.push({ beatPosition: t * bpm / 60, audioTime: t, hue: 0, spectrum: flat,
      wave: wave(fresh, (i) => beatOf(t - (fresh - i) / fresh / 30) < 0.1) });
  }
  return out;
}

const pixel = (rgb, x, y) => Math.max(rgb[(y * width + x) * 3], rgb[(y * width + x) * 3 + 1], rgb[(y * width + x) * 3 + 2]);

test('beats in time with the clock draw horizontal lines at the beat rows', () => {
  const rgb = run(new BeatGraph(width, height), 12);
  // Columns are 2 pixels a bar; take a finished bar a few columns from the right.
  for (const x of [width - 4, width - 6, width - 8]) {
    for (const beat of [0, 1, 2, 3]) {
      const row = beat * height / 4;
      assert.ok(pixel(rgb, x, row) > 150, `beat ${beat} at x ${x}: ${pixel(rgb, x, row)}`);
    }
    // Between beats it is dark; no guide falls there.
    assert.ok(pixel(rgb, x, height / 8) < 40, `between beats at x ${x}: ${pixel(rgb, x, height / 8)}`);
  }
});

test('a clock off in phase moves the lines off the beat guides, and silence draws nothing but guides', () => {
  const late = run(new BeatGraph(width, height), 12, { phase: 0.5 });
  const x = width - 6;
  assert.ok(pixel(late, x, height / 8) > 150, 'half a beat late lands between the guides');
  assert.ok(pixel(late, x, 2) < 40);
  const graph = new BeatGraph(width, height);
  let rgb;
  for (let n = 0; n < 200; ++n)
    rgb = graph.renderFrame({ beatPosition: n / 15, audioTime: n / 30, hue: 0, spectrum: new Uint8Array(256), wave: quiet });
  assert.ok(rgb.every((v) => v <= 22), 'only the faint guides');
  assert.equal(rgb[0], 22);
});

test('a clock that jumps back or far ahead does not break the picture', () => {
  const graph = new BeatGraph(width, height);
  run(graph, 4);
  const state = { audioTime: 10, hue: 0, spectrum: flat, wave: quiet };
  assert.equal(graph.renderFrame({ ...state, beatPosition: 2 }).length, width * height * 3);
  assert.equal(graph.renderFrame({ ...state, audioTime: 10.1, beatPosition: 400 }).length, width * height * 3);
  assert.equal(graph.renderFrame({ ...state, audioTime: 10.2, beatPosition: 400.2 }).length, width * height * 3);
});

test('the spectrum shape gives where the energy sits and how peaked it is', () => {
  const bass = new Uint8Array(256); bass[2] = 255;
  const treble = new Uint8Array(256); treble[253] = 255;
  assert.ok(spectrumShape(bass).centre < 0.02);
  assert.ok(spectrumShape(treble).centre > 0.98);
  assert.ok(spectrumShape(bass).peaky > 0.99);
  assert.equal(spectrumShape(flat).peaky, 0);
  assert.deepEqual(spectrumShape(new Uint8Array(256)), { centre: 0, peaky: 0 });
});

test('within the music playing, bass-heavy moments are red and treble-heavy ones blue', () => {
  const graph = new BeatGraph(width, height);
  const bass = new Uint8Array(256); bass[10] = 255;
  const treble = new Uint8Array(256); treble[240] = 255;
  const fresh = Math.round(256 * (1 / 30) / (2048 / 48000));
  let rgb;
  // A bar every 2 s: the first half of each bar bass, the second treble, equally loud.
  for (let n = 0; n <= 300; ++n) {
    const t = n / 30, inBar = (t % 2) / 2;
    rgb = graph.renderFrame({ beatPosition: t * 2, audioTime: t, hue: 0, spectrum: inBar < 0.5 ? bass : treble,
      wave: wave(fresh, () => true) });
  }
  const at = (y) => Array.from(rgb.subarray(((y * width) + width - 4) * 3, ((y * width) + width - 4) * 3 + 3));
  const [r1, , b1] = at(height / 4 + 2), [r2, , b2] = at(height * 3 / 4 + 2);
  assert.ok(r1 > b1, `first half red: ${at(height / 4 + 2)}`);
  assert.ok(b2 > r2, `second half blue: ${at(height * 3 / 4 + 2)}`);
});

test('the beat graph is a pattern that needs audio', () => {
  const pattern = PATTERNS.find((p) => p.id === 'beat-graph');
  assert.ok(pattern?.needsAudio && pattern.audioReactive);
  assert.equal(pattern.createInstance(32, 16).renderFrame({
    beatPosition: 0, audioTime: 0, hue: 0, spectrum: flat, wave: quiet,
  }).length, 32 * 16 * 3);
});

test('a graph made later shows the bars its history already holds, as one that ran all along', () => {
  const history = new BarHistory({ rows: 192, bars: 256 });
  const monitor = new BeatGraph(64, 192, history);
  const early = new BeatGraph(width, height, history);
  for (const state of frames(20)) {
    monitor.renderFrame(state);
    early.renderFrame(state);
  }
  // Made after 20 s, ten bars, as the pattern is when chosen.
  const late = new BeatGraph(width, height, history);
  const last = frames(20.5, { from: 20.04 });
  let a, b;
  for (const state of last) {
    a = monitor.renderFrame(state);
    a = early.renderFrame(state);
    b = late.renderFrame(state);
  }
  assert.deepEqual(Array.from(b), Array.from(a), 'the same picture');
  for (const x of [width - 4, width - 8, 0]) {
    for (const beat of [0, 1, 2, 3])
      assert.ok(pixel(b, x, beat * height / 4) > 150, `beat ${beat} at x ${x}: ${pixel(b, x, beat * height / 4)}`);
    assert.ok(pixel(b, x, height / 8) < 40, `between beats at x ${x}`);
  }
});

test('a frame fed twice counts once, so the monitor and the pattern can both feed one history', () => {
  const shared = new BarHistory({ rows: height, bars: 64 });
  const once = new BeatGraph(width, height);
  const twice = new BeatGraph(width, height, shared);
  const other = new BeatGraph(32, height, shared);
  let a, b;
  for (const state of frames(12)) {
    a = once.renderFrame(state);
    other.renderFrame(state);
    b = twice.renderFrame(state);
  }
  assert.deepEqual(Array.from(b), Array.from(a));
  // Bars 0 to 4; the sixth closes on the first frame past 12 s.
  assert.equal(shared.finished, 5, 'five bars finished by 12 s at 120 BPM');
});

test('a picture smaller than its history averages the rows, and one wider than it leaves the rest black', () => {
  const history = new BarHistory({ rows: 192, bars: 4 });
  const wide = new BeatGraph(width, height, history);
  let rgb;
  for (const state of frames(12)) rgb = wide.renderFrame(state);
  const x = width - 4;
  for (const beat of [0, 1, 2, 3]) assert.ok(pixel(rgb, x, beat * height / 4) > 150);
  assert.ok(pixel(rgb, x, height / 8) < 40);
  // Four bars, eight columns: the left half has only the guides.
  for (let y = 0; y < height; ++y) assert.ok(pixel(rgb, 2, y) <= 22, `row ${y}`);
});

test('the Beat Graph pattern shows the shared history', () => {
  const pattern = PATTERNS.find((p) => p.id === 'beat-graph');
  assert.equal(pattern.createInstance(32, 16).history, SHARED_BAR_HISTORY);
});
