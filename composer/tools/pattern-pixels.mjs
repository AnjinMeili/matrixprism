#!/usr/bin/env node
// Draws every shader pattern in headless Chrome on seeded simulated audio and
// prints a hash of its frames (pattern-pixels.html), to compare two versions
// pixel for pixel. `--sweep` also draws each pattern parameter at its
// extremes and marks any that leave the picture the SAME, which means the
// parameter does nothing. Chrome only, software WebGL.
import { runPage } from './headless.mjs';

// `--size WxH` sets the picture's size; 64x48 by default. Fine details, such
// as a one-pixel grid, may only show at larger sizes.
const sweep = process.argv.includes('--sweep');
const size = process.argv[process.argv.indexOf('--size') + 1]?.match(/^(\d+)x(\d+)$/);
// `--dump <id>` prints one pattern's frames at its defaults, base64, for
// diff-pixels.mjs.
const dump = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : '';
const query = [sweep ? 'sweep=1' : '', dump ? `dump=${dump}` : '', size && process.argv.includes('--size') ? `width=${size[1]}&height=${size[2]}` : '']
  .filter(Boolean).join('&');
try {
  const text = await runPage('pattern-pixels.html', { query, budgetMs: 120000, timeoutMs: 300000 });
  console.log(text);
  if (text.startsWith('FAIL') || /\tSAME$/m.test(text)) process.exit(1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
