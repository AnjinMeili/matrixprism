// The MatrixPrism desktop app (T65): the composer in its own window, with the
// relay's work running in this process and no server: nothing listens on a port.
//
// The page loads from matrixprism://app/, a secure scheme, so the microphone and
// Web MIDI work as they do on localhost. This file answers that scheme from the
// shared core (composer/lib/relay-core.js): the page's files, the small JSON
// answers, and, through an adapter, the recording and Go live handlers. The frame
// socket (/stream) is an IPC channel; the preload script puts a WebSocket
// stand-in in front of it, so the page's own code is not changed.
import { app, BrowserWindow, ipcMain, protocol, safeStorage, screen, session } from 'electron/main';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DDP_PORT } from '../composer/lib/ddp.js';
import { answerWithNodeHandler } from '../composer/lib/fetch-adapter.js';
import { pathWithFfmpegDirs } from '../composer/lib/ffmpeg-path.js';
import { LiveService, liveRequest } from '../composer/lib/live.js';
import { RecordingService, recordingRequest } from '../composer/lib/recording.js';
import { RelayApi, StreamSession, fileAnswer } from '../composer/lib/relay-core.js';
import { StreamKeyStore } from './stream-key.mjs';
import { WindowState, fitBounds } from './window-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// In a packaged app the composer's files are in the app's resources, beside this one.
const COMPOSER_DIR = process.env.MATRIXPRISM_COMPOSER_DIR ?? path.join(HERE, '..', 'composer');
const PUBLIC_DIR = path.join(COMPOSER_DIR, 'public');
const SCHEME = 'matrixprism';

// A program started from the desktop does not get the shell's PATH, so name the
// usual places for FFmpeg (recording and Go live need it).
process.env.PATH = pathWithFfmpegDirs(process.env.PATH ?? '');

// Background mode, for the checks (app/check-*.mjs): no Dock icon, no window shown,
// and the page not slowed down for being hidden, so a check can run without taking
// the screen or the keyboard focus from the person at the computer.
const BACKGROUND = process.env.MATRIXPRISM_BACKGROUND === '1';

// For a check that drives the window from outside (app/check-app.mjs).
if (process.env.MATRIXPRISM_DEBUG_PORT)
  app.commandLine.appendSwitch('remote-debugging-port', process.env.MATRIXPRISM_DEBUG_PORT);
// For a check that stores a stream key (app/check-app-key.mjs): a stand-in for the
// macOS Keychain, so a check neither touches the real one nor makes it ask.
if (process.env.MATRIXPRISM_MOCK_KEYCHAIN === '1') app.commandLine.appendSwitch('use-mock-keychain');

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

const api = new RelayApi({
  receiverHost: process.env.MATRIX_HOST ?? '', ddpPort: DDP_PORT, rootDir: COMPOSER_DIR,
});
const recordings = new RecordingService({ directory: process.env.MATRIXPRISM_RECORD_DIR });
const live = new LiveService({ hint: 'Enter the stream key beside Go live' });

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

async function answer(request) {
  const url = new URL(request.url);
  if (url.host !== 'app') return new Response('Not found', { status: 404 });
  if (url.pathname === '/api/recordings' || url.pathname.startsWith('/api/recordings/'))
    return answerWithNodeHandler((req, res, u) => recordingRequest(recordings, req, res, u), request);
  if (url.pathname === '/api/live' || url.pathname.startsWith('/api/live/'))
    return answerWithNodeHandler((req, res, u) => liveRequest(live, req, res, u), request);
  if (url.pathname.startsWith('/api/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const result = await api.handle(url.pathname, url.searchParams);
    return json(result?.status ?? 404, result?.body ?? { error: 'not found' });
  }
  const file = await fileAnswer(PUBLIC_DIR, url.pathname);
  return new Response(file.body, { status: file.status, headers: file.headers });
}

// The frame socket, one per window.
const streams = new Map();

function openStream(webContents) {
  const send = (message) => { if (!webContents.isDestroyed()) webContents.send('stream:message', message); };
  streams.set(webContents.id, new StreamSession({ send, defaultDdpPort: DDP_PORT }));
  webContents.once('destroyed', () => closeStream(webContents.id));
}

function closeStream(id) {
  streams.get(id)?.close();
  streams.delete(id);
}

if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(async () => {
  if (BACKGROUND) app.dock?.hide();
  protocol.handle(SCHEME, answer);
  // Only this app's own page may use the microphone, MIDI and the folder picker.
  const allowed = new Set(['media', 'midi', 'midiSysex', 'fileSystem', 'clipboard-sanitized-write']);
  const ours = (origin) => origin?.startsWith(`${SCHEME}://app`);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(allowed.has(permission) && ours(details.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin) =>
    allowed.has(permission) && ours(origin));
  ipcMain.on('stream:open', (event) => openStream(event.sender));
  ipcMain.on('stream:data', (event, data) => {
    const frame = typeof data === 'string' ? data : Buffer.from(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
    streams.get(event.sender.id)?.message(frame, typeof data !== 'string');
  });
  ipcMain.on('stream:close', (event) => closeStream(event.sender.id));

  // The stream key (#8): YOUTUBE_STREAM_KEY wins; otherwise the one stored in the
  // OS's secure store, or one entered for this run when it cannot be stored safely.
  // A stored key is unlocked only when Go live starts: reading it may make macOS
  // ask for the person's password, which nobody expects when an app starts.
  const keys = new StreamKeyStore({ safeStorage, directory: app.getPath('userData') });
  let keySource = live.available ? 'environment' : null;
  if (!keySource && await keys.has()) {
    live.setKeyUnlock(() => keys.load());
    keySource = 'stored';
  }
  const fromOurPage = (event) => ours(event.senderFrame?.url);
  const keyChanged = () => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('key:changed'));
  ipcMain.handle('key:status', (event) => (fromOurPage(event) ? { source: keySource } : {}));
  ipcMain.handle('key:set', async (event, key) => {
    if (!fromOurPage(event)) return { ok: false, message: 'Not allowed' };
    if (keySource === 'environment') return { ok: false, message: 'The stream key comes from YOUTUBE_STREAM_KEY' };
    try {
      if (!live.setKey(String(key).trim())) return { ok: false, message: 'That is not a stream key: copy it from YouTube Studio' };
      try {
        await keys.save(String(key).trim());
        keySource = 'stored';
        return { ok: true, message: 'Stream key saved' };
      } catch (error) {
        keySource = 'session';
        return { ok: true, message: `Stream key kept until the app quits: ${error.message}` };
      }
    } catch (error) {
      return { ok: false, message: error.message };
    } finally {
      keyChanged();
    }
  });
  ipcMain.handle('key:clear', async (event) => {
    if (!fromOurPage(event)) return { ok: false, message: 'Not allowed' };
    if (keySource === 'environment') return { ok: false, message: 'The stream key comes from YOUTUBE_STREAM_KEY' };
    try {
      live.setKey('');
      await keys.clear();
      keySource = null;
      return { ok: true, message: 'Stream key cleared' };
    } catch (error) {
      return { ok: false, message: error.message };
    } finally {
      keyChanged();
    }
  });

  // The window opens where it was last (#10), if that is on a screen connected now.
  const windowState = new WindowState(app.getPath('userData'));
  const open = async () => {
    const saved = windowState.load();
    const window = new BrowserWindow({
      ...fitBounds(saved, screen.getAllDisplays().map((display) => display.workArea)),
      title: 'MatrixPrism', show: !BACKGROUND,
      webPreferences: { preload: path.join(HERE, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false,
        backgroundThrottling: !BACKGROUND },
    });
    // Nothing but this app's own address may load in the window.
    window.webContents.on('will-navigate', (event, target) => { if (!ours(target)) event.preventDefault(); });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    if (saved?.maximized && !BACKGROUND) window.maximize();
    windowState.track(window);
    await window.loadURL(`${SCHEME}://app/index.html`);
    // A remembered Media Player folder is reopened as if its button were
    // clicked (#10): reading it again needs a user gesture, and this app's
    // permission handler grants folder access to its own page.
    window.webContents.executeJavaScript('window.matrixprismReopenFolder?.()', true).catch(() => {});
    return window;
  };
  await open();
  // Opening the app again brings its window forward; on macOS the Dock icon opens one.
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) open(); });
});

// A recording or a live stream still running is finished before the app goes.
let closing = false;
app.on('before-quit', (event) => {
  if (closing) return;
  event.preventDefault();
  closing = true;
  Promise.all([recordings.close(), live.close()]).finally(() => app.quit());
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
