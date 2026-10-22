import dgram from 'node:dgram';
import dns from 'node:dns/promises';

export const DDP_PORT = 4048;
export const DDP_HEADER_LENGTH = 10;
// 480 RGB pixels: keeps datagrams below a 1500-byte Ethernet MTU.
export const DDP_MAX_PAYLOAD = 1440;

const DDP_VERSION_1 = 0x40;
const DDP_FLAG_PUSH = 0x01;
const DDP_TYPE_RGB8 = 0x0b;
const DDP_DESTINATION_DISPLAY = 0x01;

// Splits one row-major RGB frame into DDP packets. Only the final packet
// carries the push flag so the receiver swaps once per complete frame.
export function buildDdpPackets(rgb, sequence, maxPayload = DDP_MAX_PAYLOAD) {
  if (!rgb || rgb.length === 0)
    throw new Error('frame is empty');
  if (maxPayload <= 0 || maxPayload % 3 !== 0)
    throw new Error('payload size must be a positive multiple of 3');
  const source = Buffer.from(rgb.buffer, rgb.byteOffset, rgb.length);
  const packets = [];
  for (let offset = 0; offset < source.length; offset += maxPayload) {
    const length = Math.min(maxPayload, source.length - offset);
    const last = offset + length >= source.length;
    const packet = Buffer.allocUnsafe(DDP_HEADER_LENGTH + length);
    packet[0] = DDP_VERSION_1 | (last ? DDP_FLAG_PUSH : 0);
    packet[1] = sequence & 0x0f;
    packet[2] = DDP_TYPE_RGB8;
    packet[3] = DDP_DESTINATION_DISPLAY;
    packet.writeUInt32BE(offset, 4);
    packet.writeUInt16BE(length, 8);
    source.copy(packet, DDP_HEADER_LENGTH, offset, offset + length);
    packets.push(packet);
  }
  return packets;
}

export class DdpSender {
  constructor(socket = dgram.createSocket('udp4')) {
    this.socket = socket;
    this.address = null;
    this.port = DDP_PORT;
    this.sequence = 0;
    this.stats = { frames: 0, packets: 0, bytes: 0, errors: 0, lastError: '' };
    this.socket.on('error', (error) => this.recordError(error));
  }

  // Resolves once so per-packet sends do not repeat DNS/mDNS lookups.
  async setTarget(host, port = DDP_PORT) {
    const { address } = await dns.lookup(host, { family: 4 });
    this.address = address;
    this.port = port;
    return address;
  }

  sendFrame(rgb) {
    if (!this.address)
      throw new Error('no DDP target configured');
    // DDP sequence numbers run 1-15; 0 means "not used".
    this.sequence = (this.sequence % 15) + 1;
    const packets = buildDdpPackets(rgb, this.sequence);
    for (const packet of packets) {
      this.socket.send(packet, this.port, this.address, (error) => {
        if (error)
          this.recordError(error);
      });
      this.stats.bytes += packet.length;
    }
    this.stats.packets += packets.length;
    this.stats.frames += 1;
    return packets.length;
  }

  recordError(error) {
    this.stats.errors += 1;
    this.stats.lastError = error.message;
  }

  takeStats() {
    const stats = this.stats;
    this.stats = { frames: 0, packets: 0, bytes: 0, errors: 0, lastError: '' };
    return stats;
  }

  close() {
    this.socket.close();
  }
}

// Extracts matrix dimensions from a WLED-style /json/info document.
export function parseMatrixInfo(info) {
  const matrix = info && info.leds && info.leds.matrix;
  if (matrix && Number.isInteger(matrix.w) && Number.isInteger(matrix.h) &&
      matrix.w > 0 && matrix.h > 0) {
    return { width: matrix.w, height: matrix.h, name: String(info.name || '') };
  }
  return null;
}
