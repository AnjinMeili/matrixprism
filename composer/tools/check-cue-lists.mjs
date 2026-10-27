#!/usr/bin/env node
// Checks cue lists in the real page (T76), in headless Chrome on real time
// (cue-lists-check.html): Find opens a cue list by part of its artist's
// name; Go starts it on a manual 120 BPM beat clock and each cue lands on
// its bar, 4 seconds apart; Hold stops the bar and lets it go on; Back waits
// for the bar line. Chrome only; the composer's server is not running, so
// nothing streams, and no audio is used.
import { runPagePosted } from './headless.mjs';

try {
  const text = await runPagePosted('cue-lists-check.html', { timeoutMs: 120000 });
  console.log(text);
  if (text.startsWith('FAIL')) process.exit(1);
  const r = JSON.parse(text);
  const bar = (status) => Number(/^Bar (\d+)\./.exec(status ?? '')?.[1]);
  const [first, second, third] = r.changes;
  const near = (value, want, within) => Math.abs(value - want) <= within;
  const ok = r.found.some((name) => /Test Artist – Night Drive/.test(name)) && r.presses >= 1 &&
    r.opened.active === 'cue' && r.opened.button === 'Go' && /3 cues/.test(r.opened.status) &&
    r.changes.length === 3 &&
    first.pattern === 'kaleido' && first.seconds < 0.5 && bar(first.status) === 1 &&
    second.pattern === 'tunnel' && near(second.seconds - first.seconds, 4, 0.25) && bar(second.status) === 3 &&
    third.pattern === 'stars' && near(third.seconds - second.seconds, 4, 0.25) && bar(third.status) === 5 &&
    /held/.test(r.hold.before) && r.hold.before.slice(0, 9) === r.hold.after.slice(0, 9) && r.hold.pressed === 'true' &&
    !/held/.test(r.released) &&
    r.back.atOnce === r.back.beforeBack && r.back.landed?.pattern === 'tunnel' && r.back.landed.seconds <= 2.1 &&
    /Bar \d+\.1 /.test(r.back.landed.status) &&
    r.stopped.button === 'Go' && /press Go/.test(r.stopped.status);
  console.log(ok ? 'ok' : 'FAILED');
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
