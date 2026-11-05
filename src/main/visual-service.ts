/**
 * The visual regression check (docs/ideas.md): every bundled template, at each
 * aspect it declares, at a few fixed frames, reduced to a perceptual hash and
 * compared with the approved references in `tests/visual/references.json`.
 *
 * Hashes rather than reference images: this repository ships no binaries — even
 * the sample media is generated — and a hash is a short string a reviewer can
 * read in a diff. `src/core/visual-hash.ts` says what one is and what counts as
 * the same picture.
 *
 * One offscreen window per template and aspect, stepped through the frames it
 * is asked for, so the whole library is a few hundred window loads rather than
 * a render each.
 */

import { resolveRenderSize, templateDefaultSize } from '../core/aspect';
import { frameCount } from '../core/manifest';
import { defaultParams, resolveParams } from '../core/params';
import { frameState } from '../core/runtime';
import { framesToCheck, frameHash, hammingDistance, looksSame, type VisualReferences } from '../core/visual-hash';
import { scanLibrary } from '../core/library';
import type { TemplateEntry } from '../core/library-types';
import { capturePresented, createCaptureWindow, fitPageToFrame } from './capture-window';
import { withTimeout } from '../core/render-guard';
import { captionBandFor } from '../core/player';
import {
  differingRect, madeForVertical, placementCaptions, placementFrames, placementProblems, VERTICAL_CHECK_SIZE, withOtherWords, type PixelRect,
} from '../core/vertical-layout';

export interface VisualResult {
  template: string;
  aspect: string;
  frame: number;
  hash: string;
}

export interface VisualMismatch extends VisualResult {
  reference: string;
  apart: number;
}

const LOAD_TIMEOUT_MS = 30_000;

/** Every hash for one template at one aspect, from one window. */
async function hashTemplate(entry: TemplateEntry, aspect: string): Promise<VisualResult[] | { error: string }> {
  const manifest = entry.manifest;
  const size = aspect === '' ? templateDefaultSize(manifest) : resolveRenderSize(manifest, { aspect });
  const total = frameCount(manifest);
  const frames = framesToCheck(total);
  const capture = createCaptureWindow(size, { backgroundThrottling: false });
  const win = capture.win;
  try {
    await withTimeout(win.loadURL(`pulp-template://${manifest.id}/`), LOAD_TIMEOUT_MS, 'the template did not load');
    await fitPageToFrame(capture);
    const params = resolveParams(manifest, defaultParams(manifest)).values;
    const out: VisualResult[] = [];
    for (const frame of frames) {
      const state = frameState(manifest, frame, params, size);
      await withTimeout(win.webContents.executeJavaScript(`window.__pulp.render(${JSON.stringify(state)})`), LOAD_TIMEOUT_MS, `frame ${frame} did not draw`);
      // Hashed from a frame presented after the draw, never the one before it (capturePresented).
      const image = await capturePresented(win);
      const got = image.getSize();
      if (got.width !== size.width || got.height !== size.height) return { error: `captured at ${got.width}x${got.height} instead of ${size.width}x${size.height}` };
      out.push({ template: manifest.id, aspect: aspect || 'default', frame, hash: frameHash(image.toBitmap(), size.width, size.height) });
    }
    return out;
  } catch (err) {
    return { error: (err as Error).message };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Hash every bundled template at every aspect it declares. */
export async function hashLibrary(templatesDir: string, onProgress?: (done: number, total: number, what: string) => void): Promise<{ results: VisualResult[]; failed: { what: string; error: string }[] }> {
  // Named as the bundled root, so every item is keyed by its path inside the app and the hashes
  // written here match in another checkout, on another platform (src/core/library-scan.ts).
  const index = await scanLibrary([templatesDir], { builtInRoot: templatesDir });
  const jobs: { entry: TemplateEntry; aspect: string }[] = [];
  for (const entry of index.templates) {
    const aspects = entry.manifest.aspects.length > 0 ? entry.manifest.aspects : [''];
    for (const aspect of aspects) jobs.push({ entry, aspect });
  }
  const results: VisualResult[] = [];
  const failed: { what: string; error: string }[] = [];
  let done = 0;
  for (const job of jobs) {
    const what = `${job.entry.manifest.id} ${job.aspect || 'default'}`;
    const got = await hashTemplate(job.entry, job.aspect);
    if ('error' in got) failed.push({ what, error: got.error });
    else results.push(...got);
    onProgress?.(++done, jobs.length, what);
  }
  return { results, failed };
}

/** Results as the reference file stores them: template, then aspect, then frame. */
export function toReferences(results: readonly VisualResult[]): VisualReferences {
  const out: VisualReferences = {};
  for (const r of [...results].sort((a, b) => a.template.localeCompare(b.template) || a.aspect.localeCompare(b.aspect) || a.frame - b.frame)) {
    ((out[r.template] ??= {})[r.aspect] ??= {})[String(r.frame)] = r.hash;
  }
  return out;
}

/** What no longer looks like its reference, and what has no reference at all. */
export function compare(results: readonly VisualResult[], references: VisualReferences): { changed: VisualMismatch[]; missing: VisualResult[] } {
  const changed: VisualMismatch[] = [];
  const missing: VisualResult[] = [];
  for (const r of results) {
    const reference = references[r.template]?.[r.aspect]?.[String(r.frame)];
    if (reference === undefined) missing.push(r);
    else if (!looksSame(r.hash, reference)) changed.push({ ...r, reference, apart: hammingDistance(r.hash, reference) });
  }
  return { changed, missing };
}

// ---------------------------------------------------------------- words in a tall frame (milestone 65)

export interface PlacementResult {
  template: string;
  /** "frame 45", or "caption, word 4 spoken" for a caption style. */
  moment: string;
  /** Where the words were found, in pixels of the 1080 × 1920 check frame; null when none were. */
  words: PixelRect | null;
  problems: string[];
}

/**
 * Where one template made for vertical draws its words at 9:16, at each
 * moment it has settled (`placementFrames`) — or, for a caption style, with
 * the first, a middle and the last word of a long line being spoken — and
 * what is wrong with where they are. Each moment is drawn twice, the second
 * time with every word changed, and the words are where the two differ
 * (src/core/vertical-layout.ts).
 */
async function placeTemplate(entry: TemplateEntry): Promise<PlacementResult[] | { error: string }> {
  const manifest = entry.manifest;
  const size = { ...VERTICAL_CHECK_SIZE };
  const capture = createCaptureWindow(size, { backgroundThrottling: false });
  const win = capture.win;
  const textParams = manifest.parameters.filter((p) => p.type === 'text').map((p) => p.id);
  const draw = async (state: unknown, what: string) => {
    await withTimeout(win.webContents.executeJavaScript(`window.__pulp.render(${JSON.stringify(state)})`), LOAD_TIMEOUT_MS, `${what} did not draw`);
    const image = await capturePresented(win);
    const got = image.getSize();
    if (got.width !== size.width || got.height !== size.height) throw new Error(`captured at ${got.width}x${got.height} instead of ${size.width}x${size.height}`);
    return new Uint8Array(image.toBitmap());
  };
  try {
    await withTimeout(win.loadURL(`pulp-template://${manifest.id}/`), LOAD_TIMEOUT_MS, 'the template did not load');
    await fitPageToFrame(capture);
    const params = resolveParams(manifest, defaultParams(manifest)).values;
    const moments = manifest.captions
      ? placementCaptions(captionBandFor(size.width, size.height)).map((captions) => ({
          moment: `caption, word ${captions.spoken + 1} spoken`,
          state: frameState(manifest, 0, params, size, {}, {}, undefined, captions),
        }))
      : placementFrames(manifest).map((frame) => ({ moment: `frame ${frame}`, state: frameState(manifest, frame, params, size) }));
    const out: PlacementResult[] = [];
    for (const { moment, state } of moments) {
      const as = await draw(state, moment);
      const changed = await draw(withOtherWords(state, textParams), `${moment} with other words`);
      const words = differingRect(as, changed, size.width, size.height);
      out.push({ template: manifest.id, moment, words, problems: words ? placementProblems(words, size.width, size.height) : ['no words found: changing them changed nothing drawn'] });
    }
    return out;
  } catch (err) {
    return { error: (err as Error).message };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Every bundled template made for vertical, checked for where its words sit at 9:16. */
export async function checkVerticalPlacement(templatesDir: string, onProgress?: (done: number, total: number, what: string) => void): Promise<{ results: PlacementResult[]; failed: { what: string; error: string }[] }> {
  const index = await scanLibrary([templatesDir], { builtInRoot: templatesDir });
  const entries = index.templates.filter((t) => madeForVertical(t.manifest));
  const results: PlacementResult[] = [];
  const failed: { what: string; error: string }[] = [];
  let done = 0;
  for (const entry of entries) {
    if (!entry.manifest.aspects.includes('9:16')) {
      failed.push({ what: entry.manifest.id, error: 'made for vertical, but does not declare 9:16' });
    } else {
      const got = await placeTemplate(entry);
      if ('error' in got) failed.push({ what: entry.manifest.id, error: got.error });
      else results.push(...got);
    }
    onProgress?.(++done, entries.length, entry.manifest.id);
  }
  return { results, failed };
}
