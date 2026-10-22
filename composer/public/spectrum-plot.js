import { AuroraBuffer, palette } from './aurora-fastled.js';
import { PALETTES, gradientColour } from './palettes.js';
import { GRADIENTS } from './gradient-palettes.js';

export const FFT_SIZES = [512, 1024, 2048, 4096, 8192, 16384, 32768];
export const SPECTRUM_DEFAULTS = {
  layout: 'bars', bands: 'third', count: 64, fftSize: 8192,
  minHz: 30, maxHz: 16000, floorDb: -90, ceilingDb: -15, slope: 0, gainDb: 0,
  aggregation: 'power', attack: 25, release: 250,
  peaks: true, hold: 800, fall: 24, curve: 'linear',
  grid: true, labels: true, thickness: 1, gap: 0.2, rotation: 0, turns: 2,
  colour: 'frequency', paletteId: 'rainbow',
};

export const SPECTRUM_PRESETS = {
  'Third-octave meter': { ...SPECTRUM_DEFAULTS },
  'Smooth analyser': { ...SPECTRUM_DEFAULTS, layout: 'line', bands: 'log', count: 128, curve: 'smooth', aggregation: 'peak' },
  'Octave pillars': { ...SPECTRUM_DEFAULTS, bands: 'octave', attack: 10, release: 400, colour: 'level' },
  'Circular crown': { ...SPECTRUM_DEFAULTS, layout: 'circle', bands: 'log', count: 64, grid: false },
  'Spectral spiral': { ...SPECTRUM_DEFAULTS, layout: 'spiral', bands: 'sixth', curve: 'smooth', grid: false, peaks: false },
  'Mirrored ribbon': { ...SPECTRUM_DEFAULTS, layout: 'mirror', bands: 'log', curve: 'smooth', peaks: false },
};

export function spectrumOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new Error('Spectrum settings must be an options object.');
  const result = { ...SPECTRUM_DEFAULTS, ...options };
  for (const [key, choices] of Object.entries({
    layout: ['bars', 'line', 'area', 'mirror', 'circle', 'spiral'],
    bands: ['log', 'linear', 'octave', 'third', 'sixth'],
    aggregation: ['power', 'peak'], curve: ['linear', 'smooth'],
    colour: ['frequency', 'level', 'solid'],
    paletteId: PALETTES.filter(p => p.id !== 'original').map(p => p.id),
  })) {
    if (!choices.includes(result[key])) throw new Error(`Invalid spectrum ${key}: ${result[key]}`);
  }
  for (const [key, min, max] of [
    ['count', 4, 256], ['minHz', 10, 20000], ['maxHz', 20, 24000],
    ['floorDb', -140, -1], ['ceilingDb', -100, 0], ['slope', -12, 12], ['gainDb', -30, 30],
    ['attack', 0, 2000], ['release', 0, 5000], ['hold', 0, 10000],
    ['fall', 1, 120], ['thickness', 0.5, 8], ['gap', 0, 0.9],
    ['rotation', 0, 360], ['turns', 1, 5],
  ]) {
    if (!Number.isFinite(result[key]) || result[key] < min || result[key] > max)
      throw new Error(`Spectrum ${key} must be between ${min} and ${max}.`);
  }
  if (!Number.isInteger(result.count)) throw new Error('Spectrum band count must be an integer.');
  if (!FFT_SIZES.includes(result.fftSize)) throw new Error('Invalid spectrum FFT size.');
  if (result.minHz >= result.maxHz) throw new Error('Spectrum minimum frequency must be below maximum.');
  if (result.floorDb >= result.ceilingDb) throw new Error('Spectrum dB floor must be below ceiling.');
  if (typeof result.peaks !== 'boolean' || typeof result.grid !== 'boolean' || typeof result.labels !== 'boolean')
    throw new Error('Spectrum peak and grid settings must be boolean.');
  return result;
}

export function frequencyBands(options, sampleRate) {
  const low = options.minHz, high = Math.min(options.maxHz, sampleRate / 2);
  if (low >= high) throw new Error('Spectrum frequency range is above the input Nyquist frequency.');
  const fraction = { octave: 1, third: 3, sixth: 6 }[options.bands];
  if (fraction) {
    const result = [];
    const ratio = 2 ** (1 / (2 * fraction));
    const start = Math.ceil(fraction * Math.log2(low / (1000 * ratio)));
    const end = Math.floor(fraction * Math.log2(high * ratio / 1000));
    for (let i = start; i <= end; ++i) {
      const centre = 1000 * 2 ** (i / fraction);
      const left = Math.max(low, centre / ratio), right = Math.min(high, centre * ratio);
      if (right > left) result.push({ low: left, high: right, centre });
    }
    return result;
  }
  const edge = i => options.bands === 'linear' ? low + (high - low) * i / options.count :
    low * (high / low) ** (i / options.count);
  return Array.from({ length: options.count }, (_, i) => ({
    low: edge(i), high: edge(i + 1),
    centre: options.bands === 'linear' ? (edge(i) + edge(i + 1)) / 2 : Math.sqrt(edge(i) * edge(i + 1)),
  }));
}

// Integrate linear power, not dB or display bytes. Fractional overlap avoids
// changing a band's level just because an FFT bin straddles its edge.
export function bandDecibels(data, sampleRate, fftSize, band, aggregation) {
  const hz = sampleRate / fftSize;
  const start = Math.max(0, Math.floor(band.low / hz - 0.5));
  const end = Math.min(data.length - 1, Math.ceil(band.high / hz + 0.5));
  let power = 0, weight = 0, peak = -Infinity;
  for (let i = start; i <= end; ++i) {
    const overlap = Math.max(0, Math.min(band.high, (i + 0.5) * hz) - Math.max(band.low, (i - 0.5) * hz));
    if (overlap === 0) continue;
    const db = data[i];
    if (Number.isNaN(db) || db === Infinity) throw new Error('Invalid FFT magnitude.');
    power += 10 ** (db / 10) * overlap;
    weight += overlap;
    peak = Math.max(peak, db);
  }
  return aggregation === 'peak' ? peak : power > 0 && weight > 0 ? 10 * Math.log10(power / weight) : -Infinity;
}

export function spectrumCurve(values, position, smooth = false) {
  const p = Math.max(0, Math.min(values.length - 1, position));
  const i = Math.floor(p), t = p - i;
  const a = values[i], b = values[Math.min(i + 1, values.length - 1)];
  if (!smooth) return a + (b - a) * t;
  const before = values[Math.max(0, i - 1)], after = values[Math.min(values.length - 1, i + 2)];
  const delta = b - a;
  const tangent = (left, right) => left * right <= 0 ? 0 : 2 * left * right / (left + right);
  const m0 = tangent(a - before, delta), m1 = tangent(delta, after - b);
  return (2 * t ** 3 - 3 * t ** 2 + 1) * a + (t ** 3 - 2 * t ** 2 + t) * m0 +
    (-2 * t ** 3 + 3 * t ** 2) * b + (t ** 3 - t ** 2) * m1;
}

// 3x5 digit glyphs, one bit per pixel, top row in the high bits. Shared with
// the Camelot Wheel shader.
export const DIGITS = [31599, 29850, 29671, 31207, 18925, 31183, 31695, 9383, 31727, 31215];
function scaleText(buffer, text, x, y) {
  for (const character of text) {
    const code = character === '-' ? 448 : character === 'k' ? 23213 : DIGITS[Number(character)];
    for (let row = 0; row < 5; ++row)
      for (let column = 0; column < 3; ++column)
        if (code & (1 << (column + (4 - row) * 3))) buffer.pixel(x + column, y + row, [90, 110, 130]);
    x += 4;
  }
}

export class SpectrumPlot {
  constructor(width, height) {
    this.buffer = new AuroraBuffer(width, height);
    this.options = spectrumOptions();
    this.lastTime = null;
    this.source = null;
    this.signature = '';
    this.bands = [];
  }

  // Callers replace the options object to change it, so the same object
  // does not need validating again on every frame.
  setOptions(options) {
    if (options !== undefined && options === this.sourceOptions) return;
    this.options = spectrumOptions(options);
    this.sourceOptions = options;
  }

  update(input, seconds) {
    if (!input || !Number.isFinite(input.sampleRate) || input.sampleRate < 8000 ||
        !FFT_SIZES.includes(input.fftSize) || input.data?.length !== input.fftSize / 2 ||
        !Number.isFinite(seconds))
      throw new Error('Spectrum plot needs a valid raw FFT and clock.');
    const o = this.options;
    const signature = [input.sampleRate, input.fftSize, o.bands, o.count, o.minHz, o.maxHz,
      o.aggregation, o.slope, o.gainDb, o.floorDb, o.ceilingDb].join('/');
    if (signature !== this.signature || input.source !== this.source) {
      this.bands = frequencyBands(o, input.sampleRate);
      this.levels = new Float64Array(this.bands.length).fill(o.floorDb);
      this.peaks = new Float64Array(this.bands.length).fill(o.floorDb);
      this.deadlines = new Float64Array(this.bands.length);
      this.lastTime = null;
      this.signature = signature;
      this.source = input.source;
    }
    if (this.lastTime !== null && seconds < this.lastTime) throw new Error('Spectrum clock must not move backwards.');
    const previousTime = this.lastTime;
    const dt = previousTime === null ? 0 : seconds - previousTime;
    if (previousTime !== null && dt === 0) return;
    this.lastTime = seconds;
    let dominant = -Infinity;
    for (let i = 0; i < this.bands.length; ++i) {
      const band = this.bands[i];
      const raw = bandDecibels(input.data, input.sampleRate, input.fftSize, band, o.aggregation);
      if (raw > dominant) { dominant = raw; this.dominantHz = band.centre; }
      const target = Math.max(o.floorDb, Math.min(o.ceilingDb, raw + o.gainDb + o.slope * Math.log2(band.centre / 1000)));
      const tau = (target > this.levels[i] ? o.attack : o.release) / 1000;
      this.levels[i] += (target - this.levels[i]) * (previousTime === null || tau === 0 ? 1 : -Math.expm1(-dt / tau));
      if (this.levels[i] >= this.peaks[i]) {
        this.peaks[i] = this.levels[i];
        this.deadlines[i] = seconds + o.hold / 1000;
      } else {
        const falling = Math.max(0, seconds - Math.max(previousTime ?? seconds, this.deadlines[i]));
        this.peaks[i] = Math.max(this.levels[i], this.peaks[i] - o.fall * falling);
      }
    }
    if (dominant === -Infinity) this.dominantHz = null;
  }

  renderFrame(state) {
    this.setOptions(state.spectrumOptions);
    return this.render(state.audioTime, state.rawSpectrum);
  }

  // One-line readout of what the analyser is resolving, for the controls panel.
  describe(input, simulated = false) {
    const resolution = input.sampleRate / input.fftSize;
    const unresolved = this.bands.filter(b => b.high - b.low < resolution).length;
    return `${this.bands.length} bands · ${input.fftSize / 2} FFT bins · ` +
      `${resolution.toFixed(2)} Hz/bin · ${(input.fftSize / input.sampleRate * 1000).toFixed(0)} ms window · ` +
      `${simulated ? 'simulated · ' : ''}` +
      `strongest band: ${this.dominantHz ? `${Math.round(this.dominantHz)} Hz` : 'none'} · ` +
      `${unresolved} bands narrower than one bin`;
  }

  render(seconds, input) {
    this.update(input, seconds);
    const o = this.options, { width, height } = this.buffer;
    this.buffer.rgb.fill(0);
    const normalized = data => Array.from(data, db => Math.max(0, Math.min(1, (db - o.floorDb) / (o.ceilingDb - o.floorDb))));
    const levels = normalized(this.levels), peaks = normalized(this.peaks);
    if (this.coloursId !== o.paletteId) {
      const stops = GRADIENTS.find(p => p.id === o.paletteId)?.stops;
      this.colours = Array.from({ length: 256 }, (_, i) =>
        stops ? gradientColour(stops, i) : palette(i));
      this.coloursId = o.paletteId;
    }
    const colours = this.colours;
    const colour = (position, level) => colours[Math.round(255 * (o.colour === 'level' ? level : o.colour === 'solid' ? 0.55 : position))];
    const radius = o.thickness / 2;
    const line = (a, b, rgb) => this.buffer.line(a[0], a[1], b[0], b[1], rgb, false, radius);
    const peakColour = [240, 240, 240], gridColour = [16, 22, 30];
    const polar = ['circle', 'spiral'].includes(o.layout);
    const labels = o.labels && !polar && width >= 96 && height >= 48;
    const left = labels ? 18 : 0, bottom = height - 1 - (labels ? 7 : 0);
    const plotWidth = width - left, middle = bottom / 2;
    const point = (t, value) => {
      if (!polar) return [left + t * (plotWidth - 1), bottom * (1 - value)];
      const extent = Math.max(0, Math.min(width, height) / 2 - radius - 1);
      const angle = -Math.PI / 2 + o.rotation * Math.PI / 180 + t * Math.PI * 2 * (o.layout === 'spiral' ? o.turns : 1);
      const r = o.layout === 'spiral' ? extent * (0.08 + 0.68 * t + value * 0.24) : extent * (0.28 + value * 0.72);
      return [(width - 1) / 2 + Math.cos(angle) * r, (height - 1) / 2 + Math.sin(angle) * r];
    };
    if (o.grid) {
      for (let db = Math.ceil(o.floorDb / 10) * 10; db <= o.ceilingDb; db += 10) {
        const v = (db - o.floorDb) / (o.ceilingDb - o.floorDb);
        if (polar) {
          let previous = point(0, v);
          for (let i = 1; i <= 180; ++i) {
            const next = point(i / 180, v);
            line(previous, next, gridColour); previous = next;
          }
        } else if (o.layout === 'mirror') {
          const offset = v * middle;
          line([left, middle - offset], [width - 1, middle - offset], gridColour);
          line([left, middle + offset], [width - 1, middle + offset], gridColour);
        } else line([left, point(0, v)[1]], [width - 1, point(1, v)[1]], gridColour);
      }
      if (!polar && this.bands.length > 1) {
        const low = this.bands[0].low, high = this.bands.at(-1).high;
        const scale = hz => o.bands === 'linear' ? hz : Math.log(hz);
        for (const hz of [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]) {
          if (hz <= low || hz >= high) continue;
          let t;
          if (o.layout === 'bars') {
            const i = this.bands.findIndex(b => hz <= b.high);
            const band = this.bands[i];
            t = (i + (scale(hz) - scale(band.low)) / (scale(band.high) - scale(band.low))) / this.bands.length;
          } else {
            const i = this.bands.findIndex(b => b.centre >= hz);
            if (i <= 0) t = i === -1 ? 1 : 0;
            else t = (i - 1 + (scale(hz) - scale(this.bands[i - 1].centre)) /
              (scale(this.bands[i].centre) - scale(this.bands[i - 1].centre))) / (this.bands.length - 1);
          }
          const x = o.layout === 'bars' ? left + t * plotWidth : point(t, 0)[0];
          line([x, 0], [x, bottom], gridColour);
        }
      }
    }
    if (o.layout === 'bars') {
      for (let i = 0; i < levels.length; ++i) {
        const start = left + i * plotWidth / levels.length, right = left + (i + 1) * plotWidth / levels.length;
        const gap = (right - start) * o.gap / 2;
        for (let x = Math.ceil(start + gap); x < Math.max(Math.ceil(start + gap) + 1, right - gap); ++x) {
          for (let y = Math.ceil(bottom * (1 - levels[i])); levels[i] > 0 && y <= bottom; ++y)
            this.buffer.pixel(x, y, colour(i / Math.max(1, levels.length - 1), levels[i]));
          if (o.peaks) this.buffer.dot(x, bottom * (1 - peaks[i]), peakColour, radius);
        }
      }
    } else if (o.layout === 'circle' && o.curve === 'linear') {
      for (let i = 0; i < levels.length; ++i) {
        const t = i / levels.length;
        if (levels[i] > 0) line(point(t, 0), point(t, levels[i]), colour(t, levels[i]));
        if (o.peaks) this.buffer.dot(...point(t, peaks[i]), peakColour, radius);
      }
    } else {
      const steps = Math.max(2, polar ? Math.ceil(Math.min(width, height) * Math.PI * o.turns) : width);
      let previous = null, previousPeak = null;
      for (let i = 0; i < steps; ++i) {
        const t = i / (steps - 1);
        const v = spectrumCurve(levels, t * (levels.length - 1), o.curve === 'smooth');
        const p = point(t, v), rgb = colour(t, v);
        if (o.layout === 'area' && v > 0) line(point(t, 0), p, rgb);
        if (o.layout === 'mirror') {
          if (v > 0) line([p[0], middle * (1 - v)], [p[0], middle * (1 + v)], rgb);
        } else if (previous) line(previous, p, rgb);
        if (o.peaks) {
          const peak = spectrumCurve(peaks, t * (peaks.length - 1), o.curve === 'smooth');
          const pp = point(t, peak);
          if (o.layout === 'mirror') {
            this.buffer.dot(p[0], middle * (1 - peak), peakColour, radius);
            this.buffer.dot(p[0], middle * (1 + peak), peakColour, radius);
          } else if (previousPeak) line(previousPeak, pp, peakColour);
          previousPeak = pp;
        }
        previous = p;
      }
    }
    if (labels) {
      const dbValues = [o.floorDb, (o.floorDb + o.ceilingDb) / 2, o.ceilingDb];
      for (const db of dbValues) {
        const v = (db - o.floorDb) / (o.ceilingDb - o.floorDb);
        const y = o.layout === 'mirror' ? middle * (1 - v) : bottom * (1 - v);
        scaleText(this.buffer, String(Math.round(db)), 0, Math.min(bottom - 4, Math.max(0, Math.round(y) - 2)));
      }
      const hzLabel = hz => hz >= 1000 ? `${Math.round(hz / 1000)}k` : String(Math.round(hz));
      for (const t of [0, 0.5, 1]) {
        const band = this.bands[Math.round(t * (this.bands.length - 1))];
        const hz = o.layout !== 'bars' ? band.centre : t === 0 ? band.low : t === 1 ? band.high : band.centre;
        const text = hzLabel(hz);
        const x = Math.round(Math.max(left, Math.min(width - text.length * 4, point(t, 0)[0] - text.length * 2)));
        scaleText(this.buffer, text, x, height - 5);
      }
    }
    return this.buffer.rgb;
  }
}

export const SPECTRUM_PATTERN = {
  id: 'spectrum-lab', name: 'Spectrum Lab',
  audio: 'Configurable raw-FFT analyser: bars, lines, filled/mirrored ribbons, circle or spiral; fractional-octave bands and peak hold',
  spectrumPlot: true,
  controls: ['spectrum'],
  createInstance: (width, height) => new SpectrumPlot(width, height),
};
