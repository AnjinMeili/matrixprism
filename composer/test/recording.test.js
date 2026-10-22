import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RecordingService, recordingOptions, MAX_RECORDING_CHUNK } from '../lib/recording.js';
import { PreviewRecorder, RECORDING_QUEUE_BYTES } from '../public/recording.js';

const options = { width: 255, height: 191, mimeType: 'video/webm;codecs=vp9,opus', encoder: 'software' };

test('browser recording state overrides stale server state and keeps its queue bounded', () => {
  let result;
  const recorder = new PreviewRecorder((state) => { result = state; });
  recorder.session = { id: 'test', state: 'recording' };
  recorder.update('finalizing');
  assert.equal(result.state, 'finalizing');
  assert.equal(recorder.busy, true);
  recorder.update('error', { error: 'failed' });
  assert.equal(result.state, 'error');
  assert.equal(recorder.busy, false);
  assert.equal(RECORDING_QUEUE_BYTES, 16 * 1024 * 1024);
});

test('a stale browser upload failure cannot cancel a newer recording', async () => {
  const recorder = new PreviewRecorder();
  recorder.generation = 2;
  recorder.state = 'recording';
  await recorder.fail(new Error('old request failed'), 1);
  assert.equal(recorder.state, 'recording');
});

async function makeService(t, spawnEncoder) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-test-'));
  const service = new RecordingService({ directory, spawnEncoder });
  t.after(async () => { await service.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return service;
}

test('recording validates source size, formats and fixed encoder choices', () => {
  assert.deepEqual(recordingOptions(options), options);
  for (const invalid of [{ width: 0 }, { width: 1.5 }, { width: 4097 }, { width: 2048, height: 2048 },
    { encoder: '-arbitrary' }, { mimeType: 'video/unknown' }])
    assert.throws(() => recordingOptions({ ...options, ...invalid }), /Invalid/);
});

test('recording creates unique files, serializes chunks and refuses another active session', async (t) => {
  const service = await makeService(t);
  const first = await service.start(options);
  const session = service.get(first.id);
  await assert.rejects(service.start(options), /active/);
  await assert.rejects(service.append(session, 1, Buffer.from('wrong')), /out of order/);
  await service.append(session, 0, Buffer.from('first'));
  await service.append(session, 1, Buffer.from('second'));
  assert.equal(fs.readFileSync(session.source, 'utf8'), 'firstsecond');
  assert.equal(service.status(session).bytes, 11);
  assert.equal(service.status(session).file, null);
  session.uploading = true;
  await assert.rejects(service.finish(session), /not ready/);
  session.uploading = false;
  await service.cancel(session);
  const second = await service.start(options);
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.directory, first.directory);
  assert.equal(fs.readFileSync(session.source, 'utf8'), 'firstsecond');
});

test('recording finalization publishes only after the encoder exits and never overwrites output', async (t) => {
  const commands = [];
  const service = await makeService(t, (executable, args, settings) => {
    commands.push({ executable, args });
    return spawn(process.execPath, ['-e',
      "require('node:fs').writeFileSync(process.argv[1], 'encoded')", args.at(-1)], settings);
  });
  const created = await service.start({ ...options, encoder: 'hardware' });
  const session = service.get(created.id);
  await service.append(session, 0, Buffer.from('source'));
  assert.equal((await service.finish(session)).state, 'finalizing');
  assert.equal(service.status(session).file, null);
  await new Promise((resolve) => session.child.once('close', resolve));
  await new Promise((resolve) => setImmediate(resolve));
  for (let attempt = 0; attempt < 100 && session.state === 'finalizing'; ++attempt)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(session.state, 'saved');
  assert.equal(fs.readFileSync(session.target, 'utf8'), 'encoded');
  assert.equal(commands[0].executable, 'ffmpeg');
  assert.ok(commands[0].args.includes('h264_videotoolbox'));
  assert.equal(commands[0].args[commands[0].args.indexOf('-allow_sw') + 1], '0');
  assert.ok(commands[0].args.includes('pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black,format=yuv420p'));
});

test('empty media and encoder startup failures cannot report a saved recording', async (t) => {
  const service = await makeService(t, () => spawn('matrixprism-missing-encoder', []));
  const created = await service.start(options);
  const session = service.get(created.id);
  await assert.rejects(service.finish(session), /no media/);
  await service.append(session, 0, Buffer.from('source'));
  await service.finish(session);
  for (let attempt = 0; attempt < 100 && session.state === 'finalizing'; ++attempt)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(session.state, 'error');
  assert.equal(service.status(session).file, null);
  assert.match(session.error, /FFmpeg/);
  assert.ok(fs.existsSync(session.source));
});

test('oversized media stops the session without writing the oversized chunk', async (t) => {
  const service = await makeService(t);
  const created = await service.start(options);
  const session = service.get(created.id);
  await assert.rejects(service.append(session, 0, Buffer.alloc(MAX_RECORDING_CHUNK + 1)), /limit/);
  assert.equal(session.state, 'error');
  assert.equal(fs.statSync(session.source).size, 0);
});

test('an existing output file survives encoder finalization unchanged', async (t) => {
  const service = await makeService(t, (executable, args, settings) => spawn(process.execPath, ['-e',
    "require('node:fs').writeFileSync(process.argv[1], 'new')", args.at(-1)], settings));
  const created = await service.start(options);
  const session = service.get(created.id);
  await service.append(session, 0, Buffer.from('source'));
  fs.writeFileSync(session.target, 'existing', { flag: 'wx' });
  await service.finish(session);
  for (let attempt = 0; attempt < 100 && session.state === 'finalizing'; ++attempt)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(session.state, 'error');
  assert.equal(fs.readFileSync(session.target, 'utf8'), 'existing');
});

test('a failed disk write closes the recording and cannot become Saved', async (t) => {
  const service = await makeService(t);
  const created = await service.start(options);
  const session = service.get(created.id);
  session.handle.writeFile = async () => { throw new Error('ENOSPC: disk full'); };
  await assert.rejects(service.append(session, 0, Buffer.from('source')), /disk full/);
  assert.equal(session.state, 'error');
  assert.equal(session.handle, null);
  assert.equal(service.status(session).file, null);
  assert.match(session.error, /disk full/);
});

test('cancelling while the source closes cannot launch a late encoder', async (t) => {
  let launched = false;
  const service = await makeService(t, () => { launched = true; throw new Error('Unexpected encoder'); });
  const created = await service.start(options);
  const session = service.get(created.id);
  await service.append(session, 0, Buffer.from('source'));
  const finishing = service.finish(session);
  const rejected = assert.rejects(finishing);
  await service.cancel(session);
  await rejected;
  assert.equal(launched, false);
  assert.equal(session.state, 'error');
});