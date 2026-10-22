#!/usr/bin/env node
// Checks the Monitor's Key panel (key-wheel.js) in the running composer: the
// server and the page in headless Chrome, driven in real time. A steady
// A minor chord (8A) is played into Chrome's fake microphone; the detector
// finds it and the wheel lights it; a click on 5A gives the operator's key,
// which the detector keeps until the music has said 8A for eight seconds;
// with "Keep the key I choose" ticked it stays; Detect hands it back. Also:
// the Monitor's notes are info panes beside each panel's name, and the key's
// readouts and settings have left the Setup view.
// `-- --screenshot file.png` saves the Monitor's Key panel with 5A chosen,
// and `-help.png` beside it with an info pane open; look at them, as the
// checks do not judge the picture.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME } from './headless.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 19000 + Math.floor(Math.random() * 1000);
const server = spawn(process.execPath, ['server.js', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-key-'));
const debugPort = 9700 + Math.floor(Math.random() * 90);

// A mono 16-bit WAV of a steady chord in A minor, each note's level from the
// minor key profile the detector matches (key-detector.js), three octaves.
function chordWav(file, seconds = 8, rate = 48000) {
  const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17], TONIC = 9;
  const notes = [];
  for (let midi = 45; midi < 81; ++midi) {
    const weight = MINOR[(midi - TONIC + 120) % 12];
    if (weight > 3.3) notes.push({ hz: 440 * 2 ** ((midi - 69) / 12), level: weight / 6.33 });
  }
  const n = seconds * rate, data = Buffer.alloc(n * 2), scale = 0.7 / notes.reduce((s, x) => s + x.level, 0);
  for (let i = 0; i < n; ++i) {
    let v = 0;
    for (const { hz, level } of notes) v += level * Math.sin(2 * Math.PI * hz * i / rate);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * scale)) * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

const wav = path.join(profile, 'a-minor.wav');
chordWav(wav);
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1440,900', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`,
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}`, '--disable-features=AudioServiceSandbox',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'],
{ stdio: 'ignore' });
const checks = [];
let exitCode = 1;
const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
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
  ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); pending.get(m.id)?.(m); });
  const send = (method, params = {}) => new Promise((resolve) => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.result.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? expression);
    return reply.result.result?.value;
  };
  const text = (id) => run(`document.getElementById('${id}').textContent`);
  const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  // Where a key's segment is on the screen, the wheel scrolled into view: the
  // middle of its ring at its number (12 at the top, clockwise).
  const segmentPoint = (number, letter) => run(`(() => { const c = document.getElementById('monitor-key-wheel');
    c.scrollIntoView({ block: 'center' }); const b = c.getBoundingClientRect();
    const r = (${letter === 'A' ? '(0.17 + 0.325) / 2' : '(0.325 + 0.48) / 2'}) * b.width, a = ${number} / 12 * 2 * Math.PI;
    return [b.left + b.width / 2 + r * Math.sin(a), b.top + b.height / 2 - r * Math.cos(a)]; })()`);
  const click = async (number, letter) => {
    const [x, y] = await segmentPoint(number, letter);
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y);
    await mouse('mouseReleased', x, y);
  };
  // How bright a key's segment is drawn, beside its label.
  const brightness = async (number, letter) => {
    const [x, y] = await segmentPoint(number, letter);
    return run(`(() => { const c = document.getElementById('monitor-key-wheel'), b = c.getBoundingClientRect();
      const px = Math.round((${x} - b.left) / b.width * c.width), py = Math.round((${y} - b.top) / b.height * c.height) - Math.round(c.height / 22);
      const d = c.getContext('2d').getImageData(px - 2, py - 2, 5, 5).data; let m = 0;
      for (let i = 0; i < d.length; i += 4) m = Math.max(m, (d[i] + d[i + 1] + d[i + 2]) / 3); return Math.round(m); })()`);
  };
  const shot = process.argv.includes('--screenshot') ? process.argv[process.argv.indexOf('--screenshot') + 1] : null;
  const screenshot = async (file) => {
    const { result: { data } } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  };

  await send('Page.navigate', { url: `http://localhost:${port}/` });
  await sleep(1500);
  await run(`localStorage.setItem('matrix-companion-settings', JSON.stringify({ host: '192.0.2.1', width: 64, height: 32,
    audioSource: 'device:default', patternId: 'plasma', view: 'monitor' }))`);
  await send('Page.reload');
  await sleep(2500);
  await mouse('mousePressed', 600, 860);
  await mouse('mouseReleased', 600, 860);

  const page = await run(`(() => { const monitor = document.querySelector('[data-view="monitor"]');
    return { notesLeft: document.querySelectorAll('[data-view="monitor"] p.hint[data-help], [data-view="monitor"] fieldset > p.hint:not([id])').length,
      panes: [...monitor.querySelectorAll('legend')].map((l) => [l.firstChild.textContent.trim(), !!l.querySelector('.help-button')]),
      keyInMonitor: ['musical-key', 'compatible-keys', 'key-colours', 'key-hold', 'key-lock', 'monitor-key-wheel']
        .every((id) => monitor.contains(document.getElementById(id))),
      setupKey: !!document.querySelector('[data-view="setup"] #musical-key') }; })()`);
  check('the Monitor\'s notes are info panes beside each panel\'s name, and the key\'s readouts and settings are on the Monitor, not Setup',
    page.notesLeft === 0 && page.panes.every(([, help]) => help) && page.panes.some(([name]) => name === 'Key') &&
    page.keyInMonitor && !page.setupKey, JSON.stringify(page));

  await sleep(9000);
  const found = { key: await text('musical-key'), neighbours: await text('compatible-keys'),
    detect: await run(`document.getElementById('key-detect').disabled`),
    lit: { '8A': await brightness(8, 'A'), '2B': await brightness(2, 'B') } };
  check('the detector finds A minor (8A) in the chord, and the wheel lights it above an unrelated key',
    /^A minor \/ 8A \(estimate/.test(found.key) && found.neighbours === 'Mix neighbours: 7A, 9A, 8B' && found.detect &&
    found.lit['8A'] > found.lit['2B'] + 40, JSON.stringify(found));

  await click(5, 'A');
  await sleep(400);
  const chosen = { key: await text('musical-key'), detect: await run(`document.getElementById('key-detect').disabled`),
    lit: { '5A': await brightness(5, 'A'), '8A': await brightness(8, 'A') } };
  check('a click on 5A makes C minor the key at once, the operator\'s, with Detect to hand it back',
    /^C minor \/ 5A \(your choice, until/.test(chosen.key) && !chosen.detect && chosen.lit['5A'] > chosen.lit['8A'],
    JSON.stringify(chosen));
  if (shot) await screenshot(shot);
  await sleep(4000);
  const stillChosen = await text('musical-key');
  check('the music saying 8A for four seconds does not replace it', /^C minor \/ 5A/.test(stillChosen), stillChosen);
  await sleep(7000);
  const replaced = await text('musical-key');
  check('after eight seconds and more of 8A the detector takes it back', /^A minor \/ 8A \(estimate/.test(replaced), replaced);

  await run(`{ const b = document.getElementById('key-lock'); b.checked = true; b.dispatchEvent(new Event('change')); }`);
  await click(5, 'A');
  await sleep(12000);
  const locked = { key: await text('musical-key'),
    saved: JSON.parse(await run(`localStorage.getItem('matrix-companion-settings')`)).keyLock };
  check('with "Keep the key I choose" ticked, 5A stays through twelve seconds of 8A, and the setting is saved',
    /^C minor \/ 5A \(your choice, kept whatever/.test(locked.key) && locked.saved === true, JSON.stringify(locked));
  await run(`document.getElementById('key-detect').click()`);
  await sleep(2500);
  const released = { key: await text('musical-key'), detect: await run(`document.getElementById('key-detect').disabled`) };
  check('Detect hands it back to the detector, which finds 8A again', /^A minor \/ 8A/.test(released.key) && released.detect,
    JSON.stringify(released));

  if (shot) {
    const [x, y] = await run(`(() => { const b = document.querySelector('[data-view="monitor"] fieldset:has(#monitor-key-wheel) .help-button').getBoundingClientRect();
      return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
    await mouse('mouseMoved', x, y);
    await sleep(300);
    await screenshot(shot.replace(/\.png$/, '-help.png'));
  }
  const errors = await text('error');
  check('no error shown', !errors, errors);
  ws.close();
  exitCode = checks.every((c) => c.ok) ? 0 : 1;
} catch (error) {
  checks.push({ name: 'run', ok: false, detail: error.stack });
} finally {
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  console.log(exitCode ? 'FAILED' : 'ok');
  chrome.kill();
  server.kill();
  setTimeout(() => {
    fs.rmSync(profile, { recursive: true, force: true });
    process.exit(exitCode);
  }, 500);
}
