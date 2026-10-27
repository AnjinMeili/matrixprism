#!/usr/bin/env node
// Checks recording through the desktop app, with real FFmpeg (T65): the page in
// the app records a few seconds of a canvas and an oscillator, uploads the WebM
// chunks to /api/recordings (answered through the fetch adapter, with no server),
// FFmpeg makes the MP4, and ffprobe reads it back: H.264 and AAC at the size
// asked for, and the length about right. Also the live route without a key
// (`available: false`) and a refused start. Needs ffmpeg and ffprobe on the PATH
// or in the usual places. Opens the window briefly.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { stopElectron } from './stop-electron.mjs';
import { watchFocus } from './focus-watch.mjs';
import { pathWithFfmpegDirs } from '../composer/lib/ffmpeg-path.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
import { electron, launchArgs } from './launch.mjs';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const focus = watchFocus();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'app-rec-'));
const outDir = path.join(profile, 'recordings');
const debugPort = 9800 + Math.floor(Math.random() * 90);
const app = spawn(electron, launchArgs(path.join(profile, 'data')), { cwd: ROOT, stdio: 'ignore', detached: true,
  // A bare system PATH, as a double-clicked app gets: FFmpeg must be found by the app's own search.
  env: { ...process.env, PATH: process.platform === 'win32' ? process.env.PATH : '/usr/bin:/bin:/usr/sbin:/sbin',
    ELECTRON_RUN_AS_NODE: undefined, YOUTUBE_STREAM_KEY: undefined,
    MATRIXPRISM_RECORD_DIR: outDir, MATRIXPRISM_DEBUG_PORT: String(debugPort),
    ...(process.env.MATRIXPRISM_FOREGROUND ? {} : { MATRIXPRISM_BACKGROUND: '1' }) } });

const flow = `(async () => {
  const out = {};
  const api = async (method, url, body) => {
    const r = await fetch(url, { method, body });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  out.live = await api('GET', '/api/live');
  out.refused = await api('POST', '/api/recordings', JSON.stringify({ width: 0, height: 0, mimeType: 'x' }));
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const audio = new AudioContext(); const osc = audio.createOscillator(); const dest = audio.createMediaStreamDestination();
  osc.connect(dest); osc.start();
  const stream = canvas.captureStream(30);
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mimeType = 'video/webm;codecs=vp9,opus';
  const start = await api('POST', '/api/recordings', JSON.stringify({ width: 64, height: 32, mimeType, encoder: 'software' }));
  out.start = start.status; out.startBody = start.body; const id = start.body?.id;
  if (!id) return out;
  const rec = new MediaRecorder(stream, { mimeType });
  let sequence = 0, chain = Promise.resolve();
  rec.ondataavailable = (e) => {
    if (!e.data.size) return;
    chain = chain.then(async () => {
      const r = await fetch('/api/recordings/' + id + '/chunk?sequence=' + sequence++, { method: 'POST', body: e.data });
      out.chunks = (out.chunks ?? 0) + (r.status === 200 ? 1 : 0);
    });
  };
  const stopped = new Promise((r) => { rec.onstop = r; });
  let n = 0; const timer = setInterval(() => { ctx.fillStyle = 'hsl(' + (n++ * 9 % 360) + ',80%,50%)'; ctx.fillRect(0, 0, 64, 32); }, 33);
  rec.start(500);
  await new Promise((r) => setTimeout(r, 4000));
  clearInterval(timer); rec.stop(); await stopped; await chain;
  out.finish = (await api('POST', '/api/recordings/' + id + '/finish')).status;
  for (let i = 0; i < 100; ++i) {
    const s = await api('GET', '/api/recordings/' + id);
    out.final = s.body;
    if (s.body?.state && !['recording', 'finalizing'].includes(s.body.state)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
})()`;

let result = {}, exitCode = 1;
try {
  await sleep(800);
  let targets;
  for (let i = 0; i < 100 && !targets; ++i) {
    await sleep(200);
    const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json()).catch(() => []);
    if (list.some((t) => t.type === 'page' && t.url.startsWith('matrixprism://'))) targets = list;
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page' && t.url.startsWith('matrixprism://')).webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  await sleep(2500);
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: flow, awaitPromise: true, returnByValue: true } }));
  result.page = await new Promise((resolve) => ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data); if (m.id === 1) resolve(m.result.result?.value ?? m.result);
  }));
  ws.close();
  const file = result.page.final?.file;
  const files = file && fs.existsSync(file) && file.startsWith(outDir) ? [file] : [];
  result.files = files.map((f) => path.relative(outDir, f));
  if (files.length) {
    const env = { ...process.env, PATH: pathWithFfmpegDirs(process.env.PATH ?? '') };
    const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height:format=duration',
      '-of', 'json', files[0]], { env });
    result.probe = JSON.parse(stdout);
  }
  const expectMissing = process.env.MATRIXPRISM_EXPECT_NO_FFMPEG === '1';
  const video = result.probe?.streams.find((s) => s.codec_type === 'video');
  const sound = result.probe?.streams.find((s) => s.codec_type === 'audio');
  const seconds = Number(result.probe?.format.duration);
  if (expectMissing) {
    // A machine with no FFmpeg anywhere the app looks: Record must refuse at once, saying how to install it.
    exitCode = result.page.start === 409 && /FFmpeg was not found/.test(result.page.startBody?.error ?? '') &&
      files.length === 0 ? 0 : 1;
  } else exitCode = result.page.live.status === 200 && result.page.live.body.available === false &&
    result.page.refused.status === 400 && result.page.start === 201 && result.page.chunks >= 4 &&
    result.page.finish === 202 && result.page.final?.state === 'saved' && files.length === 1 &&
    video?.codec_name === 'h264' && video.width === 64 && video.height === 32 && sound?.codec_name === 'aac' &&
    seconds > 3 && seconds < 6 ? 0 : 1;
} catch (error) {
  result.error = error.stack;
} finally {
  result.focus = focus.stop();
  console.log(JSON.stringify(result, null, 1));
  console.log(exitCode ? 'FAILED' : 'ok');
  stopElectron(app, profile);
  setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true }); process.exit(exitCode); }, 700);
}
