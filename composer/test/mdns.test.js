import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { WLED_SERVICE, buildQuery, discoverReceivers, encodeName, parseMessage, receiversFrom } from '../lib/mdns.js';

// Receiver discovery by mDNS (lib/mdns.js), on hand-built replies.

const u16 = (n) => [n >> 8, n & 0xff];
// A record: name bytes, type, class, TTL, data.
const record = (name, type, data) =>
  [...name, ...u16(type), ...u16(1), 0, 0, 0, 120, ...u16(data.length), ...data];

// A reply as matrix-dmx and WLED send it: the question, then PTR, SRV and A,
// with later names pointing back at earlier ones.
function reply({ instance = 'wled-e1f2a3', host = 'wled-e1f2a3', address = [192, 168, 1, 50], port = 80 } = {}) {
  const question = [...encodeName(WLED_SERVICE)];
  const serviceAt = 12;
  const header = [0, 0, 0x84, 0, ...u16(1), ...u16(1), 0, 0, ...u16(2)];
  const head = [...header, ...question, ...u16(12), ...u16(1)];
  // PTR: _wled._tcp.local -> <instance>._wled._tcp.local (instance label + pointer)
  const ptrData = [instance.length, ...Buffer.from(instance), 0xc0, serviceAt];
  const ptr = record([0xc0, serviceAt], 12, ptrData);
  const ptrDataAt = head.length + 2 + 10;
  // SRV: <instance> -> <host>.local
  const srvData = [0, 0, 0, 0, ...u16(port), host.length, ...Buffer.from(host), 5, ...Buffer.from('local'), 0];
  const srv = record([0xc0, ptrDataAt], 33, srvData);
  const hostAt = head.length + ptr.length + 2 + 10 + 6;
  const a = record([0xc0, hostAt], 1, address);
  return Buffer.from([...head, ...ptr, ...srv, ...a]);
}

test('the question asks for the _wled._tcp PTR records', () => {
  const query = buildQuery();
  assert.deepEqual([...query.subarray(0, 12)], [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...query.subarray(12)], [...encodeName('_wled._tcp.local'), 0, 12, 0, 1]);
  assert.throws(() => encodeName('a..b'));
});

test('a reply gives the receiver\'s name, .local host and address', () => {
  const records = parseMessage(reply());
  assert.deepEqual(records.map((r) => r.type), ['PTR', 'SRV', 'A']);
  assert.equal(records[0].data, 'wled-e1f2a3._wled._tcp.local');
  assert.deepEqual(records[1].data, { port: 80, target: 'wled-e1f2a3.local' });
  assert.deepEqual(receiversFrom([{ records, from: '192.168.1.50' }]),
    [{ name: 'wled-e1f2a3', host: 'wled-e1f2a3.local', address: '192.168.1.50' }]);
});

test('several receivers, repeats and replies without an A record', () => {
  const one = { records: parseMessage(reply()), from: '192.168.1.50' };
  const portal = { records: parseMessage(reply({ instance: 'MatrixPortal', host: 'wled-0a1b2c', address: [192, 168, 1, 77] })),
    from: '192.168.1.77' };
  const noA = { records: parseMessage(reply({ instance: 'x', host: 'wled-ccc' })).filter((r) => r.type !== 'A'), from: '192.168.1.9' };
  assert.deepEqual(receiversFrom([one, portal, one, noA]), [
    { name: 'MatrixPortal', host: 'wled-0a1b2c.local', address: '192.168.1.77' },
    { name: 'x', host: 'wled-ccc.local', address: '192.168.1.9' },
    { name: 'wled-e1f2a3', host: 'wled-e1f2a3.local', address: '192.168.1.50' },
  ]);
});

test('malformed and hostile replies are refused or left out', () => {
  assert.throws(() => parseMessage(Buffer.alloc(5)), /too short/);
  const loop = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0xc0, 12]);
  assert.throws(() => parseMessage(loop), /too many name pointers/);
  const good = reply();
  assert.throws(() => parseMessage(good.subarray(0, good.length - 3)), /runs past/);
  const long = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0, 40, 65]);
  assert.throws(() => parseMessage(long), /runs past/);
  // A host name with characters a host cannot have is not offered.
  const odd = parseMessage(reply({ host: 'a"><img' }));
  assert.deepEqual(receiversFrom([{ records: odd, from: '192.168.1.5' }]), []);
});

test('discovery sends one question, collects replies until the time is up, and skips junk', async () => {
  const sent = [];
  const socket = Object.assign(new EventEmitter(), {
    bind(port, done) { assert.equal(port, 0, 'an ordinary port, not 5353'); setImmediate(done); },
    setMulticastTTL() {},
    send(message, port, address, done) {
      sent.push({ message, port, address });
      setImmediate(() => {
        socket.emit('message', reply(), { address: '192.168.1.50' });
        socket.emit('message', Buffer.from('junk'), { address: '192.168.1.200' });
        done();
      });
    },
    close() { this.closed = true; },
  });
  const found = await discoverReceivers({ timeoutMs: 50, createSocket: () => socket });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].port, 5353);
  assert.equal(sent[0].address, '224.0.0.251');
  assert.deepEqual(found, [{ name: 'wled-e1f2a3', host: 'wled-e1f2a3.local', address: '192.168.1.50' }]);
  assert.equal(socket.closed, true);
});
