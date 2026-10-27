import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_BOUNDS, WindowState, fitBounds } from '../window-state.mjs';

const laptop = { x: 0, y: 25, width: 1512, height: 920 };
const external = { x: 1512, y: 0, width: 2560, height: 1415 };

test('a saved place on a connected screen is used', () => {
  assert.deepEqual(fitBounds({ x: 100, y: 80, width: 1200, height: 800 }, [laptop]), { x: 100, y: 80, width: 1200, height: 800 });
  assert.deepEqual(fitBounds({ x: 1800, y: 100, width: 2000, height: 1200 }, [laptop, external]), { x: 1800, y: 100, width: 2000, height: 1200 });
});

test('a place on a screen no longer connected falls back to the default', () => {
  assert.deepEqual(fitBounds({ x: 1800, y: 100, width: 2000, height: 1200 }, [laptop]), DEFAULT_BOUNDS);
});

test('a window mostly off every screen falls back; one too big is shrunk to its screen', () => {
  assert.deepEqual(fitBounds({ x: 1450, y: 100, width: 800, height: 600 }, [laptop]), DEFAULT_BOUNDS);
  assert.deepEqual(fitBounds({ x: 0, y: 25, width: 3000, height: 2000 }, [laptop]), { x: 0, y: 25, width: 1512, height: 920 });
});

test('nothing saved, or something unreadable, gives the default', () => {
  for (const saved of [null, undefined, {}, { x: 'a', y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 10 }])
    assert.deepEqual(fitBounds(saved, [laptop]), DEFAULT_BOUNDS);
});

test('what is saved is read back, and a damaged file reads as nothing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'window-state-'));
  const state = new WindowState(directory);
  assert.equal(state.load(), null);
  fs.writeFileSync(path.join(directory, 'window-state.json'), JSON.stringify({ x: 1, y: 2, width: 3, height: 4, maximized: true }));
  assert.deepEqual(state.load(), { x: 1, y: 2, width: 3, height: 4, maximized: true });
  fs.writeFileSync(path.join(directory, 'window-state.json'), '{not json');
  assert.equal(state.load(), null);
});
