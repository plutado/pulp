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

import { BrowserWindow } from 'electron';
import { resolveRenderSize, templateDefaultSize } from '../core/aspect';
import { frameCount } from '../core/manifest';
import { defaultParams, resolveParams } from '../core/params';
import { frameState } from '../core/runtime';
import { framesToCheck, frameHash, hammingDistance, looksSame, type VisualReferences } from '../core/visual-hash';
import { scanLibrary } from '../core/library';
import type { TemplateEntry } from '../core/library-types';
import { drainPaints, offscreenDeviceScaleFactor, paintComposited } from './render';
import { withTimeout } from '../core/render-guard';

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
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: { deviceScaleFactor: offscreenDeviceScaleFactor() }, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  try {
    win.setContentSize(size.width, size.height);
    await withTimeout(win.loadURL(`pulp-template://${manifest.id}/`), LOAD_TIMEOUT_MS, 'the template did not load');
    // The load's own paints, out of the way before the first frame waits for one (see drainPaints):
    // a stale paint there would hash the blank page instead of the template.
    await drainPaints(win);
    const params = resolveParams(manifest, defaultParams(manifest)).values;
    const out: VisualResult[] = [];
    for (const frame of frames) {
      const state = frameState(manifest, frame, params, size);
      await withTimeout(win.webContents.executeJavaScript(`window.__pulp.render(${JSON.stringify(state)})`), LOAD_TIMEOUT_MS, `frame ${frame} did not draw`);
      await paintComposited(win);
      const image = await win.webContents.capturePage();
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
  const index = await scanLibrary([templatesDir]);
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
