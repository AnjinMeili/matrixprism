// Finds receivers on the local network by multicast DNS (RFC 6762): one
// question for _wled._tcp.local, which WLED and matrix-dmx both answer.
//
// The question is sent from an ordinary port, not 5353, which macOS's own
// responder holds. That makes it a "legacy unicast" query: responders answer
// to the asking port directly (RFC 6762, 6.7), so nothing has to join the
// multicast group or share port 5353.
//
// Replies come from anything on the network, so they are parsed with bounds
// checked throughout, a cap on name-compression jumps, and names kept to
// host-name characters before they reach the page.
import dgram from 'node:dgram';

export const WLED_SERVICE = '_wled._tcp.local';
const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;
const TYPE = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33 };
const MAX_JUMPS = 32;
const MAX_RECEIVERS = 64;
const HOST_NAME = /^[A-Za-z0-9.-]{1,253}$/;

// A DNS name as labels: `wled-e1f2a3.local` becomes 11 "wled-e1f2a3" 5 "local" 0.
export function encodeName(name) {
  const parts = name.replace(/\.$/, '').split('.').map((label) => {
    const bytes = Buffer.from(label, 'utf8');
    if (!bytes.length || bytes.length > 63) throw new Error(`bad DNS label in ${name}`);
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

// One question for the PTR records of `service`.
export function buildQuery(service = WLED_SERVICE, id = 0) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(TYPE.PTR, 0);
  tail.writeUInt16BE(1, 2);
  return Buffer.concat([header, encodeName(service), tail]);
}

// Reads the name at `offset`, following compression pointers. Returns the
// name and where the record carries on after it.
function readName(buf, offset) {
  const labels = [];
  let at = offset, end = -1, jumps = 0;
  for (;;) {
    if (at >= buf.length) throw new Error('name runs past the message');
    const length = buf[at];
    if (length === 0) {
      if (end < 0) end = at + 1;
      break;
    }
    if ((length & 0xc0) === 0xc0) {
      if (at + 1 >= buf.length) throw new Error('pointer runs past the message');
      if (++jumps > MAX_JUMPS) throw new Error('too many name pointers');
      if (end < 0) end = at + 2;
      at = ((length & 0x3f) << 8) | buf[at + 1];
      continue;
    }
    if (length & 0xc0) throw new Error('unknown label type');
    if (at + 1 + length > buf.length) throw new Error('label runs past the message');
    labels.push(buf.toString('utf8', at + 1, at + 1 + length));
    at += 1 + length;
  }
  return { name: labels.join('.'), end };
}

// The answer, authority and additional records of a DNS message, as
// { name, type, data }: a PTR's data is a name, an SRV's { port, target },
// an A's a dotted address; other types are skipped. Throws on a malformed
// message.
export function parseMessage(buf) {
  if (buf.length < 12) throw new Error('message too short');
  const questions = buf.readUInt16BE(4);
  const records = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let at = 12;
  for (let i = 0; i < questions; ++i) {
    at = readName(buf, at).end + 4;
    if (at > buf.length) throw new Error('question runs past the message');
  }
  const out = [];
  for (let i = 0; i < records; ++i) {
    const { name, end } = readName(buf, at);
    if (end + 10 > buf.length) throw new Error('record runs past the message');
    const type = buf.readUInt16BE(end);
    const length = buf.readUInt16BE(end + 8);
    const start = end + 10;
    if (start + length > buf.length) throw new Error('record data runs past the message');
    if (type === TYPE.PTR) out.push({ name, type: 'PTR', data: readName(buf, start).name });
    else if (type === TYPE.SRV && length >= 7)
      out.push({ name, type: 'SRV', data: { port: buf.readUInt16BE(start + 4), target: readName(buf, start + 6).name } });
    else if (type === TYPE.A && length === 4)
      out.push({ name, type: 'A', data: [...buf.subarray(start, start + 4)].join('.') });
    at = start + length;
  }
  return out;
}

const lower = (name) => name.toLowerCase().replace(/\.$/, '');

// The receivers in a set of parsed replies, each { name, host, address }:
// `name` the instance's own name, `host` its .local name, `address` its IPv4
// address (from an A record, else where the reply came from). `replies` are
// { records, from }. Names that are not host-name characters are left out.
export function receiversFrom(replies, service = WLED_SERVICE) {
  const records = replies.flatMap(({ records, from }) => records.map((record) => ({ ...record, from })));
  const byName = (type, name) => records.find((r) => r.type === type && lower(r.name) === lower(name));
  const found = new Map();
  for (const ptr of records.filter((r) => r.type === 'PTR' && lower(r.name) === lower(service))) {
    const instance = ptr.data;
    const srv = byName('SRV', instance);
    const host = srv ? lower(srv.data.target) : '';
    const address = (host && byName('A', host)?.data) || ptr.from || '';
    const name = instance.slice(0, instance.length - service.length).replace(/\.$/, '');
    if (!HOST_NAME.test(host || 'x') || !/^[\d.]*$/.test(address)) continue;
    const key = host || address;
    if (key && !found.has(key)) found.set(key, { name: name.slice(0, 63), host, address });
    if (found.size >= MAX_RECEIVERS) break;
  }
  return [...found.values()].sort((a, b) => (a.host || a.address).localeCompare(b.host || b.address));
}

// Asks the network and returns the receivers that answered within
// `timeoutMs`. `createSocket` is for tests.
export function discoverReceivers({ timeoutMs = 1500, createSocket = () => dgram.createSocket('udp4') } = {}) {
  return new Promise((resolve, reject) => {
    const socket = createSocket();
    const replies = [];
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      if (error) reject(error);
      else resolve(receiversFrom(replies));
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    socket.on('error', finish);
    socket.on('message', (message, from) => {
      // Up to a few hundred replies; anything malformed is skipped.
      if (replies.length >= 512) return;
      try {
        replies.push({ records: parseMessage(message), from: from.address });
      } catch { /* not a reply we can read */ }
    });
    socket.bind(0, () => {
      try {
        socket.setMulticastTTL(255);
      } catch { /* not needed for the question to go out */ }
      socket.send(buildQuery(), MDNS_PORT, MDNS_ADDRESS, (error) => { if (error) finish(error); });
    });
  });
}
