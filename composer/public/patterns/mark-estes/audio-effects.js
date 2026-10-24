// Copyright Mark Estes (Table_Mark_Estes), adapted by Marc Merlin; JavaScript
// port copyright 2026 Anjin <anjin@skyhighatry.com>.
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0: ../../licenses/table-mark-estes.txt.
// This file is a modified, translated version of the sketch; the deliberate
// differences are listed in ./NOTICE.md.
// Audio-driven effects ported from Table_Mark_Estes_Impl.h. The sketch read
// two 64-bin spectra (left and right) from a second microcontroller; here
// they come from the composer's analyser through the runtime (see
// TmeRuntime.setAudio). Bars and spokes are spread over the whole panel at
// any width, where the sketch assumed a multiple of 64. See ./NOTICE.md.
import { sin8, cos8 } from '../../aurora-fastled.js';
import { div, hsv, WHITE } from './runtime.js';

const s8 = (angle) => (sin8(angle) - 128) / 128;
const c8 = (angle) => (cos8(angle) - 128) / 128;
const MSCALE = 1.4;

// The spectrum bin shown at position `x` of `span`, and hues that cover the
// colour wheel once across the panel or once across the 64 bins.
const bin = (x, span) => Math.min(63, div(x * 64, span));
const acrossHue = (t, x) => div(x * 256, t.W);
const binHue = (i) => i * 4;

export function solid2(t) {
  t.DFRectangle(0, 0, t.W - 1, t.H - 1, hsv(t.h, 255 - div(t.velo, 5), 128));
}

export function solid3(t) {
  if (t.counter === 0) t.rr = t.random8();
  t.DFRectangle(0, 0, t.W - 1, t.H - 1, hsv(t.rr + t.h, t.beatsin8(5, 160, 255), 128));
}

// Left spectrum below the centre line, right spectrum above it.
export function audio10(t) {
  for (let x = 0; x < t.W; ++x) {
    const i = bin(x, t.W), hue = acrossHue(t, x) + t.h;
    t.DLine(x, t.MIDLY, x, t.MIDLY + div(t.LLaudio[i] * t.H, 64), hsv(hue, 255 - div(t.velo, 4), 255));
    t.DLine(x, t.MIDLY - 1, x, t.MIDLY - 1 - div(t.RRaudio[i] * t.H, 64), hsv(hue, 255 - div(t.velo, 5), 255));
  }
  t.audioprocess();
}

// Right spectrum hanging from the top, left spectrum rising from the bottom.
export function audio11(t) {
  const saturation = 255 - div(t.velo, 5);
  for (let x = 0; x < t.W; ++x) {
    const i = bin(x, t.W), color = hsv(acrossHue(t, x) + t.h, saturation, 255);
    t.DLine(x, 0, x, div(div(t.RRaudio[i] * t.H, 64), 2), color);
    t.DLine(x, t.H - 1, x, t.H - 1 - div(div(t.LLaudio[i] * t.H, 64), 2), color);
  }
  t.audioprocess();
}

// Bars with coloured caps; `caps` lists [cap length, hue shift, saturation].
function cappedBars(t, levels, caps) {
  for (let x = 0; x < t.W; ++x) {
    const i = bin(x, t.W), top = div(div(levels[i] * t.H, 64), 2), hue = binHue(i) + t.blender;
    t.DLine(x, 0, x, top, hsv(hue, 255, 255));
    for (const [length, shift, saturation] of caps)
      t.DLine(x, top - length, x, top, hsv(hue + shift, saturation, 255));
  }
  t.audioprocess();
}

export function audio2(t) {
  cappedBars(t, t.LLaudio, [[8, -85, 196], [4, 85, 128]]);
}

export function audio3(t) {
  cappedBars(t, t.RRaudio, [[9, -64, 216], [6, -128, 176], [3, 64, 138]]);
}

// Stereo: left spectrum from the left edge, right spectrum from the right.
export function audio8(t) {
  const saturation = 255 - div(t.velo, 5);
  for (let y = 0; y < t.H; ++y) {
    const i = bin(y, t.H), color = hsv(binHue(i) + t.h, saturation, 255);
    t.DLine(0, y, div(div(t.LLaudio[i] * t.W, 64), 2), y, color);
    t.DLine(t.W - 1, y, t.W - 1 - div(div(t.RRaudio[i] * t.W, 64), 2), y, color);
  }
  t.audioprocess();
}

// Spokes reaching in from the panel's bounding ellipse.
function inwardSpokes(t, verticalReach, yTurn, hueOf) {
  const saturation = 255 - div(t.velo, 5);
  for (let k = 0; k < t.W; ++k) {
    const i = bin(k, t.W), angle = acrossHue(t, k);
    t.xangle = s8(angle - t.h);
    t.yangle = c8(angle + yTurn * t.h);
    const level = t.LLaudio[i];
    t.DLine(t.MIDLX + t.MIDLX * t.xangle, t.MIDLY + t.MIDLY * t.yangle,
      t.MIDLX + t.xangle * (t.MIDLX - div(level * t.W, 64) / (1.4 * MSCALE)),
      t.MIDLY + t.yangle * (t.MIDLY - div(level * verticalReach, 64) / (1.4 * MSCALE)),
      hsv(hueOf(i), saturation, 255));
  }
  t.audioprocess();
}

export function Raudio5(t) {
  const cycles = t.flop[6] ? 16 : 8;
  inwardSpokes(t, t.W, -1, (i) => i * cycles);
}

export function Raudio15(t) {
  inwardSpokes(t, t.H, t.flop[0] || t.flop[1] ? -1 : 1, (i) => binHue(i) - t.h);
}

// A turning burst of spokes around (locusx, locusy).
function burst(t, levels, saturation) {
  if (t.counter === 0) t.poffset = t.random8();
  const innerX = div(t.MIDLX, 4), innerY = div(t.MIDLY, 4);
  for (let k = 0; k < t.W; ++k) {
    const level = levels[bin(k, t.W)], angle = acrossHue(t, k);
    t.xangle = s8(angle - t.h);
    t.yangle = c8(angle - t.h);
    t.DLine(t.locusx + innerX * t.xangle, t.locusy + innerY * t.yangle,
      t.locusx + t.xangle * (innerX + div(level * t.W, 64) / MSCALE),
      t.locusy + t.yangle * (innerY + div(level * t.H, 64) / MSCALE),
      hsv(angle + t.poffset, saturation, 255));
  }
  t.audioprocess();
}

export function LaudioRoger(t) {
  burst(t, t.LLaudio, 255 - div(t.blender, 8));
}

export function RaudioRoger(t) {
  // The sketch has 1255 here; as a byte that is 231.
  burst(t, t.RRaudio, 1255 - div(t.blender, 8));
}

export function rogerv(t) {
  const saturation = 255 - div(t.velo, 5);
  for (let i = 0; i < 6; ++i)
    t.DLine(t.MIDLX, t.H - 2, i, 0, hsv(t.h + 20 - 10 * i, saturation, 255));
  t.DCircle(t.MIDLX, t.MIDLY * 0.6666, t.MIDLY >> 2, WHITE);
  t.HorizontalMirror();
}

// ---------- second audio batch ----------

// Calls draw(k, i, angle) for each spoke: k of t.W spokes, its spectrum bin
// and its angle around the circle in 1/256 turns.
function spokes(t, draw) {
  for (let k = 0; k < t.W; ++k) draw(k, bin(k, t.W), acrossHue(t, k));
}

// A spoke from radius `from` outwards by (lengthX, lengthY) along the
// current xangle and yangle, centred on the drifting centre.
function outward(t, from, lengthX, lengthY, color) {
  t.DLine(t.driftx + t.xangle * from, t.drifty + t.yangle * from,
    t.driftx + t.xangle * (from + lengthX), t.drifty + t.yangle * (from + lengthY), color);
}

// A spoke from the panel's bounding ellipse inwards by (lengthX, lengthY).
function inward(t, lengthX, lengthY, color) {
  t.DLine(t.MIDLX + t.MIDLX * t.xangle, t.MIDLY + t.MIDLY * t.yangle,
    t.MIDLX + t.xangle * (t.MIDLX - lengthX), t.MIDLY + t.yangle * (t.MIDLY - lengthY), color);
}

const reachW = (t, level) => div(level * t.W, 64);
const reachH = (t, level) => div(level * t.H, 64);

export function Raudio13(t) {
  if (t.counter === 0) t.poffset = t.random8();
  const saturation = 255 - div(t.velo, 5);
  spokes(t, (k, i, angle) => {
    t.xangle = s8(angle - t.h);
    t.yangle = c8(angle - t.h);
    outward(t, 5, reachW(t, t.RRaudio[i]) / (2 * MSCALE), reachH(t, t.RRaudio[i]) / (2 * MSCALE),
      hsv(i * 8 + t.poffset, saturation, 255));
  });
  t.audioprocess();
}

// Two rings of spokes: left spectrum near the centre, right further out.
function doubleRing(t, yTurn, hueStep, turning, outerDivisor) {
  spokes(t, (k, i, angle) => {
    t.xangle = s8(angle - turning * t.h);
    t.yangle = c8(angle + yTurn * turning * t.h);
    const inner = reachW(t, t.LLaudio[i]) / (2 * MSCALE);
    outward(t, 3, inner, inner,
      hsv(i * hueStep + t.blender + (hueStep === 4 ? t.h : 0), 255 - div(t.velo, 5), 255));
    const outer = reachH(t, t.RRaudio[i]) / (2 * MSCALE);
    outward(t, 24, outer, outer,
      hsv(i * hueStep + t.xblender + (hueStep === 4 ? t.h : 0), 255 - div(t.velo, outerDivisor), 255));
  });
  t.audioprocess();
}

export function Raudio3(t) {
  doubleRing(t, 1, 8, 0, 2);
}

export function Raudio14(t) {
  doubleRing(t, 1, 4, 1, 5);
}

export function Raudio4(t) {
  const hueStep = t.flop[6] ? 8 : 4, turn = t.flop[3] ? -t.h : t.h;
  const saturation = 255 - div(t.velo, 8);
  spokes(t, (k, i, angle) => {
    t.xangle = s8(angle + turn);
    t.yangle = c8(angle + turn);
    outward(t, t.dot + 1, reachW(t, t.LLaudio[i]) / MSCALE, reachH(t, t.LLaudio[i]) / MSCALE,
      hsv(i * hueStep + t.poffset, saturation, 255));
  });
  t.audioprocess();
}

// Interleaved left and right spokes reaching in from the rim.
function interleaved(t, turnLeft, turnRight, divisor, leftY, hueOf) {
  const saturation = 255 - div(t.velo, 5), half = div(128, t.W);
  spokes(t, (k, i, angle) => {
    t.xangle = s8(angle + turnLeft);
    t.yangle = c8(angle + turnLeft);
    const left = t.LLaudio[i];
    inward(t, reachW(t, left) / (divisor * MSCALE), leftY(left) / (divisor * MSCALE), hsv(hueOf(i), saturation, 255));
    t.xangle = s8(angle + turnRight + half);
    t.yangle = c8(angle + turnRight + half);
    const right = reachH(t, t.RRaudio[i]) / (divisor * MSCALE);
    inward(t, right, right, hsv(hueOf(i), saturation, 255));
  });
}

// Unlike its siblings, the sketch's Raudio1 does not refresh the audio.
export function Raudio1(t) {
  interleaved(t, -t.h, 0, 1.7, (level) => reachW(t, level), (i) => i * 8 + t.poffset);
}

export function Raudio2(t) {
  interleaved(t, t.h, t.h, 1.6, (level) => reachH(t, level), (i) => i * 8 + t.blender + t.h);
  t.audioprocess();
}

// Two dotted outlines whose shape follows the left and right spectra.
export function Raudio6(t) {
  if (t.counter === 0) t.poffset = t.random8();
  const saturation = 255 - div(t.velo, 5), moving = t.flop[1] || t.flop[2];
  spokes(t, (k, i, angle) => {
    t.xangle = s8(angle - t.h);
    t.yangle = c8(angle - t.h);
    const left = t.LLaudio[i], right = t.RRaudio[i];
    const hue = angle + t.poffset + (moving ? t.h : 0);
    t.set(t.driftx + t.xangle * (t.MIDLX - reachW(t, left) / (moving ? 1 : MSCALE)),
      t.drifty + t.yangle * (t.MIDLY - reachH(t, left) / MSCALE), hsv(hue, saturation, 255));
    t.set(t.driftx + t.xangle * (-2 + t.MIDLX - reachW(t, right) / MSCALE),
      t.drifty + t.yangle * (-2 + t.MIDLY - reachH(t, right) / (moving ? 1 : MSCALE)),
      hsv(hue + 128, saturation, 255));
  });
  t.audioprocess();
}

// Centre-line bars with a line from each bar's tip back towards the centre.
export function audio9(t) {
  const saturation = 255 - div(t.velo, 5);
  const tie = hsv(t.flop[2] ? t.blender : t.h, saturation, 255);
  for (let x = 0; x < t.W; ++x) {
    const i = bin(x, t.W), color = hsv(binHue(i) + t.h, saturation, 255);
    const below = t.MIDLY + reachW(t, t.LLaudio[i]) / 2, above = t.MIDLY - 1 - reachW(t, t.RRaudio[i]) / 2;
    t.DLine(x, t.MIDLY, x, below, color);
    t.DLine(x, t.MIDLY - 1, x, above, color);
    if (i > 0) {
      t.DLine(x, below, x - 1, t.MIDLY + div(t.LLaudio[i - 1] * 64, t.W) / 2, tie);
      t.DLine(x, above, x - 1, t.MIDLY - 1 - div(t.RRaudio[i - 1] * 64, t.W) / 2, tie);
    }
  }
  t.audioprocess();
}

// ---------- third audio batch ----------

// A 4 by 4 board of squares, one per coarse band; columns alternate between
// the left and right channels. Squares grow from a corner or from the centre.
function checkers(t, centred, advance) {
  if (advance) t.blender++;
  const cellW = div(t.W, 4), cellH = div(t.H, 4);
  t.DRectangle(0, 0, t.W - 1, t.H - 1, t.flop[2] ? hsv(t.blender, 255, 168) : WHITE);
  for (let i = 0; i < 4; ++i) {
    for (let qq = 0; qq < 4; ++qq) {
      t.ccoolloorr = t.blender + (i * 4 + qq) * 16;
      const level = Math.min(64, (i % 2 === 0 ? t.laudio : t.raudio)[i * 4 + qq]);
      const fill = hsv(t.ccoolloorr, 255 - div(t.velo, 5), 255);
      if (centred) {
        const half = div(level, 2) / 64;
        t.DFRectangle((i + 0.5 - half) * cellW, (qq + 0.5 - half) * cellH,
          (i + 0.5 + half) * cellW, (qq + 0.5 + half) * cellH, fill);
      } else {
        t.DFRectangle(i * cellW, qq * cellH, (level / 64 + i) * cellW, (qq + level / 64) * cellH, fill);
      }
      t.DRectangle(i * cellW, qq * cellH, (1 + i) * cellW, (qq + 1) * cellH,
        t.flop[2] ? hsv(t.ccoolloorr, 255 - div(t.velo, 2), 255) : WHITE);
    }
  }
  t.audioprocess();
}

export function audocheckers(t) {
  checkers(t, false, t.flop[5] && t.flop[6]);
}

export function audocheckers2(t) {
  checkers(t, true, t.flop[5]);
}

// A 4 by 4 board of discs. The sketch sizes its cells from the longer side,
// which pushes a row off a non-square panel; here the board fits the panel.
export function audiochess(t) {
  if (t.flop[5] && t.flop[6]) t.blender--;
  const cellW = div(t.W, 4), cellH = div(t.H, 4);
  const full = 1 + div(Math.min(cellW, cellH), 2);
  for (let i = 0; i < 4; ++i) {
    for (let qq = 0; qq < 4; ++qq) {
      t.ccoolloorr = t.blender + (i * 4 + qq) * 16;
      const x = (i + 0.5) * cellW, y = (qq + 0.5) * cellH;
      const left = t.laudio[i * 4 + qq] / 64 * full, right = t.raudio[i * 4 + qq] / 64 * full;
      const fillDivisor = t.flop[2] ? 8 : t.flop[3] ? 6 : 3;
      t.DFCircle(x, y, left, hsv(t.ccoolloorr, 255 - div(t.velo, fillDivisor), 255));
      if (t.flop[2]) t.DCircle(x, y, full, hsv(t.ccoolloorr, 255 - div(t.velo, 2), 255));
      else t.DCircle(x, y, t.flop[3] ? full : right, hsv(t.ccoolloorr + 85, 255 - div(t.velo, 3), 255));
    }
  }
  t.audioprocess();
}

// Left spokes all round the rim, right spokes folded into half of it.
export function Raudio18(t) {
  const scale = 1.6 * MSCALE;
  spokes(t, (k, i, angle) => {
    const left = t.LLaudio[i], right = t.RRaudio[i];
    const leftY = t.MIDLY - reachH(t, left) / scale;
    let color = hsv(binHue(i) + t.h, 255 - div(t.velo, 2), 255);
    t.xangle = s8(angle - t.h);
    t.yangle = c8(angle - t.h);
    inward(t, reachW(t, left) / scale, reachH(t, left) / scale, color);
    t.set(t.MIDLX + t.xangle * (t.MIDLX - reachH(t, right) / scale), t.MIDLY + t.yangle * leftY, color);
    color = hsv(binHue(i) + t.h, 255 - div(t.velo, 8), 255);
    t.xangle = s8(div(angle, 2) + t.h);
    t.yangle = c8(div(angle, 2) + t.h);
    inward(t, reachW(t, right) / scale, reachH(t, right) / scale, color);
    t.set(t.MIDLX + t.xangle * (t.MIDLX - reachW(t, right) / scale), t.MIDLY + t.yangle * leftY, color);
  });
  t.audioprocess();
}

// Sparks from the drifting centre; one band sets how many are flying.
export function audiofireball(t) {
  const colour = () => t.flop[0] ? t.blender + t.random(64) : t.random8();
  const capacity = t.BIGGER * 2;
  if (t.counter === 0) {
    for (let u = 0; u < capacity; ++u) {
      t.xfire[u] = t.driftx;
      t.yfire[u] = t.drifty;
      t.fpeed[u] = t.random(1, 5);
      t.yslope[u] = c8(t.xblender);
      t.xslope[u] = s8(t.xblender);
      t.fvelo[u] = t.random8();
      t.fcolor[u] = colour();
    }
  }
  t.howmany = Math.min(capacity, Math.trunc(t.BIGGER * t.raudio[t.dot3] / 32));
  for (let u = 0; u < t.howmany; ++u) {
    t.set(t.xfire[u], t.yfire[u], hsv(t.fcolor[u], div(t.fvelo[u], 4) + 192, 255));
    t.xfire[u] += t.xslope[u];
    t.yfire[u] += t.yslope[u];
    if (t.yfire[u] < 0 || t.yfire[u] > t.H - 1 || t.xfire[u] < 0 || t.xfire[u] > t.W - 1) {
      t.xfire[u] = t.driftx;
      t.yfire[u] = t.drifty;
      t.fcolor[u] = colour();
      t.xblender = t.random8();
      t.yslope[u] = c8(t.xblender);
      t.xslope[u] = s8(t.xblender);
    }
  }
  t.set(t.driftx, t.drifty, hsv(t.ccoolloorr - 96, 255 - div(t.velo, 5), 225));
  t.audioprocess();
}

// Two rings of dots or discs pulled in from the rim by the spectra.
export function Raudio19(t) {
  if (t.counter === 0) t.dot = t.random8(1, 3);
  const saturation = 255 - div(t.velo, 5), halfW = div(t.W, 2), halfH = div(t.H, 2);
  spokes(t, (k, i, angle) => {
    t.xangle = s8(angle - t.h);
    t.yangle = c8(angle - t.h);
    const left = [t.MIDLX + t.xangle * (halfW - reachW(t, t.LLaudio[i]) / MSCALE),
      t.MIDLY + t.yangle * (halfH - reachH(t, t.LLaudio[i]) / MSCALE)];
    const right = [t.MIDLX + t.xangle * (1 + halfW - reachW(t, t.RRaudio[i]) / MSCALE),
      t.MIDLY + t.yangle * (1 + halfH - reachH(t, t.RRaudio[i]) / MSCALE)];
    const main = hsv(binHue(i) + t.blender, saturation, 255);
    if (t.flop[2] || t.flop[1]) {
      t.DFCircle(...left, t.dot, main);
      t.DFCircle(...right, t.dot, t.flop[2] ? hsv(binHue(i) + t.xblender + 128, saturation, 255) : WHITE);
    } else {
      t.set(...left, t.flop[0] ? WHITE : main);
      t.set(...right, t.flop[0] ? WHITE : main);
    }
  });
  t.audioprocess();
}

// Left spectrum about the upper quarter line, right about the lower one.
export function audio12(t) {
  const upper = div(t.MIDLY, 2), lower = div(t.MIDLY * 3, 2);
  for (let x = 0; x < t.W; ++x) {
    const i = bin(x, t.W), hue = acrossHue(t, x) + t.h;
    const left = div(div(div(t.LLaudio[i] * t.H, 64), 2), 2), right = div(div(div(t.RRaudio[i] * t.H, 64), 2), 2);
    let color = hsv(hue, 255 - div(t.velo, 4), 255);
    t.DLine(x, upper, x, upper + left, color);
    t.DLine(x, upper, x, upper - left, color);
    color = hsv(hue, 255 - div(t.velo, 5), 255);
    t.DLine(x, lower, x, lower - right, color);
    t.DLine(x, lower, x, lower + right, color);
  }
  t.audioprocess();
}

// ---------- fourth audio batch ----------

// Two or four coloured hubs orbit the drifting centre; spokes whose length
// follows the left (across) and right (up and down) spectra fan out from
// them, and in the four-hub form also bridge between hubs.
function orbitingHubs(t, minOrbit, pairHues, quadHues, divisor) {
  if (t.counter === 0) {
    t.poffset = t.random8();
    t.radius3 = t.random(minOrbit, t.MIDLX - 2);
  }
  t.locusy = (t.radius3 * (cos8(t.h) - 128)) >> 7;
  t.locusx = (t.radius3 * (sin8(t.h) - 128)) >> 7;
  const lx = t.locusx, ly = t.locusy, innerX = div(t.MIDLX, 4), innerY = div(t.MIDLY, 4);
  const hubSaturation = 255 - div(t.velo, 5), saturation = 255 - div(t.velo, divisor);
  const pair = t.flop[4];
  // [x sign, y sign, hue shift] for each hub.
  const hubs = pair ? (t.flop[3] ? [[1, 1, 64], [-1, -1, -64]] : [[1, 1, 85], [-1, -1, -85]]) :
    t.flop[3] ? [[1, 1, 32], [-1, -1, 64], [-1, 1, -32], [1, -1, -64]] :
      [[1, 1, 42], [-1, -1, 84], [1, -1, -84], [-1, 1, -42]];
  // [start hub signs, end hub signs] for each spoke drawn per angle.
  const links = pair ? [[1, 1, 1, 1], [-1, -1, -1, -1]] :
    [[1, 1, 1, 1], [-1, -1, -1, -1], [-1, 1, 1, 1], [1, -1, -1, -1]];
  const hues = pair ? pairHues : quadHues;
  const spoke = (k, i, angle) => {
    t.xangle = s8(angle - t.h);
    t.yangle = c8(angle - t.h);
    const reachX = innerX + reachW(t, t.LLaudio[i]) / MSCALE, reachY = innerY + reachH(t, t.RRaudio[i]) / MSCALE;
    links.forEach(([sx, sy, ex, ey], n) => {
      t.DLine(t.driftx + sx * lx + innerX * t.xangle, t.drifty + sy * ly + innerY * t.yangle,
        t.driftx + ex * lx + t.xangle * reachX, t.drifty + ey * ly + t.yangle * reachY,
        hsv(angle + t.poffset + hues[n], saturation, 255));
    });
  };
  spokes(t, spoke);
  // The sketch repaints the hubs before every spoke, so only the last
  // spoke's lines are left showing across them.
  for (const [sx, sy, shift] of hubs)
    t.DFCircle(t.driftx + sx * lx, t.drifty + sy * ly, innerY, hsv(t.h + shift, hubSaturation, 220));
  spoke(t.W - 1, bin(t.W - 1, t.W), acrossHue(t, t.W - 1));
  t.audioprocess();
}

export function Raudio7(t) {
  orbitingHubs(t, div(t.MIDLX, 2) - 2, [128, 0], [64, 128, -64, 0], 5);
}

export function Raudio17(t) {
  orbitingHubs(t, div(t.MIDLX, 3), [0, 0], [128, 128, 0, 0], 2);
}

// Sixteen concentric arcs, one per coarse band, whose length follows the
// band. Ring spacing and point density are scaled up from the sketch's
// 64-pixel layout, and the bands cover the whole spectrum rather than its
// lowest quarter.
function arcs(t, cx, cy, baseX, baseY, spacing, step, rightStart, rightSign, hueOf) {
  const scale = Math.max(1, Math.round(Math.min(t.W, t.H) / 64));
  const saturation = 255 - div(t.velo, 5);
  // Angles are in 1/256 turns from the top; each unit of level adds `step`.
  const arc = (level, rx, ry, from, sign, j) => {
    for (let i = 0; i < level; ++i) {
      const color = hsv(hueOf(j, i), saturation, 255);
      // Sub-step angles keep long arcs solid on large panels.
      for (let fine = -scale; fine <= scale; ++fine) {
        const radians = (from + sign * (i * step + fine / scale)) * Math.PI / 128;
        t.set(cx + rx * Math.sin(radians), cy + ry * Math.cos(radians), color);
      }
    }
  };
  for (let j = 0; j < 16; ++j) {
    const rx = baseX + spacing * scale * j, ry = baseY + spacing * scale * j;
    arc(t.laudio[j], rx, ry, 0, 1, j);
    arc(t.raudio[j], rx, ry, rightStart, rightSign, j);
  }
  t.audioprocess();
}

export function circleaudio(t) {
  if (t.flop[10]) {
    t.driftx = t.MIDLX;
    t.drifty = t.MIDLY;
  }
  t.dot = t.flop[9] ? 1 : 2;
  t.dot2 = div(t.MIDLX, t.flop[9] ? 2 : 4);
  // Left arcs start at the top and right arcs opposite, turning the same way.
  arcs(t, t.driftx, t.drifty, t.dot2, t.dot2, t.dot, 2, 128, 1, (j) => j * 16 * t.dot + t.blender);
}

// Left and right arcs both start at the top and turn opposite ways.
export function circleaudio2(t) {
  arcs(t, t.MIDLX, t.MIDLY, div(t.MIDLX, 4), div(t.MIDLY, 4), 2, 3, 0, -1, (j) => j * 32 + t.blender);
}

export function circleaudio3(t) {
  arcs(t, t.MIDLX, t.MIDLY, div(t.MIDLX, 4), div(t.MIDLY, 4), 2, 3, 0, -1, (j, i) => j * 32 + t.blender + i * 4);
}
