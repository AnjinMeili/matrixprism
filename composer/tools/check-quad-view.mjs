#!/usr/bin/env node
// Checks the quad mixer's view in the running composer (T16 step 5): the
// composer's server and the page in headless Chrome, driven over the
// DevTools protocol in real time, since the frame clock does not run on
// headless Chrome's virtual time. Nothing streams: no receiver is set.
//
// The stream's picture is made predictable with the Panel Range test card,
// which does not move: A shows it, and C shows it with its brightness trimmed
// to 0, so Left is bright and Right black, and the Live monitor's mean level
// says which the stream is sending. It checks the panes and mirroring, the
// previews, C and D's patterns, the master (the fader moves the stream at
// once; Fade takes it across over the fade time; no Gated mode), blackout, a
// pair's cut, A kept in step with the Patterns view and Left with the
// one-pair mixer's settings, and Save as default with Reset main; Swap; each
// input's own hue or the main's; the randomizer in the panes; the shape's
// More… popover, Mix and tap. The master is called the main on screen (
// Anjin, 2026-10-16), and the view the Mixer (2026-10-20).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME } from './headless.mjs';
import { INPUT_DEFAULTS, PAIR_DEFAULTS } from '../public/quad.js';
import { channelTags } from '../public/channel-tags.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 19000 + Math.floor(Math.random() * 1000);
const server = spawn(process.execPath, ['server.js', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'quad-view-'));
const debugPort = 9700 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1440,900', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, 'about:blank'],
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
  const q = (selector) => `document.querySelector('#quad-view ${selector}')`;
  // Sets a control and fires what a person's use would.
  const set = (selector, value, type) => run(`{ const c = ${q(selector)}; ` +
    `if (c.type === 'checkbox' || c.type === 'radio') c.checked = ${JSON.stringify(value)}; else c.value = ${JSON.stringify(value)}; ` +
    `c.dispatchEvent(new Event('${type}', { bubbles: true })); }`);
  const click = (selector) => run(`${q(selector)}.click()`);
  const clickText = (pane, text) => run(`[...document.querySelectorAll('#quad-view [data-pane="${pane}"] button')]` +
    `.find((b) => b.textContent === ${JSON.stringify(text)}).click()`);
  // The Live monitor's mean level, 0 to 255.
  const liveLevel = () => run(`(() => { const c = ${q('[data-pane="master"] .qv-monitor:last-of-type canvas')};
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += Math.max(d[i], d[i + 1], d[i + 2]); return s / (d.length / 4); })()`);
  const canvasLevel = (selector) => run(`(() => { const c = ${q(selector)};
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += Math.max(d[i], d[i + 1], d[i + 2]); return s / (d.length / 4); })()`);
  const saved = () => run(`JSON.parse(localStorage.getItem('matrix-companion-settings'))`);

  await send('Page.navigate', { url: `http://localhost:${port}/` });
  await sleep(1500);
  await run(`localStorage.setItem('matrix-companion-settings', JSON.stringify({ host: '', width: 64, height: 32,
    fps: 30, audioSource: 'simulated', patternId: 'panel-range', view: 'patterns', brightness: 1, gamma: 1,
    quad: { inputs: { c: { patternId: 'panel-range', brightness: 0 }, d: { patternId: 'plasma' } } } }))`);
  await send('Page.reload');
  await sleep(2500);
  await run(`document.querySelector('[data-view-button="quad"]').click()`);
  await sleep(1500);

  // A screenshot of the view as first shown, for a person to look at:
  // the checks below do not judge the look. --screenshot <file.png>.
  const shot = process.argv.includes('--screenshot') ? process.argv[process.argv.indexOf('--screenshot') + 1] : null;
  if (shot) {
    const { result: { data } } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot, Buffer.from(data, 'base64'));
  }
  const panes = await run(`[...document.querySelectorAll('#quad-view .layout-pane')].map((p) => [p.dataset.pane, p.classList.contains('layout-mirror')])`);
  check('nine panes in the agreed order', panes.map(([k]) => k).join() ===
    'input:a,pair:left,input:b,all,master,output,input:c,pair:right,input:d', JSON.stringify(panes));
  check('Right mirrored, Left not', panes.filter(([k]) => /:(c|d|right)$/.test(k)).every(([, m]) => m) &&
    panes.filter(([k]) => /:(a|b|left)$/.test(k)).every(([, m]) => !m));
  check('quad mode hides the rest', await run(`document.body.classList.contains('quad-mode') && getComputedStyle(document.querySelector('main')).display === 'none'`));
  const previewA = await canvasLevel('[data-pane="input:a"] canvas');
  const previewC = await canvasLevel('[data-pane="input:c"] canvas');
  check('previews drawn: A lit, C trimmed to black', previewA > 20 && previewC < 2, `A ${previewA.toFixed(1)}, C ${previewC.toFixed(1)}`);
  const live0 = await liveLevel();
  check('the master at Left: the stream is bright', live0 > 20, live0.toFixed(1));

  // The Main's Brightness and Gamma are the Look sliders' settings, shown a
  // second time: each moves the other, and Brightness dims the stream.
  const lookRow = await run(`(() => { const main = ${q('[data-pane="master"]')}.getBoundingClientRect();
    const all = ${q('[data-pane="all"]')}.getBoundingClientRect();
    const sliders = [...${q('[data-pane="all"] .qv-all-look')}.querySelectorAll('input[type=range]')];
    const buttons = [...${q('[data-pane="master"] .qv-main-buttons')}.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
    return { sliders: sliders.map((c) => [c.getAttribute('aria-label'), c.value]),
      buttonsInside: buttons.length === 4 && buttons.every((r) => r.top >= main.top && r.bottom <= main.bottom + 0.5),
      slidersInside: sliders.every((c) => { const r = c.getBoundingClientRect(); return r.top >= all.top && r.bottom <= all.bottom + 0.5; }) }; })()`);
  check('All inputs has Brightness and Gamma sliders, at the saved values', JSON.stringify(lookRow.sliders) ===
    JSON.stringify([['Main brightness', '1'], ['Main gamma', '1']]), JSON.stringify(lookRow.sliders));
  check('the sliders stay inside All inputs and every Main button inside the Main at this window size', lookRow.buttonsInside && lookRow.slidersInside, JSON.stringify(lookRow));
  // The pills and the Live label are not rewritten while nothing changes (they
  // were, every frame, and flashed).
  const writes = await run(`new Promise((resolve) => { let count = 0;
    const watched = [...document.querySelectorAll('#quad-view .qv-pill')];
    const observer = new MutationObserver((records) => { count += records.length; });
    for (const node of watched) observer.observe(node, { childList: true, characterData: true, subtree: true, attributes: true });
    setTimeout(() => { observer.disconnect(); resolve({ pills: watched.length, writes: count }); }, 1200); })`);
  check('the on air, cued and Live pills are not rewritten while nothing changes', writes.pills >= 7 && writes.writes === 0, JSON.stringify(writes));
  // Gain, in the gap between the Spectrum and Beat map displays, is Setup's
  // Reactivity slider's setting.
  const gainRow = await run(`(() => { const main = ${q('[data-pane="master"]')}.getBoundingClientRect();
    const gain = ${q('[data-pane="master"] input[aria-label="Gain"]')}.getBoundingClientRect();
    const [spectrum, beatMap] = [...${q('[data-pane="master"] .qv-minis')}.querySelectorAll('canvas')].map((c) => c.getBoundingClientRect());
    return { between: gain.left >= spectrum.right - 1 && gain.right <= beatMap.left + 1 && gain.top >= spectrum.top - 1 && gain.bottom <= spectrum.bottom + 1,
      inside: gain.top >= main.top && gain.bottom <= main.bottom, value: ${q('[data-pane="master"] input[aria-label="Gain"]')}.value,
      setup: document.getElementById('gain').value }; })()`);
  check('Gain is a thin slider between the Spectrum and Beat map displays, at Setup\'s value', gainRow.between && gainRow.inside &&
    gainRow.value === gainRow.setup, JSON.stringify(gainRow));
  await set('[data-pane="master"] input[aria-label="Gain"]', 2.5, 'input');
  await sleep(300);
  const gainSet = await run(`({ saved: JSON.parse(localStorage.getItem('matrix-companion-settings')).gain,
    setup: document.getElementById('gain').value, setupText: document.getElementById('gain-value').textContent,
    caption: ${q('[data-pane="master"] .qv-minis figcaption')}.textContent })`);
  check('Gain sets the setting and Setup\'s slider, and the Spectrum says so', gainSet.saved === 2.5 && gainSet.setup === '2.5' &&
    gainSet.setupText === '2.50×' && gainSet.caption === 'Spectrum · gain 2.50×', JSON.stringify(gainSet));
  await run(`{ const c = document.getElementById('gain'); c.value = 0.8; c.dispatchEvent(new Event('input')); }`);
  await sleep(400);
  const gainFollows = await run(`${q('[data-pane="master"] input[aria-label="Gain"]')}.value`);
  check('Setup\'s Reactivity slider moves the Gain slider', gainFollows === '0.8', gainFollows);
  await set('[data-pane="master"] input[aria-label="Gain"]', 1.5, 'input');
  await sleep(200);
  await set('[data-pane="all"] input[aria-label="Main brightness"]', 0.4, 'input');
  await sleep(500);
  const dimmed = await liveLevel();
  const afterMain = await run(`({ saved: JSON.parse(localStorage.getItem('matrix-companion-settings')).brightness,
    look: document.getElementById('brightness').value, lookText: document.getElementById('brightness-value').textContent })`);
  check('Brightness in All inputs sets the setting and the Look slider, and dims the stream', afterMain.saved === 0.4 &&
    afterMain.look === '0.4' && afterMain.lookText === '40%' && dimmed < live0 * 0.6, `${JSON.stringify(afterMain)}, stream ${live0.toFixed(1)} to ${dimmed.toFixed(1)}`);
  await set('[data-pane="all"] input[aria-label="Main gamma"]', 2, 'input');
  const afterGamma = await run(`({ saved: JSON.parse(localStorage.getItem('matrix-companion-settings')).gamma,
    look: document.getElementById('gamma').value, lookText: document.getElementById('gamma-value').textContent })`);
  check('Gamma in All inputs sets the setting and the Look slider', afterGamma.saved === 2 && afterGamma.look === '2' &&
    afterGamma.lookText === '2.00', JSON.stringify(afterGamma));
  // The other way: the Look sliders move, and the Main's follow on the next visit.
  await run(`document.querySelector('[data-view-button="patterns"]').click()`);
  await sleep(300);
  await run(`{ for (const [id, value] of [['brightness', 0.7], ['gamma', 1.5]]) { const c = document.getElementById(id);
    c.value = value; c.dispatchEvent(new Event('input')); } }`);
  await run(`document.querySelector('[data-view-button="quad"]').click()`);
  await sleep(500);
  const followed = await run(`[...${q('[data-pane="all"] .qv-all-look')}.querySelectorAll('input[type=range]')].map((c) => c.value)`);
  check('the Look sliders move the All inputs sliders', JSON.stringify(followed) === JSON.stringify(['0.7', '1.5']), JSON.stringify(followed));
  await set('[data-pane="all"] input[aria-label="Main brightness"]', 1, 'input');
  await set('[data-pane="all"] input[aria-label="Main gamma"]', 1, 'input');
  await sleep(300);

  await set('[data-pane="master"] .qv-master-fader input[type=range]', 1, 'input');
  await sleep(500);
  const live1 = await liveLevel();
  check('the fader at Right turns the stream black at once', live1 < 2, live1.toFixed(1));

  // The master's Fade, from Right (black) back to Left over half a second.
  await run(`{ const s = [...document.querySelectorAll('#quad-view [data-pane="master"] select')][1];
    s.value = '0.5'; s.dispatchEvent(new Event('change')); }`);
  const label = await run(`[...document.querySelectorAll('#quad-view [data-pane="master"] button')].map((b) => b.textContent).join('|')`);
  check('no Gated mode: no Take, no Preview, no switch', !/Take|Gated|Live mix/.test(label) &&
    !(await run(`!!${q('[data-pane="master"] input[type=radio]')}`)), label);
  await clickText('master', 'Fade to Left');
  await sleep(150);
  const during = await liveLevel();
  await sleep(1100);
  const faded = await liveLevel();
  const position = (await saved()).quad.master.position;
  check('Fade takes the master across to the other side over the fade time',
    faded > 20 && position === 0 && during < faded, `during ${during.toFixed(1)}, after ${faded.toFixed(1)}, position ${position}`);

  await clickText('master', 'Blackout');
  await sleep(400);
  const black = await liveLevel();
  await clickText('master', 'Blackout on');
  await sleep(400);
  const back = await liveLevel();
  check('Blackout holds the stream black; off brings it back', black < 1 && back > 20, `${black.toFixed(1)} then ${back.toFixed(1)}`);

  await clickText('pair:right', 'D');
  await sleep(200);
  const right = (await saved()).quad.pairs.right;
  check('Cut to D sets the Right pair to D', right.enabled && right.amount === 1, JSON.stringify(right));

  await set('[data-pane="input:a"] select', 'plasma', 'change');
  await sleep(300);
  const a = await run(`({ saved: JSON.parse(localStorage.getItem('matrix-companion-settings')).patternId,
    pressed: document.querySelector('#patterns button[aria-pressed="true"]')?.dataset.id })`);
  check("A changed in the quad view is A in today's Patterns view", a.saved === 'plasma' && a.pressed === 'plasma', JSON.stringify(a));
  await set('[data-pane="pair:left"] input[type=range]', 0.8, 'input');
  await sleep(600);
  const leftMix = (await saved()).mixer;
  check("Left's fader is the one-pair mixer's amount, and turns its mixing on", leftMix.enabled && leftMix.amount === 0.8,
    JSON.stringify(leftMix));

  await set('[data-pane="input:c"] select', 'tunnel', 'change');
  await clickText('master', 'Save as default');
  await set('[data-pane="input:c"] select', 'stars', 'change');
  await set('[data-pane="master"] .qv-master-fader input[type=range]', 0.7, 'input');
  await run(`{ const h = document.getElementById('hue'); h.value = '0.5'; h.dispatchEvent(new Event('input')); }`);
  await sleep(200);
  await clickText('master', 'Reset main');
  await sleep(400);
  const reset = await saved();
  check('Reset main brings back the saved default, shared settings included',
    reset.quad.inputs.c.patternId === 'tunnel' && reset.quad.master.position === 0 && reset.hue !== 0.5 &&
    reset.patternId === 'plasma', JSON.stringify({ c: reset.quad.inputs.c.patternId, position: reset.quad.master.position, hue: reset.hue }));

  // Swap (Anjin, 2026-10-16): the picture stays. Left shows B, the test
  // card, at full; A is Plasma. After Swap the card is on A, the fader at A,
  // and A must cut, not crossfade, or the stream would show Plasma fading.
  await set('[data-pane="input:a"] select', 'plasma', 'change');
  await set('[data-pane="input:b"] select', 'panel-range', 'change');
  await set('[data-pane="input:c"] select', 'panel-range', 'change');
  await set('[data-pane="input:c"] input[type=range]', 0, 'input');
  await set('[data-pane="master"] .qv-master-fader input[type=range]', 0, 'input');
  // A crossfade on both pairs and the master, whose fader is a position.
  await set('[data-pane="pair:left"] select', 'crossfade', 'change');
  await set('[data-pane="pair:right"] select', 'crossfade', 'change');
  await set('[data-pane="master"] select', 'crossfade', 'change');
  await clickText('pair:right', 'C');
  await clickText('pair:left', 'B');
  await sleep(500);
  // The card blinks a band every half second, so the stream has two levels.
  // Every sample after a swap, from the first, must be one of them: a cut.
  const samples = async (ms) => {
    const out = [];
    for (const end = Date.now() + ms; Date.now() < end; await sleep(40)) out.push(await liveLevel());
    return out;
  };
  const card = await samples(1100);
  const [low, high] = [Math.min(...card), Math.max(...card)];
  const onCard = (levels) => levels.every((v) => Math.abs(v - low) < 1 || Math.abs(v - high) < 1);
  const show = (levels) => levels.map((v) => v.toFixed(0)).join(' ');
  await clickText('pair:left', 'Swap');
  const leftLevels = await samples(1100);
  const swapped = await saved();
  check('Swap on Left: A and B trade, the fader moves to A, the stream stays, from the first frame',
    swapped.patternId === 'panel-range' && swapped.mixer.patternId === 'plasma' && swapped.mixer.amount === 0 &&
    high - low > 10 && onCard(leftLevels),
    `A ${swapped.patternId}, B ${swapped.mixer.patternId}, amount ${swapped.mixer.amount}; card ${low.toFixed(1)}/${high.toFixed(1)}; after ${show(leftLevels)}`);
  await clickText('master', 'Swap');
  const masterLevels = await samples(1100);
  const crossed = await saved();
  check('Swap on the master: Left and Right trade whole, the master moves to Right, the stream stays',
    crossed.quad.master.position === 1 && crossed.patternId === 'panel-range' && crossed.quad.inputs.a.brightness === 0 &&
    crossed.quad.inputs.c.patternId === 'panel-range' && crossed.quad.inputs.c.brightness === 1 &&
    crossed.quad.inputs.d.patternId === 'plasma' && onCard(masterLevels),
    `master ${crossed.quad.master.position}; A ${crossed.patternId} at ${crossed.quad.inputs.a.brightness}, ` +
    `C ${crossed.quad.inputs.c.patternId} at ${crossed.quad.inputs.c.brightness}, D ${crossed.quad.inputs.d.patternId}; after ${show(masterLevels)}`);
  const rightBefore = crossed.quad.pairs.right;
  await clickText('pair:right', 'Swap');
  const rightLevels = await samples(600);
  const once = await saved();
  await clickText('pair:right', 'Swap');
  await sleep(300);
  const twice = await saved();
  check('Swap on Right twice puts C and D back, the stream staying', once.quad.inputs.c.patternId === 'plasma' &&
    twice.quad.inputs.c.patternId === 'panel-range' && twice.quad.pairs.right.amount === rightBefore.amount && onCard(rightLevels),
    `${JSON.stringify({ before: rightBefore, after: twice.quad.pairs.right })}; after the first ${show(rightLevels)}`);

  await clickText('pair:left', 'Swap');
  await sleep(300);
  const mixerSwap = await saved();
  check("Left's Swap trades A and B back", mixerSwap.patternId === 'plasma' && mixerSwap.mixer.patternId === 'panel-range' &&
    mixerSwap.quad.inputs.a.brightness === 1 && mixerSwap.quad.inputs.b.brightness === 0,
    `A ${mixerSwap.patternId} at ${mixerSwap.quad.inputs.a.brightness}, B ${mixerSwap.mixer.patternId} at ${mixerSwap.quad.inputs.b.brightness}`);

  check('the master is called Main', await run(`${q('[data-pane="master"] h2')}.textContent`) === 'Main' &&
    await run(`[...document.querySelectorAll('#quad-view [data-pane="master"] button')].some((b) => b.textContent === 'Reset main')`));

  // Hue (Anjin, 2026-10-16): Plasma on C and D draws the same frame, so
  // their previews match while both follow the main, and differ once C has
  // its own hue.
  const hueControl = (pane, kind) => `document.querySelector('#quad-view [data-pane="${pane}"] ` +
    `${kind === 'Hue' ? '.qv-hue input[type=range]' : '.qv-follow input'}')`;
  const setHue = (pane, kind, value, type) => run(`{ const c = ${hueControl(pane, kind)}; ` +
    `if (c.type === 'checkbox') c.checked = ${JSON.stringify(value)}; else c.value = ${JSON.stringify(value)}; ` +
    `c.dispatchEvent(new Event('${type}', { bubbles: true })); }`);
  const previewDifference = () => run(`(() => {
    const data = (id) => { const c = document.querySelector('#quad-view [data-pane="input:' + id + '"] canvas');
      return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
    const c = data('c'), d = data('d'); let s = 0;
    for (let i = 0; i < c.length; i += 4) s += Math.abs(c[i] - d[i]) + Math.abs(c[i + 1] - d[i + 1]) + Math.abs(c[i + 2] - d[i + 2]);
    return s / (c.length / 4); })()`);
  for (const id of ['c', 'd']) {
    await set(`[data-pane="input:${id}"] select`, 'plasma', 'change');
    await run(`{ const r = ${q(`[data-pane="input:${id}"] input[type=range]`)}; r.value = 1; r.dispatchEvent(new Event('input', { bubbles: true })); }`);
  }
  await sleep(600);
  const following = await saved();
  const sameBefore = await previewDifference();
  const followTicked = await run(`${hueControl('input:c', 'Follow main')}.checked && ${hueControl('input:c', 'Hue')}.disabled`);
  await setHue('input:c', 'Follow main', false, 'change');
  await sleep(200);
  const own = (await saved()).quad.inputs.c.hue;
  await setHue('input:c', 'Hue', 0.5, 'input');
  await sleep(600);
  const ownHue = await saved();
  const differs = await previewDifference();
  await setHue('input:c', 'Follow main', true, 'change');
  await sleep(600);
  const followingAgain = await saved();
  const sameAfter = await previewDifference();
  check("an input follows the main's hue until given its own", following.quad.inputs.c.hue === null && followTicked &&
    own === following.hue && ownHue.quad.inputs.c.hue === 0.5 && ownHue.quad.inputs.d.hue === null && followingAgain.quad.inputs.c.hue === null &&
    sameBefore < 1 && differs > 20 && sameAfter < 1,
    `C and D differ by ${sameBefore.toFixed(1)} following, ${differs.toFixed(1)} with C's own hue 0.5, ${sameAfter.toFixed(1)} following again; ` +
    `own hue started at ${own} (main ${following.hue})`);

  // An input's preview shows its shape and region, as it goes into the mix
  // (Anjin, 2026-10-16). Plasma is on A, C and D: C's region is the
  // centre, A's the edges, D's the whole panel. Mean levels of the preview's
  // corners and of its middle.
  const regionOf = (id) => `document.querySelectorAll('#quad-view [data-pane="input:${id}"] select')[2]`;
  const setRegion = (id, value) => run(`{ const r = ${regionOf(id)}; r.value = '${value}'; r.dispatchEvent(new Event('change')); }`);
  const parts = (id) => run(`(() => {
    const c = document.querySelector('#quad-view [data-pane="input:${id}"] canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const mean = (x0, y0, size) => { let s = 0, n = 0;
      for (let y = y0; y < y0 + size; ++y) for (let x = x0; x < x0 + size; ++x) {
        const i = (y * c.width + x) * 4; s += Math.max(d[i], d[i + 1], d[i + 2]); ++n; }
      return s / n; };
    const k = Math.max(2, Math.floor(c.height / 8));
    const corners = (mean(0, 0, k) + mean(c.width - k, 0, k) + mean(0, c.height - k, k) + mean(c.width - k, c.height - k, k)) / 4;
    return { corners: Math.round(corners), middle: Math.round(mean(Math.floor(c.width / 2 - k / 2), Math.floor(c.height / 2 - k / 2), k)) }; })()`);
  await set('[data-pane="input:a"] select', 'plasma', 'change');
  await setRegion('a', 'outer');
  await setRegion('c', 'centre');
  await setRegion('d', 'full');
  await sleep(700);
  const shaped = { a: await parts('a'), c: await parts('c'), d: await parts('d') };
  check("an input's preview shows its region: C the centre, A the edges, D all",
    shaped.c.corners < 2 && shaped.c.middle > 20 && shaped.a.middle < 2 && shaped.a.corners > 20 &&
    shaped.d.corners > 20 && shaped.d.middle > 20, JSON.stringify(shaped));
  // With --screenshot, the view with those regions too, beside the first.
  if (shot) {
    const { result: { data } } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(shot.replace(/\.png$/, '-regions.png'), Buffer.from(data, 'base64'));
  }
  await setRegion('a', 'full');
  await setRegion('c', 'full');

  // The help popovers are not cut off by their pane (Anjin, 2026-10-16):
  // D's, beside the middle column, hovered as a person would, is whole in the
  // window and on top at its four corners, and hides when the pointer leaves.
  const helpAt = await run(`(() => { const r = document.querySelector('#quad-view [data-pane="input:d"] .help-button').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: helpAt.x, y: helpAt.y });
  await sleep(200);
  const popover = await run(`(() => {
    const pop = document.getElementById(document.querySelector('#quad-view [data-pane="input:d"] .help-button').getAttribute('aria-describedby'));
    const r = pop.getBoundingClientRect();
    const corners = [[r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]];
    return { shown: getComputedStyle(pop).display !== 'none', left: Math.round(r.left), right: Math.round(r.right),
      top: Math.round(r.top), bottom: Math.round(r.bottom), width: innerWidth,
      onTop: corners.every(([x, y]) => pop.contains(document.elementFromPoint(x, y))) }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await sleep(200);
  popover.hidden = await run(`getComputedStyle(document.getElementById(document.querySelector('#quad-view [data-pane="input:d"] .help-button')
    .getAttribute('aria-describedby'))).display === 'none'`);
  check("D's help popover is whole and on top, and hides again", popover.shown && popover.onTop && popover.hidden &&
    popover.left >= 0 && popover.right <= popover.width && popover.top >= 0, JSON.stringify(popover));

  // The randomizer changes Right too (T16 step 6, Anjin, 2026-10-20),
  // run from the panes it changes ("A in A, B in B, mix of A&B in mixer"):
  // C and D's patterns and shapes and Right's blend, on their own timers,
  // with C and D between them covering the panel, and the panes showing it.
  const items = await run(`Object.fromEntries([...document.querySelectorAll('#quad-view .layout-pane')]
    .map((p) => [p.dataset.pane, p.querySelectorAll('.qv-random').length]).filter(([, n]) => n))`);
  check('each pane has its randomizer items: two per input, one per pair, colour and media',
    JSON.stringify(items) === JSON.stringify({ 'input:a': 2, 'pair:left': 1, 'input:b': 2, all: 1, output: 1, 'input:c': 2, 'pair:right': 1, 'input:d': 2 }),
    JSON.stringify(items));
  await set('[data-pane="pair:right"] input[type=range]', 0.5, 'input');
  const rightNow = async () => { const { inputs: { c, d }, pairs } = (await saved()).quad;
    return { c: c.patternId, d: d.patternId, cShape: JSON.stringify(c.shape), dShape: JSON.stringify(d.shape),
      cRegion: c.shape.region, dRegion: d.shape.region, pair: JSON.stringify(pairs.right) }; };
  const beforeRandom = await rightNow();
  // On, with one-second waits, from the Output pane.
  await run(`{ const [min, max] = ${q('[data-pane="output"]')}.querySelectorAll('input[type=number]');
    for (const [c, v] of [[min, 1], [max, 1]]) { c.value = v; c.dispatchEvent(new Event('change')); }
    const on = ${q('[data-pane="output"] .qv-check input')}; on.checked = true; on.dispatchEvent(new Event('change')); }`);
  const playlistView = await run(`({ on: document.getElementById('randomizer-enabled').checked,
    min: document.getElementById('randomizer-min').value, max: document.getElementById('randomizer-max').value })`);
  const regions = [];
  for (let i = 0; i < 12; ++i) {
    await sleep(400);
    const now = await rightNow();
    regions.push([now.cRegion, now.dRegion]);
  }
  const afterRandom = await rightNow();
  const shownC = await run(`${q('[data-pane="input:c"] select')}.value`);
  const waitC = await run(`${q('[data-pane="input:c"] .qv-wait')}.textContent`);
  const changed = ['c', 'd', 'cShape', 'dShape', 'pair'].filter((k) => afterRandom[k] !== beforeRandom[k]);
  check('the randomizer, turned on in the Output pane, changes C and D\'s patterns and shapes and Right\'s blend',
    changed.length === 5 && shownC === afterRandom.c && /^\d+ s$/.test(waitC) &&
    playlistView.on && playlistView.min === '1' && playlistView.max === '1',
    `changed ${changed.join(', ')}; C ${beforeRandom.c} to ${afterRandom.c}, D ${beforeRandom.d} to ${afterRandom.d}; ` +
    `pane shows ${shownC}, next in ${waitC}; Playlist view ${JSON.stringify(playlistView)}`);
  check('C and D between them always cover the panel',
    regions.every(([c, d]) => c === 'full' || d === 'full' || c !== d), JSON.stringify(regions));

  // Waits counted in beats or bars of the tempo (Anjin, 2026-10-20), set
  // in the Output pane; one beat each, so changes come about twice a second.
  const setUnit = (value) => run(`{ const s = [...${q('[data-pane="output"]')}.querySelectorAll('select')].at(-1);
    s.value = '${value}'; s.dispatchEvent(new Event('change')); }`);
  await setUnit('beats');
  await sleep(300);
  const inBeats = { saved: (await saved()).randomizer.unit, playlistView: await run(`document.getElementById('randomizer-unit').value`) };
  const beatsFrom = await rightNow();
  const waits = new Set();
  for (let i = 0; i < 10; ++i) {
    await sleep(300);
    waits.add(await run(`${q('[data-pane="input:d"] .qv-wait')}.textContent`));
  }
  const beatsTo = await rightNow();
  await setUnit('seconds');
  check('waits counted in beats: set in the Output pane, saved, shown as beats, and the channels go on changing',
    inBeats.saved === 'beats' && inBeats.playlistView === 'beats' && [...waits].every((w) => /^\d+ beats?$/.test(w)) &&
    (beatsTo.c !== beatsFrom.c || beatsTo.d !== beatsFrom.d),
    JSON.stringify({ inBeats, waits: [...waits], c: [beatsFrom.c, beatsTo.c], d: [beatsFrom.d, beatsTo.d] }));

  // An input locked to the Media Player (Anjin, 2026-10-20): C's Random
  // pattern unticked in its pane keeps C's pattern while D's goes on changing.
  await set('[data-pane="input:c"] select', 'media-player', 'change');
  await run(`{ const box = ${q('[data-pane="input:c"] .qv-random input')}; box.checked = false; box.dispatchEvent(new Event('change')); }`);
  const lockedFrom = await rightNow();
  const cPatterns = new Set(), dPatterns = new Set();
  for (let i = 0; i < 8; ++i) {
    await sleep(400);
    const now = await rightNow();
    cPatterns.add(now.c);
    dPatterns.add(now.d);
  }
  const lock = { tracks: (await saved()).randomizer.tracks.patternC,
    playlistBox: await run(`document.getElementById('randomizer-patternC').checked`) };
  await run(`{ const on = ${q('[data-pane="output"] .qv-check input')}; on.checked = false; on.dispatchEvent(new Event('change')); }`);
  check('C\'s Random pattern unticked keeps C on the Media Player while D changes',
    lockedFrom.c === 'media-player' && cPatterns.size === 1 && cPatterns.has('media-player') && dPatterns.size > 1 &&
    lock.tracks === false && lock.playlistBox === false,
    `C ${[...cPatterns].join(', ')}; D ${[...dPatterns].join(', ')}; saved ${lock.tracks}, Playlist view box ${lock.playlistBox}`);

  // Everything from the one-pair Mixer view is here too (Anjin,
  // 2026-10-20), the shape's further settings in a popover per input.
  await click('[data-pane="input:a"] .qv-more');
  await sleep(300);
  const popA = await run(`(() => { const pop = ${q('[data-pane="input:a"] .qv-pop')}; const r = pop.getBoundingClientRect();
    const corners = [[r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]];
    return { open: pop.matches(':popover-open'), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
      bottom: Math.round(r.bottom), width: innerWidth, height: innerHeight,
      onTop: corners.every(([x, y]) => pop.contains(document.elementFromPoint(x, y))) }; })()`);
  await run(`{ const s = [...${q('[data-pane="input:a"] .qv-pop')}.querySelectorAll('select')][1]; s.value = '2'; s.dispatchEvent(new Event('change')); }`);
  await sleep(200);
  const spinA = { saved: (await saved()).shapes.a.spin, quad: (await saved()).quad.inputs.a.shape.spin,
    marked: await run(`${q('[data-pane="input:a"] .qv-more')}.classList.contains('qv-set')`) };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);
  const closed = await run(`!${q('[data-pane="input:a"] .qv-pop')}.matches(':popover-open')`);
  check('A\'s More popover opens whole and on top, its spin is A\'s, and Escape closes it',
    popA.open && popA.onTop && popA.left >= 0 && popA.right <= popA.width && popA.top >= 0 && popA.bottom <= popA.height &&
    spinA.saved === 2 && spinA.quad === 2 && spinA.marked && closed, JSON.stringify({ popA, spinA, closed }));
  await run(`{ const s = [...${q('[data-pane="input:a"] .qv-pop')}.querySelectorAll('select')][1]; s.value = '0'; s.dispatchEvent(new Event('change')); }`);
  await run(`{ const r = [...${q('[data-pane="input:c"] .qv-pop')}.querySelectorAll('input[type=range]')].at(-1);
    r.value = 0.2; r.dispatchEvent(new Event('input')); }`);
  await sleep(200);
  const pulseC = (await saved()).quad.inputs.c.shape.pulse;
  check('C\'s pulse, set in its popover, is C\'s own', pulseC === 0.2, String(pulseC));

  await run(`{ const box = ${q('[data-pane="pair:left"] .qv-line:last-child .qv-check input')}; box.checked = false; box.dispatchEvent(new Event('change')); }`);
  await sleep(200);
  const mixOff = { saved: (await saved()).mixer.enabled, layerB: (await saved()).quad.pairs.left.enabled };
  await run(`{ const box = ${q('[data-pane="pair:left"] .qv-line:last-child .qv-check input')}; box.checked = true; box.dispatchEvent(new Event('change')); }`);
  await sleep(200);
  const mixOn = (await saved()).mixer.enabled;
  check('Left\'s Mix turns its mixing off and on', mixOff.saved === false && mixOff.layerB === false && mixOn === true,
    JSON.stringify({ mixOff, mixOn }));

  const units = await run(`[...${q('[data-pane="all"] select')}.parentElement.parentElement.querySelectorAll('select')][1].options.length`);
  await run(`{ const s = [...${q('[data-pane="all"] .qv-row')}.querySelectorAll('select')][1]; s.value = 'bar'; s.dispatchEvent(new Event('change')); }`);
  await sleep(200);
  const tap = { saved: (await saved()).tempo.tap,
    detectHidden: await run(`[...${q('[data-pane="all"]')}.querySelectorAll('button')].find((b) => b.textContent === 'Detect').hidden`) };
  check('the tap unit is saved, and Detect hides while the tempo follows the audio',
    units > 1 && tap.saved === 'bar' && tap.detectHidden, JSON.stringify(tap));
  // The tab: one Mixer, where the one-pair Mixer view was (Anjin,
  // 2026-10-20), and a saved "mixer" view opens it.
  const tabs = await run(`[...document.querySelectorAll('[data-view-button]')].map((b) => b.textContent).join('|')`);
  check('one Mixer tab, after Patterns', tabs === 'Patterns|Mixer|Playlist|Setup|Monitor' &&
    !(await run(`!!document.querySelector('[data-view="mixer"]')`)), tabs);

  // Reset to default on every input, each pair and the main (Anjin,
  // 2026-10-20: "make sure reset to default works for all channels and
  // master"), with everything their panes can change moved off its default
  // first, the More… popover's settings included.
  const plain = (input) => JSON.stringify({ brightness: input.brightness, gamma: input.gamma, hue: input.hue,
    params: input.params, shape: input.shape });
  const defaults = plain(INPUT_DEFAULTS);
  const resets = {};
  // One Reset per channel, at the top (Anjin, 2026-10-20: "Only one
  // button is needed, I like it at the top better"); D on a pattern with no
  // Pattern settings. The tags under the name show every modifier, then
  // "unmodified".
  const tagTexts = (pane) => run(`[...${q(`${pane} .qv-tags`)}.children].map((t) => t.textContent).join(' ')`);
  for (const [id, pattern] of [['a', 'plasma'], ['b', 'tunnel'], ['c', 'plasma'], ['d', 'aurora-radar']]) {
    const pane = `[data-pane="input:${id}"]`;
    await set(`${pane} select`, pattern, 'change');
    await sleep(300);
    await run(`{ const p = ${q(pane)};
      const fire = (c, v, type) => { if (c.type === 'checkbox') c.checked = v; else c.value = v; c.dispatchEvent(new Event(type)); };
      const [brightness, gamma] = p.querySelectorAll('.qv-row input[type=range]');
      fire(brightness, 0.5, 'input'); fire(gamma, 2, 'input');
      fire(p.querySelector('.qv-follow input'), false, 'change');
      fire(p.querySelectorAll('.qv-row input[type=range]')[2], 0.3, 'input');
      fire(p.querySelectorAll('.qv-shape-row select')[1], 'inside-out', 'change');
      fire(p.querySelectorAll('.qv-shape-row select')[2], 'centre', 'change');
      const pop = p.querySelector('.qv-pop');
      fire(pop.querySelectorAll('select')[1], '2', 'change');
      const [, , edge, pulse] = pop.querySelectorAll('input[type=range]');
      fire(edge, 0.2, 'input'); fire(pulse, 0.25, 'input');
      const r = p.querySelector('.qv-params input[type=range]'); if (r) fire(r, r.max, 'input'); }`);
    await sleep(300);
    const before = (await saved()).quad.inputs[id];
    const buttons = await run(`[...${q(pane)}.querySelectorAll('button')].map((b) => b.textContent).filter((t) => /^Reset/.test(t))`);
    const tagsBefore = await tagTexts(pane);
    await clickText(`input:${id}`, `Reset ${id.toUpperCase()}`);
    await sleep(300);
    const after = await saved();
    const input = after.quad.inputs[id];
    resets[id] = { buttons: buttons.join('|'), tagsBefore,
      // As channelTags makes them from what was saved (settings saved are only those changed).
      tagsExpected: channelTags(before, null).map((tag) => tag.text).join(' '), tagsAfter: await tagTexts(pane), hadParams: Object.keys(before.params).length,
      changed: plain(before) !== defaults, reset: plain(input) === defaults, pattern: input.patternId,
      marked: await run(`${q(`${pane} .qv-more`)}.classList.contains('qv-set')`),
      // A and B's shapes and settings also live in the one-pair settings.
      ...(id === 'a' || id === 'b' ? { onePair: JSON.stringify(after.shapes[id]) === JSON.stringify(INPUT_DEFAULTS.shape) &&
        !after.patternParams[pattern] } : {}) };
  }
  check('one Reset per channel, at the top, bringing it back to just its pattern; the tags show each modifier, then "unmodified"',
    Object.entries(resets).every(([id, r]) => r.buttons === `Reset ${id.toUpperCase()}` &&
      r.tagsBefore === r.tagsExpected && /^(⚙1 )?bent out centre .* soft ↻2.* ♥25%.* ☀50% γ2\.00 hue 108°$/.test(r.tagsBefore) &&
      r.tagsAfter === 'unmodified' &&
      r.changed && r.reset && !r.marked && r.hadParams === (id === 'd' ? 0 : 1) &&
      r.pattern === { a: 'plasma', b: 'tunnel', c: 'plasma', d: 'aurora-radar' }[id] && r.onePair !== false), JSON.stringify(resets));
  const pairResets = {};
  for (const id of ['left', 'right']) {
    const pane = `[data-pane="pair:${id}"]`;
    await set(`${pane} select`, 'add', 'change');
    await set(`${pane} input[type=range]`, 0.7, 'input');
    await sleep(200);
    const before = (await saved()).quad.pairs[id];
    await clickText(`pair:${id}`, 'Reset');
    await sleep(300);
    const after = await saved();
    pairResets[id] = { before, after: after.quad.pairs[id],
      ...(id === 'left' ? { onePair: { enabled: after.mixer.enabled, mode: after.mixer.mode, amount: after.mixer.amount } } : {}) };
  }
  check('each pair\'s Reset brings back its first input alone with a plain crossfade',
    Object.values(pairResets).every((r) => r.before.mode === 'add' && JSON.stringify(r.after) === JSON.stringify(PAIR_DEFAULTS)) &&
    JSON.stringify(pairResets.left.onePair) === JSON.stringify(PAIR_DEFAULTS), JSON.stringify(pairResets));
  // The main: a look saved as the default, everything changed, Reset main.
  await set('[data-pane="input:a"] select', 'cells', 'change');
  await set('[data-pane="pair:right"] input[type=range]', 0.4, 'input');
  await set('[data-pane="master"] .qv-master-fader input[type=range]', 0, 'input');
  await clickText('master', 'Save as default');
  await sleep(300);
  const look = (await saved()).defaultLook;
  await run(`{ const fire = (c, v, type) => { if (c.type === 'checkbox') c.checked = v; else c.value = v; c.dispatchEvent(new Event(type)); };
    for (const id of ['a', 'b', 'c', 'd']) {
      const p = ${q('')}.querySelector('[data-pane="input:' + id + '"]');
      fire(p.querySelectorAll('.qv-row input[type=range]')[0], 0.4, 'input');
      fire(p.querySelectorAll('.qv-shape-row select')[2], 'outer', 'change');
      fire(p.querySelector('.qv-pop').querySelectorAll('select')[1], '-4', 'change');
      fire(p.querySelector('.qv-pop').querySelectorAll('input[type=range]')[3], 0.3, 'input');
    }
    for (const id of ['left', 'right']) {
      const p = ${q('')}.querySelector('[data-pane="pair:' + id + '"]');
      fire(p.querySelector('select'), 'screen', 'change'); fire(p.querySelector('input[type=range]'), 0.9, 'input');
    }
    const m = ${q('')}.querySelector('[data-pane="master"]');
    fire(m.querySelector('input[type=range]'), 0.6, 'input');
    const [blend, time] = m.querySelectorAll('select'); fire(blend, 'add', 'change'); fire(time, '4', 'change');
    const h = document.getElementById('hue'); h.value = '0.25'; h.dispatchEvent(new Event('input')); }`);
  await set('[data-pane="input:c"] select', 'stars', 'change');
  await sleep(300);
  const changedLook = (await saved()).quad;
  await clickText('master', 'Reset main');
  await sleep(500);
  const restored = await saved();
  const lookPart = (q) => JSON.stringify({ inputs: q.inputs, pairs: q.pairs, master: q.master });
  check('Reset main brings back the saved default: every input, both pairs and the main, shared settings included',
    lookPart(changedLook) !== lookPart(look) && lookPart(restored.quad) === lookPart(look) &&
    restored.hue === look.shared.hue && restored.patternId === 'cells',
    `differs before ${lookPart(changedLook) !== lookPart(look)}; ${lookPart(restored.quad) === lookPart(look) ? 'same after' :
      `after ${lookPart(restored.quad)} against ${lookPart(look)}`}; hue ${restored.hue} against ${look.shared.hue}`);

  // Sparkles in one place, the final mix out: the Main pane (Anjin,
  // 2026-10-20: "so we have one place for sparkles, final mix out"). Its
  // button opens their settings, the on/off first, and says which.
  await click('[data-pane="master"] .qv-main-buttons .qv-more');
  await sleep(300);
  const toggle = (on) => run(`{ const box = document.getElementById('sparkle-enabled'); box.checked = ${on}; box.dispatchEvent(new Event('change')); }`);
  await toggle(true);
  await sleep(400);
  const sparkles = await run(`(() => { const pop = ${q('[data-pane="master"] .qv-pop')};
    return { saved: JSON.parse(localStorage.getItem('matrix-companion-settings')).sparkles.enabled,
      lit: ${q('[data-pane="master"] .qv-main-buttons .qv-more')}.classList.contains('qv-set'),
      rows: [...${q('[data-pane="master"] .qv-main-buttons')}.children].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent, Math.round(r.top), Math.round(r.height)]; }),
      open: pop.matches(':popover-open'), settings: pop.querySelectorAll('input[type=range], select').length,
      onOffInPopover: pop.contains(document.getElementById('sparkle-enabled')),
      allInputs: /Sparkles/.test(${q('[data-pane="all"]')}.textContent),
      patternsView: !!document.querySelector('[data-view="patterns"] [id^="sparkle-"]') }; })()`);
  // An info pane for each setting (Anjin, 2026-10-20: "perhaps pop up
  // info panes detailing"): Twinkle's, hovered inside the popover, whole and
  // on top.
  sparkles.infoPanes = await run(`${q('[data-pane="master"] .qv-pop')}.querySelectorAll('.help').length`);
  const twinkleAt = await run(`(() => { const r = document.getElementById('sparkle-twinkle').closest('label')
    .querySelector('.help-button').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: twinkleAt.x, y: twinkleAt.y });
  await sleep(200);
  sparkles.twinkleInfo = await run(`(() => { const pop = document.getElementById(document.getElementById('sparkle-twinkle')
    .closest('label').querySelector('.help-button').getAttribute('aria-describedby'));
    const r = pop.getBoundingClientRect();
    const corners = [[r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3]];
    return { shown: getComputedStyle(pop).display !== 'none', inWindow: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
      onTop: corners.every(([x, y]) => pop.contains(document.elementFromPoint(x, y))), text: pop.textContent.slice(0, 40) }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await toggle(false);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
  sparkles.off = { saved: JSON.parse(await run(`localStorage.getItem('matrix-companion-settings')`)).sparkles.enabled,
    lit: await run(`${q('[data-pane="master"] .qv-main-buttons .qv-more')}.classList.contains('qv-set')`) };
  check('sparkles are in one place, the Main: its button, on the row with Fade, Swap and Blackout, is lit while they are on and opens their settings, each with its info pane',
    sparkles.saved === true && sparkles.lit && new Set(sparkles.rows.map((r) => r[1])).size === 1 && sparkles.off.saved === false && !sparkles.off.lit &&
    sparkles.open && sparkles.settings === 7 && sparkles.onOffInPopover && !sparkles.allInputs && !sparkles.patternsView &&
    sparkles.infoPanes === 8 && sparkles.twinkleInfo.shown && sparkles.twinkleInfo.inWindow && sparkles.twinkleInfo.onTop,
    JSON.stringify(sparkles));

  const errors = await run(`document.getElementById('error').textContent`);
  check('no error shown', !errors, errors);

  // Opened straight onto the Mixer from saved settings of before (a saved
  // "mixer" view, randomizer settings without their items), start-up must
  // finish: the Mixer was once built before those settings were loaded, and
  // stopped it (found in a screenshot, 2026-10-20).
  await run(`localStorage.setItem('matrix-companion-settings', JSON.stringify({ host: '192.0.2.1', width: 64, height: 32,
    audioSource: 'simulated', patternId: 'plasma', view: 'mixer', randomizer: { enabled: true } }))`);
  await send('Page.reload');
  await sleep(3000);
  const startup = await run(`({ mixer: document.body.classList.contains('quad-mode'),
    tab: document.querySelector('[data-view-button][aria-pressed="true"]')?.textContent,
    connection: document.getElementById('connection').textContent,
    stream: document.querySelector('#quad-view [data-pane="output"] .qv-primary')?.textContent,
    error: document.getElementById('error').textContent })`);
  check('opened straight onto the Mixer from older saved settings, start-up finishes', startup.mixer && startup.tab === 'Mixer' &&
    startup.connection === 'server: connected' && startup.stream === 'Start streaming' && !startup.error, JSON.stringify(startup));
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
