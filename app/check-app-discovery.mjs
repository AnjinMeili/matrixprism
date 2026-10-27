#!/usr/bin/env node
// Asks the desktop app to search the network for receivers (/api/receivers, an mDNS
// query for _wled._tcp, answered by lib/mdns.js) and reports what it found (T65).
// It passes if the app answers 200 with a list, even an empty one: whether any
// receiver is on the network is not the app's doing. Run on each Mac, since macOS
// asks a program's permission (or the one that started it) to use the local network.
// Opens no visible window.
import { spawn } from 'node:child_process';
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'app-disc-'));
const debugPort = 9800 + Math.floor(Math.random() * 90);
const app = spawn(electron, launchArgs(profile), { cwd: ROOT, stdio: 'ignore', detached: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, MATRIXPRISM_BACKGROUND: '1', MATRIXPRISM_DEBUG_PORT: String(debugPort) } });

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
  const search = `(async () => { const t0 = performance.now(); const r = await fetch('/api/receivers'); const body = await r.json();
    return { status: r.status, ms: Math.round(performance.now() - t0), body }; })()`;
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: search, awaitPromise: true, returnByValue: true } }));
  result.search = await new Promise((resolve) => ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data); if (m.id === 1) resolve(m.result.result?.value ?? m.result);
  }));
  ws.close();
  result.count = result.search.body?.receivers?.length ?? null;
  exitCode = result.search.status === 200 && Array.isArray(result.search.body?.receivers) ? 0 : 1;
  // On a CI runner's macOS (MATRIXPRISM_CI=1) multicast needs Local Network access,
  // which no one is there to grant: the send fails with EHOSTUNREACH (Apple, TN3179).
  // That is reported as not checkable there, not passed; anywhere else it fails.
  if (exitCode && process.env.MATRIXPRISM_CI === '1' && process.platform === 'darwin' &&
      /EHOSTUNREACH/.test(result.search.body?.error ?? '')) {
    result.notCheckable = 'macOS Local Network permission cannot be granted on a CI runner';
    exitCode = 0;
  }
} catch (error) {
  result.error = error.stack;
} finally {
  result.focus = focus.stop();
  console.log(JSON.stringify(result, null, 1));
  console.log(exitCode ? 'FAILED' : 'ok');
  stopElectron(app, profile);
  setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true }); process.exit(exitCode); }, 700);
}
