import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INFO_FIELDS, OVERLAY_ANCHORS, newOverlay, overlayElement, overlaySettings,
  overlayText, overlayLines, overlayPlacement, infoLines, OverlayLayer,
} from '../public/overlays.js';

test('overlay settings default to an empty layer and reject malformed persisted data', () => {
  assert.deepEqual(overlaySettings(), { enabled: true, elements: [] });
  for (const type of ['clock', 'date', 'text'])
    assert.equal(overlayElement(newOverlay(type)).type, type);
  for (const invalid of [
    null, [], { elements: [] }, { enabled: 1, elements: [] },
    { enabled: true, elements: new Array(17).fill(newOverlay()) },
    { enabled: true, elements: [null] },
  ]) assert.throws(() => overlaySettings(invalid));
  for (const invalid of [
    { type: 'html' }, { anchor: 'left' }, { size: 0 }, { size: 12.5 },
    { opacity: 2 }, { backgroundOpacity: -1 }, { x: Infinity }, { y: 2049 },
    { padding: NaN }, { colour: '#fff' }, { background: 'red' },
    { enabled: 'true' }, { seconds: 1 }, { text: 'a\nb' },
    { text: 'a'.repeat(129) }, { format: 'invalid' }, { zone: 'invalid' },
  ]) assert.throws(() => overlayElement({ ...newOverlay(), ...invalid }));
  const source = { enabled: true, elements: [newOverlay()] };
  const settings = overlaySettings(source);
  source.elements[0].size = 30;
  assert.equal(settings.elements[0].size, 16);
});

test('clock text uses wall time, formats midnight/noon correctly, and supports seconds and UTC', () => {
  const clock = { ...newOverlay(), zone: 'utc' };
  const midnight = new Date('2026-10-11T00:04:05Z');
  assert.equal(overlayText(clock, midnight), '00:04');
  assert.equal(overlayText({ ...clock, seconds: true }, midnight), '00:04:05');
  assert.equal(overlayText({ ...clock, format: '12', seconds: true }, midnight), '12:04:05 AM');
  assert.equal(overlayText({ ...clock, format: '12' }, new Date('2026-10-11T12:04:05Z')), '12:04 PM');
  assert.equal(overlayText({ ...clock, format: '12' }, new Date('2026-10-11T23:59:59Z')), '11:59 PM');
  const local = new Date(2026, 9, 11, 3, 4, 5);
  assert.equal(overlayText({ ...clock, zone: 'local', seconds: true }, local), '03:04:05');
  assert.throws(() => overlayText(clock, new Date(NaN)), /clock time/);
});

test('dates respect local/UTC and custom text is literal, not interpreted markup', () => {
  const date = newOverlay('date');
  const now = new Date('2026-12-31T23:59:59Z');
  assert.equal(overlayText({ ...date, zone: 'utc' }, now), '2026-12-31');
  assert.equal(overlayText(date, new Date(2027, 0, 1, 0, 0, 0)), '2027-01-01');
  assert.equal(overlayText({ ...date, zone: 'utc', dateFormat: 'long' }, now),
    new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' }).format(now));
  assert.equal(overlayText({ ...newOverlay('text'), text: '<b>Hello</b>' }, now), '<b>Hello</b>');
  assert.equal(overlayText({ ...newOverlay('text'), text: '' }, now), '');
});

test('all nine anchors use native dimensions, padding and signed offsets with deterministic clipping', () => {
  const base = { ...newOverlay('text'), size: 8, padding: 2, x: 3, y: -2 };
  for (const [anchor] of OVERLAY_ANCHORS) {
    const box = overlayPlacement({ ...base, anchor }, 100, 60, 20);
    assert.equal(box.width, 24); assert.equal(box.height, 14);
    const [vertical, horizontal] = anchor.split('-');
    assert.equal(box.x, { left: 3, center: 41, right: 79 }[horizontal]);
    assert.equal(box.y, { top: -2, middle: 21, bottom: 44 }[vertical]);
  }
  assert.equal(overlayPlacement({ ...base, anchor: 'top-right', x: 0, y: 0 }, 1, 1, 20).x, -23);
});

function fakeCanvas() {
  const calls = [];
  const context = {
    clearRect: (...args) => calls.push(['clear', ...args]),
    measureText: text => ({ width: text.length * 8 }),
    fillRect: (...args) => calls.push(['background', context.fillStyle, context.globalAlpha, ...args]),
    fillText: (...args) => calls.push(['text', context.fillStyle, context.globalAlpha, ...args]),
  };
  return { canvas: { width: 0, height: 0, getContext: () => context }, calls };
}

test('overlay cache refreshes only on changed content, options, enable flags or panel dimensions', () => {
  const { canvas, calls } = fakeCanvas();
  const layer = new OverlayLayer(canvas);
  const settings = { enabled: true, elements: [newOverlay()] };
  const now = new Date('2026-10-11T00:04:05Z');
  assert.equal(layer.update(settings, 256, 192, now), true);
  const count = calls.length;
  assert.equal(layer.update(settings, 256, 192, new Date(now.getTime() + 1000)), false);
  assert.equal(calls.length, count);
  assert.equal(layer.update(settings, 256, 192, new Date(now.getTime() + 60000)), true);
  settings.elements[0].seconds = true;
  assert.equal(layer.update(settings, 256, 192, now), true);
  assert.equal(layer.update(settings, 256, 192, new Date(now.getTime() + 1000)), true);
  assert.equal(layer.update(settings, 32, 64, now), true);
  assert.equal(canvas.width, 32); assert.equal(canvas.height, 64);
  settings.enabled = false;
  assert.equal(layer.update(settings, 32, 64, now), true);
  assert.equal(calls.at(-1)[0], 'clear');
  assert.equal(layer.update(settings, 32, 64, new Date(now.getTime() + 1000)), false);
});

test('overlays respect stacking, per-element visibility, opacity and transparent backgrounds', () => {
  const { canvas, calls } = fakeCanvas();
  const layer = new OverlayLayer(canvas);
  const settings = { enabled: true, elements: [
    { ...newOverlay('text'), text: 'Back', colour: '#ff0000', opacity: 0.5, backgroundOpacity: 0.4 },
    { ...newOverlay('text'), text: 'Hidden', enabled: false },
    { ...newOverlay('text'), text: 'Invisible', opacity: 0 },
    { ...newOverlay('text'), text: 'Front', colour: '#00ff00', backgroundOpacity: 0 },
  ] };
  layer.update(settings, 100, 60, new Date());
  const texts = calls.filter(call => call[0] === 'text');
  assert.equal(texts.length, 2);
  assert.equal(texts[0][3], 'Back'); assert.equal(texts[1][3], 'Front');
  assert.equal(texts[0][1], '#ff0000'); assert.equal(texts[0][2], 0.5);
  const backgrounds = calls.filter(call => call[0] === 'background');
  assert.equal(backgrounds[0][2], 0.2); assert.equal(backgrounds[1][2], 0);
});

test('elements saved before fonts and info existed still load, with the browser font', () => {
  const saved = { ...newOverlay('clock') };
  delete saved.font; delete saved.fields; delete saved.layout;
  const loaded = overlayElement(saved);
  assert.equal(loaded.font, 'system');
  assert.equal(loaded.layout, 'stack');
  assert.deepEqual(loaded.fields, INFO_FIELDS.map(([id]) => id));
  const info = newOverlay('info');
  assert.equal(info.font, 'pixel');
  assert.equal(info.size, 6);
  for (const invalid of [
    { font: 'comic' }, { layout: 'grid' }, { fields: 'tempo' }, { fields: ['tempo', 'tempo'] },
    { fields: ['weather'] },
  ]) assert.throws(() => overlayElement({ ...info, ...invalid }));
  const fields = ['key'];
  const element = overlayElement({ ...info, fields });
  fields.push('tempo');
  assert.deepEqual(element.fields, ['key']);
});

const INFO = {
  tempo: { bpm: 127.6, beat: 3, detected: true },
  key: { camelot: '8A', name: 'A minor', held: false },
  patterns: ['Plasma Pulse', null],
  frames: { streaming: true, sent: 30, rendered: 31 },
  packets: { packets: 3090, errors: 0 },
};

test('info lines show what is known, in field order, and leave out what is not', () => {
  const all = INFO_FIELDS.map(([id]) => id);
  assert.deepEqual(infoLines(all, INFO),
    ['128 BPM 3/4', '8A A MIN', 'Plasma Pulse', '30 FPS', '3090 PKT/S']);
  assert.deepEqual(infoLines(['packets', 'tempo'], INFO), ['3090 PKT/S', '128 BPM 3/4']);
  assert.deepEqual(infoLines(all, {
    ...INFO,
    tempo: { bpm: 120, beat: 1, detected: false },
    key: { camelot: '1B', name: 'B major', held: true },
    patterns: ['Tunnel', 'Starfield'],
    packets: { packets: 3000, errors: 2 },
  }), ['120 BPM 1/4 MAN', '1B B MAJ ?', 'Tunnel + Starfield', '30 FPS', '3000 PKT/S 2 ERR']);
  assert.deepEqual(infoLines(['tempo'], { tempo: { bpm: 128, beat: 2, detected: true, source: 'FLX' } }),
    ['128 BPM 2/4 FLX'], 'a detected tempo names its source');
  // Not streaming: the frame rate drawn, and no packet line.
  assert.deepEqual(infoLines(['frames', 'packets'], { ...INFO, frames: { streaming: false, sent: 0, rendered: 29 } }),
    ['29 FPS NOT SENT']);
  assert.deepEqual(infoLines(['key'], { ...INFO, key: null }), ['KEY -']);
  assert.deepEqual(infoLines(all, {}), ['KEY -']);
  const element = newOverlay('info');
  assert.deepEqual(overlayLines(element, new Date(), INFO), infoLines(all, INFO));
  assert.deepEqual(overlayLines({ ...element, layout: 'line', fields: ['tempo', 'key'] }, new Date(), INFO),
    ['128 BPM 3/4  8A A MIN']);
  assert.equal(overlayText({ ...element, fields: ['tempo', 'key'] }, new Date(), INFO), '128 BPM 3/4  8A A MIN');
  assert.deepEqual(overlayLines(newOverlay('text'), new Date()), ['Your text']);
});

test('a pixel-font info block is drawn as whole-pixel squares, a line per field', () => {
  const { canvas, calls } = fakeCanvas();
  const layer = new OverlayLayer(canvas);
  const element = { ...newOverlay('info'), fields: ['tempo', 'key'], padding: 1, backgroundOpacity: 0.5 };
  assert.equal(layer.update({ enabled: true, elements: [element] }, 256, 192, new Date(), INFO), true);
  const rects = calls.filter(call => call[0] === 'background');
  // The background box: 11 glyphs wide ('128 BPM 3/4'), two lines of 5 with a gap.
  assert.deepEqual(rects[0].slice(3), [0, 0, 11 * 4 - 1 + 2, 2 * 6 - 1 + 2]);
  assert.equal(rects[0][2], 0.5);
  const squares = rects.slice(1);
  assert.ok(squares.length > 40);
  assert.ok(squares.every(([, , alpha, x, y, w, h]) => alpha === 1 && w === 1 && h === 1 &&
    Number.isInteger(x) && Number.isInteger(y)));
  // The second line starts six pixels below the first.
  assert.equal(Math.min(...squares.map(([, , , , y]) => y)), 1);
  assert.ok(squares.some(([, , , , y]) => y === 7));
  assert.ok(squares.every(([, , , , y]) => y < 12));
  assert.equal(calls.filter(call => call[0] === 'text').length, 0);
  // Same content, nothing redrawn; a new beat, redrawn.
  assert.equal(layer.update({ enabled: true, elements: [element] }, 256, 192, new Date(), INFO), false);
  assert.equal(layer.update({ enabled: true, elements: [element] }, 256, 192, new Date(),
    { ...INFO, tempo: { ...INFO.tempo, beat: 4 } }), true);
  // Size 12 doubles every square.
  calls.length = 0;
  layer.update({ enabled: true, elements: [{ ...element, size: 12 }] }, 256, 192, new Date(), INFO);
  assert.ok(calls.filter(call => call[0] === 'background').slice(1).every(([, , , , , w, h]) => w === 2 && h === 2));
});
