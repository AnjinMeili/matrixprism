#!/usr/bin/env node
// Checks Hotsave in headless Chrome (hotsave-check.html): the key saves the
// look with its pattern settings to a playlist made for it, and showing the
// entry later puts the look and its controls back. Chrome only; the
// composer's server is not running, so nothing streams.
import { runPage } from './headless.mjs';

try {
  const text = await runPage('hotsave-check.html', { budgetMs: 20000 });
  console.log(text);
  if (text.startsWith('FAIL')) process.exit(1);
  const r = JSON.parse(text);
  const e = r.saved.entry, b = r.restored;
  const ok = r.takenKey.shown === 'S' && /taken/.test(r.takenKey.error) &&
    r.saved.playlist === 'Hotsave' && r.saved.entries === 1 && /^Hotsave \d\d:\d\d:\d\d$/.test(e.name) &&
    e.patternId === 'plasma' && e.params.plasma.scale === 5.5 && e.hue === 0.4 && e.speed === 2 && e.sparkles === true &&
    /Hotsaved/.test(r.notice) &&
    b.patternId === 'plasma' && b.scale === 5.5 && b.hue === 0.4 && b.speed === 2 && b.sparkles === true &&
    b.controls.scale === '5.5' && b.controls.hue === '0.4' && b.controls.hueShown === '144°' &&
    b.controls.speed === '2' && b.controls.sparkles === true && r.second === 2;
  console.log(ok ? 'ok' : 'FAILED');
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
