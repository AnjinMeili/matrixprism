import assert from 'node:assert/strict';
import test from 'node:test';
import { RECEIVER_DEFAULTS, SendLimiter, receiverKey, receiverProfile, receiverSettings } from '../public/receivers.js';

// Settings kept for each receiver, and the limit on frames sent.

test('a receiver keeps brightness, gamma and its most frames a second, within the controls\' ranges', () => {
  assert.deepEqual(receiverProfile(), RECEIVER_DEFAULTS);
  assert.deepEqual(receiverProfile({ brightness: 0.4, gamma: 2.2, maxFps: 12, other: 1 }),
    { brightness: 0.4, gamma: 2.2, maxFps: 12 });
  for (const bad of [{ brightness: 1.2 }, { gamma: 0.5 }, { gamma: 3 }, { maxFps: 0 }, { maxFps: 61 }, { maxFps: 7.5 },
    { brightness: '1' }])
    assert.throws(() => receiverProfile(bad), undefined, JSON.stringify(bad));
});

test('receivers are kept by host, case and spaces aside, and a bad one is dropped alone', () => {
  assert.equal(receiverKey(' WLED-E1F2A3.local '), 'wled-e1f2a3.local');
  assert.equal(receiverKey(undefined), '');
  const { receivers, dropped } = receiverSettings({
    'Panel.local': { brightness: 0.5 }, '192.168.1.40': { gamma: 9 }, ' ': { brightness: 0.1 },
  });
  assert.deepEqual(receivers, { 'panel.local': { brightness: 0.5, gamma: 1, maxFps: null } });
  assert.deepEqual(dropped, ['192.168.1.40']);
  assert.deepEqual(receiverSettings('nonsense'), { receivers: {}, dropped: [] });
});

// Frames drawn at `fps` for `seconds`, with jitter if asked; how many are sent.
function sent(fps, maxFps, seconds = 10, jitter = 0) {
  const limiter = new SendLimiter();
  let count = 0, t = 0, random = 1;
  for (let n = 0; n < fps * seconds; ++n) {
    random = (random * 16807) % 2147483647;
    t += 1000 / fps + jitter * ((random / 2147483647) - 0.5) * 1000 / fps;
    if (limiter.allow(t, maxFps)) ++count;
  }
  return count / seconds;
}

test('the limiter sends at most the frames a second set, however fast frames are drawn', () => {
  assert.equal(sent(30, null), 30, 'no limit: every frame');
  assert.equal(sent(30, 60), 30, 'a limit above the frame rate changes nothing');
  assert.equal(sent(30, 30), 30);
  assert.equal(sent(30, 20), 20, 'two frames in three');
  assert.equal(sent(60, 15), 15);
  assert.equal(sent(30, 7), 7);
  const jittery = sent(30, 20, 60, 0.5);
  assert.ok(jittery >= 19.5 && jittery <= 20.05, `with jitter, ${jittery} a second`);
  const faster = sent(60, 20, 60, 0.5);
  assert.ok(faster >= 19.5 && faster <= 20.05, `at 60 fps with jitter, ${faster} a second`);
});

test('after a pause the limiter does not send a burst', () => {
  const limiter = new SendLimiter();
  assert.equal(limiter.allow(0, 10), true);
  assert.equal(limiter.allow(5000, 10), true, 'first frame after the pause');
  assert.equal(limiter.allow(5033, 10), false, 'no stored credit for the pause');
  assert.equal(limiter.allow(5100, 10), true);
});
