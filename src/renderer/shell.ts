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

/** Followers told whenever the layout is applied: the drawer reads its tab from it (milestone 38). */
const followers: ((l: LayoutState) => void)[] = [];
export function onLayoutApplied(cb: (l: LayoutState) => void): void {
  followers.push(cb);
}

/** The one in-memory layout: another module's change (the drawer's tab) merges here, so a later pane drag cannot revert it. */
export function patchLayout(patch: Partial<LayoutState>): void {
  const app = document.getElementById('app');
  if (!app) return;
  set(app, { ...layout, ...patch }, true);
}

function apply(app: HTMLElement): void {
  for (const [name, value] of Object.entries(layoutCssVariables(layout))) app.style.setProperty(name, value);
  app.classList.toggle('browse-collapsed', layout.browseCollapsed);
  app.classList.toggle('stage-collapsed', layout.stageCollapsed);
  app.classList.toggle('tray-collapsed', layout.trayCollapsed);
  app.classList.toggle('results-collapsed', layout.resultsCollapsed);
  $('browse-expand').hidden = !layout.browseCollapsed;
  $('browse-toggle').setAttribute('aria-expanded', String(!layout.browseCollapsed));
  const stage = $('stage-toggle');
  stage.setAttribute('aria-expanded', String(!layout.stageCollapsed));
  stage.setAttribute('aria-label', layout.stageCollapsed ? 'Show the preview' : 'Hide the preview');
  setIcon(stage, layout.stageCollapsed ? 'caret-down' : 'caret-up');
  const tray = $('tray-toggle');
  tray.setAttribute('aria-expanded', String(!layout.trayCollapsed));
  setIcon(tray, layout.trayCollapsed ? 'caret-up' : 'caret-down');
  const results = $('results-toggle');
  results.setAttribute('aria-expanded', String(!layout.resultsCollapsed));
  results.setAttribute('aria-label', layout.resultsCollapsed ? 'Show the results' : 'Hide the results');
  setIcon(results, layout.resultsCollapsed ? 'caret-up' : 'caret-down');
  for (const follow of followers) follow(layout);
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
  wireSplitter(app, $('split-browse'), 'browseWidth', (e) => e.clientX - app.getBoundingClientRect().left);
  // The drawer resizes from its top edge, as the tray and the transport row do (milestone 38).
  wireSplitter(app, $('split-inspector'), 'inspectorHeight', (e) => $('region-inspector').getBoundingClientRect().bottom - e.clientY);
  // The stage starts at the centre's top edge (milestone 41): nothing sits above it any more.
  wireSplitter(app, $('split-stage'), 'stageShare', (e) => {
    const c = center.getBoundingClientRect();
    return (e.clientY - c.top) / Math.max(1, c.height);
  });
  wireSplitter(app, $('split-tray'), 'trayHeight', (e) => $('region-tray').getBoundingClientRect().bottom - e.clientY);
  // The transport row (milestone 37) resizes from its top edge, as the tray does: up is more room for the layer bars.
  wireSplitter(app, $('split-transport'), 'transportHeight', (e) => $('region-transport').getBoundingClientRect().bottom - e.clientY);

  wireToggle(app, $('browse-toggle'), 'browse');
  wireToggle(app, $('browse-expand'), 'browse');
  wireToggle(app, $('stage-toggle'), 'stage');
  wireToggle(app, $('tray-toggle'), 'tray');
  wireToggle(app, $('results-toggle'), 'results');

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

  // The center column's floor is a sum the stylesheet keeps (--center-min-h), and one of its terms
  // is not a constant: the chrome under the center — the status bar and the tray's head — which
  // classic scroll bars and platform font metrics make taller on Linux and Windows than on macOS.
  // It is measured here rather than guessed, so the stage keeps its floor on every platform
  // (docs/platform-notes.md). The tray's head, splitter and border are read as the tray minus its
  // body, which also holds collapsed, when the body and the splitter are gone; the difference does
  // not change when a cap resizes the body, so the observers settle. (The search bar's height was
  // the other term until milestone 41 moved the bar into the left panel.)
  const tray = $('region-tray');
  const trayBody = document.querySelector('.tray-body') as HTMLElement;
  const status = $('region-status');
  const floors = () => {
    const trayChrome = tray.getBoundingClientRect().height - trayBody.getBoundingClientRect().height;
    app.style.setProperty('--chrome-h', `${Math.ceil(status.getBoundingClientRect().height + trayChrome)}px`);
  };
  const measure = new ResizeObserver(floors);
  for (const el of [status, tray]) measure.observe(el);
  floors();

  // Clamp the browse width back into view when the window shrinks below it.
  window.addEventListener('resize', () => {
    const max = Math.max(LAYOUT_LIMITS.browseWidth.min, Math.floor(window.innerWidth * 0.35));
    if (layout.browseWidth > max) set(app, withPaneSize(layout, 'browseWidth', max), true);
  });
}
