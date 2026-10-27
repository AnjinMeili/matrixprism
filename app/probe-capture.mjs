#!/usr/bin/env node
// Probes what the Electron app's Chromium can record and encode (T65): which
// MediaRecorder types it accepts, what each really produces (the codecs read
// from the file's bytes, not from the type asked for), and which WebCodecs
// encoder configurations it accepts. Run on each operating system; the result
// is for that one. Prints JSON.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopElectron } from './stop-electron.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
import { electron, launchArgs } from './launch.mjs';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
const debugPort = 9900 + Math.floor(Math.random() * 90);
const app = spawn(electron, launchArgs(profile), { cwd: ROOT, stdio: 'ignore', detached: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, MATRIXPRISM_DEBUG_PORT: String(debugPort) } });

const probe = `(async () => {
  const out = { platform: navigator.platform, userAgent: navigator.userAgent };
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=av01,opus',
    'video/webm;codecs=h264,opus', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.640028,opus',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=hvc1,mp4a.40.2', 'video/mp4'];
  out.recorderSupport = Object.fromEntries(types.map((t) => [t, MediaRecorder.isTypeSupported(t)]));
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const audio = new AudioContext(); const osc = audio.createOscillator(); const dest = audio.createMediaStreamDestination();
  osc.connect(dest); osc.start();
  const boxes = (bytes) => {
    const text = new TextDecoder('latin1').decode(bytes);
    return ['ftyp', 'avc1', 'hvc1', 'mp4a', 'Opus', 'opus', 'vp09', 'V_VP9', 'V_VP8', 'A_OPUS', 'V_MPEG4/ISO/AVC', 'EBML']
      .filter((tag) => text.includes(tag));
  };
  out.recorded = {};
  for (const type of types.filter((t) => out.recorderSupport[t])) {
    try {
      const stream = canvas.captureStream(30);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t.clone()));
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2000000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((r) => { rec.onstop = r; });
      let frames = 0;
      const t0 = performance.now();
      rec.start(500);
      const timer = setInterval(() => { ctx.fillStyle = 'hsl(' + (frames * 7 % 360) + ',80%,50%)'; ctx.fillRect(0, 0, 128, 64); ++frames; }, 33);
      await new Promise((r) => setTimeout(r, 2500));
      clearInterval(timer); rec.stop(); await stopped;
      const blob = new Blob(chunks);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      out.recorded[type] = { asked: type, got: rec.mimeType, bytes: bytes.length, seconds: (performance.now() - t0) / 1000, tagsInFile: boxes(bytes) };
      stream.getTracks().forEach((t) => t.stop());
    } catch (error) { out.recorded[type] = { error: String(error.message || error) }; }
  }
  out.webcodecs = {};
  if (typeof VideoEncoder === 'function') {
    for (const codec of ['avc1.640028', 'avc1.42E01E', 'vp09.00.10.08', 'vp8', 'av01.0.04M.08', 'hev1.1.6.L93.B0']) {
      for (const hw of ['no-preference', 'prefer-hardware', 'prefer-software', 'require-hardware']) {
        try {
          const r = await VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720, framerate: 30, bitrate: 4000000, hardwareAcceleration: hw,
            ...(codec.startsWith('avc1') ? { avc: { format: 'annexb' } } : {}) });
          out.webcodecs[codec + ' / ' + hw] = r.supported;
        } catch (error) { out.webcodecs[codec + ' / ' + hw] = 'error: ' + String(error.message || error); }
      }
    }
  } else out.webcodecs = 'no VideoEncoder';
  out.audioEncoder = typeof AudioEncoder === 'function'
    ? Object.fromEntries(await Promise.all(['mp4a.40.2', 'opus'].map(async (c) =>
        [c, (await AudioEncoder.isConfigSupported({ codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported])))
    : 'no AudioEncoder';
  return out;
})()`;

let result;
try {
  await sleep(800);
  let targets;
  for (let i = 0; i < 50 && !targets; ++i) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json()).catch(() => null);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page' && t.url.startsWith('matrixprism://')).webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  await sleep(2500);
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: probe, awaitPromise: true, returnByValue: true } }));
  result = await new Promise((resolve) => ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.id === 1) resolve(m.result.result?.value ?? m.result); }));
  ws.close();
} catch (error) {
  result = { error: error.stack };
} finally {
  console.log(JSON.stringify(result, null, 1));
  stopElectron(app, profile);
  setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true }); process.exit(0); }, 500);
}
