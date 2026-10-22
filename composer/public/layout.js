// The quad mixer's layout as data (T16 step 4), so panes can be moved,
// resized, hidden or mirrored without code changes, and a later layout editor
// or splitters have something to edit. Pure: the view is layout-view.js.
//
// A layout is columns, left to right, each a share of the width in percent
// with its panes, top to bottom. A pane is a type, and for an input or a pair
// which one (`of`); `grow` is its share of the column's spare height (0: only
// as tall as its contents); `mirror` lays its controls out right to left, as
// the Right side mirrors the Left in where controls sit, not in what they do;
// `hidden` leaves it out. Below `stackBelow` pixels of window width the
// columns stack into one.

export const PANE_TYPES = {
  input: ['a', 'b', 'c', 'd'],
  pair: ['left', 'right'],
  master: null,
  all: null,
  output: null,
};
export const GROW_RANGE = [0, 10];
export const STACK_RANGE = [0, 4000];
export const MIN_COLUMN_WIDTH = 5;

// The mock-up Anjin agreed on 2026-10-16.
export const QUAD_LAYOUT = {
  columns: [
    { width: 37, panes: [
      { type: 'input', of: 'a', grow: 1 }, { type: 'pair', of: 'left', grow: 0 }, { type: 'input', of: 'b', grow: 1 }] },
    { width: 26, panes: [
      { type: 'all', grow: 0 }, { type: 'master', grow: 1 }, { type: 'output', grow: 0 }] },
    { width: 37, panes: [
      { type: 'input', of: 'c', grow: 1, mirror: true }, { type: 'pair', of: 'right', grow: 0, mirror: true },
      { type: 'input', of: 'd', grow: 1, mirror: true }] },
  ],
  stackBelow: 900,
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// A pane's name within a layout: its type, and which one for inputs and pairs.
export const paneKey = (pane) => (pane.of ? `${pane.type}:${pane.of}` : pane.type);

function paneSettings(value) {
  if (!isObject(value)) throw new Error('A pane must be an options object.');
  if (!Object.hasOwn(PANE_TYPES, value.type)) throw new Error(`Unknown pane type: ${value.type}`);
  const which = PANE_TYPES[value.type];
  if (which ? !which.includes(value.of) : value.of !== undefined)
    throw new Error(`Pane ${value.type} cannot be of ${value.of}.`);
  const grow = value.grow ?? 0;
  if (!Number.isFinite(grow) || grow < GROW_RANGE[0] || grow > GROW_RANGE[1])
    throw new Error(`Pane grow must be between ${GROW_RANGE[0]} and ${GROW_RANGE[1]}.`);
  for (const key of ['mirror', 'hidden'])
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`Pane ${key} must be true or false.`);
  const pane = { type: value.type };
  if (which) pane.of = value.of;
  pane.grow = grow;
  if (value.mirror) pane.mirror = true;
  if (value.hidden) pane.hidden = true;
  return pane;
}

// A layout, checked. Column widths are scaled to add up to 100; each pane
// may appear once.
export function layoutSettings(value = QUAD_LAYOUT) {
  if (!isObject(value) || !Array.isArray(value.columns) || !value.columns.length)
    throw new Error('A layout needs at least one column.');
  const seen = new Set();
  const columns = value.columns.map((column) => {
    if (!isObject(column) || !Array.isArray(column.panes)) throw new Error('A column needs a list of panes.');
    if (!Number.isFinite(column.width) || column.width <= 0) throw new Error('A column needs a width above 0.');
    const panes = column.panes.map(paneSettings);
    for (const pane of panes) {
      const key = paneKey(pane);
      if (seen.has(key)) throw new Error(`Pane ${key} appears twice.`);
      seen.add(key);
    }
    return { width: column.width, panes };
  });
  const stackBelow = value.stackBelow ?? QUAD_LAYOUT.stackBelow;
  if (!Number.isFinite(stackBelow) || stackBelow < STACK_RANGE[0] || stackBelow > STACK_RANGE[1])
    throw new Error(`The stacking width must be between ${STACK_RANGE[0]} and ${STACK_RANGE[1]} pixels.`);
  const normalized = normalizeWidths(columns);
  if (normalized.some((column) => column.width < MIN_COLUMN_WIDTH))
    throw new Error(`Each column must be at least ${MIN_COLUMN_WIDTH}% of the width.`);
  return { columns: normalized, stackBelow };
}

// Widths scaled to add up to 100, rounded to a hundredth.
function normalizeWidths(columns) {
  const total = columns.reduce((sum, column) => sum + column.width, 0);
  return columns.map((column) => ({ ...column, width: Math.round(column.width / total * 10000) / 100 }));
}

// Where a pane is: its column and place, or null.
export function findPane(layout, key) {
  for (let column = 0; column < layout.columns.length; ++column) {
    const index = layout.columns[column].panes.findIndex((pane) => paneKey(pane) === key);
    if (index >= 0) return { column, index };
  }
  return null;
}

// A column set to `width`, the column to its right (or, for the last, to its
// left) giving or taking the difference, each kept at least
// MIN_COLUMN_WIDTH: what dragging the line between two columns does.
export function setColumnWidth(layout, column, width) {
  const columns = layout.columns.map((each) => ({ ...each }));
  const neighbour = column + 1 < columns.length ? column + 1 : column - 1;
  if (neighbour < 0) return layoutSettings({ ...layout, columns });
  const pair = columns[column].width + columns[neighbour].width;
  const clamped = Math.min(pair - MIN_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width));
  columns[column].width = clamped;
  columns[neighbour].width = pair - clamped;
  return layoutSettings({ ...layout, columns });
}

// A pane moved to `column`, at `index` among that column's panes.
export function movePane(layout, key, column, index) {
  const from = findPane(layout, key);
  if (!from) throw new Error(`No pane ${key} in the layout.`);
  if (column < 0 || column >= layout.columns.length) throw new Error(`No column ${column}.`);
  const columns = layout.columns.map((each) => ({ ...each, panes: [...each.panes] }));
  const [pane] = columns[from.column].panes.splice(from.index, 1);
  const panes = columns[column].panes;
  panes.splice(Math.max(0, Math.min(index, panes.length)), 0, pane);
  return layoutSettings({ ...layout, columns });
}

// A pane with some of its settings changed: grow, mirror, hidden.
export function changePane(layout, key, changes) {
  const at = findPane(layout, key);
  if (!at) throw new Error(`No pane ${key} in the layout.`);
  const columns = layout.columns.map((each, i) => i !== at.column ? each : {
    ...each, panes: each.panes.map((pane, j) => (j === at.index ? { ...pane, ...changes } : pane)),
  });
  return layoutSettings({ ...layout, columns });
}
