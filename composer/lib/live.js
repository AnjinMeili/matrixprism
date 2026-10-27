// Live streaming from the composer's page: the page captures the final
// picture and the audio input as it does for a recording (public/recording.js)
// and uploads the chunks; each goes straight into FFmpeg, which enlarges the
// picture and sends it to YouTube over RTMP. Nothing is written to disk.
// The stream key comes from the server's environment (YOUTUBE_STREAM_KEY),
// never from the page; the desktop app may set it with setKey (#8). It is
// removed from anything
// FFmpeg says before it is kept or shown. The destination is fixed on the
// command line, not chosen by the page.
import { ffmpegStartMessage } from './ffmpeg-path.js';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { YOUTUBE_INGEST, ffmpegArgs, parseSize, redact } from './stream-out.js';
import { MAX_RECORDING_CHUNK, localSameOrigin, readBody } from './recording.js';

const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'];
const MAX_SECONDS = 12 * 3600;
const MAX_QUEUED = 16 * 1024 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9._-]{4,100}$/;
const busy = (session) => ['recording', 'finalizing'].includes(session.state);
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

export function liveOptions(input) {
  const { width, height, mimeType, outWidth, outHeight } = input ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 4096 || height > 4096 || width * height > 1024 * 1024 || !MIME_TYPES.includes(mimeType))
    throw failure('Invalid live stream source size or format');
  let out;
  try {
    out = parseSize(`${outWidth}x${outHeight}`);
  } catch (error) {
    throw failure(error.message);
  }
  return { width, height, mimeType, outWidth: out.width, outHeight: out.height };
}

export class LiveService {
  constructor({ key = process.env.YOUTUBE_STREAM_KEY, ingest = YOUTUBE_INGEST, spawnEncoder = spawn,
    hint = 'Set YOUTUBE_STREAM_KEY to go live' } = {}) {
    this.key = KEY_PATTERN.test(key ?? '') ? key : null;
    this.hint = hint;
    // A key kept somewhere that may ask the person before it is read (the
    // desktop app's Keychain, #8): fetched when a stream starts, not before.
    this.unlockKey = null;
    this.ingest = ingest;
    this.spawnEncoder = spawnEncoder;
    this.sessions = new Map();
    this.starting = false;
  }

  get available() {
    return this.key !== null || this.unlockKey !== null;
  }

  // A stored key, read only when it is needed: `unlock` resolves with the key.
  setKeyUnlock(unlock) {
    this.unlockKey = unlock;
  }

  // Sets or, with an empty key, clears the stream key; refused while a stream
  // is running, since its FFmpeg holds the old key and its output is redacted
  // with it. Returns false for a key that is not a stream key's shape.
  setKey(key) {
    if (this.starting || [...this.sessions.values()].some(busy))
      throw failure('Stop the live stream before changing the stream key', 409);
    this.unlockKey = null;
    if (!key) {
      this.key = null;
      return true;
    }
    if (!KEY_PATTERN.test(key)) return false;
    this.key = key;
    return true;
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) throw failure('Live stream not found', 404);
    return session;
  }

  status(session) {
    return { id: session.id, state: session.state, bytes: session.bytes, sequence: session.sequence,
      width: session.width, height: session.height, outWidth: session.outWidth, outHeight: session.outHeight,
      error: session.error ? redact(session.error, this.key) : null };
  }

  arm(session) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => this.cancel(session, 'Live stream input timed out').catch(() => {}), 45000);
    session.timer.unref();
  }

  async start(input) {
    const options = liveOptions(input);
    if (!this.available) throw failure(this.hint, 409);
    if (this.starting || [...this.sessions.values()].some(busy)) throw failure('Another live stream is active', 409);
    this.starting = true;
    try {
      if (this.key === null && this.unlockKey) {
        let key;
        try {
          key = await this.unlockKey();
        } catch (error) {
          throw failure(`The stored stream key could not be unlocked: ${error.message}`, 409);
        }
        if (!KEY_PATTERN.test(key ?? '')) throw failure('The stored stream key could not be read; enter it again beside Go live', 409);
        this.key = key;
        this.unlockKey = null;
      }
      const session = { ...options, id: randomBytes(24).toString('hex'), state: 'recording',
        bytes: 0, sequence: 0, uploading: false, started: Date.now(), stderr: '' };
      const args = ffmpegArgs({ width: options.outWidth, height: options.outHeight,
        target: { kind: 'rtmp', url: `${this.ingest}/${this.key}` } });
      session.child = this.spawnEncoder('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
      session.child.stdin.on('error', () => {});
      session.child.stderr.on('data', (data) => {
        session.stderr = (session.stderr + redact(data, this.key)).slice(-2000);
      });
      session.child.once('error', (error) => this.cancel(session, ffmpegStartMessage(error)).catch(() => {}));
      session.child.once('close', (code) => {
        clearTimeout(session.timer);
        session.child = null;
        if (session.state === 'finalizing' && code === 0) session.state = 'saved';
        else if (busy(session)) {
          const lines = session.stderr.trim().split(/\r?\n|\r/).filter(Boolean);
          session.state = 'error';
          session.error = `FFmpeg ended with ${code}${lines.length ? `: ${lines.at(-1)}` : ''}`;
        }
      });
      this.sessions.set(session.id, session);
      while (this.sessions.size > 8) {
        const oldest = [...this.sessions.values()].find((entry) => !busy(entry));
        if (!oldest) break;
        this.sessions.delete(oldest.id);
      }
      this.arm(session);
      return this.status(session);
    } finally {
      this.starting = false;
    }
  }

  async append(session, sequence, buffer) {
    if (session.state !== 'recording' || session.sequence !== sequence)
      throw failure('Live chunk is out of order or the stream is closed', 409);
    if (!buffer.length || buffer.length > MAX_RECORDING_CHUNK || Date.now() - session.started > MAX_SECONDS * 1000) {
      await this.cancel(session, 'Live stream size or duration limit reached');
      throw failure('Live stream size or duration limit reached', 413);
    }
    if (session.child.stdin.writableLength + buffer.length > MAX_QUEUED) {
      await this.cancel(session, 'The encoder cannot keep up with the live stream');
      throw failure('The encoder cannot keep up with the live stream', 503);
    }
    session.child.stdin.write(buffer);
    session.bytes += buffer.length;
    ++session.sequence;
    this.arm(session);
    return this.status(session);
  }

  async finish(session) {
    if (session.state !== 'recording' || session.uploading) throw failure('The live stream is not ready to end', 409);
    clearTimeout(session.timer);
    session.state = 'finalizing';
    session.child.stdin.end();
    session.timer = setTimeout(() => this.cancel(session, 'The encoder did not finish').catch(() => {}), 30000);
    session.timer.unref();
    return this.status(session);
  }

  async cancel(session, message = 'Live stream cancelled') {
    if (!busy(session)) return;
    session.state = 'error';
    session.error = message;
    clearTimeout(session.timer);
    session.child?.kill('SIGKILL');
  }

  async close() {
    await Promise.all([...this.sessions.values()].map((session) => this.cancel(session, 'Composer server stopped')));
  }
}

export async function liveRequest(service, request, response, url) {
  const json = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  if (!localSameOrigin(request)) {
    json(403, { error: 'Live streaming requires a same-origin page on this computer' });
    return;
  }
  let session;
  try {
    if (url.pathname === '/api/live') {
      if (request.method === 'GET') json(200, service.available ? { available: true } : { available: false, hint: service.hint });
      else if (request.method === 'POST') json(201, await service.start(JSON.parse((await readBody(request, 2048)).toString())));
      else throw failure('Live method is not allowed', 405);
      return;
    }
    const match = url.pathname.match(/^\/api\/live\/([a-f0-9]{48})(?:\/(chunk|finish|cancel))?$/);
    if (!match) throw failure('Live endpoint not found', 404);
    session = service.get(match[1]);
    const action = match[2];
    if (request.method === 'GET' && !action) json(200, service.status(session));
    else if (request.method === 'POST' && action === 'chunk') {
      const sequence = Number(url.searchParams.get('sequence'));
      if (session.state !== 'recording' || session.uploading || !Number.isInteger(sequence) ||
          !url.searchParams.has('sequence') || sequence !== session.sequence)
        throw failure('Live chunk is out of order or busy', 409);
      session.uploading = true;
      try {
        json(200, await service.append(session, sequence, await readBody(request, MAX_RECORDING_CHUNK)));
      } finally {
        session.uploading = false;
      }
    } else if (request.method === 'POST' && action === 'finish') json(202, await service.finish(session));
    else if (request.method === 'POST' && action === 'cancel') {
      await service.cancel(session);
      json(200, service.status(session));
    } else throw failure('Live method or state is not allowed', 405);
  } catch (error) {
    if (session?.state === 'recording' && !error.status) await service.cancel(session, error.message);
    json(error.status ?? (error instanceof SyntaxError ? 400 : 500), { error: redact(error.message, service.key) });
  }
}
