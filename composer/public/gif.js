// A GIF decoder for the Media Player, so animated GIFs play in browsers that
// have no ImageDecoder. The file's structure is read once; frames are then
// composed in order, on demand, onto one RGBA canvas the size of the picture,
// so memory does not grow with the number of frames.

const MAX_PIXELS = 16 * 1024 * 1024;
const MAX_CODES = 4096;
// Browsers play frames marked 0 or 1 hundredths of a second at ten a second.
const SHORTEST_DELAY = 2;
const DEFAULT_DELAY = 10;
const INTERLACE_PASSES = [[0, 8], [4, 8], [2, 4], [1, 2]];
const NO_PALETTE = new Uint8Array(0);
// The LZW string table and output stack, reused by every frame.
const PREFIX = new Uint16Array(MAX_CODES), SUFFIX = new Uint8Array(MAX_CODES);
const STACK = new Uint8Array(MAX_CODES + 1);

// Expands a frame's LZW data, held in sub-blocks from `offset`, into colour
// indices. Returns how many of the `indices` were written; damaged or
// truncated data gives fewer than the frame needs.
function decodeLzw(bytes, offset, minCodeSize, indices) {
  const clear = 1 << minCodeSize, end = clear + 1;
  const prefix = PREFIX, suffix = SUFFIX, stack = STACK;
  let codeSize = minCodeSize + 1, codeMask = (1 << codeSize) - 1;
  let next = end + 1, previous = -1, first = 0;
  let bits = 0, bitCount = 0, written = 0;
  while (offset < bytes.length) {
    const size = bytes[offset++];
    if (size === 0) break;
    const stop = Math.min(offset + size, bytes.length);
    for (; offset < stop; ++offset) {
      bits |= bytes[offset] << bitCount;
      bitCount += 8;
      while (bitCount >= codeSize) {
        const code = bits & codeMask;
        bits >>>= codeSize;
        bitCount -= codeSize;
        if (code === clear) {
          codeSize = minCodeSize + 1;
          codeMask = (1 << codeSize) - 1;
          next = end + 1;
          previous = -1;
          continue;
        }
        if (code === end) return written;
        if (previous === -1) {
          // The first code after a clear is always a plain colour.
          if (code > clear) return written;
          indices[written++] = code;
          previous = first = code;
        } else {
          if (code > next) return written;
          let top = 0, current = code;
          // A code not yet in the table is the previous string plus its own
          // first colour.
          if (code === next) {
            stack[top++] = first;
            current = previous;
          }
          while (current > end) {
            stack[top++] = suffix[current];
            current = prefix[current];
          }
          first = current;
          stack[top++] = current;
          if (next < MAX_CODES) {
            prefix[next] = previous;
            suffix[next] = first;
            if (++next > codeMask && codeSize < 12) {
              ++codeSize;
              codeMask = (1 << codeSize) - 1;
            }
          }
          previous = code;
          while (top > 0 && written < indices.length) indices[written++] = stack[--top];
        }
        if (written >= indices.length) return written;
      }
    }
  }
  return written;
}

export class GifAnimation {
  // `data` holds the whole file, as a Uint8Array or an ArrayBuffer. Throws
  // if it is not a GIF with at least one picture in it.
  constructor(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (bytes.length < 13 || (signature !== 'GIF87a' && signature !== 'GIF89a'))
      throw new Error('Not a GIF file.');
    const u16 = (at) => bytes[at] | (bytes[at + 1] << 8);
    this.bytes = bytes;
    this.width = u16(6);
    this.height = u16(8);
    if (this.width === 0 || this.height === 0 || this.width * this.height > MAX_PIXELS)
      throw new Error('GIF dimensions are zero or too large.');
    this.frames = [];

    let offset = 13;
    // A colour table of `packed`'s size if its top bit says there is one.
    const palette = (packed) => {
      if (!(packed & 0x80)) return null;
      const table = bytes.subarray(offset, offset + 3 * (2 << (packed & 7)));
      offset += table.length;
      return table;
    };
    const skipSubBlocks = () => {
      while (offset < bytes.length) {
        const size = bytes[offset++];
        if (size === 0) break;
        offset += size;
      }
    };
    const globalPalette = palette(bytes[10]);
    let control = null;
    // A file cut short keeps the frames that were read whole.
    while (offset < bytes.length) {
      const block = bytes[offset++];
      if (block === 0x21) {
        const label = bytes[offset++];
        if (label === 0xf9 && bytes[offset] === 4 && offset + 5 <= bytes.length) {
          const packed = bytes[offset + 1];
          control = {
            disposal: (packed >> 2) & 7, delay: u16(offset + 2),
            transparent: packed & 1 ? bytes[offset + 4] : -1,
          };
        }
        skipSubBlocks();
      } else if (block === 0x2c) {
        if (offset + 9 > bytes.length) break;
        const frame = {
          left: u16(offset), top: u16(offset + 2), width: u16(offset + 4), height: u16(offset + 6),
          interlaced: (bytes[offset + 8] & 0x40) !== 0,
          disposal: control?.disposal ?? 0, transparent: control?.transparent ?? -1,
          // In microseconds, as ImageDecoder reports durations.
          duration: ((control?.delay ?? 0) < SHORTEST_DELAY ? DEFAULT_DELAY : control.delay) * 10000,
        };
        const packed = bytes[offset + 8];
        offset += 9;
        frame.palette = palette(packed) ?? globalPalette ?? NO_PALETTE;
        if (offset >= bytes.length) break;
        frame.minCodeSize = bytes[offset++];
        frame.data = offset;
        skipSubBlocks();
        control = null;
        if (frame.minCodeSize >= 2 && frame.minCodeSize <= 8 &&
            frame.width * frame.height <= MAX_PIXELS)
          this.frames.push(frame);
      } else {
        // The trailer, or something that is not GIF: either way, the end.
        break;
      }
    }
    if (!this.frames.length) throw new Error('The GIF has no pictures in it.');
    this.frameCount = this.frames.length;
    this.canvas = new Uint8ClampedArray(this.width * this.height * 4);
    this.restart();
  }

  restart() {
    this.canvas.fill(0);
    this.shown = -1;
    this.saved = null;
  }

  // The picture as it stands at frame `index`: `rgba` is this decoder's own
  // canvas (width × height × 4, top row first, transparent where nothing has
  // been drawn) and is overwritten by the next call; `duration` is how long
  // the frame is shown, in microseconds.
  frame(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.frameCount)
      throw new RangeError(`GIF frame ${index} is out of range.`);
    if (index < this.shown) this.restart();
    while (this.shown < index) this.compose(this.shown + 1);
    return { rgba: this.canvas, duration: this.frames[index].duration };
  }

  // The part of a frame's rectangle that lies on the canvas.
  area(frame) {
    const x0 = Math.min(frame.left, this.width), y0 = Math.min(frame.top, this.height);
    return {
      x0, y0,
      x1: Math.min(frame.left + frame.width, this.width),
      y1: Math.min(frame.top + frame.height, this.height),
    };
  }

  compose(index) {
    const { canvas, width } = this;
    const before = this.frames[index - 1];
    if (before?.disposal === 2) {
      // Restore to background: browsers clear the frame's area to transparent.
      const { x0, y0, x1, y1 } = this.area(before);
      for (let y = y0; y < y1; ++y) canvas.fill(0, (y * width + x0) * 4, (y * width + x1) * 4);
    } else if (before?.disposal === 3 && this.saved) {
      // Restore to previous: put back what the frame drew over.
      const { x0, y0, x1, y1 } = this.area(before);
      const rowBytes = (x1 - x0) * 4;
      for (let y = y0; y < y1; ++y)
        canvas.set(this.saved.subarray((y - y0) * rowBytes, (y - y0 + 1) * rowBytes), (y * width + x0) * 4);
    }
    const frame = this.frames[index];
    const { x0, y0, x1, y1 } = this.area(frame);
    this.saved = null;
    if (frame.disposal === 3) {
      const rowBytes = (x1 - x0) * 4;
      this.saved = new Uint8ClampedArray(rowBytes * (y1 - y0));
      for (let y = y0; y < y1; ++y)
        this.saved.set(canvas.subarray((y * width + x0) * 4, (y * width + x1) * 4), (y - y0) * rowBytes);
    }

    const indices = new Uint8Array(frame.width * frame.height);
    const count = decodeLzw(this.bytes, frame.data, frame.minCodeSize, indices);
    const { palette, transparent } = frame;
    const drawRow = (source, y) => {
      if (y >= y1) return;
      let input = source * frame.width;
      const stop = Math.min(input + (x1 - x0), count);
      for (let out = (y * width + x0) * 4; input < stop; ++input, out += 4) {
        const colour = indices[input];
        if (colour === transparent) continue;
        const entry = colour * 3;
        // A colour beyond the table is drawn black, as browsers do.
        canvas[out] = entry < palette.length ? palette[entry] : 0;
        canvas[out + 1] = entry < palette.length ? palette[entry + 1] : 0;
        canvas[out + 2] = entry < palette.length ? palette[entry + 2] : 0;
        canvas[out + 3] = 255;
      }
    };
    if (frame.interlaced) {
      let source = 0;
      for (const [start, step] of INTERLACE_PASSES)
        for (let row = start; row < frame.height; row += step) drawRow(source++, frame.top + row);
    } else {
      for (let row = 0; row < frame.height; ++row) drawRow(row, frame.top + row);
    }
    this.shown = index;
  }
}
