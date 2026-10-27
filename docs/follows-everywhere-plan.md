# Follows for every pattern (T71)

Follows (T70) lets a pattern's number setting move with the music. It can
only reach a pattern that has a number setting, and on 2026-10-27 only 22
of the 148 patterns had one: none of the 94 Table Mark Estes (TME) patterns,
none of the 9 AuroraDrop patterns, and 20 of the 42 others. This plan gives
the rest settings worth following, starting with TME.

## Why TME first, and how

The TME patterns are already variations. Each one is a `setup` that sets a
few of the runtime's shared values and a `run` that calls one or more
effect functions. Most of what makes one pattern differ from its neighbour
is in those shared values, rolled at random at the start of each run and
again after its dwell time:

| Value | What it does | Rolled |
|-------|--------------|--------|
| `targetfps` | Steps a second: the speed of everything | 2 to 13, or the pattern's own |
| `bfade` | The trail: fade to black by an amount, or a coloured fade | 1 to 8 |
| `velo` | Paleness: most effects use `255 - velo / k` as saturation | 0 to 255 |
| `hue` | Colour, and in many effects also the angle of rotation | drifts by one a step |
| `shifty`, `cangle`, `sangle` | How the drifting centre moves | 2 to 12, and a speed |
| `adjunct` | The mirror (`adjustme`): 13 kinds, most rolls none | 0 to 44 |
| `wind` | Shifts the whole picture each step: 15 kinds, most rolls none | 0 to 59 |
| `fancy` | A decoration over the top (`checkfancy`): rings, stars, confetti | 0 to 99 |
| `flop[0..12]` | Coin flips each effect reads its own way | each 50% |

So the work comes in two stages.

### Stage 1: shared settings on every TME pattern

Every TME pattern gets the same settings, built on the shared values. The
number settings change the rolled value rather than replace it. At their
defaults, every pattern draws exactly as it does today, randomness and
re-rolls included, and Follows moves each one around its resting point.

| Setting | Kind | Default | Acts on | Reaches (of 94) |
|---------|------|---------|---------|-----------------|
| Speed | number, ×0.25 to ×4 | ×1 | `targetfps` | all |
| Fade | number, 0 to 3 | 1 | the fade amount in `checkfader` (0: no fading, 2: twice as fast) | 90 |
| Paleness | number, -255 to 255 | 0 | added to the rolled `velo`, held in 0 to 255 | 72 |
| Colour shift | number, 0 to 255 | 0 | added to the colour only, not to the angles | 93 |
| Drift | number, 0 to 4 | 1 | how fast the centre wanders; 0 holds it still | 43 |
| Mirror | choice | Random | Random, None, or one of nine mirrors | all |
| Wind | choice | Random | Random, None, or one of 15 shifts | all |
| Decoration | choice | Random | Random, None, or one of 15 decorations | all |
| Fade colour | choice | Random | Random, Black, Red, Green, Blue | all that fade |

"Reaches" is measured: the patterns whose frames change with the setting at
its extremes, over two seeds (`test/tme-settings.test.js` lists the rest and
why). Most of the patterns Drift misses are audio patterns that keep their
centre in the middle.

The settings are applied after the pattern's own `setup`. A choice left on
Random keeps whatever the pattern and its roll chose. A fixed choice holds
through every re-roll, and a fixed mirror is applied even on a pattern that
never mirrors. Five mirrors (Pinwheel, the diagonals, Eight ways) work in a
square of the shorter side. The sketch never rolls them on a wider panel,
and on one they leave the picture unmirrored.

Colour shift has to be separated from `h`. Most effects use `t.h` both for colour
and as an angle, so adding to `h` would turn the picture as well as
recolour it. Following the key would then jerk the rotation. Hue therefore
goes in at the colour conversion (`hsv`), which the effects all call. Fat
Fire's fixed fire palettes are left alone.

Dot size is left for stage 2. Several effects set `dot` themselves (on
their first step, or every frame from a sine), so a shared setting would be
overwritten.

### Stage 2: families, one configurable pattern for each

Many TME effect functions are siblings: the same drawing with different
constants. One configurable pattern can generate every member of a family
when its settings include those constants and the member's coin flips.
Each original pattern is then kept as a preset of its family:
- the picker still lists "Hypno Spiral II (TME 67)";
- saved looks, playlists and Hotsave entries that name `tme-67` still work;
- the family's own entry opens every setting, and the combinations between
  the presets.

A family counts as merged only when its configurable pattern, set as each
member, draws that member frame for frame at fixed seeds and several panel
sizes. Similar code does not count as proof.

## The family tree

Read from `effects.js` and `audio-effects.js` at `main` `05769e7`. "Same
effect" means the members call the same function and differ only in the
shared values above, so stage 1 already covers them. "Siblings" means
different functions with the same structure. Nothing here is proved yet;
the proof is the frame-for-frame test.

```
Generative (57)
├── Warp: shapes flying out from the centre ........... warp, whitewarp (siblings: discs or squares)
│     11 Square Warp, 17 Warp Fade, 58 Square Warp Twister, 62 Warp,
│     77 White Warp, 101 Confetti Warp, 108 Square Warp Rings,
│     147 Square Warp Kaleidoscope                                   8 → 1
├── Hypno spiral: two-armed spirals of discs ......... hypnoduck, 2, 3, 4 (siblings)
│     66 Dual Hypno, 67 Hypno Spiral II, 103 Hypno Spiral,
│     105 Hypno Spiral IV, 115 Streaker Hypno (with streaker)        5 → 1
│     Settings: centres (one, or two orbiting), length and breathing,
│     tightness, spin, colour spread, background
├── Seasick: sine waves and bands ..................... seasick, 2, 4, 5, 6 (siblings)
│     53 Seasick II, 55 Seasick Red Blue, 75 Seasick Mirrored,
│     102 Seasick IV, 112 Seasick V, 131 Seasick Fast, 162 Seasick   7 → 1
│     Settings: waves (none, filled, lines, red and blue), band (none,
│     across, down, both), wave length, band width
├── Spire: discs orbiting on breathing rings ......... spire, spire2, spire3 (siblings)
│     14 Spire, 25 Spire Six (spire3 also appears inside 4)          2 → 1
├── Line stars: one star redrawn outwards ............ starz2, starz3, Floaty Star (siblings)
│     79 Starz III, 81 Starz II, 107 Floaty Star                     3 → 1
├── Bubbles: bouncing shapes ......................... tinybubbles, bubbles2, starbubbles88 (to confirm)
│     110 Tiny Bubbles, 124 Tiny Bubbles II (the same frames, measured),
│     111 Bubbles, 155 Star Bubbles                                  4 → 1
├── Fireball ......................................... same effect
│     10 Fireball, 59 Fireball Plain, 60 Fireball Confetti           3 → 1
├── Drops ............................................ same effect
│     69 Drops, 114 Drops with Wind, 120 Windy Drops,
│     118 Drops and Spin (with Spin)                                 4 → 1
├── Spin ............................................. same effect
│     70 Spin, 119 Spin with Wind                                    2 → 1
├── Three rings ...................................... same effect (sinx)
│     19 Three Rings Slow Fade, 26 Three Ring Circus                 2 → 1
├── Triforce ......................................... same effect
│     23 Triforce, 88 Triforce Fade                                  2 → 1
├── Spiral ........................................... same effect (spiraly), one flip apart
│     134 Helix Spiral, 190 Spiral                                   2 → 1
├── Wheels ........................................... already one helper, wheel()
│     87 Wheels, 146 Disc Wheel                                      2 → 1
├── Homing ........................................... already one helper, homing()
│     72 Homer, 113 Homer III                                        2 → 1
└── On their own: 4 Round Hole, 80 Starz, 82 Swirl, 96 Triangler, 104 Circle Arc,
      128 Magic Time, 150 Fat Fire, 158 Tuber, 187 Iris                9

Audio (37)
├── Spectrum bars .................................... cappedBars, audio8 to audio12 (siblings)
│     27 Twin Lines, 159 Twin Lines Wash, 30 Bars, 31 Bars Tricolour,
│     32 Side Bars, 50 Tied Bars, 52 Centre Bars, 138 Centre Bars Split,
│     137 Top and Bottom                                             9 → 1
│     Settings: anchor (bottom, top, sides, centre, top and bottom),
│     caps, backdrop
├── Spokes ........................................... inwardSpokes (already one helper)
│     36 Spokes, 42 Spokes Fast, 43 Spokes Mirrored, 49 Spokes Kaleidoscope   4 → 1
├── Bursts ........................................... burst() (already one helper)
│     35 Burst, 38 Twin Bursts, 129 Roger, 130 Roger Double          4 → 1
├── Rims ............................................. interleaved(), doubleRing(), Raudio13, Raudio18
│     33 Rim Stereo, 34 Double Ring, 39 Burst and Rim, 154 Rim Fold  4 → 1 or 2
├── Dot rings ........................................ same effect (Raudio19)
│     28 Dot Rings Windy, 29 Dot Rings, 37 Dot Rings Mirrored        3 → 1
├── Hubs ............................................. orbitingHubs() (already one helper)
│     41 Orbiting Hubs                                               1
├── "… in Rim": a core with the spokes laid round it   a Rim setting on the core
│     44 Burst in Rim, 46 Hubs in Rim, 47 Twin Bursts in Rim,
│     153 Disc Rings in Rim                                          4 → 0
├── Checkers ......................................... checkers() (already one helper), chess
│     22 Checkers Centred, 45 Checkers, 51 Chess                     3 → 1
├── Arcs ............................................. arcs() (already one helper)
│     165 Arcs, 166 Arcs Opposed, 184 Arcs Rainbow                   3 → 1
└── On their own: 40 Outline, 157 Audio Fireball                     2
```

If every family holds up, 94 patterns come from 33 configurable ones: 14
generative families and 9 that stand alone, and 8 audio families and 2
that stand alone. The picker still offers the 94 as presets.

## Test cases

### Stage 1

| # | Test | How | Pass when |
|---|------|-----|-----------|
| 1 | Today's picture is kept | Before any change, hash 90 steps (a re-roll half way) of each of the 94 patterns at a fixed seed, at 64×32, 48×48 and 96×48, from `main`'s code, into a fixture; the test redraws with default settings | All 282 hashes equal |
| 2 | Every TME pattern declares the settings | `paramProblems` on each entry | No problems; 94 × 9 settings |
| 3 | Each number setting changes the picture | Each setting at its minimum and maximum, two seeds | Frames differ from the default; any pattern where a setting cannot act is listed in the test, with the reason |
| 4 | Speed | Speed ×2 and ×0.25 on a pattern at a known `targetfps`, over a simulated second | Twice and a quarter of the steps |
| 5 | Fade | Fade 0, 1, 2 and a fade colour on one fade | Fade 0 keeps the pixel; 2 fades by twice the amount; the colour picks the channels |
| 6 | Colour shift recolours without turning | Colour shift 128 on Spire (14) | The same pixels lit as the default's; colours differ; no shift outside a step |
| 7 | Drift 0 | Drift 0 | `driftx` and `drifty` stay where they are |
| 8 | Mirror holds | Mirror Four ways on a pattern that calls `adjustme`, across a re-roll | Every frame is quadrant-symmetric, before and after the re-roll |
| 9 | Random choices keep re-rolling | Mirror Random, several seeds | `adjunct` varies across seeds and across re-rolls |
| 10 | Wind | Wind Up on one marked pixel with Trail 0 | The pixel moves up one row a step |
| 11 | Decoration None | Decoration None on a pattern whose setup picks one | `checkfancy` draws nothing |
| 12 | Follows reaches TME | Speed follows Beat at Amount 1, with the beat in the state | More steps on beat frames than off them |
| 13 | Saved and restored | A TME pattern's settings and follows through `changedParams` and `paramValues`; `check-param-controls` builds every pattern's controls | The same values back; Reset saves nothing |
| 14 | Cost | A step at 256×192 with the number settings moved (a measurement, not a test) | Within 10% of the defaults' time |
| 15 | Square-only mirrors | Pinwheel on 64×32 and 48×48 | Unmirrored on the wide panel, mirrored on the square one |
| 16 | In the app | Pick a TME pattern; set Speed to follow Lows at Amount 50%; play music | Its speed pumps with the kick; Mirror Four ways holds for three minutes, past a re-roll |

Checks: `npm test`, `check-param-controls`, `check-saved-state`,
`check-hotsave`, `check-quad-render`, `frame-compare` (unchanged).

### Stage 2, for each family

| # | Test | Pass when |
|---|------|-----------|
| 1 | Generates each member | The family's pattern, set as each member, draws that member's frames hash-for-hash, at 3 seeds and 3 sizes (one small, one not square), with the original functions kept as references in the test until the family is accepted |
| 2 | Old ids still work | `tme-<n>` resolves to the preset; saved settings, playlists and Hotsave entries that name it still load |
| 3 | Its own settings act | Each setting at its extremes changes the picture (as stage 1, #3) |
| 4 | New combinations draw | Every combination of its choice settings draws something at every size, without an exception |
| 5 | In the app | The family's entry, moved between its presets' settings, shows each member's look and the ones between |

## Then

AuroraDrop (9 patterns, one class each) gets its settings pattern by
pattern. The 22 others without settings are shader and JavaScript patterns
written here, which can declare their own. Both are separate stories.

## Decisions for stage 2 (2026-10-27)

- **Settings stay shared in stage 1.** All nine stay on every Mark Estes
  pattern, including where one does nothing. Stage 2 gives each family its
  own settings.
- **The picker keeps all 94 originals, grouped by family.** Under the Mark
  Estes heading, each family has a sub-heading, with the family's
  configurable pattern first and its originals under it. The stand-alone
  patterns go in a last sub-heading. The code mirrors the picker: one file
  per family in `composer/public/patterns/mark-estes/families/`. The picker
  has no sub-headings today, so that is part of stage 2.
- **The originals keep rolling their coin flips,** as the sketch does. The
  Variation (T72) keeps a look that is liked.
