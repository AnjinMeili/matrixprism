import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import WebSocket from '../lib/vendor/ws/wrapper.mjs';
import {
  DDP_HEADER_LENGTH, DDP_MAX_PAYLOAD, DdpSender, buildDdpPackets, parseMatrixInfo,
} from '../lib/ddp.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeFrame(width, height) {
  const frame = new Uint8Array(width * height * 3);
  for (let i = 0; i < frame.length; ++i)
    frame[i] = (i * 7) & 0xff;
  return frame;
}

// Reassembles a frame the way matrix-dmx does: data at the byte offset,
// display on the push flag.
function reassemble(packets, size) {
  const frame = new Uint8Array(size);
  let pushes = 0;
  for (const packet of packets) {
    assert.equal(packet[0] & 0xc0, 0x40, 'DDP version 1');
    assert.equal(packet[2], 0x0b, 'RGB 8-bit data type');
    assert.equal(packet[3], 1, 'display destination');
    const offset = packet.readUInt32BE(4);
    const length = packet.readUInt16BE(8);
    assert.equal(packet.length, DDP_HEADER_LENGTH + length);
    frame.set(packet.subarray(DDP_HEADER_LENGTH), offset);
    if (packet[0] & 0x01)
      pushes += 1;
  }
  return { frame, pushes };
}

test('splits a 256x192 frame into MTU-sized packets with one push', () => {
  const frame = makeFrame(256, 192);
  const packets = buildDdpPackets(frame, 5);
  assert.equal(packets.length, Math.ceil(frame.length / DDP_MAX_PAYLOAD));
  for (const packet of packets) {
    assert.ok(packet.length <= DDP_HEADER_LENGTH + DDP_MAX_PAYLOAD);
    assert.equal(packet[1], 5);
  }
  assert.equal(packets.at(-1)[0], 0x41);
  assert.ok(packets.slice(0, -1).every((packet) => packet[0] === 0x40));
  const { frame: rebuilt, pushes } = reassemble(packets, frame.length);
  assert.equal(pushes, 1);
  assert.deepEqual(rebuilt, frame);
});

test('handles a final partial packet and keeps pixels whole', () => {
  const frame = makeFrame(7, 3);
  const packets = buildDdpPackets(frame, 1, 12);
  assert.equal(packets.length, 6);
  assert.equal(packets.at(-1).readUInt16BE(8), 63 - 60);
  assert.deepEqual(reassemble(packets, frame.length).frame, frame);
  assert.throws(() => buildDdpPackets(new Uint8Array(0), 1));
  assert.throws(() => buildDdpPackets(frame, 1, 10));
});

test('never produces a header the receiver mistakes for Pixel Animator', () => {
  for (let sequence = 1; sequence <= 15; ++sequence) {
    for (const packet of buildDdpPackets(makeFrame(64, 32), sequence))
      assert.ok(!(packet[0] === 0x41 && packet[1] === 0x41));
  }
});

test('reads WLED 2D matrix dimensions', () => {
  assert.deepEqual(parseMatrixInfo({ name: 'wled-1', leds: { count: 49152, matrix: { w: 256, h: 192 } } }),
    { width: 256, height: 192, name: 'wled-1' });
  assert.equal(parseMatrixInfo({ leds: { count: 100 } }), null);
  assert.equal(parseMatrixInfo({ leds: { matrix: { w: 0, h: 4 } } }), null);
  assert.equal(parseMatrixInfo(null), null);
});

async function listenUdp() {
  const socket = dgram.createSocket('udp4');
  socket.bind(0, '127.0.0.1');
  await once(socket, 'listening');
  return socket;
}

function collectPackets(socket, count) {
  return new Promise((resolve) => {
    const packets = [];
    socket.on('message', (message) => {
      packets.push(message);
      if (packets.length === count)
        resolve(packets);
    });
  });
}

test('DdpSender delivers a frame over UDP with cycling sequence numbers', async () => {
  const receiver = await listenUdp();
  const sender = new DdpSender();
  try {
    await sender.setTarget('localhost', receiver.address().port);
    const frame = makeFrame(32, 16);
    const expected = Math.ceil(frame.length / DDP_MAX_PAYLOAD);
    const received = collectPackets(receiver, expected);
    assert.equal(sender.sendFrame(frame), expected);
    const packets = await received;
    assert.deepEqual(reassemble(packets, frame.length).frame, frame);
    assert.equal(packets[0][1], 1);
    for (let i = 0; i < 15; ++i)
      sender.sendFrame(frame);
    assert.equal(sender.sequence, 1, 'sequence wraps from 15 to 1');
    assert.equal(sender.takeStats().frames, 16);
  } finally {
    sender.close();
    receiver.close();
  }
});

test('server relays browser frames to DDP and serves the UI', async (t) => {
  const receiver = await listenUdp();
  const server = spawn(process.execPath, ['server.js', '--port', '0'], { cwd: ROOT });
  t.after(() => {
    server.kill();
    receiver.close();
  });
  // --port 0 picks a free port; read it from the startup line.
  let output = '';
  const url = await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/[\d.]+:(\d+)\//);
      if (match)
        resolve(`127.0.0.1:${match[1]}`);
    });
    server.on('exit', (code) => reject(new Error(`server exited ${code}: ${output}`)));
  });

  const page = await fetch(`http://${url}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /MatrixPrism/);
  const license = await fetch(`http://${url}/licenses/aurora.txt`);
  assert.equal(license.status, 200);
  assert.match(license.headers.get('content-type'), /text\/plain/);
  assert.match(await license.text(), /Permission is hereby granted, free of charge/);
  for (const [name, notice] of [
    ['fibonacci', /5f8dd395f5a8f62d169463d125ee5b102b526611/],
    ['gpl-3.0', /GNU GENERAL PUBLIC LICENSE/],
    ['gradient-palettes', /cpt-city/],
  ]) {
    const response = await fetch(`http://${url}/licenses/${name}.txt`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/plain/);
    assert.match(await response.text(), notice);
  }
  assert.equal((await fetch(`http://${url}/..%2fserver.js`)).status, 403);
  assert.equal((await fetch(`http://${url}/api/info?host=bad%20host`)).status, 502);

  const socket = new WebSocket(`ws://${url}/stream`);
  await once(socket, 'open');
  const messages = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  const width = 40;
  const height = 30;
  socket.send(JSON.stringify({ type: 'target', host: '127.0.0.1', port: receiver.address().port, width, height }));
  while (!messages.some((m) => m.type === 'target'))
    await new Promise((resolve) => setTimeout(resolve, 10));

  socket.send(new Uint8Array(5));
  const frame = makeFrame(width, height);
  const received = collectPackets(receiver, Math.ceil(frame.length / DDP_MAX_PAYLOAD));
  socket.send(frame);
  const { frame: rebuilt, pushes } = reassemble(await received, frame.length);
  assert.deepEqual(rebuilt, frame);
  assert.equal(pushes, 1);
  assert.ok(messages.some((m) => m.type === 'error' && /expected 3600/.test(m.message)));
  socket.close();
});
