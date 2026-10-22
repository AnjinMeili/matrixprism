import { reversingPosition } from './tempo.js';

// Per-layer shaping, applied when layers are composited. Independent options:
//   shape   - bend the pattern round the centre of the panel, so that its
//             bottom-to-top direction runs from the rim inwards (outside in)
//             or from the centre outwards (inside out);
//   region  - show the layer only inside a central area, or only outside it;
//   outline - whether that area is an ellipse, a rectangle or a diamond;
//   width, height - its size, as fractions of the panel's half-width and
//             half-height (1 reaches the middle of the panel edges);
//   proportional - take the height from the width so the area is as tall as
//             it is wide in pixels: a circle, a square or an even diamond.
//   edge    - how soft the area's border is: 0 is a hard line, larger values
//             fade the layer in and out across the border;
//   spin    - turn the pattern in time with the music: bars per full turn,
//             negative for anticlockwise, 0 for none;
//   spinReverse - reverse the spin every so many bars, or on each change in
//             the music;
//   pulse, pulseBeats - swell the pattern on the beat: how much, and every
//             how many beats.
// Spin and pulse move the pattern inside its region; the region stays put.
//
// Distances use the outline's own measure, so a rectangle outline bends a
// pattern along straight sides and an ellipse bends it round a curve.
//
// The compositor's GLSL and the JavaScript reference below implement the
// same lookup; the tests use the JavaScript one.

export const SHAPES = [
  { id: 'normal', name: 'Normal' },
  { id: 'outside-in', name: 'Bent, outside in (base at the rim)' },
  { id: 'inside-out', name: 'Bent, inside out (base at the centre)' },
];

export const REGIONS = [
  { id: 'full', name: 'Whole panel' },
  { id: 'centre', name: 'Centre only (inside the area)' },
  { id: 'outer', name: 'Edges only (outside the area)' },
];

export const OUTLINES = [
  { id: 'ellipse', name: 'Ellipse' },
  { id: 'rectangle', name: 'Rectangle' },
  { id: 'diamond', name: 'Diamond' },
];

export const SPINS = [0, 1, 2, 4, 8, 16, -1, -2, -4, -8, -16];
// When a spin reverses: never, every so many bars, or (-1) whenever the
// music changes.
export const SPIN_REVERSALS = [0, 1, 2, 4, 8, 16, 32, -1];
export const PULSE_BEATS = [1, 2, 4];

// What the menus call each spin, reversal and pulse timing.
export const spinName = (bars) => bars === 0 ? 'Off' :
  `One turn every ${Math.abs(bars) === 1 ? 'bar' : `${Math.abs(bars)} bars`}, ${bars > 0 ? 'clockwise' : 'anticlockwise'}`;
export const spinReverseName = (bars) => bars === 0 ? 'Never' : bars < 0 ? 'When the music changes' :
  `Every ${bars === 1 ? 'bar' : `${bars} bars`} (${bars * 4} beats)`;
export const pulseBeatsName = (beats) => beats === 1 ? 'Beat' : beats === 2 ? 'Second beat' : 'Bar';
export const PULSE_RANGE = [0, 0.5];
// Border softness, as a fraction of the area's own size either side of its
// outline.
export const EDGE_RANGE = [0, 0.5];
const MIN_EDGE = 0.0005;
const BEATS_PER_BAR = 4;

export const SHAPE_DEFAULTS = {
  shape: 'normal', region: 'full', outline: 'ellipse', width: 0.5, height: 0.5, proportional: false,
  edge: 0, spin: 0, spinReverse: 0, pulse: 0, pulseBeats: 1,
};
export const SIZE_RANGE = [0.05, 1.5];

const indexOf = (list, id, what) => {
  const index = list.findIndex(entry => entry.id === id);
  if (index < 0) throw new Error(`Unknown layer ${what}: ${id}`);
  return index;
};

export function shapeSettings(value = SHAPE_DEFAULTS) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Layer shape settings must be an options object.');
  const result = { ...SHAPE_DEFAULTS, ...value };
  indexOf(SHAPES, result.shape, 'shape');
  indexOf(REGIONS, result.region, 'region');
  indexOf(OUTLINES, result.outline, 'outline');
  for (const key of ['width', 'height']) {
    if (!Number.isFinite(result[key]) || result[key] < SIZE_RANGE[0] || result[key] > SIZE_RANGE[1])
      throw new Error(`Layer area ${key} must be between ${SIZE_RANGE[0]} and ${SIZE_RANGE[1]}.`);
  }
  if (typeof result.proportional !== 'boolean')
    throw new Error('Layer area proportional setting must be boolean.');
  if (!Number.isFinite(result.edge) || result.edge < EDGE_RANGE[0] || result.edge > EDGE_RANGE[1])
    throw new Error(`Layer border softness must be between ${EDGE_RANGE[0]} and ${EDGE_RANGE[1]}.`);
  if (!SPINS.includes(result.spin)) throw new Error(`Unknown layer spin: ${result.spin}`);
  if (!SPIN_REVERSALS.includes(result.spinReverse)) throw new Error(`Unknown layer spin reversal: ${result.spinReverse}`);
  if (!PULSE_BEATS.includes(result.pulseBeats)) throw new Error(`Unknown layer pulse interval: ${result.pulseBeats}`);
  if (!Number.isFinite(result.pulse) || result.pulse < PULSE_RANGE[0] || result.pulse > PULSE_RANGE[1])
    throw new Error(`Layer pulse must be between ${PULSE_RANGE[0]} and ${PULSE_RANGE[1]}.`);
  return {
    shape: result.shape, region: result.region, outline: result.outline,
    width: result.width, height: result.height, proportional: result.proportional,
    edge: result.edge, spin: result.spin, spinReverse: result.spinReverse,
    pulse: result.pulse, pulseBeats: result.pulseBeats,
  };
}

// The movement of a layer at a beat position: the angle it has turned
// through, in radians, and how far it has swollen (1 is none). The pulse
// kicks on the beat and dies away before the next one.
//
// `changeClock` is a beat position that already runs backwards and forwards
// with the changes in the music (TempoTracker keeps it); a spin set to
// reverse on changes follows it. A spin that reverses every so many bars
// swings forwards for that long and back again.
export function motionAt(settings, position = 0, changeClock = position) {
  const fraction = (value) => value - Math.floor(value);
  const clock = settings.spinReverse === 0 ? position :
    settings.spinReverse < 0 ? changeClock : reversingPosition(position, settings.spinReverse * BEATS_PER_BAR);
  const angle = settings.spin === 0 ? 0 :
    Math.sign(settings.spin) * fraction(clock / (Math.abs(settings.spin) * BEATS_PER_BAR)) * Math.PI * 2;
  const zoom = 1 + settings.pulse * Math.exp(-4 * fraction(position / settings.pulseBeats));
  return { angle, zoom };
}

// The numbers the compositor needs for one layer. `aspect` is the panel's
// width divided by its height in pixels, and `position` the beat position.
export function shapeUniforms(value, aspect = 1, position = 0, changeClock = position) {
  const settings = shapeSettings(value);
  return {
    aspect,
    ...motionAt(settings, position, changeClock),
    shape: indexOf(SHAPES, settings.shape, 'shape'),
    region: indexOf(REGIONS, settings.region, 'region'),
    outline: indexOf(OUTLINES, settings.outline, 'outline'),
    edge: settings.edge,
    sizeX: settings.width,
    sizeY: settings.proportional ? settings.width * aspect : settings.height,
  };
}

// How far (x, y) is from the centre in the outline's own measure.
function measure(outline, x, y) {
  if (outline === 1) return Math.max(Math.abs(x), Math.abs(y));
  if (outline === 2) return Math.abs(x) + Math.abs(y);
  return Math.hypot(x, y);
}

// How much of a layer is present where the area's measure is `area` (1 on
// its outline): 1 inside its region, 0 outside, and a smooth ramp across the
// border when it has a soft edge. Two layers with opposite regions and the
// same area and softness always add up to exactly 1.
export function regionCoverage(region, area, edge = 0) {
  if (region === 0) return 1;
  const soft = Math.max(edge, MIN_EDGE);
  const t = Math.min(1, Math.max(0, (area - (1 - soft)) / (2 * soft)));
  const outside = t * t * (3 - 2 * t);
  return region === 1 ? 1 - outside : outside;
}

// Where a layer is sampled for the panel position (u, v), each 0..1 with v
// upwards, how much of it is present there (`coverage`, 0..1), and whether
// it shows at all.
export function shapeLookup(value, u, v, aspect = 1, position = 0) {
  const { shape, region, outline, sizeX, sizeY, angle, zoom, edge } = shapeUniforms(value, aspect, position);
  const px = (u - 0.5) * 2, py = (v - 0.5) * 2;
  // 1 on the area's outline, and 1 on the same outline scaled to the panel.
  const area = measure(outline, px / sizeX, py / sizeY), panel = measure(outline, px, py);
  const coverage = regionCoverage(region, area, edge);
  // With a hard edge the outline itself belongs to the outer region.
  const visible = edge > 0 ? coverage > 0 : region === 1 ? area < 1 : region === 2 ? area >= 1 : true;
  if (shape === 0) {
    if (angle === 0 && zoom === 1) return { u, v, visible, coverage };
    // Turn and swell about the centre, in pixel proportions so a turn does not
    // skew, and reflect at the pattern's edges so nothing is left empty.
    const qx = (u - 0.5) * aspect, qy = v - 0.5;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const reflect = (value) => Math.abs(((value + 1) % 2 + 2) % 2 - 1);
    return {
      u: reflect((qx * cos - qy * sin) / zoom / aspect + 0.5),
      v: reflect((qx * sin + qy * cos) / zoom + 0.5),
      visible, coverage,
    };
  }
  // The pattern's height spans the layer's own region: centre to panel, centre
  // to the area's outline, or the outline to the panel, along each ray.
  const along = region === 1 ? area : region === 2 ? panel * (area - 1) / Math.max(area - panel, 1e-4) : panel;
  const fraction = Math.min(1, Math.max(0, along)) / zoom;
  // Mirrored round the centre, so the pattern's left edge is at the top and
  // its right edge at the bottom on both sides, with no seam. A spin slides
  // the pattern round.
  let turn = Math.atan2(px, py) / (Math.PI * 2) + 0.5 + angle / (Math.PI * 2);
  turn -= Math.floor(turn);
  return { u: Math.abs(2 * turn - 1), v: shape === 1 ? 1 - fraction : fraction, visible, coverage };
}

// `vec4 shapedLayer(sampler2D layer, vec2 uv, int shape, int region, int outline,
//                   vec2 size, vec2 motion, float aspect, float edge)`
// where motion is (angle, zoom). Alpha is how much of the layer is present:
// 1 inside its region, 0 outside, ramping across a soft border, so the
// compositor can tell "not here" from "black here".
export const SHAPE_GLSL = `
float outlineMeasure(int outline, vec2 q) {
  if (outline == 1) return max(abs(q.x), abs(q.y));
  if (outline == 2) return abs(q.x) + abs(q.y);
  return length(q);
}
vec4 shapedLayer(sampler2D layer, vec2 uv, int shape, int region, int outline, vec2 size, vec2 motion, float aspect, float edge) {
  vec2 p = (uv - 0.5) * 2.0;
  float area = outlineMeasure(outline, p / size);
  float coverage = 1.0;
  if (region != 0) {
    float soft = max(edge, ${MIN_EDGE});
    float outside = smoothstep(1.0 - soft, 1.0 + soft, area);
    coverage = region == 1 ? 1.0 - outside : outside;
  }
  if (coverage <= 0.0) return vec4(0.0);
  if (shape == 0) {
    vec2 q = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float c = cos(motion.x);
    float s = sin(motion.x);
    q = vec2(q.x * c - q.y * s, q.x * s + q.y * c) / motion.y;
    vec2 at = vec2(q.x / aspect, q.y) + 0.5;
    return vec4(texture2D(layer, abs(mod(at + 1.0, 2.0) - 1.0)).rgb, coverage);
  }
  float panel = outlineMeasure(outline, p);
  float along = panel;
  if (region == 1) along = area;
  else if (region == 2) along = panel * (area - 1.0) / max(area - panel, 0.0001);
  float fraction = clamp(along, 0.0, 1.0) / motion.y;
  float turn = fract(atan(p.x, p.y) / 6.2831853 + 0.5 + motion.x / 6.2831853);
  return vec4(texture2D(layer, vec2(abs(2.0 * turn - 1.0), shape == 1 ? 1.0 - fraction : fraction)).rgb, coverage);
}
`;
