// Ported from visualizations/beatdetection-helper.js in Spotify's
// visualizer-app, by Per-Olov Jernberg (possan), 2013. Copyright (c) 2013,
// Spotify AB, BSD 3-Clause; licence text in ./NOTICE.md.
//
// A hit is a band rising 10% over its own decaying peak, and over a
// threshold, at three fixed BAND31 bands. setData() runs on each audio
// event, update() on each animation frame (60 a second).

export class BeatDetectionHelper {
  constructor() {
    this.length = 100;
    this.range = 100;
    this.banddata = [[], []];
    this.peaks = [[], []];
    this.low_timer = 0;
    this.mid_timer = 0;
    this.high_timer = 0;
    this.low_peak = false;
    this.mid_peak = false;
    this.high_peak = false;
    this.low_treshold = 80;
    this.mid_treshold = 80;
    this.high_treshold = 70;
    // BAND31 indices: about 40, 50 and 100 Hz.
    this.low_cutoff = 3;
    this.mid_cutoff = 4;
    this.high_cutoff = 7;
  }

  // `left` and `right` are BAND31 levels in decibels.
  setData(left, right) {
    let i, l, x, y, db;

    this.low_peak = false;
    this.mid_peak = false;
    this.high_peak = false;

    for (i = 0, l = left.length; i < l; i++) {
      db = left[i];
      x = Math.round(Math.max(Math.min(Math.floor(db + 60), 72), 0) / 72 * this.range);
      db = right[i];
      y = Math.round(Math.max(Math.min(Math.floor(db + 60), 72), 0) / 72 * this.range);
      this.banddata[0][i] = (x + y) / 2;
    }

    if (this.peaks[0].length === 0)
      this.peaks[0] = this.banddata[0].map(() => 0);

    for (i = 0, l = this.banddata[0].length; i < l; i++) {
      if (this.banddata[0][i] > (this.peaks[0][i] * 1.1)) {
        this.peaks[0][i] = this.banddata[0][i];
        if (i === this.low_cutoff && this.peaks[0][i] > this.low_treshold)
          this.low_peak = true;
        else if (i === this.high_cutoff && this.peaks[0][i] > this.high_treshold)
          this.high_peak = true;
        else if (i === this.mid_cutoff && this.peaks[0][i] > this.mid_treshold)
          this.mid_peak = true;
      }
    }

    if (this.low_peak && this.low_timer > 15) this.low_timer = 0;
    if (this.mid_peak && this.mid_timer > 15) this.mid_timer = 0;
    if (this.high_peak && this.high_timer > 15) this.high_timer = 0;
  }

  update() {
    this.low_peak = false;
    this.mid_peak = false;
    this.high_peak = false;

    this.low_timer++;
    this.mid_timer++;
    this.high_timer++;

    const l = this.banddata[0].length;
    for (let i = 0; i < l; i++)
      this.peaks[0][i] = Math.max(0, this.peaks[0][i] - 2);
  }
}
