/**
 * Lottie animations (milestone 35): the types the window and the main process
 * share. Types only, plus the constants both sides name, so the renderer's
 * type-check needs none of the reader's Node dependencies.
 *
 * A Lottie file is read as a template (src/core/lottie.ts): its manifest is
 * made from the file — size, frame rate, length — and its editable text and
 * colours become parameters. `bindings` say where each parameter writes into
 * the animation's JSON when a frame is drawn; the generated page applies them
 * (src/core/lottie-page.ts).
 */

export type LottieFormat = 'json' | 'lottie';

/** A step into the animation's JSON: object keys and array indices. */
export type LottiePath = (string | number)[];

/**
 * One place a parameter writes to. `text` is a text document's string; `rgb`
 * and `rgba` are a static colour's components in 0..1 (as many as the file
 * had); `hex` is a solid layer's `#rrggbb` string.
 */
export interface LottieTarget {
  kind: 'text' | 'rgb' | 'rgba' | 'hex';
  path: LottiePath;
}

/** A parameter of the synthesized manifest and everywhere its value lands. */
export interface LottieBinding {
  id: string;
  type: 'text' | 'color';
  targets: LottieTarget[];
}

export interface LottieMarker {
  name: string;
  /** Seconds from the start of the animation. */
  time: number;
  /** Seconds; 0 for a point marker. */
  duration: number;
}

/** What the library records about a Lottie file beside its manifest. */
export interface LottieInfo {
  /** The file itself: a `.json` or a `.lottie` archive. */
  path: string;
  format: LottieFormat;
  /** The animation's own size, as the file states it (the manifest's size is this, rounded up to even). */
  width: number;
  height: number;
  fps: number;
  inPoint: number;
  outPoint: number;
  markers: LottieMarker[];
  /** Features the player cannot draw, named rather than dropped silently. */
  limits: string[];
  /** Every animation a `.lottie` holds, by id, when there is more than one; the first is the one shown. */
  animations?: string[];
  bindings: LottieBinding[];
}

/** The reserved path under a Lottie template's origin that serves the player script. */
export const LOTTIE_PLAYER_PATH = '__pulp/lottie/player.js';

/** The parameter that says how the animation sits in a frame of another shape or size. */
export const LOTTIE_FIT_PARAM = 'fit';
export const LOTTIE_FITS = ['fit', 'fill', 'center'] as const;
export type LottieFit = (typeof LOTTIE_FITS)[number];

/** Which of the player's features the limits speak of, in plain words. */
export function lottieFormatLabel(format: LottieFormat): string {
  return format === 'lottie' ? 'Lottie animation · dotLottie archive' : 'Lottie animation · JSON';
}

/** What a Lottie document states about itself, apart from its contents. */
export interface LottieDocumentMeta {
  name?: string;
  /** The Bodymovin version that wrote it, e.g. "5.12.2". */
  version?: string;
  width: number;
  height: number;
  fps: number;
  inPoint: number;
  outPoint: number;
  markers: LottieMarker[];
}
