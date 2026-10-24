/**
 * What a card in the render tray shows (docs/ui-style.md). A job knows about
 * paths, frame counts and presets; a card shows the item's name, a badge, a
 * status, and nothing else. The path belongs to the tooltip and to Reveal and
 * Copy path, never to the card's text: a reader scanning the tray is looking
 * for *which render*, not for where it landed.
 *
 * Pure, so the rule can be tested rather than hoped for.
 */

import { OUTPUT_PRESETS, type PresetId } from './render-plan';
import type { RenderJobStatus, RenderQueueJob } from './render-queue';

export interface QueueCardStatus {
  kind: RenderJobStatus;
  /** One short line. No path, no file name — except a failure's own reason. */
  text: string;
  /** 0 to 1 while rendering; absent otherwise. */
  progress?: number;
}

export interface QueueCard {
  id: number;
  /** The item's display name. */
  name: string;
  /** The output preset, shown as a badge. */
  preset: string;
  status: QueueCardStatus;
  /** The file the card drags, reveals and copies; absent until the render has finished. */
  file?: string;
  /** Where the file is and anything else the card leaves out, for the tooltip. */
  tip: string;
  draggable: boolean;
}

/** "180 frames", "1 frame". */
function frames(n: number): string {
  return `${n} ${n === 1 ? 'frame' : 'frames'}`;
}

function status(job: RenderQueueJob): QueueCardStatus {
  switch (job.status) {
    case 'queued':
      return { kind: 'queued', text: `Queued · ${frames(job.totalFrames)}` };
    case 'running':
      return {
        kind: 'running',
        text: `Frame ${job.frame} of ${job.totalFrames}`,
        progress: job.totalFrames > 0 ? Math.min(1, Math.max(0, job.frame / job.totalFrames)) : 0,
      };
    case 'done':
      // Warnings are counted here and spelled out in the tooltip: a card is one line.
      return { kind: 'done', text: job.warnings.length > 0 ? `Done · ${frames(job.frame)} · ${job.warnings.length} warning${job.warnings.length === 1 ? '' : 's'}` : `Done · ${frames(job.frame)}` };
    case 'cancelled':
      return { kind: 'cancelled', text: 'Cancelled' };
    case 'failed':
      // The one place a path may show: a failure that hides where it happened cannot be acted on.
      return { kind: 'failed', text: job.message ?? 'The render did not finish.' };
  }
}

/**
 * A sequence output is written as numbered files; the one that is dragged, and
 * that an editor offers to import the whole sequence from, is its first frame.
 */
export function dragFileFor(job: Pick<RenderQueueJob, 'output' | 'outputPath' | 'firstFrame'>): string {
  const output = job.output ?? job.outputPath;
  const m = /%(0?)(\d*)d/.exec(output);
  if (!m) return output;
  const width = m[2] ? Number(m[2]) : 0;
  return output.slice(0, m.index) + String(job.firstFrame ?? 0).padStart(width, m[1] === '0' ? '0' : ' ') + output.slice(m.index + m[0].length);
}

export function queueCard(job: RenderQueueJob): QueueCard {
  const done = job.status === 'done';
  const file = done ? dragFileFor(job) : undefined;
  const preset = OUTPUT_PRESETS[job.presetId as PresetId]?.label ?? job.presetId;
  return {
    id: job.id,
    name: job.label ?? job.templateName,
    preset,
    status: status(job),
    ...(file ? { file } : {}),
    tip: [file ?? job.outputPath, ...job.warnings].join('\n'),
    draggable: done,
  };
}
