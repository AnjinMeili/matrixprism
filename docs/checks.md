# What each check and measurement covers

The commands are listed in [AGENTS.md](../AGENTS.md), "Verifying". This is
what each one does, what it needs, and what it does not cover: read a
check's entry before relying on it, and say what it did not cover when
reporting. Moved here from AGENTS.md on 2026-11-03 to keep the agent guide
short.

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
  entry, then checks the look and its controls came back. Then pairs (T73):
  an entry shown on Right while it is off air (its look settings held back)
  and on air, Hotsave of Right and of the whole quad, and the main never
  moved. The server is not running, so nothing streams; it does not cover
  Safari or the layout.
- `npm run check-variations` drives the real page in headless Chrome on
  real time (the frame clock does not run on virtual time, so `check-hotsave`
  never draws): a Mark Estes pattern's seed on screen is shown and saved by
  Hotsave, New and Back step through seeds, showing the saved entry brings
  the variation back kept, and Return comes back to it. It does not look at
  the picture.
- `npm run check-cue-lists` seeds a cue list for a made-up track on a
  manual 120 BPM and drives the real page on real time. Find opens it by
  part of the artist's name; Go starts it, and each cue lands on beat 1 of
  its bar, 4 seconds apart. Hold stops the bar and lets it go on; Back waits
  for the bar line. No audio is used, so it does not test the tempo
  tracker; it does not look at the picture.
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
- `app/check-ndi-binding.mjs` and `app/check-app-ndi.mjs` check the NDI
  build (#62) without the NDI runtime, against a stand-in libndi that the C
  compiler builds from NDI's own headers (`--headers`: the NDI SDK's
  `include` folder, or DistroAV's `lib/ndi/`; MIT) and that logs what it is
  sent. The first checks every struct field and call; the second drives the
  app (`--expect stub`, `missing` or `none`, the last for a plain package).
  Neither shows a real NDI receiver taking the picture.
- `npm run check-saved-state` sets every control on the page to another
  value as a person would, reloads, and fails on any that comes back changed;
  it never sets a receiver or an address. A control marked `data-not-saved`
  (a search box) is not a setting and is left out. `app/check-app-saved-state.mjs`
  does the same across a restart of the desktop app, and after a forced kill.
  Neither covers the Media Player's folder, which needs the folder dialog,
  nor the window's place, which Electron hides from DevTools.
- `npm run check-video-gamma` records the Panel Range card through Record in
  headless Chrome at Video gamma 1 and 2.2 and reads the grey bars of each
  MP4: at 1 the levels sent, at 2.2 the lifted levels, within five levels.
  Needs ffmpeg. It does not look at the picture or cover Safari or YouTube.
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
- `node tools/measure-live-bitrate.mjs` is a measurement: it sends a
  synthetic panel-sized picture, sparse and busy, through Go live's real
  encoder settings to a local RTMP receiver and reports each size's bitrate
  per second and the picture's shape (`--sizes`, `--source`, `--keep`). Run it
  after changing `lib/stream-out.js` or Go live's sizes; compare against "Go
  live's size and bitrate" in `docs/findings.md`. It does not use YouTube.
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
