// Runs a tools page in headless Chrome and returns what it wrote, for the
// checks that need a real browser (WebGL, canvas, Web Audio) and cannot run
// in Node.
//
// It serves public/ and the page on a local port for the length of the run,
// with the page's own modules from tools/ under /tools/, and starts Chrome
// with a software WebGL context and a throwaway profile. Set CHROME to the
// browser's path if it is not in the usual place. This is Chrome only: Safari
// may still differ.
//
// runPage reads the text of the page's <pre id="out"> once the page has
// settled, on Chrome's virtual time: a page writes "running" there first and
// its result when it is done. runPagePosted is for pages whose work runs off
// the main thread, such as an OfflineAudioContext, which virtual time does
// not wait for: the page POSTs its result to /result, on real time.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(TOOLS_DIR, '..', 'public');
// The browser refuses a stylesheet served as anything but text/css.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((candidate) => fs.existsSync(candidate));

const missingChrome = () =>
  Promise.reject(new Error('Chrome was not found. Set CHROME to the path of Chrome or Chromium.'));

// Serves tools/<page>, public/ and /tools/; nothing outside them.
function serveFile(page, request, response) {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
  const [base, rest] = name.startsWith('tools/') ? [TOOLS_DIR, name.slice(6)] : [PUBLIC_DIR, name];
  const file = name === page ? path.join(TOOLS_DIR, page) : path.resolve(base, rest);
  if (name !== page && !file.startsWith(base + path.sep)) {
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
}

const chromeArgs = (profile) =>
  ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${profile}`];

// Loads tools/<page>?<query> and resolves with the page's result text. Rejects
// when Chrome is missing or the page gives no result.
export function runPage(page, { query = '', budgetMs = 15000, timeoutMs = 60000 } = {}) {
  if (!CHROME) return missingChrome();
  const server = http.createServer((request, response) => serveFile(page, request, response));
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'matrixprism-headless-'));
      const url = `http://127.0.0.1:${server.address().port}/${page}${query ? `?${query}` : ''}`;
      execFile(CHROME, [...chromeArgs(profile), `--virtual-time-budget=${budgetMs}`, '--dump-dom', url],
        { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
          server.close();
          fs.rmSync(profile, { recursive: true, force: true });
          const match = stdout.match(/<pre id="out">([\s\S]*?)<\/pre>/);
          const text = match ? match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';
          if (!match || text === 'running' || !text.trim())
            reject(new Error(`The page gave no result${error ? `: ${error.message}` : '.'}`));
          else
            resolve(text);
        });
    });
  });
}

// Loads tools/<page>?<query> and resolves with the body the page POSTs to
// /result. Rejects when Chrome is missing, exits first, or `timeoutMs` passes.
// `files` maps further URL paths, such as '/data/3', to a file's path or to a
// Buffer; only those are served beyond public/ and tools/. A POST to
// /post/<name> before the result goes to `onPost(name, body)`. `flags` are
// further Chrome flags, such as a fake microphone.
export function runPagePosted(page, { query = '', timeoutMs = 600000, files = new Map(), onPost = null, flags = [] } = {}) {
  if (!CHROME) return missingChrome();
  return new Promise((resolve, reject) => {
    let chrome = null, timer = null, finished = false;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'matrixprism-headless-'));
    const finish = (error, body) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      server.close();
      // Chrome writes to its profile until it has exited.
      const done = () => {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
        if (error) reject(error);
        else resolve(body);
      };
      if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
        chrome.removeAllListeners('exit');
        chrome.once('exit', done);
        chrome.kill();
      } else done();
    };
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost').pathname;
      if (request.method !== 'POST') {
        const extra = files.get(url);
        if (extra === undefined) {
          serveFile(page, request, response);
        } else if (Buffer.isBuffer(extra)) {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(extra);
        } else {
          response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
          fs.createReadStream(extra).on('error', () => response.destroy()).pipe(response);
        }
        return;
      }
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        response.end();
        const body = Buffer.concat(chunks).toString('utf8');
        if (url === '/result') finish(null, body);
        else if (url.startsWith('/post/') && onPost) onPost(url.slice(6), body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/${page}${query ? `?${query}` : ''}`;
      chrome = spawn(CHROME, [...chromeArgs(profile), ...flags, url], { stdio: 'ignore' });
      chrome.on('exit', (code) => finish(new Error(`Chrome exited (${code}) before the page posted a result.`)));
      timer = setTimeout(() => finish(new Error(`The page posted no result within ${timeoutMs / 1000} s.`)),
        timeoutMs);
    });
  });
}
