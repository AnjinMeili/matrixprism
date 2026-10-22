import { changedParams, formatParam, paramValue, paramValues } from './params.js';

// Builds the controls for a pattern's own parameters (params.js) in
// `container`: a slider for a number, a checkbox for a bool, a menu for a
// choice, and a button that puts them back to the defaults. `saved` holds the
// values that differ from the defaults; `changed(next)` is called with the
// new set after each change. `heading` names the pattern when two are shown.
// `reset`, given, is what its Reset button does in place of putting only
// these settings back: { label, title, run }, such as bringing a channel back
// to just its pattern (Anjin, 2026-10-20); false leaves the button out,
// for a container that has its own.
export function buildParamControls(container, pattern, saved, changed, heading = '', reset = null) {
  let values = paramValues(pattern, saved);
  const section = document.createElement('div');
  section.className = 'param-section';
  if (heading) {
    const title = document.createElement('p');
    title.className = 'param-heading';
    title.textContent = heading;
    section.appendChild(title);
  }
  const syncs = [];
  const set = (param, value) => {
    values = { ...values, [param.id]: paramValue(param, value) };
    changed(changedParams(pattern, values));
  };
  for (const param of pattern.params) {
    const type = param.type ?? 'number';
    const label = document.createElement('label');
    if (param.help) label.title = param.help;
    let input;
    if (type === 'bool') {
      label.className = 'check';
      input = document.createElement('input');
      input.type = 'checkbox';
      input.addEventListener('change', () => set(param, input.checked));
      label.append(input, ` ${param.name}`);
      syncs.push(() => { input.checked = values[param.id]; });
    } else if (type === 'choice') {
      input = document.createElement('select');
      for (const choice of param.choices) {
        const option = document.createElement('option');
        option.value = choice.id;
        option.textContent = choice.name;
        input.appendChild(option);
      }
      input.addEventListener('change', () => set(param, input.value));
      label.append(param.name, input);
      syncs.push(() => { input.value = values[param.id]; });
    } else {
      const output = document.createElement('output');
      input = document.createElement('input');
      Object.assign(input, { type: 'range', min: param.min, max: param.max, step: param.step });
      input.addEventListener('input', () => {
        set(param, Number(input.value));
        output.textContent = formatParam(param, values[param.id]);
      });
      label.append(`${param.name} `, output, input);
      syncs.push(() => {
        input.value = values[param.id];
        output.textContent = formatParam(param, values[param.id]);
      });
    }
    input.id = `param-${pattern.id}-${param.id}`;
    section.appendChild(label);
  }
  if (reset === false) {
    syncs.forEach((sync) => sync());
    container.appendChild(section);
    return;
  }
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = reset?.label ?? 'Reset to defaults';
  if (reset?.title) resetButton.title = reset.title;
  resetButton.addEventListener('click', () => {
    values = paramValues(pattern, {});
    syncs.forEach((sync) => sync());
    if (reset) reset.run();
    else changed({});
  });
  section.appendChild(resetButton);
  syncs.forEach((sync) => sync());
  container.appendChild(section);
}
