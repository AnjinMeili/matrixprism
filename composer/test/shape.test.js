import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OUTLINES, REGIONS, SHAPES, SHAPE_DEFAULTS, SHAPE_GLSL, motionAt, regionCoverage, shapeLookup, shapeSettings,
  shapeUniforms,
} from '../public/shape.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} versus ${expected}`);

test('layer shape settings validate and default to an unshaped whole panel', () => {
  assert.deepEqual(shapeSettings(), SHAPE_DEFAULTS);
  assert.equal(SHAPE_DEFAULTS.shape, 'normal');
  assert.equal(SHAPE_DEFAULTS.region, 'full');
  assert.deepEqual(SHAPES.map(shape => shape.id), ['normal', 'outside-in', 'inside-out']);
  assert.deepEqual(REGIONS.map(region => region.id), ['full', 'centre', 'outer']);
  assert.deepEqual(OUTLINES.map(outline => outline.id), ['ellipse', 'rectangle', 'diamond']);
  assert.deepEqual(shapeUniforms({ shape: 'inside-out', region: 'outer', outline: 'diamond', width: 0.3, height: 0.8 }),
    { aspect: 1, angle: 0, zoom: 1, shape: 2, region: 2, outline: 2, edge: 0, sizeX: 0.3, sizeY: 0.8 });
  assert.throws(() => shapeSettings({ edge: 0.9 }), /border softness/);
  assert.throws(() => shapeSettings({ spin: 3 }), /spin/);
  assert.throws(() => shapeSettings({ spinReverse: 3 }), /spin reversal/);
  assert.throws(() => shapeSettings({ pulse: 0.9 }), /pulse/);
  assert.throws(() => shapeSettings({ pulseBeats: 3 }), /pulse interval/);
  assert.throws(() => shapeSettings({ shape: 'spiral' }), /layer shape/);
  assert.throws(() => shapeSettings({ region: 'left' }), /layer region/);
  assert.throws(() => shapeSettings({ outline: 'star' }), /layer outline/);
  assert.throws(() => shapeSettings({ width: 0 }), /width/);
  assert.throws(() => shapeSettings({ height: 9 }), /height/);
  assert.throws(() => shapeSettings({ proportional: 1 }), /boolean/);
  assert.throws(() => shapeSettings([]), /options object/);
});

test('proportional areas are as tall as they are wide in pixels', () => {
  // On a 256x192 panel, a width of 0.3 is 38.4 pixels; so must the height be.
  const { sizeX, sizeY } = shapeUniforms({ width: 0.3, height: 1, proportional: true }, 256 / 192);
  close(sizeX * 256 / 2, sizeY * 192 / 2);
  assert.equal(shapeUniforms({ width: 0.3, height: 0.9 }, 256 / 192).sizeY, 0.9);
});

test('an unshaped layer is sampled where it is drawn', () => {
  assert.deepEqual(shapeLookup(undefined, 0.2, 0.9), { u: 0.2, v: 0.9, visible: true, coverage: 1 });
});

test('bending puts the pattern base at the rim or at the centre', () => {
  const outsideIn = { shape: 'outside-in' }, insideOut = { shape: 'inside-out' };
  close(shapeLookup(outsideIn, 1, 0.5).v, 0);     // middle of an edge = pattern bottom
  close(shapeLookup(outsideIn, 0.5, 0.5).v, 1);   // centre = pattern top
  close(shapeLookup(insideOut, 0.5, 0.5).v, 0);
  close(shapeLookup(insideOut, 1, 0.5).v, 1);
  close(shapeLookup(insideOut, 0.75, 0.5).v, 0.5);
  // With an ellipse the corners lie beyond the rim and hold the nearest row.
  close(shapeLookup(outsideIn, 1, 1).v, 0);
  // A rectangle outline follows the panel edges exactly, corners included.
  const framed = { shape: 'outside-in', outline: 'rectangle' };
  close(shapeLookup(framed, 1, 1).v, 0);
  close(shapeLookup(framed, 0.3, 1).v, 0);
  close(shapeLookup(framed, 0.75, 0.6).v, 0.5);
  // Round the centre: left edge at the top, right edge at the bottom, and the
  // two sides mirror each other.
  close(shapeLookup(insideOut, 0.5, 1).u, 0);
  close(shapeLookup(insideOut, 0.5, 0).u, 1);
  close(shapeLookup(insideOut, 1, 0.5).u, 0.5);
  close(shapeLookup(insideOut, 0.8, 0.7).u, shapeLookup(insideOut, 0.2, 0.7).u);
});

test('complementary regions never overlap and leave no gap, for every outline and size', () => {
  for (const outline of ['ellipse', 'rectangle', 'diamond']) {
    for (const [width, height] of [[0.6, 0.6], [0.9, 0.3], [0.2, 1.2]]) {
      const centre = { region: 'centre', outline, width, height }, outer = { ...centre, region: 'outer' };
      for (let x = 0; x <= 20; ++x) {
        for (let y = 0; y <= 20; ++y) {
          assert.notEqual(shapeLookup(centre, x / 20, y / 20).visible, shapeLookup(outer, x / 20, y / 20).visible,
            `${outline} ${width}x${height} at (${x / 20}, ${y / 20})`);
        }
      }
      assert.equal(shapeLookup(centre, 0.5, 0.5).visible, true);
    }
  }
});

test('outline and size decide which pixels belong to the centre', () => {
  const inside = (settings, u, v) => shapeLookup({ region: 'centre', ...settings }, u, v).visible;
  // Wide and short: reaches far sideways, not far up.
  const wide = { width: 0.8, height: 0.2 };
  assert.equal(inside(wide, 0.85, 0.5), true);
  assert.equal(inside(wide, 0.5, 0.65), false);
  // The corner of the bounding box is inside a rectangle only.
  const at = [0.5 + 0.38 / 2 * 2, 0.5 + 0.38 / 2 * 2];
  const box = { width: 0.8, height: 0.8 };
  assert.equal(inside({ ...box, outline: 'rectangle' }, ...at), true);
  assert.equal(inside({ ...box, outline: 'ellipse' }, ...at), false);
  assert.equal(inside({ ...box, outline: 'diamond' }, ...at), false);
  // A diamond is narrower than an ellipse off its axes but equal on them.
  assert.equal(inside({ ...box, outline: 'diamond' }, 0.5 + 0.39, 0.5), true);
  assert.equal(inside({ ...box, outline: 'diamond' }, 0.72, 0.72), false);
  assert.equal(inside({ ...box, outline: 'ellipse' }, 0.72, 0.72), true);
});

test('a bent pattern spans its own region', () => {
  const inner = { shape: 'inside-out', region: 'centre', width: 0.5, height: 0.5 };
  close(shapeLookup(inner, 0.5, 0.5).v, 0);
  close(shapeLookup(inner, 0.625, 0.5).v, 0.5);    // half way to the outline
  const ring = { shape: 'outside-in', region: 'outer', width: 0.5, height: 0.5 };
  close(shapeLookup(ring, 1, 0.5).v, 0);           // panel edge
  close(shapeLookup(ring, 0.875, 0.5).v, 0.5);     // half way in to the outline
  close(shapeLookup(ring, 0.75, 0.5).v, 1);        // on the outline
  // An uneven area still spans edge to outline along each direction.
  const uneven = { shape: 'inside-out', region: 'outer', outline: 'rectangle', width: 0.8, height: 0.2 };
  close(shapeLookup(uneven, 0.9, 0.5).v, 0);       // on the outline, sideways
  close(shapeLookup(uneven, 0.5, 0.6).v, 0);       // on the outline, upwards
  close(shapeLookup(uneven, 0.5, 0.8).v, 0.5);     // half way from outline to edge
  close(shapeLookup(uneven, 0.5, 1).v, 1);
});

test('compositor GLSL mirrors the lookup', () => {
  assert.match(SHAPE_GLSL, /vec4 shapedLayer\(sampler2D layer, vec2 uv, int shape, int region, int outline, vec2 size, vec2 motion, float aspect, float edge\)/);
  assert.ok(SHAPE_GLSL.includes('smoothstep(1.0 - soft, 1.0 + soft, area)'));
  assert.ok(SHAPE_GLSL.includes('abs(mod(at + 1.0, 2.0) - 1.0)'), 'reflects at the pattern edges');
  assert.ok(SHAPE_GLSL.includes('return vec4(0.0);'), 'outside its region a layer reports no coverage');
  for (const fragment of ['coverage = region == 1 ? 1.0 - outside : outside', 'max(abs(q.x), abs(q.y))',
    'abs(q.x) + abs(q.y)', 'panel * (area - 1.0) / max(area - panel, 0.0001)', 'abs(2.0 * turn - 1.0)'])
    assert.ok(SHAPE_GLSL.includes(fragment), fragment);
  assert.equal(SHAPE_GLSL.split('(').length, SHAPE_GLSL.split(')').length);
  assert.equal(SHAPE_GLSL.split('{').length, SHAPE_GLSL.split('}').length);
});

test('spin turns a layer once per so many bars, and pulse swells it on the beat', () => {
  const still = shapeSettings();
  assert.deepEqual(motionAt(still, 7.3), { angle: 0, zoom: 1 });
  const spin = shapeSettings({ spin: 2 });                 // one turn every 8 beats
  close(motionAt(spin, 0).angle, 0);
  close(motionAt(spin, 2).angle, Math.PI / 2);
  close(motionAt(spin, 4).angle, Math.PI);
  close(motionAt(spin, 10).angle, Math.PI / 2);            // wraps after a full turn
  close(motionAt(shapeSettings({ spin: -2 }), 2).angle, -Math.PI / 2);
  const pulse = shapeSettings({ pulse: 0.3, pulseBeats: 2 });
  close(motionAt(pulse, 0).zoom, 1.3);                     // full on the beat
  assert.ok(motionAt(pulse, 1).zoom < 1.05, 'mostly gone half way to the next one');
  close(motionAt(pulse, 2).zoom, 1.3);
  assert.ok(motionAt(pulse, 0.5).zoom > motionAt(pulse, 1.5).zoom);
});

test('a moving layer is sampled turned and swollen about the centre', () => {
  // A quarter turn on a square panel: right of centre samples from below or above it.
  const quarter = { spin: 1 };                              // one turn per 4 beats
  const sample = shapeLookup(quarter, 0.75, 0.5, 1, 1);
  close(sample.u, 0.5);
  close(Math.abs(sample.v - 0.5), 0.25);
  // The centre never moves.
  for (const position of [0.3, 1.7, 3.1]) {
    const centre = shapeLookup({ spin: 1, pulse: 0.4 }, 0.5, 0.5, 256 / 192, position);
    close(centre.u, 0.5);
    close(centre.v, 0.5);
  }
  // On the beat a pulse of 0.25 shows the middle 80%: the edge samples from 0.9.
  close(shapeLookup({ pulse: 0.25 }, 1, 0.5, 1, 0).u, 0.9);
  // Samples that leave the pattern are reflected back inside.
  for (let i = 0; i <= 20; ++i) {
    const at = shapeLookup({ spin: 1 }, i / 20, 1 - i / 20, 256 / 192, 0.5);
    assert.ok(at.u >= 0 && at.u <= 1 && at.v >= 0 && at.v <= 1);
  }
  // A bent layer slides round instead: a half turn swaps top for bottom.
  const bent = { shape: 'inside-out', spin: 1 };
  close(shapeLookup(bent, 0.5, 1, 1, 0).u, 0);
  close(shapeLookup(bent, 0.5, 1, 1, 2).u, 1);
  // The region does not move with the pattern.
  const masked = { region: 'centre', width: 0.3, height: 0.3, spin: 1, pulse: 0.5 };
  for (const position of [0, 0.5, 1.9])
    assert.equal(shapeLookup(masked, 0.9, 0.5, 1, position).visible, false);
});

test('a soft border fades a layer across its outline, and opposite layers add up to one', () => {
  // Hard edge: all or nothing either side of the outline.
  assert.equal(regionCoverage(1, 0.99, 0), 1);
  assert.equal(regionCoverage(1, 1.01, 0), 0);
  assert.equal(regionCoverage(2, 1.01, 0), 1);
  assert.equal(regionCoverage(0, 5, 0.3), 1, 'a whole-panel layer is present everywhere');
  // Soft edge: full inside the band, gone outside it, half on the outline.
  close(regionCoverage(1, 0.8, 0.2), 1);
  close(regionCoverage(1, 1, 0.2), 0.5);
  close(regionCoverage(1, 1.2, 0.2), 0);
  let previous = 1;
  for (let i = 0; i <= 40; ++i) {
    const area = 0.7 + i * 0.015;
    const inside = regionCoverage(1, area, 0.2), outside = regionCoverage(2, area, 0.2);
    close(inside + outside, 1);
    assert.ok(inside <= previous + 1e-12, 'fades one way only');
    previous = inside;
  }
  // Through the lookup: half way across a soft border on a centred area.
  const soft = { region: 'centre', width: 0.5, height: 0.5, edge: 0.2 };
  close(shapeLookup(soft, 0.75, 0.5).coverage, 0.5);
  assert.equal(shapeLookup(soft, 0.5, 0.5).coverage, 1);
  assert.equal(shapeLookup(soft, 0.95, 0.5).coverage, 0);
  assert.equal(shapeLookup(soft, 0.78, 0.5).visible, true, 'still partly there just outside the outline');
});

test('a spin can reverse every so many bars or follow the changes in the music', () => {
  // One turn per 4 bars (16 beats), reversing every 2 bars (8 beats): it
  // swings half a turn forwards and back.
  const swing = shapeSettings({ spin: 4, spinReverse: 2 });
  close(motionAt(swing, 4).angle, Math.PI / 2);
  close(motionAt(swing, 8).angle, Math.PI);
  close(motionAt(swing, 12).angle, Math.PI / 2);
  close(motionAt(swing, 16).angle, 0);
  for (let i = 1; i < 800; ++i) {
    const step = motionAt(swing, i / 20).angle - motionAt(swing, (i - 1) / 20).angle;
    assert.ok(Math.abs(step) < 0.03, 'no jump where it turns round');
  }
  // Reversing on changes follows the clock it is given, not the position.
  const onChange = shapeSettings({ spin: 4, spinReverse: -1 });
  close(motionAt(onChange, 100, 4).angle, Math.PI / 2);
  close(motionAt(onChange, 200, 4).angle, Math.PI / 2);
  // Without reversal the change clock is ignored.
  close(motionAt(shapeSettings({ spin: 4 }), 4, 12).angle, Math.PI / 2);
});
