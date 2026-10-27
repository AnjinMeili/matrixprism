import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_FRAME_BYTES, RelayApi, StreamSession, fileAnswer } from '../lib/relay-core.js';
import { answerWithNodeHandler } from '../lib/fetch-adapter.js';
import { recordingRequest } from '../lib/recording.js';

// The relay's shared core (T65): files, the small JSON answers, the frame channel
// and the adapter for the app's secure scheme, on stand-ins: no port, no network.

function publicFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-core-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>hi</p>');
  fs.writeFileSync(path.join(dir, 'a.wasm'), Buffer.from([0, 97, 115, 109]));
  fs.writeFileSync(path.join(path.dirname(dir), 'secret.txt'), 'outside');
  return dir;
}

test('files come from the public folder with their types, and nothing outside it', async () => {
  const dir = publicFolder();
  const index = await fileAnswer(dir, '/');
  assert.deepEqual([index.status, index.headers['Content-Type'], index.body.toString()], [200, 'text/html; charset=utf-8', '<p>hi</p>']);
  assert.equal((await fileAnswer(dir, '/a.wasm')).headers['Content-Type'], 'application/wasm');
  assert.equal((await fileAnswer(dir, '/missing.js')).status, 404);
  assert.equal((await fileAnswer(dir, '/../secret.txt')).status, 403);
  assert.equal((await fileAnswer(dir, '/%2e%2e/secret.txt')).status, 403);
  assert.equal((await fileAnswer(dir, '/%E0%A4%A')).status, 400);
  // A sibling folder whose name starts the same is not inside it.
  assert.equal((await fileAnswer(dir, `/../${path.basename(dir)}-x/f`)).status, 403);
});

test('the JSON answers: config, version, one shared receiver search, info, and anything else is not its own', async () => {
  let searches = 0;
  const api = new RelayApi({
    receiverHost: 'wled.local', ddpPort: 4048, started: 'then', rootDir: '/root',
    discover: () => { ++searches; return new Promise((resolve) => setTimeout(() => resolve([{ host: 'a' }]), 20)); },
    fetchInfo: async (host) => { if (host === 'bad') throw new Error('nope'); return { host, width: 32, height: 16 }; },
    version: async (dir) => ({ dir }),
  });
  assert.deepEqual(await api.handle('/api/config'), { status: 200, body: { host: 'wled.local', ddpPort: 4048, started: 'then' } });
  assert.deepEqual(await api.handle('/api/version'), { status: 200, body: { dir: '/root' } });
  const [a, b] = await Promise.all([api.handle('/api/receivers'), api.handle('/api/receivers')]);
  assert.deepEqual(a.body, { receivers: [{ host: 'a' }] });
  assert.equal(b.status, 200);
  assert.equal(searches, 1, 'requests during a search share it');
  await api.handle('/api/receivers');
  assert.equal(searches, 2, 'a later request searches again');
  assert.deepEqual(await api.handle('/api/info', new URLSearchParams('host=x')), { status: 200, body: { host: 'x', width: 32, height: 16 } });
  assert.deepEqual(await api.handle('/api/info', new URLSearchParams('host=bad')), { status: 502, body: { error: 'nope' } });
  assert.equal(await api.handle('/api/recordings'), null);
});

function fakeSender() {
  const frames = [];
  return {
    frames, closed: false, target: null,
    async setTarget(host, port) { if (host === 'nowhere') throw new Error('ENOTFOUND'); this.target = [host, port]; return '10.0.0.5'; },
    sendFrame(frame) { frames.push(frame); },
    takeStats() { return { frames: frames.length }; },
    close() { this.closed = true; },
  };
}

test('the frame channel sets a target, takes frames of the right size and reports statistics', async () => {
  const sent = [], sender = fakeSender(), logs = [];
  const session = new StreamSession({ send: (m) => sent.push(m), defaultDdpPort: 4048, sender, log: (l) => logs.push(l), statsMs: 5 });
  await session.message(Buffer.alloc(10), true);
  assert.equal(sender.frames.length, 0, 'no frames before a target');
  await session.message('not json', false);
  assert.deepEqual(sent.at(-1), { type: 'error', message: 'invalid JSON control message' });
  await session.message(JSON.stringify({ type: 'target', host: 'h', width: 0, height: 4 }), false);
  assert.equal(sent.at(-1).message, 'invalid matrix size or port');
  await session.message(JSON.stringify({ type: 'target', host: 'h', width: 4096, height: 4096 }), false);
  assert.equal(sent.at(-1).message, 'invalid matrix size or port', `over ${MAX_FRAME_BYTES} bytes`);
  await session.message(JSON.stringify({ type: 'target', host: 'nowhere', width: 4, height: 2 }), false);
  assert.match(sent.at(-1).message, /cannot resolve nowhere: ENOTFOUND/);
  await session.message(JSON.stringify({ type: 'target', host: 'h', width: 4, height: 2 }), false);
  assert.deepEqual(sent.at(-1), { type: 'target', ok: true, address: '10.0.0.5', port: 4048, width: 4, height: 2 });
  assert.deepEqual(sender.target, ['h', 4048]);
  assert.match(logs[0], /Streaming to h \(10\.0\.0\.5:4048\) 4x2/);
  await session.message(Buffer.alloc(24), true);
  await session.message(Buffer.alloc(23), true);
  assert.equal(sender.frames.length, 1);
  assert.equal(sent.at(-1).message, 'frame is 23 bytes, expected 24');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(sent.some((m) => m.type === 'stats' && m.target.startsWith('h (')));
  session.close();
  assert.equal(sender.closed, true);
});

test('the adapter lets Node-style handlers answer a Fetch request, streaming or not', async () => {
  const seen = {};
  const answer = await answerWithNodeHandler(async (req, res, url) => {
    seen.method = req.method; seen.host = req.headers.host; seen.origin = req.headers.origin;
    seen.address = req.socket.remoteAddress; seen.path = url.pathname;
    let body = '';
    for await (const chunk of req) body += chunk;
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ echoed: body }));
  }, new Request('matrixprism://app/api/x?y=1', { method: 'POST', body: 'hello', headers: { origin: 'matrixprism://app' }, duplex: 'half' }));
  assert.equal(answer.status, 201);
  assert.deepEqual(await answer.json(), { echoed: 'hello' });
  assert.deepEqual(seen, { method: 'POST', host: 'app', origin: 'http://app', address: '127.0.0.1', path: '/api/x' });

  const failed = await answerWithNodeHandler(() => { throw new Error('boom'); }, new Request('matrixprism://app/api/x'));
  assert.deepEqual([failed.status, (await failed.json()).error], [500, 'boom']);
  const silent = await answerWithNodeHandler(async () => {}, new Request('matrixprism://app/api/x'));
  assert.equal(silent.status, 204);
});

test('the recording handler works through the adapter: the app\'s own page may start one, another origin may not', async () => {
  const service = { start: async (input) => ({ id: 'abc', input }) };
  const post = (headers) => answerWithNodeHandler((req, res, url) => recordingRequest(service, req, res, url),
    new Request('matrixprism://app/api/recordings', { method: 'POST', body: '{"width":4}', headers, duplex: 'half' }));
  const ok = await post({ origin: 'matrixprism://app' });
  assert.equal(ok.status, 201);
  assert.deepEqual((await ok.json()).input, { width: 4 });
  // Chromium sends no Origin on a same-origin request to the scheme: that is the app's own page.
  assert.equal((await post({})).status, 201);
  const refused = await post({ origin: 'https://evil.example' });
  assert.equal(refused.status, 403);
});
