# Agent guide

Instructions for an AI coding agent working in this repository, MatrixPrism.
It has two parts: the composer in `composer/` (a browser app and Node
server that compose and stream the picture) and the receiver in `receiver/`
(`matrix-dmx` and `scene-tool`, C++, for the Raspberry Pi). The composer
streams DDP to any receiver, WLED as well as `matrix-dmx`, so docs should
not assume the receiver is a Pi. `CLAUDE.md` imports this file, so Claude Code loads it at the start of every session.

Anjin's checkout also has `notes/`, private development notes left
out of the public repository; when `notes/AGENTS.private.md` exists,
`CLAUDE.md` imports it too and its rules add to these.

## Read first

1. [docs/roadmap.md](docs/roadmap.md): what works, what has and has not been
   checked, and what is planned.
2. [docs/composer-spec.md](docs/composer-spec.md) before changing the
   composer: pipeline, pattern interface, modules, saved settings.
3. The `NOTICE.md` in a ported pattern directory before adding to that port.
4. [docs/audio-features-plan.md](docs/audio-features-plan.md) before changing
   the audio analysis (`audio.js`, `tempo.js`, `key-detector.js`): the
   planned comparison with Meyda and Essentia.js (T26).
5. [docs/findings.md](docs/findings.md) before changing something that was
   measured (colour, audio analysis, tempo, cost, recording), and when a
   question about a pattern's colour or the panel's brightness comes up.
6. [CREDITS.md](CREDITS.md) before bringing in code, data or an idea from
   elsewhere; add the source to it in the same commit.

## Which skill to load

Load the skill in the right column *before* starting the work in the left.
If one is not in your session's skill list, carry on without it and say so.

| When the task is… | Load | Why |
|-------------------|------|-----|
| Porting patterns from an upstream Arduino/FastLED project, or reviewing one before porting | `port-pattern-batch` (project skill) | Licence check, porting rules, tests, records, helper scripts |
| Reviewing a branch, diff or pull request for bugs | `code-review` | Severity-ranked: each finding with its failure and fix |
| Tidying just-changed code without hunting bugs | `simplify` | Ports arrive in batches and collect duplication |
| Anything touching `composer/server.js`, `lib/ddp.js`, or the receiver's sockets, HTTP or mDNS (`wled_compat.cc`, `matrix-dmx.cc`, `udp_socket.cc`) | `security-review` | Browser input is relayed to UDP; the receiver listens on the LAN |
| Starting the composer to see a change working | `run` | See "Verifying" for what it can and cannot show |
| Checking the page, layout or shaders in a real browser (`mcp__Claude_Browser__*` or `mcp__claude-in-chrome__*` tools) | `anthropic-skills:built-in-browser` or `anthropic-skills:chrome-browser` | The only in-session way to catch shader compile and layout faults |
| Driving a desktop app, such as Audio MIDI Setup | `anthropic-skills:computer-use` | Audio faults have come from device setup |
| Surveying an upstream repository, its forks and licences | `anthropic-skills:deep-research` | Only if the session can spawn subagents |
| A chart or diagram, or Spectrum Lab's colours, axes or labels | `dataviz` | Legible, consistent charts |
| Anjin asks for a shareable page or published report | `artifact-design`, then `artifact-capabilities` or `artifact-diagramming` | Not for routine reporting, which goes in `docs/` |
| Anjin asks for a Word, PDF, slide or spreadsheet file | `anthropic-skills:docx`, `pdf`, `pptx`, `xlsx` | Only on request |
| Too many permission prompts, or changing hooks, permissions or environment | `fewer-permission-prompts`, `update-config` | |
| Repeating a task on an interval | `loop` | Ports run to hundreds of patterns |
| Turning a repeated workflow into a project skill | `anthropic-skills:skill-creator` | Project skills live in `.claude/skills/` |

## Verifying

```sh
cd composer && npm test      # composer: must pass before every commit
npm run check-shaders        # composer: after any change to a shader
npm run check-test-card      # composer: after any change to test-card.js
npm run check-sparkles       # composer: after any change to sparkle.js
npm run check-essentia-live  # composer: after any change to the Essentia beat source
npm run check-param-controls # composer: after any change to params.js or param-controls.js
npm run check-hotsave        # composer: after any change to playlists, look.js, Hotsave or how entries load into pairs
npm run check-variations     # composer: after any change to seed.js, a pattern's variation, or how the renderer makes instances
npm run check-cue-lists      # composer: after any change to cue-clock.js, cue lists or the Playlist view
npm run check-receivers      # composer: after any change to receivers.js or the sending loop
npm run check-midi           # composer: after any change to midi-input.js or the Monitor's MIDI controls
npm run check-raw-spectrum   # composer: after any change to spectrum-bands.js, the raw texture or rawSpec
npm run check-quad-render    # composer: after any change to renderer.js's quad paths or the compositor
npm run check-layout         # composer: after any change to layout.js, layout-view.js, help.js or their styles
npm run check-quad-view      # composer: after any change to the quad mixer's view or its wiring in app.js
npm run check-monitor-nudge  # composer: after any change to beat-fold.js, monitor.js or the Monitor view
npm run check-monitor-key    # composer: after any change to key-detector.js, key-wheel.js or the Monitor's Key panel
npm run check-stream-out     # composer: after any change to tools/stream-out.mjs or lib/stream-out.js
npm run check-live           # composer: after any change to lib/live.js or the live endpoint in server.js
npm run check-live-page      # composer: after any change to the Go live controls in app.js or index.html
npm run check-video-gamma    # composer: after any change to video-gamma.js or what Record and Go live capture
npm run check-saved-state    # composer: after adding or changing any control, or how settings are saved
cd app && npm test           # desktop app: the stream key store
node app/check-app-key.mjs   # desktop app: after any change to the stream key (stream-key.mjs, main.mjs, preload.cjs)
node app/check-app-microphone.mjs # desktop app: after any change to the entitlements or the microphone
node app/check-app-saved-state.mjs --strict # desktop app: after any change to settings, the window or main.mjs
node app/check-ndi-binding.mjs --headers <dir> # NDI build: after any change to lib/ndi.js's calls (needs npm --prefix app/ndi ci)
node app/check-app-ndi.mjs --expect stub --headers <dir> # NDI build: after any change to the NDI output, in the app
make -C receiver test         # receiver protocol, recording, scene tool
```

- What each check and measurement covers, needs and misses, with their
  options, is in [docs/checks.md](docs/checks.md): read a check's entry
  there before relying on it. It also covers the measurement tools that are
  not checks: `tools/record-input.mjs`, `tools/pattern-frames.mjs`,
  `frame-compare`, `pattern-pixels`, `measure-colours`, `measure-quad-cost`,
  `measure-fire.mjs`, `measure-bounce.mjs`, `measure-live-bitrate.mjs`,
  `compare-audio` and `compare-tracks`.
- These checks do not see layout, real audio devices, video decoding,
  IndexedDB or Safari, which differs from Chrome (no `ImageDecoder`, no
  folder picker). Another computer on the network can open a page served
  with `--listen 0.0.0.0`. Screenshots help with layout: `check-quad-view
  -- --screenshot` and `tools/pattern-frames.mjs`; look at them, as checks
  have passed over faults a screenshot showed. If no browser tool is
  available, say plainly that the page was not seen running and ask 
  Anjin to reload and check.
- Nothing here can see the LED panel. What the panel shows can differ from
  the preview in brightness; see "The panel against the preview" in
  `docs/findings.md`. The
  Panel Range pattern (T21) is the test card for reading the panel.
- **Measure before concluding.** How things appear and what is so are
  different things. When something looks wrong (a pattern's colour, the
  panel's brightness, the beat), measure it with the tools here, or build one
  (put it in `composer/tools/` beside the others), and report figures with
  what they do and do not cover.
- Whether a receiver, WLED or `matrix-dmx`, is up can be checked without
  logging in to it: `curl http://<receiver>/json/info`.
- Compositing and timing rules are kept in pure modules with a JavaScript
  reference beside the GLSL (`mixer.js`, `shape.js`, `tempo.js`). Change the
  two together and test the reference.
- The receiver does not link on macOS (the matrix library does not build
  there). Objects compile and `make -C receiver test` runs; behaviour on the
  Pi has to be checked on a Pi with a panel.

## Working rules

- **Branches.** New work goes on a branch off `main`, checked out in the
  working clone; a `git worktree` only when two pieces of work run at once.
  Notes-only and docs-only edits can go straight to `main`. `main` is
  releasable: merge into it only when every test and check passes and the
  change has been tried by Anjin and accepted. When work is ready, say how to
  try it on the branch, with a test plan, and wait.
- **Commits, merges and pushes.** Commit finished work to the working branch,
  every commit with a test plan in its message (the shape is in
  [docs/templates/commit-message.txt](docs/templates/commit-message.txt);
  the other records' shapes are beside it). Anjin's acceptance is the
  go-ahead to run the checks again, merge and push. Delete a branch only once
  it is in `main`, and say so.
- **A running copy.** The composer's server reads the page from disk, so
  checking out a branch in a clone where the composer is running changes
  what the browser gets on its next reload; changes to `server.js` or `lib/`
  need the server restarted, which the agent may do. The composer has no npm
  dependencies, so its tests run in any checkout without `npm install`.
- **Reporting goes in the repo.** Keep `docs/roadmap.md`, the READMEs and
  `composer-spec.md` in step with the code, in the same commit where
  practical, and state what was and was not verified. A measurement that
  changes a decision gets a short summary in `docs/findings.md`: what was
  asked, how it was measured, the figures, and what was done.
- **Measurements keep their evidence.** Save the raw outputs, logs and
  screenshots of a measurement as it runs; output only printed to the
  terminal is lost. Never commit audio, video or anything personal to the
  machine or network (local paths, addresses, device names).
- **Ports.** Check the upstream licence first, file by file if there is no
  licence file, and record the position in that port's `NOTICE.md`. Keep the
  original function names, note every deliberate difference, put each
  port in its own directory under `composer/public/patterns/`, and add the
  source to `CREDITS.md`.
- **Credit.** Anything taken or adapted from elsewhere, code, data, a
  palette or an algorithm, is named in the file's header and in
  `CREDITS.md` with its authors and licence.
- **The Pi.** Run nothing on a receiver's Pi over ssh without showing the
  exact command and getting a yes first; prefer read-only commands.
