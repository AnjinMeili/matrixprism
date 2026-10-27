#!/usr/bin/env node
// Checks a pattern's variation in the real page (T72), in headless Chrome on
// real time (variations-check.html): the seed on screen is shown and saved
// by Hotsave, New and Back step through seeds, showing the saved entry
// brings the variation back kept, and Return comes back to it. Chrome only;
// the composer's server is not running, so nothing streams.
import { runPagePosted } from './headless.mjs';

try {
  const text = await runPagePosted('variations-check.html', { timeoutMs: 120000 });
  console.log(text);
  if (text.startsWith('FAIL')) process.exit(1);
  const r = JSON.parse(text);
  const seed = (shown) => Number(/^#(\d+)$/.exec(shown)?.[1]);
  const first = seed(r.first);
  const ok = first > 0 && r.savedVariation === first &&
    seed(r.rolled) > 0 && r.rolled !== r.first && r.back === r.first &&
    seed(r.rolledAgain) > 0 && r.rolledAgain !== r.first &&
    r.restored.shown === r.first && r.restored.kept === true && r.restored.setting === first &&
    r.newWhileKept.shown !== r.first && r.newWhileKept.setting === seed(r.newWhileKept.shown) &&
    r.returned.shown === r.first && r.returned.setting === first &&
    r.unkept.variation === undefined;
  console.log(ok ? 'ok' : 'FAILED');
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
