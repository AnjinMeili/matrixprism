// Native-panel adaptations of fibonacci128-touch-aurora, aurora branch
// 5f8dd395f5a8f62d169463d125ee5b102b526611. GPL-3.0.
// Original Aurora: Jason Coon / Stefan Petrick. Sublime fire:
// Intrinsically-Sublime, adapted by Marc MERLIN and Fibonacci128 contributors.
// Source and licensing details: ./licenses/fibonacci.txt.
import { AuroraAnimation } from './aurora-patterns.js';
import { byte, sin8, beatsin8, inoise8 } from './aurora-fastled.js';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const ARM_PAIRS = [[5, 8], [8, 13], [3, 5], [5, 13], [3, 8], [8, 21]];

function hsv(hue, saturation, brightness) {
  const h = byte(hue) / 256 * 6;
  const s = saturation / 255, v = brightness;
  const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
  const sector = Math.floor(h);
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
  return rgb.map(value => Math.round(value + m));
}

class Fibonacci extends AuroraAnimation {
  constructor(random, width, height) {
    super(1000 / 60, random, width, height);
    this.originalColour = (hue, brightness = 255) => hsv(hue, 255, brightness);
    const radius = Math.max(0, Math.min(width, height) / 2 - this.dotRadius - 1);
    const capacity = Math.max(1, Math.floor(Math.PI * radius * radius));
    this.points = Array.from({ length: Math.min(capacity, Math.max(128, Math.min(2048, Math.round(width * height / 64)))) },
      (_, index) => ({ index, angle: index * GOLDEN_ANGLE }));
    for (const point of this.points) {
      point.radius = Math.sqrt(point.index / Math.max(1, this.points.length - 1));
      point.x = (width - 1) / 2 + Math.cos(point.angle) * point.radius * radius;
      point.y = (height - 1) / 2 + Math.sin(point.angle) * point.radius * radius;
    }
  }

  dot(point, hue, brightness, saturation = 255) {
    const color = this.paletteState.colour(hue, brightness, index => hsv(index, saturation, 255));
    this.buffer.dot(point.x, point.y, color, this.dotSize === null ? this.dotRadius : this.dotSize / 2, true);
  }
}

class Bloom extends Fibonacci {
  draw(ms) {
    this.buffer.dim(225);
    const [arms1, arms2] = ARM_PAIRS[Math.floor(ms / 8000) % ARM_PAIRS.length];
    for (const point of this.points) {
      const position = point.index / this.points.length * 256;
      const phase1 = point.index % arms1 * 256 / arms1;
      const phase2 = point.index % arms2 * 256 / arms2;
      const wave1 = sin8(position * 3 - ms / 11 + phase1);
      const wave2 = sin8(position * 2 + ms / 17 + phase2);
      if (wave1 > 140) this.dot(point, phase1 + ms / 37 + position / 4,
        Math.min(255, (wave1 - 140) * 2 + 25), 240);
      if (wave2 > 150) this.dot(point, phase2 - ms / 37 + 128 + position / 8,
        Math.min(255, (wave2 - 150) * 2 + 20), 220);
      if (point.radius < 80 / 255)
        this.dot(point, ms / 37 * 2 + 64,
          (80 - point.radius * 255) * beatsin8(6, 60, 255, ms) / 255 * 4 / 256, 200);
    }
  }
}

class Chase extends Fibonacci {
  draw(ms) {
    this.buffer.dim(215);
    const arms = [5, 8, 13, 3][Math.floor(ms / 12000) % 4];
    const length = Math.max(1, Math.ceil(this.points.length / arms));
    for (const point of this.points) {
      const arm = point.index % arms;
      const phase = ms * 20 * Math.PI / 30000 + arm * Math.PI * 2 / arms;
      const dot = (1 + Math.sin(phase)) / 2 * (length - 1);
      const distance = Math.abs(Math.floor(point.index / arms) - dot);
      const width = Math.max(1, this.points.length / 128 * 5);
      if (distance < width)
        this.dot(point, ms / 20 + arm * 256 / arms + Math.floor(point.index / arms) * 4,
          Math.max(0, 255 * (1 - distance / width)));
    }
  }
}

class Mandala extends AuroraAnimation {
  constructor(random, width, height) {
    super(1000 / 60, random, width, height);
    this.x = random() * 65536;
    this.y = random() * 65536;
    this.z = random() * 65536;
    this.angle = 0;
    this.phase = random() * Math.PI * 2;
    this.values = new Float32Array(width * height).fill(128);
    this.randomize();
  }

  randomize() {
    this.dx = (this.random() - 0.5) * 2;
    this.dy = (this.random() - 0.5) * 2;
    this.dz = (this.random() - 0.5) * 2;
    this.scaleXNoise = 8 + this.random() * 40;
    this.scaleYNoise = 8 + this.random() * 40;
    this.rotationSpeed = 0.003 + this.random() * 0.015;
  }

  draw(ms) {
    if (this.every('drift', 5000, ms)) this.randomize();
    this.x += this.dx;
    this.y += this.dy;
    this.z += this.dz;
    this.phase += this.rotationSpeed;
    this.angle += Math.sin(this.phase) * 0.012;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const scale = 32 / Math.max(1, Math.min(this.width, this.height));
    const colours = this.colourTable(i => this.colour(i, i));
    for (let y = 0; y < this.height; ++y) {
      for (let x = 0; x < this.width; ++x) {
        const px = (x - (this.width - 1) / 2) * scale;
        const py = (y - (this.height - 1) / 2) * scale;
        const ax = Math.abs(px * c - py * s), ay = Math.abs(px * s + py * c);
        const index = y * this.width + x;
        const value = inoise8(this.x + Math.min(ax, ay) * this.scaleXNoise,
          this.y + Math.max(ax, ay) * this.scaleYNoise, this.z);
        this.values[index] = this.values[index] * 200 / 256 + value * 56 / 256;
        const intensity = this.values[index];
        this.buffer.pixel(x, y, colours[byte(intensity)]);
      }
    }
  }
}

const BLACK = [0, 0, 0];

function heatColour(index) {
  const t = byte(index) / 255 * 3;
  return [Math.min(1, t), Math.max(0, Math.min(1, t - 1)), Math.max(0, t - 2)]
    .map(value => Math.round(value * 255));
}

class RadialFire extends AuroraAnimation {
  constructor(random, width, height) {
    super(1000 / 60, random, width, height);
    this.heat = new Uint8Array(32);
    this.originalColour = heatColour;
    // Per-pixel polar geometry depends only on the panel size.
    const radius = Math.max(1, Math.min(width, height) / 2);
    this.radii = new Float64Array(width * height);
    this.angles = new Float64Array(width * height);
    for (let y = 0; y < height; ++y) {
      for (let x = 0; x < width; ++x) {
        const px = x - (width - 1) / 2, py = y - (height - 1) / 2;
        this.radii[y * width + x] = Math.hypot(px, py) / radius;
        this.angles[y * width + x] = (Math.atan2(py, px) / (Math.PI * 2) + 0.5) * 255;
      }
    }
  }

  draw(ms) {
    for (let i = 0; i < this.heat.length; ++i)
      this.heat[i] = Math.max(0, this.heat[i] - Math.floor(this.random() * 19));
    for (let i = 31; i > 1; --i)
      this.heat[i] = (this.heat[i - 1] + this.heat[i - 2] * 2) / 3;
    if (this.random() * 256 < 120) {
      const band = Math.floor(this.random() * 3);
      this.heat[band] = Math.min(255, this.heat[band] + 160 + Math.floor(this.random() * 95));
    }
    const colours = this.colourTable(i => this.paletteState.colour(i, 255, heatColour));
    for (let y = 0; y < this.height; ++y) {
      for (let x = 0; x < this.width; ++x) {
        const r = this.radii[y * this.width + x];
        if (r > 1) {
          this.buffer.pixel(x, y, BLACK);
          continue;
        }
        const band = (1 - r) * 31;
        const low = Math.floor(band), fraction = band - low;
        const heat = this.heat[low] * (1 - fraction) + this.heat[Math.min(31, low + 1)] * fraction;
        const angle = this.angles[y * this.width + x];
        const h = Math.max(0, heat - (inoise8(angle * 4, r * 510, ms / 3) >> 2));
        this.buffer.pixel(x, y, colours[byte(h)]);
      }
    }
  }
}

export const FIBONACCI_PATTERNS = [
  ['fibonacci-bloom', 'Fibonacci Bloom', Bloom, 'Overlapping Fibonacci arm pulses with a breathing centre'],
  ['fibonacci-chase', 'Fibonacci Chase', Chase, 'Staggered pulses chase along golden-angle spiral arms'],
  ['electric-mandala', 'Electric Mandala', Mandala, 'Mirrored drifting noise with smoothly reversing rotation'],
  ['radial-fire', 'Radial Fire', RadialFire, 'Stateful heat rises from the perimeter towards the centre'],
].map(([id, name, Pattern, description]) => ({
  id, name, audio: `${description} (native Fibonacci128 adaptation; no audio modulation)`,
  controls: ['aurora'],
  createInstance: (width = 32, height = 32, random = Math.random) => new Pattern(random, width, height),
}));
