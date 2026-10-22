#!/usr/bin/env node
// Measures what a frame of the quad mixer (T16) would cost (quad-cost.html),
// against today's one-pair frame, at three panel sizes and with three sets of
// patterns. Prints a Markdown table and writes the raw results as JSON.
//
//   node tools/quad-cost.mjs [--out file.json]
//       in headless Chrome, which draws with a software GPU (SwiftShader):
//       a lower bound on speed, useful for comparing the cases.
//   node tools/quad-cost.mjs --serve [--port 8765] [--listen 0.0.0.0] [--out file.json]
//       serves the page for a browser: open the address it prints in Chrome
//       and keep the tab in front; the results come back here when it
//       finishes, on the browser's real GPU. It listens on this computer only
//       (127.0.0.1) unless --listen names an interface, such as 0.0.0.0 for
//       another computer on the network. It serves only the page and
//       public/, and stops when the first result arrives.
//
// Frames are timed back to back, from the first draw to gl.finish(), so the
// figures are the work per frame, not a frame rate. At 30 fps the budget is
// 33.3 ms for everything, the page's other work included.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPagePosted } from './headless.mjs';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(TOOLS_DIR, '..', 'public');
const PAGE = 'quad-cost.html';
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const out = option('--out', null);

function table(result) {
  const lines = [`Browser: ${result.userAgent}`, `GPU: ${result.gpu}`, ''];
  if (result.error) lines.push(`Error: ${result.error}`, '');
  lines.push('| Size | Patterns | Frame | Median ms | 95th % ms | Mean ms | Share of 33.3 ms (median) | Lit |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const run of result.runs)
    lines.push(`| ${run.size} | ${run.workload} | ${run.mode} | ${run.medianMs} | ${run.p95Ms} | ${run.meanMs} | ` +
      `${Math.round(run.medianMs / 33.33 * 100)}% | ${Math.round(run.lit * 100)}% |`);
  return lines.join('\n');
}

function report(text) {
  const result = JSON.parse(text);
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
  console.log(table(result));
  return result.error ? 1 : 0;
}

if (!args.includes('--serve')) {
  try {
    process.exit(report(await runPagePosted(PAGE, { timeoutMs: 1200000 })));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

// --serve: the page and public/ on 127.0.0.1 only, until the result comes.
const port = Number(option('--port', 8765));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'POST' && url.pathname === '/result') {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      response.end();
      server.close();
      process.exitCode = report(Buffer.concat(chunks).toString('utf8'));
    });
    return;
  }
  const name = decodeURIComponent(url.pathname).slice(1) || PAGE;
  const file = name === PAGE ? path.join(TOOLS_DIR, PAGE) : path.resolve(PUBLIC_DIR, name);
  if (name !== PAGE && !file.startsWith(PUBLIC_DIR + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    response.end(data);
  });
});
const listen = option('--listen', '127.0.0.1');
server.listen(port, listen, () => {
  const hosts = listen === '0.0.0.0' ? Object.values(os.networkInterfaces()).flat()
    .filter((address) => address.family === 'IPv4' && !address.internal).map((address) => address.address) : [listen];
  for (const host of hosts)
    console.log(`Open http://${host}:${port}/${PAGE} in Chrome and keep the tab in front until it says done.`);
});
