import { palette as rainbow, byte } from './aurora-fastled.js';
import { GRADIENTS } from './gradient-palettes.js';

export const PALETTES = [
  { id: 'original', name: 'Original pattern colours' },
  { id: 'rainbow', name: 'FastLED Rainbow' },
  ...GRADIENTS.map(({ id }) => ({ id, name: id.replace(/_gp$/, '').replaceAll('_', ' ') })),
];

export function gradientColour(stops, index) {
  index = byte(index);
  let upper = 4;
  while (upper < stops.length - 4 && index > stops[upper]) upper += 4;
  const lower = upper - 4;
  const fraction = (index - stops[lower]) / Math.max(1, stops[upper] - stops[lower]);
  return [
    stops[lower + 1] + (stops[upper + 1] - stops[lower + 1]) * fraction,
    stops[lower + 2] + (stops[upper + 2] - stops[lower + 2]) * fraction,
    stops[lower + 3] + (stops[upper + 3] - stops[lower + 3]) * fraction,
  ];
}

export class PatternPalette {
  constructor() {
    this.id = 'original';
    this.mix = 1;
    this.previous = null;
  }

  set(id = 'original', original = rainbow) {
    if (!PALETTES.some(palette => palette.id === id))
      throw new Error(`Unknown pattern palette: ${id}`);
    if (id === this.id) return;
    this.previous = Array.from({ length: 256 }, (_, i) => this.colour(i, 255, original));
    this.id = id;
    this.stops = GRADIENTS.find(palette => palette.id === id)?.stops;
    this.mix = 0;
  }

  advance(seconds) {
    const next = this.mix + seconds / 2;
    this.mix = next >= 1 - 1e-9 ? 1 : next;
    if (this.mix === 1) this.previous = null;
  }

  colour(index, brightness = 255, original = rainbow) {
    const target = this.id === 'original' ? original(index) : this.id === 'rainbow' ?
      rainbow(index) : gradientColour(this.stops, index);
    const from = this.previous?.[byte(index)] ?? target;
    const mix = this.mix, scale = brightness / 255;
    return [
      Math.round((from[0] + (target[0] - from[0]) * mix) * scale),
      Math.round((from[1] + (target[1] - from[1]) * mix) * scale),
      Math.round((from[2] + (target[2] - from[2]) * mix) * scale),
    ];
  }
}
