#!/usr/bin/env node
// Measures how high Aurora Bounce's balls go over a long run (aurora-patterns.js,
// T54): the pattern run in Node at a panel's size, on silence or a simulated
// signal, with chosen settings. A measurement, not a check. For each minute it
// reports how high each ball got in that minute, above the floor, as a share of
// the panel's height: the lowest ball, the median and the highest; the balls
// that lay on the floor all minute; and the median for the left, middle and
// right thirds (bass, mids and treble when the balls follow the spectrum).
//
// The simulated signal is the composer's own (`updateSimulated` in audio.js):
// a kick at 120 BPM, a swelling mid band and a flickering treble band.
//
//   node tools/measure-bounce.mjs [--size 64x48] [--minutes 10] [--signal silence|music]
//     [--params '{"music":0,"keepAlive":false}'] [--seed 1]
import { AURORA_PATTERNS } from '../public/aurora-patterns.js';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const [width, height] = arg('--size', '64x48').split('x').map(Number);
const minutes = Number(arg('--minutes', '10'));
const signal = arg('--signal', 'music');
const params = JSON.parse(arg('--params', '{}'));
const FPS = 30, BINS = 256, FLOOR = 31;

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const spectrum = new Uint8Array(BINS);
function audioAt(t) {
  if (signal === 'silence') {
    spectrum.fill(0);
    return { bass: 0, mid: 0, treble: 0, level: 0, beat: 0 };
  }
  const beatPhase = (t * 2) % 1;
  const kick = Math.exp(-beatPhase * 7);
  const swell = 0.5 + 0.5 * Math.sin(t * 0.7);
  for (let i = 0; i < BINS; ++i) {
    const x = i / BINS;
    const shape = kick * Math.exp(-x * 9) +
      0.45 * swell * Math.exp(-((x - 0.45) ** 2) * 40) * (0.6 + 0.4 * Math.sin(t * 5 + i * 0.3)) +
      0.25 * Math.exp(-((x - 0.8) ** 2) * 60) * (0.5 + 0.5 * Math.sin(t * 13 + i));
    spectrum[i] = Math.min(255, 255 * shape);
  }
  return { bass: kick, mid: 0.45 * swell, treble: 0.25, level: 0.5, beat: Math.exp(-beatPhase * 25) };
}

const pattern = AURORA_PATTERNS.find((p) => p.id === 'aurora-bounce');
const bounce = pattern.createInstance(width, height, seeded(Number(arg('--seed', '1'))));
const balls = bounce.boids.length;
const tops = new Float64Array(balls);
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
const share = (value) => (value / FLOOR).toFixed(2);

console.log(`Aurora Bounce at ${width}×${height}, ${balls} balls, signal ${signal}, settings ${JSON.stringify(params)}`);
console.log('minute  lowest  median  highest  on floor  left  middle  right');
tops.fill(-Infinity);
for (let n = 1; n <= minutes * 60 * FPS; ++n) {
  const time = n / FPS;
  bounce.renderFrame({ auroraTime: time, audio: audioAt(time), spectrum }, params);
  bounce.boids.forEach((boid, i) => { tops[i] = Math.max(tops[i], FLOOR - boid.y); });
  if (n % (60 * FPS)) continue;
  const third = Math.floor(balls / 3);
  const parts = [tops.slice(0, third), tops.slice(third, balls - third), tops.slice(balls - third)];
  console.log([
    String(n / (60 * FPS)).padStart(6),
    share(Math.min(...tops)).padStart(7), share(median(tops)).padStart(7), share(Math.max(...tops)).padStart(8),
    String(tops.filter((top) => top < 0.5).length).padStart(9),
    ...parts.map((part) => share(median(part)).padStart(part === parts[1] ? 7 : 5)),
  ].join(' '));
  tops.fill(-Infinity);
}
