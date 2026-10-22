import assert from 'node:assert/strict';
import test from 'node:test';
import { Renderer } from '../public/renderer.js';

// Swap (T16): a stateful pattern's instance, keyed by input, goes with its
// input, so it runs on rather than starting afresh. No GL is needed for the
// bookkeeping, so it is run on a stand-in.

test('a swap moves each input\'s instances to the other input and leaves the rest', () => {
  const renderer = {
    auroraInstances: new Map([['a:fire-2d', 'fire'], ['a:plasma', 'previous'], ['c:tunnel', 'tunnel'], ['b:stars', 'stars'], ['flock', 'one pair']]),
    lastPatternIds: { a: 'fire-2d', b: 'stars', c: 'tunnel' },
  };
  Renderer.prototype.swapInputs.call(renderer, 'a', 'c');
  assert.deepEqual(Object.fromEntries(renderer.auroraInstances),
    { 'c:fire-2d': 'fire', 'c:plasma': 'previous', 'a:tunnel': 'tunnel', 'b:stars': 'stars', flock: 'one pair' });
  assert.deepEqual(renderer.lastPatternIds, { a: 'tunnel', b: 'stars', c: 'fire-2d' });
});
