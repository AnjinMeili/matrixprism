// Copyright Mark Estes (Table_Mark_Estes), adapted by Marc Merlin; JavaScript
// port copyright 2026 Anjin <anjin@skyhighatry.com>.
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0: ../../licenses/table-mark-estes.txt.
// This file is a modified, translated version of the sketch; the deliberate
// differences are listed in ./NOTICE.md.
// Runtime for the Table_Mark_Estes port: the sketch's shared state, its
// per-pattern randomisation and per-frame housekeeping, and the FastLED and
// LEDMatrix primitives its effects draw with. See ./NOTICE.md for provenance.
import { byte, scale8, sin8, cos8, beatsin8 } from '../../aurora-fastled.js';
import { checkfancy } from './decorations.js';

export const div = (a, b) => Math.trunc(a / b);
const scale8Video = (value, scale) => ((value * scale) >> 8) + (value && scale ? 1 : 0);

// FastLED hsv2rgb_rainbow.
export function hsv(hue, saturation = 255, value = 255) {
  hue = byte(hue);
  saturation = byte(saturation);
  value = byte(value);
  const offset8 = (hue & 0x1f) << 3;
  const third = scale8(offset8, 85);
  const twoThirds = scale8(offset8, 170);
  let r, g, b;
  switch (hue >> 5) {
    case 0: r = 255 - third; g = third; b = 0; break;
    case 1: r = 171; g = 85 + third; b = 0; break;
    case 2: r = 171 - twoThirds; g = 170 + third; b = 0; break;
    case 3: r = 0; g = 255 - third; b = third; break;
    case 4: r = 0; g = 171 - twoThirds; b = 85 + twoThirds; break;
    case 5: r = third; g = 0; b = 255 - third; break;
    case 6: r = 85 + third; g = 0; b = 171 - third; break;
    default: r = 170 + third; g = 0; b = 85 - third; break;
  }
  if (saturation !== 255) {
    if (saturation === 0) {
      r = g = b = 255;
    } else {
      let desat = 255 - saturation;
      desat = scale8Video(desat, desat);
      const satscale = 255 - desat;
      r = scale8(r, satscale) + desat;
      g = scale8(g, satscale) + desat;
      b = scale8(b, satscale) + desat;
    }
  }
  if (value !== 255) {
    value = scale8Video(value, value);
    if (value === 0) {
      r = g = b = 0;
    } else {
      r = scale8(r, value);
      g = scale8(g, value);
      b = scale8(b, value);
    }
  }
  return [r, g, b];
}

export const WHITE = [255, 255, 255];
export const BLACK = [0, 0, 0];
export const RED = [255, 0, 0];
export const BLUE = [0, 0, 255];
export const YELLOW = [255, 255, 0];
export const GREEN = [0, 128, 0];
export const PURPLE = [128, 0, 128];

// A 16-entry palette filled like CRGBPalette16(c0, c1, c2, c3).
export function palette16(c0, c1, c2, c3) {
  const entries = [];
  const ramp = (from, to, start, end) => {
    for (let i = start; i <= end; ++i) {
      const f = (i - start) / (end - start);
      entries[i] = from.map((value, c) => Math.round(value + (to[c] - value) * f));
    }
  };
  ramp(c0, c1, 0, 5);
  ramp(c1, c2, 5, 10);
  ramp(c2, c3, 10, 15);
  return entries;
}

// A 16-entry palette sampled from gradient stops [index, r, g, b, ...].
export function gradientPalette16(stops) {
  return Array.from({ length: 16 }, (_, i) => {
    const index = i * 17;
    let upper = 4;
    while (upper < stops.length - 4 && index > stops[upper]) upper += 4;
    const lower = upper - 4;
    const f = (index - stops[lower]) / Math.max(1, stops[upper] - stops[lower]);
    return [1, 2, 3].map(c => Math.round(stops[lower + c] + (stops[upper + c] - stops[lower + c]) * f));
  });
}

// FastLED ColorFromPalette with linear blending at full brightness.
export function colorFromPalette(palette, index) {
  index = byte(index);
  const first = palette[index >> 4];
  const fraction = (index & 15) << 4;
  if (!fraction) return first;
  const second = palette[((index >> 4) + 1) & 15];
  return [0, 1, 2].map(c => scale8(first[c], 255 - fraction) + scale8(second[c], fraction));
}

export const qsub8 = (a, b) => Math.max(0, a - b);

// The simulated frame rate range of the sketch, in frames per second.
const SLOWEST = 2, FASTEST = 15;
const TIMING = 99;
const CATCH_UP_BUDGET_MS = 100;

export class TmeRuntime {
  constructor(width, height, random = Math.random) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8)
      throw new Error('Mark Estes patterns need a panel of at least 8x8 pixels');
    this.W = width;
    this.H = height;
    this.MIDLX = div(width, 2);
    this.MIDLY = div(height, 2);
    this.BIGGER = Math.max(width, height);
    this.square = width === height;
    this.rgb = new Uint8Array(width * height * 3);
    this.rng = random;

    const size = this.BIGGER * 2;
    this.fpeed = new Uint8Array(size);
    this.fcolor = new Uint8Array(size);
    this.fcountr = new Uint8Array(size);
    this.fvelo = new Uint8Array(size);
    this.xpoffset = new Uint8Array(size);
    this.fcount = new Uint16Array(size);
    this.xslope = new Float32Array(size);
    this.yslope = new Float32Array(size);
    this.xfire = new Float32Array(size);
    this.yfire = new Float32Array(size);
    this.rimmer = new Uint8Array(size);
    this.xbouncer = new Uint8Array(size);
    this.ybouncer = new Uint8Array(size);
    this.flop = new Array(13).fill(false);

    // Values the sketch initialises globally or in setup().
    this.ms = 0;
    this.counter = 0;
    this.mstep = byte(div(256, width - 1));
    this.hue = this.random8();
    this.h = this.hue;
    this.driftx = this.random(3, width - 4);
    this.drifty = this.random(3, height - 4);
    this.cangle = (sin8(this.random(25, 220)) - 128) / 128;
    this.sangle = (sin8(this.random(25, 220)) - 128) / 128;
    this.blender = 120;
    this.xblender = 0;
    this.dot4 = 5;
    this.radius = 0;
    this.radius2 = 0;
    this.radius3 = 0;
    this.howmany = 0;
    this.xhowmany = 0;
    this.how = 0;
    this.inner = 0;
    this.quash = 5;
    this.sinewidth = 3;
    this.poffset = 0;
    this.xx = 0;
    this.yy = 0;
    this.xxx = 0;
    this.yyy = 0;
    this.xangle = 0;
    this.yangle = 0;
    this.lastTwelve = 0;
    this.patternStart = 0;
    this.timers = new Map();
    // Audio: 64-bin left and right spectra (0..63), as the effects read them.
    this.LLaudio = new Uint8Array(64);
    this.RRaudio = new Uint8Array(64);
    // The 17 coarse bands per channel that some effects read directly.
    this.laudio = new Uint8Array(17);
    this.raudio = new Uint8Array(17);
    this.inputLeft = new Uint8Array(64);
    this.inputRight = new Uint8Array(64);
    this.inputPeak = 0;
    this.lastHeard = -Infinity;
    this.beatHigh = false;
    this.beatPending = false;
    this.gotmusic = false;
    // What the audio patterns show when nothing is heard: 'standin' is the
    // sketch's moving stand-in, 'quiet' shows the silence as it is.
    this.silence = 'standin';
    this.target = false;
    this.maxiaud = 0;
    this.bpm = null;
    this.rr = 0;
    this.raad = 0;
    this.locusx = 0;
    this.locusy = 0;
    this.pointy = 4;
    this.flipme = 1;
    this.xcen = 0;
    this.ycen = 0;
  }

  // ---------- Arduino and FastLED random ----------

  random(low, high) {
    if (high === undefined) { high = low; low = 0; }
    low = Math.trunc(low);
    high = Math.trunc(high);
    return high <= low ? low : low + Math.floor(this.rng() * (high - low));
  }

  random8(low, high) {
    const value = Math.floor(this.rng() * 256);
    if (low === undefined) return value;
    if (high === undefined) return (value * byte(low)) >> 8;
    return byte(low) + ((value * byte(high - low)) >> 8);
  }

  // ---------- time ----------

  beatsin8(bpm, low, high, timebase = 0) {
    return beatsin8(bpm, byte(low), byte(high), Math.max(0, this.ms - timebase));
  }

  // Approximates FastLED beatsin16 with a floating-point sine.
  beatsin16(bpm, low, high, timebase = 0) {
    const phase = (this.ms - timebase) * bpm / 60000;
    return Math.trunc(low + (high - low) * (Math.sin(phase * Math.PI * 2) + 1) / 2);
  }

  // FastLED's EVERY_N_SECONDS: true once each time the period has elapsed.
  // Like the sketch's static timers, these run on across pattern changes.
  every(name, seconds) {
    const last = this.timers.get(name);
    if (last === undefined) {
      this.timers.set(name, this.ms);
      return false;
    }
    if (this.ms - last < seconds * 1000) return false;
    this.timers.set(name, this.ms);
    return true;
  }

  // ---------- audio ----------

  // Supplies the composer's analysis: a log-frequency spectrum (bytes, any
  // length that is a multiple of 64) and its { level, beat } features. The
  // sketch had separate left and right spectra; a mono source feeds both.
  setAudio(spectrum, features = {}, right = spectrum) {
    if (!spectrum || spectrum.length < 64) return;
    const fill = (target, source) => {
      const group = Math.floor(source.length / 64);
      for (let i = 0; i < 64; ++i) {
        let peak = 0;
        for (let j = 0; j < group; ++j) peak = Math.max(peak, source[i * group + j]);
        target[i] = peak >> 2;
      }
    };
    fill(this.inputLeft, spectrum);
    fill(this.inputRight, right);
    const loudest = Math.max(...this.inputLeft, ...this.inputRight) * 4;
    this.inputPeak = Number.isFinite(features.level) ?
      Math.max(Math.round(Math.min(1, features.level) * 255), loudest) : loudest;
    if (this.inputPeak >= 2) this.lastHeard = this.ms;
    // Latch a beat until the next simulation step reads it.
    const high = features.beat >= 0.99;
    if (high && !this.beatHigh) this.beatPending = true;
    this.beatHigh = high;
  }

  // The sketch's stand-in when no music is playing: each band bobs at its
  // own rate so the audio patterns still move.
  fakenoise() {
    if (!this.bpm || this.counter === 0) {
      const fast = [22, 45, 51].includes(this.pattern?.number) ? 2 : 1;
      this.bpm = [];
      for (let i = 0; i < 34; ++i) {
        let rate = this.random(4, 25);
        for (let tries = 0; i > 0 && tries < 100 && Math.abs(rate * fast - this.bpm[i - 1]) < 5 * fast; ++tries)
          rate = this.random(4, 20);
        this.bpm[i] = rate * fast;
      }
    }
    const left = [], right = [];
    for (let i = 0; i <= 16; ++i) {
      left[i] = this.beatsin16(this.bpm[i], 1, 63, 32);
      right[i] = this.beatsin16(this.bpm[i + 16], 1, 63, 32);
      this.maxiaud = Math.max(this.maxiaud, left[i], right[i]);
    }
    // Spread the 17 bands over 64 bins, as the sketch does.
    const spread = (bands, target) => {
      for (let p = 0; p < 16; ++p) {
        for (let q = 0; q < 4; ++q)
          target[p * 4 + q] = bands[p] * (1 - q / 4) + bands[p + 1] * (q / 4);
      }
      target[63] = (bands[15] + bands[16]) / 2;
      target[0] = (bands[0] * 0.8 + bands[1]) * 0.28;
    };
    spread(left, this.LLaudio);
    spread(right, this.RRaudio);
    this.laudio.set(left);
    this.raudio.set(right);
  }

  // Refreshes the spectra the effects read. Music counts as present while
  // something has been heard in the last five simulated seconds.
  audioprocess() {
    this.maxiaud = 0;
    this.gotmusic = this.ms - this.lastHeard < 5000;
    if (!this.gotmusic && this.silence !== 'quiet') {
      this.target = false;
      this.fakenoise();
      return;
    }
    this.LLaudio.set(this.inputLeft);
    this.RRaudio.set(this.inputRight);
    // Each coarse band is the loudest of four neighbouring bins.
    for (let band = 0; band < 17; ++band) {
      const first = Math.min(60, band * 4);
      this.laudio[band] = Math.max(...this.inputLeft.subarray(first, first + 4));
      this.raudio[band] = Math.max(...this.inputRight.subarray(first, first + 4));
    }
    this.maxiaud = this.inputPeak >> 2;
    this.target = this.beatPending;
    this.beatPending = false;
  }

  // ---------- pixels (zeds) ----------

  index(x, y) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    return x < 0 || y < 0 || x >= this.W || y >= this.H ? -1 : (y * this.W + x) * 3;
  }

  set(x, y, color) {
    const i = this.index(x, y);
    if (i < 0) return;
    this.rgb[i] = color[0];
    this.rgb[i + 1] = color[1];
    this.rgb[i + 2] = color[2];
  }

  add(x, y, color) {
    const i = this.index(x, y);
    if (i < 0) return;
    this.rgb[i] = Math.min(255, this.rgb[i] + color[0]);
    this.rgb[i + 1] = Math.min(255, this.rgb[i + 1] + color[1]);
    this.rgb[i + 2] = Math.min(255, this.rgb[i + 2] + color[2]);
  }

  // Copies one pixel; reads outside the panel give black.
  copy(toX, toY, fromX, fromY) {
    const to = this.index(toX, toY);
    if (to < 0) return;
    const from = this.index(fromX, fromY);
    for (let c = 0; c < 3; ++c)
      this.rgb[to + c] = from < 0 ? 0 : this.rgb[from + c];
  }

  // ---------- drawing (the sketch's D* helpers) ----------

  hline(x0, x1, y, color) {
    if (y < 0 || y >= this.H) return;
    let from = Math.max(0, Math.min(x0, x1));
    const to = Math.min(this.W - 1, Math.max(x0, x1));
    for (let i = (y * this.W + from) * 3; from <= to; ++from, i += 3) {
      this.rgb[i] = color[0];
      this.rgb[i + 1] = color[1];
      this.rgb[i + 2] = color[2];
    }
  }

  DLine(x0, y0, x1, y1, color) {
    x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
    const dx = x1 - x0, dy = y1 - y0;
    if (dy === 0) {
      this.hline(x0, x1, y0, color);
      return;
    }
    // 16.16 fixed point, as in the sketch.
    if (Math.abs(dx) >= Math.abs(dy)) {
      let y = y0 * 65536 + 32768;
      const f = Math.trunc(dy * 65536 / Math.abs(dx));
      const step = dx >= 0 ? 1 : -1;
      for (let x = x0; x !== x1 + step; x += step, y += f)
        this.set(x, Math.floor(y / 65536), color);
    } else {
      let x = x0 * 65536 + 32768;
      const f = Math.trunc(dx * 65536 / Math.abs(dy));
      const step = dy >= 0 ? 1 : -1;
      for (let y = y0; y !== y1 + step; y += step, x += f)
        this.set(Math.floor(x / 65536), y, color);
    }
  }

  // Like DCircle, but adds to what is already there.
  ADCircle(xc, yc, r, color) {
    this.DCircle(xc, yc, r, color, true);
  }

  DCircle(xc, yc, r, color, additive = false) {
    xc = Math.trunc(xc); yc = Math.trunc(yc); r = Math.trunc(r);
    if (r < 0) return;
    const plot = additive ? this.add : this.set;
    let x = -r, y = 0, e = 2 - 2 * r;
    do {
      plot.call(this, xc + x, yc - y, color);
      plot.call(this, xc - x, yc + y, color);
      plot.call(this, xc + y, yc + x, color);
      plot.call(this, xc - y, yc - x, color);
      const previous = e;
      if (previous <= y) e += ++y * 2 + 1;
      if (previous > x || e > y) e += ++x * 2 + 1;
    } while (x < 0);
  }

  DFCircle(xc, yc, r, color) {
    xc = Math.trunc(xc); yc = Math.trunc(yc); r = Math.trunc(r);
    if (r < 0) return;
    let x = r, y = 0, e = 1 - x;
    while (x >= y) {
      this.hline(xc - x, xc + x, yc + y, color);
      this.hline(xc - y, xc + y, yc + x, color);
      this.hline(xc - x, xc + x, yc - y, color);
      this.hline(xc - y, xc + y, yc - x, color);
      ++y;
      if (e >= 0) {
        --x;
        e += 2 * (y - x + 1);
      } else {
        e += 2 * y + 1;
      }
    }
  }

  DRectangle(x0, y0, x1, y1, color) {
    this.DLine(x0, y0, x0, y1, color);
    this.DLine(x0, y1, x1, y1, color);
    this.DLine(x1, y1, x1, y0, color);
    this.DLine(x1, y0, x0, y0, color);
  }

  DFRectangle(x0, y0, x1, y1, color) {
    x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
    for (let y = Math.min(y0, y1), c = Math.abs(y1 - y0); c >= 0; --c, ++y)
      this.hline(x0, x1, y, color);
  }

  triangle(xloc, yloc, bigg, dangle, kolor) {
    const corner = (angle) => [
      Math.trunc(xloc + bigg * (sin8(angle) - 128) / 128),
      Math.trunc(yloc + bigg * (cos8(angle) - 128) / 128),
    ];
    const a = corner(dangle), b = corner(dangle + 85), c = corner(dangle - 85);
    const color = hsv(kolor, 255 - this.counter % 64, 255);
    this.DLine(a[0], a[1], b[0], b[1], color);
    this.DLine(c[0], c[1], b[0], b[1], color);
    this.DLine(a[0], a[1], c[0], c[1], color);
  }

  drawstar(xlocl, ylocl, biggy, little, points, dangle, koler) {
    xlocl = Math.trunc(xlocl); ylocl = Math.trunc(ylocl);
    biggy = Math.trunc(biggy); little = Math.trunc(little);
    // The sketch leaves this in its shared radius2.
    this.radius2 = div(255, points);
    const step = this.radius2, half = div(step, 2);
    const color = hsv(koler, 255 - div(this.velo, 5), 255);
    for (let i = 0; i < points; ++i) {
      const tipX = xlocl + biggy * (sin8(i * step - dangle) - 128) / 128;
      const tipY = ylocl + biggy * (cos8(i * step - dangle) - 128) / 128;
      for (const side of [half, -half]) {
        this.DLine(xlocl + little * (sin8(i * step + side - dangle) - 128) / 128,
          ylocl + little * (cos8(i * step + side - dangle) - 128) / 128, tipX, tipY, color);
      }
    }
  }

  // ---------- LEDMatrix mirrors and shifts ----------

  HorizontalMirror(fullHeight = true) {
    const top = fullHeight ? this.H - 1 : div(this.H, 2);
    for (let y = top; y >= 0; --y)
      for (let x = div(this.W, 2) - 1, xx = div(this.W + 1, 2); x >= 0; --x, ++xx)
        this.copy(xx, y, x, y);
  }

  VerticalMirror() {
    for (let y = div(this.H, 2) - 1, yy = div(this.H + 1, 2); y >= 0; --y, ++yy)
      for (let x = this.W - 1; x >= 0; --x)
        this.copy(x, yy, x, y);
  }

  QuadrantMirror() {
    this.HorizontalMirror(false);
    this.VerticalMirror();
  }

  QuadrantRotateMirror() {
    let max = Math.min(this.W, this.H);
    const mid = div(max, 2);
    max--;
    const start = mid - max % 2;
    for (let x = start; x >= 0; --x) {
      for (let y = start; y >= 0; --y) {
        this.copy(mid + y, start - x, x, y);
        this.copy(max - x, max - y, x, y);
        this.copy(start - y, mid + x, x, y);
      }
    }
  }

  TriangleTopMirror(fullHeight = true) {
    let max = Math.min(this.W, this.H) - 1;
    if (!fullHeight) max = div(max, 2);
    for (let y = 1; y <= max; ++y)
      for (let x = 0; x < y; ++x)
        this.copy(y, x, x, y);
  }

  TriangleBottomMirror(fullHeight = true) {
    let max = Math.min(this.W, this.H) - 1;
    if (!fullHeight) max = div(max, 2);
    for (let y = 0, xx = max; y < max; ++y, --xx)
      for (let x = max - y - 1, yy = y + 1; x >= 0; --x, ++yy)
        this.copy(xx, yy, x, y);
  }

  QuadrantBottomTriangleMirror() {
    this.TriangleBottomMirror(false);
    this.QuadrantMirror();
  }

  // The sketch's own mirror(): bottom half reflected into the top half.
  mirror() {
    for (let x = 0; x < this.W; ++x)
      for (let y = 0; y < this.MIDLY; ++y)
        this.copy(x, y, x, this.H - y - 1);
  }

  ShiftLeft() {
    const row = this.W * 3;
    for (let y = 0; y < this.H; ++y) {
      this.rgb.copyWithin(y * row, y * row + 3, (y + 1) * row);
      this.rgb.fill(0, (y + 1) * row - 3, (y + 1) * row);
    }
  }

  ShiftRight() {
    const row = this.W * 3;
    for (let y = 0; y < this.H; ++y) {
      this.rgb.copyWithin(y * row + 3, y * row, (y + 1) * row - 3);
      this.rgb.fill(0, y * row, y * row + 3);
    }
  }

  // LEDMatrix names: "down" moves rows towards y = 0.
  ShiftDown() {
    const row = this.W * 3;
    this.rgb.copyWithin(0, row);
    this.rgb.fill(0, this.rgb.length - row);
  }

  ShiftUp() {
    const row = this.W * 3;
    this.rgb.copyWithin(row, 0, this.rgb.length - row);
    this.rgb.fill(0, 0, row);
  }

  // ---------- the sketch's per-frame housekeeping ----------

  fadeToBlackBy(amount) {
    const keep = 255 - byte(amount);
    for (let i = 0; i < this.rgb.length; ++i)
      this.rgb[i] = scale8(this.rgb[i], keep);
  }

  subtract(r, g, b) {
    const rgb = this.rgb;
    for (let i = 0; i < rgb.length; i += 3) {
      rgb[i] = Math.max(0, rgb[i] - r);
      rgb[i + 1] = Math.max(0, rgb[i + 1] - g);
      rgb[i + 2] = Math.max(0, rgb[i + 2] - b);
    }
  }

  redfado(amount) {
    const half = div(amount, 2);
    if (this.flop[2]) this.subtract(half, amount, amount);
    else this.subtract(half, half, amount);
  }

  greenfado(amount) {
    const half = div(amount, 2);
    if (this.flop[2]) this.subtract(amount, half, amount);
    else this.subtract(amount, half, half);
  }

  bluefado(amount) {
    const half = div(amount, 2);
    if (this.flop[2]) this.subtract(amount, amount, half);
    else this.subtract(half, amount, half);
  }

  checkfader() {
    const coloured = [this.redfado, this.greenfado, this.bluefado];
    const bfade = this.bfade;
    if (bfade === 0 || bfade === 99) return;
    if (bfade >= 6 && bfade <= 14) coloured[(bfade - 6) % 3].call(this, 16 + 8 * div(bfade - 6, 3));
    else if (bfade === 100) this.fadeToBlackBy(10);
    else if (bfade === 101) this.fadeToBlackBy(6);
    else if (bfade >= 108 && bfade <= 110) coloured[110 - bfade].call(this, 32);
    else if (bfade >= 118 && bfade <= 120) coloured[120 - bfade].call(this, 8);
    else this.fadeToBlackBy(8 + (bfade << 3) + 2);
  }

  checkshifty() {
    const lowX = div(this.MIDLX, 4), highX = this.W - 1 - lowX;
    const lowY = div(this.MIDLY, 4), highY = this.H - 1 - lowY;
    if (this.counter % this.shifty === 0) {
      this.driftx += this.cangle;
      if (this.driftx > highX) {
        this.cangle = -Math.abs(this.cangle);
        this.driftx += this.cangle;
      }
      if (this.driftx < lowX) {
        this.cangle = Math.abs(this.cangle);
        this.driftx += this.cangle;
      }
      this.drifty += this.sangle;
      if (this.drifty > highY) {
        this.sangle = -Math.abs(this.sangle);
        this.drifty += this.sangle;
      }
      if (this.drifty < lowY) {
        this.sangle = Math.abs(this.sangle);
        this.drifty += this.sangle;
      }
    }
    this.driftx = Math.min(highX, Math.max(lowX, this.driftx));
    this.drifty = Math.min(highY, Math.max(lowY, this.drifty));
  }

  // Splits the panel at a moving line and pushes each side outwards.
  splitWind(vertical, divider) {
    if (vertical) {
      for (let x = 0; x < this.W; ++x) {
        for (let y = 0; y < divider; ++y) this.copy(x, y, x, y + 1);
        for (let y = this.H - 1; y >= divider; --y) this.copy(x, y, x, y - 1);
      }
    } else {
      for (let y = 0; y < this.H; ++y) {
        for (let x = 0; x < divider; ++x) this.copy(x, y, x + 1, y);
        for (let x = this.W - 1; x >= divider; --x) this.copy(x, y, x - 1, y);
      }
    }
  }

  checkwind() {
    const eastWest = () => this.splitWind(false, this.beatsin8(this.dot3, this.MIDLX * 0.5, this.MIDLX * 1.5));
    switch (this.wind) {
      case 1: this.ShiftUp(); break;
      case 2: this.ShiftUp(); this.ShiftRight(); break;
      case 3: this.ShiftRight(); break;
      case 4: this.ShiftRight(); this.ShiftDown(); break;
      case 5: this.ShiftDown(); break;
      case 6: this.ShiftDown(); this.ShiftLeft(); break;
      case 7: this.ShiftLeft(); break;
      case 8: this.ShiftUp(); this.ShiftLeft(); break;
      case 9: this.splitWind(true, this.beatsin8(this.dot3, this.MIDLY * 0.5, this.MIDLY * 1.5)); break;
      case 10: eastWest(); break;
      case 11:
        if (this.counter % 2 === 0) this.splitWind(true, this.MIDLY);
        else this.splitWind(false, this.MIDLX);
        break;
      case 12: this.ShiftLeft(); this.ShiftLeft(); break;
      case 13: this.ShiftDown(); this.ShiftDown(); break;
      case 14: eastWest(); this.ShiftUp(); break;
      case 15: eastWest(); this.ShiftDown(); break;
      default: break;
    }
  }

  // Applies the screen-wide mirror chosen for this run of the pattern.
  adjustme() {
    switch (this.adjunct) {
      case 2:
        if (this.square) this.HorizontalMirror(true);
        this.VerticalMirror();
        break;
      case 3:
        if (this.square) {
          this.QuadrantBottomTriangleMirror();
        } else {
          this.TriangleTopMirror(true);
          this.HorizontalMirror();
        }
        break;
      case 4: case 9: this.HorizontalMirror(true); break;
      case 5: this.VerticalMirror(); break;
      case 6: this.QuadrantRotateMirror(); break;
      case 7: case 14: this.TriangleTopMirror(true); break;
      case 8: this.QuadrantMirror(); break;
      case 10: case 11: this.TriangleBottomMirror(true); break;
      case 12: this.TriangleTopMirror(true); this.VerticalMirror(); break;
      case 13: this.mirror(); break;
      default: break;
    }
  }

  // ---------- pattern lifecycle ----------

  // The randomisation shared by the sketch's newpattern() and regenpattern().
  randomize() {
    this.zoomer = this.random(16);
    this.velo = this.random8();
    this.targetfps = this.random(SLOWEST, FASTEST);
    this.bfade = this.random(1, 9);
    this.wind = this.random8(60);
    this.fancy = this.random8(100);
    this.dot = this.random(2, 6);
    this.dot2 = this.random(2, 6);
    this.dot3 = this.random(1, 4);
    this.adjunct = this.random(45);
    if (!this.square && this.adjunct < 15 && this.adjunct > 1)
      this.adjunct = this.random(2, 6);
    this.dwell = 1000 * this.random(TIMING, TIMING * 1.7);
    this.ringdelay = this.random(35, 80);
    this.bringdelay = this.random(80, 200);
    this.counter = 0;
    this.steper = this.random(1, 9);
    this.shifty = this.random(2, 13);
    this.ccoolloorr = this.random8();
    this.blender = this.random8();
    this.xblender = this.random8();
    this.poffset = this.random8();
    this.pointyfix = this.random(4, 9);
    for (let g = 0; g < 13; ++g)
      this.flop[g] = this.random8() < 128;
    this.cool = this.random(10, 18);
    this.hue = this.wrap16(this.hue + this.random(64));
    this.h = this.hue;
    this.cangle = this.random(25, 85) / 100;
    this.sangle = this.random(25, 85) / 100;
    if (this.random8() > 128) this.cangle = -this.cangle;
    if (this.random8() > 128) this.sangle = -this.sangle;
    this.patternStart = this.ms;
  }

  // The sketch keeps its hue in an int16.
  wrap16(value) {
    return ((value + 32768) & 65535) - 32768;
  }

  start(pattern) {
    this.pattern = pattern;
    this.randomize();
    pattern.setup?.(this);
  }

  // One pass of the sketch's loop().
  step() {
    this.hue = this.wrap16(this.hue + 1);
    this.h = this.hue;
    this.checkshifty();
    this.checkfader();
    checkfancy(this);
    this.checkwind();
    if (this.ms - this.lastTwelve >= 12000) {
      this.lastTwelve = this.ms;
      this.cangle = this.random(25, 85) / 100;
      this.sangle = this.random(25, 85) / 100;
      if (this.random8() > 128) this.cangle = -this.cangle;
      if (this.random8() > 128) this.sangle = -this.sangle;
      this.blender += this.random(4, 12);
      this.xblender -= this.random(4, 12);
    }
    this.pattern.run(this);
    this.counter++;
    this.ms += 1000 / this.targetfps;
    // When its time is up the sketch re-rolls the pattern's parameters.
    if (this.ms > this.patternStart + this.dwell)
      this.start(this.pattern);
  }
}

// A stateful composer pattern that runs one sketch pattern at its own
// simulated frame rate.
export class TmeAnimation {
  constructor(pattern, width, height, random = Math.random) {
    this.runtime = new TmeRuntime(width, height, random);
    this.runtime.start(pattern);
    this.lastTime = null;
    this.owed = 0;
    this.frames = 0;
  }

  renderFrame(state) {
    this.runtime.silence = state.silenceMode === 'quiet' ? 'quiet' : 'standin';
    this.runtime.setAudio(state.spectrumLeft ?? state.spectrum, state.audio,
      state.spectrumRight ?? state.spectrum);
    return this.render(state.auroraTime ?? state.time ?? 0);
  }

  render(seconds) {
    if (!Number.isFinite(seconds))
      throw new Error('Mark Estes animation time must be finite');
    const t = this.runtime;
    if (this.lastTime === null) {
      t.step();
      this.frames++;
    } else {
      this.owed += Math.min(1, Math.max(0, seconds - this.lastTime));
      const started = performance.now();
      while (this.owed >= 1 / t.targetfps) {
        this.owed -= 1 / t.targetfps;
        t.step();
        this.frames++;
        if (performance.now() - started > CATCH_UP_BUDGET_MS) {
          this.owed = 0;
          break;
        }
      }
    }
    this.lastTime = seconds;
    return t.rgb;
  }
}
