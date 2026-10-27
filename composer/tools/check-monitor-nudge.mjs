#!/usr/bin/env node
// Checks nudging the Monitor's beat graph (beat-fold.js) in the running
// composer: the server and the page in headless Chrome, on the simulated
// signal, driven in real time. A nudge folds the sound again at the tempo
// shown and changes the picture; the bar line moves it; Send to the tracker
// gives the tempo to the beat tracker, detection carrying on; Make it the
// manual tempo hands it to the clock as the manual tempo; Follow the clock
// goes back; the Mixer's Downbeat button is there, and D does not Hotsave.
// Then the live path: a click track (a 60 Hz kick at 126 BPM, hats, and a
// loud steady bass hum) played into Chrome's fake microphone, with the clock
// held at 126: the clock's graph, folded from the input's spectral flux,
// stands level, and nudged a beat a minute fast it slopes.
// `-- --screenshot file.png` saves the Monitor view while nudged; look at it,
// as the checks do not judge the picture. `-- --wait 60` plays that many
// seconds of the signal first (12 by default), for a picture with more bars.
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'monitor-nudge-'));
const debugPort = 9700 + Math.floor(Math.random() * 90);
const LIVE_BPM = 126;

// A mono 16-bit WAV of `bars` bars of the click track, for the fake
// microphone, which loops it: a whole number of bars, so the loop does not
// move the beat.
function clickTrackWav(file, bars = 16, rate = 48000) {
  const beat = 60 / LIVE_BPM, n = Math.round(bars * 4 * beat * rate), data = Buffer.alloc(n * 2);
  let seed = 7;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  for (let i = 0; i < n; ++i) {
    const t = i / rate, into = t % beat, sixteenth = t % (beat / 4);
    let v = 0.35 * Math.sin(2 * Math.PI * 45 * t);
    if (into < 0.08) v += 0.5 * Math.sin(2 * Math.PI * 60 * into) * (1 - into / 0.08);
    if (sixteenth < 0.015) v += 0.12 * noise() * (1 - sixteenth / 0.015);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}
const wav = path.join(profile, 'click-track.wav');
clickTrackWav(wav);
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1440,900', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`,
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  // The audio service's sandbox would not let it read the file.
  ...(process.env.BEEPS ? [] : [`--use-file-for-fake-audio-capture=${wav}`, '--disable-features=AudioServiceSandbox']),
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
  ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((resolve) => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.result.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? expression);
    return reply.result.result?.value;
  };
  const saved = () => run(`JSON.parse(localStorage.getItem('matrix-companion-settings'))`);
  const readout = () => run(`document.getElementById('monitor-fold-bpm').textContent`);
  // The graph's pixels, as a fingerprint to tell two pictures apart.
  const picture = () => run(`(() => { const c = document.getElementById('monitor-graph');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0x811c9dc5, lit = 0;
    for (let i = 0; i < d.length; i += 4) { h = Math.imul(h ^ d[i] ^ (d[i + 1] << 8) ^ (d[i + 2] << 16), 0x01000193) >>> 0;
      if (Math.max(d[i], d[i + 1], d[i + 2]) > 30) ++lit; }
    return { hash: h.toString(16), lit }; })()`);
  const press = (selector) => run(`document.querySelector('${selector}').click()`);

  await send('Page.navigate', { url: `http://localhost:${port}/` });
  await sleep(1500);
  await run(`localStorage.setItem('matrix-companion-settings', JSON.stringify({ host: '192.0.2.1', width: 64, height: 32,
    audioSource: 'simulated', patternId: 'plasma', view: 'monitor', tempo: { mode: 'auto', source: 'bass' } }))`);
  await send('Page.reload');
  // Some bars of sound to fold.
  const wait = process.argv.includes('--wait') ? Number(process.argv[process.argv.indexOf('--wait') + 1]) : 12;
  await sleep(wait * 1000);
  const following = { readout: await readout(), use: await run(`document.getElementById('monitor-use').disabled`),
    picture: await picture() };
  check('at first it follows the clock, with nothing to use', following.readout === 'Following the clock' && following.use &&
    following.picture.lit > 100, JSON.stringify(following));

  await press('[data-nudge="1"]');
  await sleep(400);
  const nudged = { readout: await readout(), picture: await picture(), use: await run(`document.getElementById('monitor-use').disabled`) };
  const bpm = Number(nudged.readout.match(/([\d.]+) BPM/)?.[1]);
  check('a nudge folds at the tempo shown, one more than the clock, and redraws the picture with its history',
    Number.isFinite(bpm) && !nudged.use && nudged.picture.hash !== following.picture.hash && nudged.picture.lit > 100,
    JSON.stringify({ ...nudged, bpm }));
  await press('[data-nudge="-0.1"]');
  await sleep(300);
  const smaller = Number((await readout()).match(/([\d.]+) BPM/)?.[1]);
  check('a smaller nudge the other way', Math.abs(smaller - (bpm - 0.1)) < 1e-6, String(smaller));

  const beforePhase = await picture();
  await press('[data-phase="0.125"]');
  await sleep(300);
  const afterPhase = await picture();
  check('moving the bar line redraws the picture at the same tempo',
    afterPhase.hash !== beforePhase.hash && (await readout()) === `Folded at ${smaller.toFixed(2)} BPM`,
    JSON.stringify({ beforePhase, afterPhase }));

  const shot = process.argv.includes('--screenshot') ? process.argv[process.argv.indexOf('--screenshot') + 1] : null;
  if (shot) {
    const { result: { data } } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot, Buffer.from(data, 'base64'));
  }

  await press('#monitor-use');
  await sleep(500);
  const used = { tempo: (await saved()).tempo, readout: await readout(),
    field: await run(`document.getElementById('tempo-manual').value`),
    valid: await run(`document.getElementById('tempo-manual').checkValidity()`) };
  check('Make it the manual tempo makes it the manual tempo, in charge, and goes back to following the clock',
    used.tempo.mode === 'manual' && Math.abs(used.tempo.manualBpm - smaller) < 1e-6 && used.readout === 'Following the clock' &&
    Number(used.field) === smaller && used.valid, JSON.stringify(used));
  await sleep(1500);
  const clock = await run(`document.getElementById('monitor-readout').textContent`);
  check('the clock then runs at that tempo', clock.startsWith(`${Math.round(smaller * 10) / 10} BPM`), clock);

  // Send to the tracker: detection carries on, from the nudged tempo.
  await run(`{ const s = document.getElementById('tempo-mode'); s.value = 'auto'; s.dispatchEvent(new Event('change')); }`);
  await sleep(2000);
  await press('[data-nudge="1"]');
  await sleep(300);
  const sentBpm = Number((await readout()).match(/([\d.]+) BPM/)?.[1]);
  await press('#monitor-send');
  await sleep(400);
  const sent = { mode: (await saved()).tempo.mode, readout: await readout(), notice: await run(`document.getElementById('notice').textContent`),
    clock: await run(`document.getElementById('monitor-readout').textContent`) };
  const clockBpm = Number(sent.clock.match(/^([\d.]+) BPM/)?.[1]);
  check('Send to the tracker gives it the nudged tempo and leaves detection in charge',
    sent.mode === 'auto' && sent.readout === 'Following the clock' && /Sent/.test(sent.notice) &&
    Math.abs(clockBpm - sentBpm) < 1 && /detected/.test(sent.clock), JSON.stringify({ ...sent, sentBpm }));

  // The downbeat: a button beside Tap on the Mixer, and D, which is not the
  // Hotsave key.
  const hotsavesBefore = JSON.stringify((await saved()).playlists ?? null);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', text: 'd' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD' });
  await sleep(300);
  await run(`document.querySelector('[data-view-button="quad"]').click()`);
  await sleep(800);
  const downbeat = { button: await run(`[...document.querySelectorAll('#quad-view [data-pane="all"] button')].some((b) => b.textContent === 'Downbeat (D)')`),
    hotsaved: JSON.stringify((await saved()).playlists ?? null) !== hotsavesBefore };
  check('the Downbeat button sits on the Mixer, and D does not Hotsave', downbeat.button && !downbeat.hotsaved, JSON.stringify(downbeat));
  await run(`document.querySelector('[data-view-button="monitor"]').click()`);
  await sleep(500);

  // Tap and Downbeat on the Monitor too: two taps half a second apart set the
  // manual tempo, as on the Mixer; the downbeat acts on its press.
  const pressDown = (id) => run(`document.getElementById('${id}').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }))`);
  await pressDown('monitor-tap');
  await sleep(500);
  await pressDown('monitor-tap');
  await sleep(300);
  await pressDown('monitor-downbeat');
  await sleep(300);
  const tapped = { tempo: (await saved()).tempo, error: await run(`document.getElementById('error').textContent`) };
  check('the Monitor\'s Tap sets the manual tempo from two taps, and its Downbeat acts', tapped.tempo.mode === 'manual' &&
    Math.abs(tapped.tempo.manualBpm - 120) <= 2 && !tapped.error, JSON.stringify(tapped));

  await press('[data-nudge="0.1"]');
  await sleep(300);
  await press('#monitor-follow');
  await sleep(300);
  check('Follow the clock goes back to its own graph', (await readout()) === 'Following the clock');

  const errors = await run(`document.getElementById('error').textContent`);
  check('no error shown', !errors, errors);

  // The live path, on the fake microphone's click track, the clock held at
  // its tempo. How level the lines are: the mean correlation of each of the
  // last 16 bars' columns with the one before (as tools/fold-measures.js
  // scores a fold); level lines make neighbours alike, slopes do not.
  const levelness = () => run(`(() => { const c = document.getElementById('monitor-graph'), x = c.getContext('2d');
    const d = x.getImageData(0, 0, c.width, c.height).data, quarter = c.height / 4;
    const column = (bar) => { const px = c.width - bar * 2, out = [];
      for (let y = 0; y < c.height; ++y) { if (y % quarter === 0) continue;
        const i = (y * c.width + px) * 4; out.push(Math.max(d[i], d[i + 1], d[i + 2])); } return out; };
    const corr = (a, b) => { const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; ++i) { ma += a[i]; mb += b[i]; }
      ma /= n; mb /= n; let ab = 0, aa = 0, bb = 0;
      for (let i = 0; i < n; ++i) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; }
      return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0; };
    let sum = 0; for (let bar = 2; bar <= 17; ++bar) sum += corr(column(bar), column(bar + 1));
    return Math.round(sum / 16 * 1000) / 1000; })()`);
  let live0 = null;
  // How alike neighbouring bars must be at the right tempo, and how much more
  // than a beat a minute off: about half what was first measured (0.27, and
  // 0.29 more than nudged), where noise sits near 0.
  const LEVEL = 0.15, LEVEL_GAP = 0.15;
  await run(`localStorage.setItem('matrix-companion-settings', JSON.stringify({ host: '192.0.2.1', width: 64, height: 32,
    audioSource: 'device:default', patternId: 'plasma', view: 'monitor', tempo: { mode: 'manual', manualBpm: ${LIVE_BPM}, source: 'flux' } }))`);
  await send('Page.reload');
  await sleep(3000);
  // A click, as a person's would, in case the browser holds audio until one.
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x: 600, y: 860, button: 'left', clickCount: 1 });
  live0 = { context: await run(`document.getElementById('monitor-readout').textContent`) };
  await sleep(42000);
  if (shot) {
    const { result: { data } } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot.replace(/\.png$/, '-live-level.png'), Buffer.from(data, 'base64'));
  }
  const live = { input: await run(`document.getElementById('audio-channels').textContent`), level: await levelness(),
    readout: await run(`document.getElementById('monitor-readout').textContent`),
    before: live0, stats: await run(`document.getElementById('stats').textContent`),
    meter: await run(`(() => { const c = document.getElementById('meter'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 100) ++lit; return lit; })()`) };
  await press('[data-nudge="1"]');
  await sleep(600);
  live.nudged = await levelness();
  live.fold = await readout();
  check('live input: the clock\'s graph, folded from flux at the right tempo, stands level; a beat a minute fast, it slopes',
    live.level >= LEVEL && live.level - live.nudged >= LEVEL_GAP && live.fold === `Folded at ${(LIVE_BPM + 1).toFixed(2)} BPM`,
    JSON.stringify(live));
  if (shot) {
    const { result: { data } } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot.replace(/\.png$/, '-live-nudged.png'), Buffer.from(data, 'base64'));
  }
  const liveErrors = await run(`document.getElementById('error').textContent`);
  check('no error shown on the live input', !liveErrors, liveErrors);
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
