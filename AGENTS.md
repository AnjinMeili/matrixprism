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

Skills are loaded on demand with the Skill tool. Load the one in the right
column *before* starting the kind of work in the left column. Names are as
they appear in the session's skill list; if one is not listed in your
session, carry on without it and say so.

| When the task is… | Load | Why it matters here |
|-------------------|------|---------------------|
| Porting patterns or effects from an upstream Arduino/FastLED project, continuing an existing port, or reviewing a pattern repository before porting | `port-pattern-batch` (project skill, in `.claude/skills/`) | The licence check, reading, porting rules, tests and records used for the Mark Estes and AuroraDrop ports, with helper scripts |
| Reviewing a branch, a diff or a pull request for bugs | `code-review` | Use a severity-ranked style: each finding with the failure it causes, then its fix |
| Tidying code that was just changed, without hunting for bugs | `simplify` | Ports arrive in large batches and collect duplication |
| Anything touching `composer/server.js`, `lib/ddp.js`, or the receiver's sockets, HTTP or mDNS (`wled_compat.cc`, `matrix-dmx.cc`, `udp_socket.cc` in `receiver/`) | `security-review` | The server relays browser input to UDP and the receiver listens on the LAN; the review already found a crash and a cross-site hole there |
| Starting the composer to see a change working | `run` | Covers launching and driving the app; see "Verifying" below for what it can and cannot show |
| Checking the composer's page, layout or shaders in a real browser, when the session has the desktop app's browser pane (`mcp__Claude_Browser__*` tools) | `anthropic-skills:built-in-browser` | This is the only way to catch shader compile errors and layout faults in-session |
| The same, when the session has the Chrome extension (`mcp__claude-in-chrome__*` tools) | `anthropic-skills:chrome-browser` | As above |
| Driving a desktop app, such as Audio MIDI Setup while chasing an audio routing fault | `anthropic-skills:computer-use` | Audio problems have come from device setup, not code |
| Surveying an upstream pattern repository, its forks and its licence position across several sources | `anthropic-skills:deep-research` | Each port starts with a licence and structure review; only use it if the session can spawn subagents |
| Drawing a chart or diagram for a document, or changing how Spectrum Lab chooses colours, axes or labels | `dataviz` | Keeps charts legible and consistent |
| Anjin asks for a shareable page, dashboard or published report | `artifact-design` first, then `artifact-capabilities` or `artifact-diagramming` if the page needs live data or diagrams | Not for routine reporting, which goes in `docs/` |
| Anjin asks for a Word, PDF, slide or spreadsheet file | `anthropic-skills:docx`, `anthropic-skills:pdf`, `anthropic-skills:pptx`, `anthropic-skills:xlsx` | Only on request; project documents are Markdown in the repo |
| Too many permission prompts for `npm test`, `make -C receiver test`, `git` and similar | `fewer-permission-prompts` | These run constantly in this repo |
| Changing hooks, permissions or environment for the harness | `update-config` | |
| Repeating a task on an interval, such as porting patterns batch by batch | `loop` | Ports run to hundreds of patterns |
| Turning a repeated workflow here into a reusable skill, or improving `port-pattern-batch` | `anthropic-skills:skill-creator` | Project skills live in `.claude/skills/` |

Skills that do not apply to this project, so do not load them for it:
`claude-api` (nothing here calls an LLM), `anthropic-skills:google-workspace`,
`anthropic-skills:morning`, `anthropic-skills:import-memory`, `schedule`,
`plugin-authoring`, `keybindings-help`, `anthropic-skills:docs` (reporting
lives in the repo, not in hosted documents).

## Verifying

```sh
cd composer && npm test      # composer: must pass before every commit
npm run check-shaders        # composer: after any change to a shader
npm run check-test-card      # composer: after any change to test-card.js
npm run check-sparkles       # composer: after any change to sparkle.js
npm run check-essentia-live  # composer: after any change to the Essentia beat source
npm run check-param-controls # composer: after any change to params.js or param-controls.js
npm run check-hotsave        # composer: after any change to playlists, look.js or Hotsave
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
make -C receiver test         # receiver protocol, recording, scene tool
```

- `npm run check-shaders` compiles the compositor and every shader pattern
  in headless Chrome. Run it after changing a pattern's GLSL or the
  compositor in `composer/public/renderer.js`, `shape.js` or `mixer.js`. It
  needs Chrome on the machine and does not look at the picture.
- `npm run check-test-card` draws the Panel Range card's shader in headless
  Chrome and compares every pixel with its JavaScript reference.
- `npm run check-midi` connects a fake MIDI device to the real page in
  headless Chrome, learns a pad for Tap and one for Downbeat, taps by the
  messages' own times (120 BPM), presses the Downbeat and Tap buttons and the
  D key, and forgets a pad. Real devices, the downbeat's
  effect on the bars and Safari (no Web MIDI) are not covered.
- `npm run check-raw-spectrum` draws a shader that paints each column from
  `rawBand` through the real renderer, with known sound at several FFT sizes
  and sample rates, and checks the bright and dark columns. It does not look
  at the picture; `tools/pattern-frames.mjs` does.
- `npm run check-sparkles` does the same for the sparkles laid over every
  pattern (`sparkle.js`, T30), for several sets of hits and settings at three
  panel sizes. A level off by one is allowed for float rounding.
- `npm run check-essentia-live` runs the Essentia beat source's live path
  in headless Chrome on its fake microphone: the audio tap
  (`pcm-capture-worklet.js`), the worker (`essentia-worker.js`) and
  Essentia's WebAssembly. It passes if Essentia loads and makes estimates;
  it does not judge the tempo, and does not cover Safari.
- `npm run check-param-controls` builds the Pattern settings controls
  (`param-controls.js`) in headless Chrome, changes each kind as a person
  would and checks what is saved and reset. It does not look at the layout.
- `npm run check-hotsave` opens the composer in a frame in headless Chrome,
  sets a look, presses the Hotsave key, changes the look and shows the saved
  entry, then checks the look and its controls came back. The server is not
  running, so nothing streams; it does not cover Safari or the layout.
- `npm run check-receivers` runs a fake receiver on UDP 4048, the server
  and the page in headless Chrome, and measures the frames a second and the
  brightest byte that arrive for two known receivers with different
  settings, and that switching between them brings each one's settings back.
  It needs port 4048 free on the Mac.
- `npm run measure-quad-cost` is a measurement: what a frame of the quad
  mixer (T16) costs against today's, at three sizes, in headless Chrome;
  `-- --serve` serves the page for a real browser on this Mac, which sends
  the figures back; add `--listen 0.0.0.0` for another computer on the
  network. Compare against "What a quad mixer frame costs" in
  `docs/findings.md`.
- `npm run check-quad-render` checks the renderer's quad mixer paths
  (`renderQuad`) against references in headless Chrome: the master at Right
  and half way, input trims, the Gated preview, blackout, one instance per
  input. It requires lit frames, since a check passed on black frames proves
  nothing.
- `npm run check-layout` draws the quad mixer's default layout in headless
  Chrome at 1440×900 and 600×900 and checks column shares, pane order and
  heights, mirroring, stacking, kept elements and the help popover. It does
  not judge the look.
- `npm run check-quad-view` runs the composer's server and drives the real
  page in headless Chrome in real time: the quad mixer's panes, previews,
  the master's fader and Fade, blackout, a pair's cut, A and Left in step
  with today's views, and the default look. `-- --screenshot file.png`
  saves the view at 1440×900; look at it, since the checks do not judge the
  look (a screenshot caught a layout fault they all passed).
- `npm run check-monitor-nudge` runs the server and the page on the
  simulated signal and nudges the Monitor's beat graph: a nudge refolds the
  picture, the bar line moves it, Use this tempo makes it the manual tempo
  and the clock follows, Follow the clock goes back. Then the live path: a
  click track played into Chrome's fake microphone (a WAV it writes, with
  the audio service's sandbox lifted so Chrome can read it), the clock held
  at its tempo: the graph, folded from the input's flux, must stand level
  (neighbouring bars alike) and slope when nudged. About two minutes.
  `-- --wait 60` plays a minute first and `-- --screenshot file.png` saves
  the views; look at them, as the checks do not judge the picture.
- `npm run check-monitor-key` plays a steady A minor chord into Chrome's
  fake microphone and drives the Monitor's Key panel: the detector finds 8A
  and the wheel lights it, a click on 5A makes it the operator's key, the
  detector takes 8A back after eight seconds, the lock keeps 5A, Detect hands
  it back; and the Monitor's notes are info panes. About a minute.
  `-- --screenshot file.png` saves the wheel and an open info pane.
- `npm run check-stream-out` writes a known flash-and-beep signal into a fake
  recording folder, runs `tools/stream-out.mjs` to an MP4 and to a local RTMP
  receiver, and checks the picture size and that each flash meets its beep
  within one frame with no drift. It needs ffmpeg and ffprobe, and port 19350
  free. It does not use the composer, a real input or YouTube.
- `npm run check-live` sends the known flash-and-beep signal to the real
  server's `/api/live` and measures what a local RTMP receiver gets (size,
  flash against beep, the key in no log). `npm run check-live-page` presses
  Go live in headless Chrome with a fake microphone. Both need ffmpeg and
  ffprobe and ports 19351 and 19352 free; neither uses YouTube.
- `node tools/record-input.mjs <device name part> <seconds> <out.wav>`
  records an input, such as BlackHole, through Chrome, every
  sample; ffmpeg's avfoundation capture on macOS has been measured dropping about 12% of the
  audio and makes every tempo read about 13% fast. Keep recordings out of
  the repository.
- `node tools/pattern-frames.mjs <id> <out.png> [--size WxH] [--frames 8]
  [--every 6] [--scale 4] [--warm 2] [--params '{…}']` saves a contact sheet
  of a pattern's frames, drawn through the real renderer after two seconds
  (`--warm` seconds): for looking at a pattern, which no check does.
- `npm run frame-compare` draws 44 scenes through `Renderer.render` (the
  stream's path) and prints a hash of each; run it on two versions (copy
  `tools/frame-compare.*` into a worktree of the other) and diff, to show a
  renderer change leaves today's picture alone. `-- --size 256x192`,
  `-- --dump "<scene>"` with `tools/diff-pixels.mjs`.
- `npm run pattern-pixels` is a measurement: it draws every shader pattern
  on seeded simulated audio and prints a hash of its frames. Run it on two
  versions (copy the tool into a worktree of the other) to show a change
  leaves the picture alone. `-- --sweep` also draws each pattern parameter
  at its extremes and marks any that leave the picture the same; `-- --size
  256x192` sets the size, since fine detail may not show at the default
  64×48; `-- --dump <id>` with `tools/diff-pixels.mjs` says how far two
  versions differ. After changing a shader pattern's parameters, run the
  sweep at the panel's size.
- `node tools/measure-fire.mjs` is a measurement: it runs the Fire
  pattern's simulation in Node at a panel's size (`--size 256x192`) on
  simulated kicks and reports what each setting changes (level, flame
  height, the jump after a beat, embers). Run it after changing `fire.js`.
- `node tools/measure-bounce.mjs` is a measurement: it runs Aurora Bounce
  in Node for minutes (`--minutes 10`) on silence or the simulated signal
  (`--signal`), with chosen settings (`--params`), and reports how high the
  balls get each minute and how many lie on the floor. Run it after
  changing Bounce.
- `npm run measure-colours` is a measurement, not a pass or fail check: it
  reports how many colours, hues and brightness levels each pattern sends.
  Use it when a question about colour comes up, and compare against "Colour
  of the patterns" in `docs/findings.md`. Patterns draw at random, so it runs
  several seeds; one short run is not evidence.
- `npm run compare-audio` is also a measurement: it runs the composer's
  audio analysis offline in headless Chrome on synthetic signals with known
  answers (tempo, beats, key, bands, level) and prints a Markdown report.
  Run it after changing `audio.js`, `tempo.js` or `key-detector.js`, and
  compare against the previous version's report (run the tool in a worktree
  of it) and the figures in `docs/findings.md`. Add
  `--fps 60` to see the frame rate's effect. It does not cover real music or
  a live input.
- `npm run compare-tracks -- --beatport <folder>` runs the same analysis on
  the [Beatport EDM Key Dataset](https://zenodo.org/records/1101082),
  downloaded outside the repository, and reports key and tempo accuracy
  against its labels; compare against "Audio analysis on real dance music"
  in `docs/findings.md`. About 10 minutes on eight
  Chrome instances. Add `--essentia` to run Essentia.js too, and
  `--windows` for Essentia on sliding windows as it would run live (about 51
  minutes in all). Never copy the dataset's audio into the repository.
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

- **Branches.** New work goes on a branch off `main`. `main` is releasable:
  merge into it only when every test and check passes and the change has
  been tried by Anjin and accepted. When work is ready, say how to
  try it on the branch and wait.
- **Commits, merges and pushes.** Commit finished work to the working branch.
  Merge or push only when asked, and treat them as separate asks. Delete a
  branch only once it is in `main`, and say so.
- **A running copy.** The composer's server reads the page from disk, so
  checking out a branch in a clone where the composer is running changes
  what the browser gets on its next reload; changes to `server.js` or `lib/`
  need the server restarted. Do branch work that should not reach a running
  copy in a `git worktree`; the composer has no npm dependencies, so the
  tests run there without `npm install`.
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
