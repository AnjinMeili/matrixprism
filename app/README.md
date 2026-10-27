# The MatrixPrism desktop app (T65): the composer in an Electron window

A spike, not a product: the composer in its own window, with the relay's code
in the main process and **no server and no open port**. It exists to price the
Electron route in `docs/packaging-plan.md` (that plan is on the
`packaging-plan` branch).

Run it, from this folder, with `npm install` once (Electron 45, about 250 MB,
checksummed by its installer) and then:

```sh
npm start
```

If it starts as plain Node and says `app` is undefined, your environment has
`ELECTRON_RUN_AS_NODE` set (some editors set it): `env -u ELECTRON_RUN_AS_NODE
npm start`.

## How it works

- `main.mjs` answers a secure scheme, `matrixprism://app/`: files from
  `../composer/public`, and the `/api/config`, `/version`, `/receivers` and
  `/info` calls from the relay's own `lib/` modules. The frame socket is IPC.
- `preload.cjs` puts a stand-in for `WebSocket` in front of that IPC channel for
  the `/stream` address only, so `composer/public/app.js` is **unchanged**.
- The composer's code is read from `../composer`, not copied.

## What works, what does not

Works (measured on 2026-10-25): the page loads; the
per-receiver settings, streaming, the frame limit and the brightness reach a
fake receiver on UDP 4048 as `check-app.mjs` measures them (the same checks as
`npm run check-receivers`); the page has a secure context, the microphone API,
Web MIDI, the folder picker, `ImageDecoder`, WebGL and AudioWorklet.

Not in the spike: recording and Go live (`/api/recordings`, `/api/live`),
packaging, signing, a quit control, an icon, and the spike's checks for a
real microphone, MIDI device or folder, which need a person.

## Check

```sh
node check-app.mjs      # opens the window briefly; needs UDP port 4048 free
npm test                # the stream key store, in plain Node
node check-app-key.mjs  # the stream key end to end, hidden, with a stand-in keychain
node check-app-microphone.mjs  # a live microphone; MATRIXPRISM_OPEN=1 starts a packaged app as the Finder does
```

The stream key (`stream-key.mjs`) is kept with Electron's `safeStorage`, async
functions only, in `stream-key.enc` in the app's data folder. Each new ad hoc
signed build is a different program to the Keychain, so macOS may ask once
per build to let MatrixPrism use "MatrixPrism Safe Storage"; a Developer ID
signature ends that.

## Building the macOS app

```sh
npm install                # once; Electron and electron-builder
node tools/make-icon.mjs   # only to redraw the placeholder icon
npm run dist:mac           # stages dist-stage/, builds dist/MatrixPrism-<version>-arm64.dmg
```

`tools/stage.mjs` copies the app and the composer's `lib/` and `public/` into
`dist-stage/` in the repository's own layout; `electron-builder.yml` says how to wrap
it (Info.plist entries for the microphone, the local network and Bonjour, the icon,
the `.dmg`). The build is **ad hoc signed**, which makes the bundle valid but not
trusted: macOS warns on a downloaded copy. A Developer ID signature and notarisation
replace that once the Apple account exists.

To check the packaged app instead of the development copy:

```sh
MATRIXPRISM_ELECTRON=$PWD/dist/mac-arm64/MatrixPrism.app/Contents/MacOS/MatrixPrism \
MATRIXPRISM_PACKAGED=1 node check-app.mjs      # also check-app-recording.mjs, check-app-discovery.mjs
```
