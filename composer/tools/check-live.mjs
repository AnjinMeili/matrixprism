// Checks Go live end to end without the page or YouTube: the real server runs
// with a made-up stream key and a local RTMP receiver as its destination, and
// the known flash-and-beep signal (tools/flash-beep.mjs) is uploaded to
// /api/live in one-second-sized pieces at about real time, as the page's
// recorder does. What the receiver gets must be the size asked for, with each
// flash meeting its beep within one frame and no drift. Also checks that the
// endpoint refuses a request without this server's Origin or with another's,
// that nothing is written to the recording folder, and that the key appears
// in none of the server's output, the status answers or the saved logs.
// Does not cover the page, a real input or YouTube.
// Usage: node tools/check-live.mjs [--keep <folder>]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSource, verify } from './flash-beep.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const keepIndex = process.argv.indexOf('--keep');
const keep = keepIndex > 0 ? path.resolve(process.argv[keepIndex + 1]) : null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'check-live-'));
const SECONDS = 8, SIZE = '256x192', HTTP = 18091, RTMP = 19351, KEY = 'check-live-key-7391';
const base = `http://localhost:${HTTP}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failed = false;
const report = (ok, message) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`); if (!ok) failed = true; };
const logs = [];
const open = (name) => { const file = path.join(work, name); logs.push(file); return fs.openSync(file, 'w'); };

const source = path.join(work, 'source.webm');
makeSource(source, SECONDS);
const received = path.join(work, 'received.flv');
const recordDir = path.join(work, 'recordings');
let server, receiver;
try {
  receiver = spawn('ffmpeg', ['-hide_banner', '-y', '-f', 'flv', '-listen', '1',
    '-i', `rtmp://127.0.0.1:${RTMP}/live/${KEY}`, '-c', 'copy', received], { stdio: ['ignore', 'ignore', open('receiver.log')] });
  const receiverClosed = new Promise((resolve) => receiver.once('close', resolve));
  server = spawn('node', ['server.js', '--port', String(HTTP), '--record-dir', recordDir,
    '--live-ingest', `rtmp://127.0.0.1:${RTMP}/live`], { cwd: root, env: { ...process.env, YOUTUBE_STREAM_KEY: KEY },
    stdio: ['ignore', open('server.log'), open('server.log')] });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${base}/api/live`).then((r) => r.ok).catch(() => false)) break;
    await sleep(200);
  }
  const post = (url, body, headers = { Origin: base }) => fetch(`${base}${url}`, { method: 'POST', body, headers });
  const json = (response) => response.json();
  report((await fetch(`${base}/api/live`).then(json)).available === true, 'the server reports Go live as available');
  report((await post('/api/live', '{}', {})).status === 403, 'a POST without this server\'s Origin is refused');
  report((await post('/api/live', '{}', { Origin: 'http://evil.test' })).status === 403, 'a POST from another Origin is refused');

  const started = await post('/api/live', JSON.stringify({ width: 64, height: 48, mimeType: 'video/webm;codecs=vp8,opus',
    outWidth: 256, outHeight: 192 })).then(json);
  report(started.state === 'recording', 'a live stream starts');
  const data = fs.readFileSync(source);
  const step = Math.ceil(data.length / (SECONDS * 10));
  let sequence = 0, answers = JSON.stringify(started);
  for (let at = 0; at < data.length; at += step, sequence++) {
    answers += await post(`/api/live/${started.id}/chunk?sequence=${sequence}`, data.subarray(at, at + step),
      { Origin: base, 'Content-Type': 'application/octet-stream' }).then((r) => r.text());
    await sleep(100);
  }
  answers += JSON.stringify(await post(`/api/live/${started.id}/finish`, '').then(json));
  let status = {};
  for (let i = 0; i < 100 && status.state !== 'saved' && status.state !== 'error'; i++) {
    await sleep(200);
    status = await fetch(`${base}/api/live/${started.id}`).then(json);
  }
  answers += JSON.stringify(status);
  report(status.state === 'saved', `the stream ended cleanly (${status.state}${status.error ? `: ${status.error}` : ''})`);
  await Promise.race([receiverClosed, sleep(10000)]);
  verify('live', received, SIZE, report);
  report(!fs.existsSync(recordDir) || fs.readdirSync(recordDir).length === 0, 'nothing was written to the recording folder');
  server.kill();
  await sleep(500);
  // The test's own receiver prints the address it was told to listen on, key included.
  const keyed = logs.filter((file) => !file.endsWith('receiver.log') && fs.readFileSync(file).includes(KEY));
  report(!answers.includes(KEY) && keyed.length === 0, 'the key appears in no status answer and not in the server\'s output');
} finally {
  server?.kill();
  receiver?.kill();
  if (keep) fs.cpSync(work, keep, { recursive: true, filter: (name) => !name.endsWith('source.webm') });
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(failed ? 'FAILED' : 'All checks passed');
process.exit(failed ? 1 : 0);
