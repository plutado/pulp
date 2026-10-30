import type { LibraryEntry, LibraryIndex, MediaEntry, TemplateEntry } from '../core/library-types';
import { formatBytes, setCollection, setIndex, setJobs, setQuery, setSelection, setShown, shownEntry } from '../core/app-state';
import { addItem, itemFor } from '../core/collection';
import { appState, dispatch, results, selectedTemplate } from './store';
import { mountResults } from './results';
import { mountCategoryCards } from './category-cards';
import { mountItemInfo } from './item-info';
import { initStage, stageClear, stageShowMedia, stageShowTemplate, stopPlayback } from './stage';
import { initShell } from './shell';
import { initInspectorTabs, showInspectorTab } from './inspector-tabs';
import { chosenLibraryItems, currentLayers, currentRawParams, initInspectorParams, paramsClear, paramsShow } from './inspector-params';
import { currentOptions, currentPresetId, initInspectorOutput, outputClear, outputSetFfmpeg, outputShow, outputShowMedia, setTemplateShower, updateRenderControls } from './inspector-output';
import { browseAccordion, browseFoldToActive, mountBrowse } from './browse';
import { initSearchBar } from './search-bar';
import { initStatusBar, setFfmpeg, setScanning } from './status-bar';
import { initTray, sayInTray } from './tray';
import { initProject } from './project';
import { askAboutRecovery, initProjectUi } from './project-ui';
import { initMenu } from './menu';
import { hideStartScreen, initStartScreen, showStartScreen } from './start-screen';
import { browsedHiddenChoice } from './psd-state';
import { initTour } from './tour';
import { initWhatsNew } from './whats-new';
import { FONT_SCHEME, fontFaceCss, importedFontFaceCss } from '../core/fonts';
import { importedFonts } from './store';
import { mountIcons } from './icons';
import { initTooltips } from './tooltip';
import { effect } from '@preact/signals';
import type { CollisionChoice, PackPreview } from '../core/pack';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  search: $<HTMLInputElement>('search'),
  addFolder: $<HTMLButtonElement>('add-folder'),
  addSampleMedia: $<HTMLButtonElement>('add-sample-media'),
  importPack: $<HTMLButtonElement>('import-pack'),
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
  const index = appState.value.index;
  els.summary.replaceChildren();
  if (!index) return;
  const counts = document.createElement('div');
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  counts.textContent = [
    plural(index.templates.length, 'template'),
    plural(index.media.length, 'media file'),
    plural(index.roots.length, 'folder'),
  ].join(' · ');
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
  dispatch((s) => setIndex(s, index));
  // A session that ended suddenly is offered back once the library is in, since the items it
  // holds mean nothing without one. Recovering it is choosing to work, so the start screen goes.
  if (first) {
    void askAboutRecovery().then((recovered) => {
      if (recovered) hideStartScreen();
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
  stageShowTemplate(entry, paramsShow(entry), currentLayers());
  outputShow(entry);
  renderResults();
}

// ---------------------------------------------------------------- template packs

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
    els.packTitle.textContent = 'Template pack';
    els.packMeta.textContent = path;
    els.packProblems.textContent = result.error;
    els.packConfirm.hidden = true;
    openPackDialog();
    return;
  }
  const { preview } = result;
  packState = { kind: 'import', path, preview, choices: {} };
  const m = preview.manifest;
  els.packTitle.textContent = m ? `${m.name}${m.version ? ` ${m.version}` : ''}` : 'Template pack';
  els.packMeta.textContent = m ? [m.author ? `by ${m.author}` : '', `license ${m.license}`, m.description ?? '', path].filter(Boolean).join(' · ') : path;
  if (preview.licenseWarning) {
    els.packLicense.hidden = false;
    els.packLicense.className = 'note warn';
    els.packLicense.textContent = `Pack license: ${preview.licenseWarning}.`;
  }
  els.packProblems.textContent = preview.problems.join(' ');
  for (const t of preview.templates) {
    const li = document.createElement('li');
    li.dataset.folder = t.folder;
    const name = document.createElement('span');
    name.textContent = t.manifest ? `${t.manifest.name} (${t.manifest.id})` : t.folder;
    const size = document.createElement('span');
    size.className = 'meta';
    size.textContent = `${t.fileCount} files · ${formatBytes(t.bytes)}${t.manifest ? ` · ${t.manifest.license}` : ''}`;
    const status = document.createElement('span');
    status.className = 'status';
    if (t.problems.length > 0) {
      status.classList.add('bad');
      status.textContent = `Cannot install: ${t.problems.join('; ')}`;
    } else if (t.collision?.where === 'library') {
      status.classList.add('warn');
      status.textContent = `Skipped: a template with this id is already in your library (${t.collision.dir}).`;
    } else if (t.collision?.where === 'pack') {
      status.classList.add('warn');
      status.textContent = 'Already installed from a pack. ';
      const choice = document.createElement('select');
      for (const [value, label] of [['skip', 'Keep installed copy'], ['replace', 'Replace with this one']] as const) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        choice.append(opt);
      }
      choice.addEventListener('change', () => {
        if (packState?.kind === 'import') packState.choices[t.folder] = choice.value as CollisionChoice;
      });
      status.append(choice);
    } else {
      status.textContent = `Will install into packs/${t.installDir}.`;
    }
    if (t.licenseWarning && t.problems.length === 0) {
      const lic = document.createElement('span');
      lic.className = 'status warn';
      lic.textContent = `Template license: ${t.licenseWarning}.`;
      li.append(name, size, status, lic);
    } else li.append(name, size, status);
    els.packTemplates.append(li);
  }
  const installable = preview.templates.some((t) => t.problems.length === 0 && (!t.collision || t.collision.where === 'pack'));
  els.packConfirm.hidden = false;
  els.packConfirm.textContent = 'Install';
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
      els.packResult.textContent = [
        result.installed.length ? `Installed: ${result.installed.join(', ')}.` : '',
        result.replaced.length ? `Replaced: ${result.replaced.join(', ')}.` : '',
        result.skipped.length ? `Skipped: ${result.skipped.map((s) => `${s.folder} (${s.reason})`).join('; ')}.` : '',
        `Into ${result.packDir}.`,
      ]
        .filter(Boolean)
        .join(' ');
      els.packConfirm.hidden = true;
    } else {
      const result = await window.pulp.exportPack(packState.ids, {
        name: els.packExportName.value.trim() || 'Pack',
        license: els.packExportLicense.value.trim(),
        ...(els.packExportAuthor.value.trim() ? { author: els.packExportAuthor.value.trim() } : {}),
      });
      els.packResult.className = result.ok || result.cancelled ? 'note' : 'note error';
      // A pack never carries an imported font; a template set in one is named so the warning travels with the file.
      els.packResult.textContent = result.ok ? [`Wrote ${result.path} (${formatBytes(result.bytes)}).`, ...result.warnings].join(' ') : result.cancelled ? '' : result.message;
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
  els.packTitle.textContent = `Export ${listed.length} template${listed.length === 1 ? '' : 's'} as a pack`;
  els.packMeta.textContent = 'A .zip with a pack.json and one folder per template.';
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
    els.packLicense.textContent =
      `${items === 1 ? 'A picture or clip' : `${items} pictures and clips`} chosen for ` +
      `${chosen.length === 1 ? 'one of these templates' : `${chosen.length} of these templates`} ` +
      'will not be in the pack: library media stays in your library, as an imported font does. ' +
      'Whoever installs the pack chooses their own.';
  }
  els.packExportFields.hidden = false;
  els.packExportName.value = listed.length === 1 ? listed[0]!.manifest.name : '';
  els.packConfirm.hidden = false;
  els.packConfirm.disabled = false;
  els.packConfirm.textContent = 'Export…';
  openPackDialog();
}

// ---------------------------------------------------------------- wiring

els.search.addEventListener('input', renderResults);
els.importPack.addEventListener('click', () => {
  void window.pulp.choosePackFile().then((path) => {
    if (path) void showPackPreview(path);
  });
});
els.exportPack.addEventListener('click', showExportDialog);
els.packConfirm.addEventListener('click', () => void confirmPack());
els.packClose.addEventListener('click', () => els.packDialog.close());
// For tests and scripting: preview a pack by path without the open dialog.
(window as unknown as { pulpPreviewPack?: (path: string) => Promise<void> }).pulpPreviewPack = showPackPreview;
els.addFolder.addEventListener('click', () => void loadLibrary(window.pulp.addLibraryFolder()));
els.addSampleMedia.addEventListener('click', () => {
  // Making the folder takes a little while (clips are rendered); the button says so and takes no second click.
  els.addSampleMedia.disabled = true;
  els.addSampleMedia.setAttribute('aria-busy', 'true');
  void loadLibrary(
    window.pulp.addSampleMedia().then((outcome) => {
      if (outcome && outcome.failed.length > 0) console.warn(`Sample media: ${outcome.failed.length} file(s) could not be made: ${outcome.failed.join('; ')}`);
      return outcome?.index ?? null;
    }),
  ).finally(() => {
      els.addSampleMedia.disabled = false;
      els.addSampleMedia.removeAttribute('aria-busy');
    });
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
initInspectorTabs();
initInspectorParams();
setTemplateShower((templateId) => {
  const entry = appState.value.index?.templates.find((t) => t.manifest.id === templateId);
  if (entry && selectedTemplate.value?.manifest.id !== templateId) select(entry);
});
initInspectorOutput();
initSearchBar();
initStatusBar();
initTray((id) => {
  const index = appState.value.index;
  const entry = [...(index?.templates ?? []), ...(index?.media ?? [])].find((e) => e.id === id);
  if (entry) dispatch((s) => setCollection(s, addItem(s.collection, itemFor(entry, currentPresetId(), currentOptions(), collectedParams(entry)))));
});
// The project (milestone 27): the session as a file, with its unsaved changes guarded.
initProject(sayInTray);
initProjectUi();
// Pulp's own application menu (milestone 27): it does what the window's own buttons do.
initMenu();
// The start screen, tour and What's new (milestone 31); File → Home brings the screen back.
initTour();
initWhatsNew();
initStartScreen();
void window.pulp.getStartScreenPrefs().then((prefs) => {
  if (prefs.showAtStartup) showStartScreen();
});
mountBrowse($('browse-find'), $('browse-tree'));
void window.pulp.getBrowseAccordion().then((on) => (browseAccordion.value = on));
mountResults(els.results, { onSelect: select, onStop: stopPlayback });
// What a chosen category holds, as pictures (milestone 34).
mountCategoryCards($('category-cards'));

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
void window.pulp.ffmpegStatus().then((info) => {
  setFfmpeg(info);
  outputSetFfmpeg(info.ok, info.encoders ?? []);
});
