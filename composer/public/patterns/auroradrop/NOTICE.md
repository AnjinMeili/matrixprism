# AuroraDrop patterns: provenance and licence

The JavaScript in this directory is a port of patterns and processing effects
from **AuroraDrop** and its fork **AuroraDrop-LXP**:

| Project | Repository | Revision read |
|---------|------------|---------------|
| AuroraDrop (uklooney) | <https://github.com/fivefishstudios/AuroraDrop> | `17af50346807de3c4764025f5a065df88607c27e` |
| AuroraDrop-LXP (troyhacks) | <https://github.com/troyhacks/AuroraDrop-LXP> | `ae59208fb04c1ad8e3d9547470cae3c1e330b490` |

Both are based on Aurora by Jason Coon (<https://github.com/pixelmatix/aurora>).

## Licence

Neither repository has a licence file, and GitHub reports no licence for
either. Licensing is therefore decided file by file:

- **Files that carry the Aurora MIT notice** ("Copyright (c) 2014 Jason
  Coon", followed by the MIT permission text) are ported here under that
  notice. This covers most pattern files, `Effects.h` and the Aurora support
  classes. AuroraDrop's authors kept the same notice on the pattern files
  they added.
- **Files with no notice** are not ported. Without one their authors keep all
  rights by default.

The MIT text those files carry:

```
Aurora: https://github.com/pixelmatix/aurora
Copyright (c) 2014 Jason Coon

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### Files left out because they carry no licence notice

| File | What it is |
|------|------------|
| `PatternAudio_E_ClassicSpectrum128.h` | Classic 128-bar spectrum |
| `PatternAudio_Z_SpectrumCircle.h` | Spectrum round a circle |
| `PatternEffect_X_Munch.h` | Munch effect |
| `PatternStatic_L_LianLi120.h` | Fan-ring layout |
| `PatternStatic_X_Atom.h` | Atom animation |
| `PatternStatic_X_SpiralingCurves.h` | Spiralling curves |
| `PatternStatic_X_Swirl.h` | Swirl |
| `PatternEffect_K_BlurMove.h` (LXP) | Blur and move effect |
| `PatternEffect_T_TVStatic.h` (LXP) | TV static effect |
| `FFTData.h`, `FftMic.h`, `audio_reactive.h` | Audio capture and FFT |

The audio capture files are not needed: the port takes its audio from the
composer's own analyser (see below), and `runtime.js` only reproduces the
names and shapes of the data the patterns read.

## What is ported

Review status of the two repositories' pattern files, 2026-10-12:

| Kind | In the sources | Ported | Notes |
|------|----------------|--------|-------|
| Processing effects | 10, plus 2 added by LXP with a notice | 4 | 2D Blurring, Spiral Streaming, Directional Stream, Directional Move: the four AuroraDrop has enabled |
| Audio patterns | 19, plus 4 added by LXP | 8 | Spectrum 2, Lines, Triangles, Diagonal Spectrum, Rotating Wave, Dots Single, Spectrum Peak Bars, Wave Single |
| Static patterns | 11 | 0 | Seven are Aurora patterns this project already has natively (Attract, Bounce, Flock, Flow Field, and others); Worms, Spiral Lines and Simple Stars are still to do |

`runtime.js` holds the shared canvas and its helpers (AuroraDrop's `Effects`
class), the audio data, and the frame pipeline. `effects.js` and
`audio-patterns.js` hold the ported classes. `index.js` defines the picker
entries.

## How it differs from AuroraDrop

- **Canvas size.** AuroraDrop's patterns are written for a 64 by 64 matrix:
  they use audio levels directly as coordinates and hard-code centres and
  radii. The port draws on a 64 by 64 canvas and scales the finished frame to
  the panel with bilinear filtering, so on a non-square panel the picture is
  stretched.
- **Audio.** AuroraDrop reads 128 spectrum bins from its Windows companion
  program (or, in LXP, a microphone). The port fills the same 128 bins from
  the composer's logarithmic spectrum, taking the loudest of each pair of
  its 256 bins, and derives the 64, 32, 16 and 8-bin views by averaging.
  AuroraDrop's own 8 and 16-bin views are built from groups that do not
  divide 128 evenly and overrun their arrays; the port uses even groups.
- **Pipeline.** One processing effect and one or two audio patterns share the
  canvas, and each is restarted with new random parameters every ten seconds,
  as in AuroraDrop. AuroraDrop's static-pattern and final-effect stages are
  not ported yet.
- **Palettes.** Rainbow, Ocean, Cloud, Forest, Party, Heat and Lava are
  FastLED's. Yellow-Blue and Ice are simple ramps standing in for
  AuroraDrop's own.
- **Unreachable options.** Several of AuroraDrop's random ranges allow only
  one value (for example the stream direction). The port keeps those ranges,
  so it behaves the same, and does not implement the branches that can never
  run.
- **Levels as coordinates.** Lines and Triangles use a third of an audio
  level as a pixel position, and Triangles then keeps only the top-left
  quarter for its kaleidoscope. Levels above about 96 of 255 put the shapes
  outside that quarter, so very loud input, or a high Reactivity setting,
  can leave Triangles empty. This is how AuroraDrop behaves; it is not
  compensated for.
- **Frame rate.** The pipeline steps 60 times per simulated second; the
  composer's Speed slider scales it.
