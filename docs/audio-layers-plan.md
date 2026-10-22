# Plan: highs, mids and vocals (T30)

**Status: in progress (2026-10-15).** Written on the `audio-layers` branch
at Anjin's request, first from `beat-providers` and then, once that was
merged, from `main`. Anjin's decisions are recorded at the end.

- **Done:** steps 2 and 3, the highs and the sparkles. Measured in
  [High-band hits for sparkles](findings.md#high-band-hits-for-sparkles).
- **Proof of concept:** sparkles that follow the picture's edges or bright
  shapes, after Anjin's note; see "Following the picture".
- **Next:** step 4, the mids.

## The request

In Anjin's words: the composer "currently [is] pulsing and moving to beat
(low), and following key for color change. I would also like to track mids
and highs. As well vocals. Sparkles with highs, twinkling bits of light.
Texture with mids, what texture means needs defined. Vocals tracked and
aurora lines vibrating to a singer's performance."

## What the composer has today

From `analyse()` and `updateBeat()` in `public/audio.js`:

| Value | How it is made | What it says |
| --- | --- | --- |
| `bass`, `mid`, `treble` | Mean byte of the smoothed analyser (2048 points, smoothing 0.55, −90 to −15 dB) over 20–250, 250–2000 and 2000–12000 Hz, times the gain | How loud each band is, on a decibel scale, slowly |
| `level` | RMS of the waveform | How loud the whole is |
| `beat` | A pulse at each onset from the chosen beat source (bass rule, flux or Essentia) | When a beat lands |
| `key` | Profile match on an 8192-point spectrum | The key, which sets the hue |
| `flux`, `lowFlux` | Spectral flux on an unsmoothed 2048-point analyser, all bins and below 165 Hz | How much the spectrum rose since the last frame |

Shaders get `u_mid` and `u_treble`, and a few use them as small nudges: for
example, Starfield's twinkle is scaled by treble and Aurora Curtains' glow by
mid. Section-change detection (T13) compares the three bands beat by beat.

So mids and highs are tracked only as loudness on a decibel scale, which
T26 found compresses changes in mastered music. Nothing says when something
happens in the highs, or what the midrange sounds like, and there is nothing
for voice or pitch.

## The shape of the new values

Each of the three layers gets the same three kinds of value, so patterns can
treat them alike:

- **Level:** how much there is, 0 to 1, smoothed.
- **Events:** when something starts: a pulse that decays, and a count.
- **Character:** what it is like: a few numbers from 0 to 1.

The existing `bass`, `mid` and `treble` stay as they are, so no pattern
changes behaviour until it is changed to use the new values.

## 1. Highs and sparkles

**The band:** 4 to 16 kHz, where hi-hats, shakers, cymbals, sibilance and
"air" sit. The 2 to 4 kHz presence band is left to the mids and the voice.

**Values:**

| Value | Meaning | Drives |
| --- | --- | --- |
| `highHit` | Pulse set to the strength of each high onset, decaying in about 100 ms | Brightness of the newest sparkles |
| `highHits` | Onsets this frame (usually 0 or 1) | How many sparkles to spawn |
| `highRate` | Onsets a second over the last two seconds | Sparkle density |
| `highPlace` | Where in 4–16 kHz the rise was, 0 to 1 (the centroid of the flux increase) | Position or colour temperature of new sparkles: a closed hat and a crash land differently |
| `air` | The high band's share of the total magnitude, smoothed | Background twinkle between hits |

**Detection.** Flux over the high bins of the unsmoothed analyser the flux
source already reads, on linear magnitudes like `lowFlux`. The threshold
should adapt (above the median plus a multiple of the median deviation over
the last second), with at least 40 ms between hits. That is deliberately not
the 1.3-times-the-average rule: on the Beatport set T26 found that rule
hardly fires for bass, and hats are quieter still. At 30 fps there is at most
one hit per frame, so 30 a second, which is above sixteenths at 174 BPM
(about 11.6 a second).

**Sparkles.** Each hit spawns sparkles: a count that follows the hit's
strength, lasting 80 to 250 ms, full brightness at once and then an
exponential decay. `air` keeps a low, slow twinkle going between hits. Shaders
cannot keep state, so the last 32 hits (age, strength, place, seed) go to the
compositor as a uniform array, and it draws each hit's sparkles from its age.
As built (step 3), the hit rule also needed two tests beyond the adaptive
threshold, a brighter-than-1–4 kHz test and a minimum rise; see
[High-band hits for sparkles](findings.md#high-band-hits-for-sparkles).

## 2. Mids and texture

**The band:** 250 Hz to 4 kHz.

**Proposed definition.** *Texture is the surface quality of the midrange:
whether it is smooth or grainy, still or churning, sparse or dense.* Each of
those is one number:

| Value | Smooth / still / sparse (0) | Grainy / churning / dense (1) | Measured as | Drives |
| --- | --- | --- | --- | --- |
| `grain` | Pad, held chord, sung vowel, sine lead | Distorted synth, noise sweep, crowd, snare wash | Spectral flatness of the mid band | Roughness: smooth gradient against crackle and grain |
| `churn` | A held pad | Arpeggios, fast chord changes, chopped vocals | Mid-band flux, smoothed over about half a second (motion, not onsets) | How fast the texture flows and evolves |
| `density` | One note | Full chords, stacked layers | Prominent spectral peaks in the band, counted and scaled | Scale: a few large features against many fine ones |

`mid` (or a linear version of it) stays as the texture's strength: its
contrast.

Why these three:

- **Measurable.** Each is a few lines on data the analysers already give;
  `flatness` and `flux` are already in `spectral-features.js`.
- **One visual control each,** so they do not fight.
- **Independent in music.** A held distorted chord is grainy, still and
  dense; a plucked arpeggio is smooth, churning and sparse.

Considered and not proposed first:

- **MFCC timbre:** it describes the sound well but means nothing visual.
- **Essentia's `Dissonance`** (psychoacoustic roughness): closer to the
  musical sense of "rough" than flatness is, so it is worth comparing with
  `grain` when measuring.
- **Spectral contrast:** overlaps with `density`.

**On screen.** A shared shader helper, `midTexture(p)`: domain-warped noise
whose roughness follows `grain`, whose scale follows `density`, whose warp
speed follows `churn`, and whose contrast follows `mid`. Patterns can use it
as a surface or a mask.

## 3. Vocals and aurora lines

**What can be done live, honestly.** No method that runs live in a browser
takes the singer out of a finished mix. What can be done is to follow the
predominant pitched sound in the vocal range and judge how voice-like it is.
It will also follow a lead synth, a saxophone or a whistled line. Heavily
tuned or vocoded vocals lose the glide and vibrato that mark a voice.

**Values:**

| Value | Meaning | Drives |
| --- | --- | --- |
| `voice` | 0 to 1: how likely it is that a voice-like pitched sound is in front | Whether the vocal line is shown, and how strongly |
| `voicePitch` | The fundamental in Hz, and 0 to 1 on a log scale over 80–1000 Hz | The line's height |
| `voiceLevel` | Loudness of 300–3400 Hz while `voice` is up | The line's amplitude and brightness |
| `vibratoRate`, `vibratoDepth` | Hz and cents of the pitch's wobble at 4–8 Hz over the last half second | The line's ripple |
| `voiceOnset` | A pulse at each new syllable or phrase | A flare along the line |

**`voice` combines cues,** each measurable on its own:

- **Clarity:** the pitch tracker's confidence.
- **Range:** a fundamental between 80 and 1000 Hz.
- **Energy:** a strong share of the total in 300–3400 Hz.
- **Panning:** centred, judged from the left and right analysers. Lead vocals
  are almost always in the middle.
- **Movement:** pitch that glides and wobbles rather than sitting on exact
  semitones as most synths do.

**Method, in stages:**

1. **C1, a pitch tracker of our own.** YIN, or McLeod's method, on the live
   input in a worker fed by the existing `pcm-capture-worklet.js`.
   - **Input:** mono, resampled to 16 kHz.
   - **Window and step:** 64 ms windows every 8 ms, about 120 estimates a
     second, which is plenty for vibrato (it needs about 20 a second).
   - **Delay:** about 50 ms.
   - **Cost:** to be measured.
2. **C2, Essentia.** `PredominantPitchMelodia` is built for exactly this:
   finding the main melody in mixed music. It comes with `Vibrato` for
   measuring the wobble. Both are already in the vendored Essentia.js, whose
   licence is accepted. Compare its accuracy, delay and cost with C1 on short
   windows.
3. **C3, only if both fall short.** A trained model, such as a small pitch
   network or a voice/instrumental classifier, would be a new dependency of
   some size, to be decided then. Source separation (Demucs, Spleeter) is too
   heavy to run live.

**On screen.** Aurora Curtains (`aurora-curtains` in `patterns.js`) draws
three ribbons. Today each ribbon's height follows the spectrum at its x, and
its glow follows bass and mid. The proposal is a lead ribbon for the voice:

- **Melody:** the recent pitch scrolls across the panel as a trace, so the
  line traces the melody. It needs a pitch-history texture, like the
  spectrum history.
- **Amplitude:** follows `voiceLevel`.
- **Ripple:** a standing wave along the ribbon at `vibratoRate` and
  `vibratoDepth`, or the band-passed voice waveform itself, so the line
  vibrates with the sound.
- **Other ribbons:** stay ambient, and dim while `voice` is down.

## Following the picture (Anjin, 2026-10-15)

After seeing random sparkles, Anjin wrote: "Texture and Sparkles should
find visual features in the frame, random is a good starting point, but
sparkles along a curve, textures morphing and impacting a panel, circle,
object... this has more feeling and emotion." It was noted, to be
or tried as a proof of concept.

**Tried: sparkles placed by the picture** (`sparkle-features` branch). A
Placement setting: Anywhere, Along edges and curves, or On bright shapes.

- **How:** the compositor first draws the mixed picture into a texture, and
  each pixel's chance of sparkling is weighted by what the picture has there.
  Along edges, the weight is the change in brightness across the pixel; on
  bright shapes, the brightness.
- **Faint features count for nothing.** Each weight ramps from a floor:
  a change of 0.1 to 0.4 for edges, brightness 0.3 to 0.8 for shapes. As a
  plain proportion, a scope's dim grid and a curtain's soft threads drew as
  many sparkles as the lines.
- **Seen:** sparkles on Oscilloscope's wave, Aurora Curtains' crests and
  Radial Spectrum's rim, and inside Metaballs' blobs (screenshots in
  [High-band hits for sparkles](findings.md#high-band-hits-for-sparkles)).
- **Cost:** about 2 fps of 53 in software WebGL, for the extra pass.

**Anjin's verdict on the panel (2026-10-15):** "the sparkle features
get lost on LED displays, laying them on features means they compete with
the data already there and just disappear; but we can keep the code." On
the panel, a sparkle needs dark around it to read. That points the other
way from placing them on features: if anything, sparkles belong where the
picture is dark, or the picture should dip around a sparkle. Anywhere stays
the default.

**Further ideas, not tried:**

- **Sparkles that travel.** Each sparkle could slide along the edge it sits
  on over its life, following the curve, instead of flashing in place. The
  edge's direction is the perpendicular of the brightness gradient already
  computed.
- **Sparkles where things move:** weight by the change since the last frame,
  so they gather on what moves.
- **Texture inside shapes.** The compositor already knows the layer regions
  (ellipse, rectangle, diamond; T11, T12). Texture could fill a region, ripple
  out from its border, or "impact" it: a disturbance that starts at the
  shape's edge on a mid-band onset and spreads across it, with grain, churn
  and density setting its look.
- **Texture that follows the picture:** domain-warp the picture itself by
  the texture field, so its curves morph, rather than laying noise over it.
  Gradient flow along edges would keep the shapes recognisable.
- **Objects.** A pattern could hand the compositor its own shapes (the
  metaballs, the rings, the ribbons) as a mask, so effects attach to those
  objects exactly rather than to edges guessed from the pixels.

## Measuring before any of it drives a pattern

Each value is checked the way T26 checked beats and key, with figures and
what they do not cover.

- **Synthetic signals with known answers,** added to `tools/audio-signals.js`
  and reported by `npm run compare-audio`:
  - **Highs:** hat patterns at known rates over a kick. Check the hit count,
    timing and `highPlace` for closed hats against crashes.
  - **Mids:** a pad, noise, an arpeggio and a chord cluster. Check that
    `grain`, `churn` and `density` order them as the table says.
  - **Voice:** a synthetic sung vowel (harmonics through formant filters, a
    known pitch contour, vibrato 5.5 Hz ±40 cents), first alone, then over
    drums, then beside a lead synth with no vibrato. Check pitch error in
    cents, `voice`, vibrato rate and depth, and how far the synth fools it.
- **The Beatport set** (`npm run compare-tracks`), which has no labels for
  this, gives distributions:
  - **Highs:** at 128 BPM, sixteenth or eighth hats would be 4 to 8 hits a
    second, and most tracks should fall there.
  - **Mids:** the texture numbers should spread across tracks, not sit pinned
    at one end.
- **Vocals on real music need labels.** Candidates, kept outside the
  repository like the Beatport set:
  - **MUSDB18:** 150 tracks with separate vocal stems, so the stem gives true
    vocal activity and pitch. Seven-second previews are free; the full set is
    given on request through Zenodo, for research use.
  - **The Jamendo corpus:** annotated for where singing is.
  - **Anjin's own tracks.**
- **The Monitor view (T29):** new columns in the log, and a voice-pitch
  trace beside the tempo trace.
- **Cost:** milliseconds per frame on the development Mac, for the frame
  loop and the worker.

## Interface changes

- **`state.audio`** gains the values above. The shaders get matching
  uniforms (`u_high_hit`, `u_air`, `u_grain`, `u_churn`, `u_density`,
  `u_voice`, `u_voice_pitch`, `u_voice_level`, `u_vibrato_rate`,
  `u_vibrato_depth`), plus the pitch-history texture. The hits went to the
  compositor instead (see sparkles), and so are not given to patterns.
- **The simulated signal** gains hats, a texture that swells and a sung line,
  so patterns can be tried without an input.
- **Settings:** a sensitivity per layer may be needed, once measuring shows
  whether fixed thresholds hold across tracks.

## Steps

1. Anjin's decisions, below.
2. **Highs:** analysis, unit tests, synthetic signals, Beatport
   distribution, Monitor columns. *Done.*
3. **Sparkles:** a sparkle effect over every pattern. *Done.* Hits go to the
   compositor as a uniform array rather than a texture. Starfield is
   unchanged; with sparkles on, it does not need moving to hits.
4. **Mids:** analysis and measurement.
5. **Texture:** the `midTexture` helper, an effect and one pattern.
6. **Vocals, C1:** pitch worker, `voice`, vibrato; synthetic and labelled
   measurement.
7. **The vocal aurora.**
8. **Vocals, C2:** the Essentia comparison.

Each step is a commit with its tests and records, and steps 2 to 5 do not
wait for the vocal work.

## Risks

- **Vocal tracking follows any lead melody**, and tuned, vocoded or chopped
  vocals, common in dance music, hide the cues that mark a voice.
- **Fixed thresholds** may not hold from a quiet live input to a loud master;
  the beat detector's history (T26) says to measure first.
- **On the panel**, a sparkle is one or two pixels at full brightness for a
  tenth of a second. How short, bright events look on a panel that may be
  linear in light (see "The panel against the preview" in [findings.md](findings.md#the-panel-against-the-preview)) is for Anjin to
  judge on the panel.
- **CPU:** the pitch worker is the main new cost. Resampling to 16 kHz first
  cuts it about ninefold.

## Decisions

The five questions put to Anjin, and the answers of 2026-10-15:

1. **Texture:** grain, churn and density? The answer: "yes, this is what I meant
   by texture, a visual feeling of rough, smooth, silky, terms often used to
   describe music as well". "Silky" is smooth but moving: low `grain` with
   some `churn`.
2. **Where sparkles and texture apply:** "sparkles should be a super
   pattern, added to anything". So sparkles are an effect the compositor lays
   over every pattern (step 3). Texture was left open.
3. **Which aurora lines:** "exactly the aurora pattern I meant in this
   context": Aurora Curtains. Whether to change it or add a new pattern beside
   it was not answered; the recommendation, a new pattern, stands until
   decided otherwise.
4. **Labelled vocal data:** "I'll find something and add to a local store".
   Kept outside the repository, like the Beatport set.
5. **Branch:** "we can finish up beat providers, all of them work well".
   `beat-providers` was fast-forwarded into `main` and deleted, and this
   branch moved onto `main`.
