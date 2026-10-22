import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionInfo } from '../lib/version.js';
import { describeVersion } from '../public/version.js';

const COMPOSER = fileURLToPath(new URL('..', import.meta.url));

test('the version comes from package.json, with git details in a checkout', async () => {
  const info = await versionInfo(COMPOSER);
  const { version } = JSON.parse(await fs.readFile(path.join(COMPOSER, 'package.json'), 'utf8'));
  assert.equal(info.version, version);
  assert.ok(info.folder && !info.folder.includes(path.sep), 'only the folder name, not its path');
  // The tests may run from an exported copy with no git history.
  if (info.commit) {
    assert.match(info.commit, /^[0-9a-f]{7,40}$/);
    assert.match(info.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof info.modified, 'boolean');
  }
});

test('outside a git checkout only the package version and folder are reported', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'matrixprism-version-'));
  t.after(() => fs.rm(parent, { recursive: true }));
  const directory = path.join(parent, 'composer');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ version: '9.8.7' }));
  assert.deepEqual(await versionInfo(directory), {
    version: '9.8.7', folder: path.basename(parent), branch: null, commit: null, date: null, modified: null,
  });
});

test('the version line names the branch, commit, changes and folder', () => {
  const info = { version: '0.1.0', folder: 'matrixprism', branch: 'main', commit: '34aa04e', date: '2026-10-13', modified: false };
  assert.equal(describeVersion(info),
    'Version 0.1.0 · branch main · commit 34aa04e of 2026-10-13 · folder matrixprism');
  assert.equal(describeVersion({ ...info, modified: true }),
    'Version 0.1.0 · branch main · commit 34aa04e of 2026-10-13 · with uncommitted changes · folder matrixprism');
  assert.equal(describeVersion({ ...info, branch: null }),
    'Version 0.1.0 · no branch (detached) · commit 34aa04e of 2026-10-13 · folder matrixprism');
  assert.equal(describeVersion({ version: '0.1.0', folder: 'copy', branch: null, commit: null, date: null, modified: null }),
    'Version 0.1.0 · not a git checkout · folder copy');
});
