/**
 * The application menu in the window (milestone 27): what each item does, and
 * what the menu is told about what can act.
 *
 * A menu item does **exactly what the button for the same thing does** — in
 * most cases by pressing that button. One behaviour, one place, and an item
 * that is disabled in the window is disabled in the menu for the same reason.
 * What the menu may offer is `MenuState`, pushed whenever it changes and only
 * then, since every push rebuilds the menu (src/main/menu-service.ts).
 *
 * The keyboard-shortcut list is read back off the menu itself rather than
 * written out again, so it cannot drift from the keys.
 */

import { effect } from '@preact/signals';
import type { MenuCommand, MenuState } from '../core/menu';
import { THUMB_SIZES } from '../core/results-view';
import { appState, renderBlocked, results, resultsView, transport } from './store';
import { newProject, openProjectFrom, saveProject } from './project';
import { showShortcuts } from './shortcuts';
import { showStartScreen } from './start-screen';
import { showWhatsNew } from './whats-new';
import { startTour } from './tour';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** Press the button that does this thing; a button that cannot act does nothing, as in the window. */
function press(id: string): void {
  const el = document.getElementById(id) as HTMLButtonElement | null;
  if (el && !el.disabled) el.click();
}

/** Step the thumbnail size along its own steps, which is what the slider does. */
function stepCardSize(delta: number): void {
  const size = document.getElementById('thumb-size') as HTMLInputElement | null;
  if (!size || size.disabled) return;
  const at = Number(size.value);
  const next = Math.min(THUMB_SIZES.length - 1, Math.max(0, at + delta));
  if (next === at) return;
  size.value = String(next);
  size.dispatchEvent(new Event('input', { bubbles: true }));
}

function run(command: MenuCommand, arg: string | null): void {
  switch (command) {
    case 'app.home': showStartScreen(); return;
    case 'project.new': void newProject(); return;
    case 'project.open': void openProjectFrom(null); return;
    case 'project.openRecent': if (arg) void openProjectFrom(arg); return;
    case 'project.save': void saveProject(); return;
    case 'project.saveAs': void saveProject({ saveAs: true }); return;
    case 'library.addFolder': press('add-folder'); return;
    case 'library.addSampleMedia': press('add-sample-media'); return;
    case 'pack.import': press('import-pack'); return;
    case 'pack.export': press('export-pack'); return;
    case 'render.one': press('render'); return;
    case 'render.all': press('collection-render'); return;
    case 'edit.undo': press('undo'); return;
    case 'edit.redo': press('redo'); return;
    case 'browse.find': {
      const find = document.querySelector('#browse-find input') as HTMLInputElement | null;
      find?.focus();
      find?.select();
      return;
    }
    case 'view.browse': press('browse-toggle'); return;
    case 'view.stage': press('stage-toggle'); return;
    case 'view.results': press('results-toggle'); return;
    case 'view.tray': press('tray-toggle'); return;
    // The drawer's tabs are the buttons in the transport row: open, switch, or close (milestone 38).
    case 'view.parameters': press('tab-parameters'); return;
    case 'view.output': press('tab-output'); return;
    case 'view.info': press('tab-info'); return;
    case 'view.grid': press('view-grid'); return;
    case 'view.list': press('view-list'); return;
    case 'view.bigger': stepCardSize(1); return;
    case 'view.smaller': stepCardSize(-1); return;
    case 'play.toggle': press('play'); return;
    case 'play.previous': press('step-back'); return;
    case 'play.next': press('step-forward'); return;
    case 'play.setIn': press('mark-in'); return;
    case 'play.setOut': press('mark-out'); return;
    case 'play.loop': press('loop'); return;
    case 'help.tour': startTour(); return;
    case 'help.whatsNew': showWhatsNew(); return;
    case 'help.shortcuts': void showShortcuts(); return;
    case 'help.diagnostics': void copyDiagnostics(); return;
  }
}

/** True when the element is there and not disabled: the same question the menu asks. */
function usable(id: string): boolean {
  const el = document.getElementById(id) as HTMLButtonElement | null;
  return el !== null && el.disabled === false;
}

function pressed(id: string): boolean {
  return document.getElementById(id)?.getAttribute('aria-pressed') === 'true';
}

function visible(region: 'browse' | 'stage' | 'tray' | 'results'): boolean {
  return !$('app').classList.contains(`${region}-collapsed`);
}

/** The drawer is open on this tab: read off the window's own controls, as every flag is. */
function tabOpen(tab: 'parameters' | 'output' | 'info'): boolean {
  return $('app').classList.contains('inspector-open') && document.getElementById(`tab-${tab}`)?.getAttribute('aria-selected') === 'true';
}

function readState(recent: string[]): MenuState {
  // The transport is the stage's own fact, published as a signal, because a preview becoming
  // ready changes nothing else in the window and so would otherwise go unnoticed here.
  const t = transport.value;
  return {
    canRender: usable('render'),
    canRenderAll: usable('collection-render'),
    canExportPack: usable('export-pack'),
    canUndo: usable('undo'),
    canRedo: usable('redo'),
    canPlay: t.canPlay,
    playing: t.playing,
    loop: t.loop,
    browseVisible: visible('browse'),
    stageVisible: visible('stage'),
    resultsVisible: visible('results'),
    trayVisible: visible('tray'),
    parametersOpen: tabOpen('parameters'),
    outputOpen: tabOpen('output'),
    infoOpen: tabOpen('info'),
    grid: pressed('view-grid'),
    recent,
  };
}

// ---------------------------------------------------------------- Copy Diagnostics
// (The shortcut list lives in ./shortcuts.ts, shared with the start screen.)

/**
 * What Pulp knows about itself, on the clipboard: enough for someone to say
 * what went wrong without being asked three questions first. No paths beyond
 * the library roots the person chose themselves.
 */
async function copyDiagnostics(): Promise<void> {
  const [ffmpeg, diagnostics, cache] = await Promise.all([
    window.pulp.ffmpegStatus(),
    window.pulp.libraryDiagnostics(),
    window.pulp.renderCacheStats(),
  ]);
  const index = appState.value.index;
  const lines = [
    `Pulp diagnostics — ${new Date().toISOString()}`,
    `Platform: ${window.pulp.platform}`,
    `ffmpeg: ${ffmpeg.ok ? `${ffmpeg.version ?? 'found'} at ${ffmpeg.path ?? 'unknown'}` : `not found (${ffmpeg.message ?? 'no reason given'})`}`,
    `Library: ${index ? `${index.templates.length} templates, ${index.media.length} media, ${index.problems.length} problems` : 'not scanned yet'}`,
    `Roots: ${diagnostics.roots.map((r) => `${r.path}${r.online ? '' : ' (offline)'}`).join(', ') || 'none'}`,
    `Background: ${diagnostics.pendingThumbnails} thumbnails, ${diagnostics.pendingMetadata} probes, ${diagnostics.heavyWaiting} waiting`,
    `Render cache: ${cache.summary}`,
    `Project: ${appState.value.project.name}${appState.value.project.path ? ` (${appState.value.project.path})` : ' (not saved)'}`,
    `Renders this session: ${appState.value.jobs.jobs.length}`,
  ];
  const ok = await window.pulp.copyDiagnostics(lines.join('\n'));
  const said = $('shortcuts-copied');
  said.textContent = ok ? 'Diagnostics copied to the clipboard.' : 'Could not reach the clipboard.';
  said.hidden = false;
  setTimeout(() => { said.hidden = true; }, 4000);
}

// ---------------------------------------------------------------- wiring

/** Recently opened projects, as the main process has them; the Open Recent submenu. */
let recent: string[] = [];
let lastSent = '';

function push(): void {
  const state = readState(recent);
  const serialized = JSON.stringify(state);
  // Every push rebuilds the menu, so only a real change is sent.
  if (serialized === lastSent) return;
  lastSent = serialized;
  void window.pulp.setMenuState(state);
}

/**
 * The state is read off the window's own controls, which is what keeps a menu
 * item and its button in step. A `disabled` attribute is not a signal, so the
 * read is scheduled rather than taken inside the effect: by the time the
 * microtask runs, everything the change set off has been applied.
 */
let scheduled = false;
function refresh(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    push();
  });
}

/** The recent list changed — a project was saved or opened — so Open Recent follows. */
export function menuRecentChanged(paths: readonly string[]): void {
  recent = [...paths];
  refresh();
}

export function initMenu(): void {
  window.pulp.onMenuCommand((command, arg) => run(command, arg));
  // For tests and scripting: run a menu item without the menu, which cannot be clicked from here.
  (window as unknown as { pulpMenuCommand?: (command: MenuCommand, arg?: string) => void }).pulpMenuCommand =
    (command, arg) => run(command, arg ?? null);
  $('shortcuts-close').addEventListener('click', () => $<HTMLDialogElement>('shortcuts-dialog').close());
  void window.pulp.recentProjects().then(menuRecentChanged);

  effect(() => {
    void appState.value;
    void resultsView.value;
    void results.value;
    void renderBlocked.value;
    void transport.value;
    refresh();
  });
  // A region toggle, the transport and the view buttons change what the menu may offer without
  // changing the shared state, so the menu also follows anything pressed in the window.
  document.addEventListener('click', refresh, true);
  document.addEventListener('keyup', refresh, true);
}
