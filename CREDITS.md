# Credits and third-party sources

MatrixPrism is built on other people's work. This file lists every source
of code, data, algorithms and ideas used in this repository, its author,
its licence and where it is used. The licence texts are kept beside the
code they cover; the paths are given below.

MatrixPrism's own code is copyright © 2026 Anjin (<anjin@skyhighatry.com>) and is licensed
under the GNU General Public License, version 3 or later ([COPYING](COPYING)),
except where this file says otherwise.

## Why GPL-3.0-or-later

It is the licence that works with everything included here:

| Part | Its licence | How it fits |
|------|-------------|-------------|
| The receiver, grown from rpi-matrix-pixelpusher | GPL-3.0-or-later | The project's own licence has to be GPL-3.0 or later to carry it |
| rpi-rgb-led-matrix (submodule) | GPL-2.0-or-later | Usable under version 3, so `matrix-dmx` as linked is GPL-3.0-or-later |
| The Fibonacci128 adaptations | GPL-3.0 | The composer as combined with them is distributed under GPL-3.0 |
| Aurora, FastLED, AuroraDrop, Meyda, ws | MIT | Permissive: included in a GPL work, keeping their notices |
| Pendulum Wave's source | CC0 1.0 | Public domain dedication |
| Essentia.js | AGPL-3.0 | GPL-3.0 §13 allows combining with AGPL-3.0 code; that part keeps its own terms, including offering the source to users of a served copy |
| Table Mark Estes | Apache-2.0 | Permissive, and compatible with GPL-3.0 one way: Apache-2.0 code may be included in a GPL-3.0 work, keeping its licence and notices. The directory stays Apache-2.0 |

## Where the project began

| Source | Author | Licence | Used for |
|--------|--------|---------|----------|
| [rpi-matrix-pixelpusher](https://github.com/hzeller/rpi-matrix-pixelpusher) | Henner Zeller | GPL-3.0 | The receiver began as this PixelPusher server. `receiver/matrix-dmx.cc` still carries its copyright line (© 2013 Henner Zeller), and its history is kept in the private development repository |
| [rpi-rgb-led-matrix](https://github.com/hzeller/rpi-rgb-led-matrix) | Henner Zeller and contributors | GPL-2.0-or-later | The library that drives the LED matrix from the Pi's GPIO. Included as a git submodule at `receiver/matrix`, not copied into this repository |

## Ported pattern code

Each port keeps the original function names, and its directory or licence
file records the exact upstream revision that was read.

| Source | Authors | Licence | Where it is used |
|--------|---------|---------|------------------|
| [Aurora](https://github.com/pixelmatix/aurora), as ported to FastLED::NeoMatrix in [FastLED_NeoMatrix_SmartMatrix_LEDMatrix_GFX_Demos](https://github.com/marcmerlin/FastLED_NeoMatrix_SmartMatrix_LEDMatrix_GFX_Demos) at `a98cb3e` | Jason Coon, Stefan Petrick, Daniel Shiffman, Noel Bundy, Windell H. Oskay; ported by Marc Merlin | MIT | `composer/public/aurora-patterns.js`, `aurora-fastled.js`; notice in `composer/public/licenses/aurora.txt` |
| Pendulum Wave, in Aurora | Based on a Prismata loading animation by Lunarch Studios | CC0 1.0 | Within the Aurora port; the dedication is quoted in `licenses/aurora.txt` |
| [FastLED](https://github.com/FastLED/FastLED) 3.5.0 primitives (`sin8`, `beatsin8`, `inoise8`, `hsv2rgb_rainbow`, palettes, fades) | The FastLED project (Daniel Garcia, Mark Kriegsman and contributors) | MIT | Translated to JavaScript in `composer/public/aurora-fastled.js`, and used by the Mark Estes port's colour conversion |
| [fibonacci128-touch-demo](https://github.com/jasoncoon/fibonacci128-touch-demo), through the fork [fibonacci128-touch-aurora](https://github.com/AnjinMeili/fibonacci128-touch-aurora) at `5f8dd39` | Jason Coon and Fibonacci128 contributors; Radial Fire after Intrinsically-Sublime's [esp8266-fastled-webserver](https://github.com/Intrinsically-Sublime/esp8266-fastled-webserver), adapted by Marc Merlin | GPL-3.0 | `composer/public/fibonacci-patterns.js`; details in `composer/public/licenses/fibonacci.txt` |
| [ColorWavesWithPalettes](https://gist.github.com/kriegsman/8281905786e8b2632aeb): 33 gradient palettes from the [cpt-city](http://soliton.vm.bytemark.co.uk/pub/cpt-city/) archive | Mark Kriegsman; each palette's original author is named in its source comment | As published with the gist and in cpt-city; the source comments are kept verbatim | `composer/public/gradient-palettes.js`; comments in `composer/public/licenses/gradient-palettes.txt` |
| [AuroraDrop](https://github.com/fivefishstudios/AuroraDrop) and its fork [AuroraDrop-LXP](https://github.com/troyhacks/AuroraDrop-LXP) | uklooney (fivefishstudios) and troyhacks, on Aurora by Jason Coon | No repository licence. Only files carrying Aurora's MIT notice are ported; files without a notice are left out and listed | `composer/public/patterns/auroradrop/`; see its [NOTICE.md](composer/public/patterns/auroradrop/NOTICE.md) |
| Table_Mark_Estes69, in [FastLED_NeoMatrix_SmartMatrix_LEDMatrix_GFX_Demos](https://github.com/marcmerlin/FastLED_NeoMatrix_SmartMatrix_LEDMatrix_GFX_Demos) at `c653f9f`, with mirror and shift routines after Aaron Liddiment's [LEDMatrix](https://github.com/marcmerlin/LEDMatrix) | Mark Estes; adapted and maintained by Marc Merlin | Apache-2.0: the `LICENSE` in upstream's `LEDMatrix/Table_Mark_Estes/`, the sketch's directory (the `…69` version carries none of its own); confirmed by Marc Merlin on 2026-10-23. Text and notice in `composer/public/licenses/table-mark-estes.txt` | `composer/public/patterns/mark-estes/`, every file tagged `SPDX-License-Identifier: Apache-2.0`; see its [NOTICE.md](composer/public/patterns/mark-estes/NOTICE.md) |

## Libraries included in this repository

| Library | Authors | Licence | Where, and what for |
|---------|---------|---------|---------------------|
| [Essentia.js](https://mtg.github.io/essentia.js/) 0.1.3 | Music Technology Group, Universitat Pompeu Fabra | AGPL-3.0 | `composer/public/vendor/essentia/`, unchanged from the npm package, with its `LICENSE` and a `NOTICE.md` giving checksums. Loaded only when **Beat from** is set to Essentia, and by the measuring tools. Under AGPL-3.0 §13 the source of a served copy must be offered to its users; this repository is that source |
| [Meyda](https://meyda.js.org/) 5.6.3 | Hugh A. Rawlinson, Nevo Segal, Jakub Fiala and contributors | MIT | `composer/tools/vendor/meyda/`, with its `LICENSE.md`. Used only by the audio comparison tools, never by the composer |
| [ws](https://github.com/websockets/ws) | Einar Otto Stangvik, Arnout Kazemier, Luigi Pinca and contributors | MIT | The composer server's WebSocket: 8.22.0, unchanged from the npm package, in `composer/lib/vendor/ws/` with its `LICENSE` and a `NOTICE.md` giving checksums |

## Algorithms and ideas written here from their published descriptions

These are not ported code. Each was written in this repository from a
published description, and is credited in the source file's header.

| Idea | From | Where |
|------|------|-------|
| The beat graph: music folded by the bar | Werner Van Belle's [BpmDj](https://bpmdj.yellowcouch.org/) | `composer/public/beat-graph.js`, `beat-fold.js` |
| Fire2012, a 1D flame simulation, and its 2D use on a matrix | Mark Kriegsman (FastLED's examples, MIT); WLED's "Fire 2012 2D" | `composer/public/fire.js` |
| Key profiles for key detection | Krumhansl and Kessler (1982) | `composer/public/key-detector.js` |
| The Camelot wheel notation for keys | Mixed In Key; "Camelot" is its trademark | The Camelot Wheel pattern, the Monitor's key wheel and key labels |
| Spectral flux onsets | The onset-detection literature (e.g. Bello et al., 2005; Dixon, 2006) | `composer/public/band-flux.js`, `flux-worklet.js` |

## Protocols and interoperability

The receiver and composer speak these protocols so that existing tools work
with them. No code from the projects named is included.

- **DDP** (Distributed Display Protocol), as specified by 3waylabs.
- **Art-Net**, by Artistic Licence; **sACN** (ANSI E1.31), by ESTA.
- **WLED**'s JSON API and mDNS discovery, by the
  [WLED project](https://github.com/Aircoookie/WLED), imitated so that apps
  such as [LedFx](https://github.com/LedFx/LedFx) can find and stream to the
  receiver. The composer uses the same API and DDP to find and stream to
  WLED devices themselves. WLED is a trademark of its project; MatrixPrism is not affiliated
  with it.

## Data used for measurement, not included

- **The Beatport EDM Key Dataset**: Ángel Faraldo, 2017,
  [doi:10.5281/zenodo.1101082](https://zenodo.org/records/1101082),
  CC BY-SA 4.0. Used by `npm run compare-tracks` to measure key and tempo
  detection. Its audio is never copied into this repository; download it
  yourself to run the comparison.

## How it was made

MatrixPrism was designed, directed and tested by Anjin, and much
of its code and documentation was written with AI coding agents (Anthropic's
Claude, through Claude Code). [AGENTS.md](AGENTS.md) is the guide those
agents work from.
