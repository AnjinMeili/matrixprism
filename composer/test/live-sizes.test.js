import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLiveSize, liveSizes } from '../public/live-sizes.js';

const names = (sizes) => sizes.map((s) => `${s.width}x${s.height}`);

test('the 256×192 panel streams at whole multiples in its own 4:3 shape (#6)', () => {
  const sizes = liveSizes(256, 192);
  assert.deepEqual(names(sizes), ['512x384', '768x576', '1024x768', '1280x960']);
  assert.ok(sizes.every((s) => s.width * 3 === s.height * 4));
  assert.equal(names([defaultLiveSize(sizes)])[0], '1024x768');
});

test('sizes stay within 1080 high and 1920 wide, at least 240 high, and even', () => {
  for (const [w, h] of [[256, 192], [128, 64], [64, 32], [192, 64], [32, 32], [96, 48], [100, 75]]) {
    for (const s of liveSizes(w, h)) {
      assert.ok(s.height >= 240 && s.height <= 1080 && s.width <= 1920, `${w}x${h}: ${s.width}x${s.height}`);
      assert.ok(s.width % 2 === 0 && s.height % 2 === 0);
      assert.equal(s.width * h, s.height * w);
    }
  }
});

test('a small panel offers at most six, nearest the usual heights', () => {
  const sizes = liveSizes(64, 32);
  assert.ok(sizes.length <= 6);
  assert.deepEqual(names(sizes), ['704x352', '960x480', '1408x704', '1920x960']);
});

test('a panel too large to enlarge offers nothing, so only Custom is left', () => {
  assert.deepEqual(liveSizes(2048, 1536), []);
});
