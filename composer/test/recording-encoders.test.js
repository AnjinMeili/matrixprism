import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeArgs, optionsFrom } from '../tools/compare-recording-encoders.mjs';

test('encoder comparison defaults to panel resolution and requires an evidence directory', () => {
  assert.throws(() => optionsFrom([]), /--out/);
  const options = optionsFrom(['--out', '/tmp/recording-evidence']);
  assert.equal(options.width, 256);
  assert.equal(options.height, 192);
  assert.equal(options.fps, 30);
  assert.equal(options.bitrate, 1000000);
});

test('encoder comparison bounds dimensions and work and rejects ambiguous options', () => {
  for (const args of [
    ['--size', '0x192'], ['--size', '256xNaN'], ['--fps', 'NaN'],
    ['--seconds', '121'], ['--bitrate', 'Infinity'], ['--fps', '29.5'],
    ['--encoder', 'arbitrary'], ['--size'],
  ]) assert.throws(() => optionsFrom(['--out', '/tmp/recording-evidence', ...args]));
  const options = optionsFrom(['--out', '/tmp/recording-evidence', '--size', '255x191']);
  assert.equal(options.width, 255);
  assert.equal(options.height, 191);
});

test('hardware comparison forbids software fallback and both encoders share bitrate and audio', () => {
  const options = optionsFrom(['--out', '/tmp/recording-evidence', '--bitrate', '500000']);
  for (const encoder of ['libx264', 'h264_videotoolbox']) {
    const args = encodeArgs(encoder, options, 'source.mkv', 'target.mp4');
    assert.equal(args[args.indexOf('-b:v') + 1], '500000');
    assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
    assert.equal(args[args.indexOf('-b:a') + 1], '192k');
    assert.ok(args.includes('-n'));
    assert.ok(args.includes('pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black,format=yuv420p'));
    if (encoder === 'h264_videotoolbox') {
      assert.equal(args[args.indexOf('-allow_sw') + 1], '0');
      assert.equal(args[args.indexOf('-require_sw') + 1], '0');
    }
  }
  assert.throws(() => encodeArgs('unknown', options, 'source', 'target'), /Unsupported/);
});