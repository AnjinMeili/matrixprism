// Checks tools/stream-out.mjs end to end with FFmpeg: a known signal (a white
// flash and a 1 kHz beep together, once a second) is written into a fake
// recording folder as the composer's server would write it, in small steps,
// and the tool sends it on, enlarged, to an MP4 and to a local RTMP
// receiver. The output must be the size asked for, and each flash must meet
// its beep within one frame, with no drift over the run. It does not use
// the composer, a real input or YouTube.
// Usage: node tools/check-stream-out.mjs [--keep <folder>]  (keeps the outputs and logs there)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSource, verify as verifyFile } from './flash-beep.mjs';

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stream-out.mjs');
const keepIndex = process.argv.indexOf('--keep');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'check-stream-out-'));
const keep = keepIndex > 0 ? path.resolve(process.argv[keepIndex + 1]) : null;
const SECONDS = 8, SIZE = '256x192';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failed = false;
const report = (ok, message) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`); if (!ok) failed = true; };

// The same kind of file the composer's recorder uploads: WebM, VP8 and Opus.
const source = path.join(work, 'source.webm');
makeSource(source, SECONDS);
const verify = (name, file) => verifyFile(name, file, SIZE, report);

// Writes the source into a fake recording folder at about real time, then
// renames it, as the server does at Stop.
async function feed(record) {
  const dir = path.join(record, 'preview-check');
  fs.mkdirSync(dir);
  const partial = path.join(dir, 'capture.webm.partial');
  fs.writeFileSync(partial, '');
  const data = fs.readFileSync(source);
  const step = Math.ceil(data.length / (SECONDS * 10));
  for (let at = 0; at < data.length; at += step) {
    fs.appendFileSync(partial, data.subarray(at, at + step));
    await sleep(100);
  }
  fs.renameSync(partial, path.join(dir, 'capture.webm'));
}

async function run(name, to, afterFeed) {
  const record = path.join(work, `${name}-record`);
  fs.mkdirSync(record);
  const log = fs.openSync(path.join(work, `${name}-tool.log`), 'w');
  const child = spawn('node', [tool, '--size', SIZE, '--to', to, '--dir', record, '--wait', '30'], { stdio: ['ignore', log, log] });
  const closed = new Promise((resolve) => child.once('close', resolve));
  await sleep(1500);
  await feed(record);
  const code = await closed;
  report(code === 0, `${name}: the tool finished cleanly (exit ${code})`);
  await afterFeed?.();
}

try {
  const mp4 = path.join(work, 'out.mp4');
  await run('file', mp4);
  verify('file', mp4);

  const received = path.join(work, 'received.flv');
  const port = 19350;
  const receiver = spawn('ffmpeg', ['-hide_banner', '-y', '-f', 'flv', '-listen', '1',
    '-i', `rtmp://127.0.0.1:${port}/live/test`, '-c', 'copy', received],
  { stdio: ['ignore', 'ignore', fs.openSync(path.join(work, 'receiver.log'), 'w')] });
  const receiverClosed = new Promise((resolve) => receiver.once('close', resolve));
  await sleep(1000);
  await run('rtmp', `rtmp://127.0.0.1:${port}/live/test`);
  await Promise.race([receiverClosed, sleep(10000)]);
  receiver.kill();
  verify('rtmp', received);
} finally {
  if (keep) fs.cpSync(work, keep, { recursive: true, filter: (name) => !name.endsWith('source.webm') });
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(failed ? 'FAILED' : 'All checks passed');
process.exit(failed ? 1 : 0);
