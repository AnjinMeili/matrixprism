#!/usr/bin/env node
// Checks the desktop app's stream key (#8) end to end, in the app itself: the key
// field is shown, a bad key is refused, a good one makes Go live available and is
// stored encrypted in the profile, it comes back after a restart, it can be cleared,
// the page cannot read it back, and it appears in neither the page's text nor the
// app's output; YOUTUBE_STREAM_KEY, when set, wins and hides the field. The app runs
// hidden, with Chromium's stand-in keychain (MATRIXPRISM_MOCK_KEYCHAIN), so the real
// Keychain is neither used nor made to ask; the check confirms it is unchanged.
// Nothing is streamed: the key is made up.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { watchFocus } from './focus-watch.mjs';
import { stopElectron } from './stop-electron.mjs';
import { electron, launchArgs } from './launch.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const KEY = 'chk1-test-key0-not5-real';
const OTHER = 'chk2-from-envi-ronm-ent0';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const focus = watchFocus();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'app-key-'));
const output = [];
const keychainItem = () => spawnSync('security', ['find-generic-password', '-s', 'MatrixPrism Safe Storage'],
  { encoding: 'utf8' }).status === 0;
const keychainBefore = process.platform === 'darwin' ? keychainItem() : null;

async function launch(env = {}) {
  const debugPort = 9800 + Math.floor(Math.random() * 90);
  const child = spawn(electron, launchArgs(profile), { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, YOUTUBE_STREAM_KEY: undefined, MATRIXPRISM_BACKGROUND: '1',
      MATRIXPRISM_MOCK_KEYCHAIN: '1', MATRIXPRISM_DEBUG_PORT: String(debugPort), ...env } });
  child.stdout.on('data', (data) => output.push(String(data)));
  child.stderr.on('data', (data) => output.push(String(data)));
  let target;
  for (let i = 0; i < 100 && !target; ++i) {
    await sleep(200);
    const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json()).catch(() => []);
    target = list.find((t) => t.type === 'page' && t.url.startsWith('matrixprism://'));
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  await sleep(1500);
  let id = 0;
  const run = (expression) => new Promise((resolve) => {
    const mine = ++id;
    const listener = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id !== mine) return;
      ws.removeEventListener('message', listener);
      resolve(m.result.result?.value ?? m.result);
    };
    ws.addEventListener('message', listener);
    ws.send(JSON.stringify({ id: mine, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  return { child, run, close: () => { ws.close(); stopElectron(child); } };
}

const live = `fetch('/api/live').then((r) => r.json())`;
const view = `({ fieldHidden: document.getElementById('live-key').hidden,
  clearHidden: document.getElementById('live-key-clear').hidden,
  status: document.getElementById('live-status').textContent,
  input: document.getElementById('live-key-input').value,
  bridge: Object.keys(window.matrixprismKey ?? {}).sort(),
  pageHasKey: document.documentElement.outerHTML.includes(${JSON.stringify(KEY)}) })`;
const steps = [];
const step = (name, ok, detail) => steps.push({ name, ok: Boolean(ok), detail });

let exitCode = 1;
try {
  let app = await launch();
  const before = await app.run(`(async () => ({ live: await ${live}, view: ${view} }))()`);
  step('no key: Go live unavailable, the hint names the field', before.live.available === false && /beside Go live/.test(before.live.hint), before.live);
  step('the key field is shown in the app', before.view.fieldHidden === false && before.view.clearHidden === true, before.view);
  step('the page can set, clear and ask, nothing more', JSON.stringify(before.view.bridge) === '["clear","onChange","set","status"]', before.view.bridge);
  const bad = await app.run(`window.matrixprismKey.set('not a key!')`);
  step('a bad key is refused', bad.ok === false && /not a stream key/.test(bad.message), bad);
  const saved = await app.run(`(async () => { const r = await window.matrixprismKey.set(${JSON.stringify(KEY)});
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { r, live: await ${live}, status: await window.matrixprismKey.status(), view: ${view} }; })()`);
  step('a good key is saved and Go live becomes available', saved.r.ok && saved.r.message === 'Stream key saved' && saved.live.available === true, saved);
  step('the page is told only that a key is set', JSON.stringify(saved.status) === '{"source":"stored"}' && saved.view.clearHidden === false, saved.status);
  step('the key is in neither the page nor its field', saved.view.pageHasKey === false && saved.view.input === '', saved.view);
  const file = path.join(profile, 'stream-key.enc');
  step('it is stored encrypted in the profile', fs.existsSync(file) && !fs.readFileSync(file).includes(KEY), fs.existsSync(file) ? fs.statSync(file).size : 'missing');
  app.close();
  await sleep(1000);

  app = await launch();
  const again = await app.run(`(async () => ({ live: await ${live}, status: await window.matrixprismKey.status() }))()`);
  step('after a restart the key is back', again.live.available === true && again.status.source === 'stored', again);
  const cleared = await app.run(`(async () => { const r = await window.matrixprismKey.clear();
    await new Promise((resolve) => setTimeout(resolve, 500)); return { r, live: await ${live}, view: ${view} }; })()`);
  step('clearing forgets it', cleared.r.ok && cleared.live.available === false && !fs.existsSync(file) && cleared.view.clearHidden === true, cleared);
  app.close();
  await sleep(1000);

  app = await launch({ YOUTUBE_STREAM_KEY: OTHER });
  const env = await app.run(`(async () => ({ live: await ${live}, status: await window.matrixprismKey.status(), view: ${view},
    set: await window.matrixprismKey.set(${JSON.stringify(KEY)}) }))()`);
  step('YOUTUBE_STREAM_KEY wins and hides the field', env.live.available === true && env.status.source === 'environment' &&
    env.view.fieldHidden === true && env.set.ok === false && !fs.existsSync(file), env);
  app.close();
  await sleep(700);

  const said = output.join('');
  step('neither key appears in the app\'s output', !said.includes(KEY) && !said.includes(OTHER), `${said.length} characters`);
  if (keychainBefore !== null) step('the real Keychain is unchanged', keychainItem() === keychainBefore, { before: keychainBefore });
  exitCode = steps.every((s) => s.ok) ? 0 : 1;
} catch (error) {
  step('ran to the end', false, error.stack);
} finally {
  const result = { steps, focus: focus.stop() };
  console.log(JSON.stringify(result, null, 1));
  for (const s of steps) console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}`);
  console.log(exitCode ? 'FAILED' : 'ok');
  try { spawnSync('pkill', ['-9', '-f', profile]); } catch {}
  setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true }); process.exit(exitCode); }, 700);
}
