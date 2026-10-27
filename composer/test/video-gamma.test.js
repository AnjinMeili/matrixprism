import test from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_GAMMA_DEFAULT, liftFrame, videoGamma, videoGammaTable } from '../public/video-gamma.js';

test('video gamma 1 sends the panel levels unchanged', () => {
  const table = videoGammaTable(1);
  for (let v = 0; v < 256; ++v) assert.equal(table[v], v);
});

test('video gamma 2.2 lifts the dark levels and keeps black and white', () => {
  const table = videoGammaTable(2.2);
  assert.equal(table[0], 0);
  assert.equal(table[255], 255);
  // The look measured on 2026-10-26 averaged 7 of 255 on the panel.
  assert.equal(table[7], Math.round(255 * (7 / 255) ** (1 / 2.2)));
  assert.ok(table[7] > 45 && table[7] < 55);
  for (let v = 1; v < 256; ++v) assert.ok(table[v] >= table[v - 1] && table[v] >= v);
});

test('video gamma is held within its range', () => {
  assert.equal(videoGamma(0.2), 1);
  assert.equal(videoGamma(9), 3);
  assert.equal(videoGamma('2.5'), 2.5);
  assert.equal(videoGamma(undefined), VIDEO_GAMMA_DEFAULT);
  assert.equal(videoGamma(NaN), VIDEO_GAMMA_DEFAULT);
});

test('liftFrame turns RGB rows into opaque RGBA through the table', () => {
  const table = videoGammaTable(2.2);
  const rgb = Uint8Array.from([0, 7, 255, 128, 64, 1]);
  const out = liftFrame(rgb, table, new Uint8ClampedArray(8));
  assert.deepEqual([...out], [0, table[7], 255, 255, table[128], table[64], table[1], 255]);
});
