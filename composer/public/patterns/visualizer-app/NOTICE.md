# Visualizer App patterns: provenance and licence

The JavaScript and GLSL in this directory are a port of the visualisations
in **visualizer-app**, Spotify's 2013 demo of the Audio API in its desktop
client:

| Repository | Revision read |
|------------|---------------|
| <https://github.com/AnjinMeili/visualizer-app>, a fork of `luastoned/visualizer-app`, itself a fork of `spotify/visualizer-app` (emptied and archived by Spotify in 2015) | `b0e9b8e56c57` (2014-08-05) |

Authors: Bastian Kuberek (the app, Wave - Simple, Bars 1, Bars 2, Globe
Normals, Boids Test) and Per-Olov Jernberg, possan (Wave - Interpolated,
Raymarching, Simple beat detection and its helper).

## Licence

The repository's `LICENSE`, present since its first commit and covering every
file without a notice of its own, is the BSD 3-Clause licence:

```
Copyright (c) 2013, Spotify AB
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
* Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
* Neither the name of Spotify AB nor the names of its contributors may
be used to endorse or promote products derived from this software
without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL SPOTIFY AB BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

The files here stay under it, within the GPL-3.0 composer. Per its third
clause, Spotify's name is not used in the picker or to promote the patterns.
The raymarching fragment shader is also marked "public domain" by its author.

**Left out:**

- **Ported, tried by Anjin and removed**: Wave - Simple (`waveform.js`),
  Bars 1 (`multiband.js`), Globe Normals (`globe.js`), Wave - Interpolated
  (`waveform-interp.js`) and Simple beat detection (`beatdetection.js`). Their
  ports, with notes on how each differed, are in the history at `d70f2dd`.
- **Never ported**: Boids Test (`visualizations/boids/`). Its `boid.js` and
  `vector2d.js` say they are "borrowed from https://github.com/glesica/canvas-boids",
  which has no licence, and `simple.js` follows that repository's `swarm.js`;
  Spotify's licence cannot cover them. The composer has Aurora Flock instead.
- The vendored libraries (three.js r47, Raphaël, Pre3d, DSP.js,
  `pocket.api.js`) are not used.

## What is ported

| Pattern id | Original | Drawn as |
|------------|----------|----------|
| `visualizer-app-multiband2` | Bars 2 - Simple canvas, `multiband2.js` | Canvas |
| `visualizer-app-raymarching` | WebGL Raymarching example, `raymarching.js` and the shader in `index.html` | Shader, with its clocks and colours stepped in JavaScript |

`runtime.js` holds the band feed, `colorize` from `js/visualizer.js`, the
canvas and the frame loop; `beatdetection-helper.js` the original's beat
helper, used by Raymarching.

## Audio

The originals received Spotify's `RealtimeAnalyzer` events with
`audio.BAND31`: for each channel, 31 band levels in decibels and a waveform.

| Original | Fed here from |
|----------|---------------|
| `spectrum.left[i]`, `spectrum.right[i]`, band `i` of BAND31 | `state.spectrumLeft`, `spectrumRight`: the loudest of the composer's log-spaced bins (30 Hz to 16 kHz) within a third of an octave of the band's centre, read as `-96 + 96 × byte / 255` dB |
| BAND31's centres | Assumed to be the standard third-octave series, 20 Hz to 20 kHz; Spotify's documentation is gone. The 20 and 25 Hz bands read the 30 Hz bin, the 20 kHz band the 16 kHz bin |
| The raymarcher's waveform texture, from `wave.left` and `wave.right` | The composer's waveform texture (`u_wave`), mono |
| The audio event | Each composer frame |
| `requestAnimationFrame` | Steps of 1/60 s on `state.auroraTime` (Speed applies), giving up after 100 ms of catching up |

The decibel scale is a choice: the originals' constants imply readings from
about -96 to 0 dB (Bars 2 grows from -96, the beat helper's thresholds sit
near the top), so the composer's byte 255 is 0 dB. It decides how often the
original's beat detector fires.

In silence Bars 2 shows its outlines along the centre line, and the
raymarcher cruises on.

## Differences from the original

- **Bars 2**: the original filled a browser window. Its fixed pixel sizes
  (the outlines' offsets, the 50-pixel margin) are scaled by the panel's
  height against a 600-pixel window. Its canvas was the window less 20
  pixels; here it is the panel.
- **Raymarching**: the camera rotation, computed in global initialisers from
  the `time` uniform, which GLSL ES 1.00 does not allow, is moved into the
  shader's body. The mouse is held at rest. Dead code is not ported: `bump()`,
  the cylinders (overwritten by the boxes), `#define N`. The 64 by 4
  waveform texture is read from the composer's waveform texture with the
  original's index arithmetic, `floor(i × 64 / length)`, which with 256
  samples uses only the first 16; linear filtering is kept, mipmapping is
  not. The camera's turns and its place along the lattice (`time * 3`, kept
  within the lattice's period of 10) are worked out in JavaScript in double
  precision, so a long flight does not lose precision in the shader; the
  waveform's spheres are sampled along that wrapped place.
  **Motion** (not in the original) defaults to **Flow**: a low hit adds a
  surge of speed (**Surge**, 1.5 times the cruising speed by default) that
  halves in about a third of a second, in place of the jump of 5 to 35
  seconds and the 60-second wrap; the colours close 4% of the way to their
  targets each frame instead of 50% and 10%, and a colour still turning
  ignores hits. The beams' pulse on a hit is kept. **Jump** is the original.
  **Hits from** chooses between the original's detector (the default)
  and the composer's analysis: the beat drives the flight, a new bar turns the
  first colour, a high-band hit the second.

## Added here

**Julia Flow** (`julia.js`, `visualizer-app-julia`) is not from
visualizer-app: it was created by Claude (Anthropic), through Claude Code, for
MatrixPrism at Anjin's request (GPL-3.0-or-later), and sits in
this group beside Raymarching, whose Flow motion it shares. Its constant
travels the edge of the Mandelbrot set's main cardioid; a beat surges it on,
the bass pushes it outward. Its settings: Zoom, Spin, Detail, Colour shift,
Colour speed, Colour bands, Segments and Surge. The smooth colouring is the renormalised
iteration count, after Linas Vepstas (1997).
