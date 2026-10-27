#!/usr/bin/env node
// Checks per-receiver settings end to end (receivers.js): a fake receiver on
// UDP 4048, the composer's server, and the page in headless Chrome driven
// over the DevTools protocol. Two known receivers, `127.0.0.1` (brightness
// 0.5, at most 10 frames a second) and `localhost` (brightness 1, no limit),
// both reach the fake. It streams the Panel Range card at 30 fps to each in
// turn and measures the frames that arrive each second and their brightest
// byte; then sets a limit of 20 on `localhost` while streaming; then checks
// switching back shows the first receiver's settings. Chrome only; nothing
// here touches a real receiver, though the page's own search for receivers
// asks the local network as it always does.
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME } from './headless.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// DDP: a 10-byte header, the push flag (0x01) in byte 0 on a frame's last packet.
let frames = 0, peak = 0;
const udp = dgram.createSocket('udp4').on('message', (m) => {
  for (let i = 10; i < m.length; ++i) if (m[i] > peak) peak = m[i];
  if (m[0] & 0x01) ++frames;
}).bind(4048, '127.0.0.1');

const port = 18000 + Math.floor(Math.random() * 1000);
const server = spawn(process.execPath, ['server.js', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'receivers-'));
const debugPort = 9800 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, 'about:blank'], { stdio: 'ignore' });
const result = {};
let exitCode = 1;
try {
  await sleep(800);
  let targets;
  for (let i = 0; i < 50 && !targets; ++i) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json()).catch(() => null);
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((resolve) => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.result?.value;
  const ui = () => run(`({ host: document.getElementById('host').value,
    brightness: document.getElementById('brightness').value, maxFps: document.getElementById('max-fps').value,
    note: document.getElementById('receiver-note').textContent, status: document.getElementById('status').textContent,
    known: [...document.querySelectorAll('#receiver-list optgroup[label="Known"] option')].map((o) => o.value) })`);
  const measure = async (seconds) => {
    await sleep(1000);
    frames = 0; peak = 0;
    await sleep(seconds * 1000);
    return { framesPerSecond: frames / seconds, peak };
  };
  const stream = () => run(`document.getElementById('stream').click()`);
  const choose = (host) => run(`{ const s = document.getElementById('receiver-list'); s.value = '${host}';
    s.dispatchEvent(new Event('change')); }`);

  await send('Page.navigate', { url: `http://localhost:${port}/` });
  await sleep(1500);
  await run(`localStorage.setItem('matrix-companion-settings', JSON.stringify({ host: '127.0.0.1', width: 32,
    height: 16, fps: 30, audioSource: 'simulated', patternId: 'panel-range', view: 'setup', brightness: 0.8,
    receivers: { '127.0.0.1': { brightness: 0.5, gamma: 1, maxFps: 10 }, localhost: { brightness: 1, gamma: 1, maxFps: null } } }))`);
  await send('Page.reload');
  await sleep(3000);
  result.loaded = await ui();
  await stream();
  result.first = { ...(await measure(5)), ui: await ui() };
  await stream();
  await choose('localhost');
  await sleep(300);
  result.switched = await ui();
  await stream();
  result.second = await measure(5);
  await run(`{ const m = document.getElementById('max-fps'); m.value = '20'; m.dispatchEvent(new Event('change')); }`);
  result.limitedWhileStreaming = await measure(5);
  await stream();
  await choose('127.0.0.1');
  await sleep(300);
  result.back = await ui();
  result.saved = await run(`JSON.parse(localStorage.getItem('matrix-companion-settings')).receivers`);
  ws.close();
  const near = (value, target, tolerance) => Math.abs(value - target) <= tolerance;
  const ok = result.loaded.brightness === '0.5' && result.loaded.maxFps === '10' &&
    result.loaded.known.includes('127.0.0.1') && result.loaded.known.includes('localhost') &&
    near(result.first.framesPerSecond, 10, 0.6) && near(result.first.peak, 128, 1) &&
    result.switched.brightness === '1' && result.switched.maxFps === '' &&
    result.second.framesPerSecond >= 25 && result.second.peak === 255 &&
    near(result.limitedWhileStreaming.framesPerSecond, 20, 1) &&
    result.back.brightness === '0.5' && result.back.maxFps === '10' &&
    result.saved.localhost.maxFps === 20 && result.saved['127.0.0.1'].maxFps === 10;
  exitCode = ok ? 0 : 1;
} catch (error) {
  result.error = error.stack;
} finally {
  console.log(JSON.stringify(result, null, 1));
  console.log(exitCode ? 'FAILED' : 'ok');
  chrome.kill();
  server.kill();
  udp.close();
  setTimeout(() => {
    fs.rmSync(profile, { recursive: true, force: true });
    process.exit(exitCode);
  }, 500);
}
