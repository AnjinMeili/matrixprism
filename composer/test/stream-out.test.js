import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PARTIAL_NAME, defaultBitrate, ffmpegArgs, findSession, followRecording, parseSize, redact, streamTarget }
  from '../lib/stream-out.js';

test('size must be even, whole and within 4096', () => {
  assert.deepEqual(parseSize('1280x720'), { width: 1280, height: 720 });
  for (const bad of ['1280', '1281x720', '0x0', '5000x720', 'axb', undefined])
    assert.throws(() => parseSize(bad));
});

test('the YouTube key comes from the environment and is redacted from output', () => {
  assert.throws(() => streamTarget('youtube', {}), /YOUTUBE_STREAM_KEY/);
  const target = streamTarget('youtube', { YOUTUBE_STREAM_KEY: 'abcd-1234' });
  assert.equal(target.url, 'rtmp://a.rtmp.youtube.com/live2/abcd-1234');
  assert.equal(redact(`Opening ${target.url}`, target.secret), 'Opening rtmp://a.rtmp.youtube.com/live2/<key>');
  assert.equal(streamTarget('rtmp://host/app/secretkey').secret, 'secretkey');
  assert.deepEqual(streamTarget('out.mp4', {}, '/rec'), { kind: 'file', path: '/rec/out.mp4' });
  assert.deepEqual(streamTarget('/elsewhere/out.mkv', {}, '/rec'), { kind: 'file', path: '/elsewhere/out.mkv' });
  assert.throws(() => streamTarget('http://example.com/x'));
  assert.throws(() => streamTarget(undefined));
});

test('FFmpeg is told to enlarge with square pixels, keep two-second keyframes and never use a shell', () => {
  const live = ffmpegArgs({ width: 1280, height: 720, target: { kind: 'rtmp', url: 'rtmp://h/a/k' } });
  assert.ok(live.includes('fps=30,scale=1280:720:flags=neighbor,setsar=1,format=yuv420p'));
  assert.equal(live[live.indexOf('-g') + 1], '60');
  // A live stream is true CBR (#1): the floor equals the rate, and HRD says so.
  assert.equal(live[live.indexOf('-b:v') + 1], '3000k');
  assert.equal(live[live.indexOf('-minrate') + 1], '3000k');
  assert.equal(live[live.indexOf('-nal-hrd') + 1], 'cbr');
  assert.equal(live.at(-1), 'rtmp://h/a/k');
  assert.ok(live.includes('zerolatency'));
  const smooth = ffmpegArgs({ width: 640, height: 480, smooth: true, target: { kind: 'file', path: 'o.mp4' } });
  assert.ok(smooth.some((a) => a.includes('flags=bicubic')));
  assert.equal(smooth.at(-1), 'o.mp4');
  assert.ok(!smooth.includes('zerolatency'));
  assert.ok(smooth.includes('-crf') && !smooth.includes('-b:v'));
  const fixed = ffmpegArgs({ width: 640, height: 480, kbps: 2000, target: { kind: 'file', path: 'o.mp4' } });
  assert.equal(fixed[fixed.indexOf('-b:v') + 1], '2000k');
  assert.ok(!fixed.includes('-crf'));
  // A file is never given the CBR floor, which an MP4 cannot carry.
  assert.ok(!fixed.includes('-minrate') && !fixed.includes('-nal-hrd'));
});

test('a live stream\'s bitrate follows YouTube\'s guidance for its size class (#1)', () => {
  for (const [w, h, kbps] of [[640, 360, 750], [512, 384, 750], [854, 480, 750], [768, 576, 3000], [1024, 768, 3000],
    [1280, 720, 3000], [1280, 960, 5000], [1920, 1080, 5000], [2560, 1440, 7000], [4096, 4096, 11000]])
    assert.equal(defaultBitrate(w, h), kbps, `${w}x${h}`);
});

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-out-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a session begun after the tool started is found, an older one is not', async (t) => {
  const root = tempDir(t);
  fs.mkdirSync(path.join(root, 'preview-old'));
  fs.writeFileSync(path.join(root, 'preview-old', PARTIAL_NAME), 'x');
  const since = Date.now() + 50;
  assert.equal(await findSession(root, since), null);
  await new Promise((resolve) => setTimeout(resolve, 80));
  fs.mkdirSync(path.join(root, 'preview-new'));
  fs.writeFileSync(path.join(root, 'preview-new', PARTIAL_NAME), 'x');
  assert.equal(await findSession(root, since), path.join(root, 'preview-new'));
});

test('following reads every byte as it is written and ends when the file is renamed', async (t) => {
  const dir = tempDir(t);
  const partial = path.join(dir, PARTIAL_NAME);
  fs.writeFileSync(partial, 'one,');
  const writer = (async () => {
    for (const part of ['two,', 'three,']) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      fs.appendFileSync(partial, part);
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    fs.appendFileSync(partial, 'four');
    fs.renameSync(partial, path.join(dir, 'capture.webm'));
  })();
  let text = '';
  for await (const chunk of followRecording(dir, { pollMs: 10 })) text += chunk;
  await writer;
  assert.equal(text, 'one,two,three,four');
});

test('following gives up when nothing arrives', async (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, PARTIAL_NAME), 'a');
  let text = '';
  for await (const chunk of followRecording(dir, { pollMs: 10, idleMs: 100 })) text += chunk;
  assert.equal(text, 'a');
});
