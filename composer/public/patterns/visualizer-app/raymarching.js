// WebGL Raymarching example, ported from visualizations/raymarching.js and
// the fragment shader in index.html of Spotify's visualizer-app, by
// Per-Olov Jernberg (possan), 2013. Copyright (c) 2013, Spotify AB, BSD
// 3-Clause; licence text in ./NOTICE.md. The shader is also marked "public
// domain" by its author.
//
// A flight through a lattice of square beams on all three axes, with small
// spheres between them pushed about by the waveform. A low hit jumps the
// flight forward and fattens the beams for an instant; mid and high hits
// turn the two colours by steps of 45 degrees. In Flow (not in the original)
// a low hit is a surge of speed that eases off instead of a jump, and the
// colours turn slowly.

import { BAND31, STEP, band31 } from './runtime.js';
import { BeatDetectionHelper } from './beatdetection-helper.js';

// Flow: a surge halves in about a third of a second, and the colours close
// 4% of the way to their targets each frame, taking about a second to turn,
// and a colour still more than 10 degrees from its target ignores hits.
const FLOW_EASE = Math.exp(-1 / 60 / 0.5);
const FLOW_HUE = 0.04;
const FLOW_SETTLED = 10;

function hslToRgb(h, s, l) {
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

// The JavaScript half: the clocks, the hues and the hits, stepped at 60 a
// second. `uniforms()` gives the shader's values for this frame.
export class Raymarching {
  constructor(random = Math.random) {
    this.random = random;
    this.helper = new BeatDetectionHelper();
    this.time = 0;
    this.beattime = 0.0;
    this.beatoffset = 0;
    this.targethue1 = 45;
    this.targethue2 = 180;
    this.hue1 = 0;
    this.hue2 = 0;
    this.left = new Float32Array(BAND31.length);
    this.right = new Float32Array(BAND31.length);
    this.lastTime = null;
    this.owed = 0;
    this.lastBeat = 0;
    this.lastBar = null;
    this.values = null;
    // Flow: extra speed, in multiples of the cruising speed, easing off.
    this.surge = 0;
  }

  beat1() {
    this.beatoffset += 5.0 + this.random() * 30.0;
    this.beattime = 0.0;
    while (this.time > 60.0) this.time -= 60.0;
    while (this.beatoffset > 60.0) this.beatoffset -= 60.0;
  }

  beat2() {
    this.targethue1 += 45 * Math.ceil(this.random() * 4.0);
  }

  beat3() {
    this.targethue2 += 45 * Math.ceil(this.random() * 4.0);
  }

  // One animation frame: render() then the rest of animate().
  animate(hits, flow, surge) {
    if (hits.low) {
      if (flow) {
        this.surge += surge;
        this.beattime = 0.0;
      } else {
        this.beat1();
      }
    }
    // In Flow a colour takes a new turn only once its last is nearly done.
    const settled = (hue, target) => !flow || Math.abs(target - hue) < FLOW_SETTLED;
    if (hits.mid && settled(this.hue1, this.targethue1)) this.beat2();
    if (hits.high && settled(this.hue2, this.targethue2)) this.beat3();
    // The shader's clock, worked out here in double precision: the camera's
    // three turns, and its place along the lattice, whose period is 10.
    const time = this.time + this.beatoffset;
    const z = (time * 3.0) % 10.0;
    this.values = {
      vz_rot: [
        Math.sin(2.32 + time * 0.037312) * 1.45 + 0.5,
        Math.cos(0.01 + time * 0.043312) * 1.45 + 0.5,
        Math.cos(1.80 + time * 0.023312) * 1.45 + 0.5,
      ],
      vz_z: z < 0 ? z + 10.0 : z,
      vz_beattime: this.beattime,
      vz_color1: hslToRgb((this.hue1 / 360.0) % 1.0, 1.0, 0.5),
      vz_color2: hslToRgb((this.hue2 / 360.0) % 1.0, 1.0, 0.5),
    };
    this.time += (1.0 + this.surge) / 60.0;
    this.surge *= FLOW_EASE;
    this.beattime += 1.0 / 60.0;
    this.hue1 += (this.targethue1 - this.hue1) * (flow ? FLOW_HUE : 0.5);
    this.hue2 += (this.targethue2 - this.hue2) * (flow ? FLOW_HUE : 0.1);
    this.helper.update();
  }

  // The hits for this composer frame: the original's detector, or the
  // composer's beat (low), bar (mid) and high band (high).
  hits(state, source) {
    if (source === 'composer') {
      const beat = state.audio?.beat ?? 0;
      const low = beat >= 1 && this.lastBeat < 1;
      this.lastBeat = beat;
      const bar = Number.isFinite(state.beatPosition) ? Math.floor(state.beatPosition / 4) : null;
      const mid = low && bar !== null && this.lastBar !== null && bar !== this.lastBar;
      if (low) this.lastBar = bar;
      return { low, mid, high: (state.audio?.highHits ?? 0) > 0 };
    }
    const { helper } = this;
    return { low: helper.low_peak, mid: helper.mid_peak, high: helper.high_peak };
  }

  uniforms(state, params = {}) {
    band31(state.spectrumLeft ?? state.spectrum, this.left);
    band31(state.spectrumRight ?? state.spectrum, this.right);
    this.helper.setData(this.left, this.right);
    let hits = this.hits(state, params.hits ?? 'original');
    const flow = (params.motion ?? 'flow') === 'flow';
    const surge = params.surge ?? 1.5;
    const seconds = state.auroraTime ?? state.time ?? 0;
    if (this.lastTime === null) {
      this.animate(hits, flow, surge);
    } else {
      this.owed += Math.min(1, Math.max(0, seconds - this.lastTime));
      const started = performance.now();
      while (this.owed >= STEP) {
        this.owed -= STEP;
        this.animate(hits, flow, surge);
        // A frame's hits fire once, on its first animation frame.
        hits = { low: false, mid: false, high: false };
        if (performance.now() - started > 100) {
          this.owed = 0;
          break;
        }
      }
    }
    this.lastTime = seconds;
    return this.values;
  }
}

// The fragment shader. The original's camera rotation, in global
// initialisers, is moved into render(), as GLSL ES 1.00 allows only constants
// there, and worked out in JavaScript (vz_rot, and vz_z for time * 3 within
// the lattice's period) so a long flight keeps its precision. `specSampler` was a 64 by 4 texture of the waveform, linearly
// filtered; specTexel() reads the same values from u_wave.
export const RAYMARCHING_GLSL = `
uniform vec3 vz_rot;
uniform float vz_z;
uniform float vz_beattime;
uniform vec3 vz_color1;
uniform vec3 vz_color2;

#define N 10
#define PI2 (3.14159265*2.0)

// Texel i of the original's texture held waveform sample floor(i * 64 / 256).
float specTexel(float i) {
  float o = floor(clamp(i, 0.0, 63.0) * 64.0 / 256.0);
  return texture2D(u_wave, vec2((o + 0.5) / 256.0, 0.5)).r;
}
float specSampler(float u) {
  float t = u * 64.0 - 0.5;
  float i0 = floor(t);
  return mix(specTexel(i0), specTexel(i0 + 1.0), t - i0);
}

float sdSphere( vec3 p, float s ) {
  return length(p)-s;
}

float udRoundBox( vec3 p, vec3 b, float r )
{
  return length(max(abs(p)-b,0.0))-r;
}

vec3 opRep( vec3 p, vec3 c ) {
    return mod(p,c)-0.5*c;
}

float dist( vec3 v ) {

  vec3 v2 = v;

  float texr = specSampler(mod(v.z * 6.0, 64.0) / 64.0);

  vec3 rep2 = opRep(v2 - vec3(5.0-texr*3.0,5.0+texr*3.0,0.0), vec3(10.0, 10.0, 0.5));

  float sp4 = sdSphere(rep2, 0.25);

  vec3 rep = opRep(v2, vec3(5.0, 5.0, 5.0));

  float rr1 = max(0.2, 0.3 - vz_beattime * 1.2);

  float sp1 = udRoundBox(rep, vec3(rr1,rr1,10.0), 0.0);
  float sp2 = udRoundBox(rep, vec3(rr1,10.0,rr1), 0.0);
  float sp3 = udRoundBox(rep, vec3(10.0,rr1,rr1), 0.0);

  return min(min(min(sp1, sp2), sp3), sp4);
}

#define M 35

vec3 render() {
  // mx2, my2, mz2 with the mouse at rest, from JavaScript.
  float mx2 = vz_rot.x;
  float my2 = vz_rot.y;
  float mz2 = vz_rot.z;

  float c12 = cos(my2 * PI2);
  float s12 = sin(my2 * PI2);
  float c22 = cos(mx2 * PI2);
  float s22 = sin(mx2 * PI2);
  float c32 = cos(mz2 * PI2);
  float s32 = sin(mz2 * PI2);

  vec3 pos, dir;
  dir = vec3( (gl_FragCoord.xy - u_res/2.0) / min(u_res.y,u_res.x), 0.6);
  dir = normalize(dir);

  float t = 0.0;
  pos = vec3(0.0);
  pos += vec3(1.5, 1.8, vz_z);

  vec3 v = dir;
    v = vec3( v.x*c12-v.y*s12, v.y*c12+v.x*s12, v.z ); // rotate
    v = vec3( v.x, v.y*c22-v.z*s22, v.z*c22+v.y*s22 ); // rotate
    v = vec3( v.x*c32-v.z*s32, v.y, v.z*c32+v.x*s32 ); // rotate
    dir = v;

  for ( int i = 0; i < M; i++ ) {
    vec3 hit = pos + dir * t;
    float d = dist( hit );
    t += d * 0.99;

    if ( abs(d) > 0.00001 )
      continue;

    vec3 c = (0.7 + 0.5 * cos((hit.x + hit.z) * 0.3)) * vz_color1
         + (0.7 + 0.5 * sin((hit.y + hit.z) * 0.4)) * vz_color2;

    return float(M-i) / float(M) * c;
  }

  return vec3( 0.0 );
}
`;
