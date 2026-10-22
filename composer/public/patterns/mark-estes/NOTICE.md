# Table Mark Estes patterns: provenance and licence status

The JavaScript in this directory is a port of patterns from the Arduino
sketch **Table_Mark_Estes69** by Mark Estes, as maintained by Marc Merlin:

- Repository: <https://github.com/marcmerlin/FastLED_NeoMatrix_SmartMatrix_LEDMatrix_GFX_Demos>
- Path: `LEDMatrix/Table_Mark_Estes69`
- Revision ported from: `c653f9fc8241932d8efed671e26252f72b892a03` (2026-08-29)
- Files read: `Table_Mark_Estes69.ino`, `Table_Mark_Estes_Impl.h`,
  `Table_Mark_Estes_config.h`

The mirror and shift routines in `runtime.js` follow the behaviour of the
LEDMatrix library by Aaron Liddiment (Marc Merlin's fork,
<https://github.com/marcmerlin/LEDMatrix>). Colour conversion follows
FastLED's `hsv2rgb_rainbow` (FastLED is MIT licensed).

## Licence status: none stated upstream

**Neither upstream repository states a licence.** When this port was made
(2026-10-11) GitHub reported no licence for either repository, and the
Table_Mark_Estes69 sources contain no licence or copyright text. Without a
licence, the authors keep all rights by default, and a port is a derivative
work.

The port was first kept on a local branch for that reason. On 2026-10-12 
Anjin decided to merge it, and later to publish it with the rest of
the project, crediting the authors here and in `CREDITS.md`. No licence or
permission from Mark Estes or Marc Merlin is recorded here, so:

- this directory is **not** covered by the project's GPL-3.0 licence, and
  nothing in this repository grants rights to it;
- anyone reusing it should ask the original authors first;
- it should be removed if either author asks.

When terms are obtained, replace this section with them and add the licence
text under `composer/public/licenses/`, as for the other ports.

## What is ported

`index.js` lists the ported patterns by the sketch's own pattern numbers; the
sketch has 199 in total. Ninety-four are ported. Fifty-seven generative
patterns come from the lists in Marc Merlin's configuration:

- Marc Merlin's best new picks: 14, 23, 26, 69, 82, 87, 103, 110, 111, 115, 124, 134,
  146, 150, 155, 162, 187 and 190.
- "Good in original": 4, 10, 11, 25, 60, 62, 67, 70, 77, 80, 104 and 105.
  Pattern 52 from that list is audio-driven and is not ported.
- "Good but not picked": 17, 19, 53, 55, 58, 59, 66, 72, 75, 79, 81, 88, 96, 101, 102,
  107, 108, 112, 113, 114, 118, 119, 120, 128, 131, 147 and 158. The other 20
  on that list need functions that are not ported yet.

Thirty-seven of the sketch's 38 audio-driven patterns are ported: 22, 27, 28,
29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
49, 50, 51, 52, 129, 130, 137, 138, 153, 154, 157, 159, 165, 166 and 184.
Their effects are in `audio-effects.js`. The last one, 48, also needs the
generative `spin1` and `fireworks`, which are not ported yet.

`decorations.js` holds the sketch's `checkfancy()` overlays (rings, boxes,
stars, triangles, confetti and the wind burst), which any pattern may show
when its random `fancy` value selects one.

## How audio is mapped

The sketch received its audio from a second microcontroller: 17 frequency
bands per stereo channel, a peak level per channel and a beat flag, which it
spread over 64 bins per channel (`LLaudio` and `RRaudio`, values 0 to 63).

The port takes the composer's own analysis instead
(`TmeRuntime.setAudio`):

| Sketch input | Port |
|--------------|------|
| `LLaudio[0..63]` | The composer's 256-bin logarithmic spectrum of the left channel (30 Hz to 16 kHz, after the Reactivity gain), taking the loudest of each group of four bins and scaling to 0..63 |
| `RRaudio[0..63]` | The same for the right channel. With a mono input both are the same |
| `music.laudio[0..16]` / `raudio[0..16]` (coarse bands, read by the board patterns and the audio fireball) | The loudest of each four neighbouring bins of the same channel |
| `music.peakL` / `peakR` | The composer's overall level, or the loudest bin if that is higher |
| `music.target` (beat) | The composer's beat detector, latched for one simulation step |
| "No music" stand-in (`fakenoise`) | Ported as is: every band bobs at its own rate. Used when nothing has been heard for five simulated seconds, including when the audio input is set to None. The composer's Setup view can turn it off, in which case the patterns show the silence |

Differences in how the audio patterns use it:

- **Bars and spokes span the panel at any size.** The sketch draws 64 bins
  times a whole-number scale, which leaves part of the panel empty unless the
  width is a multiple of 64, and draws nothing on panels narrower than 64.
  The port maps each column, row or spoke to its bin, and spreads hues over
  the full width in the same way.
- **Audio Arcs (165, 166, 184) are rescaled.** The sketch lays its rings out
  for a 64-pixel panel and reads only the lowest quarter of the spectrum.
  The port spaces the rings in proportion to the panel, fills the arcs so
  they stay solid at larger radii, and gives each ring one of the 16 coarse
  bands so the rings cover the whole spectrum.
- **Orbiting hubs (41, 46).** The sketch repaints the hubs before every
  spoke; the port draws all spokes, then the hubs, then the last spoke again,
  which leaves the same picture.
- **Audio Chess (51) fits the panel.** The sketch sizes its 4 by 4 board
  from the longer side, which pushes a row off a non-square panel.
- **Audio is used whenever it is present.** The sketch ignores the music on
  runs where one of its random flags is clear; the port does not.
- **Quiet passages do not change the pattern.** The sketch moves on to the
  next pattern after a long silence; here the composer chooses patterns.

## Known differences from the sketch

- **Starz III (79).** The sketch draws the same star `howmany` times over
  itself each frame; the port draws it once.
- **Out-of-range circle radii are skipped.** Where the sketch passes a
  negative radius (which wraps to a huge unsigned value and plots four stray
  points), the port draws nothing.
- **Frame rate.** Each pattern steps at the sketch's own target rate (2 to 14
  frames per second unless the pattern sets its own), on simulated time. The
  composer's Speed slider scales it.
- **Fire (150).** The sketch computes cooling through an 8-bit `abs`, which
  leaves a seam on panels taller than 128 rows and is patched by copying one
  row. The port computes cooling directly and needs no patch.
- **`beatsin16`** is approximated with a floating-point sine.
- **Gradient palettes** are sampled at 16 evenly spaced points rather than
  through FastLED's gradient loader.
- **Drops (69).** The sketch's column re-roll loop is bounded to 100 tries.
- Pattern changes are driven by the composer. After a pattern's dwell time
  (99 to 168 simulated seconds) its parameters are re-rolled, as the sketch's
  `regenpattern()` does.
