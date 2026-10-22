import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioAnalyzer, inputConstraints, processingLeftOn } from '../public/audio.js';

test('the input asked for is the chosen device only, with all voice processing off', () => {
  const { audio, video } = inputConstraints('abc');
  assert.deepEqual(audio.deviceId, { exact: 'abc' });
  assert.equal(video, false);
  for (const name of ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'voiceIsolation'])
    assert.equal(audio[name], false, name);
  assert.equal(inputConstraints('').audio.deviceId, undefined);
});

test('processing the browser left on is named; unreported processing is not', () => {
  assert.deepEqual(processingLeftOn({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }), []);
  assert.deepEqual(processingLeftOn({ echoCancellation: true, autoGainControl: true }),
    ['echo cancellation', 'gain control']);
  assert.deepEqual(processingLeftOn(null), []);
});

function fakeTrack(muted = false) {
  return { muted, readyState: 'live', getSettings: () => ({ echoCancellation: false }) };
}

test('a track muted, unmuted or ended by the browser is followed, and stop clears it', () => {
  const audio = new AudioAnalyzer();
  const track = fakeTrack();
  audio.watchInput(track);
  assert.equal(audio.inputState, 'live');
  assert.deepEqual(audio.inputSettings, { echoCancellation: false });
  track.onmute();
  assert.equal(audio.inputState, 'muted');
  track.onunmute();
  assert.equal(audio.inputState, 'live');
  track.onended();
  assert.equal(audio.inputState, 'ended');
  audio.stop();
  assert.equal(audio.inputState, null);
  assert.equal(track.onmute, null);
});

test('a track already muted when it arrives starts as muted', () => {
  const audio = new AudioAnalyzer();
  audio.watchInput(fakeTrack(true));
  assert.equal(audio.inputState, 'muted');
});
