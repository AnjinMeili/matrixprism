#!/usr/bin/env node
// The NDI output in the desktop app (#62), end to end but for the network:
// the app is started hidden and driven over the DevTools protocol.
//
//   --expect none     a build without NDI: no NDI controls, /api/ndi says so
//   --expect missing  an NDI build with no runtime: the controls say to get it
//   --expect stub --headers <folder>
//                     an NDI build given a stand-in runtime (app/ndi-stub.mjs,
//                     built from NDI's headers), which logs what it is sent:
//                     NDI on at the largest size, the frames' size, rate and
//                     levels at Video gamma 1 and 2.2, the status line, and NDI
//                     and the panel's stream (to a fake receiver on UDP 4048)
//                     each running and stopping without the other; then the
//                     Frame rate at 60, which NDI follows.
//
// The stub sends nothing; whether NDI receivers see the source needs the real
// runtime and NDI Tools. For a packaged app set MATRIXPRISM_PACKAGED=1 and
// MATRIXPRISM_ELECTRON (launch.mjs). Needs UDP 4048 free on this computer.
// On a CI runner (MATRIXPRISM_CI=1) the page renders in software, far below
// 25 frames a second, so the rates are checked only as arriving or not.
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NDI_RUNTIME_LINKS } from '../composer/lib/ndi.js';
import { electron, launchArgs } from './launch.mjs';
import { watchFocus } from './focus-watch.mjs';
import { buildNdiStub } from './ndi-stub.mjs';
import { stopElectron } from './stop-electron.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const expect = option('--expect');
if (!['none', 'missing', 'stub'].includes(expect) || (expect === 'stub' && !option('--headers'))) {
  console.error('usage: node app/check-app-ndi.mjs --expect none|missing|stub [--headers <folder of Processing.NDI.*.h>]');
  process.exit(2);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const focus = watchFocus();

// The runtime the app finds: an empty folder for "missing", the stub for "stub".
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ndi-app-'));
const stubLog = path.join(work, 'calls.log');
if (expect === 'stub') buildNdiStub(option('--headers'), work);
const ndiEnv = expect === 'none' ? {} : { NDI_RUNTIME_DIR_V6: work, NDI_STUB_LOG: stubLog };
const calls = () => (fs.existsSync(stubLog) ? fs.readFileSync(stubLog, 'utf8').trim().split('\n') : []);
const videoCalls = () => calls().filter((line) => line.startsWith('video '));
const field = (line, name) => line?.match(new RegExp(`\\b${name}=(\\S+)`))?.[1];

// DDP: the push flag (0x01) in byte 0 ends a frame.
let ddpFrames = 0;
const udp = dgram.createSocket('udp4').on('message', (m) => { if (m[0] & 0x01) ++ddpFrames; }).bind(4048, '127.0.0.1');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ndi-profile-'));
const debugPort = 9800 + Math.floor(Math.random() * 90);
const child = spawn(electron, launchArgs(profile), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  // ELECTRON_RUN_AS_NODE, set by some editors, would run Electron as plain Node.
  env: { ...process.env, ...ndiEnv, ELECTRON_RUN_AS_NODE: undefined, MATRIXPRISM_DEBUG_PORT: String(debugPort),
    MATRIXPRISM_BACKGROUND: '1' } });
let log = '';
child.stdout.on('data', (data) => { log += data; });
child.stderr.on('data', (data) => { log += data; });

const result = { expect };
let exitCode = 1;
try {
  let target;
  for (let i = 0; i < 100 && !target; ++i) {
    await sleep(200);
    const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json()).catch(() => []);
    target = list.find((t) => t.type === 'page' && t.url.startsWith('matrixprism://'));
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
  const ui = () => run(`({ hidden: document.querySelector('.ndi-group').hidden,
    disabled: document.getElementById('ndi').disabled, button: document.getElementById('ndi').textContent,
    status: document.getElementById('ndi-status').textContent,
    runtimeLink: document.getElementById('ndi-runtime-link').hidden ? null : document.getElementById('ndi-runtime-link').href,
    sizes: [...document.getElementById('ndi-size').options].map((o) => o.textContent),
    stats: document.getElementById('stats').textContent })`);
  // Frames reaching the stub and the fake receiver over `seconds`.
  const measure = async (seconds) => {
    const ndiBefore = videoCalls().length;
    ddpFrames = 0;
    await sleep(seconds * 1000);
    return { ndiPerSecond: (videoCalls().length - ndiBefore) / seconds, ddpPerSecond: ddpFrames / seconds };
  };

  await sleep(2000);
  result.api = await run(`fetch('/api/ndi').then((r) => r.json())`);
  if (expect !== 'stub') {
    result.ui = await ui();
    exitCode = expect === 'none'
      ? (result.api.built === false && result.ui.hidden ? 0 : 1)
      : (result.api.built && !result.api.available && !result.ui.hidden && result.ui.disabled &&
        /not installed/.test(result.ui.status) && result.ui.runtimeLink === NDI_RUNTIME_LINKS[process.platform] ? 0 : 1);
    if (expect === 'missing' && result.api.available) result.note = 'an NDI runtime is installed here, so its absence cannot be shown';
  } else {
    // The Panel Range card at half brightness: its brightest level reaches the
    // panel as 128. Video gamma 1 sends NDI that level; 2.2 lifts it to 186.
    await run(`localStorage.setItem('matrix-companion-settings', JSON.stringify({ host: '127.0.0.1', width: 32,
      height: 16, fps: 30, audioSource: 'simulated', patternId: 'panel-range', view: 'setup', videoGamma: 1,
      receivers: { '127.0.0.1': { brightness: 0.5, gamma: 1, maxFps: null } } }))`);
    await send('Page.reload');
    await sleep(3000);
    result.loaded = await ui();
    await run(`{ const s = document.getElementById('ndi-size'); s.value = s.options[s.options.length - 1].value;
      s.dispatchEvent(new Event('change')); document.getElementById('ndi').click(); }`);
    await sleep(2500);
    result.on = { ...(await ui()), ...(await measure(3)) };
    result.on.last = videoCalls().at(-1);
    await run(`{ const g = document.getElementById('video-gamma'); g.value = '2.2'; g.dispatchEvent(new Event('input')); }`);
    await sleep(1500);
    result.gamma22 = videoCalls().at(-1);
    await run(`document.getElementById('stream').click()`);
    await sleep(2000);
    result.both = await measure(3);
    await run(`document.getElementById('ndi').click()`);
    await sleep(1000);
    result.panelOnly = { ...(await measure(3)), ui: await ui() };
    await run(`document.getElementById('ndi').click()`);
    await sleep(1500);
    await run(`document.getElementById('stream').click()`);
    await sleep(1000);
    result.ndiOnly = await measure(3);
    // NDI follows the composer's Frame rate (10 to 60, 30 by default).
    await run(`{ const f = document.getElementById('fps'); f.value = '60'; f.dispatchEvent(new Event('input')); }`);
    await sleep(2000);
    result.fps60 = { ...(await measure(3)), last: videoCalls().at(-1), stats: (await ui()).stats };
    result.saved = await run(`JSON.parse(localStorage.getItem('matrix-companion-settings')).ndiSize`);
    result.creates = calls().filter((line) => line.startsWith('create ')).length;
    const near = (value, target, tolerance) => Math.abs(value - target) <= tolerance;
    const ci = process.env.MATRIXPRISM_CI === '1';
    result.ci = ci;
    const flowing = (perSecond) => (ci ? perSecond > 0 : perSecond >= 25);
    const checks = {
      shown: !result.loaded.hidden && !result.loaded.disabled && result.loaded.runtimeLink === null,
      largest: field(result.on.last, 'xres') === '3840' && field(result.on.last, 'yres') === '1920' &&
        field(result.on.last, 'fourcc') === 'RGBX' && field(result.on.last, 'rate') === '30/1',
      status: /^NDI on: MatrixPrism, 3840×1920 on 192\.0\.2\.1:5961 · 3 receivers$/.test(result.on.status),
      rate: flowing(result.on.ndiPerSecond),
      gamma1: field(result.on.last, 'peak') === '128',
      gamma22: near(Number(field(result.gamma22, 'peak')), 186, 1),
      both: flowing(result.both.ndiPerSecond) && flowing(result.both.ddpPerSecond),
      panelOnly: result.panelOnly.ndiPerSecond === 0 && flowing(result.panelOnly.ddpPerSecond) && result.panelOnly.ui.status === 'NDI off',
      ndiOnly: flowing(result.ndiOnly.ndiPerSecond) && result.ndiOnly.ddpPerSecond === 0,
      fps60: field(result.fps60.last, 'rate') === '60/1' && (ci ? result.fps60.ndiPerSecond > 0 : result.fps60.ndiPerSecond >= 50),
      oneSource: result.creates === 1,
      saved: result.saved === '120',
    };
    result.checks = checks;
    exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
  }
  ws.close();
} catch (error) {
  result.error = error.stack;
} finally {
  result.focus = focus.stop();
  result.log = log.split('\n').filter((line) => /NDI/.test(line));
  console.log(JSON.stringify(result, null, 1));
  console.log(exitCode ? 'FAILED' : 'ok');
  stopElectron(child, profile);
  udp.close();
  // On Windows a file the app still holds open cannot be removed; it is left.
  const remove = (folder) => { try { fs.rmSync(folder, { recursive: true, force: true }); } catch {} };
  setTimeout(() => {
    remove(profile);
    remove(work);
    process.exit(exitCode);
  }, 500);
}
