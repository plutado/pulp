/**
 * Guided setup (milestone 14): the Output tab's controls walked step by step —
 * what the render is for, its shape and size, its format and what happens to
 * the transparency, what the sound will do, and a summary — with a live
 * preview over a checkerboard the whole way. The model, the purposes, the
 * sentences and the result are pure (src/core/guided-setup.ts); this module
 * owns only the dialog's DOM. Finishing sets the very controls the tab holds
 * (src/renderer/inspector-output.ts), optionally saves them as the type's
 * default, and can add the item to the collection on its way out.
 */

import {
  aspectName, GUIDED_STEPS, guidedPlatforms, guidedPreviewBackdrop, guidedPurposes,
  guidedSize, guidedSoundLines, guidedSummary, withPurpose, type GuidedChoices,
} from '../core/guided-setup';
import { resolutionsFor } from '../core/aspect';
import { dimensionsLabel } from '../core/display';
import { OUTPUT_PRESETS, type PresetId } from '../core/render-plan';
import { STANDARD_FRAME_RATES } from '../core/timecode';
import { thumbUrlFor } from '../core/thumbnails';
import { outputApplyGuided, outputGuidedContext, type GuidedContext } from './inspector-output';
import { untracked } from '@preact/signals';
import { bindText, t, whenLocaleChanges } from './i18n';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  dialog: () => $<HTMLDialogElement>('guided-dialog'),
  head: () => $<HTMLParagraphElement>('guided-step-head'),
  box: () => $<HTMLDivElement>('guided-preview-box'),
  img: () => $<HTMLImageElement>('guided-preview-img'),
  caption: () => $<HTMLParagraphElement>('guided-preview-caption'),
  body: () => $<HTMLDivElement>('guided-step-body'),
  back: () => $<HTMLButtonElement>('guided-back'),
  next: () => $<HTMLButtonElement>('guided-next'),
  collect: () => $<HTMLButtonElement>('guided-collect'),
};

/** The walk as it stands: the context it opened over, the choices, and where it is. */
let walk: { context: GuidedContext; choices: GuidedChoices; step: number; saveDefault: boolean } | null = null;

export function openGuidedSetup(): void {
  const context = outputGuidedContext();
  if (!context) return;
  walk = { context, choices: { ...context.choices }, step: 0, saveDefault: false };
  const img = els.img();
  img.src = thumbUrlFor(context.entryId);
  img.hidden = false;
  img.onerror = () => {
    img.hidden = true;
  };
  show();
  els.dialog().showModal();
}

/** Paint the step and the preview from the walk as it stands. */
function show(): void {
  if (!walk) return;
  const step = GUIDED_STEPS[walk.step]!;
  els.head().textContent = t('guided.head', { step: walk.step + 1, steps: GUIDED_STEPS.length, title: step.title });
  els.back().disabled = walk.step === 0;
  const last = walk.step === GUIDED_STEPS.length - 1;
  bindText(els.next(), last ? 'guided.finish' : 'ui.guided-next');
  els.collect().hidden = !last;
  const body = els.body();
  body.replaceChildren();
  if (step.id === 'purpose') buildPurpose(body);
  else if (step.id === 'shape') buildShape(body);
  else if (step.id === 'format') buildFormat(body);
  else if (step.id === 'sound') buildSound(body);
  else buildSummary(body);
  paintPreview();
}

/**
 * The live preview: the template's poster inside a box of the chosen shape —
 * over the checkerboard while the transparency is kept, over the flatten
 * color once a format without alpha drops it — with the size, the rate and
 * the format said underneath.
 */
function paintPreview(): void {
  if (!walk) return;
  const { manifest } = walk.context;
  const size = guidedSize(manifest, walk.choices);
  const box = els.box();
  box.style.aspectRatio = `${size.width} / ${size.height}`;
  const backdrop = guidedPreviewBackdrop(manifest, walk.choices);
  box.classList.toggle('checker', backdrop === 'checker');
  box.style.backgroundColor = backdrop === 'color' ? walk.choices.background : '';
  const fps = walk.choices.fps ?? manifest.fps;
  els.caption().textContent = t('guided.preview.caption', { size: dimensionsLabel(size.width, size.height), fps, preset: OUTPUT_PRESETS[walk.choices.presetId].label });
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

function note(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = text;
  return p;
}

/** A radio with its explanation under the label, the shape every choosing step uses. */
function choice(name: string, value: string, label: string, tip: string, checked: boolean, onPick: () => void): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'guided-choice';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.addEventListener('change', onPick);
  const text = document.createElement('span');
  const title = document.createElement('span');
  title.textContent = label;
  const explain = note(tip);
  text.append(title, explain);
  wrap.append(input, text);
  return wrap;
}

function selectField(label: string, select: HTMLSelectElement): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  field.append(span, select);
  return field;
}

// ---------------------------------------------------------------- the steps

function buildPurpose(body: HTMLElement): void {
  const w = walk!;
  body.append(note(t('guided.purpose.note')));
  const platforms = document.createElement('select');
  platforms.setAttribute('aria-label', t('guided.platform'));
  for (const p of guidedPlatforms()) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    platforms.append(opt);
  }
  platforms.value = w.choices.platform && guidedPlatforms().some((p) => p.id === w.choices.platform) ? w.choices.platform : guidedPlatforms()[0]!.id;
  const platformField = selectField(t('guided.platform'), platforms);
  const repick = () => {
    w.choices = withPurpose(w.choices, w.context.manifest, w.choices.purpose, platforms.value);
    platformField.hidden = w.choices.purpose !== 'social';
    paintPreview();
  };
  for (const p of guidedPurposes(w.context.manifest)) {
    body.append(choice('guided-purpose', p.id, p.label, p.tip, w.choices.purpose === p.id, () => {
      w.choices.purpose = p.id;
      repick();
    }));
  }
  platformField.hidden = w.choices.purpose !== 'social';
  platforms.addEventListener('change', repick);
  body.append(platformField);
}

function buildShape(body: HTMLElement): void {
  const w = walk!;
  const m = w.context.manifest;
  body.append(note(t('guided.shape.note')));
  body.append(heading(t('guided.shape.heading')));
  const sizes = document.createElement('select');
  sizes.setAttribute('aria-label', t('guided.size.aria-label'));
  const fillSizes = () => {
    sizes.replaceChildren();
    const fallback = guidedSize(m, { ...w.choices, width: undefined, height: undefined } as GuidedChoices);
    const def = document.createElement('option');
    def.value = '';
    def.textContent = t('guided.size.default', { size: dimensionsLabel(fallback.width, fallback.height) });
    sizes.append(def);
    for (const r of resolutionsFor(m, w.choices.aspect)) {
      if (r.width === fallback.width && r.height === fallback.height) continue;
      const opt = document.createElement('option');
      opt.value = `${r.width}x${r.height}`;
      opt.textContent = `${r.label} · ${dimensionsLabel(r.width, r.height)}`;
      sizes.append(opt);
    }
    sizes.value = w.choices.width !== undefined ? `${w.choices.width}x${w.choices.height}` : '';
    if (sizes.selectedIndex < 0) sizes.value = '';
  };
  for (const aspect of m.aspects) {
    body.append(choice('guided-aspect', aspect, t('guided.aspect.option', { name: aspectName(aspect, m.size), aspect }),
      aspect === m.aspects[0] ? t('guided.aspect.first.tip') : t('guided.aspect.other.tip'),
      w.choices.aspect === aspect, () => {
        w.choices.aspect = aspect;
        delete w.choices.width;
        delete w.choices.height;
        fillSizes();
        paintPreview();
      }));
  }
  fillSizes();
  sizes.addEventListener('change', () => {
    const m2 = /^(\d+)x(\d+)$/.exec(sizes.value);
    if (m2) {
      w.choices.width = Number(m2[1]);
      w.choices.height = Number(m2[2]);
    } else {
      delete w.choices.width;
      delete w.choices.height;
    }
    paintPreview();
  });
  body.append(selectField(t('guided.size'), sizes));
  const rates = document.createElement('select');
  rates.setAttribute('aria-label', t('guided.fps'));
  const own = document.createElement('option');
  own.value = '';
  own.textContent = t('guided.fps.template', { fps: m.fps });
  rates.append(own);
  for (const rate of STANDARD_FRAME_RATES) {
    const opt = document.createElement('option');
    opt.value = String(rate.fps);
    opt.textContent = rate.label;
    rates.append(opt);
  }
  rates.value = w.choices.fps !== undefined ? String(w.choices.fps) : '';
  if (rates.selectedIndex < 0) rates.value = '';
  rates.addEventListener('change', () => {
    if (rates.value === '') delete w.choices.fps;
    else w.choices.fps = Number(rates.value);
    paintPreview();
  });
  body.append(selectField(t('guided.fps'), rates));
  body.append(note(t('guided.fps.note')));
}

function buildFormat(body: HTMLElement): void {
  const w = walk!;
  const m = w.context.manifest;
  const presets = document.createElement('select');
  presets.setAttribute('aria-label', t('guided.preset.aria-label'));
  for (const preset of Object.values(OUTPUT_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.label;
    opt.disabled = w.context.presetDisabled(preset.id);
    presets.append(opt);
  }
  presets.value = w.choices.presetId;
  const explain = note('');
  const flatten = document.createElement('label');
  flatten.className = 'field';
  const flattenLabel = document.createElement('span');
  flattenLabel.textContent = t('guided.flatten');
  const colour = document.createElement('input');
  colour.type = 'color';
  colour.value = w.choices.background;
  colour.setAttribute('aria-label', t('guided.flatten'));
  flatten.append(flattenLabel, colour);
  const flattenNote = note(t('guided.flatten.note'));
  const matte = document.createElement('label');
  matte.className = 'field inline guided-choice';
  const matteBox = document.createElement('input');
  matteBox.type = 'checkbox';
  matteBox.checked = w.choices.matte;
  const matteText = document.createElement('span');
  matteText.textContent = t('guided.matte');
  matte.append(matteBox, matteText);
  const follow = () => {
    const preset = OUTPUT_PRESETS[w.choices.presetId];
    explain.textContent = preset.description;
    const flattens = m.alpha && !preset.alpha;
    flatten.hidden = !flattens;
    flattenNote.hidden = !flattens;
    paintPreview();
  };
  presets.addEventListener('change', () => {
    w.choices.presetId = presets.value as PresetId;
    follow();
  });
  colour.addEventListener('input', () => {
    w.choices.background = colour.value;
    paintPreview();
  });
  matteBox.addEventListener('change', () => {
    w.choices.matte = matteBox.checked;
  });
  body.append(selectField(t('guided.format'), presets), explain, flatten, flattenNote, matte,
    note(t('guided.matte.note')));
  follow();
}

function buildSound(body: HTMLElement): void {
  const w = walk!;
  for (const line of guidedSoundLines(w.context.manifest, w.context)) body.append(note(line));
  if (w.context.hasStems) {
    const stems = document.createElement('select');
    stems.setAttribute('aria-label', t('guided.stems.aria-label'));
    for (const [value, label] of [['mix', t('guided.stems.mix')], ['files', t('guided.stems.files')]] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      stems.append(opt);
    }
    stems.value = w.choices.stems;
    stems.addEventListener('change', () => {
      w.choices.stems = stems.value as 'mix' | 'files';
    });
    body.append(selectField(t('guided.stems'), stems));
  }
}

function buildSummary(body: HTMLElement): void {
  const w = walk!;
  const list = document.createElement('ul');
  for (const line of guidedSummary(w.context.manifest, w.choices, w.context)) {
    const li = document.createElement('li');
    li.textContent = line;
    list.append(li);
  }
  body.append(list);
  const save = document.createElement('label');
  save.className = 'field inline guided-choice';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = w.saveDefault;
  box.addEventListener('change', () => {
    w.saveDefault = box.checked;
  });
  const text = document.createElement('span');
  text.textContent = t('guided.save-default');
  save.append(box, text);
  body.append(save, note(t('guided.summary.note')));
}

// ---------------------------------------------------------------- the walk itself

function finish(collect: boolean): void {
  if (!walk) return;
  outputApplyGuided(walk.choices, walk.saveDefault);
  // Add to collection is the window's own button over the settings just applied, so a card
  // collected here is exactly a card collected there (src/renderer/main.ts owns it).
  if (collect) document.getElementById('add-to-collection')?.click();
  els.dialog().close();
  walk = null;
}

export function initGuidedSetup(): void {
  // A change of language paints the open step again; its choices live in the walk, not the elements (milestone 59).
  whenLocaleChanges(() => untracked(show));
  els.back().addEventListener('click', () => {
    if (!walk || walk.step === 0) return;
    walk.step -= 1;
    show();
  });
  els.next().addEventListener('click', () => {
    if (!walk) return;
    if (walk.step === GUIDED_STEPS.length - 1) {
      finish(false);
      return;
    }
    walk.step += 1;
    show();
  });
  els.collect().addEventListener('click', () => finish(true));
  // The close event arrives a task after close(), so a walk reopened quickly — a test, a double
  // press — must not be wiped by the event of the walk before it: only a really-closed dialog clears.
  els.dialog().addEventListener('close', () => {
    if (!els.dialog().open) walk = null;
  });
}
