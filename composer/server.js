#!/usr/bin/env node
// MatrixPrism composer server: serves the pattern UI and relays rendered frames
// from the browser to a matrix-dmx receiver as DDP.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WebSocketServer } from './lib/vendor/ws/wrapper.mjs';
import { DDP_PORT } from './lib/ddp.js';
import { hostName, servedNames } from './lib/hosts.js';
import { MAX_FRAME_BYTES, RelayApi, StreamSession, fileAnswer } from './lib/relay-core.js';
import { RecordingService, recordingRequest } from './lib/recording.js';
import { LiveService, liveRequest } from './lib/live.js';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const { values: options } = parseArgs({
  options: {
    ddp: { type: 'string' },
    // The old name of --ddp, from when the only receiver was a Pi.
    pi: { type: 'string' },
    'ddp-port': { type: 'string', default: String(DDP_PORT) },
    port: { type: 'string', default: '8080' },
    listen: { type: 'string', default: '127.0.0.1' },
    'record-dir': { type: 'string' },
    'live-ingest': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

// When this server started, as the page's sign that a new command line may
// name a different receiver.
const STARTED = new Date().toISOString();

const receiverHost = options.ddp ?? options.pi ?? process.env.MATRIX_HOST ?? '';

if (options.help) {
  console.log(`usage: node server.js [--ddp <host>] [--ddp-port 4048] [--port 8080] [--listen 127.0.0.1]

  --ddp       Default DDP receiver, WLED or matrix-dmx (IP or name, e.g. wled-e1f2a3.local)
  --ddp-port  DDP UDP port on the receiver (default 4048)
  --port      HTTP port for the UI (default 8080)
  --listen    Interface for the UI (default 127.0.0.1, local only)
  --record-dir Recording output folder (default ~/Movies/MatrixPrism)
  --live-ingest RTMP address for Go live, without the key (default YouTube's); the key is read from
               YOUTUBE_STREAM_KEY`);
  process.exit(0);
}

function parsePort(text, name, allowZero = false) {
  const port = Number(text);
  if (!Number.isInteger(port) || port < (allowZero ? 0 : 1) || port > 65535) {
    console.error(`Invalid ${name}: ${text}`);
    process.exit(2);
  }
  return port;
}

const httpPort = parsePort(options.port, '--port', true);
const defaultDdpPort = parsePort(options['ddp-port'], '--ddp-port');
const recordings = new RecordingService({ directory: options['record-dir'] });
const live = new LiveService({ ...(options['live-ingest'] ? { ingest: options['live-ingest'] } : {}) });

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

// Browsers send these on cross-site requests; other pages must not be able to
// drive the relay or the matrix probe through the user's browser.
function isForeignRequest(request) {
  const origin = request.headers.origin;
  if (origin) {
    try {
      return new URL(origin).host !== request.headers.host;
    } catch {
      return true;
    }
  }
  const site = request.headers['sec-fetch-site'];
  return site === 'cross-site' || site === 'same-site';
}

// A page on another site can point its own name at this machine (DNS
// rebinding). Its requests are then same-origin to the browser, so Origin and
// Host agree and both carry that name. Answer only to this server's names.
function isKnownHost(request) {
  const name = hostName(request.headers.host);
  return name !== null && servedNames(options.listen).has(name);
}

async function serveStatic(pathname, response) {
  const answer = await fileAnswer(PUBLIC_DIR, pathname);
  response.writeHead(answer.status, answer.headers);
  response.end(answer.body ?? undefined);
}

const api = new RelayApi({ receiverHost, ddpPort: defaultDdpPort, started: STARTED, rootDir: ROOT_DIR });

const server = http.createServer(async (request, response) => {
  let url;
  try {
    url = new URL(request.url, 'http://localhost');
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request');
    return;
  }
  if (!isKnownHost(request)) {
    response.writeHead(403, { 'Content-Type': 'text/plain' })
      .end('The composer does not answer to this host name. Open it as localhost.');
    return;
  }
  if (url.pathname.startsWith('/api/') && isForeignRequest(request)) {
    sendJson(response, 403, { error: 'cross-site requests are not allowed' });
    return;
  }
  if (url.pathname === '/api/recordings' || url.pathname.startsWith('/api/recordings/')) {
    request.setTimeout(15000, () => request.destroy());
    await recordingRequest(recordings, request, response, url);
    return;
  }
  if (url.pathname === '/api/live' || url.pathname.startsWith('/api/live/')) {
    request.setTimeout(15000, () => request.destroy());
    await liveRequest(live, request, response, url);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  const answer = await api.handle(url.pathname, url.searchParams);
  if (answer) {
    sendJson(response, answer.status, answer.body);
    return;
  }
  serveStatic(url.pathname, response);
});

const wss = new WebSocketServer({
  server,
  path: '/stream',
  maxPayload: MAX_FRAME_BYTES,
  verifyClient: ({ req }) => isKnownHost(req) && !isForeignRequest(req),
});

wss.on('connection', (socket) => {
  const send = (message) => {
    if (socket.readyState === socket.OPEN)
      socket.send(JSON.stringify(message));
  };
  const session = new StreamSession({ send, defaultDdpPort, log: console.log });
  socket.on('message', (data, isBinary) => session.message(data, isBinary));
  socket.on('close', () => session.close());
});

server.on('error', (error) => {
  console.error(`Cannot start server: ${error.message}`);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => Promise.all([recordings.close(), live.close()]).finally(() => process.exit(0)));
}

server.listen(httpPort, options.listen, () => {
  const shownHost = options.listen === '0.0.0.0' ? 'localhost'
    : net.isIPv6(options.listen) ? `[${options.listen}]` : options.listen;
  console.log(`MatrixPrism composer UI: http://${shownHost}:${server.address().port}/`);
  if (receiverHost)
    console.log(`Default DDP receiver: ${receiverHost} (DDP port ${defaultDdpPort})`);
});
