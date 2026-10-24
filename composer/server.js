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
import { DDP_PORT, DdpSender, parseMatrixInfo } from './lib/ddp.js';
import { hostName, servedNames } from './lib/hosts.js';
import { discoverReceivers } from './lib/mdns.js';
import { versionInfo } from './lib/version.js';
import { RecordingService, recordingRequest } from './lib/recording.js';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MAX_FRAME_BYTES = 1024 * 1024 * 3;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const { values: options } = parseArgs({
  options: {
    ddp: { type: 'string' },
    // The old name of --ddp, from when the only receiver was a Pi.
    pi: { type: 'string' },
    'ddp-port': { type: 'string', default: String(DDP_PORT) },
    port: { type: 'string', default: '8080' },
    listen: { type: 'string', default: '127.0.0.1' },
    'record-dir': { type: 'string' },
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
  --record-dir Recording output folder (default ~/Movies/MatrixPrism)`);
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

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

// One mDNS search at a time: requests that arrive while one runs share it,
// so the page cannot make the server flood the network.
let discovery = null;
function findReceivers() {
  discovery ??= discoverReceivers().finally(() => { discovery = null; });
  return discovery;
}

async function fetchMatrixInfo(host) {
  if (!/^[A-Za-z0-9.\-:\[\]]+$/.test(host))
    throw new Error('invalid host');
  const response = await fetch(`http://${host}/json/info`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status} from ${host}`);
  const matrix = parseMatrixInfo(await response.json());
  if (!matrix)
    throw new Error(`${host} did not report matrix dimensions`);
  return matrix;
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

function serveStatic(pathname, response) {
  let relative;
  try {
    relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request');
    return;
  }
  const file = path.resolve(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(data);
  });
}

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
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  if (url.pathname === '/api/config') {
    // `started` lets the page apply a host named on the command line once per
    // start, over one saved in the browser (server-config.js).
    sendJson(response, 200, { host: receiverHost, ddpPort: defaultDdpPort, started: STARTED });
    return;
  }
  if (url.pathname === '/api/version') {
    // Read on each request: the page is served from disk, so after a change
    // of branch a reload shows what is there now.
    try {
      sendJson(response, 200, await versionInfo(ROOT_DIR));
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }
  if (url.pathname === '/api/receivers') {
    // Receivers that answer an mDNS question for _wled._tcp (lib/mdns.js).
    try {
      sendJson(response, 200, { receivers: await findReceivers() });
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return;
  }
  if (url.pathname === '/api/info') {
    try {
      sendJson(response, 200, await fetchMatrixInfo(url.searchParams.get('host') || ''));
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
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
  const sender = new DdpSender();
  let frameBytes = 0;
  let targetLabel = '';

  const send = (message) => {
    if (socket.readyState === socket.OPEN)
      socket.send(JSON.stringify(message));
  };

  const statsTimer = setInterval(() => {
    const stats = sender.takeStats();
    send({ type: 'stats', target: targetLabel, ...stats });
  }, 1000);

  socket.on('message', async (data, isBinary) => {
    if (!isBinary) {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        send({ type: 'error', message: 'invalid JSON control message' });
        return;
      }
      if (message.type !== 'target')
        return;
      const width = Number(message.width);
      const height = Number(message.height);
      const port = Number(message.port || defaultDdpPort);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 ||
          height < 1 || width * height * 3 > MAX_FRAME_BYTES ||
          !Number.isInteger(port) || port < 1 || port > 65535) {
        send({ type: 'error', message: 'invalid matrix size or port' });
        return;
      }
      frameBytes = 0;
      try {
        const address = await sender.setTarget(String(message.host || ''), port);
        frameBytes = width * height * 3;
        targetLabel = `${message.host} (${address}:${port}) ${width}x${height}`;
        console.log(`Streaming to ${targetLabel}`);
        send({ type: 'target', ok: true, address, port, width, height });
      } catch (error) {
        targetLabel = '';
        send({ type: 'error', message: `cannot resolve ${message.host}: ${error.message}` });
      }
      return;
    }
    if (frameBytes === 0)
      return;
    if (data.length !== frameBytes) {
      send({ type: 'error', message: `frame is ${data.length} bytes, expected ${frameBytes}` });
      return;
    }
    sender.sendFrame(data);
  });

  socket.on('close', () => {
    clearInterval(statsTimer);
    sender.close();
  });
});

server.on('error', (error) => {
  console.error(`Cannot start server: ${error.message}`);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => recordings.close().finally(() => process.exit(0)));
}

server.listen(httpPort, options.listen, () => {
  const shownHost = options.listen === '0.0.0.0' ? 'localhost'
    : net.isIPv6(options.listen) ? `[${options.listen}]` : options.listen;
  console.log(`MatrixPrism composer UI: http://${shownHost}:${server.address().port}/`);
  if (receiverHost)
    console.log(`Default DDP receiver: ${receiverHost} (DDP port ${defaultDdpPort})`);
});
