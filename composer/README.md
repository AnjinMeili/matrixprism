# MatrixPrism composer

> The composer half of [MatrixPrism](../README.md). It streams to any DDP
> receiver, such as WLED; MatrixPrism's own receiver is in
> [../receiver/](../receiver/README.md).
> For how the app is built see [../docs/composer-spec.md](../docs/composer-spec.md),
> and for current status and next steps see [roadmap.md](../docs/roadmap.md).

A local app that renders generative, audio-reactive patterns and streams them
over DDP (UDP 4048) to an LED receiver: a WLED controller, `matrix-dmx` on a
Raspberry Pi, or any other DDP receiver.

- The browser renders shader patterns and stateful Aurora ports, analyses audio
  with the Web Audio API, and shows a live preview at the matrix's exact resolution.
- A small Node.js server forwards each finished frame as standard DDP: RGB,
  row-major from the top-left, 480 pixels per packet, with the push flag on
  the last packet so the receiver shows each frame whole.

## Recording

The Record bar above the Mixer saves the actual final preview with the live
audio input as an MP4. Requires Chrome and FFmpeg on the server's
command path. Recording is local-only, even if the UI is served to the LAN.

1. Choose receiver dimensions and a live audio input such as BlackHole under
  Setup. None and Simulated have no soundtrack and cannot record.
2. Choose Software H.264 (default) or Mac hardware H.264 in the recording
  bar. Hardware uses VideoToolbox with software fallback disabled.
3. Press Record, change patterns/mixes as usual, then Stop recording.
  DDP streaming can be off; receiver limits do not limit recording.
4. Wait for Saved. The status shows the server-local MP4 path; Download MP4
  retrieves a copy. Output defaults to `~/Movies/MatrixPrism/preview-*/`;
  set server `--record-dir <directory>` to change it.

Dimensions, receiver and audio-source controls lock while busy. Odd sizes
are padded at the right/bottom, never scaled. Final brightness/gamma,
overlays, sparkles and blackout are included, not physical panel behaviour.

Timestamped browser WebM chunks are written incrementally to disk; FFmpeg
converts to H.264/AAC MP4 at Stop. This is a lossy intermediate, not yet the
final fidelity decision. Each directory retains source/partial WebM, the
encoder command and log for diagnosis. Failed/interrupted captures never
report Saved. Reload cancels rather than resumes. One active recording per
server; 1 hour/4 GiB source limit; 16 MiB browser queue; 8 MiB chunks.
Overloaded uploads stop rather than stalling DDP.

Short checks cover both encoders, source loss, composed frames, decoded audio
and known sync markers around a render stall. Long recordings, real-device
sync/drift and Safari remain unverified. See
[Recording the preview](../docs/findings.md#recording-the-preview) and the
[plan](../docs/recording-plan.md).

### Development Tools

The offline comparison uses the same synthetic lossless A/V source for
software x264 and hardware-only VideoToolbox. Requires FFmpeg and ffprobe:

```sh
cd composer
node tools/compare-recording-encoders.mjs --out /tmp/recording-probe-evidence --size 256x192 --seconds 10 --bitrate 1000000
```

`--out` must be a new directory. It keeps versions, exact commands, logs,
output metadata and results; media goes in a separate temporary directory
whose path is reported. HandBrakeCLI is inventoried if installed, not used
for encoding yet. This offline probe does not measure live sync or composer
performance. Odd dimensions are padded on the right/bottom, never scaled.

For a short, live BlackHole sample, without sending DDP or changing the
running composer's settings:

```sh
node tools/capture-preview.mjs
```

This records a standalone Plasma/Bars mix at 256x192 for 15 seconds, with
the actual BlackHole input feeding both analysis and the soundtrack. Chrome
must have microphone permission and music must be playing. Each run creates
a new folder under `~/Movies/MatrixPrism/` containing the MP4, source WebM,
decoded contact sheet, capture metadata, commands and logs. An optional first
argument sets a different output root. This prototype buffers a short clip
and transcodes WebM to MP4; it is not the production recorder, a capture of
the current browser look, or a measured synchronization test.

`npm run check-recording` drives the actual composer with a fake microphone,
records/stops, probes output and decodes picture/audio markers. Logs and
desktop/mobile screenshots go in an `evidence` folder beside the recordings
it makes, or in the folder named by `-- --evidence <dir>`.

## Run

Requires Node.js 18 or newer, and nothing else: the composer has no npm
dependencies, so there is no `npm install`. Its server's WebSocket library,
[ws](https://github.com/websockets/ws), is kept unchanged in
`lib/vendor/ws/` (see its `NOTICE.md`), and `.npmrc` turns off package
install scripts should a dependency ever be added.

```sh
cd composer
npm start -- --ddp wled-e1f2a3.local
```

Open <http://localhost:8080/>, then:

1. On the **Setup** view, choose the receiver from the **Receiver** menu, or
   type its host: its IP address or its WLED name, such as
   `wled-e1f2a3.local` (`matrix-dmx` prints the one it uses).
2. Click **Detect size**. This reads `leds.matrix` from the receiver's
   `/json/info`, WLED's JSON API, which `matrix-dmx` imitates, so the frame
   matches the panel (for example 256×192). A WLED set up as a strip rather
   than a 2D matrix, or a receiver without that API, has no size to read:
   set it under Matrix.
3. Choose an audio input and click **Start streaming** in the header.

**Start streaming** reads the size again every time, and so does a stream
resumed after a server restart, so the frame matches the panel streamed to.
If the size cannot be read, it streams at the size set and says so.

### Receivers

- **What can receive:** anything that takes DDP on UDP 4048 (or the port
  given by `--ddp-port`). WLED and `matrix-dmx` are found on the network and
  their size is read. The composer has been tested with WLED 16 and 17 only,
  on panels of 32×32 (WLED 16) and 128×64 (WLED 17, on an Adafruit Matrix
  Portal S3), and with `matrix-dmx` at 96×64 and 256×192. `matrix-dmx`
  exists for panels larger than WLED handles well.
- **The Receiver menu** lists the receivers used before, each marked online
  with its name and size or as not answering, then any found on the network
  that are new. The server finds them by asking the network for WLED's
  `_wled._tcp` service by mDNS, which both WLED and `matrix-dmx` answer. The
  search runs when the page opens and on **Find receivers**. Choosing one
  sets the host.
- **Kept for each receiver:** brightness and gamma (under Look) and **Most
  frames a second sent** (under Matrix). Panels differ: an outdoor
  high-brightness panel with 1/8 scan holds each pixel longer than an indoor
  1/32-scan one, so the same settings can wash out and show artifacts there,
  and want gamma up or brightness down. Switching receiver brings its own
  settings back; one used for the first time starts from those in use.
- **Most frames a second sent** leaves the page drawing at the frame rate
  under Look and sends fewer of the frames: 20 of 30 a second is two frames
  in three. Empty sends every frame. It eases a receiver that struggles to
  keep up, such as an Adafruit Matrix Portal S3, whose Wi-Fi suffers from
  interference from its own display refresh. It cannot change the panel's
  refresh rate itself.
- **The same panel by name and by address** counts as two receivers.

The header switches between five views. **Patterns** shows the controls for
the selected pattern, then Look and Auto cycle. **Mixer** holds the mixer and
the layer shape controls. **Playlist** manages saved looks. **Setup** holds
the settings
that stay the same across patterns: Matrix, Audio, and Persistent overlays.
At the bottom of Setup a **Version** frame says which copy of the composer
the page came from: its version, and the git branch, commit and folder it is
running from.

**Monitor** watches the beat clock and the tempo, whatever pattern is
showing:

- **Beat graph:** a Beat Graph of the live input, which keeps building in
  the background whatever is showing. With a live input it folds the
  sound's spectral flux, the rise in energy across eight bands, which shows
  a kick in house and the hats in drum and bass alike, about three times as
  clearly as loudness (measured in
  "What the beat graph should fold" in `docs/findings.md`); with the simulated signal it
  folds loudness, as before. The Beat Graph pattern shows the same
  bars, so it starts full when chosen. Straight lines mean the clock keeps time;
  sloping lines, its tempo is off; level lines between the beat marks, its
  phase is off.
- **Tap (T)** and **Downbeat (D)** under the beat graph, as on the Mixer
  (see Tap tempo), so the graph can be lined up from here.
- **Nudging the beat graph:** the buttons under it (−1, −0.1, +0.1, +1 BPM)
  fold the last minutes of sound again at the tempo shown, at one steady
  tempo across the picture, history and all, so you can nudge up and down
  until the lines stand level; **◀ Bar line** and **Bar line ▶** move the
  rows an eighth of a beat, so the first beat sits on the top mark. **Send
  to the tracker** gives the tempo and bar line to the beat tracker, which
  goes on following the music from there and keeps them until the music
  clearly says otherwise (a manual tempo is handed back to detection
  first); **Make it the manual tempo** holds the clock there whatever the
  music does (Detect, under All inputs on the Mixer, goes back to the
  audio's); **Follow the clock** goes back to its own graph. About ten minutes of sound are
  kept. In a mix whose tempo changes, only part of the picture can stand
  level at once.
- **Tempo:** the last three minutes of BPM, blue while detected and grey while
  manual, with a tick for each onset from the chosen beat source. A readout
  gives the BPM, the source, its confidence, onsets per minute and high hits
  a second (see Sparkles).
- **Log:** **Record** keeps ten rows a second of the beat source, BPM, whether
  detected, confidence, beat position, onsets, bass, mid, treble, level,
  flux, high hits, high hits a second and air, up to an hour. **Download
  CSV** saves them.
The preview, pattern picker and streaming button stay visible in both, and
switching views does not interrupt rendering or streaming. The page opens on
Setup until a matrix host has been entered.

Server options:

| Option | Default | Purpose |
| --- | --- | --- |
| `--ddp <host>` | `$MATRIX_HOST` | The DDP receiver, WLED or `matrix-dmx`, by IP address or name. `--pi`, its old name, still works. It replaces the host saved in the browser once each time the server starts, also in a tab left open across the restart; a host typed in the page afterwards stands until the next start |
| `--ddp-port <n>` | `4048` | DDP port on the receiver |
| `--port <n>` | `8080` | Port for the UI |
| `--listen <ip>` | `127.0.0.1` | Interface for the UI; local only by default |

The server answers only to its own names: `localhost`, `127.0.0.1`, `[::1]`
and the `--listen` address. With `--listen 0.0.0.0` it also answers to each
of the machine's addresses and to the machine's host name. Under any other
name it answers 403, so that a web page elsewhere cannot point a name of its
own at this machine and use the relay.

Settings are saved in the browser's local storage.

## Layer shape: outside in, inside out, and regions

The **Mixer** view (third button in the header) holds the Mixer panel and the
**Layer shape** panel. Layer shape reshapes a pattern after it is drawn, with
the same controls for layer A (the selected pattern) and, while the mixer is
on, for layer B.

**Shape** bends the pattern round the centre of the panel:

| Shape | Result |
|-------|--------|
| Normal | The pattern as drawn |
| Bent, outside in | The pattern's base sits on the rim and it grows towards the centre. Spectrum bars become spikes pointing inwards |
| Bent, inside out | The pattern's base sits at the centre and it grows towards the rim. Spectrum bars become a burst |

The pattern's width is wrapped round the centre and mirrored, with its left
edge at the top and its right edge at the bottom, so there is no seam.

**Region** limits where the layer shows: the whole panel, a central area
only, or everything outside that area. The area is set by:

| Control | Effect |
|---------|--------|
| Area outline | Ellipse, rectangle or diamond. It also decides how a bend runs: round a curve, along straight sides parallel to the panel edges, or along diagonals |
| Area width, Area height | Size as a percentage of the panel's width and height; 100% reaches the panel edges, and up to 150% is allowed |
| Same size both ways | Takes the height from the width in pixels, giving a circle, a square or an even diamond on a non-square panel |
| Border softness | 0 is a hard line. Larger values fade the layer in and out across the border, over that fraction of the area's size either side of its outline (up to 50%) |

A bent pattern is fitted to its region, so its full height spans from the
centre to the area's outline, or from the outline to the panel edge.

A region means the layer is absent outside it, not black there. With the
mixer on, the two layers are blended only where both are present; where just
one is present it shows as it is, whatever the blend and amount. So a
multiply blend, say, darkens the overlap but never blacks out the part of
the panel only one layer reaches. A pixel is black only where neither layer
is present, or with the mixer off and layer A limited to a region.

With a soft border the layer is partly present across the border. Two layers
with opposite regions, the same area and the same softness crossfade into
each other there: the picture goes smoothly from one pattern to the other
with no dark seam and no blend applied, because their shares always add up to
exactly one. A soft-edged layer over one that covers the whole panel fades
the blend in, and a lone soft-edged layer fades to black.

To mix two patterns without overlapping, turn on the mixer, give layer A one
region and layer B the other, and use the same outline and size for both.
Each pattern is then shown at full strength in its own area, with any blend. Shape and region work with any pattern and survive
pattern-change crossfades; overlays are not affected.

## Playlists

The **Playlist** view manages playlists of saved looks. An entry stores:

- the layer A pattern;
- the mixer state: whether it is on, the layer B pattern, the blend and the
  amount;
- both layers' transforms: shape, region, outline and size;
- each layer's Pattern settings;
- the look: hue, speed, palette and palette cycling, key colours, flock
  count, dot size, Sparkles and Spectrum Lab's settings;
- how long to show it (1 to 3600 seconds), and an optional name.

Brightness, gamma and frame rate are not kept: they suit the panel, not the
look. Entries saved before 2026-10-16 keep only the patterns, mixer and
shapes, and leave the rest as it is when shown.

To build one, press **New**, set the screen up the way you want it using the
pattern picker and the Mixer, and press **Add current look**. Each entry
can be renamed, retimed, moved, removed, shown at once, or replaced with
whatever is on screen now.

**Play** starts from the first entry; **Next** moves on early. Repeat is on by
default; with it off the playlist stops after its last entry. Shuffle picks a
different entry each time. While a playlist plays it takes the place of Auto
cycle. Layer A crossfades using the Crossfade setting, as for any pattern
change; layer B, the blend and the transforms switch at the same moment
without a fade. Edits made while playing take effect without restarting.

Playlists are saved in the browser with the other settings; there is no
export or import yet. Up to 50 playlists of 200 entries each.

### Hotsave

Press **S** anywhere on the page, except while typing in a field, to add the
look on screen to a playlist as a new entry, named for the time ("Hotsave
21:04:17") and keeping everything an entry keeps. It goes to a playlist
called **Hotsave**, made on first use, or to another chosen under **Save
to** in the Playlist view's Hotsave panel. The key can be changed there to
any letter or digit except T, which taps the tempo. A line under the
preview confirms each save. Whatever is playing carries on; the entries can
be renamed, retimed or removed like any other.

## Randomizer

The **Randomizer** panel on the Playlist view changes the picture on its own.
Set the shortest and longest wait, what they count (**Counted in**: seconds, or beats or bars of the tempo), and tick what may change. A wait in beats or bars is a whole number of them and ends on a beat or a bar line, so changes land in time with the music; it counts on the same tempo clock that moves spin and pulse. The
Mixer has the same controls in the panes they change: Random pattern
and Random shape in each input, Random blend and amount in Left and Right,
Random hue shift and palette under All inputs, and the switch, the waits and
Random Media Player file under Output and sequencing, each with the time to
its next change ("idle" while it waits for its pair to mix). Both places
change the same settings.

To keep an input on the Media Player, choose it there and untick that
input's Random pattern: the randomizer leaves the pattern alone, keeps the
other inputs off the Media Player (a new pattern avoids the four in use),
and Random Media Player file goes on changing the file.

| Item | What changes |
|------|--------------|
| Layer A pattern | A different ready pattern, with the usual crossfade |
| Layer A shape and region | Bend, outline and size; the region too while the mixer is on |
| Layer B pattern | A different pattern for the mixed-in layer |
| Layer B shape and region | Bend, region, outline and size |
| Blend and amount | Any blend mode, with an amount that keeps both layers in view |
| Input C pattern, Input C shape and region, Input D pattern, Input D shape and region, Right blend and amount | The same for the Mixer's Right pair |
| Hue shift and palette | A new hue shift and a new palette for the ported patterns |
| Media Player file from the folder | Another file from the Media Player's folder (see "Playing media") |

Each item runs on its own timer. After every change it waits a new random
time between the shortest and longest wait, so the layers and their
attributes change independently instead of together. The status line shows
the time left for each.

- Layer B items and the blend only run while the mixer is on; the randomizer
  does not switch the mixer on or off. On the Mixer's Right, input C's
  items always run, and input D's and Right's blend while Right is mixing.
  A new pattern avoids all four that are in use. Settings saved before Right
  had items give each Right item the choice its Left item had.
- It keeps the panel covered. A lone layer always keeps the whole panel; if
  it finds layer A limited to a region with the mixer off, it restores the
  whole panel, and the same for C while Right is not mixing. With the mixer on, whenever both layers would be limited to
  regions, the other layer is given the exact complement of the one that
  just changed, so there is no gap.
- It only picks blends that cannot black the picture out by themselves:
  crossfade, equal-power, average, add, screen, max and difference. Multiply,
  min, stencil, overlay and dip to black stay available by hand.
- With the audio input set to None it skips patterns that need sound to draw
  anything (the AuroraDrop group, and the Mark Estes audio patterns when
  they are set to stay quiet in silence).
- It pauses while a playlist plays, and replaces Auto cycle while it is
  changing layer A's pattern.
- Patterns with nothing to show, such as an empty Media Player, are skipped.
- The media item only runs while the Media Player is on a layer and its
  folder holds more than one file.
- Its changes are ordinary setting changes: they appear in the controls and
  are saved, so "Add current look" can capture a result you like.

## Tempo: BPM detection, movement and timed changes

The analyser's beat detector feeds a tempo tracker. It works out the tempo
from the spacing of recent beats and keeps a running beat position that
advances at that tempo and is pulled gently into step with the beats, so
anything tied to it keeps moving smoothly between beats and through breaks.
The Audio panel on the Setup view shows the tempo, whether it is detected or
manual, and the beat within the bar.

| Setting (Setup view, Audio) | Effect |
|-----------------------------|--------|
| Tempo | Detect from the audio, using the manual tempo until a steady beat is found; or always use the manual tempo |
| Beat from | Where detected beats come from. **Bass jumps:** the original detector, which hardly ever fires on mastered dance music. **Spectral flux:** onsets across the whole spectrum, timed within the frame, with only kicks setting the beat's phase; locks in 1.5 to 3 s. **Essentia:** Essentia.js's tempo extractor on the last 10 s, every 2 s, in a worker, with kicks setting the phase; it loads 2.8 MB when chosen and gives its first tempo after 10 s of audio, and needs a live input. The readout and the info overlay name the source in charge (BAS, FLX or ESS), or show MAN for the manual tempo; with Essentia the readout also says while it loads or waits |
| Manual tempo | 40 to 240 BPM, typed here or tapped on the Mixer |
| Changes | Change at any time, or hold pattern changes from Auto cycle, the playlist and the randomizer until the next beat, the next bar (4 beats), the next 4 bars (16 beats), the next 8 bars (32 beats), or the next change in the music |

**Tap tempo.** All inputs, on the Mixer, sets the tempo by hand. Press
**Tap (T)**, or the **T** key anywhere outside a text field, in time with
the music.

- **Each tap is** a beat, or a bar: tap on every beat, or only on the first
  beat of each bar, which is easier at fast tempi and also tells the composer
  where the bar starts.
- Two or more taps set the manual tempo, in whole BPM from the last eight
  taps, and switch to "always use the manual tempo". A pause of more than two
  seconds a beat starts a new run.
- Every tap also pulls the beat, or the bar line, into step with you over the
  next beat or so. One tap is enough to line it up again without changing the
  tempo.
- **Detect**, shown while the tempo is set by hand, hands it back to the
  detector.
- **Downbeat (D)**, in All inputs' heading on the Mixer, or the **D** key,
  marks the moment as the first beat of a bar, so bars line up with the
  music. While a tempo is detected it moves only which beat is the first,
  by whole beats, so the beats' timing stays the tracker's and a press a
  little early or late does no harm; on the manual tempo the press sets the
  bar line. The tempo itself is not touched. D cannot be the Hotsave key.

**Movement.** Each input's **More…** popover on the Mixer has:

- **Spin with the tempo**: one full turn every 1, 2, 4, 8 or 16 bars, either
  way. A normal layer turns about the centre; a bent layer slides round.
- **Reverse the spin**: never, every 1, 2, 4, 8, 16 or 32 bars, or when the
  music changes. A spin that reverses on a fixed count swings forwards for
  that long and then back; one that reverses on changes keeps going until
  the next change is detected. The angle is continuous either way, so the
  picture never jumps when it turns round.
- **Pulse on the beat**: the layer swells by up to 50% on the beat and
  settles before the next, every beat, second beat or bar.

Spin and pulse move the pattern inside its region; the region itself stays
put. A turned or swollen layer is reflected at its edges, so no part of the
panel is left empty. Movement is stored in playlist entries and varied by the
randomizer along with the rest of a layer's shape.

**Changes in the music.** Dance music adds or removes parts on phrase
boundaries, usually every 16 or 32 beats. The tracker compares each beat's
average energy in the bass, mids and treble with the beats before it, and
counts a change when the balance shifts by more than about 30%, such as a
breakdown losing its kick or a drop bringing it back. A change is noticed
within one beat of happening. Changes are at least 16 beats apart, and if
nothing is detected for 128 beats one is declared anyway, so nothing waiting
for a change waits for ever. The Audio panel shows how many bars it has been
since the last one.

Detection details: tempi are folded into 70 to 180 BPM, so a detector firing
on every other beat or twice a beat still gives a usable tempo. A lock needs
at least four recent beat intervals agreeing within 5%, and is dropped after
five seconds without a beat, when the manual tempo takes over. The beat
detector follows bass energy, so music without a clear low-end pulse may not
lock; use the manual tempo for that. Bars are counted in fours from wherever
the tracker started, so "bar" means every fourth beat, not the music's
actual downbeat.

## Stereo audio

The analyser asks the audio input for two channels and keeps a separate
spectrum for left and right, alongside the combined spectrum the shader
patterns use. Patterns that show the two channels separately read
`spectrumLeft` and `spectrumRight` from the render state.

- A mono input leaves the second channel silent; its spectrum is then shown
  on both sides, and the Audio panel says the input is mono.
- The simulated source produces a different right channel so stereo patterns
  can be tried without an input.
- Browsers may still deliver mono from a stereo device. Echo cancellation,
  noise suppression and automatic gain are already turned off, which is what
  usually allows two channels through.
- Level, bands, beat, musical key and Spectrum Lab still use the combined
  signal.

## Mark Estes patterns

The **Mark Estes** group in the pattern picker holds patterns ported from the
Table_Mark_Estes69 Arduino sketch. The code lives in its own directory,
`public/patterns/mark-estes/`:

| File | Contents |
|------|----------|
| `runtime.js` | The sketch's shared state, per-pattern randomisation, fades, wind, mirrors and drawing primitives |
| `effects.js` | The ported effect functions, under their original names |
| `audio-effects.js` | The audio-driven effect functions |
| `decorations.js` | The occasional overlays drawn over a pattern |
| `index.js` | The pattern table, keyed by the sketch's pattern numbers |
| `NOTICE.md` | Provenance, licence and known differences from the sketch |

**Licence: Apache-2.0.** The sketch is licensed under the Apache License,
Version 2.0 (its licence file is in upstream's `Table_Mark_Estes` directory,
and its maintainer Marc Merlin confirmed it on 2026-10-23). The text and a
notice are in `public/licenses/table-mark-estes.txt`; every file in the
directory carries the SPDX tag and says it is a translated, modified version.
See `NOTICE.md` for the provenance and the differences before reusing it.

Ninety-four of the sketch's 199 pattern numbers are ported so far, along with
the sketch's occasional decorations (rings, boxes, stars and confetti drawn
over a pattern). `NOTICE.md` lists the numbers.

Thirty-seven of them are audio-driven (the ones named "Audio …"). The sketch took
its audio from a second microcontroller; the port feeds those patterns from
the composer's spectrum, level and beat detector instead, so they respond to
whichever audio input is selected. What they do in silence (nothing heard for
five seconds, or the input set to None) is chosen on the Setup view under
Audio: either the sketch's own stand-in, in which every band bobs at its own
rate (the default), or staying quiet so the silence shows. The sketch's left and right spectra come from the composer's
stereo analysis (see "Stereo audio"). `NOTICE.md` describes the mapping.

Each run of a pattern rolls random parameters, as the sketch does, so the
same pattern looks different each time it is selected, and it re-rolls after
about two simulated minutes. Patterns step at the sketch's own frame rate,
which is low (2 to 14 frames per second for most); the Speed slider scales
it. Hue shift, the mixer and overlays apply as for other patterns.

## AuroraDrop patterns

The **AuroraDrop** group in the pattern picker holds patterns ported from
AuroraDrop and its fork AuroraDrop-LXP, audio visualisers built on Aurora.
The code is in `public/patterns/auroradrop/`:

| File | Contents |
|------|----------|
| `runtime.js` | The shared 64 by 64 canvas and its helpers, the audio data, and the frame pipeline |
| `effects.js` | The processing effects (blur, spiral stream, directional stream, move) |
| `audio-patterns.js` | The audio patterns |
| `index.js` | The picker entries |
| `NOTICE.md` | Provenance, the file-by-file licence position, what is and is not ported, and differences |

AuroraDrop works differently from the other patterns: a processing effect
keeps reworking whatever is already on the canvas (fading, blurring,
streaming or shifting it) while audio patterns draw on top, and every ten
seconds each of them is restarted with new random settings. The picker has:

- **AuroraDrop Show**: the full arrangement, with a random processing effect
  and two random audio patterns that keep being replaced.
- **One entry per audio pattern** (eight so far: Spectrum 2, Lines,
  Triangles, Diagonal Spectrum, Rotating Wave, Dots Single, Spectrum Peak
  Bars and Wave Single), each over a random processing effect.

They draw on AuroraDrop's own 64 by 64 canvas, which is then scaled to the
panel, and they follow the composer's audio spectrum and Reactivity
setting. Hue shift, the mixer, layer shapes and overlays apply as usual.

Most of AuroraDrop's files carry the MIT notice from Aurora and are ported
under it. Nine pattern files carry no notice and are left out; `NOTICE.md`
lists them.

## Playing media

The **Media Player** pattern shows a still image, an animated image (GIF,
APNG, animated WebP) or a video, resized to the matrix. Select the pattern,
then choose a file in the Media Player panel on the Patterns view.

| Resize | Result |
|--------|--------|
| Fill panel (default) | Keeps the aspect ratio and crops whatever overflows |
| Fit inside | Keeps the aspect ratio and adds black bars |
| Stretch to panel | Ignores the aspect ratio |

- The file never leaves the browser. It is stored in the browser's IndexedDB
  so the pattern still has its media after a reload; **Remove media** deletes
  that copy.
- Video plays muted and loops at its own speed; the Speed slider does not
  affect it. Supported formats are whatever the browser can play.
- Animated images use each frame's own delay. GIFs are decoded by the
  composer itself, so they animate in every browser, Safari included. APNG
  and animated WebP need the browser's `ImageDecoder`, which Chrome and Edge
  provide; without it only their first frame is shown.
- The line under the file chooser says what was found, for example
  `animation, 24 frames`. A file named `.gif` that is not a GIF, such as a
  saved web page, fails to load.
- Hue shift, brightness, gamma, overlays and the mixer apply as for any other
  pattern, so media can be one layer of a mix.
- Auto cycle skips the Media Player while no file is loaded.

### A folder of media for the randomizer

**Choose folder…** points the Media Player at a folder on this computer. Every
image and video file in it, and in its subfolders, becomes something the
randomizer can show; other files are ignored. One is shown straight away, and
**Random file from folder** changes to another by hand.

- With the randomizer on and **Media Player file from the folder** ticked,
  the file changes on its own timer for as long as the Media Player is layer
  A, or layer B with the mixer on. To run through a folder and nothing else,
  select the Media Player and untick **Layer A pattern**.
- Whenever the randomizer switches a layer to the Media Player, it also
  chooses a new file.
- The same file is not chosen twice in a row. A file the browser cannot
  decode is reported and left out from then on.
- The new file is decoded before it replaces the old one, so the change is a
  cut with no black frames. It is not a crossfade: there is one Media Player,
  so both layers show the same file.
- Files are read where they are; nothing is copied. Chrome and Edge remember
  the folder for the next visit and may need **Reopen folder** pressed once to
  allow reading it again. Other browsers list the folder for the current
  visit only, and may ask to confirm an "upload"; the files still stay in the
  browser.
- The folder is listed when it is chosen. Files added later are picked up by
  choosing or reopening it again.
- The Media Player is still one pattern among all the others when the
  randomizer chooses a pattern; a folder does not make it more likely.
- **Forget folder** drops the folder and leaves the file that is showing.
- A browser may pause a muted video while its tab is hidden; keep the
  composer tab visible when streaming video.

## Mixer

The **Mixer** view, the quad mixer, fills the window with four
inputs and their mixers: A and B on the left, mixed into **Left**; C and D on
the right, mixed into **Right**; and the **main** in the middle, which mixes
Left and Right for the stream. (Anjin renamed it from master on
2026-10-16, and the view from Quad mixer to Mixer on 2026-10-20, when it
replaced the one-pair Mixer view; the code and saved settings still call
them `master` and `quad`.) Columns
are shares of the window, not fixed sizes; below 900 px wide they stack
into one.

- **Each input** has a preview, showing it through its shape and region as
  it goes into the mix, its pattern, shape and region, its own
  **brightness and gamma** (applied before mixing; the receiver's still
  apply to the whole picture), its **hue**, and its Pattern settings inline.
  The hue follows the main's (Hue shift, under All inputs) while **main** is
  ticked beside it; untick it to give the input a hue of its own, which
  starts where the main's is. Key colours still turn an input's own hue
  with the key. Under the name, a line of **tags** shows each modifier the
  input has, so you can read it at a glance, or "unmodified": ⚙ and how many
  Pattern settings are changed, the bend (bent in, bent out), the region
  (centre or edges, its outline ◯ ▭ ◇, size, "soft" with a soft border),
  the spin (↻ or ↺ and its bars, ⇄ and when it reverses, ⇄♪ on changes in
  the music), the pulse (♥ and how much larger, /2 every second beat, /bar
  every bar), brightness (☀), gamma (γ) and its own hue. Hover a tag to read
  it in full. **Reset A**, in its corner, brings the input back to just its
  pattern, unmodified: its Pattern settings, shape, region, area, border,
  spin, pulse, brightness, gamma and hue to their defaults, the hue following
  the main's again; the randomizer then waits a whole wait before changing
  it. On the Patterns view, the Pattern settings' **Reset to just the
  pattern** does the same for the input showing it. **Edit**, on A and B, opens
  the Patterns view. **More…** beside the region opens the rest of the
  shape: the area's outline, width and height,
  border softness, and spin and pulse on the tempo. It is outlined while any
  of those differs from the default.
- **Each pair** has a preview of its mix, a crossfader, the blend, cuts to
  either input, **Fade** (over the main's fade time), **Swap**,
  **Reset** (its first input alone) and **Mix B** (or **Mix D**), which
  turns its mixing off and on; moving the fader or choosing a blend turns
  it on.
- **Swap**, on each pair and on the main, trades the two sides whole: on a
  pair its inputs, with their patterns, Pattern settings, shapes, regions,
  brightness, gamma and hue; on the main Left and Right, A with C and B with D,
  each pair's blend and fader going with it. The fader then moves so the
  picture going out stays the same, and a pattern such as Fire carries on
  rather than restarting. That is exact with a crossfade, whose fader is a
  position. A combine blend's fader is its strength and stays; Add, Screen,
  Average, Multiply, Max, Min and Difference then look the same only at full
  strength, and Stencil and Overlay, which treat their inputs differently,
  change. A pair showing its first input alone shows the other alone after,
  as a crossfade. A fade under way ends.
- **The main** has the Live monitor (what the stream is sending), a
  spectrum and a beat map, the Left–Right fader, its blend, fade time and
  when a fade starts (at once, or on the next beat, bar or phrase). Every
  change goes to the stream as it is made. **Fade to Right** (or **to
  Left**) takes the main across over the fade time; moving the fader
  ends a fade. **Blackout** sends black until pressed again. **Reset
  main** brings back the default look, shared settings included; **Save
  as default** makes the look on screen that default. Until one is saved,
  the default is plain patterns.
- **All inputs** holds the shared settings (tempo, beat source, tap tempo
  and what each tap is, hue, speed, palette, key colours; **Detect**
  shows while the tempo is set by hand and goes back to the audio's), and **Output and sequencing** streaming,
  Hotsave and the randomizer; each randomizer item sits in the pane it
  changes (see "Randomizer").
- **A is the pattern chosen on the Patterns view:** a change in either
  shows in the other.

Not yet: playlists and Hotsave work on Left only, and the randomizer, which
changes Right as well as Left, does not fade the main between them (T16
step 6); the Media Player's start position (step 7); changing pattern on C
or D cuts rather than crossfades; Edit on C and D; and A and B showing the
same pattern share its Pattern settings, as before.

## Mixing two effects

Each pair on the Mixer blends its second input with its first: Left blends
B with A, the pattern chosen in the picker. Tick **Mix B** (or move the
fader), choose B's pattern and a blend, then set the amount.

Crossfades move from A at 0% to B at 100%:

| Blend | Result |
|-------|--------|
| Progressive crossfade (linear) | Straight mix; 50% is an even blend |
| Equal-power crossfade | Sine/cosine gains, so brightness does not sag mid-fade |
| Dip to black | A fades out by 50%, then B fades in |

Combine modes blend both layers; the amount is the strength of the effect
over plain layer A:

| Blend | Result |
|-------|--------|
| 50/50 average | Mean of both layers |
| Add | Sum, clipped at full brightness |
| Screen | Brightens without clipping; black in B leaves A unchanged |
| Multiply | Darkens; white in B leaves A unchanged |
| Max (lighten) / Min (darken) | Brighter or darker of the two, per colour channel |
| Overlay | Multiply in A's shadows, screen in its highlights |
| Difference | Absolute difference per channel |
| Stencil | B's brightness masks A, so A shows only where B is lit |

**Swap** on Left trades A and B: patterns, settings, shapes and trims, and
the fader moves so the picture stays (with a crossfade; see Swap under
Mixer). Both layers use the same audio,
speed, hue, palette and pattern settings, and the pattern-specific panels are
shown for either layer. Pattern changes and auto cycle apply to layer A and
crossfade as before; the mix is applied after that crossfade and before the
overlays, brightness and gamma. Rendering two patterns costs roughly twice
the frame time of one. Mixer settings persist across reloads.

## Persistent overlays

The **Persistent overlays** panel adds clocks, dates, single-line custom
text and info blocks above **every pattern**, including Spectrum Lab, Aurora/Fibonacci ports,
and shaders. Overlays are part of the final RGB frame: the browser preview
and DDP LED output show the same elements. They stay stationary and fully
visible during pattern changes and crossfades rather than fading with either
pattern. Nothing is drawn until you add an element.

- **Add clock**, **Add date**, **Add text** or **Add info**, then expand the
  element to edit it.
- **Info** shows what the composer knows, one line for each field ticked, or
  all on one line:
  - tempo, as BPM and the beat of the bar (`128 BPM 3/4`), with `MAN` when the
    tempo is the manual one rather than detected;
  - the musical key, Camelot first (`8A A MIN`), with `?` when the key is the
    last one found and the music is uncertain now;
  - the patterns showing, both when the mixer is on;
  - frames per second sent to the matrix, or drawn when not streaming;
  - DDP packets per second, and send errors if there are any.

  Packet loss is not shown because it is not known: the receiver does not
  report back what arrived. Frame and packet counts are the last second's.
- **Font**: the browser's bold monospace, or a 3 by 5 **pixel font** that
  stays crisp on small panels. Info blocks use the pixel font by default. The
  pixel font scales in whole pixels, one pixel per six of text size (size 6
  gives letters 5 pixels tall, size 12 gives 10), and has capitals, digits
  and common punctuation; lower case is shown as capitals.
- Nine position anchors keep elements aligned when the panel is resized.
  Signed X/Y offsets, font size (6–128 pixels), and padding are native panel
  pixels; positive offsets move right/down.
- Set text colour, opacity, background colour/opacity, and background padding.
  Background opacity zero leaves transparent text; a dark background improves
  readability over busy effects. Text uses the browser's bold monospace font.
- Clocks offer 12-hour AM/PM or 24-hour time, optional seconds, and local/UTC
  time. Dates offer ISO `YYYY-MM-DD` or locale-dependent short/long formats.
  They use the **composer computer's wall clock**, not the receiver's or animation
  Speed, and continue updating with Speed zero and in background tabs.
- Each element has a visibility toggle. The master toggle hides all without
  deleting them. **Move back/front** changes stacking order; later elements
  draw on top. **Remove** deletes an element.

Up to 16 elements are saved in browser local storage with the other settings.
Custom text is literal, not HTML; it is limited to one line of 128 characters.
Elements saved before the font choice existed keep the browser font.
Overlays ignore manual/key-derived pattern hue, but global **Brightness**
and **Gamma** apply after overlay compositing. With brightness zero the whole
frame remains black, and **Send black frame when stopping** still clears the
whole output. Text that extends beyond the panel is clipped, not automatically
scaled: reduce font size or adjust offsets on small panels.

The overlay canvas is rasterized at native resolution and uploaded only when
content, settings, or panel size changes. Clocks update once per displayed
minute/second; static text does not need re-rasterizing every animation frame.
An info block changes on each beat and each second, when its counts do.

## Audio

- **Microphone or line input:** pick it in the Input menu. The browser asks for
  permission once, then shows the device names.
- **Music playing on the same Mac:** install a loopback driver such as
  [BlackHole](https://github.com/ExistentialAudio/BlackHole). Create a
  Multi-Output Device in Audio MIDI Setup with your speakers and BlackHole,
  play music to it, and choose BlackHole as the input.
- **Simulated 120 BPM:** a synthetic beat for trying patterns without audio.

Echo cancellation, noise suppression, auto gain and voice isolation are
turned off so music keeps its dynamics, and only the input chosen is opened.
The line under the meter says whether the browser actually turned them off.
Use **Reactivity** to match the input level.

**Two copies of the composer on one input.** Chrome lets several pages use
the same input at once. Safari lets only one page use it: when another page
takes it, Safari mutes the first ([WebKit bug
223198](https://bugs.webkit.org/show_bug.cgi?id=223198)). The Audio panel
then says the input is muted by the browser and offers **Take the input
back**, which mutes the other page in turn. To run two copies on one input
with Safari, open one of them in Chrome. The meter
shows the spectrum plus bass, mid, treble, and beat.

## Sparkles

**Sparkles**, on the Mixer's Main, lay twinkling points of light over the
final mix out, whichever pattern, mixer or playlist is in charge: the one
place for them (Anjin, 2026-10-20). The **Sparkles** button beside
Blackout is lit while they are on and opens their settings, the on/off
first; the ⓘ beside each setting says in full what it does. Each hit in the highs (4 to 16 kHz: hi-hats, shakers,
cymbals) lights a scatter of points that flash and fade, and a faint twinkle
follows how much treble there is between hits. They are drawn once, over the
final mix after the main, and under the overlays, before Gamma and
Brightness; on edges or bright shapes they follow that final picture.

- **Amount:** how bright they are.
- **Density:** how many points a hit lights, up to 2% of the panel for the
  strongest.
- **Length:** how long a point takes to fade to a third, 50 to 400 ms.
- **Twinkle with the air:** the twinkle between hits.
- **Shape:** single points, or stars with four dimmer neighbours.
- **Colour:** white; the key colour; or gold to ice, by where in the highs
  the hit fell, so a closed hat and a crash differ.

A hit is a rise in the high band that stands out from the last second, is
brighter than any rise at 1 to 4 kHz (so kicks and snares do not count), and
is large against the band's own level. Hats that land with a kick or snare
are often skipped; the beat already marks those. Very fast rolls, faster than
about one hit every two frames, are mostly missed. The measurements are in
[High-band hits for sparkles](../docs/findings.md#high-band-hits-for-sparkles).

## Patterns

**Pattern settings.** A pattern can describe its own variables, and the
Patterns view shows them under **Pattern settings** when it is chosen:
sliders, checkboxes or menus, each with a note on hover, and **Reset to
defaults**. They are kept for each pattern, so Tunnel keeps its spin while
Plasma keeps its scale. When the mixer's layer B is another pattern, its
settings are shown too. The defaults are what the patterns drew before they
had settings. So far the shader patterns below have them, all but Panel
Range; the ported patterns (Aurora, Fibonacci, Mark Estes, AuroraDrop) and
the panels of their own (Spectrum Lab, Media Player) do not yet. Playlists
and the randomizer do not keep them.

| Pattern | Audio response |
| --- | --- |
| Plasma Pulse | Bass swells the rings, mids shift colour, beats flash |
| Spectrum Bars | Mirrored log spectrum, bass in the centre |
| Spectral Waterfall | Scrolling spectrum history; bass left, treble right, energy from blue/cyan through red to white |
| Camelot Wheel | DJ key wheel: detected sector bright, adjacent numbers and relative major/minor highlighted. The detected sector kicks on each beat, the hub goes from near black to the key's colour, a ring runs from the hub to the rim, and the compatible keys breathe with the level |
| Radial Spectrum | Spectrum around a ring that breathes with the bass |
| Tunnel | Ring brightness follows the spectrum by depth |
| Flow Field | Domain-warped noise; bass deepens the warp, treble shimmers |
| Kaleidoscope | Six-way mirrored noise; bass zooms, mids shift palette |
| Oscilloscope | Live waveform with echo traces |
| Metaballs | Each blob grows with its own frequency band |
| Starfield | Flying stars; beats brighten, treble twinkles |
| Voronoi Cells | Cell brightness follows the spectrum, edges flare on beats |
| Rotating Wave | Rotating waveform ribbons; bass spreads echoes, treble brightens them |
| Circular Wave | Waveform-distorted rings; bass expands them, beats light the centre |
| Spectrum Tiles | 8 by 8 frequency tiles that grow and brighten with band energy |
| Spectral Rain | Falling frequency trails; bass left, treble right, beats widen drops |
| Aurora Curtains | Flowing light ribbons lifted by the spectrum and brightened by bass |
| Triangle Pulse | Nested rotating triangles; bass expands outlines, treble adds glow |
| Fire | A 2D flame simulation after Fire2012 (as WLED's Fire 2012 2D uses it): heat rises, cools along a drifting noise field into tongues of flame, sways with wind and turbulence; sparks feed the base more with the bass, each beat flares it, embers rise above. Its Pattern settings: Cooling, Sparking, Wind, Turbulence, Embers, Music |
| Panel Range | A test card, not a visual: steps at known levels for reading how the panel answers what it is sent (see "Reading the panel" below). The randomizer and Auto cycle pass over it |

### Reading the panel

An LED panel does not show brightness the way a monitor does, so a change
that is plain in the preview can be faint on the panel, and something dim in
the preview can be bright there. **Panel Range** sends known levels so that
the difference can be seen. Choose it with the mixer off, the layer's region
set to the whole panel, and Brightness at 1 and Gamma at 1 in the Look panel,
so that the levels go out as written. From the top:

| Row | What it sends | What to look for |
| --- | --- | --- |
| Grey steps | 16 bars, level 0 to 255 in steps of 17 | Where the bars stop looking different from their neighbours. On a panel that is linear in light the bright half runs together |
| Doubling steps | 16 bars at 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 255 | The first bar that lights at all, and whether the steps look even. Even steps here mean the panel is linear |
| Red, green, blue | The grey steps again, one colour each | Whether a colour starts later or runs out earlier than the others |
| Four patches | Each changes between two levels once a second: 8 and 255, 89 and 191, 102 and 166, 128 and 255 | Which of them reads as a pulse. The first goes from near black to full; the rest move between two bright levels |

Bars are parted by a dark pixel where the panel is at least 64 wide. The
patches follow the Speed control, and stop at speed 0.

Then raise Gamma in the Look panel (about 2.2 is the usual figure for a
linear panel) and watch the grey steps spread out on the panel. The preview
darkens as Gamma rises, because it shows what is sent. Starting the receiver
with `-l` does the same job at the panel; use one or the other, not both.

The additional wave, tile, rain, aurora, and triangle patterns are original
WebGL shaders inspired by the visual themes in
[AuroraDrop](https://github.com/fivefishstudios/AuroraDrop), not ports of its
ESP32/FastLED implementation.

### Spectrum Lab: configurable frequency analysis

Select **Spectrum Lab** for a native-resolution, audio-driven analysis plot.
Start with one of six presets, then expand its tuning sections. Settings apply
live and persist across reloads; changing geometry/colours does not restart
level or peak history. Changing bands, FFT resolution, level range, slope or
audio source clears incompatible history.

| Control | Options |
| --- | --- |
| Display | Bars, line, filled curve, mirrored ribbon, circular crown, spiral |
| Frequency grouping | Linear/logarithmic with 4–256 bands; octave, 1/3 octave, or 1/6 octave |
| FFT | 512–32768 window samples (256–16384 positive-frequency bins) |
| Range | Adjustable minimum/maximum frequency and dB floor/ceiling |
| Band detector | Mean linear power (RMS magnitude) or maximum bin magnitude |
| Response | Independent attack/release time constants, analysis gain, slope compensation |
| Peak indicators | Enable/disable, hold duration, fall rate in dB/second |
| Geometry | Straight segments or bounded smooth cubic interpolation, thickness, bar gaps, polar rotation, spiral turns |
| Colour | Frequency/level/single-colour mapping; Rainbow plus the 33 gradients |
| Reference | 10 dB grid, octave frequency guides on rectangular plots, compact scale labels at 96×48 or larger |

This uses a **separate unsmoothed floating-point Web Audio FFT** with a
Blackman window. It does not change the original 256-bin shader spectrum,
waveform, or musical-key FFT. Analysis gain is independent of **Reactivity**.
The simulated source also supplies a synthetic raw spectrum; None clears it.
Level response and peak hold follow **real audio time**, even when animation
Speed is zero. The existing global brightness, gamma, hue and crossfade still
apply to the final output.

Fractional bands use exact base-two ratios anchored at **1 kHz**, not a
certified IEC filter bank. Overlapping FFT bins contribute by their fractional
frequency coverage. Mean power averages linear bin powers, not dB values; it
is a band-average magnitude, not integrated band energy. Positive slope adds
the selected dB per octave above 1 kHz (and subtracts below); zero is flat.
Smooth curves interpolate neighbouring measurements without overshoot; they
are visual curves, not fitted spectral models or additional FFT resolution.

The readout shows effective band count, FFT bins, Hz/bin, window duration,
strongest uncorrected band, and how many bands are narrower than one FFT bin.
The upper frequency is capped at the input's Nyquist frequency. Larger FFTs
resolve low frequencies better but have longer analysis windows. Narrower
display bands cannot separate frequencies that the FFT has not resolved.
Levels are relative digital FFT magnitudes, **not calibrated SPL/dB(A)**.
No microphone signal leaves the browser; only rendered RGB frames are streamed.

### Beat Graph: the music folded by the bar

Select **Beat Graph** for a picture of the music's structure, after the beat
graphs of [BpmDj](http://bpmdj.yellowcouch.org/) by Werner Van Belle. It is
written here from that idea, not ported from BpmDj's code.

- **Layout.** Each column, two pixels wide, is one bar of the beat clock,
  with the newest at the right; a 256-pixel panel shows the last 128 bars.
- **History.** It shows the bars the Monitor view's graph has gathered since
  the page was opened, so when chosen it starts with as many bars as the
  panel has room for, not a blank panel. Those bars are kept at 192 rows and
  averaged down to the panel's height. Each column keeps the hue of the
  moment it was painted; bars from before the pattern was chosen take the
  hue of that moment.
  Down the column runs the bar, from its first beat at the top to its last at
  the bottom, with faint lines at each beat.
- **Brightness** is the sound's energy at that moment of the bar.
- **Colour** shows whether that moment leans to the bass (red) or the treble
  (blue), turned by the hue setting, and is paler when many frequencies sound
  at once.
- **Scaling.** Brightness and colour are scaled between the lowest and
  highest values of the bars just played, so mastered music, loud all the
  time, still shows its shape.

**It also shows whether the beat clock is right:**

- **Horizontal lines:** the clock keeps time with the music.
- **Sloping lines:** its tempo is off.
- **Level lines away from the beat marks:** its phase is off.

It needs an audio input; with none it shows only the beat marks.

### Live key detection and the DJ Camelot wheel

Select a **live audio input** to estimate musical key locally in the browser.
The key lives on the **Monitor** view's **Key** panel, which shows the note name, major/minor mode, **Camelot number/letter**,
an estimate-strength indicator, and compatible neighbours. Detection uses a
separate 8192-point FFT sampled about ten times per second, spectral peak
pitch classes, a six-second decaying history, and major/minor profile matching.
It needs roughly four or more seconds of pitched material before reporting
a stable result. A changing key may take longer to replace the previous one.
The indicator is a heuristic score, **not a calibrated probability**.
Relative keys, short chords, detuned music, percussion, and complex mixes can
be ambiguous or misclassified. None/simulated inputs do not invent a key.

The panel's **live wheel** is the Camelot wheel below, drawn as the pattern
draws it: every key shaded by how well it fits the last several seconds of
pitched music (the detector's score for each of the 24, relative to the
weakest and strongest), the key in use lit and ringed, its mixing neighbours
outlined, and a dot on the detector's own best when it hears another key.
**Click a key** to say what you hear ("no, this is 5A"): the detector takes
it at once and keeps it until the music clearly says another key for eight
seconds (a key it found itself needs one); the ring is dashed while the key
is yours. With **Keep the key I choose whatever the music says** ticked it
stays until **Detect** hands it back. The Monitor's log records the key and
who says it (`key`, `key_by`: detector, held, chosen or locked).

**Keep the last key until another is found** (on the Key panel, on by
default). When the music turns uncertain or stops, the wheel, the key
colours and the Key panel keep the last key, and the panel marks it "last
found, uncertain now". After two seconds of silence the detector forgets
what it heard, but not the key. The key is forgotten when the audio input is
changed or stopped. With the setting off, a key shows only while the
detector is confident of it, and the wheel and colours go back to having no
key in between. The setting persists.

**Camelot Wheel** has 12 numbered sectors clockwise, with **12 at the top**,
**minor A keys inside** and **major B keys outside**. It highlights the
estimated key, the **previous/next number on the same ring**, and the
**same number on the other ring** (relative major/minor). For example,
**8A = A minor**, with **7A, 9A, and 8B (C major)** as basic harmonic-mixing
neighbours. These are DJ mixing suggestions, not guarantees for every track.
Labels appear at panel sizes of at least 128 pixels on the shorter axis;
smaller panels retain the rings, colours, and highlights. Until a first key
is found the full wheel remains dim, with no selected sector or neighbours.
A key that is being held is lit a little less brightly than one being heard.

**Use musical key for colours** optionally adds the detected Camelot sector's
colour offset to the manual hue for other patterns, including Aurora ports.
Relative major/minor pairs share an offset. Changes ease around the hue wheel.
The offset stays on the last key found through uncertainty while the last
key is kept, and returns to the manual hue when there is no key. This setting persists and
defaults off. The Camelot pattern always uses detection for highlighting,
regardless of that checkbox; its sector colours stay fixed except for the
manual hue shift so they do not rotate when the detected key changes.
Key detection does not alter animation speed or the original audio analysis.

### Ported Aurora demos

All **13** patterns from the top-level playlist at the linked revision of
[Marc MERLIN's Aurora demos](https://github.com/marcmerlin/FastLED_NeoMatrix_SmartMatrix_LEDMatrix_GFX_Demos/tree/a98cb3e965433a8eebb8893d630735fda12469cb/GFX/Aurora)
are available alongside the shader patterns:

| Pattern | Original algorithm |
| --- | --- |
| Aurora Attract | Gravitational particles orbiting an attractor |
| Aurora Bounce | Gravity-driven bouncing columns |
| Aurora Cube | Rotating perspective cube with front/back edge visibility |
| Aurora Flock | Separation, alignment, cohesion, predator avoidance, and wind |
| Aurora Flow Field | Particle velocities driven by FastLED 3D noise |
| Aurora Incremental Drift | Nested sine/cosine orbits at incremental beat frequencies |
| Aurora Incremental Drift Rose | Counter-rotating incremental orbits |
| Aurora Pendulum Wave | One oscillator per column, with increasing beat frequencies |
| Aurora Radar | Rotating radial sweep with fading trails |
| Aurora Spiral | Oscillator-driven lines and three spiral-stream buffer effects |
| Aurora Spiro | Two phase counters and a changing number of orbiting points |
| Aurora Swirl | Six reflected beat-driven dots with lossy 2D blur |
| Aurora Wave | Quadratic wave with random orientation and optional reflection |

These are **algorithm ports**, not look-alike shaders. Each has an independent
persistent RGB buffer, particle/phase state, and upstream fade/blur operations.
The effects draw directly into a buffer at the **configured panel resolution**;
there is no enlarged 32 by 32 framebuffer. Geometry, particle motion, dot/line
widths, blur radii, and spiral streams scale before rasterization. Larger panels
use continuous positions and connected trails, and wave effects sample every
native column or row. Particle counts increase with panel dimensions. Cube
projection keeps its proportions on rectangular panels.

Selecting **Aurora Flock** reveals flock controls. Enter **1–256 birds**
(not including the contrasting predator). Editing turns off automatic count;
check **Automatic flock count** to restore panel width divided by three,
capped at 256.

All **13 ported Aurora patterns** share an **Aurora dot size** control.
Choose a **1–32 panel-pixel diameter / line width** for dots, connected trails,
cube edges, and wave/spiral lines, including Flock's predator. The control is
always editable; editing turns off automatic sizing. Check **Automatic dot
size** to restore each pattern's original resolution-scaled dots and lines.
This does not affect the original audio-reactive shader patterns such as
Aurora Curtains. Existing saved flock dot sizes migrate to the shared control.
Valid changes apply while editing on the next simulation step without
restarting animations; old trails fade naturally. Settings persist across
reloads and pattern changes and apply to both sides of Aurora crossfades.
Explicit sizes stay fixed in panel pixels when the panel is resized.
Large flocks and large dots use more CPU and can lower the achieved frame rate.

At 32 by 32 with automatic sizing, the original byte-coordinate drawing is retained. Other sizes use
floating-point trigonometry and antialiased geometry to avoid coarse coordinate
steps and byte overflow. Scaled blur uses a separable native-pixel filter;
these high-resolution adaptations are not byte-identical to the original
32-pixel output. The transmitted RGB frame matches the panel's full dimensions.

Explicit upstream frame delays (15, 20, or 50 ms) are retained; demos returning
zero delay use a 60 Hz simulation clock in place of the MCU's unrestricted loop.
Simulation is independent of the selected output frame rate. **Speed** scales
the simulation clock; speed zero freezes it. The original demos are **not
audio-reactive**: they do not use audio to change their animation speed.
Hue, brightness, gamma, manual selection, auto cycle, and crossfades still apply.
Both sides of a crossfade continue animating with separate buffers. Selecting
a demo again or resizing the panel restarts its state; inactive buffers are
released. Long browser interruptions freeze time rather than replaying every
missed physics frame.

Necessary source fixes: Flow Field's malformed nested palette call is replaced
with the intended single palette lookup. Spiral-stream operations clip
off-screen reads/writes instead of corrupting the shared off-screen XY pixel.
Random starts use JavaScript's random generator rather than the MCU generator,
and particle arithmetic uses JavaScript floating point. FastLED byte trigonometry,
quadratic waves, rainbow palette blending, noise, saturating addition, and blur
are translated directly (FastLED 3.5.0).

### Fibonacci128 adaptations and palettes

Four additional native-resolution patterns adapt the **aurora** branch of
[fibonacci128-touch-aurora](https://github.com/AnjinMeili/fibonacci128-touch-aurora/tree/5f8dd395f5a8f62d169463d125ee5b102b526611):

| Pattern | Behaviour |
| --- | --- |
| Fibonacci Bloom | Two overlapping Fibonacci arm systems, outward/counter pulses and a breathing centre; arm pairs change every eight seconds |
| Fibonacci Chase | Staggered pulses travel along golden-angle arms; arm counts change every twelve seconds |
| Electric Mandala | Temporally smoothed, mirrored noise with organic reversing rotation and changing drift/scale |
| Radial Fire | Stateful cooling, sparks and heat transport from the perimeter towards the centre, with angular noise |

These run on the same fixed simulation clock as the Aurora ports, without
audio modulation. Bloom and Chase generate native golden-angle points instead
of magnifying a 128-LED picture; dot sizing also applies to them. Mandala and
Fire are full-field effects, so dot size does not alter them.

**Ported pattern look** offers the original pattern colours, FastLED Rainbow,
and **33 cpt-city gradient palettes**. Changes blend over two simulation seconds.
Optional palette cycling advances through gradients every ten simulation
seconds; Speed zero freezes both patterns and palette transitions. The shared
choice persists across reloads, re-selection, resizing and crossfades. Palette
controls apply to all 13 Aurora ports and these four additions, not to the
audio shaders. Radial Fire's original colours are black/red/yellow/white.

Adaptations are not byte-identical firmware output: Mandala reuses `inoise8`
instead of `inoise16`, Fire interpolates its 32 heat bands, and gradient stops
are interpolated directly rather than quantized to 16 palette entries.

**Licensing:** the composer application combined with the new GPL-derived
adaptations is distributed under **GPL-3.0**; the project as a whole is
GPL-3.0-or-later (see [../CREDITS.md](../CREDITS.md)). Original MIT/CC0 components keep
their attribution. This does not relicense the independent receiver, `matrix-dmx`.
Source revision, adaptation notes and credits are in
[public/licenses/fibonacci.txt](public/licenses/fibonacci.txt), full GPL text in
[public/licenses/gpl-3.0.txt](public/licenses/gpl-3.0.txt), and original gradient
source comments in [public/licenses/gradient-palettes.txt](public/licenses/gradient-palettes.txt).

Attribution, original copyright notices, and MIT permission text are retained in
[public/licenses/aurora.txt](public/licenses/aurora.txt), also served at
`/licenses/aurora.txt` with the browser app. The `_notmytaste` and `_baddisplay`
directories are not included.

Animation speed also rises with the overall audio level. Use ← / → to switch
shader patterns. **Auto cycle** steps through all patterns with a crossfade.

**Spectral Waterfall** is a scrolling spectrogram with the newest spectrum at
the bottom and older samples moving upward. It stores 256 spectra at 30 samples
per second (about 8.5 seconds), independent of the frame rate, animation speed,
or panel size. Frequency runs logarithmically from about 30 Hz to 16 kHz
(limited by the audio input's Nyquist frequency). Silence is black; stronger
energy is brighter and warmer. Reactivity, hue, brightness, and gamma still
apply. History is collected even while other patterns are selected, so
switching or crossfading into it shows recent audio immediately.

To add a pattern, add an entry to `public/patterns.js` with a GLSL function
`vec3 render()`. The shared prelude provides `u_time`, `u_bass`, `u_mid`,
`u_treble`, `u_level`, `u_beat`, `spec(x)`, `wave(x)`, `pal(t)`, `noise`,
`fbm`, `centered()`, and `uv01()`. `history(x, age)` samples the spectrum history
at normalized frequency `x` and age `age` (0 = newest, 1 = oldest).

## Notes

- **Bandwidth:** 256×192 at 30 fps is about 3,100 packets/s (4.4 MB/s). If
  the receiver drops frames, lower **Frame rate**, or set the receiver's
  **Most frames a second sent**.
- **Switching tabs keeps streaming.** A Web Worker drives rendering rather
  than the visibility-dependent animation-frame API. Keep the page open and
  the computer awake: browser tab freezing/discarding or system sleep can
  still interrupt streaming.
- **Stopping** sends one black frame unless that option is unchecked.
  Otherwise `matrix-dmx` keeps showing the last frame, and WLED shows it
  until its realtime timeout passes and it goes back to its own effect.
- **Gamma** above 1.0 darkens mid-tones, which often looks better on LED
  panels. Brightness is applied before sending.

## Test

```sh
npm test
```

`npm run check-sparkles` draws the sparkles' shader in headless Chrome and
compares every pixel with its JavaScript reference.

The tests cover Aurora algorithms and FastLED primitives, spectrum history,
the background frame clock, DDP packet layout and reassembly, UDP delivery,
and the server's browser-to-DDP relay.
