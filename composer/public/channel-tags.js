// A Mixer channel's modifiers as short tags under its name (Anjin,
// 2026-10-20: "The label for channel has the pattern name, it should also
// include all modifiers, in a short code"), one for each that differs from
// the default, so a channel with none is just its pattern. Each tag is
// { id, text, title }: `text` short for the chip, `title` in full for its
// hover.
import { changedParams, formatParam } from './params.js';
import { OUTLINES, REGIONS, SHAPE_DEFAULTS, SHAPES, pulseBeatsName, spinName, spinReverseName } from './shape.js';

const OUTLINE_MARKS = { ellipse: '◯', rectangle: '▭', diamond: '◇' };
const percent = (value) => `${Math.round(value * 100)}%`;
const nameOf = (list, id) => list.find((entry) => entry.id === id)?.name ?? id;
const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);

// `input` is a Mixer input ({ params, brightness, gamma, hue, shape });
// `pattern` its pattern, for the names of its settings.
export function channelTags(input, pattern) {
  const tags = [];
  const shape = { ...SHAPE_DEFAULTS, ...input.shape };
  const changed = Object.entries(pattern ? changedParams(pattern, input.params) : input.params ?? {});
  if (changed.length) {
    const named = changed.map(([id, value]) => {
      const param = pattern?.params?.find((p) => p.id === id);
      return param ? `${param.name} ${formatParam(param, value)}` : `${id} ${value}`;
    });
    tags.push({ id: 'params', text: `⚙${changed.length}`, title: `Pattern settings changed: ${named.join(', ')}` });
  }
  // The outline sets how a bend curves even on the whole panel.
  const outlineMark = OUTLINE_MARKS[shape.outline] ?? '';
  if (shape.shape !== 'normal')
    tags.push({ id: 'bend', text: `bent ${shape.shape === 'inside-out' ? 'out' : 'in'}` +
      (shape.region === 'full' && shape.outline !== SHAPE_DEFAULTS.outline ? ` ${outlineMark}` : ''),
    title: `${nameOf(SHAPES, shape.shape)}, along ${lower(nameOf(OUTLINES, shape.outline))} lines` });
  if (shape.region !== 'full') {
    const size = shape.proportional ? percent(shape.width) : `${percent(shape.width)}×${percent(shape.height)}`;
    tags.push({ id: 'region', text: `${shape.region === 'centre' ? 'centre' : 'edges'} ${outlineMark}${size}` +
      (shape.edge > 0 ? ' soft' : ''),
    title: `${nameOf(REGIONS, shape.region)}: ${lower(nameOf(OUTLINES, shape.outline))} ` +
      `${shape.proportional ? `${percent(shape.width)} both ways` : `${percent(shape.width)} wide, ${percent(shape.height)} high`}` +
      `, ${shape.edge > 0 ? `border softened ${percent(shape.edge)} either side` : 'a hard border'}` });
  }
  if (shape.spin !== 0) {
    const reverse = shape.spinReverse === 0 ? '' : shape.spinReverse < 0 ? ' ⇄♪' : ` ⇄${shape.spinReverse}`;
    tags.push({ id: 'spin', text: `${shape.spin > 0 ? '↻' : '↺'}${Math.abs(shape.spin)}${reverse}`,
      title: `Spin: ${lower(spinName(shape.spin))}` +
        (shape.spinReverse === 0 ? '' : `, reversing ${lower(spinReverseName(shape.spinReverse))}`) });
  }
  if (shape.pulse > 0)
    tags.push({ id: 'pulse', text: `♥${percent(shape.pulse)}${{ 1: '', 2: '/2', 4: '/bar' }[shape.pulseBeats] ?? ''}`,
      title: `Pulse: ${percent(shape.pulse)} larger every ${lower(pulseBeatsName(shape.pulseBeats))}` });
  if (input.brightness !== 1)
    tags.push({ id: 'brightness', text: `☀${percent(input.brightness)}`, title: `Brightness ${percent(input.brightness)}` });
  if (input.gamma !== 1)
    tags.push({ id: 'gamma', text: `γ${input.gamma.toFixed(2)}`, title: `Gamma ${input.gamma.toFixed(2)}` });
  if (input.hue !== null && input.hue !== undefined)
    tags.push({ id: 'hue', text: `hue ${Math.round(input.hue * 360)}°`,
      title: `Its own hue, ${Math.round(input.hue * 360)}°, not following the main's` });
  return tags;
}
