/**
 * The inspector's Output tab: output preset, frame rate, background, trim, Render
 * and the CSV batch. Reads the selected template from the shared signal and the
 * raw parameters from the Parameters tab's API; publishes whether rendering is
 * possible through the renderBlocked signal, which the tray's Prepare button follows.
 */

import { effect } from '@preact/signals';
import { AspectError, aspectById, defaultAspect, orientationOf, resolutionsFor, resolveRenderSize, templateDefaultSize, type Size } from '../core/aspect';
import { planBatch, type BatchPlan } from '../core/batch-csv';
import { dimensionsLabel } from '../core/display';
import { presetUnavailableReason } from '../core/ffmpeg-presets';
import { OUTPUT_PRESETS, PRESET_IDS, RenderPlanError, resolveTiming, type AudioOptions, type PresetId, type RenderOptions } from '../core/render-plan';
import { AUDIO_PRESET_IDS, AUDIO_PRESETS, DEFAULT_STILL_SECONDS, isAudioPresetId, mediaDefaultFps, NOT_MEASURED, resolveMediaTiming, sourceFromEntry } from '../core/media-render';
import type { MediaEntry } from '../core/library-types';
import { browsedHiddenChoice } from './psd-state';
import { formatTimecode, parseTimecode, STANDARD_FRAME_RATES, TimecodeError, timecodePattern } from '../core/timecode';
import type { TemplateEntry } from '../core/library-types';
import { currentRawParams } from './inspector-params';
import { lengthIn } from '../core/params';
import { lengthFrameCount, resolveLength } from '../core/timing';
import { stageStop } from './stage';
import { appState, dispatch, frameSize, preferredAspect, renderBlocked, selectedTemplate, trim } from './store';
import { setCollection, setEditing } from '../core/app-state';
import { updateItem } from '../core/collection';
import { editing } from './collection';
import { paramsApply } from './inspector-params';
import { sanitizePsdChoice } from '../core/image-slot';
import { setPsdHidden } from './psd-state';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  preset: $<HTMLSelectElement>('preset'),
  presetNote: $<HTMLParagraphElement>('preset-note'),
  presetUnavailable: $<HTMLParagraphElement>('preset-unavailable'),
  optAspectField: $<HTMLLabelElement>('opt-aspect-field'),
  optAspect: $<HTMLSelectElement>('opt-aspect'),
  optResolution: $<HTMLSelectElement>('opt-resolution'),
  optSizeCustom: $<HTMLDivElement>('opt-size-custom'),
  optWidth: $<HTMLInputElement>('opt-width'),
  optHeight: $<HTMLInputElement>('opt-height'),
  optFps: $<HTMLSelectElement>('opt-fps'),
  optBackgroundField: $<HTMLLabelElement>('opt-background-field'),
  optBackground: $<HTMLInputElement>('opt-background'),
  optIn: $<HTMLInputElement>('opt-in'),
  optOut: $<HTMLInputElement>('opt-out'),
  optionsNote: $<HTMLParagraphElement>('options-note'),
  // Rendering media itself (milestone 15).
  mediaOptions: $<HTMLDivElement>('media-options'),
  optLength: $<HTMLInputElement>('opt-length'),
  optSpeedField: $<HTMLLabelElement>('opt-speed-field'),
  optSpeed: $<HTMLInputElement>('opt-speed'),
  optCrossfadeField: $<HTMLLabelElement>('opt-crossfade-field'),
  optCrossfade: $<HTMLInputElement>('opt-crossfade'),
  optMatteField: $<HTMLLabelElement>('opt-matte-field'),
  optTintField: $<HTMLLabelElement>('opt-tint-field'),
  optTintOn: $<HTMLInputElement>('opt-tint-on'),
  optTint: $<HTMLInputElement>('opt-tint'),
  optMatte: $<HTMLInputElement>('opt-matte'),
  audioOptions: $<HTMLDivElement>('audio-options'),
  optSampleRate: $<HTMLSelectElement>('opt-sample-rate'),
  optChannels: $<HTMLSelectElement>('opt-channels'),
  optBitDepth: $<HTMLSelectElement>('opt-bit-depth'),
  batch: $<HTMLDetailsElement>('batch'),
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
  /** True while a collection card is being loaded into the fields, so the write-back stays quiet. */
  loadingCard: false,
  writeToCard: null as null | ((patch: { presetId?: string; options?: RenderOptions; params?: Record<string, unknown> }) => void),
  /** Set by the orchestrator: show a template by its manifest id. */
  showTemplate: null as null | ((templateId: string) => void),
  /** The media item the tab is set up for, when it is one rather than a template (milestone 15). */
  media: null as MediaEntry | null,
  /** What the detected ffmpeg can encode, kept so the preset list can be rebuilt for a sound. */
  encoders: [] as readonly string[],
  /** Which list the preset select holds now. */
  presetKind: 'video' as 'video' | 'audio',
};

/** The orchestrator owns selection, so it lends the Output tab a way to show a card's template. */
export function setTemplateShower(fn: (templateId: string) => void): void {
  o.showTemplate = fn;
}

/**
 * The preset list: the video presets for a template, a clip or a still; the
 * audio presets for a sound (milestone 15). Rebuilt when the kind changes,
 * with what this ffmpeg cannot write disabled.
 */
function listPresets(kind: 'video' | 'audio'): void {
  const keep = els.preset.value;
  els.preset.replaceChildren();
  for (const id of kind === 'audio' ? AUDIO_PRESET_IDS : PRESET_IDS) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = kind === 'audio' ? AUDIO_PRESETS[id as keyof typeof AUDIO_PRESETS].label : OUTPUT_PRESETS[id as PresetId].label;
    els.preset.append(opt);
  }
  o.presetKind = kind;
  if (Array.from(els.preset.options).some((opt) => opt.value === keep)) els.preset.value = keep;
  if (o.ffmpegOk) markPresetAvailability(o.encoders);
  showPresetNote();
}

/** What the chosen preset is, under the select; the background only matters when an alpha picture is flattened. */
function showPresetNote(): void {
  const id = els.preset.value;
  if (isAudioPresetId(id)) {
    els.presetNote.textContent = AUDIO_PRESETS[id].description;
    els.optBackgroundField.hidden = true;
    return;
  }
  const preset = OUTPUT_PRESETS[id as PresetId];
  if (!preset) return;
  els.presetNote.textContent = preset.description;
  els.optBackgroundField.hidden = preset.alpha;
}

function populatePresets(): void {
  listPresets('video');
  els.preset.addEventListener('change', showPresetNote);
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

// ---------------------------------------------------------------- shape and size (milestone 19)

const CUSTOM_SIZE = 'custom';

function orientationWord(aspectId: string): string {
  const a = aspectById(aspectId);
  if (!a) return '';
  return { landscape: 'Landscape', portrait: 'Portrait', square: 'Square' }[orientationOf(a.w, a.h)];
}

/** The aspect select lists what the template draws for; it is shown only when there is a choice to make. */
function populateAspects(m: { aspects: readonly string[]; size?: Size }): void {
  els.optAspect.replaceChildren();
  for (const id of m.aspects) {
    const opt = document.createElement('option');
    opt.value = id;
    const word = orientationWord(id);
    opt.textContent = word ? `${id} · ${word}` : id;
    els.optAspect.append(opt);
  }
  // The session's preferred shape wins where the template draws it (milestone 31).
  const preferred = preferredAspect.peek();
  els.optAspect.value = preferred && m.aspects.includes(preferred) ? preferred : defaultAspect(m);
  els.optAspectField.hidden = m.aspects.length < 2;
}

/** The resolutions for the chosen aspect: the template's own size first where it has one, then the standard list, then a custom size. */
function populateResolutions(m: { aspects: readonly string[]; size?: Size }): void {
  const aspect = els.optAspect.value || defaultAspect(m);
  const fallback = resolveRenderSize(m, { aspect });
  els.optResolution.replaceChildren();
  const def = document.createElement('option');
  def.value = '';
  def.textContent = `${m.size && defaultAspect(m) === aspect ? 'Template size' : 'Default'} · ${dimensionsLabel(fallback.width, fallback.height)}`;
  els.optResolution.append(def);
  for (const r of resolutionsFor(m, aspect)) {
    if (r.width === fallback.width && r.height === fallback.height) continue;
    const opt = document.createElement('option');
    opt.value = `${r.width}x${r.height}`;
    opt.textContent = `${r.label} · ${dimensionsLabel(r.width, r.height)}`;
    els.optResolution.append(opt);
  }
  const custom = document.createElement('option');
  custom.value = CUSTOM_SIZE;
  custom.textContent = 'Custom size…';
  els.optResolution.append(custom);
  els.optResolution.value = '';
  els.optSizeCustom.hidden = true;
  els.optWidth.placeholder = String(fallback.width);
  els.optHeight.placeholder = String(fallback.height);
}

/** The shape and size fields as render options: nothing for the defaults, so a plain render stays a plain request. */
function readSizeChoice(): Pick<RenderOptions, 'aspect' | 'width' | 'height'> {
  const m = selectedTemplate.value?.manifest;
  const out: Pick<RenderOptions, 'aspect' | 'width' | 'height'> = {};
  if (!m && o.media) {
    // A media item has no aspects to choose from: its own size, or the custom one typed in.
    if (els.optResolution.value === CUSTOM_SIZE) {
      out.width = els.optWidth.value.trim() === '' ? Number.NaN : Number(els.optWidth.value);
      out.height = els.optHeight.value.trim() === '' ? Number.NaN : Number(els.optHeight.value);
    }
    return out;
  }
  if (!m) return out;
  if (!els.optAspectField.hidden && els.optAspect.value && els.optAspect.value !== defaultAspect(m)) out.aspect = els.optAspect.value;
  const chosen = els.optResolution.value;
  if (chosen === CUSTOM_SIZE) {
    // Whatever was typed goes through as typed; the planner says what is wrong with it.
    out.width = els.optWidth.value.trim() === '' ? Number.NaN : Number(els.optWidth.value);
    out.height = els.optHeight.value.trim() === '' ? Number.NaN : Number(els.optHeight.value);
    if (out.aspect === undefined && !els.optAspectField.hidden) out.aspect = els.optAspect.value;
  } else if (chosen) {
    const [w, h] = chosen.split('x').map(Number);
    out.width = w;
    out.height = h;
  }
  return out;
}

/** Tell the stage what shape to preview; the template's default when the fields do not resolve. */
function publishFrameSize(): void {
  const m = selectedTemplate.value?.manifest;
  if (!m) {
    frameSize.value = null;
    return;
  }
  let next: Size;
  try {
    const r = resolveRenderSize(m, readSizeChoice());
    next = { width: r.width, height: r.height };
  } catch {
    next = templateDefaultSize(m);
  }
  if (frameSize.value?.width !== next.width || frameSize.value?.height !== next.height) frameSize.value = next;
}

/** Put a card's or a request's size choice back into the fields. */
function showSizeChoice(m: { aspects: readonly string[]; size?: Size }, options: RenderOptions): void {
  populateAspects(m);
  if (options.aspect && m.aspects.includes(options.aspect)) els.optAspect.value = options.aspect;
  else if (options.width && options.height) {
    const inferred = m.aspects.find((a) => {
      try {
        return resolveRenderSize(m, { aspect: a, width: options.width!, height: options.height! }).aspect === a;
      } catch {
        return false;
      }
    });
    if (inferred) els.optAspect.value = inferred;
  }
  populateResolutions(m);
  if (options.width && options.height) {
    const value = `${options.width}x${options.height}`;
    const fallback = resolveRenderSize(m, { aspect: els.optAspect.value || defaultAspect(m) });
    if (options.width === fallback.width && options.height === fallback.height) els.optResolution.value = '';
    else if (Array.from(els.optResolution.options).some((o) => o.value === value)) els.optResolution.value = value;
    else {
      els.optResolution.value = CUSTOM_SIZE;
      els.optWidth.value = String(options.width);
      els.optHeight.value = String(options.height);
    }
  }
  els.optSizeCustom.hidden = els.optResolution.value !== CUSTOM_SIZE;
}

/** The output frame rate as currently chosen: the override, or the template's — or the media item's own. */
function chosenFps(): number | undefined {
  if (els.optFps.value !== '') return Number(els.optFps.value);
  if (selectedTemplate.value) return selectedTemplate.value.manifest.fps;
  return o.media ? mediaDefaultFps(o.media) : undefined;
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
  const preset = OUTPUT_PRESETS[els.preset.value as PresetId];
  if (preset && !preset.alpha) options.background = els.optBackground.value;
  Object.assign(options, readSizeChoice());
  if (preset && !els.optMatteField.hidden && els.optMatte.checked) options.matte = true;
  if (o.media) {
    // What a media item renders with beyond a template's options (milestone 15). A blank field is "as it is".
    const number = (el: HTMLInputElement): number | undefined => (el.value.trim() === '' ? undefined : Number(el.value));
    const length = number(els.optLength);
    if (length !== undefined) options.length = length;
    const speed = els.optSpeedField.hidden ? undefined : number(els.optSpeed);
    if (speed !== undefined && speed !== 1) options.speed = speed;
    const crossfade = els.optCrossfadeField.hidden ? undefined : number(els.optCrossfade);
    if (crossfade !== undefined) options.crossfade = crossfade;
    if (!els.optTintField.hidden && els.optTintOn.checked) options.tint = els.optTint.value;
    if (!els.audioOptions.hidden) {
      const audio: AudioOptions = {};
      if (els.optSampleRate.value) audio.sampleRate = Number(els.optSampleRate.value);
      if (els.optChannels.value) audio.channels = Number(els.optChannels.value);
      if (els.optBitDepth.value === '24') audio.bitDepth = 24;
      if (Object.keys(audio).length > 0) options.audio = audio;
    }
  }
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
  if (!m && o.media) {
    updateMediaOptionsNote(o.media);
    return;
  }
  if (!m) {
    els.optionsNote.textContent = '';
    o.optionsValid = true;
    updateRenderControls();
    return;
  }
  const fps = chosenFps() ?? m.fps;
  // The length chosen in the Parameters tab (milestone 30): a trim is taken within it, so the
  // placeholders and the summary below are of the graphic as it will be rendered.
  const length = resolveLength(m.duration, m.structure ?? null, lengthIn(currentRawParams()));
  // Placeholders show the range at the chosen rate, in that rate's timecode form.
  const lastFrame = Math.max(1, Math.round(length * fps)) - 1;
  els.optIn.placeholder = formatTimecode(0, fps);
  els.optOut.placeholder = formatTimecode(lastFrame, fps);
  els.optIn.title = els.optOut.title = `Timecode ${timecodePattern(fps)}, a frame number, or seconds such as 2.5s`;
  try {
    const options = { ...readRenderOptions(), ...(length !== m.duration ? { length } : {}) };
    const t = resolveTiming(m, options);
    const size = resolveRenderSize(m, options);
    const own = templateDefaultSize(m);
    const seconds = t.totalFrames / t.fps;
    const parts: string[] = [];
    if (size.width !== own.width || size.height !== own.height) parts.push(`${dimensionsLabel(size.width, size.height)} (${size.aspect})`);
    // A length set in the Parameters tab is said here too, since this is where a render is set up.
    if (t.length !== m.duration) parts.push(`${t.length} s long (designed at ${m.duration} s)`);
    if (t.fps !== m.fps || t.totalFrames !== lengthFrameCount(t.length, t.fps) || t.firstFrame !== 0) {
      const last = t.firstFrame + t.totalFrames - 1;
      parts.push(`${t.totalFrames} frames at ${t.fps} fps (${seconds.toFixed(2)} s), ${formatTimecode(t.firstFrame, t.fps)} to ${formatTimecode(last, t.fps)}`);
    }
    els.optionsNote.classList.remove('error');
    els.optionsNote.textContent = parts.join(' · ');
    o.optionsValid = true;
  } catch (err) {
    els.optionsNote.classList.add('error');
    els.optionsNote.textContent = err instanceof RenderPlanError || err instanceof TimecodeError || err instanceof AspectError ? err.message : String(err);
    o.optionsValid = false;
  }
  publishFrameSize();
  updateRenderControls();
}

/**
 * What a media render amounts to (milestone 15): the length, the loop and its
 * crossfade, the frames, the size — or why the planner would refuse it. An
 * item the library has not measured yet is not refused: the render measures
 * it, so the note says so and the button stays live.
 */
function updateMediaOptionsNote(entry: MediaEntry): void {
  const source = sourceFromEntry(entry);
  const fps = chosenFps() ?? mediaDefaultFps(entry);
  els.optIn.placeholder = formatTimecode(0, fps);
  els.optIn.title = els.optOut.title = `Timecode ${timecodePattern(fps)}, a frame number, or seconds such as 2.5s`;
  els.optLength.placeholder = source.kind === 'image' ? `${DEFAULT_STILL_SECONDS} s` : source.duration ? `${source.duration.toFixed(2)} s, as it is` : 'as it is';
  try {
    const options = readRenderOptions();
    const t = resolveMediaTiming(source, options);
    const last = t.firstFrame + t.totalFrames - 1;
    els.optOut.placeholder = formatTimecode(Math.max(1, Math.round(t.length * t.fps)) - 1, t.fps);
    const parts: string[] = [];
    if (t.loops) parts.push(t.crossfade > 0 ? `loops to ${t.length} s with a ${t.crossfade} s crossfade` : `loops to ${t.length} s`);
    else if (options.length !== undefined && source.kind !== 'image') parts.push(`cut to ${t.length} s`);
    if (t.speed !== 1) parts.push(`at ×${t.speed}`);
    if (source.kind !== 'audio') {
      const size = options.width && options.height ? dimensionsLabel(options.width, options.height) : source.width && source.height ? dimensionsLabel(source.width, source.height) : '';
      if (size && (options.width || options.height)) parts.push(size);
      parts.push(`${t.totalFrames} frames at ${t.fps} fps (${(t.totalFrames / t.fps).toFixed(2)} s), ${formatTimecode(t.firstFrame, t.fps)} to ${formatTimecode(last, t.fps)}`);
    } else {
      parts.push(`${(t.totalFrames / t.fps).toFixed(2)} s of sound`);
    }
    if (options.tint) parts.push(`recoloured ${options.tint}`);
    if (options.matte) parts.push('with a matte file');
    els.optionsNote.classList.remove('error');
    els.optionsNote.textContent = parts.join(' · ');
    o.optionsValid = true;
  } catch (err) {
    const message = err instanceof RenderPlanError || err instanceof TimecodeError ? err.message : String(err);
    const unmeasured = message.includes(NOT_MEASURED);
    // Not measured yet is not wrong: the render reads the file itself.
    els.optionsNote.classList.toggle('error', !unmeasured);
    els.optionsNote.textContent = unmeasured ? 'Not measured yet; the render reads the file as it starts.' : message;
    o.optionsValid = unmeasured;
  }
  updateRenderControls();
}

/** Disable presets the detected ffmpeg cannot write and say why; move the selection off a disabled one. */
function markPresetAvailability(encoders: readonly string[]): void {
  const reasons: string[] = [];
  for (const opt of Array.from(els.preset.options)) {
    let label: string;
    let reason: string | null;
    if (isAudioPresetId(opt.value)) {
      const preset = AUDIO_PRESETS[opt.value];
      label = preset.label;
      reason = preset.encoder.startsWith('pcm') || encoders.includes(preset.encoder) ? null : `needs the ${preset.encoder} encoder`;
    } else {
      const preset = OUTPUT_PRESETS[opt.value as PresetId];
      label = preset.label;
      reason = presetUnavailableReason(encoders, preset);
    }
    opt.disabled = reason !== null;
    opt.textContent = reason ? `${label} (unavailable)` : label;
    if (reason) reasons.push(`${label}: ${reason}.`);
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

/**
 * Read the options again and say what they amount to. The Parameters tab calls
 * this when the graphic's length changes (milestone 30): a trim is taken
 * within the length, so what this tab shows depends on it.
 */
export function outputRefreshOptions(): void {
  updateOptionsNote();
}

export function updateRenderControls(): void {
  const selected = selectedTemplate.value;
  const shown = selected ?? o.media;
  els.render.disabled = !shown || !o.ffmpegOk || o.choosingOutput || !o.optionsValid || shown.offline === true;
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

/** The output preset as chosen now, for anything that wants to record it. */
export function currentPresetId(): PresetId {
  return els.preset.value as PresetId;
}

/** The render options as entered, or none when a field is unreadable. */
export function currentOptions(): RenderOptions {
  try {
    return readRenderOptions();
  } catch {
    return {};
  }
}

/** The request a render or a prepared drag would carry, or null when nothing is selected. */
export function buildRenderRequest(): { templateId?: string; mediaId?: string; params: Record<string, unknown>; presetId: PresetId; options: RenderOptions } | null {
  const selected = selectedTemplate.value;
  if (selected) return { templateId: selected.manifest.id, params: currentRawParams(), presetId: els.preset.value as PresetId, options: readRenderOptions() };
  if (!o.media) return null;
  // A layered still renders as it is browsed: the hidden layers travel in the params (milestone 33).
  const psd = browsedHiddenChoice(o.media);
  return { mediaId: o.media.id, params: psd ? { psd } : {}, presetId: els.preset.value as PresetId, options: readRenderOptions() };
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
    if (result.ok) div.textContent = `Queued ${result.jobIds.length} renders into ${result.folder}.${result.skipped?.length ? ` Skipped ${result.skipped.length}: ${result.skipped.join('; ')}` : ''}`;
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

/** The fields a media item has and a template does not, shown or hidden as one. */
function showMediaFields(entry: MediaEntry | null): void {
  els.mediaOptions.hidden = entry === null;
  els.batch.hidden = entry !== null;
  els.optAspectField.hidden = entry !== null || els.optAspectField.hidden;
  if (!entry) {
    els.optMatteField.hidden = false;
    return;
  }
  const kind = entry.sequence ? 'video' : entry.mediaKind;
  els.optSpeedField.hidden = kind === 'image';
  els.optCrossfadeField.hidden = kind === 'image';
  els.audioOptions.hidden = kind !== 'audio';
  // A sound has no picture to flatten, fit, matte or recolour.
  els.optMatteField.hidden = kind === 'audio';
  els.optTintField.hidden = kind === 'audio';
  els.optResolution.parentElement!.hidden = kind === 'audio';
  els.optBackgroundField.hidden = kind === 'audio' || els.optBackgroundField.hidden;
}

/** A media item was selected (milestone 15): the tab is set up for it as it is for a template. */
export function outputShowMedia(entry: MediaEntry): void {
  o.media = entry;
  const kind = entry.sequence ? 'video' : entry.mediaKind;
  if ((kind === 'audio') !== (o.presetKind === 'audio')) listPresets(kind === 'audio' ? 'audio' : 'video');
  // The size list: the item's own size, or a custom one.
  els.optAspect.replaceChildren();
  els.optResolution.replaceChildren();
  const own = document.createElement('option');
  own.value = '';
  own.textContent = entry.meta?.width && entry.meta.height ? `As it is · ${dimensionsLabel(entry.meta.width, entry.meta.height)}` : 'As it is';
  const custom = document.createElement('option');
  custom.value = CUSTOM_SIZE;
  custom.textContent = 'Custom size…';
  els.optResolution.append(own, custom);
  els.optResolution.value = '';
  els.optSizeCustom.hidden = true;
  els.optWidth.value = '';
  els.optHeight.value = '';
  const source = sourceFromEntry(entry);
  els.optFps.options[0]!.textContent = kind === 'image' ? 'Still (30 fps)' : kind === 'audio' ? 'Timecode at 25 fps' : `Clip rate${source.fps ? ` (${source.fps} fps)` : ''}`;
  els.optFps.value = '';
  els.optIn.value = '';
  els.optOut.value = '';
  els.optLength.value = '';
  els.optSpeed.value = '';
  els.optCrossfade.value = '';
  els.optMatte.checked = false;
  els.optTintOn.checked = false;
  els.optTint.hidden = true;
  els.optSampleRate.value = '';
  els.optChannels.value = '';
  els.optBitDepth.value = '16';
  els.dragStatus.textContent = '';
  trim.value = { inFrame: null, outFrame: null };
  showMediaFields(entry);
  showPresetNote();
  updateOptionsNote();
}

/** Nothing is shown: the tab waits, its media fields put away. */
export function outputClear(): void {
  o.media = null;
  showMediaFields(null);
  updateOptionsNote();
}

/** A template was selected: its own rate labels the list, trims from the last template are cleared. */
export function outputShow(entry: TemplateEntry): void {
  o.media = null;
  if (o.presetKind !== 'video') listPresets('video');
  showMediaFields(null);
  populateAspects(entry.manifest);
  populateResolutions(entry.manifest);
  els.optWidth.value = '';
  els.optHeight.value = '';
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
  o.encoders = encoders;
  if (ok) markPresetAvailability(encoders);
  updateRenderControls();
}

/**
 * Editing a collection card. Choosing one in the tray hands it to these tabs:
 * its preset and options fill the fields, and every change goes back to the
 * card, so an item is edited with the same controls as anything else.
 */
function initCollectionEditing(): void {
  const note = $('editing-note');
  const write = (patch: { presetId?: string; options?: RenderOptions; params?: Record<string, unknown> }) => {
    const uid = appState.value.editing;
    if (uid === null) return;
    dispatch((s) => setCollection(s, updateItem(s.collection, uid, patch)));
  };
  o.writeToCard = write;

  // Loading a card into the tabs; the flag stops the write-back from echoing it straight back.
  // One effect, not two, so the template is selected before its parameters are applied.
  effect(() => {
    const item = editing.value;
    note.hidden = item === null;
    if (!item) return;
    o.loadingCard = true;
    try {
      $('editing-note-text').textContent = `Editing ${item.name} in the collection.`;
      // Show the item itself, so the Parameters tab is this card's template and not whatever was last clicked.
      if (item.templateId) o.showTemplate?.(item.templateId);
      // A media card (milestone 15): the tab is set up for the item, then its settings fill the fields.
      const mediaEntry = item.kind === 'media' ? appState.value.index?.media.find((m) => m.id === item.id) : undefined;
      if (mediaEntry && o.media?.id !== mediaEntry.id) outputShowMedia(mediaEntry);
      if (mediaEntry) {
        els.optLength.value = item.options.length === undefined ? '' : String(item.options.length);
        els.optSpeed.value = item.options.speed === undefined ? '' : String(item.options.speed);
        els.optCrossfade.value = item.options.crossfade === undefined ? '' : String(item.options.crossfade);
        els.optMatte.checked = item.options.matte === true;
        els.optTintOn.checked = item.options.tint !== undefined;
        els.optTint.hidden = item.options.tint === undefined;
        if (item.options.tint) els.optTint.value = item.options.tint;
        els.optSampleRate.value = item.options.audio?.sampleRate ? String(item.options.audio.sampleRate) : '';
        els.optChannels.value = item.options.audio?.channels ? String(item.options.audio.channels) : '';
        els.optBitDepth.value = item.options.audio?.bitDepth === 24 ? '24' : '16';
        if (item.options.width && item.options.height) {
          els.optResolution.value = CUSTOM_SIZE;
          els.optSizeCustom.hidden = false;
          els.optWidth.value = String(item.options.width);
          els.optHeight.value = String(item.options.height);
        }
      }
      els.preset.value = item.presetId;
      els.preset.dispatchEvent(new Event('change'));
      els.optFps.value = item.options.fps === undefined ? '' : String(item.options.fps);
      const fps = item.options.fps ?? selectedTemplate.value?.manifest.fps ?? 25;
      els.optIn.value = item.options.inFrame === undefined ? '' : formatTimecode(item.options.inFrame, fps);
      els.optOut.value = item.options.outFrame === undefined ? '' : formatTimecode(item.options.outFrame, fps);
      if (item.options.background !== undefined) els.optBackground.value = item.options.background;
      if (selectedTemplate.value && item.templateId === selectedTemplate.value.manifest.id) showSizeChoice(selectedTemplate.value.manifest, item.options);
      updateOptionsNote();
      // Only when the form really is this template's, or the values would land on the wrong one.
      if (item.templateId && selectedTemplate.value?.manifest.id === item.templateId) paramsApply(item.params);
      // A layered still collected with layers hidden (milestone 33): choosing its card brings that
      // list back into the session, so the stage and the Info tab show the picture it was collected as.
      if (item.kind === 'media') {
        const psd = sanitizePsdChoice((item.params as { psd?: unknown }).psd);
        if (psd?.hide) setPsdHidden(item.id, psd.hide);
      }
    } finally {
      o.loadingCard = false;
    }
  });

  $('editing-done').addEventListener('click', () => dispatch((s) => setEditing(s, null)));
}

/** Push what the Output tab now says onto the card being edited, if there is one. */
export function saveToEditedCard(): void {
  if (o.loadingCard || appState.value.editing === null) return;
  o.writeToCard?.({ presetId: els.preset.value, options: currentOptions() });
}

/** Push the parameters onto the card being edited; called when the form commits. */
export function saveParamsToEditedCard(params: Record<string, unknown>): void {
  if (o.loadingCard || appState.value.editing === null) return;
  o.writeToCard?.({ params });
}

export function initInspectorOutput(): void {
  initCollectionEditing();
  populatePresets();
  populateFrameRates();
  for (const el of [els.optIn, els.optOut]) {
    el.addEventListener('input', () => {
      updateOptionsNote();
      publishTrim();
      saveToEditedCard();
    });
  }
  els.optFps.addEventListener('change', () => {
    updateOptionsNote();
    // The same text means a different frame at another rate.
    publishTrim();
    saveToEditedCard();
  });
  effect(() => {
    void trim.value;
    showTrim();
  });
  els.preset.addEventListener('change', () => {
    updateOptionsNote();
    saveToEditedCard();
  });
  els.optAspect.addEventListener('change', () => {
    // A new shape has its own list of sizes; the choice goes back to that shape's default.
    const m = selectedTemplate.value?.manifest;
    if (m) populateResolutions(m);
    updateOptionsNote();
    saveToEditedCard();
  });
  els.optResolution.addEventListener('change', () => {
    els.optSizeCustom.hidden = els.optResolution.value !== CUSTOM_SIZE;
    if (!els.optSizeCustom.hidden) els.optWidth.focus();
    updateOptionsNote();
    saveToEditedCard();
  });
  for (const el of [els.optWidth, els.optHeight]) {
    el.addEventListener('input', () => {
      updateOptionsNote();
      saveToEditedCard();
    });
  }
  for (const el of [els.optLength, els.optSpeed, els.optCrossfade, els.optWidth, els.optHeight]) {
    el.addEventListener('input', () => {
      updateOptionsNote();
      saveToEditedCard();
    });
  }
  els.optTintOn.addEventListener('change', () => {
    els.optTint.hidden = !els.optTintOn.checked;
    updateOptionsNote();
    saveToEditedCard();
  });
  els.optTint.addEventListener('input', () => {
    updateOptionsNote();
    saveToEditedCard();
  });
  for (const el of [els.optMatte, els.optSampleRate, els.optChannels, els.optBitDepth]) {
    el.addEventListener('change', () => {
      updateOptionsNote();
      saveToEditedCard();
    });
  }
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
