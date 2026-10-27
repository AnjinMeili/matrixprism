// Stops an Electron app a check started, and everything it started (T65).
// Electron's main process ignores a polite SIGTERM, and its helper processes can
// outlive it, which left a Dock icon behind per run. A check starts the app
// `detached` (its own process group) and calls this at the end: it kills the
// group, then anything still carrying the run's unique profile folder.
import { execFileSync } from 'node:child_process';

export function stopElectron(child, profile) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  if (profile) {
    try { execFileSync('pkill', ['-9', '-f', profile]); } catch { /* none left, which is the aim */ }
  }
}
