/**
 * The inspector's Parameters tab: the parameter form with its controls, per-template
 * undo history, per-field and whole-template reset, saved presets and recent colors.
 * The controls are the imperative hosts ADR 0009 keeps; the selected template comes
 * from the shared `selectedTemplate` signal, and new values go to the stage through
 * its API. Nothing here touches another region's DOM.
 */

import { alphaToPercent, joinColor, parseColorText, percentToAlpha, splitColor, toCssRgba } from '../core/color';
import { History } from '../core/history';
import type { TemplateEntry } from '../core/library-types';
import type { TemplateManifest, TemplateParameter } from '../core/manifest';
import { applyPreset, diffFromDefaults } from '../core/param-presets';
import { saveParamsToEditedCard } from './inspector-output';
import { LAYERS_KEY, resolveParams, type ResolvedParams } from '../core/params';
import { BUNDLED_FAMILIES, cssFontFamily, familyLabel } from '../core/fonts';
import { hasCards, labelRepeatsHeading, paramCards, type ParamCard } from '../core/param-cards';
import {
  defaultLayers,
  LAYER_ALIGNS,
  LAYER_LIMITS,
  newLayer,
  resolveLayers,
  TEXT_CASES,
  TEXT_OVERFLOWS,
  type Layer,
  type LayerType,
  type LayerValues,
  type TextLayer,
} from '../core/layers';
import { addRecentColor } from '../core/recent-colors';
import { dimensionsLabel } from '../core/display';
import { IMAGE_TREATMENTS, sanitizeImageValue, type ImageValue } from '../core/image-slot';
import { setIcon, type IconName } from './icons';
import type { MediaEntry } from '../core/library-types';
import { mediaUrlFor } from '../core/media-url';
import { stageSetParams } from './stage';
import { appState, selectedTemplate, slotNotes } from './store';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  params: $<HTMLFormElement>('params'),
  presetList: $<HTMLSelectElement>('param-preset-list'),
  presetName: $<HTMLInputElement>('param-preset-name'),
  presetSave: $<HTMLButtonElement>('param-preset-save'),
  presetDelete: $<HTMLButtonElement>('param-preset-delete'),
  presetConfirm: $<HTMLDivElement>('param-preset-confirm'),
  presetConfirmText: $<HTMLSpanElement>('param-preset-confirm-text'),
  presetReplace: $<HTMLButtonElement>('param-preset-replace'),
  presetCancel: $<HTMLButtonElement>('param-preset-cancel'),
  undo: $<HTMLButtonElement>('undo'),
  redo: $<HTMLButtonElement>('redo'),
  resetAll: $<HTMLButtonElement>('reset-all'),
};

const p = {
  raw: {} as Record<string, unknown>,
  values: {} as ResolvedParams,
  /** Saved presets of the selected template, name to stored values. */
  presets: {} as Record<string, Record<string, unknown>>,
  /** Recently used colors, shared across templates, most recent first. */
  recentColors: [] as string[],
};

/** The raw (non-default) parameter values, for render, batch and drag requests. */
export function currentRawParams(): Record<string, unknown> {
  return p.raw;
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
  const selected = selectedTemplate.value;
  if (!selected) return;
  const editor = editorFor(selected.manifest.id);
  if (!sameSnapshot(editor.committed, p.raw)) {
    editor.history.push(editor.committed);
    editor.committed = { ...p.raw };
  }
  // A committed edit belongs to the collection card too, when one is being edited.
  saveParamsToEditedCard(diffFromDefaults(selected.manifest, p.raw));
  updateHistoryButtons();
}

function scheduleCommit(): void {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(commitParams, 400);
}

/** Apply a live edit: resolve, redraw the preview, and schedule a history step. */
function setParam(id: string, value: unknown): void {
  const selected = selectedTemplate.value;
  if (!selected) return;
  p.raw[id] = value;
  editorFor(selected.manifest.id).current = p.raw;
  p.values = resolveParams(selected.manifest, p.raw).values;
  stageSetParams(p.values, currentLayers());
  scheduleCommit();
  updateResetButtons();
}

/** Replace all parameters (undo, redo, reset) and rebuild the form to match. */
function applySnapshot(snapshot: Snapshot, record: boolean): void {
  const selected = selectedTemplate.value;
  if (!selected) return;
  const editor = editorFor(selected.manifest.id);
  clearTimeout(commitTimer);
  commitTimer = undefined;
  p.raw = { ...snapshot };
  editor.current = p.raw;
  if (record) {
    if (!sameSnapshot(editor.committed, p.raw)) editor.history.push(editor.committed);
  }
  editor.committed = { ...p.raw };
  p.values = resolveParams(selected.manifest, p.raw).values;
  buildParamForm(selected.manifest);
  stageSetParams(p.values, currentLayers());
  updateHistoryButtons();
}

function undo(): void {
  const selected = selectedTemplate.value;
  if (!selected) return;
  commitParams(); // a pending typed edit becomes its own step first
  const editor = editorFor(selected.manifest.id);
  const previous = editor.history.undo(editor.committed);
  if (previous) applySnapshot(previous, false);
}

function redo(): void {
  const selected = selectedTemplate.value;
  if (!selected) return;
  const editor = editorFor(selected.manifest.id);
  const next = editor.history.redo(editor.committed);
  if (next) applySnapshot(next, false);
}

function resetParam(id: string): void {
  commitParams();
  const next = { ...p.raw };
  delete next[id];
  applySnapshot(next, true);
}

function resetAll(): void {
  commitParams();
  applySnapshot({}, true);
}

function updateHistoryButtons(): void {
  const selected = selectedTemplate.value;
  const editor = selected ? editorFor(selected.manifest.id) : null;
  els.undo.disabled = !editor?.history.canUndo;
  els.redo.disabled = !editor?.history.canRedo;
  els.resetAll.disabled = !selected || Object.keys(p.raw).length === 0;
}

/** Show the per-field reset only where the value differs from the default. */
function updateResetButtons(): void {
  for (const button of els.params.querySelectorAll<HTMLButtonElement>('.field-reset')) {
    if (button.dataset.param === undefined) continue; // the layers reset has its own rule
    button.hidden = !(button.dataset.param in p.raw);
  }
  const selected = selectedTemplate.value;
  for (const button of els.params.querySelectorAll<HTMLButtonElement>('.layers-reset')) {
    button.hidden = !selected || sameLayers(currentLayers(), defaultLayers(selected.manifest));
  }
  els.resetAll.disabled = !selectedTemplate.value || Object.keys(p.raw).length === 0;
}

/** True while the keyboard focus is in a field with its own text undo. */
function isTextEditing(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return ['text', 'number', 'search', 'url', 'email', 'password'].includes(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

// ---------------------------------------------------------------- saved presets

function showPresets(): void {
  const current = els.presetList.value;
  els.presetList.replaceChildren();
  const head = document.createElement('option');
  head.value = '';
  head.textContent = Object.keys(p.presets).length ? 'Saved presets…' : 'No saved presets';
  els.presetList.append(head);
  for (const name of Object.keys(p.presets).sort((a, b) => a.localeCompare(b))) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    els.presetList.append(opt);
  }
  els.presetList.value = current in p.presets ? current : '';
  els.presetConfirm.hidden = true;
  updatePresetButtons();
}

function updatePresetButtons(): void {
  els.presetSave.disabled = !selectedTemplate.value || els.presetName.value.trim() === '';
  els.presetDelete.disabled = !selectedTemplate.value || els.presetList.value === '';
}

/** Store the values that differ from the defaults under the name; ask first if the name is taken. */
async function savePresetAs(name: string, replace: boolean): Promise<void> {
  const selected = selectedTemplate.value;
  if (!selected) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  if (trimmed in p.presets && !replace) {
    els.presetConfirmText.textContent = `Replace the preset "${trimmed}" with the current values?`;
    els.presetConfirm.hidden = false;
    return;
  }
  els.presetConfirm.hidden = true;
  const values = diffFromDefaults(selected.manifest, p.raw);
  p.presets = await window.pulp.savePreset(selected.manifest.id, trimmed, values);
  els.presetName.value = '';
  showPresets();
  els.presetList.value = trimmed;
  updatePresetButtons();
}

/** Apply a saved preset as one undoable step; parameters the template no longer has are dropped quietly. */
function applySavedPreset(name: string): void {
  const selected = selectedTemplate.value;
  if (!selected || !(name in p.presets)) return;
  commitParams();
  applySnapshot(applyPreset(selected.manifest, p.presets[name]!), true);
  updateResetButtons();
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
  const value = p.values[param.id];
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
    case 'image':
      return imageField(sanitizeImageValue(value) ?? null, onChange, { id: param.id, label: param.label });
  }
}

// ---------------------------------------------------------------- image slots (milestone 22)

/** The library's stills that can fill a slot, newest name order; what the picker lists. */
function libraryStills(query: string): MediaEntry[] {
  const q = query.trim().toLowerCase();
  const stills = (appState.value.index?.media ?? []).filter((m) => m.mediaKind === 'image' && !m.offline);
  return stills.filter((m) => !q || m.name.toLowerCase().includes(q) || m.tags.some((t) => t.includes(q))).slice(0, 60);
}

/** Short enough for a segmented control; the long form is the button's tooltip. */
const TREATMENT_LABELS: Record<ImageValue['treatment'], string> = { original: 'Original', tinted: 'Tinted', white: 'White', black: 'Black' };
const TREATMENT_TIPS: Record<ImageValue['treatment'], string> = {
  original: 'Draw the image as it is',
  tinted: 'Flatten the image to one colour',
  white: 'Flatten the image to white, for a dark background',
  black: 'Flatten the image to black, for a light background',
};
/** The two effects are toggles; neither pressed is "none". */
const EFFECT_TOGGLES: { id: Exclude<ImageValue['effect'], 'none'>; label: string; tip: string }[] = [
  { id: 'shadow', label: 'Shadow', tip: 'Drop a soft shadow behind the image' },
  { id: 'glow', label: 'Glow', tip: 'Spread a soft glow behind the image' },
];

/**
 * An image slot's control: a picture well the whole width of the field, the
 * image contained and centred inside it over a checkerboard; under it one row
 * with the name, the pixel size and Replace and Clear as icon buttons; then the
 * treatment as a segmented control with its tint beside it, the effects as
 * toggles, and a note when the chosen image has gone or its folder is offline.
 * The well is also where an image is chosen: clicking it opens a picker over
 * the library's stills (with search) or a file from outside, and a file dropped
 * on it is imported the same way — copied into the managed Imported folder and
 * indexed, so the library stays the one thing a template may see (ADR 0013).
 */
/** What each slot has to say about its image, so the Info tab can show it too. */
const slotProblems = new Map<string, { label: string; note: string }>();
function publishSlotNotes(): void {
  slotNotes.value = [...slotProblems.values()];
}

/** An icon-only button with the accessible name and tooltip docs/ui-style.md asks for. */
function iconButton(icon: IconName, label: string, tip = label): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  button.setAttribute('aria-label', label);
  button.dataset.tip = tip;
  setIcon(button, icon);
  return button;
}

function imageField(initial: ImageValue | null, onChange: (v: ImageValue | null) => void, slot: { id: string; label: string }): HTMLElement {
  let value = initial;
  const wrap = document.createElement('div');
  wrap.className = 'image-field';

  // The well: one fixed height whatever the slot's shape, with the image contained and
  // centred, so a square mark, a wide badge and a tall crest all sit in the same box.
  const well = document.createElement('button');
  well.type = 'button';
  well.className = 'image-well checker';
  well.setAttribute('aria-label', `${slot.label}: choose an image`);
  const emptyLabel = document.createElement('span');
  emptyLabel.className = 'empty-label';
  emptyLabel.textContent = 'Choose or drop an image';
  const img = document.createElement('img');
  img.alt = '';

  // One row under the well: what the image is on the left, what to do with it on the right.
  const meta = document.createElement('div');
  meta.className = 'image-meta';
  const caption = document.createElement('span');
  caption.className = 'image-name';
  const dims = document.createElement('span');
  dims.className = 'image-dims';
  const buttons = document.createElement('span');
  buttons.className = 'image-buttons';
  const replace = iconButton('swap', 'Replace image', 'Choose another image');
  // Hiding is not clearing: the choice is kept, and nothing is drawn there at all — not even the fallback.
  const hide = iconButton('eye', `Hide ${slot.label}`, 'Draw nothing here, keeping the image for later');
  const clear = iconButton('x', 'Clear image', 'Use no image: the slot shows its fallback');
  buttons.append(hide, replace, clear);
  meta.append(caption, dims, buttons);

  const picker = document.createElement('div');
  picker.className = 'image-picker';
  picker.hidden = true;
  const pickerHead = document.createElement('div');
  pickerHead.className = 'picker-head';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search stills';
  search.setAttribute('aria-label', 'Search stills');
  const fromFile = document.createElement('button');
  fromFile.type = 'button';
  fromFile.className = 'from-file';
  fromFile.textContent = 'File…';
  fromFile.dataset.tip = 'Copy an image file into the library\'s Imported folder and use it';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*,.svg';
  fileInput.hidden = true;
  pickerHead.append(search, fromFile, fileInput);
  const choices = document.createElement('ul');
  choices.className = 'image-choices';
  picker.append(pickerHead, choices);

  const treat = document.createElement('div');
  treat.className = 'image-treatment';
  const segmented = document.createElement('div');
  segmented.className = 'segmented';
  segmented.setAttribute('role', 'group');
  segmented.setAttribute('aria-label', 'Colour treatment');
  const treatmentButtons = IMAGE_TREATMENTS.map((t) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.treatment = t;
    button.textContent = TREATMENT_LABELS[t];
    button.dataset.tip = TREATMENT_TIPS[t];
    button.setAttribute('aria-pressed', 'false');
    segmented.append(button);
    return button;
  });
  const tint = document.createElement('input');
  tint.type = 'color';
  tint.className = 'tint';
  tint.setAttribute('aria-label', 'Tint colour');
  const effects = document.createElement('div');
  effects.className = 'image-effects';
  effects.setAttribute('role', 'group');
  effects.setAttribute('aria-label', 'Effect');
  const effectButtons = EFFECT_TOGGLES.map((e) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.effect = e.id;
    button.textContent = e.label;
    button.dataset.tip = e.tip;
    button.setAttribute('aria-pressed', 'false');
    effects.append(button);
    return button;
  });
  treat.append(segmented, tint, effects);
  const note = document.createElement('p');
  note.className = 'note image-note';
  wrap.append(well, meta, picker, treat, note);

  const entryFor = (id: string) => appState.value.index?.media.find((m) => m.id === id);
  const show = () => {
    const entry = value?.id ? entryFor(value.id) : undefined;
    const isHidden = value?.hidden === true;
    well.replaceChildren();
    well.classList.toggle('empty', !entry);
    well.classList.toggle('hidden-slot', isHidden);
    setIcon(hide, isHidden ? 'eye-slash' : 'eye');
    hide.setAttribute('aria-label', `${isHidden ? 'Show' : 'Hide'} ${slot.label}`);
    hide.dataset.tip = isHidden ? 'Draw it here again' : 'Draw nothing here, keeping the image for later';
    hide.setAttribute('aria-pressed', String(isHidden));
    if (value && entry) {
      // The poster when the library has made one; the still itself otherwise, so the box is never a broken image.
      img.src = entry.thumbnail ?? mediaUrlFor(value.id!);
      well.append(img);
      well.title = '';
      caption.textContent = entry.name;
      const { width, height } = entry.meta ?? {};
      // Said only once it is known: a size the library has not probed yet is left out, not guessed.
      dims.textContent = width && height ? dimensionsLabel(width, height) : '';
    } else {
      emptyLabel.textContent = value?.id ? 'Image not found — choose another' : 'Choose or drop an image';
      well.append(emptyLabel);
      well.title = '';
      caption.textContent = value?.id ? '' : 'No image; the slot shows its fallback';
      dims.textContent = '';
    }
    clear.hidden = value === null || (isHidden && !value.id);
    // A hidden slot draws nothing, so how it would be treated is not a question worth asking.
    treat.hidden = value === null || !value.id || isHidden;
    if (isHidden) caption.textContent = entry ? `${entry.name} · not drawn` : 'Nothing drawn here';
    const treatment = value?.treatment ?? 'original';
    for (const button of treatmentButtons) button.setAttribute('aria-pressed', String(button.dataset.treatment === treatment));
    tint.value = value?.tint ?? '#ffffff';
    tint.hidden = treatment !== 'tinted';
    for (const button of effectButtons) button.setAttribute('aria-pressed', String(button.dataset.effect === (value?.effect ?? 'none')));
    note.hidden = true;
    slotProblems.delete(slot.id);
    if (isHidden) {
      // Nothing to report: a hidden slot draws nothing, so an image it no longer has is no problem.
    } else if (value?.id && !entry) {
      note.hidden = false;
      note.textContent = 'The chosen image is no longer in the library. The slot shows its fallback until another is picked.';
      slotProblems.set(slot.id, { label: slot.label, note: 'Not in the library; the slot shows its fallback' });
    } else if (entry?.offline) {
      note.hidden = false;
      note.textContent = 'The chosen image\'s folder is offline.';
      slotProblems.set(slot.id, { label: slot.label, note: 'Its folder is offline' });
    }
    publishSlotNotes();
  };
  const set = (next: ImageValue | null) => {
    value = next;
    show();
    onChange(next);
    commitParams();
  };
  const pick = (id: string) => set({ id, treatment: value?.treatment ?? 'original', tint: value?.tint ?? '#ffffff', effect: value?.effect ?? 'none', hidden: value?.hidden ?? false });
  const listChoices = () => {
    choices.replaceChildren();
    const stills = libraryStills(search.value);
    if (stills.length === 0) {
      const li = document.createElement('li');
      li.className = 'note';
      li.textContent = search.value.trim() ? 'No stills match.' : 'No stills in the library yet. Add a folder with images, or use File….';
      choices.append(li);
      return;
    }
    for (const m of stills) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'image-choice';
      button.dataset.id = m.id;
      button.setAttribute('aria-pressed', String(value?.id === m.id));
      const t = document.createElement('span');
      t.className = 'thumb checker';
      const i = document.createElement('img');
      i.alt = '';
      i.src = m.thumbnail ?? mediaUrlFor(m.id);
      t.append(i);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = m.name;
      button.append(t, name);
      button.addEventListener('click', () => {
        pick(m.id);
        picker.hidden = true;
      });
      li.append(button);
      choices.append(li);
    }
  };
  const togglePicker = () => {
    picker.hidden = !picker.hidden;
    if (!picker.hidden) {
      listChoices();
      search.focus();
    }
  };
  /** A file from the picker's File… button or dropped on the well: the same import either way. */
  const importFile = (file: File) => {
    fromFile.disabled = true;
    void window.pulp
      .importImage(file)
      .then((result) => {
        if ('error' in result) {
          note.hidden = false;
          note.textContent = result.error;
          return;
        }
        pick(result.id);
        picker.hidden = true;
      })
      .finally(() => {
        fromFile.disabled = false;
      });
  };
  well.addEventListener('click', togglePicker);
  replace.addEventListener('click', togglePicker);
  // Dropping an image on the well is the shortest way in; the cursor says so while one is over it.
  well.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    well.classList.add('dropping');
  });
  for (const type of ['dragleave', 'dragend', 'drop'] as const) well.addEventListener(type, () => well.classList.remove('dropping'));
  well.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    importFile(file);
  });
  search.addEventListener('input', listChoices);
  fromFile.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) importFile(file);
  });
  clear.addEventListener('click', () => set(null));
  hide.addEventListener('click', () => {
    const now = value?.hidden === true;
    // Showing a slot that has no image again is simply an empty slot.
    if (now && !value?.id) set(null);
    else set({ id: value?.id ?? null, treatment: value?.treatment ?? 'original', tint: value?.tint ?? '#ffffff', effect: value?.effect ?? 'none', hidden: !now });
  });
  for (const button of treatmentButtons) {
    button.addEventListener('click', () => {
      if (value) set({ ...value, treatment: button.dataset.treatment as ImageValue['treatment'] });
    });
  }
  tint.addEventListener('change', () => {
    if (value) set({ ...value, tint: tint.value });
  });
  for (const button of effectButtons) {
    button.addEventListener('click', () => {
      // Pressing the effect that is on turns it off; the two are never on together.
      const next = button.dataset.effect as Exclude<ImageValue['effect'], 'none'>;
      if (value) set({ ...value, effect: value.effect === next ? 'none' : next });
    });
  }
  show();
  return wrap;
}

/** Every color field's recent-colors row, refreshed when the list changes. */
const recentRows = new Set<(colors: string[]) => void>();

function setRecentColors(colors: string[]): void {
  p.recentColors = colors;
  for (const refresh of recentRows) refresh(colors);
}

/** Remember a committed color: locally at once, then as the main process stored it. */
function rememberColor(hex: string): void {
  setRecentColors(addRecentColor(p.recentColors, hex));
  void window.pulp.addRecentColor(hex).then(setRecentColors);
}

/**
 * Color control with alpha. The native color input only holds `#rrggbb`, so it
 * edits the RGB part, a slider edits the alpha as a percentage, and a text
 * field shows and accepts the whole `#rrggbb[aa]` value. A swatch over a
 * checkerboard previews the result.
 */
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
  refresh(p.recentColors);

  show();
  field.append(swatch, picker, slider, percent, text, recent);
  return field;
}

// ---------------------------------------------------------------- layers (milestone 23)

/**
 * The layer stacks as they are now: what the person built, resolved against the
 * template, or the template's own when they have built nothing. They live in the
 * same bag of raw values as the parameters (`LAYERS_KEY`), so undo, reset and a
 * saved preset carry them without a second history.
 */
export function currentLayers(): LayerValues {
  const selected = selectedTemplate.value;
  if (!selected || selected.manifest.blocks.length === 0) return {};
  return resolveLayers(selected.manifest, p.raw[LAYERS_KEY]).values;
}

const sameLayers = (a: LayerValues, b: LayerValues): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Put a changed stack back. A stack that matches the template's own is no edit
 * at all, so it is removed rather than stored — "Reset layers" then leaves the
 * template as it was found, and Reset all stays disabled.
 */
function setLayers(next: LayerValues, rebuild: boolean): void {
  const selected = selectedTemplate.value;
  if (!selected) return;
  if (sameLayers(next, defaultLayers(selected.manifest))) delete p.raw[LAYERS_KEY];
  else p.raw[LAYERS_KEY] = next;
  editorFor(selected.manifest.id).current = p.raw;
  stageSetParams(p.values, currentLayers());
  if (rebuild) {
    buildParamForm(selected.manifest);
    commitParams();
  } else scheduleCommit();
  updateResetButtons();
}

/** Change one layer of one block, keeping the rest of the stack. */
function editLayer(blockId: string, layerId: string, change: (layer: Layer) => Layer, rebuild: boolean): void {
  const layers = currentLayers();
  const stack = layers[blockId];
  if (!stack) return;
  setLayers({ ...layers, [blockId]: stack.map((l) => (l.id === layerId ? change(l) : l)) }, rebuild);
}

/** A layer id that is free in this block, for one being added. */
function freeLayerId(stack: readonly Layer[], type: LayerType): string {
  for (let n = stack.length + 1; ; n++) {
    const id = `${type}_${n}`;
    if (!stack.some((l) => l.id === id)) return id;
  }
}

function addLayer(blockId: string, type: LayerType): void {
  const selected = selectedTemplate.value;
  const block = selected?.manifest.blocks.find((b) => b.id === blockId);
  if (!block) return;
  const layers = currentLayers();
  const stack = layers[blockId] ?? [];
  const layer = newLayer(type, block, freeLayerId(stack, type), type === 'text' ? `Line ${stack.length + 1}` : `Image ${stack.length + 1}`);
  setLayers({ ...layers, [blockId]: [...stack, layer] }, true);
}

function removeLayer(blockId: string, layerId: string): void {
  const layers = currentLayers();
  const stack = layers[blockId];
  if (!stack) return;
  setLayers({ ...layers, [blockId]: stack.filter((l) => l.id !== layerId || l.required) }, true);
}

/** Move a layer one place along the stack; the ends do nothing. */
function moveLayer(blockId: string, layerId: string, delta: -1 | 1): void {
  const layers = currentLayers();
  const stack = layers[blockId];
  if (!stack) return;
  const from = stack.findIndex((l) => l.id === layerId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= stack.length) return;
  const next = [...stack];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  setLayers({ ...layers, [blockId]: next }, true);
}

function resetLayers(blockId: string): void {
  const selected = selectedTemplate.value;
  if (!selected) return;
  setLayers({ ...currentLayers(), [blockId]: defaultLayers(selected.manifest)[blockId] ?? [] }, true);
}

/** One block's layers: the stack, what can be done to each, and how to add one. */
/** What belongs to the block rather than to one of its layers: adding a layer, and putting the template's own back. */
function blockFooter(manifest: TemplateManifest, blockId: string, label: string, showLabel: boolean): HTMLElement {
  const foot = document.createElement('div');
  foot.className = 'layer-add';
  const addLabel = document.createElement('span');
  addLabel.textContent = showLabel ? `Add layer to ${label}` : 'Add layer';
  foot.append(addLabel);
  for (const type of ['text', 'image'] as LayerType[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.add = type;
    button.textContent = type === 'text' ? 'Text' : 'Image';
    setIcon(button, 'plus');
    button.addEventListener('click', () => addLayer(blockId, type));
    foot.append(button);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'field-reset layers-reset';
  reset.textContent = 'Reset layers';
  reset.title = 'Put this template\'s own layers back';
  reset.hidden = sameLayers(currentLayers(), defaultLayers(manifest));
  reset.addEventListener('click', (e) => {
    e.preventDefault();
    resetLayers(blockId);
  });
  foot.append(reset);
  return foot;
}

/** What can be done to a layer, for its card's head: hide it, move it along the stack, take it out. */
function layerActions(blockId: string, layer: Layer, index: number, count: number): HTMLElement {
  const actions = document.createElement('span');
  actions.className = 'layer-actions';

  const hide = iconButton(layer.hidden ? 'eye-slash' : 'eye', layer.hidden ? `Show ${layer.label}` : `Hide ${layer.label}`,
    layer.hidden ? 'Kept, but not drawn: show it again' : 'Keep the layer but stop drawing it; the stack closes up');
  hide.setAttribute('aria-pressed', String(layer.hidden));
  hide.addEventListener('click', () => editLayer(blockId, layer.id, (l) => ({ ...l, hidden: !l.hidden }), true));

  const up = iconButton('caret-up', `Move ${layer.label} up`);
  up.disabled = index === 0;
  up.addEventListener('click', () => moveLayer(blockId, layer.id, -1));
  const down = iconButton('caret-down', `Move ${layer.label} down`);
  down.disabled = index === count - 1;
  down.addEventListener('click', () => moveLayer(blockId, layer.id, 1));
  actions.append(hide, up, down);

  // A layer the template marks required stays: there is no Remove for it.
  if (!layer.required) {
    const remove = iconButton('trash', `Remove ${layer.label}`);
    remove.addEventListener('click', () => removeLayer(blockId, layer.id));
    actions.append(remove);
  }
  return actions;
}

/** Everything about one layer: its words and type, or its picture. */
function layerBody(blockId: string, layer: Layer): HTMLElement[] {
  if (layer.type === 'text') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-text';
    input.value = layer.text;
    input.setAttribute('aria-label', `${layer.label} text`);
    input.addEventListener('input', () => editLayer(blockId, layer.id, (l) => ({ ...l, text: input.value }), false));
    input.addEventListener('change', () => commitParams());
    return [input, typographyControls(blockId, layer)];
  }
  return [imageField(layer.image, (value) => editLayer(blockId, layer.id, (l) => ({ ...l, image: value }), false), { id: `${blockId}.${layer.id}`, label: layer.label })];
}

// ---------------------------------------------------------------- text layer properties (milestone 23)

/** Which layers have their type controls open, across rebuilds of the form; keyed block.layer. */
const openTypography = new Set<string>();

const CASE_LABELS: Record<TextLayer['case'], string> = { none: 'As typed', upper: 'Uppercase', lower: 'Lowercase', title: 'Title case' };
const OVERFLOW_LABELS: Record<TextLayer['overflow'], string> = { wrap: 'Wrap', shrink: 'Shrink to fit', truncate: 'Truncate' };
const ALIGN_LABELS: Record<TextLayer['align'], string> = { left: 'Left', center: 'Centre', right: 'Right' };
const WEIGHT_LABELS: Record<number, string> = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };

/** The families on offer: the bundled set, then whatever the template itself sets type in, then the layer's own if it is neither. */
function familyChoices(current: string): { stack: string; bundled: boolean }[] {
  const out: { stack: string; bundled: boolean }[] = BUNDLED_FAMILIES.map((f) => ({ stack: f, bundled: true }));
  const seen = new Set(out.map((o) => o.stack));
  const own: string[] = [];
  for (const block of selectedTemplate.value?.manifest.blocks ?? []) {
    own.push(block.typography.family);
    for (const layer of block.layers) if (layer.type === 'text') own.push(layer.family);
  }
  for (const param of selectedTemplate.value?.manifest.parameters ?? []) {
    if (param.type === 'font') own.push(param.default, ...(param.options ?? []));
  }
  own.push(current);
  for (const stack of own) {
    if (seen.has(stack)) continue;
    seen.add(stack);
    out.push({ stack, bundled: false });
  }
  return out;
}

/**
 * The family control: a button that shows the current family set in itself,
 * opening a list where every family is set in its own face — the bundled ten,
 * then the template's own stacks. A native select cannot style its options.
 */
function familyPicker(current: string, onPick: (stack: string) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'family-picker';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'family-current';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  const show = (stack: string) => {
    button.textContent = familyLabel(stack);
    button.style.fontFamily = cssFontFamily(stack);
    button.dataset.family = stack;
  };
  show(current);
  const list = document.createElement('ul');
  list.className = 'family-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Font family');
  list.hidden = true;
  const close = () => {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
  };
  const onOutside = (e: Event) => {
    if (!wrap.contains(e.target as Node)) close();
  };
  const open = () => {
    list.replaceChildren();
    let divided = false;
    for (const choice of familyChoices(button.dataset.family ?? current)) {
      if (!choice.bundled && !divided) {
        divided = true;
        const rule = document.createElement('li');
        rule.className = 'family-divider';
        rule.setAttribute('role', 'presentation');
        rule.textContent = 'This template\'s';
        list.append(rule);
      }
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(choice.stack === (button.dataset.family ?? current)));
      li.dataset.family = choice.stack;
      li.style.fontFamily = cssFontFamily(choice.stack);
      li.textContent = familyLabel(choice.stack);
      li.addEventListener('click', () => {
        show(choice.stack);
        onPick(choice.stack);
        close();
      });
      list.append(li);
    }
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
  };
  button.addEventListener('click', () => (list.hidden ? open() : close()));
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !list.hidden) {
      e.preventDefault();
      close();
      button.focus();
    }
  });
  wrap.append(button, list);
  return wrap;
}

/** A labelled control in the type grid. */
function typeField(label: string, control: HTMLElement, wide = false): HTMLElement {
  const field = document.createElement('label');
  field.className = `type-field${wide ? ' wide' : ''}`;
  const span = document.createElement('span');
  span.textContent = label;
  field.append(span, control);
  return field;
}

function selectOf<T extends string>(values: readonly T[], labels: Record<T, string>, current: T, onChange: (v: T) => void, name: string): HTMLSelectElement {
  const el = document.createElement('select');
  el.setAttribute('aria-label', name);
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = labels[v];
    el.append(opt);
  }
  el.value = current;
  el.addEventListener('change', () => onChange(el.value as T));
  return el;
}

/** A number entry over a range; `scale` shows a stored fraction as a percentage. */
function numberOf(current: number, limit: { min: number; max: number }, step: number, onChange: (v: number) => void, name: string, scale = 1): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'number';
  el.min = String(limit.min * scale);
  el.max = String(limit.max * scale);
  el.step = String(step);
  el.value = String(Math.round(current * scale * 1000) / 1000);
  el.setAttribute('aria-label', name);
  el.addEventListener('change', () => {
    const n = Number(el.value);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(limit.max * scale, Math.max(limit.min * scale, n));
    el.value = String(clamped);
    onChange(clamped / scale);
  });
  return el;
}

function checkOf(current: boolean, onChange: (v: boolean) => void, name: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = current;
  el.setAttribute('aria-label', name);
  el.addEventListener('change', () => onChange(el.checked));
  return el;
}

/** One line that says how the layer is set, for the closed disclosure: "Georgia · 8.9% · Regular · Italic". */
function typographySummary(layer: TextLayer): string {
  const parts = [familyLabel(layer.family), `${Math.round(layer.size * 1000) / 10}%`, WEIGHT_LABELS[layer.weight] ?? String(layer.weight)];
  if (layer.italic) parts.push('Italic');
  if (layer.case !== 'none') parts.push(CASE_LABELS[layer.case]);
  return parts.join(' · ');
}

/**
 * A text layer's type, collapsed under its words so the list stays readable:
 * family, size, weight, italic, case, letter spacing, kerning, line height,
 * space before, colour, alignment and overflow. Each control changes the one
 * property and commits at once; the summary line follows.
 */
function typographyControls(blockId: string, layer: TextLayer): HTMLElement {
  const key = `${blockId}.${layer.id}`;
  const details = document.createElement('details');
  details.className = 'layer-type';
  details.open = openTypography.has(key);
  details.addEventListener('toggle', () => {
    if (details.open) openTypography.add(key);
    else openTypography.delete(key);
  });
  const summary = document.createElement('summary');
  summary.textContent = typographySummary(layer);
  details.append(summary);

  let current = layer;
  /** Change one property, redraw, commit, and keep the summary honest without rebuilding the form. */
  const set = <K extends keyof TextLayer>(prop: K, value: TextLayer[K]) => {
    current = { ...current, [prop]: value };
    editLayer(blockId, layer.id, (l) => ({ ...l, [prop]: value }) as Layer, false);
    commitParams();
    summary.textContent = typographySummary(current);
    maxLines.hidden = current.overflow !== 'wrap';
  };

  const grid = document.createElement('div');
  grid.className = 'type-grid';
  grid.append(typeField('Family', familyPicker(layer.family, (stack) => set('family', stack)), true));
  grid.append(typeField('Size, % of frame', numberOf(layer.size, LAYER_LIMITS.size, 0.1, (v) => set('size', v), `${layer.label} size`, 100)));
  const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900].map(String);
  const weightLabels = Object.fromEntries(weights.map((w) => [w, `${w} ${WEIGHT_LABELS[Number(w)]}`])) as Record<string, string>;
  grid.append(typeField('Weight', selectOf(weights, weightLabels, String(layer.weight), (v) => set('weight', Number(v)), `${layer.label} weight`)));
  const italic = typeField('Italic', checkOf(layer.italic, (v) => set('italic', v), `${layer.label} italic`));
  italic.classList.add('check');
  grid.append(italic);
  grid.append(typeField('Case', selectOf(TEXT_CASES, CASE_LABELS, layer.case, (v) => set('case', v), `${layer.label} case`)));
  grid.append(typeField('Letter spacing, em', numberOf(layer.letterSpacing, LAYER_LIMITS.letterSpacing, 0.01, (v) => set('letterSpacing', v), `${layer.label} letter spacing`)));
  const kerning = typeField('Kerning', checkOf(layer.kerning, (v) => set('kerning', v), `${layer.label} kerning`));
  kerning.classList.add('check');
  grid.append(kerning);
  grid.append(typeField('Line height', numberOf(layer.lineHeight, LAYER_LIMITS.lineHeight, 0.05, (v) => set('lineHeight', v), `${layer.label} line height`)));
  grid.append(typeField('Space before, % of frame', numberOf(layer.spaceBefore, LAYER_LIMITS.spaceBefore, 0.1, (v) => set('spaceBefore', v), `${layer.label} space before`, 100)));
  grid.append(typeField('Colour', colorField(layer.color, (hex) => set('color', hex)), true));
  const align = document.createElement('div');
  align.className = 'segmented';
  align.setAttribute('role', 'group');
  align.setAttribute('aria-label', `${layer.label} alignment`);
  const alignButtons = LAYER_ALIGNS.map((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.align = a;
    b.textContent = ALIGN_LABELS[a];
    b.setAttribute('aria-pressed', String(a === layer.align));
    b.addEventListener('click', () => {
      set('align', a);
      for (const other of alignButtons) other.setAttribute('aria-pressed', String(other === b));
    });
    align.append(b);
    return b;
  });
  grid.append(typeField('Alignment', align));
  grid.append(typeField('Overflow', selectOf(TEXT_OVERFLOWS, OVERFLOW_LABELS, layer.overflow, (v) => set('overflow', v), `${layer.label} overflow`)));
  const maxLines = typeField('Lines at most', numberOf(layer.maxLines, LAYER_LIMITS.maxLines, 1, (v) => set('maxLines', Math.round(v)), `${layer.label} lines at most`));
  maxLines.hidden = layer.overflow !== 'wrap';
  grid.append(maxLines);
  details.append(grid);
  return details;
}

/** Cards the person has folded away, by card id; they are open until then, and stay as left across rebuilds. */
const closedCards = new Set<string>();

/**
 * One parameter's field, as the form has always drawn it. `heading` is what the
 * field sits under — its card's title, or its group's — and a label that would
 * only repeat it is kept for the screen reader but not shown (docs/ui-style.md).
 */
function paramField(param: TemplateParameter, heading?: string): HTMLElement {
  const label = document.createElement('label');
  label.className = param.type === 'boolean' ? 'field inline' : 'field';
  label.dataset.param = param.id;
  const span = document.createElement('span');
  span.textContent = param.label;
  const repeats = labelRepeatsHeading(param.label, heading);
  if (repeats) {
    span.className = 'visually-hidden';
    label.dataset.labelUnseen = '';
  }
  if (param.description) label.title = param.description;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'field-reset';
  reset.dataset.param = param.id;
  reset.textContent = 'Reset';
  reset.title = `Reset ${param.label} to its default`;
  reset.hidden = !(param.id in p.raw);
  reset.addEventListener('click', (e) => {
    e.preventDefault();
    resetParam(param.id);
  });
  const input = inputFor(param);
  if (param.type === 'boolean') {
    label.append(input, span, reset);
  } else {
    const head = document.createElement('div');
    head.className = `field-head${repeats ? ' unlabelled' : ''}`;
    head.append(span, reset);
    label.append(head, input);
  }
  return label;
}

/**
 * One part of the graphic, folded or open: its name, what can be done to it
 * when it is a layer, and every setting that belongs to it.
 */
function paramCardEl(card: ParamCard): HTMLElement {
  const section = document.createElement('section');
  section.className = `param-card${card.layer?.layer.hidden ? ' hidden-layer' : ''}${card.kind === 'layer' ? ' layer-row' : ''}`;
  section.dataset.card = card.id;
  if (card.layer) {
    section.dataset.layer = card.layer.layer.id;
    section.dataset.block = card.layer.block;
  }
  const head = document.createElement('div');
  head.className = 'card-head';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'card-toggle';
  const open = !closedCards.has(card.id);
  toggle.setAttribute('aria-expanded', String(open));
  const name = document.createElement('span');
  name.className = 'layer-label';
  name.textContent = card.label;
  toggle.append(name);
  head.append(toggle);
  if (card.layer) head.append(layerActions(card.layer.block, card.layer.layer, card.layer.index, card.layer.count));
  section.append(head);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.hidden = !open;
  if (card.layer) body.append(...layerBody(card.layer.block, card.layer.layer));
  for (const param of card.params) body.append(paramField(param, card.label));
  section.append(body);
  toggle.addEventListener('click', () => {
    const nowOpen = body.hidden;
    body.hidden = !nowOpen;
    toggle.setAttribute('aria-expanded', String(nowOpen));
    if (nowOpen) closedCards.delete(card.id);
    else closedCards.add(card.id);
  });
  return section;
}

/**
 * The tab, by element: a card per part of the graphic (src/core/param-cards.ts).
 * A template that names no elements and has no layers gets the plain form it
 * always had, with its own `group` headings.
 */
function buildParamForm(manifest: TemplateManifest): void {
  const parameters = manifest.parameters;
  els.params.replaceChildren();
  recentRows.clear();
  if (parameters.length === 0 && manifest.blocks.length === 0) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'This template has no editable parameters.';
    els.params.append(note);
    return;
  }
  const cards = paramCards(manifest, currentLayers());
  if (!hasCards(cards)) {
    let group: string | undefined;
    for (const param of parameters) {
      if (param.group && param.group !== group) {
        const g = document.createElement('div');
        g.className = 'group-label';
        g.textContent = param.group;
        els.params.append(g);
      }
      group = param.group;
      els.params.append(paramField(param, group));
    }
    updateHistoryButtons();
    return;
  }
  // A block's layer cards sit together, with what belongs to the block itself under them.
  let blockWrap: HTMLElement | null = null;
  let blockId: string | null = null;
  const closeBlock = () => {
    if (blockWrap && blockId) {
      const block = manifest.blocks.find((b) => b.id === blockId)!;
      blockWrap.append(blockFooter(manifest, block.id, block.label, manifest.blocks.length > 1));
      els.params.append(blockWrap);
    }
    blockWrap = null;
    blockId = null;
  };
  for (const card of cards) {
    if (card.layer) {
      if (card.layer.block !== blockId) {
        closeBlock();
        blockId = card.layer.block;
        blockWrap = document.createElement('section');
        blockWrap.className = 'layers-block';
        blockWrap.dataset.block = blockId;
      }
      blockWrap!.append(paramCardEl(card));
      continue;
    }
    closeBlock();
    els.params.append(paramCardEl(card));
  }
  closeBlock();
  updateHistoryButtons();
}

// ---------------------------------------------------------------- region API

/** Show a template's parameters, restoring the session's edits; returns the resolved values for the stage. */
export function paramsShow(entry: TemplateEntry): ResolvedParams {
  const m = entry.manifest;
  slotProblems.clear();
  publishSlotNotes();
  p.raw = { ...editorFor(m.id).current };
  p.values = resolveParams(m, p.raw).values;
  buildParamForm(m);
  p.presets = {};
  showPresets();
  void window.pulp.listPresets(m.id).then((presets) => {
    if (selectedTemplate.value?.manifest.id === m.id) {
      p.presets = presets;
      showPresets();
    }
  });
  return p.values;
}

/**
 * Put a collection card's stored parameters into the form, as one undoable step.
 * The template must already be selected; values it no longer has are dropped.
 */
export function paramsApply(values: Record<string, unknown>): void {
  const selected = selectedTemplate.value;
  if (!selected) return;
  commitParams();
  applySnapshot(applyPreset(selected.manifest, values), true);
  updateResetButtons();
}

export function paramsClear(): void {
  els.params.replaceChildren();
  updatePresetButtons();
  updateHistoryButtons();
}

export function initInspectorParams(): void {
  els.params.addEventListener('submit', (e) => e.preventDefault());
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
    const selected = selectedTemplate.value;
    if (!selected || !els.presetList.value) return;
    void window.pulp.deletePreset(selected.manifest.id, els.presetList.value).then((presets) => {
      p.presets = presets;
      els.presetList.value = '';
      showPresets();
    });
  });
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
  void window.pulp.getRecentColors().then(setRecentColors);
}
