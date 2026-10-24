// Copyright Mark Estes (Table_Mark_Estes), adapted by Marc Merlin; JavaScript
// port copyright 2026 Anjin <anjin@skyhighatry.com>.
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0: ../../licenses/table-mark-estes.txt.
// This file is a modified, translated version of the sketch; the deliberate
// differences are listed in ./NOTICE.md.
// Effect functions ported from Table_Mark_Estes_Impl.h. Each takes the
// runtime `t` in place of the sketch's globals and keeps the original name.
// See ./NOTICE.md for provenance.
import { sin8, cos8, inoise8 } from '../../aurora-fastled.js';
import {
  div, hsv, WHITE, BLACK, GREEN, PURPLE, RED, BLUE, YELLOW,
  palette16, gradientPalette16, colorFromPalette, qsub8,
} from './runtime.js';

const s8 = (angle) => (sin8(angle) - 128) / 128;
const c8 = (angle) => (cos8(angle) - 128) / 128;

export function spire2(t) {
  if (t.counter === 0) {
    t.radius = div(t.BIGGER, 2);
    t.flop[0] = true;
    t.radius2 = 5;
    t.flop[1] = false;
    t.dot = t.dot + 5 + t.random(3, 7);
  }
  if (t.h % 24 === 0) {
    const limit = div(t.BIGGER * 2, 3);
    if (t.radius < 4) t.flop[0] = !t.flop[0];
    if (t.radius > limit) t.flop[0] = !t.flop[0];
    t.radius += t.flop[0] ? -1 : 1;
    if (t.radius2 < 4) t.flop[1] = !t.flop[1];
    if (t.radius2 > limit) t.flop[1] = !t.flop[1];
    t.radius2 += t.flop[1] ? -1 : 1;
  }
  const saturation = 255 - div(t.velo, 5);
  for (const offset of [0, 85, 174]) {
    let x = t.driftx + t.radius * c8(t.h * 2 + offset);
    let y = t.drifty + t.radius * s8(t.h * 2 + offset);
    t.DFCircle(x, y, t.dot, hsv(t.h + offset, saturation, 255));
    if (t.flop[2]) t.DCircle(x, y, t.dot + 1, WHITE);
    x = t.driftx - t.radius2 * c8(t.h * 2 + offset);
    y = t.drifty - t.radius2 * s8(t.h * 2 + offset);
    t.DFCircle(x, y, t.dot, hsv(t.h + 128 + offset, saturation, 255));
    if (t.flop[2]) t.DCircle(x, y, t.dot + 1, WHITE);
  }
}

export function triforce(t) {
  t.dot = t.flop[9] ? 7 : 5;
  for (let i = 0; i < div(t.BIGGER, 2); ++i) {
    if (t.flop[5])
      t.triangle(t.MIDLX, t.MIDLY, 10 + i, t.xblender + t.h + i, t.blender + t.h + t.dot * i);
    else
      t.triangle(t.MIDLX, t.MIDLY, 10 + i, t.xblender - t.h + i, t.blender + t.h - t.dot * i);
  }
}

export function sinx(t) {
  if (t.counter === 0) {
    t.dot++;
    t.radius2 = t.random(div(t.BIGGER, 4), div(t.BIGGER, 2)) - 4;
    t.radius3 = t.random(div(t.BIGGER, 7), div(t.BIGGER, 4));
    t.ringdelay = (t.ringdelay * t.random(12, 25)) & 65535;
  }
  const saturation = 255 - div(t.velo, 3);
  const hues = t.flop[1] ? [t.h * 2 - 64, t.h * 2 + 21, t.h * 2 + 106] :
    [t.h + 100, t.h * 2 + 100, t.h * 3 + 100];
  [0, 85, 170].forEach((offset, i) => {
    t.DCircle(t.MIDLX + ((t.radius3 * (cos8(t.h + offset) - 128)) >> 7),
      t.MIDLY + ((t.radius3 * (sin8(t.h + offset) - 128)) >> 7),
      t.radius2 + (i === 0 ? 1 : -1), hsv(hues[i], saturation, 255));
  });
}

export function drops(t) {
  if (t.counter === 0) {
    t.howmany = t.random(t.BIGGER * 1.5, t.BIGGER * 2);
    t.blender = t.flop[2] ? t.random8() : 80;
    for (let i = 0; i < t.howmany; ++i) {
      t.xslope[i] = t.random(t.W);
      t.yslope[i] = t.MIDLY - t.random(t.H);
      t.fpeed[i] = t.random(1, 8);
      t.fcountr[i] = t.random(2, 6);
      t.fcolor[i] = t.blender + t.random(82);
      t.fvelo[i] = t.random8();
    }
    // As in the sketch, columns closer than 36 to their neighbour are re-rolled
    // into a band starting at `blender`. Bounded here so it always ends.
    for (let i = 1; i < t.howmany; ++i) {
      for (let tries = 0; tries < 100 && Math.abs(t.xslope[i] - t.xslope[i - 1]) < 36; ++tries)
        t.xslope[i] = t.blender + t.random(75);
    }
    if (!t.flop[1]) t.fcolor[div(t.howmany, 2)] = t.blender - 90;
  }
  for (let i = 0; i < t.howmany; ++i) {
    if (t.counter % t.fpeed[i] === 0) t.yslope[i]++;
    if (t.yslope[i] > t.H + t.fcountr[i]) {
      t.fcountr[i] = t.random(2, 6);
      t.yslope[i] = -t.random(5, div(t.H, 4));
      t.xslope[i] = t.random(t.W);
      t.fpeed[i] = t.random(1, 7);
    }
    const x = t.xslope[i], y = t.yslope[i];
    t.DLine(x, y, x, y - t.fcountr[i], hsv(t.fcolor[i], 255 - div(t.fvelo[i], 3), 255));
    if (i % 19 === 0)
      t.DLine(x, y, x, y - t.fcountr[i], hsv(t.fcolor[i], 155 - div(t.fvelo[i], 3), 255));
  }
}

export function swirl2(t) {
  if (t.counter === 0) {
    t.xhowmany = t.random(div(t.BIGGER * 2, 3), div(t.BIGGER * 3, 2));
    for (let i = 0; i < t.xhowmany; ++i) {
      t.xslope[i] = t.random(3, t.MIDLX + 19);
      t.fpeed[i] = t.random(1, 6);
      t.xpoffset[i] = t.xblender + t.random(94);
      t.fvelo[i] = t.random8();
      t.fcountr[i] = t.random8();
    }
  }
  for (let i = 0; i < t.xhowmany; ++i) {
    const back = -t.h * t.fpeed[i] + t.fcountr[i], forward = t.h * t.fpeed[i] + t.fcountr[i];
    const x = t.driftx + t.xslope[i] * s8(back), y = t.drifty + t.xslope[i] * c8(back);
    t.set(x, y, hsv(t.xpoffset[i], 255 - div(t.fvelo[i], 4), 255));
    if (i % 13 === 0) t.set(x, y, WHITE);
    if (i % 17 === 0) {
      const color = hsv(128 + t.xpoffset[i], 255 - div(t.fvelo[i], 4), 255);
      t.set(t.driftx + t.xslope[i] * s8(forward), t.drifty + t.xslope[i] * c8(forward), color);
      t.set(t.driftx + 1 + t.xslope[i] * s8(forward), t.drifty - 1 + t.xslope[i] * c8(forward), color);
    }
  }
}

function wheel(t, count, shrink, direction, rimHue) {
  for (let i = 0; i < count; ++i) {
    const size = t.inner - shrink * i;
    if (size <= 0) continue;
    const angle = div(i * t.radius2, 2) + direction * t.h;
    const x = t.driftx + (t.inner + t.dot2) * s8(angle), y = t.drifty + (t.inner + t.dot2) * c8(angle);
    t.DFCircle(x, y, size, hsv(t.h + t.radius2 * i, 255, 255));
    t.DCircle(x, y, size, hsv(t.h + t.radius2 * i + rimHue, 200, 255));
  }
}

export function wheelz2(t) {
  if (t.counter === 0) {
    t.howmany = t.random(12, 25);
    t.inner = (4 + t.random(div(t.BIGGER, 4), div(t.BIGGER, 2))) & 255;
    t.radius2 = div(255, t.howmany);
    t.dot2 = t.random(2, 8);
  }
  if (t.flop[3]) {
    t.driftx = t.MIDLX;
    t.drifty = t.MIDLY;
  }
  wheel(t, t.howmany * 2, 2, -1, -85);
}

export function wheelz3(t) {
  if (t.counter === 0) {
    t.howmany = t.random(15, 30);
    t.inner = t.random(div(t.BIGGER, 4), div(t.BIGGER, 2)) & 255;
    t.radius2 = div(255, t.howmany);
    t.dot2 = t.random(2, 4);
  }
  t.driftx = t.MIDLX;
  t.drifty = t.MIDLY;
  wheel(t, t.howmany * 4, 1, 1, 85);
}

export function hypnoduck3(t) {
  if (t.counter === 0) {
    t.dot = t.random(2, 5);
    t.quash = -12 - t.dot;
  }
  const limit = t.beatsin16(6, 190, 1420);
  for (let jj = 20; jj < limit; jj += 3) {
    t.poffset = t.flop[2] ? div(jj, 2) : t.flop[4] ? div(jj, 4) : 0;
    const reach = div(jj, 19 - t.dot);
    let angle = jj + t.quash * t.h;
    t.DFCircle(t.driftx + s8(angle) * reach, t.drifty + c8(angle) * reach, t.dot,
      hsv(t.poffset - t.h - 100, 255 - div(t.velo, 5), 255));
    angle += 128;
    t.DFCircle(t.driftx + s8(angle) * reach, t.drifty + c8(angle) * reach, t.dot,
      hsv(t.poffset - t.h, 255 - div(t.velo, 2), 255));
  }
}

export function hypnoduck(t) {
  if (t.counter === 0) {
    t.dot = t.random(2, 5);
    t.radius = t.random(t.BIGGER * 0.2, t.BIGGER * 0.4);
    t.quash = -20 + t.dot;
  }
  const centred = t.flop[9] || t.flop[8];
  const arm = (phase, hueA, satA, hueB) => {
    t.xxx = Math.trunc((centred ? t.MIDLX : t.driftx) + t.radius * s8(t.h + phase));
    t.yyy = Math.trunc((centred ? t.MIDLY : t.drifty) + t.radius * c8(t.h + phase));
    for (let jj = 0; jj < 400; jj += 5) {
      t.poffset = t.flop[2] ? div(jj, 2) : t.flop[4] ? div(jj, 4) : 0;
      const reach = div(jj, 17);
      let angle = jj + t.quash * t.h;
      t.DFCircle(t.xxx + s8(angle) * reach, t.yyy + c8(angle) * reach, t.dot,
        hsv(t.poffset + t.h + hueA, 255 - div(t.velo, satA), 255));
      angle += 128;
      t.DFCircle(t.xxx + s8(angle) * reach, t.yyy + c8(angle) * reach, t.dot,
        hsv(t.poffset + t.h + hueB, 255 - div(t.velo, 2), 255));
    }
  };
  arm(0, -64, 5, 64);
  arm(128, 128, 4, 0);
}

export function whitewarp(t) {
  if (t.counter === 0) {
    t.dot4 = t.random(5, 8);
    t.howmany = t.random(div(t.BIGGER * 2, 3), div(t.BIGGER * 4, 3));
    for (let i = 0; i < t.howmany; ++i) {
      t.fcount[i] = t.random8();
      t.fcolor[i] = t.blender + div(t.random8(), 4);
      t.fvelo[i] = t.random8();
      t.fpeed[i] = t.random(2, 12);
      t.xpoffset[i] = t.flop[9] ? t.random(5, 8) : t.dot4;
      t.xfire[i] = t.driftx;
      t.yfire[i] = t.drifty;
    }
  }
  const poffset = t.poffset = t.flop[9] ? 1 : 0;
  const sat = (i) => 255 - div(t.fvelo[i], t.dot);
  if (t.flop[0]) t.set(t.driftx, t.drifty, WHITE);
  else if (t.flop[1]) t.set(t.driftx, t.drifty, hsv(t.fcolor[0] + poffset, sat(0), 255));
  else t.set(t.driftx, t.drifty, hsv(128 + t.blender + poffset, sat(0), 255));
  for (let i = 1; i < t.howmany; ++i) {
    t.xfire[i] += (t.fpeed[i] / 4) * s8(t.fcount[i] + poffset);
    t.yfire[i] += (t.fpeed[i] / 4) * c8(t.fcount[i] + poffset);
    const x = t.xfire[i], y = t.yfire[i], size = t.xpoffset[i];
    if (t.flop[7]) {
      if (t.flop[0]) t.set(x, y, hsv(t.fcolor[i] + poffset, sat(i), 255));
      else if (t.flop[1]) t.set(x, y, WHITE);
      else t.set(x, y, hsv(t.blender + poffset, sat(i), 255));
    } else {
      const colors = t.flop[0] && t.flop[9] ? [GREEN, BLACK, PURPLE] :
        t.flop[1] ? [0, 64, -64].map(shift => hsv(t.fcolor[i] + shift + poffset, sat(i), 255)) :
          [0, -64, 64].map(shift => hsv(t.blender + shift - poffset, sat(i), 255));
      colors.forEach((color, ring) => {
        const inset = size - 2 * ring;
        t.DFRectangle(x - inset, y - inset, x + inset, y + inset, color);
      });
    }
    if (x < 0 || y < 0 || x > t.W || y > t.H) {
      t.xfire[i] = t.driftx;
      t.yfire[i] = t.drifty;
      t.fcount[i] = t.random8();
      if (t.flop[4]) t.fcolor[i] = t.fcolor[i] + t.h;
    }
  }
}

// Moves the bouncing shapes shared by the bubble effects.
function bounce(t, u) {
  const dx = t.fpeed[u] * s8(t.xslope[u]), dy = t.fpeed[u] * c8(t.xslope[u]);
  t.xfire[u] += t.xbouncer[u] ? dx : -dx;
  t.yfire[u] += t.ybouncer[u] ? dy : -dy;
  if (t.xfire[u] > t.W - t.fcount[u] || t.xfire[u] < t.fcount[u]) t.xbouncer[u] ^= 1;
  if (t.yfire[u] > t.H - t.fcount[u] || t.yfire[u] < t.fcount[u]) t.ybouncer[u] ^= 1;
}

function placeBubbles(t, minRadius, maxRadius, maxSpeed) {
  for (let u = 0; u < t.howmany; ++u) {
    t.xfire[u] = t.random(div(t.MIDLX, 2), div(t.MIDLX * 3, 2));
    t.yfire[u] = t.random(div(t.MIDLY, 2), div(t.MIDLY * 3, 2));
    t.fcolor[u] = t.random8();
    t.fvelo[u] = t.random8();
    t.fcount[u] = t.random(minRadius, maxRadius);
    t.fpeed[u] = t.random(1, maxSpeed);
    // An angle that avoids the horizontal and vertical.
    t.xslope[u] = t.random(13, 52) + t.random(4) * 64;
  }
}

export function tinybubbles(t) {
  if (t.counter === 0) {
    t.howmany = Math.trunc(t.BIGGER * 1.5);
    placeBubbles(t, 3, 10, 4);
    for (let u = 0; u < t.howmany; ++u) {
      t.rimmer[u] = t.random8() > 128 ? 1 : 0;
      t.xbouncer[u] = t.rimmer[u] ? 0 : 1;
      t.ybouncer[u] = t.random8() < 128 ? 0 : 1;
    }
  }
  for (let u = 0; u < t.howmany; ++u) {
    bounce(t, u);
    const x = t.xfire[u], y = t.yfire[u], size = t.fcount[u];
    const fill = hsv(t.fcolor[u], div(t.fvelo[u], 4) + 192, 255);
    if (t.flop[6] && t.flop[7]) {
      t.DFCircle(x, y, size, fill);
      if (u % (4 + t.dot2) === 0)
        t.drawstar(x, y, size, div(size, 3), 7, t.h, t.fcolor[u] + 128);
      t.DCircle(x, y, size, t.rimmer[u] ? hsv(t.fcolor[u] + 128, div(t.fvelo[u], 4) + 192, 255) : WHITE);
    } else {
      t.DFRectangle(x, y, x + size + t.dot, y + size + t.dot, fill);
      if (t.flop[7] || t.flop[8]) {
        t.DRectangle(x, y, x + size + t.dot, y + size + t.dot,
          t.rimmer[u] ? hsv(t.fcolor[u] + 128, div(t.fvelo[u], 4) + 128, 255) : WHITE);
      }
    }
  }
}

export function bubbles2(t) {
  if (t.counter === 0) {
    t.howmany = t.random((t.BIGGER >> 2) - 4, div(t.BIGGER, 2) - 8);
    placeBubbles(t, 4, (t.MIDLX >> 1) - 4, 4);
    for (let u = 0; u < t.howmany; ++u) {
      t.rimmer[u] = t.random8() > 99 ? 1 : 0;
      t.xbouncer[u] = t.ybouncer[u] = t.rimmer[u] ? 0 : 1;
    }
  }
  for (let u = 0; u < t.howmany; ++u) {
    bounce(t, u);
    const x = t.xfire[u], y = t.yfire[u], size = t.fcount[u];
    t.DFCircle(x, y, size,
      hsv(t.fcolor[u] + t.h, 255 - div(t.fvelo[u], t.flop[3] && u % 9 === 0 ? 8 : 4), 255));
    t.DCircle(x, y, size,
      t.rimmer[u] ? hsv(t.fcolor[u] + t.h + 128, div(t.fvelo[u], 4) + 192, 255) : WHITE);
  }
}

export function starbubbles88(t) {
  if (t.counter === 0) {
    t.howmany = t.random(div(t.BIGGER, 8), div(t.BIGGER, 4));
    placeBubbles(t, 7, 2 + div(t.MIDLX, 2), 5);
    for (let u = 0; u < t.howmany; ++u) {
      t.rimmer[u] = t.random8() > 168 ? 1 : 0;
      t.xbouncer[u] = t.ybouncer[u] = t.rimmer[u] ? 0 : 1;
    }
  }
  const spin = t.flop[9] && t.flop[8];
  for (let u = 0; u < t.howmany; ++u) {
    bounce(t, u);
    for (let j = 0; j < t.fcount[u]; ++j) {
      t.drawstar(t.xfire[u], t.yfire[u], j, div(j, 3), 3 + u % 5, t.h * 2 + t.fvelo[u],
        t.fcolor[u] + 6 * j + (spin ? t.h : 0));
    }
  }
}

export function streaker(t) {
  const launch = (u, spread) => {
    t.xfire[u] = t.driftx;
    t.yfire[u] = t.drifty;
    t.fpeed[u] = t.random(1, 5);
    t.blender = t.random8();
    t.yslope[u] = c8(t.blender);
    t.xslope[u] = s8(t.blender);
    t.fcolor[u] = t.flop[0] ? t.ccoolloorr + t.random(spread) : t.random8();
  };
  if (t.counter === 0) {
    t.howmany = div(t.BIGGER * 3, 2);
    t.how = t.howmany;
    for (let u = 0; u < t.howmany; ++u) {
      launch(u, 80);
      t.fvelo[u] = t.random8();
    }
  }
  if (t.flop[4])
    t.howmany = t.beatsin8(4, div(t.how, 3), div(t.how * 2, 3));
  for (let u = 0; u < t.howmany; ++u) {
    t.set(t.xfire[u], t.yfire[u], hsv(t.fcolor[u], div(t.fvelo[u], 4) + 192, 255));
    t.xfire[u] += t.xslope[u] * t.fpeed[u];
    t.yfire[u] += t.yslope[u] * t.fpeed[u];
    t.fcount[u] = 0;
    if (t.yfire[u] < 0 || t.yfire[u] > t.H - 1 || t.xfire[u] < 0 || t.xfire[u] > t.W - 1)
      launch(u, 64);
  }
}

export function spiraly(t) {
  if (t.counter === 0) {
    t.howmany = t.random(div(t.BIGGER, 8), div(t.BIGGER, 6));
    for (let i = 0; i < t.howmany; ++i)
      t.fcount[i] = div(i * 255, t.howmany);
  }
  const saturation = 255 - div(t.velo, 5);
  for (let i = 0; i < t.howmany; ++i) {
    for (let jj = 0; jj < div(t.BIGGER, 2); ++jj) {
      t.xx = Math.trunc(t.driftx + jj * s8(t.fcount[i] + t.h + 2 * jj));
      // flop[1] twists the arms into a helix instead of a plain spiral.
      t.yy = Math.trunc(t.drifty + jj * c8(t.flop[1] ? t.fcount[i] - t.h - (t.dot - 2) * jj :
        t.fcount[i] + t.h + 2 * jj));
      const color = hsv(t.blender + (t.flop[2] ? jj * t.dot3 : t.fcount[i]) + t.h, saturation, 255);
      if (t.flop[7]) t.set(t.xx, t.yy, color);
      else t.DFCircle(t.xx, t.yy, 1, color);
    }
    t.set(t.driftx, t.drifty, hsv(t.blender + 256 + t.h, 205, 255));
    t.DRectangle(0, 0, t.W - 1, t.H - 1, BLACK);
  }
}

const FIRE_PALETTES = [
  [0, 0, 0, 0, 32, 255, 0, 0, 190, 255, 255, 0, 255, 255, 255, 255],     // pal2: red, yellow
  [0, 0, 0, 0, 32, 0, 255, 0, 190, 0, 255, 255, 255, 0, 0, 255],         // pal3: green, teal, blue
  [0, 0, 0, 0, 32, 0, 0, 255, 190, 255, 255, 0, 255, 255, 255, 255],     // pal4: blue, yellow
  [0, 0, 0, 0, 32, 255, 0, 0, 190, 0, 255, 255, 255, 255, 255, 255],     // pal5: red, teal
  [0, 0, 0, 0, 32, 255, 0, 205, 170, 0, 0, 255, 255, 255, 255, 255],     // pal6: pink, blue
  null,
  [0, 0, 0, 0, 64, 0, 255, 0, 170, 200, 0, 255, 255, 255, 255, 255],     // pal1: green, purple
].map(stops => stops && gradientPalette16(stops));

export function fire2(t) {
  if (t.counter === 0) t.dot = t.random(9);
  const palette = FIRE_PALETTES[t.dot] ?? (
    t.dot === 5 ? palette16(BLACK, hsv(2 * t.h, 255, 205), hsv(2 * t.h, 128, 255), WHITE) :
      t.dot === 7 ? palette16(BLACK, hsv(t.h + 85, 255, 255), hsv(t.h, 128, 255), WHITE) :
        palette16(BLACK, hsv(t.h, 255, 255), hsv(t.h + 85, 128, 255), WHITE));
  const ace = Math.trunc(t.ms);
  for (let i = 0; i < t.W; ++i) {
    for (let j = 0; j < t.H; ++j) {
      // Cooling rises linearly with height. The sketch computes this through
      // an 8-bit abs, which leaves a seam on panels taller than 128 rows.
      const cooling = div(j * 255, t.H - 1);
      t.set(i, t.H - 1 - j,
        colorFromPalette(palette, qsub8(inoise8(i * 50, j * 50 + ace, div(ace, 3)), cooling)));
    }
  }
  if (t.flop[2] && t.flop[4]) {
    if (t.flop[3]) t.VerticalMirror();
    else t.mirror();
  }
}

export function solid5(t) {
  for (let i = 0; i < t.W; ++i)
    for (let j = 0; j < t.H; ++j)
      t.set(i, j, hsv(i * t.dot2 + div(t.dot, 2) * j + 2 * t.h, 255, 120));
}

export function solidblack(t) {
  t.rgb.fill(0);
}

export function seasick6(t) {
  if (t.counter === 0) t.sinewidth = t.random(4, 8);
  let color = hsv(t.h - 44, 255 - div(t.velo, 7), 205);
  for (let jj = 0; jj < t.W; ++jj) {
    const centre = t.MIDLY + s8(3 * t.h + jj * t.sinewidth) * t.MIDLY * 0.70;
    for (let ii = -2 * t.dot2; ii < 2 * t.dot2 + 1; ++ii)
      t.add(jj, ii + centre, color);
  }
  color = hsv(t.h + 44, 255 - div(t.velo, 6), 205);
  for (let jj = 0; jj < t.H; ++jj) {
    const centre = t.MIDLX + s8(-3 * t.h + jj * t.sinewidth) * t.MIDLX * 0.70;
    for (let ii = -3 * t.dot; ii < 3 * t.dot + 1; ++ii)
      t.add(ii + centre, jj, color);
  }
}

export function iris(t) {
  if (t.counter === 0) {
    t.howmany = 2 + t.random(3, 7) * 2;
    for (let i = 0; i < t.howmany; ++i) {
      t.fvelo[i] = t.random8();
      t.fcolor[i] = div(i * 256, t.howmany) + (i % 2 === 0 ? 128 : 0);
    }
    t.radius2 = t.random(div(t.BIGGER, 4), div(t.BIGGER * 3, 4));
    t.poffset = t.random(div(t.BIGGER, 10), div(t.BIGGER, 6));
    t.dot2 = t.random8() > 128 ? 1 : 2;
    t.dot3 = t.random8() > 128 ? 1 : 2;
  }
  if (t.flop[3]) {
    t.driftx = t.MIDLX;
    t.drifty = t.MIDLY;
  }
  t.radius3 = t.beatsin16(5, t.radius2 + div(t.poffset, 2), div(t.radius2 * 3, 2) - div(t.poffset, 2));
  const limit = t.radius2 * t.radius2;
  for (let i = 0; i < t.howmany; ++i) {
    const turn = div(i * 256, t.howmany);
    const mx = t.driftx + ((t.radius3 * (cos8(t.h * t.dot3 + turn) - 128)) >> 7);
    const my = t.drifty + ((t.radius3 * (sin8(t.h * t.dot3 + turn) - 128)) >> 7);
    const sx = t.driftx + ((t.radius3 * (cos8(-t.h * t.dot2 + turn) - 128)) >> 7);
    const sy = t.drifty + ((t.radius3 * (sin8(-t.h * t.dot2 + turn) - 128)) >> 7);
    const color = hsv(t.fcolor[i] + t.h, 255 - div(t.fvelo[i], 2), 255);
    // Each blade is one disc with a second disc cut out of it.
    for (let x = 0; x < t.W; ++x) {
      for (let y = 0; y < t.H; ++y) {
        if ((x - mx) ** 2 + (y - my) ** 2 < limit && (x - sx) ** 2 + (y - sy) ** 2 > limit)
          t.set(x, y, color);
      }
    }
  }
}

// ---------- second batch ----------

export function Roundhole(t) {
  if (t.counter === 0) {
    t.radius3 = t.random(6, 13);
    t.shifty = Math.max(1, div(t.shifty, 2));
  }
  for (let y = 0; y < t.BIGGER - 1; y += t.dot3 + 1) {
    t.DCircle(t.driftx + ((t.radius3 * (cos8(4 * y + 2 * t.h) - 128)) >> 7),
      t.drifty + ((t.radius3 * (sin8(4 * y + 2 * t.h) - 128)) >> 7), t.H - y,
      hsv(t.blender + y * t.dot2 - t.h * 3, 255 - div(t.velo, 8), 255));
  }
}

export function spin2(t) {
  if (t.counter === 0) {
    t.dot += 3;
    t.ccoolloorr = t.flop[6] || t.flop[7] ? 64 : 0;
  }
  const turn = (t.flop[8] ? -2 : 2) * t.h, size = 6 + t.dot + t.dot3, c = t.ccoolloorr;
  const wide = [div(t.MIDLX, 2), t.MIDLY], tall = [t.MIDLX, div(t.MIDLY, 2)];
  [[0, wide, 2 * c, 4], [64, tall, 0, 4], [128, wide, c, 5], [-64, tall, -c, 5]]
    .forEach(([phase, reach, shift, rim]) => {
      t.xangle = s8(turn + phase);
      t.yangle = c8(turn + phase);
      const x = t.driftx + t.xangle * reach[0], y = t.drifty + t.yangle * reach[1];
      t.DFCircle(x, y, size, hsv(t.h + shift, div(t.velo, 4) + 106, 180));
      t.DCircle(x, y, size, hsv(t.h + shift - 16, 255 - div(t.velo, rim), 255));
    });
}

export function spire3(t) {
  if (t.counter === 0) t.howmany = t.random(4, 9);
  t.dot = t.beatsin8(2, 4, 10, 7);
  t.radius = t.beatsin16(5, div(t.BIGGER, 8), div(t.BIGGER, 2));
  t.radius2 = t.beatsin16(5, div(t.BIGGER, 8), div(t.BIGGER, 2), div(t.BIGGER, 5));
  const saturation = 255 - div(t.velo, 5), fill = t.flop[2] ? 128 : 148;
  for (let i = 0; i < t.howmany; ++i) {
    const turn = div(i * 256, t.howmany), angle = 2 * t.h + turn;
    let x = t.driftx + t.radius * c8(angle), y = t.drifty + t.radius * s8(angle);
    t.DFCircle(x, y, t.dot, hsv(t.h + turn, saturation, fill));
    t.DCircle(x, y, t.dot, hsv((t.flop[2] ? 128 : 0) + t.h + turn, saturation, 205));
    const offset = angle + div(128, t.howmany);
    x = t.driftx - t.radius2 * c8(offset);
    y = t.drifty - t.radius2 * s8(offset);
    t.DFCircle(x, y, t.dot, hsv(t.h + turn, saturation, fill));
    t.DCircle(x, y, t.dot, hsv((t.flop[2] ? 0 : 128) + t.h + turn, saturation, 205));
  }
}

export function fireball(t) {
  const aim = (u) => {
    t.xfire[u] = t.driftx;
    t.yfire[u] = t.drifty;
    t.xblender = t.random8();
    t.yslope[u] = c8(t.xblender);
    t.xslope[u] = s8(t.xblender);
  };
  if (t.counter === 0) {
    t.howmany = t.random(div(t.BIGGER * 2, 3), div(t.BIGGER * 3, 2));
    t.how = t.howmany;
    for (let u = 0; u < t.howmany; ++u) {
      aim(u);
      t.fvelo[u] = t.random(128);
      t.fcolor[u] = t.flop[0] ? t.blender + t.random(99) : 170 + t.random(84);
    }
  }
  if (t.flop[4] || t.flop[5])
    t.howmany = t.beatsin8(4, div(t.how, 8), t.how);
  for (let u = 0; u < t.howmany; ++u) {
    const color = hsv(t.fcolor[u], 255 - t.fvelo[u], 255);
    if (t.BIGGER < 65) t.set(t.xfire[u], t.yfire[u], color);
    else t.DFCircle(t.xfire[u], t.yfire[u], div(t.BIGGER, 64), color);
    t.xfire[u] += t.xslope[u];
    t.yfire[u] += t.yslope[u];
    if (t.yfire[u] < 0 || t.yfire[u] > t.H - 1 || t.xfire[u] < 0 || t.xfire[u] > t.W - 1)
      aim(u);
  }
  t.set(t.driftx, t.drifty, hsv(110, 200, 225));
}

export function spire(t) {
  t.dot = t.beatsin8(2, 5, 11, 8);
  t.radius = t.beatsin16(5, div(t.BIGGER, 7), div(t.BIGGER, 2));
  const saturation = 255 - div(t.velo, 5);
  for (const [phase, sign] of [[0, 1], [0, -1], [84, 1], [84, -1], [42, 1], [42, -1]]) {
    const x = t.driftx + sign * t.radius * c8(2 * t.h + phase);
    const y = t.drifty + sign * t.radius * s8(2 * t.h + phase);
    const hue = t.h + (phase === 0 ? (sign > 0 ? 0 : 128) : sign * phase);
    t.DFCircle(x, y, t.dot, hsv(hue, saturation, 128));
    t.DCircle(x, y, t.dot, hsv(hue, saturation, 255));
  }
}

export function warp(t) {
  if (t.counter === 0) {
    t.howmany = t.random(div(t.BIGGER * 2, 3), t.BIGGER);
    t.dot4 = t.random(4, 7);
    for (let i = 0; i < t.howmany; ++i) {
      t.fcount[i] = t.random8();
      t.fcolor[i] = t.blender + div(t.random8(), 4);
      t.fvelo[i] = t.random8();
      t.fpeed[i] = t.random(2, 12);
      t.xfire[i] = t.driftx;
      t.yfire[i] = t.drifty;
      t.xpoffset[i] = t.flop[9] ? t.random(5, 8) : t.dot4;
    }
  }
  const poffset = t.poffset = t.flop[9] ? t.h : 0;
  const rings = (x, y, size, colors) =>
    colors.forEach((color, ring) => t.DFCircle(x, y, size - 2 * ring, color));
  const sat = (i, by) => 255 - div(t.fvelo[i], by);
  if (t.flop[7]) {
    t.set(t.driftx, t.drifty, t.flop[0] ? WHITE :
      hsv((t.flop[1] ? t.fcolor[0] : 128 + t.blender) + poffset, sat(0, t.dot4 + 1), 255));
  } else {
    const s = sat(0, t.dot + 1);
    rings(t.driftx, t.drifty, t.xpoffset[0],
      t.flop[0] ? [hsv(t.fcolor[0] + poffset, s, 255), BLACK, hsv(t.fcolor[0] - 64 + poffset, s, 255)] :
        t.flop[1] ? [WHITE, hsv(t.fcolor[0] + 64 + poffset, s, 255), WHITE] :
          [0, -64, 64].map(shift => hsv(128 + t.blender + shift - poffset, s, 255)));
  }
  for (let i = 0; i < t.howmany; ++i) {
    t.xfire[i] += (t.fpeed[i] / 4) * s8(t.fcount[i] + poffset);
    t.yfire[i] += (t.fpeed[i] / 4) * c8(t.fcount[i] + poffset);
    const x = t.xfire[i], y = t.yfire[i];
    if (t.flop[7]) {
      t.set(x, y, t.flop[0] ? hsv(t.fcolor[i] + poffset, sat(i, t.dot + 1), 255) :
        t.flop[1] ? WHITE : hsv(t.blender + poffset, sat(i, t.dot + 1), 255));
    } else {
      rings(x, y, t.xpoffset[i], t.flop[0] && t.flop[9] ? [RED, BLUE, YELLOW] :
        t.flop[1] ? [0, 64, -64].map(shift => hsv(t.fcolor[i] + shift + poffset, sat(i, t.dot), 255)) :
          [0, -64, 64].map(shift => hsv(t.blender + shift - poffset, sat(i, t.dot), 255)));
    }
    if (x < 0 || y < 0 || x > t.W || y > t.H) {
      t.xfire[i] = t.driftx;
      t.yfire[i] = t.drifty;
      t.fcount[i] = t.random8();
      if (t.flop[4]) t.fcolor[i] = t.fcolor[i] + t.h;
    }
  }
}

export function hypnoduck2(t) {
  if (t.counter === 0) {
    t.dot = t.random8(2, 5);
    t.quash = -9;
  }
  const limit = t.beatsin16(4, 199, 1750, 500);
  for (let jj = 0; jj < limit; jj += 3) {
    t.poffset = t.flop[2] ? div(jj, 2) : t.flop[4] ? div(jj, 4) : 0;
    let angle = jj + t.quash * t.h;
    t.DFCircle(t.driftx + s8(angle) * jj / 15, t.drifty + c8(angle) * jj / 15, t.dot,
      hsv(-t.h + t.ccoolloorr - 85 + t.poffset, 255 - div(t.velo, 5), 255));
    angle += 128;
    t.DFCircle(t.driftx + s8(angle) * jj / 15, t.drifty + c8(angle) * jj / 15, t.dot,
      hsv(-t.h + t.ccoolloorr + 85 + t.poffset, 255 - div(t.velo, 2), 255));
  }
}

export function hypnoduck4(t) {
  if (t.counter === 0) {
    t.dot = t.random8(2, 5);
    t.quash = 9;
  }
  if (t.flop[2]) t.rgb.fill(0);
  else if (t.flop[0]) solid5(t);
  for (let jj = t.beatsin16(4, 4, 1300); jj > 0; jj -= 5) {
    t.poffset = t.flop[2] ? div(jj, 2) : t.flop[4] ? div(jj, 3) : 0;
    const reach = div(jj, 22);
    let angle = jj - t.quash * t.h;
    t.DFCircle(t.driftx + s8(angle) * reach, t.drifty + c8(angle) * reach, t.dot,
      hsv(t.poffset + t.h + 64, 255 - div(t.velo, 5), 255));
    angle += 128;
    t.DFCircle(t.driftx + s8(angle) * reach, t.drifty + c8(angle) * reach, t.dot,
      hsv(t.poffset + t.h - 64, 255 - div(t.velo, 5), 255));
  }
}

export function starz(t) {
  if (t.counter === 0) {
    t.howmany = t.random(3, 9);
    t.inner = t.random(div(t.BIGGER, 10), div(t.BIGGER, 4)) & 255;
    t.radius2 = div(255, t.howmany);
  }
  if (t.h % 16 === 0) {
    t.inner = (t.inner + t.flipme) & 255;
    if (t.inner > div(t.MIDLY, 2) || t.inner < div(t.MIDLY, 5)) t.flipme = -t.flipme;
  }
  const step = t.radius2, half = div(step, 2);
  // Three stars orbit the drifting centre, each drawn more sparsely.
  const star = (spacing, divisor) => {
    const color = (j) => hsv(t.h - 85 + t.dot * j, 255 - div(t.velo, t.flop[5] ? divisor : 8), 255);
    for (let i = 0; i < t.howmany; ++i) {
      const tipX = t.driftx + t.xcen + t.MIDLX * s8(i * step + t.h);
      const tipY = t.drifty + t.ycen + t.MIDLY * c8(i * step + t.h);
      for (let j = 2; j < t.inner; j += spacing) {
        for (const side of [half, -half]) {
          t.DLine(t.driftx + t.xcen + j * s8(i * step + side + t.h),
            t.drifty + t.ycen + j * c8(i * step + side + t.h), tipX, tipY, color(j));
        }
      }
    }
  };
  t.xcen = t.MIDLX * s8(-2 * t.h - 85);
  t.ycen = t.MIDLY * c8(-2 * t.h - 85);
  star(1, 4);
  t.xcen = t.MIDLX * s8(-2 * t.h + 85);
  t.ycen = t.MIDLY * c8(-2 * t.h + 85);
  star(2, 3);
  t.xcen = div(t.MIDLX * (sin8(-2 * t.h) - 128), 128);
  t.ycen = div(t.MIDLY * (cos8(-2 * t.h) - 128), 128);
  star(3, 3);
}

export function circlearc(t) {
  if (t.counter === 0) {
    t.howmany = t.random(3, 8);
    t.radius2 = div(t.BIGGER, t.howmany);
    t.poffset = t.random(0, 6);
    t.inner = t.random(6, div(t.MIDLX, 2)) & 255;
  }
  t.radius3 = t.beatsin16(5, t.W * 0.75, t.W * 1.5);
  const r = t.radius3, hm = t.h % 64, h = t.h, inner = t.inner, small = div(inner, 2);
  const s = 255 - div(t.velo, 5);
  // Arcs of discs swing out from each corner of the panel.
  const corner = [
    (a) => [r * s8(a), r * c8(a)],
    (a) => [r * s8(a), t.H - r * c8(a)],
    (a) => [t.W - r * s8(a), t.H - r * c8(a)],
    (a) => [t.W - r * s8(a), r * c8(a)],
  ];
  const disc = (which, angle, size, color) => t.DFCircle(...corner[which](angle), size, color);
  const ring = (which, angle, size, color) => t.DCircle(...corner[which](angle), size, color);
  const each = (draw) => { for (let i = 0; i < t.howmany * 4; ++i) draw(i, i * t.radius2); };
  switch (t.poffset) {
    case 0:
      each((i, a) => {
        disc(0, a - h, inner, hsv(h + 8 * i, s, 255));
        if (t.flop[1]) disc(1, a - h - 64, inner, hsv(h + 8 * i + 64, s, 255));
      });
      each((i, a) => {
        disc(2, a - h + 128, inner, hsv(h + 4 * i + 128, s, 255));
        if (t.flop[1]) disc(3, a - h + 64, inner, hsv(h + 4 * i - 64, s, 255));
      });
      break;
    case 1:
      each((i, a) => {
        ring(0, a - hm, inner, hsv(h, s, 255));
        if (t.flop[1]) ring(1, a - hm - 64, inner, hsv(h + 8 * i + 64, s, 255));
      });
      each((i, a) => {
        ring(2, a - h + 128, inner, hsv(h + 4 * i + 128, s, 255));
        if (t.flop[1]) ring(3, a - h + 64, inner, hsv(h - 64, s, 255));
      });
      break;
    case 2: {
      const rimmed = (which, angle, hue) => {
        disc(which, angle, inner, hsv(hue, s, 255));
        ring(which, angle, inner, WHITE);
      };
      each((i, a) => {
        if (t.flop[1]) rimmed(0, a - hm, h);
        rimmed(1, a - hm - 64, h + 64);
      });
      each((i, a) => {
        if (t.flop[1]) rimmed(2, a - hm + 128, h + 128);
        rimmed(3, a - hm + 64, h - 64);
      });
      break;
    }
    case 3: {
      const dotted = (which, angle, hue, rimHue) => {
        disc(which, angle, small, hsv(hue, s, 255));
        if (t.flop[1]) ring(which, angle, inner, hsv(rimHue, s, 255));
      };
      each((i, a) => {
        dotted(0, a - h, h, h - 32);
        if (t.flop[2]) dotted(1, a - h - 64, h + 85, h + 85 - 32);
      });
      each((i, a) => {
        dotted(2, a - hm + 128, h - 85, h - 85 - 32);
        if (t.flop[2]) dotted(3, a - hm + 64, h - 85 + 32, h - 85 - 32);
      });
      break;
    }
    case 4: {
      const other = t.flop[0] ? small : inner;
      each((i, a) => {
        disc(0, a - hm, small, hsv(h, s, 255));
        disc(1, a - hm - 64, other, hsv(h + 64, s, 255));
      });
      each((i, a) => {
        disc(2, a - hm + 128, small, hsv(h + 128, s, 255));
        disc(3, a - hm + 64, other, hsv(h - 64, s, 255));
      });
      break;
    }
    default:
      each((i, a) => {
        ring(2, a + hm + 128, inner, hsv(h + 128, s, 255));
        if (t.flop[1]) ring(3, a + hm + 64, inner, hsv(h - 64, s, 255));
      });
      each((i, a) => {
        ring(0, a - hm, inner, hsv(h, s, 255));
        if (t.flop[1]) ring(1, a - hm - 64, inner, hsv(h + 64, s, 255));
      });
      break;
  }
}

// ---------- third batch ----------

// Re-rolls the wind direction every 20 seconds.
export function twister(t) {
  if (t.every('twister', 20)) t.wind = t.random(0, 11);
}

export function starz2(t) {
  if (t.counter === 0) {
    t.inner = t.random(t.MIDLY - 8, t.MIDLY + 8) & 255;
    t.shifty = 1;
    t.dot = t.random(3, 8);
    t.dot2 = t.random(5, 9);
  }
  for (let j = 0; j < t.inner; ++j)
    t.drawstar(t.driftx, t.drifty, j, div(j, 3), t.dot2, t.h, t.h + j * t.dot);
}

export function starz3(t) {
  if (t.counter === 0) {
    t.dot = t.random(5, 9);
    t.howmany = t.random(3, 11);
    t.inner = t.random(div(t.BIGGER, 2), t.BIGGER) & 255;
  }
  // The sketch repeats this drawing `howmany` times over the same pixels.
  for (let j = 0; j < t.inner; ++j)
    t.drawstar(t.driftx, t.drifty, j, div(j, 2), t.howmany, t.h, t.h + j * t.dot);
}

export function rmagictime(t) {
  if (t.counter === 0) {
    t.raad = 1;
    t.ringdelay = t.random(40, 70);
  }
  if (t.raad < t.BIGGER - t.dot) {
    const hue = t.blender + t.h;
    t.DCircle(t.driftx, t.drifty, t.raad, hsv(hue, 255 - div(t.velo, 5), 255));
    t.DCircle(t.driftx, t.drifty, t.raad + 1, hsv(hue, 255 - div(t.velo, 4), 255));
    t.DCircle(t.driftx, t.drifty, t.raad - 1, hsv(hue, 255 - div(t.velo, 5), 255));
    t.raad++;
  }
  if (t.raad === t.BIGGER - t.dot) t.ringdelay--;
  if (t.ringdelay === 0) {
    t.raad = 1;
    t.ringdelay = t.random(40, 70);
  }
}

export function magictime(t) {
  const restart = (low, high) => {
    t.raad = t.random(div(t.BIGGER, 2), div(t.BIGGER * 2, 3));
    t.locusx = t.driftx;
    t.locusy = t.drifty;
    t.ringdelay = low === high ? low : t.random(low, high);
  };
  if (t.counter === 0) restart(50, 50);
  if (t.raad > 1) {
    t.DFCircle(t.locusx, t.locusy, t.raad, hsv(t.h * 3, 255 - t.counter % 128, 255));
    t.raad--;
  }
  if (t.raad === 2) {
    t.ringdelay = t.random(20, 70);
    t.raad--;
  }
  if (t.raad === 1) t.ringdelay--;
  if (t.ringdelay === 0) restart(40, 90);
}

export function seasick2(t) {
  if (t.counter === 0) t.sinewidth = t.random(4, 10);
  if (t.flop[1] && t.flop[3]) solid5(t);
  const saturation = 255 - div(t.velo, 6), quarter = div(t.MIDLY, 2), lower = div(t.MIDLY * 3, 2);
  for (let jj = 0; jj < t.W; ++jj) {
    const top = quarter - s8(-3 * t.h + jj * t.sinewidth) * t.MIDLY * 0.65;
    let color = hsv(t.h + div(jj, 2) + 80, saturation, 205);
    for (let gg = 0; gg < top; ++gg) t.add(jj, gg, color);
    color = hsv(t.h + div(jj, 2), saturation, 205);
    for (let gg = Math.trunc(lower - s8(-t.h + jj * t.sinewidth) * t.MIDLY * 0.65); gg < t.H; ++gg)
      t.add(jj, gg, color);
  }
}

export function seasick(t) {
  if (t.counter === 0) t.sinewidth = t.random(4, 8);
  const quarter = div(t.MIDLY, 2), lower = div(t.MIDLY * 3, 2);
  const wave = (phase, depth) => s8(phase) * t.MIDLY * depth;
  const upper = hsv(t.h + 128, 255 - div(t.velo, 6), 205);
  const under = hsv(t.h, 255 - div(t.blender, 6), 205);
  for (let jj = 0; jj < t.W; ++jj) {
    const a = jj * t.sinewidth;
    for (let gg = 0; gg < 2 + quarter - wave(-2 * t.h + a, 0.45); ++gg) t.set(jj, gg, RED);
    for (let gg = 0; gg < 8 + quarter - wave(t.h + a, 0.65); ++gg) t.add(jj, gg, upper);
    for (let gg = Math.trunc(-2 + lower - wave(2 * t.h + a, 0.45)); gg < t.H; ++gg) t.set(jj, gg, BLUE);
    for (let gg = Math.trunc(-8 + lower - wave(-t.h + a, 0.65)); gg < t.H; ++gg) t.add(jj, gg, under);
  }
}

export function seasick4(t) {
  if (t.counter === 0) {
    t.sinewidth = t.random(div(t.MIDLX, 9), div(t.MIDLX, 5));
    t.dot2 = t.random(6, 14);
    t.dot = t.random(6, 14);
  }
  t.bfade = 2;
  const quarter = div(t.MIDLY, 2), lower = div(t.MIDLY * 3, 2);
  for (let jj = 0; jj < t.W; ++jj) {
    t.DLine(jj, 2 + quarter - s8(-2 * t.h + jj * t.sinewidth) * t.MIDLY * 0.50, jj, 0,
      hsv(t.h + jj, 215, 255));
    t.DLine(jj, -2 + lower - s8(2 * t.h + jj * t.sinewidth) * t.MIDLY * 0.50, jj, t.H,
      hsv(t.h - jj, 225, 255));
  }
  const across = t.flop[3] || t.flop[5];
  for (let jj = 0; jj < t.W; ++jj) {
    const color = hsv(t.h + jj + 128, 155, 230);
    const offset = s8(t.h + jj * t.sinewidth) * t.MIDLY * 0.70;
    if (across) {
      for (let ii = -t.dot2; ii < t.dot2; ++ii) t.set(jj, ii + t.MIDLY + offset, color);
    } else {
      for (let ii = -t.dot * 2; ii < t.dot * 2; ++ii) t.set(ii + t.MIDLX + offset, jj, color);
    }
  }
}

export function seasick5(t) {
  if (t.counter === 0) {
    t.sinewidth = t.random(div(t.MIDLX, 8), div(t.MIDLX, 4));
    t.dot2 = t.random(6, 13);
    t.dot = t.random(6, 13);
  }
  t.bfade = 2;
  const quarter = div(t.MIDLY, 2), lower = div(t.MIDLY * 3, 2);
  const top = hsv(t.h + 85, 255, 255), bottom = hsv(t.h, 255, 205), band = hsv(t.h - 85, 255, 205);
  for (let jj = 0; jj < t.W; ++jj) {
    t.DLine(jj, 3 + quarter - s8(-2 * t.h + jj * t.sinewidth) * t.MIDLY * 0.525, jj, 0, top);
    t.DLine(jj, -3 + lower - s8(t.h + jj * t.sinewidth) * t.MIDLY * 0.525, jj, t.H, bottom);
  }
  if (t.flop[3] || t.flop[5]) {
    for (let jj = 0; jj < t.W; ++jj) {
      const centre = t.MIDLY + s8(4 * t.h + jj * t.sinewidth) * t.MIDLY * 0.60;
      for (let ii = -t.dot2; ii < t.dot2; ++ii) t.add(jj, ii + centre, band);
    }
  } else {
    for (let jj = 0; jj < t.H; ++jj) {
      const centre = t.MIDLX + s8(-4 * t.h + jj * t.sinewidth) * t.MIDLX * 0.60;
      for (let ii = -t.dot; ii < t.dot; ++ii) t.add(ii + centre, jj, band);
    }
  }
}

export function tuber(t) {
  if (t.counter === 0) {
    for (let u = 0; u < t.BIGGER; ++u) {
      t.xfire[u] = t.driftx;
      t.yfire[u] = t.drifty;
      t.fcount[u] = u * 2 + 8;
      t.fcolor[u] = u * 3;
    }
  }
  t.dot = t.beatsin8(1, 4, 7, 2);
  if (t.flop[5] || t.flop[4]) t.rgb.fill(0);
  for (let u = 0; u < t.BIGGER; ++u) {
    t.fcount[u]++;
    if (t.fcount[u] > t.W + t.dot3 - 1) {
      t.fcount[u] = 8;
      t.xfire[u] = t.driftx;
      t.yfire[u] = t.drifty;
    }
    if (!t.flop[3])
      t.DCircle(t.xfire[u], t.yfire[u], t.fcount[u], hsv(t.fcolor[u] + t.h, 255 - div(t.velo, 6), 255));
    else
      t.drawstar(t.xfire[u], t.yfire[u], t.fcount[u], div(t.fcount[u], t.dot2), t.dot, t.h, t.fcolor[u] + t.h);
  }
}

// Points fall towards the drifting centre along turning spokes.
function homing(t, low, high, maxSpeed) {
  if (t.counter === 0) {
    t.howmany = t.random(low, high);
    for (let i = 0; i < t.howmany; ++i) {
      t.fcount[i] = t.random8();
      t.fcolor[i] = t.blender + t.random8(64);
      t.fpeed[i] = t.random(1, maxSpeed);
      t.xpoffset[i] = t.random8();
    }
  }
  const saturation = 255 - div(t.velo, 5);
  for (let i = 0; i < t.howmany; ++i) {
    const phase = t.counter + t.xpoffset[i];
    t.set(t.driftx + (t.W - div(phase % t.W, t.fpeed[i])) * s8(t.fcount[i] + t.h),
      t.drifty + (t.H - div(phase % t.H, t.fpeed[i])) * c8(t.fcount[i] + t.h),
      hsv(t.flop[0] ? t.fcolor[i] : t.xblender, saturation, 255));
  }
  t.set(t.driftx, t.drifty, WHITE);
}

export function homer(t) {
  if (t.counter === 0) t.ccoolloorr = t.random8();
  homing(t, t.BIGGER, t.BIGGER * 2, 7);
}

export function homer3(t) {
  homing(t, t.BIGGER * 1.5, t.BIGGER * 2, 6);
}
