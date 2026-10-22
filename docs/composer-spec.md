# MatrixPrism composer: design specification

Last updated: 2026-10-15. Describes the code on the `audio-layers` branch
(T30: the high band and sparkles), from `main`.

The composer renders patterns in a browser and streams them to the matrix
receiver (`matrix-dmx`, in `receiver/`). This document describes how it is put together: the processes, the
frame pipeline, the pattern interface, the modules and the saved settings.
For how to use it, see [composer/README.md](../composer/README.md). For
current state and next steps, see [roadmap.md](roadmap.md).

## Processes and data flow

```
audio input ─► browser page ──WebSocket──► Node server ──UDP (DDP)──► matrix-dmx on the Pi
               (render frames)             (split into packets)
```

- **Browser page** (`composer/public/`): analyses audio, renders each frame
  with WebGL, reads the pixels back and sends them as one binary WebSocket
  message of `width × height × 3` RGB bytes, top row first.
- **Node server** (`composer/server.js`, `lib/ddp.js`): serves the page,
  looks up the matrix size from the receiver's WLED-style `/json/info`, and
  turns each frame into DDP packets of up to 1440 bytes, with the push flag on
  the last. It refuses cross-site WebSocket and `/api/*` requests, and any
  request whose `Host` is not one of its own names (`lib/hosts.js`).
  `/api/receivers` asks the local network by mDNS for `_wled._tcp` from an
  ordinary port, so responders answer it directly (`lib/mdns.js`); one search
  runs at a time.
- **Frame clock**: a Web Worker timer drives the frame loop, so frames keep
  coming when the tab is in the background. Each tick is acknowledged before
  the next is scheduled, so a stalled page cannot queue frames.

Frames are skipped, not queued, when the WebSocket is backed up, and before
that when the receiver's **Most frames a second sent** says so (`SendLimiter`
in `receivers.js`).

### Experimental recording (T47, preview-recording branch)

`public/recording.js` captures the final preview immediately after rendering,
before DDP's limiter, with the existing live input audio tracks. MediaRecorder
emits timestamped WebM chunks, uploaded sequentially (16 MiB queue, 8 MiB
chunk cap, bounded wait) to local-only `/api/recordings` routes. No second
input is opened. Simulated/absent inputs cannot record; source/dimension
changes and lost rendering/audio fail visibly. Controls lock while busy.

`lib/recording.js` incrementally writes chunks in a unique directory under
`~/Movies/MatrixPrism/` (or server `--record-dir`). After the final chunk,
Stop launches FFmpeg to convert to a temporary H.264/AAC MP4, published
without overwriting only after successful exit. Software x264 and
hardware-only VideoToolbox are fixed encoder choices. Source/staging media,
encoder command and log remain for diagnosis. Idle/page-close/server-stop
failures cancel work. Downloads use unguessable ids, not client paths.
Host/Origin checks remain in force; recording also requires a loopback peer
and same-origin POSTs. Sessions/queues/payloads and process time are bounded.

The intermediate is lossy and conversion happens at Stop. This is ready for
short branch testing, not a final long-session/live publishing pipeline.
See [recording-plan.md](recording-plan.md) and the
[Recording the preview](findings.md#recording-the-preview).

## Frame pipeline

One call to `tick()` in `app.js` per frame:

1. **Audio** (`audio.js`): update the spectrum (256 logarithmic bins, 30 Hz
   to 16 kHz), per-channel spectra, waveform, band energies, level, beat,
   high-band hits and air (T30), and key. For a live input, `update()` reads the analysers and hands the data
   to `analyse()`, which takes the frame's time from `tick()` rather than the
   wall clock, so other callers, such as the audio comparison (T26), can
   supply the same data offline.
2. **Tempo** (`tempo.js`): advance the beat position; detect section changes.
3. **Sequencing**: a playing playlist, else the randomizer, else Auto cycle
   may change what is shown. Changes can be held until a beat, bar, phrase or
   detected change.
4. **Render** (`renderer.js`):
   1. Layer A's pattern into a texture. During a pattern change the previous
      pattern is rendered too.
   2. Layer B's pattern into a texture, if the mixer is on.
   3. Composite: shape each layer, blend them, add sparkles and overlays,
      apply gamma and brightness.
   4. Read back the pixels and convert to RGB.
5. **Send** the frame if streaming.

### Compositing rules

Implemented in the compositor shader in `renderer.js`, with reference
implementations in JavaScript that the tests use.

- **Shape** (`shape.js`): each layer is sampled through a lookup that can
  bend it round the centre (base at the rim, or base at the centre), turn it
  and swell it with the tempo. A turned or swollen layer is reflected at its
  edges.
- **Region and coverage** (`shape.js`): a layer may be limited to a central
  area or to everything outside it. The area has an outline (ellipse,
  rectangle, diamond), a width and a height. Coverage is 1 inside the
  region, 0 outside, and a smooth ramp across a soft border.
- **Blend** (`mixer.js`): with coverage `a` and `b`, the overlap is
  `max(0, a + b − 1)`. The blend mode is applied to the overlap; each layer
  shows unblended for the rest of its share. So a layer is absent, not black,
  outside its region, and opposite regions with the same area and softness
  crossfade across their border.
- **Sparkles** (`sparkle.js`): each high-band hit lights the pixels where a
  fixed table of random numbers, read at an offset set by the hit's seed,
  falls below a share set by Density and the hit's strength; the light
  fades with the hit's age. A faint twinkle follows the air. Added to the
  mix and capped at 1. The table is uploaded as a texture so the GLSL and
  the JavaScript reference light exactly the same pixels.
- **Order**: pattern-change crossfade of layer A, then the mix with layer B,
  then sparkles, then overlays, then gamma and brightness.
- **The quad mixer's renderer (T16 step 3).** `Renderer.renderQuad` draws
  four inputs, A to D, each into its own target, with its own parameters and
  a brightness and gamma trim (`trimPixel` and `TRIM_GLSL` in `mixer.js`,
  untouched at 1 and 1) applied before mixing. A stateful pattern runs as one
  instance per input, keyed `<input>:<pattern>`. At master position 0 every
  blend gives Left exactly, so Left is drawn in one compositor pass with its
  effects, as before; otherwise each pair is drawn into an 8-bit submix and
  the master's pass blends them and applies sparkles, overlays, gamma and
  brightness. A preview, a second master pass into the `preview` target not
  streamed, is supported but unused since Anjin removed Gated. `Renderer.render` takes today's one-pair state and
  draws it as Left; until the mixer view (step 5) it is what the page uses.

## Pattern interface

Every pattern is an object in `PATTERNS` (`patterns.js`):

| Property | Meaning |
|----------|---------|
| `id`, `name`, `audio` | Stable id (stored in settings), picker label, description |
| `group` | Optional picker heading (`Mark Estes`, `AuroraDrop`) |
| `glsl` | Shader patterns: GLSL that defines `vec3 render()`; compiled with the shared prelude in `patterns.js` |
| `createInstance(width, height)` | Stateful patterns: returns an object with `renderFrame(state)` that returns `width × height × 3` RGB bytes, top row first |
| `controls` | Which control panels to show: `aurora`, `flock`, `spectrum`, `media` |
| `params` | The pattern's own parameters, shown in Pattern settings and saved per pattern; see below |
| `manualHue` | Use the manual hue only, not the key-driven hue |
| `spectrumPlot` | Needs the high-resolution FFT |
| `audioReactive`, `needsAudio` | Responds to audio; draws nothing without it |
| `isReady()` | Optional: false while the pattern has nothing to show |
| `manualOnly` | Chosen by hand only: the randomizer and Auto cycle pass over it. Set by the Panel Range test card (`test-card.js`) |

`renderFrame(state)` receives the render state built in `tick()`. The fields
patterns use:

| Field | Meaning |
|-------|---------|
| `time`, `auroraTime` | Animation clocks in seconds, scaled by Speed; `time` also speeds up with level |
| `audioTime` | Wall-clock seconds |
| `audio` | `{ bass, mid, treble, level, beat }`, each 0 to 1; and the high band (T30): `highHit` (a pulse at each hit), `highHits` (hits this frame), `highStrength`, `highRate` (hits a second), `highPlace` (where in 4–16 kHz, 0 to 1), `air` (the band's share of the spectrum) |
| `spectrum`, `spectrumLeft`, `spectrumRight`, `wave` | 256-byte arrays |
| `rawSpectrum` | High-resolution FFT for Spectrum Lab |
| `hue`, `manualHue`, `musicalKey` | Colour inputs |
| `paletteId`, `auroraDotSize`, `flock`, `spectrumOptions`, `mediaFit`, `silenceMode` | Pattern settings |
| `patternParams` | Each pattern's own parameters that differ from the defaults, by pattern id; the renderer resolves them for each pattern |
| `sparkles` | The Sparkles settings, used by the renderer, not by patterns |
| `beatPosition`, `changeClock` | Tempo clocks, in beats |
| `layer`, `shape` | Mixer layer B and layer A's shape, used by the renderer |

### Pattern parameters

A pattern describes its own variables in `params` (`params.js`), and the
Patterns view builds its Pattern settings panel from them
(`param-controls.js`). Each is one of:

| Kind | Declared as | Control | A shader reads `p_<id>` as | `renderFrame` gets |
|------|-------------|---------|----------------------------|--------------------|
| Number | `{ id, name, min, max, step, default, help }` | Slider | The number | The number |
| On or off | `{ id, name, type: 'bool', default, help }` | Checkbox | 0 or 1 | `true` or `false` |
| Choice | `{ id, name, type: 'choice', choices: [{ id, name }], default, help }` | Menu | The choice's index | The choice's id |

- **Shader patterns** get a `uniform float p_<id>;` for each, declared for
  them. A count that bounds a loop needs a fixed maximum and an early
  `break`, since WebGL 1 loops must have constant bounds.
- **Stateful patterns** get the values by id as the second argument:
  `renderFrame(state, params)`.
- **Saved** in `settings.patternParams`, by pattern id, only where a value
  differs from its default. Values are clamped and put on their steps when
  read, so a saved value from an older version of a pattern is safe.
- **Help** is shown on hover.
- **Defaults** are the constants the pattern had before it had parameters,
  so declaring them changes nothing until a value is moved.
- **Tests** in `test/params.test.js` check every declaration, and that a
  shader reads every parameter it declares.

Stateful patterns step their own simulation on the supplied clock and stop
catching up after 100 ms of wall time, so a slow pattern slows down instead
of stalling every frame.

### Pattern families

| Family | Count | Where | Notes |
|--------|-------|-------|-------|
| Shader patterns | 18 | `patterns.js` | Audio-reactive GLSL |
| Spectrum Lab | 1 | `spectrum-plot.js` | Configurable analyser |
| Beat Graph | 1 | `beat-graph.js` | The music folded by the bar of the beat clock, after BpmDj |
| Media Player | 1 | `media.js` | Image, animated image or video; one file, or a random one from a folder |
| Aurora ports | 13 | `aurora-patterns.js`, `aurora-fastled.js` | Native panel resolution |
| Fibonacci ports | 4 | `fibonacci-patterns.js` | Native panel resolution |
| Mark Estes | 94 | `patterns/mark-estes/` | Sketch's own runtime; 37 audio-driven |
| AuroraDrop | 9 | `patterns/auroradrop/` | 64 by 64 canvas scaled to the panel |

The two ported families each have a `NOTICE.md` with provenance, licence
position and differences from the original.

## Modules

In `composer/public/` unless noted.

| Module | Responsibility |
|--------|----------------|
| `app.js` | Settings, control binding, the frame loop, sequencing, the server link |
| `renderer.js` | WebGL: pattern programs, layer targets, the compositor, read-back |
| `audio.js` | Capture and analysis; owns the tempo tracker |
| `tempo.js` | BPM estimate, beat position, section changes, change gating |
| `key-detector.js` | Musical key and Camelot notation; the operator's chosen key |
| `key-wheel.js` | The Monitor's live Camelot wheel: layout, hit-testing, drawing |
| `mixer.js` | Blend modes (GLSL and reference), coverage-aware compositing |
| `shape.js` | Layer shape, region, border, spin and pulse (GLSL and reference) |
| `playlist.js`, `playlist-controls.js` | Playlist model and player; the manager UI |
| `quad-view.js` | The quad mixer's view (T16 step 5): its panes, drawn by the layout base, changing settings through app.js |
| `channel-tags.js` | A Mixer channel's modifiers as short tags for under its name, each with its full text for hovering (pure; tested) |
| `layout.js`, `layout-view.js`, `help.js` | The quad mixer's layout as data, its view from components registered by pane type, and the help popover (T16 step 4); not yet used by the page |
| `quad.js` | The quad mixer's model (T16): four inputs, two pairs, the master, whole looks and the default look; not yet used by the page |
| `look.js` | What an entry keeps beyond patterns, mixer and shapes (the look settings and pattern parameters); Hotsave's settings |
| `randomizer.js` | Per-track random timers and random choices, including the media file |
| `overlays.js`, `overlay-controls.js` | Clock, date, text and info overlays |
| `sparkle.js` | Sparkles over every pattern: the hit ring, settings, GLSL and JavaScript reference |
| `pixel-font.js` | The 3 by 5 pixel font that overlays can use |
| `media.js` | Media source, the Media Player pattern, folder listing, saved file and folder |
| `gif.js` | GIF decoder: reads the file's structure once and composes frames in order on one canvas, so GIFs animate without the browser's `ImageDecoder` |
| `patterns.js` | Shader prelude and the pattern registry |
| `palettes.js`, `gradient-palettes.js` | Palettes for the ported patterns |
| `spectrum-plot.js`, `spectrum-controls.js` | Spectrum Lab and its controls |
| `beat-graph.js` | Beat Graph |
| `beat-fold.js` | The sound kept by time (`SoundTrace`) and folded at any tempo and bar line (`FoldedHistory`), for nudging the Monitor's graph (pure; tested) |
| `band-flux.js` | Spectral flux over eight bands (`BandFlux`), 200 readings a second, which the beat graphs fold; imports nothing, so the audio thread can load it (pure; tested) |
| `flux-worklet.js` | An audio worklet: `BandFlux` over every sample of the live input, posted with the audio clock's time; `audio.js` queues the readings (`takeFlux`) for the Monitor |
| `monitor.js` | The Monitor view: a Beat Graph of the bar history the Beat Graph pattern shows (`SHARED_BAR_HISTORY`), or of the sound folded at a nudged tempo; the tempo trace and the CSV log |
| `frame-clock.js` | Worker timer |
| `server.js`, `lib/ddp.js` (in `composer/`) | HTTP, WebSocket and DDP |
| `lib/mdns.js` (in `composer/`) | Finding receivers on the network by mDNS |
| `receivers.js` | Settings kept for each receiver, and the limit on frames sent |
| `lib/version.js` (in `composer/`), `version.js` | Which copy is running: package version, git branch, commit and folder, served at `/api/version` and shown in the Version frame |

Modules that define compositing or timing rules keep the rule in one place,
with the GLSL generated from or mirrored by a JavaScript reference that the
tests exercise. This is the main defence against shader mistakes, because
the shaders themselves are not compiled in the test suite.

## Views

The header switches between five views of the control column; the preview,
pattern picker and streaming button are always visible.

| View | Panels |
|------|--------|
| Patterns | The selected pattern's own panel (Media Player, Spectrum Lab, Aurora Flock, Ported pattern look), Look, Auto cycle |
| Playlist | Playlists, Hotsave, Randomizer |
| Setup | Matrix, Audio (input, tempo, silence handling), Persistent overlays, Version |
| Monitor | Beat graph, Tempo (trace and readout), Log (record, download CSV); fed every frame whichever view is open (`monitor.js`) |
| Mixer (`quad`) | The quad mixer, second in the header: fills the window below it in place of the rest: four inputs (each with a More… popover for the rest of its shape), the Left and Right pairs, the master (with Sparkles, the one place for them, in a popover), All inputs (with tap tempo), Output and sequencing, laid out by `settings.quadLayout` (T16). It replaced the one-pair Mixer view on 2026-10-20; a saved `mixer` view opens it |

## Saved settings

Stored as JSON under `matrix-companion-settings` in the browser's local
storage. Each structured group is validated on load by its module; an invalid
group is replaced by defaults with a message, without discarding the rest.

| Key | Contents | Validated by |
|-----|----------|--------------|
| `host`, `width`, `height`, `ddpPort`, `blackOnStop` | Matrix target | `app.js` |
| `patternId`, `autoCycle`, `cycleSeconds`, `fadeSeconds` | Layer A and Auto cycle | `app.js` |
| `audioSource`, `gain`, `silenceMode` | Audio | `app.js` |
| `keyColours`, `keyHold`, `keyLock` | Monitor's Key panel | `app.js` |
| `brightness`, `gamma`, `speed`, `hue`, `fps` | Look | `app.js` |
| `flockCount`, `auroraDotSize`, `paletteId`, `paletteCycle`, `mediaFit` | Pattern settings | `app.js` |
| `spectrumOptions` | Spectrum Lab | `spectrumOptions()` |
| `overlays` | Overlay elements | `overlaySettings()` |
| `mixer` | `enabled`, `patternId`, `mode`, `amount` | `mixerSettings()` |
| `shapes` | `a` and `b`, each: `shape`, `region`, `outline`, `width`, `height`, `proportional`, `edge`, `spin`, `spinReverse`, `pulse`, `pulseBeats` | `shapeSettings()` |
| `playlists` | `lists` of entries, `activeId`, `loop`, `shuffle` | `playlistSettings()` |
| `patternParams` | Each pattern's own parameters that differ from the defaults, by pattern id | `changedParams()` on load (`app.js`) |
| `receivers` | Each receiver's `brightness`, `gamma` and `maxFps`, by host in lower case; `brightness`, `gamma` and `maxFps` hold the values in use | `receiverSettings()`, `receiverProfile()` |
| `quad`, `quadLayout`, `defaultLook` | The quad mixer: C, D, Right, the master (shown as the main) and each input's trim and hue (`hue`: null to follow the main's, or 0 to 1) (A, B and Left copied from the one-pair settings before each save); its layout; the look Reset main brings back, or null | `quadFromSettings()`, `layoutSettings()`, `wholeLook()` |
| `hotsave` | `key` (one letter or digit, not T) and `playlistId` (null: a playlist called Hotsave, made on first use) | `hotsaveSettings()` |
| `randomizer` | `enabled`, `unit` (`seconds`, `beats` or `bars`), `minWait`, `maxWait`, `tracks`; `minSeconds` and `maxSeconds` saved before 2026-10-20 are read as the waits in seconds | `randomizerSettings()` |
| `tempo` | `mode`, `manualBpm`, `quantize`, `tap` | `tempoSettings()` |
| `sparkles` | `enabled`, `amount`, `density`, `length`, `shape`, `colour`, `twinkle` | `sparkleSettings()` |
| `view` | The selected view | `app.js` |

The Media Player's file is kept separately in IndexedDB, as is the directory
handle of its folder where the browser has a folder picker. The folder's
contents are not stored: the folder is listed again on each visit, and held in
memory as `{ path, file }` entries by `app.js`.

A playlist entry holds `name`, `patternId`, `seconds`, `mixer` and `shapes`,
validated by the same functions. Entries saved since 2026-10-16 also hold
`look` (`hue`, `speed`, `paletteId`, `paletteCycle`, `keyColours`,
`flockCount`, `auroraDotSize`, `sparkles`, `spectrumOptions`; checked by
`lookSettings()`) and `params` (the pattern parameters of layer A's pattern
and, with the mixer on, layer B's, by pattern id; checked by
`entryParams()`, then against each pattern's declaration when shown).
Showing an entry without them leaves those settings as they are. Brightness,
gamma and frame rate are never kept: they suit the panel, not the look.

## Tempo model

- **Beats** come from the source chosen in **Beat from** (`BEAT_SOURCES` in
  `tempo.js`; `updateBeat` in `audio.js`):
  - **Bass:** the bass band 1.3 times its running average, at most one in
    0.22 s; the original detector.
  - **Flux:** the same rule on spectral flux from an unsmoothed 2048-point
    analyser. Each onset is timed within the frame (`onsetTime`: the 64-sample
    block of the new samples where energy rises most), so the tempo is not
    held to whole frames. Every onset counts towards the tempo, but only kicks
    pull the beat position: an onset whose flux below about 165 Hz also jumps
    by the same rule, or any onset after two seconds without a kick. The
    simulated signal always uses the bass rule.
  - **Essentia:** `pcm-capture-worklet.js` copies the live input to
    `essentia-worker.js`, which runs `EssentiaTempo` (`essentia-tempo.js`):
    `RhythmExtractor2013` on the last 10 s, resampled to 44.1 kHz, every 2 s.
    Each estimate goes to `TempoTracker.setEstimate()`, which replaces the
    onset intervals and keeps the lock alive. Its beat positions are not used:
    on 10-second windows they were up to a third of a beat out. Flux onsets
    still give the beat pulse, and kicks set the phase through `alignTo()`.
    Essentia.js (AGPL-3.0) is in `public/vendor/essentia/` and loads only when
    chosen.
- **BPM**: recent beat intervals, folded into 70 to 180 BPM; a lock needs at
  least four intervals agreeing within 5% and is dropped after five seconds
  without a beat. A manual tempo is used otherwise.
- **Tap tempo** (`TapTempo`): the manual tempo can be tapped. A run of taps,
  each standing for a beat or for a bar, gives a tempo in whole BPM from the
  last eight; two taps are enough, and a gap of more than two seconds a beat
  starts a new run. Tapping a tempo switches to the manual tempo.
- **Beat position**: advances at the current tempo and is pulled towards the
  detected beats without running backwards. Bars are four beats, counted from
  wherever the tracker started. While the manual tempo is in charge there are
  no detected beats to follow, and a tap pulls the position to the nearest
  beat, or to the nearest bar line when a tap stands for a bar, in the same
  gradual way.
- **Section changes**: each beat's average bass, mid and treble energy is
  compared with a slowly following reference; a shift above the threshold, at
  least 16 beats after the last, is a change. One is declared after 128 beats
  without any.
- **Change clock**: a beat clock that reverses direction at each change, for
  movement that turns round with the music.

## High band (T30)

From the unsmoothed 2048-point analyser that the flux source reads, on
linear magnitudes (`updateHighs` in `audio.js`, `HitDetector` in
`spectral-features.js`):

- **A hit** is a frame whose flux in 4–16 kHz:
  - exceeds the median of the last second by three median deviations, and a
    floor, at least 40 ms after the last hit;
  - rose, as a share of the band's level the frame before, by at least
    `HIGH_RISE` (0.5), so the wobble inside a ringing cymbal is not a new
    hit;
  - rose, as a share of level, at least `HIGH_BRIGHTNESS` (1.5) times as
    much as 1–4 kHz did, that band's level taken as at least the high
    band's, so broadband kick clicks and snares are not hats.
- **Strength** is 0.25 at the threshold, rising to 1 at eight times it.
- **Place** is the centre of the rise on a log scale of 4–16 kHz.
- **Air** is the band's share of the spectrum's magnitude, smoothed over
  0.3 s; white noise gives about 0.5, because the bins are evenly spaced in
  frequency.

Measured in [High-band hits for sparkles](findings.md#high-band-hits-for-sparkles).

## Testing

`npm test` runs `composer/test/*.test.js` with Node's test runner. Coverage
is by module: pure logic and reference implementations are tested; the WebGL
renderer, the DOM binding in `app.js` and the control builders are not. The
server has an integration test that starts the real process.

Three tools run pages in headless Chrome through `tools/headless.mjs`, which
serves `public/` and the page, starts Chrome with software WebGL and reads
the page's result. They are separate from `npm test` because they need
Chrome, and they check Chrome only.

| Command | Page | What it does |
| --- | --- | --- |
| `npm run check-shaders` | `tools/shader-check.html` | Compiles the compositor and every shader pattern |
| `npm run check-test-card` | `tools/test-card-check.html` | Draws the Panel Range card at five sizes and compares every pixel with `cardLevels()` |
| `npm run check-sparkles` | `tools/sparkle-check.html` | Draws the sparkles for six sets of hits and settings at three sizes and compares every pixel with `sparkleLight()`, allowing a level of rounding |
| `npm run measure-colours` | `tools/colour-measure.html` | Draws every pattern with the simulated audio and a seeded `Math.random`, and reports colours, hues and brightness levels per pattern; see "Colour of the patterns" in `docs/findings.md` |

What neither can catch: layout, how a frame looks, Safari's differences from
Chrome, and anything that needs a real audio device, video decoder or
IndexedDB. Those need a browser and Anjin.
