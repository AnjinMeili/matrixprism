// The settings every Table Mark Estes pattern shares (T71): they leave the
// picture alone at their defaults, and each does what it names.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MARK_ESTES_PATTERNS, TME_PATTERNS } from '../public/patterns/mark-estes/index.js';
import { TME_PARAMS, resolveTmeSettings } from '../public/patterns/mark-estes/settings.js';
import { TmeAnimation, TmeRuntime, hsv } from '../public/patterns/mark-estes/runtime.js';
import { scale8 } from '../public/aurora-fastled.js';
import { changedParams, followedValues, paramProblems, paramValues } from '../public/params.js';
import { seeded, tmeFramesHash, tmeHashes, tmeRun } from '../tools/tme-frames.js';

const BASELINE = JSON.parse(readFileSync(new URL('./fixtures/tme-baseline.json', import.meta.url)));
const byNumber = (number) => MARK_ESTES_PATTERNS.find((pattern) => pattern.id === `tme-${number}`);
const sketchPattern = (number) => TME_PATTERNS.find((pattern) => pattern.number === number);
const pixel = (t, x, y) => [...t.rgb.slice((y * t.W + x) * 3, (y * t.W + x) * 3 + 3)];

test('at the defaults every pattern draws as it did before the settings', () => {
  const allDefaults = Object.fromEntries(TME_PARAMS.map((param) => [param.id, param.default]));
  for (const settings of [undefined, {}, allDefaults]) {
    const hashes = tmeHashes(MARK_ESTES_PATTERNS, settings);
    assert.equal(Object.keys(hashes).length, 282);
    for (const [key, hash] of Object.entries(BASELINE))
      assert.equal(hashes[key], hash, `${key} with ${JSON.stringify(settings)}`);
  }
});

test('every pattern declares the shared settings, soundly', () => {
  assert.deepEqual(TME_PARAMS.map((param) => param.id),
    ['speed', 'fade', 'paleness', 'hueShift', 'drift', 'mirror', 'wind', 'decoration', 'fadeColour']);
  for (const pattern of MARK_ESTES_PATTERNS) {
    // The shared settings, then the variation (T72).
    assert.deepEqual(pattern.params.slice(0, TME_PARAMS.length), TME_PARAMS, pattern.id);
    assert.deepEqual(pattern.params.slice(TME_PARAMS.length).map((param) => param.id), ['variation'], pattern.id);
    assert.deepEqual(paramProblems(pattern), [], pattern.id);
  }
  for (const param of TME_PARAMS.filter((entry) => entry.type === 'choice')) {
    assert.equal(param.default, 'random');
    assert.equal(new Set(param.choices.map((choice) => choice.id)).size, param.choices.length, param.id);
  }
});

// The patterns a number setting cannot change, measured over two seeds, and
// why. A change to these lists is a change in what the settings reach.
const UNCHANGED = {
  // 50 paints a backdrop over the whole panel each step; 150 redraws every
  // pixel from its palette; 154 and 155 set no fade.
  fade: [50, 150, 154, 155],
  // Their effects never read the rolled paleness (`velo`).
  paleness: [10, 11, 17, 23, 30, 31, 58, 59, 69, 82, 87, 88, 96, 102, 111, 112, 114, 120, 146, 147, 150, 187],
  // Fat Fire draws from fixed fire palettes on most runs.
  hueShift: [150],
  // These keep their centre in the middle, or draw without one.
  drift: [19, 22, 23, 26, 27, 28, 29, 30, 31, 32, 33, 36, 37, 38, 40, 42, 43, 45, 47, 49, 50, 51, 52, 53, 55,
    69, 75, 102, 104, 110, 111, 112, 114, 120, 124, 129, 130, 131, 137, 138, 146, 150, 153, 154, 155, 159, 162,
    166, 184],
};

test('each number setting changes the picture, except where listed', () => {
  const SEEDS = [7, 1];
  const hashes = (pattern, settings) => SEEDS.map((seed) => tmeFramesHash(pattern, 64, 32, seed, settings));
  const defaults = new Map(MARK_ESTES_PATTERNS.map((pattern) => [pattern, hashes(pattern)]));
  for (const [id, values] of Object.entries({ fade: [0, 3], paleness: [-255, 255], hueShift: [128], drift: [0, 4] })) {
    for (const value of values) {
      const unchanged = MARK_ESTES_PATTERNS
        .filter((pattern) => hashes(pattern, { [id]: value }).every((hash, i) => hash === defaults.get(pattern)[i]))
        .map((pattern) => Number(pattern.id.slice(4)));
      assert.deepEqual(unchanged, UNCHANGED[id], `${id} at ${value}`);
    }
  }
});

test('Speed scales the steps a second', () => {
  const steps = (speed) => {
    const animation = new TmeAnimation(sketchPattern(14), 32, 32, seeded(6));
    animation.applySettings({ speed });
    const fps = animation.runtime.targetfps;
    for (let frame = 0; frame <= 60; ++frame) animation.render(frame / 60);
    return { frames: animation.frames - 1, fps };
  };
  const once = steps(1), twice = steps(2), quarter = steps(0.25);
  assert.ok(Math.abs(once.frames - once.fps) <= 1, `${once.frames} steps at ${once.fps} a second`);
  assert.ok(Math.abs(twice.frames - 2 * twice.fps) <= 1, `${twice.frames} steps at twice ${twice.fps}`);
  assert.ok(Math.abs(quarter.frames - quarter.fps / 4) <= 1, `${quarter.frames} steps at a quarter of ${quarter.fps}`);
});

test('Fade 0 keeps what is drawn, Fade 2 fades twice as far, Fade colour picks the colour', () => {
  const fadeOnce = (bfade, settings) => {
    const t = new TmeRuntime(8, 8, seeded(1));
    t.applySettings(settings);
    t.bfade = bfade;
    t.rgb.fill(200);
    t.checkfader();
    return pixel(t, 3, 3);
  };
  // bfade 2 fades to black by 8 + 16 + 2 = 26 of 255.
  const faded = (amount) => Array(3).fill(scale8(200, 255 - amount));
  assert.deepEqual(fadeOnce(2, {}), faded(26));
  assert.deepEqual(fadeOnce(2, { fade: 0 }), [200, 200, 200]);
  assert.deepEqual(fadeOnce(2, { fade: 2 }), faded(52));
  // The same amount as a red fade: red loses half as much as green and blue
  // (or than green alone, as flop[2] chooses).
  const red = fadeOnce(2, { fadeColour: 'red' });
  assert.equal(red[0], 200 - 13);
  assert.equal(red[2], 200 - 26);
  // A roll of no fade stays so, whatever the colour.
  assert.deepEqual(fadeOnce(0, { fade: 3, fadeColour: 'blue' }), [200, 200, 200]);
});

test('Colour shift recolours without moving anything', () => {
  const run = (hueShift) => {
    const t = tmeRun(byNumber(14), 48, 48, 3, { hueShift, fade: 0, decoration: 'none', wind: 'none' });
    for (let step = 0; step < 40; ++step) t.step();
    return t.rgb;
  };
  const plain = run(0), shifted = run(128);
  const lit = (rgb) => Array.from({ length: rgb.length / 3 }, (_, i) => rgb[3 * i] + rgb[3 * i + 1] + rgb[3 * i + 2] > 0);
  assert.deepEqual(lit(shifted), lit(plain), 'the same pixels are lit');
  assert.notDeepEqual(shifted, plain, 'in other colours');
  // Nothing outside a pattern's step is shifted.
  const before = hsv(10);
  const t = tmeRun(byNumber(14), 8, 8, 1, { hueShift: 128 });
  t.step();
  assert.deepEqual(hsv(10), before);
});

test('Drift 0 holds the wandering centre still', () => {
  const t = tmeRun(byNumber(10), 64, 32, 7, { drift: 0 });
  t.step();
  const start = [t.driftx, t.drifty];
  for (let step = 0; step < 60; ++step) t.step();
  assert.deepEqual([t.driftx, t.drifty], start);
  const moving = tmeRun(byNumber(10), 64, 32, 7, { drift: 4 });
  for (let step = 0; step < 60; ++step) moving.step();
  assert.notDeepEqual([moving.driftx, moving.drifty], start);
});

test('a fixed Mirror holds through re-rolls, even on patterns that never mirror', () => {
  const symmetric = (t) => {
    for (let y = 0; y < t.H; ++y)
      for (let x = 0; x < t.W; ++x) {
        assert.deepEqual(pixel(t, x, y), pixel(t, t.W - 1 - x, y), `left to right at ${x},${y}`);
        assert.deepEqual(pixel(t, x, y), pixel(t, x, t.H - 1 - y), `top to bottom at ${x},${y}`);
      }
  };
  // 11 never calls the sketch's mirror; 4 does; 147 changes its own mirror.
  for (const number of [11, 4, 147]) {
    const t = tmeRun(byNumber(number), 64, 32, 5, { mirror: 'fourWays' });
    for (let step = 0; step < 40; ++step) t.step();
    symmetric(t);
    t.ms = t.patternStart + t.dwell;
    t.step();
    assert.equal(t.counter, 0, 're-rolled');
    for (let step = 0; step < 40; ++step) t.step();
    symmetric(t);
  }
});

test('a mirror for square panels leaves a wider panel unmirrored, as the sketch never rolls it there', () => {
  const wide = tmeRun(byNumber(11), 64, 32, 5, { mirror: 'pinwheel' });
  const square = tmeRun(byNumber(11), 48, 48, 5, { mirror: 'pinwheel' });
  for (let step = 0; step < 20; ++step) {
    wide.step();
    square.step();
  }
  assert.equal(wide.adjunct, 0);
  assert.equal(square.adjunct, 6);
  assert.equal(tmeFramesHash(byNumber(11), 64, 32, 5, { mirror: 'pinwheel' }),
    tmeFramesHash(byNumber(11), 64, 32, 5, { mirror: 'none' }));
});

test('choices left on Random keep rolling as the sketch does', () => {
  const rolls = new Set();
  for (let seed = 1; seed <= 20; ++seed) {
    const t = tmeRun(byNumber(62), 64, 32, seed);
    rolls.add(`${t.adjunct}/${t.wind}/${t.fancy}`);
  }
  assert.ok(rolls.size > 10, `${rolls.size} different rolls in 20`);
});

test('Wind moves the picture the way it is named', () => {
  const moved = (wind) => {
    const t = new TmeRuntime(16, 16, seeded(1));
    t.applySettings({ wind });
    t.holdChoices();
    t.rgb.fill(0);
    t.rgb[(8 * 16 + 8) * 3] = 255;
    t.counter = 1;
    t.checkwind();
    const i = t.rgb.indexOf(255) / 3;
    return [i % 16 - 8, Math.floor(i / 16) - 8];
  };
  assert.deepEqual(moved('up'), [0, -1]);
  assert.deepEqual(moved('down'), [0, 1]);
  assert.deepEqual(moved('left'), [-1, 0]);
  assert.deepEqual(moved('right'), [1, 0]);
  assert.deepEqual(moved('upRight'), [1, -1]);
  assert.deepEqual(moved('downLeft'), [-1, 1]);
  assert.deepEqual(moved('upFast'), [0, -2]);
  assert.deepEqual(moved('leftFast'), [-2, 0]);
  // A fixed wind outlasts twister(), which changes it every 20 seconds of
  // the pattern's own time (1200 steps is over 30).
  const t = tmeRun(byNumber(120), 64, 32, 2, { wind: 'left' });
  const blown = new Set(), checkwind = t.checkwind.bind(t);
  t.checkwind = () => {
    blown.add(t.wind);
    checkwind();
  };
  for (let step = 0; step < 1200; ++step) t.step();
  assert.deepEqual([...blown], [7]);
  const rolling = tmeRun(byNumber(120), 64, 32, 2);
  const rolled = new Set();
  for (let step = 0; step < 1200; ++step) {
    rolled.add(rolling.wind);
    rolling.step();
  }
  assert.ok(rolled.size > 1, 'on Random, twister still changes it');
});

test('Decoration None removes the decoration a pattern picks for itself', () => {
  const t = tmeRun(byNumber(69), 64, 32, 3, { decoration: 'none' });
  for (let step = 0; step < 30; ++step) t.step();
  assert.equal(t.fancy, 0);
  const rolled = tmeRun(byNumber(69), 64, 32, 3);
  assert.ok(rolled.fancy >= 1 && rolled.fancy < 24, 'pattern 69 picks one itself');
  const ringed = tmeRun(byNumber(69), 64, 32, 3, { decoration: 'rings' });
  assert.equal(ringed.fancy, 8);
});

test('Paleness is added to the rolled paleness and held in range', () => {
  const t = tmeRun(byNumber(14), 32, 32, 4);
  const rolled = t.velo;
  t.applySettings({ paleness: 40 });
  assert.equal(t.velo, Math.min(255, rolled + 40));
  t.applySettings({ paleness: -255 });
  assert.equal(t.velo, 0);
  t.applySettings({ paleness: 255 });
  assert.equal(t.velo, 255);
  t.applySettings({});
  assert.equal(t.velo, rolled);
});

test('settings out of range or unknown fall back safely', () => {
  const resolved = resolveTmeSettings({ speed: 99, fade: -1, paleness: 'x', mirror: 'sideways', wind: 'random' });
  assert.equal(resolved.speed, 4);
  assert.equal(resolved.fade, 0);
  assert.equal(resolved.paleness, 0);
  assert.equal(resolved.adjunct, null);
  assert.equal(resolved.wind, null);
});

test('Follows reaches a TME pattern: Speed following the beat steps faster on the beat', () => {
  const pattern = byNumber(14);
  const values = { ...paramValues(pattern, {}), follows: { speed: { source: 'beat', amount: 0.5 } } };
  assert.equal(followedValues(pattern, values, { audio: { beat: 0 } }).speed, 1);
  assert.equal(followedValues(pattern, values, { audio: { beat: 1 } }).speed, 1 + 0.5 * 3.75);
  const steps = (beat) => {
    const animation = pattern.createInstance(32, 32, seeded(6));
    const state = { audio: { beat }, spectrum: new Uint8Array(256) };
    for (let frame = 0; frame <= 60; ++frame)
      animation.renderFrame({ ...state, auroraTime: frame / 60 }, followedValues(pattern, values, state));
    return animation.frames;
  };
  assert.ok(steps(1) > 2 * steps(0), `${steps(1)} steps on the beat, ${steps(0)} off it`);
});

test('settings and follows survive the save path every pattern uses', () => {
  const pattern = byNumber(147);
  const set = { ...paramValues(pattern, {}), speed: 2.5, paleness: -40, mirror: 'fourWays', wind: 'upFast',
    follows: { speed: { source: 'lows', amount: 0.5 }, hueShift: { source: 'key', amount: 1 } } };
  const saved = JSON.parse(JSON.stringify(changedParams(pattern, set)));
  assert.deepEqual(saved, { speed: 2.5, paleness: -40, mirror: 'fourWays', wind: 'upFast',
    follows: { speed: { source: 'lows', amount: 0.5 }, hueShift: { source: 'key', amount: 1 } } });
  assert.deepEqual(paramValues(pattern, saved), set);
  // Reset: nothing saved is every default, and draws as before.
  assert.deepEqual(changedParams(pattern, paramValues(pattern, {})), {});
});
