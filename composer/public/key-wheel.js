// The Monitor's live key wheel: the Camelot wheel as the Camelot Wheel pattern
// draws it (patterns.js), 12 at the top and numbers clockwise, minor (A) in
// the inner ring and major (B) outside. Every key is shaded by how well it
// fits what the key detector has heard; the key in use is lit and ringed, its
// mixing neighbours outlined, and the detector's own best marked with a dot
// when it differs. A click on a key gives the operator's opinion of it to the
// detector (KeyDetector.choose). The geometry is pure, so tested.
import { compatibleCamelotKeys } from './key-detector.js';

// Radii as a share of the canvas's side, as in the pattern.
export const HUB = 0.17;
export const BETWEEN = 0.325;
export const RIM = 0.48;

// The Camelot number and letter under (x, y) on a square of `side`, or null
// off the rings.
export function segmentAt(x, y, side) {
  const dx = x / side - 0.5, dy = y / side - 0.5;
  const r = Math.hypot(dx, dy);
  if (r < HUB || r >= RIM) return null;
  const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
  const index = Math.round(turn * 12) % 12;
  return { number: index || 12, letter: r < BETWEEN ? 'A' : 'B' };
}

// Each key's share between the weakest and the strongest of the detector's
// scores (by Camelot label), so the wheel shows where the evidence leans even
// before it is sure; all 0 with no scores.
export function relativeScores(scores) {
  const values = scores ? Object.values(scores) : [];
  if (!values.length) return {};
  const low = Math.min(...values), high = Math.max(...values);
  return Object.fromEntries(Object.entries(scores).map(([label, score]) =>
    [label, high > low ? (score - low) / (high - low) : 0]));
}

const TAU = 2 * Math.PI;

// Draws the wheel on `canvas` for `key` (the key in use, as shownKey gives it,
// or null) and `scores` (KeyDetector.scores, or null).
export function drawKeyWheel(canvas, key, scores) {
  const g = canvas.getContext('2d');
  const side = Math.min(canvas.width, canvas.height);
  const c = side / 2;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const share = relativeScores(scores);
  const best = scores ? Object.entries(scores).reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
  const neighbours = key ? compatibleCamelotKeys(key.camelot) : [];
  const segments = [];
  for (let number = 1; number <= 12; ++number)
    for (const letter of ['A', 'B']) segments.push({ number, letter, label: `${number}${letter}` });
  const path = ({ number, letter }) => {
    const [inner, outer] = letter === 'A' ? [HUB, BETWEEN] : [BETWEEN, RIM];
    const middle = (number % 12) / 12 * TAU - TAU / 4;
    const p = new Path2D();
    p.arc(c, c, outer * side, middle - TAU / 24, middle + TAU / 24);
    p.arc(c, c, inner * side, middle + TAU / 24, middle - TAU / 24, true);
    p.closePath();
    return p;
  };
  for (const s of segments) {
    const hue = (s.number - 1) * 30;
    const inUse = key?.camelot.label === s.label;
    const t = share[s.label] ?? 0;
    const light = inUse ? 58 : 10 + 34 * t * t;
    g.fillStyle = `hsl(${hue} ${inUse ? 85 : 55}% ${light}%)`;
    const p = path(s);
    g.fill(p);
    g.lineWidth = Math.max(1, side / 150);
    g.strokeStyle = '#000';
    g.stroke(p);
    s.light = light;
  }
  // Neighbours outlined, then the key in use ringed on top.
  for (const s of segments.filter((s) => neighbours.includes(s.label))) {
    g.lineWidth = Math.max(1.5, side / 110);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.stroke(path(s));
  }
  if (key) {
    g.lineWidth = Math.max(2, side / 70);
    g.strokeStyle = key.held ? 'rgba(255,255,255,0.6)' : '#fff';
    g.setLineDash(key.chosen ? [side / 40, side / 70] : []);
    g.stroke(path(key.camelot));
    g.setLineDash([]);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 ${Math.round(side / 24)}px system-ui, sans-serif`;
  for (const s of segments) {
    const middle = (s.number % 12) / 12 * TAU - TAU / 4;
    const r = (s.letter === 'A' ? (HUB + BETWEEN) / 2 : (BETWEEN + RIM) / 2) * side;
    const x = c + r * Math.cos(middle), y = c + r * Math.sin(middle);
    g.fillStyle = s.light > 45 ? '#000' : 'rgba(255,255,255,0.85)';
    g.fillText(s.label, x, y);
    if (best === s.label && key?.camelot.label !== s.label) {
      // The detector's own best, where it differs from the key in use.
      g.beginPath();
      g.arc(x, y + side / 26, side / 110, 0, TAU);
      g.fill();
    }
  }
  // The hub names the key in use.
  g.fillStyle = key ? '#fff' : 'rgba(255,255,255,0.5)';
  g.font = `700 ${Math.round(side / 13)}px system-ui, sans-serif`;
  g.fillText(key ? key.camelot.label : '–', c, c - side / 40);
  g.font = `${Math.round(side / 30)}px system-ui, sans-serif`;
  g.fillText(key ? key.name.replace(' major', ' maj').replace(' minor', ' min') : 'no key', c, c + side / 28);
}
