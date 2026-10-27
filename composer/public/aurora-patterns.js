// Aurora's top-level playlist at a98cb3e965433a8eebb8893d630735fda12469cb,
// translated from C++ to stateful JavaScript. See ./licenses/aurora.txt.
// Copyright (c) 2014 Jason Coon, Daniel Shiffman, Noel Bundy,
// Stefan Petrick, and (c) 2008 Windell H Oskay. MIT licensed.
// Bounce's settings and its response to audio are added here (T54).
import { VARIATION_PARAM } from './seed.js';
import {
  AURORA_SIZE, AuroraBuffer, byte, sin8, cos8, mapsin8, mapcos8,
  beatsin8, beatcos8, quadwave8, palette, inoise8,
} from './aurora-fastled.js';
import { PatternPalette } from './palettes.js';

const SIZE = AURORA_SIZE;
const CENTER = SIZE / 2;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
// Wall-clock allowance for catching up simulation steps in one render call.
const CATCH_UP_BUDGET_MS = 100;

function limit(x, y, maximum) {
  const length = Math.hypot(x, y);
  const scale = length > maximum ? maximum / length : 1;
  return [x * scale, y * scale];
}

function normalized(x, y, magnitude = 1) {
  const length = Math.hypot(x, y);
  return length ? [x / length * magnitude, y / length * magnitude] : [0, 0];
}

class Boid {
  constructor(x, y, random) {
    this.x = x;
    this.y = y;
    this.vx = Math.floor(random() * 255) / 255 - 0.5;
    this.vy = Math.floor(random() * 255) / 255 - 0.5;
    this.ax = 0;
    this.ay = 0;
    this.maxspeed = 1.5;
    this.maxforce = 0.05;
    this.separation = 4;
    this.neighbors = 8;
    this.color = 0;
  }

  update() {
    [this.vx, this.vy] = limit(this.vx + this.ax, this.vy + this.ay, this.maxspeed);
    this.x += this.vx;
    this.y += this.vy;
    this.ax = 0;
    this.ay = 0;
  }

  steer(x, y) {
    const [dx, dy] = normalized(x, y, this.maxspeed);
    return limit(dx - this.vx, dy - this.vy, this.maxforce);
  }

  flock(boids) {
    let sx = 0, sy = 0, vx = 0, vy = 0, px = 0, py = 0;
    let close = 0, neighbors = 0;
    for (const other of boids) {
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < this.separation) {
        sx += dx / (distance * distance);
        sy += dy / (distance * distance);
        close++;
      }
      if (distance > 0 && distance < this.neighbors) {
        vx += other.vx;
        vy += other.vy;
        px += other.x;
        py += other.y;
        neighbors++;
      }
    }
    if (close && (sx !== 0 || sy !== 0)) {
      const [x, y] = this.steer(sx / close, sy / close);
      this.ax += x * 1.5;
      this.ay += y * 1.5;
    }
    if (neighbors) {
      const alignment = this.steer(vx / neighbors, vy / neighbors);
      const cohesion = this.steer(px / neighbors - this.x, py / neighbors - this.y);
      this.ax += alignment[0] + cohesion[0];
      this.ay += alignment[1] + cohesion[1];
    }
    this.update();
  }

  wrap() {
    if (this.x < 0) this.x = SIZE - 1;
    if (this.y < 0) this.y = SIZE - 1;
    if (this.x >= SIZE) this.x = 0;
    if (this.y >= SIZE) this.y = 0;
  }
}

export class AuroraAnimation {
  constructor(interval = 1000 / 60, random = Math.random, width = SIZE, height = SIZE) {
    this.buffer = new AuroraBuffer(width, height);
    this.width = width;
    this.height = height;
    this.scaleX = (width - 1) / (SIZE - 1);
    this.scaleY = (height - 1) / (SIZE - 1);
    this.native = width !== SIZE || height !== SIZE;
    this.dotRadius = Math.max(0.5, Math.min(this.scaleX, this.scaleY) * 0.4);
    this.dotSize = null;
    this.paletteState = new PatternPalette();
    this.originalColour = palette;
    this.interval = interval;
    this.random = random;
    this.lastTime = null;
    this.elapsed = 0;
    this.nextFrame = interval;
    this.frames = 0;
    this.timers = new Map();
  }

  setDotSize(diameter = null) {
    if (diameter !== null && (!Number.isFinite(diameter) || diameter < 1 || diameter > 32))
      throw new Error('Aurora dot diameter must be from 1 to 32 pixels');
    this.dotSize = diameter;
  }

  setPalette(id = 'original') {
    this.paletteState.set(id, this.originalColour);
  }

  colour(index, brightness = 255) {
    if (this.paletteState.id === 'original' && this.paletteState.mix === 1)
      return this.originalColour(index, brightness);
    return this.paletteState.colour(index, brightness, this.originalColour);
  }

  // A 256-entry lookup for full-field patterns, rebuilt only while a palette
  // change is still blending or after the palette changes.
  colourTable(build) {
    const state = this.paletteState;
    if (state.mix !== 1 || this.tableId !== state.id) {
      this.table = Array.from({ length: 256 }, (_, i) => build(i));
      this.tableId = state.mix === 1 ? state.id : null;
    }
    return this.table;
  }

  nativeLine(x0, y0, x1, y1, color, add = false, automaticRadius = 0.5) {
    this.buffer.line(x0, y0, x1, y1, color, add, this.dotSize === null ? automaticRadius : this.dotSize / 2);
  }

  point(x, y, color, add = false) {
    if (this.native || this.dotSize !== null)
      this.buffer.dot(x * this.scaleX, y * this.scaleY, color, this.dotSize === null ? this.dotRadius : this.dotSize / 2, add);
    else
      this.buffer.pixel(x, y, color, add);
  }

  trace(x0, y0, x1, y1, color) {
    if ((!this.native && this.dotSize === null) || Math.abs(x1 - x0) > SIZE / 2 || Math.abs(y1 - y0) > SIZE / 2)
      this.point(x1, y1, color);
    else
      this.nativeLine(x0 * this.scaleX, y0 * this.scaleY, x1 * this.scaleX,
        y1 * this.scaleY, color, false, this.dotRadius);
  }

  line(x0, y0, x1, y1, color, add = false) {
    this.nativeLine(x0 * this.scaleX, y0 * this.scaleY, x1 * this.scaleX,
      y1 * this.scaleY, color, add, this.native ? Math.max(0.5, this.dotRadius * 0.5) : 0);
  }

  blur(amount) {
    this.buffer.blur(amount, Math.max(1, Math.round(this.scaleX)), Math.max(1, Math.round(this.scaleY)));
  }

  spiral(x, y, radius, dim) {
    if (this.native)
      this.buffer.spiralStreamScaled(x * this.scaleX, y * this.scaleY, radius * this.scaleX,
        radius * this.scaleY, dim, Math.max(1, this.scaleX), Math.max(1, this.scaleY));
    else
      this.buffer.spiralStream(x, y, radius, dim);
  }

  sinPosition(theta, low, high) {
    return this.native ? low + (high - low) * (1 + Math.sin(theta * Math.PI / 128)) / 2 :
      mapsin8(theta, low, high);
  }

  cosPosition(theta, low, high) {
    return this.native ? low + (high - low) * (1 + Math.cos(theta * Math.PI / 128)) / 2 :
      mapcos8(theta, low, high);
  }

  beatPosition(bpm, low, high, ms, cosine = false) {
    if (!this.native)
      return cosine ? beatcos8(bpm, low, high, ms) : beatsin8(bpm, low, high, ms);
    const phase = bpm * ms * Math.PI / 30000;
    return low + (high - low) * (1 + (cosine ? Math.cos(phase) : Math.sin(phase))) / 2;
  }

  every(name, milliseconds, now) {
    const last = this.timers.get(name) || 0;
    if (now - last + 1e-7 < milliseconds)
      return false;
    this.timers.set(name, now);
    return true;
  }

  // The renderer's single entry point for stateful patterns: apply the
  // controls this pattern understands, then advance to the frame's time.
  renderFrame(state) {
    this.setDotSize(state.auroraDotSize ?? null);
    this.setPalette(state.paletteId);
    return this.render(state.auroraTime ?? state.time);
  }

  render(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 ||
        (this.lastTime !== null && seconds < this.lastTime))
      throw new Error('Aurora animation time must be finite, nonnegative, and monotonic');
    if (this.lastTime === null) {
      this.draw(0);
      this.frames++;
    } else {
      // Like the composer clock, freeze across long interruptions, not a burst
      // of minutes of physics updates when a discarded/suspended page resumes.
      this.elapsed += Math.min(1000, (seconds - this.lastTime) * 1000);
      const started = performance.now();
      while (this.nextFrame <= this.elapsed + 1e-7) {
        this.paletteState.advance(this.interval / 1000);
        this.draw(this.nextFrame);
        this.frames++;
        this.nextFrame += this.interval;
        // When a step costs more than its interval the debt only grows, so
        // slow the animation down rather than stalling every later frame.
        if (performance.now() - started > CATCH_UP_BUDGET_MS) {
          this.elapsed = Math.min(this.elapsed, this.nextFrame - this.interval);
          break;
        }
      }
    }
    this.lastTime = seconds;
    return this.buffer.rgb;
  }

  draw() {
    throw new Error('Aurora pattern has no draw implementation');
  }
}

class Attract extends AuroraAnimation {
  constructor(random, width, height) {
    super(15, random, width, height);
    const count = Math.max(1, Math.floor(this.height / 3));
    const direction = Math.floor(random() * 2) === 0 ? -1 : 1;
    this.boids = Array.from({ length: count }, (_, i) => {
      const boid = new Boid(CENTER - 1, SIZE - 1 - i / (this.scaleY || 1), random);
      boid.vx = (20 + Math.floor(random() * 60)) / 100 * direction;
      boid.vy = 0;
      boid.color = i * (this.native ? 240 / count : Math.floor(240 / count));
      return boid;
    });
  }

  draw(ms) {
    this.buffer.dim(beatsin8(2, 170, 250, ms));
    for (const boid of this.boids) {
      const dx = CENTER - 1 - boid.x;
      const dy = CENTER - 1 - boid.y;
      const distance = clamp(Math.hypot(dx, dy), 5, 32);
      const [fx, fy] = normalized(dx, dy, 5 / (distance * distance));
      boid.ax += fx;
      boid.ay += fy;
      const oldX = boid.x, oldY = boid.y;
      boid.update();
      this.trace(oldX, oldY, boid.x, boid.y, this.colour(boid.color));
    }
  }
}

// Bounce's own settings, an addition to the original. Upstream, nothing puts
// energy back, so every ball settles on the floor within a few minutes.
export const BOUNCE_PARAMS = [
  { id: 'kicks', name: 'Kicks from', type: 'choice', default: 'spectrum',
    choices: [{ id: 'spectrum', name: 'Spectrum' }, { id: 'beat', name: 'Beat' }],
    help: 'Spectrum: each ball follows its own part of the spectrum, bass on the left, treble on the right. ' +
      'Beat: every ball is kicked on each beat, harder with more bass' },
  { id: 'music', name: 'Music', min: 0, max: 1, step: 0.05, default: 0.75,
    help: 'How high the music kicks the balls; at 0 they bounce and settle as in the original' },
  { id: 'gravity', name: 'Gravity', min: 0.5, max: 4, step: 0.1, default: 1,
    help: 'How fast the balls fall; 1 is the original. Higher makes quicker bounces that keep up with the music' },
  { id: 'spread', name: 'Spread', min: 0, max: 1, step: 0.05, default: 0.3,
    help: 'Beat only: how much the kicks differ from ball to ball, so they do not rise in step' },
  { id: 'keepAlive', name: 'Keep bouncing', type: 'bool', default: true,
    help: 'Relaunch a ball that has lain on the floor for a few seconds, so the pattern never goes still' },
];
const BOUNCE_DEFAULTS = Object.fromEntries(BOUNCE_PARAMS.map((param) => [param.id, param.default]));
// The original's gravity, per 15 ms step, at Gravity 1.
const GRAVITY = 0.0125;
const FLOOR = SIZE - 1;
// A ball whose next peak is lower than this is lying on the floor.
const RESTING = 0.5;

class Bounce extends AuroraAnimation {
  constructor(random, width, height) {
    super(15, random, width, height);
    this.boids = Array.from({ length: this.width }, (_, i) => {
      const x = this.width > 1 ? i / this.scaleX : 0;
      const boid = new Boid(x, SIZE / 8, random);
      boid.vx = 0;
      boid.vy = x * -0.01;
      boid.color = i * 256 / this.width;
      boid.maxforce = 10;
      boid.maxspeed = 10;
      return boid;
    });
    this.params = BOUNCE_DEFAULTS;
    this.audio = {};
    this.spectrum = null;
    this.kick = false;
    this.lastBeat = 0;
    // Each ball's recent level in its part of the spectrum, falling slowly.
    this.levels = new Float32Array(this.boids.length);
    this.resting = new Float32Array(this.boids.length);
    this.waits = Float32Array.from(this.boids, () => this.restWait());
  }

  renderFrame(state, params = {}) {
    this.params = { ...BOUNCE_DEFAULTS, ...params };
    this.audio = state.audio ?? {};
    this.spectrum = state.spectrum ?? null;
    // A beat kicks the balls as it arrives.
    const beat = this.audio.beat ?? 0;
    if (beat > 0.8 && this.lastBeat <= 0.8) this.kick = true;
    this.lastBeat = beat;
    return super.renderFrame(state);
  }

  restWait() {
    return 2000 + this.random() * 4000;
  }

  // Ball i's part of the spectrum, 0 to 1: bass on the left.
  band(i) {
    const s = this.spectrum, n = this.boids.length;
    const from = Math.floor(i * s.length / n);
    const to = Math.max(from + 1, Math.floor((i + 1) * s.length / n));
    let peak = 0;
    for (let b = from; b < to; ++b) peak = Math.max(peak, s[b]);
    return peak / 255;
  }

  // How high above the floor a ball will rise before it falls.
  peak(boid, gravity) {
    return FLOOR - boid.y + (boid.vy < 0 ? boid.vy * boid.vy / (2 * gravity) : 0);
  }

  // Sends a ball up to `height` above the floor, unless it is going higher.
  lift(boid, height, gravity) {
    if (height > this.peak(boid, gravity))
      boid.vy = -Math.sqrt(2 * gravity * (height - (FLOOR - boid.y)));
  }

  draw() {
    const { kicks, music, spread, keepAlive } = this.params;
    const gravity = GRAVITY * this.params.gravity;
    const kick = this.kick;
    this.kick = false;
    this.buffer.dim(170);
    this.boids.forEach((boid, i) => {
      let landed = false;
      boid.ay += gravity;
      const oldY = boid.y;
      boid.update();
      const color = this.colour(boid.color);
      if (this.native)
        this.trace(boid.x, oldY, boid.x, boid.y, color);
      else {
        for (let y = Math.min(oldY, boid.y); y < Math.max(oldY, boid.y); y++)
          this.point(boid.x, y, color);
        this.point(boid.x, boid.y, color);
      }
      if (boid.y >= FLOOR) {
        boid.y = FLOOR;
        boid.vy *= -1;
        landed = true;
      }
      if (music > 0 && kicks === 'spectrum' && this.spectrum) {
        // Each landing goes back up to the ball's recent level. A level that
        // jumps also catches a ball on its way down, if it has fallen below
        // half the new height, but never one near its top, or the ball would
        // hang in the air on every beat.
        const level = this.band(i);
        const jump = level > this.levels[i] + 0.1;
        this.levels[i] = Math.max(level, this.levels[i] - 0.02);
        const height = music * this.levels[i] * FLOOR;
        if (landed || (jump && boid.vy > 0 && FLOOR - boid.y < height / 2)) this.lift(boid, height, gravity);
      } else if (music > 0 && kicks === 'beat' && kick) {
        const bass = this.audio.bass ?? 0;
        this.lift(boid, music * (0.4 + 0.6 * bass) * (1 - spread * this.random()) * FLOOR, gravity);
      }
      if (!keepAlive) return;
      this.resting[i] = this.peak(boid, gravity) < RESTING ? this.resting[i] + this.interval : 0;
      if (this.resting[i] > this.waits[i]) {
        this.lift(boid, (0.5 + 0.5 * this.random()) * FLOOR, gravity);
        this.resting[i] = 0;
        this.waits[i] = this.restWait();
      }
    });
  }
}

class Cube extends AuroraAnimation {
  constructor(random, width, height) {
    super(20, random, width, height);
    this.angleX = 20;
    this.angleY = 10;
    this.hue = 0;
    this.step = 0;
    const w = SIZE - 4;
    this.vertices = [
      [-w, w, w], [w, w, w], [w, -w, w], [-w, -w, w],
      [-w, w, -w], [w, w, -w], [w, -w, -w], [-w, -w, -w],
    ];
    this.faces = [[1, 0, 3, 2], [0, 4, 7, 3], [4, 0, 1, 5],
      [4, 5, 6, 7], [1, 2, 6, 5], [2, 3, 7, 6]];
    this.edges = [];
    for (const face of this.faces) {
      for (let i = 0; i < 4; ++i) {
        const a = face[i], b = face[(i + 3) % 4];
        if (!this.edges.some(edge => edge.a === a && edge.b === b || edge.a === b && edge.b === a))
          this.edges.push({ a, b });
      }
    }
  }

  draw(ms) {
    if (this.native && this.width > 32)
      this.blur(255);
    else
      this.buffer.dim(215);
    const camera = beatsin8(2, 80, 160, ms);
    this.angleX += beatsin8(3, 1, 5, ms) / 100;
    this.angleY += beatcos8(5, 1, 5, ms) / 100;
    const cx = Math.cos(this.angleX), sx = Math.sin(this.angleX);
    const cy = Math.cos(this.angleY), sy = Math.sin(this.angleY);
    const projected = this.vertices.map(([x, y, z]) => {
      const ax = cy * x - sy * z;
      const ay = sx * sy * x + cx * y + sx * cy * z;
      const az = cx * sy * x - sx * y + cx * cy * z + camera;
      if (this.native) {
        const scale = Math.min(this.scaleX, this.scaleY);
        return [this.width / 2 + 30 * ax / az * scale, this.height / 2 - 30 * ay / az * scale];
      }
      return [Math.floor(CENTER + 30 * ax / az), Math.floor(CENTER - 30 * ay / az)];
    });
    const visible = new Set();
    for (const face of this.faces) {
      const [a, b, c] = face.map(index => projected[index]);
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0) {
        for (let i = 0; i < 4; ++i) {
          const x = face[i], y = face[(i + 3) % 4];
          visible.add(this.edges.find(edge => edge.a === x && edge.b === y || edge.a === y && edge.b === x));
        }
      }
    }
    for (const front of [false, true]) {
      const color = this.colour(this.hue, front ? 255 : 64);
      for (const edge of this.edges) {
        if (visible.has(edge) === front) {
          const a = projected[edge.a], b = projected[edge.b];
          this.nativeLine(a[0], a[1], b[0], b[1], color, false,
            this.native ? Math.max(0.5, this.dotRadius * 0.5) : 0);
        }
      }
    }
    if (++this.step === 8) {
      this.step = 0;
      this.hue = byte(this.hue + 1);
    }
  }
}

class Flock extends AuroraAnimation {
  constructor(random, width, height) {
    super(1000 / 60, random, width, height);
    this.hue = 0;
    this.boids = [];
    this.setOptions();
    this.predator = new Boid(CENTER / 2, CENTER / 2, random);
    this.predator.maxspeed = 0.385;
    this.predator.maxforce = 0.020;
    this.predator.neighbors = 16;
    this.predator.separation = 0;
  }

  setOptions({ count = null, dotSize = null } = {}) {
    if (count !== null && (!Number.isInteger(count) || count < 1 || count > 256))
      throw new Error('Flock count must be an integer from 1 to 256');
    this.setDotSize(dotSize);
    const size = count ?? Math.min(256, Math.max(1, Math.floor(this.width / 3)));
    this.boids.length = Math.min(this.boids.length, size);
    while (this.boids.length < size) {
      const boid = new Boid(CENTER - 1, CENTER - 1, this.random);
      boid.maxspeed = 0.380;
      boid.maxforce = 0.015;
      this.boids.push(boid);
    }
  }

  renderFrame(state) {
    this.setOptions(state.flock);
    if (state.auroraDotSize !== undefined)
      this.setDotSize(state.auroraDotSize);
    this.setPalette(state.paletteId);
    return this.render(state.auroraTime ?? state.time);
  }

  draw(ms) {
    this.buffer.dim(230);
    let applyWind = Math.floor(this.random() * 255) > 250;
    const wind = applyWind ? [
      (Math.floor(this.random() * 255) / 255 - 0.5) * 0.015,
      (Math.floor(this.random() * 255) / 255 - 0.5) * 0.015,
    ] : [0, 0];
    const color = this.colour(this.hue);
    for (const boid of this.boids) {
      const d = Math.hypot(this.predator.x - boid.x - boid.vx, this.predator.y - boid.y - boid.vy);
      if (d <= 10) {
        const repel = normalized(boid.x - this.predator.x, boid.y - this.predator.y,
          d === 0 ? 1 : boid.maxforce * 7);
        boid.ax += repel[0];
        boid.ay += repel[1];
      }
      const oldX = boid.x, oldY = boid.y;
      boid.flock(this.boids);
      boid.wrap();
      this.trace(oldX, oldY, boid.x, boid.y, color);
      if (applyWind) {
        boid.ax += wind[0];
        boid.ay += wind[1];
        applyWind = false;
      }
    }
    const oldX = this.predator.x, oldY = this.predator.y;
    this.predator.flock(this.boids);
    this.predator.wrap();
    this.trace(oldX, oldY, this.predator.x, this.predator.y, this.colour(this.hue + 128));
    if (this.every('hue', 200, ms))
      this.hue = byte(this.hue + 1);
  }
}

class FlowField extends AuroraAnimation {
  constructor(random, width, height) {
    super(50, random, width, height);
    this.x = Math.floor(random() * 65536);
    this.y = Math.floor(random() * 65536);
    this.z = Math.floor(random() * 65536);
    this.hue = 0;
    this.boids = Array.from({ length: Math.max(this.width, this.height) }, () =>
      new Boid(this.native ? random() * (SIZE - 1) : Math.floor(random() * SIZE),
        this.native ? random() * (SIZE - 1) : Math.floor(random() * SIZE), random));
  }

  draw(ms) {
    this.buffer.dim(240);
    for (const boid of this.boids) {
      const angle = inoise8(this.x + Math.trunc(26 * boid.x), this.y + Math.trunc(26 * boid.y), this.z);
      boid.vx = sin8(angle) / 128 - 1;
      boid.vy = -(cos8(angle) / 128 - 1);
      const oldX = boid.x, oldY = boid.y;
      boid.update();
      this.trace(oldX, oldY, boid.x, boid.y, this.colour(angle + this.hue));
      if (boid.x < 0 || boid.x >= SIZE || boid.y < 0 || boid.y >= SIZE) {
        boid.x = this.native ? this.random() * (SIZE - 1) : Math.floor(this.random() * SIZE);
        boid.y = 0;
      }
    }
    if (this.every('hue', 200, ms))
      this.hue = byte(this.hue + 1);
    this.x = (this.x + 1) & 65535;
    this.y = (this.y + 1) & 65535;
    this.z = (this.z + 1) & 65535;
  }
}

class IncrementalDrift extends AuroraAnimation {
  constructor(random, width, height) {
    super(1000 / 60, random, width, height);
  }

  draw(ms) {
    this.buffer.dim(beatsin8(2, 230, 250, ms));
    const count = Math.max(1, Math.floor(this.width / 2));
    const first = Math.min(2, count);
    for (let i = first; i <= count; ++i) {
      const radius = i * CENTER / count;
      const bpm = (CENTER + 1 - radius) * 2;
      this.point(
        this.beatPosition(bpm, CENTER - radius, CENTER + radius, ms, true),
        this.beatPosition(bpm, CENTER - radius, CENTER + radius, ms),
        this.colour((i - first) * (this.native ? 240 / count : Math.floor(240 / count))));
    }
  }
}

class IncrementalDriftRose extends AuroraAnimation {
  constructor(random, width, height) {
    super(1000 / 60, random, width, height);
  }

  draw(ms) {
    this.buffer.dim(beatsin8(2, 170, 250, ms));
    for (let i = 0; i < this.width; ++i) {
      const position = this.width > 1 ? i / this.scaleX : 0;
      const inner = position < CENTER;
      const bpm = (inner ? position + 1 : SIZE - position) * 2;
      const low = inner ? position : SIZE - position;
      const high = inner ? SIZE - position : position + 1;
      this.point(
        this.beatPosition(bpm, low, high, ms, inner),
        this.beatPosition(bpm, low, high, ms, !inner),
        this.colour((inner ? position : 31 - position) * 14));
    }
  }
}

class PendulumWave extends AuroraAnimation {
  constructor(random, width, height) {
    super(15, random, width, height);
  }

  draw(ms) {
    this.buffer.dim(170);
    let previousY = null;
    for (let x = 0; x < this.width; ++x) {
      const position = this.width > 1 ? x / this.scaleX : 0;
      const y = this.beatPosition(position + 1, 0, this.native ? SIZE - 1 : SIZE, ms);
      const color = this.colour(position * 7);
      if (this.native) {
        const py = y * this.scaleY;
        this.nativeLine(previousY === null ? x : x - 1, previousY ?? py,
          x, py, color, false, 0.5);
        previousY = py;
      } else {
        this.point(x, y, color);
      }
    }
  }
}

class Radar extends AuroraAnimation {
  constructor(random, width, height) {
    super(1000 / 60, random, width, height);
    this.theta = 0;
    this.hue = 0;
  }

  draw(ms) {
    this.buffer.dim(245);
    const count = Math.max(1, Math.ceil(Math.max(this.width, this.height) / 2));
    for (let offset = 0; offset < count; ++offset) {
      const inset = this.native ? (SIZE - 1) / 2 * offset / Math.max(1, count - 1) : offset;
      this.point(this.cosPosition(this.theta, inset, SIZE - 1 - inset),
        this.sinPosition(this.theta, inset, SIZE - 1 - inset),
        this.colour(255 - (offset * 256 / count + this.hue)));
      if (this.every('sweep', 25, ms)) {
        this.theta = byte(this.theta + 2);
        this.hue = byte(this.hue + 1);
      }
    }
  }
}

class Spiral extends AuroraAnimation {
  constructor(random, width, height) {
    super(1000 / 60, random, width, height);
  }

  draw(ms) {
    const oscillator = (period, high) => {
      const ticks = (ms + 1e-7) / period;
      const step = (this.native ? ticks : Math.floor(ticks)) % (high * 2);
      return step <= high ? step : high * 2 - step;
    };
    this.line(oscillator(71, 31), oscillator(89, 31),
      oscillator(42, 31), oscillator(55, 31), this.colour(oscillator(3, 255)), true);
    this.spiral(15, 15, 16, 128);
    this.spiral(16, 6, 6, 128);
    this.spiral(10, 24, 10, 128);
    this.buffer.dim(224);
  }
}

class Spiro extends AuroraAnimation {
  constructor(random, width, height) {
    super(1000 / 60, random, width, height);
    this.theta1 = 0;
    this.theta2 = 0;
    this.hue = 0;
    this.count = 5;
    this.offset = Math.floor(256 / this.count);
    this.increment = false;
    this.handledChange = false;
    this.previousPoints = [];
  }

  draw(ms) {
    this.buffer.dim(254);
    let change = false;
    const points = [];
    for (let i = 0; i < this.count; ++i) {
      const angle = i * this.offset;
      const x = this.sinPosition(this.theta1 + angle, 8, 25);
      const y = this.cosPosition(this.theta1 + angle, 8, 25);
      const x2 = this.sinPosition(this.theta2 + angle, this.native ? x - 8 : byte(x - 8),
        this.native ? x + 8 : byte(x + 8));
      const y2 = this.cosPosition(this.theta2 + angle, this.native ? y - 8 : byte(y - 8),
        this.native ? y + 8 : byte(y + 8));
      const previous = this.previousPoints[i] || [x2, y2];
      this.trace(previous[0], previous[1], x2, y2, this.colour(this.hue + angle));
      points.push([x2, y2]);
      const near = (center) => this.native ?
        Math.abs(x2 - center) < 0.5 && Math.abs(y2 - center) < 0.5 :
        x2 === center && y2 === center;
      if (near(CENTER) || near(CENTER - 1))
        change = true;
    }
    this.previousPoints = points;
    this.theta2 = byte(this.theta2 + 1);
    if (this.every('theta', 25, ms))
      this.theta1 = byte(this.theta1 + 1);
    if (this.every('count', 100, ms)) {
      if (change && !this.handledChange) {
        this.handledChange = true;
        if (this.count >= SIZE || this.count === 1)
          this.increment = !this.increment;
        if (this.increment)
          this.count = this.count >= 4 ? this.count * 2 : this.count + 1;
        else
          this.count = this.count > 4 ? Math.floor(this.count / 2) : this.count - 1;
        this.offset = byte(Math.floor(256 / this.count));
        this.previousPoints = [];
      }
      if (!change)
        this.handledChange = false;
    }
    if (this.every('hue', 33, ms))
      this.hue = byte(this.hue + 1);
  }
}

class Swirl extends AuroraAnimation {
  constructor(random, width, height) {
    super(1000 / 60, random, width, height);
  }

  draw(ms) {
    this.blur(172);
    const i = this.beatPosition(27, 2, SIZE - 2, ms);
    const j = this.beatPosition(41, 2, SIZE - 2, ms);
    const ni = SIZE - 1 - i;
    const nj = SIZE - 1 - j;
    const clock = Math.trunc(ms) & 65535;
    for (const [x, y, divisor] of [
      [i, j, 11], [j, i, 13], [ni, nj, 17],
      [nj, ni, 29], [i, nj, 37], [ni, j, 41],
    ])
      this.point(x, y, this.colour(Math.floor(clock / divisor)), true);
  }
}

class Wave extends AuroraAnimation {
  constructor(random, width, height) {
    super(1000 / 60, random, width, height);
    this.rotation = Math.floor(random() * 4);
    if (this.height > this.width) this.rotation = 1;
    if (this.height < this.width) this.rotation = 0;
    this.count = 1 + Math.floor(random() * 2);
    this.theta = 0;
    this.hue = 0;
  }

  draw() {
    if (this.native) {
      const vertical = this.rotation % 2 !== 0;
      const length = vertical ? this.height : this.width;
      const previous = [];
      for (let i = 0; i < length; ++i) {
        const position = length > 1 ? i * (SIZE - 1) / (length - 1) : 0;
        const phase = position * 2 + (this.rotation < 2 ? this.theta : -this.theta);
        const whole = Math.floor(phase);
        const fraction = phase - whole;
        const value = quadwave8(whole) * (1 - fraction) + quadwave8(whole + 1) * fraction;
        const n = value / 255 * (vertical ? this.width - 1 : this.height - 1);
        const color = this.colour(position + this.hue);
        for (let wave = 0; wave < this.count; ++wave) {
          const coordinate = wave ? (vertical ? this.width - 1 : this.height - 1) - n : n;
          const x = vertical ? coordinate : i;
          const y = vertical ? i : coordinate;
          const old = previous[wave] || [x, y];
          this.nativeLine(old[0], old[1], x, y, color);
          previous[wave] = [x, y];
        }
      }
      this.buffer.dim(254);
      this.theta = byte(this.theta + 1);
      this.hue = byte(this.hue + 1);
      return;
    }
    for (let i = 0; i < SIZE; ++i) {
      const n = Math.floor(quadwave8(i * 2 + (this.rotation < 2 ? this.theta : -this.theta)) / 8);
      const color = this.colour(i + this.hue);
      if (this.rotation % 2 === 0) {
        this.point(i, n, color);
        if (this.count === 2) this.point(i, SIZE - 1 - n, color);
      } else {
        this.point(n, i, color);
        if (this.count === 2) this.point(SIZE - 1 - n, i, color);
      }
    }
    this.buffer.dim(254);
    this.theta = byte(this.theta + 1);
    this.hue = byte(this.hue + 1);
  }
}

const definitions = [
  ['attract', 'Attract', Attract, 'Gravitational particles orbit a central attractor'],
  ['bounce', 'Bounce', Bounce, 'Gravity-driven coloured bouncing columns', {
    audio: 'Gravity-driven coloured bouncing columns; each ball is kicked back up by its own part of ' +
      'the spectrum or by the beat, and relaunched when it settles (added here: upstream they settle for good)',
    audioReactive: true,
    params: BOUNCE_PARAMS,
  }],
  ['cube', 'Cube', Cube, 'Perspective cube with bright front edges and dim back edges'],
  ['flock', 'Flock', Flock, 'Reynolds flocking with separation, alignment, cohesion, and a predator'],
  ['flowfield', 'Flow Field', FlowField, 'Particles follow FastLED 3D noise with persistent trails'],
  ['incremental-drift', 'Incremental Drift', IncrementalDrift, 'Nested sine/cosine orbits with incremental beat frequencies'],
  ['incremental-drift-rose', 'Incremental Drift Rose', IncrementalDriftRose, 'Counter-rotating incremental sine/cosine orbits'],
  ['pendulum-wave', 'Pendulum Wave', PendulumWave, 'Columns oscillate at successively increasing beat frequencies'],
  ['radar', 'Radar', Radar, 'A palette-coloured rotating sweep with fading trails'],
  ['spiral', 'Spiral', Spiral, 'Five oscillators draw lines through three spiral-stream effects'],
  ['spiro', 'Spiro', Spiro, 'Two phase counters trace a changing multi-point spirograph'],
  ['swirl', 'Swirl', Swirl, 'Six reflected beat-driven dots spread through lossy 2D blur'],
  ['wave', 'Wave', Wave, 'Quadratic waves with random orientation and optional reflection'],
];

// Patterns that never draw from their random generator (measured, T72), so
// have no Variation to keep.
const NO_DICE = new Set(['cube', 'incremental-drift', 'incremental-drift-rose', 'pendulum-wave', 'radar', 'spiral',
  'spiro', 'swirl']);

export const AURORA_PATTERNS = definitions.map(([id, name, Pattern, description, extra = {}]) => ({
  id: `aurora-${id}`,
  name: `Aurora ${name}`,
  audio: `${description} (original demo; no audio modulation)`,
  controls: Pattern === Flock ? ['aurora', 'flock'] : ['aurora'],
  createInstance: (width = SIZE, height = SIZE, random = Math.random) => new Pattern(random, width, height),
  ...extra,
  ...(NO_DICE.has(id) ? {} : { params: [...(extra.params ?? []), VARIATION_PARAM] }),
}));
