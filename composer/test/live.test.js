import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { LiveService, liveOptions, liveRequest } from '../lib/live.js';
import { PreviewRecorder } from '../public/recording.js';

const KEY = 'abcd-1234-efgh-5678';
const source = { width: 256, height: 192, mimeType: 'video/webm;codecs=vp9,opus', outWidth: 1280, outHeight: 720 };

function fakeEncoder() {
  const made = [];
  const spawnEncoder = (command, args) => {
    const child = new EventEmitter();
    child.written = [];
    child.stdin = new Writable({ write(chunk, encoding, done) { child.written.push(chunk); done(); } });
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    child.command = command;
    child.args = args;
    made.push(child);
    return child;
  };
  return { made, spawnEncoder };
}

test('live options check the source and the size asked for', () => {
  assert.deepEqual(liveOptions(source), source);
  for (const bad of [{ ...source, outWidth: 1281 }, { ...source, outHeight: 5000 }, { ...source, width: 0 },
    { ...source, mimeType: 'video/mp4' }, { ...source, width: 4096, height: 4096 }, null])
    assert.throws(() => liveOptions(bad));
});

test('without a usable key from the environment it cannot go live and says how to set it', async () => {
  for (const key of [undefined, '', 'a/b', 'abcd?x=1', 'abc']) {
    const service = new LiveService({ key, spawnEncoder: fakeEncoder().spawnEncoder });
    assert.equal(service.available, false);
    await assert.rejects(service.start(source), /YOUTUBE_STREAM_KEY/);
  }
});

test('chunks go in order into FFmpeg, which sends to the fixed address, and Stop ends the stream', async () => {
  const { made, spawnEncoder } = fakeEncoder();
  const service = new LiveService({ key: KEY, ingest: 'rtmp://example.test/live', spawnEncoder });
  const session = service.get((await service.start(source)).id);
  const [child] = made;
  assert.equal(child.command, 'ffmpeg');
  assert.equal(child.args.at(-1), `rtmp://example.test/live/${KEY}`);
  assert.ok(child.args.includes('fps=30,scale=1280:720:flags=neighbor,format=yuv420p'));
  await service.append(session, 0, Buffer.from('one'));
  await assert.rejects(service.append(session, 5, Buffer.from('x')), /out of order/);
  await service.append(session, 1, Buffer.from('two'));
  assert.equal(Buffer.concat(child.written).toString(), 'onetwo');
  await assert.rejects(service.start(source), /Another live stream/);
  await service.finish(session);
  child.emit('close', 0);
  assert.equal(service.status(session).state, 'saved');
  clearTimeout(session.timer);
});

test('a refused connection ends the stream with FFmpeg\'s words and never shows the key', async () => {
  const { made, spawnEncoder } = fakeEncoder();
  const service = new LiveService({ key: KEY, spawnEncoder });
  const session = service.get((await service.start(source)).id);
  made[0].stderr.write(`rtmp://a.rtmp.youtube.com/live2/${KEY}: Input/output error\n`);
  await new Promise((resolve) => setImmediate(resolve));
  made[0].emit('close', 1);
  const status = service.status(session);
  assert.equal(status.state, 'error');
  assert.match(status.error, /Input\/output error/);
  assert.ok(!JSON.stringify(status).includes(KEY));
  assert.ok(!session.stderr.includes(KEY));
});

test('cancelling kills FFmpeg, and a stalled encoder is cut off', async () => {
  const { made, spawnEncoder } = fakeEncoder();
  const service = new LiveService({ key: KEY, spawnEncoder });
  const session = service.get((await service.start(source)).id);
  await service.cancel(session);
  assert.equal(made[0].killed, true);
  assert.equal(service.status(session).state, 'error');
  const second = service.get((await service.start(source)).id);
  Object.defineProperty(made[1].stdin, 'writableLength', { value: 20 * 1024 * 1024 });
  await assert.rejects(service.append(second, 0, Buffer.from('x')), /cannot keep up/);
  assert.equal(service.status(second).state, 'error');
});

function fakeRequest(method, path, { origin, address = '127.0.0.1', body = '' } = {}) {
  const request = new PassThrough();
  request.method = method;
  request.url = path;
  request.headers = { host: 'localhost:8080', ...(origin ? { origin } : {}) };
  request.socket = { remoteAddress: address };
  request.end(body);
  return request;
}

async function call(service, request) {
  let status, text = '';
  const response = { writeHead(code) { status = code; }, end(chunk) { text += chunk ?? ''; } };
  await liveRequest(service, request, response, new URL(request.url, 'http://localhost:8080'));
  return { status, body: JSON.parse(text) };
}

test('the endpoints answer only a same-origin page on this computer', async () => {
  const service = new LiveService({ key: KEY, spawnEncoder: fakeEncoder().spawnEncoder });
  assert.deepEqual((await call(service, fakeRequest('GET', '/api/live'))).body, { available: true });
  assert.equal((await call(service, fakeRequest('POST', '/api/live', { body: JSON.stringify(source) }))).status, 403);
  assert.equal((await call(service, fakeRequest('POST', '/api/live',
    { origin: 'http://evil.test', body: JSON.stringify(source) }))).status, 403);
  assert.equal((await call(service, fakeRequest('GET', '/api/live', { address: '203.0.113.9' }))).status, 403);
  const started = await call(service, fakeRequest('POST', '/api/live',
    { origin: 'http://localhost:8080', body: JSON.stringify(source) }));
  assert.equal(started.status, 201);
  assert.ok(!JSON.stringify(started.body).includes(KEY));
  assert.equal((await call(service, fakeRequest('POST', '/api/live',
    { origin: 'http://localhost:8080', body: JSON.stringify({ ...source, outWidth: 3 }) }))).status, 400);
  await service.close();
});

test('the page\'s recorder can be pointed at the live endpoint and given its own limit', () => {
  const recorder = new PreviewRecorder(() => {}, '/api/live', 12 * 3600 * 1000);
  assert.equal(recorder.api, '/api/live');
  assert.equal(recorder.maxMs, 12 * 3600 * 1000);
  assert.equal(new PreviewRecorder().api, '/api/recordings');
});
