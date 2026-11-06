/**
 * The inspector's Output tab: output preset, frame rate, background, trim, Render
 * and the CSV batch. Reads the selected template from the shared signal and the
 * raw parameters from the Parameters tab's API; publishes whether rendering is
 * possible through the renderBlocked signal, which the tray's Prepare button follows.
 */

import { effect, signal, untracked } from '@preact/signals';
import { bindAttr, bindText, t, whenLocaleChanges } from './i18n';
import type { MessageId } from '../core/i18n';
import { AspectError, aspectById, defaultAspect, orientationOf, resolutionsFor, resolveRenderSize, templateDefaultSize, type Size } from '../core/aspect';
import { planBatch, type BatchPlan } from '../core/batch-csv';
import { dimensionsLabel } from '../core/display';
import { presetUnavailableReason } from '../core/ffmpeg-presets';
import { coverFrameWithin, OUTPUT_PRESETS, PRESET_IDS, RenderPlanError, resolveTiming, type AudioOptions, type CaptionsMode, type PresetId, type RenderOptions } from '../core/render-plan';
import { AUDIO_PRESET_IDS, AUDIO_PRESETS, DEFAULT_STILL_SECONDS, isAudioPresetId, MediaNotMeasuredError, mediaDefaultFps, resolveMediaTiming, sourceFromEntry } from '../core/media-render';
import type { MediaEntry } from '../core/library-types';
import { browsedHiddenChoice } from './psd-state';
import { formatTimecode, parseTimecode, STANDARD_FRAME_RATES, TimecodeError, timecodePattern } from '../core/timecode';
import type { TemplateEntry } from '../core/library-types';
import { currentRawParams } from './inspector-params';
import { captionsIn, LAYERS_KEY } from '../core/params';
import { lengthIn } from '../core/params';
import { layersHaveStems, soundIdsInLayers } from '../core/sound-layer';
import { lengthFrameCount, resolveLength } from '../core/timing';
import { stageStop } from './stage';
import { appState, coverFrame, dispatch, frameSize, playheadSeconds, preferredAspect, preferredPlatform, renderBlocked, selectedTemplate, trim } from './store';
import {
  PLATFORM_PRESETS, platformLimitsLabel, platformPreset, platformSummary, platformWarningsBefore, type PlatformPreset,
} from '../core/platform-presets';
import { templateType, TYPES } from '../core/taxonomy';
import { defaultGuidedChoices, type GuidedChoices } from '../core/guided-setup';
import { openGuidedSetup } from './guided-setup';
import { assetPresetsFor, type AssetOutputPreset, type TypeOutputDefault } from '../core/output-defaults';
import type { TemplateManifest } from '../core/manifest';
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
  optPlatformField: $<HTMLLabelElement>('opt-platform-field'),
  optPlatform: $<HTMLSelectElement>('opt-platform'),
  platformNote: $<HTMLParagraphElement>('platform-note'),
  platformWarnings: $<HTMLParagraphElement>('platform-warnings'),
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
  optLut: $<HTMLButtonElement>('opt-lut'),
  optLutName: $<HTMLSpanElement>('opt-lut-name'),
  optLutClear: $<HTMLButtonElement>('opt-lut-clear'),
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
  /** How the project's captions reach the render (milestone 50); shown only while the project has any. */
  optCaptionsField: $<HTMLLabelElement>('opt-captions-field'),
  optCaptions: $<HTMLSelectElement>('opt-captions'),
  /** How music that came in as stems reaches the render (milestone 16); shown only while the project has stems. */
  optStemsField: $<HTMLLabelElement>('opt-stems-field'),
  optStems: $<HTMLSelectElement>('opt-stems'),
  /** Guided setup (milestone 14): the launcher; the dialog itself is src/renderer/guided-setup.ts. */
  guidedField: $<HTMLDivElement>('guided-field'),
  guidedOpen: $<HTMLButtonElement>('guided-open'),
  /** One-click output presets per kind of asset, and the type's remembered default (milestone 14). */
  assetPresets: $<HTMLDivElement>('asset-presets'),
  assetPresetButtons: $<HTMLDivElement>('asset-preset-buttons'),
  typeDefaultRow: $<HTMLDivElement>('type-default-row'),
  typeDefaultSave: $<HTMLButtonElement>('type-default-save'),
  typeDefaultClear: $<HTMLButtonElement>('type-default-clear'),
  typeDefaultNote: $<HTMLParagraphElement>('type-default-note'),
  optCoverField: $<HTMLDivElement>('opt-cover-field'),
  optCover: $<HTMLInputElement>('opt-cover'),
  optCoverRow: $<HTMLDivElement>('opt-cover-row'),
  optCoverAt: $<HTMLInputElement>('opt-cover-at'),
  optCoverHere: $<HTMLButtonElement>('opt-cover-here'),
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

/** Words that are not a message — the main process's, a path — where a message's stamp may be left from before. */
function setPlain(el: HTMLElement, text: string): void {
  delete el.dataset.i18n;
  delete el.dataset.i18nValues;
  el.textContent = text;
}

/** An attribute this code fills with something other than a message: the markup's stamp for it is taken off, so a change of language leaves it be. */
function setPlainAttr(el: HTMLElement, name: string, value: string): void {
  const pairs = (el.dataset.i18nAttr ?? '').split(';').filter((p) => p && p.split(':')[0] !== name);
  if (pairs.length > 0) el.dataset.i18nAttr = pairs.join(';');
  else delete el.dataset.i18nAttr;
  el.setAttribute(name, value);
}

const o = {
  ffmpegOk: false,
  /** The .cube graded over the whole render (milestone 52), as chosen; null is no grade. */
  lutPath: null as string | null,
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
  /** The Output tab's remembered settings per template type (milestone 14), from settings.json. */
  typeDefaults: {} as Record<string, TypeOutputDefault>,
  /** Which list the preset select holds now. */
  presetKind: 'video' as 'video' | 'audio',
  /** What the chosen platform could not set, said under it; kept as words to say, so a change of language says them again. */
  platformMissed: [] as readonly (() => string)[],
  /** The CSV the last preview was planned from, so a change of language can plan it again in the new words. */
  batchCsv: '',
  /** The line a queued batch left under the preview, as words to say. */
  batchQueued: null as null | { say: () => string; warning: boolean },
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
  bindText(own, 'output.fps.template');
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

/** An aspect as the select lists it, "16:9 · Landscape", or null for one that is not built in (listed as its bare ratio). */
function orientationOption(aspectId: string): MessageId | null {
  const a = aspectById(aspectId);
  if (!a) return null;
  const options: Record<ReturnType<typeof orientationOf>, MessageId> = {
    landscape: 'output.aspect.landscape', portrait: 'output.aspect.portrait', square: 'output.aspect.square',
  };
  return options[orientationOf(a.w, a.h)];
}

/** The aspect select lists what the template draws for; it is shown only when there is a choice to make. */
function populateAspects(m: { aspects: readonly string[]; size?: Size }): void {
  els.optAspect.replaceChildren();
  for (const id of m.aspects) {
    const opt = document.createElement('option');
    opt.value = id;
    const option = orientationOption(id);
    if (option) bindText(opt, option, { aspect: id });
    else opt.textContent = id;
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
  bindText(def, m.size && defaultAspect(m) === aspect ? 'output.size.template' : 'output.size.default', { size: dimensionsLabel(fallback.width, fallback.height) });
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
  bindText(custom, 'output.size.custom');
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

// ---------------------------------------------------------------- platform presets (milestone 20)

/** The chooser: no platform, then the built-in list. */
function populatePlatforms(): void {
  const none = document.createElement('option');
  none.value = '';
  bindText(none, 'output.platform.none');
  els.optPlatform.append(none);
  for (const p of PLATFORM_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    els.optPlatform.append(opt);
  }
}

/** The platform the render is aimed at, as the chooser now stands. */
function chosenPlatform(): PlatformPreset | undefined {
  if (els.optPlatformField.hidden) return undefined;
  return platformPreset(els.optPlatform.value || undefined);
}

/** What the platform amounts to and what it takes, with the date those limits were read; `missed` is whatever could not be set. */
function showPlatformNote(missed: readonly (() => string)[] = []): void {
  o.platformMissed = missed;
  const p = chosenPlatform();
  const unset = missed.map((say) => say()).join('; ');
  els.platformNote.textContent = p ? [platformSummary(p), platformLimitsLabel(p), unset].filter(Boolean).join(' · ') : '';
}

/** Put a size into the resolution field: the default entry, a standard one, or a custom size typed in. */
function selectResolution(m: { aspects: readonly string[]; size?: Size } | undefined, width: number, height: number): void {
  if (m) {
    try {
      const fallback = resolveRenderSize(m, { aspect: els.optAspect.value || defaultAspect(m) });
      if (fallback.width === width && fallback.height === height) {
        els.optResolution.value = '';
        els.optSizeCustom.hidden = true;
        return;
      }
    } catch {
      // The fields hold something the planner refuses; the note already says so.
    }
  }
  const exact = `${width}x${height}`;
  if (Array.from(els.optResolution.options).some((opt) => opt.value === exact)) {
    els.optResolution.value = exact;
    els.optSizeCustom.hidden = true;
    return;
  }
  els.optResolution.value = CUSTOM_SIZE;
  els.optSizeCustom.hidden = false;
  els.optWidth.value = String(width);
  els.optHeight.value = String(height);
}

/**
 * Choosing a platform sets the four things it stands for at once: the aspect
 * where the item draws it, the resolution, the frame rate and the output
 * preset. What it cannot set it says rather than quietly leaving — a template
 * that does not draw 9:16 keeps the shape it has — and every field stays free
 * to change afterwards, since a preset is a starting point, not a lock.
 */
function applyPlatform(): void {
  const p = chosenPlatform();
  if (!p) {
    showPlatformNote();
    return;
  }
  const missed: (() => string)[] = [];
  // A media item has no aspects of its own to choose from, so every shape is its shape.
  const m = selectedTemplate.value?.manifest;
  const drawsIt = !m || m.aspects.includes(p.aspect);
  if (m && drawsIt) {
    els.optAspect.value = p.aspect;
    populateResolutions(m);
  } else if (m) {
    missed.push(() => t('output.platform.missed.aspect', { aspect: p.aspect }));
  }
  if (drawsIt) selectResolution(m, p.width, p.height);
  els.optFps.value = String(p.fps);
  const option = Array.from(els.preset.options).find((opt) => opt.value === p.presetId);
  if (option && !option.disabled) {
    els.preset.value = p.presetId;
    showPresetNote();
  } else if (option) {
    missed.push(() => t('output.platform.missed.preset', { preset: OUTPUT_PRESETS[p.presetId].label }));
  }
  showPlatformNote(missed);
}

/**
 * The length and file-size warnings before a render: the trim's own length
 * against what the platform takes, and what the preset's bitrate target says
 * the file will weigh. Never blocking — a limit may have moved since the list
 * was written, and the person rendering may know something it does not.
 */
function showPlatformWarnings(seconds: number | null): void {
  const p = chosenPlatform();
  const lines = p && seconds !== null ? platformWarningsBefore(p, seconds) : [];
  els.platformWarnings.hidden = lines.length === 0;
  els.platformWarnings.textContent = lines.join(' ');
}

/** The session's platform, taken up by the item now being shown (milestone 20). */
function applyPreferredPlatform(): void {
  const preferred = preferredPlatform.peek();
  els.optPlatform.value = preferred && platformPreset(preferred) && !els.optPlatformField.hidden ? preferred : '';
  if (els.optPlatform.value) applyPlatform();
  else showPlatformNote();
}

// ---------------------------------------------------------------- defaults per type, presets per kind (milestone 14)

/** The type a template's default is remembered under: declared, or mapped from its category; null where neither says. */
function typeKeyFor(manifest: TemplateManifest): string | null {
  return templateType(manifest) ?? null;
}

/** The type's display name, for the note under the save button. */
function typeLabelFor(type: string): string {
  return TYPES.find((t) => t.id === type)?.label ?? type;
}

/** What the controls hold that is worth remembering for a kind of thing; never the trim, the cover, a LUT or the captions. */
function readTypeDefault(): TypeOutputDefault | null {
  const presetId = els.preset.value as PresetId;
  if (!presetId) return null;
  const d: TypeOutputDefault = { presetId };
  if (!els.optAspectField.hidden && els.optAspect.value) d.aspect = els.optAspect.value;
  const size = readSizeChoice();
  if (Number.isInteger(size.width) && Number.isInteger(size.height)) {
    d.width = size.width!;
    d.height = size.height!;
  }
  if (els.optFps.value !== '') d.fps = Number(els.optFps.value);
  if (!els.optBackgroundField.hidden) d.background = els.optBackground.value;
  if (!els.optMatteField.hidden && els.optMatte.checked) d.matte = true;
  return d;
}

/**
 * Open the controls on the type's remembered default, each choice only where
 * this template can take it: a preset this ffmpeg writes, a shape it draws, a
 * rate the list offers. The session's platform lean is applied after this and
 * stays the stronger word where both speak.
 */
function applyTypeDefault(manifest: TemplateManifest): void {
  const type = typeKeyFor(manifest);
  const d = type ? o.typeDefaults[type] : undefined;
  if (!d) return;
  const presetOption = Array.from(els.preset.options).find((opt) => opt.value === d.presetId);
  if (presetOption && !presetOption.disabled) els.preset.value = d.presetId;
  if (d.aspect && manifest.aspects.includes(d.aspect)) {
    els.optAspect.value = d.aspect;
    populateResolutions(manifest);
  }
  if (d.width && d.height) selectResolution(manifest, d.width, d.height);
  if (d.fps !== undefined && Array.from(els.optFps.options).some((opt) => opt.value === String(d.fps))) {
    els.optFps.value = String(d.fps);
  }
  if (d.background !== undefined) els.optBackground.value = d.background;
  els.optMatte.checked = d.matte === true;
  showPresetNote();
}

/** The save-and-clear row under the preset: shown for a template with a type, saying when a default is held. */
function refreshTypeDefaultRow(manifest: TemplateManifest | null): void {
  const type = manifest ? typeKeyFor(manifest) : null;
  els.typeDefaultRow.hidden = type === null;
  if (type === null) return;
  const saved = o.typeDefaults[type] !== undefined;
  els.typeDefaultClear.hidden = !saved;
  els.typeDefaultNote.hidden = !saved;
  els.typeDefaultSave.setAttribute('aria-label', t('output.type-default.save.aria-label', { type: typeLabelFor(type) }));
  if (saved) {
    const d = o.typeDefaults[type]!;
    els.typeDefaultNote.textContent = t('output.type-default.note', { type: typeLabelFor(type), preset: OUTPUT_PRESETS[d.presetId]?.label ?? d.presetId });
  }
}

/** Write or clear the type's default and keep the row in step; the main process answers with the map as saved. */
async function saveTypeDefault(value: TypeOutputDefault | null): Promise<void> {
  const manifest = selectedTemplate.value?.manifest;
  const type = manifest ? typeKeyFor(manifest) : null;
  if (!manifest || !type) return;
  o.typeDefaults = await window.pulp.setTypeOutputDefault(type, value);
  refreshTypeDefaultRow(manifest);
}

// ---------------------------------------------------------------- guided setup (milestone 14)

/** What the wizard starts from and reasons over: the shown template and the tab's controls as they stand. */
export interface GuidedContext {
  entryId: string;
  manifest: TemplateManifest;
  choices: GuidedChoices;
  hasStems: boolean;
  hasLayerSound: boolean;
  presetDisabled: (id: string) => boolean;
}

/** The shown template with the controls read into the wizard's choices, or null while a media item or nothing is shown. */
export function outputGuidedContext(): GuidedContext | null {
  const entry = selectedTemplate.value;
  if (!entry || o.media !== null) return null;
  const m = entry.manifest;
  const choices = defaultGuidedChoices(m);
  const presetId = els.preset.value as PresetId;
  if (presetId && OUTPUT_PRESETS[presetId]) choices.presetId = presetId;
  if (els.optAspect.value && m.aspects.includes(els.optAspect.value)) choices.aspect = els.optAspect.value;
  const size = readSizeChoice();
  if (Number.isInteger(size.width) && Number.isInteger(size.height)) {
    choices.width = size.width!;
    choices.height = size.height!;
  }
  if (els.optFps.value !== '') choices.fps = Number(els.optFps.value);
  choices.background = els.optBackground.value;
  choices.matte = els.optMatte.checked;
  if (!els.optStemsField.hidden && els.optStems.value === 'files') choices.stems = 'files';
  if (els.optPlatform.value && platformPreset(els.optPlatform.value)) {
    choices.purpose = 'social';
    choices.platform = els.optPlatform.value;
  }
  const layers = currentRawParams()[LAYERS_KEY];
  return {
    entryId: entry.id,
    manifest: m,
    choices,
    hasStems: layersHaveStems(layers),
    hasLayerSound: soundIdsInLayers(layers).length > 0,
    presetDisabled: (id) => Array.from(els.preset.options).some((opt) => opt.value === id && opt.disabled),
  };
}

/**
 * The wizard finished: its choices land on the very controls this tab holds,
 * each only where the template can take it, exactly as a type default lands —
 * and may then be saved as one, which is the wizard's save-as-default box.
 */
export function outputApplyGuided(choices: GuidedChoices, saveDefault: boolean): void {
  const m = selectedTemplate.value?.manifest;
  if (!m) return;
  // The platform first, as the session's lean; the fields below say the wizard's own answers over it.
  els.optPlatform.value = choices.platform && platformPreset(choices.platform) ? choices.platform : '';
  preferredPlatform.value = els.optPlatform.value || null;
  showPlatformNote();
  const presetOption = Array.from(els.preset.options).find((opt) => opt.value === choices.presetId);
  if (presetOption && !presetOption.disabled) els.preset.value = choices.presetId;
  if (m.aspects.includes(choices.aspect)) {
    els.optAspect.value = choices.aspect;
    populateResolutions(m);
  }
  if (choices.width !== undefined && choices.height !== undefined) selectResolution(m, choices.width, choices.height);
  else {
    els.optResolution.value = '';
    els.optSizeCustom.hidden = true;
  }
  els.optFps.value = choices.fps !== undefined && Array.from(els.optFps.options).some((opt) => opt.value === String(choices.fps)) ? String(choices.fps) : '';
  els.optBackground.value = choices.background;
  els.optMatte.checked = choices.matte;
  if (!els.optStemsField.hidden) els.optStems.value = choices.stems;
  showPresetNote();
  updateOptionsNote();
  // A new rate means the same trim text is a different frame, as the rate field's own change does.
  publishTrim();
  publishCover();
  saveToEditedCard();
  if (saveDefault) void saveTypeDefault(readTypeDefault());
  else refreshTypeDefaultRow(m);
}

/**
 * One-click output presets per kind of asset: offered only where they fit —
 * a transparent overlay for anything drawn on alpha, the editor-safe pair, a
 * flat full-screen background. Clicking one sets the controls and nothing
 * more; "Save as default for this type" is how it becomes the standing answer.
 */
function renderAssetPresets(manifest: TemplateManifest | null): void {
  const offered = manifest ? assetPresetsFor(manifest) : [];
  els.assetPresets.hidden = offered.length === 0;
  els.assetPresetButtons.replaceChildren();
  for (const preset of offered) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost asset-preset';
    button.textContent = preset.label;
    button.dataset.preset = preset.id;
    button.dataset.tip = preset.tip;
    button.addEventListener('click', () => applyAssetPreset(preset));
    els.assetPresetButtons.append(button);
  }
}

function applyAssetPreset(preset: AssetOutputPreset): void {
  const option = Array.from(els.preset.options).find((opt) => opt.value === preset.choices.presetId);
  if (option && !option.disabled) els.preset.value = preset.choices.presetId;
  if (preset.choices.background !== undefined) els.optBackground.value = preset.choices.background;
  els.optMatte.checked = preset.choices.matte === true;
  showPresetNote();
  updateOptionsNote();
  saveToEditedCard();
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
  const point = (el: HTMLInputElement, field: MessageId): number | undefined => {
    if (el.value.trim() === '' || fps === undefined) return undefined;
    try {
      return parseTimecode(el.value, fps);
    } catch (err) {
      throw err instanceof TimecodeError ? new TimecodeError(t(field, { reason: err.message })) : err;
    }
  };
  const inFrame = point(els.optIn, 'output.trim.in.error');
  const outFrame = point(els.optOut, 'output.trim.out.error');
  if (inFrame !== undefined) options.inFrame = inFrame;
  if (outFrame !== undefined) options.outFrame = outFrame;
  const preset = OUTPUT_PRESETS[els.preset.value as PresetId];
  // A still image (milestone 44) is the frame at the playhead unless an in point says otherwise:
  // what is on the stage is what is written. Counted at the output rate; the planner holds it
  // within the timeline should the rounding land a frame past the end.
  if (preset?.still && inFrame === undefined && fps !== undefined) options.inFrame = Math.max(0, Math.round(playheadSeconds.peek() * fps));
  if (preset && !preset.alpha) options.background = els.optBackground.value;
  // The grade over the whole render (milestone 52).
  if (o.lutPath) options.lut = o.lutPath;
  // Where this is going (milestone 20): it changes no pixel, it is what the warnings are measured against.
  const platform = chosenPlatform();
  if (platform) options.platform = platform.id;
  Object.assign(options, readSizeChoice());
  if (preset && !els.optMatteField.hidden && els.optMatte.checked) options.matte = true;
  // The captions (milestone 50): only a choice other than the default is worth carrying.
  if (!els.optCaptionsField.hidden && els.optCaptions.value !== 'burn') options.captions = els.optCaptions.value as CaptionsMode;
  // The music's stems (milestone 16): only "files" is worth carrying; the mix is the default.
  if (!els.optStemsField.hidden && els.optStems.value === 'files') options.stems = 'files';
  // The cover image (milestone 20): a still of one frame beside the render. The frame is whatever
  // the field holds — filled from the playhead when the box is ticked, and editable after.
  if (preset && !els.optCoverField.hidden && els.optCover.checked) {
    const at = point(els.optCoverAt, 'output.cover.error');
    options.coverFrame = at ?? Math.max(0, Math.round(playheadSeconds.peek() * (fps ?? 30)));
  }
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

/**
 * The cover's own row and its mark on the scrub bar (milestone 20). Ticking
 * the box fills the frame from the playhead, so the picture on the stage is
 * the cover unless another frame is typed; the mark follows the field.
 */
function publishCover(): void {
  const on = els.optCover.checked && !els.optCoverField.hidden;
  els.optCoverRow.hidden = !on;
  if (!on) {
    if (coverFrame.value !== null) coverFrame.value = null;
    return;
  }
  const fps = chosenFps();
  if (els.optCoverAt.value.trim() === '' && fps !== undefined) {
    els.optCoverAt.value = formatTimecode(Math.max(0, Math.round(playheadSeconds.peek() * fps)), fps);
  }
  const at = trimField(els.optCoverAt);
  if (coverFrame.value !== at) coverFrame.value = at;
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
/** The shown item has edits behind the Output tab: the dot on the transport row's button (milestone 38). */
export const outputEdited = signal(false);

/** Anything set beyond the item's own: a trim, a rate, a custom size, the media extras, a matte or a tint. */
function noteEdits(): void {
  const text = [els.optIn, els.optOut, els.optWidth, els.optHeight, els.optLength, els.optCrossfade, els.optSampleRate, els.optChannels];
  outputEdited.value =
    text.some((el) => el.value.trim() !== '') ||
    els.optFps.value !== '' ||
    (els.optSpeed.value.trim() !== '' && els.optSpeed.value.trim() !== '1') ||
    els.optMatte.checked ||
    els.optTintOn.checked ||
    els.optBitDepth.value === '24';
}

function updateOptionsNote(): void {
  noteEdits();
  const m = selectedTemplate.value?.manifest;
  if (!m && o.media) {
    updateMediaOptionsNote(o.media);
    return;
  }
  if (!m) {
    els.optionsNote.textContent = '';
    showPlatformWarnings(null);
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
  setPlainAttr(els.optOut, 'placeholder', formatTimecode(lastFrame, fps));
  bindAttr(els.optIn, 'title', 'output.trim.title', { pattern: timecodePattern(fps) });
  bindAttr(els.optOut, 'title', 'output.trim.title', { pattern: timecodePattern(fps) });
  try {
    const options = { ...readRenderOptions(), ...(length !== m.duration ? { length } : {}) };
    const timing = resolveTiming(m, options);
    const size = resolveRenderSize(m, options);
    const own = templateDefaultSize(m);
    const seconds = timing.totalFrames / timing.fps;
    const parts: string[] = [];
    if (size.width !== own.width || size.height !== own.height) parts.push(`${dimensionsLabel(size.width, size.height)} (${size.aspect})`);
    // A length set in the Parameters tab is said here too, since this is where a render is set up.
    if (timing.length !== m.duration) parts.push(t('output.note.length', { length: timing.length, designed: m.duration }));
    if (timing.fps !== m.fps || timing.totalFrames !== lengthFrameCount(timing.length, timing.fps) || timing.firstFrame !== 0) {
      const last = timing.firstFrame + timing.totalFrames - 1;
      parts.push(t('output.note.frames', { frames: timing.totalFrames, fps: timing.fps, seconds: seconds.toFixed(2), from: formatTimecode(timing.firstFrame, timing.fps), to: formatTimecode(last, timing.fps) }));
    }
    // The cover beside it, and which frame it is taken at (milestone 20).
    if (options.coverFrame !== undefined) parts.push(t('output.note.cover-at', { at: formatTimecode(coverFrameWithin(options.coverFrame, timing.fps, timing.length), timing.fps) }));
    els.optionsNote.classList.remove('error');
    els.optionsNote.textContent = parts.join(' · ');
    showPlatformWarnings(seconds);
    o.optionsValid = true;
  } catch (err) {
    els.optionsNote.classList.add('error');
    els.optionsNote.textContent = err instanceof RenderPlanError || err instanceof TimecodeError || err instanceof AspectError ? err.message : String(err);
    showPlatformWarnings(null);
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
  bindAttr(els.optIn, 'title', 'output.trim.title', { pattern: timecodePattern(fps) });
  bindAttr(els.optOut, 'title', 'output.trim.title', { pattern: timecodePattern(fps) });
  if (source.kind === 'image') bindAttr(els.optLength, 'placeholder', 'output.media.length.still', { seconds: DEFAULT_STILL_SECONDS });
  else if (source.duration) bindAttr(els.optLength, 'placeholder', 'output.media.length.as-is', { seconds: source.duration.toFixed(2) });
  else bindAttr(els.optLength, 'placeholder', 'ui.opt-length.placeholder');
  try {
    const options = readRenderOptions();
    const timing = resolveMediaTiming(source, options);
    const last = timing.firstFrame + timing.totalFrames - 1;
    setPlainAttr(els.optOut, 'placeholder', formatTimecode(Math.max(1, Math.round(timing.length * timing.fps)) - 1, timing.fps));
    const parts: string[] = [];
    if (timing.loops) parts.push(timing.crossfade > 0 ? t('output.media.loops-crossfade', { length: timing.length, crossfade: timing.crossfade }) : t('output.media.loops', { length: timing.length }));
    else if (options.length !== undefined && source.kind !== 'image') parts.push(t('output.media.cut', { length: timing.length }));
    if (timing.speed !== 1) parts.push(t('output.media.speed', { speed: timing.speed }));
    if (source.kind !== 'audio') {
      const size = options.width && options.height ? dimensionsLabel(options.width, options.height) : source.width && source.height ? dimensionsLabel(source.width, source.height) : '';
      if (size && (options.width || options.height)) parts.push(size);
      parts.push(t('output.note.frames', { frames: timing.totalFrames, fps: timing.fps, seconds: (timing.totalFrames / timing.fps).toFixed(2), from: formatTimecode(timing.firstFrame, timing.fps), to: formatTimecode(last, timing.fps) }));
    } else {
      parts.push(t('output.media.sound-seconds', { seconds: (timing.totalFrames / timing.fps).toFixed(2) }));
    }
    if (options.tint) parts.push(t('output.media.tint', { color: options.tint }));
    if (options.matte) parts.push(t('output.media.matte'));
    if (!els.optCaptionsField.hidden) parts.push(options.captions === 'track' ? t('output.media.captions.track') : options.captions === 'none' ? t('output.media.captions.none') : t('output.media.captions.burn'));
    if (options.coverFrame !== undefined) parts.push(t('output.media.cover'));
    if (options.stems === 'files') parts.push(t('output.media.stems'));
    els.optionsNote.classList.remove('error');
    els.optionsNote.textContent = parts.join(' · ');
    showPlatformWarnings(timing.totalFrames / timing.fps);
    o.optionsValid = true;
  } catch (err) {
    showPlatformWarnings(null);
    const message = err instanceof RenderPlanError || err instanceof TimecodeError ? err.message : String(err);
    const unmeasured = err instanceof MediaNotMeasuredError;
    // Not measured yet is not wrong: the render reads the file itself.
    els.optionsNote.classList.toggle('error', !unmeasured);
    els.optionsNote.textContent = unmeasured ? t('output.media.not-measured') : message;
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
      reason = preset.encoder.startsWith('pcm') || encoders.includes(preset.encoder) ? null : t('output.preset.needs-encoder', { encoder: preset.encoder });
    } else {
      const preset = OUTPUT_PRESETS[opt.value as PresetId];
      label = preset.label;
      reason = presetUnavailableReason(encoders, preset);
    }
    opt.disabled = reason !== null;
    opt.textContent = reason ? t('output.preset.unavailable-option', { preset: label }) : label;
    if (reason) reasons.push(t('output.preset.unavailable-reason', { preset: label, reason }));
  }
  if (els.preset.selectedOptions[0]?.disabled) {
    const first = Array.from(els.preset.options).find((opt) => !opt.disabled);
    if (first) {
      els.preset.value = first.value;
      els.preset.dispatchEvent(new Event('change'));
    }
  }
  els.presetUnavailable.hidden = reasons.length === 0;
  els.presetUnavailable.textContent = reasons.length ? t('output.preset.unavailable', { reasons: reasons.join(' ') }) : '';
}

/**
 * Read the options again and say what they amount to. The Parameters tab calls
 * this when the graphic's length changes (milestone 30): a trim is taken
 * within the length, so what this tab shows depends on it.
 */
export function outputRefreshOptions(): void {
  // The captions row is there while the project has captions (milestone 50), and goes with them.
  els.optCaptionsField.hidden = o.media !== null || captionsIn(currentRawParams()) === null;
  // And the stems row while any audio layer holds its music as stems (milestone 16).
  els.optStemsField.hidden = o.media !== null || !layersHaveStems(currentRawParams()[LAYERS_KEY]);
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
  setPlain(els.dragStatus, '');
  updateRenderControls();
  try {
    const result = await window.pulp.prepareDrag(request);
    if (!result.ok) {
      els.dragStatus.classList.add('error');
      setPlain(els.dragStatus, result.message);
      return;
    }
    // Either way a card is waiting in the tray; the card says the rest.
    bindText(els.dragStatus, result.cached ? 'output.drag.ready' : 'output.drag.rendering');
  } finally {
    o.preparing = false;
    updateRenderControls();
  }
}

/** Set or clear the grade (milestone 52): the name on the row, the whole path in its tip, the summary refreshed. */
function setLut(path: string | null): void {
  o.lutPath = path;
  els.optLutName.textContent = path ? (path.split(/[\\/]/).pop() ?? path) : '';
  els.optLutName.dataset.tip = path ?? '';
  els.optLutClear.hidden = path === null;
  updateOptionsNote();
  saveToEditedCard();
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
  bindText(els.renderStatus, 'output.render.choosing');
  updateRenderControls();
  try {
    const result = await window.pulp.render(request);
    if (result.ok) {
      setPlain(els.renderStatus, '');
    } else {
      els.renderStatus.classList.toggle('error', !result.cancelled);
      setPlain(els.renderStatus, result.cancelled ? '' : result.message);
    }
  } finally {
    o.choosingOutput = false;
    updateRenderControls();
  }
}

// ---------------------------------------------------------------- batch from CSV

function previewBatch(csv = els.batchCsv.value): void {
  const selected = selectedTemplate.value;
  if (!selected) return;
  const plan = planBatch(selected.manifest, csv);
  o.batch = plan;
  o.batchCsv = csv;
  o.batchQueued = null;
  els.batchSummary.replaceChildren();
  const lines: { text: string; warning?: boolean }[] = [];
  if (plan.rows.length > 0) {
    const columns = plan.columns.map((c) => `${c.header} → ${c.paramId}`).join(', ') || t('output.batch.columns.none');
    lines.push({ text: plan.nameColumn
      ? t('output.batch.summary.names', { count: plan.rows.length, columns, name: plan.nameColumn })
      : t('output.batch.summary', { count: plan.rows.length, columns }) });
    lines.push({ text: t('output.batch.files', { files: `${plan.rows.slice(0, 5).map((r) => r.fileName).join(', ')}${plan.rows.length > 5 ? ', …' : ''}` }) });
  }
  for (const w of plan.warnings) lines.push({ text: w, warning: true });
  for (const line of lines) {
    const div = document.createElement('div');
    if (line.warning) div.className = 'warning';
    div.textContent = line.text;
    els.batchSummary.append(div);
  }
  if (plan.rows.length > 0) bindText(els.batchQueue, 'output.batch.queue', { count: plan.rows.length });
  else bindText(els.batchQueue, 'ui.batch-queue');
  els.batchQueue.disabled = plan.rows.length === 0 || plan.columns.length === 0 || !o.ffmpegOk || !o.optionsValid;
}

/** The line a queued batch leaves under the preview. */
function showBatchQueued(queued: { say: () => string; warning: boolean }): void {
  o.batchQueued = queued;
  const div = document.createElement('div');
  div.className = queued.warning ? 'warning' : '';
  div.textContent = queued.say();
  els.batchSummary.append(div);
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
    if (result.ok) {
      const queued = { count: result.jobIds.length, folder: result.folder };
      const skipped = result.skipped ?? [];
      showBatchQueued({
        say: () => (skipped.length
          ? t('output.batch.queued.skipped', { ...queued, skipped: skipped.length, names: skipped.join('; ') })
          : t('output.batch.queued', queued)),
        warning: false,
      });
    } else {
      const message = result.cancelled ? '' : result.message;
      showBatchQueued({ say: () => message, warning: !result.cancelled });
    }
  } finally {
    els.batchQueue.disabled = false;
  }
}

// ---------------------------------------------------------------- region API

/** The fields a media item has and a template does not, shown or hidden as one. */
function showMediaFields(entry: MediaEntry | null): void {
  els.mediaOptions.hidden = entry === null;
  // Type defaults and the kind presets are a template's business (milestone 14).
  if (entry !== null) {
    renderAssetPresets(null);
    refreshTypeDefaultRow(null);
  }
  els.guidedField.hidden = entry !== null;
  // A media item has no captions; a template's project may (milestone 50). Likewise the stems row.
  els.optCaptionsField.hidden = entry !== null || captionsIn(currentRawParams()) === null;
  els.optStemsField.hidden = entry !== null || !layersHaveStems(currentRawParams()[LAYERS_KEY]);
  els.batch.hidden = entry !== null;
  els.optAspectField.hidden = entry !== null || els.optAspectField.hidden;
  if (!entry) {
    els.optMatteField.hidden = false;
    els.optCoverField.hidden = false;
    els.optPlatformField.hidden = false;
    publishCover();
    return;
  }
  const kind = entry.sequence ? 'video' : entry.mediaKind;
  // A sound has no shape, size or frame rate for a platform preset to set (milestone 20).
  els.optPlatformField.hidden = kind === 'audio';
  els.optSpeedField.hidden = kind === 'image';
  els.optCrossfadeField.hidden = kind === 'image';
  els.audioOptions.hidden = kind !== 'audio';
  // A sound has no picture to flatten, fit, matte, recolour or take a cover from; a still is its
  // own cover already, so only a clip is offered one (milestone 20).
  els.optMatteField.hidden = kind === 'audio';
  els.optCoverField.hidden = kind !== 'video';
  publishCover();
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
  if (entry.meta?.width && entry.meta.height) bindText(own, 'output.size.as-is.dims', { size: dimensionsLabel(entry.meta.width, entry.meta.height) });
  else bindText(own, 'output.size.as-is');
  const custom = document.createElement('option');
  custom.value = CUSTOM_SIZE;
  bindText(custom, 'output.size.custom');
  els.optResolution.append(own, custom);
  els.optResolution.value = '';
  els.optSizeCustom.hidden = true;
  els.optWidth.value = '';
  els.optHeight.value = '';
  const source = sourceFromEntry(entry);
  const ownRate = els.optFps.options[0]!;
  if (kind === 'image') bindText(ownRate, 'output.fps.still');
  else if (kind === 'audio') bindText(ownRate, 'output.fps.sound');
  else if (source.fps) bindText(ownRate, 'output.fps.clip.rate', { fps: source.fps });
  else bindText(ownRate, 'output.fps.clip');
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
  setPlain(els.dragStatus, '');
  setLut(null);
  trim.value = { inFrame: null, outFrame: null };
  showMediaFields(entry);
  showPresetNote();
  applyPreferredPlatform();
  updateOptionsNote();
}

/** Nothing is shown: the tab waits, its media fields put away. */
export function outputClear(): void {
  o.media = null;
  showMediaFields(null);
  renderAssetPresets(null);
  refreshTypeDefaultRow(null);
  els.guidedField.hidden = true;
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
  bindText(els.optFps.options[0]!, 'output.fps.template.rate', { fps: entry.manifest.fps });
  els.optFps.value = '';
  els.optIn.value = '';
  els.optOut.value = '';
  els.optStems.value = 'mix';
  setPlain(els.dragStatus, '');
  setLut(null);
  trim.value = { inFrame: null, outFrame: null };
  o.batch = null;
  o.batchQueued = null;
  els.batchSummary.textContent = '';
  els.batchQueue.disabled = true;
  // The kind's own answers (milestone 14): the one-click presets this template can take, and the
  // type's remembered default — applied before the platform lean, which stays the stronger word.
  renderAssetPresets(entry.manifest);
  applyTypeDefault(entry.manifest);
  refreshTypeDefaultRow(entry.manifest);
  applyPreferredPlatform();
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
      $('editing-note-text').textContent = t('output.editing', { name: item.name });
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
        els.optCaptions.value = item.options.captions ?? 'burn';
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
      // The platform a card was collected for (milestone 20): shown, not applied again — the size
      // and rate the card carries are what it was saved with, whatever has been chosen since.
      els.optPlatform.value = item.options.platform && platformPreset(item.options.platform) ? item.options.platform : '';
      showPlatformNote();
      els.optFps.value = item.options.fps === undefined ? '' : String(item.options.fps);
      const fps = item.options.fps ?? selectedTemplate.value?.manifest.fps ?? 25;
      els.optIn.value = item.options.inFrame === undefined ? '' : formatTimecode(item.options.inFrame, fps);
      els.optOut.value = item.options.outFrame === undefined ? '' : formatTimecode(item.options.outFrame, fps);
      // The cover a card was collected with, and its mark (milestone 20).
      setLut(item.options.lut ?? null);
      // How the card's music stems reach the render (milestone 16); the row shows only while there are stems.
      els.optStems.value = item.options.stems === 'files' ? 'files' : 'mix';
      els.optCover.checked = item.options.coverFrame !== undefined;
      els.optCoverAt.value = item.options.coverFrame === undefined ? '' : formatTimecode(item.options.coverFrame, fps);
      publishCover();
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

/**
 * A change of language (milestone 59): the lists' names, the notes and the batch preview said again
 * in the new words. Read untracked, so the repaint follows the language and nothing else.
 */
function repaintWords(): void {
  for (const opt of Array.from(els.optFps.options)) {
    const rate = opt.value ? STANDARD_FRAME_RATES.find((r) => String(r.fps) === opt.value) : undefined;
    if (rate) opt.textContent = rate.label;
  }
  for (const opt of Array.from(els.optPlatform.options)) {
    const platform = platformPreset(opt.value || undefined);
    if (platform) opt.textContent = platform.label;
  }
  listPresets(o.presetKind);
  showPlatformNote(o.platformMissed);
  const manifest = selectedTemplate.value?.manifest ?? null;
  if (!o.media) {
    renderAssetPresets(manifest);
    refreshTypeDefaultRow(manifest);
  }
  updateOptionsNote();
  if (o.batch && manifest) {
    const queued = o.batchQueued;
    previewBatch(o.batchCsv);
    if (queued) showBatchQueued(queued);
  }
}

export function initInspectorOutput(): void {
  initCollectionEditing();
  populatePresets();
  populateFrameRates();
  populatePlatforms();
  whenLocaleChanges(() => untracked(repaintWords));
  // The remembered defaults per type (milestone 14), in before the first item is shown.
  void window.pulp.getTypeOutputDefaults().then((defaults) => {
    o.typeDefaults = defaults;
    refreshTypeDefaultRow(selectedTemplate.value?.manifest ?? null);
  });
  els.typeDefaultSave.addEventListener('click', () => {
    void saveTypeDefault(readTypeDefault());
  });
  els.typeDefaultClear.addEventListener('click', () => {
    void saveTypeDefault(null);
  });
  // Guided setup (milestone 14): the same controls, walked step by step with a live preview.
  els.guidedOpen.addEventListener('click', () => openGuidedSetup());
  // A platform sets the aspect, size, rate and encoder in one go, and stays the session's lean, so
  // the next item shown opens the same way (milestone 20).
  els.optPlatform.addEventListener('change', () => {
    preferredPlatform.value = els.optPlatform.value || null;
    applyPlatform();
    updateOptionsNote();
    // A new rate means the same trim text is a different frame.
    publishTrim();
    publishCover();
    saveToEditedCard();
  });
  for (const el of [els.optIn, els.optOut]) {
    el.addEventListener('input', () => {
      updateOptionsNote();
      publishTrim();
      saveToEditedCard();
    });
  }
  // The cover image (milestone 20): the box opens its row and takes the playhead's frame, the
  // field moves the mark, and the button brings the playhead back after a scrub.
  els.optCover.addEventListener('change', () => {
    publishCover();
    updateOptionsNote();
    saveToEditedCard();
  });
  els.optCoverAt.addEventListener('input', () => {
    publishCover();
    updateOptionsNote();
    saveToEditedCard();
  });
  els.optCoverHere.addEventListener('click', () => {
    const fps = chosenFps();
    if (fps === undefined) return;
    els.optCoverAt.value = formatTimecode(Math.max(0, Math.round(playheadSeconds.peek() * fps)), fps);
    publishCover();
    updateOptionsNote();
    saveToEditedCard();
  });
  els.optFps.addEventListener('change', () => {
    updateOptionsNote();
    // The same text means a different frame at another rate.
    publishTrim();
    publishCover();
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
  // The LUT over the whole render (milestone 52): a .cube chosen by name, cleared with its cross.
  els.optLut.addEventListener('click', () => {
    void window.pulp.chooseLutFile().then((path) => {
      if (!path) return;
      setLut(path);
    });
  });
  els.optLutClear.addEventListener('click', () => setLut(null));
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
  els.batchPreview.addEventListener('click', () => previewBatch());
  els.batchQueue.addEventListener('click', () => void queueBatch());
  updateRenderControls();
}
