import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/frame-clock.js', import.meta.url), 'utf8');

function makeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const ticks = [];
  const self = { postMessage: () => ticks.push(now) };
  vm.runInNewContext(source, {
    self,
    performance: { now: () => now },
    setTimeout: (callback, delay) => {
      const id = ++nextId;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  return {
    ticks,
    timers,
    send: (data) => self.onmessage({ data }),
    advance: (milliseconds) => {
      now += milliseconds;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

test('worker clock drives 30 fps without animation frames or page timers', () => {
  const clock = makeClock();
  clock.send({ type: 'start', fps: 30 });
  clock.advance(0);
  for (let i = 0; i < 300; ++i) {
    clock.send({ type: 'frame', fps: 30 });
    clock.advance(1000 / 30);
  }
  assert.equal(clock.ticks.length, 301);
  assert.ok(Math.abs(clock.ticks.at(-1) - 10000) < 0.001);
});

test('clock accounts for rendering time and applies frame rate changes', () => {
  const clock = makeClock();
  clock.send({ type: 'start', fps: 30 });
  clock.advance(0);
  clock.advance(10);
  clock.send({ type: 'frame', fps: 20 });
  clock.advance(39);
  assert.equal(clock.ticks.length, 1);
  clock.advance(1);
  assert.deepEqual(clock.ticks, [0, 50]);
  clock.send({ type: 'frame', fps: 10 });
  clock.advance(99);
  assert.equal(clock.ticks.length, 2);
  clock.advance(1);
  assert.deepEqual(clock.ticks, [0, 50, 150]);
});

test('a stalled page does not queue ticks or cause catch-up bursts', () => {
  const clock = makeClock();
  clock.send({ type: 'start', fps: 30 });
  clock.advance(0);
  clock.advance(60000);
  assert.deepEqual(clock.ticks, [0]);
  assert.equal(clock.timers.size, 0);
  clock.send({ type: 'frame', fps: 30 });
  clock.advance(0);
  assert.deepEqual(clock.ticks, [0, 60000]);
  clock.send({ type: 'frame', fps: 30 });
  clock.send({ type: 'frame', fps: 30 });
  assert.equal(clock.timers.size, 1);
  clock.advance(1000 / 30);
  assert.equal(clock.ticks.length, 3);
});
