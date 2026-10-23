/**
 * Tooltips for icon-only controls (docs/ui-style.md): the control's aria-label, or
 * its data-tip when the tooltip should say more (a shortcut, say), shown after a
 * short delay on hover and on keyboard focus, hidden on leave, blur or Escape.
 * One tooltip element serves the whole window; native title attributes are not
 * used on these controls, so nothing shows twice.
 */

const DELAY_MS = 500;
const SELECTOR = '[data-tip], button[aria-label]';

export function initTooltips(): void {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: HTMLElement | null = null;

  const textFor = (el: HTMLElement): string => el.dataset.tip ?? el.getAttribute('aria-label') ?? '';

  const position = (el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
    // Below the control; above it when there is no room.
    const top = r.bottom + 6 + t.height > window.innerHeight ? r.top - t.height - 6 : r.bottom + 6;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  const hide = (): void => {
    clearTimeout(timer);
    tip.hidden = true;
    current = null;
  };

  const show = (el: HTMLElement): void => {
    const text = textFor(el);
    // A control with visible text needs no tooltip unless data-tip says more; in the icon rail the
    // labels are display:none, so innerText is empty and the tooltip steps in.
    if (!text || (el.dataset.tip === undefined && el.innerText.trim() !== '')) return;
    current = el;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (current !== el) return;
      tip.textContent = text;
      tip.hidden = false;
      position(el);
    }, DELAY_MS);
  };

  const controlFrom = (target: EventTarget | null): HTMLElement | null => {
    const el = target instanceof Element ? target.closest(SELECTOR) : null;
    return el instanceof HTMLElement ? el : null;
  };

  document.addEventListener('mouseover', (e) => {
    const el = controlFrom(e.target);
    if (el && el !== current) show(el);
  });
  document.addEventListener('mouseout', (e) => {
    if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = controlFrom(e.target);
    if (el) show(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  document.addEventListener('mousedown', hide);
}
