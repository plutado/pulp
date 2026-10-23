import type { LibraryEntry, LibraryIndex, MediaEntry, TemplateEntry } from '../core/library-types';
import { describeMeta, formatBytes, setDrag, setIndex, setJobs, setQuery, setSelection } from '../core/app-state';
import { appState, dispatch, renderBlocked, results } from './store';
import { mountResults } from './results';
import { initShell } from './shell';
import { initInspectorTabs, showInspectorTab } from './inspector-tabs';
import { mountBrowse } from './browse';
import { initSearchBar } from './search-bar';
import { initStatusBar, setScanning } from './status-bar';
import { initTray } from './tray';
import { effect } from '@preact/signals';
import { frameCount, type TemplateParameter } from '../core/manifest';
import { resolveParams, type ResolvedParams } from '../core/params';
import { alphaToPercent, joinColor, parseColorText, percentToAlpha, splitColor, toCssRgba } from '../core/color';
import { presetUnavailableReason } from '../core/ffmpeg-presets';
import { History } from '../core/history';
import { planBatch, type BatchPlan } from '../core/batch-csv';
import { applyPreset, diffFromDefaults } from '../core/param-presets';
import type { CollisionChoice, PackPreview } from '../core/pack';
import { addRecentColor } from '../core/recent-colors';
import { OUTPUT_PRESETS, PRESET_IDS, RenderPlanError, resolveTiming, type PresetId, type RenderOptions } from '../core/render-plan';
import { frameState } from '../core/runtime';
import { formatTimecode, parseTimecode, STANDARD_FRAME_RATES, TimecodeError, timecodePattern } from '../core/timecode';
import { mediaUrlFor, templateUrlFor } from '../shared/api';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  search: $<HTMLInputElement>('search'),
  addFolder: $<HTMLButtonElement>('add-folder'),
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
  previewFrame: $<HTMLDivElement>('preview-frame'),
  preview: $<HTMLIFrameElement>('preview'),
  previewEmpty: $<HTMLDivElement>('preview-empty'),
  mediaVideo: $<HTMLVideoElement>('media-video'),
  mediaImage: $<HTMLImageElement>('media-image'),
  mediaAudio: $<HTMLAudioElement>('media-audio'),
  play: $<HTMLButtonElement>('play'),
  scrub: $<HTMLInputElement>('scrub'),
  timecode: $<HTMLSpanElement>('timecode'),
  details: $<HTMLDivElement>('details'),
  itemTools: $<HTMLDivElement>('item-tools'),
  favorite: $<HTMLButtonElement>('favorite'),
  tagChips: $<HTMLDivElement>('tag-chips'),
  tagInput: $<HTMLInputElement>('tag-input'),
  infoTools: $<HTMLDivElement>('info-tools'),
  infoFavorite: $<HTMLButtonElement>('info-favorite'),
  infoTagChips: $<HTMLDivElement>('info-tag-chips'),
  infoTagInput: $<HTMLInputElement>('info-tag-input'),
  params: $<HTMLFormElement>('params'),
  presetList: $<HTMLSelectElement>('param-preset-list'),
  presetName: $<HTMLInputElement>('param-preset-name'),
  presetSave: $<HTMLButtonElement>('param-preset-save'),
  presetDelete: $<HTMLButtonElement>('param-preset-delete'),
  presetConfirm: $<HTMLDivElement>('param-preset-confirm'),
  presetConfirmText: $<HTMLSpanElement>('param-preset-confirm-text'),
  presetReplace: $<HTMLButtonElement>('param-preset-replace'),
  presetCancel: $<HTMLButtonElement>('param-preset-cancel'),
  batchCsv: $<HTMLTextAreaElement>('batch-csv'),
  batchFile: $<HTMLButtonElement>('batch-file'),
  batchFileInput: $<HTMLInputElement>('batch-file-input'),
  batchPreview: $<HTMLButtonElement>('batch-preview'),
  batchQueue: $<HTMLButtonElement>('batch-queue'),
  batchSummary: $<HTMLDivElement>('batch-summary'),
  undo: $<HTMLButtonElement>('undo'),
  redo: $<HTMLButtonElement>('redo'),
  resetAll: $<HTMLButtonElement>('reset-all'),
  preset: $<HTMLSelectElement>('preset'),
  presetNote: $<HTMLParagraphElement>('preset-note'),
  presetUnavailable: $<HTMLParagraphElement>('preset-unavailable'),
  optFps: $<HTMLSelectElement>('opt-fps'),
  optBackgroundField: $<HTMLLabelElement>('opt-background-field'),
  optBackground: $<HTMLInputElement>('opt-background'),
  optIn: $<HTMLInputElement>('opt-in'),
  optOut: $<HTMLInputElement>('opt-out'),
  optionsNote: $<HTMLParagraphElement>('options-note'),
  render: $<HTMLButtonElement>('render'),
  renderStatus: $<HTMLParagraphElement>('render-status'),
  ffmpegStatus: $<HTMLParagraphElement>('ffmpeg-status'),
};

interface State {
  index: LibraryIndex | null;
  selected: TemplateEntry | null;
  rawParams: Record<string, unknown>;
  params: ResolvedParams;
  frame: number;
  playing: boolean;
  previewReady: boolean;
  inFlight: boolean;
  pendingFrame: number | null;
  ffmpegOk: boolean;
  /** Recently used colors, shared across templates, most recent first. */
  recentColors: string[];
  /** The library item shown in the stage (template or media), for tags and favorite. */
  shown: LibraryEntry | null;
  /** Saved presets of the selected template, name to stored values. */
  presets: Record<string, Record<string, unknown>>;
  /** The last previewed batch, ready to queue. */
  batch: BatchPlan | null;
  /** Waiting for the save dialog after a click on Render. */
  choosingOutput: boolean;
  /** False while the frame rate or trim fields hold something the planner rejects. */
  optionsValid: boolean;
}

const state: State = {
  index: null,
  selected: null,
  rawParams: {},
  params: {},
  frame: 0,
  playing: false,
  previewReady: false,
  inFlight: false,
  pendingFrame: null,
  ffmpegOk: false,
  recentColors: [],
  shown: null,
  presets: {},
  batch: null,
  choosingOutput: false,
  optionsValid: true,
};

// ---------------------------------------------------------------- library

/** Pushes index, query and selection into the shared state (the Results component renders the list from it) and redraws the summary. */
function renderResults(): void {
  dispatch((s) => setSelection(setQuery(setIndex(s, state.index), els.search.value), state.selected?.key ?? null));
  const index = state.index;
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
    div.title = p.issues?.map((i) => `${i.path}: ${i.message}`).join('\n') ?? '';
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
  state.index = index;
  if (state.selected) {
    const still = index.templates.find((t) => t.manifest.id === state.selected?.manifest.id);
    if (!still) clearSelection();
  }
  if (state.shown) {
    const fresh = [...index.templates, ...index.media].find((e) => e.id === state.shown?.id);
    if (fresh) showItemTools(fresh);
  }
  renderResults();
}

// ---------------------------------------------------------------- selection + params

/** Favorite button and tag chips for the item shown in the stage. User tags can be removed; folder and manifest tags cannot. */
/** The stage strip and the Info tab show the same favorite and tags; one renderer serves both. */
function itemToolGroups(): { tools: HTMLDivElement; favorite: HTMLButtonElement; chips: HTMLDivElement; input: HTMLInputElement }[] {
  return [
    { tools: els.itemTools, favorite: els.favorite, chips: els.tagChips, input: els.tagInput },
    { tools: els.infoTools, favorite: els.infoFavorite, chips: els.infoTagChips, input: els.infoTagInput },
  ];
}

function showItemTools(entry: LibraryEntry | null): void {
  state.shown = entry;
  for (const group of itemToolGroups()) {
    group.tools.hidden = entry === null;
    if (!entry) continue;
    group.favorite.setAttribute('aria-pressed', String(entry.favorite === true));
    group.favorite.textContent = entry.favorite ? '★' : '☆';
    group.chips.replaceChildren();
    const user = new Set(entry.userTags ?? []);
    for (const tag of entry.tags) {
      const chip = document.createElement('span');
      chip.className = user.has(tag) ? 'tag-chip user' : 'tag-chip folder';
      chip.dataset.tag = tag;
      chip.textContent = tag;
      chip.title = user.has(tag) ? 'Your tag' : 'From the folder or manifest';
      if (user.has(tag)) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = `Remove ${tag}`;
        remove.addEventListener('click', () => void window.pulp.setItemTags(entry.id, (entry.userTags ?? []).filter((t) => t !== tag)));
        chip.append(remove);
      }
      group.chips.append(chip);
    }
    group.input.value = '';
  }
}

/** Stop and hide the media preview elements. */
function clearMediaPreview(): void {
  for (const el of [els.mediaVideo, els.mediaAudio]) {
    el.pause();
    el.removeAttribute('src');
    el.load();
    el.hidden = true;
  }
  els.mediaImage.removeAttribute('src');
  els.mediaImage.hidden = true;
}

function clearSelection(): void {
  state.selected = null;
  state.previewReady = false;
  stop();
  els.preview.removeAttribute('src');
  clearMediaPreview();
  showItemTools(null);
  els.previewEmpty.textContent = 'Select a template';
  els.previewEmpty.hidden = false;
  els.params.replaceChildren();
  els.details.textContent = '';
  updateControls();
}

/** Show a media item in the stage, served by id through pulp-media://. */
function selectMedia(entry: MediaEntry): void {
  clearSelection();
  showItemTools(entry);
  // A media item has no parameters; the Info tab is the one with content for it.
  showInspectorTab('info');
  void window.pulp.markItemUsed(entry.id);
  els.previewFrame.classList.add('checker');
  els.details.textContent = [`${entry.mediaKind} · ${entry.ext.slice(1)} · ${formatBytes(entry.size)}`, describeMeta(entry), entry.path].filter(Boolean).join(' · ');
  if (entry.offline) {
    els.previewEmpty.textContent = 'This file\'s folder is offline.';
    renderResults();
    return;
  }
  els.previewEmpty.hidden = true;
  const url = mediaUrlFor(entry.id);
  const fit = (w: number, h: number) => {
    if (w > 0 && h > 0) els.previewFrame.style.aspectRatio = `${w} / ${h}`;
  };
  if (entry.mediaKind === 'video') {
    els.mediaVideo.hidden = false;
    els.mediaVideo.onloadedmetadata = () => fit(els.mediaVideo.videoWidth, els.mediaVideo.videoHeight);
    els.mediaVideo.src = url;
  } else if (entry.mediaKind === 'image') {
    els.mediaImage.hidden = false;
    els.mediaImage.onload = () => fit(els.mediaImage.naturalWidth, els.mediaImage.naturalHeight);
    els.mediaImage.src = url;
  } else {
    els.previewFrame.style.aspectRatio = '16 / 9';
    els.mediaAudio.hidden = false;
    els.mediaAudio.src = url;
  }
  renderResults();
}

function select(entry: LibraryEntry): void {
  if (entry.kind === 'media') {
    selectMedia(entry);
    return;
  }
  stop();
  clearMediaPreview();
  showItemTools(entry);
  showInspectorTab('parameters');
  void window.pulp.markItemUsed(entry.id);
  state.selected = entry;
  // Each template keeps its own edits and undo history while the app runs.
  state.rawParams = { ...editorFor(entry.manifest.id).current };
  state.params = resolveParams(entry.manifest, state.rawParams).values;
  // Start at mid-progress, the frame the thumbnails use: a transition's first frame is blank.
  state.frame = Math.floor(frameCount(entry.manifest) / 2);
  state.previewReady = false;

  const m = entry.manifest;
  els.previewFrame.style.aspectRatio = `${m.width} / ${m.height}`;
  els.previewFrame.classList.toggle('checker', m.alpha);
  if (entry.offline) {
    // The folder is not reachable; keep the item (and its edits) but do not try to load it.
    els.preview.removeAttribute('src');
    els.previewEmpty.textContent = 'This template\'s folder is offline. It will load again when the folder is back.';
    els.previewEmpty.hidden = false;
  } else {
    els.previewEmpty.hidden = true;
    els.preview.src = templateUrlFor(m.id, m.entry);
  }
  els.scrub.max = String(frameCount(m) - 1);
  els.scrub.value = String(state.frame);
  // The frame rate list offers the template's own rate first; in/out points from the previous
  // template would not fit, so they are cleared.
  els.optFps.options[0]!.textContent = `Template rate (${m.fps} fps)`;
  els.optFps.value = '';
  els.optIn.value = '';
  els.optOut.value = '';
  updateOptionsNote();
  els.details.textContent = [m.description, `License: ${m.license}`, m.author ? `Author: ${m.author}` : '']
    .filter(Boolean)
    .join('  ·  ');

  buildParamForm(m.parameters);
  state.presets = {};
  showPresets();
  void window.pulp.listPresets(m.id).then((presets) => {
    if (state.selected?.manifest.id === m.id) {
      state.presets = presets;
      showPresets();
    }
  });
  state.batch = null;
  els.batchSummary.textContent = '';
  els.batchQueue.disabled = true;
  // A file prepared for another template must not be dragged under this one's name.
  const drag = appState.value.drag;
  if (drag && 'file' in drag && drag.templateId !== m.id) dispatch((s) => setDrag(s, null));
  updateControls();
  renderResults();
}

// ---------------------------------------------------------------- saved presets

function showPresets(): void {
  const current = els.presetList.value;
  els.presetList.replaceChildren();
  const head = document.createElement('option');
  head.value = '';
  head.textContent = Object.keys(state.presets).length ? 'Saved presets…' : 'No saved presets';
  els.presetList.append(head);
  for (const name of Object.keys(state.presets).sort((a, b) => a.localeCompare(b))) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    els.presetList.append(opt);
  }
  els.presetList.value = current in state.presets ? current : '';
  els.presetConfirm.hidden = true;
  updatePresetButtons();
}

function updatePresetButtons(): void {
  els.presetSave.disabled = !state.selected || els.presetName.value.trim() === '';
  els.presetDelete.disabled = !state.selected || els.presetList.value === '';
}

/** Store the values that differ from the defaults under the name; ask first if the name is taken. */
async function savePresetAs(name: string, replace: boolean): Promise<void> {
  if (!state.selected) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  if (trimmed in state.presets && !replace) {
    els.presetConfirmText.textContent = `Replace the preset "${trimmed}" with the current values?`;
    els.presetConfirm.hidden = false;
    return;
  }
  els.presetConfirm.hidden = true;
  const values = diffFromDefaults(state.selected.manifest, state.rawParams);
  state.presets = await window.pulp.savePreset(state.selected.manifest.id, trimmed, values);
  els.presetName.value = '';
  showPresets();
  els.presetList.value = trimmed;
  updatePresetButtons();
}

/** Apply a saved preset as one undoable step; parameters the template no longer has are dropped quietly. */
function applySavedPreset(name: string): void {
  if (!state.selected || !(name in state.presets)) return;
  commitParams();
  applySnapshot(applyPreset(state.selected.manifest, state.presets[name]!), true);
  updateResetButtons();
}

// ---------------------------------------------------------------- batch from CSV

function previewBatch(): void {
  if (!state.selected) return;
  const plan = planBatch(state.selected.manifest, els.batchCsv.value);
  state.batch = plan;
  els.batchSummary.replaceChildren();
  const lines: { text: string; warning?: boolean }[] = [];
  if (plan.rows.length > 0) {
    lines.push({ text: `${plan.rows.length} row${plan.rows.length === 1 ? '' : 's'}, columns: ${plan.columns.map((c) => `${c.header} → ${c.paramId}`).join(', ') || 'none'}${plan.nameColumn ? `; names from "${plan.nameColumn}"` : ''}.` });
    lines.push({ text: `Files: ${plan.rows.slice(0, 5).map((r) => r.fileName).join(', ')}${plan.rows.length > 5 ? ', …' : ''}` });
  }
  for (const w of plan.warnings) lines.push({ text: w, warning: true });
  for (const line of lines) {
    const div = document.createElement('div');
    if (line.warning) div.className = 'warning';
    div.textContent = line.text;
    els.batchSummary.append(div);
  }
  els.batchQueue.textContent = plan.rows.length > 0 ? `Queue ${plan.rows.length} render${plan.rows.length === 1 ? '' : 's'}` : 'Queue';
  els.batchQueue.disabled = plan.rows.length === 0 || plan.columns.length === 0 || !state.ffmpegOk || !state.optionsValid;
}

async function queueBatch(): Promise<void> {
  if (!state.selected || !state.batch || state.batch.rows.length === 0) return;
  els.batchQueue.disabled = true;
  try {
    const result = await window.pulp.renderBatch({
      templateId: state.selected.manifest.id,
      presetId: els.preset.value as PresetId,
      options: readRenderOptions(),
      rows: state.batch.rows.map((r) => ({ label: r.label, fileName: r.fileName, params: r.params })),
    });
    const div = document.createElement('div');
    if (result.ok) div.textContent = `Queued ${result.jobIds.length} renders into ${result.folder}.`;
    else {
      div.className = result.cancelled ? '' : 'warning';
      div.textContent = result.cancelled ? '' : result.message;
    }
    els.batchSummary.append(div);
  } finally {
    els.batchQueue.disabled = false;
  }
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
      els.packResult.textContent = result.ok ? `Wrote ${result.path} (${formatBytes(result.bytes)}).` : result.cancelled ? '' : result.message;
      if (result.ok) els.packConfirm.hidden = true;
    }
  } finally {
    els.packConfirm.disabled = false;
  }
}

/** Export the templates currently listed (the search result), with a license warning if the chosen license is not open. */
function showExportDialog(): void {
  if (!state.index) return;
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
  els.packExportFields.hidden = false;
  els.packExportName.value = listed.length === 1 ? listed[0]!.manifest.name : '';
  els.packConfirm.hidden = false;
  els.packConfirm.disabled = false;
  els.packConfirm.textContent = 'Export…';
  openPackDialog();
}

// ---------------------------------------------------------------- edits, undo, reset

type Snapshot = Record<string, unknown>;

/** Edits and undo history of one template, kept for the session; undo acts only on the selected template. */
interface Editor {
  history: History<Snapshot>;
  /** Last state recorded in history (what an edit replaces). */
  committed: Snapshot;
  /** Live state, restored when the template is selected again. */
  current: Snapshot;
}

const editors = new Map<string, Editor>();

function editorFor(templateId: string): Editor {
  let editor = editors.get(templateId);
  if (!editor) {
    editor = { history: new History<Snapshot>(), committed: {}, current: {} };
    editors.set(templateId, editor);
  }
  return editor;
}

const sameSnapshot = (a: Snapshot, b: Snapshot): boolean => JSON.stringify(a) === JSON.stringify(b);

let commitTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Record the current parameters as one history step if they changed since
 * the last step. Typing is coalesced: live edits schedule this with a delay,
 * and a field's change event (blur, slider release) runs it at once.
 */
function commitParams(): void {
  clearTimeout(commitTimer);
  commitTimer = undefined;
  if (!state.selected) return;
  const editor = editorFor(state.selected.manifest.id);
  if (!sameSnapshot(editor.committed, state.rawParams)) {
    editor.history.push(editor.committed);
    editor.committed = { ...state.rawParams };
  }
  updateHistoryButtons();
}

function scheduleCommit(): void {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(commitParams, 400);
}

/** Apply a live edit: resolve, redraw the preview, and schedule a history step. */
function setParam(id: string, value: unknown): void {
  if (!state.selected) return;
  state.rawParams[id] = value;
  editorFor(state.selected.manifest.id).current = state.rawParams;
  state.params = resolveParams(state.selected.manifest, state.rawParams).values;
  requestFrame(state.frame);
  scheduleCommit();
  updateResetButtons();
}

/** Replace all parameters (undo, redo, reset) and rebuild the form to match. */
function applySnapshot(snapshot: Snapshot, record: boolean): void {
  if (!state.selected) return;
  const editor = editorFor(state.selected.manifest.id);
  clearTimeout(commitTimer);
  commitTimer = undefined;
  state.rawParams = { ...snapshot };
  editor.current = state.rawParams;
  if (record) {
    if (!sameSnapshot(editor.committed, state.rawParams)) editor.history.push(editor.committed);
  }
  editor.committed = { ...state.rawParams };
  state.params = resolveParams(state.selected.manifest, state.rawParams).values;
  buildParamForm(state.selected.manifest.parameters);
  requestFrame(state.frame);
  updateHistoryButtons();
}

function undo(): void {
  if (!state.selected) return;
  commitParams(); // a pending typed edit becomes its own step first
  const editor = editorFor(state.selected.manifest.id);
  const previous = editor.history.undo(editor.committed);
  if (previous) applySnapshot(previous, false);
}

function redo(): void {
  if (!state.selected) return;
  const editor = editorFor(state.selected.manifest.id);
  const next = editor.history.redo(editor.committed);
  if (next) applySnapshot(next, false);
}

function resetParam(id: string): void {
  commitParams();
  const next = { ...state.rawParams };
  delete next[id];
  applySnapshot(next, true);
}

function resetAll(): void {
  commitParams();
  applySnapshot({}, true);
}

function updateHistoryButtons(): void {
  const editor = state.selected ? editorFor(state.selected.manifest.id) : null;
  els.undo.disabled = !editor?.history.canUndo;
  els.redo.disabled = !editor?.history.canRedo;
  els.resetAll.disabled = !state.selected || Object.keys(state.rawParams).length === 0;
}

/** Show the per-field reset only where the value differs from the default. */
function updateResetButtons(): void {
  for (const button of els.params.querySelectorAll<HTMLButtonElement>('.field-reset')) {
    button.hidden = !(button.dataset.param! in state.rawParams);
  }
  els.resetAll.disabled = !state.selected || Object.keys(state.rawParams).length === 0;
}

/** True while the keyboard focus is in a field with its own text undo. */
function isTextEditing(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return ['text', 'number', 'search', 'url', 'email', 'password'].includes(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

// ---------------------------------------------------------------- parameter controls

/** A number control: slider plus direct entry when the parameter has a range, direct entry alone otherwise. */
function numberField(param: Extract<TemplateParameter, { type: 'number' }>, value: number, onChange: (v: unknown) => void): HTMLElement {
  const entry = document.createElement('input');
  entry.type = 'number';
  entry.value = String(value);
  if (param.min !== undefined) entry.min = String(param.min);
  if (param.max !== undefined) entry.max = String(param.max);
  if (param.step !== undefined) entry.step = String(param.step);
  if (param.min === undefined || param.max === undefined) {
    entry.addEventListener('input', () => onChange(entry.value));
    entry.addEventListener('change', commitParams);
    return entry;
  }
  const wrap = document.createElement('div');
  wrap.className = 'number-field';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(param.min);
  slider.max = String(param.max);
  // Without a declared step, 100 positions across the range.
  slider.step = String(param.step ?? (param.max - param.min) / 100);
  slider.value = String(value);
  slider.addEventListener('input', () => {
    entry.value = slider.value;
    onChange(slider.value);
  });
  slider.addEventListener('change', commitParams);
  entry.addEventListener('input', () => {
    if (entry.value.trim() !== '') slider.value = entry.value;
    onChange(entry.value);
  });
  entry.addEventListener('change', commitParams);
  wrap.append(slider, entry);
  return wrap;
}

/** A text control; with a maxLength, a live character counter. */
function textField(param: Extract<TemplateParameter, { type: 'text' }>, value: string, onChange: (v: unknown) => void): HTMLElement {
  const el = param.multiline ? document.createElement('textarea') : document.createElement('input');
  if (el instanceof HTMLInputElement) el.type = 'text';
  el.value = value;
  el.addEventListener('change', commitParams);
  if (!param.maxLength) {
    el.addEventListener('input', () => onChange(el.value));
    return el;
  }
  el.maxLength = param.maxLength;
  const wrap = document.createElement('div');
  wrap.className = 'text-field';
  const counter = document.createElement('span');
  counter.className = 'counter';
  const show = () => {
    counter.textContent = `${el.value.length}/${param.maxLength}`;
    counter.classList.toggle('full', el.value.length >= param.maxLength!);
  };
  el.addEventListener('input', () => {
    show();
    onChange(el.value);
  });
  show();
  wrap.append(el, counter);
  return wrap;
}

function inputFor(param: TemplateParameter): HTMLElement {
  const value = state.params[param.id];
  const onChange = (v: unknown) => setParam(param.id, v);

  switch (param.type) {
    case 'text':
      return textField(param, String(value), onChange);
    case 'color':
      return colorField(String(value), onChange);
    case 'number':
      return numberField(param, Number(value), onChange);
    case 'boolean': {
      const el = document.createElement('input');
      el.type = 'checkbox';
      el.checked = Boolean(value);
      el.addEventListener('change', () => {
        onChange(el.checked);
        commitParams();
      });
      return el;
    }
    case 'select':
    case 'font': {
      const options =
        param.type === 'select'
          ? param.options
          : (param.options ?? [param.default]).map((f) => ({ value: f, label: f.split(',')[0] ?? f }));
      const el = document.createElement('select');
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        el.append(opt);
      }
      el.value = String(value);
      el.addEventListener('change', () => {
        onChange(el.value);
        commitParams();
      });
      return el;
    }
  }
}

/**
 * Color control with alpha. The native color input only holds `#rrggbb`, so it
 * edits the RGB part, a slider edits the alpha as a percentage, and a text
 * field shows and accepts the whole `#rrggbb[aa]` value. A swatch over a
 * checkerboard previews the result.
 */
/** Every color field's recent-colors row, refreshed when the list changes. */
const recentRows = new Set<(colors: string[]) => void>();

function setRecentColors(colors: string[]): void {
  state.recentColors = colors;
  for (const refresh of recentRows) refresh(colors);
}

/** Remember a committed color: locally at once, then as the main process stored it. */
function rememberColor(hex: string): void {
  setRecentColors(addRecentColor(state.recentColors, hex));
  void window.pulp.addRecentColor(hex).then(setRecentColors);
}

function colorField(initial: string, onChange: (hex: string) => void): HTMLElement {
  let { rgb, alpha } = splitColor(initial);
  const field = document.createElement('div');
  field.className = 'color-field';
  const swatch = document.createElement('span');
  swatch.className = 'swatch checker';
  const fill = document.createElement('span');
  fill.className = 'swatch-fill';
  swatch.append(fill);
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.title = 'Color';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.className = 'alpha';
  slider.title = 'Alpha';
  const percent = document.createElement('span');
  percent.className = 'alpha-value';
  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'hex';
  text.spellcheck = false;
  text.title = '#RRGGBB or #RRGGBBAA';

  const show = () => {
    const hex = joinColor(rgb, alpha);
    fill.style.background = toCssRgba(hex);
    picker.value = rgb;
    slider.value = String(alphaToPercent(alpha));
    percent.textContent = `${alphaToPercent(alpha)}%`;
    text.value = hex;
    text.classList.remove('error');
  };
  const apply = () => {
    show();
    onChange(joinColor(rgb, alpha));
  };
  /** A finished edit: one history step and a recent color. */
  const commit = () => {
    commitParams();
    rememberColor(joinColor(rgb, alpha));
  };
  picker.addEventListener('input', () => {
    rgb = picker.value;
    apply();
  });
  picker.addEventListener('change', commit);
  slider.addEventListener('input', () => {
    alpha = percentToAlpha(Number(slider.value));
    apply();
  });
  slider.addEventListener('change', commit);
  text.addEventListener('change', () => {
    const parsed = parseColorText(text.value);
    if (!parsed) {
      text.classList.add('error');
      return;
    }
    ({ rgb, alpha } = splitColor(parsed));
    apply();
    commit();
  });

  // Recent colors, shared across templates: click one to use it here.
  const recent = document.createElement('div');
  recent.className = 'recent-colors';
  const refresh = (colors: string[]) => {
    recent.replaceChildren();
    recent.hidden = colors.length === 0;
    for (const hex of colors) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recent-swatch checker';
      button.title = hex;
      button.dataset.color = hex;
      const fillSpan = document.createElement('span');
      fillSpan.className = 'swatch-fill';
      fillSpan.style.background = toCssRgba(hex);
      button.append(fillSpan);
      button.addEventListener('click', () => {
        ({ rgb, alpha } = splitColor(hex));
        apply();
        commit();
      });
      recent.append(button);
    }
  };
  recentRows.add(refresh);
  refresh(state.recentColors);

  show();
  field.append(swatch, picker, slider, percent, text, recent);
  return field;
}

function buildParamForm(parameters: TemplateParameter[]): void {
  els.params.replaceChildren();
  recentRows.clear();
  if (parameters.length === 0) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'This template has no editable parameters.';
    els.params.append(p);
    return;
  }
  let group: string | undefined;
  for (const param of parameters) {
    if (param.group && param.group !== group) {
      const g = document.createElement('div');
      g.className = 'group-label';
      g.textContent = param.group;
      els.params.append(g);
    }
    group = param.group;
    const label = document.createElement('label');
    label.className = param.type === 'boolean' ? 'field inline' : 'field';
    label.dataset.param = param.id;
    const span = document.createElement('span');
    span.textContent = param.label;
    if (param.description) label.title = param.description;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'field-reset';
    reset.dataset.param = param.id;
    reset.textContent = 'Reset';
    reset.title = `Reset ${param.label} to its default`;
    reset.hidden = !(param.id in state.rawParams);
    reset.addEventListener('click', (e) => {
      e.preventDefault();
      resetParam(param.id);
    });
    const input = inputFor(param);
    if (param.type === 'boolean') {
      label.append(input, span, reset);
    } else {
      const head = document.createElement('div');
      head.className = 'field-head';
      head.append(span, reset);
      label.append(head, input);
    }
    els.params.append(label);
  }
  updateHistoryButtons();
}

// ---------------------------------------------------------------- preview

function postFrame(frame: number): void {
  const win = els.preview.contentWindow;
  if (!win || !state.selected) return;
  state.inFlight = true;
  const fs = frameState(state.selected.manifest, frame, state.params);
  win.postMessage({ type: 'pulp:render', id: frame, state: fs }, '*');
  updateTimecode(frame);
}

/** Only one frame is in flight at a time; newer requests replace queued ones. */
function requestFrame(frame: number): void {
  state.frame = frame;
  if (!state.previewReady) return;
  if (state.inFlight) {
    state.pendingFrame = frame;
    return;
  }
  postFrame(frame);
}

window.addEventListener('message', (event) => {
  if (event.source !== els.preview.contentWindow) return;
  const data = event.data as { type?: string; message?: string };
  if (data?.type === 'pulp:ready') {
    state.previewReady = true;
    state.inFlight = false;
    requestFrame(state.frame);
    updateControls();
  } else if (data?.type === 'pulp:rendered' || data?.type === 'pulp:error') {
    state.inFlight = false;
    if (data.type === 'pulp:error') els.details.textContent = `Template error: ${data.message ?? 'unknown'}`;
    if (state.pendingFrame !== null) {
      const next = state.pendingFrame;
      state.pendingFrame = null;
      postFrame(next);
    }
  }
});

function updateTimecode(frame: number): void {
  const m = state.selected?.manifest;
  if (!m) {
    els.timecode.textContent = '--';
    return;
  }
  els.scrub.value = String(frame);
  els.timecode.textContent = `${formatTimecode(frame, m.fps)} · ${frame + 1}/${frameCount(m)}`;
}

let rafId = 0;
let playStart = 0;
let playStartFrame = 0;

function tick(now: number): void {
  const m = state.selected?.manifest;
  if (!state.playing || !m) return;
  const total = frameCount(m);
  const frame = (playStartFrame + Math.floor(((now - playStart) / 1000) * m.fps)) % total;
  if (frame !== state.frame) requestFrame(frame);
  rafId = requestAnimationFrame(tick);
}

function play(): void {
  if (!state.selected || !state.previewReady) return;
  state.playing = true;
  playStart = performance.now();
  playStartFrame = state.frame;
  els.play.textContent = 'Pause';
  rafId = requestAnimationFrame(tick);
}

function stop(): void {
  state.playing = false;
  cancelAnimationFrame(rafId);
  els.play.textContent = 'Play';
}

// ---------------------------------------------------------------- render

function populatePresets(): void {
  for (const id of PRESET_IDS) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = OUTPUT_PRESETS[id].label;
    els.preset.append(opt);
  }
  const showNote = () => {
    const preset = OUTPUT_PRESETS[els.preset.value as PresetId];
    els.presetNote.textContent = preset.description;
    // The background only matters when an alpha template is flattened into a preset without alpha.
    els.optBackgroundField.hidden = preset.alpha;
  };
  els.preset.addEventListener('change', showNote);
  showNote();
}

/** Frame rate choices: the template's own rate, then the standard list (film, PAL, NTSC and HFR). */
function populateFrameRates(): void {
  const own = document.createElement('option');
  own.value = '';
  own.textContent = 'Template rate';
  els.optFps.append(own);
  for (const rate of STANDARD_FRAME_RATES) {
    const opt = document.createElement('option');
    opt.value = String(rate.fps);
    opt.textContent = rate.label;
    els.optFps.append(opt);
  }
}

/** The output frame rate as currently chosen: the override, or the template's. */
function chosenFps(): number | undefined {
  if (els.optFps.value !== '') return Number(els.optFps.value);
  return state.selected?.manifest.fps;
}

/**
 * The render options as entered; blank fields mean the template's own value.
 * In and out points are parsed at the chosen frame rate; a TimecodeError names the bad field.
 */
function readRenderOptions(): RenderOptions {
  const options: RenderOptions = {};
  const fps = chosenFps();
  if (els.optFps.value !== '') options.fps = Number(els.optFps.value);
  const point = (el: HTMLInputElement, name: string): number | undefined => {
    if (el.value.trim() === '' || fps === undefined) return undefined;
    try {
      return parseTimecode(el.value, fps);
    } catch (err) {
      throw err instanceof TimecodeError ? new TimecodeError(`${name}: ${err.message}`) : err;
    }
  };
  const inFrame = point(els.optIn, 'In point');
  const outFrame = point(els.optOut, 'Out point');
  if (inFrame !== undefined) options.inFrame = inFrame;
  if (outFrame !== undefined) options.outFrame = outFrame;
  if (!OUTPUT_PRESETS[els.preset.value as PresetId].alpha) options.background = els.optBackground.value;
  return options;
}

/** Say what the options amount to (frames and rate), or why the planner would refuse them. */
function updateOptionsNote(): void {
  const m = state.selected?.manifest;
  if (!m) {
    els.optionsNote.textContent = '';
    state.optionsValid = true;
    updateControls();
    return;
  }
  const fps = chosenFps() ?? m.fps;
  // Placeholders show the range at the chosen rate, in that rate's timecode form.
  const lastFrame = Math.max(1, Math.round(m.duration * fps)) - 1;
  els.optIn.placeholder = formatTimecode(0, fps);
  els.optOut.placeholder = formatTimecode(lastFrame, fps);
  els.optIn.title = els.optOut.title = `Timecode ${timecodePattern(fps)}, a frame number, or seconds such as 2.5s`;
  try {
    const t = resolveTiming(m, readRenderOptions());
    const seconds = t.totalFrames / t.fps;
    const changed = t.fps !== m.fps || t.totalFrames !== frameCount(m) || t.firstFrame !== 0;
    const last = t.firstFrame + t.totalFrames - 1;
    els.optionsNote.classList.remove('error');
    els.optionsNote.textContent = changed
      ? `${t.totalFrames} frames at ${t.fps} fps (${seconds.toFixed(2)} s), ${formatTimecode(t.firstFrame, t.fps)} to ${formatTimecode(last, t.fps)}`
      : '';
    state.optionsValid = true;
  } catch (err) {
    els.optionsNote.classList.add('error');
    els.optionsNote.textContent = err instanceof RenderPlanError || err instanceof TimecodeError ? err.message : String(err);
    state.optionsValid = false;
  }
  updateControls();
}

/** Disable presets the detected ffmpeg cannot write and say why; move the selection off a disabled one. */
function markPresetAvailability(encoders: readonly string[]): void {
  const reasons: string[] = [];
  for (const opt of Array.from(els.preset.options)) {
    const preset = OUTPUT_PRESETS[opt.value as PresetId];
    const reason = presetUnavailableReason(encoders, preset);
    opt.disabled = reason !== null;
    opt.textContent = reason ? `${preset.label} (unavailable)` : preset.label;
    if (reason) reasons.push(`${preset.label}: ${reason}.`);
  }
  if (els.preset.selectedOptions[0]?.disabled) {
    const first = Array.from(els.preset.options).find((o) => !o.disabled);
    if (first) {
      els.preset.value = first.value;
      els.preset.dispatchEvent(new Event('change'));
    }
  }
  els.presetUnavailable.hidden = reasons.length === 0;
  els.presetUnavailable.textContent = reasons.length ? `Unavailable: ${reasons.join(' ')}` : '';
}

function updateControls(): void {
  const hasTemplate = state.selected !== null;
  els.play.disabled = !hasTemplate || !state.previewReady;
  els.scrub.disabled = !hasTemplate;
  els.render.disabled = !hasTemplate || !state.ffmpegOk || state.choosingOutput || !state.optionsValid || state.selected?.offline === true;
  renderBlocked.value = els.render.disabled;
}

/** Ask for an output path and add the render to the queue; the queue list shows progress and results. */
async function queueRender(): Promise<void> {
  if (!state.selected) return;
  stop();
  state.choosingOutput = true;
  els.renderStatus.classList.remove('error');
  els.renderStatus.textContent = 'Choose where to save...';
  updateControls();
  try {
    const result = await window.pulp.render({
      templateId: state.selected.manifest.id,
      params: state.rawParams,
      presetId: els.preset.value as PresetId,
      options: readRenderOptions(),
    });
    if (result.ok) {
      els.renderStatus.textContent = '';
    } else {
      els.renderStatus.classList.toggle('error', !result.cancelled);
      els.renderStatus.textContent = result.cancelled ? '' : result.message;
    }
  } finally {
    state.choosingOutput = false;
    updateControls();
  }
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
els.rescan.addEventListener('click', () => void loadLibrary(window.pulp.rescanLibrary()));
els.play.addEventListener('click', () => (state.playing ? stop() : play()));
els.scrub.addEventListener('input', () => {
  stop();
  requestFrame(Number(els.scrub.value));
});
els.render.addEventListener('click', () => void queueRender());
els.presetName.addEventListener('input', updatePresetButtons);
els.presetName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void savePresetAs(els.presetName.value, false);
  }
});
els.presetSave.addEventListener('click', () => void savePresetAs(els.presetName.value, false));
els.presetReplace.addEventListener('click', () => void savePresetAs(els.presetName.value, true));
els.presetCancel.addEventListener('click', () => {
  els.presetConfirm.hidden = true;
});
els.presetList.addEventListener('change', () => {
  updatePresetButtons();
  if (els.presetList.value) applySavedPreset(els.presetList.value);
});
els.presetDelete.addEventListener('click', () => {
  if (!state.selected || !els.presetList.value) return;
  void window.pulp.deletePreset(state.selected.manifest.id, els.presetList.value).then((presets) => {
    state.presets = presets;
    els.presetList.value = '';
    showPresets();
  });
});
els.batchCsv.addEventListener('input', () => {
  els.batchPreview.disabled = !state.selected || els.batchCsv.value.trim() === '';
  els.batchQueue.disabled = true;
  state.batch = null;
});
els.batchFile.addEventListener('click', () => els.batchFileInput.click());
els.batchFileInput.addEventListener('change', () => {
  const file = els.batchFileInput.files?.[0];
  if (!file) return;
  void file.text().then((text) => {
    els.batchCsv.value = text;
    els.batchPreview.disabled = !state.selected;
    previewBatch();
  });
});
els.batchPreview.addEventListener('click', previewBatch);
els.batchQueue.addEventListener('click', () => void queueBatch());
for (const group of itemToolGroups()) {
  group.favorite.addEventListener('click', () => {
    if (state.shown) void window.pulp.setItemFavorite(state.shown.id, !state.shown.favorite);
  });
  group.input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !state.shown) return;
    e.preventDefault();
    const added = group.input.value.split(',').map((t) => t.trim()).filter(Boolean);
    if (added.length === 0) return;
    void window.pulp.setItemTags(state.shown.id, [...(state.shown.userTags ?? []), ...added]);
  });
}
els.undo.addEventListener('click', undo);
els.redo.addEventListener('click', redo);
els.resetAll.addEventListener('click', resetAll);
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.altKey) return;
  const key = e.key.toLowerCase();
  // Inside a text or number field the field's own undo applies; the app history takes over elsewhere.
  if (isTextEditing(e.target)) return;
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if ((key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.metaKey)) {
    e.preventDefault();
    redo();
  }
});
for (const el of [els.optIn, els.optOut]) el.addEventListener('input', updateOptionsNote);
els.optFps.addEventListener('change', updateOptionsNote);
els.preset.addEventListener('change', updateOptionsNote);
els.params.addEventListener('submit', (e) => e.preventDefault());
window.pulp.onRenderQueue((snapshot) => dispatch((s) => setJobs(s, snapshot)));

populatePresets();
populateFrameRates();
updateControls();
initShell();
initInspectorTabs();
initSearchBar();
initStatusBar();
initTray(() =>
  state.selected
    ? { templateId: state.selected.manifest.id, params: state.rawParams, presetId: els.preset.value as PresetId, options: readRenderOptions() }
    : null,
);
mountBrowse($('browse-nodes'));
mountResults(els.results, select);
effect(() => {
  els.exportPack.disabled = !results.value.canExportPack;
});
void window.pulp.getRenderQueue().then((snapshot) => dispatch((s) => setJobs(s, snapshot)));
void window.pulp.getRecentColors().then(setRecentColors);
void loadLibrary(window.pulp.getLibrary());
window.pulp.onLibraryChanged((index) => void loadLibrary(Promise.resolve(index)));
void window.pulp.ffmpegStatus().then((info) => {
  state.ffmpegOk = info.ok;
  els.ffmpegStatus.classList.toggle('error', !info.ok);
  els.ffmpegStatus.textContent = info.ok ? `ffmpeg ${info.version} (${info.path})` : (info.message ?? 'ffmpeg not found');
  if (info.ok) markPresetAvailability(info.encoders ?? []);
  updateControls();
});
