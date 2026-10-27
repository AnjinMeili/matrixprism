// Checks Go live in the real page: headless Chrome with a fake microphone
// presses Go live (custom size), the server sends to a local RTMP receiver
// under a made-up key, and Stop live ends it. The receiver's file must hold
// a picture of the size asked for and audio, the controls must lock while
// live and free afterwards, Record must be unavailable while live, and the
// key must be in neither the page nor the server's output. Does not judge the
// picture, the sync (see check-live.mjs) or YouTube. About 30 seconds.
// Usage: node tools/check-live-page.mjs [--keep <folder>]
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from '../lib/vendor/ws/wrapper.mjs';
import { CHROME } from './headless.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keepIndex = process.argv.indexOf('--keep');
const keep = keepIndex > 0 ? path.resolve(process.argv[keepIndex + 1]) : null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'check-live-page-'));
const KEY = 'check-live-page-key-5520', RTMP = 19352, SIZE = [640, 360];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failed = false, chrome, server, receiver, socket;
const check = (ok, message) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`); if (!ok) failed = true; };

try {
  if (!CHROME) throw new Error('Chrome is required');
  const wav = path.join(work, 'fake-input.wav');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i',
    "aevalsrc='0.4*sin(2*PI*80*t)*exp(-14*mod(t,0.5))':s=48000:d=30", '-c:a', 'pcm_s16le', wav]);
  const received = path.join(work, 'received.flv');
  receiver = spawn('ffmpeg', ['-hide_banner', '-y', '-f', 'flv', '-listen', '1', '-i', `rtmp://127.0.0.1:${RTMP}/live/${KEY}`,
    '-c', 'copy', received], { stdio: ['ignore', 'ignore', fs.openSync(path.join(work, 'receiver.log'), 'w')] });
  const receiverClosed = new Promise((resolve) => receiver.once('close', resolve));
  const serverLog = path.join(work, 'server.log');
  server = spawn(process.execPath, ['server.js', '--port', '0', '--record-dir', path.join(work, 'recordings'),
    '--live-ingest', `rtmp://127.0.0.1:${RTMP}/live`], { cwd: root, env: { ...process.env, YOUTUBE_STREAM_KEY: KEY },
    stdio: ['ignore', 'pipe', fs.openSync(serverLog, 'w')] });
  const origin = await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (data) => {
      output += data;
      fs.appendFileSync(serverLog, data);
      const match = output.match(/http:\/\/[^\s/]+:\d+/);
      if (match) resolve(match[0]);
    });
    server.once('exit', (code) => reject(new Error(`Server exited ${code}`)));
  });
  const profile = path.join(work, 'profile');
  chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1440,900',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`, '--disable-features=AudioServiceSandbox',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let debugPort;
  for (let attempt = 0; attempt < 100 && !debugPort; ++attempt) {
    await delay(100);
    try { debugPort = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {}
  }
  if (!debugPort) throw new Error('Chrome debug port was not available');
  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let nextId = 0;
  const pending = new Map();
  socket.on('message', (data) => {
    const reply = JSON.parse(data);
    if (pending.has(reply.id)) { pending.get(reply.id)(reply); pending.delete(reply.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const run = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description || expression);
    return reply.result?.result?.value;
  };
  const liveState = () => run("document.querySelector('.live-group').dataset.state || 'idle'");
  async function waitLive(expected) {
    for (let attempt = 0; attempt < 120; ++attempt) {
      const value = await liveState();
      if (value === expected) return;
      if (value === 'error') throw new Error(await run("document.getElementById('live-status').textContent"));
      await delay(250);
    }
    throw new Error(`Timed out waiting for ${expected}`);
  }

  await send('Page.navigate', { url: origin });
  await delay(800);
  await run(`localStorage.setItem('matrix-companion-settings', JSON.stringify({
    host:'', width:255, height:191, audioSource:'simulated', patternId:'plasma', view:'quad',
    brightness:1, fps:30, autoCycle:false, maxFps:1 }))`);
  await send('Page.reload');
  await delay(1000);
  check(await run("!document.getElementById('go-live').disabled"), 'Go live is available when the server has a key');
  const offered = await run(`(() => { const w = Number(document.getElementById('width').value), h = Number(document.getElementById('height').value);
    const sizes = [...document.getElementById('live-size').options].map((o) => o.value).filter((v) => v !== 'custom');
    return { panel: [w, h], sizes, shaped: sizes.length > 0 && sizes.every((v) => { const [a, b] = v.split('x').map(Number); return a * h === b * w; }) }; })()`);
  check(offered.shaped, `every Size offered has the panel's shape (#6): ${offered.panel.join('x')} offers ${offered.sizes.join(', ')}`);
  await run("document.getElementById('go-live').click()");
  await delay(150);
  check(await liveState() === 'error', 'simulated audio cannot go live silently');
  await run(`(async () => {
    const permission = await navigator.mediaDevices.getUserMedia({audio:true});
    permission.getTracks().forEach(track => track.stop());
    const source = document.getElementById('audio-source');
    source.value = [...source.options].find(option => option.value.startsWith('device:')).value;
    source.dispatchEvent(new Event('change'));
    const size = document.getElementById('live-size');
    size.value = 'custom';
    size.dispatchEvent(new Event('change'));
    document.getElementById('live-width').value = ${SIZE[0]};
    document.getElementById('live-height').value = ${SIZE[1]};
  })()`);
  await delay(1000);
  await run("document.getElementById('go-live').click()");
  await waitLive('recording');
  await delay(6000);
  const locked = await run(`({
    record: document.getElementById('record').disabled,
    width: document.getElementById('width').disabled,
    audio: document.getElementById('audio-source').disabled,
    button: document.getElementById('go-live').textContent,
    status: document.getElementById('live-status').textContent })`);
  check(locked.record && locked.width && locked.audio && locked.button === 'Stop live',
    `while live: Record, the matrix size and the audio input are locked (${JSON.stringify(locked)})`);
  check(!(await run("document.documentElement.outerHTML + JSON.stringify(localStorage)")).includes(KEY), 'the key is not in the page or its saved settings');
  await run("document.getElementById('go-live').click()");
  await waitLive('saved');
  await Promise.race([receiverClosed, delay(10000)]);
  check(await run("!document.getElementById('record').disabled && !document.getElementById('width').disabled"), 'after Stop live the controls are free again');
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,sample_aspect_ratio:format=duration',
    '-of', 'json', received]).toString());
  const video = probe.streams.find((s) => s.codec_type === 'video'), audio = probe.streams.find((s) => s.codec_type === 'audio');
  check(video?.width === SIZE[0] && video?.height === SIZE[1], `the receiver got ${video?.width}x${video?.height}, asked ${SIZE.join('x')}`);
  check(!!audio, 'the receiver got audio with the picture');
  check(video?.sample_aspect_ratio === '1:1', `the picture's pixels are square (#6): ${video?.sample_aspect_ratio}`);
  const seconds = Number(probe.format?.duration ?? 0);
  check(seconds >= 4, `the receiver got ${seconds.toFixed(1)} s of picture`);
  server.kill();
  await delay(500);
  check(!fs.readFileSync(serverLog, 'utf8').includes(KEY), 'the key is not in the server\'s output');
} catch (error) {
  console.log(`FAIL  ${error.message}`);
  failed = true;
} finally {
  socket?.close();
  chrome?.kill();
  server?.kill();
  receiver?.kill();
  await delay(300);
  if (keep) fs.cpSync(work, keep, { recursive: true, filter: (name) => !/fake-input\.wav$|profile/.test(name) });
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(failed ? 'FAILED' : 'All checks passed');
process.exit(failed ? 1 : 0);
