# Plan: evolving Troy's tempo tracker, with a testing protocol

Status: proposed, 2026-11-03. Nothing here is built. Each iteration and
each stage becomes a story with an acceptance list.

## Why Troy's tracker

Troy's tracker (in his WLED fork's audioreactive usermod, EUPL-1.2) finds
the tempo and the beat phase live. It works from kick onsets in the
40–160 Hz band:

- a comb over the last 12 s of onsets;
- a log-normal prior centred on 125 BPM;
- a phase-locked loop that holds a beat grid.

It already runs on ESP32 and is light enough for any of our targets.

An offline study (summarised in [findings.md](findings.md#tempo-by-folding))
ran a faithful port beside our fold, counting a tempo right when it is
within 2% of the label:

| Within 2% | Beatport, all 774 | Beatport, house 251 | FSLD loops, 296 |
| --- | ---: | ---: | ---: |
| Troy's tracker (faithful port) | 69.5% | 97.2% | 47.0% |
| Our fold (offline reference) | 90.6% | 98.8% | 75.3% |
| QM beat tracker (offline reference) | 95.9% | 100% | 63.2% |

On house it is level with the fold (p = 0.29). Away from house, the study
found four causes, each of which can be measured and fixed:

1. **The prior holds it near 125 BPM** when the music is elsewhere. 180 of
   its 236 Beatport misses bear no simple ratio to the label.
2. **Its comb score rises with tempo even on noise** (0.39 at 90 BPM, 0.58
   at 175), because the ±70 ms window covers more of a short beat. The prior
   partly cancels this, so the prior does two jobs at once.
3. **Noise locks** near 125–135 BPM with a score of about 0.45, so a lock
   is not a confidence.
4. **Its evidence is thin:** a 12 s window of peak-picked kicks. The fold,
   with the whole track and a continuous feature, rarely loses the
   periodicity.

The aim is to evolve the tracker one tested change at a time, keeping what
makes it good: live, causal, small and phase-locked. The goal is the fold's
accuracy without the fold's cost.

## The testing protocol

### The baseline

- **The faithful port, frozen.** Its traces matched the original C++
  exactly on 16 synthetic signals. Every variant is a flag on the port, so
  the baseline is always one flag away and reproducible.
- **The original C++ is rebuilt from the same source** on the Mac for each
  variant's C++ twin (see "Bringing it to the boards"), and traces are
  compared as before.

### One iteration

Each iteration is one change, written down before it is run:

| Field | Example |
| --- | --- |
| Change | Correct the comb score for chance: $\tilde S = (S - S_0)/(1 - S_0)$ |
| Cause it targets | 2 and 3 above |
| Prediction | Fewer locks on noise; fewer misses at ×3/2; the house score unchanged |
| What would falsify it | A lower house score, or no change on noise |
| Cost | Operations per frame and bytes, against the baseline |

Then:

1. **Synthetic and noise first** (minutes):
   - known-tempo signals, including tempo steps and swing;
   - Poisson onsets and white noise: lock rate, and score against tempo
     (the noise check that found cause 2).
2. **A subset of Beatport,** two tracks a genre, with a slice review by a
   reviewer with roots in beat tracking: is the change what it claims, and
   is the explanation right? Only a cleared variant runs on all the data.
3. **Beatport, all 774, the tuning set,** with every figure paired against
   the current best (exact McNemar):
   - within 2% overall, Acc1 and Acc2;
   - within 2% on the house subset, which must not fall;
   - how the misses relate to the label (×2, ×3/2, ×3/4, no simple ratio);
   - the lock rate and score on noise;
   - whether the score predicts a right answer (area under the ROC curve),
     to tell whether it can serve as a confidence;
   - read after 12 s and at the end, as on the board.
4. **Streaming, whole tracks:** `tempo-stability` (share of each track right
   within 4%, jumps, lock time), on the same tracks each time.
5. **Promote or drop.** A variant is promoted when all of these hold:
   - it is better on Beatport (p < 0.05), or level and better on a stated
     secondary measure;
   - house does not fall;
   - noise is no worse;
   - the cost is within the budget (below).

   Each result is logged in a table (variant, change, prediction, figures,
   verdict), and dropped variants are kept, with why.
6. **Held-out checks.** FSLD is scored only for a promoted variant, once per
   promotion, never to choose between variants. A larger unlabelled
   collection, scored by a consensus of references, is the final
   confirmation after the last iteration.

### Budget

The budget applies only to the board versions:

- **ESP32:** within the cost of Troy's sweep today (44 candidates a frame),
  adding at most a few KB of memory.
- **Teensy:** the same, though it has more room.

MatrixPrism and MoonLight's desktop version run on a computer, not tied to
a board, and are held to neither. Their variants may use whatever helps.

### Faithfulness and credit

Every variant is a dated difference in the port's NOTICE, as the EUPL asks.
A promoted variant is offered to Troy (and to MoonLight) as a change he can
take or leave. His method stays his, credited, and the baseline stays
available.

## Iterations to try, in order

Each targets a measured cause. The order puts cheap, likely gains first.

1. **Correct the comb for chance** (causes 2 and 3). Use the expectation of
   the best-window share for the same onsets with random phases. It can be
   computed per sweep from the onset count and the window width, or by
   shuffling phases once.
2. **Retune the prior** (cause 1). Now that it no longer cancels a bias, fit
   its centre and width on Beatport-all, not on house alone, or soften it to
   a preference.
3. **Longer memory** (cause 4). A 24 or 32 s comb window, or an
   exponentially weighted onset history, within the budget.
4. **Choose the metrical level with a bar check** (learning from the fold).
   For the best tempo $T$, compare $T$ with its relatives $2T$, $T/2$,
   $3T/2$ and $2T/3$ using a one-bar fold of the onset function (the fold's
   template clarity, made small). This is where the fold's strength (it
   finds the periodicity) meets the comb's (the kick marks the beat).
5. **Continuous evidence** (cause 4). The comb over the onset function
   itself rather than peak-picked onsets, or a second band (hats) for music
   without a steady kick.
6. **A calibrated confidence** (cause 3). A threshold on the corrected score
   validated on noise, exposed as "locked" or "unsure".

## Bringing it to the composer

- **Beat from: "Troy"** (the evolved tracker) is added beside bass jumps,
  spectral flux and Essentia, fed by the composer's audio worklet. Its
  estimates go through the existing hold and flux veto.
- **Agreement as confidence:** with Essentia or the fold also running, the
  tempo is "locked" when they agree within 2%. The study found agreement a
  reliable sign of a right answer.
- **The fold** stays the offline reference, and a possible source later.

## Bringing it to the boards: ESP32 and Teensy

This path is separate from MatrixPrism, which never runs on a board and
needs no change for it. It takes promoted variants of Troy's tracker to
MoonLight on ESP32 and to a Teensy tempo box. The harness that tests them is
shared.

MoonLight's desktop version runs the same code without the board's budget.
It is the test bed: a variant runs there on real audio before it is
flashed to a board.

| | ESP32 (MoonLight, WLED) | Teensy 4.x (Audio Library) |
| --- | --- | --- |
| Input | I2S microphone or line-in; the onset function at about 94 frames a second (512-sample hops at 48 kHz), as Troy's tracker reads it today | Line-in through the audio shield, 128-sample blocks at 44.1 kHz, decimated |
| Starting point | Troy's tracker runs there already | His C++ header compiles as is |
| Each promoted variant | Compiled in behind the same flag | The same code |
| Output | Effects on the board; sync to other nodes | MIDI clock (24 a beat) over USB or DIN, and tempo over serial |

1. **One C++ twin per promoted variant,** kept beside the JavaScript port
   and tested against it on the Mac:
   - the same synthetic signals and real tracks;
   - matching traces, exact for integer paths and to a stated tolerance for
     float;
   - its cost counted, then timed on each board.
2. **ESP32 first,** inside MoonLight, where the tracker already lives.
   Measure:
   - CPU share and memory;
   - the tempo against the JavaScript port's on the same recording;
   - the microphone's effect, which on a board may limit accuracy more than
     the method does.
3. **Teensy:** `AudioAnalyzeTempoTroy` as an Audio Library object. A small
   **tempo box** listens to line-in and sends MIDI clock, so the composer,
   DJ gear and lights can follow a source the composer cannot hear. The
   composer already reads MIDI.
4. **Licence:**
   - Troy's code and its variants stay under the EUPL-1.2 with his notices.
   - Combined into the composer, it is distributed under the composer's
     GPL-3.0, by the EUPL's Article 5.
   - On the boards, MoonLight's and WLED-MM's own licences apply; check
     each before code is offered.

*Acceptance per board:*

- the twin matches the JavaScript reference;
- it keeps up with the audio within the budget;
- its tempo agrees with the JavaScript port's on the same recording.

## Risks

- **A change that helps house may hurt the rest, or the other way round.**
  Both figures are reported for every variant, and house must not fall.
- **Overfitting to Beatport,** its labels being store metadata. FSLD is
  looked at once per promotion only, and the final check is on unlabelled
  internal music, by consensus.
- **The board's microphone and room** may limit accuracy more than the
  method. Line-in comes first on Teensy, and the ESP32 is tested with both.
- **The bar check (iteration 4)** may cost too much on ESP32. It can run
  less often than the sweep, for instance once per lock.

## Related work

- **Mosaikbox** (Sowula and Knees, ISMIR 2024) reports a tempo detector
  better than the state of the art at tight tolerances, for DJ mixing. Score
  it on the same sets if its code is available.
- **Beat This!** (Foscarin, Schlüter and Widmer, ISMIR 2024) publishes beat
  and downbeat annotations: the reference for testing the PLL's phase and
  lock time.
