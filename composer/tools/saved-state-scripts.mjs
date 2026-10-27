// The page scripts of the saved-state audit (#10), shared by
// tools/check-saved-state.mjs (the browser, a reload) and
// app/check-app-saved-state.mjs (the desktop app, a quit and a reopen).
// Run in the page: a name for each control, and its value.
export const SNAPSHOT = `(() => {
  const name = (el) => {
    if (el.id) return '#' + el.id;
    const parts = [];
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      if (node.id) { parts.unshift('#' + node.id); break; }
      const same = [...(node.parentElement?.children ?? [])].filter((c) => c.tagName === node.tagName);
      parts.unshift(node.tagName.toLowerCase() + (same.length > 1 ? ':' + (same.indexOf(node) + 1) : ''));
    }
    return parts.join(' > ');
  };
  const label = (el) => (el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.title || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  const controls = {};
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (['file', 'password', 'button', 'submit', 'reset', 'hidden'].includes(el.type)) continue;
    controls[name(el)] = { type: el.type || el.tagName.toLowerCase(), label: label(el),
      value: el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value,
      shown: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length), disabled: el.disabled };
  }
  return controls;
})()`;

// Run in the page: give every enabled control another value.
export const CHANGE_ALL = `(async () => {
  const fire = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const changed = [];
  const never = new Set(['host', 'receiver-list']);
  for (const el of [...document.querySelectorAll('input, select, textarea')]) {
    if (!el.isConnected || el.disabled || never.has(el.id) || ['file', 'password', 'button', 'submit', 'reset', 'hidden'].includes(el.type)) continue;
    if (el.type === 'checkbox') el.checked = !el.checked;
    else if (el.type === 'radio') { if (el.checked) continue; el.checked = true; }
    else if (el.tagName === 'SELECT') {
      const other = [...el.options].find((o) => o.value !== el.value && !o.disabled && o.value !== 'custom');
      if (!other) continue;
      el.value = other.value;
    } else if (el.type === 'range' || el.type === 'number') {
      const min = el.min === '' ? -Infinity : Number(el.min), max = el.max === '' ? Infinity : Number(el.max);
      const step = el.step && el.step !== 'any' ? Number(el.step) : (el.type === 'range' ? (max - min) / 100 || 1 : 1);
      const now = Number(el.value || 0);
      let next = now + step * 3 <= max ? now + step * 3 : now - step * 3;
      if (next < min) continue;
      el.value = String(Math.round(next * 1e6) / 1e6);
    } else if (el.type === 'color') el.value = el.value === '#123456' ? '#654321' : '#123456';
    else if (['text', 'search', 'url', 'textarea', ''].includes(el.type) || el.tagName === 'TEXTAREA') {
      if (/host|address|url/i.test(el.id + el.name + (el.placeholder || ''))) continue;
      el.value = (el.value || '') + ' saved-check';
    } else continue;
    fire(el);
    changed.push(el.id || el.name || el.tagName);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return changed.length;
})()`;


// What came back: each control set away from its default, kept or lost.
export function compare(defaults, set, back) {
  const rows = [];
  for (const [key, before] of Object.entries(set)) {
    const after = back[key];
    const changedFromDefault = !(defaults[key] && defaults[key].value === before.value);
    const result = !after ? 'gone' : after.value === before.value ? 'kept' : 'lost';
    rows.push({ key, label: before.label, type: before.type, shown: before.shown, set: before.value,
      after: after?.value, default: defaults[key]?.value, changedFromDefault, result });
  }
  const told = rows.filter((r) => r.changedFromDefault);
  const lost = told.filter((r) => r.result !== 'kept');
  // Backslashes first, then the table's own bar, so a cell cannot end early.
  const out = (v) => String(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').slice(0, 40);
  const table = ['| Control | Label | Type | Shown | Set to | After | Result |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...told.sort((a, b) => (a.result === 'kept') - (b.result === 'kept') || a.key.localeCompare(b.key))
      .map((r) => `| \`${r.key}\` | ${out(r.label)} | ${r.type} | ${r.shown ? 'yes' : 'no'} | ${out(r.set)} | ${out(r.after)} | ${r.result} |`)];
  return { rows, told, lost, table: table.join('\n') };
}
