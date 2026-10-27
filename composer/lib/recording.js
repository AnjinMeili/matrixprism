import { ffmpegAvailable, ffmpegStartMessage } from './ffmpeg-path.js';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MAX_RECORDING_CHUNK = 8 * 1024 * 1024;
const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_SECONDS = 3600;
const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'];
const busy = (session) => ['recording', 'finalizing'].includes(session.state);
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

export function recordingOptions(input) {
  const { width, height, mimeType, encoder = 'software' } = input ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 4096 || height > 4096 || width * height > 1024 * 1024 ||
      !MIME_TYPES.includes(mimeType) || !['software', 'hardware'].includes(encoder))
    throw failure('Invalid recording dimensions, format or encoder');
  return { width, height, mimeType, encoder };
}

export class RecordingService {
  constructor({ directory = path.join(os.homedir(), 'Movies', 'MatrixPrism'), spawnEncoder = spawn,
    // Checked when a recording starts; a stand-in encoder (tests) needs no real FFmpeg.
    checkEncoder = spawnEncoder === spawn ? ffmpegAvailable : async () => {} } = {}) {
    this.directory = path.resolve(directory);
    this.spawnEncoder = spawnEncoder;
    this.checkEncoder = checkEncoder;
    this.sessions = new Map();
    this.starting = false;
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) throw failure('Recording not found', 404);
    return session;
  }

  status(session) {
    return { id: session.id, state: session.state, bytes: session.bytes, sequence: session.sequence,
      width: session.width, height: session.height, encoder: session.encoder,
      directory: session.directory, error: session.error ?? null,
      file: session.state === 'saved' ? session.target : null };
  }

  arm(session) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => this.cancel(session, 'Recording input timed out').catch(() => {}), 45000);
    session.timer.unref();
  }

  async start(input) {
    const options = recordingOptions(input);
    await this.checkEncoder();
    if (this.starting || [...this.sessions.values()].some(busy))
      throw failure('Another recording is still active', 409);
    this.starting = true;
    try {
      await fs.promises.mkdir(this.directory, { recursive: true });
      const directory = await fs.promises.mkdtemp(path.join(this.directory, 'preview-'));
      const session = { ...options, id: randomBytes(24).toString('hex'), directory,
        state: 'recording', bytes: 0, sequence: 0, uploading: false, started: Date.now() };
      session.source = path.join(directory, 'capture.webm.partial');
      session.target = path.join(directory, 'preview.mp4');
      await fs.promises.writeFile(path.join(directory, 'settings.json'), JSON.stringify(options, null, 2) + '\n');
      session.handle = await fs.promises.open(session.source, 'wx', 0o600);
      this.sessions.set(session.id, session);
      while (this.sessions.size > 32) {
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
      throw failure('Recording chunk is out of order or recording is closed', 409);
    if (!buffer.length || buffer.length > MAX_RECORDING_CHUNK || session.bytes + buffer.length > MAX_BYTES ||
        Date.now() - session.started > MAX_SECONDS * 1000) {
      await this.cancel(session, 'Recording size or duration limit reached');
      throw failure('Recording size or duration limit reached', 413);
    }
    clearTimeout(session.timer);
    try {
      await session.handle.writeFile(buffer);
      session.bytes += buffer.length;
      ++session.sequence;
      this.arm(session);
      return this.status(session);
    } catch (error) {
      await this.cancel(session, `Cannot write recording: ${error.message}`);
      throw error;
    }
  }

  async finish(session) {
    if (session.state !== 'recording' || session.uploading)
      throw failure('Recording is not ready to finalize', 409);
    if (!session.bytes) throw failure('Recording contains no media');
    clearTimeout(session.timer);
    session.state = 'finalizing';
    try {
      await session.handle.close();
      session.handle = null;
      const source = path.join(session.directory, 'capture.webm');
      await fs.promises.rename(session.source, source);
      session.source = source;
      const partial = path.join(session.directory, 'preview.partial.mp4');
      const args = ['-hide_banner', '-nostdin', '-n', '-f', 'matroska', '-i', source,
        '-map', '0:v:0', '-map', '0:a:0',
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black,format=yuv420p',
        ...(session.encoder === 'hardware'
          ? ['-c:v', 'h264_videotoolbox', '-allow_sw', '0', '-require_sw', '0',
            '-b:v', String(Math.max(500000, Math.min(8000000, session.width * session.height * 24)))]
          : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18']),
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', partial];
      await fs.promises.writeFile(path.join(session.directory, 'encoder-command.json'),
        JSON.stringify({ executable: 'ffmpeg', args }, null, 2) + '\n');
      if (session.state !== 'finalizing') throw failure('Recording was cancelled before encoding', 409);
      const log = fs.openSync(path.join(session.directory, 'encoder.log'), 'wx', 0o600);
      try {
        session.child = this.spawnEncoder('ffmpeg', args, { stdio: ['ignore', 'ignore', log] });
      } finally {
        fs.closeSync(log);
      }
      session.timer = setTimeout(() => this.cancel(session, 'Encoder timed out').catch(() => {}), 300000);
      session.timer.unref();
      session.child.once('error', (error) => this.cancel(session, ffmpegStartMessage(error)).catch(() => {}));
      session.child.once('close', async (code) => {
        clearTimeout(session.timer);
        session.child = null;
        if (session.state !== 'finalizing') return;
        try {
          if (code !== 0) throw new Error(`FFmpeg exited ${code}; see ${path.join(session.directory, 'encoder.log')}`);
          const stat = await fs.promises.stat(partial);
          if (!stat.size) throw new Error('Encoder produced an empty file');
          await fs.promises.link(partial, session.target);
          await fs.promises.unlink(partial);
          session.state = 'saved';
        } catch (error) {
          await this.cancel(session, error.message);
        }
      });
      return this.status(session);
    } catch (error) {
      await this.cancel(session, error.message);
      throw error;
    }
  }

  async cancel(session, message = 'Recording cancelled; captured media retained') {
    if (!busy(session)) return;
    session.state = 'error';
    session.error = message;
    clearTimeout(session.timer);
    session.child?.kill('SIGKILL');
    if (session.handle) {
      const handle = session.handle;
      session.handle = null;
      await handle.close().catch(() => {});
    }
  }

  async close() {
    await Promise.all([...this.sessions.values()].map((session) => this.cancel(session, 'Composer server stopped')));
  }
}

export async function readBody(request, limit) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw failure('Recording request is too large', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Recording and live streaming are for a page on this computer: a request
// must come from loopback, and a POST must carry this server's own Origin.
export function localSameOrigin(request) {
  const address = request.socket.remoteAddress ?? '';
  const origin = request.headers.origin;
  return (address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')) &&
    !(origin && origin !== `http://${request.headers.host}`) &&
    !(request.method !== 'GET' && !origin);
}

export async function recordingRequest(service, request, response, url) {
  const json = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  if (!localSameOrigin(request)) {
    json(403, { error: 'Recording requires a same-origin page on this computer' });
    return;
  }
  let session;
  try {
    if (request.method === 'POST' && url.pathname === '/api/recordings') {
      json(201, await service.start(JSON.parse((await readBody(request, 2048)).toString())));
      return;
    }
    const match = url.pathname.match(/^\/api\/recordings\/([a-f0-9]{48})(?:\/(chunk|finish|cancel|file))?$/);
    if (!match) throw failure('Recording endpoint not found', 404);
    session = service.get(match[1]);
    const action = match[2];
    if (request.method === 'GET' && !action) json(200, service.status(session));
    else if (request.method === 'GET' && action === 'file' && session.state === 'saved') {
      response.writeHead(200, { 'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="preview.mp4"', 'Cache-Control': 'no-store' });
      fs.createReadStream(session.target).on('error', () => response.destroy()).pipe(response);
    } else if (request.method === 'POST' && action === 'chunk') {
      const sequence = Number(url.searchParams.get('sequence'));
      if (session.state !== 'recording' || session.uploading || !Number.isInteger(sequence) ||
          !url.searchParams.has('sequence') || sequence !== session.sequence)
        throw failure('Recording chunk is out of order or busy', 409);
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
    } else throw failure('Recording method or state is not allowed', 405);
  } catch (error) {
    if (session?.state === 'recording' && !error.status) await service.cancel(session, error.message);
    json(error.status ?? (error instanceof SyntaxError ? 400 : 500), { error: error.message });
  }
}