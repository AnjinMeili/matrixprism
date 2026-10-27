// Draws the placeholder icon, build/icon.png (1024 by 1024), with no dependencies:
// a dark rounded square holding a 4 by 4 grid of coloured "pixels", as on a panel.
// To be replaced by a real icon.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const SIZE = 1024;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
const rgba = Buffer.alloc(SIZE * SIZE * 4);
const hue = (h) => [0, 4, 2].map((n) => Math.round(255 * Math.min(1, Math.max(0, Math.abs(((h * 6 + n) % 6) - 3) - 1))));
const inRounded = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
  const cx = x < x0 + r ? x0 + r : x >= x1 - r ? x1 - r - 1 : x;
  const cy = y < y0 + r ? y0 + r : y >= y1 - r ? y1 - r - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const margin = 100, cell = (SIZE - 2 * margin - 3 * 36) / 4;
for (let y = 0; y < SIZE; ++y) {
  for (let x = 0; x < SIZE; ++x) {
    let colour = null;
    if (inRounded(x, y, 40, 40, SIZE - 40, SIZE - 40, 190)) colour = [18, 20, 30];
    if (colour) {
      for (let i = 0; i < 4; ++i) for (let j = 0; j < 4; ++j) {
        const x0 = margin + i * (cell + 36), y0 = margin + j * (cell + 36);
        if (inRounded(x, y, Math.round(x0), Math.round(y0), Math.round(x0 + cell), Math.round(y0 + cell), 34))
          colour = hue((i + j * 4) / 16 * 0.8);
      }
    }
    const at = (y * SIZE + x) * 4;
    if (colour) rgba.set([...colour, 255], at);
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; ++k) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, sum]);
};
const header = Buffer.alloc(13); header.writeUInt32BE(SIZE, 0); header.writeUInt32BE(SIZE, 4); header.set([8, 6, 0, 0, 0], 8);
const rows = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; ++y) { rows[y * (SIZE * 4 + 1)] = 0; rgba.copy(rows, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4); }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${path.relative(process.cwd(), out)}`);
