// A 3 by 5 pixel font for overlays on small LED panels, where a browser font
// at six or eight pixels blurs into a smudge. Capitals, digits and a little
// punctuation; lower case is drawn as capitals and anything else as "?".
// Each glyph is five rows of three, top first, "#" for a lit pixel.
const ROWS = {
  A: '.#. #.# ### #.# #.#', B: '##. #.# ##. #.# ##.', C: '.## #.. #.. #.. .##',
  D: '##. #.# #.# #.# ##.', E: '### #.. ##. #.. ###', F: '### #.. ##. #.. #..',
  G: '.## #.. #.# #.# .##', H: '#.# #.# ### #.# #.#', I: '### .#. .#. .#. ###',
  J: '..# ..# ..# #.# .#.', K: '#.# #.# ##. #.# #.#', L: '#.. #.. #.. #.. ###',
  M: '#.# ### ### #.# #.#', N: '##. #.# #.# #.# #.#', O: '.#. #.# #.# #.# .#.',
  P: '##. #.# ##. #.. #..', Q: '.#. #.# #.# ##. .##', R: '##. #.# ##. #.# #.#',
  S: '.## #.. .#. ..# ##.', T: '### .#. .#. .#. .#.', U: '#.# #.# #.# #.# ###',
  V: '#.# #.# #.# #.# .#.', W: '#.# #.# ### ### #.#', X: '#.# #.# .#. #.# #.#',
  Y: '#.# #.# .#. .#. .#.', Z: '### ..# .#. #.. ###',
  0: '### #.# #.# #.# ###', 1: '.#. ##. .#. .#. ###', 2: '##. ..# .#. #.. ###',
  3: '##. ..# .#. ..# ##.', 4: '#.# #.# ### ..# ..#', 5: '### #.. ##. ..# ##.',
  6: '.## #.. ### #.# ###', 7: '### ..# .#. .#. .#.', 8: '### #.# ### #.# ###',
  9: '### #.# ### ..# ##.',
  ' ': '... ... ... ... ...', '.': '... ... ... ... .#.', ',': '... ... ... .#. #..',
  ':': '... .#. ... .#. ...', '/': '..# ..# .#. #.. #..', '-': '... ... ### ... ...',
  '+': '... .#. ### .#. ...', '%': '#.# ..# .#. #.. #.#', '?': '##. ..# .#. ... .#.',
  '!': '.#. .#. .#. ... .#.', '#': '#.# ### #.# ### #.#', '(': '.#. #.. #.. #.. .#.',
  ')': '.#. ..# ..# ..# .#.', "'": '.#. .#. ... ... ...', '=': '... ### ... ### ...',
  '_': '... ... ... ... ###', '|': '.#. .#. .#. .#. .#.', '*': '#.# .#. #.# ... ...',
};

export const GLYPH_WIDTH = 3;
export const GLYPH_HEIGHT = 5;
// One dark column after each glyph and one dark row under each line.
export const ADVANCE = GLYPH_WIDTH + 1;
export const LINE_HEIGHT = GLYPH_HEIGHT + 1;

// The lit pixels of each glyph as [column, row] pairs.
export const GLYPHS = Object.fromEntries(Object.entries(ROWS).map(([character, rows]) => [
  character,
  rows.split(' ').flatMap((row, y) => [...row].flatMap((cell, x) => cell === '#' ? [[x, y]] : [])),
]));

export function glyph(character) {
  return GLYPHS[character.toUpperCase()] ?? GLYPHS['?'];
}

// The whole-pixel scale for a text size, so that the font stays crisp: one
// pixel of the font per six pixels of size.
export function pixelScale(size) {
  return Math.max(1, Math.floor(size / LINE_HEIGHT));
}

// Width in panel pixels of one line at `scale`, without the gap after it.
export function pixelTextWidth(text, scale) {
  return text.length ? (text.length * ADVANCE - 1) * scale : 0;
}

// Height in panel pixels of `lines` lines at `scale`, without the gap after
// the last.
export function pixelTextHeight(lines, scale) {
  return lines ? (lines * LINE_HEIGHT - 1) * scale : 0;
}

// Calls fill(x, y, size) for each square to light, with the text's top-left
// corner at (x, y).
export function drawPixelText(text, x, y, scale, fill) {
  let left = x;
  for (const character of text) {
    for (const [column, row] of glyph(character))
      fill(left + column * scale, y + row * scale, scale);
    left += ADVANCE * scale;
  }
}
