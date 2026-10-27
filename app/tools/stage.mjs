// Stages what goes into the packaged app (T65): the app's own files and the
// composer's lib/ and public/, in the same layout as the repository (app/ and
// composer/ side by side, so main.mjs's relative imports hold), with a package.json
// the builder can read. Everything is copied from the repository; nothing is edited.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const COMPOSER = path.join(APP, '..', 'composer');
const STAGE = path.join(APP, 'dist-stage');

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'app'), { recursive: true });
for (const file of ['main.mjs', 'preload.cjs', 'stream-key.mjs', 'window-state.mjs'])
  fs.copyFileSync(path.join(APP, file), path.join(STAGE, 'app', file));
const skip = (source) => !/(^|\/)(node_modules|\.DS_Store)(\/|$)/.test(source);
for (const folder of ['lib', 'public'])
  fs.cpSync(path.join(COMPOSER, folder), path.join(STAGE, 'composer', folder), { recursive: true, filter: skip });
fs.copyFileSync(path.join(COMPOSER, 'package.json'), path.join(STAGE, 'composer', 'package.json'));
for (const file of ['LICENSE', 'LICENSE.md', 'COPYING'])
  if (fs.existsSync(path.join(APP, '..', file))) fs.copyFileSync(path.join(APP, '..', file), path.join(STAGE, file));

const own = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
  name: own.name, productName: own.productName, version: own.version, description: own.description,
  author: own.author, license: own.license, main: 'app/main.mjs',
}, null, 2) + '\n');
console.log(`staged ${path.relative(process.cwd(), STAGE) || STAGE}`);
