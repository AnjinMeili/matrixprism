# Plan: a pattern library and editor (T33), and a cleaner UI (T34)

**Status: for future work (2026-10-15).** Recorded at Anjin's request,
"no need to action these at this point, but for future work planning".
Nothing is built.

## The requests

- **The pattern library and editor (T33).** "Pattern editor with categories
  and favor[ites] IE, curated patterns that one always returns to. Pattern
  editing should allow random mutations of just that pattern during a
  session, rapid fast change that can be scrubbed forward and backward,
  paused, tweaked, and replayed and saved when to the user's taste."
- **The UI (T34).** "Entire UI needs cleaned up for functionality."

## What the composer has today

- **142 patterns** in one registry (`PATTERNS` in `patterns.js`). Some have
  a `group` (Mark Estes, AuroraDrop), shown as headings in a grid of
  buttons. There are no user categories, favourites or search.
- **No pattern parameters.** A shader pattern's constants (speeds, scales,
  counts) are written into its GLSL. The ports keep theirs inside their own
  code. The only settings a user can change are global: Look (brightness,
  gamma, speed, hue), the palette, dot size and flock count for the ports,
  and Spectrum Lab's own panel. **This is the main gap:** mutation needs
  parameters to mutate.
- **Saved looks exist in part.** A playlist entry keeps a pattern with the
  mixer and layer shapes (T7). The randomizer picks patterns, blends and
  shapes on timers (T8). Neither keeps a pattern's own settings, since there
  are none.
- **Settings** live in the browser's local storage, checked group by group
  on load.

## T33: the pattern library and editor

### 1. Parameters, the groundwork

Each pattern declares the parameters worth changing: name, range, default,
and whether it may be mutated. For example, for Plasma: scale, speed, warp,
colour spread.

- **Shader patterns** read them as uniforms (`u_param[8]`), with the
  constants in the GLSL replaced by them.
- **Stateful ports** read them from the render state.
- **Pattern settings that exist now** (palette, dot size) become
  parameters of the patterns they belong to.

Start with a handful of shader patterns to settle the interface, then widen.
The ports are the most work: each constant has to be found in code written
by someone else and given a sensible range. Their `NOTICE.md` files would
record each parameter as a deliberate difference.

### 2. Categories and favourites

- **Categories:** the existing groups, plus categories the user makes and
  tags patterns with, such as "calm", "beat-heavy", "dark", "for the big
  panel". A pattern can be in several.
- **Favourites:** a star on any pattern or variant, and a Favourites
  category at the top of the picker.
- **The picker** filters by category, favourites and a search.
- **The randomizer and Auto cycle** can draw from one category or from the
  favourites only. That is what makes "patterns one always returns to" useful
  on a live night.

### 3. Variants: curated patterns

A variant is a pattern with its parameters set to taste, plus its look (hue,
speed, palette), under a name of its own.

- **In the picker,** variants appear under their pattern and can be starred
  and tagged like it.
- **Elsewhere,** playlists and the randomizer can use them as they use
  patterns.

### 4. Mutation sessions

Mutation works on one pattern, in a session, and records each step on a
timeline:

- **Mutate:** each step changes the parameters at random within their
  ranges.
  - *Strength* sets how far a step goes, from a nudge to a leap.
  - *Rate* sets how often steps come: several a second for "rapid fast
    change", or on each beat, bar or detected change in the music (T13).
  - Any parameter can be *locked* to keep it out of mutation.
- **Scrub:** the timeline keeps every state, so it can be dragged back and
  forward, paused, and stepped one state at a time.
- **Tweak:** while paused, the parameters are sliders. A tweak is a new
  state on the timeline.
- **Replay:** play the timeline back from any point, at its own pace or
  faster.
- **Branch:** resume mutating from any earlier state; the later states are
  kept as a branch rather than lost.
- **Save:** any state becomes a variant, and a stretch of timeline could be
  saved as a moving variant that replays its changes.
- **Morph or cut:** a step can jump, or glide over a set time. Gliding reads
  better on the panel.

Mutation uses a seeded random generator, so a timeline is its seed and its
steps. It can be replayed exactly, and is small enough to save.

### Questions for Anjin when this is taken up

- **Where it lives:** a sixth view, "Editor", or a mode of the Patterns view?
- **Streaming while editing:** should the panel show the session as it runs,
  or stay on what it was showing while the editor previews only?
- **Mutation style:** steps from the current state, fresh draws within the
  ranges, or "pick the better of two" (breeding)?
- **Keeping the work:** variants and timelines in this browser only, or
  exported and imported as files, so they move between machines and survive
  cleared browser data?
- **The music:** should mutation follow it, for instance stronger steps on
  louder passages and a pause in breakdowns?

### Steps

1. **The parameter interface,** on three or four shader patterns, with
   tests on ranges and defaults. *Done 2026-10-16 (merged into `main`), on all 18 shader patterns but the test card, at Anjin's
   request: "a pattern will describe its own interface as part of the
   pattern api". See T33 in the task record. Not done: the "whether it may
   be mutated" flag, which waits for step 4.*
2. **Favourites and categories** in the picker, and the randomizer drawing
   from them.
3. **Variants:** save, load and use in playlists.
4. **The mutation timeline:** mutate, pause, scrub, tweak, replay, branch,
   save. Its state rules go in a pure module with tests, as `tempo.js` and
   `mixer.js` do.
5. **Parameters for the remaining shader patterns,** then the ports, batch
   by batch.
6. **Export and import** of variants and timelines.

## T34: a cleaner UI

Anjin's words were "entire UI needs cleaned up for functionality". What
that covers is to be agreed with Anjin; these are the faults seen so far, in
the session's screenshots and in use:

- **The pattern picker** is a grid of 142 buttons with no search, favourites
  or filter (see T33, part 2).
- **Controls are scattered:**
  - Sparkles, an effect over every pattern, sits under Look in the Patterns
    view.
  - Tempo is in both the Mixer view (tap) and Setup (source, mode).
  - Key colours are in Setup.
- **Setup carries everyday controls** among the one-time ones: audio input,
  tempo and silence handling sit with the matrix host and size.
- **One long column per view,** whose panels change with the selected
  pattern, so a control's place moves.
- **Status is spread out:**
  - the streaming state and target are in the header;
  - render and send rates are under the preview;
  - tempo and key are in Setup's readouts and the Monitor;
  - errors are in one line.
- **Safari** has not been looked at by a session since the quad mixer.

**A way to go about it:**

1. **List the tasks the UI is for,** with Anjin: set up a panel, pick
   and change patterns live, mix, run a playlist or the randomizer, watch
   the music, tune.
2. **Walk each task in the current UI,** counting clicks and where the eye
   has to go, with screenshots, saved with the work.
3. **Propose a layout:**
   - live controls in one place;
   - setup out of the way;
   - one status strip;
   - effects (sparkles, later texture) together.

   The proposal could be a mock-up page for Anjin to react to before
   any change. *The first such mock-up, the quad mixer (T16), was agreed as
   the MVP on 2026-10-16, with the layout to be flexible from the start;
   see T16 in the task record.*
4. **Change it in steps,** each one tried by Anjin, Safari included.

T33's picker and editor should be designed inside this layout rather than
added to the current one, so T34's first steps (1 to 3) come before T33's
UI work. T33's parameter interface (step 1) does not depend on the layout.
