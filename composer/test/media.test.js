import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEDIA_PATTERN, MediaPattern, MediaSource, directoryFiles, fitRect, mediaEntries, mediaKind,
} from '../public/media.js';
import { PATTERNS } from '../public/patterns.js';

test('fit modes fill, letterbox or stretch a picture onto the panel', () => {
  // 400x100 picture on a 100x50 panel.
  assert.deepEqual(fitRect(400, 100, 100, 50, 'cover'),
    { sx: 100, sy: 0, sw: 200, sh: 100, dx: 0, dy: 0, dw: 100, dh: 50 });
  assert.deepEqual(fitRect(400, 100, 100, 50, 'contain'),
    { sx: 0, sy: 0, sw: 400, sh: 100, dx: 0, dy: 12.5, dw: 100, dh: 25 });
  assert.deepEqual(fitRect(400, 100, 100, 50, 'stretch'),
    { sx: 0, sy: 0, sw: 400, sh: 100, dx: 0, dy: 0, dw: 100, dh: 50 });
  // Portrait picture, upscaled.
  assert.deepEqual(fitRect(10, 40, 64, 64, 'cover'),
    { sx: 0, sy: 15, sw: 10, sh: 10, dx: 0, dy: 0, dw: 64, dh: 64 });
  assert.deepEqual(fitRect(10, 40, 64, 64, 'contain'),
    { sx: 0, sy: 0, sw: 10, sh: 40, dx: 24, dy: 0, dw: 16, dh: 64 });
  assert.throws(() => fitRect(0, 10, 10, 10), /positive/);
  assert.throws(() => fitRect(10, 10, 10, 10, 'zoom'), /media fit/);
});

test('media kinds follow the file type', () => {
  assert.equal(mediaKind('image/gif'), 'image');
  assert.equal(mediaKind('video/mp4'), 'video');
  assert.equal(mediaKind('application/pdf'), null);
  assert.equal(mediaKind(undefined), null);
});

function fakeCanvas(width, height, calls) {
  const context = {
    fillRect: () => calls.push(['fill']),
    drawImage: (...args) => calls.push(['draw', ...args]),
    // Opaque mid-grey with distinct channels.
    getImageData: () => ({ data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => [10, 20, 30, 255][i % 4]) }),
  };
  return () => ({ getContext: () => context });
}

test('media pattern is registered, black when empty, and rasterizes only new frames', () => {
  assert.ok(PATTERNS.includes(MEDIA_PATTERN));
  assert.deepEqual(MEDIA_PATTERN.controls, ['media']);
  const source = new MediaSource();
  assert.equal(source.ready, false);
  assert.equal(source.describe(), 'No media loaded');
  const calls = [];
  const pattern = new MediaPattern(4, 2, source, fakeCanvas(4, 2, calls));
  assert.ok(pattern.renderFrame({ audioTime: 0 }).every(value => value === 0));
  assert.equal(calls.length, 0);

  const picture = {};
  Object.assign(source, { kind: 'image', image: picture, width: 8, height: 8, name: 'test.png' });
  source.version++;
  const rgb = pattern.renderFrame({ audioTime: 1, mediaFit: 'contain' });
  assert.deepEqual([...rgb.slice(0, 6)], [10, 20, 30, 10, 20, 30]);
  assert.deepEqual(calls.at(-1), ['draw', picture, 0, 0, 8, 8, 1, 0, 2, 2]);
  const count = calls.length;
  pattern.renderFrame({ audioTime: 2, mediaFit: 'contain' });
  assert.equal(calls.length, count, 'unchanged still is not redrawn');
  pattern.renderFrame({ audioTime: 3, mediaFit: 'stretch' });
  assert.deepEqual(calls.at(-1), ['draw', picture, 0, 0, 8, 8, 0, 0, 4, 2]);
  assert.equal(source.describe(), 'test.png · 8×8 · image');

  source.reset();
  assert.ok(pattern.renderFrame({ audioTime: 4 }).every(value => value === 0));
  assert.throws(() => new MediaPattern(0, 2), /dimensions/);
});

test('animations advance by each frame\'s own duration and loop', async () => {
  const closed = [];
  const decoder = {
    decode: async ({ frameIndex }) => ({ image: {
      index: frameIndex, displayWidth: 16, displayHeight: 8,
      duration: [100000, 0, 500000][frameIndex], close: () => closed.push(frameIndex),
    } }),
  };
  const source = new MediaSource();
  await source.startAnimation(decoder, 3);
  assert.equal(source.kind, 'animation');
  assert.equal(source.current().image.index, 0);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  source.update(10);          // Starts the clock for frame 0 (0.1 s).
  source.update(10.05);
  await settle();
  assert.equal(source.current().image.index, 0);
  source.update(10.1);
  await settle();
  assert.equal(source.current().image.index, 1);
  assert.deepEqual(closed, [0]);
  // A zero duration falls back to 0.1 s.
  source.update(20);
  source.update(20.09);
  await settle();
  assert.equal(source.current().image.index, 1);
  source.update(20.1);
  await settle();
  assert.equal(source.current().image.index, 2);
  source.update(30);
  source.update(30.5);
  await settle();
  assert.equal(source.current().image.index, 0, 'loops to the first frame');
  assert.match(source.describe(), /animation, 3 frames/);

  const single = new MediaSource();
  await single.startAnimation(decoder, 1);
  assert.equal(single.kind, 'image');
});

test('loading rejects files that are neither images nor video', async () => {
  await assert.rejects(new MediaSource().load({ type: 'text/plain', name: 'notes.txt' }), /image, animated GIF or video/);
});

// A directory handle as the browser's folder picker returns it.
function fakeDirectory(name, children) {
  return {
    kind: 'directory', name,
    async *values() {
      for (const [childName, child] of Object.entries(children)) {
        if (typeof child === 'string')
          yield { kind: 'file', name: childName, getFile: async () => ({ name: childName, type: child }) };
        else
          yield fakeDirectory(childName, child);
      }
    },
  };
}

test('a folder lists its image and video files, subfolders included, in path order', async () => {
  const files = await directoryFiles(fakeDirectory('loops', {
    'clip10.mp4': 'video/mp4',
    'clip2.mp4': 'video/mp4',
    '.DS_Store': '',
    'notes.txt': 'text/plain',
    stills: { 'b.png': 'image/png', deep: { 'a.gif': 'image/gif' } },
  }));
  assert.equal(files.length, 6);
  const entries = mediaEntries(files);
  assert.deepEqual(entries.map(entry => entry.path),
    ['clip2.mp4', 'clip10.mp4', 'stills/b.png', 'stills/deep/a.gif']);
  assert.equal(entries[0].file.type, 'video/mp4');
  assert.deepEqual(mediaEntries([]), []);
});

test('a source adopts another\'s media, releasing its own and forcing a redraw', () => {
  const closed = [];
  const source = new MediaSource();
  Object.assign(source, { kind: 'image', image: { close: () => closed.push('old') }, width: 8, height: 8, name: 'old.png' });
  const calls = [];
  const pattern = new MediaPattern(4, 2, source, fakeCanvas(4, 2, calls));
  pattern.renderFrame({ audioTime: 0 });
  const drawn = calls.length;

  const picture = { close: () => closed.push('new') };
  const next = new MediaSource();
  Object.assign(next, { kind: 'image', image: picture, width: 16, height: 4, name: 'new.png' });
  const generation = source.generation;
  source.adopt(next);
  assert.deepEqual(closed, ['old']);
  assert.equal(source.describe(), 'new.png · 16×4 · image');
  assert.equal(source.current().image, picture);
  assert.ok(source.generation > generation);
  assert.equal(next.ready, false);
  pattern.renderFrame({ audioTime: 1 });
  assert.ok(calls.length > drawn, 'the adopted picture is drawn');
  assert.equal(calls.at(-1)[1], picture);
});
