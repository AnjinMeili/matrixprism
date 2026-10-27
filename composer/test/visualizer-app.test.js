import assert from 'node:assert/strict';
import test from 'node:test';
import { PATTERNS } from '../public/patterns.js';
import { VISUALIZER_APP_PATTERNS } from '../public/patterns/visualizer-app/index.js';
import { BAND31, Canvas, Runner, band31, colorize, decibels } from '../public/patterns/visualizer-app/runtime.js';
import { BeatDetectionHelper } from '../public/patterns/visualizer-app/beatdetection-helper.js';
import { Multiband2 } from '../public/patterns/visualizer-app/multiband2.js';
import { Raymarching } from '../public/patterns/visualizer-app/raymarching.js';
import { JuliaFlow } from '../public/patterns/visualizer-app/julia.js';

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const flat = (byte) => new Uint8Array(256).fill(byte);
const sine = Uint8Array.from({ length: 256 }, (_, i) => 128 + Math.round(90 * Math.sin(i / 5)));
const music = Uint8Array.from({ length: 256 }, (_, i) => 120 + Math.round(100 * Math.sin(i / 9) ** 2));
const stateAt = (t, spectrum = music, wave = sine, extra = {}) => ({
  auroraTime: t, spectrum, spectrumLeft: spectrum, spectrumRight: spectrum, wave, audio: { beat: 0 }, ...extra,
});
const lit = (rgb) => { let n = 0; for (let i = 0; i < rgb.length; i += 3) if (rgb[i] || rgb[i + 1] || rgb[i + 2]) n++; return n; };

test('the kept visualisations and Julia Flow are registered as their own group', () => {
  assert.deepEqual(VISUALIZER_APP_PATTERNS.map((p) => p.id.replace('visualizer-app-', '')),
    ['multiband2', 'raymarching', 'julia']);
  for (const pattern of VISUALIZER_APP_PATTERNS) {
    assert.ok(PATTERNS.includes(pattern));
    assert.equal(pattern.group, 'Visualizer App');
    assert.doesNotMatch(`${pattern.name} ${pattern.audio}`, /spotify/i, 'BSD clause 3: no endorsement by name');
  }
});

test('colorize turns a band\'s frequency into the colour of light, red to violet', () => {
  assert.deepEqual(colorize(20), [255, 0, 0]);
  // 750 to 380 nm: the top band lands in the violet, with red coming back.
  const top = colorize(20000);
  assert.equal(top[2], 255);
  assert.ok(top[0] > 200 && top[1] === 0, String(top));
  // Somewhere in the middle it is green.
  assert.ok(BAND31.map(colorize).some(([r, g, b]) => g === 255 && r < 64 && b < 64));
});

test('the composer\'s bytes read as the decibels the originals expect, per third-octave band', () => {
  assert.equal(decibels(0), -96);
  assert.equal(decibels(255), 0);
  assert.deepEqual([...band31(flat(0))], new Array(31).fill(-96));
  assert.deepEqual([...band31(null)], new Array(31).fill(-96));
  // One bin lit near 1 kHz: band 1000 reads it, 100 Hz and 10 kHz do not.
  const spectrum = flat(0);
  const bin = Math.floor(256 * Math.log(1000 / 30) / Math.log(16000 / 30));
  spectrum[bin] = 255;
  const db = band31(spectrum);
  assert.equal(db[BAND31.indexOf(1000)], 0);
  assert.equal(db[BAND31.indexOf(100)], -96);
  assert.equal(db[BAND31.indexOf(10000)], -96);
});

test('the canvas covers by area, puts destination-over behind, and strokes a path once', () => {
  const c = new Canvas(4, 2);
  c.fillRect(0.5, 0, 1, 1, [255, 255, 255]);
  assert.deepEqual([...c.toRGB().slice(0, 9)], [128, 128, 128, 128, 128, 128, 0, 0, 0]);
  c.clear();
  c.fillRect(0, 0, 4, 2, [255, 0, 0]);
  c.composite = 'destination-over';
  c.fillRect(0, 0, 4, 2, [0, 0, 255]);
  assert.deepEqual([...c.toRGB().slice(0, 3)], [255, 0, 0]);
  // A path that doubles back over itself at half alpha is still half bright.
  const d = new Canvas(8, 3);
  d.strokePath([0.5, 1.5, 7.5, 1.5, 0.5, 1.5], [255, 255, 255], 0.5, 1);
  assert.deepEqual([...d.toRGB().slice((8 + 3) * 3, (8 + 3) * 3 + 3)], [128, 128, 128]);
});

test('the beat helper fires on a band rising past its decaying peak, and times the hit', () => {
  const helper = new BeatDetectionHelper();
  const quiet = new Float32Array(31).fill(-96);
  const loud = Float32Array.from(quiet);
  loud[3] = 0; // 40 Hz at full level: 60 / 72 of the range, 83, over 80.
  for (let f = 0; f < 20; ++f) { helper.setData(quiet, quiet); helper.update(); }
  helper.setData(loud, loud);
  assert.equal(helper.low_peak, true);
  assert.equal(helper.mid_peak, false);
  assert.equal(helper.low_timer, 0);
  helper.update();
  assert.equal(helper.low_peak, false);
  assert.equal(helper.peaks[0][3], 81);
  // Held level does not fire again until the peak has decayed past it.
  helper.setData(loud, loud);
  assert.equal(helper.low_peak, false);
});

test('every visualisation draws at small, odd and panel sizes, repeatably', () => {
  for (const pattern of VISUALIZER_APP_PATTERNS.filter((p) => p.createInstance)) {
    for (const [w, h] of [[16, 8], [17, 9], [64, 32], [256, 192]]) {
      const runs = [1, 2].map(() => {
        const instance = pattern.createInstance(w, h, seeded(7));
        let rgb;
        for (let f = 0; f < 30; ++f) rgb = instance.renderFrame(stateAt(f / 60), {});
        return [...rgb];
      });
      assert.equal(runs[0].length, w * h * 3, `${pattern.id} ${w}x${h}`);
      assert.ok(lit(runs[0]) > 0, `${pattern.id} ${w}x${h} draws something`);
      assert.deepEqual(runs[0], runs[1], `${pattern.id} ${w}x${h} repeatable`);
    }
  }
});

test('Bars 2: a louder band draws a taller bar each way from the centre, and silence a line', () => {
  const vz = new Multiband2(64, 48);
  // Lit rows in column 1, the lowest band's bar.
  const column = (rgb) => { let n = 0; for (let y = 0; y < 48; ++y) if (rgb[(y * 64 + 1) * 3]) n++; return n; };
  const heights = [0, 128, 255].map((byte) => {
    vz.audio(stateAt(0, flat(byte)));
    return column(vz.draw());
  });
  assert.ok(heights[0] < heights[1] && heights[1] < heights[2], String(heights));
  // At full level the bars reach the margin: half the height less 50 / 600 of it, each way.
  assert.ok(heights[2] >= 2 * (24 - 4) && heights[2] <= 48, String(heights[2]));
  // In silence the bars have no height, and what is left is the outlines
  // near the centre line, the farthest 40 window pixels (3.2 here) off it.
  vz.audio(stateAt(0, flat(0)));
  const rgb = vz.draw();
  for (let y = 0; y < 48; ++y)
    assert.equal(rgb[(y * 64 + 30) * 3 + 1] > 0, y >= 20 && y <= 27, `row ${y}`);
});

// The flight time the shader's first turn was worked out from.
const turnAt = (time) => Math.sin(2.32 + time * 0.037312) * 1.45 + 0.5;

test('Raymarching in Jump: a low hit jumps the flight forward and resets the beat time', () => {
  const jump = { hits: 'original', motion: 'jump' };
  const ray = new Raymarching(seeded(5));
  const silent = stateAt(0, flat(0));
  ray.uniforms(silent, jump);
  for (let f = 1; f <= 30; ++f) ray.uniforms(stateAt(f / 60, flat(0)), jump);
  assert.ok(ray.values.vz_beattime > 0.4);
  assert.ok(Math.abs(ray.values.vz_rot[0] - turnAt(30 / 60)) < 1e-9);
  const before = ray.time + ray.beatoffset;
  // The composer's beat: a frame whose beat is 1 after one below it.
  const values = ray.uniforms(stateAt(31 / 60, flat(0), sine, { audio: { beat: 1 }, beatPosition: 8 }),
    { ...jump, hits: 'composer' });
  assert.equal(values.vz_beattime, 0);
  // beat1: the offset grows by 5 + 30 times the first random draw.
  const expected = before + 5 + 30 * seeded(5)();
  assert.ok(Math.abs(values.vz_rot[0] - turnAt(expected)) < 1e-9);
  assert.ok(Math.abs(values.vz_z - (expected * 3) % 10) < 1e-9);
  assert.equal(values.vz_color1.length, 3);
  assert.ok(values.vz_color1.every((v) => v >= 0 && v <= 1));
  // The original's detector on a full 40 Hz band.
  const kick = flat(0);
  kick.fill(255, 0, 40);
  const ray2 = new Raymarching(seeded(5));
  ray2.uniforms(silent, jump);
  assert.equal(ray2.uniforms(stateAt(1 / 60, kick), jump).vz_beattime, 0);
});

test('Raymarching in Flow: a low hit surges the flight and eases off, with no jump', () => {
  const ray = new Raymarching(seeded(5));
  const params = { hits: 'composer' };
  ray.uniforms(stateAt(0, flat(0)), params);
  const flight = () => ray.time + ray.beatoffset;
  const step = () => { const t = flight(); ray.animate({ low: false, mid: false, high: false }, true, 1.5); return flight() - t; };
  assert.ok(Math.abs(step() - 1 / 60) < 1e-12, 'cruising');
  ray.uniforms(stateAt(1 / 60, flat(0), sine, { audio: { beat: 1 } }), params);
  assert.equal(ray.beatoffset, 0, 'no jump');
  assert.equal(ray.values.vz_beattime, 0, 'the beams still pulse');
  const first = step();
  assert.ok(first > 2 / 60 && first < 3 / 60, `surging: ${first * 60} times`);
  for (let f = 0; f < 240; ++f) step();
  assert.ok(step() < 1.001 / 60, 'eased off after four seconds');
  // The colours turn a little each frame, not at once.
  ray.targethue1 = ray.hue1 + 90;
  const was = ray.hue1;
  step();
  assert.ok(Math.abs(ray.hue1 - was - 90 * 0.04) < 1e-9);
});

test('Julia Flow: c stays near the cardioid\'s edge, and a beat surges it along, easing off', () => {
  const julia = new JuliaFlow(seeded(9));
  const at = (t, audio = { beat: 0, bass: 0 }) => julia.uniforms({ auroraTime: t, audio }, { surge: 1.5 });
  at(0);
  // On the cardioid's edge, scaled by r: 1 in silence.
  const onEdge = (theta) => [Math.cos(theta) / 2 - Math.cos(2 * theta) / 4, Math.sin(theta) / 2 - Math.sin(2 * theta) / 4];
  const step = (t, audio) => { const before = julia.theta; const values = at(t, audio); return [julia.theta - before, values]; };
  const [cruise, values] = step(0.05);
  assert.ok(Math.abs(cruise - 0.05 * 0.05) < 1e-12);
  const [x, y] = onEdge(julia.theta);
  assert.ok(Math.abs(values.julia_c[0] - x) < 1e-12 && Math.abs(values.julia_c[1] - y) < 1e-12);
  // A beat: the next step goes 2.5 times as far, and no further jump.
  const [surged] = step(0.1, { beat: 1, bass: 0 });
  assert.ok(Math.abs(surged / cruise - 2.5) < 1e-9, String(surged / cruise));
  for (let t = 0.15; t < 4; t += 0.05) step(t, { beat: 0.5, bass: 0 });
  const [settled] = step(4.05);
  assert.ok(settled / cruise < 1.001);
  // A stall is taken as a tenth of a second.
  const [stall] = step(30);
  assert.ok(Math.abs(stall / cruise - 2) < 0.01, String(stall / cruise));
  // The bass pushes c outward and zooms in a little.
  for (let t = 30.05; t < 33; t += 0.05) at(t, { beat: 0, bass: 1 });
  const loud = at(33.05, { beat: 0, bass: 1 });
  assert.ok(Math.hypot(...loud.julia_c.slice(0, 2)) > Math.hypot(...onEdge(julia.theta)) * 1.02);
  assert.ok(loud.julia_zoom < 0.93);
});

test('the runner steps at 60 a second on the clock, and draws once a frame', () => {
  let frames = 0, draws = 0;
  const runner = new Runner({ frame: () => frames++, draw: () => (draws++, new Uint8Array(3)) });
  runner.renderFrame({ auroraTime: 0 });
  runner.renderFrame({ auroraTime: 0.5 });
  assert.equal(draws, 2);
  assert.equal(frames, 1 + 30);
});
