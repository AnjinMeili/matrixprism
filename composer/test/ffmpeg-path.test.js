import assert from 'node:assert/strict';
import test from 'node:test';
import { ffmpegStartMessage, pathWithFfmpegDirs, usualFfmpegDirs } from '../lib/ffmpeg-path.js';

test('the usual FFmpeg folders are added after the PATH, once, in the system\'s own form', () => {
  assert.equal(pathWithFfmpegDirs('/usr/bin:/bin', 'darwin'), '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/opt/local/bin');
  assert.equal(pathWithFfmpegDirs('/opt/homebrew/bin:/usr/bin', 'darwin'), '/opt/homebrew/bin:/usr/bin:/usr/local/bin:/opt/local/bin');
  assert.equal(pathWithFfmpegDirs('/a', 'linux').startsWith('/a:/usr/local/bin'), true);
  const env = { ProgramFiles: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\x', ChocolateyInstall: 'C:\\ProgramData\\chocolatey' };
  const windows = pathWithFfmpegDirs('C:\\Windows', 'win32', env);
  assert.ok(windows.startsWith('C:\\Windows;C:\\ProgramData\\chocolatey\\bin;'), windows);
  assert.ok(windows.includes('C:\\Program Files\\ffmpeg\\bin') && windows.includes('scoop\\shims'));
  assert.deepEqual(usualFfmpegDirs('win32', {}), ['C:\\ffmpeg\\bin']);
  assert.equal(pathWithFfmpegDirs('', 'darwin').startsWith('/opt/homebrew/bin'), true);
});

test('a missing FFmpeg is explained with how to install it, anything else is reported as it came', async () => {
  const { ffmpegStartMessage } = await import('../lib/ffmpeg-path.js');
  const missing = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
  assert.match(ffmpegStartMessage(missing, 'darwin'), /FFmpeg was not found.*brew install ffmpeg/);
  assert.match(ffmpegStartMessage(missing, 'win32'), /winget install Gyan\.FFmpeg/);
  assert.match(ffmpegStartMessage(missing, 'linux'), /sudo apt install ffmpeg/);
  assert.equal(ffmpegStartMessage(new Error('EACCES'), 'darwin'), 'Cannot start FFmpeg: EACCES');
});

test('a recording refuses to start when FFmpeg is missing, and a live stream ends with the explanation', async () => {
  const { RecordingService } = await import('../lib/recording.js');
  const { LiveService } = await import('../lib/live.js');
  const { EventEmitter } = await import('node:events');
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const missing = () => Object.assign(new Error(ffmpegStartMessage(Object.assign(new Error('x'), { code: 'ENOENT' }))), { status: 409 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-ffmpeg-'));
  const recordings = new RecordingService({ directory: dir, spawnEncoder: () => { throw new Error('never started'); },
    checkEncoder: async () => { throw missing(); } });
  await assert.rejects(() => recordings.start({ width: 64, height: 32, mimeType: 'video/webm;codecs=vp9,opus' }),
    (error) => error.status === 409 && /FFmpeg was not found/.test(error.message));
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing was created for a recording that could not start');
  const noFfmpeg = () => {
    const child = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { write() {}, end() {} });
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => child.emit('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' })));
    return child;
  };
  const live = new LiveService({ key: 'abcd-efgh-ijkl', spawnEncoder: noFfmpeg });
  const started = await live.start({ width: 64, height: 32, mimeType: 'video/webm;codecs=vp9,opus', outWidth: 640, outHeight: 320 });
  for (let i = 0; i < 100 && !live.status(live.get(started.id)).error; ++i) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(live.status(live.get(started.id)).error ?? '', /FFmpeg was not found/);
});
