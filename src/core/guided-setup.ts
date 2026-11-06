/**
 * Guided setup (milestone 14's last item): the Output tab walked through step
 * by step, for someone who does not yet know what the controls mean. A modal
 * asks what the render is for, then its shape and size, its format and what
 * happens to the transparency, says what the sound will do, and ends on a
 * summary — with a live preview over a checkerboard the whole way, so a choice
 * is seen before it is made. Nothing new to render with: the wizard ends by
 * setting the very controls the Output tab holds, optionally saving them as
 * the type's default (milestone 14) and adding the item to the collection.
 *
 * Pure: the steps, the choices, the purposes a template is offered, the
 * sentences the summary says and the result the Output tab applies. The modal
 * (src/renderer/guided-setup.ts) draws from here and owns only the DOM.
 */

import { aspectOf, defaultAspect, resolveRenderSize, type ShapeDeclaration, type Size } from './aspect';
import type { TemplateManifest } from './manifest';
import { ASSET_OUTPUT_PRESETS, assetPresetsFor } from './output-defaults';
import { PLATFORM_PRESETS, platformPreset } from './platform-presets';
import { OUTPUT_PRESETS, type PresetId } from './render-plan';
import { tr } from './i18n';

/** The steps, in the order they are walked. Every template gets all five. */
export const GUIDED_STEPS = [
  { id: 'purpose', get title() { return tr('guided.step.purpose'); } },
  { id: 'shape', get title() { return tr('guided.step.shape'); } },
  { id: 'format', get title() { return tr('guided.step.format'); } },
  { id: 'sound', get title() { return tr('guided.step.sound'); } },
  { id: 'summary', get title() { return tr('guided.step.summary'); } },
] as const;
export type GuidedStepId = (typeof GUIDED_STEPS)[number]['id'];

/** Everything the wizard decides. The Output tab's controls, as one value. */
export interface GuidedChoices {
  /** An asset preset's id, 'social', or 'custom' — what step one answered. */
  purpose: string;
  /** The platform, when the purpose is a social post. */
  platform?: string;
  presetId: PresetId;
  aspect: string;
  /** An exact size; absent is the aspect's default. */
  width?: number;
  height?: number;
  /** A frame-rate override; absent is the template's own rate. */
  fps?: number;
  /** The color an alpha template is flattened over when the preset keeps no alpha. */
  background: string;
  matte: boolean;
  /** How music that came in as stems reaches the render; only shown when the project holds stems. */
  stems: 'mix' | 'files';
}

/** One answer step one offers: an asset preset, a social post, or choosing by hand. */
export interface GuidedPurpose {
  id: string;
  label: string;
  tip: string;
}

/** What step one offers this template: the kind presets that fit it, a social post, and by-hand. */
export function guidedPurposes(manifest: Pick<TemplateManifest, 'alpha' | 'category'>): GuidedPurpose[] {
  return [
    ...assetPresetsFor(manifest).map((p) => ({ id: p.id, label: p.label, tip: p.tip })),
    { id: 'social', label: tr('guided.purpose.social'), tip: tr('guided.purpose.social.tip') },
    { id: 'custom', label: tr('guided.purpose.custom'), tip: tr('guided.purpose.custom.tip') },
  ];
}

/** Where the wizard starts: the template's own answers, with the mix and no matte. */
export function defaultGuidedChoices(manifest: ShapeDeclaration & Pick<TemplateManifest, 'alpha' | 'category'>): GuidedChoices {
  return {
    purpose: 'custom',
    presetId: manifest.alpha ? 'prores-4444' : 'h264-mp4',
    aspect: defaultAspect(manifest),
    background: '#000000',
    matte: false,
    stems: 'mix',
  };
}

/**
 * Step one's answer seeds the rest: an asset preset brings its format,
 * background and matte; a platform brings its shape, size, rate and format —
 * held to a shape the template draws. Later steps may change any of it.
 */
export function withPurpose(
  choices: GuidedChoices,
  manifest: ShapeDeclaration,
  purpose: string,
  platform?: string,
): GuidedChoices {
  const next: GuidedChoices = { ...choices, purpose };
  delete next.platform;
  const asset = ASSET_OUTPUT_PRESETS.find((p) => p.id === purpose);
  if (asset) {
    next.presetId = asset.choices.presetId;
    if (asset.choices.background !== undefined) next.background = asset.choices.background;
    next.matte = asset.choices.matte === true;
    return next;
  }
  const p = purpose === 'social' ? platformPreset(platform) : null;
  if (p) {
    next.platform = p.id;
    next.presetId = p.presetId;
    next.fps = p.fps;
    if (manifest.aspects.includes(p.aspect)) {
      next.aspect = p.aspect;
      next.width = p.width;
      next.height = p.height;
    }
  }
  return next;
}

/** The platforms step one's social answer offers, as the Output tab lists them. */
export function guidedPlatforms(): { id: string; label: string }[] {
  return PLATFORM_PRESETS.map((p) => ({ id: p.id, label: p.label }));
}

/** The size the choices land on, resolved as the render would resolve it. */
export function guidedSize(manifest: ShapeDeclaration, choices: GuidedChoices): { aspect: string } & Size {
  try {
    return resolveRenderSize(manifest, {
      aspect: choices.aspect,
      ...(choices.width !== undefined && choices.height !== undefined ? { width: choices.width, height: choices.height } : {}),
    });
  } catch {
    return resolveRenderSize(manifest, { aspect: choices.aspect });
  }
}

/** Whether the live preview shows the checkerboard (transparency kept) or the flatten color. */
export function guidedPreviewBackdrop(manifest: Pick<TemplateManifest, 'alpha'>, choices: GuidedChoices): 'checker' | 'color' | 'opaque' {
  if (!manifest.alpha) return 'opaque';
  return OUTPUT_PRESETS[choices.presetId].alpha ? 'checker' : 'color';
}

/**
 * The sound step's sentences: what this render will carry, from what the
 * template and the project hold. Said rather than asked — the sounds
 * themselves are chosen on the Parameters tab; the one output choice here is
 * the stems', when the project has any.
 */
export function guidedSoundLines(
  manifest: Pick<TemplateManifest, 'sound'>,
  project: { hasStems: boolean; hasLayerSound: boolean },
): string[] {
  const lines: string[] = [];
  if (manifest.sound) {
    const count = manifest.sound.variants.length;
    lines.push(count > 1
      ? tr('guided.sound.template-variants', { count })
      : tr('guided.sound.template'));
  }
  if (project.hasLayerSound) lines.push(tr('guided.sound.layers'));
  if (project.hasStems) lines.push(tr('guided.sound.stems'));
  if (lines.length === 0) lines.push(tr('guided.sound.none'));
  lines.push(tr('guided.sound.sequence'));
  return lines;
}

/** The summary: what will happen, in sentences, from the choices as they stand. */
export function guidedSummary(
  manifest: ShapeDeclaration & Pick<TemplateManifest, 'alpha' | 'fps'>,
  choices: GuidedChoices,
  project: { hasStems: boolean } = { hasStems: false },
): string[] {
  const preset = OUTPUT_PRESETS[choices.presetId];
  const size = guidedSize(manifest, choices);
  const lines: string[] = [];
  lines.push(tr('guided.summary.preset', { preset: preset.label, description: preset.description }));
  const dimensions = { aspect: size.aspect, width: size.width, height: size.height };
  lines.push(choices.fps !== undefined && choices.fps !== manifest.fps
    ? tr('guided.summary.size', { ...dimensions, fps: choices.fps })
    : tr('guided.summary.size.own-rate', { ...dimensions, fps: manifest.fps }));
  if (manifest.alpha) {
    lines.push(preset.alpha
      ? tr('guided.summary.alpha-kept')
      : tr('guided.summary.alpha-flattened', { color: choices.background }));
  }
  if (choices.matte) lines.push(tr('guided.summary.matte'));
  const platform = platformPreset(choices.platform);
  if (platform) lines.push(tr('guided.summary.platform', { platform: platform.label }));
  if (project.hasStems) {
    lines.push(choices.stems === 'files'
      ? tr('guided.summary.stems-files')
      : tr('guided.summary.stems-mix'));
  }
  return lines;
}

/** A friendly name for an aspect id, said beside the bare ratio. */
export function aspectName(id: string, size?: Size): string {
  switch (id) {
    case '16:9': return tr('guided.aspect.wide');
    case '9:16': return tr('guided.aspect.vertical');
    case '1:1': return tr('guided.aspect.square');
    case '4:5': return tr('guided.aspect.portrait');
    default: return size && aspectOf(size.width, size.height) === id ? tr('guided.aspect.own') : tr('guided.aspect.custom');
  }
}
