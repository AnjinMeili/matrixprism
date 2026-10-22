#!/usr/bin/env node
// Opens the live input twice at once in headless Chrome
// (input-sharing-check.html), as two copies of the composer would, and prints
// what Chrome applied to each: the voice processing left on, if any, and
// whether either input was muted. Chrome's fake microphone only, so it does
// not reach macOS's audio devices, and it does not cover Safari, which lets
// one page use an input at a time.
import { runPagePosted } from './headless.mjs';

try {
  const text = await runPagePosted('input-sharing-check.html', { timeoutMs: 60000,
    flags: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  console.log(text);
  const result = JSON.parse(text);
  if (result.error || result.first.leftOn.length || result.second.leftOn.length ||
      result.afterOneSecond.first !== 'live' || result.afterOneSecond.second !== 'live')
    process.exit(1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
