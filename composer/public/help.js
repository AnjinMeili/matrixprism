// A control's help, kept out of the way: a small round "i" button whose
// popover shows on hover and on keyboard focus, read by screen readers as the
// button's description. Escape hides it. Written once per control, here
// rather than as lines of text under it. Styles in style.css.
//
// The popover is placed against the window, not its pane, so a pane that
// clips its contents cannot cut it off (Anjin, 2026-10-16: "popup info is
// truncated"): above the button, or below it where there is no room, and
// moved sideways to stay inside the window.
let count = 0;
const MARGIN = 8;

function place(button, pop) {
  pop.style.display = 'block';
  const anchor = button.getBoundingClientRect();
  const { width, height } = pop.getBoundingClientRect();
  const left = Math.min(Math.max(MARGIN, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - MARGIN);
  const above = anchor.top - height - 6;
  pop.style.left = `${Math.max(MARGIN, left)}px`;
  pop.style.top = `${above >= MARGIN ? above : anchor.bottom + 6}px`;
}

export function helpPopover(text, about) {
  const id = `help-${++count}`;
  const wrapper = document.createElement('span');
  wrapper.className = 'help';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'help-button';
  button.textContent = 'i';
  button.setAttribute('aria-label', `About ${about}`);
  button.setAttribute('aria-describedby', id);
  const pop = document.createElement('span');
  pop.className = 'help-pop';
  pop.id = id;
  pop.setAttribute('role', 'tooltip');
  pop.textContent = text;
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') button.blur();
  });
  const hide = () => {
    if (!wrapper.matches(':hover') && document.activeElement !== button) pop.style.display = '';
  };
  wrapper.addEventListener('mouseenter', () => place(button, pop));
  button.addEventListener('focus', () => place(button, pop));
  wrapper.addEventListener('mouseleave', hide);
  button.addEventListener('blur', hide);
  wrapper.append(button, pop);
  return wrapper;
}
