#!/usr/bin/env node
// Asks the desktop app for a microphone (getUserMedia) and reports what it got and
// which audio inputs it can see before and after (#7). It passes only if a live audio
// track comes back: the API being present, which check-app.mjs reports, is not
// enough, since under the hardened runtime macOS refuses audio input to an app
// without the com.apple.security.device.audio-input entitlement. The first run of a
// correctly signed app may show macOS's microphone prompt; the request gives up after
// 20 seconds. Opens no window of its own.
//
// MATRIXPRISM_OPEN=1, with MATRIXPRISM_ELECTRON naming a packaged app, starts it through
// macOS's \`open\` (hidden, not brought forward, a new instance) instead of as a child of
// this script: macOS then holds the app itself responsible for the microphone, as when
// it is opened from the Finder. As a child, the app is credited with the permission of
// whatever started the script (a terminal or the editor), which can hide a fault.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watchFocus } from './focus-watch.mjs';
import { stopElectron } from './stop-electron.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
import { electron, launchArgs } from './launch.mjs';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const focus = watchFocus();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'app-mic-'));
const debugPort = 9800 + Math.floor(Math.random() * 90);
const viaOpen = process.env.MATRIXPRISM_OPEN === '1';
const bundle = viaOpen ? electron.replace(/\/Contents\/MacOS\/[^/]+$/, '') : null;
const app = viaOpen
  ? spawn('open', ['-n', '-g', '-j', '--env', `MATRIXPRISM_DEBUG_PORT=${debugPort}`, '--env', 'MATRIXPRISM_BACKGROUND=1',
    '-a', bundle, '--args', `--user-data-dir=${profile}`], { stdio: 'ignore' })
  : spawn(electron, launchArgs(profile), { cwd: ROOT, stdio: 'ignore', detached: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, MATRIXPRISM_BACKGROUND: '1', MATRIXPRISM_DEBUG_PORT: String(debugPort) } });
// An app started by \`open\` is not our child: stop every process given this run's profile.
const stopOpened = () => {
  const pids = spawnSync('pgrep', ['-f', profile], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  for (const pid of pids) try { process.kill(Number(pid), 'SIGKILL'); } catch {}
  return pids.length;
};

let result = {}, exitCode = 1;
try {
  let targets;
  for (let i = 0; i < 100 && !targets; ++i) {
    await sleep(200);
    const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json()).catch(() => []);
    if (list.some((t) => t.type === 'page' && t.url.startsWith('matrixprism://'))) targets = list;
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page' && t.url.startsWith('matrixprism://')).webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  await sleep(1500);
  const ask = `(async () => {
    const inputs = async () => (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput').map((d) => d.label || '(no label)');
    const before = await inputs();
    let got;
    try {
      const stream = await Promise.race([navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('no answer in 20 s')), 20000))]);
      const track = stream.getAudioTracks()[0];
      got = { ok: true, label: track?.label, state: track?.readyState, muted: track?.muted };
      stream.getTracks().forEach((t) => t.stop());
    } catch (error) { got = { ok: false, name: error.name, message: error.message }; }
    return { before, got, after: await inputs() };
  })()`;
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: ask, awaitPromise: true, returnByValue: true } }));
  result.microphone = await new Promise((resolve) => ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data); if (m.id === 1) resolve(m.result.result?.value ?? m.result);
  }));
  ws.close();
  exitCode = result.microphone.got?.ok && result.microphone.got.state === 'live' ? 0 : 1;
} catch (error) {
  result.error = error.stack;
} finally {
  result.launch = viaOpen ? 'open' : 'child';
  if (viaOpen) {
    result.stopped = stopOpened();
    await sleep(500);
    result.left = spawnSync('pgrep', ['-f', profile], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).length;
  }
  result.focus = focus.stop();
  console.log(JSON.stringify(result, null, 1));
  console.log(exitCode ? 'FAILED' : 'ok');
  if (!viaOpen) stopElectron(app, profile);
  setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true }); process.exit(exitCode); }, 700);
}
