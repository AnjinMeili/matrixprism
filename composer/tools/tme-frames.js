// Hashes of the Table Mark Estes patterns' frames, for showing that a change
// leaves their picture alone (T71). Each run steps the sketch runtime
// directly, on a seeded random sequence and a known spectrum, forces one
// re-roll half way, and hashes every frame.
import { createHash } from 'node:crypto';

export const TME_HASH_SIZES = [[64, 32], [48, 48], [96, 48]];
export const TME_HASH_SEED = 7;
const STEPS = 90;

// Small deterministic generator so runs can be repeated.
export function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// A spectrum that moves from step to step, with a beat every eighth step.
function feed(runtime, step) {
  const left = new Uint8Array(256), right = new Uint8Array(256);
  for (let i = 0; i < 256; ++i) {
    left[i] = Math.round(110 + 100 * Math.sin(i * 0.11 + step * 0.7));
    right[i] = Math.round(110 + 100 * Math.cos(i * 0.07 - step * 0.5));
  }
  runtime.setAudio(left, { level: 0.5, beat: step % 8 === 0 ? 1 : 0 }, right);
}

// The runtime of a fresh instance, with `settings` applied when given.
export function tmeRun(pattern, width, height, seed = TME_HASH_SEED, settings) {
  const animation = pattern.createInstance(width, height, seeded(seed));
  if (settings) animation.applySettings(settings);
  return animation.runtime;
}

export function tmeFramesHash(pattern, width, height, seed = TME_HASH_SEED, settings) {
  const runtime = tmeRun(pattern, width, height, seed, settings);
  const hash = createHash('sha1');
  for (let step = 0; step < STEPS; ++step) {
    if (step === STEPS / 2) runtime.ms = runtime.patternStart + runtime.dwell;
    feed(runtime, step);
    runtime.step();
    hash.update(runtime.rgb);
  }
  return hash.digest('hex').slice(0, 16);
}

export function tmeHashes(patterns, settings) {
  const hashes = {};
  for (const pattern of patterns)
    for (const [width, height] of TME_HASH_SIZES)
      hashes[`${pattern.id}@${width}x${height}`] = tmeFramesHash(pattern, width, height, TME_HASH_SEED, settings);
  return hashes;
}
