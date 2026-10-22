#!/usr/bin/env node
// Compares two dumps from `pattern-pixels.mjs --dump <id>`: how many channel
// values differ, by how much at most, and how many pixels hold a difference.
import fs from 'node:fs';

const [a, b] = process.argv.slice(2).map((file) => Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64'));
if (a.length !== b.length) throw new Error(`sizes differ: ${a.length} and ${b.length}`);
let values = 0, max = 0, pixels = 0;
const histogram = new Map();
for (let i = 0; i < a.length; i += 3) {
  let differs = false;
  for (let c = 0; c < 3; ++c) {
    const d = Math.abs(a[i + c] - b[i + c]);
    if (!d) continue;
    ++values;
    differs = true;
    max = Math.max(max, d);
    histogram.set(d, (histogram.get(d) ?? 0) + 1);
  }
  if (differs) ++pixels;
}
const share = (n, of) => `${n} of ${of} (${(100 * n / of).toFixed(3)}%)`;
console.log(`channel values differing: ${share(values, a.length)}; pixels: ${share(pixels, a.length / 3)}; largest difference ${max}`);
console.log(`by size: ${[...histogram].sort((x, y) => x[0] - y[0]).map(([d, n]) => `${d}: ${n}`).join(', ') || 'none'}`);
