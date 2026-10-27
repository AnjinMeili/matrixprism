#!/usr/bin/env node
// An audit of what the composer remembers (#10): the real server and page in
// headless Chrome; every control the operator can set (inputs, selects, text
// areas, outside the stream key and file pickers) is given a value other than
// its own, as a person would (input and change events); then the page is
// reloaded and each control is read again. A control is "kept" when it comes
// back as it was set, "lost" when not. Some controls change others when set,
// so the state compared is the one after every control was set. It covers a
// reload in one browser profile, the same storage a restart of the browser or
// the app reads; it does not cover the Media Player's folder (a handle, not a
// value), Safari, or the desktop app's own restart. It never sets a receiver or
// an address: the page reconnects to a saved receiver on load, and the only
// receivers on offer would be real ones found on the network (#host,
// #receiver-list are left alone). The server's log is kept with --keep.
// Usage: node tools/check-saved-state.mjs [--keep <folder>] [--strict]
//   --strict fails when anything is lost (for when the exceptions are agreed).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from '../lib/vendor/ws/wrapper.mjs';
import { CHROME } from './headless.mjs';
import { CHANGE_ALL, SNAPSHOT, compare } from './saved-state-scripts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keepIndex = process.argv.indexOf('--keep');
const keep = keepIndex > 0 ? path.resolve(process.argv[keepIndex + 1]) : null;
const strict = process.argv.includes('--strict');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'check-saved-state-'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let chrome, server, socket, exitCode = 1;

try {
  if (!CHROME) throw new Error('Chrome is required');
  const serverLog = path.join(work, 'server.log');
  server = spawn(process.execPath, ['server.js', '--port', '0', '--record-dir', path.join(work, 'recordings')],
    { cwd: root, env: { ...process.env, YOUTUBE_STREAM_KEY: '' }, stdio: ['ignore', 'pipe', fs.openSync(serverLog, 'w')] });
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
  await send('Page.enable');
  await send('Page.navigate', { url: `${origin}/` });
  await delay(3000);
  const defaults = await run(SNAPSHOT);
  const changed = await run(CHANGE_ALL);
  await delay(1500);
  const set = await run(SNAPSHOT);
  await send('Page.reload');
  await delay(3000);
  const back = await run(SNAPSHOT);

  const { rows, told, lost, table } = compare(defaults, set, back);
  const streamed = fs.readFileSync(serverLog, 'utf8').split('\n').filter((line) => /Streaming to/.test(line));
  const report = `Streamed to a receiver during the check: ${streamed.length ? streamed.join('; ') : 'no'}.\n\nControls on the page: ${rows.length}; changed by the check: ${changed} (${told.length} differ from their default afterwards); kept after a reload: ${told.length - lost.length}; lost: ${lost.length}.\n\n${table}\n`;
  console.log(report);
  if (keep) {
    fs.mkdirSync(keep, { recursive: true });
    fs.writeFileSync(path.join(keep, 'report.md'), report);
    fs.writeFileSync(path.join(keep, 'controls.json'), JSON.stringify({ defaults, set, back, rows }, null, 1));
    fs.copyFileSync(serverLog, path.join(keep, 'server.log'));
  }
  exitCode = strict && lost.length ? 1 : 0;
  console.log(strict ? (exitCode ? 'FAILED: controls were lost' : 'All controls kept') : 'Audit done (not strict)');
} catch (error) {
  console.error(error.stack);
} finally {
  socket?.close();
  chrome?.kill('SIGKILL');
  server?.kill('SIGKILL');
  fs.rmSync(work, { recursive: true, force: true });
  setTimeout(() => process.exit(exitCode), 300);
}
