import { FOLLOW_DEFAULT, FOLLOW_SOURCES, changedParams, followValue, formatParam, paramValue, paramValues } from './params.js';
import { newSeed } from './seed.js';

// Builds the controls for a pattern's own parameters (params.js) in
// `container`: a slider for a number, a checkbox for a bool, a menu for a
// choice, and a button that puts them back to the defaults. Under each
// slider, Follows and Amount let it follow the music (#21). `saved` holds the
// values that differ from the defaults; `changed(next)` is called with the
// new set after each change. `heading` names the pattern when two are shown.
// `reset`, given, is what its Reset button does in place of putting only
// these settings back: { label, title, run }, such as bringing a channel back
// to just its pattern (Anjin, 2026-10-20); false leaves the button out,
// for a container that has its own.
//
// A pattern that rolls dice has a Variation (T72), shown only when
// `variation` hooks are given: { current() the seed on screen or null,
// use(seed) to restart from it while none is kept, back() the seed before
// the one on screen or null, keep(values) and canReturn() and returnTo() for
// the anchor that Return goes back to }. Returns { refresh() }, which shows
// the seed on screen again.
export function buildParamControls(container, pattern, saved, changed, heading = '', reset = null, variation = null) {
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
  const followOf = (param) => followValue(values.follows?.[param.id] ?? FOLLOW_DEFAULT);
  const setFollow = (param, follow) => {
    values = { ...values, follows: { ...values.follows, [param.id]: followValue(follow) } };
    changed(changedParams(pattern, values));
  };
  const refreshers = [];
  for (const param of pattern.params) {
    const type = param.type ?? 'number';
    if (type === 'variation') {
      if (variation) section.appendChild(variationControls(param));
      continue;
    }
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
    if (type === 'number') section.appendChild(followControls(param));
  }
  // The variation's number, Keep, and New, Back and Return.
  function variationControls(param) {
    const row = document.createElement('div');
    row.className = 'param-variation';
    if (param.help) row.title = param.help;
    const shown = document.createElement('output');
    shown.id = `param-${pattern.id}-variation`;
    const keep = document.createElement('input');
    keep.type = 'checkbox';
    keep.id = `param-${pattern.id}-variation-keep`;
    const keepLabel = document.createElement('label');
    keepLabel.className = 'check';
    keepLabel.title = 'Hold this variation: no re-roll, and the randomizer leaves it alone';
    keepLabel.append(keep, ' Keep');
    const button = (text, title, run) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      b.id = `param-${pattern.id}-variation-${text.toLowerCase()}`;
      b.addEventListener('click', run);
      return b;
    };
    const kept = () => values[param.id] > 0;
    const use = (seed) => {
      if (!seed) return;
      if (kept()) set(param, seed);
      else variation.use(seed);
      show();
    };
    const back = button('Back', 'The variation before this one', () => use(variation.back()));
    const again = button('Return', 'Back to the settings and variation kept or loaded last', () => variation.returnTo());
    keep.addEventListener('change', () => {
      set(param, keep.checked ? variation.current() ?? 0 : 0);
      if (keep.checked) variation.keep(values);
      show();
    });
    const show = () => {
      const seed = kept() ? values[param.id] : variation.current();
      shown.textContent = seed ? `#${seed}` : '–';
      keep.checked = kept();
      keep.disabled = !seed && !kept();
      again.disabled = !variation.canReturn();
    };
    const name = document.createElement('span');
    name.textContent = `${param.name} `;
    const buttons = document.createElement('span');
    buttons.className = 'param-variation-buttons';
    buttons.append(button('New', 'Roll another variation now', () => use(newSeed())), back, again);
    row.append(name, shown, keepLabel, buttons);
    syncs.push(show);
    refreshers.push(show);
    return row;
  }

  // Follows and Amount for a number setting.
  function followControls(param) {
    const row = document.createElement('div');
    row.className = 'param-follow';
    row.title = `${param.name} follows the music: it moves from the slider's value by the source times Amount, either way`;
    const source = document.createElement('select');
    source.id = `param-${pattern.id}-${param.id}-follow`;
    source.setAttribute('aria-label', `${param.name} follows`);
    for (const entry of FOLLOW_SOURCES) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      source.appendChild(option);
    }
    const amount = document.createElement('input');
    Object.assign(amount, { type: 'range', min: -1, max: 1, step: 0.05 });
    amount.id = `param-${pattern.id}-${param.id}-amount`;
    amount.setAttribute('aria-label', `${param.name} follow amount`);
    const shown = document.createElement('output');
    const show = () => {
      const follow = followOf(param);
      source.value = follow.source;
      amount.value = follow.amount;
      amount.disabled = follow.source === 'off';
      shown.textContent = `${Math.round(follow.amount * 100)}%`;
    };
    source.addEventListener('change', () => { setFollow(param, { ...followOf(param), source: source.value }); show(); });
    amount.addEventListener('input', () => { setFollow(param, { ...followOf(param), amount: Number(amount.value) }); show(); });
    const label = document.createElement('label');
    label.append('Follows ', source);
    row.append(label, amount, shown);
    syncs.push(show);
    return row;
  }

  const result = { refresh: () => refreshers.forEach((refresh) => refresh()) };
  if (reset === false) {
    syncs.forEach((sync) => sync());
    container.appendChild(section);
    return result;
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
  return result;
}
