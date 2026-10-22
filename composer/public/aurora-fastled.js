// FastLED 3.5.0 and Aurora primitives translated to JavaScript.
// Copyright (c) 2013 FastLED; Copyright (c) 2014 Jason Coon and Stefan Petrick.
// MIT license and source revisions: ./licenses/aurora.txt.

export const AURORA_SIZE = 32;
export const byte = (value) => Math.trunc(value) & 255;
export const scale8 = (value, scale) => (value * (scale + 1)) >> 8;

const SIN_TABLE = [0, 49, 49, 41, 90, 27, 117, 10];

export function sin8(theta) {
  theta = byte(theta);
  let offset = theta & 64 ? 255 - theta : theta;
  offset &= 63;
  const section = (offset >> 4) * 2;
  const fraction = (offset & 15) + (theta & 64 ? 1 : 0);
  const y = SIN_TABLE[section] + ((SIN_TABLE[section + 1] * fraction) >> 4);
  return 128 + (theta & 128 ? -y : y);
}

export const cos8 = (theta) => sin8(theta + 64);
export const mapsin8 = (theta, low, high) => byte(low + scale8(sin8(theta), byte(high - low)));
export const mapcos8 = (theta, low, high) => byte(low + scale8(cos8(theta), byte(high - low)));

export function beat8(bpm, milliseconds) {
  const rate = bpm < 256 ? bpm * 256 : bpm;
  // Keep unsigned 32-bit multiplication semantics from FastLED's beat88.
  const product = (Math.trunc(milliseconds) * rate * 280) >>> 0;
  return (product >>> 24) & 255;
}

export const beatsin8 = (bpm, low, high, ms) => mapsin8(beat8(bpm, ms), low, high);
export const beatcos8 = (bpm, low, high, ms) => mapcos8(beat8(bpm, ms), low, high);

export function ease8InOutQuad(value) {
  value = byte(value);
  const j = value & 128 ? 255 - value : value;
  const doubled = scale8(j, j) * 2;
  return value & 128 ? 255 - doubled : doubled;
}

export function quadwave8(value) {
  value = byte(value);
  return ease8InOutQuad((value & 128 ? 255 - value : value) * 2);
}

const RAINBOW = [
  0xff0000, 0xd52a00, 0xab5500, 0xab7f00,
  0xabab00, 0x56d500, 0x00ff00, 0x00d52a,
  0x00ab55, 0x0056aa, 0x0000ff, 0x2a00d5,
  0x5500ab, 0x7f0081, 0xab0055, 0xd5002b,
];

function paletteChannel(first, second, shift, fraction, brightness) {
  let value = (first >> shift) & 255;
  if (fraction)
    value = scale8(value, 255 - fraction) + scale8((second >> shift) & 255, fraction);
  return brightness === 255 ? value : brightness === 0 ? 0 : scale8(value, brightness + 1);
}

export function palette(index, brightness = 255) {
  index = byte(index);
  const first = RAINBOW[index >> 4];
  const second = RAINBOW[((index >> 4) + 1) & 15];
  const fraction = (index & 15) << 4;
  return [
    paletteChannel(first, second, 16, fraction, brightness),
    paletteChannel(first, second, 8, fraction, brightness),
    paletteChannel(first, second, 0, fraction, brightness),
  ];
}

const PERMUTATION = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
  207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
  81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
  151,
];

function grad8(hash, x, y, z) {
  hash &= 15;
  let u = hash & 8 ? y : x;
  let v = hash < 4 ? y : hash === 12 || hash === 14 ? x : z;
  if (hash & 1) u = (-u << 24) >> 24;
  if (hash & 2) v = (-v << 24) >> 24;
  // Signed avg7 rounds according to the low bit of its first operand.
  return ((((u + v) >> 1) + (u & 1)) << 24) >> 24;
}

const lerp7by8 = (a, b, fraction) =>
  b > a ? a + scale8(b - a, fraction) : a - scale8(a - b, fraction);

export function inoise8(x, y, z) {
  x = Math.trunc(x) & 65535;
  y = Math.trunc(y) & 65535;
  z = Math.trunc(z) & 65535;
  const p = PERMUTATION;
  const a = byte(p[x >> 8] + (y >> 8));
  const b = byte(p[(x >> 8) + 1] + (y >> 8));
  const aa = byte(p[a] + (z >> 8));
  const ab = byte(p[a + 1] + (z >> 8));
  const ba = byte(p[b] + (z >> 8));
  const bb = byte(p[b + 1] + (z >> 8));
  const xx = (x & 255) >> 1;
  const yy = (y & 255) >> 1;
  const zz = (z & 255) >> 1;
  const u = ease8InOutQuad(x);
  const v = ease8InOutQuad(y);
  const w = ease8InOutQuad(z);
  const x1 = lerp7by8(grad8(p[aa], xx, yy, zz), grad8(p[ba], xx - 128, yy, zz), u);
  const x2 = lerp7by8(grad8(p[ab], xx, yy - 128, zz), grad8(p[bb], xx - 128, yy - 128, zz), u);
  const x3 = lerp7by8(grad8(p[aa + 1], xx, yy, zz - 128), grad8(p[ba + 1], xx - 128, yy, zz - 128), u);
  const x4 = lerp7by8(grad8(p[ab + 1], xx, yy - 128, zz - 128), grad8(p[bb + 1], xx - 128, yy - 128, zz - 128), u);
  const n = lerp7by8(lerp7by8(x1, x2, v), lerp7by8(x3, x4, v), w) + 64;
  return Math.min(255, byte(n) * 2);
}

export class AuroraBuffer {
  constructor(width = AURORA_SIZE, height = AURORA_SIZE) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
      throw new Error('Aurora buffer dimensions must be positive integers');
    this.width = width;
    this.height = height;
    this.rgb = new Uint8Array(width * height * 3);
  }

  index(x, y) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? -1 :
      (y * this.width + x) * 3;
  }

  pixel(x, y, color, add = false) {
    const index = this.index(x, y);
    if (index < 0)
      return; // Match GFX drawPixel clipping, not XY's shared off-screen pixel.
    for (let c = 0; c < 3; ++c)
      this.rgb[index + c] = add ? Math.min(255, this.rgb[index + c] + color[c]) : color[c];
  }

  dot(x, y, color, radius = 0.5, add = false) {
    for (let py = Math.max(0, Math.ceil(y - radius - 0.5)); py <= Math.min(this.height - 1, Math.floor(y + radius + 0.5)); ++py) {
      for (let px = Math.max(0, Math.ceil(x - radius - 0.5)); px <= Math.min(this.width - 1, Math.floor(x + radius + 0.5)); ++px) {
        const coverage = Math.min(1, Math.max(0, radius + 0.5 - Math.hypot(px - x, py - y)));
        const index = (py * this.width + px) * 3;
        for (let c = 0; c < 3; ++c)
          this.rgb[index + c] = Math.round(add ?
            Math.min(255, this.rgb[index + c] + color[c] * coverage) :
            this.rgb[index + c] * (1 - coverage) + color[c] * coverage);
      }
    }
  }

  dim(value) {
    for (let i = 0; i < this.rgb.length; ++i)
      this.rgb[i] = scale8(this.rgb[i], value);
  }

  line(x0, y0, x1, y1, color, add = false, radius = 0) {
    if (radius > 0) {
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
      for (let i = 0; i <= steps; ++i)
        this.dot(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, color, radius, add);
      return;
    }
    x0 = Math.trunc(x0);
    y0 = Math.trunc(y0);
    x1 = Math.trunc(x1);
    y1 = Math.trunc(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      this.pixel(x0, y0, color, add);
      if (x0 === x1 && y0 === y1)
        break;
      const twice = error * 2;
      if (twice > dy) { error += dy; x0 += sx; }
      if (twice < dx) { error += dx; y0 += sy; }
    }
  }

  blur(amount, radiusX = 1, radiusY = 1) {
    if (radiusX > 1 || radiusY > 1) {
      this.blurScaled(amount, radiusX, radiusY);
      return;
    }
    const keep = 255 - amount;
    const seep = amount >> 1;
    for (const vertical of [false, true]) {
      const stride = vertical ? this.width * 3 : 3;
      const lines = vertical ? this.width : this.height;
      const length = vertical ? this.height : this.width;
      for (let line = 0; line < lines; ++line) {
        const carry = [0, 0, 0];
        for (let i = 0; i < length; ++i) {
          const index = vertical ? (i * this.width + line) * 3 : (line * this.width + i) * 3;
          for (let c = 0; c < 3; ++c) {
            const value = this.rgb[index + c];
            const part = scale8(value, seep);
            this.rgb[index + c] = Math.min(255, scale8(value, keep) + carry[c]);
            if (i)
              this.rgb[index - stride + c] = Math.min(255, this.rgb[index - stride + c] + part);
            carry[c] = part;
          }
        }
      }
    }
  }

  blurScaled(amount, radiusX, radiusY) {
    this.blurScratch ??= new Uint8Array(this.rgb.length);
    // Sliding windows spread into adjacent native pixels in O(width * height),
    // rather than scattering into a coarse grid of scaled neighbour offsets.
    for (const vertical of [false, true]) {
      const input = vertical ? this.blurScratch : this.rgb;
      const output = vertical ? this.rgb : this.blurScratch;
      const radius = Math.max(1, Math.round(vertical ? radiusY : radiusX));
      const divisor = radius * 2 + 1;
      const length = vertical ? this.height : this.width;
      const lines = vertical ? this.width : this.height;
      const stride = vertical ? this.width * 3 : 3;
      for (let line = 0; line < lines; ++line) {
        const base = vertical ? line * 3 : line * this.width * 3;
        for (let c = 0; c < 3; ++c) {
          let sum = 0;
          for (let i = 0; i <= Math.min(radius, length - 1); ++i)
            sum += input[base + i * stride + c];
          for (let i = 0; i < length; ++i) {
            const index = base + i * stride + c;
            output[index] = Math.min(255,
              scale8(input[index], 255 - amount) + scale8(Math.floor(sum / divisor), amount));
            if (i - radius >= 0) sum -= input[base + (i - radius) * stride + c];
            if (i + radius + 1 < length) sum += input[base + (i + radius + 1) * stride + c];
          }
        }
      }
    }
  }

  spiralStreamScaled(x, y, radiusX, radiusY, dim, stepX, stepY) {
    if (radiusX === 0 || radiusY === 0) {
      this.spiralStream(x, y, radiusX, dim, radiusY, stepX, stepY);
      return;
    }
    this.spiralScratch ??= new Uint8Array(this.rgb.length);
    this.spiralScratch.set(this.rgb);
    const sample = (px, py, c) => {
      const index = this.index(px, py);
      return index < 0 ? 0 : this.spiralScratch[index + c];
    };
    // Read a snapshot and visit each pixel once. Rounded concentric rectangles
    // repeat some edges on unequal axes, causing horizontal/vertical stripes.
    for (let py = Math.max(0, Math.ceil(y - radiusY)); py <= Math.min(this.height - 1, Math.floor(y + radiusY)); ++py) {
      for (let px = Math.max(0, Math.ceil(x - radiusX)); px <= Math.min(this.width - 1, Math.floor(x + radiusX)); ++px) {
        const dx = px - x, dy = py - y;
        const vertical = Math.abs(dx) * radiusY > Math.abs(dy) * radiusX;
        const fromX = vertical ? px : px + (dy < 0 ? stepX : -stepX);
        const fromY = vertical ? py + (dx > 0 ? stepY : -stepY) : py;
        const left = Math.floor(fromX), top = Math.floor(fromY);
        const fx = fromX - left, fy = fromY - top;
        const index = (py * this.width + px) * 3;
        for (let c = 0; c < 3; ++c) {
          const neighbor =
            (sample(left, top, c) * (1 - fx) + sample(left + 1, top, c) * fx) * (1 - fy) +
            (sample(left, top + 1, c) * (1 - fx) + sample(left + 1, top + 1, c) * fx) * fy;
          this.rgb[index + c] = scale8(Math.min(255, this.spiralScratch[index + c] + Math.round(neighbor)), dim);
        }
      }
    }
  }

  spiralStream(x, y, radius, dim, radiusY = radius, stepX = 1, stepY = 1) {
    x = Math.round(x);
    y = Math.round(y);
    radius = Math.round(radius);
    radiusY = Math.round(radiusY);
    const move = (x0, y0, x1, y1) => {
      const to = this.index(x0, y0);
      const from = this.index(x1, y1);
      if (to < 0)
        return;
      for (let c = 0; c < 3; ++c)
        this.rgb[to + c] = scale8(Math.min(255, this.rgb[to + c] + (from < 0 ? 0 : this.rgb[from + c])), dim);
    };
    // A collapsed rectangle has no four distinct edges to stream around.
    if (radius === 0 && radiusY === 0) {
      move(x, y, x, y);
      return;
    }
    if (radius === 0) {
      for (let i = y - radiusY; i <= y + radiusY; ++i)
        move(x, i, x, i + stepY);
      return;
    }
    if (radiusY === 0) {
      for (let i = x - radius; i <= x + radius; ++i)
        move(i, y, i + stepX, y);
      return;
    }
    const layers = Math.max(radius, radiusY);
    for (let d = layers; d >= 0; --d) {
      const dx = layers ? Math.round(radius * d / layers) : 0;
      const dy = layers ? Math.round(radiusY * d / layers) : 0;
      for (let i = x - dx; i <= x + dx; ++i) move(i, y - dy, i + stepX, y - dy);
      for (let i = y - dy; i <= y + dy; ++i) move(x + dx, i, x + dx, i + stepY);
      for (let i = x + dx; i >= x - dx; --i) move(i, y + dy, i - stepX, y + dy);
      for (let i = y + dy; i >= y - dy; --i) move(x - dx, i, x - dx, i - stepY);
    }
  }
}
