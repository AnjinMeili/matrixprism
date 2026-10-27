// The picture for recordings and the live stream, lifted for screens (T67).
// The panel is close to linear in light and a screen is not, so the panel's
// levels look much darker in a video than on the panel (docs/findings.md,
// "The panel against the preview"). Each level v of the frame sent to the
// panel becomes 255 * (v / 255) ^ (1 / gamma) in the video; 2.2 makes a
// screen's light follow the panel's, and 1 sends the panel's levels. The
// panel and the preview are unchanged.

export const VIDEO_GAMMA_RANGE = [1, 3];
export const VIDEO_GAMMA_DEFAULT = 2.2;

export function videoGamma(value) {
  const number = Number(value);
  const [low, high] = VIDEO_GAMMA_RANGE;
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : VIDEO_GAMMA_DEFAULT;
}

// The 256 levels of the video for each level sent to the panel.
export function videoGammaTable(gamma) {
  const exponent = 1 / videoGamma(gamma);
  return Uint8Array.from({ length: 256 }, (_, v) => Math.round(255 * (v / 255) ** exponent));
}

// Fills RGBA `out` from the RGB rows of `rgb`, top row first, through `table`.
export function liftFrame(rgb, table, out) {
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    out[j] = table[rgb[i]];
    out[j + 1] = table[rgb[i + 1]];
    out[j + 2] = table[rgb[i + 2]];
    out[j + 3] = 255;
  }
  return out;
}

// A 2D canvas the recorders capture in place of the preview: each frame sent
// to the panel, drawn through the table.
export class VideoCanvas {
  constructor(canvas = document.createElement('canvas')) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.gamma = null;
    this.table = null;
    this.image = null;
  }

  resize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (!this.image || this.image.width !== width || this.image.height !== height)
      this.image = this.context.createImageData(width, height);
  }

  draw(rgb, width, height, gamma) {
    if (rgb.length !== width * height * 3) return;
    this.resize(width, height);
    if (gamma !== this.gamma) {
      this.gamma = gamma;
      this.table = videoGammaTable(gamma);
    }
    liftFrame(rgb, this.table, this.image.data);
    this.context.putImageData(this.image, 0, 0);
  }
}
