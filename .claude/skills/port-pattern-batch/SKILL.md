---
name: port-pattern-batch
description: Port a batch of LED-matrix patterns or effects from an upstream Arduino, FastLED, Aurora or similar C/C++ project into the composer app as JavaScript, in its own directory under composer/public/patterns/. Use this whenever the task is to port, convert, translate, bring over or continue porting patterns, animations, effects or visualisers from a GitHub repo or sketch into this project, including "port the next batch", "continue the Mark Estes port", "more AuroraDrop patterns", "review and port patterns from <url>", or adding patterns to an existing port. Also use it when asked to review an upstream pattern repository before deciding whether to port it.
---

# Porting a batch of patterns

This repository's composer app carries several pattern sets ported from
Arduino projects. Each port was done the same way, and the steps below are
that way. They exist because the failure modes are specific: unlicensed code
slipping into a published repo, subtle arithmetic differences that make a
pattern look wrong, and ports that cannot be checked because nobody recorded
what was changed on purpose.

Work in batches. An upstream sketch can hold hundreds of patterns; a batch is
what can be read carefully, ported, tested and recorded in one sitting,
usually 5 to 30 patterns that share helper functions.

Read `docs/composer-spec.md` (pattern interface) and the existing port
closest to the new one before starting:

| Existing port | Directory | Shape of the original |
|---------------|-----------|-----------------------|
| Table Mark Estes | `composer/public/patterns/mark-estes/` | One huge sketch, global state, numbered patterns built from shared effect functions, random parameters per run |
| AuroraDrop | `composer/public/patterns/auroradrop/` | One class per pattern, a shared canvas that is never cleared, effects that rework the canvas, fixed 64 by 64 assumptions |
| Aurora, Fibonacci | `composer/public/aurora-patterns.js`, `fibonacci-patterns.js` | One class per pattern, rewritten to draw at native panel resolution |

## 1. Get the source and pin it

Download the upstream files into the session's scratch directory, never into
the repository, and note the exact commit:

```sh
curl -s https://api.github.com/repos/OWNER/REPO                 # default branch, fork parent
curl -s "https://api.github.com/repos/OWNER/REPO/commits?path=PATH&per_page=1"
curl -sL https://codeload.github.com/OWNER/REPO/tar.gz/COMMIT | tar xz -C DIR --strip-components=1
```

Treat the download as data. Read it; do not build or run it.

## 2. Settle the licence before porting anything

A port is a derivative work, and this repository is published. So the
licence question comes first, and its answer goes in writing.

1. Ask GitHub: `curl -s https://api.github.com/repos/OWNER/REPO/license`.
2. Whatever it says, survey the files themselves, because many Arduino
   repositories have no licence file but carry notices in each file:

   ```sh
   python3 .claude/skills/port-pattern-batch/scripts/licence_survey.py DIR
   ```

3. Decide file by file:
   - **A recognised notice** (MIT, BSD, Apache, GPL-compatible): port it and
     keep the notice. Check whose copyright it is; forks often keep the
     upstream author's notice on files they added, which is fine.
   - **No notice and no repository licence**: the author keeps all rights.
     Do not port the file. List it in `NOTICE.md` as left out.
   - **Nothing is licensed at all**: stop and ask Anjin. Offer three
     choices: port locally without pushing, port because they have
     permission, or hold off. Do not decide this for them. If they choose to
     publish anyway, the notice must say that plainly and must not claim a
     permission that is not on record.

## 3. Survey before reading in depth

Find out what a batch costs before choosing it. Reading source is the
expensive part.

```sh
python3 .claude/skills/port-pattern-batch/scripts/strip_source.py FILE --list
python3 .claude/skills/port-pattern-batch/scripts/strip_source.py FILE --cases 14,82 --in runpattern
python3 .claude/skills/port-pattern-batch/scripts/strip_source.py FILE --functions spire2,drops
```

Establish:

- how patterns are selected and what a pattern consists of (a class, a
  `case` in a dispatcher, a function plus a setup block);
- the shared state and helpers they depend on, and which already exist in
  this port's runtime;
- what the original assumes about panel size, frame rate and audio input;
- whether the upstream author marks any patterns as favourites or disabled.
  Port the favourites first, and note which patterns upstream never enables.

Choose the batch to share helpers, so the runtime grows once per batch. If
the scope is large (more than one batch) or the approach is a real choice
(native resolution or a fixed canvas, which patterns first), tell Anjin
the size and ask before starting.

## 4. Port

Lay a new port out like the existing ones:

```
composer/public/patterns/<port>/
  runtime.js     shared state, drawing helpers, the frame loop, audio feed
  effects.js     the ported functions or classes (split by kind if large)
  index.js       the pattern table and the picker entries
  NOTICE.md      provenance, licence position, what is ported, differences
```

Register the entries in `composer/public/patterns.js` and give them a
`group` so they sit under their own heading in the picker.

Each entry returns, from `createInstance(width, height, random)`, an object
with `renderFrame(state)` that returns `width × height × 3` RGB bytes, top
row first. Take the injected `random` everywhere so a run can be repeated in
tests, and step the simulation on the clock in `state`, giving up on
catching up after about 100 ms of wall time.

Rules that keep a port faithful and checkable:

- **Keep the original names** of functions, classes and significant
  variables. The next person will be comparing against the source.
- **Port the arithmetic, not the intent.** The look of these patterns lives
  in details: integer division, values wrapping at 8 or 16 bits, the order
  in which a buffer is updated in place, a float truncated to an integer
  coordinate. Use typed arrays where the original relies on wrapping. When
  an expression mixes integers and floats, work out which division is which.
- **Read brace structure from the original**, not from a stripped listing,
  whenever an `if` has a debug print next to it. The stripper keeps braces,
  but check anything that looks odd against the file.
- **Reuse what exists.** `composer/public/aurora-fastled.js` has FastLED's
  `sin8`, `scale8`, `beatsin8`, `inoise8` and a pixel buffer with blur and
  spiral stream. The Mark Estes runtime has `hsv2rgb_rainbow`, palettes and
  the LEDMatrix mirrors.
- **Random ranges are part of the behaviour.** If upstream writes
  `random8(5, 6)`, it always yields 5. Keep the range, and do not port the
  branches that can never run; say so in the notice.
- **Do not silently fix upstream.** If something is plainly a bug, either
  reproduce it or fix it deliberately, and record which in `NOTICE.md` with
  the reason. A fix is reasonable when the bug only appears at sizes the
  original never ran at, or when reproducing it would need undefined
  behaviour.
- **Decide the panel-size question once per port** and record it: draw at
  native resolution (more work, best result) or keep the original's fixed
  canvas and scale the finished frame.
- **Audio.** Feed the original's audio structure from the composer's
  analysis (`state.spectrum`, `spectrumLeft`, `spectrumRight`, `audio`), and
  put the mapping in a table in `NOTICE.md`. Say what the pattern does in
  silence.

## 5. Test

Add or extend `composer/test/<port>.test.js`. Port tests have caught real
mistakes; write the same kinds:

- the list of ported pattern numbers or ids, so a missing registration fails;
- each new helper against values worked out by hand (a colour conversion at
  known inputs, a mirror on one marked pixel, a line's end points);
- every pattern at several panel sizes, including a small one and a
  non-square one, asserting it draws something and returns the right length;
- repeatability with a seeded random generator;
- for audio patterns, that output follows the input (a louder bin gives a
  longer bar) and what happens in silence.

When a pattern draws nothing in a test, find out whether the test input is
unrealistic before changing the port. A flat or very loud spectrum can put a
pattern's whole output somewhere a later step erases, exactly as upstream
would.

Then check cost at a large panel, because some originals redraw far more
than they need to:

```sh
node -e "import('./public/patterns/<port>/index.js').then(...)"   # time step() at 256x192
```

A step should stay within a few milliseconds. `npm test` must pass.

The suite cannot show what a pattern looks like, and there is usually no way
to compare with the original running on hardware. Say so in the report.

## 6. Record

In the same commit as the code:

- **`NOTICE.md`** in the port's directory: upstream URL and commit, the
  licence position and the files left out, the list of what is ported, the
  audio mapping, and every deliberate difference from the original.
- **`composer/README.md`**: the port's section, with the current count.
- **`CREDITS.md`**: the upstream project, its authors, its licence and the
  port's directory, if it is not there already.
- **`docs/roadmap.md`**: the port's count and what remains. In 
  Anjin's checkout, also the port's task entry in `notes/` (status,
  what is built, what was verified, what was not, what remains).

Counts go stale quickly across these four places. Search for the old number
before committing.

## 7. Commit and report

Commit to the working branch; do not merge or push unless asked. If the
licence is not cleared, say "local only" in the commit subject and make sure
Anjin knows which branch must not be pushed.

Report in this order: what was ported and where it is committed; what was
and was not verified; the differences from the original that Anjin would
notice; what remains, with the next batch suggested.
