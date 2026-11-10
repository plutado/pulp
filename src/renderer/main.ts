import type { LibraryEntry, LibraryIndex, MediaEntry, TemplateEntry } from '../core/library-types';
import { formatBytes, setCollection, setEditing, setIndex, setJobs, setQuery, setSelection, setShown, setTallWork, shownEntry } from '../core/app-state';
import { addItem, itemFor, type Collection } from '../core/collection';
import { appState, dispatch, frameSize, paramsEdited, preferredAspect, preferredPlatform, results, selectedTemplate } from './store';
import { workIsTall } from '../core/vertical-layout';
import { platformPreset } from '../core/platform-presets';
import { mountResults, showSelectedResult } from './results';
import { mountCategoryCards } from './category-cards';
import { infoSetFfmpeg, mountItemInfo } from './item-info';
import { initStage, stageClear, stageShowMedia, stageShowTemplate, stopPlayback } from './stage';
import { initCleanup, initStabilize } from './cleanup';
import { initShell } from './shell';
import { closeInspectorUnlessPinned, initInspectorTabs, openInspector, showInspectorTab } from './inspector-tabs';
import { mountCaptions } from './captions';
import { chosenLibraryItems, currentCaptions, currentLayers, currentRawParams, currentSound, currentTrack, exposeLayerProperty, initInspectorParams, paramsClear, paramsRelabel, paramsShow } from './inspector-params';
import { currentOptions, currentPresetId, initInspectorOutput, outputClear, outputEdited, outputSetFfmpeg, outputSetFfmpegFeatures, outputShow, outputShowMedia, setTemplateShower, updateRenderControls } from './inspector-output';
import { initGuidedSetup } from './guided-setup';
import { initSemantic } from './semantic';
import { browseAccordion, browseFoldToActive, mountBrowse } from './browse';
import { initSearchBar } from './search-bar';
import { initStatusBar, setFfmpeg, setScanning } from './status-bar';
import { initTray, sayInTray } from './tray';
import { initSampleHint, refreshSampleHint } from './sample-hint';
import { initLibraryAdd, setLibraryAddBusy } from './library-add';
import { initProject, openProjectFrom } from './project';
import { askAboutRecovery, initProjectUi, offerInterruptedRenders } from './project-ui';
import { initMenu, registerBlankCanvasOpener, registerSavedTemplateOpener } from './menu';
import { initAppearance } from './appearance';
import { bindText, initI18n, locale, t, whenLocaleChanges } from './i18n';
import { localizeIndex } from '../core/library-words';
import type { MessageId, MessageValues } from '../core/i18n';
import { initRecorder, registerRecordingOpener } from './recorder';
import { initCameraRecorder } from './camera-recorder';
import { registerExposer } from './stage-menu';
import { BLANK_CANVAS_ID } from '../core/menu';
import { initContextMenu } from './context-menu';
import { hideStartScreen, initStartScreen, showStartScreen } from './start-screen';
import { browsedHiddenChoice } from './psd-state';
import { initTheater } from './theater';
import { initStageWindow } from './stage-window';
import { initCrashLog } from './crash-log';
import { initTour } from './tour';
import { initWhatsNew } from './whats-new';
import { initSettings, registerFfmpegRefresh } from './settings';
import { receiveTiming, windowPerformance } from './perf';
import { initUserGuide } from './user-guide';
import { FONT_SCHEME, fontFaceCss, importedFontFaceCss } from '../core/fonts';
import { importedFonts } from './store';
import { mountIcons } from './icons';
import { initTooltips } from './tooltip';
import { effect, untracked } from '@preact/signals';
import type { CollisionChoice, PackPreview } from '../core/pack';

// The interface's language first, so whatever is drawn from code after it is in it (milestone 59).
initI18n();

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  search: $<HTMLInputElement>('search'),
  exportPack: $<HTMLButtonElement>('export-pack'),
  packDialog: $<HTMLDialogElement>('pack-dialog'),
  packTitle: $<HTMLHeadingElement>('pack-title'),
  packMeta: $<HTMLParagraphElement>('pack-meta'),
  packLicense: $<HTMLParagraphElement>('pack-license'),
  packTemplates: $<HTMLUListElement>('pack-templates'),
  packProblems: $<HTMLDivElement>('pack-problems'),
  packExportFields: $<HTMLDivElement>('pack-export-fields'),
  packExportName: $<HTMLInputElement>('pack-export-name'),
  packExportAuthor: $<HTMLInputElement>('pack-export-author'),
  packExportLicense: $<HTMLInputElement>('pack-export-license'),
  packResult: $<HTMLDivElement>('pack-result'),
  packConfirm: $<HTMLButtonElement>('pack-confirm'),
  packClose: $<HTMLButtonElement>('pack-close'),
  rescan: $<HTMLButtonElement>('rescan'),
  results: $<HTMLUListElement>('results'),
  summary: $<HTMLDivElement>('library-summary'),
};


// ---------------------------------------------------------------- library

/** Pushes index, query and selection into the shared state (the Results component renders the list from it) and redraws the summary. */
function renderResults(): void {
  dispatch((s) => setSelection(setQuery(s, els.search.value), selectedTemplate.value?.key ?? null));
  paintSummary();
}

/** The library's counts and its first problems, in the status row: drawn again when the language changes too. */
function paintSummary(): void {
  const index = appState.value.index;
  els.summary.replaceChildren();
  if (!index) return;
  const counts = document.createElement('div');
  // Short, since the counts share the transport row's line with the controls (milestone 42):
  // the items, with the templates, the media files and the folders told apart in the tooltip.
  counts.textContent = t('library-summary.items', { count: index.templates.length + index.media.length });
  counts.dataset.tip = t('library-summary.tip', {
    templates: t('library-summary.templates', { count: index.templates.length }),
    media: t('library-summary.media-files', { count: index.media.length }),
    folders: t('library-summary.folders', { count: index.roots.length }),
  });
  els.summary.append(counts);
  for (const p of index.problems.slice(0, 5)) {
    const div = document.createElement('div');
    div.className = 'problem';
    // The bar keeps one line, so the whole message rides in the tooltip.
    div.title = p.issues?.map((i) => `${i.path}: ${i.message}`).join('\n') || `${p.message} (${p.path})`;
    div.textContent = `${p.message} (${p.path.split(/[\\/]/).slice(-2).join('/')})`;
    els.summary.append(div);
  }
}

/**
 * The library as the main process sent it, in US English; what the state holds is it in the
 * interface's language (src/core/library-words.ts), made again when the language changes.
 */
let sourceIndex: LibraryIndex | null = null;
// Untracked: inside the language's effect, reading the state would tie every later dispatch back to it.
whenLocaleChanges(() => untracked(() => {
  if (!sourceIndex) return;
  const shown = localizeIndex(sourceIndex, locale.value);
  dispatch((s) => setIndex(s, shown));
  // The template on the stage is the same one in other words: its tab is drawn again from them,
  // keeping what was set on it.
  const selected = selectedTemplate.value;
  const fresh = selected ? shown.templates.find((t) => t.key === selected.key) : undefined;
  if (fresh && fresh !== selected) {
    selectedTemplate.value = fresh;
    paramsRelabel();
  }
}));

async function loadLibrary(next: Promise<LibraryIndex | null>): Promise<void> {
  setScanning(true);
  let index: LibraryIndex | null;
  try {
    index = await next;
  } finally {
    setScanning(false);
  }
  if (!index) return;
  const first = appState.value.index === null;
  // Timed for Copy diagnostics (milestone 58): the index landing in the state, which recomputes
  // the results, the facets and the tree over the whole library.
  const started = performance.now();
  sourceIndex = index;
  dispatch((s) => setIndex(s, localizeIndex(index, locale.value)));
  receiveTiming.record(performance.now() - started);
  // A session that ended suddenly is offered back once the library is in, since the items it
  // holds mean nothing without one. Recovering it is choosing to work, so the start screen goes.
  if (first) {
    void askAboutRecovery().then(async (recovered) => {
      if (recovered) hideStartScreen();
      // The file the app was started with, if it was started by one (milestone 17): opened
      // after the recovery question, through the same opener as File → Open, which asks before
      // a recovered session with changes is put aside for it.
      const handed = await window.pulp.takePendingOpen();
      if (handed) await openFromSystem(handed);
      // And the renders a killed session left unfinished (milestone 58), after the project is settled.
      await offerInterruptedRenders();
    });
  }
  // The panel opens on where you are rather than on everything at once: the first time there is a
  // tree to fold, it folds to the active category's path, or to Quick access alone.
  if (first) browseFoldToActive();
  if (selectedTemplate.value) {
    const still = index.templates.find((t) => t.manifest.id === selectedTemplate.value?.manifest.id);
    if (!still) clearSelection();
  }
  renderResults();
}

// ---------------------------------------------------------------- selection + params

/** Stop and hide the media preview elements. */
function clearSelection(): void {
  selectedTemplate.value = null;
  stageClear();
  dispatch((s) => setShown(s, null));
  paramsClear();
  outputClear();
  updateRenderControls();
}

/** Show a media item in the stage, served by id through pulp-media://. */
function selectMedia(entry: MediaEntry): void {
  clearSelection();
  dispatch((s) => setShown(s, entry.key));
  // A media item has no parameters; the Info tab is the one with content for it.
  showInspectorTab('info');
  void window.pulp.markItemUsed(entry.id);
  stageShowMedia(entry);
  // A media item renders itself (milestone 15): the Output tab takes it as it takes a template.
  outputShowMedia(entry);
  renderResults();
}

function select(entry: LibraryEntry): void {
  if (entry.kind === 'media') {
    selectMedia(entry);
    return;
  }
  dispatch((s) => setShown(s, entry.key));
  showInspectorTab('parameters');
  void window.pulp.markItemUsed(entry.id);
  selectedTemplate.value = entry;
  stageShowTemplate(entry, paramsShow(entry), currentLayers(), currentTrack(), currentCaptions(), currentSound());
  outputShow(entry);
  renderResults();
}

// ---------------------------------------------------------------- template packs

/** Words that are not a message — a pack's or a template's own, a path — where a message's stamp may be left from before. */
function sayPlain(el: HTMLElement, text: string): void {
  delete el.dataset.i18n;
  delete el.dataset.i18nValues;
  el.textContent = text;
}

/** A message as an element of its own, bound so a change of language rewrites it. */
function message(id: MessageId, values?: MessageValues): HTMLSpanElement {
  const span = document.createElement('span');
  bindText(span, id, values);
  return span;
}

/** Sentences and words side by side in one element, joined as the line always was. */
function sayParts(el: HTMLElement, parts: readonly (Node | string)[], separator: string): void {
  delete el.dataset.i18n;
  delete el.dataset.i18nValues;
  el.replaceChildren(...parts.flatMap((part, i) => (i === 0 ? [part] : [separator, part])));
}

/** The pack being previewed for import, or the templates being exported. */
let packState: { kind: 'import'; path: string; preview: PackPreview; choices: Record<string, CollisionChoice> } | { kind: 'export'; ids: string[] } | null = null;

function openPackDialog(): void {
  if (!els.packDialog.open) els.packDialog.showModal();
}

/** Preview a pack (zip or folder) and show what installing it would do. */
async function showPackPreview(path: string): Promise<void> {
  const result = await window.pulp.previewPack(path);
  els.packResult.textContent = '';
  els.packExportFields.hidden = true;
  els.packTemplates.replaceChildren();
  els.packLicense.hidden = true;
  if ('error' in result) {
    packState = null;
    bindText(els.packTitle, 'ui.pack-title');
    sayPlain(els.packMeta, path);
    els.packProblems.textContent = result.error;
    els.packConfirm.hidden = true;
    openPackDialog();
    return;
  }
  const { preview } = result;
  packState = { kind: 'import', path, preview, choices: {} };
  const m = preview.manifest;
  if (m) sayPlain(els.packTitle, `${m.name}${m.version ? ` ${m.version}` : ''}`);
  else bindText(els.packTitle, 'ui.pack-title');
  if (m) {
    const parts: (Node | string)[] = [];
    if (m.author) parts.push(message('pack-dialog.meta.author', { author: m.author }));
    parts.push(message('pack-dialog.meta.license', { licenseId: m.license }));
    if (m.description) parts.push(m.description);
    if (path) parts.push(path);
    sayParts(els.packMeta, parts, ' · ');
  } else sayPlain(els.packMeta, path);
  if (preview.licenseWarning) {
    els.packLicense.hidden = false;
    els.packLicense.className = 'note warn';
    bindText(els.packLicense, 'pack-dialog.license-warning', { warning: preview.licenseWarning });
  }
  els.packProblems.textContent = preview.problems.join(' ');
  for (const t of preview.templates) {
    const li = document.createElement('li');
    li.dataset.folder = t.folder;
    const name = document.createElement('span');
    name.textContent = t.manifest ? `${t.manifest.name} (${t.manifest.id})` : t.folder;
    const size = document.createElement('span');
    size.className = 'meta';
    if (t.manifest) bindText(size, 'pack-dialog.template.size-license', { count: t.fileCount, size: formatBytes(t.bytes), licenseId: t.manifest.license });
    else bindText(size, 'pack-dialog.template.size', { count: t.fileCount, size: formatBytes(t.bytes) });
    const status = document.createElement('span');
    status.className = 'status';
    if (t.problems.length > 0) {
      status.classList.add('bad');
      bindText(status, 'pack-dialog.status.cannot-install', { problems: t.problems.join('; ') });
    } else if (t.collision?.where === 'library') {
      status.classList.add('warn');
      bindText(status, 'pack-dialog.status.in-library', { dir: t.collision.dir });
    } else if (t.collision?.where === 'pack') {
      status.classList.add('warn');
      status.replaceChildren(message('pack-dialog.status.from-pack'));
      const choice = document.createElement('select');
      for (const [value, label] of [['skip', 'pack-dialog.collision.keep'], ['replace', 'pack-dialog.collision.replace']] as const) {
        const opt = document.createElement('option');
        opt.value = value;
        bindText(opt, label);
        choice.append(opt);
      }
      choice.addEventListener('change', () => {
        if (packState?.kind === 'import') packState.choices[t.folder] = choice.value as CollisionChoice;
      });
      status.append(choice);
    } else {
      bindText(status, 'pack-dialog.status.will-install', { dir: t.installDir });
    }
    if (t.licenseWarning && t.problems.length === 0) {
      const lic = document.createElement('span');
      lic.className = 'status warn';
      bindText(lic, 'pack-dialog.template-license-warning', { warning: t.licenseWarning });
      li.append(name, size, status, lic);
    } else li.append(name, size, status);
    els.packTemplates.append(li);
  }
  const installable = preview.templates.some((t) => t.problems.length === 0 && (!t.collision || t.collision.where === 'pack'));
  els.packConfirm.hidden = false;
  bindText(els.packConfirm, 'ui.pack-confirm');
  els.packConfirm.disabled = !m || preview.problems.length > 0 || !installable;
  openPackDialog();
}

async function confirmPack(): Promise<void> {
  if (!packState) return;
  els.packConfirm.disabled = true;
  try {
    if (packState.kind === 'import') {
      const result = await window.pulp.installPack(packState.path, packState.choices);
      if ('error' in result) {
        els.packResult.className = 'note error';
        els.packResult.textContent = result.error;
        return;
      }
      els.packResult.className = 'note';
      const said: Node[] = [];
      if (result.installed.length) said.push(message('pack-dialog.result.installed', { names: result.installed.join(', ') }));
      if (result.replaced.length) said.push(message('pack-dialog.result.replaced', { names: result.replaced.join(', ') }));
      if (result.skipped.length) {
        const list = result.skipped.map((s) => t('pack-dialog.result.skipped-item', { folder: s.folder, reason: s.reason })).join('; ');
        said.push(message('pack-dialog.result.skipped', { list }));
      }
      said.push(message('pack-dialog.result.into', { dir: result.packDir }));
      sayParts(els.packResult, said, ' ');
      els.packConfirm.hidden = true;
    } else {
      const result = await window.pulp.exportPack(packState.ids, {
        name: els.packExportName.value.trim() || t('pack-dialog.export.default-name'),
        license: els.packExportLicense.value.trim(),
        ...(els.packExportAuthor.value.trim() ? { author: els.packExportAuthor.value.trim() } : {}),
      });
      els.packResult.className = result.ok || result.cancelled ? 'note' : 'note error';
      // A pack never carries an imported font; a template set in one is named so the warning travels with the file.
      if (result.ok) sayParts(els.packResult, [message('pack-dialog.result.wrote', { path: result.path, size: formatBytes(result.bytes) }), ...result.warnings], ' ');
      else sayPlain(els.packResult, result.cancelled ? '' : result.message);
      if (result.ok) els.packConfirm.hidden = true;
    }
  } finally {
    els.packConfirm.disabled = false;
  }
}

/** Export the templates currently listed (the search result), with a license warning if the chosen license is not open. */
function showExportDialog(): void {
  if (!appState.value.index) return;
  // "Export the listed templates": the same results the user sees, scope and chips included.
  const listed = results.value.entries.filter((e): e is TemplateEntry => e.kind === 'template' && !e.offline);
  if (listed.length === 0) return;
  packState = { kind: 'export', ids: listed.map((t) => t.manifest.id) };
  bindText(els.packTitle, 'pack-dialog.export.title', { count: listed.length });
  bindText(els.packMeta, 'pack-dialog.export.meta');
  els.packLicense.hidden = true;
  els.packProblems.textContent = '';
  els.packResult.textContent = '';
  els.packTemplates.replaceChildren();
  for (const t of listed) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${t.manifest.name} (${t.manifest.id})`;
    const lic = document.createElement('span');
    lic.className = 'meta';
    lic.textContent = `${t.manifest.license}${t.manifest.author ? ` · ${t.manifest.author}` : ''}`;
    li.append(name, lic);
    els.packTemplates.append(li);
  }
  // A pack carries template folders and nothing else. Pictures and clips chosen for these
  // templates live in the library and stay there — an asset is referenced where it lies and is
  // never copied into a pack or an export (milestone 26) — so say it before the file is written.
  const chosen = chosenLibraryItems(listed.map((t) => t.manifest.id));
  if (chosen.length > 0) {
    const items = chosen.reduce((n, c) => n + c.items, 0);
    els.packLicense.hidden = false;
    els.packLicense.className = 'note warn';
    const note = chosen.length === 1
      ? message('pack-dialog.export.media-note.one-template', { count: items })
      : message('pack-dialog.export.media-note.templates', { count: items, templates: chosen.length });
    sayParts(els.packLicense, [note, message('pack-dialog.export.media-note.choose')], ' ');
  }
  els.packExportFields.hidden = false;
  els.packExportName.value = listed.length === 1 ? listed[0]!.manifest.name : '';
  els.packConfirm.hidden = false;
  els.packConfirm.disabled = false;
  bindText(els.packConfirm, 'pack-dialog.export.confirm');
  openPackDialog();
}

// ---------------------------------------------------------------- wiring

els.search.addEventListener('input', renderResults);
// The summary's counts are words: a change of language draws them again (milestone 59).
whenLocaleChanges(paintSummary);
// And the other way: a query cleared from the results' heading (Clear search, milestone 42) or set
// anywhere but the field itself shows in the field, so the two cannot disagree and a later redraw
// cannot put the stale text back.
effect(() => {
  const q = appState.value.query;
  if (els.search.value !== q) els.search.value = q;
});
els.exportPack.addEventListener('click', showExportDialog);
els.packConfirm.addEventListener('click', () => void confirmPack());
els.packClose.addEventListener('click', () => els.packDialog.close());
// For tests and scripting: preview a pack by path without the open dialog.
(window as unknown as { pulpPreviewPack?: (path: string) => Promise<void> }).pulpPreviewPack = showPackPreview;
// What the browse panel's one Add button brings in, and what File → Add runs (milestone 47).
initLibraryAdd({
  addFolder: () => void loadLibrary(window.pulp.addLibraryFolder()),
  // A stock library (milestone 32): added where it is; a refusal is said rather than ignored.
  addStock: () => void loadLibrary(window.pulp.addStockLibrary().then((outcome) => {
    if (!outcome) return null;
    if (!outcome.ok) {
      const { why } = outcome;
      // Said where the window's other messages are: the tray's line, or the strip over the window while it is away.
      sayInTray(t(`library.stock.refused.${why}`));
      return null;
    }
    return outcome.index;
  })),
  // From a disc image (milestone 32): mounted read-only and read; what cannot be mounted is said in the tool's words.
  addStockImage: () => void loadLibrary(window.pulp.addStockLibraryImage().then((outcome) => {
    if (!outcome) return null;
    if (!outcome.ok) {
      sayInTray(outcome.why === 'mount' && outcome.message ? outcome.message : t(`library.stock.refused.${outcome.why}`));
      return null;
    }
    return outcome.index;
  })),
  importPack: () => {
    void window.pulp.choosePackFile().then((path) => {
      if (path) void showPackPreview(path);
    });
  },
  addSampleMedia: () => {
    // Making the folder takes a little while (clips are rendered); Add says so and takes no second press.
    setLibraryAddBusy(true);
    void loadLibrary(
      window.pulp.addSampleMedia().then((outcome) => {
        if (outcome && outcome.failed.length > 0) console.warn(`Sample media: ${outcome.failed.length} file(s) could not be made: ${outcome.failed.join('; ')}`);
        return outcome?.index ?? null;
      }),
    ).finally(() => {
      setLibraryAddBusy(false);
      // Whatever that made, the line under the results stops offering (milestone 34).
      void refreshSampleHint();
    });
  },
});
els.rescan.addEventListener('click', () => void loadLibrary(window.pulp.rescanLibrary()));

/**
 * What an entry is collected with (milestone 33): a template's current
 * parameters; for a layered still browsed with layers hidden, that list, so an
 * unplaced item keeps the picture it was collected as.
 */
function collectedParams(entry: LibraryEntry): Record<string, unknown> {
  if (entry.kind === 'template') return currentRawParams();
  const psd = browsedHiddenChoice(entry);
  return psd ? { psd } : {};
}
window.pulp.onRenderQueue((snapshot) => dispatch((s) => setJobs(s, snapshot)));

// The bundled fonts (ADR 0014), so the family control can show each face in itself.
const fontStyle = document.createElement('style');
fontStyle.dataset.pulpFonts = '';
fontStyle.textContent = fontFaceCss(`${FONT_SCHEME}://`);
document.head.append(fontStyle);
// The person's own fonts too, as the managed folder has them now and whenever it changes.
const importedStyle = document.createElement('style');
importedStyle.dataset.pulpImportedFonts = '';
document.head.append(importedStyle);
effect(() => {
  importedStyle.textContent = importedFontFaceCss(importedFonts.value, `${FONT_SCHEME}://`);
});
void window.pulp.listFonts().then((fonts) => (importedFonts.value = fonts));
window.pulp.onFontsChanged((fonts) => (importedFonts.value = fonts));
mountIcons();
initTooltips();
initShell();
initStage();
initCleanup();
initStabilize();
initInspectorTabs();
initTheater();
initInspectorParams();
// Picking a property on the stage makes it a parameter in the tab (milestone 55): the tab owns the form.
registerExposer(exposeLayerProperty);
// The captions dialog's own wiring (milestone 50): the model ask, the run and its progress.
mountCaptions();
setTemplateShower((templateId) => {
  const entry = appState.value.index?.templates.find((t) => t.manifest.id === templateId);
  if (entry && selectedTemplate.value?.manifest.id !== templateId) select(entry);
});
// A template the canvas just saved (milestone 55): shown once the rescan lands, retried briefly since
// the index arrives as a broadcast after the save answers.
registerSavedTemplateOpener((templateId) => {
  const started = Date.now();
  const show = () => {
    const entry = appState.value.index?.templates.find((t) => t.manifest.id === templateId);
    if (entry) {
      hideStartScreen();
      select(entry);
      return;
    }
    if (Date.now() - started < 5000) setTimeout(show, 200);
  };
  show();
});
// File → New Blank Canvas (milestone 55): the bundled canvas on the stage, the start screen out of the way.
registerBlankCanvasOpener(() => {
  const entry = appState.value.index?.templates.find((t) => t.manifest.id === BLANK_CANVAS_ID);
  if (!entry) return;
  hideStartScreen();
  select(entry);
});
initInspectorOutput();
initGuidedSetup();
initSemantic();
initSearchBar();
initStatusBar();
// The line under the results that says what sample media would add (milestone 34); a run of it
// hands back a bigger library, which goes in the same way a folder added by hand does.
initSampleHint({ onIndex: (index) => void loadLibrary(Promise.resolve(index)) });
initTray((id) => {
  const index = appState.value.index;
  const entry = [...(index?.templates ?? []), ...(index?.media ?? [])].find((e) => e.id === id);
  if (entry) dispatch((s) => setCollection(s, addItem(s.collection, itemFor(entry, currentPresetId(), currentOptions(), collectedParams(entry)))));
});
// The project (milestone 27): the session as a file, with its unsaved changes guarded.
initProject(sayInTray);
initProjectUi();
/** A file the system handed over opens like any other, and opening it is choosing to work, so the start screen goes. */
async function openFromSystem(path: string): Promise<void> {
  if (await openProjectFrom(path)) hideStartScreen();
}
window.pulp.onOpenFile((path) => void openFromSystem(path));
// Pulp's own application menu (milestone 27): it does what the window's own buttons do.
initAppearance();
// The work is tall (milestone 65): a vertical lean, a tall platform, or a tall shape chosen in the
// Output tab puts the templates made for vertical first under the default order.
effect(() => {
  const shown = selectedTemplate.value;
  const tall = workIsTall({
    preferredAspect: preferredAspect.value,
    platformAspect: platformPreset(preferredPlatform.value ?? undefined)?.aspect ?? null,
    shown: shown ? { size: frameSize.value, aspects: shown.manifest.aspects } : null,
  }, appState.peek().tallWork);
  if (tall !== appState.peek().tallWork) dispatch((st) => setTallWork(st, tall));
});
initRecorder();
initCameraRecorder();
// A take the microphone or the camera just saved (milestones 63 and 64): selected once the rescan lands, retried briefly
// since the index arrives as a broadcast after the save answers — as a saved canvas template is.
registerRecordingOpener((id) => {
  const started = Date.now();
  const show = () => {
    const entry = appState.value.index?.media.find((m) => m.id === id);
    if (entry) {
      select(entry);
      showSelectedResult();
      return;
    }
    if (Date.now() - started < 5000) setTimeout(show, 200);
  };
  show();
});
initMenu();
initContextMenu();
// What the window catches goes to Pulp's own log, which never leaves the machine (milestone 8).
initCrashLog();
// The stage in a window of its own (milestone 43): after the stage, the theater and the menus it
// moves with, and out again at launch if it was left out.
initStageWindow();
// The start screen, tour and What's new (milestone 31); File → Home brings the screen back.
initTour();
initWhatsNew();
initSettings();
initUserGuide();
initStartScreen();
void window.pulp.getStartScreenPrefs().then((prefs) => {
  if (prefs.showAtStartup) showStartScreen();
});
mountBrowse($('browse-find'), $('browse-tree'), $<HTMLButtonElement>('browse-filter-toggle'));
void window.pulp.getBrowseAccordion().then((on) => (browseAccordion.value = on));
mountResults(els.results, {
  // Choosing in the results is going back to browsing, so the drawer closes — unless it is pinned
  // for a run of edits (milestone 38).
  onSelect: (entry) => {
    closeInspectorUnlessPinned();
    select(entry);
  },
  onStop: stopPlayback,
});

// The dots on Parameters and Output: the shown item has edits behind that tab (milestone 38).
effect(() => {
  $('tab-parameters').classList.toggle('edited', paramsEdited.value);
});
effect(() => {
  $('tab-output').classList.toggle('edited', outputEdited.value);
});

// Choosing a collection card is choosing to edit it: the drawer opens on Parameters (milestone 38).
{
  let lastEditing: string | null = null;
  effect(() => {
    const uid = appState.value.editing;
    if (uid !== null && uid !== lastEditing) openInspector('parameters');
    lastEditing = uid;
  });
}
// What a chosen category holds, as pictures (milestone 34).
mountCategoryCards($('category-cards'));

// The editor panel's bridge lists the collection as the window holds it (milestone 54), so every
// change is reported — by reference, since an unchanged collection is the same object (core/collection.ts).
{
  let lastCollection: Collection | null = null;
  let lastName: string | null = null;
  effect(() => {
    const { collection, collectionName } = appState.value;
    if (collection === lastCollection && collectionName === lastName) return;
    lastCollection = collection;
    lastName = collectionName;
    void window.pulp.panelCollectionChanged(collection, collectionName);
  });
}
// And the panel asks back (milestone 54's third item): show this item, or open this collection
// card for editing — the very paths a click in the results or the tray takes, so what the
// panel opens is edited with the same controls and the next drop carries the change.
window.pulp.onPanelOpen((target) => {
  hideStartScreen();
  if (target.kind === 'collection') {
    if (appState.value.collection.items.some((i) => i.uid === target.uid)) dispatch((s) => setEditing(s, target.uid));
    return;
  }
  const index = appState.value.index;
  const entry = index ? [...index.templates, ...index.media].find((e) => e.id === target.id) : undefined;
  if (entry) select(entry);
});

// Add to collection: the item on the stage, with whatever the Output tab currently says.
const addToCollection = $<HTMLButtonElement>('add-to-collection');
addToCollection.addEventListener('click', () => {
  const entry = shownEntry(appState.value);
  if (!entry) return;
  dispatch((s) => setCollection(s, addItem(s.collection, itemFor(entry, currentPresetId(), currentOptions(), collectedParams(entry)))));
});
effect(() => {
  addToCollection.disabled = shownEntry(appState.value) === null;
});
mountItemInfo($('item-tools'), { favorite: 'favorite', chips: 'tag-chips', input: 'tag-input' }, false);
mountItemInfo($('info-item'), {}, true, select);
effect(() => {
  els.exportPack.disabled = !results.value.canExportPack;
});
void window.pulp.getRenderQueue().then((snapshot) => dispatch((s) => setJobs(s, snapshot)));
void loadLibrary(window.pulp.getLibrary());
window.pulp.onLibraryChanged((index) => void loadLibrary(Promise.resolve(index)));
/** Where FFmpeg stands, as the status bar and the Output tab read it: at launch, and again
 *  after Settings has fetched one (milestone 17), which is why it is a function with a name. */
function readFfmpeg(): void {
  void window.pulp.ffmpegStatus().then((info) => {
    setFfmpeg(info);
    outputSetFfmpeg(info.ok, info.encoders ?? []);
    // Whether it can convert HDR (milestone 81), for an HDR clip's Range row in the Info tab.
    infoSetFfmpeg(info);
    // What the project needs that this build lacks, said on the Output tab before a render (milestone 88).
    outputSetFfmpegFeatures(info.ok ? info.features ?? [] : []);
  });
}
registerFfmpegRefresh(readFfmpeg);
readFfmpeg();
// For the UI test: what the window has recorded of its own speed (milestone 58).
(window as unknown as { pulpWindowPerformance?: typeof windowPerformance }).pulpWindowPerformance = windowPerformance;
