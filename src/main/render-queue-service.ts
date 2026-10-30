/**
 * Runs queued renders one after another and forwards queue snapshots to the
 * UI. The save dialog is shown when a job is added, so the user picks every
 * output path up front and can leave the queue to work.
 */

import { app, BrowserWindow, dialog } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TemplateEntry } from '../core/library';
import { OUTPUT_PRESETS, resolveTiming, type PresetId, type RenderOptions } from '../core/render-plan';
import { RenderQueue, type RenderQueueSnapshot } from '../core/render-queue';
import type { BatchRequest, EnqueueBatchResult, EnqueueResult, PrepareDragResult, RenderCollectionResult, RenderRequest } from '../shared/api';
import type { CollectionItem } from '../core/collection';
import { slug } from '../core/pack';
import { cacheKey } from '../core/render-cache';
import { imageIdsIn } from '../core/image-slot';
import { imageStamps, resolveRowImages } from './image-grant';
import { clipStamps } from './clip-grant';
import { clipIdsInLayers } from '../core/video-layer';
import { splitLayers } from '../core/params';
import { cacheFileForKey, dragFileFor, evictIfNeeded, isCachedFile } from './render-cache-service';
import { existsSync } from 'node:fs';
import { findTemplate, lookupMedia, markItemRendered, markItemUsed } from './library-service';
import { renderTemplate } from './render';
import { planMediaRender, renderMedia } from './media-render';
import { AUDIO_PRESETS, isAudioPresetId } from '../core/media-render';
import { mediaCacheKey } from '../core/render-cache';
import type { MediaEntry } from '../core/library-types';

/** Per-job inputs the UI does not need to see: a template to step, or a media item to transcode (milestone 15). */
type JobInputs =
  | { template: TemplateEntry; media?: undefined; params: Record<string, unknown>; options?: RenderOptions; forCache?: boolean }
  | { template?: undefined; media: MediaEntry; params: Record<string, unknown>; options?: RenderOptions; forCache?: boolean };

/** Files that may be dragged: outputs of finished jobs (cache files are allowed by location). */
const finishedOutputs = new Set<string>();

export function allowedDragFiles(): ReadonlySet<string> {
  return finishedOutputs;
}

/** A preset's label and extension, whichever list it is in. */
function presetFacts(presetId: string): { label: string; extension: string; sequence: boolean } | null {
  if (isAudioPresetId(presetId)) return { label: AUDIO_PRESETS[presetId].label, extension: AUDIO_PRESETS[presetId].extension, sequence: false };
  const preset = OUTPUT_PRESETS[presetId as PresetId];
  return preset ? { label: preset.label, extension: preset.extension, sequence: preset.sequence } : null;
}

/** The media item a request or a collection item names, when the library has it and can reach it. */
function mediaFor(id: string): MediaEntry | null {
  const found = lookupMedia(id);
  return found && found.online ? found.entry : null;
}

const queue = new RenderQueue(broadcast);
const inputs = new Map<number, JobInputs>();
let active: AbortController | null = null;
let pumping = false;

function broadcast(snapshot: RenderQueueSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('queue:changed', snapshot);
  }
}

export function getRenderQueue(): RenderQueueSnapshot {
  return queue.snapshot();
}

/** Ask where to save, then queue a media item's own render (milestone 15). */
async function enqueueMediaRender(request: RenderRequest & { mediaId: string }): Promise<EnqueueResult> {
  const entry = mediaFor(request.mediaId);
  if (!entry) return { ok: false, message: 'That item is not in the library, or its folder is offline.' };
  const facts = presetFacts(request.presetId);
  if (!facts) return { ok: false, message: `Unknown preset "${request.presetId}".` };
  const planned = await planMediaRender(entry, request.presetId, request.options, request.params, join(homedir(), `render${facts.extension}`));
  if (!planned.ok) return { ok: false, message: planned.message };
  const save = await dialog.showSaveDialog({
    title: `Render ${entry.name}`,
    defaultPath: join(app.getPath('videos') || homedir(), `${slug(entry.name, 'render')}${facts.extension}`),
    filters: [{ name: facts.label, extensions: [facts.extension.slice(1)] }],
  });
  if (save.canceled || !save.filePath) return { ok: false, cancelled: true, message: 'Render cancelled.' };
  const job = queue.add({
    templateId: '',
    mediaId: entry.id,
    templateName: entry.name,
    presetId: request.presetId,
    outputPath: save.filePath,
    totalFrames: planned.plan.timing.totalFrames,
    firstFrame: planned.plan.timing.firstFrame,
  });
  inputs.set(job.id, { media: entry, params: request.params, ...(request.options ? { options: request.options } : {}) });
  markItemUsed(entry.id);
  void pump();
  return { ok: true, jobId: job.id };
}

/** Ask where to save, then queue the render. Resolves as soon as the job is queued. */
export async function enqueueRender(request: RenderRequest): Promise<EnqueueResult> {
  if (request.mediaId) return enqueueMediaRender({ ...request, mediaId: request.mediaId });
  if (!request.templateId) return { ok: false, message: 'Nothing to render: the request names no template and no item.' };
  const template = await findTemplate(request.templateId);
  if (!template) return { ok: false, message: `Template "${request.templateId}" not found.` };
  const preset = OUTPUT_PRESETS[request.presetId as PresetId];
  if (!preset) return { ok: false, message: `Unknown preset "${request.presetId}".` };
  // Validate the options before asking where to save.
  let timing;
  try {
    timing = resolveTiming(template.manifest, request.options);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }

  const defaultName = `${template.manifest.id.split('.').pop() ?? 'render'}${preset.extension}`;
  const save = await dialog.showSaveDialog({
    title: `Render ${template.manifest.name}`,
    defaultPath: join(app.getPath('videos') || homedir(), defaultName),
    filters: [{ name: preset.label, extensions: [preset.extension.slice(1)] }],
  });
  if (save.canceled || !save.filePath) return { ok: false, cancelled: true, message: 'Render cancelled.' };

  const job = queue.add({
    templateId: template.manifest.id,
    templateName: template.manifest.name,
    presetId: preset.id,
    outputPath: save.filePath,
    totalFrames: timing.totalFrames,
    firstFrame: timing.firstFrame,
  });
  inputs.set(job.id, { template, params: request.params, ...(request.options ? { options: request.options } : {}) });
  markItemUsed(template.id);
  void pump();
  return { ok: true, jobId: job.id };
}

/**
 * Render into the cache for dragging, unless the same render is already
 * cached. Resolves at once with either the cached file or the queued job.
 */
/** A media item rendered into the cache for dragging (milestone 15), or found there already. */
async function prepareMediaDrag(request: RenderRequest & { mediaId: string }): Promise<PrepareDragResult> {
  const entry = mediaFor(request.mediaId);
  if (!entry) return { ok: false, message: 'That item is not in the library, or its folder is offline.' };
  const facts = presetFacts(request.presetId);
  if (!facts) return { ok: false, message: `Unknown preset "${request.presetId}".` };
  const planned = await planMediaRender(entry, request.presetId, request.options, request.params, join(homedir(), `render${facts.extension}`));
  if (!planned.ok) return { ok: false, message: planned.message };
  const timing = planned.plan.timing;
  const key = mediaCacheKey({ id: entry.id, size: entry.size, mtimeMs: entry.mtimeMs, presetId: request.presetId, options: request.options, params: request.params });
  const { path: outputPath } = await cacheFileForKey(key, entry.name, facts.extension, facts.sequence);
  const existing = dragFileFor(outputPath, timing.firstFrame);
  const job = { templateId: '', mediaId: entry.id, templateName: entry.name, presetId: request.presetId, outputPath, totalFrames: timing.totalFrames, firstFrame: timing.firstFrame };
  if (existsSync(existing) && (await isCachedFile(existing))) {
    const cached = queue.addFinished(job, outputPath, timing.totalFrames);
    finishedOutputs.add(existing);
    markItemUsed(entry.id);
    return { ok: true, cached: true, file: existing, jobId: cached.id };
  }
  const queued = queue.add(job);
  inputs.set(queued.id, { media: entry, params: request.params, forCache: true, ...(request.options ? { options: request.options } : {}) });
  markItemUsed(entry.id);
  void pump();
  return { ok: true, cached: false, jobId: queued.id };
}

export async function prepareDrag(request: RenderRequest): Promise<PrepareDragResult> {
  if (request.mediaId) return prepareMediaDrag({ ...request, mediaId: request.mediaId });
  if (!request.templateId) return { ok: false, message: 'Nothing to render: the request names no template and no item.' };
  const template = await findTemplate(request.templateId);
  if (!template) return { ok: false, message: `Template "${request.templateId}" not found.` };
  const preset = OUTPUT_PRESETS[request.presetId as PresetId];
  if (!preset) return { ok: false, message: `Unknown preset "${request.presetId}".` };
  let timing;
  try {
    timing = resolveTiming(template.manifest, request.options);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  // The chosen images' size and mtime are part of the key, so a replaced logo renders afresh (milestone 22).
  const key = cacheKey({
    templateId: template.manifest.id,
    manifest: template.manifest,
    params: request.params,
    presetId: preset.id,
    options: request.options,
    images: imageStamps(imageIdsIn(template.manifest.parameters, request.params)),
    // A clip a layer plays is an input like a chosen still: re-export it and this is a new render.
    clips: clipStamps(clipIdsInLayers(splitLayers(request.params).layers)),
  });
  // Clean names (the editor shows them as clip names): lower-third-bar.mov, lower-third-bar-2.mov, keyed in the cache index.
  const { path: outputPath } = await cacheFileForKey(key, template.manifest.name, preset.extension, preset.sequence);
  const existing = dragFileFor(outputPath, timing.firstFrame);
  if (existsSync(existing) && (await isCachedFile(existing))) {
    // Already rendered, but the tray still gets a card: one place to drag from,
    // whether the render happened now or an hour ago.
    const cached = queue.addFinished(
      {
        templateId: template.manifest.id,
        templateName: template.manifest.name,
        presetId: preset.id,
        outputPath,
        totalFrames: timing.totalFrames,
        firstFrame: timing.firstFrame,
      },
      outputPath,
      timing.totalFrames,
    );
    // The card can be dragged, revealed and copied, like any other finished render.
    finishedOutputs.add(existing);
    markItemUsed(template.id);
    return { ok: true, cached: true, file: existing, jobId: cached.id };
  }
  const job = queue.add({
    templateId: template.manifest.id,
    templateName: template.manifest.name,
    presetId: preset.id,
    outputPath,
    totalFrames: timing.totalFrames,
    firstFrame: timing.firstFrame,
  });
  inputs.set(job.id, { template, params: request.params, forCache: true, ...(request.options ? { options: request.options } : {}) });
  markItemUsed(template.id);
  void pump();
  return { ok: true, cached: false, jobId: job.id };
}

/**
 * Queue a collection: one job per item into one folder, each with the settings
 * the item carries. Items whose template has gone are reported rather than
 * silently dropped, and whatever can render still does.
 */
export async function enqueueCollectionItems(items: readonly CollectionItem[], folder: string): Promise<RenderCollectionResult> {
  const jobIds: number[] = [];
  const skipped: string[] = [];
  const used = new Map<string, number>();
  for (const item of items) {
    // Two of the same item in one collection must not render over each other.
    const fileNameFor = (): string => {
      const base = slug(item.name, 'render');
      const seen = (used.get(base) ?? 0) + 1;
      used.set(base, seen);
      return seen === 1 ? base : `${base}-${seen}`;
    };
    if (item.kind === 'media') {
      // A media item renders itself (milestone 15), with the settings its card carries.
      const entry = mediaFor(item.id);
      const facts = presetFacts(item.presetId);
      if (!entry || !facts) {
        skipped.push(`${item.name}: ${entry ? `unknown preset "${item.presetId}"` : 'it is not in the library, or its folder is offline'}`);
        continue;
      }
      const outputPath = join(folder, `${fileNameFor()}${facts.extension}`);
      const planned = await planMediaRender(entry, item.presetId, item.options, item.params, outputPath);
      if (!planned.ok) {
        skipped.push(`${item.name}: ${planned.message}`);
        continue;
      }
      const job = queue.add({ templateId: '', mediaId: entry.id, templateName: entry.name, label: item.name, presetId: item.presetId, outputPath, totalFrames: planned.plan.timing.totalFrames, firstFrame: planned.plan.timing.firstFrame });
      inputs.set(job.id, { media: entry, params: item.params, ...(item.options ? { options: item.options } : {}) });
      jobIds.push(job.id);
      markItemUsed(entry.id);
      continue;
    }
    const template = item.templateId ? await findTemplate(item.templateId) : null;
    const preset = OUTPUT_PRESETS[item.presetId as PresetId];
    if (!template || !preset) {
      skipped.push(`${item.name}: ${template ? `unknown preset "${item.presetId}"` : 'its template is not in the library'}`);
      continue;
    }
    let timing;
    try {
      timing = resolveTiming(template.manifest, item.options);
    } catch (err) {
      skipped.push(`${item.name}: ${(err as Error).message}`);
      continue;
    }
    const job = queue.add({
      templateId: template.manifest.id,
      templateName: template.manifest.name,
      label: item.name,
      presetId: preset.id,
      outputPath: join(folder, `${fileNameFor()}${preset.extension}`),
      totalFrames: timing.totalFrames,
      firstFrame: timing.firstFrame,
    });
    inputs.set(job.id, { template, params: item.params, ...(item.options ? { options: item.options } : {}) });
    jobIds.push(job.id);
    markItemUsed(template.id);
  }
  if (jobIds.length === 0) return { ok: false, message: skipped.join('; ') || 'Nothing could be queued.' };
  void pump();
  return { ok: true, jobIds, folder, skipped };
}

/** Ask for a folder once, then queue one job per row, named and filed by the row. */
export async function enqueueBatch(request: BatchRequest): Promise<EnqueueBatchResult> {
  const template = await findTemplate(request.templateId);
  if (!template) return { ok: false, message: `Template "${request.templateId}" not found.` };
  const preset = OUTPUT_PRESETS[request.presetId as PresetId];
  if (!preset) return { ok: false, message: `Unknown preset "${request.presetId}".` };
  if (request.rows.length === 0) return { ok: false, message: 'The batch has no rows.' };
  let timing;
  try {
    timing = resolveTiming(template.manifest, request.options);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  const pick = await dialog.showOpenDialog({
    title: `Folder for ${request.rows.length} renders of ${template.manifest.name}`,
    defaultPath: app.getPath('videos') || homedir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  const folder = pick.filePaths[0];
  if (pick.canceled || !folder) return { ok: false, cancelled: true, message: 'Batch cancelled.' };

  const jobIds: number[] = [];
  const skipped: string[] = [];
  for (const row of request.rows) {
    // A logo column may name a file in the Imported folder; a row whose logo cannot be found is named, not rendered blank.
    const images = resolveRowImages(template.manifest, row.params);
    if (images.problems.length > 0) {
      skipped.push(`${row.label}: ${images.problems.join('; ')}`);
      continue;
    }
    const job = queue.add({
      templateId: template.manifest.id,
      templateName: template.manifest.name,
      label: `${template.manifest.name} · ${row.label}`,
      presetId: preset.id,
      outputPath: join(folder, `${row.fileName}${preset.extension}`),
      totalFrames: timing.totalFrames,
      firstFrame: timing.firstFrame,
    });
    inputs.set(job.id, { template, params: images.params, ...(request.options ? { options: request.options } : {}) });
    jobIds.push(job.id);
  }
  if (jobIds.length === 0) return { ok: false, message: skipped.join('; ') || 'Nothing could be queued.' };
  markItemUsed(template.id);
  void pump();
  return { ok: true, jobIds, folder, ...(skipped.length > 0 ? { skipped } : {}) };
}

export function cancelRender(jobId: number): void {
  const outcome = queue.cancel(jobId);
  if (outcome === 'running') active?.abort();
  if (outcome === 'cancelled') inputs.delete(jobId);
}

export function clearFinishedRenders(): void {
  queue.clearFinished();
}

/** Take one finished card off the tray. A job still running is cancelled instead. */
export function removeRender(id: number): void {
  queue.remove(id);
}

/** Render queued jobs until none are left. Only one pump runs at a time. */
async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (let job = queue.startNext(); job; job = queue.startNext()) {
      const input = inputs.get(job.id);
      inputs.delete(job.id);
      if (!input) {
        queue.finish(job.id, { ok: false, message: 'Render inputs were lost before the job started.' });
        continue;
      }
      active = new AbortController();
      const id = job.id;
      const shared = {
        params: input.params,
        presetId: job.presetId,
        outputPath: job.outputPath,
        // The save dialog already asked about replacing an existing file.
        overwrite: true,
        signal: active.signal,
        ...(input.options ? { options: input.options } : {}),
        onProgress: ({ frame }: { frame: number }) => queue.progress(id, frame),
      };
      const result = input.media ? await renderMedia({ entry: input.media, ...shared }) : await renderTemplate({ template: input.template, ...shared });
      active = null;
      queue.finish(id, result);
      if (result.ok) {
        markItemRendered(input.media ? input.media.id : input.template.id);
        // Finished outputs may be dragged into an editing app; sequences drag their first frame.
        const dragged = dragFileFor(result.output, job.firstFrame ?? 0);
        finishedOutputs.add(dragged);
        if (input.forCache) await evictIfNeeded(new Set([dragged]));
      }
    }
  } finally {
    pumping = false;
  }
}
