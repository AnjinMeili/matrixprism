#!/usr/bin/env node
// Checks the quad mixer's layout view in headless Chrome (layout-check.html):
// at 1440×900 three columns of 37%, 26% and 37% in the agreed order, the
// growing panes taller, Right's rows mirrored; at 600×900 one stacked column;
// a moved pane keeps its element; a hidden pane takes no room; the help
// popover hidden until focused. It does not judge how anything looks.
import { runPage } from './headless.mjs';

try {
  const text = await runPage('layout-check.html', { budgetMs: 20000 });
  console.log(text);
  const { wide, narrow } = JSON.parse(text);
  const near = (x, y) => Math.abs(x - y) < 0.6;
  const [left, middle, right] = wide.columns;
  const ok = !wide.stacked && near(left.share, 37) && near(middle.share, 26) && near(right.share, 37) &&
    left.panes.map((p) => p.key).join() === 'input:a,pair:left,input:b' &&
    middle.panes.map((p) => p.key).join() === 'all,master,output' &&
    right.panes.every((p) => p.mirror) && !left.panes.some((p) => p.mirror) &&
    left.panes[0].height > 2 * left.panes[1].height && middle.panes[1].height > middle.panes[0].height &&
    wide.rowOrder['input:a'] === 'left to right' && wide.rowOrder['input:c'] === 'right to left' &&
    wide.movedKeepsElement && wide.hiddenHidden &&
    wide.popover.before === 'none' && wide.popover.focused === 'block' && wide.popover.describedBy &&
    wide.popover.role === 'tooltip' &&
    narrow.stacked && narrow.columns.every((column) => column.share > 99);
  console.log(ok ? 'ok' : 'FAILED');
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
