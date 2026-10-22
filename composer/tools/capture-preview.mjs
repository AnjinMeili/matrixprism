import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPagePosted } from './headless.mjs';

const root = path.resolve(process.argv[2] || path.join(os.homedir(), 'Movies', 'MatrixPrism'));
fs.mkdirSync(root, { recursive: true });
const output = fs.mkdtempSync(path.join(root, 'blackhole-preview-'));
const commands = [];
function execute(label, executable, args) {
  commands.push({ label, executable, args });
  fs.writeFileSync(path.join(output, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
  const result = spawnSync(executable, args, {
    encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(output, `${label}.log`), `${result.stdout || ''}${result.stderr || ''}`);
  if (result.error || result.status !== 0)
    throw new Error(`${label} failed: ${result.error?.message || `see ${output}`}`);
  return result.stdout;
}

try {
  console.log(`Capturing BlackHole for 15 seconds; output: ${output}`);
  const text = await runPagePosted('capture-preview.html', {
    query: 'seconds=15', timeoutMs: 60000,
    flags: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  if (text.startsWith('FAIL')) throw new Error(text);
  const { data, ...metadata } = JSON.parse(text);
  const source = path.join(output, 'captured-preview.webm');
  fs.writeFileSync(source, Buffer.from(data, 'base64'), { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify(metadata, null, 2) + '\n');
  const target = path.join(output, 'blackhole-preview.mp4');
  execute('encode', 'ffmpeg', [
    '-hide_banner', '-nostdin', '-n', '-i', source, '-map', '0:v:0', '-map', '0:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', target,
  ]);
  const probe = JSON.parse(execute('probe', 'ffprobe', [
    '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', target,
  ]));
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  if (video?.width !== metadata.width || video?.height !== metadata.height ||
      Number(video.nb_read_frames) < 30 || audio?.codec_name !== 'aac' ||
      Number(probe.format.duration) < 14 || Number(probe.format.duration) > 17)
    throw new Error('Unexpected encoded dimensions, duration or missing audio/video');
  fs.writeFileSync(path.join(output, 'probe.json'), JSON.stringify(probe, null, 2) + '\n');
  execute('contact-sheet', 'ffmpeg', [
    '-hide_banner', '-nostdin', '-n', '-i', target,
    '-vf', 'fps=1/4,scale=768:576:flags=neighbor,tile=2x2', '-frames:v', '1',
    '-update', '1', path.join(output, 'contact-sheet.png'),
  ]);
  execute('audio-level', 'ffmpeg', [
    '-hide_banner', '-nostdin', '-i', target, '-vn', '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  console.log(`Saved ${target}`);
  console.log(`${metadata.input}; ${metadata.width}x${metadata.height}; ${probe.format.duration} s; ${fs.statSync(target).size} bytes`);
  console.log(`Lit share ${metadata.litShare.toFixed(3)}; ${metadata.changedFrames} changed frames; peak input level ${metadata.peakLevel.toFixed(3)}`);
  console.log('Standalone sample composition; no DDP sent and no running mixer settings changed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}