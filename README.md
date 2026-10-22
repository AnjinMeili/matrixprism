# MatrixPrism

A real-time composer of music-driven generative visuals for LED panels.

MatrixPrism follows the beat, tempo, key, spectrum and section changes of
live audio in a browser, renders patterns from them, and streams the result
as standard DDP to a Raspberry Pi that drives an RGB LED matrix.

```
audio input ─► browser page ──WebSocket──► Node server ──UDP (DDP)──► matrix-dmx on the Pi ─► LED matrix
               (analyse, render)           (split into packets)       (display, record, play back)
```

It has two parts, each in its own directory:

| Part | Directory | What it is |
|------|-----------|------------|
| **Composer** | [`composer/`](composer) | A local app for a Mac or PC. A browser page analyses audio and renders the patterns; a small Node server sends each frame to the matrix as DDP. See [composer/README.md](composer/README.md) |
| **Receiver** | [`receiver/`](receiver) | `matrix-dmx`, which runs on the Pi and displays Art-Net, sACN and DDP pixel data from any sender on the matrix, and records and plays back what it displays; and `scene-tool`, which edits those recordings. See [receiver/README.md](receiver/README.md) |

## Quick start

On the Raspberry Pi:

```sh
git clone --recursive https://github.com/AnjinMeili/matrixprism.git
cd matrixprism/receiver
make
sudo ./matrix-dmx
```

On the Mac or PC:

```sh
cd matrixprism/composer
npm install
npm start -- --pi <matrix host>
```

Then open <http://localhost:8080/>. The READMEs of the two parts have the
options and the details.

## What the composer does

- 142 patterns: audio-reactive shaders, a configurable spectrum analyser, a
  beat graph after BpmDj, a media player for images, GIFs and video, and ports of the Aurora,
  Fibonacci128, Table Mark Estes and AuroraDrop pattern sets;
- a two-layer mixer with crossfades and combine blends, and per-layer shapes
  and regions with hard or soft borders;
- audio analysis with stereo spectra, beat and BPM detection, musical key,
  and detection of section changes in the music;
- movement tied to the tempo, and pattern changes that can wait for a beat,
  a bar, a phrase or a change in the music;
- playlists of saved looks, a randomizer, and clock, date and text overlays.

## What the receiver does

- Listens for Art-Net, sACN (E1.31) and DDP, and answers Art-Net scans and
  WLED-style discovery, so existing senders find it;
- records the frames it displays, with their timing, and plays recordings
  and scenes back without a sender;
- `scene-tool` inspects, trims, recovers and sequences recordings on any
  machine, without matrix hardware.

## Project documents

| Document | Contents |
|----------|----------|
| [composer/README.md](composer/README.md) | Using the composer |
| [receiver/README.md](receiver/README.md) | Building and running the receiver, recording, playback, the scene tool and the file formats |
| [docs/composer-spec.md](docs/composer-spec.md) | How the composer is built: pipeline, pattern interface, modules, saved settings, tempo model |
| [docs/roadmap.md](docs/roadmap.md) | What works, what has and has not been checked, and what is planned |
| [docs/findings.md](docs/findings.md) | What has been measured: colour, audio analysis, tempo, cost, recording, the panel |
| `docs/*-plan.md` | Plans for the audio layers, audio features, a pattern editor, several panels and recording |
| [CREDITS.md](CREDITS.md) | Every source this project builds on: upstream projects, ported code, libraries, algorithms and data, with their licences |
| `composer/public/patterns/*/NOTICE.md` | Provenance and licence position of the ported pattern sets |
| [AGENTS.md](AGENTS.md) | Instructions for AI coding agents: which skills to load, how to verify, and the working rules. `CLAUDE.md` imports it |
| [.claude/skills/port-pattern-batch/](.claude/skills/port-pattern-batch/SKILL.md) | A project skill: how a batch of patterns is ported from an upstream project, with helper scripts |

## Licence and credits

MatrixPrism is free software under the GNU General Public License, version
3 or later; see [COPYING](COPYING). Some parts carry their own licences: the
Aurora and AuroraDrop ports and FastLED's primitives are MIT, Essentia.js is
AGPL-3.0, and the Table Mark Estes port has no licence from its authors and
is not covered by the GPL. [CREDITS.md](CREDITS.md) lists each source, its
authors and its licence.

## Contact

Anjin, <anjin@skyhighatry.com>. Bugs and ideas are welcome as GitHub issues;
an author who wants their work credited differently or taken out can write
by email.

## History

The project began as a receiver grown from Henner Zeller's
[rpi-matrix-pixelpusher](https://github.com/hzeller/rpi-matrix-pixelpusher),
and drives the matrix with the same author's
[rpi-rgb-led-matrix](https://github.com/hzeller/rpi-rgb-led-matrix) library.
It was later known as `rpi-matrix-artnet` and `matrix-music-visualizer`, and
was renamed MatrixPrism in October 2026, when the browser app became the
composer. The programs keep their names: `matrix-dmx` and `scene-tool`.
