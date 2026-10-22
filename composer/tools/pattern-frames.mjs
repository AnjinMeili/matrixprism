#!/usr/bin/env node
// Saves a contact sheet of a pattern's frames as a PNG, drawn through the
// real Renderer in headless Chrome (pattern-frames.html), after two seconds
// of warming up, for a person to look at.
//   node tools/pattern-frames.mjs <pattern id> <out.png> [--size 64x32]
//     [--frames 8] [--every 6] [--scale 4] [--params '{"cooling":1.5}']
import fs from 'node:fs';
import { runPagePosted } from './headless.mjs';

const [id, out] = process.argv.slice(2);
const option = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const [width, height] = option('--size', '64x32').split('x');
const query = new URLSearchParams({ id, width, height, frames: option('--frames', '8'), every: option('--every', '6'),
  scale: option('--scale', '4'), params: option('--params', '{}') });
const text = await runPagePosted('pattern-frames.html', { query: query.toString(), timeoutMs: 120000 });
if (text.startsWith('FAIL')) {
  console.error(text);
  process.exit(1);
}
fs.writeFileSync(out, Buffer.from(text.split(',')[1], 'base64'));
console.log(`wrote ${out}`);
