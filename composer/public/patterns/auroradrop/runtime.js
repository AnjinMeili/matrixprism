// Runtime for the AuroraDrop port: the shared canvas and its helpers
// (AuroraDrop's Effects class), the audio data its patterns read, and the
// frame pipeline that layers processing effects and audio patterns.
//
// AuroraDrop: https://github.com/fivefishstudios/AuroraDrop (uklooney) and
// the fork https://github.com/troyhacks/AuroraDrop-LXP, both based on
// Aurora: https://github.com/pixelmatix/aurora
// Copyright (c) 2014 Jason Coon. MIT licence: see ./NOTICE.md.
import { AuroraBuffer, byte, scale8, beatsin8 } from '../../aurora-fastled.js';

// AuroraDrop's patterns are written for a 64 by 64 matrix: coordinates come
// straight from audio levels and several centres and radii are literals. The
// port keeps that canvas and scales the finished frame to the panel.
export const SIZE = 64;
export const CENTER = SIZE / 2;

const hex = (...colours) => colours.map(c => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);
const ramp = (stops) => Array.from({ length: 16 }, (_, i) => {
  const at = i / 15 * (stops.length - 1), low = Math.min(stops.length - 2, Math.floor(at)), f = at - low;
  return stops[low].map((value, c) => Math.round(value + (stops[low + 1][c] - value) * f));
});

// The palettes AuroraDrop cycles through. The first seven are FastLED's;
// Yellow-Blue and Ice stand in for AuroraDrop's own two-colour ramps.
export const PALETTES = [
  ['Rainbow', hex(0xff0000, 0xd52a00, 0xab5500, 0xab7f00, 0xabab00, 0x56d500, 0x00ff00, 0x00d52a,
    0x00ab55, 0x0056aa, 0x0000ff, 0x2a00d5, 0x5500ab, 0x7f0081, 0xab0055, 0xd5002b)],
  ['Ocean', hex(0x191970, 0x00008b, 0x191970, 0x000080, 0x00008b, 0x0000cd, 0x2e8b57, 0x008080,
    0x5f9ea0, 0x0000ff, 0x008b8b, 0x6495ed, 0x7fffd4, 0x2e8b57, 0x00ffff, 0x87cefa)],
  ['Cloud', hex(0x0000ff, 0x00008b, 0x00008b, 0x00008b, 0x00008b, 0x00008b, 0x00008b, 0x00008b,
    0x0000ff, 0x00008b, 0x87ceeb, 0x87ceeb, 0xadd8e6, 0xffffff, 0xadd8e6, 0x87ceeb)],
  ['Forest', hex(0x006400, 0x006400, 0x556b2f, 0x006400, 0x008000, 0x228b22, 0x6b8e23, 0x008000,
    0x2e8b57, 0x66cdaa, 0x32cd32, 0x9acd32, 0x90ee90, 0x7cfc00, 0x66cdaa, 0x228b22)],
  ['Party', hex(0x5500ab, 0x84007c, 0xb5004b, 0xe5001b, 0xe81700, 0xb84700, 0xab7700, 0xabab00,
    0xab5500, 0xdd2200, 0xf2000e, 0xc2003e, 0x8f0071, 0x5f00a1, 0x2f00d0, 0x0007f9)],
  ['Yellow-Blue', ramp(hex(0xffff00, 0x0000ff, 0xffff00))],
  ['Heat', hex(0x000000, 0x330000, 0x660000, 0x990000, 0xcc0000, 0xff0000, 0xff3300, 0xff6600,
    0xff9900, 0xffcc00, 0xffff00, 0xffff33, 0xffff66, 0xffff99, 0xffffcc, 0xffffff)],
  ['Lava', hex(0x000000, 0x800000, 0x000000, 0x800000, 0x8b0000, 0x800000, 0x8b0000, 0x8b0000,
    0x8b0000, 0x8b0000, 0xff0000, 0xffa500, 0xffffff, 0xffa500, 0xff0000, 0x8b0000)],
  ['Ice', ramp(hex(0x000000, 0x0000ff, 0x00ffff, 0xffffff))],
];

// The shared canvas with the helpers of AuroraDrop's Effects class. Drawing
// is additive, as in AuroraDrop; reads outside the canvas give black and
// writes there are dropped.
export class DropCanvas extends AuroraBuffer {
  constructor(random = Math.random) {
    super(SIZE, SIZE);
    this.random = random;
    this.ms = 0;
    this.palette = PALETTES[0][1];
    this.paletteName = PALETTES[0][0];
  }

  // FastLED random8(low, high): low up to but not including high.
  random8(low, high) {
    if (low === undefined) return Math.floor(this.random() * 256);
    if (high === undefined) return Math.floor(this.random() * low);
    return high <= low ? low : low + Math.floor(this.random() * (high - low));
  }

  beatsin8(bpm, low, high) {
    return beatsin8(bpm, low, high, this.ms);
  }

  RandomPalette() {
    [this.paletteName, this.palette] = PALETTES[this.random8(PALETTES.length)];
  }

  ColorFromCurrentPalette(index = 0, brightness = 255) {
    index = byte(index);
    const first = this.palette[index >> 4], fraction = (index & 15) << 4;
    let colour = first;
    if (fraction) {
      const second = this.palette[((index >> 4) + 1) & 15];
      colour = [0, 1, 2].map(c => scale8(first[c], 255 - fraction) + scale8(second[c], fraction));
    }
    return brightness === 255 ? colour : colour.map(value => scale8(value, brightness));
  }

  at(x, y) {
    return x < 0 || y < 0 || x >= SIZE || y >= SIZE ? -1 : (y * SIZE + x) * 3;
  }

  addPixel(x, y, colour) {
    const i = this.at(x, y);
    if (i < 0) return;
    for (let c = 0; c < 3; ++c) this.rgb[i + c] = Math.min(255, this.rgb[i + c] + colour[c]);
  }

  // leds[to] += leds[from], then leds[to].nscale8(scale): the step every
  // stream is built from.
  streamInto(toX, toY, fromX, fromY, scale) {
    const to = this.at(toX, toY);
    if (to < 0) return;
    const from = this.at(fromX, fromY);
    for (let c = 0; c < 3; ++c)
      this.rgb[to + c] = scale8(Math.min(255, this.rgb[to + c] + (from < 0 ? 0 : this.rgb[from + c])), scale);
  }

  copyPixel(toX, toY, fromX, fromY) {
    const to = this.at(toX, toY), from = this.at(fromX, fromY);
    if (to < 0) return;
    for (let c = 0; c < 3; ++c) this.rgb[to + c] = from < 0 ? 0 : this.rgb[from + c];
  }

  DimAll(value) {
    this.dim(value);
  }

  blur2d(amount) {
    this.blur(amount);
  }

  // Accepts a colour, or a palette index and brightness.
  BresenhamLine(x0, y0, x1, y1, colour, brightness = 255) {
    if (typeof colour === 'number') colour = this.ColorFromCurrentPalette(colour, brightness);
    x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      this.addPixel(x0, y0, colour);
      if (x0 === x1 && y0 === y1) break;
      const twice = 2 * error;
      if (twice > dy) { error += dy; x0 += sx; }
      if (twice < dx) { error += dx; y0 += sy; }
    }
  }

  // Mirrors the top-left quarter into the other three.
  Caleidoscope1() {
    for (let x = 0; x < CENTER; ++x) {
      for (let y = 0; y < CENTER; ++y) {
        this.copyPixel(SIZE - 1 - x, y, x, y);
        this.copyPixel(SIZE - 1 - x, SIZE - 1 - y, x, y);
        this.copyPixel(x, SIZE - 1 - y, x, y);
      }
    }
  }

  // As above, but two quarters take the transposed image.
  Caleidoscope2() {
    for (let x = 0; x < CENTER; ++x) {
      for (let y = 0; y < CENTER; ++y) {
        this.copyPixel(SIZE - 1 - x, y, y, x);
        this.copyPixel(x, SIZE - 1 - y, y, x);
        this.copyPixel(SIZE - 1 - x, SIZE - 1 - y, x, y);
      }
    }
  }

  // Copies a block of pixels, each to (x + dx, y + dy), optionally reading
  // from the mirror image of the source column.
  copyBlock(x0, x1, y0, y1, dx, dy, mirrorFrom = null) {
    for (let x = x0; x < x1; ++x)
      for (let y = y0; y < y1; ++y)
        this.copyPixel(x + dx, y + dy, mirrorFrom === null ? x : mirrorFrom - x, y);
  }

  // Folds the top-left triangle across its diagonal, one way or the other.
  Caleidoscope4() {
    for (let x = 0; x <= CENTER; ++x)
      for (let y = 0; y <= CENTER - x; ++y) this.copyPixel(CENTER - y, CENTER - x, x, y);
  }

  Caleidoscope4Rework() {
    for (let x = 0; x <= CENTER; ++x)
      for (let y = 0; y <= CENTER - x; ++y) this.copyPixel(x, y, CENTER - y, CENTER - x);
  }

  // Tiles the left half's middle band over the whole canvas; A2 mirrors the
  // copies on the right.
  caleidoscopeA(mirrored) {
    const quarter = SIZE / 4, mirror = mirrored ? CENTER : null;
    for (const [y0, y1, dy] of [[CENTER, SIZE - quarter, -CENTER], [CENTER - quarter, CENTER, CENTER]]) {
      this.copyBlock(0, CENTER, y0, y1, 0, dy);
      this.copyBlock(0, CENTER, y0, y1, CENTER, dy, mirror);
    }
    this.copyBlock(0, CENTER, CENTER - quarter, SIZE - quarter, CENTER, 0, mirror);
  }

  CaleidoscopeA1() {
    this.caleidoscopeA(false);
  }

  CaleidoscopeA2() {
    this.caleidoscopeA(true);
  }

  // Pushes the middle of the canvas outwards into the corners (B1) or into
  // the whole left and right edges (B2).
  CaleidoscopeB1() {
    const q = SIZE / 4;
    this.copyBlock(q, CENTER, q, CENTER, -q, -q);
    this.copyBlock(CENTER, SIZE - q, q, CENTER, q, -q);
    this.copyBlock(q, CENTER, CENTER, SIZE - q, -q, q);
    this.copyBlock(CENTER, SIZE - q, CENTER, SIZE - q, q, q);
  }

  CaleidoscopeB2() {
    const q = SIZE / 4;
    for (const dy of [-q, q]) {
      this.copyBlock(q, CENTER, q, SIZE - q, -q, dy);
      this.copyBlock(CENTER, SIZE - q, q, SIZE - q, q, dy);
    }
  }

  // One of AuroraDrop's nine kaleidoscope arrangements; 0 picks at random.
  RandomCaleidoscope(id = 0) {
    switch (id === 0 ? this.random8(1, 10) : id) {
      case 1: this.Caleidoscope1(); break;
      case 2: this.Caleidoscope2(); break;
      case 3: this.CaleidoscopeA1(); break;
      case 4: this.CaleidoscopeA2(); break;
      case 5: this.CaleidoscopeB1(); break;
      case 6: this.CaleidoscopeB2(); break;
      case 7: this.Caleidoscope4Rework(); this.Caleidoscope1(); break;
      case 8: this.Caleidoscope4Rework(); this.Caleidoscope2(); break;
      case 9: this.Caleidoscope4(); this.Caleidoscope1(); break;
      default: break;
    }
  }

  // Rotates a point about (cx, cy); AuroraDrop's points are whole pixels.
  RotatePoint(cx, cy, angle, x, y) {
    const s = Math.sin(angle), c = Math.cos(angle);
    x -= cx;
    y -= cy;
    return [Math.trunc(x * c - y * s + cx), Math.trunc(x * s + y * c + cy)];
  }

  // Replaces a pixel rather than adding to it.
  setPixel(x, y, colour) {
    const i = this.at(Math.trunc(x), Math.trunc(y));
    if (i < 0) return;
    this.rgb[i] = colour[0];
    this.rgb[i + 1] = colour[1];
    this.rgb[i + 2] = colour[2];
  }

  SpiralStream(x, y, r, dimm) {
    for (let d = r; d >= 0; --d) {
      for (let i = x - d; i <= x + d; ++i) this.streamInto(i, y - d, i + 1, y - d, dimm);
      for (let i = y - d; i <= y + d; ++i) this.streamInto(x + d, i, x + d, i + 1, dimm);
      for (let i = x + d; i >= x - d; --i) this.streamInto(i, y + d, i - 1, y + d, dimm);
      for (let i = y + d; i >= y - d; --i) this.streamInto(x - d, i, x - d, i - 1, dimm);
    }
  }

  StreamUpAndLeft(scale) {
    for (let x = 0; x < SIZE - 1; ++x)
      for (let y = SIZE - 2; y >= 0; --y) this.streamInto(x, y, x + 1, y + 1, scale);
    for (let x = 0; x < SIZE; ++x) this.streamInto(x, SIZE - 1, -1, -1, scale);
    for (let y = 0; y < SIZE; ++y) this.streamInto(SIZE - 1, y, -1, -1, scale);
  }

  MoveDown() {
    const row = SIZE * 3;
    this.rgb.copyWithin(row, 0, this.rgb.length - row);
  }

  // Rotates every row one pixel to the left, `delta` times.
  MoveX(delta) {
    const row = SIZE * 3;
    for (let y = 0; y < SIZE; ++y) {
      const line = this.rgb.subarray(y * row, (y + 1) * row);
      for (let m = 0; m < delta; ++m) {
        const first = [line[0], line[1], line[2]];
        line.copyWithin(0, 3);
        line.set(first, row - 3);
      }
    }
  }

  // Rotates every column one pixel upwards, `delta` times.
  MoveY(delta) {
    const row = SIZE * 3;
    for (let m = 0; m < delta; ++m) {
      const top = this.rgb.slice(0, row);
      this.rgb.copyWithin(0, row);
      this.rgb.set(top, this.rgb.length - row);
    }
  }
}

// The audio data AuroraDrop's patterns read (its FFTData), filled from the
// composer's logarithmic spectrum instead of AuroraDrop's own companion
// program or microphone.
export class DropAudio {
  constructor() {
    this.specData = new Uint8Array(128);
    this.specDataPeak = new Uint8Array(128);
    this.specData64 = new Uint8Array(64);
    this.specData32 = new Uint8Array(32);
    this.specData16 = new Uint8Array(16);
    this.specData8 = new Uint8Array(8);
    this.noAudio = true;
    this.specDataMaxVolume = 0;
    this.specDataMinVolume = 0;
  }

  // `spectrum` is bytes in a multiple of 128 bins. Coarser views average
  // neighbouring bins, as AuroraDrop does.
  update(spectrum) {
    if (!spectrum || spectrum.length < 128) return;
    const group = Math.floor(spectrum.length / 128);
    this.noAudio = true;
    this.specDataMaxVolume = 0;
    this.specDataMinVolume = 255;
    for (let i = 0; i < 128; ++i) {
      let peak = 0;
      for (let j = 0; j < group; ++j) peak = Math.max(peak, spectrum[i * group + j]);
      this.specData[i] = peak;
      if (peak > 0) this.noAudio = false;
      this.specDataMaxVolume = Math.max(this.specDataMaxVolume, peak);
      this.specDataMinVolume = Math.min(this.specDataMinVolume, peak);
      if (this.specDataPeak[i] > 0) this.specDataPeak[i]--;
      if (peak > this.specDataPeak[i]) this.specDataPeak[i] = peak;
    }
    for (const view of [this.specData64, this.specData32, this.specData16, this.specData8]) {
      const span = 128 / view.length;
      for (let i = 0; i < view.length; ++i) {
        let total = 0;
        for (let j = 0; j < span; ++j) total += this.specData[i * span + j];
        view[i] = Math.floor(total / span);
      }
    }
  }
}

const STEP_MS = 1000 / 60;
const CATCH_UP_BUDGET_MS = 100;
// AuroraDrop re-rolls each playlist slot after this long.
export const SLOT_MS = 10000;

// Runs AuroraDrop's frame pipeline: one processing effect works on what is
// already on the canvas, then each audio pattern draws on top. Every ten
// seconds each slot is restarted with new random parameters, and slots
// given several candidates pick a new one.
export class AuroraDropAnimation {
  constructor({ effects, patterns, layers = 1 }, width, height, random = Math.random) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
      throw new Error('AuroraDrop dimensions must be positive integers');
    this.width = width;
    this.height = height;
    this.canvas = new DropCanvas(random);
    this.audio = new DropAudio();
    this.output = new Uint8Array(width * height * 3);
    this.effectChoices = effects;
    this.patternChoices = patterns;
    this.slots = [];
    this.pick(null, effects);
    for (let i = 0; i < layers; ++i) this.pick(null, patterns);
    this.lastTime = null;
    this.owed = 0;
    this.frames = 0;
  }

  // Fills a slot (or adds one) with a newly started instance of a choice.
  pick(slot, choices) {
    const canvas = this.canvas;
    const Choice = choices[canvas.random8(choices.length)];
    const instance = new Choice();
    instance.start?.(canvas);
    const entry = { instance, choices, startedAt: canvas.ms };
    if (slot === null) this.slots.push(entry);
    else this.slots[slot] = entry;
    return entry;
  }

  step() {
    const canvas = this.canvas;
    this.slots.forEach((slot, index) => {
      if (canvas.ms - slot.startedAt > SLOT_MS) {
        slot = this.pick(index, slot.choices);
        // A new audio pattern brings a new palette, as in AuroraDrop.
        if (slot.choices === this.patternChoices) canvas.RandomPalette();
      }
      slot.instance.draw(canvas, this.audio);
    });
    canvas.ms += STEP_MS;
    this.frames++;
  }

  renderFrame(state) {
    this.audio.update(state.spectrum);
    return this.render(state.auroraTime ?? state.time ?? 0);
  }

  render(seconds) {
    if (!Number.isFinite(seconds))
      throw new Error('AuroraDrop animation time must be finite');
    if (this.lastTime === null) {
      this.step();
    } else {
      this.owed += Math.min(1, Math.max(0, seconds - this.lastTime)) * 1000;
      const started = performance.now();
      while (this.owed >= STEP_MS) {
        this.owed -= STEP_MS;
        this.step();
        if (performance.now() - started > CATCH_UP_BUDGET_MS) {
          this.owed = 0;
          break;
        }
      }
    }
    this.lastTime = seconds;
    return this.scale();
  }

  // Bilinear resize of the 64 by 64 canvas to the panel.
  scale() {
    const { width, height, output } = this, source = this.canvas.rgb;
    if (width === SIZE && height === SIZE) {
      output.set(source);
      return output;
    }
    for (let y = 0, out = 0; y < height; ++y) {
      const fy = Math.max(0, Math.min(SIZE - 1, (y + 0.5) * SIZE / height - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(SIZE - 1, y0 + 1), wy = fy - y0;
      for (let x = 0; x < width; ++x) {
        const fx = Math.max(0, Math.min(SIZE - 1, (x + 0.5) * SIZE / width - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(SIZE - 1, x0 + 1), wx = fx - x0;
        const a = (y0 * SIZE + x0) * 3, b = (y0 * SIZE + x1) * 3, c = (y1 * SIZE + x0) * 3, d = (y1 * SIZE + x1) * 3;
        for (let ch = 0; ch < 3; ++ch) {
          const top = source[a + ch] + (source[b + ch] - source[a + ch]) * wx;
          const bottom = source[c + ch] + (source[d + ch] - source[c + ch]) * wx;
          output[out++] = top + (bottom - top) * wy;
        }
      }
    }
    return output;
  }
}
