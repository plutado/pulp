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
import type { EnqueueResult, RenderRequest } from '../shared/api';
import { findTemplate } from './library-service';
import { renderTemplate } from './render';

/** Per-job inputs the UI does not need to see. */
interface JobInputs {
  template: TemplateEntry;
  params: Record<string, unknown>;
  options?: RenderOptions;
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
  let totalFrames: number;
  try {
    totalFrames = resolveTiming(template.manifest, request.options).totalFrames;
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
    totalFrames,
  });
  inputs.set(job.id, { template, params: request.params, ...(request.options ? { options: request.options } : {}) });
  void pump();
  return { ok: true, jobId: job.id };
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
    }
  } finally {
    pumping = false;
  }
}
