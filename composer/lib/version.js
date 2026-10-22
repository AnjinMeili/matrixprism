import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// What is being served from `directory`: the package version and, where the
// directory is in a git checkout, its branch, its commit and whether tracked
// files under the directory have uncommitted changes. Only the name of the
// checkout's folder is given, not its full path. The git fields are null
// when there is no checkout or no git.
export async function versionInfo(directory) {
  const { version } = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const info = {
    version, folder: path.basename(path.dirname(directory)),
    branch: null, commit: null, date: null, modified: null,
  };
  const git = async (...args) =>
    (await run('git', args, { cwd: directory, timeout: 2000 })).stdout.trim();
  try {
    const [top, branch, log, status] = await Promise.all([
      git('rev-parse', '--show-toplevel'),
      git('rev-parse', '--abbrev-ref', 'HEAD'),
      git('log', '-1', '--format=%h %cs'),
      git('status', '--porcelain', '--untracked-files=no', '--ignore-submodules', '--', '.'),
    ]);
    const [commit, date] = log.split(' ');
    Object.assign(info, {
      folder: path.basename(top),
      // A detached checkout has no branch; git answers "HEAD".
      branch: branch === 'HEAD' ? null : branch,
      commit, date, modified: status !== '',
    });
  } catch {
    // Not a git checkout, or git is not installed: the package version stands.
  }
  return info;
}
