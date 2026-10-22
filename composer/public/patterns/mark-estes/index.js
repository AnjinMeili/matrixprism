// Pattern table for the Table_Mark_Estes port. Numbers are the sketch's own
// pattern numbers; `setup` is that pattern's case in whatami() and `run` its
// case in runpattern(). See ./NOTICE.md for provenance and licence status.
import { TmeAnimation } from './runtime.js';
import * as fx from './effects.js';
import * as audio from './audio-effects.js';
import { confetti2, confetti4, triangler, bkstarer } from './decorations.js';

const centre = (t) => {
  t.driftx = t.MIDLX;
  t.drifty = t.MIDLY;
};

const spiralRun = (t) => {
  if (t.flop[6]) centre(t);
  fx.spiraly(t);
  if (t.flop[5]) t.adjustme();
};

export const TME_PATTERNS = [
  {
    number: 4, name: 'Round Hole', description: 'A tunnel of rings, sometimes with orbiting discs',
    setup(t) { t.fancy = 0; },
    run(t) {
      fx.Roundhole(t);
      if (t.flop[5]) fx.spin2(t);
      else if (t.flop[7]) fx.spire3(t);
      t.adjustme();
    },
  },
  {
    number: 10, name: 'Fireball', description: 'Sparks streaming from a drifting centre, mirrored',
    setup(t) { t.shifty = 1; t.adjunct = t.square ? t.random(1, 15) : t.random(1, 6); },
    run(t) { fx.fireball(t); t.adjustme(); },
  },
  {
    number: 11, name: 'Square Warp', description: 'Nested squares flying outwards',
    setup(t) { t.adjunct = 0; t.bfade = t.random(6, 9); },
    run(t) { fx.whitewarp(t); },
  },
  {
    number: 14, name: 'Spire', description: 'Six discs orbit on two breathing rings',
    setup(t) { t.adjunct = 0; t.fancy = 0; t.targetfps = t.random(12, 25); },
    run(t) { fx.spire2(t); if (t.flop[0] && t.flop[1]) t.adjustme(); },
  },
  {
    number: 23, name: 'Triforce', description: 'Nested rotating triangles with coloured fades',
    setup(t) { t.bfade = t.random(6, 9); },
    run(t) { fx.triforce(t); if (t.flop[6] && (t.flop[1] || !t.flop[2])) t.adjustme(); },
  },
  {
    number: 25, name: 'Spire Six', description: 'Six discs on one breathing ring',
    setup(t) { t.adjunct = 0; t.targetfps = t.random(15, 30); },
    run(t) { fx.spire(t); if (t.flop[2]) t.adjustme(); },
  },
  {
    number: 26, name: 'Three Ring Circus', description: 'Three large circles orbiting the centre',
    setup(t) {
      t.steper = t.mstep;
      t.targetfps = t.random(15, 30);
      if (t.flop[6]) { t.bfade = 3; t.adjunct = 3; t.wind = 2; t.fancy = 0; }
    },
    run(t) { fx.sinx(t); if (t.flop[7] || t.flop[5]) t.adjustme(); },
  },
  {
    number: 60, name: 'Fireball Confetti', description: 'Fireball with confetti, a star and more mirrors',
    setup(t) {
      if (t.square) t.adjunct = t.random(2, 15);
      if (t.flop[0]) {
        t.dot = 2; t.adjunct = 3; t.wind = 7; t.fancy = t.random(1, 32); t.bfade = t.random(3, 8);
      }
    },
    run(t) { if (t.flop[0] || t.flop[1]) confetti4(t); fx.fireball(t); t.adjustme(); },
  },
  {
    number: 62, name: 'Warp', description: 'Nested discs flying outwards, sometimes with confetti',
    run(t) { fx.warp(t); if (t.flop[2]) confetti4(t); t.adjustme(); },
  },
  {
    number: 67, name: 'Hypno Spiral II', description: 'A long two-colour spiral that winds in and out',
    setup(t) { t.adjunct = 0; },
    run(t) { fx.hypnoduck2(t); },
  },
  {
    number: 69, name: 'Drops', description: 'Falling rain streaks with a mirror effect',
    setup(t) { t.fancy = t.random(1, 24); },
    run(t) { fx.drops(t); t.adjustme(); },
  },
  {
    number: 70, name: 'Spin', description: 'Four large discs on crossed elliptical orbits',
    run(t) { fx.spin2(t); if (!t.flop[0] || t.flop[1]) t.adjustme(); },
  },
  {
    number: 77, name: 'White Warp', description: 'Square warp with paired decorations',
    setup(t) { t.wind = 0; t.fancy = t.random(15, 19); },
    run(t) { fx.whitewarp(t); },
  },
  {
    number: 80, name: 'Starz', description: 'Three orbiting many-pointed stars, mirrored',
    run(t) { fx.starz(t); t.adjustme(); },
  },
  {
    number: 82, name: 'Swirl', description: 'Counter-rotating rings of orbiting points',
    setup(t) { t.wind = 0; t.fancy = 0; t.bfade = t.random(6, 9); },
    run(t) { fx.swirl2(t); },
  },
  {
    number: 87, name: 'Wheels', description: 'A turning ring of shrinking discs',
    setup(t) { if (t.flop[7] || t.flop[9] || t.flop[6]) t.adjunct = 3; },
    run(t) { fx.wheelz2(t); if (t.flop[6]) t.adjustme(); },
  },
  {
    number: 103, name: 'Hypno Spiral', description: 'A growing double spiral, sometimes through a warp field',
    setup(t) { t.wind = 0; t.fancy = 0; },
    run(t) { if (t.flop[7] && t.flop[9]) fx.whitewarp(t); fx.hypnoduck3(t); },
  },
  {
    number: 104, name: 'Circle Arc', description: 'Arcs of discs swinging out from the corners',
    run(t) { fx.circlearc(t); },
  },
  {
    number: 105, name: 'Hypno Spiral IV', description: 'A pulsing spiral over black or a colour wash',
    setup(t) { t.wind = 0; if (t.flop[0]) t.fancy = 0; },
    run(t) { fx.hypnoduck4(t); },
  },
  {
    number: 110, name: 'Tiny Bubbles', description: 'Many small bouncing squares or discs',
    setup(t) { t.fancy = 0; },
    run(t) { fx.tinybubbles(t); },
  },
  {
    number: 111, name: 'Bubbles', description: 'Large bouncing discs with heavy trails',
    setup(t) { t.bfade = 10; t.fancy = 0; },
    run(t) { fx.bubbles2(t); },
  },
  {
    number: 115, name: 'Streaker Hypno', description: 'Two spirals with stars streaming from the centre',
    setup(t) { t.targetfps = t.random(30, 50); t.fancy = 0; t.wind = 0; },
    run(t) { fx.streaker(t); fx.hypnoduck(t); },
  },
  {
    number: 124, name: 'Tiny Bubbles II', description: 'Many small bouncing squares or discs',
    setup(t) { t.fancy = 0; },
    run(t) { fx.tinybubbles(t); },
  },
  {
    number: 134, name: 'Helix Spiral', description: 'Spiral arms twisted into a helix, with wind',
    setup(t) {
      t.targetfps = t.random(6, 30);
      if (t.flop[3]) t.adjunct = t.random8() >> 1;
      t.wind = t.wind * 2 + 1;
      t.fancy = 0;
      t.bfade = t.random(3, 6);
      t.flop[1] = true;
      t.flop[7] = true;
    },
    run: spiralRun,
  },
  {
    number: 146, name: 'Disc Wheel', description: 'Offset rainbow discs turning about the centre',
    setup(t) { t.fancy = 0; t.wind = 0; t.bfade++; },
    run(t) { fx.wheelz3(t); t.adjustme(); },
  },
  {
    number: 150, name: 'Fat Fire', description: 'Noise fire in one of nine palettes',
    setup(t) { t.wind = 0; t.adjunct = 0; t.fancy = 0; },
    run(t) { fx.fire2(t); },
  },
  {
    number: 155, name: 'Star Bubbles', description: 'Bouncing nested stars over a colour wash or black',
    setup(t) { t.bfade = 99; t.fancy = 0; t.wind = 0; t.targetfps = t.random(10, 20); },
    run(t) {
      if (t.flop[5] || t.flop[7]) { fx.solid5(t); centre(t); }
      else if (t.flop[6]) fx.solidblack(t);
      fx.starbubbles88(t);
    },
  },
  {
    number: 162, name: 'Seasick', description: 'Two crossed colour waves, mirrored',
    setup(t) { t.adjunct = t.random(1, 3) * 4; },
    run(t) { fx.seasick6(t); t.adjustme(); },
  },
  {
    number: 187, name: 'Iris', description: 'Large discs merging like a camera shutter',
    setup(t) { t.bfade = t.random(2, 5); },
    run(t) { fx.iris(t); },
  },
  {
    number: 190, name: 'Spiral', description: 'Classic multi-arm spiral, with wind',
    setup(t) {
      t.targetfps = t.random(6, 30);
      if (t.flop[5]) t.adjunct = 4;
      t.wind = t.wind * 2 + 1;
      t.fancy = 0;
      t.bfade = t.random(3, 6);
      t.flop[1] = false;
      t.flop[7] = true;
    },
    run: spiralRun,
  },
];


// Patterns from Marc Merlin's "good but not picked" list.
const THIRD_BATCH = [
  {
    number: 17, name: 'Warp Fade', description: 'Warp discs with gentle colour fades',
    setup(t) { t.adjunct = 0; t.bfade = t.random(118, 121); },
    run(t) { fx.warp(t); },
  },
  {
    number: 19, name: 'Three Rings Slow Fade', description: 'Three orbiting circles with long trails and rings',
    setup(t) {
      if (t.flop[5] || t.flop[4]) t.adjunct = 0;
      t.fancy = t.flop[2] && t.flop[3] ? 2 : 9;
      t.bfade = t.random(100, 102);
      t.targetfps = 20;
    },
    run(t) { fx.sinx(t); if (t.flop[0] && !t.flop[2]) t.adjustme(); },
  },
  {
    number: 53, name: 'Seasick II', description: 'Two waving colour bands, mirrored',
    setup(t) { t.bfade = t.random(2, 6); t.fancy = 0; if (t.flop[6] || t.flop[7]) t.adjunct = t.random(2, 4); },
    run(t) { fx.seasick2(t); t.adjustme(); },
  },
  {
    number: 55, name: 'Seasick Red Blue', description: 'Red and blue seas with coloured swells',
    setup(t) { t.bfade = t.random(2, 6); t.fancy = 0; t.wind = 0; },
    run(t) { fx.seasick(t); },
  },
  {
    number: 58, name: 'Square Warp Twister', description: 'Square warp, mirrored, with changing wind',
    run(t) { fx.whitewarp(t); t.adjustme(); if (t.flop[1] && t.wind < 9) fx.twister(t); },
  },
  {
    number: 59, name: 'Fireball Plain', description: 'Sparks streaming from a drifting centre',
    setup(t) { t.adjunct = 0; },
    run(t) { fx.fireball(t); },
  },
  {
    number: 66, name: 'Dual Hypno', description: 'Two orbiting double spirals',
    setup(t) { if (t.wind % 2 !== 0) t.wind--; },
    run(t) { fx.hypnoduck(t); if (t.flop[9]) t.adjustme(); },
  },
  {
    number: 72, name: 'Homer', description: 'Points homing in along turning spokes',
    setup(t) { t.bfade = t.random(1, 4); },
    run(t) { fx.homer(t); },
  },
  {
    number: 75, name: 'Seasick Mirrored', description: 'Two crossed colour waves with long trails',
    setup(t) { t.bfade = t.random(2, 5); t.fancy = 0; },
    run(t) { fx.seasick6(t); t.adjustme(); },
  },
  {
    number: 79, name: 'Starz III', description: 'One large star of nested outlines',
    setup(t) { t.wind = 0; },
    run(t) { fx.starz3(t); t.adjustme(); },
  },
  {
    number: 81, name: 'Starz II', description: 'A nested star with wind',
    setup(t) { t.wind = 2 * t.wind + 1; },
    run(t) { fx.starz2(t); t.adjustme(); },
  },
  {
    number: 88, name: 'Triforce Fade', description: 'Nested rotating triangles with decorations',
    setup(t) { t.fancy = t.random(10); t.bfade = 3; },
    run(t) { fx.triforce(t); if (t.flop[4]) t.adjustme(); },
  },
  {
    number: 96, name: 'Triangler', description: 'Expanding triangles and other decorations',
    setup(t) { t.fancy = t.random(2, 12); },
    run(t) { triangler(t); },
  },
  {
    number: 101, name: 'Confetti Warp', description: 'Confetti and a star, usually with warp discs',
    run(t) { confetti4(t); if (t.flop[0] || t.flop[1] || t.flop[2]) fx.warp(t); },
  },
  {
    number: 102, name: 'Seasick IV', description: 'Rainbow seas with a waving ribbon',
    setup(t) { if (t.flop[4] || t.flop[5]) t.wind = 3; t.bfade = t.random(1, 5); t.fancy = 0; },
    run(t) { fx.seasick4(t); },
  },
  {
    number: 107, name: 'Floaty Star', description: 'A large nested star with rings and star bursts',
    setup(t) { if (t.flop[9] || t.flop[8]) t.fancy = t.random(6, 9); },
    run(t) {
      for (let j = 1; j < t.W - 8; ++j)
        t.drawstar(t.driftx, t.drifty, j, j >> 1, 7, 2 * t.h, t.h + j * 4);
      if (t.flop[0]) fx.rmagictime(t);
      bkstarer(t);
      t.adjustme();
    },
  },
  {
    number: 108, name: 'Square Warp Rings', description: 'Square warp with expanding rings',
    setup(t) { t.adjunct = t.square ? t.random(2, 15) : t.random(2, 6); },
    run(t) { fx.whitewarp(t); fx.rmagictime(t); if (t.flop[1] && t.flop[2] && t.wind < 9) fx.twister(t); },
  },
  {
    number: 112, name: 'Seasick V', description: 'Two seas with an additive waving band',
    setup(t) { t.bfade = t.random(2, 6); t.fancy = 0; if (t.wind < 9) t.wind = 3; },
    run(t) { fx.seasick5(t); },
  },
  {
    number: 113, name: 'Homer III', description: 'A denser field of homing points',
    setup(t) { t.bfade = t.random(2, 4); },
    run(t) { fx.homer3(t); },
  },
  {
    number: 114, name: 'Drops with Wind', description: 'Rain streaks blown sideways',
    setup(t) { t.bfade = t.random(2, 4); t.wind = t.random(6, 11); t.fancy = 0; },
    run(t) { fx.drops(t); },
  },
  {
    number: 118, name: 'Drops and Spin', description: 'Rain behind four orbiting discs',
    setup(t) {
      t.targetfps = t.random(9, 30); t.bfade = t.random(1, 4);
      if (t.flop[0] || t.flop[1]) t.wind = 0;
      t.fancy = 0;
    },
    run(t) { fx.drops(t); fx.spin2(t); },
  },
  {
    number: 119, name: 'Spin with Wind', description: 'Four orbiting discs smeared by wind',
    setup(t) { t.targetfps = t.random(9, 30); t.bfade = t.random(1, 4); t.wind = t.flop[0] ? 8 : 9; },
    run(t) { fx.spin2(t); },
  },
  {
    number: 120, name: 'Windy Drops', description: 'Fast rain with changing wind',
    setup(t) {
      t.targetfps = t.random(25, 38); t.bfade = t.random(1, 5); t.wind = t.random(2, 5);
      if (t.square) t.adjunct = 11;
      t.fancy = 0;
    },
    run(t) { fx.drops(t); fx.twister(t); if (t.flop[5]) t.adjustme(); },
  },
  {
    number: 128, name: 'Magic Time', description: 'Shrinking discs with confetti and decorations',
    setup(t) { t.targetfps = t.random(5, 20); t.bfade = 2; t.fancy = t.random(1, 32); },
    run(t) { fx.magictime(t); t.adjustme(); if (t.flop[2]) confetti2(t); else confetti4(t); },
  },
  {
    number: 131, name: 'Seasick Fast', description: 'Two crossed colour waves at a high frame rate',
    setup(t) {
      t.targetfps = t.random(20, 60); t.bfade = t.random(108, 111);
      if (t.flop[2] || t.flop[3]) t.fancy = 0;
    },
    run(t) { fx.seasick6(t); },
  },
  {
    number: 147, name: 'Square Warp Kaleidoscope', description: 'Square warp whose mirror changes every 30 seconds',
    setup(t) { t.adjunct = t.square ? 12 : t.random(8, 10); },
    run(t) {
      fx.whitewarp(t);
      t.adjustme();
      if (t.every('pattern147', 30)) {
        t.adjunct = t.square ? t.random(15) : t.random(6);
        t.flop[6] = !t.flop[6];
      }
    },
  },
  {
    number: 158, name: 'Tuber', description: 'A tunnel of expanding rings or stars',
    setup(t) {
      t.shifty = 1; t.fancy = t.random(15);
      if (t.random8() > 128) t.adjunct = 5;
      t.bfade = t.random(108, 111);
    },
    run(t) { fx.tuber(t); t.adjustme(); },
  },
];
TME_PATTERNS.push(...THIRD_BATCH);
TME_PATTERNS.sort((a, b) => a.number - b.number);

// Wind and mirror choices shared by the capped-bar patterns 30 and 31.
const barSetup = (t) => {
  t.adjunct = 5;
  t.wind = !t.flop[0] ? 10 : t.flop[1] ? 2 : 8;
  t.bfade = !t.flop[0] ? 3 : 2;
  t.fancy = 0;
};

// Audio-driven patterns. With no sound they follow the sketch's own
// stand-in, in which every band bobs at its own rate.
const AUDIO_BATCH = [
  {
    number: 30, name: 'Audio Bars', description: 'Spectrum bars with two coloured caps, mirrored with wind',
    setup(t) { barSetup(t); t.targetfps = 30; },
    run(t) { audio.audio2(t); t.adjustme(); },
  },
  {
    number: 31, name: 'Audio Bars Tricolour', description: 'Spectrum bars with three coloured caps, mirrored with wind',
    setup(t) { barSetup(t); t.targetfps = 35; },
    run(t) { audio.audio3(t); t.adjustme(); },
  },
  {
    number: 32, name: 'Audio Side Bars', description: 'Spectra growing in from the left and right edges',
    setup(t) { t.bfade = t.random(1, 3); t.adjunct = 0; t.fancy = 0; t.wind = t.flop[0] ? 9 : 0; t.targetfps = 35; },
    run(t) { audio.audio8(t); },
  },
  {
    number: 36, name: 'Audio Spokes', description: 'Spectrum spokes reaching in from the rim, sometimes over a colour wash',
    setup(t) { t.bfade = t.random(2, 5); t.adjunct = 0; t.targetfps = 30; },
    run(t) {
      if (t.flop[1]) t.driftx = t.MIDLX;
      if (t.flop[2]) t.drifty = t.MIDLY;
      if (t.flop[1] && t.flop[2] && !t.flop[0]) { audio.solid3(t); t.bfade = 0; }
      audio.Raudio5(t);
    },
  },
  {
    number: 42, name: 'Audio Spokes Fast', description: 'Rim spokes at a high frame rate, sometimes mirrored with wind',
    setup(t) {
      t.fancy = 0;
      if (t.flop[0]) { t.adjunct = t.square ? 11 : 4; t.wind = 6; }
      else t.adjunct = t.flop[1] ? 9 : 0;
      t.targetfps = 99;
    },
    run(t) { centre(t); audio.Raudio15(t); t.adjustme(); },
  },
  {
    number: 43, name: 'Audio Spokes Mirrored', description: 'Rim spokes with mirrors and wind',
    setup(t) {
      if (t.flop[0]) { t.adjunct = t.square ? 11 : t.random(2, 6); t.wind = 6; }
      else if (t.flop[1]) t.adjunct = t.square ? 12 : t.random(2, 6);
      else t.adjunct = 0;
      t.targetfps = 30;
      if (t.wind < 9) t.bfade = 4;
    },
    run(t) { centre(t); audio.Raudio5(t); t.adjustme(); },
  },
  {
    number: 49, name: 'Audio Spokes Kaleidoscope', description: 'Rim spokes, always mirrored',
    setup(t) {
      t.bfade = t.random(3, 6); t.fancy = 0;
      t.adjunct = t.square ? 12 : t.random(2, 6);
      t.targetfps = 30;
      t.flop[2] = true;
    },
    run(t) { centre(t); audio.Raudio5(t); t.adjustme(); },
  },
  {
    number: 52, name: 'Audio Centre Bars', description: 'Spectra above and below the centre line, with wind',
    setup(t) {
      t.bfade = t.random(3, 5); t.adjunct = 0; t.fancy = 0;
      if (t.wind < 9) t.wind = t.random(1, 4);
      t.targetfps = 30;
    },
    run(t) { audio.audio10(t); t.adjustme(); },
  },
  {
    number: 129, name: 'Audio Roger', description: 'Spectrum bursts over a prism and beam',
    setup(t) { t.bfade = t.random(2, 5); t.adjunct = 0; t.targetfps = 30; },
    run(t) {
      t.locusy = t.H * 0.333;
      t.locusx = t.MIDLX;
      audio.RaudioRoger(t);
      if (t.flop[1]) { t.locusy = t.H; audio.LaudioRoger(t); }
      audio.rogerv(t);
    },
  },
  {
    number: 130, name: 'Audio Roger Double', description: 'Three spectrum bursts over a prism and beam',
    setup(t) { t.bfade = t.random(2, 5); t.adjunct = t.random(64); t.targetfps = 30; },
    run(t) {
      t.locusy = 0; t.locusx = 0;
      audio.RaudioRoger(t);
      t.locusx = t.W;
      audio.LaudioRoger(t);
      t.locusy = t.H + (t.MIDLY >> 2); t.locusx = t.MIDLX;
      audio.RaudioRoger(t);
      audio.rogerv(t);
      t.adjustme();
    },
  },
  {
    number: 137, name: 'Audio Top and Bottom', description: 'Spectra from the top and bottom edges, pushed apart by wind',
    setup(t) { t.bfade = t.random(3, 5); t.adjunct = 0; t.fancy = 0; t.wind = 10; t.targetfps = 30; },
    run(t) { if (t.flop[5]) audio.solid2(t); audio.audio11(t); },
  },
  {
    number: 138, name: 'Audio Centre Bars Split', description: 'Centre-line spectra with a north-south wind',
    setup(t) { t.bfade = t.random(3, 5); t.adjunct = 0; t.fancy = 0; t.targetfps = 30; t.wind = 9; },
    run(t) { audio.audio10(t); },
  },
].map(pattern => ({ ...pattern, audioReactive: true }));
TME_PATTERNS.push(...AUDIO_BATCH);
TME_PATTERNS.sort((a, b) => a.number - b.number);

const centreIf = (t) => {
  if (t.flop[1]) t.driftx = t.MIDLX;
  if (t.flop[2]) t.drifty = t.MIDLY;
};

// Two Raudio4 bursts turning opposite ways at one-third and two-thirds.
const twinBursts = (t, first, second) => {
  for (const fraction of [first, second]) {
    t.flop[3] = !t.flop[3];
    t.driftx = Math.trunc(t.W * fraction / 3);
    t.drifty = Math.trunc(t.H * fraction / 3);
    audio.Raudio4(t);
  }
  if (t.flop[1] && t.wind < 9) fx.twister(t);
};

const AUDIO_BATCH_2 = [
  {
    number: 33, name: 'Audio Rim Stereo', description: 'Interleaved left and right spokes from the rim, split by wind',
    setup(t) { t.bfade = t.random(1, 3); t.adjunct = 0; t.fancy = 0; t.wind = 10; t.targetfps = 30; },
    run(t) { if (t.flop[6]) centre(t); audio.Raudio2(t); },
  },
  {
    number: 34, name: 'Audio Double Ring', description: 'Left spectrum as an inner burst, right as an outer ring',
    setup(t) {
      t.bfade = t.random(2, 5); t.adjunct = 0; t.fancy = 0;
      if (t.flop[2] || !t.flop[1]) t.wind = 9;
      t.targetfps = 30;
    },
    run(t) { centreIf(t); if (t.flop[0]) audio.Raudio3(t); else audio.Raudio14(t); },
  },
  {
    number: 35, name: 'Audio Burst', description: 'A turning burst of spectrum spokes',
    setup(t) { t.bfade = t.random(1, 5); t.adjunct = 0; t.targetfps = 30; },
    run(t) { centreIf(t); audio.Raudio4(t); },
  },
  {
    number: 38, name: 'Audio Twin Bursts', description: 'Two counter-turning spectrum bursts',
    setup(t) { t.bfade = t.random(2, 4); t.adjunct = 0; t.fancy = 0; t.targetfps = 30; },
    run(t) { twinBursts(t, 1, 2); },
  },
  {
    number: 39, name: 'Audio Burst and Rim', description: 'A right-channel burst inside left and right rim spokes',
    setup(t) { t.bfade = t.random(2, 5); t.adjunct = 0; t.targetfps = 30; },
    run(t) { if (t.flop[1] && t.wind < 9) fx.twister(t); audio.Raudio13(t); audio.Raudio1(t); },
  },
  {
    number: 40, name: 'Audio Outline', description: 'Two dotted outlines shaped by the spectra, mirrored',
    setup(t) { t.adjunct = t.square ? 11 : t.flop[0] ? 5 : 3; t.bfade = t.random(1, 4); t.targetfps = 30; },
    run(t) { centre(t); audio.Raudio6(t); t.adjustme(); },
  },
  {
    number: 44, name: 'Audio Burst in Rim', description: 'A spectrum burst inside rim spokes',
    setup(t) { t.bfade = t.random(2, 5); t.fancy = 0; t.targetfps = 30; },
    run(t) {
      if (t.flop[6]) centre(t);
      audio.Raudio4(t);
      audio.Raudio5(t);
      if (t.flop[7] && t.flop[5]) t.adjustme();
    },
  },
  {
    number: 47, name: 'Audio Twin Bursts in Rim', description: 'Two mirrored bursts inside rim spokes',
    setup(t) { t.bfade = t.random(2, 5); t.fancy = 0; if (t.adjunct === 6) t.adjunct = 3; t.targetfps = 30; },
    run(t) { twinBursts(t, 2, 1); t.adjustme(); audio.Raudio5(t); },
  },
  {
    number: 50, name: 'Audio Tied Bars', description: 'Centre-line bars over a colour wash, with wind',
    setup(t) {
      t.bfade = t.random(1, 4); t.adjunct = 0; t.fancy = 0;
      if (t.wind < 9) t.wind = t.random(1, 4);
      t.targetfps = 30;
    },
    run(t) { audio.solid2(t); audio.audio9(t); t.adjustme(); },
  },
].map(pattern => ({ ...pattern, audioReactive: true }));
TME_PATTERNS.push(...AUDIO_BATCH_2);
TME_PATTERNS.sort((a, b) => a.number - b.number);

// Wind and fade choices shared by the board patterns; `a` and `b` are the
// two wind directions the pattern may use.
const boardSetup = (t, a, b, maxFade) => {
  t.bfade = t.random(1, maxFade);
  t.fancy = 0;
  t.wind = 0;
  if (t.flop[3] || t.flop[2]) {
    t.wind = t.flop[3] ? a : b;
    t.bfade = t.random(3, 5);
  }
  t.targetfps = 30;
};

const AUDIO_BATCH_3 = [
  {
    number: 22, name: 'Audio Checkers Centred', description: 'Sixteen squares that grow from their centres, one per band',
    setup(t) { boardSetup(t, 4, 6, 3); },
    run(t) { audio.audocheckers2(t); },
  },
  {
    number: 27, name: 'Audio Twin Lines', description: 'Left and right spectra about two lines, split by wind',
    setup(t) {
      t.bfade = t.random(108, 111);
      if (t.flop[2] || t.flop[3]) t.fancy = 0;
      t.targetfps = 30; t.wind = 9;
    },
    run(t) { audio.audio12(t); if (t.flop[7] && t.flop[5]) t.adjustme(); },
  },
  {
    number: 28, name: 'Audio Dot Rings Windy', description: 'Two spectrum rings of dots with changing wind',
    setup(t) { t.bfade = t.random(1, 5); t.fancy = 0; t.wind = t.flop[0] ? 13 : 8; t.targetfps = 30; },
    run(t) { if (t.flop[5]) centre(t); audio.Raudio19(t); fx.twister(t); },
  },
  {
    number: 29, name: 'Audio Dot Rings', description: 'Two spectrum rings of dots or discs',
    setup(t) { t.bfade = t.random(2, 6); t.fancy = 0; t.targetfps = 30; },
    run(t) { centre(t); audio.Raudio19(t); if (t.flop[1] && t.wind < 9) fx.twister(t); },
  },
  {
    number: 37, name: 'Audio Dot Rings Mirrored', description: 'Two spectrum rings of dots, mirrored',
    setup(t) { t.bfade = t.random(2, 4); t.fancy = 0; if (t.wind % 2 !== 0) t.wind--; t.targetfps = 30; },
    run(t) {
      if (t.flop[7]) t.driftx = t.MIDLX;
      if (t.flop[5]) t.drifty = t.MIDLY;
      audio.Raudio19(t);
      t.adjustme();
    },
  },
  {
    number: 45, name: 'Audio Checkers', description: 'Sixteen squares that grow from their corners, one per band',
    setup(t) { boardSetup(t, 4, 6, 3); },
    run(t) { audio.audocheckers(t); },
  },
  {
    number: 51, name: 'Audio Chess', description: 'Sixteen discs sized by the left and right bands',
    setup(t) { boardSetup(t, 3, 7, 5); },
    run(t) { audio.audiochess(t); },
  },
  {
    number: 153, name: 'Audio Disc Rings in Rim', description: 'Spectrum rings of discs inside rim spokes, mirrored',
    setup(t) {
      t.bfade = 3; t.fancy = 0;
      t.adjunct = t.square ? 12 : t.random(6);
      t.targetfps = 30;
      t.dot++;
      t.flop[2] = true;
    },
    run(t) { if (t.flop[5] || t.flop[6]) centre(t); audio.Raudio19(t); audio.Raudio5(t); t.adjustme(); },
  },
  {
    number: 154, name: 'Audio Rim Fold', description: 'Rim spokes with the right channel folded into half the circle, no fade',
    setup(t) { t.bfade = 0; t.fancy = 0; t.targetfps = 30; },
    run(t) { audio.Raudio18(t); if (t.flop[4]) t.adjustme(); },
  },
  {
    number: 157, name: 'Audio Fireball', description: 'Sparks from the centre; one band sets how many fly',
    setup(t) { t.bfade = 2; t.fancy = 0; },
    run(t) { audio.audiofireball(t); if (t.flop[4]) t.adjustme(); },
  },
  {
    number: 159, name: 'Audio Twin Lines Wash', description: 'Left and right spectra about two lines, sometimes over a colour wash',
    setup(t) {
      t.bfade = t.random(3, 5); t.fancy = 0;
      if (t.flop[5] || t.flop[8]) t.bfade = 0;
      t.targetfps = 30;
    },
    run(t) { if (t.flop[5] || t.flop[8]) fx.solid5(t); audio.audio12(t); },
  },
].map(pattern => ({ ...pattern, audioReactive: true }));
TME_PATTERNS.push(...AUDIO_BATCH_3);
TME_PATTERNS.sort((a, b) => a.number - b.number);

const arcSetup = (t) => { t.targetfps = 30; t.fancy = 0; t.bfade = t.random(1, 5); };

const AUDIO_BATCH_4 = [
  {
    number: 41, name: 'Audio Orbiting Hubs', description: 'Two or four orbiting hubs with spectrum spokes',
    setup(t) {
      t.bfade = t.random(1, 4);
      if (t.flop[1] && t.flop[2]) {
        if (t.square) {
          t.adjunct = 12;
        } else {
          t.adjunct = t.random(6);
          if (t.flop[9]) { t.adjunct = 4; t.wind = 15; t.fancy = 62; }
        }
      }
      if (!t.flop[0]) t.targetfps = 30;
    },
    run(t) {
      if (t.flop[1] || t.flop[3]) centre(t);
      if (t.flop[0]) audio.Raudio17(t); else audio.Raudio7(t);
      if (t.flop[5] || t.flop[4]) t.adjustme();
    },
  },
  {
    number: 46, name: 'Audio Hubs in Rim', description: 'Orbiting hubs with spectrum spokes inside rim spokes',
    setup(t) { t.bfade = t.random(2, 5); t.fancy = 0; t.adjunct = 0; t.targetfps = 30; },
    run(t) { if (t.flop[1] || t.flop[0]) centre(t); audio.Raudio7(t); audio.Raudio5(t); },
  },
  {
    number: 165, name: 'Audio Arcs', description: 'Sixteen ring arcs, left bands on one half and right on the other',
    setup: arcSetup,
    run(t) { audio.circleaudio(t); t.adjustme(); },
  },
  {
    number: 166, name: 'Audio Arcs Opposed', description: 'Ring arcs growing both ways from the top',
    setup: arcSetup,
    run(t) { audio.circleaudio2(t); t.adjustme(); },
  },
  {
    number: 184, name: 'Audio Arcs Rainbow', description: 'Opposed ring arcs with colour running along each arc',
    setup: arcSetup,
    run(t) { audio.circleaudio3(t); t.adjustme(); },
  },
].map(pattern => ({ ...pattern, audioReactive: true }));
TME_PATTERNS.push(...AUDIO_BATCH_4);
TME_PATTERNS.sort((a, b) => a.number - b.number);

export const MARK_ESTES_GROUP = 'Mark Estes';

export const MARK_ESTES_PATTERNS = TME_PATTERNS.map((pattern) => ({
  id: `tme-${pattern.number}`,
  name: `${pattern.name} (TME ${pattern.number})`,
  group: MARK_ESTES_GROUP,
  // These patterns have no adjustable settings of their own yet.
  controls: [],
  audio: `${pattern.description} (Table Mark Estes port; ${pattern.audioReactive ?
    'follows the audio spectrum, or animates on its own in silence' : 'no audio modulation'})`,
  audioReactive: !!pattern.audioReactive,
  createInstance: (width, height, random = Math.random) =>
    new TmeAnimation(pattern, width, height, random),
}));
