// AuroraDrop's audio patterns, ported from its PatternAudio_* files, which
// carry the Aurora MIT notice (Copyright (c) 2014 Jason Coon); see
// ./NOTICE.md. Each draws additively on the shared canvas from the audio
// data; trails come from the processing effect that runs before it.
import { SIZE } from './runtime.js';

const coin = (canvas) => canvas.random8(0, 2) !== 0;

// O: 32 bars on the left half, centred vertically, optionally mirrored.
export class Spectrum2 {
  static title = 'Spectrum 2';

  start(canvas) {
    this.vertical = coin(canvas);
    this.mirror = coin(canvas);
    this.mirrorDim = coin(canvas) ? canvas.random8(64, 128) : 255;
    this.dimAmount = canvas.random8(0, 10);
    this.useCurrentPalette = coin(canvas);
    this.colorSpread = canvas.random8(1, 5);
  }

  draw(canvas, audio) {
    canvas.DimAll(250 - this.dimAmount * 10);
    for (let i = 0; i < SIZE / 2; ++i) {
      const data = Math.trunc(audio.specData32[i] / 3);
      if (!data) continue;
      let y1 = SIZE - 1, y2 = SIZE - data;
      const space = 64 - (y1 - y2);
      y1 -= space >> 1;
      y2 -= space >> 1;
      const index = this.useCurrentPalette ? i * this.colorSpread : 16;
      canvas.BresenhamLine(i, y1, i, y2, index, 255);
      if (this.mirror) canvas.BresenhamLine(SIZE - i - 1, y1, SIZE - i - 1, y2, index, this.mirrorDim);
    }
  }
}

// Colours that either stay put or cycle together.
class CyclingColours {
  start(canvas) {
    this.cycleColors = coin(canvas);
    this.caleidoscopeMode = canvas.random8(0, this.modes);
    this.colors = [0, 64, 128, 192];
  }

  advance() {
    this.colors = this.cycleColors ? this.colors.map(value => (value + 1) & 255) : [0, 64, 128, 192];
  }
}

// L: three line segments whose end points are audio levels.
export class Lines extends CyclingColours {
  static title = 'Lines';
  modes = 2;

  draw(canvas, audio) {
    this.advance();
    const at = (bin) => Math.trunc(audio.specData[bin] / 3);
    [[5, 10, 15, 20], [25, 30, 35, 40], [45, 50, 55, 60]].forEach(([x1, y1, x2, y2], n) => {
      canvas.BresenhamLine(at(x1), at(y1), at(x2), at(y2), canvas.ColorFromCurrentPalette(this.colors[n], 255));
    });
  }
}

// T: two triangles whose corners are audio levels, with a kaleidoscope.
export class Triangles extends CyclingColours {
  static title = 'Triangles';
  modes = 2;

  draw(canvas, audio) {
    this.advance();
    const at = (bin) => Math.trunc(audio.specData[bin] / 3);
    [[0, 20, 40, 60, 80, 90], [5, 25, 45, 65, 85, 95]].forEach((bins, n) => {
      const [x1, y1, x2, y2, x3, y3] = bins.map(at);
      const colour = canvas.ColorFromCurrentPalette(this.colors[n], 200);
      canvas.BresenhamLine(x1, y1, x2, y2, colour);
      canvas.BresenhamLine(x2, y2, x3, y3, colour);
      canvas.BresenhamLine(x3, y3, x1, y1, colour);
    });
    if (this.caleidoscopeMode === 0) canvas.Caleidoscope1();
    else canvas.Caleidoscope2();
    canvas.DimAll(250);
  }
}

// P: the spectrum laid along a diagonal, each bin a short crossing line,
// drawn into a spiral stream.
export class DiagonalSpectrum {
  static title = 'Diagonal Spectrum';

  start(canvas) {
    this.caleidoscopeMode = canvas.random8(0, 3);
    this.mirrorMode = canvas.random8(0, 3);
  }

  draw(canvas, audio) {
    const leading = this.mirrorMode === 0 || this.mirrorMode === 2;
    for (let i = 0; i < SIZE; ++i) {
      const height = Math.trunc(audio.specData[i] / (512 / SIZE));
      if (height <= 0) continue;
      if (leading) {
        canvas.BresenhamLine(i + height, i - height, i - height, i + height, 16, 255);
        const half = height >> 1;
        canvas.BresenhamLine(i + half, i - half, i - half, i + half, 16, 255);
      } else {
        const x = SIZE - i;
        canvas.BresenhamLine(x - height, i - height, x + height, i + height, 16, 255);
      }
    }
    if (this.caleidoscopeMode === 1) canvas.Caleidoscope1();
    else if (this.caleidoscopeMode === 2) canvas.Caleidoscope2();
    canvas.DimAll(230);
    canvas.SpiralStream(31, 31, 64, 128);
  }
}

// N: sixteen short bars, or a half-size copy fed through a kaleidoscope.
export class SpectrumPeakBars {
  static title = 'Spectrum Peak Bars';

  start(canvas) {
    this.flipVert = coin(canvas);
    this.caleido = canvas.random8(0, 3) !== 0;
    this.caleidoscopeEffect = canvas.random8(1, 10);
    // AuroraDrop keeps this slant in a boolean, so it is 0 or 1 pixel.
    this.diagonalOffset = canvas.random8(0, 10) !== 0 ? 0 : 1;
  }

  draw(canvas, audio) {
    canvas.DimAll(250);
    const half = this.caleido;
    const step = half ? 2 : 4, limit = half ? 31 : 63, offset = half ? 0 : this.diagonalOffset;
    for (let i = 0; i < (half ? 32 : 64); i += step) {
      const data = Math.min(limit, Math.trunc(audio.specData16[i / step] / (half ? 6 : 3)));
      if (!data) continue;
      const y1 = this.flipVert ? data : SIZE - data - (half ? 32 : 0);
      canvas.BresenhamLine(i, y1, i + 4, this.flipVert ? y1 + offset : y1 - offset, 16, 255);
    }
    if (half) canvas.RandomCaleidoscope(this.caleidoscopeEffect);
  }
}

// C: one dot per bin, mirrored about a centre line, slowly rolling sideways.
export class DotsSingle {
  static title = 'Dots Single';

  start(canvas) {
    this.dimVal = 255;
    this.dimEnd = canvas.random8(128, 218);
    this.caleido = canvas.random8(0, 3) !== 0;
    this.caleidoEffect = canvas.random8(1, 3);
    this.vertical = coin(canvas);
    this.upwards = coin(canvas);
    this.useCurrentPalette = canvas.random8(0, 6) !== 0;
    this.colorSpread = canvas.random8(2, 5);
    this.audioScale = canvas.random8(6, 11);
    this.hueCycle = canvas.random8(0, 5) !== 0;
    this.hue = canvas.random8(0, 255);
    this.rolling = 0;
    this.rolledAt = canvas.ms;
    this.hueAt = canvas.ms;
  }

  draw(canvas, audio) {
    canvas.DimAll(this.dimVal);
    if (this.dimVal > this.dimEnd) this.dimVal--;
    for (let i = 0; i < SIZE && !audio.noAudio; ++i) {
      const y0 = Math.min(SIZE / 2 - 1, Math.trunc(audio.specData[i] / this.audioScale));
      let x0 = i + this.rolling;
      if (x0 > SIZE) x0 -= SIZE;
      // Without a palette AuroraDrop uses a fixed green-to-blue code per column.
      const code = 32768 | ((i & 0xfc) << 3) | 16;
      const colour = this.useCurrentPalette ? canvas.ColorFromCurrentPalette(i * this.colorSpread + this.hue) :
        [(code >> 16) & 255, (code >> 8) & 255, code & 255];
      if (this.vertical) {
        const y = this.upwards ? x0 : SIZE - x0;
        canvas.setPixel(y0, y, colour);
        canvas.setPixel(SIZE - y0, y, colour);
      } else if (this.upwards) {
        canvas.setPixel(x0, SIZE / 2 - y0, colour);
        canvas.setPixel(x0, SIZE / 2 + y0, colour);
      } else {
        canvas.setPixel(x0, y0, colour);
        canvas.setPixel(x0, SIZE - y0, colour);
      }
    }
    if (this.caleido) canvas.RandomCaleidoscope(this.caleidoEffect);
    if (this.rolledAt + 100 < canvas.ms) {
      this.rolling = (this.rolling + 1) % SIZE;
      this.rolledAt = canvas.ms;
    }
    if (this.hueCycle && this.hueAt + 50 < canvas.ms) {
      this.hue = (this.hue + 1) & 255;
      this.hueAt = canvas.ms;
    }
  }
}

// A: the spectrum as two joined-up waves, top and bottom, slowly rotating.
export class RotatingWave {
  static title = 'Rotating Wave';
  angle = 0;

  start(canvas) {
    this.rotate = coin(canvas);
    this.direction = coin(canvas) ? -0.01 : 0.01;
    this.audioScale = canvas.random8(3, 6);
    this.caleidoscope = canvas.random8(0, 5) !== 0;
    this.caleidoscopeEffect = canvas.random8(1, 10);
    this.dimVal = 255;
    this.dimEnd = canvas.random8(0, 180);
  }

  draw(canvas, audio) {
    canvas.DimAll(this.dimVal);
    if (this.dimVal > this.dimEnd) this.dimVal--;
    if (!audio.noAudio) {
      const segment = (x1, y1, x2, y2, i) => {
        const a = canvas.RotatePoint(31, 31, this.angle, x1, y1), b = canvas.RotatePoint(31, 31, this.angle, x2, y2);
        canvas.BresenhamLine(a[0], a[1], b[0], b[1], canvas.ColorFromCurrentPalette(i * 3));
      };
      const level = (bin, scale) => Math.trunc(audio.specData[bin] / scale);
      for (let i = 0; i < SIZE - 1 + 16; ++i) {
        const x = SIZE + 16 - i - 8;
        segment(x, level(i, this.audioScale), x - 1, level(i + 1, this.audioScale), i);
      }
      for (let i = 0; i < SIZE - 1 + 16; ++i)
        segment(i - 8, SIZE - level(i, 3), i - 7, SIZE - level(i + 1, 3), i);
    }
    if (this.caleidoscope) canvas.RandomCaleidoscope(this.caleidoscopeEffect);
    if (this.rotate) {
      this.angle += this.direction;
      if (this.angle >= 3.14 * 2) this.angle = 0;
    }
  }
}

// Z: a zig-zag through the 32-bin spectrum about the centre line.
export class WaveSingle {
  static title = 'Wave Single';

  draw(canvas, audio) {
    canvas.DimAll(100);
    if (audio.noAudio) return;
    const level = (bin) => Math.min(SIZE - 10, Math.trunc(audio.specData32[bin] / 6));
    let invert = -1, x1 = 0, y1 = SIZE / 2;
    for (let i = 0; i < SIZE - 4; i += 2) {
      const y0 = -level(i / 2) * invert + SIZE / 2;
      x1 = i + 4;
      y1 = level(i / 2 + 1) * invert + SIZE / 2;
      canvas.BresenhamLine(i, y0, x1, y1, 16);
      invert = -invert;
    }
    canvas.BresenhamLine(x1, y1, SIZE, SIZE / 2, 16);
  }
}

// `inShow` marks the patterns AuroraDrop has enabled for its own playlist.
export const AUDIO_PATTERNS = [
  { id: 'spectrum-2', Pattern: Spectrum2, inShow: true, description: 'Centred spectrum bars, sometimes mirrored' },
  { id: 'lines', Pattern: Lines, inShow: true, description: 'Three lines whose ends follow audio levels' },
  { id: 'triangles', Pattern: Triangles, inShow: true, description: 'Two audio-driven triangles in a kaleidoscope' },
  { id: 'diagonal-spectrum', Pattern: DiagonalSpectrum, inShow: false, description: 'The spectrum along a diagonal, drawn into a spiral stream' },
  { id: 'rotating-wave', Pattern: RotatingWave, inShow: true, description: 'Two spectrum waves that slowly rotate, usually in a kaleidoscope' },
  { id: 'dots-single', Pattern: DotsSingle, inShow: true, description: 'A mirrored row of dots, one per bin, rolling sideways' },
  { id: 'spectrum-peak-bars', Pattern: SpectrumPeakBars, inShow: true, description: 'Sixteen short bars, often through a kaleidoscope' },
  { id: 'wave-single', Pattern: WaveSingle, inShow: false, description: 'A zig-zag through the spectrum about the centre line' },
];
