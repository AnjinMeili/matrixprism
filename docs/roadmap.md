# Roadmap

What MatrixPrism does today, what has and has not been checked, and what is
planned. The design of the composer is in [composer-spec.md](composer-spec.md);
the measurements behind it are in [findings.md](findings.md).

## What works today

**Receiver** (`receiver/`, C++ on a Raspberry Pi):

- Displays Art-Net, sACN (E1.31) and DDP on an RGB LED matrix, and answers
  Art-Net scans and WLED discovery, so apps such as LedFx find it and stream
  to it as if it were a WLED node.
- Records what it displays, with timing, and plays recordings and scenes
  back without a sender; `scene-tool` inspects, trims, recovers and
  sequences recordings on any machine.

**Composer** (`composer/`, a browser page and a Node server):

- 142 patterns: audio-reactive shaders, Spectrum Lab, the Beat Graph, Fire,
  the Panel Range test card, a Media Player for images, GIFs and video, and
  ports of the Aurora, Fibonacci128, AuroraDrop and Table Mark Estes sets.
- A quad mixer: inputs A and B mix to Left, C and D to Right, and the main
  mixes Left and Right, with crossfades and blends, per-input shapes,
  regions with hard or soft borders, hue, brightness and gamma trims, Swap,
  Fade and blackout.
- Audio analysis of a live input: stereo spectra, bands, level, high-band
  hits, musical key, section changes, and tempo from a choice of beat
  sources (bass jumps, spectral flux, or Essentia.js with a hold and a flux
  veto). Tap tempo, nudging the beat graph and marking downbeats.
- Movement tied to the tempo, and changes that wait for a beat, a bar, a
  phrase or a change in the music.
- Sparkles over the final picture on the high-band hits.
- A Monitor view with the beat graph and a live Camelot key wheel.
- Playlists of saved looks, Hotsave, a randomizer with its own timers for
  each input, clock, date and text overlays.
- Streaming DDP to WLED, to `matrix-dmx` or to any other DDP receiver;
  settings kept for each receiver, and a list of receivers found by mDNS.
- Recording the final preview with the live audio to an MP4 (Chrome and
  FFmpeg).
- Go live: the preview and the live audio sent to YouTube, enlarged to a
  chosen size, from the Record bar; and `composer/tools/stream-out.mjs`,
  which does the same for a recording under way, to an MP4 or a stream.
- Video gamma: recordings and the live stream lift the panel's dark levels
  so that on a screen they look as the panel does (2.2 by default; 1 keeps the
  panel's levels). Checked through Record in headless Chrome; not yet seen on
  YouTube or in Safari.

## How it is checked

- `npm test` in `composer/` (350 tests) and `make -C receiver test`.
- Checks in headless Chrome for the shaders, the test card, sparkles, the
  quad mixer's rendering, layout and view, the Monitor, Hotsave, receivers,
  the Essentia beat source and recording (see [AGENTS.md](../AGENTS.md),
  "Verifying").
- Measurements that are run again after a change and compared (see
  [findings.md](findings.md)).

## Not yet checked

- Safari since the quad mixer (it lacks `ImageDecoder` and the folder
  picker); the composer is used in Chrome.
- The compositor's soft borders and spin reversal by eye on a panel.
- Section-change detection on real music; its 30% threshold is untuned.
- The AuroraDrop and Mark Estes ports side by side with the originals on
  hardware.
- Stereo capture with a real stereo input.
- Recording over a 30-minute session: sync drift, memory and CPU.
- Go live over a long run (delay, sync by ear, CPU); it has been tried once
  on a private YouTube stream and against a local receiver with a test signal.
  `stream-out` has only had the test signal.
- The receiver's latest changes on the Pi: the recording writer thread,
  address refresh and `scene-tool recover`.

## Next

1. **The quad mixer, steps 6 to 8**: the main's fade to the pair off air,
   playlists and Hotsave on four inputs, the Media Player's start position,
   and documentation.
2. **Mids and vocals** for the audio layers: texture from the mids, then
   vocals once there is a labelled set to measure against
   ([audio-layers-plan.md](audio-layers-plan.md)).
3. **Choosing the default beat source**: Essentia with the hold and veto
   measured best on dance music and a live mix; bass jumps is still the
   default.
4. **More AuroraDrop**: 15 audio patterns with an MIT notice remain, most
   needing AuroraDrop's half and quarter-size canvases, then its Plasma,
   Simplex Noise, Electric Mandala and Life effects.
5. **The rest of Table Mark Estes**: 105 pattern numbers.
6. **Tempo into the ported patterns**: AuroraDrop's beat oscillators and the
   Aurora ports could run off the detected tempo.
7. **Open review items**: a saved value that can stop the page loading with
   no message; three documentation corrections; the recording format's
   per-frame timestamp scan (needs a timestamp index); tests for the WebGL
   renderer and `app.js`.

8. **Patterns that use the spectral features and loudness**: `u_centroid`,
   `u_flatness`, `u_rolloff`, `u_zcr` and `u_loudness` reach every shader
   pattern (scales set from 120 dance tracks, see "Audio features" in the
   [findings](findings.md)) but no pattern reads them yet. Brightness from
   loudness or centroid and texture from flatness are the usual mappings.
9. **Spectrum by frequency**: every pattern can read the spectrum by
   frequency (`rawSpec` in shaders, `state.spectrumInput` in JavaScript), and
   Spectrum Flock shows it in four modes (flock, springs, gather, cymatics);
   sparkles can land across the panel by pitch, though the detector finds
   hits in the high band only. More patterns that give frequencies to their
   parts are open.
10. **Downbeats**: bars are counted from where the tracker started, not from
   the music, so a change that waits for a bar waits for the composer's bar.
   No beat source here finds the downbeat. A pad on a MIDI device can now mark
   it (Monitor view, Chrome and Edge only; the D key and button did already).
   An outside clock from DJ software would keep it in step without presses
   (some, such as djay Pro by forum reports, sync by Ableton Link only, which
   needs a native helper); the
   research route is a measured trial of the small Beat This! ONNX model.
11. **Packaging**: a download-and-double-click executable per platform, a
    container for always-on Linux hosts, and a release-only GitHub Actions
    workflow with signing and attestations: [packaging-plan.md](packaging-plan.md).
    Nothing is built; several decisions are open. Recording and live
    streaming from the app on all three systems:
    [capture-streaming-plan.md](capture-streaming-plan.md).

Decisions on audio analysis (2026-10-24):

- **Essentia stays opt-in.** It earns its place on tempo, but it is 2.8 MB
  of AGPL-3.0 code with no release since 2021 and a 10-second start, and the
  measured in-house flux source is within two points of it live. The public
  default stays the in-house path.
- **Not worth doing now:** chroma and MFCC (the key detector works on its
  own profile match, and MFCCs feed classifiers rather than visuals), and any
  Python-side analysis service, which would bring back an install step the
  packaging work is removing.

## Plans for later

- **A pattern library and editor**, and **a cleaner UI** first:
  [pattern-editor-plan.md](pattern-editor-plan.md).
- **Several receivers as windows onto one canvas**, each panel showing its
  own rectangle at its own size: [multi-panel-plan.md](multi-panel-plan.md).
- **Effects that follow the picture**: sparkles along curves, texture that
  strikes a shape ([audio-layers-plan.md](audio-layers-plan.md)).
- **Outside control**: tempo, beat and phase from DJ software over Ableton
  Link as a beat source; a MIDI controller such as an Akai APC40 mk2 over
  Web MIDI (faders on the main and inputs, the clip grid choosing patterns,
  MIDI learn); keys from DJ software's playlist exports as a reference for
  the key detector.
- **Stage lasers over ILDA**: the picture's key parts traced into paths, or
  vector patterns and ILDA files tinted and timed by the key and beat, sent
  to network laser DACs (Ether Dream, Helios over IDN). Each laser's limits
  (points a second, largest step, scan area) kept with it and applied in a
  last stage before its DAC; blackout and an interlock stop the output.
- **A beat clock that tunes itself** by watching the beat graph: when tempo
  and phase are right, each bar lines up with the one before it.
- **An ESP32-S3 HUB75 driver board** as a receiver in hardware. Its design,
  schematic and layout are being worked on separately and are not in this
  repository yet.
