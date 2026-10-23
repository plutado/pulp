/**
 * Guards for the render loop: timeouts for templates that hang, readable
 * messages for templates that throw, and the list of files to remove when a
 * render does not finish. Pure; the main process applies the results.
 */

import type { FrameState } from './runtime';

/** Default time allowed for one frame (render call plus capture). */
export const DEFAULT_FRAME_TIMEOUT_MS = 10_000;
/** Default time allowed for the template page to load and report ready. */
export const DEFAULT_LOAD_TIMEOUT_MS = 30_000;

export class RenderTimeoutError extends Error {
  override name = 'RenderTimeoutError';
}

/** Resolve or reject with `promise`, or reject with RenderTimeoutError after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderTimeoutError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** What the frame call script resolves to: null on success, error details otherwise. */
export interface TemplateErrorDetail {
  name?: string;
  message?: string;
  stack?: string;
}

/**
 * Script run in the template page for one frame. It never rejects: errors are
 * returned as data, because a rejected executeJavaScript only reports a generic
 * "Script failed to execute" message in the main process.
 */
export function frameCallScript(state: FrameState): string {
  return (
    `window.__pulp.render(${JSON.stringify(state)}).then(function () { return null; }, function (e) {` +
    ` return e instanceof Error ? { name: e.name, message: e.message, stack: String(e.stack || '') } : { message: String(e) }; })`
  );
}

/** "TypeError: x is undefined (index.html:42:7)" from the details a template error carries. */
export function formatTemplateError(detail: TemplateErrorDetail): string {
  const message = (detail.message ?? '').trim() || 'unknown error';
  const name = detail.name && detail.name !== 'Error' ? `${detail.name}: ` : '';
  const location = firstStackLocation(detail.stack ?? '');
  return `${name}${message}${location ? ` (${location})` : ''}`;
}

/** First stack location inside the template, shortened to its path within the template folder. */
function firstStackLocation(stack: string): string | null {
  for (const line of stack.split('\n')) {
    const match = /pulp-template:\/\/[^/\s)]+\/([^\s)]+:\d+:\d+)/.exec(line);
    if (match) return decodeURIComponent(match[1]!);
  }
  return null;
}

export function templateThrewMessage(templateName: string, frame: number, detail: TemplateErrorDetail): string {
  return `Template "${templateName}" threw an error on frame ${frame}: ${formatTemplateError(detail)}`;
}

export function frameTimeoutMessage(templateName: string, frame: number, ms: number): string {
  return (
    `Template "${templateName}" did not finish frame ${frame} within ${formatSeconds(ms)}. ` +
    'It may be stuck in a loop or waiting on something that never resolves.'
  );
}

export function loadTimeoutMessage(templateName: string, ms: number): string {
  return `Template "${templateName}" did not finish loading within ${formatSeconds(ms)}.`;
}

/**
 * Message for a captured frame whose pixel size is not the template's declared
 * size. The offscreen window renders at device scale 1 on purpose, so this
 * means the platform scaled or clamped it; frames are never resampled to hide that.
 */
export function captureSizeMessage(
  templateName: string,
  frame: number,
  expected: { width: number; height: number },
  actual: { width: number; height: number },
): string {
  const sx = actual.width / expected.width;
  const sy = actual.height / expected.height;
  const scale = sx === sy ? ` (scale ${Number(sx.toFixed(2))})` : '';
  return (
    `Template "${templateName}" frame ${frame} was captured at ${actual.width}x${actual.height} ` +
    `instead of ${expected.width}x${expected.height}${scale}. ` +
    'Pulp renders offscreen at device scale 1 and does not resize captured frames.'
  );
}

/** Message for a raw frame whose byte count is not width * height * 4 (padded rows or an unexpected pixel format). */
export function captureBytesMessage(templateName: string, frame: number, expectedBytes: number, actualBytes: number): string {
  return (
    `Template "${templateName}" frame ${frame} produced ${actualBytes} bytes of pixel data instead of ${expectedBytes}. ` +
    'Raw frames must be tightly packed 32-bit BGRA; use --frame-format png as a workaround.'
  );
}

function formatSeconds(ms: number): string {
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
}

/**
 * Files a failed or cancelled render may have written, for cleanup.
 *
 * A single-file output is one path. A sequence pattern such as
 * `out_%05d.png` expands to the frame numbers the render covers (from its
 * first frame), so unrelated files in the folder are never touched.
 *
 * Without overwrite, ffmpeg refuses to replace files (-n), so anything that
 * existed before the render started belongs to the user and is kept.
 */
export function partialOutputFiles(input: {
  output: string;
  sequence: boolean;
  totalFrames: number;
  /** Index of the first frame, which sequence numbering starts at. Default 0. */
  firstFrame?: number;
  overwrite: boolean;
  existedBefore: ReadonlySet<string>;
}): string[] {
  const files = input.sequence ? expandSequence(input.output, input.totalFrames, input.firstFrame ?? 0) : [input.output];
  return input.overwrite ? files : files.filter((f) => !input.existedBefore.has(f));
}

/** Expand the first printf-style `%d` / `%05d` in a path for frames start..start+count-1. */
export function expandSequence(pattern: string, count: number, start = 0): string[] {
  const match = /%(0?)(\d*)d/.exec(pattern);
  if (!match) return [pattern];
  const width = match[2] ? Number(match[2]) : 0;
  const pad = match[1] === '0' ? '0' : ' ';
  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + match[0].length);
  return Array.from({ length: count }, (_, i) => before + String(start + i).padStart(width, pad) + after);
}
