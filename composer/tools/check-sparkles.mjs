#!/usr/bin/env node
// Draws the compositor's sparkles (sparkle.js) in headless Chrome for several
// sets of hits and settings, at two panel sizes, and checks every pixel
// against the JavaScript reference, sparkleLight(). A level off by one is
// allowed for float rounding. Run with `npm run check-sparkles` after
// changing sparkle.js. It checks the sparkle rule, not the compositor around
// it, which `npm run check-shaders` compiles.
import { runPage } from './headless.mjs';

try {
  const lines = (await runPage('sparkle-check.html')).split('\n').filter(Boolean);
  const failed = lines.filter((line) => !line.startsWith('ok '));
  console.log(lines.join('\n'));
  console.log(failed.length ? `\n${failed.length} failed.` : `\nAll ${lines.length} matched.`);
  process.exit(failed.length ? 1 : 0);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
