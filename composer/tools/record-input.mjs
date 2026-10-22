// Records an audio input (by part of its name, e.g. BlackHole) through
// Chrome's Web Audio, every sample, into a WAV, for measuring what is
// played (tempo-stability.mjs --file, fold-clarity.mjs --file): ffmpeg's
// avfoundation capture on macOS was found to drop about 12% of the audio,
// which makes every tempo read about 13% fast
// (docs/findings.md, "Recording a live input"). Keep recordings out of the
// repository. Runs headless Chrome with the real devices (permission granted
// automatically) and a capture worklet that sends each block to a local server.
// Usage: node record-input.mjs <device name part> <seconds> <out.wav>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const [namePart, secondsArg, out] = process.argv.slice(2);
const seconds = Number(secondsArg);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chunks = [];
let rate = 0, channels = 2, done;
const finished = new Promise((resolve) => { done = resolve; });
const WORKLET = `class Tap extends AudioWorkletProcessor {
  process(inputs) { const input = inputs[0]; if (input?.length) this.port.postMessage(input.map((c) => c.slice(0))); return true; }
}
registerProcessor('tap', Tap);`;
const PAGE = `<!doctype html><script type="module">
const post = (path, body) => fetch(path, { method: 'POST', body });
try {
  let stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const device = devices.find((d) => d.label.toLowerCase().includes(${JSON.stringify(namePart.toLowerCase())}));
  if (!device) throw new Error('no input named like ${namePart}: ' + devices.map((d) => d.label).join(', '));
  stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: device.deviceId }, echoCancellation: false,
    noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } } });
  const context = new AudioContext({ latencyHint: 'playback' });
  await context.audioWorklet.addModule('/worklet.js');
  const source = context.createMediaStreamSource(stream), tap = new AudioWorkletNode(context, 'tap');
  const sink = context.createGain(); sink.gain.value = 0;
  source.connect(tap); tap.connect(sink); sink.connect(context.destination);
  await context.resume();
  await post('/start', JSON.stringify({ rate: context.sampleRate, label: device.label, channels: source.channelCount }));
  let batch = [], frames = 0;
  tap.port.onmessage = ({ data }) => {
    batch.push(data); frames += data[0].length;
    if (batch.length >= 64) {
      const ch = Math.min(2, batch[0].length), n = batch.reduce((s, b) => s + b[0].length, 0), buf = new Float32Array(n * ch);
      let k = 0; for (const b of batch) for (let i = 0; i < b[0].length; ++i) for (let c = 0; c < ch; ++c) buf[k++] = b[Math.min(c, b.length - 1)][i];
      post('/chunk', buf.buffer); batch = [];
    }
  };
} catch (error) { post('/error', String(error.stack || error)); }
</script>`;
const server = http.createServer((request, response) => {
  const url = request.url;
  if (request.method === 'GET') {
    if (url === '/worklet.js') response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(WORKLET);
    else response.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE);
    return;
  }
  const parts = [];
  request.on('data', (p) => parts.push(p));
  request.on('end', () => {
    const body = Buffer.concat(parts);
    response.writeHead(200).end();
    if (url === '/start') {
      const info = JSON.parse(body); rate = info.rate;
      console.error(`recording ${info.label} at ${rate} Hz for ${seconds} s`);
      setTimeout(() => done(), seconds * 1000);
    } else if (url === '/chunk') chunks.push(Buffer.from(body));
    else if (url === '/error') { console.error(String(body)); done(); }
  });
});
server.listen(0, '127.0.0.1', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'record-input-'));
  const chrome = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required', `http://127.0.0.1:${server.address().port}/`], { stdio: 'ignore' });
  await finished;
  chrome.kill();
  server.close();
  const pcm = Buffer.concat(chunks), floats = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
  const data = Buffer.alloc(floats.length * 2);
  floats.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  if (rate) fs.writeFileSync(out, Buffer.concat([header, data]));
  console.error(`${rate ? (floats.length / channels / rate).toFixed(2) : 0} s of audio written`);
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 300);
});
