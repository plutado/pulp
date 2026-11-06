/**
 * A template's own sound (milestone 16): a swoosh on a transition, a sting on
 * a logo reveal, shipped inside the template folder with a few variations to
 * pick from. The manifest names the variants; the chosen one rides with the
 * parameters as `@sound` (src/core/params.ts), so it travels into projects,
 * presets, collections and `--param @sound=...` without a second channel; the
 * preview plays it through the same elements a layer's sound plays through,
 * and the render mixes it in with `applyLayerAudio` — or writes it into the
 * WAV beside an image sequence, as every other sound in the mix is.
 *
 * The sound follows the template's own clock. `at` is the moment it starts in
 * the template's **design** time; when a length is asked for, the moment is
 * mapped the way the picture is (src/core/timing.ts): through an entrance, a
 * hold and an exit it moves with the part it sits in, and a `scale` template —
 * a transition played faster or slower — plays its sound at the same rate,
 * pitch kept, exactly as a cut's sound at a speed is.
 *
 * Pure: no Node, no DOM, no decision made twice. The preview, the render and
 * the loudness meter all build the one SoundValue from here.
 */

import { isSafeRelativePath } from './manifest-path';
import { EMPTY_SOUND, type SoundValue } from './sound-layer';
import { entranceSeconds, exitSeconds, type TemplateStructure } from './timing';

/** The chosen variant rides with the parameters under this key; "none" is silence chosen on purpose. */
export const TEMPLATE_SOUND_NONE = 'none';

/** The file types a template may ship sound as: what ffmpeg and <audio> both read everywhere. */
export const TEMPLATE_SOUND_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac'] as const;

/** One sound the template offers: a value to store, a label to show, a file inside the template folder. */
export interface TemplateSoundVariant {
  /** Stored as the choice; an identifier-ish word, never "none", which is the built-in silence. */
  value: string;
  label: string;
  /** Relative path inside the template folder, with an audio extension. */
  file: string;
  /** 0 to 1 against the file as recorded; 1 when left out. */
  gain?: number;
}

export interface TemplateSound {
  variants: TemplateSoundVariant[];
  /** The variant played when nothing was chosen: a variant's value, or "none"; the first variant when left out. */
  default?: string;
  /** The moment the sound starts, in seconds of the template's own design time; 0 when left out. */
  at?: number;
}

export interface TemplateSoundIssue {
  path: string;
  message: string;
}

/** Does a file name carry one of the audio extensions a template may ship? */
export function isTemplateSoundFile(file: string): boolean {
  const dot = file.lastIndexOf('.');
  if (dot < 0) return false;
  return (TEMPLATE_SOUND_EXTENSIONS as readonly string[]).includes(file.slice(dot).toLowerCase());
}

/**
 * Validate a manifest's `sound` field. Returns the normalized value, or null
 * with the problems pushed onto `errors` — the same contract the rest of the
 * manifest's fields follow (src/core/manifest.ts calls this).
 */
export function validateTemplateSound(raw: unknown, duration: number, errors: TemplateSoundIssue[]): TemplateSound | null {
  const start = errors.length;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors.push({ path: 'sound', message: 'must be an object with a list of variants' }); // i18n-exempt(diagnostic)
    return null;
  }
  const r = raw as Record<string, unknown>;
  const variants: TemplateSoundVariant[] = [];
  if (!Array.isArray(r.variants) || r.variants.length === 0) {
    errors.push({ path: 'sound.variants', message: 'must be a non-empty array of { value, label, file }' }); // i18n-exempt(diagnostic)
  } else {
    const values = new Set<string>();
    r.variants.forEach((entry, i) => {
      const path = `sound.variants[${i}]`;
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        errors.push({ path, message: 'must be { value, label, file }' }); // i18n-exempt(diagnostic)
        return;
      }
      const v = entry as Record<string, unknown>;
      const before = errors.length;
      if (typeof v.value !== 'string' || v.value.trim() === '' || v.value === TEMPLATE_SOUND_NONE) {
        errors.push({ path: `${path}.value`, message: `must be a non-empty string other than "${TEMPLATE_SOUND_NONE}"` }); // i18n-exempt(diagnostic)
      } else if (values.has(v.value)) {
        errors.push({ path: `${path}.value`, message: 'is duplicated' }); // i18n-exempt(diagnostic)
      }
      if (typeof v.label !== 'string' || v.label.trim() === '') {
        errors.push({ path: `${path}.label`, message: 'must be a non-empty string' }); // i18n-exempt(diagnostic)
      }
      if (typeof v.file !== 'string' || !isSafeRelativePath(v.file) || !isTemplateSoundFile(v.file)) {
        errors.push({ path: `${path}.file`, message: `must be a relative path inside the template folder ending in ${TEMPLATE_SOUND_EXTENSIONS.join(', ')}` }); // i18n-exempt(diagnostic)
      }
      if (v.gain !== undefined && (typeof v.gain !== 'number' || !Number.isFinite(v.gain) || v.gain < 0 || v.gain > 1)) {
        errors.push({ path: `${path}.gain`, message: 'must be a number from 0 to 1' }); // i18n-exempt(diagnostic)
      }
      if (errors.length !== before) return;
      values.add(v.value as string);
      variants.push({
        value: v.value as string,
        label: (v.label as string).trim(),
        file: v.file as string,
        ...(typeof v.gain === 'number' ? { gain: v.gain } : {}),
      });
    });
    if (r.default !== undefined && (typeof r.default !== 'string' || (r.default !== TEMPLATE_SOUND_NONE && !values.has(r.default)))) {
      errors.push({ path: 'sound.default', message: `must be one of the variant values, or "${TEMPLATE_SOUND_NONE}"` }); // i18n-exempt(diagnostic)
    }
  }
  if (r.at !== undefined && (typeof r.at !== 'number' || !Number.isFinite(r.at) || r.at < 0 || r.at > duration)) {
    errors.push({ path: 'sound.at', message: 'must be a moment in seconds of the template\'s own time, from 0 to its duration' }); // i18n-exempt(diagnostic)
  }
  if (errors.length !== start) return null;
  return {
    variants,
    ...(typeof r.default === 'string' ? { default: r.default } : {}),
    ...(typeof r.at === 'number' ? { at: r.at } : {}),
  };
}

/**
 * The variant a stored choice names, or null for silence: "none", a chosen
 * variant's value, or — when nothing or something unknown was stored — the
 * manifest's default, falling back to the first variant, since a template
 * that ships a sound means it to be heard.
 */
export function resolveTemplateSoundChoice(sound: TemplateSound, choice: unknown): TemplateSoundVariant | null {
  if (choice === TEMPLATE_SOUND_NONE) return null;
  if (typeof choice === 'string') {
    const found = sound.variants.find((v) => v.value === choice);
    if (found) return found;
  }
  if (sound.default === TEMPLATE_SOUND_NONE) return null;
  return sound.variants.find((v) => v.value === sound.default) ?? sound.variants[0] ?? null;
}

/**
 * When the template's sound starts on the graphic's clock, and the rate it
 * plays at, for a chosen length. The inverse of `templateTimeAt` at one
 * moment: through a hold the start moves with the part it sits in and the
 * sound plays as recorded; a `scale` template plays it faster or slower with
 * the picture, pitch kept; a loop plays it once, where its first pass would.
 */
export function templateSoundTiming(
  duration: number,
  structure: TemplateStructure | null,
  length: number,
  at: number,
): { delay: number; speed: number } {
  const designAt = Math.min(Math.max(0, at), duration);
  if (!structure || length === duration) return { delay: round(designAt), speed: 1 };
  if (structure.kind === 'scale') {
    return { delay: round(designAt * (length / Math.max(1e-9, duration))), speed: round(duration / Math.max(1e-9, length)) };
  }
  if (structure.kind === 'loop') return { delay: round(designAt), speed: 1 };
  const entrance = entranceSeconds(structure);
  const exit = exitSeconds(structure, duration);
  if (designAt <= structure.holdFrom) return { delay: round(designAt), speed: 1 };
  if (designAt >= structure.holdTo) return { delay: round(Math.max(0, designAt + (length - duration))), speed: 1 };
  // Inside the hold: the moment keeps its share of the stretched middle.
  const ownHold = Math.max(1e-9, structure.holdTo - structure.holdFrom);
  const askedHold = Math.max(0, length - entrance - exit);
  return { delay: round(entrance + ((designAt - structure.holdFrom) / ownHold) * askedHold), speed: 1 };
}

/**
 * The sound-shaped value the chosen variant plays as, ready for everything
 * milestone 48 built: `layerGainAt` for the preview's gain, `layerAudioChain`
 * for the render's mix. The `id` is the variant's file, which is never a
 * library id; the callers that need a path or a URL resolve it against the
 * template, never against the library.
 */
export function templateSoundValue(
  sound: TemplateSound,
  variant: TemplateSoundVariant,
  manifest: { duration: number; structure?: TemplateStructure },
  length: number,
): { value: SoundValue; speed?: number } {
  const { delay, speed } = templateSoundTiming(manifest.duration, manifest.structure ?? null, length, sound.at ?? 0);
  return {
    value: { ...EMPTY_SOUND, id: variant.file, ending: 'once', delay, volume: variant.gain ?? 1 },
    ...(speed !== 1 ? { speed } : {}),
  };
}

/**
 * A wipe on a cut join plays its template's default sound with it (milestone
 * 49 meets 59): the transition is the template's timeline spread over its
 * `seconds` and centered on the join, so the sound is scaled onto the same
 * window, whatever structure the wipe declares — spreading **is** `scale`.
 */
export function wipeSoundValue(
  sound: TemplateSound,
  manifest: { duration: number },
  wipe: { at: number; seconds: number },
): { value: SoundValue; speed: number } | null {
  const variant = resolveTemplateSoundChoice(sound, undefined);
  if (!variant || wipe.seconds <= 0) return null;
  const factor = wipe.seconds / Math.max(1e-9, manifest.duration);
  const delay = Math.max(0, wipe.at - wipe.seconds / 2 + (sound.at ?? 0) * factor);
  return {
    value: { ...EMPTY_SOUND, id: variant.file, ending: 'once', delay: round(delay), volume: variant.gain ?? 1 },
    speed: round(manifest.duration / wipe.seconds),
  };
}

/** Seconds, to the millisecond, as every stored time in a project is. */
function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
