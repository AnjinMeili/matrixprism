import { AURORA_PATTERNS } from './aurora-patterns.js';
import { FIBONACCI_PATTERNS } from './fibonacci-patterns.js';
import { DIGITS, SPECTRUM_PATTERN } from './spectrum-plot.js';
import { MEDIA_PATTERN } from './media.js';
import { PANEL_RANGE_PATTERN } from './test-card.js';
import { BEAT_GRAPH_PATTERN } from './beat-graph.js';
import { FIRE_PATTERN } from './fire.js';
import { MARK_ESTES_PATTERNS } from './patterns/mark-estes/index.js';
import { AURORADROP_PATTERNS } from './patterns/auroradrop/index.js';

// Shader patterns define `vec3 render()`; Aurora ports use stateful RGB buffers.
// The shared prelude provides audio uniforms, palette, noise and helpers.
// u_time is accumulated in JavaScript, so it already includes the speed control.
export const PRELUDE = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_bass;
uniform float u_mid;
uniform float u_treble;
uniform float u_level;
uniform float u_beat;
uniform float u_hue;
uniform sampler2D u_spectrum;
uniform sampler2D u_wave;
uniform sampler2D u_history;
uniform float u_history_head;
uniform float u_history_rows;
uniform float u_key_number;
uniform float u_key_minor;
uniform float u_key_confidence;
#define PI 3.14159265
#define TAU 6.2831853

float spec(float x) { return texture2D(u_spectrum, vec2(clamp(x, 0.0, 1.0) * 0.996 + 0.002, 0.5)).r; }
float wave(float x) { return texture2D(u_wave, vec2(clamp(x, 0.0, 1.0) * 0.996 + 0.002, 0.5)).r * 2.0 - 1.0; }
float history(float x, float age) {
  float row = mod(u_history_head - 1.0 - floor(clamp(age, 0.0, 1.0) * (u_history_rows - 1.0)) + u_history_rows, u_history_rows);
  return texture2D(u_history, vec2(clamp(x, 0.001953125, 0.998046875), (row + 0.5) / u_history_rows)).r;
}
vec3 pal(float t) { return 0.5 + 0.5 * cos(TAU * (t + u_hue + vec3(0.0, 0.33, 0.67))); }
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
vec2 centered() { return (gl_FragCoord.xy - 0.5 * u_res) / u_res.y; }
vec2 uv01() { return gl_FragCoord.xy / u_res; }
`;

export const PATTERNS = [
  SPECTRUM_PATTERN,
  BEAT_GRAPH_PATTERN,
  MEDIA_PATTERN,
  FIRE_PATTERN,
  {
    id: 'camelot-wheel',
    // The wheel's colours identify keys, so key-driven hue must not shift them.
    manualHue: true,
    name: 'Camelot Wheel',
    audio: 'DJ harmonic mixing: minor A inside, major B outside; detected key bright, +/-1 and same-number A/B neighbours highlighted',
    params: [
      { id: 'labels', name: 'Key numbers', type: 'bool', default: true, help: 'Draw the key numbers on panels at least 128 pixels across' },
      { id: 'ripple', name: 'Beat ripple', type: 'bool', default: true, help: 'Send a ring in the key\'s colour from the hub on each beat' },
    ],
    glsl: `
float glyph(vec2 p, float code) {
  vec2 cell = floor(p);
  if (cell.x < 0.0 || cell.x >= 3.0 || cell.y < 0.0 || cell.y >= 5.0) return 0.0;
  return mod(floor(code / exp2(cell.x + (4.0 - cell.y) * 3.0)), 2.0);
}
float digit(vec2 p, float n) {
  float code = ${DIGITS[0]}.0;
${DIGITS.slice(1).map((code, i) => `  ${i ? 'else ' : ''}if (n == ${i + 1}.0) code = ${code}.0;`).join('\n')}
  return glyph(p, code);
}
float label(vec2 p, float n, float minor) {
  float width = n >= 10.0 ? 11.0 : 7.0;
  p += vec2(width * 0.5, 2.5);
  float ink;
  if (n >= 10.0) {
    ink = digit(p, 1.0) + digit(p - vec2(4.0, 0.0), n - 10.0);
    p.x -= 8.0;
  } else {
    ink = digit(p, n);
    p.x -= 4.0;
  }
  return min(1.0, ink + glyph(p, minor > 0.5 ? 23530.0 : 15083.0));
}
vec3 render() {
  float side = min(u_res.x, u_res.y);
  vec2 p = (gl_FragCoord.xy - u_res * 0.5) / side;
  float r = length(p);
  // 12 at the top; numbers advance clockwise.
  float sector = mod(atan(p.x, p.y) / TAU * 12.0 + 12.0, 12.0);
  float index = mod(floor(sector + 0.5), 12.0);
  float number = index < 0.5 ? 12.0 : index;
  float minor = r < 0.325 ? 1.0 : 0.0;
  float inside = step(0.17, r) * (1.0 - step(0.48, r));
  float valid = step(0.5, u_key_number);
  float distance = abs(number - u_key_number);
  distance = min(distance, 12.0 - distance);
  float sameRing = 1.0 - abs(minor - u_key_minor);
  float selected = valid * (1.0 - step(0.5, distance)) * sameRing;
  float neighbor = valid * ((1.0 - step(0.5, abs(distance - 1.0))) * sameRing +
    (1.0 - step(0.5, distance)) * (1.0 - sameRing));
  vec3 colour = pal((number - 1.0) / 12.0);
  vec3 keyColour = pal((u_key_number - 1.0) / 12.0);
  // The detected key kicks on the beat. The keys that mix with it breathe
  // with the level, each a little out of step with its neighbour, and stay
  // dimmer than the key itself.
  float breathe = 0.5 + 0.5 * sin(u_time * 2.5 + number * 1.7 + minor * 2.4);
  float strength = 0.12 + neighbor * (0.16 + 0.16 * u_level + 0.08 * breathe) +
    selected * (0.45 + 0.15 * u_key_confidence + 0.45 * u_beat);
  float gap = step(0.045, 0.5 - abs(sector - floor(sector + 0.5)));
  float ringGap = step(1.2 / side, abs(r - 0.325));
  vec3 col = colour * strength * inside * gap * ringGap;
  // Each beat sends a ring in the key's colour from the hub to the rim,
  // fading as it goes.
  float ripple = 1.0 - smoothstep(0.0, 0.035, abs(r - mix(0.48, 0.15, u_beat)));
  col += keyColour * ripple * u_beat * valid * inside * 0.6 * p_ripple;
  float angle = index * TAU / 12.0;
  vec2 direction = vec2(sin(angle), cos(angle));
  float labelRadius = minor > 0.5 ? 0.252 : 0.403;
  float pixel = max(1.0, floor(side / 190.0));
  vec2 text = (p - direction * labelRadius) * side / pixel;
  float ink = side >= 128.0 && p_labels > 0.5 ? label(text, number, minor) : 0.0;
  col = mix(col, vec3(0.65 + selected * 0.35), ink * inside);
  float centre = (1.0 - smoothstep(0.10, 0.14, r)) * valid;
  // The hub falls nearly to black between beats and comes up to the key's
  // full colour on each. A change between two bright levels showed in the
  // preview and hardly at all on the LED panel.
  col += keyColour * centre * (0.03 + 0.12 * u_level + 0.85 * u_beat);
  return col;
}`,
  },
  {
    id: 'plasma',
    name: 'Plasma Pulse',
    audio: 'Bass swells the rings, mids shift colour, beats flash',
    params: [
      { id: 'scale', name: 'Scale', min: 0.5, max: 8, step: 0.1, default: 3, help: 'How many waves fit across the panel' },
      { id: 'swell', name: 'Bass swell', min: 0, max: 2, step: 0.05, default: 0.6, help: 'How far the bass swells the rings' },
      { id: 'flash', name: 'Beat flash', min: 0, max: 1, step: 0.05, default: 0.4, help: 'How much each beat brightens the picture' },
    ],
    glsl: `
vec3 render() {
  vec2 p = centered() * p_scale;
  float t = u_time;
  float v = sin(p.x * 1.3 + t) + sin(p.y * 1.7 - t * 1.3) + sin((p.x + p.y) * 1.1 + t * 0.7);
  v += sin(length(p * (1.0 + u_bass * p_swell)) * 2.5 - t * 2.0);
  vec3 col = pal(v * 0.25 + 0.5 + u_mid * 0.3);
  return col * (0.55 + 0.45 * u_level + p_flash * u_beat);
}`,
  },
  {
    id: 'bars',
    name: 'Spectrum Bars',
    audio: 'Mirrored log spectrum, bass in the centre',
    params: [
      { id: 'bars', name: 'Bars each side', min: 4, max: 96, step: 1, default: 48, help: 'How many bars from the centre to each edge' },
      { id: 'gap', name: 'Gap', min: 0, max: 0.8, step: 0.01, default: 0.18, help: 'The gap between bars, as a share of a bar' },
      { id: 'glow', name: 'Beat glow', min: 0, max: 0.5, step: 0.01, default: 0.12, help: 'How much each beat lights the background' },
    ],
    glsl: `
vec3 render() {
  vec2 uv = uv01();
  float bars = p_bars;
  float x = abs(uv.x * 2.0 - 1.0);
  float idx = floor(x * bars) / bars;
  float h = spec(idx * 0.92);
  float inBar = step(uv.y, h) * step(p_gap, fract(x * bars));
  vec3 col = pal(idx * 0.6 + uv.y * 0.3);
  float cap = smoothstep(2.5 / u_res.y, 0.0, abs(uv.y - h)) * step(p_gap, fract(x * bars));
  vec3 bg = pal(0.55) * (0.03 + p_glow * u_beat) * (1.0 - uv.y);
  return col * (inBar * (0.35 + 0.65 * uv.y / max(h, 0.01)) + cap) + bg;
}`,
  },
  {
    id: 'waterfall',
    name: 'Spectral Waterfall',
    audio: 'Scrolling spectrogram: bass left, treble right, newest at the bottom; blue to white shows increasing energy',
    params: [
      { id: 'fade', name: 'Quiet fade', min: 0.01, max: 0.5, step: 0.01, default: 0.12, help: 'Energy below this fades to black, hiding the quietest sound' },
      { id: 'heat', name: 'Heat', min: 0.1, max: 0.9, step: 0.01, default: 0.4, help: 'The energy at which blue turns to red; lower shows more red' },
    ],
    glsl: `
vec3 render() {
  vec2 uv = uv01();
  float energy = history(uv.x, uv.y);
  vec3 cold = vec3(0.02, 0.08, 0.55);
  vec3 warm = vec3(1.0, 0.18, 0.02);
  vec3 col = mix(cold, vec3(0.0, 0.85, 0.9), smoothstep(0.05, p_heat, energy));
  col = mix(col, warm, smoothstep(p_heat, 0.75, energy));
  col = mix(col, vec3(1.0, 0.95, 0.75), smoothstep(0.75, 1.0, energy));
  return mix(col, col.gbr, u_hue) * smoothstep(0.0, p_fade, energy);
}`,
  },
  {
    id: 'radial',
    name: 'Radial Spectrum',
    audio: 'Spectrum wrapped around a ring that breathes with the bass',
    params: [
      { id: 'spin', name: 'Spin', min: -1, max: 1, step: 0.05, default: 0.2, help: 'Turns per unit of time; below 0 turns the other way' },
      { id: 'size', name: 'Ring size', min: 0.05, max: 0.4, step: 0.01, default: 0.16, help: 'The radius of the quiet ring' },
      { id: 'reach', name: 'Reach', min: 0.05, max: 0.6, step: 0.01, default: 0.32, help: 'How far loud frequencies reach out from the ring' },
    ],
    glsl: `
vec3 render() {
  vec2 p = centered() * rot(u_time * p_spin);
  float r = length(p);
  float x = abs(atan(p.y, p.x)) / PI;
  float s = spec(x * 0.85);
  float base = p_size + 0.08 * u_bass;
  float edge = base + s * p_reach;
  float ring = smoothstep(0.015, 0.0, abs(r - edge));
  float fill = step(r, edge) * step(base, r) * (r - base) / (edge - base + 0.001);
  vec3 col = pal(x * 0.5 + u_time * 0.05);
  float core = exp(-r * 10.0) * (0.3 + u_beat);
  return col * (ring + fill * 0.7) + pal(0.6) * core;
}`,
  },
  {
    id: 'tunnel',
    name: 'Tunnel',
    audio: 'Ring brightness follows the spectrum by depth; beats flash the core',
    params: [
      { id: 'spin', name: 'Spin', min: -1, max: 1, step: 0.05, default: 0.1, help: 'How fast the tunnel turns; below 0 turns the other way' },
      { id: 'speed', name: 'Speed', min: 0, max: 5, step: 0.1, default: 1.5, help: 'How fast the rings come towards you' },
      { id: 'rings', name: 'Ring density', min: 1, max: 16, step: 0.5, default: 6, help: 'How close together the rings are' },
      { id: 'spokes', name: 'Spokes', min: 0, max: 16, step: 1, default: 8, help: 'How many spokes run down the tunnel' },
    ],
    glsl: `
vec3 render() {
  vec2 p = centered() * rot(u_time * p_spin + u_mid * 0.4);
  float r = length(p) + 0.001;
  float a = atan(p.y, p.x) / PI;
  float z = 0.3 / r + u_time * p_speed;
  float rings = 0.5 + 0.5 * sin(z * p_rings);
  float spokes = 0.5 + 0.5 * sin(a * PI * p_spokes + z * 1.5);
  vec3 col = pal(z * 0.08 + a * 0.1) * mix(rings, rings * spokes, 0.5);
  col *= smoothstep(0.0, 0.3, r) * (0.45 + 1.2 * spec(clamp(r * 1.3, 0.0, 1.0)));
  col += pal(0.1) * u_beat * exp(-r * 3.0) * 0.8;
  return col;
}`,
  },
  {
    id: 'flow',
    name: 'Flow Field',
    audio: 'Bass deepens the warp, treble adds shimmer',
    params: [
      { id: 'zoom', name: 'Zoom', min: 0.5, max: 6, step: 0.1, default: 2, help: 'How much of the field fits on the panel; higher shows more, finer' },
      { id: 'drift', name: 'Drift', min: 0, max: 1, step: 0.01, default: 0.15, help: 'How fast the field moves' },
      { id: 'warp', name: 'Warp', min: 0, max: 8, step: 0.1, default: 3, help: 'How strongly the field folds on itself, before the bass adds more' },
    ],
    glsl: `
vec3 render() {
  vec2 p = centered() * p_zoom;
  float t = u_time * p_drift;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 1.5), fbm(p + 4.0 * q + vec2(8.3, 2.8)));
  float f = fbm(p + (p_warp + u_bass * 2.0) * r);
  vec3 col = pal(f * 1.2 + q.x * 0.5);
  col *= 0.4 + f * f * 1.6;
  col += u_treble * 0.3 * pal(r.y);
  return col * (0.8 + 0.4 * u_beat);
}`,
  },
  {
    id: 'kaleido',
    name: 'Kaleidoscope',
    audio: 'Bass zooms, mids rotate the palette',
    params: [
      { id: 'segments', name: 'Mirrors', min: 2, max: 16, step: 1, default: 6, help: 'How many mirrored slices make the circle' },
      { id: 'spin', name: 'Spin', min: -1, max: 1, step: 0.05, default: 0.15, help: 'How fast it turns; below 0 turns the other way' },
      { id: 'zoom', name: 'Zoom', min: 0.5, max: 6, step: 0.1, default: 2.5, help: 'How much of the pattern each slice shows, before the bass zooms it' },
    ],
    glsl: `
vec3 render() {
  vec2 p = centered() * rot(u_time * p_spin);
  float segs = p_segments;
  float a = atan(p.y, p.x);
  float r = length(p);
  a = mod(a, TAU / segs);
  a = abs(a - PI / segs);
  p = vec2(cos(a), sin(a)) * r * (p_zoom + u_bass);
  float f = fbm(p + vec2(u_time * 0.3, -u_time * 0.2));
  float g = fbm(p * 1.7 - f * 2.0);
  vec3 col = pal(g + r * 0.6 + u_mid * 0.4);
  col *= smoothstep(0.25, 0.75, g) * 1.4;
  return col + u_beat * 0.25 * pal(r);
}`,
  },
  {
    id: 'scope',
    name: 'Oscilloscope',
    audio: 'Live waveform with echo traces',
    params: [
      { id: 'traces', name: 'Traces', min: 1, max: 4, step: 1, default: 3, help: 'The waveform and its echoes, each taller and fainter' },
      { id: 'height', name: 'Height', min: 0.1, max: 0.5, step: 0.01, default: 0.42, help: 'How tall the waveform is drawn' },
      { id: 'grid', name: 'Grid', type: 'bool', default: true, help: 'Draw the faint scope grid' },
    ],
    glsl: `
vec3 render() {
  vec2 uv = uv01();
  vec3 col = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    if (fk >= p_traces) break;
    float y = 0.5 + wave(uv.x) * p_height * (1.0 + fk * 0.35);
    float d = abs(uv.y - y) * u_res.y;
    col += pal(fk * 0.2 + uv.x * 0.3 + u_time * 0.05) *
           (exp(-d * 0.7) + 0.25 * exp(-d * 0.12)) * (1.0 - fk * 0.3);
  }
  vec2 g = abs(fract(uv * vec2(8.0, 6.0)) - 0.5);
  col += vec3(0.05) * step(0.47, max(g.x, g.y)) * p_grid;
  return col * (0.7 + 0.5 * u_level);
}`,
  },
  {
    id: 'metaballs',
    name: 'Metaballs',
    audio: 'Each blob grows with its own frequency band',
    params: [
      { id: 'blobs', name: 'Blobs', min: 1, max: 12, step: 1, default: 6, help: 'How many blobs; each follows its own frequency band' },
      { id: 'size', name: 'Size', min: 0.02, max: 0.2, step: 0.005, default: 0.08, help: 'Each blob\'s size before the music adds to it' },
    ],
    glsl: `
vec3 render() {
  vec2 p = centered();
  float field = 0.0;
  vec3 tint = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    if (fi >= p_blobs) break;
    vec2 c = vec2(sin(u_time * (0.5 + fi * 0.13) + fi * 1.7) * 0.55,
                  cos(u_time * (0.4 + fi * 0.11) + fi * 2.3) * 0.35);
    float rad = p_size + 0.06 * spec(fi / p_blobs * 0.7) + 0.04 * u_bass;
    vec2 d = p - c;
    float v = rad * rad / max(dot(d, d), 0.0001);
    field += v;
    tint += pal(fi / p_blobs) * v;
  }
  tint /= max(field, 0.0001);
  float body = smoothstep(0.9, 1.1, field);
  float glow = clamp(field * 0.4, 0.0, 1.0);
  return tint * (body + glow * 0.3 + u_beat * 0.2);
}`,
  },
  {
    id: 'stars',
    name: 'Starfield',
    audio: 'Beats brighten the stars, treble adds twinkle',
    params: [
      { id: 'layers', name: 'Layers', min: 1, max: 8, step: 1, default: 5, help: 'How many layers of stars at different depths' },
      { id: 'speed', name: 'Speed', min: 0, max: 1, step: 0.01, default: 0.12, help: 'How fast you fly through them' },
      { id: 'density', name: 'Density', min: 0.05, max: 0.95, step: 0.05, default: 0.45, help: 'The share of places that hold a star' },
    ],
    glsl: `
vec3 render() {
  vec2 p = centered();
  vec3 col = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    if (fi >= p_layers) break;
    float z = fract(fi / p_layers + u_time * p_speed);
    float scale = mix(20.0, 1.5, z);
    float fade = smoothstep(0.0, 0.3, z) * smoothstep(1.0, 0.85, z);
    vec2 q = p * scale + fi * 17.3;
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = hash(id);
    vec2 off = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
    float d = length(f - off * 0.6);
    float star = smoothstep(0.06 + 0.08 * z, 0.0, d) * step(1.0 - p_density, h);
    float twinkle = 0.7 + 0.3 * sin(u_time * 9.0 + h * 40.0) * u_treble;
    col += pal(h + fi * 0.1) * star * fade * twinkle * (1.0 + u_beat);
  }
  return col;
}`,
  },
  {
    id: 'cells',
    name: 'Voronoi Cells',
    audio: 'Cell brightness follows the spectrum, edges flare on beats',
    params: [
      { id: 'scale', name: 'Cells across', min: 1, max: 12, step: 0.5, default: 4, help: 'How many cells fit across the panel\'s height' },
      { id: 'motion', name: 'Motion', min: 0, max: 3, step: 0.05, default: 0.8, help: 'How fast the cell centres wander' },
      { id: 'edge', name: 'Edge width', min: 0.01, max: 0.3, step: 0.01, default: 0.08, help: 'How wide the bright edges are, before beats widen them' },
    ],
    glsl: `
vec3 render() {
  vec2 p = centered() * p_scale;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 nearest = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash(i + g), hash(i + g + 19.1));
      o = 0.5 + 0.4 * sin(u_time * p_motion + TAU * o);
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; nearest = i + g; }
      else if (d < d2) { d2 = d; }
    }
  }
  float h = hash(nearest);
  float edge = smoothstep(p_edge + 0.1 * u_beat, 0.0, d2 - d1);
  vec3 col = pal(h * 0.6 + u_time * 0.03) * (0.25 + 0.75 * spec(h));
  col *= 1.0 - d1 * 0.6;
  col += edge * pal(h + 0.5) * (0.6 + u_beat);
  return col;
}`,
  },
  {
    id: 'rotating-wave',
    name: 'Rotating Wave',
    audio: 'Rotating waveform ribbons; bass spreads the echoes, treble brightens them',
    params: [
      { id: 'spin', name: 'Spin', min: -1, max: 1, step: 0.05, default: 0.35, help: 'How fast the ribbons turn; below 0 turns the other way' },
      { id: 'ribbons', name: 'Ribbons', min: 1, max: 6, step: 1, default: 4, help: 'The waveform and its echoes' },
    ],
    glsl: `
vec3 render() {
  vec2 p = centered() * rot(u_time * p_spin);
  float x = clamp(p.x + 0.5, 0.0, 1.0);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    if (fi >= p_ribbons) break;
    float y = wave(x) * (0.16 + fi * 0.035 + u_bass * 0.08);
    y += sin(p.x * 7.0 + u_time + fi) * 0.025;
    float d = abs(p.y - y) * u_res.y;
    col += pal(x * 0.55 + fi * 0.15 + u_time * 0.03) *
      exp(-d * 0.65) * (1.0 - fi * 0.15);
  }
  return col * (0.4 + u_level + u_treble * 0.4);
}`,
  },
  {
    id: 'circular-wave',
    name: 'Circular Wave',
    audio: 'Waveform bends concentric rings; bass expands them, beats light the centre',
    params: [
      { id: 'rings', name: 'Rings', min: 1, max: 8, step: 1, default: 4, help: 'How many rings' },
      { id: 'spacing', name: 'Spacing', min: 0.03, max: 0.2, step: 0.005, default: 0.085, help: 'The distance between rings' },
      { id: 'spin', name: 'Spin', min: -1, max: 1, step: 0.05, default: 0.25, help: 'How fast the waveform travels round the rings' },
    ],
    glsl: `
vec3 render() {
  vec2 p = centered();
  float r = length(p);
  float angle = atan(p.y, p.x);
  float x = 0.5 + 0.5 * cos(angle - u_time * p_spin);
  float signal = wave(x);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    if (fi >= p_rings) break;
    float radius = 0.12 + fi * p_spacing + u_bass * 0.045;
    radius += signal * (0.035 + fi * 0.014);
    float d = abs(r - radius) * u_res.y;
    col += pal(x * 0.5 + fi * 0.18) *
      (exp(-d * 0.8) + 0.12 * exp(-d * 0.15));
  }
  return col * (0.35 + u_level) + pal(0.15) * u_beat * exp(-r * 22.0);
}`,
  },
  {
    id: 'spectrum-tiles',
    name: 'Spectrum Tiles',
    audio: 'An 8 by 8 grid of frequency tiles; stronger bands fill and brighten each tile',
    params: [
      { id: 'grid', name: 'Grid', min: 2, max: 16, step: 1, default: 8, help: 'Tiles along each side; the spectrum is shared among them all' },
    ],
    glsl: `
vec3 render() {
  vec2 uv = uv01();
  vec2 cell = floor(uv * p_grid);
  vec2 local = fract(uv * p_grid) - 0.5;
  float band = (cell.x + cell.y * p_grid) / (p_grid * p_grid - 1.0);
  float energy = spec(band);
  float size = 0.12 + energy * 0.33;
  float distance = max(abs(local.x), abs(local.y));
  float edge = clamp(4.0 / min(u_res.x, u_res.y), 0.01, 0.08);
  float tile = 1.0 - smoothstep(size - edge, size, distance);
  vec3 col = pal(band * 0.75 + u_time * 0.04);
  return col * tile * (0.08 + energy * 1.1) +
    col * exp(-length(local) * 9.0) * u_beat * 0.12;
}`,
  },
  {
    id: 'spectral-rain',
    name: 'Spectral Rain',
    audio: 'Falling spectrum trails; bass on the left, treble on the right, beats widen drops',
    params: [
      { id: 'lane', name: 'Lane width', min: 2, max: 16, step: 1, default: 4, help: 'Pixels per lane of rain, until Most lanes is reached' },
      { id: 'lanes', name: 'Most lanes', min: 2, max: 64, step: 1, default: 32, help: 'The most lanes, however wide the panel; at 32, a 256-pixel panel has lanes 8 pixels wide' },
      { id: 'speed', name: 'Fall speed', min: 0, max: 1, step: 0.01, default: 0.13, help: 'How fast the drops fall, before each lane\'s own extra' },
    ],
    glsl: `
vec3 render() {
  vec2 uv = uv01();
  float lanes = clamp(floor(u_res.x / p_lane), 2.0, p_lanes);
  float lane = floor(uv.x * lanes);
  float band = lane / (lanes - 1.0);
  float energy = spec(band);
  float seed = hash(vec2(lane, 7.0));
  float head = fract(seed + u_time * (p_speed + seed * 0.18));
  float behind = fract(uv.y + head);
  float tail = exp(-behind * (12.0 - energy * 7.0));
  float width = 0.12 + 0.22 * energy + 0.05 * u_beat;
  float stripe = 1.0 - smoothstep(width, width + 0.08, abs(fract(uv.x * lanes) - 0.5));
  vec3 col = pal(band * 0.6 + seed * 0.2);
  return col * tail * stripe * (0.04 + energy * 1.3) +
    vec3(0.7, 0.9, 1.0) * exp(-behind * 100.0) * stripe * energy;
}`,
  },
  {
    id: 'aurora-curtains',
    name: 'Aurora Curtains',
    audio: 'Flowing light curtains; spectrum lifts the ribbons, bass swells their glow',
    params: [
      { id: 'curtains', name: 'Curtains', min: 1, max: 6, step: 1, default: 3, help: 'How many curtains, one above the next' },
      { id: 'drift', name: 'Drift', min: 0, max: 1, step: 0.01, default: 0.12, help: 'How fast the curtains fold' },
      { id: 'threads', name: 'Threads', min: 0, max: 200, step: 5, default: 100, help: 'How fine the vertical threads are' },
    ],
    glsl: `
vec3 render() {
  vec2 uv = uv01();
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    if (fi >= p_curtains) break;
    float x = uv.x * 2.5 + fi * 3.7;
    float fold = noise(vec2(x, u_time * p_drift + fi));
    float ridge = 0.2 + fi * 0.18 + fold * 0.22;
    ridge += spec(uv.x) * 0.16 + sin(x * 4.0 + u_time * 0.3) * 0.06;
    float d = uv.y - ridge;
    float ribbon = exp(-abs(d) * 35.0) +
      step(0.0, d) * exp(-d * 9.0) * 0.35;
    float threads = 0.65 + 0.35 * sin(uv.x * p_threads + fold * 12.0 + fi);
    col += pal(fi * 0.23 + uv.x * 0.25 + u_time * 0.025) *
      ribbon * threads * (0.3 + u_bass * 0.6 + u_mid * 0.5);
  }
  return col;
}`,
  },
  {
    id: 'triangle-pulse',
    name: 'Triangle Pulse',
    audio: 'Nested rotating triangles; bass expands the outlines, treble adds glow',
    params: [
      { id: 'triangles', name: 'Triangles', min: 1, max: 10, step: 1, default: 6, help: 'How many nested triangles' },
      { id: 'spin', name: 'Spin', min: -1, max: 1, step: 0.02, default: 0.22, help: 'How fast they turn; below 0 turns the other way' },
      { id: 'twist', name: 'Twist', min: 0, max: 1, step: 0.02, default: 0.16, help: 'How far each triangle turns from the one inside it' },
    ],
    glsl: `
vec3 render() {
  vec2 p = centered() * rot(u_time * p_spin);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    if (fi >= p_triangles) break;
    vec2 q = p * rot(fi * p_twist + u_mid * 0.35);
    float radius = 0.06 + fi * 0.065 + u_bass * 0.04;
    float edge = max(dot(q, vec2(0.0, 1.0)),
      max(dot(q, vec2(0.8660254, -0.5)), dot(q, vec2(-0.8660254, -0.5))));
    float d = abs(edge - radius) * u_res.y;
    float energy = spec(fi / max(1.0, p_triangles - 1.0));
    col += pal(fi * 0.14 + u_time * 0.04) *
      (exp(-d * 0.8) + u_treble * 0.12 * exp(-d * 0.18)) *
      (0.2 + energy + u_beat * 0.3);
  }
  return col;
}`,
  },
  PANEL_RANGE_PATTERN,
  ...AURORA_PATTERNS,
  ...FIBONACCI_PATTERNS,
  ...MARK_ESTES_PATTERNS,
  ...AURORADROP_PATTERNS,
];
