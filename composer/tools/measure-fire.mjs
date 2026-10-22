#!/usr/bin/env node
// Measures what the Fire pattern's settings change (fire.js, T41): its
// simulation run in Node at a panel's size on a simulated beat, for each
// value of a setting, with the others at their defaults. A measurement, not a
// check. Reports, over the frames after a warm-up:
// - level: the mean brightness sent, 0 to 255 (the brightest channel);
// - height: how far up the flames reach, as a share of the panel (the
//   highest row whose mean level is over 8);
// - beat: the mean level in the 0.15 s after each beat less that over the
//   rest of the beat, so how much each beat shows;
// - swing: the spread (standard deviation) of the level from frame to frame;
// - embers: embers on the panel, on average, and the pixels they light
//   (before clipping at the edges);
// - full base: the share of the base's cells at full heat, where more sparks
//   can add nothing.
// Seeded; the median of three seeds is printed.
//
//   node tools/measure-fire.mjs [--size 256x192] [--param music] [--values 0,0.5,1]
import { FIRE_PARAMS, Fire2D } from '../public/fire.js';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const [width, height] = arg('--size', '256x192').split('x').map(Number);
const params = arg('--param', 'music,embers,sparking,cooling').split(',');
const values = arg('--values', null)?.split(',').map(Number);
const FPS = 30, SECONDS = 12, WARM = 3, BPM = 120;

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A kick on every beat: bass jumps to 1 and falls to 0.15 over the beat; the
// beat signal is 1 on the kick and decays fast, as the composer's does.
function audioAt(time) {
  const phase = (time * BPM / 60) % 1;
  return { bass: 0.15 + 0.85 * Math.exp(-phase * 6), beat: Math.exp(-phase * 25), phase };
}

function run(setting, seed) {
  const p = { ...Object.fromEntries(FIRE_PARAMS.map((q) => [q.id, q.default])), ...setting };
  const fire = new Fire2D(width, height, seeded(seed));
  const levels = [], heights = [], onBeat = [], offBeat = [];
  let embers = 0, emberPixels = 0, fullBase = 0, frames = 0;
  for (let n = 0; n <= SECONDS * FPS; ++n) {
    const time = n / FPS;
    const audio = audioAt(time);
    const rgb = fire.renderFrame({ auroraTime: time, audio }, p);
    if (time < WARM) continue;
    ++frames;
    let sum = 0, top = 0;
    for (let y = 0; y < height; ++y) {
      let row = 0;
      for (let x = 0; x < width; ++x) {
        const at = (y * width + x) * 3;
        row += Math.max(rgb[at], rgb[at + 1], rgb[at + 2]);
      }
      sum += row;
      // Rows are top first: the flames' top is the first row that is lit.
      if (!top && row / width > 8) top = height - y;
    }
    const level = sum / (width * height);
    levels.push(level);
    heights.push(top / height);
    (audio.phase * 60 / BPM < 0.15 ? onBeat : offBeat).push(level);
    const shown = fire.embers.filter((e) => e.y >= 2 && e.y < height + 2 && e.x >= 0 && e.x < width);
    embers += shown.length;
    // Each ember covers a square emberSize across (1 before T41's fix).
    const size = fire.emberSize ?? 1;
    const lit = new Set();
    for (const e of shown)
      for (let dy = 0; dy < size; ++dy) for (let dx = 0; dx < size; ++dx) lit.add(`${Math.round(e.x) + dx} ${Math.round(e.y) + dy}`);
    emberPixels += lit.size;
    let full = 0;
    for (let i = 0; i < width * 2; ++i) if (fire.heat[i] >= 0.99) ++full;
    fullBase += full / (width * 2);
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const m = mean(levels);
  return {
    level: m, height: mean(heights), beat: mean(onBeat) - mean(offBeat),
    swing: Math.sqrt(mean(levels.map((v) => (v - m) ** 2))),
    embers: embers / frames, emberPixels: emberPixels / frames, fullBase: fullBase / frames,
  };
}

const median = (a) => [...a].sort((x, y) => x - y)[1];
console.log(`Fire at ${width}×${height}, ${BPM} BPM simulated kicks, ${SECONDS - WARM} s after ${WARM} s warm-up, median of 3 seeds\n`);
console.log('| Setting | Value | Level | Height | Beat | Swing | Embers | Ember px | Full base |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const id of params) {
  const param = FIRE_PARAMS.find((q) => q.id === id);
  const list = values ?? [param.min, param.default, param.max];
  for (const value of list) {
    const runs = [1, 2, 3].map((seed) => run({ [id]: value }, seed));
    const pick = (key) => median(runs.map((r) => r[key]));
    console.log(`| ${param.name} | ${value} | ${pick('level').toFixed(1)} | ${(pick('height') * 100).toFixed(0)}% | ` +
      `${pick('beat').toFixed(1)} | ${pick('swing').toFixed(1)} | ${pick('embers').toFixed(1)} | ${pick('emberPixels').toFixed(1)} | ` +
      `${(pick('fullBase') * 100).toFixed(0)}% |`);
  }
}
