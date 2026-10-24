import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from '../lib/vendor/ws/wrapper.mjs';
import { CHROME } from './headless.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mediaRoot = path.join(os.homedir(), 'Movies', 'MatrixPrism');
fs.mkdirSync(mediaRoot, { recursive: true });
const media = fs.mkdtempSync(path.join(mediaRoot, 'recording-check-'));
// Logs, probes and screenshots go beside the media, outside the repository,
// unless `--evidence <dir>` names a report's folder to keep them in.
const evidenceArg = process.argv.indexOf('--evidence');
const evidence = evidenceArg > 0 ? path.resolve(process.argv[evidenceArg + 1]) : path.join(media, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-browser-'));
const checks = [], commands = [];
let chrome, server, socket;
const check = (name, ok, details) => {
  checks.push({ name, ok: !!ok, details });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${details ? `: ${JSON.stringify(details)}` : ''}`);
  if (!ok) throw new Error(name);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function command(label, executable, args, binary = false) {
  commands.push({ label, executable, args });
  const result = spawnSync(executable, args, { encoding: binary ? null : 'utf8',
    timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(path.join(evidence, `${label}.log`), result.stderr || '');
  if (result.error || result.status !== 0) throw new Error(`${label} failed: ${result.error?.message || result.stderr}`);
  return result.stdout;
}

try {
  if (!CHROME) throw new Error('Chrome is required');
  const wav = path.join(media, 'fake-input.wav');
  command('fake-input', 'ffmpeg', ['-hide_banner', '-nostdin', '-n', '-f', 'lavfi', '-i',
    "aevalsrc='0.4*sin(2*PI*80*t)*exp(-14*mod(t,0.5))':s=48000:d=8", '-c:a', 'pcm_s16le', wav]);
  server = spawn(process.execPath, ['server.js', '--port', '0', '--record-dir', media],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const origin = await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (data) => {
      output += data;
      const match = output.match(/http:\/\/[^\s/]+:\d+/);
      if (match) resolve(match[0]);
    });
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`Server exited ${code}`)));
  });
  chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1440,900', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
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
    if (reply.result?.exceptionDetails)
      throw new Error(reply.result.exceptionDetails.exception?.description || expression);
    return reply.result?.result?.value;
  };
  const state = () => run("document.querySelector('.recording-bar').dataset.state || 'idle'");
  async function waitState(expected) {
    for (let attempt = 0; attempt < 120; ++attempt) {
      const value = await state();
      if (value === expected) return;
      if (value === 'error') throw new Error(await run("document.getElementById('recording-status').textContent"));
      await delay(250);
    }
    throw new Error(`Timed out waiting for ${expected}`);
  }
  const screenshot = async (name, width, height) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(150);
    const reply = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidence, name), Buffer.from(reply.result.data, 'base64'));
  };
  await send('Page.navigate', { url: origin });
  await delay(800);
  await run(`localStorage.setItem('matrix-companion-settings', JSON.stringify({
    host:'', width:255, height:191, audioSource:'simulated', patternId:'plasma', view:'quad',
    brightness:1, fps:30, autoCycle:false, maxFps:1 }))`);
  await send('Page.reload');
  await delay(1000);
  await run("document.getElementById('record').click()");
  await delay(100);
  check('simulated audio cannot produce a falsely successful silent recording', await state() === 'error');
  await run(`(async () => {
    const permission = await navigator.mediaDevices.getUserMedia({audio:true});
    permission.getTracks().forEach(track => track.stop());
    const source = document.getElementById('audio-source');
    source.value = [...source.options].find(option => option.value.startsWith('device:')).value;
    source.dispatchEvent(new Event('change'));
  })()`);
  await delay(1000);
  await run("document.getElementById('record').click()");
  await waitState('recording');
  check('recording starts with DDP stopped and controls lock dimensions/audio', await run(`
    document.getElementById('stream').textContent.includes('Start') &&
    ['width','height','audio-source','receiver-list'].every(id => document.getElementById(id).disabled)`));
  await delay(2500);
  await screenshot('recording-desktop.png', 1440, 900);
  await screenshot('recording-mobile.png', 600, 900);
  check('recording controls fit the mobile viewport', await run(`(() => {
    const bar = document.querySelector('.recording-bar');
    return [...bar.children].filter(element => !element.hidden).every(element => {
      const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= 601;
    }); })()`));
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await run(`document.querySelector('[data-view-button="patterns"]').click();
    [...document.querySelectorAll('#patterns button')].find(button => /tunnel/i.test(button.textContent)).click()`);
  await delay(3000);
  await run("document.getElementById('record').click()");
  await waitState('saved');
  const result = await run(`(async () => {
    const link = document.getElementById('recording-download');
    return fetch(link.href.replace('/file','')).then(response => response.json()); })()`);
  const probe = JSON.parse(command('app-probe', 'ffprobe', ['-v', 'error', '-count_frames', '-show_streams',
    '-show_format', '-of', 'json', result.file]));
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  check('actual app recording saves padded H.264/AAC with audio and many frames',
    video?.width === 256 && video?.height === 192 && audio?.codec_name === 'aac' &&
    Number(video.nb_read_frames) > 60 && Number(probe.format.duration) > 5, { file: result.file, frames: video.nb_read_frames });
  check('saved download is available and size/audio controls unlock', await run(`(async () => {
    const response = await fetch(document.getElementById('recording-download').href);
    return response.ok && (await response.blob()).size > 1000 &&
      !document.getElementById('width').disabled && !document.getElementById('audio-source').disabled; })()`));
  const pixels = command('app-pixels', 'ffmpeg', ['-v', 'error', '-i', result.file,
    '-vf', 'fps=1,scale=32:24', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], true);
  const frameBytes = 32 * 24 * 3;
  const lit = pixels.filter((value) => value > 16).length / pixels.length;
  let delta = 0;
  for (let index = frameBytes; index < pixels.length; ++index)
    delta += Math.abs(pixels[index] - pixels[index - frameBytes]);
  check('decoded composed picture is lit and changing', lit > 0.1 && delta / pixels.length > 2,
    { litShare: lit, meanFrameDelta: delta / pixels.length });
  const levels = command('app-audio', 'ffmpeg', ['-v', 'error', '-i', result.file,
    '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], true);
  let peak = 0;
  for (let offset = 0; offset < levels.length; offset += 4) peak = Math.max(peak, Math.abs(levels.readFloatLE(offset)));
  check('decoded soundtrack is not silent', peak > 0.05, { peak });
  fs.writeFileSync(path.join(evidence, 'app-probe.json'), JSON.stringify(probe, null, 2) + '\n');
  check('recorded frame rate is independent of receiver sending limit', Number(video.nb_read_frames) / Number(probe.format.duration) > 10);

  await run("document.getElementById('recording-encoder').value='hardware'; document.getElementById('record').click()");
  await waitState('recording');
  await delay(1500);
  await run("document.getElementById('record').click()");
  await waitState('saved');
  check('a second recording succeeds using hardware-only VideoToolbox', await run(`(async () => {
    const session = await fetch(document.getElementById('recording-download').href.replace('/file','')).then(response => response.json());
    return session.state === 'saved' && session.encoder === 'hardware'; })()`));

  const marker = await run(`(async () => {
    const { PreviewRecorder } = await import('./recording.js');
    const context = new AudioContext({sampleRate:48000});
    await context.resume();
    const destination = context.createMediaStreamDestination();
    const canvas = document.createElement('canvas');
    canvas.width=64; canvas.height=48;
    document.body.appendChild(canvas);
    const graphics = canvas.getContext('2d');
    const capture = new PreviewRecorder();
    await capture.start(canvas, destination.stream, 'software');
    if (capture.state === 'error') throw new Error('Marker recorder did not start');
    const base = context.currentTime;
    const pulses = [base+1,base+7];
    for (const time of pulses) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value=880; gain.gain.value=0.2;
      oscillator.connect(gain); gain.connect(destination);
      oscillator.start(time); oscillator.stop(time+0.12);
    }
    let stalled=false;
    const draw = () => {
      const time = context.currentTime;
      graphics.fillStyle=pulses.some(pulse => time>=pulse && time<pulse+0.12)?'#ffffff':'#000000';
      graphics.fillRect(0,0,64,48); capture.frame(destination.stream);
      if (!stalled && time-base>4) {
        stalled=true; const until=performance.now()+200;
        while(performance.now()<until) {}
      }
    };
    draw();
    const timer = setInterval(draw,16);
    await new Promise(resolve => setTimeout(resolve,8500));
    clearInterval(timer);
    await capture.stop();
    destination.stream.getTracks().forEach(track => track.stop());
    await context.close(); canvas.remove();
    return { ...capture.session, stalled, state:capture.state };
  })()`);
  check('timestamp marker capture survives a deliberate 200 ms render stall', marker.state === 'saved' && marker.stalled);
  const markerProbe = JSON.parse(command('marker-probe', 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', marker.file]));
  const frameTimes = JSON.parse(command('marker-frames', 'ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', marker.file]))
    .frames.map((frame) => Number(frame.best_effort_timestamp_time));
  const brightness = command('marker-pixels', 'ffmpeg', ['-v', 'error', '-i', marker.file,
    '-map', '0:v:0', '-vf', 'scale=1:1', '-pix_fmt', 'gray', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], true);
  const whiteStarts = [];
  for (let index = 0; index < brightness.length; ++index)
    if (brightness[index] > 128 && (index === 0 || brightness[index - 1] <= 128)) whiteStarts.push(frameTimes[index]);
  const markerAudio = command('marker-audio', 'ffmpeg', ['-v', 'error', '-i', marker.file,
    '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], true);
  const audioStart = Number(markerProbe.streams.find((stream) => stream.codec_type === 'audio').start_time || 0);
  const audioStarts = [];
  let previousLoud = -Infinity;
  for (let offset = 0; offset < markerAudio.length; offset += 4) {
    if (Math.abs(markerAudio.readFloatLE(offset)) < 0.05) continue;
    const time = offset / 4 / 48000 + audioStart;
    if (time - previousLoud > 0.2) audioStarts.push(time);
    previousLoud = time;
  }
  const offsets = whiteStarts.map((time, index) => time - audioStarts[index]);
  const drift = offsets[1] - offsets[0];
  const timing = { file: marker.file, whiteStarts, audioStarts, offsets, drift,
    gapSeconds: Math.max(...frameTimes.slice(1).map((time, index) => time - frameTimes[index])) };
  fs.writeFileSync(path.join(evidence, 'sync-results.json'), JSON.stringify(timing, null, 2) + '\n');
  check('decoded audio/video marker offset and drift stay within one frame plus AAC priming',
    whiteStarts.length === 2 && audioStarts.length === 2 && offsets.every((offset) => Math.abs(offset) <= 0.055) &&
    Math.abs(drift) <= 1/30, timing);
  const lostAudio = await run(`(async () => {
    const { PreviewRecorder } = await import('./recording.js');
    const context = new AudioContext(); await context.resume();
    const destination = context.createMediaStreamDestination();
    const canvas = document.createElement('canvas'); canvas.width=64; canvas.height=48;
    document.body.appendChild(canvas);
    const capture = new PreviewRecorder();
    await capture.start(canvas,destination.stream);
    canvas.getContext('2d').fillRect(0,0,64,48); capture.frame(destination.stream);
    destination.stream.getAudioTracks()[0].stop();
    capture.frame(destination.stream);
    await new Promise(resolve => setTimeout(resolve,100));
    const state=capture.state;
    await context.close(); canvas.remove(); return state;
  })()`);
  check('ended audio causes an error rather than a saved silent recording', lostAudio === 'error');
  console.log(`Media retained outside git: ${media}`);
  console.log(`Evidence: ${evidence}`);
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(evidence, 'browser-results.json'), JSON.stringify({ checks, commands, media }, null, 2) + '\n');
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill();
    await exited;
  }
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}