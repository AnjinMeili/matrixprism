// Writes the hashes of every Table Mark Estes pattern's frames at its
// default settings (tools/tme-frames.js) to test/fixtures/tme-baseline.json,
// which test/tme-settings.test.js holds the patterns to (T71). Run it only
// when a change to the picture is meant, and say so in the commit.
//
//   node tools/tme-baseline.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { MARK_ESTES_PATTERNS } from '../public/patterns/mark-estes/index.js';
import { tmeHashes } from './tme-frames.js';

const out = new URL('../test/fixtures/tme-baseline.json', import.meta.url);
mkdirSync(new URL('.', out), { recursive: true });
const hashes = tmeHashes(MARK_ESTES_PATTERNS);
writeFileSync(out, `${JSON.stringify(hashes, null, 1)}\n`);
console.log(`${Object.keys(hashes).length} hashes written to test/fixtures/tme-baseline.json`);
