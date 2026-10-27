// Records which application is in front while a check runs (macOS), so a check
// can show it did not take the screen's focus from the person using the
// computer (T65). Samples `lsappinfo` every 100 ms; on other systems it records
// nothing and says so.
import { execFileSync } from 'node:child_process';

const frontName = () => {
  try {
    const asn = execFileSync('lsappinfo', ['front'], { encoding: 'utf8' }).trim();
    const info = execFileSync('lsappinfo', ['info', '-only', 'name', asn], { encoding: 'utf8' });
    return info.match(/"LSDisplayName"="([^"]*)"/)?.[1] ?? null;
  } catch {
    return null;
  }
};

export function watchFocus(isOurs = /electron|matrixprism/i) {
  if (process.platform !== 'darwin') return { stop: () => ({ supported: false, stolen: null, names: [] }) };
  const names = new Map(), changes = [];
  const started = Date.now();
  let last = null;
  const timer = setInterval(() => {
    const name = frontName();
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
    if (name !== last) changes.push([Math.round((Date.now() - started) / 100) / 10, name]);
    last = name;
  }, 100);
  return {
    stop() {
      clearInterval(timer);
      const seen = [...names.keys()];
      return { supported: true, stolen: seen.some((name) => isOurs.test(name)), names: Object.fromEntries(names), changes };
    },
  };
}
