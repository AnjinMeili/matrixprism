#!/usr/bin/env node
// A measurement, not a check: prints each pattern's mean output level with
// the app's clocks started as if the page had been open for hours, and with
// the input quieter by some decibels (long-run-brightness.html), to tell a
// pattern that dims over time from one that follows the input's level.
// `--patterns a,b` picks patterns (every shader pattern by default);
// `--size WxH`; `--gain g` (1.5, the app's default). Chrome only, software
// WebGL, whose float maths may differ from a real GPU's.
import { runPage } from './headless.mjs';

const arg = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const size = arg('--size')?.match(/^(\d+)x(\d+)$/);
const query = [arg('--patterns') ? `patterns=${arg('--patterns')}` : '', size ? `width=${size[1]}&height=${size[2]}` : '',
  arg('--gain') ? `gain=${arg('--gain')}` : ''].filter(Boolean).join('&');
try {
  const text = await runPage('long-run-brightness.html', { query, budgetMs: 300000, timeoutMs: 900000 });
  console.log(text);
  if (text.startsWith('FAIL')) process.exit(1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
