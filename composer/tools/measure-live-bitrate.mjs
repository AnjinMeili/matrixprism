#!/usr/bin/env node
// A measurement for Go live's size and bitrate (#1, #6): what the live encoder
// actually sends, not what it is asked for. A synthetic panel-sized picture
// (256×192 by default) goes through the real ffmpegArgs (lib/stream-out.js) to a
// local RTMP receiver (FFmpeg listening, as tools/check-live.mjs does); ffprobe
// then reads what arrived: the picture's size and shape, and the video bitrate
// in each second. Two pictures: "sparse", a few moving cells on black like a
// typical look, and "busy", FFmpeg's test pattern. Nothing goes to YouTube.
// Usage: node tools/measure-live-bitrate.mjs [--sizes 640x360,1280x720]
//        [--source 256x192] [--seconds 12] [--keep <folder>]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultBitrate, ffmpegArgs, parseSize } from '../lib/stream-out.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const sizes = arg('sizes', '640x360,854x480,1280x720,1920x1080').split(',').map(parseSize);
const source = parseSize(arg('source', '256x192'));
const seconds = Number(arg('seconds', '12'));
const folder = arg('keep', null) ?? fs.mkdtempSync(path.join(os.tmpdir(), 'live-rate-'));
fs.mkdirSync(folder, { recursive: true });
const PORT = 19353;
const pictures = {
  sparse: `life=size=${source.width}x${source.height}:rate=30:ratio=0.04:seed=7:mold=20:life_color=#ff8000:death_color=#000000`,
  busy: `testsrc2=size=${source.width}x${source.height}:rate=30`,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (command, args, log) => new Promise((resolve) => {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', fs.openSync(log, 'w')] });
  child.on('close', (code) => resolve(code));
  return child;
});

const rows = [];
for (const size of sizes) for (const [name, filter] of Object.entries(pictures)) {
  const tag = `${size.width}x${size.height}-${name}`;
  const received = path.join(folder, `${tag}.flv`);
  const receiver = spawn('ffmpeg', ['-hide_banner', '-y', '-f', 'flv', '-listen', '1',
    '-i', `rtmp://127.0.0.1:${PORT}/live/test`, '-c', 'copy', received], { stdio: ['ignore', 'ignore', fs.openSync(path.join(folder, `${tag}-receiver.log`), 'w')] });
  const receiverDone = new Promise((resolve) => receiver.on('close', resolve));
  await sleep(800);
  // The source, as the page would upload it: a Matroska stream of picture and sound, at real time.
  const feed = spawn('ffmpeg', ['-hide_banner', '-re', '-f', 'lavfi', '-i', filter, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(seconds), '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-f', 'matroska', 'pipe:1'],
    { stdio: ['ignore', 'pipe', fs.openSync(path.join(folder, `${tag}-feed.log`), 'w')] });
  const args = ffmpegArgs({ width: size.width, height: size.height, target: { kind: 'rtmp', url: `rtmp://127.0.0.1:${PORT}/live/test` } });
  fs.writeFileSync(path.join(folder, `${tag}-encoder-args.txt`), `ffmpeg ${args.join(' ')}\n`);
  const encoder = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', fs.openSync(path.join(folder, `${tag}-encoder.log`), 'w')] });
  feed.stdout.pipe(encoder.stdin);
  await new Promise((resolve) => encoder.on('close', resolve));
  await Promise.race([receiverDone, sleep(5000)]);
  receiver.kill('SIGKILL');

  const probe = (entries, extra = []) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', ...extra,
    '-show_entries', entries, '-of', 'json', received], { encoding: 'utf8' }).stdout || '{}');
  const stream = probe('stream=width,height,sample_aspect_ratio,display_aspect_ratio').streams?.[0] ?? {};
  const packets = probe('packet=pts_time,size', ['-show_packets']).packets ?? [];
  const perSecond = new Map();
  for (const p of packets) {
    const s = Math.floor(Number(p.pts_time));
    perSecond.set(s, (perSecond.get(s) ?? 0) + Number(p.size) * 8 / 1000);
  }
  // Leave out the first and last seconds, which are part-filled.
  const kbps = [...perSecond.entries()].sort((a, b) => a[0] - b[0]).slice(1, -1).map(([, v]) => Math.round(v));
  const mean = kbps.length ? Math.round(kbps.reduce((a, b) => a + b, 0) / kbps.length) : null;
  rows.push({ size: `${size.width}×${size.height}`, picture: name, askedKbps: defaultBitrate(size.width, size.height),
    receivedSize: stream.width ? `${stream.width}×${stream.height}` : 'none', dar: stream.display_aspect_ratio ?? '-',
    meanKbps: mean, minKbps: kbps.length ? Math.min(...kbps) : null, maxKbps: kbps.length ? Math.max(...kbps) : null, seconds: kbps.length });
}

const lines = ['| Size asked | Picture | Asked (kbps) | Received | Shape | Mean (kbps) | Min | Max | Seconds |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.size} | ${r.picture} | ${r.askedKbps} | ${r.receivedSize} | ${r.dar} | ${r.meanKbps} | ${r.minKbps} | ${r.maxKbps} | ${r.seconds} |`)];
const report = `Source ${source.width}×${source.height} (shape ${source.width / source.height === 4 / 3 ? '4:3' : `${source.width}:${source.height}`}), ${seconds} s each, video only, first and last second left out.\n\n${lines.join('\n')}\n`;
fs.writeFileSync(path.join(folder, 'report.md'), report);
console.log(report);
console.log(`Files: ${folder}`);
