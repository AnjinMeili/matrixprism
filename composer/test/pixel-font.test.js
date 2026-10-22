import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADVANCE, GLYPHS, GLYPH_HEIGHT, GLYPH_WIDTH, LINE_HEIGHT, drawPixelText, glyph, pixelScale,
  pixelTextHeight, pixelTextWidth,
} from '../public/pixel-font.js';

test('the pixel font covers capitals, digits and the punctuation the info overlay uses', () => {
  for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:/-+%?!#()\'=_|*')
    assert.ok(GLYPHS[character], character);
  for (const [character, pixels] of Object.entries(GLYPHS)) {
    assert.ok(pixels.every(([x, y]) => x >= 0 && x < GLYPH_WIDTH && y >= 0 && y < GLYPH_HEIGHT), character);
    assert.equal(pixels.length === 0, character === ' ', character);
  }
  // Every glyph but the space is distinct, so no two characters can be mistaken.
  const shapes = Object.values(GLYPHS).map((pixels) => JSON.stringify(pixels));
  assert.equal(new Set(shapes).size, shapes.length);
  assert.equal(glyph('a'), GLYPHS.A);
  assert.equal(glyph('é'), GLYPHS['?']);
});

test('sizes step by whole pixels and text measures without its trailing gap', () => {
  assert.equal(ADVANCE, 4);
  assert.equal(LINE_HEIGHT, 6);
  assert.deepEqual([6, 8, 11, 12, 17, 18, 128].map(pixelScale), [1, 1, 1, 2, 2, 3, 21]);
  assert.equal(pixelScale(1), 1);
  assert.equal(pixelTextWidth('', 1), 0);
  assert.equal(pixelTextWidth('A', 1), 3);
  assert.equal(pixelTextWidth('128 BPM', 2), (7 * 4 - 1) * 2);
  assert.equal(pixelTextHeight(1, 1), 5);
  assert.equal(pixelTextHeight(3, 2), (3 * 6 - 1) * 2);
  assert.equal(pixelTextHeight(0, 1), 0);
});

test('drawPixelText lights each glyph pixel as a square, advancing four pixels a glyph', () => {
  const squares = [];
  drawPixelText('I-', 10, 20, 2, (x, y, size) => squares.push([x, y, size]));
  const expected = [
    ...GLYPHS.I.map(([x, y]) => [10 + x * 2, 20 + y * 2, 2]),
    ...GLYPHS['-'].map(([x, y]) => [18 + x * 2, 20 + y * 2, 2]),
  ];
  assert.deepEqual(squares, expected);
});
