#!/usr/bin/env node
// Checks the Pattern settings controls (param-controls.js) in headless Chrome:
// that each kind of control shows the saved value, saves only what differs
// from the defaults, and resets, a number's Follows and Amount too (#21), and
// a Variation's Keep, New, Back and Return (T72); and that every pattern's
// controls build.
// It does not look at the layout.
import { runPage } from './headless.mjs';

try {
  const text = await runPage('param-controls-check.html');
  console.log(text);
  if (text.startsWith('FAIL')) process.exit(1);
  const r = JSON.parse(text);
  const changed = { scale: 6.3, grid: false, mode: 'b' };
  const expected = JSON.stringify([{ scale: 6.3 }, { scale: 6.3, grid: false }, changed,
    { ...changed, follows: { scale: { source: 'lows', amount: 0.5 } } },
    { ...changed, follows: { scale: { source: 'lows', amount: -0.3 } } }, {}]);
  const ok = r.start.scale === '5' && r.start.shown === '5.0' && r.start.grid && r.start.mode === 'a' &&
    r.shownAfterSlide === '6.3' && JSON.stringify(r.saved) === expected &&
    r.followStart.source === 'off' && r.followStart.amountDisabled &&
    !r.followShown.amountDisabled && r.followShown.percent === '-30%' &&
    r.afterReset.scale === '3' && r.afterReset.grid && r.afterReset.mode === 'a' &&
    r.afterReset.follow === 'off' && r.afterReset.amount === '0.5' &&
    r.fromSaved.follow === 'key' && r.fromSaved.amount === '0.25' &&
    r.realPatterns.controls === r.realPatterns.params &&
    JSON.stringify(r.variation) === JSON.stringify({
      shown: '#4242', keptAtStart: false, returnDisabled: true,
      newWhileFree: { used: 1, saved: 0, shown: true },
      backWhileFree: { used: 4141, shown: '#4141' },
      kept: { saved: { variation: 4141 }, calls: [['keep', 4141]], returnDisabled: false },
      newWhileKept: { usedMore: 2, saved: true },
      returned: 'return',
      unkept: {},
      refreshed: '#5555',
      withoutHooks: 0,
    });
  console.log(ok ? 'ok' : 'FAILED');
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
