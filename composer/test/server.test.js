import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocket } from '../lib/vendor/ws/wrapper.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SERVER = fileURLToPath(new URL('../server.js', import.meta.url));

// Starts the real server on an ephemeral port and resolves with its origin.
function startServer(args = []) {
  const child = spawn(process.execPath, [SERVER, '--port', '0', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/[^\s/]+:\d+/);
      if (match) resolve({ child, origin: match[0] });
    });
    child.once('exit', (code) => reject(new Error(`server exited early (${code}): ${output}`)));
    child.once('error', reject);
  });
}

function openSocket(origin, headers) {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${origin.replace('http', 'ws')}/stream`, { headers });
    socket.once('open', () => { socket.close(); resolve('open'); });
    socket.once('error', () => resolve('rejected'));
  });
}

// The status of a GET sent to the server at `origin` under another Host name,
// which fetch() does not allow to be set.
function statusAs(origin, pathname, headers) {
  return new Promise((resolve, reject) => {
    http.get(`${origin}${pathname}`, { headers }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).once('error', reject);
  });
}

test('server survives malformed URLs and refuses cross-site API and stream use', async (t) => {
  const { child, origin } = await startServer();
  t.after(() => child.kill());

  assert.equal((await fetch(`${origin}/`)).status, 200);
  assert.equal((await fetch(`${origin}/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${origin}/../server.js`)).status, 404);
  assert.equal((await fetch(`${origin}/`, { method: 'POST' })).status, 405);
  // Still serving after the malformed request.
  const config = await fetch(`${origin}/api/config`);
  assert.equal(config.status, 200);
  // When it started, so the page can apply a host named on the command line.
  assert.ok(!Number.isNaN(Date.parse((await config.json()).started)));

  const foreign = { Origin: 'http://evil.example' };
  assert.equal((await fetch(`${origin}/api/config`, { headers: foreign })).status, 403);
  assert.equal((await fetch(`${origin}/api/info?host=127.0.0.1`,
    { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);

  const version = await fetch(`${origin}/api/version`);
  assert.equal(version.status, 200);
  assert.match((await version.json()).version, /^\d+\.\d+\.\d+/);
  assert.equal((await fetch(`${origin}/api/version`, { headers: foreign })).status, 403);
  // Refused before any search goes out on the network.
  assert.equal((await fetch(`${origin}/api/receivers`, { headers: foreign })).status, 403);

  assert.equal(await openSocket(origin, foreign), 'rejected');
  assert.equal(await openSocket(origin, { Origin: origin }), 'open');
  assert.equal(await openSocket(origin, {}), 'open');
});

test('server answers only to its own names, so a rebound name cannot use it', async (t) => {
  const { child, origin } = await startServer();
  t.after(() => child.kill());
  const port = new URL(origin).port;

  // After rebinding, the other site's page is same-origin to the browser:
  // Origin and Host both carry its name.
  const rebound = { Host: `evil.example:${port}`, Origin: `http://evil.example:${port}` };
  assert.equal(await statusAs(origin, '/api/config', rebound), 403);
  assert.equal(await statusAs(origin, '/api/info?host=127.0.0.1', rebound), 403);
  assert.equal(await statusAs(origin, '/api/version', rebound), 403);
  assert.equal(await statusAs(origin, '/', rebound), 403);
  assert.equal(await statusAs(origin, '/api/config', { Host: `evil.example:${port}` }), 403);
  assert.equal(await statusAs(origin, '/api/config', { Host: `127.0.0.1.evil.example:${port}` }), 403);
  assert.equal(await openSocket(origin, rebound), 'rejected');
  assert.equal(await openSocket(origin, { Host: `evil.example:${port}` }), 'rejected');

  for (const name of ['localhost', '127.0.0.1', '[::1]']) {
    const local = { Host: `${name}:${port}`, Origin: `http://${name}:${port}` };
    assert.equal(await statusAs(origin, '/api/config', local), 200, name);
    assert.equal(await statusAs(origin, '/', local), 200, name);
    assert.equal(await openSocket(origin, local), 'open', name);
  }
  // The local name does not excuse a request that comes from another site.
  assert.equal(await statusAs(origin, '/api/config',
    { Host: `localhost:${port}`, Origin: 'http://evil.example' }), 403);
});

test('recording API requires same-origin ownership and accepts only ordered bounded media', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-api-'));
  const { child, origin } = await startServer(['--record-dir', directory]);
  t.after(async () => {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const body = JSON.stringify({ width: 256, height: 192, encoder: 'software',
    mimeType: 'video/webm;codecs=vp9,opus' });
  const post = (endpoint, content = body, headers = { Origin: origin }) =>
    fetch(`${origin}/api/recordings${endpoint}`, { method: 'POST', headers, body: content });
  assert.equal((await post('', body, {})).status, 403);
  assert.equal((await post('', body, { Origin: 'http://evil.example' })).status, 403);
  assert.equal((await post('', '{bad')).status, 400);
  assert.equal((await post('', JSON.stringify({ width: 999999 }))).status, 400);
  const created = await post('');
  assert.equal(created.status, 201);
  const session = await created.json();
  assert.match(session.id, /^[a-f0-9]{48}$/);
  assert.ok(session.directory.startsWith(directory));
  assert.equal((await post('')).status, 409);
  assert.equal((await post(`/${session.id}/chunk?sequence=1`, 'wrong')).status, 409);
  assert.equal((await post(`/${session.id}/chunk?sequence=0`, 'first')).status, 200);
  assert.equal((await post(`/${session.id}/chunk?sequence=0`, 'duplicate')).status, 409);
  assert.equal((await post(`/${'a'.repeat(48)}/cancel`, '')).status, 404);
  assert.equal((await fetch(`${origin}/api/recordings/${session.id}`, {
    headers: { 'Sec-Fetch-Site': 'cross-site' },
  })).status, 403);
  assert.equal((await fetch(`${origin}/api/recordings/${session.id}/file`)).status, 405);
  const cancelled = await post(`/${session.id}/cancel`, '');
  assert.equal((await cancelled.json()).state, 'error');
  assert.equal((await post(`/${session.id}/chunk?sequence=1`, 'late')).status, 409);
  assert.equal(fs.readFileSync(path.join(session.directory, 'capture.webm.partial'), 'utf8'), 'first');
});
