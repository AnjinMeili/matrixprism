// The app window's size and place, kept between runs (#10) in window-state.json
// in the app's data folder. A saved place is used only if enough of the window
// would land on a screen connected now, so it never opens out of reach after a
// screen is unplugged; otherwise it opens at the default size, centred.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_BOUNDS = { width: 1440, height: 900 };
const MIN_VISIBLE = { width: 200, height: 100 };

// The bounds to open with, from what was saved and the screens' work areas.
export function fitBounds(saved, workAreas) {
  const ok = saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) && saved.width > 0 && saved.height > 0;
  if (!ok) return { ...DEFAULT_BOUNDS };
  const screen = workAreas.find((area) =>
    Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x) >= MIN_VISIBLE.width &&
    Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y) >= MIN_VISIBLE.height);
  if (!screen) return { ...DEFAULT_BOUNDS };
  const width = Math.min(saved.width, screen.width), height = Math.min(saved.height, screen.height);
  return { x: saved.x, y: saved.y, width, height };
}

export class WindowState {
  constructor(directory) {
    this.file = path.join(directory, 'window-state.json');
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  // Follows a window: saves its bounds a moment after each move or resize, and
  // when it closes. The normal bounds are kept while maximised.
  track(window) {
    let timer = null;
    const save = () => {
      clearTimeout(timer);
      if (window.isDestroyed()) return;
      const bounds = window.isMaximized() || window.isFullScreen() ? window.getNormalBounds() : window.getBounds();
      try {
        fs.writeFileSync(this.file, JSON.stringify({ ...bounds, maximized: window.isMaximized() }));
      } catch { /* not worth failing for */ }
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(save, 500); };
    for (const event of ['resize', 'move', 'maximize', 'unmaximize']) window.on(event, soon);
    window.on('close', save);
  }
}
