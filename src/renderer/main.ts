import type { LibraryEntry, LibraryIndex, TemplateEntry } from '../core/library-types';
import { frameCount, type TemplateParameter } from '../core/manifest';
import { resolveParams, type ResolvedParams } from '../core/params';
import { OUTPUT_PRESETS, PRESET_IDS, type PresetId } from '../core/render-plan';
import { frameState } from '../core/runtime';
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
  preset: $<HTMLSelectElement>('preset'),
  presetNote: $<HTMLParagraphElement>('preset-note'),
  render: $<HTMLButtonElement>('render'),
  cancel: $<HTMLButtonElement>('cancel'),
  progress: $<HTMLProgressElement>('progress'),
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
  rendering: boolean;
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
  rendering: false,
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
  state.rawParams = {};
  state.params = resolveParams(entry.manifest).values;
  state.frame = 0;
  state.previewReady = false;

  const m = entry.manifest;
  els.previewFrame.style.aspectRatio = `${m.width} / ${m.height}`;
  els.previewFrame.classList.toggle('checker', m.alpha);
  els.previewEmpty.hidden = true;
  els.preview.src = templateUrlFor(m.id, m.entry);
  els.scrub.max = String(frameCount(m) - 1);
  els.scrub.value = '0';
  els.details.textContent = [m.description, `License: ${m.license}`, m.author ? `Author: ${m.author}` : '']
    .filter(Boolean)
    .join('  ·  ');

  buildParamForm(m.parameters);
  updateControls();
  renderResults();
}

function inputFor(param: TemplateParameter): HTMLElement {
  const value = state.params[param.id];
  const onChange = (v: unknown) => {
    state.rawParams[param.id] = v;
    if (!state.selected) return;
    state.params = resolveParams(state.selected.manifest, state.rawParams).values;
    requestFrame(state.frame);
  };

  switch (param.type) {
    case 'text': {
      const el = param.multiline ? document.createElement('textarea') : document.createElement('input');
      if (el instanceof HTMLInputElement) el.type = 'text';
      el.value = String(value);
      if (param.maxLength) el.maxLength = param.maxLength;
      el.addEventListener('input', () => onChange(el.value));
      return el;
    }
    case 'color': {
      // <input type=color> has no alpha; keep any alpha suffix from the default.
      const el = document.createElement('input');
      el.type = 'color';
      const hex = String(value);
      const alpha = hex.length === 9 ? hex.slice(7) : '';
      el.value = hex.slice(0, 7);
      el.addEventListener('input', () => onChange(el.value + alpha));
      return el;
    }
    case 'number': {
      const el = document.createElement('input');
      el.type = 'number';
      el.value = String(value);
      if (param.min !== undefined) el.min = String(param.min);
      if (param.max !== undefined) el.max = String(param.max);
      if (param.step !== undefined) el.step = String(param.step);
      el.addEventListener('input', () => onChange(el.value));
      return el;
    }
    case 'boolean': {
      const el = document.createElement('input');
      el.type = 'checkbox';
      el.checked = Boolean(value);
      el.addEventListener('change', () => onChange(el.checked));
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
      el.addEventListener('change', () => onChange(el.value));
      return el;
    }
  }
}

function buildParamForm(parameters: TemplateParameter[]): void {
  els.params.replaceChildren();
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
    const span = document.createElement('span');
    span.textContent = param.label;
    if (param.description) label.title = param.description;
    const input = inputFor(param);
    if (param.type === 'boolean') label.append(input, span);
    else label.append(span, input);
    els.params.append(label);
  }
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
  els.timecode.textContent = `${(frame / m.fps).toFixed(2)}s · ${frame + 1}/${frameCount(m)}`;
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
    els.presetNote.textContent = OUTPUT_PRESETS[els.preset.value as PresetId].description;
  };
  els.preset.addEventListener('change', showNote);
  showNote();
}

function updateControls(): void {
  const hasTemplate = state.selected !== null;
  els.play.disabled = !hasTemplate || !state.previewReady;
  els.scrub.disabled = !hasTemplate;
  els.render.disabled = !hasTemplate || !state.ffmpegOk || state.rendering;
  els.cancel.hidden = !state.rendering;
  els.progress.hidden = !state.rendering;
}

async function startRender(): Promise<void> {
  if (!state.selected) return;
  stop();
  state.rendering = true;
  els.progress.value = 0;
  els.renderStatus.classList.remove('error');
  els.renderStatus.textContent = 'Choose where to save...';
  updateControls();
  try {
    const result = await window.pulp.render({
      templateId: state.selected.manifest.id,
      params: state.rawParams,
      presetId: els.preset.value as PresetId,
    });
    if (result.ok) {
      els.renderStatus.textContent = `Wrote ${result.output} (${result.frames} frames).${
        result.warnings.length ? ` Warnings: ${result.warnings.join('; ')}` : ''
      }`;
    } else {
      els.renderStatus.classList.toggle('error', !result.cancelled);
      els.renderStatus.textContent = result.message;
    }
  } finally {
    state.rendering = false;
    updateControls();
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
els.render.addEventListener('click', () => void startRender());
els.cancel.addEventListener('click', () => void window.pulp.cancelRender());
els.params.addEventListener('submit', (e) => e.preventDefault());
window.pulp.onRenderProgress(({ frame, totalFrames }) => {
  els.progress.value = frame / totalFrames;
  els.renderStatus.textContent = `Rendering frame ${frame} of ${totalFrames}...`;
});

populatePresets();
updateControls();
void loadLibrary(window.pulp.getLibrary());
void window.pulp.ffmpegStatus().then((info) => {
  state.ffmpegOk = info.ok;
  els.ffmpegStatus.classList.toggle('error', !info.ok);
  els.ffmpegStatus.textContent = info.ok ? `ffmpeg ${info.version} (${info.path})` : (info.message ?? 'ffmpeg not found');
  updateControls();
});
