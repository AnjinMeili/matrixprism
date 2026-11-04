// Stages what goes into the packaged app (T65): the app's own files and the
// composer's lib/ and public/, in the same layout as the repository (app/ and
// composer/ side by side, so main.mjs's relative imports hold), with a package.json
// the builder can read. Everything is copied from the repository; nothing is edited.
//
// With --ndi, the NDI build (#62, never released): koffi, installed in app/ndi/
// by `npm --prefix app/ndi ci`, goes in too, as the stage's one dependency, since
// the builder keeps only the node_modules its package.json names. A plain stage
// refuses to finish if anything of NDI, or any node_modules, got in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const COMPOSER = path.join(APP, '..', 'composer');
const STAGE = path.join(APP, 'dist-stage');
const NDI = process.argv.includes('--ndi');
const NDI_MODULES = path.join(APP, 'ndi', 'node_modules');
if (NDI && !fs.existsSync(path.join(NDI_MODULES, 'koffi'))) {
  console.error('The NDI build needs koffi: run npm --prefix app/ndi ci first');
  process.exit(1);
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'app'), { recursive: true });
for (const file of ['main.mjs', 'preload.cjs', 'stream-key.mjs', 'window-state.mjs'])
  fs.copyFileSync(path.join(APP, file), path.join(STAGE, 'app', file));
const skip = (source) => !/(^|\/)(node_modules|\.DS_Store)(\/|$)/.test(source);
for (const folder of ['lib', 'public'])
  fs.cpSync(path.join(COMPOSER, folder), path.join(STAGE, 'composer', folder), { recursive: true, filter: skip });
fs.copyFileSync(path.join(COMPOSER, 'package.json'), path.join(STAGE, 'composer', 'package.json'));
if (NDI) fs.cpSync(NDI_MODULES, path.join(STAGE, 'node_modules'), { recursive: true });
for (const file of ['LICENSE', 'LICENSE.md', 'COPYING'])
  if (fs.existsSync(path.join(APP, '..', file))) fs.copyFileSync(path.join(APP, '..', file), path.join(STAGE, file));

const own = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
  name: own.name, productName: own.productName, version: own.version, description: own.description,
  author: own.author, license: own.license, main: 'app/main.mjs',
  ...(NDI ? { dependencies: JSON.parse(fs.readFileSync(path.join(APP, 'ndi', 'package.json'), 'utf8')).dependencies } : {}),
}, null, 2) + '\n');

// What a plain stage must not hold: the release is built from one.
const found = [];
const walk = (folder) => {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (/node_modules|koffi/i.test(entry.name)) found.push(path.relative(STAGE, file));
    else if (entry.isDirectory()) walk(file);
  }
};
if (!NDI) walk(STAGE);
if (found.length) {
  console.error(`A plain stage must have no NDI and no node_modules, but holds: ${found.join(', ')}`);
  process.exit(1);
}
console.log(`staged ${path.relative(process.cwd(), STAGE) || STAGE}${NDI ? ' with NDI' : ''}`);
