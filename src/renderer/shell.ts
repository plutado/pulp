/**
 * The shell: applies the pane layout (src/core/layout.ts) as CSS custom
 * properties and classes on #app, wires the splitters and collapse toggles,
 * and persists changes through settings.json. It owns only the shell chrome;
 * regions render their own content from the shared state.
 */

import { effect } from '@preact/signals';
import { traySummary } from '../core/app-state';
import {
  DEFAULT_LAYOUT,
  LAYOUT_LIMITS,
  layoutCssVariables,
  withCollapsed,
  withPaneSize,
  type CollapsiblePane,
  type LayoutState,
  type SizedPane,
} from '../core/layout';
import { appState } from './store';
import { setIcon } from './icons';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

let layout: LayoutState = DEFAULT_LAYOUT;

function apply(app: HTMLElement): void {
  for (const [name, value] of Object.entries(layoutCssVariables(layout))) app.style.setProperty(name, value);
  app.classList.toggle('browse-collapsed', layout.browseCollapsed);
  app.classList.toggle('stage-collapsed', layout.stageCollapsed);
  app.classList.toggle('tray-collapsed', layout.trayCollapsed);
  $('browse-expand').hidden = !layout.browseCollapsed;
  $('browse-toggle').setAttribute('aria-expanded', String(!layout.browseCollapsed));
  const stage = $('stage-toggle');
  stage.setAttribute('aria-expanded', String(!layout.stageCollapsed));
  stage.setAttribute('aria-label', layout.stageCollapsed ? 'Show the preview' : 'Hide the preview');
  setIcon(stage, layout.stageCollapsed ? 'caret-down' : 'caret-up');
  const tray = $('tray-toggle');
  tray.setAttribute('aria-expanded', String(!layout.trayCollapsed));
  setIcon(tray, layout.trayCollapsed ? 'caret-up' : 'caret-down');
}

function set(app: HTMLElement, next: LayoutState, save: boolean): void {
  const changed = next !== layout;
  layout = next;
  if (changed) apply(app);
  if (changed && save) void window.pulp.saveLayout(layout);
}

/** Pointer drags resize live and save once on release; arrow keys resize in steps and save each press. */
function wireSplitter(app: HTMLElement, el: HTMLElement, pane: SizedPane, fromPointer: (e: PointerEvent) => number): void {
  el.addEventListener('pointerdown', (down) => {
    down.preventDefault();
    el.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent) => set(app, withPaneSize(layout, pane, fromPointer(e)), false);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      void window.pulp.saveLayout(layout);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('keydown', (e) => {
    const less = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const more = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    if (!less && !more) return;
    e.preventDefault();
    const step = pane === 'stageShare' ? 0.03 : 16;
    set(app, withPaneSize(layout, pane, layout[pane] + (more ? step : -step)), true);
  });
}

function wireToggle(app: HTMLElement, el: HTMLElement, pane: CollapsiblePane): void {
  el.addEventListener('click', () => {
    const collapsed = !layout[`${pane}Collapsed`];
    set(app, withCollapsed(layout, pane, collapsed), true);
  });
}

export function initShell(): void {
  const app = $('app');
  apply(app);

  const center = document.querySelector('.center') as HTMLElement;
  const searchBar = $('region-search');
  wireSplitter(app, $('split-browse'), 'browseWidth', (e) => e.clientX - app.getBoundingClientRect().left);
  wireSplitter(app, $('split-inspector'), 'inspectorWidth', (e) => app.getBoundingClientRect().right - e.clientX);
  wireSplitter(app, $('split-stage'), 'stageShare', (e) => {
    const c = center.getBoundingClientRect();
    const top = c.top + searchBar.getBoundingClientRect().height;
    return (e.clientY - top) / Math.max(1, c.height - searchBar.getBoundingClientRect().height);
  });
  wireSplitter(app, $('split-tray'), 'trayHeight', (e) => $('region-tray').getBoundingClientRect().bottom - e.clientY);

  wireToggle(app, $('browse-toggle'), 'browse');
  wireToggle(app, $('browse-expand'), 'browse');
  wireToggle(app, $('stage-toggle'), 'stage');
  wireToggle(app, $('tray-toggle'), 'tray');

  // The one-line summary, and the drawer opening itself when the first job arrives.
  const summary = $('tray-summary');
  let lastCount = 0;
  effect(() => {
    const s = appState.value;
    summary.textContent = traySummary(s);
    // Opens itself for the first thing collected or queued, and stays as left after that.
    const count = s.jobs.jobs.length + s.collection.items.length;
    if (count > 0 && lastCount === 0 && layout.trayCollapsed) set(app, withCollapsed(layout, 'tray', false), true);
    lastCount = count;
  });

  // The saved layout arrives after first paint; starting from the defaults avoids a flash of nothing.
  void window.pulp.getLayout().then((saved) => set(app, saved, false));

  // Clamp the pane widths back into view when the window shrinks below them.
  window.addEventListener('resize', () => {
    const max = Math.max(LAYOUT_LIMITS.browseWidth.min, Math.floor(window.innerWidth * 0.35));
    if (layout.browseWidth > max) set(app, withPaneSize(layout, 'browseWidth', max), true);
    if (layout.inspectorWidth > max) set(app, withPaneSize(layout, 'inspectorWidth', max), true);
  });
}
