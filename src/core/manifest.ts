/**
 * Template manifest schema (format version 1) and validation.
 *
 * This module has no Node or DOM dependencies so it can be used from the
 * Electron main process, the renderer, and tests alike. The normative
 * description of the format lives in docs/template-format.md; keep the two in
 * sync.
 */

import { ASPECT_IDS, aspectOf, isBuiltInAspect, MAX_DIMENSION, MIN_DIMENSION, type Size } from './aspect';
import { IMAGE_ALIGNS, IMAGE_FITS, isSlotBox, type ImageAlign, type ImageFit, type SlotBoxes } from './image-slot';
import { isBuiltInStyle, isBuiltInType, normalizeTheme, STYLES } from './taxonomy';

export const MANIFEST_FILENAME = 'template.json';
export const CURRENT_FORMAT_VERSION = 1;

export const TEMPLATE_CATEGORIES = [
  'lower-third',
  'title',
  'transition',
  'overlay',
  'background',
  'other',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const PARAMETER_TYPES = ['text', 'color', 'number', 'boolean', 'select', 'font', 'image'] as const;
export type ParameterType = (typeof PARAMETER_TYPES)[number];

interface ParameterBase {
  /** Key passed to the template at render time. */
  id: string;
  /** Human-readable label for the parameter form. */
  label: string;
  description?: string;
  /** Optional grouping hint for the editor UI. */
  group?: string;
}

export interface TextParameter extends ParameterBase {
  type: 'text';
  default: string;
  maxLength?: number;
  multiline?: boolean;
}

export interface ColorParameter extends ParameterBase {
  type: 'color';
  /** `#RRGGBB` or `#RRGGBBAA`. */
  default: string;
}

export interface NumberParameter extends ParameterBase {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface BooleanParameter extends ParameterBase {
  type: 'boolean';
  default: boolean;
}

export interface SelectParameter extends ParameterBase {
  type: 'select';
  default: string;
  options: { value: string; label: string }[];
}

export interface FontParameter extends ParameterBase {
  type: 'font';
  /** A CSS font-family value. */
  default: string;
  /** Optional list of suggested families; if present the value must be one of them. */
  options?: string[];
}

/**
 * An image slot (milestone 22, ADR 0013): a box in the layout that a chosen
 * library still is drawn into, inside the template's own animation. The value
 * is a library id with a treatment, never a path; the default is always "no
 * image", since a template cannot ship a library id.
 */
export interface ImageParameter extends ParameterBase {
  type: 'image';
  default: null;
  /** Fractions of the frame; one box, or one per aspect id with an optional "default". */
  box: SlotBoxes;
  fit: ImageFit;
  align: ImageAlign;
  /** Kept clear on every edge, as a fraction of the box's shorter side; 0 to 0.45. */
  margin: number;
  /** A text parameter whose value stands in when no image is chosen. */
  fallbackText?: string;
}

export type TemplateParameter =
  | TextParameter
  | ColorParameter
  | NumberParameter
  | BooleanParameter
  | SelectParameter
  | FontParameter
  | ImageParameter;

export interface TemplateManifest {
  formatVersion: number;
  /** Stable identifier: lowercase letters, digits, dots and dashes. */
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  /** SPDX license identifier of the template itself, e.g. `CC0-1.0` or `MIT`. */
  license: string;
  category: TemplateCategory;
  /** What the template is, from the built-in type list (src/core/taxonomy.ts); when absent, the category maps to a type. */
  type?: string;
  /** What it is about or for: built-in theme ids or custom ones, normalized like tags. */
  themes?: string[];
  /** How it looks, from the built-in style list only. */
  styles?: string[];
  tags: string[];
  /** Duration in seconds. */
  duration: number;
  fps: number;
  /**
   * The shapes the template draws for, as "16:9" ids (src/core/aspect.ts); at least one.
   * A manifest that declared `width` and `height` instead gets the aspect of that size,
   * which may be a reduced ratio such as "4:3" when it is none of the built-in ones.
   */
  aspects: string[];
  /** The pixel size the manifest declared, if it did: kept as this template's default resolution. */
  size?: Size;
  /** True when the template draws on a transparent background and is meant for alpha output. */
  alpha: boolean;
  /** HTML entry point relative to the template folder. */
  entry: string;
  /** Optional poster image relative to the template folder. */
  thumbnail?: string;
  parameters: TemplateParameter[];
}

export interface ValidationIssue {
  /** JSON-path-like location, e.g. `parameters[2].default`. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; manifest: TemplateManifest; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const PARAM_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MAX_DURATION_SECONDS = 600;

export function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Rejects absolute paths and parent-directory traversal in template-relative paths. */
export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) return false;
  return !value.split(/[\\/]/).some((segment) => segment === '..');
}

function validateParameter(raw: unknown, path: string, errors: ValidationIssue[]): TemplateParameter | null {
  if (!isRecord(raw)) {
    errors.push({ path, message: 'must be an object' });
    return null;
  }
  const start = errors.length;
  const { id, label, type } = raw;

  if (typeof id !== 'string' || !PARAM_ID_PATTERN.test(id)) {
    errors.push({ path: `${path}.id`, message: 'must be an identifier (letters, digits, underscore; not starting with a digit)' });
  }
  if (!isNonEmptyString(label)) {
    errors.push({ path: `${path}.label`, message: 'must be a non-empty string' });
  }
  if (typeof type !== 'string' || !(PARAMETER_TYPES as readonly string[]).includes(type)) {
    errors.push({ path: `${path}.type`, message: `must be one of: ${PARAMETER_TYPES.join(', ')}` });
    return null;
  }

  const def = raw.default;
  const at = `${path}.default`;
  switch (type as ParameterType) {
    case 'text':
      if (typeof def !== 'string') errors.push({ path: at, message: 'must be a string' });
      if (raw.maxLength !== undefined && (!Number.isInteger(raw.maxLength) || (raw.maxLength as number) < 1)) {
        errors.push({ path: `${path}.maxLength`, message: 'must be a positive integer' });
      } else if (typeof def === 'string' && typeof raw.maxLength === 'number' && def.length > raw.maxLength) {
        errors.push({ path: at, message: `is longer than maxLength (${raw.maxLength})` });
      }
      break;
    case 'color':
      if (!isValidColor(def)) errors.push({ path: at, message: 'must be a color in #RRGGBB or #RRGGBBAA form' });
      break;
    case 'number': {
      if (!isFiniteNumber(def)) errors.push({ path: at, message: 'must be a finite number' });
      for (const key of ['min', 'max', 'step'] as const) {
        if (raw[key] !== undefined && !isFiniteNumber(raw[key])) {
          errors.push({ path: `${path}.${key}`, message: 'must be a finite number' });
        }
      }
      const { min, max, step } = raw as { min?: number; max?: number; step?: number };
      if (isFiniteNumber(min) && isFiniteNumber(max) && min > max) {
        errors.push({ path: `${path}.min`, message: 'must not be greater than max' });
      }
      if (isFiniteNumber(step) && step <= 0) errors.push({ path: `${path}.step`, message: 'must be greater than 0' });
      if (isFiniteNumber(def)) {
        if (isFiniteNumber(min) && def < min) errors.push({ path: at, message: 'is below min' });
        if (isFiniteNumber(max) && def > max) errors.push({ path: at, message: 'is above max' });
      }
      break;
    }
    case 'boolean':
      if (typeof def !== 'boolean') errors.push({ path: at, message: 'must be a boolean' });
      break;
    case 'select': {
      const options = raw.options;
      if (!Array.isArray(options) || options.length === 0) {
        errors.push({ path: `${path}.options`, message: 'must be a non-empty array' });
        break;
      }
      const values = new Set<string>();
      options.forEach((option, i) => {
        if (!isRecord(option) || typeof option.value !== 'string' || !isNonEmptyString(option.label)) {
          errors.push({ path: `${path}.options[${i}]`, message: 'must be { value: string, label: string }' });
          return;
        }
        if (values.has(option.value)) errors.push({ path: `${path}.options[${i}].value`, message: 'is duplicated' });
        values.add(option.value);
      });
      if (typeof def !== 'string' || !values.has(def)) errors.push({ path: at, message: 'must be one of the option values' });
      break;
    }
    case 'font': {
      if (!isNonEmptyString(def)) errors.push({ path: at, message: 'must be a non-empty font-family string' });
      const options = raw.options;
      if (options !== undefined) {
        if (!Array.isArray(options) || options.length === 0 || !options.every(isNonEmptyString)) {
          errors.push({ path: `${path}.options`, message: 'must be a non-empty array of strings' });
        } else if (typeof def === 'string' && !options.includes(def)) {
          errors.push({ path: at, message: 'must be one of the options' });
        }
      }
      break;
    }
    case 'image': {
      if (def !== undefined && def !== null) errors.push({ path: at, message: 'an image slot has no default: leave it out or set it to null' });
      const box = raw.box;
      if (isSlotBox(box)) {
        // One box for every shape.
      } else if (isRecord(box) && Object.keys(box).length > 0 && Object.values(box).every(isRecord)) {
        for (const [key, value] of Object.entries(box)) {
          if (key !== 'default' && !/^\d+:\d+$/.test(key)) errors.push({ path: `${path}.box.${key}`, message: 'must be an aspect id such as "16:9", or "default"' });
          if (!isSlotBox(value)) errors.push({ path: `${path}.box.${key}`, message: 'must be { x, y, width, height } as fractions of the frame, inside it' });
        }
      } else {
        errors.push({ path: `${path}.box`, message: 'must be { x, y, width, height } as fractions of the frame, or one such box per aspect' });
      }
      if (raw.fit !== undefined && !(IMAGE_FITS as readonly string[]).includes(raw.fit as string)) {
        errors.push({ path: `${path}.fit`, message: `must be one of: ${IMAGE_FITS.join(', ')}` });
      }
      if (raw.align !== undefined && !(IMAGE_ALIGNS as readonly string[]).includes(raw.align as string)) {
        errors.push({ path: `${path}.align`, message: `must be one of: ${IMAGE_ALIGNS.join(', ')}` });
      }
      if (raw.margin !== undefined && (!isFiniteNumber(raw.margin) || raw.margin < 0 || raw.margin > 0.45)) {
        errors.push({ path: `${path}.margin`, message: 'must be a number from 0 to 0.45 (a fraction of the box)' });
      }
      if (raw.fallbackText !== undefined && !isNonEmptyString(raw.fallbackText)) {
        errors.push({ path: `${path}.fallbackText`, message: 'must be the id of a text parameter' });
      }
      if (errors.length === start) {
        // Filled defaults, so every reader sees a complete slot.
        return { ...raw, default: null, fit: raw.fit ?? 'contain', align: raw.align ?? 'center', margin: raw.margin ?? 0 } as unknown as TemplateParameter;
      }
      break;
    }
  }

  return errors.length === start ? (raw as unknown as TemplateParameter) : null;
}

/**
 * Validate an untrusted, already-parsed JSON value as a template manifest.
 * Optional fields are filled with their defaults in the returned manifest.
 */
export function validateManifest(raw: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!isRecord(raw)) {
    return { ok: false, errors: [{ path: '', message: 'manifest must be a JSON object' }], warnings };
  }

  if (raw.formatVersion !== CURRENT_FORMAT_VERSION) {
    errors.push({ path: 'formatVersion', message: `must be ${CURRENT_FORMAT_VERSION}` });
  }
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) {
    errors.push({ path: 'id', message: 'must be lowercase letters and digits separated by "." or "-"' });
  }
  if (!isNonEmptyString(raw.name)) errors.push({ path: 'name', message: 'must be a non-empty string' });
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    errors.push({ path: 'description', message: 'must be a string' });
  }
  if (typeof raw.version !== 'string' || !SEMVER_PATTERN.test(raw.version)) {
    errors.push({ path: 'version', message: 'must be a semantic version such as 1.0.0' });
  }
  if (raw.author !== undefined && typeof raw.author !== 'string') errors.push({ path: 'author', message: 'must be a string' });
  if (!isNonEmptyString(raw.license)) {
    errors.push({ path: 'license', message: 'must be an SPDX license identifier, e.g. CC0-1.0' });
  }
  if (typeof raw.category !== 'string' || !(TEMPLATE_CATEGORIES as readonly string[]).includes(raw.category)) {
    errors.push({ path: 'category', message: `must be one of: ${TEMPLATE_CATEGORIES.join(', ')}` });
  }

  if (raw.type !== undefined && (typeof raw.type !== 'string' || !isBuiltInType(raw.type))) {
    errors.push({ path: 'type', message: 'must be a type id from the built-in list (see docs/template-format.md)' });
  }
  let themes: string[] | undefined;
  if (raw.themes !== undefined) {
    if (!Array.isArray(raw.themes) || !raw.themes.every(isNonEmptyString)) {
      errors.push({ path: 'themes', message: 'must be an array of non-empty strings' });
    } else {
      themes = [...new Set(raw.themes.map(normalizeTheme))].filter((t) => t.length > 0);
    }
  }
  let styles: string[] | undefined;
  if (raw.styles !== undefined) {
    if (!Array.isArray(raw.styles) || !raw.styles.every(isNonEmptyString)) {
      errors.push({ path: 'styles', message: 'must be an array of non-empty strings' });
    } else {
      styles = [...new Set(raw.styles.map((v) => v.trim().toLowerCase()))];
      for (const style of styles) {
        if (!isBuiltInStyle(style)) {
          errors.push({ path: 'styles', message: `"${style}" is not a built-in style (${STYLES.map((v) => v.id).join(', ')})` });
        }
      }
    }
  }

  let tags: string[] = [];
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || !raw.tags.every(isNonEmptyString)) {
      errors.push({ path: 'tags', message: 'must be an array of non-empty strings' });
    } else {
      tags = [...new Set(raw.tags.map((t) => t.trim().toLowerCase()))];
    }
  }

  if (!isFiniteNumber(raw.duration) || raw.duration <= 0 || raw.duration > MAX_DURATION_SECONDS) {
    errors.push({ path: 'duration', message: `must be a number of seconds in (0, ${MAX_DURATION_SECONDS}]` });
  }
  if (!isFiniteNumber(raw.fps) || raw.fps <= 0 || raw.fps > 240) {
    errors.push({ path: 'fps', message: 'must be a number in (0, 240]' });
  } else if (!Number.isInteger(raw.fps) && ![23.976, 29.97, 59.94].includes(raw.fps)) {
    warnings.push({ path: 'fps', message: 'non-integer frame rates other than 23.976, 29.97 and 59.94 are unusual' });
  }
  // Shape: `aspects`, or the older `width` and `height`, or both (the size is then the default resolution).
  let aspects: string[] | undefined;
  let aspectsOk = true;
  if (raw.aspects !== undefined) {
    if (!Array.isArray(raw.aspects) || !raw.aspects.every(isNonEmptyString)) {
      errors.push({ path: 'aspects', message: `must be an array of aspect ratios (${ASPECT_IDS.join(', ')})` });
      aspectsOk = false;
    } else {
      aspects = [...new Set(raw.aspects.map((a) => a.trim()))];
      if (aspects.length === 0) {
        errors.push({ path: 'aspects', message: 'must name at least one aspect ratio' });
        aspectsOk = false;
      }
      for (const a of aspects) {
        if (!isBuiltInAspect(a)) {
          errors.push({ path: 'aspects', message: `"${a}" is not a supported aspect ratio (${ASPECT_IDS.join(', ')})` });
          aspectsOk = false;
        }
      }
    }
  }
  let size: Size | undefined;
  if (raw.width !== undefined || raw.height !== undefined) {
    let sizeOk = true;
    for (const key of ['width', 'height'] as const) {
      const v = raw[key];
      if (!Number.isInteger(v) || (v as number) < MIN_DIMENSION || (v as number) > MAX_DIMENSION) {
        errors.push({ path: key, message: `must be an integer between ${MIN_DIMENSION} and ${MAX_DIMENSION} (width and height go together)` });
        sizeOk = false;
      } else if ((v as number) % 2 !== 0) {
        warnings.push({ path: key, message: 'odd dimensions are not supported by some encoders (yuv420p output will fail)' });
      }
    }
    if (sizeOk) {
      size = { width: raw.width as number, height: raw.height as number };
      const own = aspectOf(size.width, size.height);
      if (aspects === undefined) aspects = [own];
      else if (aspectsOk && !aspects.includes(own)) {
        errors.push({ path: 'width', message: `${size.width}x${size.height} is ${own}, which is not among the declared aspects (${aspects.join(', ')})` });
      }
    }
  } else if (aspects === undefined) {
    errors.push({ path: 'aspects', message: `declare the aspect ratios the template draws for (${ASPECT_IDS.join(', ')}), or a width and height` });
  }
  if (raw.alpha !== undefined && typeof raw.alpha !== 'boolean') errors.push({ path: 'alpha', message: 'must be a boolean' });

  const entry = raw.entry === undefined ? 'index.html' : raw.entry;
  if (typeof entry !== 'string' || !isSafeRelativePath(entry) || !/\.html?$/i.test(entry)) {
    errors.push({ path: 'entry', message: 'must be a relative path to an .html file inside the template folder' });
  }
  if (raw.thumbnail !== undefined && (typeof raw.thumbnail !== 'string' || !isSafeRelativePath(raw.thumbnail))) {
    errors.push({ path: 'thumbnail', message: 'must be a relative path inside the template folder' });
  }

  const parameters: TemplateParameter[] = [];
  if (raw.parameters !== undefined && !Array.isArray(raw.parameters)) {
    errors.push({ path: 'parameters', message: 'must be an array' });
  } else if (Array.isArray(raw.parameters)) {
    const seen = new Set<string>();
    raw.parameters.forEach((p, i) => {
      const param = validateParameter(p, `parameters[${i}]`, errors);
      if (!param) return;
      if (seen.has(param.id)) {
        errors.push({ path: `parameters[${i}].id`, message: `duplicate parameter id "${param.id}"` });
        return;
      }
      seen.add(param.id);
      parameters.push(param);
    });
    // A slot's fallback must name a text parameter of this template; checked once every parameter is known.
    parameters.forEach((param, i) => {
      if (param.type !== 'image' || param.fallbackText === undefined) return;
      const target = parameters.find((other) => other.id === param.fallbackText);
      if (!target || target.type !== 'text') {
        errors.push({ path: `parameters[${i}].fallbackText`, message: `"${param.fallbackText}" is not a text parameter of this template` });
      }
    });
  }

  const known = new Set([
    'formatVersion', 'id', 'name', 'description', 'version', 'author', 'license', 'category', 'type', 'themes', 'styles', 'tags',
    'duration', 'fps', 'aspects', 'width', 'height', 'alpha', 'entry', 'thumbnail', 'parameters',
  ]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key) && !key.startsWith('x-')) {
      warnings.push({ path: key, message: 'unknown field (use an "x-" prefix for custom extensions)' });
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  const manifest: TemplateManifest = {
    formatVersion: CURRENT_FORMAT_VERSION,
    id: raw.id as string,
    name: (raw.name as string).trim(),
    version: raw.version as string,
    license: raw.license as string,
    category: raw.category as TemplateCategory,
    tags,
    duration: raw.duration as number,
    fps: raw.fps as number,
    aspects: aspects ?? [],
    alpha: (raw.alpha as boolean | undefined) ?? false,
    entry: entry as string,
    parameters,
  };
  if (size) manifest.size = size;
  if (typeof raw.type === 'string') manifest.type = raw.type;
  if (themes !== undefined) manifest.themes = themes;
  if (styles !== undefined) manifest.styles = styles;
  if (typeof raw.description === 'string') manifest.description = raw.description;
  if (typeof raw.author === 'string') manifest.author = raw.author;
  if (typeof raw.thumbnail === 'string') manifest.thumbnail = raw.thumbnail;
  return { ok: true, manifest, warnings };
}

/** Parse manifest JSON text and validate it. JSON syntax errors are reported as validation errors. */
export function parseManifest(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [{ path: '', message: `invalid JSON: ${(err as Error).message}` }], warnings: [] };
  }
  return validateManifest(raw);
}

/** Total number of frames rendered for a manifest (duration rounded to whole frames). */
export function frameCount(manifest: Pick<TemplateManifest, 'duration' | 'fps'>): number {
  return Math.max(1, Math.round(manifest.duration * manifest.fps));
}
