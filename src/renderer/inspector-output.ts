/**
 * The inspector's Output tab: output preset, frame rate, background, trim, Render
 * and the CSV batch. Reads the selected template from the shared signal and the
 * raw parameters from the Parameters tab's API; publishes whether rendering is
 * possible through the renderBlocked signal, which the tray's Prepare button follows.
 */

import { effect } from '@preact/signals';
import { planBatch, type BatchPlan } from '../core/batch-csv';
import { presetUnavailableReason } from '../core/ffmpeg-presets';
import { frameCount } from '../core/manifest';
import { OUTPUT_PRESETS, PRESET_IDS, RenderPlanError, resolveTiming, type PresetId, type RenderOptions } from '../core/render-plan';
import { formatTimecode, parseTimecode, STANDARD_FRAME_RATES, TimecodeError, timecodePattern } from '../core/timecode';
import type { TemplateEntry } from '../core/library-types';
import { currentRawParams } from './inspector-params';
import { stageStop } from './stage';
import { renderBlocked, selectedTemplate, trim } from './store';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
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
  dragPrepare: $<HTMLButtonElement>('drag-prepare'),
  dragStatus: $<HTMLParagraphElement>('drag-status'),
  renderStatus: $<HTMLParagraphElement>('render-status'),
  batchCsv: $<HTMLTextAreaElement>('batch-csv'),
  batchFile: $<HTMLButtonElement>('batch-file'),
  batchFileInput: $<HTMLInputElement>('batch-file-input'),
  batchPreview: $<HTMLButtonElement>('batch-preview'),
  batchQueue: $<HTMLButtonElement>('batch-queue'),
  batchSummary: $<HTMLDivElement>('batch-summary'),
};

const o = {
  ffmpegOk: false,
  /** Waiting for the save dialog after a click on Render. */
  choosingOutput: false,
  /** False while the frame rate or trim fields hold something the planner rejects. */
  optionsValid: true,
  /** The last previewed batch, ready to queue. */
  batch: null as BatchPlan | null,
  /** A prepare-for-drag is in flight. */
  preparing: false,
};

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
  return selectedTemplate.value?.manifest.fps;
}

/**
 * The render options as entered; blank fields mean the template's own value.
 * In and out points are parsed at the chosen frame rate; a TimecodeError names the bad field.
 */
export function readRenderOptions(): RenderOptions {
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

/** The frame a trim field holds at the chosen rate, or null when it is blank or unreadable. */
function trimField(el: HTMLInputElement): number | null {
  const fps = chosenFps();
  if (el.value.trim() === '' || fps === undefined) return null;
  try {
    return parseTimecode(el.value, fps);
  } catch {
    return null;
  }
}

/** Hand the trim to the stage, which marks it on the scrub bar. */
function publishTrim(): void {
  const next = { inFrame: trimField(els.optIn), outFrame: trimField(els.optOut) };
  if (next.inFrame !== trim.value.inFrame || next.outFrame !== trim.value.outFrame) trim.value = next;
}

/** Take a trim set from the stage into the fields, in the chosen rate's timecode form. */
function showTrim(): void {
  const fps = chosenFps();
  if (fps === undefined) return;
  let changed = false;
  for (const [el, frame] of [
    [els.optIn, trim.value.inFrame],
    [els.optOut, trim.value.outFrame],
  ] as const) {
    if (trimField(el) === frame && (frame !== null || el.value.trim() === '')) continue;
    el.value = frame === null ? '' : formatTimecode(frame, fps);
    changed = true;
  }
  if (changed) updateOptionsNote();
}

/** Say what the options amount to (frames and rate), or why the planner would refuse them. */
function updateOptionsNote(): void {
  const m = selectedTemplate.value?.manifest;
  if (!m) {
    els.optionsNote.textContent = '';
    o.optionsValid = true;
    updateRenderControls();
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
    o.optionsValid = true;
  } catch (err) {
    els.optionsNote.classList.add('error');
    els.optionsNote.textContent = err instanceof RenderPlanError || err instanceof TimecodeError ? err.message : String(err);
    o.optionsValid = false;
  }
  updateRenderControls();
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
    const first = Array.from(els.preset.options).find((opt) => !opt.disabled);
    if (first) {
      els.preset.value = first.value;
      els.preset.dispatchEvent(new Event('change'));
    }
  }
  els.presetUnavailable.hidden = reasons.length === 0;
  els.presetUnavailable.textContent = reasons.length ? `Unavailable: ${reasons.join(' ')}` : '';
}

export function updateRenderControls(): void {
  const selected = selectedTemplate.value;
  els.render.disabled = !selected || !o.ffmpegOk || o.choosingOutput || !o.optionsValid || selected.offline === true;
  els.dragPrepare.disabled = els.render.disabled || o.preparing;
  renderBlocked.value = els.render.disabled;
}

/**
 * Render into the cache and leave a card in the tray to drag from. An action on
 * the item being looked at, next to Render, rather than a panel of its own.
 */
async function prepareForDrag(): Promise<void> {
  const request = buildRenderRequest();
  if (!request) return;
  o.preparing = true;
  els.dragStatus.classList.remove('error');
  els.dragStatus.textContent = '';
  updateRenderControls();
  try {
    const result = await window.pulp.prepareDrag(request);
    if (!result.ok) {
      els.dragStatus.classList.add('error');
      els.dragStatus.textContent = result.message;
      return;
    }
    // Either way a card is waiting in the tray; the card says the rest.
    els.dragStatus.textContent = result.cached ? 'Ready to drag, in the tray.' : 'Rendering for drag; the tray shows it.';
  } finally {
    o.preparing = false;
    updateRenderControls();
  }
}

/** The request a render or a prepared drag would carry, or null when nothing is selected. */
export function buildRenderRequest(): { templateId: string; params: Record<string, unknown>; presetId: PresetId; options: RenderOptions } | null {
  const selected = selectedTemplate.value;
  if (!selected) return null;
  return { templateId: selected.manifest.id, params: currentRawParams(), presetId: els.preset.value as PresetId, options: readRenderOptions() };
}

/** Ask for an output path and add the render to the queue; the queue list shows progress and results. */
async function queueRender(): Promise<void> {
  const request = buildRenderRequest();
  if (!request) return;
  stageStop();
  o.choosingOutput = true;
  els.renderStatus.classList.remove('error');
  els.renderStatus.textContent = 'Choose where to save…';
  updateRenderControls();
  try {
    const result = await window.pulp.render(request);
    if (result.ok) {
      els.renderStatus.textContent = '';
    } else {
      els.renderStatus.classList.toggle('error', !result.cancelled);
      els.renderStatus.textContent = result.cancelled ? '' : result.message;
    }
  } finally {
    o.choosingOutput = false;
    updateRenderControls();
  }
}

// ---------------------------------------------------------------- batch from CSV

function previewBatch(): void {
  const selected = selectedTemplate.value;
  if (!selected) return;
  const plan = planBatch(selected.manifest, els.batchCsv.value);
  o.batch = plan;
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
  els.batchQueue.disabled = plan.rows.length === 0 || plan.columns.length === 0 || !o.ffmpegOk || !o.optionsValid;
}

async function queueBatch(): Promise<void> {
  const selected = selectedTemplate.value;
  if (!selected || !o.batch || o.batch.rows.length === 0) return;
  els.batchQueue.disabled = true;
  try {
    const result = await window.pulp.renderBatch({
      templateId: selected.manifest.id,
      presetId: els.preset.value as PresetId,
      options: readRenderOptions(),
      rows: o.batch.rows.map((r) => ({ label: r.label, fileName: r.fileName, params: r.params })),
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

// ---------------------------------------------------------------- region API

/** A template was selected: its own rate labels the list, trims from the last template are cleared. */
export function outputShow(entry: TemplateEntry): void {
  els.optFps.options[0]!.textContent = `Template rate (${entry.manifest.fps} fps)`;
  els.optFps.value = '';
  els.optIn.value = '';
  els.optOut.value = '';
  els.dragStatus.textContent = '';
  trim.value = { inFrame: null, outFrame: null };
  o.batch = null;
  els.batchSummary.textContent = '';
  els.batchQueue.disabled = true;
  updateOptionsNote();
}

/** ffmpeg detection finished: presets the build cannot write are disabled with the reason. */
export function outputSetFfmpeg(ok: boolean, encoders: readonly string[]): void {
  o.ffmpegOk = ok;
  if (ok) markPresetAvailability(encoders);
  updateRenderControls();
}

export function initInspectorOutput(): void {
  populatePresets();
  populateFrameRates();
  for (const el of [els.optIn, els.optOut]) {
    el.addEventListener('input', () => {
      updateOptionsNote();
      publishTrim();
    });
  }
  els.optFps.addEventListener('change', () => {
    updateOptionsNote();
    // The same text means a different frame at another rate.
    publishTrim();
  });
  effect(() => {
    void trim.value;
    showTrim();
  });
  els.preset.addEventListener('change', updateOptionsNote);
  els.render.addEventListener('click', () => void queueRender());
  els.dragPrepare.addEventListener('click', () => void prepareForDrag());
  els.batchCsv.addEventListener('input', () => {
    els.batchPreview.disabled = !selectedTemplate.value || els.batchCsv.value.trim() === '';
    els.batchQueue.disabled = true;
    o.batch = null;
  });
  els.batchFile.addEventListener('click', () => els.batchFileInput.click());
  els.batchFileInput.addEventListener('change', () => {
    const file = els.batchFileInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      els.batchCsv.value = text;
      els.batchPreview.disabled = !selectedTemplate.value;
      previewBatch();
    });
  });
  els.batchPreview.addEventListener('click', previewBatch);
  els.batchQueue.addEventListener('click', () => void queueBatch());
  updateRenderControls();
}
