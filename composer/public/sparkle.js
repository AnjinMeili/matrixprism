// Sparkles (T30): twinkling points of light laid over whatever is showing.
// Each high-band hit (updateHighs in audio.js) lights a scatter of pixels
// that flash and fade, and a faint twinkle follows the air between hits. The
// compositor (renderer.js) draws them after the mix and before the overlays,
// so they go over every pattern. The rule is kept twice, as GLSL and as a
// JavaScript reference (sparkleLight) that the tests and
// tools/sparkle-check.html compare, pixel by pixel.

// Hits kept for drawing; older ones have faded by the time they drop out.
export const SPARKLE_HITS = 32;

export const SPARKLE_SHAPES = [
  { id: 'point', label: 'Points' },
  { id: 'star', label: 'Stars' },
];

export const SPARKLE_COLOURS = [
  { id: 'white', label: 'White' },
  { id: 'key', label: 'Key colour' },
  { id: 'place', label: 'Gold to ice, by pitch' },
];

// Where sparkles land: anywhere, or where the picture has features (a proof
// of concept, after Anjin asked for sparkles that follow curves and
// objects rather than falling at random). The compositor first draws the
// mixed picture into a texture, and each pixel's chance of sparkling is
// weighted by what that picture has there.
export const SPARKLE_PLACEMENTS = [
  { id: 'anywhere', label: 'Anywhere' },
  { id: 'edges', label: 'Along edges and curves' },
  { id: 'light', label: 'On bright shapes' },
];
// Faint features count for nothing: an edge's weight rises from a change in
// brightness of EDGE_RAMP[0] across it to full at EDGE_RAMP[1], and a bright
// shape's from LIGHT_RAMP[0] to LIGHT_RAMP[1]. With a plain proportion, a
// scope's dim grid and a curtain's soft threads drew as many as the lines.
// Features are sparse, so a full weight is PLACEMENT_GAIN times Anywhere's
// chance, to keep about as many sparkles.
const EDGE_RAMP = [0.1, 0.4];
const LIGHT_RAMP = [0.3, 0.8];
const PLACEMENT_GAIN = [1, 3, 2];
const ramp = (value, [low, high]) => Math.min(1, Math.max(0, (value - low) / (high - low)));

export const SPARKLE_DEFAULTS = {
  enabled: false, amount: 0.8, density: 0.5, length: 0.4, shape: 'star', colour: 'white', twinkle: 0.3,
  placement: 'anywhere',
};

// How long a sparkle takes to fall to a third, from Length (0 to 1): 50 ms to
// 400 ms.
export const sparkleLife = (length) => 0.05 * 8 ** length;
// The share of pixels a full-strength hit lights, from Density (0 to 1): up
// to 2%.
export const sparkleShare = (density) => 0.02 * density ** 2;
// The air twinkle's period in seconds, and the share of pixels it lights at
// full air.
const AIR_PERIOD = 0.6;
const AIR_SHARE = 0.004;
// Air below AIR_LOW gives no twinkle and at AIR_HIGH full twinkle. On the
// Beatport set the median track's air is about 0.3.
const AIR_LOW = 0.1;
const AIR_HIGH = 0.5;
// The air twinkle's seeds repeat every 289 periods, so its clock can wrap
// there without a jump.
const AIR_WRAP = AIR_PERIOD * 289;

export function sparkleSettings(value = SPARKLE_DEFAULTS) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Sparkle settings must be an options object.');
  const result = { ...SPARKLE_DEFAULTS, ...value };
  if (typeof result.enabled !== 'boolean') throw new Error('Sparkles enabled must be boolean.');
  for (const key of ['amount', 'density', 'length', 'twinkle'])
    if (!Number.isFinite(result[key]) || result[key] < 0 || result[key] > 1)
      throw new Error(`Sparkle ${key} must be between 0 and 1.`);
  if (!SPARKLE_SHAPES.some((s) => s.id === result.shape)) throw new Error(`Unknown sparkle shape: ${result.shape}`);
  if (!SPARKLE_COLOURS.some((c) => c.id === result.colour)) throw new Error(`Unknown sparkle colour: ${result.colour}`);
  if (!SPARKLE_PLACEMENTS.some((p) => p.id === result.placement))
    throw new Error(`Unknown sparkle placement: ${result.placement}`);
  const { enabled, amount, density, length, shape, colour, twinkle, placement } = result;
  return { enabled, amount, density, length, shape, colour, twinkle, placement };
}

// The prelude's palette (pal in patterns.js) at 0, for the key colour.
export function keyTint(hue) {
  return [0, 0.33, 0.67].map((offset) => 0.5 + 0.5 * Math.cos(2 * Math.PI * (hue + offset)));
}

// The last SPARKLE_HITS hits, each { time, strength, place, seed }, and what
// the compositor needs to draw them.
export class SparkleField {
  constructor() {
    this.hits = [];
    this.nextSeed = 0;
  }

  // Takes this frame's hit, if any, from the audio features.
  add(audio, seconds) {
    if (!audio?.highHits || !(audio.highStrength > 0)) return;
    this.hits.push({ time: seconds, strength: audio.highStrength, place: audio.highPlace ?? 0.5, seed: this.nextSeed });
    this.nextSeed = (this.nextSeed + 1) % 289;
    if (this.hits.length > SPARKLE_HITS) this.hits.shift();
  }

  clear() {
    this.hits = [];
  }

  // The compositor's uniforms at `seconds`: u_hits (age, strength, place and
  // seed of each hit; strength 0 where there is none), u_sparkle (amount,
  // share, life, star) and u_sparkle_air (twinkle level, air clock, colour
  // mode, placement), and u_sparkle_tint. Amount 0 turns them off.
  uniforms(seconds, settings, hue = 0, air = 0) {
    const hits = new Float32Array(SPARKLE_HITS * 4);
    this.hits.forEach((hit, i) => hits.set([Math.max(0, seconds - hit.time), hit.strength, hit.place, hit.seed], i * 4));
    const on = settings?.enabled;
    const t = Math.min(1, Math.max(0, (air - AIR_LOW) / (AIR_HIGH - AIR_LOW)));
    return {
      hits,
      sparkle: [on ? settings.amount : 0, sparkleShare(settings?.density ?? 0), sparkleLife(settings?.length ?? 0),
        settings?.shape === 'star' ? 1 : 0],
      air: [on ? settings.twinkle * t * t * (3 - 2 * t) : 0, ((seconds % AIR_WRAP) + AIR_WRAP) % AIR_WRAP,
        Math.max(0, SPARKLE_COLOURS.findIndex((c) => c.id === settings?.colour)),
        Math.max(0, SPARKLE_PLACEMENTS.findIndex((p) => p.id === settings?.placement))],
      tint: keyTint(hue),
    };
  }
}

// Which pixels a hit lights comes from a fixed table of random numbers, the
// same in JavaScript and, as a texture, in GLSL, so the two agree exactly.
// A hash in arithmetic was tried first: a permutation polynomial kept below
// 2^24 for single-precision floats. It lit pixels in diagonal stripes.
export const SPARKLE_NOISE_SIZE = 256;
let noise = null;

// The table: SPARKLE_NOISE_SIZE squared RGBA texels, of which red and green
// hold a 16-bit number, from a seeded generator (mulberry32).
export function sparkleNoise() {
  if (noise) return noise;
  noise = new Uint8Array(SPARKLE_NOISE_SIZE * SPARKLE_NOISE_SIZE * 4);
  let a = 0x5eed;
  for (let i = 0; i < noise.length; i += 4) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const value = (t ^ (t >>> 14)) >>> 0;
    noise[i] = value >>> 24;
    noise[i + 1] = (value >>> 16) & 255;
    noise[i + 3] = 255;
  }
  return noise;
}

// Whole numbers only. The remainder is corrected after the division, which a
// GPU may round.
function sparkleMod(x, y) {
  const m = x - y * Math.floor(x / y);
  return m < 0 ? m + y : m >= y ? m - y : m;
}

// 0 to 1 for pixel (x, y) and seed s (0 to 288), all whole numbers: the table
// read at an offset that each seed moves.
export function sparkleHash(x, y, s) {
  const table = sparkleNoise();
  const column = sparkleMod(x + s * 97, SPARKLE_NOISE_SIZE);
  const row = sparkleMod(y + s * 57 + 13, SPARKLE_NOISE_SIZE);
  const at = (row * SPARKLE_NOISE_SIZE + column) * 4;
  return (table[at] * 256 + table[at + 1]) / 65536;
}

const twinkle = (age, phase) => 0.75 + 0.25 * Math.cos(age * 40 + phase * 2 * Math.PI);

function sparkleColour(mode, place, tint) {
  if (mode === 1) return tint.map((c) => 0.3 + 0.7 * c);
  if (mode === 2) return [1 + (0.65 - 1) * place, 0.78 + (0.85 - 0.78) * place, 0.45 + (1 - 0.45) * place];
  return [1, 1, 1];
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Whether a placement needs the mixed picture drawn first.
export const needsFeatures = (settings) => !!settings?.enabled && (settings.placement ?? 'anywhere') !== 'anywhere';

// The picture's brightness at (x, y), 0 to 1, from `frame` ({ width, height,
// pixels }: RGBA bytes, rows from the bottom), clamped at its edges. In whole
// numbers, as the GLSL reads its texture back to bytes, so the two agree.
function frameLuma(frame, x, y) {
  const cx = Math.min(frame.width - 1, Math.max(0, x)), cy = Math.min(frame.height - 1, Math.max(0, y));
  const at = (cy * frame.width + cx) * 4;
  return (299 * frame.pixels[at] + 587 * frame.pixels[at + 1] + 114 * frame.pixels[at + 2]) / 255000;
}

// How likely pixel (x, y) is to sparkle, relative to Anywhere, for placement
// `mode` (an index into SPARKLE_PLACEMENTS): along edges, by how much the
// brightness changes across it; on bright shapes, by its brightness.
export function sparkleWeight(x, y, mode, frame) {
  if (!mode || !frame) return 1;
  if (mode === 1) {
    const change = Math.abs(frameLuma(frame, x + 1, y) - frameLuma(frame, x - 1, y)) +
      Math.abs(frameLuma(frame, x, y + 1) - frameLuma(frame, x, y - 1));
    return ramp(change, EDGE_RAMP) * PLACEMENT_GAIN[1];
  }
  return ramp(frameLuma(frame, x, y), LIGHT_RAMP) * PLACEMENT_GAIN[2];
}

// The light added at pixel (x, y), counted from the bottom left as
// gl_FragCoord is, as [r, g, b]; `u` is SparkleField.uniforms(), and `frame`
// the mixed picture, for a placement that needs it.
export function sparkleLight(x, y, u, frame = null) {
  const [amount, share, life, star] = u.sparkle;
  const light = [0, 0, 0];
  if (amount <= 0) return light;
  const add = (colour, value) => colour.forEach((c, i) => { light[i] += c * value; });
  for (let i = 0; i < SPARKLE_HITS; ++i) {
    const [age, strength, place, seed] = u.hits.subarray(i * 4, i * 4 + 4);
    if (strength <= 0) continue;
    const envelope = strength * Math.exp(-age / life);
    if (envelope < 0.004) continue;
    const q = share * strength;
    const mode = u.air[3];
    const centre = sparkleHash(x, y, seed);
    const qc = q * sparkleWeight(x, y, mode, frame);
    let value = centre < qc ? twinkle(age, centre / q) : 0;
    if (star)
      for (const [dx, dy] of NEIGHBOURS) {
        const h = sparkleHash(x + dx, y + dy, seed);
        if (h < q * sparkleWeight(x + dx, y + dy, mode, frame)) value = Math.max(value, 0.35 * twinkle(age, h / q));
      }
    if (value > 0) add(sparkleColour(u.air[2], place, u.tint), envelope * value);
  }
  const [level, clock] = u.air;
  if (level > 0) {
    const position = clock / AIR_PERIOD + sparkleHash(x, y, 7);
    const h = sparkleHash(x, y, sparkleMod(Math.floor(position), 289));
    if (h < AIR_SHARE * sparkleWeight(x, y, u.air[3], frame)) add(sparkleColour(u.air[2], h / AIR_SHARE, u.tint), 0.5 * level * Math.sin(Math.PI * (position % 1)));
  }
  return light.map((c) => c * amount);
}

// The same rule for the compositor: `vec3 sparkles(vec2 pixel)`, with pixel
// the whole-number position from the bottom left. Needs `uniform vec2 u_res`
// declared before it, as the compositor has.
export const SPARKLE_GLSL = `
uniform vec4 u_hits[${SPARKLE_HITS}];
uniform vec4 u_sparkle;
uniform vec4 u_sparkle_air;
uniform vec3 u_sparkle_tint;
uniform sampler2D u_sparkle_noise;
uniform sampler2D u_features;
float sparkleMod(float x, float y) {
  float m = x - y * floor(x / y);
  return m < 0.0 ? m + y : (m >= y ? m - y : m);
}
float sparkleHash(float x, float y, float s) {
  vec2 cell = vec2(sparkleMod(x + s * 97.0, ${SPARKLE_NOISE_SIZE}.0), sparkleMod(y + s * 57.0 + 13.0, ${SPARKLE_NOISE_SIZE}.0));
  vec4 texel = texture2D(u_sparkle_noise, (cell + 0.5) / ${SPARKLE_NOISE_SIZE}.0);
  return (floor(texel.r * 255.0 + 0.5) * 256.0 + floor(texel.g * 255.0 + 0.5)) / 65536.0;
}
float sparkleLuma(vec2 p) {
  vec2 c = clamp(p, vec2(0.0), u_res - 1.0);
  vec3 bytes = floor(texture2D(u_features, (c + 0.5) / u_res).rgb * 255.0 + 0.5);
  return dot(bytes, vec3(299.0, 587.0, 114.0)) / 255000.0;
}
float sparkleWeight(vec2 p) {
  if (u_sparkle_air.w < 0.5) return 1.0;
  if (u_sparkle_air.w < 1.5) {
    float change = abs(sparkleLuma(p + vec2(1.0, 0.0)) - sparkleLuma(p - vec2(1.0, 0.0))) +
      abs(sparkleLuma(p + vec2(0.0, 1.0)) - sparkleLuma(p - vec2(0.0, 1.0)));
    return clamp((change - ${EDGE_RAMP[0].toFixed(2)}) / ${(EDGE_RAMP[1] - EDGE_RAMP[0]).toFixed(2)}, 0.0, 1.0) * ${PLACEMENT_GAIN[1].toFixed(1)};
  }
  return clamp((sparkleLuma(p) - ${LIGHT_RAMP[0].toFixed(2)}) / ${(LIGHT_RAMP[1] - LIGHT_RAMP[0]).toFixed(2)}, 0.0, 1.0) * ${PLACEMENT_GAIN[2].toFixed(1)};
}
float sparkleTwinkle(float age, float phase) { return 0.75 + 0.25 * cos(age * 40.0 + phase * 6.2831853); }
vec3 sparkleColour(float place) {
  if (u_sparkle_air.z > 1.5) return mix(vec3(1.0, 0.78, 0.45), vec3(0.65, 0.85, 1.0), place);
  if (u_sparkle_air.z > 0.5) return 0.3 + 0.7 * u_sparkle_tint;
  return vec3(1.0);
}
vec3 sparkles(vec2 pixel) {
  vec3 light = vec3(0.0);
  if (u_sparkle.x <= 0.0) return light;
  for (int i = 0; i < ${SPARKLE_HITS}; i++) {
    vec4 hit = u_hits[i];
    if (hit.y <= 0.0) continue;
    float envelope = hit.y * exp(-hit.x / u_sparkle.z);
    if (envelope < 0.004) continue;
    float q = u_sparkle.y * hit.y;
    float centre = sparkleHash(pixel.x, pixel.y, hit.w);
    float value = centre < q * sparkleWeight(pixel) ? sparkleTwinkle(hit.x, centre / q) : 0.0;
    if (u_sparkle.w > 0.5) {
      float h = sparkleHash(pixel.x + 1.0, pixel.y, hit.w);
      if (h < q * sparkleWeight(pixel + vec2(1.0, 0.0))) value = max(value, 0.35 * sparkleTwinkle(hit.x, h / q));
      h = sparkleHash(pixel.x - 1.0, pixel.y, hit.w);
      if (h < q * sparkleWeight(pixel - vec2(1.0, 0.0))) value = max(value, 0.35 * sparkleTwinkle(hit.x, h / q));
      h = sparkleHash(pixel.x, pixel.y + 1.0, hit.w);
      if (h < q * sparkleWeight(pixel + vec2(0.0, 1.0))) value = max(value, 0.35 * sparkleTwinkle(hit.x, h / q));
      h = sparkleHash(pixel.x, pixel.y - 1.0, hit.w);
      if (h < q * sparkleWeight(pixel - vec2(0.0, 1.0))) value = max(value, 0.35 * sparkleTwinkle(hit.x, h / q));
    }
    if (value > 0.0) light += sparkleColour(hit.z) * envelope * value;
  }
  if (u_sparkle_air.x > 0.0) {
    float position = u_sparkle_air.y / ${AIR_PERIOD.toFixed(1)} + sparkleHash(pixel.x, pixel.y, 7.0);
    float h = sparkleHash(pixel.x, pixel.y, sparkleMod(floor(position), 289.0));
    if (h < ${AIR_SHARE.toFixed(3)} * sparkleWeight(pixel))
      light += sparkleColour(h / ${AIR_SHARE.toFixed(3)}) * 0.5 * u_sparkle_air.x * sin(3.14159265 * fract(position));
  }
  return light * u_sparkle.x;
}
`;
