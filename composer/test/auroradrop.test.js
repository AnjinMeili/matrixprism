import assert from 'node:assert/strict';
import test from 'node:test';
import { PATTERNS } from '../public/patterns.js';
import { AURORADROP_PATTERNS } from '../public/patterns/auroradrop/index.js';
import { AuroraDropAnimation, DropAudio, DropCanvas, PALETTES, SIZE, SLOT_MS } from '../public/patterns/auroradrop/runtime.js';
import { EFFECTS, Move, SpiralStream1, Stream1 } from '../public/patterns/auroradrop/effects.js';
import { AUDIO_PATTERNS, Spectrum2 } from '../public/patterns/auroradrop/audio-patterns.js';

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const pixel = (canvas, x, y) => [...canvas.rgb.slice((y * SIZE + x) * 3, (y * SIZE + x) * 3 + 3)];
// A varied, moderate spectrum. Patterns that use levels as coordinates need a
// spread, and the kaleidoscopes keep only what lands in the top-left quarter
// (levels under 96).
const loud = () => Uint8Array.from({ length: 256 }, (_, i) => 20 + (i * 37) % 70);

test('AuroraDrop patterns are registered as their own group', () => {
  assert.equal(AURORADROP_PATTERNS[0].id, 'auroradrop-show');
  assert.equal(AURORADROP_PATTERNS.length, AUDIO_PATTERNS.length + 1);
  for (const pattern of AURORADROP_PATTERNS) {
    assert.ok(PATTERNS.includes(pattern));
    assert.equal(pattern.group, 'AuroraDrop');
    assert.deepEqual(pattern.controls, []);
  }
  assert.equal(new Set(AURORADROP_PATTERNS.map(pattern => pattern.id)).size, AURORADROP_PATTERNS.length);
});

test('canvas drawing is additive, clipped, and palettes blend between entries', () => {
  const canvas = new DropCanvas(seeded(1));
  assert.equal(PALETTES.length, 9);
  assert.ok(PALETTES.every(([, entries]) => entries.length === 16 && entries.every(c => c.length === 3)));
  assert.deepEqual(canvas.ColorFromCurrentPalette(0), [255, 0, 0]);
  assert.deepEqual(canvas.ColorFromCurrentPalette(96), [0, 255, 0]);
  const dim = canvas.ColorFromCurrentPalette(0, 128);
  assert.ok(dim[0] > 120 && dim[0] < 135);
  canvas.BresenhamLine(-5, 3, 70, 3, [100, 0, 0]);
  canvas.BresenhamLine(10, 3, 12, 3, [100, 0, 0]);
  canvas.BresenhamLine(10, 3, 12, 3, [100, 0, 0]);
  assert.deepEqual(pixel(canvas, 0, 3), [100, 0, 0]);
  assert.deepEqual(pixel(canvas, 11, 3), [255, 0, 0], 'overlapping lines add and saturate');
  canvas.BresenhamLine(2, 10, 6, 14, 96, 255);
  assert.deepEqual(pixel(canvas, 4, 12), [0, 255, 0], 'a number is a palette index');
});

test('kaleidoscopes, streams and moves follow AuroraDrop', () => {
  const canvas = new DropCanvas(seeded(2));
  const mark = [40, 80, 120];
  canvas.addPixel(3, 5, mark);
  canvas.Caleidoscope1();
  for (const [x, y] of [[60, 5], [60, 58], [3, 58]]) assert.deepEqual(pixel(canvas, x, y), mark);
  canvas.rgb.fill(0);
  canvas.addPixel(3, 5, mark);
  canvas.Caleidoscope2();
  assert.deepEqual(pixel(canvas, 58, 3), mark, 'the top-right quarter is transposed');
  assert.deepEqual(pixel(canvas, 60, 58), mark);

  canvas.rgb.fill(0);
  canvas.addPixel(10, 10, [200, 200, 200]);
  canvas.StreamUpAndLeft(128);
  assert.ok(pixel(canvas, 9, 9)[0] > 0, 'the pixel bleeds up and to the left');
  assert.ok(pixel(canvas, 10, 10)[0] < 200);

  canvas.rgb.fill(0);
  canvas.addPixel(0, 0, mark);
  canvas.MoveX(1);
  assert.deepEqual(pixel(canvas, 63, 0), mark, 'rows wrap');
  canvas.MoveY(1);
  assert.deepEqual(pixel(canvas, 63, 63), mark, 'columns wrap');
  canvas.MoveDown();
  assert.deepEqual(pixel(canvas, 63, 63), [0, 0, 0]);

  canvas.rgb.fill(0);
  canvas.addPixel(32, 20, [255, 255, 255]);
  canvas.SpiralStream(31, 31, 32, 128);
  assert.ok(pixel(canvas, 32, 20)[0] < 255, 'spiral streaming dims the pixel');
  assert.ok(canvas.rgb.filter(value => value > 0).length > 3, 'and smears it along the spiral');
});

test('audio data is folded from the composer spectrum into every view', () => {
  const audio = new DropAudio();
  assert.equal(audio.noAudio, true);
  const spectrum = new Uint8Array(256);
  spectrum[0] = 90; spectrum[1] = 200;   // bin 0 takes the louder of its pair
  spectrum.fill(64, 128, 144);           // bins 64..71
  audio.update(spectrum);
  assert.equal(audio.noAudio, false);
  assert.equal(audio.specData[0], 200);
  assert.equal(audio.specData[64], 64);
  assert.equal(audio.specData64[0], 100, 'averages bins 0 and 1');
  assert.equal(audio.specData32[16], 64);
  assert.equal(audio.specData16[8], 64);
  assert.equal(audio.specData8[4], 32, 'half of its sixteen bins are lit');
  assert.equal(audio.specDataMaxVolume, 200);
  audio.update(new Uint8Array(256));
  assert.equal(audio.noAudio, true);
  assert.equal(audio.specDataPeak[0], 199, 'peaks fall by one per update');
});

test('spectrum bars grow with the audio and stay centred', () => {
  const canvas = new DropCanvas(() => 0), audio = new DropAudio();
  const bars = new Spectrum2();
  bars.start(canvas);
  audio.update(new Uint8Array(256).fill(90));
  bars.draw(canvas, audio);
  const lit = [...Array(SIZE).keys()].filter(y => pixel(canvas, 5, y).some(value => value > 0));
  assert.equal(lit.length, 30, 'a level of 90 is a 30-pixel bar');
  assert.ok(Math.abs((lit[0] + lit.at(-1)) / 2 - 31.5) <= 1, 'centred on the panel');
  assert.deepEqual(pixel(canvas, 40, 31), [0, 0, 0], 'bars occupy the left half unless mirrored');
});

test('every pattern draws at several panel sizes and is repeatable', () => {
  for (const [width, height] of [[64, 64], [32, 32], [256, 192], [48, 96]]) {
    for (const pattern of AURORADROP_PATTERNS) {
      const run = () => {
        const animation = pattern.createInstance(width, height, seeded(7));
        let rgb;
        for (let frame = 0; frame < 40; ++frame)
          rgb = animation.renderFrame({ spectrum: loud(), auroraTime: frame / 30 });
        return rgb.slice();
      };
      const first = run();
      assert.equal(first.length, width * height * 3);
      assert.ok(first.some(value => value > 0), `${pattern.id} drew nothing at ${width}x${height}`);
      assert.deepEqual(first, run(), `${pattern.id} is repeatable`);
    }
  }
});

test('slots restart every ten seconds and the show swaps patterns', () => {
  const animation = new AuroraDropAnimation(
    { effects: EFFECTS, patterns: AUDIO_PATTERNS.map(pattern => pattern.Pattern), layers: 2 }, 64, 64, seeded(3));
  assert.equal(animation.slots.length, 3, 'one effect and two audio layers');
  const seen = new Set();
  const first = animation.slots.map(slot => slot.instance);
  for (let frame = 0; frame < 60 * 65; ++frame) {
    animation.audio.update(loud());
    animation.step();
    animation.slots.forEach(slot => seen.add(slot.instance.constructor.name));
  }
  assert.ok(animation.slots.every((slot, i) => slot.instance !== first[i]));
  assert.ok(animation.canvas.ms > 6 * SLOT_MS);
  assert.ok(seen.size >= 6, `saw ${[...seen].join(', ')}`);
});

test('effects keep AuroraDrop\'s random ranges, including the single-valued ones', () => {
  const canvas = new DropCanvas(seeded(4));
  for (let i = 0; i < 50; ++i) {
    const spiral = new SpiralStream1();
    spiral.start(canvas);
    assert.equal(spiral.addBlur, false);
    assert.equal(spiral.scrollStream, true);
    assert.equal(spiral.dimAmount, 250);
    assert.ok([32, 21, 16].includes(spiral.streamRadius));
    const move = new Move();
    move.start(canvas);
    assert.ok(move.direction === 0 || move.direction === 1);
    const stream = new Stream1();
    stream.start(canvas);
    assert.equal(stream.scaleColorDown, 128);
  }
});

test('frames step on the supplied clock, capped after a long gap', () => {
  const animation = AURORADROP_PATTERNS[1].createInstance(64, 64, seeded(5));
  animation.render(0);
  assert.equal(animation.frames, 1);
  animation.render(0.5);
  assert.ok(Math.abs(animation.frames - 31) <= 1);
  const before = animation.frames;
  animation.render(3600);
  assert.ok(animation.frames - before <= 61);
  assert.throws(() => animation.render(NaN), /finite/);
  assert.throws(() => new AuroraDropAnimation({ effects: EFFECTS, patterns: [Spectrum2] }, 0, 4), /dimensions/);
});

test('every kaleidoscope arrangement runs and spreads the picture', () => {
  for (let id = 1; id <= 9; ++id) {
    const canvas = new DropCanvas(seeded(id));
    for (let i = 0; i < 64; ++i) canvas.addPixel(i, (i * 7) % 64, [200, 100, 50]);
    const before = canvas.rgb.slice();
    canvas.RandomCaleidoscope(id);
    assert.notDeepEqual([...canvas.rgb], [...before], `kaleidoscope ${id} changed the picture`);
    assert.ok(canvas.rgb.some(value => value > 0), `kaleidoscope ${id} left something showing`);
  }
  const canvas = new DropCanvas(seeded(1));
  assert.deepEqual(canvas.RotatePoint(31, 31, 0, 40, 20), [40, 20]);
  assert.deepEqual(canvas.RotatePoint(31, 31, Math.PI, 41, 31), [21, 31]);
  canvas.addPixel(5, 5, [10, 10, 10]);
  canvas.setPixel(5, 5, [1, 2, 3]);
  assert.deepEqual(pixel(canvas, 5, 5), [1, 2, 3], 'setPixel replaces');
  canvas.rgb.fill(0);
  canvas.addPixel(20, 20, [9, 9, 9]);       // in the middle block
  canvas.CaleidoscopeB1();
  assert.deepEqual(pixel(canvas, 4, 4), [9, 9, 9], 'B1 pushes the middle out to the corner');
});
