import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyDetector, keyColourHue, camelotKey, compatibleCamelotKeys, shownKey, keyAtCamelot, CHOSEN_KEY_SECONDS } from '../public/key-detector.js';
import { segmentAt, relativeScores } from '../public/key-wheel.js';
import { keySource } from '../public/monitor.js';
import { AudioAnalyzer } from '../public/audio.js';

const profiles = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
const fftSize = 8192;

function spectrum(tonic, mode, sampleRate = 48000) {
  const fft = new Float32Array(fftSize / 2).fill(-100);
  for (let midi = 48; midi < 84; ++midi) {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const bin = frequency * fftSize / sampleRate;
    const amplitude = profiles[mode][(midi - tonic + 120) % 12];
    for (let i = Math.floor(bin) - 1; i <= Math.ceil(bin) + 1; ++i)
      fft[i] = Math.max(fft[i], -30 + 20 * Math.log10(amplitude / 6.35) - 12 * (i - bin) ** 2);
  }
  return fft;
}

function feed(detector, fft, seconds, sampleRate = 48000) {
  for (let i = 0; i < Math.round(seconds * 10); ++i)
    detector.update(fft, sampleRate, fftSize, 0.1);
  return detector.result;
}

test('key detector recognizes all 24 transposed profile spectra at common sample rates', () => {
  for (const sampleRate of [44100, 48000]) {
    for (const mode of ['major', 'minor']) {
      for (let tonic = 0; tonic < 12; ++tonic) {
        const detector = new KeyDetector();
        const result = feed(detector, spectrum(tonic, mode, sampleRate), 6, sampleRate);
        assert.ok(result, `${tonic} ${mode} at ${sampleRate}`);
        assert.equal(result.tonic, tonic);
        assert.equal(result.mode, mode);
        assert.ok(result.confidence > 0 && result.confidence <= 1);
      }
    }
  }
});

test('key detection waits for context, adapts to a new key, and clears its evidence in silence', () => {
  const detector = new KeyDetector();
  assert.equal(feed(detector, spectrum(0, 'major'), 2), null);
  assert.equal(feed(detector, spectrum(0, 'major'), 4).name, 'C major');
  assert.equal(detector.result.held, false);
  assert.equal(feed(detector, spectrum(6, 'minor'), 24).name, 'F# minor');
  feed(detector, new Float32Array(fftSize / 2).fill(-Infinity), 2.1);
  assert.equal(detector.evidenceSeconds, 0);
});

// A single pitch: sound, but nothing a key can be read from.
function oneNote(midi) {
  const fft = new Float32Array(fftSize / 2).fill(-100);
  fft[Math.round(440 * 2 ** ((midi - 69) / 12) * fftSize / 48000)] = -25;
  return fft;
}

test('the last key found stands through uncertainty and silence until another is found', () => {
  const detector = new KeyDetector();
  const found = feed(detector, spectrum(0, 'major'), 6);
  assert.equal(found.name, 'C major');
  assert.ok(found.confidence > 0);

  // Sound with no readable key: C major is held, marked so, with no confidence.
  const uncertain = feed(detector, oneNote(60), 30);
  assert.equal(uncertain.name, 'C major');
  assert.equal(uncertain.camelot.label, '8B');
  assert.equal(uncertain.held, true);
  assert.equal(uncertain.confidence, 0);

  // Silence clears what was heard, not the key.
  const silent = feed(detector, new Float32Array(fftSize / 2).fill(-Infinity), 5);
  assert.equal(silent.name, 'C major');
  assert.equal(silent.held, true);
  assert.equal(detector.evidenceSeconds, 0);

  // Another key replaces it only once it is found; until then C major stands.
  const names = new Set();
  let changedAt = null;
  for (let i = 0; i < 300 && changedAt === null; ++i) {
    const result = detector.update(spectrum(6, 'minor'), 48000, fftSize, 0.1);
    names.add(result.name);
    if (result.name === 'F# minor')
      changedAt = result;
    else
      assert.equal(result.held, true, 'the old key is held while the new one is not yet found');
  }
  assert.equal(changedAt.held, false);
  assert.ok(changedAt.confidence > 0);
  assert.ok(names.has('C major'));

  // The same key heard again after a spell of uncertainty is live again.
  feed(detector, oneNote(66), 30);
  assert.equal(detector.result.name, 'F# minor');
  assert.equal(detector.result.held, true);
  const again = feed(detector, spectrum(6, 'minor'), 10);
  assert.equal(again.name, 'F# minor');
  assert.equal(again.held, false);

  detector.reset();
  assert.equal(detector.result, null);
  assert.equal(detector.heldKey(), null);
});

test('silence, isolated notes, triads, and broadband noise do not claim a musical key', () => {
  for (const midiNotes of [[], [69], [60, 64, 67]]) {
    const fft = new Float32Array(fftSize / 2).fill(-100);
    for (const midi of midiNotes) {
      const bin = Math.round(440 * 2 ** ((midi - 69) / 12) * fftSize / 48000);
      fft[bin] = -25;
    }
    assert.equal(feed(new KeyDetector(), fft, 10), null);
  }
  assert.equal(feed(new KeyDetector(), new Float32Array(fftSize / 2).fill(-30), 10), null);
});

test('a held key is shown only when the last key is to be kept', () => {
  const heard = { name: 'C major', held: false };
  const held = { name: 'C major', held: true };
  assert.equal(shownKey(heard, true), heard);
  assert.equal(shownKey(heard, false), heard);
  assert.equal(shownKey(held, true), held);
  assert.equal(shownKey(held, false), null);
  assert.equal(shownKey(null, true), null);
  assert.equal(shownKey(null, false), null);
});

test('key colour smoothly offsets manual hue, returns on uncertainty, and can be disabled', () => {
  const result = { hue: 0.9 };
  let colour = keyColourHue(0.25, true, result, 0, 0.1);
  assert.ok(colour.offset > 0.9, 'take the shorter path across the hue wrap');
  for (let i = 0; i < 200; ++i)
    colour = keyColourHue(0.25, true, result, colour.offset, 0.1);
  assert.ok(Math.abs(colour.hue - 0.15) < 0.00001);
  for (let i = 0; i < 200; ++i)
    colour = keyColourHue(0.25, false, result, colour.offset, 0.1);
  assert.ok(Math.abs(colour.hue - 0.25) < 0.00001);
  assert.deepEqual(keyColourHue(0.25, true, null, 0, 0.1), { offset: 0, hue: 0.25 });
});

test('audio source changes clear key evidence and simulated audio does not invent a key', () => {
  const audio = new AudioAnalyzer();
  audio.key = feed(audio.keyDetector, spectrum(0, 'major'), 6);
  audio.startSimulated();
  for (let i = 0; i < 60; ++i) audio.update(0.1, 1);
  assert.equal(audio.key, null);
  assert.equal(audio.keyDetector.evidenceSeconds, 0);
  audio.stop();
  assert.equal(audio.key, null);
});

test('invalid detector inputs raise explicit errors', () => {
  const detector = new KeyDetector();
  assert.throws(() => detector.update([], 48000, fftSize, 0.1), /valid FFT/);
  assert.throws(() => detector.update(spectrum(0, 'major'), 0, fftSize, 0.1), /valid FFT/);
  assert.throws(() => detector.update(spectrum(0, 'major'), 48000, fftSize, NaN), /valid FFT/);
});

test('Camelot mapping matches all DJ major and minor wheel positions', () => {
  const major = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
  const minor = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
  for (let tonic = 0; tonic < 12; ++tonic) {
    assert.equal(camelotKey(tonic, 'major').label, `${major[tonic]}B`);
    assert.equal(camelotKey(tonic, 'minor').label, `${minor[tonic]}A`);
    assert.equal(camelotKey(tonic, 'major').hue, camelotKey((tonic + 9) % 12, 'minor').hue);
  }
  assert.deepEqual(compatibleCamelotKeys(camelotKey(9, 'minor')), ['7A', '9A', '8B']);
  assert.deepEqual(compatibleCamelotKeys(camelotKey(7, 'major')), ['8B', '10B', '9A']);
  assert.deepEqual(compatibleCamelotKeys({ number: 1, letter: 'A' }), ['12A', '2A', '1B']);
  assert.deepEqual(compatibleCamelotKeys({ number: 12, letter: 'B' }), ['11B', '1B', '12A']);
  assert.throws(() => camelotKey(12, 'major'), /Camelot key/);
});

test('the detector keeps every key\'s score, by Camelot label, with the key found the best', () => {
  const detector = new KeyDetector();
  assert.equal(detector.scores, null);
  feed(detector, spectrum(9, 'minor'), 6);
  assert.equal(Object.keys(detector.scores).length, 24);
  const best = Object.entries(detector.scores).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(best, '8A');
  assert.equal(detector.result.camelot.label, '8A');
  detector.reset();
  assert.equal(detector.scores, null);
});

test('a key the operator chooses is the result at once, and gives way only to music that says otherwise for long', () => {
  const detector = new KeyDetector();
  assert.equal(feed(detector, spectrum(0, 'major'), 6).name, 'C major');
  const chosen = detector.choose(0, 'minor');
  assert.equal(chosen.camelot.label, '5A');
  assert.equal(chosen.chosen, 'chosen');
  assert.equal(chosen.held, false);
  // C major goes on playing: the operator's key stands for a while...
  assert.equal(feed(detector, spectrum(0, 'major'), CHOSEN_KEY_SECONDS - 1).name, 'C minor');
  // ...and is replaced once the music has said C major for CHOSEN_KEY_SECONDS.
  const after = feed(detector, spectrum(0, 'major'), 2);
  assert.equal(after.name, 'C major');
  assert.equal(after.chosen, undefined);
});

test('music agreeing with a chosen key, and silence, leave it the operator\'s', () => {
  const detector = new KeyDetector();
  detector.choose(9, 'minor');
  assert.equal(feed(detector, spectrum(9, 'minor'), 20).chosen, 'chosen');
  const quiet = feed(detector, new Float32Array(fftSize / 2).fill(-Infinity), 3);
  assert.equal(quiet.name, 'A minor');
  assert.equal(quiet.held, false);
  assert.equal(shownKey(quiet, false), quiet);
});

test('a locked key stays whatever the music says, until released to the detector', () => {
  const detector = new KeyDetector();
  detector.choose(0, 'minor', true);
  assert.equal(feed(detector, spectrum(6, 'major'), 30).name, 'C minor');
  assert.equal(detector.result.chosen, 'locked');
  assert.equal(detector.release(), null);
  assert.equal(feed(detector, spectrum(6, 'major'), 1.5).name, 'F# major');
  // Releasing a key the detector found itself forgets nothing.
  assert.equal(detector.release().name, 'F# major');
});

test('keyAtCamelot is camelotKey\'s inverse for all 24 keys', () => {
  for (const mode of ['major', 'minor'])
    for (let tonic = 0; tonic < 12; ++tonic) {
      const { number, letter } = camelotKey(tonic, mode);
      const key = keyAtCamelot(number, letter);
      assert.deepEqual([key.tonic, key.mode], [tonic, mode]);
    }
  assert.equal(keyAtCamelot(5, 'A').name, 'C minor');
  assert.equal(keyAtCamelot(8, 'B').name, 'C major');
});

test('the wheel puts 12 at the top, numbers clockwise, minor inside and major outside', () => {
  const at = (x, y) => segmentAt(x, y, 100);
  assert.deepEqual(at(50, 50 - 40), { number: 12, letter: 'B' });
  assert.deepEqual(at(50, 50 - 25), { number: 12, letter: 'A' });
  assert.deepEqual(at(50 + 40, 50), { number: 3, letter: 'B' });
  assert.deepEqual(at(50, 50 + 25), { number: 6, letter: 'A' });
  assert.deepEqual(at(50 - 40, 50), { number: 9, letter: 'B' });
  // Half a sector either side of a number still names it.
  const r = 40, turn = (n) => [50 + r * Math.sin(n / 12 * 2 * Math.PI), 50 - r * Math.cos(n / 12 * 2 * Math.PI)];
  assert.equal(at(...turn(4.45)).number, 4);
  assert.equal(at(...turn(4.55)).number, 5);
  assert.equal(at(...turn(11.6)).number, 12);
  // The hub and outside the rim are no key.
  assert.equal(at(50, 50), null);
  assert.equal(at(50, 1), null);
  assert.equal(at(0, 0), null);
});

test('the wheel shades keys between the weakest and strongest score', () => {
  assert.deepEqual(relativeScores(null), {});
  assert.deepEqual(relativeScores({ '1A': -0.5, '1B': 0.5, '2A': 0 }), { '1A': 0, '1B': 1, '2A': 0.5 });
  assert.deepEqual(relativeScores({ '1A': 0.2, '1B': 0.2 }), { '1A': 0, '1B': 0 });
});

test('the log says who says the key', () => {
  assert.equal(keySource(null), '');
  const detector = new KeyDetector();
  feed(detector, spectrum(0, 'major'), 6);
  assert.equal(keySource(detector.result), 'detector');
  assert.equal(keySource(detector.heldKey()), 'held');
  assert.equal(keySource(detector.choose(0, 'minor')), 'chosen');
  assert.equal(keySource(detector.choose(0, 'minor', true)), 'locked');
});
