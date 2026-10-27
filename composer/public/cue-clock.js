// The cue-list clock (T76): where a cue list is in its track, counted in
// beats from the track's first downbeat, on the composer's beat clock. Pure:
// it is given the beat clock's position and says which cue to show.
//
// - Go, pressed on the track's first downbeat, makes that beat the track's
//   start. Each cue is placed in bars and beats from the start; a cue shows
//   once the track reaches it, which is always on one of the track's beats.
// - Next and Back show the next or previous cue on the track's next bar
//   line, and move the clock so the cue's own place is there: the DJ is ahead
//   or behind the plan, and the cues after it follow from there.
// - Hold stops the track's position, as when the DJ loops; Release goes on
//   from where it stopped.
// - Seek moves to any place, again on the next bar line, showing only the
//   cue in force there, not the ones passed. Scrubbing (T76, later) uses it.

export const BEATS_PER_BAR = 4;

// A cue's place in beats from the track's start, or null when it is placed
// by a marker this clock does not know yet (the DJ's mix-out, cue points,
// breaks).
export function cueBeat(at) {
  if (!at || at.marker !== 'start') return null;
  return at.bars * BEATS_PER_BAR + at.beats;
}

export class CueClock {
  // `places`: each cue's place in beats from the start, or null, in the cue
  // list's order. Cues are taken in order of place; equal places keep their
  // order.
  constructor(places) {
    this.order = places.map((place, index) => ({ place, index }))
      .filter((cue) => Number.isFinite(cue.place))
      .sort((a, b) => a.place - b.place || a.index - b.index);
    this.stop();
  }

  stop() {
    this.origin = null;
    this.current = null;
    this.pending = null;
    this.held = null;
  }

  get playing() {
    return this.origin !== null;
  }

  // Go: `beat` on the beat clock is the track's first downbeat, taken to the
  // nearest whole beat. Before the beat clock has a position, nothing starts.
  go(beat) {
    this.stop();
    if (Number.isFinite(beat)) this.origin = Math.round(beat);
  }

  // The track's position in beats from its start.
  trackBeat(beat) {
    if (!this.playing) return null;
    return this.held ?? beat - this.origin;
  }

  hold(beat) {
    if (this.playing && this.held === null) this.held = beat - this.origin;
  }

  release(beat) {
    if (this.held === null) return;
    this.origin = beat - this.held;
    this.held = null;
  }

  // The beat clock's beat of the track's next bar line after `beat`.
  nextBarLine(beat) {
    const track = beat - this.origin;
    return this.origin + Math.ceil((track + 1e-9) / BEATS_PER_BAR) * BEATS_PER_BAR;
  }

  // Where in `order` the cue showing is, or -1.
  position() {
    return this.order.findIndex((cue) => cue.index === this.current);
  }

  next(beat) {
    const target = this.order[this.position() + 1];
    if (target) this.seek(beat, target.place);
  }

  back(beat) {
    const target = this.order[Math.max(0, this.position() - 1)];
    if (target) this.seek(beat, target.place);
  }

  // Moves the track to `place` (beats from its start) on the next bar line.
  // A hold ends.
  seek(beat, place) {
    if (!this.playing) return;
    if (this.held !== null) this.release(beat);
    this.pending = { at: this.nextBarLine(beat), place };
  }

  // The cue in force at a place: the last one at or before it, or null.
  cueAt(place) {
    let found = null;
    for (const cue of this.order) {
      if (cue.place > place) break;
      found = cue.index;
    }
    return found;
  }

  // Called each frame: returns the index of the cue to show when it changes,
  // otherwise null.
  tick(beat) {
    if (!this.playing) return null;
    if (this.pending && beat >= this.pending.at) {
      this.origin = this.pending.at - this.pending.place;
      this.pending = null;
    }
    const index = this.cueAt(this.trackBeat(beat));
    if (index === null || index === this.current) return null;
    this.current = index;
    return index;
  }

  // What the cue list shows: the bar and beat in the track (from 1), the cue
  // showing, the next cue and the beats to it, whether it is held, and a
  // change waiting for the bar line.
  status(beat) {
    if (!this.playing) return null;
    const track = this.trackBeat(beat);
    const upcoming = this.order.find((cue) => cue.place > track) ?? null;
    return {
      bar: Math.floor(track / BEATS_PER_BAR) + 1,
      beat: Math.floor(((track % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR) + 1,
      current: this.current,
      next: upcoming?.index ?? null,
      beatsToNext: upcoming ? upcoming.place - track : null,
      held: this.held !== null,
      waiting: this.pending !== null,
    };
  }
}
