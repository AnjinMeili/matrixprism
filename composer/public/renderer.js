import { PRELUDE } from './patterns.js';
import { followedValues, paramUniforms, paramValues, uniformValue } from './params.js';
import { needsReseed, newSeed, seededRandom } from './seed.js';
import { SPECTRUM_BINS, SPECTRUM_HISTORY_ROWS, SpectrumHistory } from './audio.js';
import { RAW_TEXELS, rawTexture } from './spectrum-bands.js';
import { OverlayLayer } from './overlays.js';
import { BLEND_GLSL, COMPOSITE_GLSL, TRIM_GLSL } from './mixer.js';
import { SHAPE_DEFAULTS, SHAPE_GLSL, shapeUniforms } from './shape.js';
import { SPARKLE_GLSL, SPARKLE_NOISE_SIZE, SparkleField, needsFeatures, sparkleNoise } from './sparkle.js';

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const COMPOSITE_SHADER = `
precision highp float;
uniform sampler2D u_current;
uniform sampler2D u_previous;
uniform sampler2D u_overlay;
uniform sampler2D u_layer;
uniform vec2 u_res;
uniform float u_mix;
uniform int u_blend_mode;
uniform float u_blend_amount;
uniform int u_shape_a;
uniform int u_region_a;
uniform int u_outline_a;
uniform vec2 u_size_a;
uniform vec2 u_motion_a;
uniform float u_edge_a;
uniform int u_shape_b;
uniform int u_region_b;
uniform int u_outline_b;
uniform vec2 u_size_b;
uniform vec2 u_motion_b;
uniform float u_edge_b;
// Each input's (brightness, gamma) trim, before mixing (T16).
uniform vec2 u_trim_a;
uniform vec2 u_trim_b;
uniform float u_brightness;
uniform float u_gamma;
// 0: the mixed picture only, for sparkles that follow its features; 1: all.
uniform int u_stage;
${BLEND_GLSL}
${COMPOSITE_GLSL}
${TRIM_GLSL}
${SHAPE_GLSL}
${SPARKLE_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  // Layer A keeps its shape through a pattern-change crossfade.
  float aspect = u_res.x / u_res.y;
  vec4 layerA = mix(
    trimmed(shapedLayer(u_previous, uv, u_shape_a, u_region_a, u_outline_a, u_size_a, u_motion_a, aspect, u_edge_a), u_trim_a),
    trimmed(shapedLayer(u_current, uv, u_shape_a, u_region_a, u_outline_a, u_size_a, u_motion_a, aspect, u_edge_a), u_trim_a),
    u_mix);
  vec3 col = layerA.rgb * layerA.a;
  // A negative mode means the mixer is off. Otherwise the layers blend where
  // both cover the pixel, and each shows alone where the other is absent.
  if (u_blend_mode >= 0)
    col = compositeLayers(layerA,
      trimmed(shapedLayer(u_layer, uv, u_shape_b, u_region_b, u_outline_b, u_size_b, u_motion_b, aspect, u_edge_b), u_trim_b),
      u_blend_mode, u_blend_amount);
  if (u_stage == 0) {
    gl_FragColor = vec4(col, 1.0);
    return;
  }
  // Sparkles go over the picture and under the overlays.
  col = min(col + sparkles(floor(gl_FragCoord.xy)), 1.0);
  vec4 overlay = texture2D(u_overlay, vec2(uv.x, 1.0 - uv.y));
  col = mix(col, overlay.rgb, overlay.a);
  gl_FragColor = vec4(pow(col, vec3(u_gamma)) * u_brightness, 1.0);
}
`;

// Draws a texture scaled into the rectangle in use, through an input's shape
// and region and with its trim, as the compositor takes it into the mix,
// black where the input is absent: for the small previews (Anjin,
// 2026-10-16: a shape "does not show in the pattern preview, only in the
// output"). A pair's picture has the plain shape and no trim.
const COPY_SHADER = `
precision highp float;
uniform sampler2D u_source;
uniform vec4 u_tile;
uniform vec2 u_trim;
uniform int u_shape;
uniform int u_region;
uniform int u_outline;
uniform vec2 u_size;
uniform vec2 u_motion;
uniform float u_edge;
uniform float u_aspect;
${TRIM_GLSL}
${SHAPE_GLSL}
void main() {
  vec2 uv = (gl_FragCoord.xy - u_tile.xy) / u_tile.zw;
  vec4 layer = trimmed(shapedLayer(u_source, uv, u_shape, u_region, u_outline, u_size, u_motion, u_aspect, u_edge), u_trim);
  gl_FragColor = vec4(layer.rgb * layer.a, 1.0);
}
`;

const RGB_SHADER = `
precision highp float;
uniform sampler2D u_rgb;
uniform vec2 u_res;
uniform float u_hue;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 col = texture2D(u_rgb, vec2(uv.x, 1.0 - uv.y)).rgb;
  float high = max(col.r, max(col.g, col.b));
  float low = min(col.r, min(col.g, col.b));
  float delta = high - low;
  if (delta > 0.0 && u_hue > 0.0) {
    float hue;
    if (high == col.r) hue = (col.g - col.b) / delta;
    else if (high == col.g) hue = 2.0 + (col.b - col.r) / delta;
    else hue = 4.0 + (col.r - col.g) / delta;
    vec3 wheel = clamp(abs(fract(hue / 6.0 + u_hue +
      vec3(0.0, 0.66666667, 0.33333333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    col = vec3(low) + delta * wheel;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const PATTERN_UNIFORMS = ['u_res', 'u_time', 'u_bass', 'u_mid', 'u_treble',
  'u_level', 'u_centroid', 'u_flatness', 'u_rolloff', 'u_zcr', 'u_loudness', 'u_beat', 'u_hue', 'u_spectrum', 'u_wave', 'u_raw', 'u_raw_nyquist',
  'u_history', 'u_history_head', 'u_history_rows',
  'u_key_number', 'u_key_minor', 'u_key_confidence'];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      depth: false,
      preserveDrawingBuffer: false,
    });
    if (!gl)
      throw new Error('WebGL is not available in this browser');
    this.gl = gl;
    this.programs = new Map();
    this.auroraInstances = new Map();
    // Seeds asked for by reseed() for instances not yet made again (T72).
    this.pendingSeeds = new Map();
    this.lastPatternId = null;
    this.width = 0;
    this.height = 0;

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.spectrumTexture = this.createDataTexture();
    this.waveTexture = this.createDataTexture();
    // The spectrum by frequency for patterns (T62): RAW_TEXELS bytes, 0 Hz to Nyquist.
    this.rawTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.rawTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, RAW_TEXELS, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE,
      new Uint8Array(RAW_TEXELS));
    this.setSampling(gl.LINEAR);
    this.rawBytes = new Uint8Array(RAW_TEXELS);
    this.rawNyquist = 24000;
    this.history = new SpectrumHistory();
    this.historyTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.historyTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, SPECTRUM_BINS, SPECTRUM_HISTORY_ROWS,
      0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.history.data);
    this.setSampling(gl.NEAREST);
    this.composite = this.createProgram(COMPOSITE_SHADER,
      ['u_current', 'u_previous', 'u_overlay', 'u_layer', 'u_res', 'u_mix',
        'u_blend_mode', 'u_blend_amount', 'u_shape_a', 'u_region_a', 'u_outline_a', 'u_size_a', 'u_motion_a', 'u_edge_a',
        'u_shape_b', 'u_region_b', 'u_outline_b', 'u_size_b', 'u_motion_b', 'u_edge_b', 'u_trim_a', 'u_trim_b',
        'u_brightness', 'u_gamma',
        'u_hits', 'u_sparkle', 'u_sparkle_air', 'u_sparkle_tint', 'u_sparkle_noise', 'u_features', 'u_stage']);
    this.sparkles = new SparkleField();
    this.sparkleNoise = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sparkleNoise);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SPARKLE_NOISE_SIZE, SPARKLE_NOISE_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      sparkleNoise());
    this.setSampling(gl.NEAREST);
    this.rgbProgram = this.createProgram(RGB_SHADER, ['u_rgb', 'u_res', 'u_hue']);
    this.copyProgram = this.createProgram(COPY_SHADER, ['u_source', 'u_tile', 'u_trim', 'u_shape', 'u_region', 'u_outline',
      'u_size', 'u_motion', 'u_edge', 'u_aspect']);
    this.overlay = new OverlayLayer();
    this.overlayTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.setSampling(gl.NEAREST);
  }

  createDataTexture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, SPECTRUM_BINS, 1, 0,
      gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(SPECTRUM_BINS));
    this.setSampling(gl.LINEAR);
    return texture;
  }

  setSampling(filter) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`shader compile failed: ${log}`);
    }
    return shader;
  }

  createProgram(fragmentSource, uniformNames) {
    const gl = this.gl;
    const program = gl.createProgram();
    gl.attachShader(program, this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, this.compileShader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`shader link failed: ${gl.getProgramInfoLog(program)}`);
    const uniforms = {};
    for (const name of uniformNames)
      uniforms[name] = gl.getUniformLocation(program, name);
    return { program, uniforms, position: gl.getAttribLocation(program, 'a_position') };
  }

  patternProgram(pattern) {
    if (!this.programs.has(pattern.id)) {
      // The pattern's own parameters (params.js) are uniforms named p_<id>.
      const source = `${PRELUDE}\n${paramUniforms(pattern)}\n${pattern.glsl}\n` +
        'void main() { gl_FragColor = vec4(clamp(render(), 0.0, 1.0), 1.0); }';
      const names = [...(pattern.params ?? []).map((param) => `p_${param.id}`), ...(pattern.stateUniforms ?? [])];
      this.programs.set(pattern.id, this.createProgram(source, [...PATTERN_UNIFORMS, ...names]));
    }
    return this.programs.get(pattern.id);
  }

  createTarget() {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.setSampling(gl.NEAREST);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer };
  }

  deleteTarget(target) {
    if (!target)
      return;
    this.gl.deleteTexture(target.texture);
    this.gl.deleteFramebuffer(target.framebuffer);
  }

  setSize(width, height) {
    if (width === this.width && height === this.height)
      return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    for (const entry of this.auroraInstances.values())
      this.gl.deleteTexture(entry.texture);
    this.auroraInstances.clear();
    for (const target of Object.values(this.targets ?? {}))
      this.deleteTarget(target);
    // Each input's pattern, and its previous pattern while a change
    // crossfades; each pair's mix; the master's preview; and the mixed
    // picture, drawn first when sparkles follow its features. Made when first
    // needed, so a frame that uses only Left costs what it did.
    this.targets = {};
    this.lastPatternIds = {};
    this.rgba = new Uint8Array(width * height * 4);
    this.rgb = new Uint8Array(width * height * 3);
  }

  draw(info) {
    const gl = this.gl;
    gl.useProgram(info.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(info.position);
    gl.vertexAttribPointer(info.position, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // `params` are the pattern's parameter values (params.js), by default those
  // saved for the pattern; `key` names a stateful pattern's instance, by
  // default the pattern's id. The quad mixer keys instances by input, so the
  // same pattern on two inputs runs as two, each with its own settings.
  renderPattern(pattern, target, time, state, params = null, key = pattern.id) {
    const gl = this.gl;
    // Settings that follow the music (#21) are moved for this frame here.
    const values = followedValues(pattern, params ?? paramValues(pattern, state.patternParams?.[pattern.id]), state);
    if (pattern.createInstance) {
      this.renderInstance(pattern, target, state, values, key);
      return;
    }
    const info = this.patternProgram(pattern);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(info.program);
    const u = info.uniforms;
    gl.uniform2f(u.u_res, this.width, this.height);
    gl.uniform1f(u.u_time, time);
    gl.uniform1f(u.u_bass, state.audio.bass);
    gl.uniform1f(u.u_mid, state.audio.mid);
    gl.uniform1f(u.u_treble, state.audio.treble);
    gl.uniform1f(u.u_level, state.audio.level);
    gl.uniform1f(u.u_centroid, state.audio.centroid ?? 0);
    gl.uniform1f(u.u_flatness, state.audio.flatness ?? 0);
    gl.uniform1f(u.u_rolloff, state.audio.rolloff ?? 0);
    gl.uniform1f(u.u_zcr, state.audio.zcr ?? 0);
    gl.uniform1f(u.u_loudness, state.audio.loudness ?? 0);
    gl.uniform1f(u.u_beat, state.audio.beat);
    gl.uniform1f(u.u_hue, pattern.manualHue ? state.manualHue ?? state.hue : state.hue);
    gl.uniform1f(u.u_key_number, state.musicalKey?.camelot.number ?? 0);
    gl.uniform1f(u.u_key_minor, state.musicalKey?.mode === 'minor' ? 1 : 0);
    gl.uniform1f(u.u_key_confidence, state.musicalKey?.confidence ?? 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.spectrumTexture);
    gl.uniform1i(u.u_spectrum, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.waveTexture);
    gl.uniform1i(u.u_wave, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.historyTexture);
    gl.uniform1i(u.u_history, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.rawTexture);
    gl.uniform1i(u.u_raw, 3);
    gl.uniform1f(u.u_raw_nyquist, this.rawNyquist);
    gl.uniform1f(u.u_history_head, this.history.nextRow);
    gl.uniform1f(u.u_history_rows, SPECTRUM_HISTORY_ROWS);
    if (pattern.params) {
      for (const param of pattern.params)
        gl.uniform1f(u[`p_${param.id}`], uniformValue(param, values[param.id]));
    }
    if (pattern.createState) {
      for (const [name, value] of Object.entries(this.shaderState(pattern, key).uniforms(state, values)))
        if (typeof value === 'number') gl.uniform1f(u[name], value);
        else gl.uniform3fv(u[name], value);
    }
    this.draw(info);
  }

  // A shader pattern with state of its own (`createState`, `stateUniforms`)
  // keeps it here, keyed and dropped as a stateful pattern's instance is; it
  // has no picture of its own, so no texture.
  shaderState(pattern, key) {
    let entry = this.auroraInstances.get(key);
    if (!entry) {
      entry = { animation: pattern.createState(), texture: null, patternId: pattern.id };
      this.auroraInstances.set(key, entry);
    }
    return entry.animation;
  }

  // The seed of the variation an instance shows (T72), or null when there is
  // none: a pattern that re-rolls itself (Mark Estes) names its latest.
  seedOf(key) {
    if (this.pendingSeeds.has(key)) return this.pendingSeeds.get(key);
    const entry = this.auroraInstances.get(key);
    return entry?.seed ? entry.animation.seed ?? entry.seed : null;
  }

  // Starts an instance afresh from `seed` on its next frame.
  reseed(key, seed) {
    this.pendingSeeds.set(key, seed);
    const entry = this.auroraInstances.get(key);
    if (entry) {
      this.gl.deleteTexture(entry.texture);
      this.auroraInstances.delete(key);
    }
  }

  // The live animation for a stateful pattern, or null before its first
  // frame: the first instance of it, whichever input it is on.
  animationFor(pattern) {
    for (const entry of this.auroraInstances.values())
      if (entry.patternId === pattern.id) return entry.animation;
    return null;
  }

  // Swap (T16): inputs `x` and `y` trade places. A stateful pattern's
  // instance, keyed by input, goes with its input, so it runs on rather than
  // starting afresh.
  swapInputs(x, y) {
    const other = (id) => (id === x ? y : id === y ? x : id);
    const moved = new Map();
    for (const [key, entry] of this.auroraInstances) {
      const colon = key.indexOf(':');
      moved.set(colon < 0 ? key : `${other(key.slice(0, colon))}${key.slice(colon)}`, entry);
    }
    this.auroraInstances = moved;
    [this.lastPatternIds[x], this.lastPatternIds[y]] = [this.lastPatternIds[y], this.lastPatternIds[x]];
  }

  renderInstance(pattern, target, state, params, key = pattern.id) {
    const gl = this.gl;
    let entry = this.auroraInstances.get(key);
    // A kept variation other than the one running starts it afresh (T72).
    if (entry && needsReseed(entry.seed, params)) {
      gl.deleteTexture(entry.texture);
      this.auroraInstances.delete(key);
      entry = null;
    }
    if (!entry) {
      // Each instance draws its dice from a seed: the kept variation, one
      // asked for, or a new one, which seedOf() reports so it can be kept.
      const seed = this.pendingSeeds.get(key) ?? (params?.variation || newSeed());
      this.pendingSeeds.delete(key);
      const animation = pattern.createInstance(this.width, this.height, seededRandom(seed));
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, this.width, this.height,
        0, gl.RGB, gl.UNSIGNED_BYTE, null);
      this.setSampling(gl.NEAREST);
      entry = { animation, texture, patternId: pattern.id, seed };
      this.auroraInstances.set(key, entry);
    }
    const rgb = entry.animation.renderFrame(state, params);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height,
      gl.RGB, gl.UNSIGNED_BYTE, rgb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    const info = this.rgbProgram;
    gl.useProgram(info.program);
    gl.uniform1i(info.uniforms.u_rgb, 0);
    gl.uniform2f(info.uniforms.u_res, this.width, this.height);
    gl.uniform1f(info.uniforms.u_hue, state.hue);
    this.draw(info);
  }

  uploadAudio(spectrum, wave, rawInput = null) {
    const gl = this.gl;
    this.rawNyquist = rawTexture(rawInput, this.rawBytes);
    gl.bindTexture(gl.TEXTURE_2D, this.rawTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, RAW_TEXELS, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.rawBytes);
    gl.bindTexture(gl.TEXTURE_2D, this.spectrumTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPECTRUM_BINS, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, spectrum);
    gl.bindTexture(gl.TEXTURE_2D, this.waveTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPECTRUM_BINS, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, wave);
  }

  // A render target by name, made at the current size when first asked for.
  target(name) {
    this.targets[name] ??= this.createTarget();
    return this.targets[name];
  }

  // Renders one frame and returns it as top-to-bottom row-major RGB, the
  // pixel order matrix-dmx expects from DDP. Today's state, one pair: layer
  // A (`pattern`, crossfading from `previousPattern` by `mix`) and the mixer's
  // `layer` B, drawn as the quad mixer's Left with nothing on Right.
  render(state) {
    const a = {
      pattern: state.pattern, params: paramValues(state.pattern, state.patternParams?.[state.pattern.id]),
      shape: state.shape, time: state.time,
      previousPattern: state.previousPattern && state.mix < 1 ? state.previousPattern : null,
      previousParams: state.previousPattern
        ? paramValues(state.previousPattern, state.patternParams?.[state.previousPattern.id]) : null,
      previousTime: state.previousTime, mix: state.mix,
    };
    const layer = state.layer ?? null;
    // The quad mixer's parts that today's state does not have (T16 step 5):
    // each input's trim, B while its mixer is off (drawn for its preview,
    // not mixed), C and D, the Right pair, the master, the preview.
    const quad = state.quad ?? {};
    const b = layer ? {
      pattern: layer.pattern, params: paramValues(layer.pattern, state.patternParams?.[layer.pattern.id]),
      shape: layer.shape, time: state.time,
    } : quad.b ?? null;
    const trim = (input, id) => input && { ...input, brightness: quad.trims?.[id]?.brightness ?? 1,
      gamma: quad.trims?.[id]?.gamma ?? 1, ...quad.hues?.[id] };
    return this.renderQuad({
      ...state,
      inputs: { a: trim(a, 'a'), b: trim(b, 'b'), c: quad.c ?? null, d: quad.d ?? null },
      pairs: { left: { mode: layer ? layer.mode : -1, amount: layer ? layer.amount : 0 }, right: quad.right ?? null },
      master: quad.master ?? { mode: 0, position: 0, blackout: false },
      preview: quad.preview ?? null,
      submixes: !!quad.submixes,
    });
  }

  // Renders one frame of the quad mixer (T16) and returns it as RGB rows.
  // `frame` is the render state, plus:
  //   inputs: { a, b, c, d }, each null or { pattern, params (all of them,
  //     or only those changed from the defaults), shape, time,
  //     brightness, gamma, and while a pattern change crossfades
  //     previousPattern, previousParams, previousTime and mix }
  //   pairs: { left, right }, each null or { mode: a blend index, or -1 for
  //     the second input off, amount }
  //   master: { mode: a blend index, position from Left (0) to Right (1),
  //     blackout }, and optionally `preview`, a second { mode, position }
  //     drawn into the `preview` target and not streamed (Gated);
  //   submixes: true to draw each pair's picture even when Left alone is
  //     streamed, for the pairs' previews.
  // At position 0 every blend gives Left exactly, so Left alone is drawn in
  // one pass with its effects, as before the quad mixer; otherwise each pair
  // is drawn into its own picture and the master mixes them.
  renderQuad(frame) {
    const gl = this.gl;
    const inputs = frame.inputs;
    // Instances: one per input and pattern. A pattern newly on an input
    // starts afresh; instances no input uses are dropped.
    const active = new Set();
    for (const [id, input] of Object.entries(inputs)) {
      if (!input) continue;
      if (this.lastPatternIds[id] !== input.pattern.id) {
        const key = `${id}:${input.pattern.id}`;
        const entry = this.auroraInstances.get(key);
        if (entry) {
          gl.deleteTexture(entry.texture);
          this.auroraInstances.delete(key);
        }
        this.lastPatternIds[id] = input.pattern.id;
      }
      active.add(`${id}:${input.pattern.id}`);
      if (input.previousPattern) active.add(`${id}:${input.previousPattern.id}`);
    }
    for (const [key, entry] of this.auroraInstances) {
      if (!active.has(key)) {
        gl.deleteTexture(entry.texture);
        this.auroraInstances.delete(key);
      }
    }
    // The beat that moves the shapes, kept for the previews (readPreviews).
    this.shapeClock = [frame.beatPosition ?? 0, frame.changeClock ?? frame.beatPosition ?? 0];
    this.uploadAudio(frame.spectrum, frame.wave, frame.spectrumInput);
    if (this.history.update(frame.spectrum, frame.audioTime)) {
      gl.bindTexture(gl.TEXTURE_2D, this.historyTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPECTRUM_BINS, SPECTRUM_HISTORY_ROWS,
        gl.LUMINANCE, gl.UNSIGNED_BYTE, this.history.data);
    }
    for (const [id, input] of Object.entries(inputs)) {
      if (!input) continue;
      // An input with its own hue draws with it in place of the main's;
      // `manualHue` is that hue before Key colours turn it.
      const state = input.hue === undefined || input.hue === null ? frame
        : { ...frame, hue: input.hue, manualHue: input.manualHue ?? input.hue };
      // An input's settings may be only those that differ from the defaults,
      // as saved; every parameter gets its value.
      this.renderPattern(input.pattern, this.target(id), input.time ?? frame.time, state,
        paramValues(input.pattern, input.params), `${id}:${input.pattern.id}`);
      if (input.previousPattern)
        this.renderPattern(input.previousPattern, this.target(`${id}-previous`), input.previousTime ?? frame.time, state,
          paramValues(input.previousPattern, input.previousParams), `${id}:${input.previousPattern.id}`);
    }
    if (this.overlay.update(frame.overlays, this.width, this.height, new Date(frame.wallTime ?? Date.now()),
      frame.overlayInfo)) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.overlayTexture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.overlay.canvas);
    }
    // state.sparkles is the Sparkles settings (sparkle.js); hits come from the audio.
    this.sparkles.add(frame.audio, frame.audioTime);
    const sparkle = this.sparkles.uniforms(frame.audioTime, frame.sparkles, frame.hue, frame.audio?.air ?? 0);
    const finish = { brightness: frame.brightness, gamma: frame.gamma, sparkle, features: needsFeatures(frame.sparkles) };
    const master = frame.master;
    if (master.blackout) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else if (master.position === 0) {
      this.composePair(null, 'a', 'b', frame.pairs.left, frame, finish);
      // The pairs' own pictures, for their previews, when asked for.
      if (frame.submixes && !frame.preview) {
        this.composePair(this.target('left').framebuffer, 'a', 'b', frame.pairs.left, frame, null);
        this.composePair(this.target('right').framebuffer, 'c', 'd', frame.pairs.right, frame, null);
      }
    } else {
      this.composePair(this.target('left').framebuffer, 'a', 'b', frame.pairs.left, frame, null);
      this.composePair(this.target('right').framebuffer, 'c', 'd', frame.pairs.right, frame, null);
      this.composeMaster(null, master, frame, finish);
    }
    if (frame.preview && !master.blackout) {
      if (master.position === 0) {
        this.composePair(this.target('left').framebuffer, 'a', 'b', frame.pairs.left, frame, null);
        this.composePair(this.target('right').framebuffer, 'c', 'd', frame.pairs.right, frame, null);
      }
      this.composeMaster(this.target('preview').framebuffer, frame.preview, frame, finish);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.rgba);
    const { width, height, rgba, rgb } = this;
    let out = 0;
    for (let y = height - 1; y >= 0; --y) {
      let input = y * width * 4;
      for (let x = 0; x < width; ++x) {
        rgb[out++] = rgba[input];
        rgb[out++] = rgba[input + 1];
        rgb[out++] = rgba[input + 2];
        input += 4;
      }
    }
    return rgb;
  }

  // The named targets drawn small, side by side, into one strip and read
  // back in one call: the quad mixer's previews, without reading each
  // picture back at full size (step 2 found that stalls). `inputs` gives an
  // input's brightness, gamma and shape by name, so its preview shows it as
  // it goes into the mix, the shape moving with the last frame's beat.
  // Returns RGBA rows, bottom row first, `tileWidth` × `tileHeight` per name,
  // in order; a name with no target yet is black.
  readPreviews(names, tileWidth, tileHeight, inputs = {}) {
    const gl = this.gl;
    const width = tileWidth * names.length;
    if (!this.previewStrip || this.previewStrip.width !== width || this.previewStrip.height !== tileHeight) {
      if (this.previewStrip) this.deleteTarget(this.previewStrip.target);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, tileHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.setSampling(gl.NEAREST);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      this.previewStrip = { target: { texture, framebuffer }, width, height: tileHeight,
        pixels: new Uint8Array(width * tileHeight * 4) };
    }
    const strip = this.previewStrip;
    gl.bindFramebuffer(gl.FRAMEBUFFER, strip.target.framebuffer);
    gl.viewport(0, 0, width, tileHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const info = this.copyProgram;
    gl.useProgram(info.program);
    gl.uniform1i(info.uniforms.u_source, 0);
    names.forEach((name, i) => {
      const target = this.targets[name];
      if (!target) return;
      gl.viewport(i * tileWidth, 0, tileWidth, tileHeight);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.uniform4f(info.uniforms.u_tile, i * tileWidth, 0, tileWidth, tileHeight);
      gl.uniform2f(info.uniforms.u_trim, inputs[name]?.brightness ?? 1, inputs[name]?.gamma ?? 1);
      const [position, changeClock] = this.shapeClock ?? [0, 0];
      const shaping = shapeUniforms(inputs[name]?.shape ?? SHAPE_DEFAULTS, this.width / this.height, position, changeClock);
      gl.uniform1i(info.uniforms.u_shape, shaping.shape);
      gl.uniform1i(info.uniforms.u_region, shaping.region);
      gl.uniform1i(info.uniforms.u_outline, shaping.outline);
      gl.uniform2f(info.uniforms.u_size, shaping.sizeX, shaping.sizeY);
      gl.uniform2f(info.uniforms.u_motion, shaping.angle, shaping.zoom);
      gl.uniform1f(info.uniforms.u_edge, shaping.edge);
      gl.uniform1f(info.uniforms.u_aspect, this.width / this.height);
      this.draw(info);
    });
    gl.readPixels(0, 0, width, tileHeight, gl.RGBA, gl.UNSIGNED_BYTE, strip.pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    return strip.pixels;
  }

  // One pair through the compositor into `framebuffer` (null: the canvas):
  // its first input, crossfading from that input's previous pattern, with
  // the second blended over it. With `finish`, sparkles, overlays, gamma and
  // brightness follow, as for the stream; without, the mix alone. A pair with
  // no first input is black.
  composePair(framebuffer, firstId, secondId, pair, frame, finish) {
    const gl = this.gl;
    const first = frame.inputs[firstId];
    if (!first) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const second = pair && pair.mode >= 0 ? frame.inputs[secondId] : null;
    const current = this.target(firstId).texture;
    this.compose(framebuffer, {
      current,
      previous: first.previousPattern ? this.target(`${firstId}-previous`).texture : current,
      mix: first.previousPattern ? first.mix : 1,
      layer: second ? this.target(secondId).texture : null,
      mode: second ? pair.mode : -1,
      amount: second ? pair.amount : 0,
      shapeA: first.shape, shapeB: second?.shape,
      trimA: [first.brightness ?? 1, first.gamma ?? 1], trimB: [second?.brightness ?? 1, second?.gamma ?? 1],
    }, frame, finish);
  }

  // The master through the compositor: Left with Right blended over it by
  // `master.mode` at `master.position`, then the stream's effects.
  composeMaster(framebuffer, master, frame, finish) {
    const left = this.target('left').texture;
    this.compose(framebuffer, {
      current: left, previous: left, mix: 1, layer: this.target('right').texture, mode: master.mode,
      amount: master.position, shapeA: SHAPE_DEFAULTS, shapeB: SHAPE_DEFAULTS, trimA: [1, 1], trimB: [1, 1],
    }, frame, finish);
  }

  // One compositor pass. With `finish` it draws the stream's picture: when
  // sparkles follow the picture's features, the mixed picture first, then
  // everything. Without, it draws the mixed picture alone.
  compose(framebuffer, pass, frame, finish) {
    const gl = this.gl;
    const c = this.composite;
    gl.useProgram(c.program);
    const bind = (unit, texture, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(c.uniforms[name], unit);
    };
    bind(0, pass.current, 'u_current');
    bind(1, pass.previous, 'u_previous');
    bind(2, this.overlayTexture, 'u_overlay');
    bind(3, pass.layer ?? pass.current, 'u_layer');
    gl.uniform1i(c.uniforms.u_blend_mode, pass.layer ? pass.mode : -1);
    gl.uniform1f(c.uniforms.u_blend_amount, pass.layer ? pass.amount : 0);
    // Each layer's shape (shape.js); the beat position drives spin and pulse.
    for (const [suffix, value] of [['a', pass.shapeA], ['b', pass.shapeB]]) {
      const shaping = shapeUniforms(value, this.width / this.height, frame.beatPosition ?? 0,
        frame.changeClock ?? frame.beatPosition ?? 0);
      gl.uniform1i(c.uniforms[`u_shape_${suffix}`], shaping.shape);
      gl.uniform1i(c.uniforms[`u_region_${suffix}`], shaping.region);
      gl.uniform1i(c.uniforms[`u_outline_${suffix}`], shaping.outline);
      gl.uniform2f(c.uniforms[`u_size_${suffix}`], shaping.sizeX, shaping.sizeY);
      gl.uniform2f(c.uniforms[`u_motion_${suffix}`], shaping.angle, shaping.zoom);
      gl.uniform1f(c.uniforms[`u_edge_${suffix}`], shaping.edge);
    }
    gl.uniform2f(c.uniforms.u_trim_a, pass.trimA[0], pass.trimA[1]);
    gl.uniform2f(c.uniforms.u_trim_b, pass.trimB[0], pass.trimB[1]);
    gl.uniform2f(c.uniforms.u_res, this.width, this.height);
    gl.uniform1f(c.uniforms.u_mix, pass.mix);
    const sparkle = finish?.sparkle;
    gl.uniform1f(c.uniforms.u_brightness, finish ? finish.brightness : 1);
    gl.uniform1f(c.uniforms.u_gamma, finish ? finish.gamma : 1);
    if (sparkle) {
      gl.uniform4fv(c.uniforms.u_hits, sparkle.hits);
      gl.uniform4fv(c.uniforms.u_sparkle, sparkle.sparkle);
      gl.uniform4fv(c.uniforms.u_sparkle_air, sparkle.air);
      gl.uniform3fv(c.uniforms.u_sparkle_tint, sparkle.tint);
    }
    bind(4, this.sparkleNoise, 'u_sparkle_noise');
    // A texture may not be read while it is drawn into, so the noise stands
    // in for the picture until the picture has been drawn.
    bind(5, this.sparkleNoise, 'u_features');
    gl.viewport(0, 0, this.width, this.height);
    if (!finish) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.uniform1i(c.uniforms.u_stage, 0);
      this.draw(c);
      return;
    }
    if (finish.features) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.target('features').framebuffer);
      gl.uniform1i(c.uniforms.u_stage, 0);
      this.draw(c);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.target('features').texture);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.uniform1i(c.uniforms.u_stage, 1);
    this.draw(c);
  }
}
