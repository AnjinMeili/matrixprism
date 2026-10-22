import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIN_COLUMN_WIDTH, QUAD_LAYOUT, changePane, findPane, layoutSettings, movePane, paneKey, setColumnWidth,
} from '../public/layout.js';

// The quad mixer's layout as data (T16 step 4).

const keys = (layout) => layout.columns.map((column) => column.panes.map(paneKey));

test('the agreed layout is valid as it stands: inputs on the sides, the master in the middle, Right mirrored', () => {
  const layout = layoutSettings();
  assert.deepEqual(layout, layoutSettings(QUAD_LAYOUT));
  assert.deepEqual(layout.columns.map((column) => column.width), [37, 26, 37]);
  assert.deepEqual(keys(layout), [
    ['input:a', 'pair:left', 'input:b'], ['all', 'master', 'output'], ['input:c', 'pair:right', 'input:d']]);
  assert.deepEqual(layout.columns[2].panes.map((pane) => !!pane.mirror), [true, true, true]);
  assert.deepEqual(layout.columns[0].panes.map((pane) => !!pane.mirror), [false, false, false]);
  assert.equal(layout.stackBelow, 900);
});

test('widths are shares that add up to 100; panes are checked and appear once', () => {
  const layout = layoutSettings({ columns: [{ width: 1, panes: [] }, { width: 3, panes: [] }] });
  assert.deepEqual(layout.columns.map((column) => column.width), [25, 75]);
  const bad = [
    { columns: [] },
    { columns: [{ width: 2, panes: [] }, { width: 98, panes: [] }] },
    { columns: [{ width: 0, panes: [] }] },
    { columns: [{ width: 50, panes: [{ type: 'mixer' }] }] },
    { columns: [{ width: 50, panes: [{ type: 'input', of: 'e' }] }] },
    { columns: [{ width: 50, panes: [{ type: 'master', of: 'a' }] }] },
    { columns: [{ width: 50, panes: [{ type: 'input', of: 'a', grow: 11 }] }] },
    { columns: [{ width: 50, panes: [{ type: 'input', of: 'a', mirror: 'yes' }] }] },
    { columns: [{ width: 50, panes: [{ type: 'all' }] }, { width: 50, panes: [{ type: 'all' }] }] },
    { columns: [{ width: 50, panes: [] }], stackBelow: -1 },
  ];
  for (const value of bad) assert.throws(() => layoutSettings(value), undefined, JSON.stringify(value));
});

test('a column resized takes from or gives to its neighbour, never below the minimum', () => {
  const layout = layoutSettings();
  assert.deepEqual(setColumnWidth(layout, 0, 40).columns.map((c) => c.width), [40, 23, 37]);
  assert.deepEqual(setColumnWidth(layout, 2, 30).columns.map((c) => c.width), [37, 33, 30], 'the last gives to its left');
  assert.deepEqual(setColumnWidth(layout, 0, 90).columns.map((c) => c.width), [63 - MIN_COLUMN_WIDTH, MIN_COLUMN_WIDTH, 37]);
  assert.deepEqual(setColumnWidth(layout, 0, 1).columns.map((c) => c.width), [MIN_COLUMN_WIDTH, 58, 37]);
});

test('panes move between and within columns, and change grow, mirror and hidden', () => {
  const layout = layoutSettings();
  const moved = movePane(layout, 'output', 0, 1);
  assert.deepEqual(keys(moved)[0], ['input:a', 'output', 'pair:left', 'input:b']);
  assert.deepEqual(keys(moved)[1], ['all', 'master']);
  assert.deepEqual(keys(movePane(layout, 'input:a', 0, 9))[0], ['pair:left', 'input:b', 'input:a']);
  assert.throws(() => movePane(layout, 'input:e', 0, 0));
  assert.throws(() => movePane(layout, 'master', 5, 0));
  const changed = changePane(layout, 'input:c', { mirror: false, grow: 2 });
  assert.deepEqual(changed.columns[2].panes[0], { type: 'input', of: 'c', grow: 2 });
  assert.equal(changePane(layout, 'all', { hidden: true }).columns[1].panes[0].hidden, true);
  assert.deepEqual(findPane(layout, 'pair:right'), { column: 2, index: 1 });
  assert.equal(findPane(layout, 'nothing'), null);
  assert.deepEqual(layout, layoutSettings(), 'the original is unchanged');
});
