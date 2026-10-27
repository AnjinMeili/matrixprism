# Plan: packaging and distribution (T65)

**Status: a plan, with research done on 2026-10-25. Nothing is built.** It
follows from asking what people who buy these panels expect ("install in one step") and
from the decision that the public way in is not `git clone` and `npm start`.
Claims here that rest on forum posts, third-party trackers or pages not
checked at their source say so.

## What is being packaged

The relay, `composer/server.js` (307 lines) and `composer/lib/` (about 860),
on Node's built-in modules and one vendored library:

- it serves `composer/public/` (3.8 MB, with Essentia's WebAssembly) by
  reading files from disk;
- it turns WebSocket frames from the browser into DDP packets on UDP 4048
  (`node:dgram`), and asks the network for receivers by an mDNS multicast query
  (`setMulticastTTL(255)`);
- it starts FFmpeg with `child_process.spawn` for recordings and the live
  stream, and `git` with `execFile` for the version line, which falls back
  when there is no checkout;
- it listens on `127.0.0.1` unless told otherwise, limits each WebSocket frame
  (`maxPayload`) and refuses cross-site and unknown-host requests;
- its one dependency, `ws` 8.22.0, is vendored in `composer/lib/vendor/ws/`.

Two things follow. A packaged copy must serve `public/` from inside itself,
which today it cannot, because the server reads `PUBLIC_DIR` from the file
system. And it must keep a real network stack underneath: UDP unicast, UDP
multicast, and a child process.

## The candidates, reviewed

Security means known advisories and the trust a user must place in the build.
Bugs means open issues that touch what the relay does. Development means how
alive the project is. GitHub Actions means how well it builds on hosted runners.

| Candidate | Security | Bugs and limits for this relay | Development | GitHub Actions | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Node single executable (SEA)** | The runtime is Node's own, with its release and security process. Signing is on us. A build adds the `postject`/LIEF step. | ES modules work (`mainFormat: module`); bundle to one file. Assets need `useVfs` (Stability 1.0, from v26.9.0) or an asset map read through `sea.getAsset`. `import.meta.resolve` is unsupported. macOS x64 is not in Node's own test matrix (arm64 only); Windows, Linux are. The macOS signature must be removed before injection and the result signed again. No native addons are used here, so the arm64 Docker `dlopen` crash does not apply. | `--build-sea` added in 25.5.0 (26 January 2026), the feature is Stability 1.1. Node 25 is an odd, short-lived line; Node 24 left Active LTS on 20 October 2026; **Node 26 becomes LTS on 28 October 2026**. Whether `--build-sea` reaches an older LTS is not confirmed. | Official `setup-node`; one job per platform; cross-building is shown in the docs for Linux from macOS only. | **First choice**, built with Node 26 |
| **Bun compile** | Different engine (JavaScriptCore) and a different runtime to trust. A withdrawn advisory (CVE-2025-8022, `$` shell) does not apply. | Six targets from one machine. Windows metadata only when built on Windows. macOS needs a JIT entitlement to sign. Reports found: `setMulticastTTL(0)` fails on Windows (we use 255, so not hit; fix status unconfirmed); `child_process` `exit` event not emitted on macOS in `bun test` (we rely on `exit` for FFmpeg); a 1.4.0 `child_process` regression on Windows, fixed in 1.4.1; segfaults in other projects' compiled binaries. | Fast-moving; frequent releases. | Official `setup-bun`; single-runner cross-builds. | **Second.** Only if Node's build per platform proves a burden, and only after `check-receivers` and the recording checks pass against it |
| **`@yao-pkg/pkg`** | Described by its docs as updated with Node's security releases (not verified at the source). | Most compatible with native addons, which this relay does not have. | A maintained fork of `pkg` (that the original is archived was not rechecked here). | Works from any runner. | **Fallback**, not tried |
| **Container image** | A small base image, a non-root user, and the image published with provenance. | On Linux with host networking, UDP unicast and multicast work. Docker Desktop's host networking (4.34 and later, opt-in) works at layer 4 only and the container cannot use the host's interfaces; forum posts report multicast failing on macOS, the official docs do not say. | Docker's own. | `docker/build-push-action` to `ghcr.io`, two architectures. | **Second route**, for an always-on Linux host or a Pi |
| **Electron** | Chromium security fixes arrive every few weeks and each means a rebuild and a new download; it supports only the newest three majors and gives older ones no fix. | 200 MB and up; needs signing and an update path. | Eight-week cadence; Electron 45.0.0 is the current release on npm (October 2026). | `electron-builder` or Forge on three runners, signing by secrets. | **First choice for the desktop app**, if its spike passes (track A) |
| **Tauri** | Uses the system web view. | On macOS that is Safari's engine, which lacks `ImageDecoder`, the folder picker and Web MIDI that this composer uses; each needs a native bridge. | | | **Not ruled out any more:** the same idea as the native shell, priced by spike B |
| Deno compile, nexe, caxa | Not reviewed beyond one mention. | | | | Not pursued |

## The shipped parts, reviewed

- **`ws`.** CVE-2026-48779, a memory-exhaustion denial of service from floods of
  tiny fragments, is fixed in ws 8.21.0 (and 7.5.11, 6.2.4, 5.2.5). We vendor
  8.22.0, so it does not apply. Step 1 below adds a test that fails if the
  vendored version ever falls under 8.21.0. The relay also caps each frame with
  `maxPayload`.
- **Default exposure.** The packaged relay keeps `--listen 127.0.0.1`. A packaged
  copy must not change it; a double-clicked program that opens the LAN would be
  a new risk. (A page served to other computers is still a deliberate flag.)
- **Build trust.** The runtime binary comes from the project that makes it;
  its published checksum is verified in the build, and the build has no other
  downloads. There are no npm dependencies to audit.
- **FFmpeg** stays an external install in every route (it is GPL or LGPL
  depending on the build, and large); the README says so, and the browser's
  own WebM recording stays the way for a user who does not have it.

## The GitHub Actions method

A release-only workflow. It builds and attaches files; it gates nothing and
never runs on a push or a pull request.

- **Where.** `.github/workflows/release.yml` lives in the development tree, so
  the export carries it to the public repository. It runs there, on a pushed
  tag `v*`, and by hand (`workflow_dispatch`) for a trial without a release.
  Artifact attestations need a public repository on a free plan, which is a
  reason to build on the public side. The development repository (private) has
  Actions turned off, or is never given a tag.
- **Permissions.** The default for the workflow is `contents: read`. Only the
  job that attests gets `id-token: write` and `attestations: write`, and only
  the job that creates the release gets `contents: write`. The macOS and
  Windows signing secrets live in a `release` environment, never in the
  repository's general secrets; forks and pull requests never see them, and
  there is no `pull_request_target`.
- **Pinning.** Every third-party action is pinned to a full commit hash, with
  its version in a comment. A new Node or action version is a deliberate edit.
- **Matrix.** `macos-15` (arm64 only), `windows-latest`, `ubuntu-24.04`, and an
  Arm Linux runner (the exact label to be confirmed in GitHub's runner list
  before use). No Intel Mac build: those Macs use the Linux routes.
- **Per job.** Check out with `persist-credentials: false`; install the exact
  Node 26 version; run `npm test` once on Linux; run the build script (`composer/tools/build-executable.mjs`, giving
  `matrixprism-<os>-<arch>` for the headless relay) or the app builder
  (`electron-builder`, giving the `.dmg`, installer or AppImage);
  start the built file and run the smoke check against it (below); sign;
  write `SHA256SUMS`; attest with `actions/attest-build-provenance` (v3 at the
  time of writing) on the built files.
- **Release.** A final job creates a **draft** release with the files and the
  checksums. You download one on a Mac account with no Node, run it, and
  promote the draft. Nothing is published by the workflow itself.
- **Signing.**
  - *macOS:* a Developer ID Application certificate imported into a temporary
    keychain from a secret, `codesign` with the hardened runtime and the JIT
    entitlements Node needs (to be confirmed on the first build), then
    `notarytool submit --wait`. A bare command-line binary cannot be stapled
    (reports from 2019, not rechecked), so Gatekeeper contacts Apple on first
    run; shipping a signed `.pkg` or `.dmg` would allow stapling. This costs an
    Apple Developer Program membership (annual fee, not checked here).
  - *Windows:* the free route is the SignPath Foundation for open-source
    projects (it states the build must be automated from a public repository;
    the licence and file-type rules were not confirmed, and early reports gave
    GitHub Actions support as a beta). The paid route is Azure Artifact Signing
    (about USD 10 a month; open to organisations and individuals in the US and
    Canada, and organisations in the EU and UK). Neither gives an EV
    certificate, so SmartScreen may still warn until the file has a reputation.
  - *Linux:* unsigned, with checksums and the attestation.

## First build (2026-10-25)

`app/` now builds a macOS `.dmg` with electron-builder 26.18.0: `npm run dist:mac`
stages the app and the composer's files and produces `MatrixPrism-0.1.0-arm64.dmg`
(116 MB; the app is 262 MB), ad hoc signed, with the microphone, local-network and
Bonjour (`_wled._tcp`) entries in its Info.plist and a placeholder icon. The checks
run against the packaged app, not the development copy: the receivers check, a real
recording (H.264 and AAC through FFmpeg found on a bare system PATH) and the search
for receivers by mDNS all pass; nothing listens on a port. Not yet done: a Developer
ID signature and notarisation (needs the Apple account), a Windows and a Linux build,
a release workflow, and how the first launch looks to a person who downloaded it
(macOS warns on a download that is not notarised).

## Direction: three tracks around one shared core

The relay's code (the DDP sender, mDNS, recording, FFmpeg, the live stream, the
file serving) is the core. Three ways to wrap it:

- **A. Desktop app, Electron first.** The page runs in a bundled Chromium; the
  core runs in the main process; no server and no open port. A custom secure
  `app://` address answers static files and the `/api/...` calls from code, so
  `app.js` changes only where it opens its frame socket. `electron-builder`
  makes the `.app` and `.dmg`, signs, notarises and staples, and has documented
  GitHub Actions steps. It keeps all of our code and the engine our checks
  cover. It costs 200 MB or more and a rebuild whenever Chromium has a security
  fix.
- **B. Native macOS shell, as the alternative to price.** A Swift app hosting
  the page in the system web view, with native code for UDP and mDNS
  (Network.framework), about 10 MB, and security fixes arriving with macOS. The
  web view has no Web MIDI, `ImageDecoder` or folder picker, so each needs a
  native bridge, and our checks do not cover its engine. It keeps the door open
  to the native strengths: Core Audio capture with clean timing, and Metal
  compute for the spectrum and for simulations such as Spectrum Flock at far
  higher counts. A full native rewrite (Swift and Metal) is the end of this
  road; it is not priced here and leaves Windows and Linux without a program.
- **C. Headless relay, for Linux, Windows and always-on hosts.** The core as a
  Node single executable (Node 26) and a container, serving the page to a
  browser as today. This is also the route for Intel Macs.

## Spike A, priced (2026-10-25)

A minimal Electron 45 shell was built (branch `electron-spike`, folder `app/`):
the relay's modules run in the main process, the page loads from a secure
`matrixprism://app/` address, and the frame socket is an IPC channel behind a
`WebSocket` stand-in, so `app.js` is unchanged. Measured:

- the receivers check passes against it, with frames arriving at the rates
  and brightness set, as with the server and Chrome;
- in the app the page has a secure context, the microphone API, Web MIDI, the
  folder picker, `ImageDecoder`, WebGL and AudioWorklet;
- download size about 115 MB (252 MB unpacked); memory about 580 MB across nine
  processes at idle (an overestimate); no process listens on a TCP port.

Not yet shown: the microphone with a loopback input, Web MIDI with a real
controller and the folder picker as a person uses them; recording and Go live;
signing, notarising and an update path. Estimated work to a signed, notarised
`.dmg`: 7 to 10 working days, then a rebuild at least about twice a year and
for each Chromium security fix. Spike B (the native shell) was not priced, by
choice; a native route stays open as a later alternative.

## Steps, in order, each with its check

0. **Decisions** (below).
1. **Finish spike A** (B is set aside). It must still show, with a person:
   - the microphone, with a BlackHole input selectable and a clean signal
     (compare with Chrome's);
   - Web MIDI, or a bridge for it, working with the APC40;
   - the folder picker or its replacement;
   - UDP and mDNS from the app's own process, passing `check-receivers`
     pointed at it;
   - the page's own checks passing in it (`check-quad-view`, `check-midi`).
   Write the result down. If it fails on the microphone or MIDI in the app,
   reconsider B.
2. **The shared core.** Split `server.js` into a relay you can create from code
   (the DDP sender, mDNS, recording, live stream and file serving, with the path
   check against `..`) and a thin command-line wrapper. Add a test that the
   vendored `ws` is at least 8.21.0. *Check:* `npm test`, and a test that the
   file serving returns the same bytes from disk and from inside an executable.
3. **The chosen app shell, for macOS first**, signed and notarised by the
   builder, shipped as a `.dmg` with the app stapled. *Done when* it opens on a
   Mac account with no Node and **with the network off**, and passes
   `check-receivers` and the page checks. That observation, not the build
   succeeding, is the criterion.
4. **Quit, and the first-run basics:** a Quit control, opening the app again
   brings the existing window forward, and FFmpeg is found in the usual places
   (a double-clicked app does not get your shell's PATH, so Homebrew's
   `/opt/homebrew/bin` is not seen) with a setting to name it.
5. **Measure:** file size, start time, memory, recording and the live stream.
6. **Windows and Linux:** the headless relay as a single executable on Node 26,
   built with `build-executable.mjs`, and the Windows signing application to
   the SignPath Foundation, started early because it is the slow part. The
   Electron route also gives Windows and Linux installers, if A is chosen.
7. **The workflow,** run first by hand on a test tag, with the attestation
   verified (`gh attestation verify`) on a downloaded file.
8. **A Dockerfile** of a dozen lines and a compose file, tested on a Linux host
   with host networking; the README states the Docker Desktop limit.
9. **The README quick start:** download, double-click, open; `git clone` moves
   to a Developing section. The `npx matrixprism` idea in the hosting plan is
   dropped, since it needs Node on the machine.

## Decisions

Made on 2026-10-25:

- **Node SEA on Node 26 first, Bun only as an alternative** (recommended, accepted
  by not being questioned; not stated in so many words).
- **macOS signing is paid for:** an Apple Developer Program membership.
- **Windows signing takes the slow, free route:** apply to the SignPath
  Foundation, and ship unsigned or with a warning until it is granted.
- **No executable for Intel Macs.** Macs with Intel chips are being retired, and
  Node does not test them. They are served by the Linux routes: the Linux
  executable or the container (typed receiver addresses work there; discovery
  by mDNS may not on Docker Desktop).

Still open:

- **A reviewer on the release environment?** GitHub can require an approver
  before secrets are used. It would gate only a release, never other work.
- **Electron or the native shell** for the macOS app: Electron is priced and
  passed its receivers check; the native shell was not priced.

## What the research did not establish

- Whether `--build-sea` is, or will be, in an LTS older than 26.
- A macOS-to-Windows build of a Node SEA; the plan builds each on its own runner.
- The JIT entitlements Node needs to run signed, and whether notarising a bare
  binary works as the 2019 reports say.
- SignPath's current licence, file-type and GitHub Actions rules.
- Bun's fix status for the multicast and `child_process` reports above.
- Executable sizes and start times for this relay.
- The exact Arm Linux runner label, and any 2026 changes to the runner images.
