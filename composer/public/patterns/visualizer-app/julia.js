// Julia Flow: a Julia set that morphs as its constant travels round the edge
// of the Mandelbrot set's main cardioid, faster for a moment on each beat.
// Not from visualizer-app: created by Claude (Anthropic), through Claude Code,
// for MatrixPrism at Anjin's request (GPL-3.0-or-later), to sit in this group
// beside Raymarching, whose Flow motion it shares.
//
// The cardioid's edge, c = e^(iθ)/2 - e^(2iθ)/4, is standard; the smooth
// colouring is the renormalised iteration count, n - log2(log2 |z|^2), after
// Linas Vepstas (1997).

const TAU = Math.PI * 2;

// The JavaScript half: where c is on the cardioid, the turn, the zoom and the
// colour's drift, stepped on the composer's clock. The turn and the drift add
// up their speeds over time, so moving Spin or Colour speed does not jump.
export class JuliaFlow {
  constructor(random = Math.random) {
    this.theta = random() * TAU;
    this.turn = 0;
    this.drift = 0;
    this.surge = 0;
    this.bass = 0;
    this.lastBeat = 0;
    this.lastTime = null;
  }

  uniforms(state, params = {}) {
    const seconds = state.auroraTime ?? state.time ?? 0;
    // At most a tenth of a second at once, so a stall does not leap.
    const dt = this.lastTime === null ? 0 : Math.min(0.1, Math.max(0, seconds - this.lastTime));
    this.lastTime = seconds;
    const beat = state.audio?.beat ?? 0;
    if (beat >= 1 && this.lastBeat < 1) this.surge += params.surge ?? 1.5;
    this.lastBeat = beat;
    // Cruising, a full turn of the cardioid takes about two minutes.
    this.theta = (this.theta + dt * 0.05 * (1 + this.surge)) % TAU;
    this.surge *= Math.exp(-dt / 0.5);
    this.bass += ((state.audio?.bass ?? 0) - this.bass) * Math.min(1, dt * 4);
    this.turn = (this.turn + dt * (params.spin ?? 0.03)) % TAU;
    this.drift = (this.drift + dt * (params.drift ?? 0.02)) % 1;
    // On the edge, where the sets are most intricate; the bass pushes c
    // outward, where the set breaks into finer filaments.
    const r = 1.0 + 0.05 * this.bass;
    const c = [
      r * (Math.cos(this.theta) / 2 - Math.cos(2 * this.theta) / 4),
      r * (Math.sin(this.theta) / 2 - Math.sin(2 * this.theta) / 4),
      this.drift,
    ];
    return {
      julia_c: c,
      julia_turn: this.turn,
      julia_zoom: 1.0 - 0.08 * this.bass,
    };
  }
}

export const JULIA_GLSL = `
uniform vec3 julia_c;
uniform float julia_turn;
uniform float julia_zoom;

vec3 render() {
  vec2 p = centered();
  // Segments: the picture folded into mirrored wedges round the centre.
  if (p_segments > 1.5) {
    float wedge = TAU / p_segments;
    float a = mod(atan(p.y, p.x), wedge);
    a = min(a, wedge - a);
    p = length(p) * vec2(cos(a), sin(a));
  }
  vec2 z = rot(julia_turn) * p * 2.9 * julia_zoom / p_zoom;
  float n = 0.0;
  float m2 = 0.0;
  for (int i = 0; i < 256; i++) {
    if (float(i) >= p_detail) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + julia_c.xy;
    m2 = dot(z, z);
    if (m2 > 256.0) break;
    n += 1.0;
  }
  // Inside the set: dark.
  if (m2 <= 256.0) return vec3(0.0);
  float sn = n - log2(log2(m2)) + 4.0;
  // Brighter toward the set's edge, where escape takes longest; on a fixed
  // scale, so Detail adds filaments without dimming the rest.
  float glow = sqrt(clamp(sn / 28.0, 0.0, 1.0));
  return pal(sn * p_bands + julia_c.z + p_shift) * glow;
}
`;
