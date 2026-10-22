#!/usr/bin/env node
// Draws the Panel Range test card's shader in headless Chrome at five panel
// sizes and three times, and checks that every pixel is the level the
// JavaScript reference, cardLevels() in test-card.js, says it should be. Run
// with `npm run check-test-card` after changing test-card.js. It checks the
// card's own shader, not the compositor after it.
import { runPage } from './headless.mjs';

try {
  const lines = (await runPage('test-card-check.html')).split('\n').filter(Boolean);
  const failed = lines.filter((line) => !line.startsWith('ok '));
  console.log(lines.join('\n'));
  console.log(failed.length ? `\n${failed.length} failed.` : `\nAll ${lines.length} matched.`);
  process.exit(failed.length ? 1 : 0);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
