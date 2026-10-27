// Bars 2, ported from visualizations/multiband2.js in Spotify's
// visualizer-app, by Bastian Kuberek, 2013. Copyright (c) 2013, Spotify AB,
// BSD 3-Clause; licence text in ./NOTICE.md.
//
// The left channel's 31 bands as bars up from the centre line and the
// right's down, coloured by frequency, at half opacity, with nine white
// stepped outlines of the spectrum behind them. Sizes the original gave in
// window pixels are scaled by the panel's height against a 600-pixel window.

import { BAND31, Canvas, WINDOW_HEIGHT, band31, colorize } from './runtime.js';

const WHITE = [255, 255, 255];

export class Multiband2 {
  constructor(width, height) {
    this.amp = 96;
    this.gap = 1;
    this.opacity = 0.5;
    this.band_count = BAND31.length;
    // The original's canvas was the window less 20 pixels; here it is the panel.
    this.cw = width;
    this.ch = height;
    this.hc = this.ch / 2;
    this.nP = this.cw / this.band_count;
    this.margin = 50 * height / WINDOW_HEIGHT;
    this.colours = BAND31.map(colorize);
    this.canvas = new Canvas(width, height);
    this.left = new Float32Array(this.band_count);
    this.right = new Float32Array(this.band_count);
  }

  // The original's audio event: each channel's BAND31 levels in decibels.
  audio(state) {
    band31(state.spectrumLeft ?? state.spectrum, this.left);
    band31(state.spectrumRight ?? state.spectrum, this.right);
  }

  draw() {
    const c = this.canvas, { cw, ch, hc, amp } = this;
    c.clear();
    // 'destination-over': each shape drawn goes behind those before it.
    c.composite = 'destination-over';
    c.alpha = this.opacity;
    const w = (cw - this.band_count * this.gap) / this.band_count;
    for (let i = 0; i < this.band_count; i++) {
      const hl = (amp + this.left[i]) * (ch / 2 - this.margin) / amp;
      const hr = (amp + this.right[i]) * (ch / 2 - this.margin) / amp;
      const dx = w * i + i;
      c.fillRect(dx, hc - hl - 0.5, w, hl, this.colours[i]);
      c.fillRect(dx, hc + 0.5, w, hr, this.colours[i]);
    }
    for (const lr of [0, 1])
      for (const offset of [-280, -180, -100, -10, 0, 10, 20, 30, 40])
        this.drawPath(offset * this.ch / WINDOW_HEIGHT, lr);
    c.alpha = 1;
    return c.toRGB();
  }

  // Make some lines
  drawPath(offset, lr) {
    const { cw, ch, hc, amp, nP } = this;
    const path = [0, hc];
    for (let i = 0; i < this.band_count; i++) {
      let y;
      if (lr) {
        y = hc + ((amp + this.right[i]) * (ch / 2 - this.margin) / amp) + offset;
        y = y > hc ? y : hc;
      } else {
        y = hc - ((amp + this.left[i]) * (ch / 2 - this.margin) / amp) - offset;
        y = y < hc ? y : hc;
      }
      path.push(i * nP, y, i * nP + nP, y);
    }
    path.push(cw, hc);
    this.canvas.strokePath(path, WHITE);
  }
}
