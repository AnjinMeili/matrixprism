#!/usr/bin/env node
// Checks the Pattern settings controls (param-controls.js) in headless Chrome:
// that each kind of control shows the saved value, saves only what differs
// from the defaults, and resets; and that every pattern's controls build.
// It does not look at the layout.
import { runPage } from './headless.mjs';

try {
  const text = await runPage('param-controls-check.html');
  console.log(text);
  if (text.startsWith('FAIL')) process.exit(1);
  const r = JSON.parse(text);
  const expected = JSON.stringify([{ scale: 6.3 }, { scale: 6.3, grid: false }, { scale: 6.3, grid: false, mode: 'b' }, {}]);
  const ok = r.start.scale === '5' && r.start.shown === '5.0' && r.start.grid && r.start.mode === 'a' &&
    r.shownAfterSlide === '6.3' && JSON.stringify(r.saved) === expected &&
    r.afterReset.scale === '3' && r.afterReset.grid && r.afterReset.mode === 'a' &&
    r.realPatterns.controls === r.realPatterns.params;
  console.log(ok ? 'ok' : 'FAILED');
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
