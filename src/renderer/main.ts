import type { LibraryEntry, LibraryIndex, TemplateEntry } from '../core/library-types';
import { frameCount, type TemplateParameter } from '../core/manifest';
import { resolveParams, type ResolvedParams } from '../core/params';
import { alphaToPercent, joinColor, parseColorText, percentToAlpha, splitColor, toCssRgba } from '../core/color';
import { presetUnavailableReason } from '../core/ffmpeg-presets';
import { History } from '../core/history';
import { addRecentColor } from '../core/recent-colors';
import { OUTPUT_PRESETS, PRESET_IDS, RenderPlanError, resolveTiming, type PresetId, type RenderOptions } from '../core/render-plan';
import { isFinished, type RenderQueueJob, type RenderQueueSnapshot } from '../core/render-queue';
import { frameState } from '../core/runtime';
import { formatTimecode, parseTimecode, STANDARD_FRAME_RATES, TimecodeError, timecodePattern } from '../core/timecode';
import { searchLibrary } from '../core/search';
import { templateUrlFor } from '../shared/api';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  search: $<HTMLInputElement>('search'),
  addFolder: $<HTMLButtonElement>('add-folder'),
  rescan: $<HTMLButtonElement>('rescan'),
  results: $<HTMLUListElement>('results'),
  summary: $<HTMLDivElement>('library-summary'),
  previewFrame: $<HTMLDivElement>('preview-frame'),
  preview: $<HTMLIFrameElement>('preview'),
  previewEmpty: $<HTMLDivElement>('preview-empty'),
  play: $<HTMLButtonElement>('play'),
  scrub: $<HTMLInputElement>('scrub'),
  timecode: $<HTMLSpanElement>('timecode'),
  details: $<HTMLDivElement>('details'),
  params: $<HTMLFormElement>('params'),
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
  queue: $<HTMLUListElement>('queue'),
  clearFinished: $<HTMLButtonElement>('clear-finished'),
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
  choosingOutput: false,
  optionsValid: true,
};

// ---------------------------------------------------------------- library

function entryLabel(entry: LibraryEntry): { name: string; meta: string } {
  if (entry.kind === 'template') {
    const m = entry.manifest;
    return { name: m.name, meta: `${m.category} · ${m.duration}s · ${m.width}x${m.height}${m.alpha ? ' · alpha' : ''}` };
  }
  return { name: entry.name, meta: `${entry.mediaKind} · ${entry.ext.slice(1)} · ${formatBytes(entry.size)}` };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function renderResults(): void {
  const index = state.index;
  els.results.replaceChildren();
  if (!index) return;
  const hits = searchLibrary(index, els.search.value);
  for (const { entry } of hits.slice(0, 500)) {
    const li = document.createElement('li');
    const { name, meta } = entryLabel(entry);
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = name;
    const metaEl = document.createElement('span');
    metaEl.className = 'meta';
    metaEl.textContent = entry.tags.length ? `${meta} · ${entry.tags.join(', ')}` : meta;
    li.append(nameEl, metaEl);
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(state.selected?.key === entry.key));
    li.addEventListener('click', () => select(entry));
    els.results.append(li);
  }
  if (hits.length === 0) {
    const li = document.createElement('li');
    li.className = 'meta';
    li.textContent = 'No matches.';
    els.results.append(li);
  }

  els.summary.replaceChildren();
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
  const index = await next;
  if (!index) return;
  state.index = index;
  if (state.selected) {
    const still = index.templates.find((t) => t.manifest.id === state.selected?.manifest.id);
    if (!still) clearSelection();
  }
  renderResults();
}

// ---------------------------------------------------------------- selection + params

function clearSelection(): void {
  state.selected = null;
  state.previewReady = false;
  stop();
  els.preview.removeAttribute('src');
  els.previewEmpty.hidden = false;
  els.params.replaceChildren();
  els.details.textContent = '';
  updateControls();
}

function select(entry: LibraryEntry): void {
  if (entry.kind === 'media') {
    clearSelection();
    els.previewEmpty.textContent = 'Media preview is not implemented yet.';
    els.details.textContent = entry.path;
    renderResults();
    return;
  }
  stop();
  state.selected = entry;
  // Each template keeps its own edits and undo history while the app runs.
  state.rawParams = { ...editorFor(entry.manifest.id).current };
  state.params = resolveParams(entry.manifest, state.rawParams).values;
  state.frame = 0;
  state.previewReady = false;

  const m = entry.manifest;
  els.previewFrame.style.aspectRatio = `${m.width} / ${m.height}`;
  els.previewFrame.classList.toggle('checker', m.alpha);
  els.previewEmpty.hidden = true;
  els.preview.src = templateUrlFor(m.id, m.entry);
  els.scrub.max = String(frameCount(m) - 1);
  els.scrub.value = '0';
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
  updateControls();
  renderResults();
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
  els.render.disabled = !hasTemplate || !state.ffmpegOk || state.choosingOutput || !state.optionsValid;
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

function jobStatusText(job: RenderQueueJob): string {
  switch (job.status) {
    case 'queued':
      return `Queued · ${job.totalFrames} frames`;
    case 'running':
      return `Rendering frame ${job.frame} of ${job.totalFrames}...`;
    case 'done':
      return `Wrote ${job.output ?? job.outputPath} (${job.frame} frames).${
        job.warnings.length ? ` Warnings: ${job.warnings.join('; ')}` : ''
      }`;
    case 'failed':
    case 'cancelled':
      return job.message ?? job.status;
  }
}

function renderQueue(snapshot: RenderQueueSnapshot): void {
  els.queue.replaceChildren();
  els.clearFinished.disabled = !snapshot.jobs.some(isFinished);
  if (snapshot.jobs.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No renders yet.';
    els.queue.append(li);
    return;
  }
  for (const job of snapshot.jobs) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'job-head';
    const name = document.createElement('span');
    name.className = 'job-name';
    name.textContent = job.templateName;
    const preset = document.createElement('span');
    preset.className = 'job-preset';
    preset.textContent = OUTPUT_PRESETS[job.presetId as PresetId]?.label ?? job.presetId;
    head.append(name, preset);
    li.append(head);

    if (job.status === 'running') {
      const bar = document.createElement('progress');
      bar.max = 1;
      bar.value = job.totalFrames > 0 ? job.frame / job.totalFrames : 0;
      li.append(bar);
    }

    const status = document.createElement('div');
    status.className = `job-status ${job.status === 'failed' ? 'error' : job.status}`;
    status.textContent = jobStatusText(job);
    status.title = job.outputPath;
    li.append(status);

    if (!isFinished(job)) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'job-cancel';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => void window.pulp.cancelRender(job.id));
      li.append(cancel);
    }
    els.queue.append(li);
  }
}

// ---------------------------------------------------------------- wiring

els.search.addEventListener('input', renderResults);
els.addFolder.addEventListener('click', () => void loadLibrary(window.pulp.addLibraryFolder()));
els.rescan.addEventListener('click', () => void loadLibrary(window.pulp.rescanLibrary()));
els.play.addEventListener('click', () => (state.playing ? stop() : play()));
els.scrub.addEventListener('input', () => {
  stop();
  requestFrame(Number(els.scrub.value));
});
els.render.addEventListener('click', () => void queueRender());
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
els.clearFinished.addEventListener('click', () => void window.pulp.clearFinishedRenders());
els.params.addEventListener('submit', (e) => e.preventDefault());
window.pulp.onRenderQueue(renderQueue);

populatePresets();
populateFrameRates();
updateControls();
renderQueue({ jobs: [] });
void window.pulp.getRenderQueue().then(renderQueue);
void window.pulp.getRecentColors().then(setRecentColors);
void loadLibrary(window.pulp.getLibrary());
void window.pulp.ffmpegStatus().then((info) => {
  state.ffmpegOk = info.ok;
  els.ffmpegStatus.classList.toggle('error', !info.ok);
  els.ffmpegStatus.textContent = info.ok ? `ffmpeg ${info.version} (${info.path})` : (info.message ?? 'ffmpeg not found');
  if (info.ok) markPresetAvailability(info.encoders ?? []);
  updateControls();
});
