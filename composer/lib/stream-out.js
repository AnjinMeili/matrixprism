// Helpers for tools/stream-out.mjs: follow the recording the composer is
// writing to disk and send it on, enlarged, to a file or an RTMP stream such
// as YouTube's. Pure functions and a file follower; nothing here talks to
// the network.
import fs from 'node:fs';
import path from 'node:path';

export const YOUTUBE_INGEST = 'rtmp://a.rtmp.youtube.com/live2';
export const PARTIAL_NAME = 'capture.webm.partial';

export function parseSize(text) {
  const match = /^(\d{1,4})x(\d{1,4})$/.exec(String(text ?? ''));
  const width = Number(match?.[1]), height = Number(match?.[2]);
  if (!match || width < 2 || height < 2 || width > 4096 || height > 4096 || width % 2 || height % 2)
    throw new Error('Size must be WIDTHxHEIGHT, both even and at most 4096, such as 1280x720');
  return { width, height };
}

// 'youtube' uses the key from the environment; an rtmp(s):// URL is used as
// given; anything else is an output file, .mp4 or .mkv, which goes in `dir`
// (the recording's own folder) unless it is written with a folder of its own.
export function streamTarget(to, env = {}, dir = '.') {
  if (to === 'youtube') {
    const key = env.YOUTUBE_STREAM_KEY;
    if (!key) throw new Error('Set YOUTUBE_STREAM_KEY to the stream key from YouTube Studio');
    return { kind: 'rtmp', url: `${YOUTUBE_INGEST}/${key}`, secret: key };
  }
  if (/^rtmps?:\/\//.test(to ?? '')) return { kind: 'rtmp', url: to, secret: new URL(to).pathname.split('/').pop() };
  if (/\.(mp4|mkv)$/i.test(to ?? '')) return { kind: 'file', path: path.basename(to) === to ? path.join(dir, to) : path.resolve(to) };
  throw new Error('--to must be youtube, an rtmp:// or rtmps:// URL, or a .mp4 or .mkv file');
}

// The stream key must never reach a log or the screen.
export function redact(text, secret) {
  return secret ? String(text).split(secret).join('<key>') : String(text);
}

export function defaultBitrate(width, height) {
  return Math.max(1500, Math.min(12000, Math.round(width * height * 4.5 / 1000)));
}

// A stream always has a fixed bitrate; a file keeps constant quality (CRF 18,
// whose size follows the picture) unless `kbps` is given.
export function ffmpegArgs({ width, height, fps = 30, kbps, smooth = false, target }) {
  const live = target.kind === 'rtmp';
  const rate = kbps ?? (live ? defaultBitrate(width, height) : null);
  return ['-hide_banner', '-f', 'matroska', '-i', 'pipe:0', '-map', '0:v:0', '-map', '0:a:0',
    '-vf', `fps=${fps},scale=${width}:${height}:flags=${smooth ? 'bicubic' : 'neighbor'},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', ...(live ? ['-tune', 'zerolatency'] : []),
    ...(rate ? ['-b:v', `${rate}k`, '-maxrate', `${rate}k`, '-bufsize', `${rate * 2}k`] : ['-crf', '18']),
    '-g', String(fps * 2), '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    ...(live ? ['-f', 'flv', target.url] : ['-n', '-movflags', '+faststart', target.path])];
}

// The newest recording folder that has begun since `since` (ms), or null.
export async function findSession(directory, since) {
  let best = null;
  for (const name of await fs.promises.readdir(directory).catch(() => [])) {
    if (!name.startsWith('preview-')) continue;
    const stat = await fs.promises.stat(path.join(directory, name, PARTIAL_NAME)).catch(() => null);
    if (stat && stat.birthtimeMs >= since && (!best || stat.birthtimeMs > best.time))
      best = { dir: path.join(directory, name), time: stat.birthtimeMs };
  }
  return best?.dir ?? null;
}

// Yields the recording's bytes as the server writes them. Ends when the
// server renames the partial file (Stop) and the rest has been read, or when
// nothing has arrived for `idleMs` (the server cancels a silent session
// after 45 s).
export async function* followRecording(dir, { pollMs = 100, idleMs = 60000, signal } = {}) {
  const partial = path.join(dir, PARTIAL_NAME);
  const handle = await fs.promises.open(partial, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  let last = Date.now();
  try {
    while (!signal?.aborted) {
      const gone = !fs.existsSync(partial);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead) {
        last = Date.now();
        yield Buffer.from(buffer.subarray(0, bytesRead));
        continue;
      }
      if (gone || Date.now() - last > idleMs) return;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    await handle.close();
  }
}
