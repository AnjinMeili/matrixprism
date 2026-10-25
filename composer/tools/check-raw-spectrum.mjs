#!/usr/bin/env node
// Draws a shader that paints each column with rawBand() at its frequency
// through the real renderer in headless Chrome, with known patches of sound at
// several FFT sizes and sample rates, and checks the columns at the sound are
// bright and those far from it dark (T62). Run with `npm run
// check-raw-spectrum` after changing spectrum-bands.js, the renderer's raw
// texture or the prelude's rawSpec. It does not look at the picture.
import { runPage } from './headless.mjs';

try {
  const lines = (await runPage('raw-spectrum-check.html')).split('\n').filter(Boolean);
  const failed = lines.filter((line) => !line.startsWith('ok '));
  console.log(lines.join('\n'));
  console.log(failed.length ? `\n${failed.length} failed.` : `\nAll ${lines.length} matched.`);
  process.exit(failed.length ? 1 : 0);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
