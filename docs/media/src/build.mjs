#!/usr/bin/env node
// Draws MatrixPrism's README artwork as SVG and renders each to PNG with
// headless Chrome: the banner, the section headers, the feature tiles, and
// the pattern gallery (an HTML page over the contact sheets in ../patterns/,
// which composer/tools/pattern-frames.mjs makes). Everything is drawn by code
// from the numbers below, so it can be changed and made again.
//
//   node docs/media/src/build.mjs                 everything
//   node docs/media/src/build.mjs --only banner   one group: banner, headers,
//                                                 tiles, gallery
//   node docs/media/src/build.mjs --sheet <out.png> [--background <css colour>]
//                                                 a contact sheet of every
//                                                 delivered PNG, to look at
//
// The text is real text in the SVGs, set in Exo 2 (SIL Open Font License
// 1.1, fonts/OFL.txt), which the SVGs load from fonts/ by a relative URL; an
// SVG opened elsewhere falls back to a system sans. Chrome comes from
// composer/tools/headless.mjs (set CHROME if it is not found).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME } from '../../../composer/tools/headless.mjs';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(SRC, '..');
const SVG_DIR = path.join(MEDIA, 'svg');

// Colours: near-black blue and purple grounds, neon cyan, magenta and green.
const C = {
  ground0: '#06071a', ground1: '#120a2e', plate: '#070818',
  cyan: '#2ee6ff', magenta: '#ff4fd8', green: '#4dff9e', violet: '#9b7bff', blue: '#4d8dff', rose: '#ff5c8a',
  text: '#eef4ff', soft: '#b9c6e8', led: '#1a1f47',
};

// A small seeded random, so every build draws the same bars.
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fontStyle(fontPath) {
  return `<style>@font-face{font-family:'Exo 2';src:url('${fontPath}') format('woff2');font-weight:300 800}`
    + `text{font-family:'Exo 2','Avenir Next','Segoe UI',sans-serif}</style>`;
}

// Glow filters and the LED dot grid shared by every drawing.
function defs(id, { pitch = 10, led = 7 } = {}) {
  const o = (pitch - led) / 2;
  return `
  <filter id="${id}-glow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="${id}-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>
  <pattern id="${id}-leds" width="${pitch}" height="${pitch}" patternUnits="userSpaceOnUse">
    <rect x="${o}" y="${o}" width="${led}" height="${led}" rx="1.4" fill="${C.led}"/>
  </pattern>
  <linearGradient id="${id}-ground" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${C.ground0}"/><stop offset="1" stop-color="${C.ground1}"/>
  </linearGradient>`;
}

// A rounded frame: dark ground, LED grid, and a glowing edge in one or two colours.
function frame(id, x, y, w, h, rx, edge0, edge1 = edge0) {
  return `
  <linearGradient id="${id}-edge" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${edge0}"/><stop offset="1" stop-color="${edge1}"/>
  </linearGradient>
  <clipPath id="${id}-clip"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/></clipPath>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#${id}-ground)"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#${id}-leds)" opacity="0.75"/>`;
}

function edge(id, x, y, w, h, rx, width = 2.5) {
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" stroke="url(#${id}-edge)" stroke-width="${width + 3}" opacity="0.35" filter="url(#${id}-soft)"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" stroke="url(#${id}-edge)" stroke-width="${width}"/>`;
}

// Lit LEDs standing as spectrum bars on the grid, from x0 to x1, floor at y.
function bars(x0, x1, floor, maxRows, colours, seed, { pitch = 10, led = 7, fadeFrom = null, fadeTo = null, opacity = 1 } = {}) {
  const rand = random(seed), o = (pitch - led) / 2;
  let out = '';
  const first = Math.ceil(x0 / pitch), last = Math.floor(x1 / pitch);
  for (let col = first; col < last; ++col) {
    const t = (col - first) / Math.max(1, last - first - 1);
    // A spectrum-like envelope: louder low end, a few peaks, some noise.
    const envelope = 0.35 + 0.45 * Math.abs(Math.sin(t * 7.3 + seed)) * (1 - 0.4 * t) + 0.25 * rand();
    const rows = Math.max(1, Math.round(envelope * maxRows));
    let fade = 1;
    if (fadeFrom !== null) fade = Math.max(0, Math.min(1, (col * pitch - fadeFrom) / (fadeTo - fadeFrom)));
    for (let row = 0; row < rows; ++row) {
      const level = row / Math.max(1, maxRows - 1);
      const colour = colours[Math.min(colours.length - 1, Math.floor(level * colours.length))];
      const a = r1((0.35 + 0.65 * (1 - level * 0.5)) * fade * opacity * 100) / 100;
      if (a <= 0) continue;
      out += `<rect x="${col * pitch + o}" y="${floor - (row + 1) * pitch + o}" width="${led}" height="${led}" rx="1.4" fill="${colour}" opacity="${a}"/>`;
    }
  }
  return out;
}

// A flowing line across the frame: a sum of sines.
function wave(x0, x1, cy, amp, seed, step = 8) {
  const rand = random(seed);
  const parts = [0, 1, 2].map(() => ({ k: 0.004 + rand() * 0.012, p: rand() * 6.28, a: 0.4 + rand() * 0.6 }));
  let d = '';
  for (let x = x0; x <= x1; x += step) {
    const y = cy + amp * parts.reduce((s, q) => s + q.a * Math.sin(x * q.k + q.p), 0) / 2;
    d += `${d ? 'L' : 'M'}${r1(x)} ${r1(y)}`;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Line icons, drawn in a 100×100 box, stroked in the accent colour.

const ICONS = {
  // An LED panel with a ring of lit LEDs.
  patterns(a) {
    let s = `<rect x="6" y="14" width="88" height="72" rx="8" fill="none" stroke="${a}" stroke-width="4"/>`;
    for (let r = 0; r < 5; ++r) {
      for (let c = 0; c < 7; ++c) {
        const x = 15 + c * 12, y = 23 + r * 12;
        const d = Math.hypot(c - 3, (r - 2) * 1.25);
        const lit = Math.abs(d - 2.2) < 0.75 || d < 0.5;
        s += `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1.5" fill="${lit ? a : 'none'}" stroke="${a}" stroke-width="${lit ? 0 : 1.2}" opacity="${lit ? 1 : 0.45}"/>`;
      }
    }
    return s;
  },
  // A, B → Left; C, D → Right; Left and Right → the main.
  quad(a) {
    const box = (x, y, t) => `<rect x="${x - 9}" y="${y - 9}" width="18" height="18" rx="4" fill="none" stroke="${a}" stroke-width="3.5"/>`
      + `<text x="${x}" y="${y + 4.5}" font-size="12.5" font-weight="700" fill="${a}" text-anchor="middle">${t}</text>`;
    const dot = (x, y, t) => `<circle cx="${x}" cy="${y}" r="10" fill="none" stroke="${a}" stroke-width="3.5"/>`
      + `<text x="${x}" y="${y + 4.5}" font-size="12" font-weight="700" fill="${a}" text-anchor="middle">${t}</text>`;
    const line = (d) => `<path d="${d}" fill="none" stroke="${a}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`;
    return line('M14 21 C14 36 28 34 28 44') + line('M38 21 C38 36 28 34 28 44')
      + line('M62 21 C62 36 72 34 72 44') + line('M86 21 C86 36 72 34 72 44')
      + line('M28 64 C28 76 50 72 50 80') + line('M72 64 C72 76 50 72 50 80')
      + box(14, 12, 'A') + box(38, 12, 'B') + box(62, 12, 'C') + box(86, 12, 'D')
      + dot(28, 54, 'L') + dot(72, 54, 'R')
      + `<circle cx="50" cy="88" r="9" fill="${a}"/>`;
  },
  // A Camelot wheel: twelve sectors, one lit, the key in the middle.
  key(a) {
    let s = '';
    for (let i = 0; i < 12; ++i) {
      const a0 = (i * 30 - 90 - 13) * Math.PI / 180, a1 = (i * 30 - 90 + 13) * Math.PI / 180;
      const R = 44, r = 30;
      const p = (rad, ang) => `${r1(50 + rad * Math.cos(ang))} ${r1(50 + rad * Math.sin(ang))}`;
      const d = `M${p(R, a0)} A${R} ${R} 0 0 1 ${p(R, a1)} L${p(r, a1)} A${r} ${r} 0 0 0 ${p(r, a0)} Z`;
      const lit = i === 7;
      s += `<path d="${d}" fill="${lit ? a : 'none'}" stroke="${a}" stroke-width="2.5" stroke-linejoin="round" opacity="${lit ? 1 : 0.7}"/>`;
    }
    return s + `<text x="50" y="58" font-size="22" font-weight="700" fill="${a}" text-anchor="middle">8A</text>`;
  },
  // Spectrum bars with peak caps.
  spectrum(a) {
    const h = [58, 72, 50, 64, 40, 30, 44, 22];
    return h.map((v, i) => {
      const x = 9 + i * 11;
      return `<rect x="${x}" y="${90 - v}" width="7" height="${v}" rx="2" fill="${a}" opacity="${0.55 + 0.45 * (1 - i / 8)}"/>`
        + `<rect x="${x}" y="${90 - v - 9}" width="7" height="3" rx="1.5" fill="${a}"/>`;
    }).join('') + `<path d="M4 94 H96" stroke="${a}" stroke-width="3" stroke-linecap="round"/>`;
  },
  // A pad controller: four pads, one struck.
  midi(a) {
    let s = `<rect x="8" y="16" width="84" height="70" rx="9" fill="none" stroke="${a}" stroke-width="4"/>`;
    [[18, 26], [52, 26], [18, 54], [52, 54]].forEach(([x, y], i) => {
      s += `<rect x="${x}" y="${y}" width="30" height="22" rx="4" fill="${i === 0 ? a : 'none'}" stroke="${a}" stroke-width="3"/>`;
    });
    return s + `<path d="M50 16 V6" stroke="${a}" stroke-width="4" stroke-linecap="round"/>`;
  },
  // The record button, over a strip of film.
  record(a) {
    return `<circle cx="50" cy="46" r="34" fill="none" stroke="${a}" stroke-width="4"/>`
      + `<circle cx="50" cy="46" r="19" fill="${a}"/>`
      + `<text x="50" y="98" font-size="15" font-weight="700" fill="${a}" text-anchor="middle" letter-spacing="2">MP4</text>`;
  },
  // Broadcast arcs around a dot.
  live(a) {
    const arc = (r, side) => {
      const s = side < 0 ? 0 : 1;
      const x = 50 + side * r * Math.cos(Math.PI / 4), y0 = 50 - r * Math.sin(Math.PI / 4), y1 = 50 + r * Math.sin(Math.PI / 4);
      return `<path d="M${r1(x)} ${r1(y0)} A${r} ${r} 0 0 ${s} ${r1(x)} ${r1(y1)}" fill="none" stroke="${a}" stroke-width="4.5" stroke-linecap="round"/>`;
    };
    return `<circle cx="50" cy="50" r="10" fill="${a}"/>` + arc(24, -1) + arc(24, 1) + arc(40, -1) + arc(40, 1);
  },
  // A panel taking a signal from above.
  receivers(a) {
    let s = '';
    for (const r of [14, 26]) {
      s += `<path d="M${50 - r * 0.8} ${30 - r * 0.6} A${r} ${r} 0 0 0 ${50 + r * 0.8} ${30 - r * 0.6}" transform="rotate(180 50 ${30 - r * 0.6 / 2 - 4})" fill="none" stroke="${a}" stroke-width="4" stroke-linecap="round"/>`;
    }
    s += `<path d="M50 30 V44" stroke="${a}" stroke-width="4" stroke-linecap="round"/>`;
    s += `<rect x="10" y="46" width="80" height="46" rx="7" fill="none" stroke="${a}" stroke-width="4"/>`;
    for (let r = 0; r < 3; ++r) {
      for (let c = 0; c < 6; ++c) {
        const lit = (c + r) % 3 === 0;
        s += `<rect x="${20 + c * 11.5}" y="${54 + r * 11}" width="7" height="7" rx="1.5" fill="${a}" opacity="${lit ? 1 : 0.4}"/>`;
      }
    }
    return s;
  },
  // A screen with the app's panes in it.
  desktop(a) {
    return `<rect x="6" y="12" width="88" height="60" rx="7" fill="none" stroke="${a}" stroke-width="4"/>`
      + `<path d="M6 24 H94" stroke="${a}" stroke-width="3"/>`
      + `<circle cx="14" cy="18" r="2.2" fill="${a}"/><circle cx="21" cy="18" r="2.2" fill="${a}"/><circle cx="28" cy="18" r="2.2" fill="${a}"/>`
      + `<rect x="14" y="31" width="34" height="34" rx="3" fill="${a}" opacity="0.85"/>`
      + `<rect x="54" y="31" width="32" height="15" rx="3" fill="none" stroke="${a}" stroke-width="2.5"/>`
      + `<rect x="54" y="50" width="32" height="15" rx="3" fill="none" stroke="${a}" stroke-width="2.5"/>`
      + `<path d="M40 72 L36 86 H64 L60 72" fill="none" stroke="${a}" stroke-width="4" stroke-linejoin="round"/>`
      + `<path d="M30 88 H70" stroke="${a}" stroke-width="4" stroke-linecap="round"/>`;
  },
  // A download into a tray: getting started.
  start(a) {
    return `<path d="M50 10 V60 M30 42 L50 62 L70 42" fill="none" stroke="${a}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<path d="M14 66 V84 Q14 90 20 90 H80 Q86 90 86 84 V66" fill="none" stroke="${a}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  },
  // Faders: the composer's controls.
  sliders(a) {
    return [[22, 36], [50, 64], [78, 28]].map(([x, y]) => `<path d="M${x} 10 V90" stroke="${a}" stroke-width="4" stroke-linecap="round" opacity="0.6"/>`
      + `<rect x="${x - 10}" y="${y - 7}" width="20" height="14" rx="4" fill="${a}"/>`).join('');
  },
};

function icon(name, accent, x, y, size) {
  return `<g transform="translate(${x} ${y}) scale(${size / 100})">${ICONS[name](accent)}</g>`;
}

// ---------------------------------------------------------------------------
// The banner.

function banner(fontPath) {
  const W = 1280, H = 320, id = 'b';
  const fx = 10, fy = 10, fw = W - 20, fh = H - 20, rx = 26;
  const prismX = 286, prismY = 150;
  // The prism: a white beam in from the left, three colours out to the right.
  const tri = `M${prismX} ${prismY - 46} L${prismX + 46} ${prismY + 34} L${prismX - 46} ${prismY + 34} Z`;
  // Each ray leaves the prism's right face and bends into a flowing line.
  const face = [prismX + 23, prismY - 6];
  const ray = (i, spread, amp, seed) => {
    const line = wave(prismX + 170, fx + fw, prismY + spread, amp, seed, 10);
    const [, x1, y1] = line.match(/^M([-0-9.]+) ([-0-9.]+)/);
    return `M${face[0]} ${face[1] + i * 3} C${face[0] + 60} ${face[1] + i * 3 + spread * 0.2} ${Number(x1) - 70} ${y1} ${x1} ${y1} L${line.slice(1)}`;
  };
  let rays = '';
  [[C.cyan, -40, 120, 11], [C.magenta, 4, 140, 18], [C.green, 44, 110, 25]].forEach(([colour, spread, amp, seed], i) => {
    const d = ray(i, spread, amp, seed);
    rays += `<path d="${d}" fill="none" stroke="${colour}" stroke-width="8" opacity="0.28" filter="url(#${id}-soft)"/>`;
    rays += `<path d="${d}" fill="none" stroke="${colour}" stroke-width="2.4" opacity="0.95"/>`;
  });
  let threads = '';
  for (let i = 0; i < 12; ++i) {
    const d = ray(1, (i - 6) * 10, 100 + (i % 4) * 22, 40 + i * 3);
    threads += `<path d="${d}" fill="none" stroke="url(#${id}-thread)" stroke-width="${i % 3 ? 0.9 : 1.4}" opacity="${0.25 + (i % 3) * 0.08}"/>`;
  }
  const beam = `<path d="M${fx} ${prismY + 34} L${prismX - 23} ${prismY - 6}" stroke="#ffffff" stroke-width="7" opacity="0.25" filter="url(#${id}-soft)"/>`
    + `<path d="M${fx} ${prismY + 34} L${prismX - 23} ${prismY - 6}" stroke="#ffffff" stroke-width="2.4" opacity="0.95"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <title>MatrixPrism: music-driven visuals for LED matrix panels</title>
  ${fontStyle(fontPath)}
  <defs>${defs(id)}
    <linearGradient id="${id}-word" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.cyan}"/><stop offset="0.55" stop-color="#c9b8ff"/><stop offset="1" stop-color="${C.magenta}"/>
    </linearGradient>
    <linearGradient id="${id}-thread" gradientUnits="userSpaceOnUse" x1="${prismX}" y1="0" x2="${fx + fw}" y2="0">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.25" stop-color="${C.cyan}"/><stop offset="0.6" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.magenta}"/>
    </linearGradient>
    <linearGradient id="${id}-plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.plate}" stop-opacity="0.6"/><stop offset="1" stop-color="${C.plate}" stop-opacity="0.78"/>
    </linearGradient>
  </defs>
  ${frame(id, fx, fy, fw, fh, rx, C.cyan, C.magenta)}
  <g clip-path="url(#${id}-clip)">
    ${bars(fx + 10, 250, fy + fh - 6, 10, [C.cyan, C.cyan, C.blue, C.violet], 3)}
    ${bars(1010, fx + fw - 10, fy + fh - 6, 11, [C.green, C.cyan, C.violet, C.magenta], 9)}
    ${bars(360, 990, fy + fh - 6, 5, [C.violet, C.magenta], 5, { opacity: 0.55 })}
    ${threads}
    ${beam}
    ${rays}
  </g>
  <path d="${tri}" fill="${C.plate}" fill-opacity="0.6" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" filter="url(#${id}-glow)"/>
  <rect x="356" y="82" width="740" height="150" rx="18" fill="url(#${id}-plate)" stroke="#ffffff" stroke-opacity="0.08"/>
  <text x="726" y="172" font-size="92" font-weight="600" fill="url(#${id}-word)" text-anchor="middle" letter-spacing="1" filter="url(#${id}-glow)">MatrixPrism</text>
  <text x="726" y="210" font-size="20" font-weight="500" fill="${C.soft}" text-anchor="middle" letter-spacing="4.5">MUSIC-DRIVEN VISUALS FOR LED MATRIX PANELS</text>
  ${edge(id, fx, fy, fw, fh, rx)}
</svg>
`;
}

// ---------------------------------------------------------------------------
// Section headers: a thin wide frame with an icon, a title and bars that fade in.

const HEADERS = [
  { file: 'header-quick-start', title: 'Quick start', icon: 'start', accent: C.green, seed: 21 },
  { file: 'header-composer', title: 'What the composer does', icon: 'sliders', accent: C.cyan, seed: 22 },
  { file: 'header-patterns', title: 'Patterns', icon: 'patterns', accent: C.magenta, seed: 23 },
  { file: 'header-receivers', title: 'Receivers', icon: 'receivers', accent: C.violet, seed: 24 },
  { file: 'header-going-live', title: 'Going live', icon: 'live', accent: C.rose, seed: 25 },
];

function header({ title, icon: iconName, accent, seed }, fontPath) {
  const W = 1280, H = 120, id = 'h';
  const fx = 8, fy = 8, fw = W - 16, fh = H - 16, rx = 18;
  const line = wave(640, fx + fw, 64, 40, seed, 8);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <title>${esc(title)}</title>
  ${fontStyle(fontPath)}
  <defs>${defs(id)}
    <linearGradient id="${id}-fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="0.8" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <mask id="${id}-mask"><rect width="${W}" height="${H}" fill="url(#${id}-fade)"/></mask>
  </defs>
  ${frame(id, fx, fy, fw, fh, rx, accent, C.violet)}
  <g clip-path="url(#${id}-clip)" mask="url(#${id}-mask)">
    ${bars(fx, fx + fw, fy + fh - 4, 7, [accent, accent, C.violet], seed)}
    <path d="${line}" fill="none" stroke="${accent}" stroke-width="6" opacity="0.3" filter="url(#${id}-soft)"/>
    <path d="${line}" fill="none" stroke="${accent}" stroke-width="2"/>
  </g>
  <rect x="30" y="26" width="68" height="68" rx="14" fill="${C.plate}" stroke="${accent}" stroke-width="2.5" filter="url(#${id}-glow)"/>
  ${icon(iconName, accent, 40, 36, 48)}
  <text x="124" y="76" font-size="42" font-weight="600" fill="${C.text}" letter-spacing="0.5">${esc(title)}</text>
  ${edge(id, fx, fy, fw, fh, rx, 2)}
</svg>
`;
}

// ---------------------------------------------------------------------------
// Feature tiles: one feature each, square, with a label and a short line.

const TILES = [
  { file: 'tile-patterns', icon: 'patterns', accent: C.magenta, label: 'Patterns', note: '140+ at the panel’s size' },
  { file: 'tile-quad-mixer', icon: 'quad', accent: C.cyan, label: 'Quad mixer', note: 'A B → Left, C D → Right' },
  { file: 'tile-tempo-key', icon: 'key', accent: C.violet, label: 'Tempo & key', note: 'Beat, BPM, Camelot key' },
  { file: 'tile-spectrum', icon: 'spectrum', accent: C.green, label: 'Spectrum', note: 'Stereo spectra and bands' },
  { file: 'tile-midi', icon: 'midi', accent: C.blue, label: 'MIDI', note: 'Pads for Tap and Downbeat' },
  { file: 'tile-record', icon: 'record', accent: C.rose, label: 'Record', note: 'Preview and audio to MP4' },
  { file: 'tile-go-live', icon: 'live', accent: C.magenta, label: 'Go live', note: 'To YouTube, panel-shaped' },
  { file: 'tile-receivers', icon: 'receivers', accent: C.cyan, label: 'Receivers · DDP', note: 'WLED or matrix-dmx' },
  { file: 'tile-desktop-app', icon: 'desktop', accent: C.green, label: 'Desktop app', note: 'macOS · Windows · Linux' },
];

function tile({ icon: iconName, accent, label, note }, fontPath) {
  const S = 256, id = 't';
  const f = 12, fw = S - 24, rx = 34;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <title>${esc(label)}: ${esc(note)}</title>
  ${fontStyle(fontPath)}
  <defs>${defs(id, { pitch: 8, led: 5 })}
    <radialGradient id="${id}-halo" cx="0.5" cy="0.42" r="0.5">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.22"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${frame(id, f, f, fw, fw, rx, accent)}
  <rect x="${f}" y="${f}" width="${fw}" height="${fw}" rx="${rx}" fill="url(#${id}-halo)"/>
  <g filter="url(#${id}-glow)">${icon(iconName, accent, 73, 40, 110)}</g>
  <text x="128" y="190" font-size="21" font-weight="600" fill="${C.text}" text-anchor="middle" letter-spacing="2">${esc(label.toUpperCase())}</text>
  <text x="128" y="214" font-size="14.5" font-weight="400" fill="${C.soft}" text-anchor="middle" letter-spacing="0.3">${esc(note)}</text>
  ${edge(id, f, f, fw, fw, rx, 3)}
</svg>
`;
}

// ---------------------------------------------------------------------------
// The pattern gallery: one frame from each kept contact sheet, framed and named.
// Sheets are 4 frames across, 4 px gaps, frames 256×192 (pattern-frames.mjs
// at --scale 1). `frame` picks which of the eight.

const GALLERY = [
  { id: 'spectrum-lab', name: 'Spectrum Lab', from: 'Spectrum analyser', frame: 0, accent: C.green },
  { id: 'aurora-curtains', name: 'Aurora Curtains', from: 'Shader', frame: 2, accent: C.cyan },
  { id: 'fire-2d', name: 'Fire', from: 'After FastLED’s Fire2012', frame: 0, accent: C.rose },
  { id: 'kaleido', name: 'Kaleidoscope', from: 'Shader', frame: 5, accent: C.magenta },
  { id: 'aurora-flowfield', name: 'Aurora Flow Field', from: 'Aurora port', frame: 3, accent: C.blue },
  { id: 'auroradrop-show', name: 'AuroraDrop Show', from: 'AuroraDrop port', frame: 0, accent: C.violet },
  { id: 'fibonacci-bloom', name: 'Fibonacci Bloom', from: 'Fibonacci128 adaptation', frame: 4, accent: C.green },
  { id: 'tme-67', name: 'Hypno Spiral II', from: 'Table Mark Estes port', frame: 1, accent: C.magenta },
];

function gallery(fontPath) {
  const cards = GALLERY.map(({ id, name, from, frame: n, accent }) => {
    const x = 4 + (n % 4) * 260, y = 4 + Math.floor(n / 4) * 196;
    return `<figure style="--accent:${accent}">
      <div class="shot" style="background-image:url('../patterns/${id}.png');background-position:-${x}px -${y}px"></div>
      <figcaption><b>${name}</b><span>${from}</span></figcaption>
    </figure>`;
  }).join('\n');
  return `<!doctype html>
<meta charset="utf-8">
<title>Pattern gallery</title>
<style>
@font-face { font-family: 'Exo 2'; src: url('${fontPath}') format('woff2'); font-weight: 300 800; }
html, body { margin: 0; background: transparent; }
body { width: 1280px; height: 676px; font-family: 'Exo 2', sans-serif; }
.frame { position: absolute; inset: 12px; border-radius: 26px; overflow: hidden;
  background: radial-gradient(circle at 1.5px 1.5px, ${C.led} 1.5px, transparent 2px) 0 0 / 10px 10px,
    linear-gradient(135deg, ${C.ground0}, ${C.ground1});
  box-shadow: 0 0 0 2.5px ${C.violet}, 0 0 8px 0 rgba(155, 123, 255, 0.5); }
.grid { position: absolute; left: 38px; top: 28px; display: grid; grid-template-columns: repeat(4, 280px); gap: 22px 20px; }
figure { margin: 0; padding: 12px 12px 10px; border-radius: 16px; background: rgba(7, 8, 24, 0.85);
  box-shadow: 0 0 0 2px var(--accent), 0 0 12px 0 var(--accent); }
.shot { width: 256px; height: 192px; border-radius: 6px; background-repeat: no-repeat; image-rendering: pixelated; }
figcaption { display: flex; flex-direction: column; padding-top: 8px; color: ${C.text}; }
figcaption b { font-weight: 600; font-size: 19px; letter-spacing: 0.3px; }
figcaption span { font-size: 13.5px; color: ${C.soft}; letter-spacing: 0.3px; }
.note { position: absolute; left: 0; right: 0; text-align: center; bottom: 24px; font-size: 14px; color: ${C.soft}; letter-spacing: 0.4px; }
</style>
<div class="frame">
  <div class="grid">
${cards}
  </div>
  <div class="note">Single frames drawn by the composer’s own renderer at 256×192, on its simulated audio (composer/tools/pattern-frames.mjs).</div>
</div>
`;
}

// ---------------------------------------------------------------------------
// Rendering with headless Chrome.

function render(source, out, width, height, profile) {
  const result = spawnSync(CHROME, ['--headless=new', `--screenshot=${out}`, `--window-size=${width},${height}`,
    '--hide-scrollbars', '--default-background-color=00000000', '--force-device-scale-factor=1',
    '--allow-file-access-from-files', '--virtual-time-budget=4000', `--user-data-dir=${profile}`,
    `file://${source}`], { encoding: 'utf8' });
  if (!fs.existsSync(out)) throw new Error(`Chrome wrote no ${out}: ${result.stderr}`);
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}

const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
if (!CHROME) throw new Error('Chrome was not found. Set CHROME to the path of Chrome or Chromium.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'media-build-'));

try {
  const sheetOut = option('--sheet');
  if (sheetOut) {
    contactSheet(path.resolve(sheetOut), option('--background') || '#0d1117', profile);
  } else {
    const only = option('--only');
    fs.mkdirSync(SVG_DIR, { recursive: true });
    const font = '../src/fonts/Exo2-latin.woff2';
    const draw = (name, svg, w, h) => {
      const file = path.join(SVG_DIR, `${name}.svg`);
      fs.writeFileSync(file, svg);
      render(file, path.join(MEDIA, `${name}.png`), w, h, profile);
    };
    if (!only || only === 'banner') draw('banner', banner(font), 1280, 320);
    if (!only || only === 'headers') for (const h of HEADERS) draw(h.file, header(h, font), 1280, 120);
    if (!only || only === 'tiles') for (const t of TILES) draw(t.file, tile(t, font), 256, 256);
    if (!only || only === 'gallery') {
      const page = path.join(SRC, 'gallery.html');
      fs.writeFileSync(page, gallery('fonts/Exo2-latin.woff2'));
      render(page, path.join(MEDIA, 'pattern-gallery.png'), 1280, 676, profile);
    }
  }
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}

// A contact sheet of every PNG delivered in docs/media, on a chosen
// background, for a person to look at everything at once. The page is
// written beside the output and removed after.
function contactSheet(out, background, profileDir) {
  const rel = (f) => path.relative(path.dirname(out), path.join(MEDIA, f)).split(path.sep).join('/');
  const pngs = (dir) => fs.readdirSync(path.join(MEDIA, dir)).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(dir, f));
  const top = pngs('.').filter((f) => f !== 'contact-sheet.png');
  const groups = [
    ['Banner', top.filter((f) => f.startsWith('banner'))],
    ['Section headers', top.filter((f) => f.startsWith('header-'))],
    ['Feature tiles', top.filter((f) => f.startsWith('tile-'))],
    ['Pattern gallery', top.filter((f) => f.startsWith('pattern-gallery'))],
    ['Composer views (screenshots)', pngs('screens')],
    ['Pattern contact sheets (8 frames each)', pngs('patterns')],
  ];
  const fg = /^#(0|1)/.test(background) ? '#c9d1d9' : '#1f2328';
  const body = groups.map(([name, files]) => `<h2>${name}</h2><div class="row ${name.startsWith('Feature') ? 'tiles' : ''}">`
    + files.map((f) => `<figure><img src="${rel(f)}"><figcaption>${f}</figcaption></figure>`).join('') + '</div>').join('\n');
  const page = `${out}.html`;
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; width: 2600px; background: ${background}; color: ${fg}; font: 15px -apple-system, 'Segoe UI', sans-serif; }
    h2 { margin: 18px 0 8px; font-weight: 600; } .row { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start; }
    figure { margin: 0; } figcaption { font-size: 12px; opacity: 0.7; padding-top: 3px; }
    img { display: block; max-width: 1280px; } .tiles img { width: 256px; }
    .row:has(img[src*="patterns/"]) img { width: 840px; }
    .row:has(img[src*="screens/"]) img { width: 840px; }
  </style>${body}`);
  // Tall enough for every group as delivered; make it taller if more are added.
  render(page, out, 2648, 3820, profileDir);
  fs.rmSync(page);
}
