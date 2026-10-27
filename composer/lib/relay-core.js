// The relay's work, apart from how a request reaches it (T65). The composer's
// server (server.js) and the desktop app (app/main.mjs) both use this: the files
// of the page, the small JSON answers about receivers and the version, and the
// frame channel that turns the page's frames into DDP packets. Each brings its
// own transport: HTTP and a WebSocket in the server; a secure scheme and IPC in
// the app. Nothing here listens on a port.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DDP_PORT, DdpSender, parseMatrixInfo } from './ddp.js';
import { discoverReceivers } from './mdns.js';
import { versionInfo } from './version.js';

export const MAX_FRAME_BYTES = 1024 * 1024 * 3;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
};

// A file of the page: { status, headers, body }. Refuses a path that leaves
// `publicDir`, and a name that is not valid percent-encoding.
export async function fileAnswer(publicDir, pathname) {
  const text = { 'Content-Type': 'text/plain' };
  let relative;
  try {
    relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
  } catch {
    return { status: 400, headers: text, body: 'Bad request' };
  }
  const file = path.resolve(publicDir, relative);
  if (!file.startsWith(path.resolve(publicDir) + path.sep)) return { status: 403, headers: {}, body: null };
  try {
    return {
      status: 200,
      headers: { 'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' },
      body: await fs.readFile(file),
    };
  } catch {
    return { status: 404, headers: text, body: 'Not found' };
  }
}

export async function fetchMatrixInfo(host, fetchImpl = fetch) {
  if (!/^[A-Za-z0-9.\-:\[\]]+$/.test(host)) throw new Error('invalid host');
  const response = await fetchImpl(`http://${host}/json/info`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${host}`);
  const matrix = parseMatrixInfo(await response.json());
  if (!matrix) throw new Error(`${host} did not report matrix dimensions`);
  return matrix;
}

// The GET answers the page asks the relay for besides files: /api/config,
// /api/version, /api/receivers and /api/info. `handle` gives { status, body }
// for one of them, or null for any other path.
export class RelayApi {
  constructor({ receiverHost = '', ddpPort = DDP_PORT, started = new Date().toISOString(), rootDir,
    discover = discoverReceivers, fetchInfo = fetchMatrixInfo, version = versionInfo } = {}) {
    Object.assign(this, { receiverHost, ddpPort, started, rootDir, discover, fetchInfo, version });
    this.discovery = null;
  }

  // One search at a time: requests that arrive while one runs share it, so the
  // page cannot make the relay flood the network.
  findReceivers() {
    this.discovery ??= this.discover().finally(() => { this.discovery = null; });
    return this.discovery;
  }

  async handle(pathname, searchParams = new URLSearchParams()) {
    switch (pathname) {
      case '/api/config':
        // `started` lets the page apply a host named on the command line once per
        // start, over one saved in the browser (server-config.js).
        return { status: 200, body: { host: this.receiverHost, ddpPort: this.ddpPort, started: this.started } };
      case '/api/version':
        // Read on each request: after a change of branch a reload shows what is there now.
        try { return { status: 200, body: await this.version(this.rootDir) }; } catch (error) { return { status: 500, body: { error: error.message } }; }
      case '/api/receivers':
        try { return { status: 200, body: { receivers: await this.findReceivers() } }; } catch (error) { return { status: 502, body: { error: error.message } }; }
      case '/api/info':
        try { return { status: 200, body: await this.fetchInfo(searchParams.get('host') || '') }; } catch (error) { return { status: 502, body: { error: error.message } }; }
      default:
        return null;
    }
  }
}

// One page's frame channel: the messages of /stream, whatever carries them.
// `send(message)` takes an object for the page. Give it each message with
// `message(data, isBinary)`; a text message is JSON, a binary one a frame.
export class StreamSession {
  constructor({ send, defaultDdpPort = DDP_PORT, sender = new DdpSender(), log = () => {}, statsMs = 1000 }) {
    Object.assign(this, { send, defaultDdpPort, sender, log });
    this.frameBytes = 0;
    this.targetLabel = '';
    this.timer = setInterval(() => send({ type: 'stats', target: this.targetLabel, ...sender.takeStats() }), statsMs);
  }

  async message(data, isBinary) {
    if (!isBinary) return this.control(data);
    if (this.frameBytes === 0) return;
    if (data.length !== this.frameBytes) {
      this.send({ type: 'error', message: `frame is ${data.length} bytes, expected ${this.frameBytes}` });
      return;
    }
    this.sender.sendFrame(data);
  }

  async control(data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      this.send({ type: 'error', message: 'invalid JSON control message' });
      return;
    }
    if (message.type !== 'target') return;
    const width = Number(message.width);
    const height = Number(message.height);
    const port = Number(message.port || this.defaultDdpPort);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 ||
        height < 1 || width * height * 3 > MAX_FRAME_BYTES ||
        !Number.isInteger(port) || port < 1 || port > 65535) {
      this.send({ type: 'error', message: 'invalid matrix size or port' });
      return;
    }
    this.frameBytes = 0;
    try {
      const address = await this.sender.setTarget(String(message.host || ''), port);
      this.frameBytes = width * height * 3;
      this.targetLabel = `${message.host} (${address}:${port}) ${width}x${height}`;
      this.log(`Streaming to ${this.targetLabel}`);
      this.send({ type: 'target', ok: true, address, port, width, height });
    } catch (error) {
      this.targetLabel = '';
      this.send({ type: 'error', message: `cannot resolve ${message.host}: ${error.message}` });
    }
  }

  close() {
    clearInterval(this.timer);
    this.sender.close();
  }
}
