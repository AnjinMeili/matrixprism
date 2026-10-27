import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { StreamKeyStore } from '../stream-key.mjs';

const KEY = 'abcd-1234-efgh-5678';

// A stand-in for Electron's safeStorage: reverses the bytes, which is enough to
// show the file never holds the key as written.
function fakeSafeStorage({ available = true, backend = 'gnome_libsecret', reEncrypt = false } = {}) {
  const calls = [];
  return {
    calls,
    isAsyncEncryptionAvailable: async () => available,
    getSelectedStorageBackend: () => backend,
    encryptStringAsync: async (text) => { calls.push('encrypt'); return Buffer.from(text).reverse(); },
    decryptStringAsync: async (buffer) => {
      calls.push('decrypt');
      return { result: Buffer.from(buffer).reverse().toString(), shouldReEncrypt: reEncrypt };
    },
  };
}

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stream-key-'));

test('a saved key comes back after a restart and is not in the file as written', async () => {
  const directory = folder();
  const safeStorage = fakeSafeStorage();
  await new StreamKeyStore({ safeStorage, directory, env: {} }).save(KEY);
  const file = fs.readFileSync(path.join(directory, 'stream-key.enc'));
  assert.ok(!file.toString().includes(KEY));
  // Only the account that saved it may read it, where the system has Unix permissions; Windows has
  // none to set (it reports 0666), and protects the key by DPAPI's encryption alone.
  if (process.platform !== 'win32')
    assert.equal(fs.statSync(path.join(directory, 'stream-key.enc')).mode & 0o777, 0o600);
  assert.equal(await new StreamKeyStore({ safeStorage, directory, env: {} }).load(), KEY);
});

test('clearing removes it, and with nothing stored there is no key', async () => {
  const directory = folder();
  const safeStorage = fakeSafeStorage();
  const store = new StreamKeyStore({ safeStorage, directory, env: {} });
  assert.equal(await store.has(), false);
  assert.equal(await store.load(), null);
  await store.save(KEY);
  safeStorage.calls.length = 0;
  assert.equal(await store.has(), true);
  assert.deepEqual(safeStorage.calls, [], 'asking whether a key is stored does not read it');
  await store.clear();
  assert.equal(await store.has(), false);
  assert.equal(await store.load(), null);
  await store.clear();
});

test('the environment wins: nothing is loaded or stored while YOUTUBE_STREAM_KEY is set', async () => {
  const store = new StreamKeyStore({ safeStorage: fakeSafeStorage(), directory: folder(), env: { YOUTUBE_STREAM_KEY: KEY } });
  assert.equal(await store.load(), null);
  await assert.rejects(store.save(KEY), /YOUTUBE_STREAM_KEY/);
});

test('on Linux with no keyring or wallet (basic_text) the key is refused, not stored', async () => {
  const directory = folder();
  const safeStorage = fakeSafeStorage({ backend: 'basic_text' });
  const store = new StreamKeyStore({ safeStorage, directory, platform: 'linux', env: {} });
  assert.match(await store.refusal(), /keyring or wallet/);
  await assert.rejects(store.save(KEY), /YOUTUBE_STREAM_KEY instead/);
  assert.ok(!fs.existsSync(path.join(directory, 'stream-key.enc')));
  assert.deepEqual(safeStorage.calls, []);
  // The same backend name means nothing on macOS or Windows.
  assert.equal(await new StreamKeyStore({ safeStorage, directory, platform: 'darwin', env: {} }).refusal(), null);
});

test('with no encryption available at all the key is refused', async () => {
  const store = new StreamKeyStore({ safeStorage: fakeSafeStorage({ available: false }), directory: folder(), env: {} });
  await assert.rejects(store.save(KEY), /no secure place/);
});

test('a key the OS asks to re-encrypt is saved again', async () => {
  const directory = folder();
  await new StreamKeyStore({ safeStorage: fakeSafeStorage(), directory, env: {} }).save(KEY);
  const safeStorage = fakeSafeStorage({ reEncrypt: true });
  assert.equal(await new StreamKeyStore({ safeStorage, directory, env: {} }).load(), KEY);
  assert.deepEqual(safeStorage.calls, ['decrypt', 'encrypt']);
});
