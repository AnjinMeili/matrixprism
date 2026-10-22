import { LINE_HEIGHT, drawPixelText, pixelScale, pixelTextHeight, pixelTextWidth } from './pixel-font.js';

export const OVERLAY_ANCHORS = [
  ['top-left', 'Top left'], ['top-center', 'Top centre'], ['top-right', 'Top right'],
  ['middle-left', 'Middle left'], ['middle-center', 'Centre'], ['middle-right', 'Middle right'],
  ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'],
];

// What an info element can show, one line each.
export const INFO_FIELDS = [
  ['tempo', 'Tempo: BPM and beat of the bar'], ['key', 'Musical key'],
  ['pattern', 'Patterns showing'], ['frames', 'Frames per second'],
  ['packets', 'DDP packets per second and send errors'],
];
const INFO_IDS = INFO_FIELDS.map(([id]) => id);

export function newOverlay(type = 'clock') {
  const info = type === 'info';
  return overlayElement({
    type, enabled: true, text: 'Your text', anchor: info ? 'top-left' : 'top-right',
    x: 0, y: 0, size: info ? 6 : 16, colour: '#ffffff', opacity: 1,
    background: '#000000', backgroundOpacity: 0.65, padding: info ? 1 : 2,
    format: '24', seconds: false, zone: 'local', dateFormat: 'iso',
  });
}

// Fields added after elements were first saved, so that saved elements from
// before them still load: an info element uses the pixel font by default.
function withDefaults(value) {
  return { font: value.type === 'info' ? 'pixel' : 'system', fields: INFO_IDS, layout: 'stack', ...value };
}

export function overlayElement(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Overlay element must be an options object.');
  value = withDefaults(value);
  for (const [key, choices] of Object.entries({
    type: ['clock', 'date', 'text', 'info'], anchor: OVERLAY_ANCHORS.map(([id]) => id),
    format: ['24', '12'], zone: ['local', 'utc'], dateFormat: ['iso', 'short', 'long'],
    font: ['system', 'pixel'], layout: ['stack', 'line'],
  })) {
    if (!choices.includes(value[key])) throw new Error(`Invalid overlay ${key}: ${value[key]}`);
  }
  for (const [key, min, max] of [
    ['x', -2048, 2048], ['y', -2048, 2048], ['size', 6, 128],
    ['opacity', 0, 1], ['backgroundOpacity', 0, 1], ['padding', 0, 16],
  ]) {
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max)
      throw new Error(`Overlay ${key} must be between ${min} and ${max}.`);
  }
  if (![value.size, value.x, value.y, value.padding].every(Number.isInteger))
    throw new Error('Overlay size, offsets and padding must be whole panel pixels.');
  if (typeof value.enabled !== 'boolean' || typeof value.seconds !== 'boolean')
    throw new Error('Overlay enabled and seconds must be boolean.');
  if (typeof value.text !== 'string' || value.text.length > 128 || /[\r\n\t]/.test(value.text))
    throw new Error('Overlay text must be a single line of up to 128 characters.');
  for (const key of ['colour', 'background'])
    if (!/^#[0-9a-f]{6}$/i.test(value[key])) throw new Error(`Overlay ${key} must be a hex RGB colour.`);
  if (!Array.isArray(value.fields) || !value.fields.every((field) => INFO_IDS.includes(field)) ||
      new Set(value.fields).size !== value.fields.length)
    throw new Error(`Overlay info fields must be some of: ${INFO_IDS.join(', ')}.`);
  return { ...value, fields: [...value.fields] };
}

export function overlaySettings(value = { enabled: true, elements: [] }) {
  if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.elements) || value.elements.length > 16)
    throw new Error('Overlay settings need an enabled flag and at most 16 elements.');
  return { enabled: value.enabled, elements: value.elements.map(overlayElement) };
}

// The lines of an info element from what the composer knows now. `info` holds
// the tempo, the key, the patterns showing and the last second's frame and
// packet counts; whatever is missing is left out or shown as unknown. Packet
// loss is not among them: the receiver does not report back what arrived.
export function infoLines(fields, info = {}) {
  const lines = {
    tempo: () => info.tempo && `${Math.round(info.tempo.bpm)} BPM ${info.tempo.beat}/4` +
      (info.tempo.detected ? (info.tempo.source ? ` ${info.tempo.source}` : '') : ' MAN'),
    key: () => info.key ? `${info.key.camelot} ${info.key.name.replace(/ major$/, ' MAJ').replace(/ minor$/, ' MIN')}` +
      (info.key.held ? ' ?' : '') : 'KEY -',
    pattern: () => (info.patterns || []).filter(Boolean).join(' + '),
    frames: () => info.frames && (info.frames.streaming ? `${info.frames.sent} FPS` :
      `${info.frames.rendered} FPS NOT SENT`),
    packets: () => info.packets && info.frames?.streaming && `${info.packets.packets} PKT/S` +
      (info.packets.errors ? ` ${info.packets.errors} ERR` : ''),
  };
  return fields.map((field) => lines[field]()).filter(Boolean);
}

// The lines an element draws: one, except for an info element stacked a field
// to a line.
export function overlayLines(element, date, info) {
  if (element.type !== 'info')
    return [overlayText(element, date)];
  const lines = infoLines(element.fields, info);
  return element.layout === 'line' ? [lines.join('  ')].filter(Boolean) : lines;
}

export function overlayText(element, date, info) {
  if (element.type === 'text') return element.text;
  if (element.type === 'info') return overlayLines(element, date, info).join('  ');
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('Invalid overlay clock time.');
  const utc = element.zone === 'utc';
  const part = name => date[`${utc ? 'getUTC' : 'get'}${name}`]();
  const pad = value => String(value).padStart(2, '0');
  if (element.type === 'clock') {
    const hour = part('Hours');
    const time = `${pad(element.format === '12' ? hour % 12 || 12 : hour)}:${pad(part('Minutes'))}` +
      (element.seconds ? `:${pad(part('Seconds'))}` : '');
    return time + (element.format === '12' ? hour < 12 ? ' AM' : ' PM' : '');
  }
  if (element.dateFormat === 'iso')
    return `${part('FullYear')}-${pad(part('Month') + 1)}-${pad(part('Date'))}`;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: element.dateFormat === 'short' ? 'short' : 'long',
    ...(utc ? { timeZone: 'UTC' } : {}),
  }).format(date);
}

export function overlayPlacement(element, panelWidth, panelHeight, textWidth,
  textHeight = Math.ceil(element.size * 1.25)) {
  const width = Math.ceil(textWidth) + element.padding * 2;
  const height = textHeight + element.padding * 2;
  const [vertical, horizontal] = element.anchor.split('-');
  const x = (horizontal === 'left' ? 0 : horizontal === 'right' ? panelWidth - width : (panelWidth - width) / 2) + element.x;
  const y = (vertical === 'top' ? 0 : vertical === 'bottom' ? panelHeight - height : (panelHeight - height) / 2) + element.y;
  return { x: Math.round(x), y: Math.round(y), width, height };
}

export class OverlayLayer {
  constructor(canvas = document.createElement('canvas')) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    if (!this.context) throw new Error('Canvas text overlays are not available in this browser.');
    this.signature = null;
  }

  update(value, width, height, date, info) {
    const settings = overlaySettings(value);
    const elements = settings.enabled ? settings.elements.filter(e => e.enabled && e.opacity > 0) : [];
    const texts = elements.map(e => overlayLines(e, date, info));
    const signature = JSON.stringify([width, height, elements, texts]);
    if (signature === this.signature) return false;
    if (width !== this.canvas.width || height !== this.canvas.height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const c = this.context;
    c.clearRect(0, 0, width, height);
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    for (let i = 0; i < elements.length; ++i) {
      const e = elements[i], lines = texts[i].filter(Boolean);
      if (!lines.length) continue;
      const pixel = e.font === 'pixel';
      const scale = pixelScale(e.size);
      const lineHeight = Math.ceil(e.size * 1.25);
      c.font = `bold ${e.size}px monospace`;
      const textWidth = Math.max(...lines.map(line =>
        pixel ? pixelTextWidth(line, scale) : c.measureText(line).width));
      const textHeight = pixel ? pixelTextHeight(lines.length, scale) : lineHeight * lines.length;
      const { x, y, width: w, height: h } = overlayPlacement(e, width, height, textWidth, textHeight);
      c.globalAlpha = e.opacity * e.backgroundOpacity;
      c.fillStyle = e.background;
      c.fillRect(x, y, w, h);
      c.globalAlpha = e.opacity;
      c.fillStyle = e.colour;
      lines.forEach((line, row) => {
        if (pixel)
          drawPixelText(line, x + e.padding, y + e.padding + row * LINE_HEIGHT * scale, scale,
            (left, top, size) => c.fillRect(left, top, size, size));
        else
          c.fillText(line, x + e.padding, y + e.padding + lineHeight * (row + 0.5));
      });
    }
    c.globalAlpha = 1;
    this.signature = signature;
    return true;
  }
}
