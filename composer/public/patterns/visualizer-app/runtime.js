// Runtime for the visualizer-app port: the bands the originals were fed, the
// colour by frequency, a small canvas that composites as a 2D canvas does, and
// the 60 Hz frame loop. See ./NOTICE.md.
//
// Adapted from Spotify's visualizer-app (js/visualizer.js), Copyright (c)
// 2013, Spotify AB, BSD 3-Clause; licence text in ./NOTICE.md.

// Spotify's audio.BAND31: assumed to be the standard third-octave centres.
export const BAND31 = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
  630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];

// The composer's 256 spectrum bins run logarithmically from 30 Hz to 16 kHz
// (audio.js, buildLogBins).
const SPECTRUM_LOW_HZ = 30;
const SPECTRUM_HIGH_HZ = 16000;
const THIRD_OCTAVE = 2 ** (1 / 6);

function binOf(hz, bins) {
  const at = bins * Math.log(hz / SPECTRUM_LOW_HZ) / Math.log(SPECTRUM_HIGH_HZ / SPECTRUM_LOW_HZ);
  return Math.max(0, Math.min(bins - 1, Math.floor(at)));
}

// A byte level, 0 to 255, as the decibels the originals were written for:
// about -96 (silence) to 0 (full).
export const decibels = (byte) => -96 + 96 * byte / 255;

// One reading per BAND31 band, in decibels: the loudest bin within a third
// of an octave of the band's centre. Bands outside 30 Hz to 16 kHz read the
// nearest end bin.
export function band31(spectrum, out = new Float32Array(BAND31.length)) {
  const bins = spectrum?.length ?? 0;
  for (let i = 0; i < BAND31.length; ++i) {
    if (!bins) { out[i] = -96; continue; }
    const b0 = binOf(BAND31[i] / THIRD_OCTAVE, bins);
    const b1 = Math.max(b0, binOf(BAND31[i] * THIRD_OCTAVE, bins));
    let peak = 0;
    for (let b = b0; b <= b1; ++b) peak = Math.max(peak, spectrum[b]);
    out[i] = decibels(peak);
  }
  return out;
}

// visualizer.js colorize(): a band's frequency as the colour of light, from
// red at 20 Hz to violet at 22.5 kHz. Returns [r, g, b] bytes, as the
// original's hex string held them.
export function colorize(frequency) {
  const s = Math.log(frequency - 19) / Math.log(22500 - 19);
  const w = (1 - s) * 370 + 380;
  let r, g, b;
  if (w >= 380 && w < 440) {
    r = -(w - 440) / (440 - 380); g = 0; b = 1;
  } else if (w >= 440 && w < 490) {
    r = 0; g = (w - 440) / (490 - 440); b = 1;
  } else if (w >= 490 && w < 510) {
    r = 0; g = 1; b = -(w - 510) / (510 - 490);
  } else if (w >= 510 && w < 580) {
    r = (w - 510) / (580 - 510); g = 1; b = 0;
  } else if (w >= 580 && w < 645) {
    r = 1; g = -(w - 645) / (645 - 580); b = 0;
  } else if (w >= 645 && w <= 750) {
    r = 1; g = 0; b = 0;
  } else {
    r = 0; g = 0; b = 0;
  }
  return [Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)];
}

// The originals drew in a browser window; their fixed pixel sizes (offsets,
// margins) are scaled by the panel's height against a
// window this tall.
export const WINDOW_HEIGHT = 600;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// A canvas that composites as a 2D canvas does: premultiplied RGBA in floats,
// 'source-over' or 'destination-over', with antialiased coverage. Each fill
// or stroke is rasterised to a coverage mask first, so a path's own joins
// and overlaps composite once, as the canvas does.
export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.rgba = new Float32Array(width * height * 4);
    this.mask = new Float32Array(width * height);
    this.out = new Uint8Array(width * height * 3);
    this.composite = 'source-over';
    this.alpha = 1;
    this.box = null;
  }

  clear() {
    this.rgba.fill(0);
  }

  // Marks a pixel's coverage in the mask, keeping the largest.
  cover(x, y, c) {
    if (c <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    if (c > this.mask[i]) this.mask[i] = c > 1 ? 1 : c;
    const box = this.box;
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x;
    if (y > box[3]) box[3] = y;
  }

  begin() {
    this.box = [this.width, this.height, -1, -1];
  }

  // Composites the mask in one colour, [r, g, b] bytes, at `alpha` (times the
  // canvas's own), and clears the mask.
  paint(colour, alpha = 1) {
    const [x0, y0, x1, y1] = this.box;
    const a0 = alpha * this.alpha;
    const { rgba, mask, width } = this;
    for (let y = y0; y <= y1; ++y) {
      for (let x = x0; x <= x1; ++x) {
        const i = y * width + x;
        const c = mask[i];
        if (!c) continue;
        mask[i] = 0;
        const a = c * a0;
        const p = i * 4;
        if (this.composite === 'destination-over') {
          const k = a * (1 - rgba[p + 3]);
          rgba[p] += colour[0] / 255 * k;
          rgba[p + 1] += colour[1] / 255 * k;
          rgba[p + 2] += colour[2] / 255 * k;
          rgba[p + 3] += k;
        } else {
          const keep = 1 - a;
          rgba[p] = rgba[p] * keep + colour[0] / 255 * a;
          rgba[p + 1] = rgba[p + 1] * keep + colour[1] / 255 * a;
          rgba[p + 2] = rgba[p + 2] * keep + colour[2] / 255 * a;
          rgba[p + 3] = rgba[p + 3] * keep + a;
        }
      }
    }
    this.box = null;
  }

  // Coverage of an axis-aligned rectangle, by area within each pixel.
  coverRect(x, y, w, h) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    const xa = Math.max(0, Math.floor(x)), xb = Math.min(this.width - 1, Math.ceil(x + w) - 1);
    const ya = Math.max(0, Math.floor(y)), yb = Math.min(this.height - 1, Math.ceil(y + h) - 1);
    for (let py = ya; py <= yb; ++py) {
      const cy = Math.min(py + 1, y + h) - Math.max(py, y);
      for (let px = xa; px <= xb; ++px) {
        const cx = Math.min(px + 1, x + w) - Math.max(px, x);
        this.cover(px, py, cx * cy);
      }
    }
  }

  fillRect(x, y, w, h, colour, alpha = 1) {
    this.begin();
    this.coverRect(x, y, w, h);
    this.paint(colour, alpha);
  }

  // Coverage of a segment drawn `lineWidth` wide with round ends.
  coverSegment(ax, ay, bx, by, lineWidth) {
    const half = lineWidth / 2;
    const dx = bx - ax, dy = by - ay;
    const length2 = dx * dx + dy * dy;
    const xa = Math.max(0, Math.floor(Math.min(ax, bx) - half - 1));
    const xb = Math.min(this.width - 1, Math.ceil(Math.max(ax, bx) + half + 1));
    const ya = Math.max(0, Math.floor(Math.min(ay, by) - half - 1));
    const yb = Math.min(this.height - 1, Math.ceil(Math.max(ay, by) + half + 1));
    // Thin lines spread their ink over a pixel, as a canvas's do.
    const ink = Math.min(1, lineWidth);
    const reach = Math.max(half, 0.5);
    for (let py = ya; py <= yb; ++py) {
      for (let px = xa; px <= xb; ++px) {
        const cx = px + 0.5 - ax, cy = py + 0.5 - ay;
        const t = length2 ? clamp01((cx * dx + cy * dy) / length2) : 0;
        const ex = cx - t * dx, ey = cy - t * dy;
        const d = Math.sqrt(ex * ex + ey * ey);
        this.cover(px, py, clamp01(reach + 0.5 - d) * ink);
      }
    }
  }

  // Strokes a polyline, [x0, y0, x1, y1, ...], as one path.
  strokePath(points, colour, alpha = 1, lineWidth = 1) {
    this.begin();
    for (let i = 0; i + 3 < points.length; i += 2)
      this.coverSegment(points[i], points[i + 1], points[i + 2], points[i + 3], lineWidth);
    this.paint(colour, alpha);
  }

  // The picture over black, as RGB bytes, top row first.
  toRGB() {
    const { rgba, out } = this;
    for (let i = 0, j = 0; j < out.length; i += 4, j += 3) {
      out[j] = Math.round(clamp01(rgba[i]) * 255);
      out[j + 1] = Math.round(clamp01(rgba[i + 1]) * 255);
      out[j + 2] = Math.round(clamp01(rgba[i + 2]) * 255);
    }
    return out;
  }
}

const STEP_SECONDS = 1 / 60;
const CATCH_UP_BUDGET_MS = 100;

// Steps a visualisation at the 60 frames a second its originals counted in,
// on the composer's clock, and gives up catching up after 100 ms.
//
// A visualisation has `audio(state, params)`, called once per composer frame
// as the original's audio event was, and `frame(params)`, its animation
// frame (requestAnimationFrame). `draw(params)` returns the picture.
export class Runner {
  constructor(visualisation) {
    this.visualisation = visualisation;
    this.lastTime = null;
    this.owed = 0;
  }

  renderFrame(state, params = {}) {
    const vz = this.visualisation;
    const seconds = state.auroraTime ?? state.time ?? 0;
    vz.audio?.(state, params);
    if (this.lastTime === null) {
      vz.frame?.(params);
    } else {
      this.owed += Math.min(1, Math.max(0, seconds - this.lastTime));
      const started = performance.now();
      while (this.owed >= STEP_SECONDS) {
        this.owed -= STEP_SECONDS;
        vz.frame?.(params);
        if (performance.now() - started > CATCH_UP_BUDGET_MS) {
          this.owed = 0;
          break;
        }
      }
    }
    this.lastTime = seconds;
    return vz.draw(params);
  }
}

export const STEP = STEP_SECONDS;
