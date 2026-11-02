/**
 * Renders that outlive the app, or do not (milestone 58).
 *
 * **A render writes to a staged name and is renamed when it is whole.** ffmpeg
 * writes `name.partial.mp4` and the render moves it to `name.mp4` only after
 * the last frame; a kill mid-render leaves a file that says it is partial
 * rather than one that looks finished, and the next run of the same render
 * clears it. A frame sequence is already a pile of numbered files and stays
 * as it is: a half-written sequence is visibly short.
 *
 * **The queue keeps a ledger of what it is rendering.** Written when a job
 * starts and cleared when it ends, so a session that is killed leaves the
 * jobs it was in the middle of on disk; the next launch removes their partial
 * files and offers to render them again — the inputs are in the ledger, the
 * save dialog already answered, so rendering again is one press.
 *
 * Pure: the names and the ledger's text. The files are
 * src/main/render-queue-service.ts's and src/main/render.ts's.
 */

import { expandSequence } from './render-guard';

/** Where ffmpeg writes a single-file output until it is whole: `name.partial.ext`. A sequence pattern is itself. */
export function stagedOutputPath(output: string): string {
  if (/%0?\d*d/.test(output)) return output;
  const slash = Math.max(output.lastIndexOf('/'), output.lastIndexOf('\\'));
  const dot = output.lastIndexOf('.');
  if (dot <= slash + 1) return `${output}.partial`;
  return `${output.slice(0, dot)}.partial${output.slice(dot)}`;
}

/** One render the queue was in the middle of, with everything needed to run it again. */
export interface InterruptedRender {
  templateId?: string;
  mediaId?: string;
  presetId: string;
  outputPath: string;
  params: Record<string, unknown>;
  options?: Record<string, unknown>;
  /** For a sequence, which frames were being written, so the partial files can be named. */
  totalFrames: number;
  firstFrame: number;
  startedAt: string;
  label: string;
}

export interface RenderLedger {
  jobs: InterruptedRender[];
}

export const EMPTY_LEDGER: RenderLedger = { jobs: [] };

export function serializeLedger(ledger: RenderLedger): string {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

/** A ledger from its text, keeping only jobs that could be run again; anything else is no ledger. */
export function parseLedger(text: string): RenderLedger {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return EMPTY_LEDGER;
  }
  const list = (raw as { jobs?: unknown })?.jobs;
  if (!Array.isArray(list)) return EMPTY_LEDGER;
  const jobs: InterruptedRender[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const r = entry as Record<string, unknown>;
    const templateId = typeof r.templateId === 'string' ? r.templateId : undefined;
    const mediaId = typeof r.mediaId === 'string' ? r.mediaId : undefined;
    if (!templateId && !mediaId) continue;
    if (typeof r.presetId !== 'string' || typeof r.outputPath !== 'string' || r.outputPath === '') continue;
    jobs.push({
      ...(templateId ? { templateId } : {}),
      ...(mediaId ? { mediaId } : {}),
      presetId: r.presetId,
      outputPath: r.outputPath,
      params: typeof r.params === 'object' && r.params !== null ? (r.params as Record<string, unknown>) : {},
      ...(typeof r.options === 'object' && r.options !== null ? { options: r.options as Record<string, unknown> } : {}),
      totalFrames: typeof r.totalFrames === 'number' && Number.isFinite(r.totalFrames) ? Math.max(0, Math.floor(r.totalFrames)) : 0,
      firstFrame: typeof r.firstFrame === 'number' && Number.isFinite(r.firstFrame) ? Math.max(0, Math.floor(r.firstFrame)) : 0,
      startedAt: typeof r.startedAt === 'string' ? r.startedAt : '',
      label: typeof r.label === 'string' ? r.label : r.outputPath,
    });
  }
  return { jobs };
}

export function withJob(ledger: RenderLedger, job: InterruptedRender): RenderLedger {
  return { jobs: [...ledger.jobs.filter((j) => j.outputPath !== job.outputPath), job] };
}

export function withoutJob(ledger: RenderLedger, outputPath: string): RenderLedger {
  return { jobs: ledger.jobs.filter((j) => j.outputPath !== outputPath) };
}

/**
 * The files a job killed mid-render may have left: its staged output, and for
 * a sequence the frames it was writing. Never the finished name of a single
 * file, which a killed render never reaches.
 */
export function interruptedFiles(job: InterruptedRender, sequence: boolean): string[] {
  if (sequence) return expandSequence(job.outputPath, job.totalFrames, job.firstFrame);
  return [stagedOutputPath(job.outputPath)];
}
