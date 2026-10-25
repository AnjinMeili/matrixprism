#!/usr/bin/env node
// Checks the MIDI buttons (T64) in headless Chrome (midi-check.html): a fake
// MIDI device is connected, a pad is learned for Tap and one for Downbeat, taps
// half a second apart by the messages' own times set 120 BPM, a Downbeat press
// is reported in the Monitor beside four beat lights (one lit), and Forget unbinds.
// Chrome only; real devices and Safari are not covered, and the composer's
// server is not running.
import { runPagePosted } from './headless.mjs';

try {
  const text = await runPagePosted('midi-check.html', { timeoutMs: 60000 });
  console.log(text);
  if (text.startsWith('FAIL')) process.exit(1);
  const r = JSON.parse(text);
  const ok = /Listening to Test Pad/.test(r.connected.status) && r.connected.connectHidden === true &&
    r.learnedTap.binding === 'Note 38 (D2), channel 10' && r.learnedDownbeat.binding === 'Note 36 (C2), channel 10' &&
    r.stored.bindings.tap.number === 38 && r.stored.bindings.downbeat.number === 36 &&
    r.tempo.mode === 'manual' && Math.abs(r.tempo.bpm - 120) < 0.5 && r.error === '' && /^Downbeat pressed/.test(r.button) && /^Downbeat pressed/.test(r.key) && /^Tap pressed/.test(r.tapButton) && /^Downbeat pressed/.test(r.note) && r.dots.total === 4 && r.dots.lit === 1 &&
    r.forgotten.shown === 'Not set' && r.forgotten.stored === null;
  console.log(ok ? 'ok' : 'FAILED');
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
