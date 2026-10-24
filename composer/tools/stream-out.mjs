// Sends the composer's recording on, enlarged, to a file or a live stream
// such as YouTube. Start this, then press Record in the composer: the tool
// follows the recording as the composer's server writes it to disk
// (lib/recording.js), has FFmpeg enlarge it and sends picture and audio on.
// Stop in the composer ends the stream.
//
// Usage: node tools/stream-out.mjs --size 1280x720 --to youtube
//        node tools/stream-out.mjs --size 1920x1080 --to rtmp://host/app/key
//        node tools/stream-out.mjs --size 1280x720 --to out.mp4   (saved in the
//   recording's own folder, beside its preview.mp4; a path with a folder in
//   it is used as written)
// Options: --dir <record folder> (default ~/Movies/MatrixPrism), --fps 30,
//   --kbps <video bitrate; a stream always has one, a file
//   keeps constant quality, which can reach 13 Mbit/s at 1280x720, unless given>, --smooth (smooth enlarging; the default keeps the
//   panel's pixels square and sharp), --wait <seconds to wait for Record>.
// The key for --to youtube is read from YOUTUBE_STREAM_KEY and never printed
// or saved. FFmpeg's command line holds it while the stream runs, so it is
// visible to other users of this computer in a process list.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ffmpegArgs, findSession, followRecording, parseSize, redact, streamTarget } from '../lib/stream-out.js';

const { values: options } = parseArgs({ options: {
  size: { type: 'string' }, to: { type: 'string' }, dir: { type: 'string' }, fps: { type: 'string', default: '30' },
  kbps: { type: 'string' }, smooth: { type: 'boolean', default: false }, wait: { type: 'string', default: '600' },
} });

let size, target;
try {
  size = parseSize(options.size);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const directory = path.resolve(options.dir ?? path.join(os.homedir(), 'Movies', 'MatrixPrism'));
try {
  target = streamTarget(options.to, process.env, directory);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const started = Date.now();
const destination = target.kind === 'rtmp' ? 'the live stream' : target.path;
console.log(`Waiting for Record in the composer (up to ${options.wait} s); sending ${size.width}x${size.height} to ${destination}`);

let session = null;
while (!session && Date.now() - started < Number(options.wait) * 1000) {
  session = await findSession(directory, started - 2000);
  if (!session) await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!session) {
  console.error('Record was not pressed in time');
  process.exit(1);
}
// A file with a bare name is saved in the recording's own folder, beside its preview.mp4.
target = streamTarget(options.to, process.env, session);
console.log(`Recording found; starting FFmpeg${target.kind === 'file' ? `, saving ${target.path}` : ''}`);

const ffmpeg = spawn('ffmpeg', ffmpegArgs({ ...size, fps: Number(options.fps),
  kbps: options.kbps ? Number(options.kbps) : undefined, smooth: options.smooth, target }),
{ stdio: ['pipe', 'ignore', 'pipe'] });
ffmpeg.stderr.on('data', (data) => process.stderr.write(redact(data, target.secret)));
const exited = new Promise((resolve) => {
  ffmpeg.once('close', resolve);
  ffmpeg.once('error', (error) => { console.error(`Cannot start FFmpeg: ${error.message}`); resolve(1); });
});
ffmpeg.stdin.on('error', () => {});

const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abort.abort());
for await (const chunk of followRecording(session, { signal: abort.signal })) {
  if (!ffmpeg.stdin.write(chunk)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
}
ffmpeg.stdin.end();
const code = await exited;
console.log(code === 0 ? 'Finished' : `FFmpeg exited ${code}`);
process.exit(code === 0 ? 0 : 1);
