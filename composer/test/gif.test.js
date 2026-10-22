import assert from 'node:assert/strict';
import test from 'node:test';
import { GifAnimation } from '../public/gif.js';
import { GifFrames, MediaSource } from '../public/media.js';

// ---------- a small GIF writer for the tests ----------

// Standard GIF LZW, returned as data sub-blocks with their terminator.
function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize, end = clear + 1;
  const out = [];
  let bits = 0, bitCount = 0, codeSize = minCodeSize + 1, next = end + 1, table = new Map();
  const emit = (code) => {
    bits |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bits & 255);
      bits >>>= 8;
      bitCount -= 8;
    }
  };
  emit(clear);
  let current = indices[0];
  for (let i = 1; i < indices.length; ++i) {
    const key = current * 256 + indices[i];
    if (table.has(key)) {
      current = table.get(key);
      continue;
    }
    emit(current);
    if (next < 4096) {
      table.set(key, next++);
      if (next > (1 << codeSize) && codeSize < 12) ++codeSize;
    } else {
      emit(clear);
      table = new Map();
      codeSize = minCodeSize + 1;
      next = end + 1;
    }
    current = indices[i];
  }
  emit(current);
  emit(end);
  if (bitCount) out.push(bits & 255);
  const blocks = [];
  for (let at = 0; at < out.length; at += 255) {
    const chunk = out.slice(at, at + 255);
    blocks.push(chunk.length, ...chunk);
  }
  return [...blocks, 0];
}

const u16 = (value) => [value & 255, value >> 8];
// A colour table padded to a power of two, and the three size bits for it.
function table(colours) {
  let bits = 0;
  while ((2 << bits) < colours.length) ++bits;
  const bytes = colours.flat();
  while (bytes.length < 3 * (2 << bits)) bytes.push(0);
  return { bits, bytes };
}
// Rows of a picture in the order an interlaced GIF stores them.
function interlace(indices, width, height) {
  const out = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]])
    for (let y = start; y < height; y += step) out.push(...indices.slice(y * width, (y + 1) * width));
  return out;
}

// frames: { indices, left, top, width, height, delay, disposal, transparent,
// interlaced, palette }; everything but indices is optional.
function buildGif({ width, height, palette, frames }) {
  const global = table(palette);
  const minCodeSize = Math.max(2, global.bits + 1);
  const bytes = [...Buffer.from('GIF89a'), ...u16(width), ...u16(height), 0x80 | global.bits, 0, 0, ...global.bytes];
  for (const frame of frames) {
    const w = frame.width ?? width, h = frame.height ?? height;
    const local = frame.palette ? table(frame.palette) : null;
    bytes.push(0x21, 0xf9, 4, ((frame.disposal ?? 0) << 2) | (frame.transparent === undefined ? 0 : 1),
      ...u16(frame.delay ?? 0), frame.transparent ?? 0, 0);
    bytes.push(0x2c, ...u16(frame.left ?? 0), ...u16(frame.top ?? 0), ...u16(w), ...u16(h),
      (local ? 0x80 | local.bits : 0) | (frame.interlaced ? 0x40 : 0));
    if (local) bytes.push(...local.bytes);
    const size = local ? Math.max(2, local.bits + 1) : minCodeSize;
    bytes.push(size, ...lzw(frame.interlaced ? interlace(frame.indices, w, h) : frame.indices, size));
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255], WHITE = [255, 255, 255];
const pixel = (rgba, width, x, y) => [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

// ---------- files made by other software ----------

test('a GIF written by other software decodes to the published picture', () => {
  // The 10 by 10 sample from Matthew Flickinger's "What's in a GIF".
  const sample = Uint8Array.from(Buffer.from(
    '4749463839610a000a00910000ffffffff00000000ff00000021f90400000000002c000000000a000a000002168c2d99872a1cdc33a00275ec95faa8de608c04914c01003b',
    'hex'));
  const gif = new GifAnimation(sample);
  assert.deepEqual([gif.width, gif.height, gif.frameCount], [10, 10, 1]);
  const { rgba } = gif.frame(0);
  const rows = [
    '1111122222', '1111122222', '1111122222', '1110000222', '1110000222',
    '2220000111', '2220000111', '2222211111', '2222211111', '2222211111',
  ];
  const colours = { 0: [255, 255, 255, 255], 1: [255, 0, 0, 255], 2: [0, 0, 255, 255] };
  for (let y = 0; y < 10; ++y)
    for (let x = 0; x < 10; ++x)
      assert.deepEqual(pixel(rgba, 10, x, y), colours[rows[y][x]], `pixel ${x},${y}`);
});

test('the common one-pixel transparent GIF is one transparent pixel', () => {
  const gif = new GifAnimation(Uint8Array.from(Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')));
  assert.deepEqual([gif.width, gif.height, gif.frameCount], [1, 1, 1]);
  const { rgba, duration } = gif.frame(0);
  assert.deepEqual([...rgba], [0, 0, 0, 0]);
  assert.equal(duration, 100000, 'no delay plays at ten frames a second');
});

// ---------- the decoder's own rules ----------

test('frames are counted, timed, and composed over what came before', () => {
  const gif = new GifAnimation(buildGif({
    width: 4, height: 2, palette: [RED, GREEN, BLUE, WHITE],
    frames: [
      { indices: [0, 0, 0, 0, 0, 0, 0, 0], delay: 5 },
      // A 2 by 1 patch at (1, 1); index 3 is transparent, so red shows through.
      { indices: [1, 3], left: 1, top: 1, width: 2, height: 1, delay: 1, transparent: 3 },
      { indices: [2], left: 3, top: 0, width: 1, height: 1, delay: 20 },
    ],
  }));
  assert.equal(gif.frameCount, 3);
  assert.equal(gif.frame(0).duration, 50000);
  assert.deepEqual(pixel(gif.frame(0).rgba, 4, 1, 1), [255, 0, 0, 255]);
  const second = gif.frame(1);
  assert.equal(second.duration, 100000, 'a delay under 0.02 s is played as 0.1 s');
  assert.deepEqual(pixel(second.rgba, 4, 1, 1), [0, 255, 0, 255]);
  assert.deepEqual(pixel(second.rgba, 4, 2, 1), [255, 0, 0, 255], 'transparent pixel keeps the old colour');
  const third = gif.frame(2);
  assert.equal(third.duration, 200000);
  assert.deepEqual(pixel(third.rgba, 4, 3, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixel(third.rgba, 4, 1, 1), [0, 255, 0, 255], 'earlier frames stay');
  // Going back composes again from the first frame.
  assert.deepEqual(pixel(gif.frame(0).rgba, 4, 1, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(gif.frame(0).rgba, 4, 3, 0), [255, 0, 0, 255]);
  assert.throws(() => gif.frame(3), /out of range/);
  assert.throws(() => gif.frame(-1), /out of range/);
});

test('a frame can be cleared or undone before the next is drawn', () => {
  const patch = { left: 1, top: 0, width: 1, height: 1 };
  const gif = new GifAnimation(buildGif({
    width: 3, height: 1, palette: [RED, GREEN, BLUE, WHITE],
    frames: [
      { indices: [0, 0, 0] },
      { ...patch, indices: [1], disposal: 3 },   // green, then put red back
      { ...patch, left: 2, indices: [2], disposal: 2 },   // blue, then cleared
      { ...patch, left: 0, indices: [3] },
    ],
  }));
  assert.deepEqual(pixel(gif.frame(1).rgba, 3, 1, 0), [0, 255, 0, 255]);
  const third = gif.frame(2).rgba;
  assert.deepEqual(pixel(third, 3, 1, 0), [255, 0, 0, 255], 'restore to previous');
  assert.deepEqual(pixel(third, 3, 2, 0), [0, 0, 255, 255]);
  const fourth = gif.frame(3).rgba;
  assert.deepEqual(pixel(fourth, 3, 2, 0), [0, 0, 0, 0], 'restore to background leaves it transparent');
  assert.deepEqual(pixel(fourth, 3, 0, 0), [255, 255, 255, 255]);
});

test('interlaced rows, a frame\'s own colours and frames off the edge are handled', () => {
  const rows = 9, width = 2;
  const indices = Array.from({ length: rows * width }, (_, i) => Math.floor(i / width) % 4);
  const gif = new GifAnimation(buildGif({
    width, height: rows, palette: [RED, GREEN, BLUE, WHITE],
    frames: [
      { indices, interlaced: true },
      { indices: [0, 1, 0, 1], left: 1, top: rows - 1, width: 2, height: 2, palette: [WHITE, BLUE] },
    ],
  }));
  const first = gif.frame(0).rgba;
  const palette = [RED, GREEN, BLUE, WHITE];
  for (let y = 0; y < rows; ++y)
    assert.deepEqual(pixel(first, width, 0, y), [...palette[y % 4], 255], `row ${y}`);
  const second = gif.frame(1).rgba;
  assert.deepEqual(pixel(second, width, 1, rows - 1), [255, 255, 255, 255], 'local colours, clipped to the picture');
  assert.deepEqual(pixel(second, width, 0, rows - 1), [...palette[(rows - 1) % 4], 255]);
});

test('a picture with enough detail to fill and restart the code table survives', () => {
  const width = 160, height = 120;
  let seed = 12345;
  const indices = Array.from({ length: width * height }, () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed >>> 24;
  });
  const palette = Array.from({ length: 256 }, (_, i) => [i, 255 - i, (i * 7) & 255]);
  const gif = new GifAnimation(buildGif({ width, height, palette, frames: [{ indices }] }));
  const { rgba } = gif.frame(0);
  for (let i = 0; i < indices.length; ++i) {
    if (rgba[i * 4] !== palette[indices[i]][0] || rgba[i * 4 + 2] !== palette[indices[i]][2] || rgba[i * 4 + 3] !== 255)
      assert.fail(`pixel ${i} differs`);
  }
});

test('files that are not GIFs are refused, and a cut-off file keeps what is whole', () => {
  assert.throws(() => new GifAnimation(Uint8Array.from(Buffer.from('not a gif at all'))), /Not a GIF/);
  assert.throws(() => new GifAnimation(new Uint8Array(4)), /Not a GIF/);
  const whole = buildGif({
    width: 8, height: 8, palette: [RED, GREEN],
    frames: [{ indices: new Array(64).fill(0) }, { indices: new Array(64).fill(1) }],
  });
  assert.throws(() => new GifAnimation(whole.subarray(0, 19)), /no pictures/);
  // Cut in the middle of the second frame's data: its rows are missing,
  // and the first frame is untouched.
  const cut = new GifAnimation(whole.subarray(0, whole.length - 6));
  assert.equal(cut.frameCount, 2);
  assert.deepEqual(pixel(cut.frame(0).rgba, 8, 7, 7), [255, 0, 0, 255]);
  assert.deepEqual(pixel(cut.frame(1).rgba, 8, 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(cut.frame(1).rgba, 8, 7, 7), [255, 0, 0, 255]);
});

// ---------- in the Media Player ----------

// Stands in for a canvas: records the pixels last put on it.
const fakeCanvas = (width, height) => {
  const canvas = { width, height, put: null };
  canvas.getContext = () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (image) => { canvas.put = Uint8ClampedArray.from(image.data); },
  });
  return canvas;
};
const gifFile = (bytes, name = 'test.gif') =>
  ({ type: 'image/gif', name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

test('the Media Player animates a GIF with no help from the browser', async () => {
  const bytes = buildGif({
    width: 2, height: 1, palette: [RED, GREEN, BLUE, WHITE],
    frames: [{ indices: [0, 0], delay: 10 }, { indices: [1, 1], delay: 30 }, { indices: [2, 2], delay: 10 }],
  });
  const source = new MediaSource(fakeCanvas);
  await source.load(gifFile(bytes, 'three.gif'));
  assert.equal(source.kind, 'animation');
  assert.equal(source.describe(), 'three.gif · 2×1 · animation, 3 frames');
  const shown = () => [...source.current().image.put.subarray(0, 3)];
  assert.deepEqual(shown(), RED);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  source.update(5);
  source.update(5.1);
  await settle();
  assert.deepEqual(shown(), GREEN);
  source.update(6);
  source.update(6.2);
  await settle();
  assert.deepEqual(shown(), GREEN, 'the second frame lasts 0.3 s');
  source.update(6.3);
  await settle();
  assert.deepEqual(shown(), BLUE);
  source.update(7);
  source.update(7.1);
  await settle();
  assert.deepEqual(shown(), RED, 'loops to the first frame');

  const still = new MediaSource(fakeCanvas);
  await still.load(gifFile(buildGif({ width: 1, height: 1, palette: [RED, GREEN], frames: [{ indices: [1] }] })));
  assert.equal(still.kind, 'image');
  assert.equal(await new MediaSource(fakeCanvas).loadGif(gifFile(Uint8Array.from([1, 2, 3]))), false,
    'something that is not a GIF is left to the browser');
});

test('a decoded GIF frame is handed over as a canvas with its duration', async () => {
  const frames = new GifFrames(new GifAnimation(buildGif({
    width: 1, height: 1, palette: [RED, GREEN], frames: [{ indices: [1], delay: 7 }],
  })), fakeCanvas);
  const { image, duration } = await frames.decode({ frameIndex: 0 });
  assert.deepEqual([image.width, image.height, duration], [1, 1, 70000]);
  assert.deepEqual([...image.put], [0, 255, 0, 255]);
});
