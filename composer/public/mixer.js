// Two-layer effect mixing. Layer A is the selected pattern and layer B a
// second pattern; a blend mode combines them per pixel on RGB in 0..1.
//
// Transitions move from A (amount 0) to B (amount 1). Combine modes compute
// a blend of both layers and use amount as its strength over plain A.
// Each mode carries the GLSL the compositor runs and the same maths in
// JavaScript, which the tests use as the reference.

const HALF_PI = Math.PI / 2;
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const perChannel = (fn) => (a, b) => [fn(a[0], b[0]), fn(a[1], b[1]), fn(a[2], b[2])];

export const BLEND_MODES = [
  {
    id: 'crossfade', name: 'Progressive crossfade (linear)', kind: 'transition',
    glsl: 'mix(a, b, t)',
    js: (a, b, t) => a.map((value, c) => value + (b[c] - value) * t),
  },
  {
    id: 'equal-power', name: 'Equal-power crossfade', kind: 'transition',
    glsl: 'a * cos(t * 1.5707963) + b * sin(t * 1.5707963)',
    js: (a, b, t) => a.map((value, c) => value * Math.cos(t * HALF_PI) + b[c] * Math.sin(t * HALF_PI)),
  },
  {
    id: 'dip-to-black', name: 'Dip to black', kind: 'transition',
    glsl: 'a * max(0.0, 1.0 - 2.0 * t) + b * max(0.0, 2.0 * t - 1.0)',
    js: (a, b, t) => a.map((value, c) => value * Math.max(0, 1 - 2 * t) + b[c] * Math.max(0, 2 * t - 1)),
  },
  {
    id: 'average', name: '50/50 average', kind: 'combine',
    glsl: '(a + b) * 0.5',
    js: perChannel((a, b) => (a + b) / 2),
  },
  {
    id: 'add', name: 'Add', kind: 'combine',
    glsl: 'min(a + b, 1.0)',
    js: perChannel((a, b) => Math.min(a + b, 1)),
  },
  {
    id: 'screen', name: 'Screen', kind: 'combine',
    glsl: '1.0 - (1.0 - a) * (1.0 - b)',
    js: perChannel((a, b) => 1 - (1 - a) * (1 - b)),
  },
  {
    id: 'multiply', name: 'Multiply', kind: 'combine',
    glsl: 'a * b',
    js: perChannel((a, b) => a * b),
  },
  {
    id: 'lighten', name: 'Max (lighten)', kind: 'combine',
    glsl: 'max(a, b)',
    js: perChannel(Math.max),
  },
  {
    id: 'darken', name: 'Min (darken)', kind: 'combine',
    glsl: 'min(a, b)',
    js: perChannel(Math.min),
  },
  {
    id: 'overlay', name: 'Overlay', kind: 'combine',
    glsl: 'mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a))',
    js: perChannel((a, b) => a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)),
  },
  {
    id: 'difference', name: 'Difference', kind: 'combine',
    glsl: 'abs(a - b)',
    js: perChannel((a, b) => Math.abs(a - b)),
  },
  {
    // Layer B's brightness cuts layer A: A shows only where B is lit.
    id: 'stencil', name: 'Stencil (B brightness masks A)', kind: 'combine',
    glsl: 'a * dot(b, vec3(0.2126, 0.7152, 0.0722))',
    js: (a, b) => a.map(value => value * luma(b)),
  },
];

export const MIXER_DEFAULTS = { enabled: false, patternId: 'plasma', mode: 'screen', amount: 0.5 };

export function blendModeIndex(id) {
  const index = BLEND_MODES.findIndex(mode => mode.id === id);
  if (index < 0) throw new Error(`Unknown blend mode: ${id}`);
  return index;
}

export function mixerSettings(value = MIXER_DEFAULTS, patternIds = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Mixer settings must be an options object.');
  const result = { ...MIXER_DEFAULTS, ...value };
  if (typeof result.enabled !== 'boolean') throw new Error('Mixer enabled must be boolean.');
  if (typeof result.patternId !== 'string' || (patternIds && !patternIds.includes(result.patternId)))
    throw new Error(`Unknown mixer pattern: ${result.patternId}`);
  blendModeIndex(result.mode);
  if (!Number.isFinite(result.amount) || result.amount < 0 || result.amount > 1)
    throw new Error('Mixer amount must be between 0 and 1.');
  return { enabled: result.enabled, patternId: result.patternId, mode: result.mode, amount: result.amount };
}

// Reference result for one pixel; a and b are [r, g, b] in 0..1.
export function blendPixel(modeId, a, b, amount) {
  const mode = BLEND_MODES[blendModeIndex(modeId)];
  const mixed = mode.kind === 'transition' ? mode.js(a, b, amount) :
    mode.js(a, b).map((value, c) => a[c] + (value - a[c]) * amount);
  return mixed.map(value => Math.min(1, Math.max(0, value)));
}

// The result for one pixel when each layer may be limited to a region.
// `coversA` and `coversB` say how much of each layer is present there, from
// 0 to 1 (true and false count as 1 and 0). Blending only happens where the
// layers overlap; where one is absent the other shows as it is, whatever the
// blend, so a region never blacks out the layer beneath it. Across a soft
// border between two opposite regions the overlap is nil and the picture is
// a plain crossfade from one layer to the other.
export function compositePixel(modeId, a, b, amount, coversA = true, coversB = true) {
  const wa = Number(coversA), wb = Number(coversB);
  const both = Math.max(0, wa + wb - 1);
  const blended = both > 0 ? blendPixel(modeId, a, b, amount) : [0, 0, 0];
  return a.map((value, c) => blended[c] * both + value * (wa - both) + b[c] * (wb - both));
}

// One input's brightness and gamma trim (T16), applied to its pattern before
// it is mixed: the colour to the power gamma, times brightness. At the
// defaults (1, 1) the colour is returned untouched, not merely recomputed,
// so an untrimmed input is exactly what it was.
export function trimPixel(rgb, brightness = 1, gamma = 1) {
  if (brightness === 1 && gamma === 1) return rgb;
  return rgb.map((value) => value ** gamma * brightness);
}

// `vec4 trimmed(vec4 layer, vec2 trim)` for the compositor, trim being
// (brightness, gamma); alpha, the layer's coverage, is kept.
export const TRIM_GLSL = `
vec4 trimmed(vec4 layer, vec2 trim) {
  if (trim.x == 1.0 && trim.y == 1.0) return layer;
  return vec4(pow(layer.rgb, vec3(trim.y)) * trim.x, layer.a);
}
`;

// `vec3 compositeLayers(vec4 a, vec4 b, int mode, float t)` for the
// compositor; alpha is how much of each layer is present.
export const COMPOSITE_GLSL = `
vec3 compositeLayers(vec4 a, vec4 b, int mode, float t) {
  float both = max(0.0, a.a + b.a - 1.0);
  return blendLayers(a.rgb, b.rgb, mode, t) * both + a.rgb * (a.a - both) + b.rgb * (b.a - both);
}
`;

// `vec3 blendLayers(vec3 a, vec3 b, int mode, float t)` for the compositor.
export const BLEND_GLSL = `
vec3 blendLayers(vec3 a, vec3 b, int mode, float t) {
  vec3 c = a;
${BLEND_MODES.map((mode, index) => `  ${index ? 'else ' : ''}if (mode == ${index}) c = ${
    mode.kind === 'transition' ? mode.glsl : `mix(a, ${mode.glsl}, t)`};`).join('\n')}
  return clamp(c, 0.0, 1.0);
}
`;
