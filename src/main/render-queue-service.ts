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
import type { BatchRequest, EnqueueBatchResult, EnqueueResult, PrepareDragResult, RenderRequest } from '../shared/api';
import { cacheFileName, cacheKey } from '../core/render-cache';
import { dragFileFor, ensureCacheDir, evictIfNeeded, isCachedFile } from './render-cache-service';
import { existsSync } from 'node:fs';
import { findTemplate, markItemUsed } from './library-service';
import { renderTemplate } from './render';

/** Per-job inputs the UI does not need to see. */
interface JobInputs {
  template: TemplateEntry;
  params: Record<string, unknown>;
  options?: RenderOptions;
  /** A render into the cache folder, for dragging. */
  forCache?: boolean;
}

/** Files that may be dragged: outputs of finished jobs (cache files are allowed by location). */
const finishedOutputs = new Set<string>();

export function allowedDragFiles(): ReadonlySet<string> {
  return finishedOutputs;
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

/** Ask where to save, then queue the render. Resolves as soon as the job is queued. */
export async function enqueueRender(request: RenderRequest): Promise<EnqueueResult> {
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
export async function prepareDrag(request: RenderRequest): Promise<PrepareDragResult> {
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
  const key = cacheKey({ templateId: template.manifest.id, manifest: template.manifest, params: request.params, presetId: preset.id, options: request.options });
  const dir = await ensureCacheDir();
  const outputPath = join(dir, cacheFileName(key, template.manifest.id, preset.extension));
  const existing = dragFileFor(preset.sequence ? outputPath.replace(preset.extension, `_%05d${preset.extension}`) : outputPath, timing.firstFrame);
  if (existsSync(existing) && (await isCachedFile(existing))) {
    return { ok: true, cached: true, file: existing };
  }
  const job = queue.add({
    templateId: template.manifest.id,
    templateName: template.manifest.name,
    label: `${template.manifest.name} · for drag`,
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
  for (const row of request.rows) {
    const job = queue.add({
      templateId: template.manifest.id,
      templateName: template.manifest.name,
      label: `${template.manifest.name} · ${row.label}`,
      presetId: preset.id,
      outputPath: join(folder, `${row.fileName}${preset.extension}`),
      totalFrames: timing.totalFrames,
      firstFrame: timing.firstFrame,
    });
    inputs.set(job.id, { template, params: row.params, ...(request.options ? { options: request.options } : {}) });
    jobIds.push(job.id);
  }
  markItemUsed(template.id);
  void pump();
  return { ok: true, jobIds, folder };
}

export function cancelRender(jobId: number): void {
  const outcome = queue.cancel(jobId);
  if (outcome === 'running') active?.abort();
  if (outcome === 'cancelled') inputs.delete(jobId);
}

export function clearFinishedRenders(): void {
  queue.clearFinished();
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
      const result = await renderTemplate({
        template: input.template,
        params: input.params,
        presetId: job.presetId,
        outputPath: job.outputPath,
        // The save dialog already asked about replacing an existing file.
        overwrite: true,
        signal: active.signal,
        ...(input.options ? { options: input.options } : {}),
        onProgress: ({ frame }) => queue.progress(id, frame),
      });
      active = null;
      queue.finish(id, result);
      if (result.ok) {
        // Finished outputs may be dragged into an editing app; sequences drag their first frame.
        const plan = { output: result.output, firstFrame: 0 };
        finishedOutputs.add(dragFileFor(plan.output, resolveTiming(input.template.manifest, input.options).firstFrame));
        if (input.forCache) await evictIfNeeded(new Set([dragFileFor(plan.output, resolveTiming(input.template.manifest, input.options).firstFrame)]));
      }
    }
  } finally {
    pumping = false;
  }
}
