import assert from 'node:assert/strict';
import test from 'node:test';
import { NDI_LINK, NDI_RUNTIME_LINKS, NdiOutput, enlargeFrame, loadNdi, runtimeCandidates } from '../lib/ndi.js';
import { RelayApi, StreamSession } from '../lib/relay-core.js';
import { defaultLiveSize, ndiSizes } from '../public/live-sizes.js';

// NDI output (#62), on stand-ins for the NDI runtime: the runtime search, the
// frame enlarged, the source's sending and closing, and the frame channel
// telling NDI frames from DDP ones. The real calls are checked against a
// stub library built from NDI's headers (app/check-ndi-binding.mjs).

test('the NDI runtime is looked for where its installer puts it, then by name', () => {
  assert.deepEqual(runtimeCandidates('darwin', {}), ['/usr/local/lib/libndi.dylib', 'libndi.dylib']);
  assert.deepEqual(runtimeCandidates('darwin', { NDI_RUNTIME_DIR_V6: '/opt/ndi' }),
    ['/opt/ndi/libndi.dylib', '/usr/local/lib/libndi.dylib', 'libndi.dylib']);
  assert.deepEqual(runtimeCandidates('win32', { NDI_RUNTIME_DIR_V6: 'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6' }),
    ['C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\Processing.NDI.Lib.x64.dll', 'Processing.NDI.Lib.x64.dll']);
  assert.deepEqual(runtimeCandidates('linux', {}), ['/usr/lib/libndi.so.6', '/usr/local/lib/libndi.so.6', 'libndi.so.6']);
  assert.deepEqual(runtimeCandidates('aix', {}), []);
});

test('a frame is enlarged by whole blocks, with no smoothing', () => {
  // Two pixels side by side over one below: red, green / blue, white.
  const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const out = enlargeFrame(rgba, 2, 2, 3, new Uint8Array(6 * 6 * 4));
  const pixel = (x, y) => [...out.subarray((y * 6 + x) * 4, (y * 6 + x) * 4 + 4)];
  for (let y = 0; y < 6; ++y)
    for (let x = 0; x < 6; ++x) {
      const source = Math.floor(y / 3) * 2 + Math.floor(x / 3);
      assert.deepEqual(pixel(x, y), [...rgba.subarray(source * 4, source * 4 + 4)], `pixel ${x},${y}`);
    }
  const same = enlargeFrame(rgba, 2, 2, 1, new Uint8Array(16));
  assert.deepEqual([...same], [...rgba]);
});

test('NDI offers the panel\'s own size first, then multiples up to 4K UHD, nearest 720 high by default', () => {
  const sizes = ndiSizes(128, 64);
  assert.deepEqual(sizes[0], { width: 128, height: 64, scale: 1 });
  assert.ok(sizes.length <= 7);
  for (const size of sizes) {
    assert.ok(size.width <= 3840 && size.height <= 2160, `${size.width}x${size.height}`);
    assert.equal(size.width, 128 * size.scale);
    assert.equal(size.height, 64 * size.scale);
  }
  assert.deepEqual(sizes.at(-1), { width: 3840, height: 1920, scale: 30 }, 'the width reaches 4K first');
  assert.equal(defaultLiveSize(sizes).height, 704);
  // The panel's size, then those nearest 360, 480, 720, 1080, 1440 and 2160 high.
  assert.deepEqual(sizes.map((size) => size.scale), [1, 6, 7, 11, 17, 22, 30]);
  assert.deepEqual(ndiSizes(256, 192).map((size) => size.scale), [1, 2, 4, 6, 7, 11]);
  assert.deepEqual(ndiSizes(3000, 2000), [{ width: 3000, height: 2000, scale: 1 }]);
});

test('without koffi the build has no NDI; without the runtime it says how to get it', () => {
  assert.deepEqual(loadNdi(null).status, { built: false, available: false });
  const tried = [];
  const missing = loadNdi({}, { platform: 'darwin', env: {}, bind: (koffi, file) => { tried.push(file); throw new Error('not found'); } });
  assert.deepEqual(tried, ['/usr/local/lib/libndi.dylib', 'libndi.dylib']);
  assert.equal(missing.bindings, null);
  assert.equal(missing.status.built, true);
  assert.equal(missing.status.available, false);
  assert.match(missing.status.reason, /not installed.*ndi\.video/);
  assert.equal(missing.status.link, NDI_LINK);
  assert.equal(missing.status.runtimeLink, NDI_RUNTIME_LINKS.darwin);
  assert.match(missing.problems.join(), /libndi\.dylib: not found/);
  const found = loadNdi({}, { platform: 'darwin', env: {}, bind: (koffi, file) => {
    if (file.startsWith('/')) throw new Error('not found');
    return { version: 'NDI SDK 6.2' };
  } });
  assert.deepEqual(found.status, { built: true, available: true, version: 'NDI SDK 6.2', link: NDI_LINK });
});

// A stand-in for the NDI calls: each send waits until `finish()` is called.
function fakeBindings() {
  const fake = {
    created: [], destroyed: [], sends: [], pending: [],
    create(name) { fake.created.push(name); return 7n; },
    destroy(sender) { fake.destroyed.push(sender); },
    send(sender, frame, done) { fake.sends.push({ sender, ...frame, data: Uint8Array.from(frame.data) }); fake.pending.push(done); },
    finish(error = null) { fake.pending.shift()(error); },
    connections: () => 2,
    address: () => '10.0.0.9:5961',
  };
  return fake;
}

test('the NDI source sends one frame at a time, enlarged, and skips frames while NDI is busy', async () => {
  const fake = fakeBindings();
  const output = new NdiOutput(fake);
  assert.equal(output.on, false);
  assert.equal(output.frame(new Uint8Array(8)), false, 'nothing before it starts');
  assert.throws(() => output.start({ width: 0, height: 2, scale: 1 }), /invalid NDI size/);
  assert.throws(() => output.start({ width: 128, height: 64, scale: 31 }), /invalid NDI size/, 'wider than 3840');
  assert.deepEqual(output.start({ width: 2, height: 1, scale: 2, fps: 30 }), { width: 4, height: 2, address: '10.0.0.9:5961' });
  assert.deepEqual(fake.created, ['MatrixPrism']);
  assert.equal(output.frameBytes, 8);
  assert.equal(output.frame(new Uint8Array(6)), false, 'a frame of another size is ignored');
  const frame = Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255]);
  assert.equal(output.frame(frame), true);
  assert.equal(output.frame(frame), false, 'skipped while the last is being sent');
  assert.deepEqual(output.takeStats(), { on: true, connections: 0, sent: 0, skipped: 1 }, 'the count is not asked for mid-send');
  fake.finish();
  assert.equal(output.connections, 2, 'but as soon as the send is done');
  assert.deepEqual(fake.sends[0].width, 4);
  assert.deepEqual(fake.sends[0].height, 2);
  assert.equal(fake.sends[0].fps, 30);
  assert.deepEqual([...fake.sends[0].data], [1, 2, 3, 255, 1, 2, 3, 255, 4, 5, 6, 255, 4, 5, 6, 255,
    1, 2, 3, 255, 1, 2, 3, 255, 4, 5, 6, 255, 4, 5, 6, 255]);
  assert.equal(output.frame(frame), true);
  fake.finish(new Error('network down'));
  assert.deepEqual(output.takeStats(), { on: true, connections: 2, sent: 1, skipped: 0, error: 'network down' });
  // Started again at another size and rate, the same source carries on.
  output.start({ width: 2, height: 1, scale: 1 });
  assert.equal(fake.created.length, 1);
  assert.equal(output.size.fps, 60, 'a rate not given is 60');
  output.frame(frame);
  assert.equal(fake.sends[2].data.length, 8);
  // Closing waits for the frame being sent before the source is destroyed.
  const closed = output.close();
  assert.equal(output.frame(frame), false);
  assert.deepEqual(fake.destroyed, []);
  fake.finish();
  await closed;
  assert.deepEqual(fake.destroyed, [7n]);
  assert.equal(output.close(), closed, 'closing twice is the same close');
});

test('the frame channel tells NDI frames from DDP frames by size and reports the source each second', async () => {
  const sent = [], ddpFrames = [];
  const sender = {
    async setTarget() { return '10.0.0.5'; },
    sendFrame(frame) { ddpFrames.push(frame); },
    takeStats: () => ({ frames: ddpFrames.length }),
    close() {},
  };
  const fake = fakeBindings();
  const session = new StreamSession({ send: (m) => sent.push(m), sender, ndi: new NdiOutput(fake), statsMs: 5 });
  await session.message(JSON.stringify({ type: 'ndi', on: true, width: 4, height: 2, scale: 0 }), false);
  assert.deepEqual(sent.at(-1), { type: 'ndi', on: false, error: 'invalid NDI size' });
  await session.message(JSON.stringify({ type: 'ndi', on: true, width: 4, height: 2, scale: 2, fps: 30 }), false);
  assert.deepEqual(sent.at(-1), { type: 'ndi', on: true, name: 'MatrixPrism', width: 8, height: 4, address: '10.0.0.9:5961' });
  // NDI alone: no receiver set, so an RGBA frame goes to NDI and nothing to DDP.
  await session.message(Buffer.alloc(4 * 2 * 4), true);
  assert.equal(fake.sends.length, 1);
  fake.finish();
  // Both: the RGB frame to the receiver, the RGBA one to NDI.
  await session.message(JSON.stringify({ type: 'target', host: 'h', width: 4, height: 2 }), false);
  await session.message(Buffer.alloc(4 * 2 * 3), true);
  await session.message(Buffer.alloc(4 * 2 * 4), true);
  assert.equal(ddpFrames.length, 1);
  assert.equal(fake.sends.length, 2);
  fake.finish();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stats = sent.filter((m) => m.type === 'stats').at(-1);
  assert.equal(stats.ndi.on, true);
  assert.equal(stats.ndi.connections, 2);
  await session.message(JSON.stringify({ type: 'ndi', on: false }), false);
  assert.deepEqual(sent.at(-1), { type: 'ndi', on: false });
  // Off, an RGBA frame is not NDI's and not the receiver's.
  await session.message(Buffer.alloc(4 * 2 * 4), true);
  assert.equal(fake.sends.length, 2);
  assert.match(sent.at(-1).message, /frame is 32 bytes, expected 24/);
  await session.close();
  assert.deepEqual(fake.destroyed, [7n]);
});

test('without NDI the frame channel says so, and the relay reports the build has none', async () => {
  const sent = [];
  const session = new StreamSession({ send: (m) => sent.push(m), sender: { takeStats: () => ({}), close() {} }, statsMs: 1000 });
  await session.message(JSON.stringify({ type: 'ndi', on: true, width: 4, height: 2, scale: 1 }), false);
  assert.deepEqual(sent.at(-1), { type: 'ndi', on: false, error: 'NDI is not available here' });
  assert.equal(session.close(), undefined);
  assert.deepEqual(await new RelayApi().handle('/api/ndi'), { status: 200, body: { built: false, available: false } });
  const status = { built: true, available: true, version: 'NDI SDK 6.2', link: NDI_LINK };
  assert.deepEqual(await new RelayApi({ ndi: status }).handle('/api/ndi'), { status: 200, body: status });
});
