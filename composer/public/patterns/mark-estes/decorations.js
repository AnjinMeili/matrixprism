// The sketch's "fancy" decorations: occasional rings, boxes, stars and
// confetti drawn over a pattern, chosen by checkfancy(). Ported from
// Table_Mark_Estes_Impl.h; see ./NOTICE.md.
import { div, hsv, WHITE, BLACK } from './runtime.js';

const saturation = (t) => 255 - div(t.velo, 5);
const pulse = (t) => 255 - t.counter % 64;

// Runs `draw(age)` while a decoration is expanding, then schedules the next
// one `low` to `high` seconds' worth of frames ahead.
function timed(t, delay, span, low, high, draw, rearm) {
  if (t.counter < t[delay]) return;
  const age = t.counter - t[delay];
  if (age <= span) {
    draw(age);
  } else {
    t[delay] = t.counter + t.random(t.targetfps * low, t.targetfps * high);
    rearm?.();
  }
}

export function triangler(t) {
  timed(t, 'ringdelay', t.BIGGER + 10, 4, 12, (age) => {
    for (let gg = 0; gg < 18; gg += 3)
      t.triangle(t.driftx, t.drifty, age + gg, 3 * t.h, t.h * 8);
    t.triangle(t.driftx, t.drifty, age + 21, 3 * t.h + 128, t.h * 8 + 128);
  });
}

export function bkringer(t) {
  timed(t, 'bringdelay', t.BIGGER + 13, 4, 15, (age) => {
    [12, 8, 4, 0].forEach((extra, i) =>
      t.DCircle(t.driftx, t.drifty, t.BIGGER + extra - age, hsv(t.h + 60 + 10 * i, saturation(t), 255)));
  });
}

export function bkstarer(t) {
  if (t.counter === 0) t.pointyfix = t.random(4, 9);
  timed(t, 'bringdelay', t.BIGGER + 10, 5, 17, (age) => {
    [15, 10, 5, 0].forEach((extra, i) => {
      const size = t.BIGGER - age + extra;
      t.drawstar(t.driftx, t.drifty, 2 * size, size, t.pointyfix, t.blender - t.h, t.h - 60 + 10 * i);
    });
  }, () => { t.pointy = t.random(4, 9); });
}

export function boxer(t) {
  timed(t, 'ringdelay', t.BIGGER, 3, 15, (age) => {
    t.DRectangle(t.driftx - age, t.drifty - age, t.driftx + age, t.drifty + age,
      hsv(t.h * 2 + 128, pulse(t), 255));
  });
}

export function bkboxer(t) {
  timed(t, 'bringdelay', t.BIGGER + 10, 4, 12, (age) => {
    [12, 8, 4, 0].forEach((extra, i) => {
      const size = extra + age;
      t.DRectangle(t.driftx - size, t.drifty - size, t.driftx + size, t.drifty + size,
        hsv(t.h + t.steper * 4 * i, pulse(t), 255));
    });
  });
}

export function starer(t) {
  if (t.counter === 0) t.pointy = t.random(4, 9);
  timed(t, 'ringdelay', t.BIGGER, 5, 10, (age) => {
    t.drawstar(t.driftx, t.drifty, 2 * age, age, t.pointy, t.blender + t.h, t.h * 2 + 85);
  }, () => { t.pointy = t.random(3, 9); });
}

export function ringer(t) {
  timed(t, 'ringdelay', t.BIGGER, 5, 10, (age) => {
    t.DCircle(t.driftx, t.drifty, age,
      t.flop[0] || t.flop[1] ? hsv(t.h + 85, saturation(t), 255) : WHITE);
  });
}

export function nringer(t, i) {
  t.DFCircle(t.driftx, t.drifty, i, BLACK);
  t.DCircle(t.driftx, t.drifty, i, t.flop[0] ? WHITE : hsv(t.blender, 255 - div(t.velo, 2), 255));
}

export function cringer(t, i) {
  t.DFCircle(t.driftx, t.drifty, i, t.flop[1] ? BLACK : hsv(t.h + 128, 255, 54));
  t.DCircle(t.driftx, t.drifty, i, t.flop[1] ? hsv(t.h, 255, 255) : WHITE);
}

export function confetti(t) {
  if (t.random8() < 224)
    t.ADCircle(t.random(t.W), t.random(t.H), t.random(1, 7), hsv(t.random8(), saturation(t), 255));
  else
    t.DFCircle(t.random(t.W), t.random(t.H), t.random(1, 7), hsv(t.h + 128, 255 - div(t.velo, 7), 255));
}

export function confetti2(t) {
  const speck = () => t.set(t.random(t.W), t.random(t.H), hsv(t.h + t.random(32), saturation(t), 255));
  if (t.random8() > t.blender) {
    for (let i = 0; i < 2 * t.dot + 2; ++i) speck();
    return;
  }
  const size = t.random(2, 9), x = t.random(t.W), y = t.random(t.H);
  const rings = t.random8() > 128 ? [[0, 235], [0, 200], [0, 170]] : [[0, 235], [16, 235], [32, 235]];
  rings.forEach(([shift, sat], i) => t.DCircle(x, y, size + i, hsv(t.h + shift, sat, 255)));
  speck();
}

export function confetti4(t) {
  const coloured = () => hsv(t.blender + t.random(64), saturation(t), 190 + t.random(64));
  const many = t.flop[2] ? () => WHITE : coloured, rare = t.flop[2] ? coloured : () => WHITE;
  for (let i = 0; i < 2 * t.dot + 2; ++i)
    t.set(t.random(t.W), t.random(t.H), many());
  if (t.counter % 27 === 0)
    t.set(t.random(t.W), t.random(t.H), rare());
  const holder = t.beatsin16(4, 6, t.W);
  t.drawstar(t.driftx, t.drifty, holder, div(holder, t.dot3 + 1), t.dot3 + 2, t.h, t.h);
}

// A burst of double-speed wind once per cycle of the frame counter.
export function mindfack(t) {
  const phase = t.counter % t.BIGGER;
  if (phase <= 16 || phase >= 42) return;
  const shift = t.flop[8] ? (t.flop[9] ? 'ShiftUp' : 'ShiftRight') : (t.flop[9] ? 'ShiftDown' : 'ShiftLeft');
  t[shift]();
  t[shift]();
}

const BACK = [bkringer, bkboxer, bkstarer];
const FRONT = [ringer, boxer, starer, triangler];

export function checkfancy(t) {
  const fancy = t.fancy;
  // 9 to 20 pair one background decoration with one foreground decoration.
  if (fancy >= 9 && fancy <= 20) {
    BACK[div(fancy - 9, 4)](t);
    FRONT[(fancy - 9) % 4](t);
    return;
  }
  switch (fancy) {
    case 1: triangler(t); break;
    case 2: bkringer(t); break;
    case 3: bkstarer(t); break;
    case 4: case 7: boxer(t); break;
    case 5: bkboxer(t); break;
    case 6: starer(t); break;
    case 8: case 26: ringer(t); break;
    case 21: nringer(t, t.counter % t.BIGGER); break;
    case 22: confetti2(t); break;
    case 23: confetti4(t); break;
    case 24: confetti(t); break;
    case 25: bkboxer(t); triangler(t); break;
    case 27: cringer(t, t.counter % t.BIGGER); break;
    case 28: mindfack(t); break;
    case 29: bkringer(t); ringer(t); break;
    default: break;
  }
}
