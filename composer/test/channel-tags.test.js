import assert from 'node:assert/strict';
import test from 'node:test';
import { channelTags } from '../public/channel-tags.js';
import { INPUT_DEFAULTS } from '../public/quad.js';

const plasma = {
  id: 'plasma',
  params: [
    { id: 'scale', name: 'Scale', min: 0.5, max: 8, step: 0.1, default: 3 },
    { id: 'swell', name: 'Bass swell', min: 0, max: 2, step: 0.01, default: 0.6 },
  ],
};
const input = (changes = {}, shape = {}) => ({ ...INPUT_DEFAULTS, ...changes, shape: { ...INPUT_DEFAULTS.shape, ...shape } });
const texts = (tags) => tags.map((tag) => tag.text);

test('a channel with nothing changed has no tags', () => {
  assert.deepEqual(channelTags(input(), plasma), []);
  // Settings at their defaults, saved or not, are not changes.
  assert.deepEqual(channelTags(input({ params: { scale: 3 } }), plasma), []);
  // Width, height and border do nothing on the whole panel unbent.
  assert.deepEqual(channelTags(input({}, { width: 0.9, edge: 0.3, outline: 'diamond' }), plasma), []);
});

test('each modifier has its tag, in a fixed order, spelled out in its title', () => {
  const tags = channelTags(input({ params: { scale: 6, swell: 1.2 }, brightness: 0.5, gamma: 2, hue: 1 / 3 },
    { shape: 'outside-in', region: 'centre', outline: 'diamond', width: 0.6, height: 0.4, edge: 0.2,
      spin: -2, spinReverse: 4, pulse: 0.2, pulseBeats: 2 }), plasma);
  assert.deepEqual(texts(tags), ['⚙2', 'bent in', 'centre ◇60%×40% soft', '↺2 ⇄4', '♥20%/2', '☀50%', 'γ2.00', 'hue 120°']);
  const titles = Object.fromEntries(tags.map((tag) => [tag.id, tag.title]));
  assert.equal(titles.params, 'Pattern settings changed: Scale 6.0, Bass swell 1.20');
  assert.match(titles.region, /^Centre only.*diamond 60% wide, 40% high, border softened 20% either side$/);
  assert.equal(titles.spin, 'Spin: one turn every 2 bars, anticlockwise, reversing every 4 bars (16 beats)');
  assert.equal(titles.pulse, 'Pulse: 20% larger every second beat');
  assert.match(titles.hue, /own hue, 120°/);
});

test('short forms: a bend inside out, edges at one size, a spin reversing on changes, a pulse every bar', () => {
  assert.deepEqual(texts(channelTags(input({}, { shape: 'inside-out' }), plasma)), ['bent out']);
  // On the whole panel, a bend's outline shows when it is not the default.
  assert.deepEqual(texts(channelTags(input({}, { shape: 'inside-out', outline: 'rectangle' }), plasma)), ['bent out ▭']);
  assert.deepEqual(texts(channelTags(input({}, { region: 'outer', width: 0.5, proportional: true }), plasma)), ['edges ◯50%']);
  assert.deepEqual(texts(channelTags(input({}, { spin: 8, spinReverse: -1 }), plasma)), ['↻8 ⇄♪']);
  assert.deepEqual(texts(channelTags(input({}, { pulse: 0.35, pulseBeats: 4 }), plasma)), ['♥35%/bar']);
});

test('a pattern with no settings, or none known, still gets its other tags', () => {
  assert.deepEqual(texts(channelTags(input({ gamma: 0.5 }), { id: 'radar' })), ['γ0.50']);
  assert.deepEqual(texts(channelTags(input({ params: { x: 2 } }), null)), ['⚙1']);
});
