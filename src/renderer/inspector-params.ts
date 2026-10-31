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
import { LAYERS_KEY, lengthIn, resolveParams, withLength, type ResolvedParams } from '../core/params';
import {
  DEFAULT_TRANSITION, isTemplateMovement, isWholeGraphic, LAYER_TRANSITIONS, roundSeconds, spanWindow,
  TRANSITION_DIRECTIONS, TRANSITION_LIMITS, type LayerSpan, type LayerTransition, type LayerTransitions,
  type LayerTransitionType, type TransitionDirection,
} from '../core/layer-time';
import { BLEND_MODES, DEFAULT_LOOK, hasShadow, isDefaultLook, LOOK_LIMITS, type BlendMode, type LayerLook } from '../core/layer-look';
import { BUNDLED_FAMILIES, cssFontFamily, familyLabel, importedFamilies, type ImportedFont } from '../core/fonts';
import { hasCards, labelRepeatsHeading, paramCards, type ParamCard } from '../core/param-cards';
import {
  defaultLayers,
  LAYER_ALIGNS,
  LAYER_LIMITS,
  isIdentityPlacement,
  LAYER_TYPES,
  normalizeAngle,
  placementFor,
  resolveLayers,
  TEXT_CASES,
  TEXT_OVERFLOWS,
  type Layer,
  type LayerType,
  type ImageLayer,
  type LayerPlacements,
  type LayerValues,
  type PictureLayer,
  type VideoLayer,
  type TextLayer,
} from '../core/layers';
import { addRecentColor } from '../core/recent-colors';
import { lengthParts, MAX_LENGTH_SECONDS, minimumLength, resolveLength } from '../core/timing';
import { dimensionsLabel } from '../core/display';
import { IMAGE_TREATMENTS, sanitizeImageValue, sanitizePsdChoice, type ImageValue } from '../core/image-slot';
import { fileHiddenLayers, layersTopFirst, layerShown, placeableLayers, psdLimitSummary, type PsdOutline } from '../core/psd';
import { hiddenDiffersFromFile, hiddenFor, isPsdEntry, psdOutlineFor, psdOutlines } from './psd-state';
import { CLIP_ENDINGS, CLIP_LIMITS, EMPTY_CLIP, sanitizeClipValue, type ClipEnding, type ClipValue } from '../core/video-layer';
import { COLLECTION_DRAG_TYPE } from '../core/collection';
import { setIcon, type IconName } from './icons';
import type { MediaEntry } from '../core/library-types';
import { mediaUrlFor } from '../core/media-url';
import { stageSetParams } from './stage';
import { outputRefreshOptions } from './inspector-output';
import { appState, frameSize, importedFonts, paramsEdited, selectedTemplate, slotNotes } from './store';
import { aspectOf } from '../core/aspect';
import { registerLayerEditor, selectedLayer } from './layer-edit';
import { openInspector } from './inspector-tabs';
import { mediaPicker } from './media-picker';
import { addedLayer } from '../core/stage-menu';
import { effect } from '@preact/signals';

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

/**
 * Library items these templates are currently set to show: ids chosen for
 * image slots, image layers and video layers, by template id (milestone 26).
 *
 * A pack carries template folders and nothing else, so none of it travels —
 * the pack export says so with this (ADR 0013 keeps library media out of a
 * template's reach, and an asset is referenced where it lies, never copied).
 */
export function chosenLibraryItems(templateIds: readonly string[]): { templateId: string; items: number }[] {
  const out: { templateId: string; items: number }[] = [];
  for (const templateId of templateIds) {
    const raw = editors.get(templateId)?.current;
    if (!raw) continue;
    const ids = new Set<string>();
    for (const [key, value] of Object.entries(raw)) {
      if (key === LAYERS_KEY) continue;
      const image = sanitizeImageValue(value);
      if (image?.id && !image.hidden) ids.add(image.id);
    }
    const layers = raw[LAYERS_KEY];
    if (layers && typeof layers === 'object') {
      for (const stack of Object.values(layers as Record<string, unknown>)) {
        if (!Array.isArray(stack)) continue;
        for (const layer of stack) {
          if (typeof layer !== 'object' || layer === null) continue;
          const image = sanitizeImageValue((layer as { image?: unknown }).image);
          if (image?.id && !image.hidden) ids.add(image.id);
          const clip = sanitizeClipValue((layer as { clip?: unknown }).clip);
          if (clip?.id && !clip.hidden) ids.add(clip.id);
        }
      }
    }
    if (ids.size > 0) out.push({ templateId, items: ids.size });
  }
  return out;
}

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
  stageSetParams(p.values, currentLayers(), lengthIn(p.raw));
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
  stageSetParams(p.values, currentLayers(), lengthIn(p.raw));
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
  paramsEdited.value = Boolean(selected) && Object.keys(p.raw).length > 0;
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

/**
 * What a layered file placed now starts with (milestone 33): the layers hidden
 * while it was browsed in the Info tab, when that differs from the file's own
 * visibility; nothing otherwise, and nothing for any other still.
 */
function browsedPsdChoice(id: string): { psd?: ImageValue['psd'] } {
  const entry = appState.value.index?.media.find((m) => m.id === id);
  if (!entry || !isPsdEntry(entry)) return {};
  const state = psdOutlineFor(id);
  if (state.ok !== true || !hiddenDiffersFromFile(id, state.outline)) return {};
  const psd = sanitizePsdChoice({ hide: hiddenFor(id, state.outline) });
  return psd ? { psd } : {};
}

/**
 * Place a layered file as separate image layers (milestone 33): the one layer
 * showing it becomes one image layer per shown layer, bottom first so the
 * stack reads as the file does. Each draws its layer on the whole canvas and
 * copies the original's size and placement, so every layer keeps its place —
 * and from here each is moved and styled on its own (milestones 25 and 28).
 */
function splitPsdLayer(blockId: string, layerId: string, outline: PsdOutline): void {
  const layers = currentLayers();
  const stack = layers[blockId];
  const at = stack?.findIndex((l) => l.id === layerId) ?? -1;
  const original = stack?.[at];
  if (!stack || !original || original.type !== 'image' || !original.image?.id) return;
  const hidden = new Set(original.image.psd?.hide ?? fileHiddenLayers(outline.layers));
  const parts = placeableLayers(outline, hidden);
  if (parts.length < 2) return;
  const taken = new Set(stack.map((l) => l.id));
  const made = parts.map((part, i) => {
    let n = i + 1;
    let id = `${layerId}_${n}`;
    while (taken.has(id)) id = `${layerId}_${++n}`;
    taken.add(id);
    const base = original.image!;
    return { ...original, id, label: part.name || `Layer ${i + 1}`, required: false, image: { id: base.id, treatment: base.treatment, tint: base.tint, effect: base.effect, hidden: false, psd: { layer: part.id } } } as Layer;
  });
  setLayers({ ...layers, [blockId]: [...stack.slice(0, at), ...made, ...stack.slice(at + 1)] }, true);
  selectedLayer.value = { block: blockId, id: made[0]!.id };
}

function imageField(
  initial: ImageValue | null,
  onChange: (v: ImageValue | null) => void,
  slot: { id: string; label: string },
  options: {
    /** A layer's picture: the layer hides as a whole, and an empty one takes no room rather than showing a fallback. */
    layer?: boolean;
    /** For a layer showing a layered file: place its layers as separate image layers (milestone 33). */
    onSplit?: () => void;
  } = {},
): HTMLElement {
  let value = initial;
  const wrap = document.createElement('div');
  wrap.className = 'image-field';

  // The well: one fixed height whatever the slot's shape, with the image contained and
  // centred, so a square mark, a wide badge and a tall crest all sit in the same box.
  const well = document.createElement('button');
  well.type = 'button';
  well.className = 'image-well checker picker-toggle';
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
  const clear = iconButton('x', 'Clear image', options.layer ? 'Use no image: the layer takes no room' : 'Use no image: the slot shows its fallback');
  buttons.append(...(options.layer ? [replace, clear] : [hide, replace, clear]));
  meta.append(caption, dims, buttons);

  const fromFile = document.createElement('button');
  fromFile.type = 'button';
  fromFile.className = 'from-file';
  fromFile.textContent = 'File…';
  fromFile.dataset.tip = 'Copy an image file into the library\'s Imported folder and use it';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*,.svg';
  fileInput.hidden = true;
  // The one chooser (milestone 40), so this searches the library the way the search bar does.
  const chooser = mediaPicker({
    kinds: ['image'],
    noun: 'stills',
    label: slot.label,
    emptyLibrary: 'No stills in the library yet. Add a folder with images, or use File….',
    chosen: () => value?.id ?? undefined,
    onPick: (entry) => pick(entry.id),
    head: [fromFile, fileInput],
  });
  const picker = chooser.el;

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
  // A layer's shadow and glow are looks now (milestone 28), set with the rest of them under Look.
  effects.hidden = !!options.layer;
  treat.append(segmented, tint, effects);
  const note = document.createElement('p');
  note.className = 'note image-note';
  // A layered file's layers (milestone 33): boxes to show or hide each in this picture, or which one layer this is.
  const psdBox = document.createElement('div');
  psdBox.className = 'psd-box';
  psdBox.hidden = true;
  wrap.append(well, meta, picker, treat, psdBox, note);

  const entryFor = (id: string) => appState.value.index?.media.find((m) => m.id === id);
  let stopWaiting: (() => void) | null = null;
  const renderPsd = (entry: MediaEntry | undefined) => {
    psdBox.replaceChildren();
    psdBox.hidden = true;
    if (!value?.id || !entry || !isPsdEntry(entry) || value.hidden) return;
    const layeredEntry: MediaEntry = entry;
    const state = psdOutlineFor(entry.id);
    if (state.ok === 'pending') {
      // Drawn again once the structure lands; one wait per field, dropped when it is answered.
      if (!stopWaiting) {
        stopWaiting = psdOutlines.subscribe(() => {
          if (psdOutlineFor(entry.id).ok === 'pending') return;
          stopWaiting?.();
          stopWaiting = null;
          show();
        });
      }
      return;
    }
    psdBox.hidden = false;
    if (!state.ok) {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = `This file could not be read as layers: ${state.message}. Its stored picture is used.`;
      psdBox.append(p);
      return;
    }
    const { outline } = state;
    if (value.psd?.layer) {
      const which = document.createElement('p');
      which.className = 'psd-which';
      const layer = outline.layers.find((l) => l.id === value!.psd!.layer);
      which.textContent = layer ? `Layer “${layer.name}” of ${layeredEntry.name}` : `A layer ${layeredEntry.name} no longer has`;
      psdBox.append(which);
      return;
    }
    const hidden = new Set(value.psd?.hide ?? fileHiddenLayers(outline.layers));
    const list = document.createElement('ul');
    list.className = 'psd-layers';
    for (const layer of layersTopFirst(outline.layers)) {
      const li = document.createElement('li');
      li.className = `psd-layer${layer.kind === 'group' ? ' group' : ''}${layerShown(outline.layers, layer.id, hidden) ? '' : ' hidden'}`;
      li.style.paddingLeft = `${layer.depth * 16}px`;
      li.dataset.layer = layer.id;
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !hidden.has(layer.id);
      box.disabled = layer.hasPixels === false;
      box.setAttribute('aria-label', `Show ${layer.name || 'layer'}`);
      box.addEventListener('change', () => {
        const next = new Set(hidden);
        if (box.checked) next.delete(layer.id);
        else next.add(layer.id);
        const psd = sanitizePsdChoice({ hide: [...next] });
        // The file's own visibility is no choice at all, so it is not stored.
        const own = fileHiddenLayers(outline.layers).join('+');
        const same = (psd?.hide ?? []).join('+') === own;
        if (value) set({ ...value, ...(psd && !same ? { psd } : { psd: undefined }) });
      });
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = layer.name || (layer.kind === 'group' ? 'Group' : 'Layer');
      label.append(box, name);
      if (layer.limits.length > 0) {
        const limits = document.createElement('span');
        limits.className = 'limits';
        limits.textContent = layer.limits.length === 1 ? layer.limits[0]! : `${layer.limits.length} things not reproduced`;
        limits.dataset.tip = layer.limits.join('; ');
        li.append(label, limits);
      } else li.append(label);
      list.append(li);
    }
    psdBox.append(list);
    const summary = psdLimitSummary(outline);
    if (summary) {
      const p = document.createElement('p');
      p.className = 'note psd-limits';
      p.textContent = summary;
      psdBox.append(p);
    }
    const placeable = placeableLayers(outline, hidden);
    if (options.onSplit && placeable.length > 1) {
      const actions = document.createElement('div');
      actions.className = 'psd-actions';
      const split = document.createElement('button');
      split.type = 'button';
      split.textContent = `Split into ${placeable.length} layers`;
      split.dataset.tip = 'One image layer per shown layer, each keeping its place, to be moved and styled on their own';
      split.addEventListener('click', () => options.onSplit?.());
      actions.append(split);
      psdBox.append(actions);
    }
  };
  const show = () => {
    const entry = value?.id ? entryFor(value.id) : undefined;
    const isHidden = value?.hidden === true;
    renderPsd(entry);
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
      caption.textContent = value?.id ? '' : options.layer ? 'No image; the layer takes no room' : 'No image; the slot shows its fallback';
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
  const pick = (id: string) => set({ id, treatment: value?.treatment ?? 'original', tint: value?.tint ?? '#ffffff', effect: value?.effect ?? 'none', hidden: value?.hidden ?? false, ...browsedPsdChoice(id) });
  const togglePicker = () => chooser.toggle();
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
        chooser.close();
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
  stageSetParams(p.values, currentLayers(), lengthIn(p.raw));
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

function addLayer(blockId: string, type: LayerType): void {
  const selected = selectedTemplate.value;
  const block = selected?.manifest.blocks.find((b) => b.id === blockId);
  if (!block) return;
  const layers = currentLayers();
  const stack = layers[blockId] ?? [];
  const layer = addedLayer(type, block, stack);
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

/**
 * How long the graphic runs for (milestone 30): seconds, with a floor of the
 * entrance plus the exit, and a way back to the length the template was
 * designed at. Absent for a template that declares no structure — there is
 * nothing to stretch, so there is nothing to ask.
 */
function lengthField(): HTMLElement | null {
  const selected = selectedTemplate.value;
  const structure = selected?.manifest.structure;
  if (!selected || !structure) return null;
  const duration = selected.manifest.duration;
  const floor = minimumLength(structure, duration);
  const current = resolveLength(duration, structure, lengthIn(p.raw));

  const wrap = document.createElement('div');
  wrap.className = 'length-field';
  const input = numberOf(current, { min: floor, max: MAX_LENGTH_SECONDS }, 0.5, (v) => setLength(v === duration ? undefined : v), 'Length, seconds');
  wrap.append(typeField('Length, seconds', input));
  const note = document.createElement('p');
  note.className = 'note';
  const parts = lengthParts(duration, structure, current);
  note.textContent =
    `In ${parts.entrance} s, hold ${Math.round((parts.holdTo - parts.holdFrom) * 10) / 10} s, out ${parts.exit} s. ` +
    'Only the hold stretches; the entrance and the exit keep the speed they were designed at.';
  wrap.append(note);
  if (current !== duration) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'field-reset';
    reset.textContent = `Reset to ${duration} s`;
    reset.title = 'Back to the length this template was designed at';
    reset.addEventListener('click', (e) => {
      e.preventDefault();
      setLength(undefined);
    });
    wrap.append(reset);
  }
  return wrap;
}

/**
 * Choose a length; `undefined` is the template's own. `commit` makes it one
 * undo step — a field change or the end of a drag — where a live drag passes
 * false and only redraws.
 */
function setLength(length: number | undefined, commit = true): void {
  const selected = selectedTemplate.value;
  if (!selected) return;
  // The same path a parameter edit takes: the raw values, the editor's own copy, the preview,
  // then one history step. The form is rebuilt because the note and the reset button follow it.
  p.raw = withLength(p.raw, length);
  editorFor(selected.manifest.id).current = p.raw;
  stageSetParams(p.values, currentLayers(), lengthIn(p.raw));
  // The Output tab trims within the length, so what it shows follows it.
  outputRefreshOptions();
  if (!commit) return;
  commitParams();
  buildParamForm(selected.manifest);
}

/** One block's layers: the stack, what can be done to each, and how to add one. */
/** What belongs to the block rather than to one of its layers: adding a layer, and putting the template's own back. */
function blockFooter(manifest: TemplateManifest, blockId: string, label: string, showLabel: boolean): HTMLElement {
  const foot = document.createElement('div');
  foot.className = 'layer-add';
  const addLabel = document.createElement('span');
  addLabel.textContent = showLabel ? `Add layer to ${label}` : 'Add layer';
  foot.append(addLabel);
  // Video sits beside Text and Image: a clip is as much a layer as a line or a picture (milestone 26).
  for (const type of LAYER_TYPES as readonly LayerType[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.add = type;
    button.textContent = ADD_LAYER_LABELS[type];
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

  // A placed layer can be put back where its stack places it (milestone 25).
  if (layer.placement) {
    const resetPos = iconButton('frame-corners', `Reset ${layer.label} position`, 'Put the layer back where the stack places it');
    resetPos.addEventListener('click', () => {
      editLayer(blockId, layer.id, (l) => {
        const rest = { ...l };
        delete rest.placement;
        return rest;
      }, true);
      commitParams();
    });
    actions.append(resetPos);
  }

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
    const parts: HTMLElement[] = [input, typographyControls(blockId, layer)];
    if (familyMissing(layer.family)) {
      // A preset or a collection set in a font that has gone: said, not silently drawn in a fallback.
      const gone = document.createElement('p');
      gone.className = 'note font-missing';
      gone.textContent = `"${familyLabel(layer.family)}" is not on this computer, so the line is drawn in a fallback face. Import it, or choose another family.`;
      parts.push(gone);
    }
    parts.push(motionControls(blockId, layer), lookControls(blockId, layer));
    return parts;
  }
  if (layer.type === 'video') {
    return [
      clipField(layer.clip, (value) => editLayer(blockId, layer.id, (l) => ({ ...l, clip: value }), false), { id: `${blockId}.${layer.id}`, label: layer.label }),
      imageLayerControls(blockId, layer),
      motionControls(blockId, layer),
      lookControls(blockId, layer),
    ];
  }
  return [
    imageField(layer.image, (value) => editLayer(blockId, layer.id, (l) => ({ ...l, image: value }), false), { id: `${blockId}.${layer.id}`, label: layer.label }, {
      layer: true,
      onSplit: () => {
        const id = layer.image?.id;
        const state = id ? psdOutlineFor(id) : null;
        if (state && state.ok === true) splitPsdLayer(blockId, layer.id, state.outline);
      },
    }),
    imageLayerControls(blockId, layer),
    motionControls(blockId, layer),
    lookControls(blockId, layer),
  ];
}

const ENDING_LABELS: Record<ClipEnding, string> = { loop: 'Loop', once: 'Play once' };

/** What the Add layer buttons say, and what a new layer of each type is called. */
const ADD_LAYER_LABELS: Record<LayerType, string> = { text: 'Text', image: 'Image', video: 'Video' };

/**
 * A video layer's clip: which clip, and how it plays. Chosen from the library
 * only — a clip is referenced where it lies and never imported or copied
 * (milestone 26), so there is no File… here as there is for a still.
 */
function clipField(
  initial: ClipValue | null,
  onChange: (value: ClipValue | null) => void,
  slot: { id: string; label: string },
): HTMLElement {
  let value = initial;
  const wrap = document.createElement('div');
  wrap.className = 'image-field clip-field';
  const well = document.createElement('div');
  well.className = 'image-well checker';
  const img = document.createElement('img');
  img.alt = '';
  const emptyLabel = document.createElement('span');
  emptyLabel.className = 'empty-label';
  const meta = document.createElement('div');
  meta.className = 'image-meta';
  const caption = document.createElement('span');
  caption.className = 'name';
  const dims = document.createElement('span');
  dims.className = 'dims';
  const actions = document.createElement('span');
  actions.className = 'image-actions';
  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'ghost picker-toggle';
  choose.textContent = 'Choose…';
  choose.setAttribute('aria-label', `${slot.label}: choose a clip`);
  const hide = iconButton('eye', `Hide ${slot.label}`);
  const clear = iconButton('trash', `Clear ${slot.label}`);
  actions.append(choose, hide, clear);
  meta.append(caption, dims, actions);

  // The one chooser (milestone 40), the same the picture well opens: a clip is searched for the
  // way a still is, and the way everything is in the search bar.
  const chooser = mediaPicker({
    kinds: ['video'],
    noun: 'clips',
    label: slot.label,
    emptyLibrary: 'No clips in the library yet. Add a folder with video, or make the sample media.',
    chosen: () => value?.id ?? undefined,
    // A new clip starts from the whole of it: in and out points of the one before mean nothing here.
    onPick: (entry) => set({ ...EMPTY_CLIP, id: entry.id, ending: value?.ending ?? 'loop', speed: value?.speed ?? 1, delay: value?.delay ?? 0 }),
  });
  const picker = chooser.el;

  const settings = document.createElement('div');
  settings.className = 'type-grid clip-settings';
  const note = document.createElement('p');
  note.className = 'note image-note';
  wrap.append(well, meta, picker, settings, note);

  const entryFor = (id: string) => appState.value.index?.media.find((m) => m.id === id);
  const set = (next: ClipValue | null) => {
    value = next;
    show();
    onChange(next);
    commitParams();
  };
  const patch = (over: Partial<ClipValue>) => {
    if (!value) return;
    set({ ...value, ...over });
  };

  function buildSettings(entry: MediaEntry | undefined): void {
    settings.replaceChildren();
    if (!value?.id || value.hidden) return;
    const frames = entry?.meta?.duration && entry.meta.fps ? Math.round(entry.meta.duration * entry.meta.fps) : 0;
    const lastFrame = Math.max(0, frames - 1);
    settings.append(
      typeField('In point, frame', numberOf(value.inPoint, { min: 0, max: Math.max(0, lastFrame) }, 1, (v) => patch({ inPoint: Math.round(v) }), `${slot.label} in point`)),
      // -1 is "to the end", and stays that way unless a frame is named.
      typeField('Out point, frame', numberOf(value.outPoint < 0 ? lastFrame : value.outPoint, { min: 0, max: Math.max(0, lastFrame) }, 1, (v) => patch({ outPoint: Math.round(v) }), `${slot.label} out point`)),
      typeField('At the end', selectOf(CLIP_ENDINGS, ENDING_LABELS, value.ending, (v) => patch({ ending: v }), `${slot.label} ending`)),
      typeField('Speed', numberOf(value.speed, CLIP_LIMITS.speed, 0.1, (v) => patch({ speed: v }), `${slot.label} speed`)),
      typeField('Start delay, s', numberOf(value.delay, CLIP_LIMITS.delay, 0.1, (v) => patch({ delay: v }), `${slot.label} start delay`)),
    );
    if (frames === 0) {
      const waiting = document.createElement('p');
      waiting.className = 'note';
      waiting.textContent = 'Its length is not known yet, so the whole clip plays; set in and out once the library has read it.';
      settings.append(waiting);
    }
  }

  function show(): void {
    const entry = value?.id ? entryFor(value.id) : undefined;
    const isHidden = value?.hidden === true;
    well.replaceChildren();
    well.classList.toggle('empty', !entry);
    well.classList.toggle('hidden-slot', isHidden);
    setIcon(hide, isHidden ? 'eye-slash' : 'eye');
    hide.setAttribute('aria-label', `${isHidden ? 'Show' : 'Hide'} ${slot.label}`);
    hide.dataset.tip = isHidden ? 'Draw it here again' : 'Draw nothing here, keeping the clip for later';
    hide.setAttribute('aria-pressed', String(isHidden));
    if (value && entry) {
      // A clip's poster, never the file: a <video> here would decode a whole clip for one picture.
      if (entry.thumbnail) img.src = entry.thumbnail;
      well.append(img);
      caption.textContent = entry.name;
      const { width, height } = entry.meta ?? {};
      dims.textContent = width && height ? dimensionsLabel(width, height) : '';
    } else {
      emptyLabel.textContent = value?.id ? 'Clip not found — choose another' : 'Choose a clip';
      well.append(emptyLabel);
      caption.textContent = value?.id ? '' : 'No clip; the layer takes no room';
      dims.textContent = '';
    }
    clear.hidden = value === null || (isHidden && !value.id);
    if (isHidden) caption.textContent = entry ? `${entry.name} · not drawn` : 'Nothing drawn here';
    buildSettings(entry);
    note.hidden = true;
    slotProblems.delete(slot.id);
    if (isHidden) {
      // A hidden layer draws nothing, so a clip it no longer has is no problem.
    } else if (value?.id && !entry) {
      note.hidden = false;
      note.textContent = 'The chosen clip is no longer in the library. The layer draws nothing until another is picked.';
      slotProblems.set(slot.id, { label: slot.label, note: 'Not in the library; the layer draws nothing' });
    } else if (entry?.offline) {
      note.hidden = false;
      note.textContent = 'The chosen clip\'s folder is offline.';
      slotProblems.set(slot.id, { label: slot.label, note: 'Its folder is offline' });
    }
    publishSlotNotes();
  }

  choose.addEventListener('click', () => chooser.toggle());
  hide.addEventListener('click', () => set({ ...(value ?? EMPTY_CLIP), hidden: !(value?.hidden === true) }));
  clear.addEventListener('click', () => set(null));
  show();
  return wrap;
}

/** An image layer's own two settings: how tall the picture is, and where it sits across the block. No type here. */
function imageLayerControls(blockId: string, layer: PictureLayer): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'type-grid image-layer-controls';
  const set = <K extends keyof PictureLayer>(prop: K, value: PictureLayer[K]) => {
    editLayer(blockId, layer.id, (l) => ({ ...l, [prop]: value }) as Layer, false);
    commitParams();
  };
  grid.append(typeField('Size, % of frame', numberOf(layer.size, LAYER_LIMITS.size, 0.5, (v) => set('size', v), `${layer.label} size`, 100)));
  const align = document.createElement('div');
  align.className = 'segmented';
  align.setAttribute('role', 'group');
  align.setAttribute('aria-label', `${layer.label} alignment`);
  const buttons = LAYER_ALIGNS.map((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.align = a;
    b.textContent = ALIGN_LABELS[a];
    b.setAttribute('aria-pressed', String(a === layer.align));
    b.addEventListener('click', () => {
      set('align', a);
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === b));
    });
    align.append(b);
    return b;
  });
  grid.append(typeField('Alignment', align));
  return grid;
}

// ---------------------------------------------------------------- text layer properties (milestone 23)

/** Which layers have their type controls open, across rebuilds of the form; keyed block.layer. */
const openTypography = new Set<string>();

/** The same for the Advanced disclosure, which holds a layer's own motion. */
const openAdvanced = new Set<string>();

const MOTION_LABELS: Record<LayerTransitionType, string> = { template: 'Template', fade: 'Fade', slide: 'Slide', scale: 'Scale', wipe: 'Wipe', none: 'None' };
const DIRECTION_LABELS: Record<TransitionDirection, string> = { auto: 'With the stack', top: 'The top', bottom: 'The bottom', left: 'The left', right: 'The right' };

/** The length the graphic is running at, which a layer's own start and end are set within. */
function graphicLength(): number {
  const selected = selectedTemplate.value;
  if (!selected) return 0;
  return resolveLength(selected.manifest.duration, selected.manifest.structure ?? null, lengthIn(p.raw));
}

/** "2-8 s", or nothing at all while the layer is on screen for the whole graphic. */
function spanSummary(span: LayerSpan | undefined, length: number): string {
  if (isWholeGraphic(span)) return '';
  const { from, to } = spanWindow(span, length);
  return ` · ${roundSeconds(from)}-${roundSeconds(to)} s`;
}

/** What the folded Advanced line says: nothing of its own while the template owns both ends. */
function motionSummary(transition: LayerTransitions | undefined, span: LayerSpan | undefined, length: number): string {
  const timing = spanSummary(span, length);
  if (isTemplateMovement(transition) || !transition) return `Advanced${timing}`;
  const ends = [
    transition.in.type === 'template' ? '' : `in ${MOTION_LABELS[transition.in.type]}`,
    transition.out.type === 'template' ? '' : `out ${MOTION_LABELS[transition.out.type]}`,
  ].filter(Boolean).join(', ');
  return `Advanced · ${ends}${timing}`;
}

/**
 * When a layer comes and goes, in seconds of the graphic as it is watched
 * (milestone 28). The default is the whole of it, which is every layer before
 * this and stays the answer until someone says otherwise, so End shows the
 * graphic's length and setting it back there stores nothing: the layer then
 * follows the length rather than being pinned to the number it had when it was
 * set (src/core/layer-time.ts).
 */
function spanControls(blockId: string, layer: Layer, onChange: () => void): HTMLElement[] {
  const length = graphicLength();
  let current = layer.span;
  const set = (span: LayerSpan) => {
    current = isWholeGraphic(span) ? undefined : span;
    editLayer(blockId, layer.id, (l) => ({ ...l, span: current }) as Layer, false);
    commitParams();
    onChange();
  };
  const window = spanWindow(layer.span, length);
  const limit = { min: 0, max: Math.max(0, length) };
  const start = numberOf(window.from, limit, 0.1, (v) => set({ start: v, end: current?.end ?? null }), `${layer.label} start`);
  // An end at or past the graphic's end is no end of its own: the layer runs as long as the graphic does.
  const end = numberOf(window.to, limit, 0.1, (v) => set({ start: current?.start ?? 0, end: v >= length ? null : v }), `${layer.label} end`);
  return [typeField('Start, s', start), typeField('End, s', end)];
}

/**
 * One end of a layer: how it arrives, or how it leaves. The template owns both
 * by default — that is what a block is for — and these are the person's own
 * for this layer. Whatever is chosen still goes when the graphic goes, so a
 * layer cannot be left on screen after the design has cleared
 * (src/core/layer-time.ts).
 */
function transitionFields(label: string, end: 'in' | 'out', layer: Layer, read: () => LayerTransitions, set: (t: LayerTransitions) => void): HTMLElement[] {
  const current = () => read()[end];
  const put = (over: Partial<LayerTransition>) => {
    const next = read();
    set({ ...next, [end]: { ...next[end], ...over } });
    follow();
  };
  const type = typeField(label, selectOf(LAYER_TRANSITIONS, MOTION_LABELS, current().type, (v) => put({ type: v }), `${layer.label} ${end === 'in' ? 'entrance' : 'exit'}`));
  const seconds = typeField(`${label}, s`, numberOf(current().seconds, TRANSITION_LIMITS.seconds, 0.05, (v) => put({ seconds: v }), `${layer.label} ${end === 'in' ? 'entrance' : 'exit'} seconds`));
  const direction = typeField(`${label} from`, selectOf(TRANSITION_DIRECTIONS, DIRECTION_LABELS, current().direction, (v) => put({ direction: v }), `${layer.label} ${end === 'in' ? 'entrance' : 'exit'} direction`));
  /** Seconds mean nothing while the template owns the end, and an edge means nothing to a fade. */
  function follow(): void {
    const t = current().type;
    seconds.hidden = t === 'template';
    direction.hidden = t !== 'slide' && t !== 'wipe';
  }
  follow();
  return [type, seconds, direction];
}

/**
 * A layer's own two ends and its own time on screen, folded away under
 * Advanced. Both ends default to the template's movement, which is what every
 * layer had before milestone 28 and what it keeps until someone says otherwise.
 */
function motionControls(blockId: string, layer: Layer): HTMLElement {
  const key = `${blockId}.${layer.id}`;
  const details = document.createElement('details');
  details.className = 'layer-advanced';
  details.open = openAdvanced.has(key);
  details.addEventListener('toggle', () => {
    if (details.open) openAdvanced.add(key);
    else openAdvanced.delete(key);
  });
  const summary = document.createElement('summary');
  const length = graphicLength();
  let span = layer.span;
  let transition: LayerTransitions | undefined = layer.transition;
  const retitle = () => { summary.textContent = motionSummary(transition, span, length); };
  retitle();
  details.append(summary);

  const setTransition = (next: LayerTransitions) => {
    // The template's movement at both ends is no transition at all, so the layer is stored as it was.
    transition = isTemplateMovement(next) ? undefined : next;
    editLayer(blockId, layer.id, (l) => ({ ...l, transition }) as Layer, false);
    commitParams();
    retitle();
  };
  const readTransition = (): LayerTransitions => transition ?? { in: { ...DEFAULT_TRANSITION }, out: { ...DEFAULT_TRANSITION } };

  const grid = document.createElement('div');
  grid.className = 'type-grid';
  grid.append(...transitionFields('In', 'in', layer, readTransition, setTransition));
  grid.append(...transitionFields('Out', 'out', layer, readTransition, setTransition));
  grid.append(angleField(blockId, layer));
  grid.append(...spanControls(blockId, layer, () => { span = currentLayer(blockId, layer.id)?.span; retitle(); }));
  details.append(grid);
  return details;
}

/** The layer as it stands now, after an edit that did not rebuild the form. */
function currentLayer(blockId: string, layerId: string): Layer | undefined {
  return currentLayers()[blockId]?.find((l) => l.id === layerId);
}

/** Which layers have their Look open, across rebuilds of the form; keyed block.layer. */
const openLook = new Set<string>();

const BLEND_LABELS: Record<BlendMode, string> = { normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay' };

/** What the folded Look line says: which of its parts are in play, or nothing while the template's draw stands. */
function lookSummary(look: LayerLook | undefined): string {
  if (!look || isDefaultLook(look)) return 'Look';
  const parts: string[] = [];
  if (look.opacity !== 1) parts.push(`${Math.round(look.opacity * 100)}%`);
  if (hasShadow(look)) parts.push('shadow');
  if (look.glowSize > 0) parts.push('glow');
  if (look.outlineWidth > 0) parts.push('outline');
  if (look.blur > 0) parts.push('blur');
  if (look.blend !== 'normal') parts.push(BLEND_LABELS[look.blend]);
  if (look.brightness !== 0 || look.saturation !== 1 || look.tint) parts.push('colour');
  if (look.corners > 0) parts.push('corners');
  if (look.feather > 0) parts.push('soft edges');
  return `Look · ${parts.join(', ')}`;
}

/**
 * How a layer looks (milestone 28), folded away under Look: opacity, a shadow,
 * a glow, an outline, a blur, a blend mode and a colour adjustment, and on a
 * picture or a clip, rounded corners and soft edges. Set once and not animated;
 * drawn by the host around the template's own draw, so the design stays the
 * author's (src/core/layer-look.ts). Sizes are a percentage of the frame's
 * short side, as a layer's own size is.
 */
function lookControls(blockId: string, layer: Layer): HTMLElement {
  const key = `${blockId}.${layer.id}`;
  const details = document.createElement('details');
  details.className = 'layer-look';
  details.open = openLook.has(key);
  details.addEventListener('toggle', () => {
    if (details.open) openLook.add(key);
    else openLook.delete(key);
  });
  const summary = document.createElement('summary');
  let current: LayerLook = { ...DEFAULT_LOOK, ...(layer.look ?? {}) };
  summary.textContent = lookSummary(layer.look);
  details.append(summary);
  // Eighteen controls a layer, so the grid is built the first time the disclosure is opened; a
  // tab with many layers stays light, and a look is rarely the thing being edited.
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    details.append(buildLookGrid());
  };
  if (details.open) build();
  else details.addEventListener('toggle', build, { once: true });
  return details;

  function buildLookGrid(): HTMLElement {
  const put = (over: Partial<LayerLook>) => {
    current = { ...current, ...over };
    // The template's draw is no look at all, so a layer put back to it is stored as it was.
    const stored = isDefaultLook(current) ? undefined : current;
    editLayer(blockId, layer.id, (l) => ({ ...l, look: stored }) as Layer, false);
    commitParams();
    summary.textContent = lookSummary(stored);
  };
  const name = (what: string) => `${layer.label} ${what}`;
  const pct = (label: string, k: keyof LayerLook, limit: { min: number; max: number }, step: number, scale: number) =>
    typeField(label, numberOf(current[k] as number, limit, step, (v) => put({ [k]: v } as Partial<LayerLook>), name(label.toLowerCase()), scale));

  const grid = document.createElement('div');
  grid.className = 'type-grid';
  grid.append(
    pct('Opacity, %', 'opacity', LOOK_LIMITS.opacity, 1, 100),
    typeField('Blend', selectOf(BLEND_MODES, BLEND_LABELS, current.blend, (v) => put({ blend: v }), name('blend'))),
    typeField('Shadow colour', colorField(current.shadowColor, (hex) => put({ shadowColor: hex }))),
    pct('Shadow distance, %', 'shadowDistance', LOOK_LIMITS.size, 0.1, 100),
    pct('Shadow angle, °', 'shadowAngle', LOOK_LIMITS.angle, 1, 1),
    pct('Shadow softness, %', 'shadowSoftness', LOOK_LIMITS.size, 0.1, 100),
    typeField('Glow colour', colorField(current.glowColor, (hex) => put({ glowColor: hex }))),
    pct('Glow size, %', 'glowSize', LOOK_LIMITS.size, 0.1, 100),
    typeField('Outline colour', colorField(current.outlineColor, (hex) => put({ outlineColor: hex }))),
    pct('Outline width, %', 'outlineWidth', LOOK_LIMITS.size, 0.05, 100),
    pct('Blur, %', 'blur', LOOK_LIMITS.size, 0.1, 100),
    pct('Brightness', 'brightness', LOOK_LIMITS.brightness, 0.05, 1),
    pct('Saturation', 'saturation', LOOK_LIMITS.saturation, 0.05, 1),
  );
  // A tint is a colour or nothing: the switch says which, and the colour waits beside it.
  const tintOn = checkOf(current.tint !== null, (on) => put({ tint: on ? tintColor : null }), name('tint on'));
  let tintColor = current.tint ?? '#ffffff';
  const tintField = colorField(tintColor, (hex) => { tintColor = hex; if (current.tint !== null) put({ tint: hex }); });
  const tintWrap = document.createElement('div');
  tintWrap.className = 'tint-field';
  tintWrap.append(tintOn, tintField);
  grid.append(typeField('Tint', tintWrap));
  if (layer.type !== 'text') {
    grid.append(
      pct('Corners, %', 'corners', LOOK_LIMITS.size, 0.1, 100),
      pct('Soft edges, %', 'feather', LOOK_LIMITS.size, 0.1, 100),
    );
  }
  return grid;
  }
}

/**
 * The angle a layer is turned by, for this frame's aspect (milestone 29). The
 * handle on the stage is the quick way; this is the exact one, and the place
 * to read what a drag settled on. Degrees, clockwise, from a half turn either
 * way — the same number the placement stores.
 */
function angleField(blockId: string, layer: Layer): HTMLElement {
  // The shape being previewed decides which placement this field edits; before one is known,
  // the default entry is the one a layer would be given.
  const size = frameSize.value;
  const aspect = size ? aspectOf(size.width, size.height) : 'default';
  const current = placementFor(layer.placement, aspect);
  const input = numberOf(current.rotate, { min: -180, max: 180 }, 1, (v) => {
    const rotate = normalizeAngle(v);
    editLayer(blockId, layer.id, (l) => {
      const placements: LayerPlacements = { ...l.placement };
      const next = { ...placementFor(l.placement, aspect), rotate };
      if (isIdentityPlacement(next)) delete placements[aspect];
      else placements[aspect] = next;
      if (Object.keys(placements).length === 0) {
        const rest = { ...l };
        delete rest.placement;
        return rest;
      }
      return { ...l, placement: placements };
    }, true);
    commitParams();
  }, `${layer.label} angle`);
  return typeField('Angle, degrees', input);
}

const CASE_LABELS: Record<TextLayer['case'], string> = { none: 'As typed', upper: 'Uppercase', lower: 'Lowercase', title: 'Title case' };
const OVERFLOW_LABELS: Record<TextLayer['overflow'], string> = { wrap: 'Wrap', shrink: 'Shrink to fit', truncate: 'Truncate' };
const ALIGN_LABELS: Record<TextLayer['align'], string> = { left: 'Left', center: 'Centre', right: 'Right' };
const WEIGHT_LABELS: Record<number, string> = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };

type FamilyKind = 'bundled' | 'imported' | 'own';

/** The families on offer: the bundled set, the person's imported ones with their licence notes, then whatever the template itself sets type in, then the layer's own if it is none of those. */
function familyChoices(current: string): { stack: string; kind: FamilyKind; note?: string }[] {
  const out: { stack: string; kind: FamilyKind; note?: string }[] = BUNDLED_FAMILIES.map((f) => ({ stack: f, kind: 'bundled' }));
  const seen = new Set(out.map((o) => o.stack));
  for (const family of importedFamilies(importedFonts.value)) {
    if (seen.has(family)) continue;
    seen.add(family);
    const note = importedFonts.value.find((f) => f.family === family && f.note.trim() !== '')?.note.trim();
    out.push({ stack: family, kind: 'imported', ...(note ? { note } : {}) });
  }
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
    out.push({ stack, kind: 'own' });
  }
  return out;
}

/**
 * A family a layer is set in that is nowhere to be found: not bundled, not
 * imported, and not one the template itself names. That is a preset or a
 * collection whose imported font has gone, and it is said rather than quietly
 * drawn in whatever the renderer falls back to.
 */
function familyMissing(family: string): boolean {
  if (BUNDLED_FAMILIES.includes(family) || importedFamilies(importedFonts.value).includes(family)) return false;
  for (const block of selectedTemplate.value?.manifest.blocks ?? []) {
    if (block.typography.family === family) return false;
    for (const layer of block.layers) if (layer.type === 'text' && layer.family === family) return false;
  }
  for (const param of selectedTemplate.value?.manifest.parameters ?? []) {
    if (param.type === 'font' && (param.default === family || (param.options ?? []).includes(family))) return false;
  }
  return true;
}

/** What the licence note says about an imported family, for where it is chosen; empty when there is none. */
function importedNote(font: ImportedFont | undefined): string {
  return font?.note.trim() ? `Imported · ${font.note.trim()}` : 'Imported';
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
  const divider = (text: string) => {
    const rule = document.createElement('li');
    rule.className = 'family-divider';
    rule.setAttribute('role', 'presentation');
    rule.textContent = text;
    return rule;
  };
  const open = () => {
    list.replaceChildren();
    let shownKind: FamilyKind = 'bundled';
    for (const choice of familyChoices(button.dataset.family ?? current)) {
      if (choice.kind !== shownKind) {
        shownKind = choice.kind;
        list.append(divider(choice.kind === 'imported' ? 'Imported' : 'This template\'s'));
      }
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(choice.stack === (button.dataset.family ?? current)));
      li.dataset.family = choice.stack;
      li.dataset.kind = choice.kind;
      li.style.fontFamily = cssFontFamily(choice.stack);
      li.textContent = familyLabel(choice.stack);
      // The licence note travels with the family, where it is chosen: the licence is the person's to know.
      if (choice.kind === 'imported') li.dataset.tip = importedNote(importedFonts.value.find((f) => f.family === choice.stack));
      li.addEventListener('click', () => {
        show(choice.stack);
        onPick(choice.stack);
        close();
      });
      list.append(li);
    }
    list.append(divider(''), fontImportRow(() => open()));
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

/**
 * The last row of the family list: import a font of your own. The file dialog
 * is the main process's; the family is read from the file, and the person
 * writes what they know of its licence before it is kept. Pulp records the
 * note and shows it with the family; the licence itself is theirs to answer for.
 */
function fontImportRow(onDone: () => void): HTMLElement {
  const row = document.createElement('li');
  row.className = 'font-import';
  row.setAttribute('role', 'presentation');
  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'font-import-start';
  start.textContent = 'Import font…';
  start.dataset.tip = 'Copy a TTF, OTF or WOFF2 file of your own into Pulp\'s fonts folder';
  const form = document.createElement('div');
  form.className = 'font-import-form';
  form.hidden = true;
  const who = document.createElement('span');
  who.className = 'font-import-family';
  const note = document.createElement('input');
  note.type = 'text';
  note.placeholder = 'Licence note, e.g. "Bought from the foundry, desktop licence"';
  note.setAttribute('aria-label', 'Licence note for the imported font');
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = 'Add';
  const error = document.createElement('p');
  error.className = 'note error';
  error.hidden = true;
  form.append(who, note, add);
  row.append(start, form, error);
  let chosen: { path: string; family: string; file: string } | null = null;
  start.addEventListener('click', () => {
    error.hidden = true;
    void window.pulp.chooseFont().then((result) => {
      if (result === null) return;
      if ('error' in result) {
        error.hidden = false;
        error.textContent = result.error;
        return;
      }
      chosen = result;
      who.textContent = `${result.family} — its licence is yours to know. A note to keep with it:`;
      form.hidden = false;
      note.value = '';
      note.focus();
    });
  });
  const finish = () => {
    if (!chosen) return;
    add.disabled = true;
    void window.pulp.importFont(chosen.path, note.value).then((result) => {
      add.disabled = false;
      if ('error' in result) {
        error.hidden = false;
        error.textContent = result.error;
        return;
      }
      form.hidden = true;
      chosen = null;
      onDone();
    });
  };
  add.addEventListener('click', finish);
  note.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish();
    }
  });
  // Clicks inside the form must not count as choosing a family or as clicking outside the list.
  row.addEventListener('click', (e) => e.stopPropagation());
  return row;
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
 * A picture layer's card takes a drop from the results: a still replaces an
 * image layer's picture, a clip a video layer's clip. A drop of the wrong kind
 * is refused on the card itself rather than silently swapping a layer's type,
 * which would move it in the stack and lose its settings.
 */
function acceptItemDrop(section: HTMLElement, block: string, layer: ImageLayer | VideoLayer): void {
  const wants = layer.type === 'video' ? 'video' : 'image';
  const entryFor = (id: string) => appState.value.index?.media.find((m) => m.id === id);
  section.addEventListener('dragover', (e) => {
    const id = e.dataTransfer?.types.includes(COLLECTION_DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    section.classList.add('drop-target');
  });
  for (const type of ['dragleave', 'dragend', 'drop'] as const) {
    section.addEventListener(type, () => section.classList.remove('drop-target'));
  }
  section.addEventListener('drop', (e) => {
    const id = e.dataTransfer?.getData(COLLECTION_DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    const entry = entryFor(id);
    if (!entry || entry.offline || entry.mediaKind !== wants) return;
    editLayer(block, layer.id, (l) =>
      l.type === 'video'
        ? { ...l, clip: { ...EMPTY_CLIP, id } }
        : { ...l, image: { id, treatment: 'original', tint: '#ffffff', effect: 'none', hidden: false, ...browsedPsdChoice(id) } },
    true);
    commitParams();
    // The card shows what the layer holds, so it is rebuilt: the field's own display was made
    // from the value as it was.
    const selected = selectedTemplate.value;
    if (selected) buildParamForm(selected.manifest);
  });
}

/** A layer's card in the tab, by the ids the stack carries; escaped, so the selector is only ever a lookup. */
function layerCardEl(block: string, id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#params .param-card[data-block="${CSS.escape(block)}"][data-layer="${CSS.escape(id)}"]`);
}

/**
 * Open a layer's card for the stage (milestone 39): the drawer forward on
 * Parameters, the layer selected, the card unfolded if it was folded and
 * brought into view, then `then` with the card to finish the job. The form is
 * rebuilt on every change, so this waits a frame and looks the card up again
 * rather than holding an element that may be gone by then.
 */
function openLayerCard(block: string, id: string, then: (card: HTMLElement) => void): void {
  selectedLayer.value = { block, id };
  openInspector('parameters');
  requestAnimationFrame(() => {
    const card = layerCardEl(block, id);
    if (!card) return;
    const body = card.querySelector<HTMLElement>('.card-body');
    // A folded card has nothing to reach into: open it the way pressing its heading would.
    if (body?.hidden) card.querySelector<HTMLButtonElement>('.card-toggle')?.click();
    card.scrollIntoView({ block: 'nearest' });
    then(card);
  });
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
    // Dropping a library item on a picture layer's card replaces what it shows (milestone 26).
    const { block, layer } = card.layer;
    if (layer.type === 'image' || layer.type === 'video') acceptItemDrop(section, block, layer);
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
  if (card.layer) {
    head.append(layerActions(card.layer.block, card.layer.layer, card.layer.index, card.layer.count));
    // Touching a layer's card selects it on the stage, the same selection the stage sets (milestone 25).
    const choice = { block: card.layer.block, id: card.layer.layer.id };
    toggle.addEventListener('click', () => (selectedLayer.value = choice));
    if (selectedLayer.value?.block === choice.block && selectedLayer.value?.id === choice.id) section.classList.add('stage-selected');
  }
  section.append(head);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.hidden = !open;
  if (card.layer) body.append(...layerBody(card.layer.block, card.layer.layer));
  for (const param of card.params) body.append(paramField(param, card.label));
  // How long the graphic runs for belongs with the layout and the timing (milestone 30), and only
  // a template that says which part of itself may stretch can be asked.
  if (card.kind === 'rest') {
    const field = lengthField();
    if (field) body.append(field);
  }
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
  // A template with no parameters and no layers still has something to edit when it declares
  // what may stretch: how long the graphic runs for (milestone 30).
  if (parameters.length === 0 && manifest.blocks.length === 0 && !manifest.structure) {
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
    // The unheaded form has no "Layout and timing" card to put it in, so the length goes last,
    // where that card would have been (milestone 30).
    const length = lengthField();
    if (length) els.params.append(length);
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

  // The stage edits layers through the tab's own machinery (milestone 25): the same live-edit
  // path, the same commit, so a drag is one undo step and every redraw goes one way.
  registerLayerEditor({
    edit: (block, id, change, commit) => {
      editLayer(block, id, change, commit);
      if (commit) commitParams();
    },
    get: (block, id) => currentLayers()[block]?.find((l) => l.id === id),
    commit: () => {
      commitParams();
      const selected = selectedTemplate.value;
      if (selected) buildParamForm(selected.manifest);
    },
    setLength: (length, commit) => setLength(length, commit),
    addLayer: (type, label, itemId) => {
      const selected = selectedTemplate.value;
      if (!selected) return { refused: 'No template is open.' };
      // The first block that takes added layers. A template whose blocks are all closed has
      // decided its stack is its own, and a drop says so rather than quietly doing nothing.
      const block = selected.manifest.blocks.find((b) => b.open);
      if (!block) return { refused: 'This template does not take added layers.' };
      const layers = currentLayers();
      const stack = layers[block.id] ?? [];
      const fresh = addedLayer(type, block, stack, label);
      const layer = itemId === undefined
        ? fresh
        : type === 'video'
          ? { ...fresh, clip: { ...EMPTY_CLIP, id: itemId } }
          : { ...fresh, image: { id: itemId, treatment: 'original' as const, tint: '#ffffff', effect: 'none' as const, hidden: false, ...browsedPsdChoice(itemId) } };
      setLayers({ ...layers, [block.id]: [...stack, layer as Layer] }, true);
      return { block: block.id, id: fresh.id };
    },
    editText: (block, id) => openLayerCard(block, id, (card) => {
      const field = card.querySelector<HTMLInputElement>('.layer-text');
      if (!field) return;
      field.focus();
      // The words are there to be typed over, so they arrive selected.
      field.select();
    }),
    choosePicture: (block, id) => openLayerCard(block, id, (card) => {
      // Whatever opens this layer's chooser: the picture's own well, the clip's Choose button.
      const opener = card.querySelector<HTMLButtonElement>('.picker-toggle');
      // It toggles, so an already-open chooser is left alone rather than shut.
      if (card.querySelector<HTMLElement>('.image-picker')?.hidden) opener?.click();
      opener?.focus();
    }),
    stack: (block) => currentLayers()[block],
    blocks: () => (selectedTemplate.value?.manifest.blocks ?? []).map((b) => ({ id: b.id, label: b.label, open: b.open })),
    setStack: (block, layers) => {
      setLayers({ ...currentLayers(), [block]: [...layers] }, true);
      commitParams();
    },
  });

  // The stage's selection lights the layer's card and brings it into view, both ways.
  effect(() => {
    const chosen = selectedLayer.value;
    document.querySelectorAll('#params .param-card.stage-selected').forEach((el) => el.classList.remove('stage-selected'));
    if (!chosen) return;
    const card = layerCardEl(chosen.block, chosen.id);
    if (card) {
      card.classList.add('stage-selected');
      card.scrollIntoView({ block: 'nearest' });
    }
  });
}
