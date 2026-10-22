import { paneKey } from './layout.js';

// Draws a layout (layout.js) into `container`. `components` maps a pane type
// to a function that builds that pane: `(pane, { mirror }) => element`. A
// pane's element is built once and kept, so moving it or changing the layout
// moves the element without rebuilding it or losing what it holds. Returns
// { update(layout), element(key) }.
//
// Columns are percentages of the width and panes shares of their column's
// spare height, both from the layout. A mirrored pane carries the class
// `layout-mirror`, which its component's rows follow (style.css). Below the
// layout's `stackBelow` window width the columns stack into one.
export function renderLayout(container, layout, components) {
  const built = new Map();
  let stack = null;
  container.classList.add('layout');

  const paneElement = (pane) => {
    const key = paneKey(pane);
    if (!built.has(key)) {
      const build = components[pane.type];
      if (!build) throw new Error(`No component for pane type ${pane.type}.`);
      const wrapper = document.createElement('div');
      wrapper.className = 'layout-pane';
      wrapper.dataset.pane = key;
      wrapper.append(build(pane, { mirror: !!pane.mirror }));
      built.set(key, wrapper);
    }
    const wrapper = built.get(key);
    wrapper.classList.toggle('layout-mirror', !!pane.mirror);
    wrapper.hidden = !!pane.hidden;
    wrapper.style.flexGrow = String(pane.grow);
    wrapper.style.flexBasis = pane.grow ? '0' : 'auto';
    return wrapper;
  };

  const update = (next) => {
    layout = next;
    container.style.gridTemplateColumns = layout.columns.map((column) => `${column.width}%`).join(' ');
    const columns = layout.columns.map((column) => {
      const element = document.createElement('div');
      element.className = 'layout-column';
      element.append(...column.panes.map(paneElement));
      return element;
    });
    container.replaceChildren(...columns);
    stack?.removeEventListener('change', stacked);
    stack = window.matchMedia(`(max-width: ${layout.stackBelow}px)`);
    stack.addEventListener('change', stacked);
    stacked();
  };
  const stacked = () => container.classList.toggle('layout-stacked', stack.matches);

  update(layout);
  return { update, element: (key) => built.get(key) ?? null };
}
