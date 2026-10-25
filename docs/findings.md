# What has been measured

A summary of the measurements behind the composer's design: what each asked,
the figures, and what was done about it. Each was made with a tool in
`composer/tools/` that can be run again; the command is given. Figures are
from the development machine (an Apple Silicon Mac, Chrome) unless stated.

The rule throughout is to measure before concluding: how a pattern or the
panel appears is not the same as what is sent, and a single short look at a
pattern that draws at random says little.

## Contents

- [Colour of the patterns](#colour-of-the-patterns)
- [Audio analysis on synthetic signals](#audio-analysis-on-synthetic-signals)
- [Audio analysis on real dance music](#audio-analysis-on-real-dance-music)
- [High-band hits for sparkles](#high-band-hits-for-sparkles)
- [What a quad mixer frame costs](#what-a-quad-mixer-frame-costs)
- [What the beat graph should fold](#what-the-beat-graph-should-fold)
- [Tempo through whole tracks](#tempo-through-whole-tracks)
- [Recording a live input](#recording-a-live-input)
- [Brightness over a long run](#brightness-over-a-long-run)
- [Sparkles in the stream](#sparkles-in-the-stream)
- [Recording the preview](#recording-the-preview)
- [The panel against the preview](#the-panel-against-the-preview)
- [Beat-tracking methods surveyed](#beat-tracking-methods-surveyed)
- [Aurora Bounce runs down](#aurora-bounce-runs-down)

## Colour of the patterns

`npm run measure-colours`: 140 patterns at 256×192, 10 s each, simulated
audio, five seeds, medians over the seeds.

| Family | Patterns | Colours per frame | Hue bands of 24 | Brightness levels |
| --- | ---: | ---: | ---: | ---: |
| Aurora, Fibonacci, Spectrum Lab | 18 | 3764 | 24 | 256 |
| Shader | 19 | 2856 | 24 | 243 |
| Mark Estes | 94 | 542 | 24 | 224 |
| AuroraDrop | 9 | 1946 | 13 | 256 |

- The Mark Estes ports paint areas of solid colour: 43 of 94 send fewer than
  500 colours a frame, though they light as much of the panel as the rest.
- AuroraDrop has many shades but a narrow hue range; five of its nine
  patterns use five hue bands or fewer.
- `aurora-spiral` never sends a level above 112 of 255.
- **Chance decides a lot**: for 36 of 140 patterns the richest of five runs
  had over four times the colours of the poorest. Hence seeded runs and
  medians.

## Audio analysis on synthetic signals

`npm run compare-audio`: 51 generated signals with known tempo, beats, key,
bands and level, played through the composer's own analysis offline in
headless Chrome, with Meyda beside the hand-written spectral features.

- **The detected BPM was tied to the frame rate.** Onsets were timed to the
  frame, so at 30 fps most tempos came out as 1800 divided by a whole number
  (110 read 112.5, 160 read 163.6). At 60 fps they were right. Onsets are
  now timed within the frame from flux (`band-flux.js`).
- **The 70–180 BPM fold has hard edges**: 70 can be doubled and 180 halved.
- **Dense bass hides beats**: a beat was a bass level 1.3 times its average,
  so swung or sustained bass gave few onsets and no tempo.
- **Detected beats are late**, by 20 to 34 ms at 30 fps and 14 to 18 ms at 60.
- Meyda's centroid, flatness and zero-crossing rate agree with the
  hand-written ones (correlation 0.998 to 1.000), so it is kept for the
  comparison tools only. Its `spectralFlux` failed on every frame.

## Audio analysis on real dance music

`npm run compare-tracks -- --beatport <folder>`: the
[Beatport EDM Key Dataset](https://zenodo.org/records/1101082) (1,486
two-minute previews with hand-labelled keys; 1,303 tracks in the run).

| | Tempo within 2% of Beatport's | Key exact |
| --- | ---: | ---: |
| The composer's own analysis (then) | 13% | 32% |
| Essentia.js (`RhythmExtractor2013`, `KeyExtractor` with `edma`) | 96% | 54% |

- The composer's bass-jump beat rule hardly fires on mastered dance music:
  a median of 3.5 onsets a minute, and 76% of tracks gave no tempo at any
  gain.
- The composer's key detector heard minor dance music as major (right tonic
  on 62%).
- Essentia keeps its 96% when run live on sliding 10-second windows, at
  about a tenth of a CPU core.

What followed: a choice of beat source (**Beat from**: bass jumps, spectral
flux or Essentia) rather than replacing the detector.

## High-band hits for sparkles

`npm run compare-audio` and `compare-tracks`, on the hit rule in
`updateHighs` (`audio.js`) and `HitDetector` (`spectral-features.js`).

- On clean synthetic hats: recall 0.99–1.00, precision 1.00, no false hits
  on noise or silence.
- On drum tracks, hats that land with a kick or snare are often missed
  (recall 0.72–0.79 at 30 fps), the price of not taking kicks for hats.
- On real music: a median of 3.1 hits a second.
- Known faults: rolls of thirty-second hats at 140 BPM are mostly missed; a
  sine sweep through the band gives 39 hits a minute.
- Cost: 0.055 ms a frame for the whole analysis; no drawing cost could be
  seen.

## What a quad mixer frame costs

`npm run measure-quad-cost`, before the quad mixer was built: four inputs,
two submixes, the master and the previews, against the one-pair frame.

- **It fits easily**: the worst median at 256×192 was 3.5 ms on an M5 Max
  GPU, 5.9 ms on an M1 and 4.8 ms in software rendering, against a 33 ms
  frame at 30 fps.
- **Stateful patterns set the cost**, not the mixing: their time is
  JavaScript.
- **Reading full-size previews back from the GPU is the one cost to avoid**:
  it lifted the 95th percentile from under 2 ms to about 9 ms. Previews are
  drawn small by the GPU instead.

## What the beat graph should fold

`tools/fold-clarity.mjs`: four measures of the sound folded at each track's
tempo into bars, scored by how alike neighbouring bars are.

- **Spectral flux shows the beat best in every genre**, about three times as
  clearly as loudness, catching a house kick's attack and drum and bass's
  hats alike, so no choice of band is needed.
- Stripes in the live graph came mostly from the clock's own movement.

What followed: the beat graph folds spectral flux, worked out in the audio
thread so no sample is missed (`flux-worklet.js`).

## Tempo through whole tracks

`tools/tempo-stability.mjs`: whole tracks run through each beat source as it
runs live, scored against Essentia's tempo for the whole track: the share of
the track the clock was right (within 4%), and its jumps (changes over 8%).
122 tracks, 7.7 hours, from two dance-music compilations.

| Source | Median right | Tracks right over 80% | Tracks with 10+ jumps |
| --- | ---: | ---: | ---: |
| Bass jumps | 0% | 0 | – |
| Spectral flux | 92% | 89 | 4 |
| Essentia, live, each estimate replacing the tempo | 93% | 109 | 25 |

Live Essentia found the right tempo but would not hold it through changes of
texture. Two changes followed, each measured on the same tracks:

| Variant of live Essentia | Mean right | Total jumps | Tracks with 10+ jumps |
| --- | ---: | ---: | ---: |
| Before | 88.9% | 627 | 25 |
| **The hold**: estimates folded into 70–180; a change needs three estimates in a row to agree | 89.4% | 88 | 1 |
| **The hold and the flux veto**: a change goes ahead only if spectral flux supports it | 90.1% | 46 | – |

On a 34-minute mix whose tempo changes, the hold cut jumps from 240 to 34
and the veto to 6. What the hold still gets wrong is mostly 2/3 of the tempo
on trap's triplet feel, which flux does not share. Treating 3:2 as agreeing
was also tried and left off: it added wrong locks.

Both are on by default (`TempoTracker.setEstimate` in `tempo.js`,
`AudioAnalyzer.fluxVeto` in `audio.js`).

## Recording a live input

- **ffmpeg's avfoundation capture drops audio** on the development Mac:
  about 12.6% of a 48 kHz loopback input, so every tempo measured from such a
  recording reads about 13% fast. `tools/record-input.mjs` records through
  Chrome instead and keeps every sample (179.82 s of 180).
- **On a live DJ mix held at 125 BPM** for three minutes: live Essentia with
  the hold was right all the time once started (123.7–125.2, no jumps);
  spectral flux kept a tempo but drifted up to 134.6; bass jumps found none.

## Brightness over a long run

`tools/long-run-brightness.mjs` drew patterns with their clocks started as if
the page had been open from 0 to 72 hours, and again with a quieter input.
Spectrum Tiles' level was the same at every age and fell with the input, so
patterns that dim after a while are following the input's level, not time. Nothing in the composer
changes brightness or gamma outside the operator's controls, and the audio
path has no automatic gain.

## Sparkles in the stream

Two probes of the real page counted lit pixels in the frame sent to the
panel, on a black picture and over the test card, for every placement and
three positions of the main. Sparkles reach the stream in every case. They
are drawn once, over the final picture after the main.

## Recording the preview

`tools/compare-recording-encoders.mjs` and `npm run check-recording`.

- Software x264 and hardware-only VideoToolbox both make valid H.264/AAC
  MP4s at 256×192, 64×48 and odd sizes (padded to even, not scaled). x264 was
  faster and smaller on short synthetic clips; that does not rank them for
  live use.
- A known-marker capture with a deliberate 200 ms stall: video led audio by
  37.9 ms at both markers, with no measurable drift over six seconds, within
  one frame plus AAC priming.
- Not yet measured: sync and load over a 30-minute session with a real
  input.

## The panel against the preview

- **The pixels sent are the pixels the preview shows**, but an LED panel is
  close to linear in light where a monitor is not, so changes that are only
  of brightness can flatten on the panel, and what looks dim in the preview
  can be bright on the panel. The Panel Range pattern is a test card for
  reading the panel level by level; Gamma in the composer, or `-l` on the
  receiver, corrects for it (use one, not both).
- **Panels differ in persistence**: an outdoor 1/8-scan panel holds each
  pixel longer than an indoor 1/32-scan one, so the same settings can wash
  out. Hence brightness and gamma are kept for each receiver.
- **Two composers streaming to one matrix take turns on the panel**: the
  receiver shows whichever sender pushed last.
- Some boards' Wi-Fi suffers from their own display refresh; the composer
  can send them fewer frames a second.

## Beat-tracking methods surveyed

A survey of the literature, not a measurement. Neural methods have led tempo,
beat and downbeat tracking since about 2015 (MIREX and ISMIR results), but
the composer needs methods that run live in a browser and stay steady
through changes of texture. Candidates noted for later: TempoCNN (Essentia)
for tempo, BeatNet for live beats and downbeats, and Beat This! offline as a
reference with a beat time for every beat, which a test of music whose tempo
floats would need.

## Aurora Bounce runs down

Asked because Bounce's balls lay still after a few minutes.
`tools/measure-bounce.mjs` ran it in Node for ten minutes at 64×48. As
ported, nothing puts energy back: the median ball's bounce fell from 0.90 of
the panel in the first minute to 0.10 in the third, and all 64 balls lay on
the floor from the fourth minute on. Upstream behaves the same; Aurora's
playlist showed each pattern only briefly. Bounce now has its own settings
(T54): each ball is kicked by its own part of the spectrum or by the beat,
and one that settles is relaunched. With them, in silence, no ball lay on
the floor in any minute (median 0.6 to 0.8 of the panel); on the simulated
signal the heights follow its spectrum. Music at 0 with Keep bouncing off
gives the original. Not measured: real music, and the panel.


## Audio features

**Asked:** what scales make the spectral features and loudness sent to the
patterns (centroid, flatness, rolloff, zero-crossing rate, momentary loudness)
use their 0 to 1 range on real dance music?

**Measured:** the composer's own smoothed features, offline in headless
Chrome at 30 fps and gain 1.5, on the first 120 tracks of the Beatport EDM Key
Dataset (`npm run compare-tracks`). Per-track medians:

| Feature | Scale (0 to 1) | Tracks' medians span | Median of medians |
| --- | --- | --- | --- |
| Centroid | 100 Hz to 12.8 kHz, log | 0.30 to 0.81 | 0.66 |
| Rolloff | 300 Hz to 20 kHz, log | 0.19 to 0.86 | 0.70 |
| Flatness | full at 0.05 | 0.05 to 0.62 | 0.29 |
| Zero-crossing rate | full at 0.25 | 0.03 to 0.58 | 0.20 |
| Loudness | -40 to -4 LUFS | | about 0.8 (typical -10.7 LUFS) |

**Done:** the first guesses bunched centroid and rolloff near 1 and used a
tenth of flatness's range, so the scales were moved to these. The loudness
mapping moves with the Gain setting.

**Not covered:** other genres, a live input, Safari, and whether any pattern
looks better for using them (none does yet).
