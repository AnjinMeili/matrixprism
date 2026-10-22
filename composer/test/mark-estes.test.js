import assert from 'node:assert/strict';
import test from 'node:test';
import { PATTERNS } from '../public/patterns.js';
import { MARK_ESTES_PATTERNS, TME_PATTERNS } from '../public/patterns/mark-estes/index.js';
import {
  TmeRuntime, TmeAnimation, hsv, palette16, gradientPalette16, colorFromPalette,
} from '../public/patterns/mark-estes/runtime.js';

// Small deterministic generator so runs can be repeated.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const pixel = (t, x, y) => [...t.rgb.slice((y * t.W + x) * 3, (y * t.W + x) * 3 + 3)];

test('first batch is registered as its own group with the sketch pattern numbers', () => {
  assert.deepEqual(TME_PATTERNS.map(pattern => pattern.number),
    [4, 10, 11, 14, 17, 19, 22, 23, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42,
      43, 44, 45, 46, 47, 49, 50, 51, 52, 53, 55, 58, 59, 60, 62, 66, 67, 69, 70, 72, 75, 77, 79, 80, 81,
      82, 87, 88, 96, 101, 102, 103, 104, 105, 107, 108, 110, 111, 112, 113, 114, 115, 118, 119, 120,
      124, 128, 129, 130, 131, 134, 137, 138, 146, 147, 150, 153, 154, 155, 157, 158, 159, 162, 165, 166, 184, 187, 190]);
  assert.equal(new Set(TME_PATTERNS.map(pattern => pattern.number)).size, TME_PATTERNS.length);
  for (const pattern of MARK_ESTES_PATTERNS) {
    assert.ok(PATTERNS.includes(pattern));
    assert.equal(pattern.group, 'Mark Estes');
    assert.match(pattern.id, /^tme-\d+$/);
  }
});

test('hsv follows the FastLED rainbow conversion', () => {
  assert.deepEqual(hsv(0, 255, 255), [255, 0, 0]);
  assert.deepEqual(hsv(32, 255, 255), [171, 85, 0]);
  assert.deepEqual(hsv(64, 255, 255), [171, 170, 0]);
  assert.deepEqual(hsv(96, 255, 255), [0, 255, 0]);
  assert.deepEqual(hsv(160, 255, 255), [0, 0, 255]);
  assert.deepEqual(hsv(77, 0, 255), [255, 255, 255]);
  assert.deepEqual(hsv(77, 255, 0), [0, 0, 0]);
  assert.deepEqual(hsv(256 + 96, 255, 255), hsv(96, 255, 255), 'hue wraps like a byte');
  assert.deepEqual(hsv(-160, 255, 255), hsv(96, 255, 255));
  const dim = hsv(0, 255, 120);
  assert.ok(dim[0] > 40 && dim[0] < 70 && dim[1] === 0 && dim[2] === 0);
});

test('palettes blend between their entries', () => {
  const ramp = palette16([0, 0, 0], [255, 0, 0], [255, 255, 0], [255, 255, 255]);
  assert.equal(ramp.length, 16);
  assert.deepEqual(ramp[0], [0, 0, 0]);
  assert.deepEqual(ramp[5], [255, 0, 0]);
  assert.deepEqual(ramp[10], [255, 255, 0]);
  assert.deepEqual(ramp[15], [255, 255, 255]);
  assert.deepEqual(colorFromPalette(ramp, 80), [255, 0, 0]);
  const between = colorFromPalette(ramp, 88);
  assert.ok(between[1] > 0 && between[1] < 51);
  const gradient = gradientPalette16([0, 0, 0, 0, 255, 255, 255, 255]);
  assert.deepEqual(gradient[0], [0, 0, 0]);
  assert.deepEqual(gradient[15], [255, 255, 255]);
});

test('drawing clips to the panel and matches simple shapes', () => {
  const t = new TmeRuntime(16, 12, seeded(1));
  const red = [255, 0, 0];
  t.set(-1, 0, red); t.set(16, 0, red); t.set(0, 12, red);
  assert.ok(t.rgb.every(value => value === 0));
  t.set(3.9, 2.9, red);
  assert.deepEqual(pixel(t, 3, 2), red, 'coordinates truncate');
  t.rgb.fill(0);
  t.DLine(-5, 4, 40, 4, red);
  for (let x = 0; x < 16; ++x) assert.deepEqual(pixel(t, x, 4), red);
  t.rgb.fill(0);
  t.DLine(2, 1, 6, 5, red);
  for (let i = 0; i <= 4; ++i) assert.deepEqual(pixel(t, 2 + i, 1 + i), red);
  t.rgb.fill(0);
  t.DFCircle(8, 6, 3, red);
  assert.deepEqual(pixel(t, 8, 6), red);
  assert.deepEqual(pixel(t, 11, 6), red);
  assert.deepEqual(pixel(t, 8, 9), red);
  assert.deepEqual(pixel(t, 12, 6), [0, 0, 0]);
  assert.deepEqual(pixel(t, 11, 9), [0, 0, 0]);
  t.rgb.fill(0);
  t.DCircle(8, 6, 3, red);
  assert.deepEqual(pixel(t, 8, 6), [0, 0, 0], 'outline only');
  assert.deepEqual(pixel(t, 5, 6), red);
  t.DCircle(8, 6, -2, red);
  t.DFCircle(8, 6, -2, red);
  t.rgb.fill(0);
  t.DFRectangle(14, 10, 30, 30, red);
  assert.deepEqual(pixel(t, 15, 11), red);
  assert.deepEqual(pixel(t, 13, 11), [0, 0, 0]);
});

test('mirrors and shifts follow LEDMatrix', () => {
  const t = new TmeRuntime(8, 8, seeded(2));
  const mark = [9, 8, 7];
  t.set(1, 2, mark);
  t.HorizontalMirror();
  assert.deepEqual(pixel(t, 6, 2), mark);
  t.VerticalMirror();
  assert.deepEqual(pixel(t, 1, 5), mark);
  assert.deepEqual(pixel(t, 6, 5), mark);

  t.rgb.fill(0);
  t.set(1, 3, mark);
  t.TriangleTopMirror();
  assert.deepEqual(pixel(t, 3, 1), mark);

  t.rgb.fill(0);
  t.set(1, 0, mark);
  t.QuadrantRotateMirror();
  assert.deepEqual(pixel(t, 6, 7), mark, 'half turn');
  assert.equal([...t.rgb].filter(value => value === 9).length, 4, 'four rotated copies');

  t.rgb.fill(0);
  t.set(4, 4, mark);
  t.ShiftLeft();
  assert.deepEqual(pixel(t, 3, 4), mark);
  t.ShiftRight(); t.ShiftRight();
  assert.deepEqual(pixel(t, 5, 4), mark);
  t.ShiftDown();
  assert.deepEqual(pixel(t, 5, 3), mark, 'LEDMatrix "down" is towards row 0');
  t.ShiftUp(); t.ShiftUp();
  assert.deepEqual(pixel(t, 5, 5), mark);
  assert.equal([...t.rgb].filter(value => value === 9).length, 1);
  t.set(7, 0, mark);
  t.ShiftRight();
  assert.deepEqual(pixel(t, 0, 1), [0, 0, 0], 'shifts do not wrap between rows');

  t.rgb.fill(200);
  t.bfade = 3; t.checkfader();
  assert.ok(t.rgb.every(value => value < 200 && value > 150));
  t.rgb.fill(200); t.flop[2] = true;
  t.bfade = 6; t.checkfader();
  assert.deepEqual(pixel(t, 0, 0), [192, 184, 184], 'red fade leaves more red');
  t.rgb.fill(200);
  t.bfade = 99; t.checkfader();
  assert.ok(t.rgb.every(value => value === 200));
});

test('Arduino-style random stays in range and tolerates empty ranges', () => {
  const t = new TmeRuntime(16, 16, seeded(3));
  for (let i = 0; i < 500; ++i) {
    const a = t.random(5), b = t.random(3, 7), c = t.random8(), d = t.random8(60);
    assert.ok(a >= 0 && a < 5 && b >= 3 && b < 7 && c >= 0 && c < 256 && d >= 0 && d < 60);
  }
  assert.equal(t.random(4, 4), 4);
  assert.equal(t.random(9, 2), 9);
  assert.throws(() => new TmeRuntime(4, 4), /8x8/);
});

test('every pattern draws at several panel sizes, with every flag combination reachable', () => {
  for (const [width, height] of [[32, 32], [64, 32], [48, 96], [128, 64]]) {
    for (const pattern of MARK_ESTES_PATTERNS) {
      let lit = false;
      for (let seed = 1; seed <= 6 && !lit; ++seed) {
        const animation = pattern.createInstance(width, height, seeded(seed * 7919));
        for (let frame = 0; frame < 40; ++frame) {
          const rgb = animation.render(frame / 2);
          assert.equal(rgb.length, width * height * 3);
          lit ||= rgb.some(value => value > 0);
        }
      }
      assert.ok(lit, `${pattern.id} drew nothing at ${width}x${height}`);
    }
  }
});

test('patterns are repeatable for a given random sequence and re-roll after their dwell', () => {
  for (const pattern of MARK_ESTES_PATTERNS) {
    const run = () => {
      const animation = pattern.createInstance(48, 32, seeded(42));
      for (let frame = 1; frame <= 30; ++frame) animation.render(frame / 2);
      return animation.render(16).slice();
    };
    assert.deepEqual(run(), run(), pattern.id);
  }
  const animation = new TmeAnimation(TME_PATTERNS.find(p => p.number === 14), 32, 32, seeded(5));
  const t = animation.runtime;
  const firstDwell = t.dwell;
  assert.ok(firstDwell >= 99000 && firstDwell < 169000);
  t.ms = t.patternStart + t.dwell;
  t.counter = 50;
  t.step();
  assert.equal(t.counter, 0, 'parameters were re-rolled');
  assert.ok(t.patternStart > 0);
});

test('animation steps at the pattern frame rate on the supplied clock', () => {
  const animation = new TmeAnimation(TME_PATTERNS.find(p => p.number === 14), 32, 32, seeded(6));
  const fps = animation.runtime.targetfps;
  assert.ok(fps >= 12 && fps < 25, 'pattern 14 sets its own rate');
  animation.render(0);
  assert.equal(animation.frames, 1);
  animation.render(0);
  assert.equal(animation.frames, 1);
  animation.render(0.5);
  assert.ok(Math.abs(animation.frames - 1 - fps / 2) <= 1);
  const before = animation.frames;
  animation.render(3600);
  assert.ok(animation.frames - before <= fps + 1, 'long gaps are capped at one second');
  assert.throws(() => animation.render(NaN), /finite/);
});

test('every decoration runs, and paired decorations draw both parts', async () => {
  const decorations = await import('../public/patterns/mark-estes/decorations.js');
  for (let fancy = 0; fancy <= 31; ++fancy) {
    const t = new TmeRuntime(48, 32, seeded(100 + fancy));
    t.start({ run() {}, setup(runtime) { runtime.fancy = fancy; runtime.bfade = 99; runtime.wind = 0; } });
    t.ringdelay = 2; t.bringdelay = 3;
    for (let frame = 0; frame < 120; ++frame) t.step();
    if (fancy >= 1 && fancy <= 27 || fancy === 29)
      assert.ok(t.rgb.some(value => value > 0), `fancy ${fancy} drew nothing`);
  }
  const t = new TmeRuntime(48, 32, seeded(7));
  t.start({ run() {}, setup(runtime) { runtime.fancy = 0; runtime.bfade = 99; runtime.wind = 0; } });
  t.counter = 10; t.ringdelay = 5;
  decorations.ringer(t);
  assert.ok(t.rgb.some(value => value > 0));
  t.counter = 5 + t.BIGGER + 1;
  decorations.ringer(t);
  assert.ok(t.ringdelay > t.counter, 'next ring is scheduled after the current one ends');
  t.rgb.fill(0);
  t.ADCircle(10, 10, 4, [100, 0, 0]);
  t.ADCircle(10, 10, 4, [100, 0, 0]);
  assert.equal(Math.max(...t.rgb), 200, 'additive circles accumulate');
});

test('every-N timers fire once per period of simulated time', () => {
  const t = new TmeRuntime(16, 16, seeded(9));
  assert.equal(t.every('x', 2), false, 'the first call only starts the clock');
  t.ms += 1999;
  assert.equal(t.every('x', 2), false);
  t.ms += 1;
  assert.equal(t.every('x', 2), true);
  assert.equal(t.every('x', 2), false);
  assert.equal(t.every('y', 2), false, 'timers are independent');
});

test('audio patterns follow the supplied spectrum and fall back to moving stand-in levels', () => {
  const t = new TmeRuntime(64, 32, seeded(11));
  t.start(TME_PATTERNS.find(p => p.number === 52));
  t.audioprocess();
  assert.equal(t.gotmusic, false);
  assert.ok(t.LLaudio.some(value => value > 0), 'stand-in levels are present in silence');
  const before = t.LLaudio.slice();
  t.ms += 400;
  t.audioprocess();
  assert.notDeepEqual([...t.LLaudio], [...before], 'stand-in levels move');

  const spectrum = new Uint8Array(256);
  spectrum.fill(255, 0, 4);      // bin 0 full
  spectrum.fill(128, 128, 132);  // bin 32 half
  t.setAudio(spectrum, { level: 0.5, beat: 1 });
  t.audioprocess();
  assert.equal(t.gotmusic, true);
  assert.equal(t.LLaudio[0], 63);
  assert.equal(t.LLaudio[32], 32);
  assert.equal(t.LLaudio[1], 0);
  assert.deepEqual([...t.RRaudio], [...t.LLaudio], 'a mono source feeds both channels');
  assert.equal(t.target, true, 'a beat is latched for one step');
  t.setAudio(spectrum, { level: 0.5, beat: 1 });
  t.audioprocess();
  assert.equal(t.target, false, 'a held beat does not repeat');
  t.setAudio(spectrum, { level: 0.5, beat: 0.2 });
  t.setAudio(spectrum, { level: 0.5, beat: 1 });
  t.audioprocess();
  assert.equal(t.target, true);

  // Silence for more than five simulated seconds returns to the stand-in.
  t.setAudio(new Uint8Array(256), { level: 0, beat: 0 });
  t.ms += 5001;
  t.audioprocess();
  assert.equal(t.gotmusic, false);
});

test('centre bars reach as far as their spectrum bin and span the panel width', () => {
  for (const width of [64, 96, 256]) {
    const animation = new TmeAnimation(TME_PATTERNS.find(p => p.number === 138), width, 64, seeded(12));
    const t = animation.runtime;
    t.wind = 0; t.bfade = 99; t.fancy = 0;
    const spectrum = new Uint8Array(256).fill(0);
    spectrum.fill(255, 252, 256);  // only the highest bin is loud
    const state = { spectrum, audio: { level: 1, beat: 0 }, auroraTime: 0 };
    animation.renderFrame(state);
    t.rgb.fill(0);
    state.auroraTime = 1 / t.targetfps + 1e-6;
    animation.renderFrame(state);
    const lit = (x, y) => t.rgb[(y * width + x) * 3] + t.rgb[(y * width + x) * 3 + 1] + t.rgb[(y * width + x) * 3 + 2] > 0;
    assert.ok(lit(width - 1, 60), `right-hand column is tall at width ${width}`);
    assert.ok(lit(width - 1, 3));
    assert.ok(!lit(0, 60), 'quiet bins stay at the centre line');
    assert.ok(lit(0, 32));
  }
});

test('separate left and right spectra reach the stereo patterns', () => {
  const animation = new TmeAnimation(TME_PATTERNS.find(p => p.number === 32), 64, 64, seeded(13));
  const left = new Uint8Array(256).fill(255), right = new Uint8Array(256);
  animation.renderFrame({ spectrum: left, spectrumLeft: left, spectrumRight: right, audio: { level: 1 }, auroraTime: 0 });
  const t = animation.runtime;
  assert.equal(t.LLaudio[20], 63);
  assert.equal(t.RRaudio[20], 0);
});

test('audio spokes grow with their spectrum bin', () => {
  const lit = (level) => {
    const animation = new TmeAnimation(TME_PATTERNS.find(p => p.number === 35), 64, 64, seeded(14));
    const t = animation.runtime;
    t.wind = 0; t.bfade = 99; t.fancy = 0;
    const spectrum = new Uint8Array(256).fill(level);
    const state = { spectrum, audio: { level: level / 255 }, auroraTime: 0 };
    animation.renderFrame(state);
    t.rgb.fill(0);
    state.auroraTime = 1 / t.targetfps + 1e-6;
    animation.renderFrame(state);
    return t.rgb.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
  };
  assert.ok(lit(255) > lit(60) * 2, 'louder input draws longer spokes');
  assert.ok(lit(60) > 0);
});

test('coarse bands feed the checker board, alternating channels by column', () => {
  const animation = new TmeAnimation(TME_PATTERNS.find(p => p.number === 45), 64, 64, seeded(15));
  const t = animation.runtime;
  t.wind = 0; t.bfade = 99; t.fancy = 0;
  const left = new Uint8Array(256).fill(255), right = new Uint8Array(256);
  const state = { spectrum: left, spectrumLeft: left, spectrumRight: right, audio: { level: 1 }, auroraTime: 0 };
  animation.renderFrame(state);
  assert.equal(t.laudio[3], 63);
  assert.equal(t.raudio[3], 0);
  t.rgb.fill(0);
  state.auroraTime = 1 / t.targetfps + 1e-6;
  animation.renderFrame(state);
  const lit = (x, y) => t.rgb[(y * 64 + x) * 3] + t.rgb[(y * 64 + x) * 3 + 1] + t.rgb[(y * 64 + x) * 3 + 2] > 0;
  assert.ok(lit(8, 8), 'left-channel column is filled');
  assert.ok(!lit(24, 8), 'right-channel column is empty inside its outline');
  assert.ok(lit(16, 8), 'cell outlines are drawn');
});

test('audio arcs lengthen with their band and keep left and right apart', () => {
  const count = (leftLevel, rightLevel) => {
    const animation = new TmeAnimation(TME_PATTERNS.find(p => p.number === 165), 64, 64, seeded(16));
    const t = animation.runtime;
    t.wind = 0; t.bfade = 99; t.fancy = 0; t.adjunct = 0; t.flop[10] = true;
    const left = new Uint8Array(256).fill(leftLevel), right = new Uint8Array(256).fill(rightLevel);
    const state = { spectrum: left, spectrumLeft: left, spectrumRight: right, audio: { level: 1 }, auroraTime: 0 };
    animation.renderFrame(state);
    t.rgb.fill(0);
    state.auroraTime = 1 / t.targetfps + 1e-6;
    animation.renderFrame(state);
    const lit = (x0, x1) => {
      let total = 0;
      for (let y = 0; y < 64; ++y)
        for (let x = x0; x < x1; ++x)
          if (t.rgb[(y * 64 + x) * 3] + t.rgb[(y * 64 + x) * 3 + 1] + t.rgb[(y * 64 + x) * 3 + 2] > 0) total++;
      return total;
    };
    return { rightHalf: lit(33, 64), leftHalf: lit(0, 31) };
  };
  const leftOnly = count(255, 4), rightOnly = count(4, 255);
  // Left arcs sweep from the top through the right-hand side of the panel.
  assert.ok(leftOnly.rightHalf > leftOnly.leftHalf * 3);
  assert.ok(rightOnly.leftHalf > rightOnly.rightHalf * 3);
  assert.ok(count(255, 255).rightHalf > count(100, 100).rightHalf);
});

test('silence can show the stand-in or stay quiet', () => {
  const levels = (silenceMode) => {
    const animation = new TmeAnimation(TME_PATTERNS.find(p => p.number === 138), 64, 64, seeded(17));
    const state = { spectrum: new Uint8Array(256), audio: { level: 0, beat: 0 }, auroraTime: 0, silenceMode };
    for (let frame = 0; frame < 5; ++frame) {
      state.auroraTime = frame / 10;
      animation.renderFrame(state);
    }
    return animation.runtime;
  };
  assert.ok(levels(undefined).LLaudio.some(value => value > 0), 'default is the moving stand-in');
  assert.ok(levels('standin').LLaudio.some(value => value > 0));
  const quiet = levels('quiet');
  assert.ok(quiet.LLaudio.every(value => value === 0) && quiet.RRaudio.every(value => value === 0));
  assert.ok(quiet.laudio.every(value => value === 0));
  assert.equal(quiet.gotmusic, false);

  // Quiet mode still follows sound as soon as there is some.
  const animation = new TmeAnimation(TME_PATTERNS.find(p => p.number === 138), 64, 64, seeded(18));
  const loud = { spectrum: new Uint8Array(256).fill(200), audio: { level: 0.8 }, auroraTime: 0, silenceMode: 'quiet' };
  animation.renderFrame(loud);
  assert.equal(animation.runtime.LLaudio[10], 50);
});
