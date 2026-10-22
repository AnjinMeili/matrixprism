#!/usr/bin/env node
// Draws a set of scenes through Renderer.render in headless Chrome
// (frame-compare.html) and prints a hash and the lit share of each scene's
// frames, to compare two versions of the renderer frame for frame: run it in
// each (copy the two files into a worktree of the other) and diff the output.
// `--dump "<scene>"` prints that scene's frames, base64, for diff-pixels.mjs.
// `--size WxH` sets the size, 96x64 by default.
import { runPage } from './headless.mjs';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const size = option('--size')?.match(/^(\d+)x(\d+)$/);
const query = [size ? `width=${size[1]}&height=${size[2]}` : '', option('--dump') ? `dump=${encodeURIComponent(option('--dump'))}` : '']
  .filter(Boolean).join('&');
try {
  const text = await runPage('frame-compare.html', { query, budgetMs: 300000, timeoutMs: 600000 });
  console.log(text);
  process.exit(text.startsWith('FAIL') ? 1 : 0);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
