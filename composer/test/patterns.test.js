import assert from 'node:assert/strict';
import test from 'node:test';
import { PATTERNS } from '../public/patterns.js';

test('every pattern has a unique persistent ID and picker metadata', () => {
  assert.equal(new Set(PATTERNS.map(pattern => pattern.id)).size, PATTERNS.length);
  for (const pattern of PATTERNS) {
    assert.match(pattern.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(pattern.name.length > 0);
    assert.ok(pattern.audio.length > 0);
    if (pattern.createInstance)
      assert.equal(typeof pattern.createInstance, 'function');
    else
      assert.match(pattern.glsl, /vec3 render\(\)/);
  }
});

test('additional audio patterns are available through the shared registry', () => {
  for (const id of ['rotating-wave', 'circular-wave', 'spectrum-tiles',
    'spectral-rain', 'aurora-curtains', 'triangle-pulse']) {
    const pattern = PATTERNS.find(pattern => pattern.id === id);
    assert.ok(pattern, id);
    assert.match(pattern.glsl, /wave\(|spec\(|u_bass|u_mid|u_treble/);
  }
});

test('Camelot wheel uses live key uniforms and minor/major labelled rings', () => {
  const pattern = PATTERNS.find(pattern => pattern.id === 'camelot-wheel');
  assert.ok(pattern);
  assert.match(pattern.glsl, /u_key_number/);
  assert.match(pattern.glsl, /u_key_minor/);
  assert.match(pattern.glsl, /u_key_confidence/);
  assert.match(pattern.glsl, /float label\(/);
});

test('stateful patterns share one renderFrame entry point and declare their control panels', () => {
  const state = {
    time: 0, auroraTime: 0, audioTime: 0, paletteId: 'original', auroraDotSize: null,
    flock: { count: 3 }, spectrumOptions: {},
    rawSpectrum: { data: new Float32Array(4096).fill(-50), fftSize: 8192, sampleRate: 48000, source: 1 },
  };
  for (const pattern of PATTERNS.filter(pattern => pattern.createInstance)) {
    const animation = pattern.createInstance(48, 32);
    const rgb = animation.renderFrame(state);
    assert.equal(rgb.length, 48 * 32 * 3, pattern.id);
    assert.ok(pattern.controls.every(group => ['aurora', 'flock', 'spectrum', 'media'].includes(group)), pattern.id);
  }
  const flock = PATTERNS.find(pattern => pattern.id === 'aurora-flock');
  assert.deepEqual(flock.controls, ['aurora', 'flock']);
  const birds = flock.createInstance(48, 32);
  birds.renderFrame(state);
  assert.equal(birds.boids.length, 3);
  const spectrum = PATTERNS.find(pattern => pattern.spectrumPlot).createInstance(48, 32);
  spectrum.renderFrame(state);
  assert.match(spectrum.describe(state.rawSpectrum, true), /bands · 4096 FFT bins .* simulated/);
});

test('Camelot wheel digits come from the shared glyph table and keep manual hue', () => {
  const pattern = PATTERNS.find(pattern => pattern.id === 'camelot-wheel');
  assert.equal(pattern.manualHue, true);
  assert.match(pattern.glsl, /float code = 31599\.0;\n  if \(n == 1\.0\) code = 29850\.0;\n  else if \(n == 2\.0\) code = 29671\.0;/);
  assert.match(pattern.glsl, /else if \(n == 9\.0\) code = 31215\.0;\n  return glyph/);
});
