import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLINK_PAIRS, DOUBLING_STEPS, LINEAR_STEPS, PANEL_RANGE_PATTERN, cardLevels,
} from '../public/test-card.js';
import { PATTERNS } from '../public/patterns.js';

const WIDTH = 256;
// The middle of bar or patch `index` of `count`.
const middle = (index, count) => (index + 0.5) / count;

test('the step tables run from dark to full in 8-bit levels', () => {
  assert.deepEqual(LINEAR_STEPS, [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204,
    221, 238, 255]);
  assert.equal(DOUBLING_STEPS.length, 16);
  assert.equal(DOUBLING_STEPS[0], 1);
  assert.equal(DOUBLING_STEPS[15], 255);
  for (let index = 1; index < 16; ++index) {
    const ratio = DOUBLING_STEPS[index] / DOUBLING_STEPS[index - 1];
    assert.ok(ratio > 1.3 && ratio <= 2, `step ${index} is ${ratio} times the one before`);
  }
  for (const [low, high] of BLINK_PAIRS)
    assert.ok(low >= 0 && low < high && high <= 255);
});

test('cardLevels lays the rows out from the top: grey, doubling, red, green, blue, blink', () => {
  for (let bar = 0; bar < 16; ++bar) {
    const u = middle(bar, 16);
    const step = LINEAR_STEPS[bar];
    assert.deepEqual(cardLevels(u, 0.85, 0, WIDTH), [step, step, step]);
    assert.deepEqual(cardLevels(u, 0.55, 0, WIDTH), Array(3).fill(DOUBLING_STEPS[bar]));
    assert.deepEqual(cardLevels(u, 0.42, 0, WIDTH), [step, 0, 0]);
    assert.deepEqual(cardLevels(u, 0.37, 0, WIDTH), [0, step, 0]);
    assert.deepEqual(cardLevels(u, 0.32, 0, WIDTH), [0, 0, step]);
  }
  // The edges of the card belong to the first and last bars.
  assert.deepEqual(cardLevels(1, 0.99, 0, 32), [255, 255, 255]);
  assert.deepEqual(cardLevels(1, 0.1, 0.75, WIDTH), Array(3).fill(BLINK_PAIRS[3][1]));
});

test('cardLevels blinks each patch between its two levels once a second', () => {
  BLINK_PAIRS.forEach(([low, high], patch) => {
    const u = middle(patch, 4);
    assert.deepEqual(cardLevels(u, 0.15, 0.25, WIDTH), [low, low, low]);
    assert.deepEqual(cardLevels(u, 0.15, 0.75, WIDTH), [high, high, high]);
    assert.deepEqual(cardLevels(u, 0.15, 7.25, WIDTH), [low, low, low]);
  });
});

test('cardLevels parts bars with a dark pixel only where a bar can spare one', () => {
  // 256 wide: bars of 16 pixels, the first of each dark.
  assert.deepEqual(cardLevels((5 * 16 + 0.5) / 256, 0.85, 0, 256), [0, 0, 0]);
  assert.deepEqual(cardLevels((5 * 16 + 1.5) / 256, 0.85, 0, 256), Array(3).fill(LINEAR_STEPS[5]));
  // 32 wide: bars of 2 pixels, none given up.
  assert.deepEqual(cardLevels((5 * 2 + 0.5) / 32, 0.85, 0, 32), Array(3).fill(LINEAR_STEPS[5]));
  // Patches are parted by two pixels at any width.
  assert.deepEqual(cardLevels((64 + 1.5) / 256, 0.15, 0.75, 256), [0, 0, 0]);
  assert.deepEqual(cardLevels((64 + 2.5) / 256, 0.15, 0.75, 256), Array(3).fill(BLINK_PAIRS[1][1]));
});

test('the shader is written from the same tables and is chosen by hand only', () => {
  const { glsl } = PANEL_RANGE_PATTERN;
  assert.ok(glsl.includes(
    'bar < 0.5 ? 1.0 : bar < 1.5 ? 2.0 : bar < 2.5 ? 3.0 : bar < 3.5 ? 4.0 : bar < 4.5 ? 6.0'));
  assert.ok(glsl.includes('bar < 14.5 ? 192.0 : 255.0'));
  assert.ok(glsl.includes(
    'tile < 0.5 ? vec2(8.0, 255.0) : tile < 1.5 ? vec2(89.0, 191.0) : ' +
    'tile < 2.5 ? vec2(102.0, 166.0) : vec2(128.0, 255.0)'));
  assert.ok(glsl.includes('uv.y >= 0.70') && glsl.includes('uv.y < 0.30'));
  assert.equal(PANEL_RANGE_PATTERN.manualOnly, true);
  assert.ok(PATTERNS.includes(PANEL_RANGE_PATTERN));
  // Nothing else is kept from the randomizer and the auto cycle this way.
  assert.deepEqual(PATTERNS.filter((pattern) => pattern.manualOnly), [PANEL_RANGE_PATTERN]);
});
