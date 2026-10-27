// Where FFmpeg usually is, for a program that was not started from a shell (T65).
// A double-clicked macOS app does not get the shell's PATH, so a Homebrew
// FFmpeg in /opt/homebrew/bin is not found by `spawn('ffmpeg')`; Windows and
// Linux desktop launchers can differ the same way. `pathWithFfmpegDirs` adds the
// usual folders to the end of a PATH, never ahead of what is already there.
import { execFile } from 'node:child_process';
import path from 'node:path';

export function usualFfmpegDirs(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];
  if (platform === 'win32') {
    return [
      env.ChocolateyInstall && path.win32.join(env.ChocolateyInstall, 'bin'),
      env.ProgramFiles && path.win32.join(env.ProgramFiles, 'ffmpeg', 'bin'),
      env.USERPROFILE && path.win32.join(env.USERPROFILE, 'scoop', 'shims'),
      'C:\\ffmpeg\\bin',
    ].filter(Boolean);
  }
  return ['/usr/local/bin', '/usr/bin', '/snap/bin', '/home/linuxbrew/.linuxbrew/bin'];
}

export function pathWithFfmpegDirs(current = '', platform = process.platform, env = process.env) {
  const separator = platform === 'win32' ? ';' : ':';
  const have = new Set(current.split(separator).filter(Boolean));
  const extra = usualFfmpegDirs(platform, env).filter((dir) => !have.has(dir));
  return [...have, ...extra].join(separator);
}

// What to tell a person when FFmpeg cannot be started: the raw error, and for a
// missing program how to install it where they are. `error` is what spawn gave.
export function ffmpegStartMessage(error, platform = process.platform) {
  if (error?.code !== 'ENOENT') return `Cannot start FFmpeg: ${error?.message ?? error}`;
  const how = platform === 'darwin' ? 'On a Mac with Homebrew: brew install ffmpeg'
    : platform === 'win32' ? 'On Windows, for example: winget install Gyan.FFmpeg'
      : 'On Linux, with your package manager, for example: sudo apt install ffmpeg';
  return `FFmpeg was not found, and recording and Go live need it. ${how}. Then try again.`;
}

// Whether FFmpeg can be started, found once and then remembered. Rejects with the
// explanation above (and a 409 status for the handlers) when it cannot, so a
// recording can say so when it begins, not minutes later when it is stopped.
let found = false;
export function ffmpegAvailable() {
  if (found) return Promise.resolve();
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-version'], { timeout: 8000 }, (error) => {
      if (!error) {
        found = true;
        resolve();
      } else {
        reject(Object.assign(new Error(ffmpegStartMessage(error)), { status: 409 }));
      }
    });
  });
}
