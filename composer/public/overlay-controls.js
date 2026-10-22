import { INFO_FIELDS, OVERLAY_ANCHORS, newOverlay, overlaySettings } from './overlays.js';

export function bindOverlayControls(container, initial, changed, showError) {
  let current = overlaySettings(initial);
  const commit = next => {
    const validated = overlaySettings(next);
    changed(validated);
    current = validated;
    showError('');
  };
  const run = action => {
    try { action(); } catch (error) { showError(error.message); }
  };
  const render = () => {
    container.replaceChildren();
    const master = document.createElement('label');
    master.className = 'check';
    const toggle = document.createElement('input');
    toggle.id = 'overlays-enabled';
    toggle.type = 'checkbox';
    toggle.checked = current.enabled;
    toggle.addEventListener('change', () => run(() => commit({ ...current, enabled: toggle.checked })));
    master.append(toggle, document.createTextNode('Show overlays on all patterns'));
    container.appendChild(master);
    const addRow = document.createElement('div');
    addRow.className = 'row';
    for (const [type, title] of [['clock', 'Add clock'], ['date', 'Add date'], ['text', 'Add text'], ['info', 'Add info']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = title; button.id = `overlay-add-${type}`;
      button.disabled = current.elements.length >= 16;
      button.addEventListener('click', () => run(() => {
        commit({ ...current, elements: [...current.elements, newOverlay(type)] });
        render();
        container.querySelector('details:last-child').open = true;
      }));
      addRow.appendChild(button);
    }
    container.appendChild(addRow);
    current.elements.forEach((element, index) => {
      const details = document.createElement('details');
      details.dataset.overlayIndex = index;
      const summary = document.createElement('summary');
      const updateSummary = () => {
        const e = current.elements[index];
        const name = { text: e.text || 'Text', clock: 'Clock', date: 'Date', info: 'Info' }[e.type];
        summary.textContent = `${index + 1}. ${name}${e.enabled ? '' : ' (hidden)'}`;
      };
      updateSummary();
      details.appendChild(summary);
      const update = (key, value) => {
        const elements = [...current.elements];
        elements[index] = { ...elements[index], [key]: value };
        commit({ ...current, elements });
        updateSummary();
      };
      const field = (key, title, type, choices, min, max, step) => {
        const label = document.createElement('label');
        const input = document.createElement(type === 'select' ? 'select' : 'input');
        input.dataset.overlayField = key;
        input.id = `overlay-${index}-${key}`;
        if (type === 'select') {
          for (const [value, text] of choices) {
            const option = document.createElement('option');
            option.value = value; option.textContent = text; input.appendChild(option);
          }
          input.value = element[key];
        } else {
          input.type = type;
          if (type === 'checkbox') { input.checked = element[key]; label.className = 'check'; }
          else input.value = element[key];
          if (type === 'number') { input.min = min; input.max = max; input.step = step; input.required = true; }
          if (type === 'text') input.maxLength = 128;
        }
        label.htmlFor = input.id;
        if (type === 'checkbox') label.append(input, document.createTextNode(title));
        else label.append(document.createTextNode(title), input);
        input.addEventListener(type === 'select' || type === 'checkbox' ? 'change' : 'input', () => run(() => {
          if (!input.checkValidity()) throw new Error(`Invalid overlay ${title.toLowerCase()}.`);
          update(key, type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value) : input.value);
        }));
        details.appendChild(label);
      };
      field('enabled', 'Visible', 'checkbox');
      if (element.type === 'text') field('text', 'Text (single line)', 'text');
      else if (element.type === 'info') {
        // One checkbox for each thing it can show, kept in INFO_FIELDS order.
        for (const [id, title] of INFO_FIELDS) {
          const label = document.createElement('label');
          label.className = 'check';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.id = `overlay-${index}-field-${id}`;
          input.dataset.overlayInfoField = id;
          input.checked = element.fields.includes(id);
          input.addEventListener('change', () => run(() => {
            const fields = new Set(current.elements[index].fields);
            if (input.checked) fields.add(id); else fields.delete(id);
            update('fields', INFO_FIELDS.map(([field]) => field).filter((field) => fields.has(field)));
          }));
          label.htmlFor = input.id;
          label.append(input, document.createTextNode(title));
          details.appendChild(label);
        }
        field('layout', 'Layout', 'select', [['stack', 'One line for each'], ['line', 'All on one line']]);
      } else {
        field('zone', 'Time zone', 'select', [['local', 'Browser local time'], ['utc', 'UTC']]);
        if (element.type === 'clock') {
          field('format', 'Clock format', 'select', [['24', '24 hour'], ['12', '12 hour AM/PM']]);
          field('seconds', 'Show seconds', 'checkbox');
        } else field('dateFormat', 'Date format', 'select', [['iso', 'YYYY-MM-DD'], ['short', 'Local short date'], ['long', 'Local long date']]);
      }
      field('anchor', 'Position anchor', 'select', OVERLAY_ANCHORS);
      field('x', 'Horizontal offset (panel pixels; positive = right)', 'number', null, -2048, 2048, 1);
      field('y', 'Vertical offset (panel pixels; positive = down)', 'number', null, -2048, 2048, 1);
      field('font', 'Font', 'select', [['system', 'Browser font (smooth)'],
        ['pixel', 'Pixel font, 3 by 5 (crisp on small panels; sizes step by 6)']]);
      field('size', 'Text size (panel pixels)', 'number', null, 6, 128, 1);
      field('colour', 'Text colour', 'color');
      field('opacity', 'Element opacity (0-1)', 'number', null, 0, 1, 0.05);
      field('background', 'Background colour', 'color');
      field('backgroundOpacity', 'Background opacity (0 = transparent)', 'number', null, 0, 1, 0.05);
      field('padding', 'Background padding (panel pixels)', 'number', null, 0, 16, 1);
      const buttons = document.createElement('div');
      buttons.className = 'row';
      for (const [action, title] of [['up', 'Move back'], ['down', 'Move front'], ['remove', 'Remove']]) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = title; button.dataset.overlayAction = action;
        button.disabled = action === 'up' && index === 0 || action === 'down' && index === current.elements.length - 1;
        button.addEventListener('click', () => run(() => {
          const elements = [...current.elements];
          if (action === 'remove') elements.splice(index, 1);
          else {
            const other = index + (action === 'up' ? -1 : 1);
            [elements[index], elements[other]] = [elements[other], elements[index]];
          }
          commit({ ...current, elements });
          render();
        }));
        buttons.appendChild(button);
      }
      details.appendChild(buttons);
      container.appendChild(details);
    });
  };
  render();
}
