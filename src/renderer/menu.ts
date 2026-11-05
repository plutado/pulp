/**
 * The application menu in the window (milestone 27): what each item does, and
 * what the menu is told about what can act.
 *
 * A menu item does **exactly what the button for the same thing does** — in
 * most cases by pressing that button. One behavior, one place, and an item
 * that is disabled in the window is disabled in the menu for the same reason.
 * What the menu may offer is `MenuState`, pushed whenever it changes and only
 * then, since every push rebuilds the menu (src/main/menu-service.ts).
 *
 * The keyboard-shortcut list is read back off the menu itself rather than
 * written out again, so it cannot drift from the keys.
 */

import { effect } from '@preact/signals';
import { exposeIn } from '../core/expose';
import { BLANK_CANVAS_ID } from '../core/menu';
import type { MenuCommand, MenuState } from '../core/menu';
import { DEFAULT_PLAYER, STAGE_BACKGROUNDS, type StageBackground } from '../core/player';
import { THUMB_SIZES } from '../core/results-view';
import { appState, paramsEdited, renderBlocked, results, resultsView, selectedTemplate, transport } from './store';
import { layerEditor, selectedLayer } from './layer-edit';
import { currentLayerFacts, recording, runLayerCommand, stageClipboard } from './stage-menu';
import { registerCommandRunner } from './commands';
import { sayInTray } from './tray';
import { appearanceChoice, chooseAppearance } from './appearance';
import { recordingActive } from './recorder';
import { cameraRecording, toggleCamera } from './camera-recorder';

/**
 * How "New Blank Canvas" shows the canvas: main.ts registers the very select a
 * click in the results performs, so the menu opens it exactly as browsing to
 * it would (milestone 55).
 */
let blankCanvasOpener: () => void = () => undefined;

export function registerBlankCanvasOpener(fn: () => void): void {
  blankCanvasOpener = fn;
}

function openBlankCanvas(): void {
  blankCanvasOpener();
}

/** How a freshly saved template is shown: main.ts registers a select-by-manifest-id that waits for the rescan. */
let savedTemplateOpener: (templateId: string) => void = () => undefined;

export function registerSavedTemplateOpener(fn: (templateId: string) => void): void {
  savedTemplateOpener = fn;
}

/**
 * Save the canvas as a template folder (milestone 55): the window sends what
 * was composed — the stacks, the picked parameters, the length — and the main
 * process asks where (or a test's argument says), writes the folder, and adds
 * it to the library. What could not travel is said in the tray, not dropped
 * silently; the new template is then shown, reopened for editing.
 */
async function saveCanvasAsTemplate(dirArg: string | null): Promise<void> {
  const editor = layerEditor();
  const selected = selectedTemplate.value;
  if (!editor || selected?.manifest.id !== BLANK_CANVAS_ID) return;
  const layers = Object.fromEntries(editor.blocks().map((b) => [b.id, editor.stack(b.id) ?? []]));
  const result = await window.pulp.saveCanvasTemplate({
    layers,
    expose: exposeIn(editor.params()),
    length: editor.length(),
    ...(dirArg ? { dir: dirArg } : {}),
  });
  if (!result.ok) {
    if (!result.cancelled) sayInTray(result.message);
    return;
  }
  for (const note of result.notes) sayInTray(note);
  savedTemplateOpener(result.templateId);
}
import { diagnosticsText } from '../core/log';
import { performanceLines } from '../core/perf';
import { windowPerformance } from './perf';
import { focusSearch } from './search-bar';
import { openBrowseFilter } from './browse';
import { newProject, openProjectFrom, saveProject } from './project';
import { showShortcuts } from './shortcuts';
import { showStartScreen } from './start-screen';
import { showWhatsNew } from './whats-new';
import { showAcknowledgements, showSettings } from './settings';
import { showUserGuide } from './user-guide';
import { startTour } from './tour';
import { findControl, stageIsOut, stageOnDisplay, toggleStagePopOut } from './stage-window';
import { libraryAddState, runLibraryAdd } from './library-add';
import { theaterOn } from './theater';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/**
 * Press the button that does this thing; a button that cannot act does nothing, as in the window.
 * The button is looked for wherever the stage is (milestone 43): the stage's own controls go with
 * it to its window, and are still the one place their state lives.
 */
function press(id: string): void {
  const el = findControl(id) as HTMLButtonElement | null;
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
    case 'help.setup': showStartScreen({ checklist: true }); return;
    case 'project.new': void newProject(); return;
    // The blank canvas (milestone 55): the bundled template to compose on, shown as a click on it would.
    case 'canvas.new': openBlankCanvas(); return;
    case 'canvas.saveTemplate': void saveCanvasAsTemplate(arg); return;
    case 'project.open': void openProjectFrom(null); return;
    case 'project.openRecent': if (arg) void openProjectFrom(arg); return;
    case 'project.save': void saveProject(); return;
    case 'project.saveAs': void saveProject({ saveAs: true }); return;
    // The three Add choices have no button of their own since milestone 47: one Add menu offers
    // them, in the browse panel and here, and both run them through this one place.
    case 'library.addFolder': case 'library.addSampleMedia': case 'pack.import':
      runLibraryAdd(command);
      return;
    case 'pack.export': press('export-pack'); return;
    case 'render.one': press('render'); return;
    case 'render.all': press('collection-render'); return;
    case 'edit.undo': press('undo'); return;
    case 'edit.redo': press('redo'); return;
    // The layer edits (milestone 39) are the same commands the stage's right-click menu names,
    // and they run here, in the one dispatcher, whichever menu asked.
    case 'layer.editText': case 'layer.replaceImage': case 'layer.replaceClip':
    case 'layer.addText': case 'layer.addImage': case 'layer.addVideo': case 'layer.addShape':
    case 'layer.exposeText': case 'layer.exposeColor': case 'layer.exposeImage':
    case 'layer.motion': case 'layer.keyframing':
    case 'layer.cut': case 'layer.copy': case 'layer.paste': case 'layer.duplicate': case 'layer.delete':
    case 'layer.forward': case 'layer.backward': case 'layer.front': case 'layer.back':
    case 'layer.copyLook': case 'layer.pasteLook': case 'layer.startHere': case 'layer.endHere': case 'layer.reset':
      runLayerCommand(command, arg);
      return;
    case 'search.focus': focusSearch(); return;
    case 'browse.filter': {
      // The panel must be out for the field to be seen; the rail has no room for it.
      if (document.getElementById('app')?.classList.contains('browse-collapsed')) press('browse-expand');
      openBrowseFilter();
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
    case 'view.theater': press('theater'); return;
    // Not a press: the stage's own button is in whichever window the stage is in.
    case 'view.popOut': toggleStagePopOut(); return;
    case 'view.stageOnDisplay': stageOnDisplay(Number(arg)); return;
    // One command for the four choices, with the chosen one as its argument — checked against
    // the four, so the argument can only ever name one of the stage's own buttons.
    case 'view.background': if (STAGE_BACKGROUNDS.some((b) => b.id === arg)) press(`bg-${arg}`); return;
    // The same call as Settings → Appearance, which checks the argument names one of the three.
    case 'view.appearance': void chooseAppearance(arg); return;
    case 'record.audio': press('record-audio'); return;
    case 'record.video': toggleCamera(); return;
    case 'collection.add': press('add-to-collection'); return;
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
    case 'help.userGuide': showUserGuide(); return;
    case 'help.acknowledgements': showAcknowledgements(); return;
    case 'app.settings': void showSettings(); return;
    // The status item is the button for it, so the menu presses that rather than keeping a second way.
    case 'help.diagnostics': press('status-diagnostics'); return;
  }
}

/** True when the element is there and not disabled: the same question the menu asks. */
function usable(id: string): boolean {
  const el = findControl(id) as HTMLButtonElement | null;
  return el !== null && el.disabled === false;
}

function pressed(id: string): boolean {
  return findControl(id)?.getAttribute('aria-pressed') === 'true';
}

/** What the stage draws behind a transparent graphic, read off its own controls. */
function stageBackground(): StageBackground {
  if (findControl('bg-custom')?.classList.contains('active')) return 'custom';
  return (STAGE_BACKGROUNDS.find((b) => pressed(`bg-${b.id}`))?.id ?? DEFAULT_PLAYER.background);
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
    stageOut: stageIsOut(),
    canAddSampleMedia: libraryAddState().canAddSampleMedia,
    // The main process fills these in, since the screen is its to see.
    displays: [],
    theater: theaterOn(),
    background: stageBackground(),
    appearance: appearanceChoice.value,
    recordingAudio: recordingActive(),
    recordingVideo: cameraRecording(),
    canAddToCollection: usable('add-to-collection'),
    // What can be done to a layer, worked out once and read by both menus (milestone 39).
    ...currentLayerFacts(),
    keyframing: recording(),
    canSaveCanvas: selectedTemplate.value?.manifest.id === BLANK_CANVAS_ID,
    recent,
  };
}

// ---------------------------------------------------------------- Copy Diagnostics
// (The shortcut list lives in ./shortcuts.ts, shared with the start screen.)

/**
 * What Pulp knows about itself, on the clipboard: enough for someone to say
 * what went wrong without being asked three questions first, now with the
 * last of the local log (milestone 8). The words are `diagnosticsText` in
 * src/core/log.ts; what is gathered for them is here.
 *
 * It is said where it was asked for: the status item itself, which is on
 * screen wherever the command came from. It used to be said in the shortcut
 * dialog's own line, which nobody saw unless that dialog happened to be open.
 */
export async function copyDiagnostics(): Promise<void> {
  const [ffmpeg, diagnostics, cache, log, version, mainPerformance] = await Promise.all([
    window.pulp.ffmpegStatus(),
    window.pulp.libraryDiagnostics(),
    window.pulp.renderCacheStats(),
    window.pulp.logTail(),
    window.pulp.appVersion(),
    window.pulp.appPerformance(),
  ]);
  const index = appState.value.index;
  const text = diagnosticsText({
    at: new Date().toISOString(),
    platform: window.pulp.platform,
    version,
    ffmpeg: ffmpeg.ok ? `${ffmpeg.version ?? 'found'} at ${ffmpeg.path ?? 'unknown'}` : `not found (${ffmpeg.message ?? 'no reason given'})`,
    library: index ? `${index.templates.length} templates, ${index.media.length} media, ${index.problems.length} problems` : 'not scanned yet',
    roots: diagnostics.roots.map((r) => `${r.path}${r.online ? '' : ' (offline)'}`),
    background: `${diagnostics.pendingThumbnails} thumbnails, ${diagnostics.pendingMetadata} probes, ${diagnostics.heavyWaiting} waiting`,
    renderCache: cache.summary,
    project: `${appState.value.project.name}${appState.value.project.path ? ` (${appState.value.project.path})` : ' (not saved)'}`,
    renders: appState.value.jobs.jobs.length,
    logPath: log.path,
    logTail: log.lines,
    // Speed and weight (milestone 58): what the main process measured just now, and what the window
    // has been recording as it searched, scrolled and took the index in.
    performance: performanceLines(mainPerformance, windowPerformance()),
  });
  const ok = await window.pulp.copyDiagnostics(text);
  sayInStatus(ok ? 'Diagnostics copied' : 'Could not reach the clipboard');
}

/** The status item says what just happened, then goes back to being a button. */
function sayInStatus(words: string): void {
  const button = document.getElementById('status-diagnostics');
  const label = button?.querySelector('.label');
  if (!button || !label) return;
  label.textContent = words;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { label.textContent = ''; }, 4000);
}
let sayTimer: ReturnType<typeof setTimeout> | undefined;

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

/** Something the menu reads changed outside a click or a key — a recording started or stopped. */
export function menuStateChanged(): void {
  refresh();
}

/** The recent list changed — a project was saved or opened — so Open Recent follows. */
export function menuRecentChanged(paths: readonly string[]): void {
  recent = [...paths];
  refresh();
}

export function initMenu(): void {
  // Copy diagnostics is a button in the status items (milestone 8); Help's item presses it.
  document.getElementById('status-diagnostics')?.addEventListener('click', () => void copyDiagnostics());
  window.pulp.onMenuCommand((command, arg) => run(command, arg));
  // The stage's right-click menu names the same commands and runs them through here
  // (milestone 39), so a command cannot mean one thing on one menu and another on the other.
  registerCommandRunner(run);
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
    // The layer edits follow the selection on the stage and the edits made to it (milestone 39).
    void selectedLayer.value;
    void paramsEdited.value;
    void stageClipboard.value;
    void appearanceChoice.value;
    refresh();
  });
  // A region toggle, the transport and the view buttons change what the menu may offer without
  // changing the shared state, so the menu also follows anything pressed in the window.
  document.addEventListener('click', refresh, true);
  document.addEventListener('keyup', refresh, true);
}
