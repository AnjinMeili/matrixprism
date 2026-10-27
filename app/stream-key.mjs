// The desktop app's stream key (#8): kept encrypted with Electron's safeStorage in
// the app's own data folder, so Go live works when the app is opened from the
// Finder or the Start menu, with no environment. safeStorage uses the OS's secret
// store: the Keychain on macOS, DPAPI on Windows, a keyring or wallet on Linux.
// With no secret store on Linux it falls back to `basic_text`, a fixed password,
// which protects nothing, so the key is not stored then and the app says why.
// YOUTUBE_STREAM_KEY, when set, wins and nothing is stored. Only the async
// functions are used: the sync ones are deprecated in Electron 45 and removed in 46.
import fs from 'node:fs/promises';
import path from 'node:path';

const FILE = 'stream-key.enc';

export class StreamKeyStore {
  constructor({ safeStorage, directory, platform = process.platform, env = process.env }) {
    this.safeStorage = safeStorage;
    this.file = path.join(directory, FILE);
    this.platform = platform;
    this.fromEnvironment = Boolean(env.YOUTUBE_STREAM_KEY);
  }

  // Why the key cannot be stored here, or null when it can.
  async refusal() {
    if (this.fromEnvironment) return 'The stream key comes from YOUTUBE_STREAM_KEY; unset it to store one in the app';
    if (!(await this.safeStorage.isAsyncEncryptionAvailable()))
      return 'This computer offers no secure place for the stream key; set YOUTUBE_STREAM_KEY instead';
    if (this.platform === 'linux' && this.safeStorage.getSelectedStorageBackend() === 'basic_text')
      return 'No keyring or wallet is running, so the stream key could not be kept safely; set YOUTUBE_STREAM_KEY instead';
    return null;
  }

  // Whether a key is stored, without reading it: reading may make macOS ask.
  async has() {
    if (this.fromEnvironment) return false;
    try {
      await fs.access(this.file);
      return true;
    } catch {
      return false;
    }
  }

  // The stored key, or null. A key the OS asks to have encrypted again is saved again.
  async load() {
    if (this.fromEnvironment) return null;
    let encrypted;
    try {
      encrypted = await fs.readFile(this.file);
    } catch {
      return null;
    }
    const { result, shouldReEncrypt } = await this.safeStorage.decryptStringAsync(encrypted);
    if (shouldReEncrypt) await this.save(result);
    return result;
  }

  async save(key) {
    const why = await this.refusal();
    if (why) throw new Error(why);
    const encrypted = await this.safeStorage.encryptStringAsync(key);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, encrypted, { mode: 0o600 });
  }

  async clear() {
    await fs.rm(this.file, { force: true });
  }
}
