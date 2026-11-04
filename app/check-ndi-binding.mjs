#!/usr/bin/env node
// Checks the NDI build's calls (composer/lib/ndi.js, #62) against NDI's own
// headers, without the NDI runtime: a stub libndi is compiled from the
// headers by the C compiler, so its structs are laid out as the real
// library's are, and records what it is given. The real binding, through the
// koffi of app/ndi/, creates a source, sends frames and destroys it; the
// check compares every field the stub saw with what was meant.
//
// It does not show NDI on the network or a receiver taking the picture;
// that needs the runtime and an NDI receiver (NDI Tools).
//
//   npm --prefix app/ndi ci
//   node app/check-ndi-binding.mjs --headers <folder of Processing.NDI.*.h>
//
// The headers are in the NDI SDK (its include folder) and in projects that
// carry them, such as DistroAV's lib/ndi/; they are MIT licensed. Run it
// under Electron's Node as well, to check koffi there:
//   ELECTRON_RUN_AS_NODE=1 app/node_modules/.bin/electron app/check-ndi-binding.mjs --headers <folder>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NdiOutput, bindNdi } from '../composer/lib/ndi.js';
import { buildNdiStub } from './ndi-stub.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const headers = args[args.indexOf('--headers') + 1];
if (!args.includes('--headers') || !headers || !fs.existsSync(path.join(headers, 'Processing.NDI.Lib.h'))) {
  console.error('usage: node app/check-ndi-binding.mjs --headers <folder holding Processing.NDI.Lib.h>');
  process.exit(2);
}
const koffiFolder = path.join(HERE, 'ndi', 'node_modules', 'koffi');
if (!fs.existsSync(koffiFolder)) {
  console.error('koffi is not installed: run npm --prefix app/ndi ci');
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ndi-stub-'));
const library = buildNdiStub(headers, work);

const koffi = createRequire(import.meta.url)(koffiFolder);
const stub = koffi.load(library);
const stubLast = stub.func('const char *stub_last()');
const stubDestroyed = stub.func('int stub_destroyed()');

let failures = 0;
const expect = (label, actual, wanted) => {
  const ok = actual === wanted;
  failures += ok ? 0 : 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n     got    ${actual}\n     wanted ${wanted}`}`);
};
// The stub's checksum of the bytes it was given.
const sum = (bytes) => bytes.reduce((total, byte) => (Math.imul(total, 31) + byte) >>> 0, 0);
const peak = (bytes) => bytes.reduce((most, byte, i) => (i % 4 !== 3 && byte > most ? byte : most), 0);

const bindings = bindNdi(koffi, library);
console.log(`koffi ${koffi.version} under ${process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`}`);
expect('version', bindings.version, 'stub NDI 6');
const output = new NdiOutput(bindings);
const started = output.start({ width: 3, height: 2, scale: 2, fps: 30 });
expect('create', stubLast(), 'create name=MatrixPrism groups=(null) clock_video=0 clock_audio=0 size=24');
expect('address', started.address, '192.0.2.1:5961');

const frame = Uint8Array.from({ length: 3 * 2 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 37) & 255));
const enlarged = new Uint8Array(6 * 4 * 4);
for (let y = 0; y < 4; ++y)
  for (let x = 0; x < 6; ++x)
    enlarged.set(frame.subarray(((y >> 1) * 3 + (x >> 1)) * 4, ((y >> 1) * 3 + (x >> 1)) * 4 + 4), (y * 6 + x) * 4);
const sent = () => new Promise((resolve) => { output.settle = resolve; });
output.frame(frame);
await sent();
expect('video, enlarged', stubLast(), `video instance=1 xres=6 yres=4 fourcc=RGBX rate=30/1 aspect=0 format=1 ` +
  `timecode=9223372036854775807 stride=24 metadata=(null) timestamp=0 sum=${sum(enlarged)} peak=${peak(frame)} size=72`);
output.start({ width: 3, height: 2, scale: 1, fps: 60 });
output.frame(frame);
await sent();
expect('video, as sent', stubLast(), `video instance=1 xres=3 yres=2 fourcc=RGBX rate=60/1 aspect=0 format=1 ` +
  `timecode=9223372036854775807 stride=12 metadata=(null) timestamp=0 sum=${sum(frame)} peak=${peak(frame)} size=72`);
expect('connections', output.takeStats().connections, 3);
await output.close();
expect('destroyed', stubDestroyed(), 1);
// On Windows the loaded stub cannot be removed by the process that holds it.
try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
