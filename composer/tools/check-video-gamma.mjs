// Checks Video gamma (T67) in the real page: headless Chrome with a fake
// microphone records the Panel Range test card through Record twice, at
// Video gamma 1 and 2.2, and reads the grey bars of the MP4s the server
// writes. At 1 each bar must come out at the level sent to the panel; at 2.2
// at 255 * (level / 255) ^ (1 / 2.2), within a few levels for the video's
// YUV and compression. Does not cover Go live's RTMP path beyond what it
// shares with Record (the captured canvas), the panel's frames (which the
// lift only reads), Safari, or how the video looks.
// About 40 seconds. Usage: node tools/check-video-gamma.mjs [--keep <folder>]
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from '../lib/vendor/ws/wrapper.mjs';
import { CHROME } from './headless.mjs';
import { cardLevels } from '../public/test-card.js';
import { videoGammaTable } from '../public/video-gamma.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keepIndex = process.argv.indexOf('--keep');
const keep = keepIndex > 0 ? path.resolve(process.argv[keepIndex + 1]) : null;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'check-video-gamma-'));
const recordDir = path.join(work, 'recordings');
const [W, H] = [256, 192];
// Most a grey bar's mean may stray from the level expected, in 8-bit levels.
const TOLERANCE = 5;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failed = false, chrome, server, socket;
const check = (ok, message) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`); if (!ok) failed = true; };

// The grey rows' pixels away from any bar's edge, by the level sent.
function greyBars() {
  const bars = new Map();
  const level = (x, y) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return null;
    const [r, g, b] = cardLevels((x + 0.5) / W, 1 - (y + 0.5) / H, 0, W);
    return r === g && g === b ? r : null;
  };
  for (let y = 0; y < H; ++y) {
    if (1 - (y + 0.5) / H < 0.45) continue;
    for (let x = 0; x < W; ++x) {
      const value = level(x, y);
      if (value === null) continue;
      let inside = true;
      for (let dy = -2; dy <= 2 && inside; ++dy)
        for (let dx = -2; dx <= 2 && inside; ++dx) inside = level(x + dx, y + dy) === value;
      if (!inside) continue;
      if (!bars.has(value)) bars.set(value, []);
      bars.get(value).push(y * W + x);
    }
  }
  return bars;
}

// The mean of each grey bar in one frame of an MP4, two seconds in.
function readBars(file, bars) {
  const rgb = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', '2', '-i', file, '-frames:v', '1',
    '-vf', `crop=${W}:${H}:0:0`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const means = new Map();
  for (const [value, pixels] of bars) {
    let sum = 0;
    for (const p of pixels) sum += rgb[p * 3] + rgb[p * 3 + 1] + rgb[p * 3 + 2];
    means.set(value, sum / (pixels.length * 3));
  }
  return means;
}

try {
  if (!CHROME) throw new Error('Chrome is required');
  const wav = path.join(work, 'fake-input.wav');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i',
    "aevalsrc='0.4*sin(2*PI*80*t)*exp(-14*mod(t,0.5))':s=48000:d=60", '-c:a', 'pcm_s16le', wav]);
  const serverLog = path.join(work, 'server.log');
  server = spawn(process.execPath, ['server.js', '--port', '0', '--record-dir', recordDir], { cwd: root,
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
  const recordState = () => run("document.querySelector('.recording-bar').dataset.state || 'idle'");
  async function waitRecording(expected) {
    for (let attempt = 0; attempt < 160; ++attempt) {
      const value = await recordState();
      if (value === expected) return;
      if (value === 'error') throw new Error(await run("document.getElementById('recording-status').textContent"));
      await delay(250);
    }
    throw new Error(`Timed out waiting for ${expected}`);
  }

  await send('Page.navigate', { url: origin });
  await delay(800);
  await run(`localStorage.setItem('matrix-companion-settings', JSON.stringify({
    host:'', width:${W}, height:${H}, audioSource:'simulated', patternId:'panel-range', view:'patterns',
    brightness:1, gamma:1, fps:30, autoCycle:false, videoGamma:2.2 }))`);
  await send('Page.reload');
  await delay(1000);
  check(await run("document.getElementById('video-gamma').value") === '2.2' &&
    await run("document.getElementById('video-gamma-value').textContent") === '2.20', 'Video gamma shows the saved 2.2');
  await run(`(async () => {
    const permission = await navigator.mediaDevices.getUserMedia({audio:true});
    permission.getTracks().forEach(track => track.stop());
    const source = document.getElementById('audio-source');
    source.value = [...source.options].find(option => option.value.startsWith('device:')).value;
    source.dispatchEvent(new Event('change'));
  })()`);
  await delay(1000);

  const bars = greyBars();
  check(bars.size >= 24, `${bars.size} grey bars found on the card`);
  const recordings = {};
  for (const gamma of [2.2, 1]) {
    await run(`(() => { const input = document.getElementById('video-gamma'); input.value = ${gamma};
      input.dispatchEvent(new Event('input')); })()`);
    const before = new Set(fs.existsSync(recordDir) ? fs.readdirSync(recordDir) : []);
    await run("document.getElementById('record').click()");
    await waitRecording('recording');
    await delay(4000);
    await run("document.getElementById('record').click()");
    await waitRecording('saved');
    const folder = fs.readdirSync(recordDir).find((name) => !before.has(name) && name.startsWith('preview-'));
    const file = folder && path.join(recordDir, folder, 'preview.mp4');
    if (!file || !fs.existsSync(file)) throw new Error(`No recording at Video gamma ${gamma}`);
    recordings[gamma] = readBars(file, bars);
  }
  check(JSON.parse(await run("localStorage.getItem('matrix-companion-settings')")).videoGamma === 1,
    'the last Video gamma used is saved');

  const table = videoGammaTable(2.2);
  const rows = [...bars.keys()].sort((a, b) => a - b).map((level) => ({
    level, atOne: recordings[1].get(level), expectTwo: table[level], atTwo: recordings[2.2].get(level),
  }));
  console.log('level  at 1.0  expected at 2.2  at 2.2');
  for (const row of rows)
    console.log(`${String(row.level).padStart(5)}  ${row.atOne.toFixed(1).padStart(6)}  ${String(row.expectTwo).padStart(15)}  ${row.atTwo.toFixed(1).padStart(6)}`);
  const worstOne = Math.max(...rows.map((row) => Math.abs(row.atOne - row.level)));
  const worstTwo = Math.max(...rows.map((row) => Math.abs(row.atTwo - row.expectTwo)));
  check(worstOne <= TOLERANCE, `at Video gamma 1 every bar is within ${TOLERANCE} of the level sent (worst ${worstOne.toFixed(1)})`);
  check(worstTwo <= TOLERANCE, `at Video gamma 2.2 every bar is within ${TOLERANCE} of the lifted level (worst ${worstTwo.toFixed(1)})`);
  const dark = rows.find((row) => row.level === 16);
  check(dark && dark.atTwo > dark.atOne * 3, `a dark bar (16) is lifted (${dark?.atOne.toFixed(1)} to ${dark?.atTwo.toFixed(1)})`);
} catch (error) {
  console.log(`FAIL  ${error.message}`);
  failed = true;
} finally {
  socket?.close();
  chrome?.kill();
  server?.kill();
  await delay(300);
  if (keep) fs.cpSync(work, keep, { recursive: true, filter: (name) => !/fake-input\.wav$|profile/.test(name) });
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(failed ? 'FAILED' : 'All checks passed');
process.exit(failed ? 1 : 0);
