#!/usr/bin/env node
// Checks the Essentia beat source's live path in headless Chrome
// (essentia-live-check.html): Chrome's fake microphone into the composer's
// analyser, the audio tap (pcm-capture-worklet.js), the worker
// (essentia-worker.js) and Essentia's WebAssembly. Passes if Essentia loads,
// waits for its ten seconds and makes estimates without an error. Chrome
// only, about 25 seconds of real time; it does not judge the tempo, since the
// fake microphone plays beeps, not music.
import { runPagePosted } from './headless.mjs';

try {
  const text = await runPagePosted('essentia-live-check.html', {
    query: 'seconds=20', timeoutMs: 120000,
    flags: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  if (text.startsWith('FAIL')) throw new Error(text);
  const result = JSON.parse(text);
  const path = result.states.map((s) => `${s.status} (${s.at} s)`).join(' → ');
  console.log(`Essentia states: ${path}`);
  console.log(`Context ${result.contextState} at ${result.sampleRate} Hz; tempo ${result.bpm?.toFixed(1) ?? 'none'}, ` +
    `confidence ${Math.round(result.confidence * 100)}%`);
  const statuses = result.states.map((s) => s.status);
  const failed = statuses.find((s) => !['off', 'loading', 'waiting', 'running'].includes(s));
  if (failed || !statuses.includes('running')) {
    console.error(failed ? `Failed: ${failed}` : 'Failed: Essentia never made an estimate.');
    process.exit(1);
  }
  console.log('ok');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
