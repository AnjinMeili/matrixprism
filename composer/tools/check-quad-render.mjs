#!/usr/bin/env node
// Checks the renderer's quad mixer paths in headless Chrome
// (quad-render-check.html): the master at Right gives what Left alone gives;
// half way matches the reference blend within a level; input trims match
// trimPixel within a level; the Gated preview with the live settings is the
// live picture; blackout is black; the same stateful pattern on two inputs
// runs as two instances. Today's picture, Left alone, is compared with main
// by frame-compare.mjs.
import { runPage } from './headless.mjs';

try {
  const text = await runPage('quad-render-check.html', { budgetMs: 60000 });
  console.log(text);
  if (text.startsWith('FAIL')) process.exit(1);
  const r = JSON.parse(text);
  // A check passed on black frames proves nothing, so the frames must be lit.
  const ok = r.rightAtFull.worst === 0 && r.rightAtFull.lit > 0.2 && r.halfWay.worst <= 1 &&
    r.trim.brightnessHalf <= 1 && r.trim.gammaTwo <= 1 && r.trim.both <= 1 && r.preview.worst === 0 &&
    r.blackout.max === 0 && JSON.stringify(r.instances) === JSON.stringify([`a:${r.statefulId}`, `c:${r.statefulId}`]);
  console.log(ok ? 'ok' : 'FAILED');
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
