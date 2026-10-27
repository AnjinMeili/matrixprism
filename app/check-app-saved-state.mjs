#!/usr/bin/env node
// The saved-state audit (#10) in the desktop app, across a real restart: every
// control is given another value (composer/tools/saved-state-scripts.mjs), the
// window is closed (the DevTools Browser.close) and the app stopped (on macOS
// an app keeps running when its window closes, so this is not Cmd-Q, which no
// tool here can press), then opened again on the same profile, and each
// control is read back. A second round
// changes everything again and kills the app two seconds later, as a crash or
// a forced quit would, to see what recent changes survive. Installing a new
// build over an old one keeps the same profile folder, so the first round
// stands for that too. Runs hidden, with a stand-in keychain; never sets a
// receiver or an address. Does not cover the Media Player's folder.
// Usage: node check-app-saved-state.mjs [--keep <folder>] [--strict]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANGE_ALL, SNAPSHOT, compare } from '../composer/tools/saved-state-scripts.mjs';
import { watchFocus } from './focus-watch.mjs';
import { electron, launchArgs } from './launch.mjs';
import { stopElectron } from './stop-electron.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const keepIndex = process.argv.indexOf('--keep');
const keep = keepIndex > 0 ? path.resolve(process.argv[keepIndex + 1]) : null;
const strict = process.argv.includes('--strict');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const focus = watchFocus();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'app-saved-'));

async function launch() {
  const debugPort = 9800 + Math.floor(Math.random() * 90);
  const child = spawn(electron, launchArgs(profile), { cwd: ROOT, stdio: 'ignore', detached: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, YOUTUBE_STREAM_KEY: undefined, MATRIXPRISM_BACKGROUND: '1',
      MATRIXPRISM_MOCK_KEYCHAIN: '1', MATRIXPRISM_DEBUG_PORT: String(debugPort) } });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let target;
  for (let i = 0; i < 100 && !target; ++i) {
    await sleep(200);
    const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json()).catch(() => []);
    target = list.find((t) => t.type === 'page' && t.url.startsWith('matrixprism://'));
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  await sleep(3000);
  let id = 0;
  const call = (socket, method, params = {}) => new Promise((resolve) => {
    const mine = ++id;
    const listener = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id !== mine) return;
      socket.removeEventListener('message', listener);
      resolve(m.result);
    };
    socket.addEventListener('message', listener);
    socket.send(JSON.stringify({ id: mine, method, params }));
  });
  const run = async (expression) => (await call(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
  // Close the window, give the page a moment, then stop the app.
  const quit = async () => {
    const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((r) => r.json());
    const browser = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve) => browser.addEventListener('open', resolve));
    call(browser, 'Browser.close');
    const done = await Promise.race([exited.then(() => true), sleep(3000).then(() => false)]);
    if (!done) { stopElectron(child, profile); await exited; }
    return done;
  };
  const kill = () => { ws.close(); stopElectron(child); return exited; };
  // The window's bounds, through DevTools; null where Electron does not offer it.
  const windowId = async () => (await call(ws, 'Browser.getWindowForTarget'))?.windowId ?? null;
  const getBounds = async () => { const id = await windowId(); return id === null ? null : (await call(ws, 'Browser.getWindowBounds', { windowId: id }))?.bounds ?? null; };
  const setBounds = async (bounds) => { const id = await windowId(); if (id !== null) await call(ws, 'Browser.setWindowBounds', { windowId: id, bounds }); };
  return { run, quit, kill, getBounds, setBounds };
}

const result = {};
let exitCode = 1;
try {
  let app = await launch();
  const defaults = await app.run(SNAPSHOT);
  result.changed = await app.run(CHANGE_ALL);
  const WANT = { left: 120, top: 140, width: 1100, height: 760 };
  await app.setBounds(WANT);
  await sleep(1500);
  const boundsSet = await app.getBounds();
  const set = await app.run(SNAPSHOT);
  result.quitCleanly = await app.quit();
  // The window's place is saved by the app itself (window-state.mjs) when it closes.
  try { result.windowFile = JSON.parse(fs.readFileSync(path.join(profile, 'window-state.json'), 'utf8')); } catch { result.windowFile = null; }
  await sleep(1000);
  app = await launch();
  const back = await app.run(SNAPSHOT);
  const boundsBack = await app.getBounds();
  const same = (a, b) => a && b && ['left', 'top', 'width', 'height'].every((k) => a[k] === b[k]);
  result.window = !boundsSet ? `not checkable through DevTools; the app ${result.windowFile ? `saved ${result.windowFile.width}×${result.windowFile.height} at ${result.windowFile.x},${result.windowFile.y} when its window closed` : 'saved no window-state.json'}`
    : !same(boundsSet, WANT) ? `not checkable: the window could not be moved (${JSON.stringify(boundsSet)})`
    : same(boundsBack, WANT) ? `kept (${WANT.width}×${WANT.height} at ${WANT.left},${WANT.top})` : `lost (came back as ${JSON.stringify(boundsBack)})`;
  const proper = compare(defaults, set, back);
  result.proper = { kept: proper.told.length - proper.lost.length, lost: proper.lost.map((r) => r.key) };

  result.changedAgain = await app.run(CHANGE_ALL);
  await sleep(2000);
  const setAgain = await app.run(SNAPSHOT);
  await app.kill();
  await sleep(1000);
  app = await launch();
  const backAgain = await app.run(SNAPSHOT);
  const forced = compare(back, setAgain, backAgain);
  result.forced = { kept: forced.told.length - forced.lost.length, lost: forced.lost.map((r) => r.key) };
  await app.quit();

  const report = `The window's size and place after the restart: ${result.window}.\n\nAfter its window closed the app ${result.quitCleanly ? 'quit' : 'kept running (as macOS apps do) and was stopped'}.\n\n` +
    `## Window closed and the app stopped, then reopened\n\nControls changed: ${result.changed}; ${proper.told.length} differ from their default; kept: ${result.proper.kept}; lost: ${proper.lost.length}.\n\n${proper.table}\n\n` +
    `## Killed two seconds after a change, then reopened\n\nControls changed: ${result.changedAgain}; ${forced.told.length} differ from before; kept: ${result.forced.kept}; lost: ${forced.lost.length}.\n\n${forced.table}\n`;
  console.log(report);
  if (keep) {
    fs.mkdirSync(keep, { recursive: true });
    fs.writeFileSync(path.join(keep, 'report.md'), report);
    fs.writeFileSync(path.join(keep, 'controls.json'), JSON.stringify({ defaults, set, back, setAgain, backAgain }, null, 1));
  }
  exitCode = strict && (proper.lost.length || /^lost|saved no/.test(result.window)) ? 1 : 0;
} catch (error) {
  result.error = error.stack;
  console.error(error.stack);
} finally {
  result.focus = focus.stop();
  console.log(JSON.stringify({ window: result.window, quitCleanly: result.quitCleanly, proper: result.proper, forced: result.forced, focus: result.focus }, null, 1));
  console.log(exitCode ? 'FAILED' : strict ? 'ok' : 'Audit done (not strict)');
  setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true }); process.exit(exitCode); }, 700);
}
