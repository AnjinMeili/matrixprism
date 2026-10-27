# Cue lists by track (T76)

A VJ shows looks that fit the track playing, and changes them where the
track changes. This plan adds cue lists: a list of looks for one track,
named by the track, placed on its bars. The DJ can steer the list to their
own mix, above all to where they plan to mix out.

## What other tools do

Every serious tool for following a DJ works per track (see the research
summary in [findings.md](findings.md), "DJs and VJs"):
- **Resolume with Pioneer players** links a clip to a track and follows its
  playhead.
- **Beat Link Trigger** places cues on a track's beat grid, with events for
  entering a cue on the beat or late.
- **SoundSwitch** keeps a scripted light show per track, with Autoloops for
  tracks that have none.
- **rekordbox's Lighting mode** maps each phrase of a track (intro, build,
  break, drop, outro) to a scene.

The common shape:
- one show per track, found by the track;
- cues on the track's bars or phrases;
- something automatic for tracks with no show.

## The cue list

A cue list is a playlist (playlists are the composer's one save; see T72)
that belongs to a track:

- **Named by the track**, "Artist – Title". It also keeps the track's
  identifiers, where it has them, so it can be found automatically: an
  ISRC, the DJ software's own id, the file name. It keeps the track's BPM
  as well.
- **Its entries are cues.** Each is a look, as a playlist entry already holds,
  placed by **where**, not by seconds:
  - **Bars from a marker.** The markers are the **start** (the track's first
    downbeat), **mix-out** (where the DJ plans to leave the track), the DJ's
    **cue points**, and the **breaks** the composer detects (section changes).
    "16 bars after the start", "8 bars before mix-out" and "on the second
    break" are all cues.
  - **A fade:** how the cue arrives, as a cut or over some beats.
- **Actions,** not just a look. Each cue carries a list of actions, and
  showing a look is the only kind at first. Later kinds plug in without
  changing what a cue list is: laser cues and DMX scenes (stage 6).
- **A cue placed from mix-out moves when the mix-out moves.** That is how the
  DJ's plan reaches the VJ: set the mix-out earlier or later, and the
  outro's cues follow.

## What today's build keeps for later

The later plan (strips, one view, options, lasers and DMX) shapes the data
and logic built now, so the interface can grow into it without migrating
anything:

1. **A cue is a list of actions.** Showing a look is the first kind; laser
   cues and DMX scenes are added later.
2. **The unit is a pair:** two inputs and the pair's mix, loadable into
   either pair. A save of the whole quad is two pairs.
3. **A cue holds options,** as a list, even while only the first is used.
4. **Each option has a moment tag:** intro, build, drop, break, outro or none.
5. **Timing is one of two kinds:** seconds, as playlists use, or a position
   in bars and beats from a marker.
6. **Markers carry their source:** set by the DJ, learned from a play,
   estimated, or detected. That gives solid against faded later.
7. **A cue list knows its track:** artist, title, identifiers where known
   (ISRC, the DJ software's own), and BPM.
8. **The cue-list clock is a pure module with tests,** as `tempo.js` is. It
   handles a position in beats, Go, Next, Back, Hold, landing on the bar,
   and seeking without firing the cues passed. Seeking is what scrubbing
   will be.
9. **What is playing comes through one interface:** a manual Go first, then
   Link, Serato and djay.
10. **Automation never moves the main fader** unless the VJ arms it.
11. **The saved format has a version,** and export (#26) writes the same
    format.

## Following the track

The cue list steps on the composer's beat clock, in bars, from a **Go** at
the track's first downbeat. What gives the Go, the mix-out and the rest
grows in stages:

1. **By hand.** The VJ picks the track's cue list by name and presses Go on
   the first downbeat. Next, Back, **Hold** (stay on this cue, as when the
   DJ loops) and **Mix out now** steer it. All of these can be learned onto
   MIDI pads, as Tap and Downbeat are, so they can sit on the DJ's
   controller or a VJ's APC40.
2. **The DJ steers it.** The same actions on the DJ's controller let the DJ
   say "starting now", "holding", "mixing out" without a word. With
   **Mix out now**, the outro's cues play from that point.
3. **From the DJ software.** The composer's server reads which track is
   playing on which deck, and picks its cue list itself:
   - **djay Pro** on the same Mac, from its library database, read-only. This
     gives the track, its deck and when it started, within about five
     seconds. It also gives the DJ's **End cue**, which becomes the mix-out
     marker, and the DJ's cue points, which become markers. It does not give
     faders or the play position, and its record format is undocumented, so
     a djay update can break it.
   - **Serato DJ Pro** through its Remote protocol (OSC over TCP, found by
     Bonjour), which Serato's own remote apps use. It gives each deck's
     track, playhead, loops, channel faders and crossfader in real time. It
     is undocumented, and whether it can be used from another computer has
     to be tried. Serato's session history files and Live Playlists are
     slower fallbacks.
   - **Ableton Link** gives tempo and bar phase from djay, Serato (since
     DJ Pro 1.9.3) or any Link app, so cues land on the DJ's bar lines.
4. **Two decks.** The incoming track's cue list plays on the quad's other
   pair, and the master crossfades as the DJ mixes: on Mix out now, over
   the cue's fade, or following the DJ's crossfader where the controller's
   MIDI can be read.
5. **Club rigs.** Pioneer's Pro DJ Link and Denon's StageLinQ give the track,
   its exact position (so loops and jumps are followed), and what is on air.
   These are for later, through the same "what is playing" interface.
6. **Lasers and lights (a stretch goal).** The same cues fire laser cues and
   DMX scenes:
   - **Lasers** over ILDA's network protocols (IDN, Ether Dream). Each
     laser's limits and the path
     optimisation sit in one last stage before its DAC, and blackout and an
     interlock stop it. Nothing scans the audience by default.
   - **DMX** over Art-Net or sACN: the receiver already speaks both as an
     input, and the composer would send them.

   Beat Link Trigger drives laser shows from per-track cues, and SoundSwitch
   sends DMX from per-track scripts, so the shape is proven.

**No cue list for a track.** The randomizer (T72 part 2) runs instead:
looks drift, and jump on breaks. This is SoundSwitch's Autoloop idea.

## The quad as two decks, and scrubbing

*A plan for later (2026-10-27), not for today's interface: the strips, the
one view and the cue options are built after cue lists themselves (stage 1)
have been used at a set.*

The quad mixer lets the VJ judge a pair before it reaches the main: fade
the main to the right pair, set up the left pair, then blend back. Cue
lists follow that:

- **A cue list plays on one pair,** the pair its track is on. The next
  track's cue list loads onto the pair that is off air, to be judged in its
  preview. The blend to the main stays the VJ's.
- **Scrubbing** moves a cue list's playhead:
  - On the pair off air, to look ahead: cues flash past while dragging.
  - On air, to realign with the track after the DJ loops, jumps or mixes out
    early: only the cue where it stops is shown, and it lands on the next
    bar line.

  It snaps to bars, to beats when fine-tuning, and to markers. It moves
  which cue is up, not a pattern's own animation, since stateful patterns
  cannot run backwards.
- **Two vertical strips per pair,** on the Mixer's outer edges, mirrored
  like a DJ mixer's two decks. Distance from the picture is distance in
  time: the pair's picture is now, the strip beside it the near future, the
  strip beyond that the far future.

  ```
   [bars][beats][ Left pair panes ][ Right pair panes ][beats][bars]
  ```

  - **The near strip,** in beats: the open moment (see "One view" below),
    its cue options, and a count down to it in beats, with beat ticks and
    heavier bar lines. Fine scrubbing snaps to beats and options. In silence
    or without a tempo it counts seconds.
  - **The far strip,** in bars: the moments ahead as groups, at bar
    resolution: markers as coloured bands, cues as blocks, and a highlight
    on the open moment. Coarse scrubbing snaps to bars and moments; a click
    opens a moment.
  - **Only the future:** each strip's playhead, at one end, is now.
  - **Two knobs,** one for bars and one for beats, on a MIDI controller such
    as the APC40.
  - **Without a cue list** the strips still show the beat clock, bars,
    detected breaks and a count to the randomizer's next change.
  - **Later:** the track's energy per bar behind the cues.

  It is the shape of DJ software's zoomed waveform beside its overview. The
  panes are already crowded side to side, so the strips use the height they
  have to spare. Cue lists are edited in the Playlist view.

- **What the strips can know.** The near future is fairly safe from the beat
  clock alone. The far future is mostly the VJ's own plan, laid on a
  projected clock; the DJ can always loop, jump or mix out early.

  | What is known | Near strip | Far strip | Mix-out |
  |---|---|---|---|
  | Audio only, track unknown | Our beat clock | The randomizer's next changes | Unknown |
  | Track known, with a cue list from an earlier play | Same | Our cues, and the track's breaks and length from that play | Estimated |
  | Ableton Link | The DJ's bars | Same | Same |
  | The DJ software's playhead (Serato's Remote protocol) | Same | Aligned to the playhead, with the DJ's cue points and loops | The DJ's, if they set a cue |
  | The DJ signals it | | | Known a few bars ahead |

  The strips are solid for what is owned or told (our cues, a mix-out the DJ
  set), faded for projections (the far beat grid, an estimated mix-out), and
  say so when nothing is known.
- **One view, menu and timeline together.** There is no mode switch. A group
  is always shown and a group is always open:
  - **The far strip shows groups: the track's moments ahead,** in time
    order (intro, build, drop, break, outro). When the future is known, that
    is the timeline at bar resolution, solid. When it is not, it is the
    plain list of moments, faded. The coarse knob or a drag scrubs through
    them, with a highlight on the one open.
  - **The near strip always has a moment open,** by default the next one,
    showing its **cue options** with the first armed to fire. The fine knob
    scrubs through the options to change what is armed. Firing puts it on
    the pair at the next bar line.
  - **A cue can carry options:** several alternative looks for one moment.
    Each is tagged with its moment when saved, and the current track's own
    cues come first.
  - **Scrubbing is fast:** it accelerates with the speed of the turn and
    snaps to each item.
  - **Seeing an option before firing it:** off air, the option under the
    playhead shows on the pair. On air, it shows as a thumbnail in the strip
    until it is fired.
  - When the DJ goes off-plan nothing flips: the view simply shows more
    faded, and scrubbing or Return puts it right.
  - A MIDI clip grid such as the APC40's could mirror the open moment's
    options.

## Building a cue list

- **By hand** in the Playlist view: add a cue at a bar or a marker, from the
  look on screen.
- **Learn while the track plays.** Press Go at the first downbeat, then use
  Hotsave as usual. Each press adds the look on screen as a cue at the
  current bar, in the track's cue list. Play the track again and the looks
  come back on the same bars.
- **From the track's breaks.** After one play, the breaks the composer
  detected are kept as markers, so the next pass can place cues on them.

## Stages and their tests

| Stage | Done when | Tested by |
|---|---|---|
| 1. Cue lists named by track (built, T76 stage 1) | A playlist can be a track's cue list, named "Artist – Title" and found by searching that name; cues placed in bars from the start; Go, Next, Back, Hold; cues land on bar lines | Unit tests of the cue timing (bars, markers, Hold), a browser check of Go and the cues landing on bars on the simulated 120 BPM signal |
| 2. Learn and Mix out | Hotsave after Go adds a cue at the current bar; Mix out now moves the mix-out marker and its cues; all actions learnable on MIDI | Unit tests of the marker arithmetic; `check-midi` extended to the new actions |
| 3. djay Pro and Link | A track started in djay selects its cue list within five seconds; djay's End cue becomes the mix-out marker; the beat clock follows Link | A recorded djay database copy (no audio) for the reader's tests; a Link session from a test app; a real DJ set |
| 4. Two decks | The incoming deck's cue list runs on the other pair; the master crossfades at Mix out | `check-quad-view` extended |
| 5. Club rigs | Pro DJ Link or StageLinQ selects and follows tracks | Depends on hardware access |
| 6. Lasers and DMX (stretch) | A cue fires a laser cue and a DMX scene on its bar | A fake IDN or Ether Dream receiver and an Art-Net listener, as `check-receivers` fakes a DDP receiver; real lasers and lights by hand, safety first |

## Open questions

- Which DJ setup comes first: djay Pro on the same Mac as the composer,
  Serato on the DJ's own laptop, or a club rig?
- Is the DJ also the VJ? If so, steering should cost the DJ nothing:
  automatic from djay, with MIDI as the override.
- How a track is identified when names differ between libraries: the ISRC
  where there is one, otherwise "Artist – Title" with a manual link.
- Ableton Link in the composer: a native library (a first npm dependency, in
  the server or the desktop app), or a small JavaScript listener ported from
  Link's GPLv2+ source.
