// Seeds for the patterns that roll dice (T72). A pattern's instance draws
// all its randomness from one generator; started from a seed, the same seed
// brings back the same roll (its rates, sizes, mirrors, colours). With live
// music an audio pattern still moves with the music, so the frames differ,
// but the variation is the same.

export const SEED_MAX = 2147483647;
// New seeds stay at six digits, easy to read and say; any seed up to
// SEED_MAX is still valid.
export const NEW_SEED_MAX = 999999;

// A small, fast generator (mulberry32's mix) that carries its seed, so a
// pattern can tell a seeded run from an injected test generator.
export function seededRandom(seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  random.seed = seed;
  return random;
}

// A seed from 1 to NEW_SEED_MAX; 0 is kept for "no variation chosen".
export function newSeed(random = Math.random) {
  return 1 + Math.floor(random() * NEW_SEED_MAX);
}

// The setting every dice-rolling pattern carries: 0 lets each run roll its
// own, as before; a seed holds that variation, and Hotsave and playlists
// keep it with the pattern's other settings.
export const VARIATION_PARAM = Object.freeze({
  id: 'variation', name: 'Variation', type: 'variation', default: 0,
  help: 'Which roll of the dice this pattern shows. Keep holds it, and a saved look brings it back',
});

// Whether a pattern's instance must be made afresh for these settings: a
// kept variation other than the one it runs.
export function needsReseed(runningSeed, params) {
  const kept = params?.variation;
  return Number.isInteger(kept) && kept > 0 && kept !== runningSeed;
}
