// Fire: a 2D flame simulation, after Fire2012 (Mark Kriegsman, FastLED's
// examples, MIT) as WLED's "Fire 2012 2D" uses it on a matrix. Written here
// from the published algorithm, not ported from either's code.
//
// The panel is a grid of heat, bottom row first. Each step of the simulation:
// - every cell cools by a random amount, more on short panels so a flame
//   reaches a like share of any panel;
// - heat rises: each cell takes the heat of the two rows below it, mostly the
//   nearer, from a little to the side, as wind and a slowly changing
//   turbulence push it, so flames lean and lick rather than rise in columns;
// - neighbours mix a little, which softens the edges;
// - sparks land on the bottom rows in small clusters;
// - embers break away above the flames, rise, drift and fade; on a bigger
//   panel there are more, drawn bigger, rising as far up it.
// The music lifts the fire: each beat starts a flare that dies away over a
// quarter of a second, and the bass adds to it. Lifted, the fire cools less,
// so the flames leap, takes more sparks, and glows hotter.
// Heat becomes colour from black through deep red, orange and yellow to
// white, as hot gas glows; the shared hue setting turns it like any pattern.
//
// The simulation steps at a fixed rate on the pattern clock (state.auroraTime,
// which Speed scales), so it looks the same at any frame rate, and catches up
// at most a few steps after a stall.

const STEP_SECONDS = 1 / 50;
const MAX_STEPS = 5;
// Embers alive at once on a panel 64 wide; more on a wider one.
const MAX_EMBERS = 64;
// A beat's flare falls to a third in a quarter of a second.
const FLARE_DECAY = Math.exp(-STEP_SECONDS / 0.25);
// Rows below the panel where the sparks land, so the panel shows the fire
// they feed, not the sparks themselves.
const HIDDEN_ROWS = 2;

// Black, deep red, orange, yellow, white: heat 0 to 1.
const STOPS = [
  [0, [0, 0, 0]], [0.18, [60, 0, 0]], [0.38, [200, 20, 0]], [0.58, [255, 110, 0]],
  [0.78, [255, 210, 40]], [1, [255, 255, 220]],
];

// The colour for each of 256 heat levels.
export const FIRE_COLOURS = (() => {
  const table = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; ++i) {
    const heat = i / 255;
    let k = 1;
    while (k < STOPS.length - 1 && STOPS[k][0] < heat) ++k;
    const [h0, c0] = STOPS[k - 1], [h1, c1] = STOPS[k];
    const t = (heat - h0) / (h1 - h0);
    for (let c = 0; c < 3; ++c) table[i * 3 + c] = Math.round(c0[c] + (c1[c] - c0[c]) * t);
  }
  return table;
})();

// Smooth value noise in 2D, from a hash of the lattice points, for the
// turbulence that pushes rising heat sideways. -1 to 1.
function hash(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}
function noise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * sx;
  const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
}

export const FIRE_PARAMS = [
  { id: 'cooling', name: 'Cooling', min: 0.2, max: 3, step: 0.05, default: 1,
    help: 'How fast heat dies away as it rises: higher gives shorter flames' },
  { id: 'sparking', name: 'Sparking', min: 0, max: 1, step: 0.01, default: 0.55,
    help: 'How often new sparks feed the base' },
  { id: 'wind', name: 'Wind', min: -1, max: 1, step: 0.05, default: 0,
    help: 'Leans the flames left (below 0) or right' },
  { id: 'turbulence', name: 'Turbulence', min: 0, max: 1, step: 0.05, default: 0.45,
    help: 'How much the flames lick and sway' },
  { id: 'embers', name: 'Embers', min: 0, max: 1, step: 0.05, default: 0.35,
    help: 'How many embers break away and rise above the flames' },
  { id: 'music', name: 'Music', min: 0, max: 1, step: 0.05, default: 0.5,
    help: 'How much the bass and each beat lift the fire: it leaps higher and glows hotter' },
];

export class Fire2D {
  constructor(width, height, random = Math.random) {
    this.width = width;
    this.height = height;
    // The simulated rows: the panel's, and the hidden ones below it.
    this.rows = height + HIDDEN_ROWS;
    this.random = random;
    this.heat = new Float32Array(width * this.rows);
    this.next = new Float32Array(width * this.rows);
    this.out = new Uint8Array(width * height * 3);
    this.embers = [];
    // Embers are drawn a pixel across on panels up to 64 on the short side,
    // and in proportion beyond, so they still show on a big panel.
    this.scale = Math.max(1, Math.min(width, height) / 64);
    this.emberSize = Math.max(1, Math.round(this.scale));
    this.maxEmbers = Math.round(MAX_EMBERS * Math.max(1, width / 64));
    this.flare = 0;
    this.lift = 0;
    this.time = null;
    this.carry = 0;
    this.steps = 0;
    this.lastBeat = 0;
  }

  renderFrame(state, params = {}) {
    const p = { ...Object.fromEntries(FIRE_PARAMS.map((param) => [param.id, param.default])), ...params };
    const time = state.auroraTime ?? state.time ?? 0;
    if (this.time === null || time < this.time) {
      this.time = time;
      this.carry = 0;
    }
    this.carry = Math.min(this.carry + (time - this.time), STEP_SECONDS * MAX_STEPS);
    this.time = time;
    const audio = state.audio ?? {};
    // A beat starts a flare as it arrives.
    if ((audio.beat ?? 0) > 0.8 && this.lastBeat <= 0.8) this.flare = 1;
    this.lastBeat = audio.beat ?? 0;
    while (this.carry >= STEP_SECONDS) {
      this.carry -= STEP_SECONDS;
      this.step(p, audio.bass ?? 0);
    }
    return this.draw();
  }

  // One step of the simulation. `bass` is 0 to 1.
  step(p, bass) {
    const { width: w, rows: h, heat, next, random } = this;
    const t = this.steps++ * STEP_SECONDS;
    // How far the music lifts the fire, 0 to 1: none with Music at 0.
    this.lift = Math.min(1, p.music * (0.5 * bass + 0.8 * this.flare));
    this.flare *= FLARE_DECAY;
    // Fire2012 cools each cell by up to (COOLING × 10 / length + 2) of 255 a
    // step, with COOLING 55 by default: Cooling 1 here is that 55, scaled to
    // heat 0 to 1 and to the panel's height.
    const cool = (p.cooling * 55 * 10 / this.height + 2) / 255 * (1 - 0.55 * this.lift);
    for (let y = h - 1; y >= 0; --y) {
      for (let x = 0; x < w; ++x) {
        // Where this cell's heat comes from: below, pushed sideways.
        const sway = (noise(x * 0.18, y * 0.12 - t * 1.6) * p.turbulence * 1.6 + p.wind * 0.9);
        const sx = Math.min(w - 1, Math.max(0, x - sway));
        const x0 = Math.floor(sx), fx = sx - x0, x1 = Math.min(w - 1, x0 + 1);
        const at = (row) => (row < 0 ? 0 : heat[row * w + x0] * (1 - fx) + heat[row * w + x1] * fx);
        let value = y < 2 ? heat[y * w + x] : (at(y - 1) * 2 + at(y - 2)) / 3;
        // A little mixing with the neighbours softens the edges.
        if (x > 0 && x < w - 1) value = value * 0.8 + (heat[y * w + x - 1] + heat[y * w + x + 1]) * 0.1;
        // Cooling follows a smooth noise field that rises with the flames, so
        // some places cool fast and some slowly: it carves tongues of flame
        // and the gaps between them, where cooling each cell at random alone
        // would give an even, grainy sheet.
        const field = (noise(x * 0.22, y * 0.2 - t * 2.2) + 1) / 2;
        value -= cool * (0.2 + 1.6 * field * field) * (0.6 + 0.4 * random()) * (1 + 0.5 * y / h);
        next[y * w + x] = value > 0 ? value : 0;
      }
    }
    // Sparks on the bottom rows, in clusters, more as the music lifts the
    // fire, and more where the fuel along the base, which shifts slowly, is
    // richer.
    const chance = Math.min(1, p.sparking * (0.6 + this.lift * 1.2));
    const tries = Math.max(1, Math.round(w / 6));
    for (let i = 0; i < tries; ++i) {
      const cx = Math.floor(random() * w);
      const fuel = 0.25 + 0.75 * (noise(cx * 0.15, t * 0.4 + 50) + 1) / 2;
      if (random() >= chance * fuel * 1.4) continue;
      const spread = 1 + Math.floor(random() * Math.max(1, w / 16));
      for (let x = Math.max(0, cx - spread); x <= Math.min(w - 1, cx + spread); ++x) {
        const row = random() < 0.6 ? 0 : 1;
        const index = Math.min(h - 1, row) * w + x;
        next[index] = Math.min(1, next[index] + 0.55 + random() * 0.45 + this.lift * 0.3);
      }
    }
    this.heat = next;
    this.next = heat;
    this.moveEmbers(p, t);
  }

  // Embers leave from hot cells near the top of a flame, rise, drift with the
  // wind and turbulence, flicker and fade. A wider panel has more, and they
  // rise and drift in proportion to its size.
  moveEmbers(p, t) {
    const { width: w, rows: h, heat, random, scale } = this;
    for (let n = p.embers * 0.35 * Math.max(1, w / 64); n > 0 && this.embers.length < this.maxEmbers; --n) {
      if (random() >= Math.min(1, n)) continue;
      const x = Math.floor(random() * w);
      // The highest hot cell in that column.
      let y = -1;
      for (let row = h - 1; row >= 0; --row) if (heat[row * w + x] > 0.45) { y = row; break; }
      if (y >= 0) this.embers.push({ x, y, life: 0.6 + random() * 0.4, rise: (0.25 + random() * 0.35) * scale });
    }
    for (const ember of this.embers) {
      ember.y += ember.rise;
      ember.x += (p.wind * 0.3 + noise(ember.x * 0.3 / scale, t * 2) * p.turbulence * 0.5) * scale;
      ember.life -= 0.012 + random() * 0.01;
    }
    this.embers = this.embers.filter((e) => e.life > 0 && e.y < h + 1 && e.x > -1 && e.x < w + 1);
  }

  // Heat to colour, top row first, with the embers over it. Lifted by the
  // music, the fire glows hotter than its heat.
  draw() {
    const { width: w, height: h, heat, out } = this;
    const glow = 255 * (1 + 0.35 * this.lift);
    for (let y = 0; y < h; ++y) {
      const row = h - 1 - y + HIDDEN_ROWS;
      for (let x = 0; x < w; ++x) {
        const level = Math.min(255, Math.round(heat[row * w + x] * glow)) * 3;
        const at = (y * w + x) * 3;
        out[at] = FIRE_COLOURS[level];
        out[at + 1] = FIRE_COLOURS[level + 1];
        out[at + 2] = FIRE_COLOURS[level + 2];
      }
    }
    const size = this.emberSize, half = Math.floor(size / 2);
    for (const ember of this.embers) {
      const cx = Math.round(ember.x) - half, cy = h - 1 - Math.round(ember.y) + HIDDEN_ROWS - half;
      const level = Math.round(Math.min(1, ember.life * (0.75 + this.random() * 0.25)) * 230) * 3;
      for (let y = Math.max(0, cy); y < Math.min(h, cy + size); ++y) {
        for (let x = Math.max(0, cx); x < Math.min(w, cx + size); ++x) {
          const at = (y * w + x) * 3;
          for (let c = 0; c < 3; ++c) out[at + c] = Math.max(out[at + c], FIRE_COLOURS[level + c]);
        }
      }
    }
    return out;
  }
}

export const FIRE_PATTERN = {
  id: 'fire-2d',
  name: 'Fire',
  audio: 'A 2D flame simulation after Fire2012: heat rises, cools and sways; the bass feeds the base and each beat flares it',
  audioReactive: true,
  controls: [],
  params: FIRE_PARAMS,
  createInstance: (width, height, random = Math.random) => new Fire2D(width, height, random),
};
