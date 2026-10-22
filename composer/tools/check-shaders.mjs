#!/usr/bin/env node
// Compiles the compositor and every shader pattern in headless Chrome, which
// the Node tests cannot do. Run with `npm run check-shaders`. See headless.mjs
// for how the page is run.
import { runPage } from './headless.mjs';

try {
  const lines = (await runPage('shader-check.html')).split('\n').filter(Boolean);
  const failed = lines.filter((line) => !line.startsWith('ok '));
  console.log(lines.join('\n'));
  console.log(failed.length ? `\n${failed.length} failed.` : `\nAll ${lines.length} compiled.`);
  process.exit(failed.length ? 1 : 0);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
