/**
 * Aspect ratios and output resolutions (ADR 0012, milestone 19).
 *
 * A template is defined by the shapes it draws for, not by a pixel size: a
 * lower third is a lower third at 1920 × 1080 and at 1080 × 1920. The
 * manifest names its aspects; the pixel size is chosen when a frame is
 * rendered, previewed or thumbnailed, through `resolveRenderSize`. A manifest
 * written with `width` and `height` keeps working: its aspect is inferred and
 * the size becomes that template's default resolution.
 *
 * Pure: no Node, no DOM.
 */

export interface Size {
  width: number;
  height: number;
}

/** A named output resolution for one aspect. */
export interface Resolution extends Size {
  /** Short name as editors say it: "1080p", "4K". Named by the short side for every shape. */
  label: string;
}

export interface Aspect {
  /** "16:9" form; the id the manifest and the search syntax use. */
  id: string;
  /** Ratio terms, so an aspect can be compared with a size. */
  w: number;
  h: number;
  /** Standard resolutions, smallest first. */
  resolutions: readonly Resolution[];
  /** The resolution used when none is chosen: the 1080-class size. */
  default: Resolution;
}

function res(label: string, width: number, height: number): Resolution {
  return { label, width, height };
}

const LANDSCAPE = [res('720p', 1280, 720), res('1080p', 1920, 1080), res('1440p', 2560, 1440), res('4K', 3840, 2160), res('8K', 7680, 4320)] as const;
const PORTRAIT = [res('720p', 720, 1280), res('1080p', 1080, 1920), res('1440p', 1440, 2560), res('4K', 2160, 3840)] as const;
const SQUARE = [res('720p', 720, 720), res('1080p', 1080, 1080), res('1440p', 1440, 1440), res('4K', 2160, 2160)] as const;
const FOUR_FIVE = [res('720p', 720, 900), res('1080p', 1080, 1350), res('1440p', 1440, 1800), res('4K', 2160, 2700)] as const;

/** The aspects a template may declare. Ids are permanent; add, never rename. */
export const ASPECTS: readonly Aspect[] = [
  { id: '16:9', w: 16, h: 9, resolutions: LANDSCAPE, default: LANDSCAPE[1] },
  { id: '9:16', w: 9, h: 16, resolutions: PORTRAIT, default: PORTRAIT[1] },
  { id: '1:1', w: 1, h: 1, resolutions: SQUARE, default: SQUARE[1] },
  { id: '4:5', w: 4, h: 5, resolutions: FOUR_FIVE, default: FOUR_FIVE[1] },
];

export const ASPECT_IDS: readonly string[] = ASPECTS.map((a) => a.id);

/** Frame sizes the renderer accepts, in pixels per side. */
export const MIN_DIMENSION = 16;
export const MAX_DIMENSION = 8192;

/** A size is "of" an aspect when its ratio is within this fraction of the aspect's. 1% takes 1366 × 768 as 16:9; 4:3 stays apart. */
const TOLERANCE = 0.01;

export function isBuiltInAspect(id: string): boolean {
  return ASPECT_IDS.includes(id);
}

export function aspectById(id: string): Aspect | undefined {
  return ASPECTS.find((a) => a.id === id);
}

/** The built-in aspect a size has, or null when it is none of them. */
export function inferAspect(width: number, height: number): Aspect | null {
  if (!(width > 0) || !(height > 0)) return null;
  const ratio = width / height;
  return ASPECTS.find((a) => Math.abs(ratio - a.w / a.h) / (a.w / a.h) <= TOLERANCE) ?? null;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The aspect id of a size: a built-in id when it is near one, otherwise the
 * reduced ratio ("4:3", "16:10"), so a manifest that declared an unusual size
 * still has a name for its shape and keeps rendering at that one size.
 */
export function aspectOf(width: number, height: number): string {
  const known = inferAspect(width, height);
  if (known) return known.id;
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

export type Orientation = 'landscape' | 'portrait' | 'square';
export const ORIENTATIONS: readonly Orientation[] = ['landscape', 'portrait', 'square'];

/** The orientation of a shape, from a size. */
export function orientationOf(width: number, height: number): Orientation {
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

/** The orientation of an aspect id ("9:16" is portrait), or undefined for a malformed one. */
export function aspectOrientation(id: string): Orientation | undefined {
  const m = /^(\d+):(\d+)$/.exec(id);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? orientationOf(w, h) : undefined;
}

/** Every orientation a template draws for, in the order it declares them, without repeats. */
export function templateOrientations(template: { aspects: readonly string[] }): Orientation[] {
  const out: Orientation[] = [];
  for (const a of template.aspects) {
    const o = aspectOrientation(a);
    if (o && !out.includes(o)) out.push(o);
  }
  return out;
}

/** What a template says about its shapes and its size: the slice of a manifest this module reads. */
export interface ShapeDeclaration {
  /** At least one; built-in ids, or the reduced ratio of a declared size. */
  aspects: readonly string[];
  /** The pixel size a manifest declared, kept as its default resolution. */
  size?: Size;
}

/** The aspect a template renders at when none is chosen: the one its declared size has, else the first declared. */
export function defaultAspect(template: ShapeDeclaration): string {
  return template.size ? aspectOf(template.size.width, template.size.height) : (template.aspects[0] ?? '16:9');
}

/** The sizes offered for an aspect: the built-in list, or the template's own size for a custom aspect. */
export function resolutionsFor(template: ShapeDeclaration, aspect: string): readonly Resolution[] {
  const known = aspectById(aspect);
  if (known) return known.resolutions;
  if (template.size && aspectOf(template.size.width, template.size.height) === aspect) {
    return [res(`${template.size.width} × ${template.size.height}`, template.size.width, template.size.height)];
  }
  return [];
}

/** The size a template is rendered at when nothing is chosen: what it declared, else its first aspect's default. */
export function templateDefaultSize(template: ShapeDeclaration): Size {
  if (template.size) return { width: template.size.width, height: template.size.height };
  const aspect = aspectById(template.aspects[0] ?? '16:9');
  const d = aspect?.default ?? LANDSCAPE[1];
  return { width: d.width, height: d.height };
}

export class AspectError extends Error {}

/** The shape and size choices a render may carry. The Output tab and the headless flags fill these in. */
export interface SizeChoice {
  /** One of the template's aspects. Default: `defaultAspect`. */
  aspect?: string;
  /** An exact output size; must be of the chosen aspect. Default: the template's declared size for that aspect, else the aspect's default. */
  width?: number;
  height?: number;
}

/**
 * The frame size for one render: the aspect checked against what the template
 * draws for, the size checked against the aspect. Throws `AspectError` with a
 * message fit for the window or the terminal.
 */
export function resolveRenderSize(template: ShapeDeclaration, choice: SizeChoice = {}): { aspect: string } & Size {
  const supported = template.aspects.length > 0 ? template.aspects : ['16:9'];
  const hasW = choice.width !== undefined;
  const hasH = choice.height !== undefined;
  if (hasW !== hasH) throw new AspectError('width and height must be given together');
  if (hasW) {
    for (const [name, v] of [['width', choice.width], ['height', choice.height]] as const) {
      if (!Number.isInteger(v) || (v as number) < MIN_DIMENSION || (v as number) > MAX_DIMENSION) {
        throw new AspectError(`${name} must be a whole number of pixels between ${MIN_DIMENSION} and ${MAX_DIMENSION}${Number.isNaN(v) ? '' : `, got ${String(v)}`}`);
      }
    }
  }
  const sizeAspect = hasW ? aspectOf(choice.width!, choice.height!) : undefined;
  const aspect = choice.aspect ?? sizeAspect ?? defaultAspect(template);
  if (!supported.includes(aspect)) {
    throw new AspectError(
      `aspect ${aspect} is not one the template draws for (${supported.join(', ')})`,
    );
  }
  if (sizeAspect !== undefined && sizeAspect !== aspect) {
    throw new AspectError(`${choice.width} × ${choice.height} is ${sizeAspect}, not ${aspect}`);
  }
  if (hasW) return { aspect, width: choice.width!, height: choice.height! };
  if (template.size && aspectOf(template.size.width, template.size.height) === aspect) {
    return { aspect, width: template.size.width, height: template.size.height };
  }
  const known = aspectById(aspect);
  if (!known) throw new AspectError(`aspect ${aspect} has no standard sizes; give a width and height`);
  return { aspect, width: known.default.width, height: known.default.height };
}
