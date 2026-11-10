/**
 * What a card in the render tray shows (docs/ui-style.md). A job knows about
 * paths, frame counts and presets; a card shows the item's name, a badge, a
 * status, and nothing else. The path belongs to the tooltip and to Reveal and
 * Copy path, never to the card's text: a reader scanning the tray is looking
 * for *which render*, not for where it landed.
 *
 * Pure, so the rule can be tested rather than hoped for.
 */

import { platformPreset } from './platform-presets';
import { OUTPUT_PRESETS, type PresetId } from './render-plan';
import type { JobFlash, RenderJobStatus, RenderQueueJob } from './render-queue';
import { tr } from './i18n';
import { formatTimecode } from './timecode';
import type { FlashSpan } from './flash';

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
  /**
   * The hand-off (milestone 20): offered once the render is done, when it was
   * aimed at a platform Pulp knows. The card sends the preset's id back, never
   * a URL — the main process holds the only list of pages it will open.
   */
  handOff?: { platform: string; label: string };
  /**
   * The flash check's line (milestone 84), under the status: what it found,
   * in the render's own timecode, or that it is running, or why it could not
   * look. `soften` offers the calming where there is something to calm in a
   * video file.
   */
  flash?: { tone: 'warn' | 'ok' | 'muted'; text: string; soften: boolean; busy: boolean };
}

/** A strong moment in the render's own timecode — the file's time plus where the render began — and what flashed. */
export function flashSpanText(span: FlashSpan, fps: number, firstFrame = 0): string {
  const tc = (seconds: number) => formatTimecode(Math.round(seconds * fps) + firstFrame, fps);
  const kind = span.kinds.length > 1 ? tr('queue.flash.kind.both') : span.kinds[0] === 'red' ? tr('queue.flash.kind.red') : tr('queue.flash.kind.general');
  return tr('queue.flash.span', { from: tc(span.from), to: tc(span.to), count: span.perSecond, kind });
}

/** The card's flash line and the tooltip's account, where the job has a check. */
function flashLine(flash: JobFlash | undefined, firstFrame: number): { line: NonNullable<QueueCard['flash']>; tip: string[] } | null {
  if (!flash) return null;
  const note = tr('queue.flash.not-certified');
  switch (flash.state) {
    case 'checking':
      return { line: { tone: 'muted', text: tr('queue.flash.checking'), soften: false, busy: true }, tip: [] };
    case 'unchecked':
      return { line: { tone: 'muted', text: tr(`queue.flash.unchecked.${flash.reason}`), soften: false, busy: false }, tip: [note] };
    case 'softening':
      return { line: { tone: 'warn', text: tr('queue.flash.softening'), soften: false, busy: true }, tip: [] };
    case 'checked': {
      if (flash.spans.length === 0) {
        return { line: { tone: 'ok', text: tr(flash.softened ? 'queue.flash.softened-clear' : 'queue.flash.clear'), soften: false, busy: false }, tip: [note] };
      }
      const first = flashSpanText(flash.spans[0]!, flash.fps, firstFrame);
      const text = flash.spans.length > 1 ? tr('queue.flash.found-more', { first, count: flash.spans.length - 1 }) : tr('queue.flash.found', { first });
      return {
        line: { tone: 'warn', text, soften: flash.canSoften, busy: false },
        tip: [...flash.spans.map((s) => flashSpanText(s, flash.fps, firstFrame)), ...(flash.canSoften ? [] : [tr('queue.flash.no-soften')]), note],
      };
    }
  }
}

/** "180 frames", "1 frame". */
function frames(n: number): string {
  return tr('queue.frames', { count: n });
}

function status(job: RenderQueueJob): QueueCardStatus {
  switch (job.status) {
    case 'queued':
      return { kind: 'queued', text: tr('queue.status.queued', { frames: frames(job.totalFrames) }) };
    case 'running':
      return {
        kind: 'running',
        text: tr('queue.status.running', { frame: job.frame, total: job.totalFrames }),
        progress: job.totalFrames > 0 ? Math.min(1, Math.max(0, job.frame / job.totalFrames)) : 0,
      };
    case 'done':
      // Warnings are counted here and spelled out in the tooltip: a card is one line.
      return {
        kind: 'done',
        text: job.warnings.length > 0
          ? tr('queue.status.done-warnings', { frames: frames(job.frame), warnings: tr('queue.warnings', { count: job.warnings.length }) })
          : tr('queue.status.done', { frames: frames(job.frame) }),
      };
    case 'cancelled':
      return { kind: 'cancelled', text: tr('queue.status.cancelled') };
    case 'failed':
      // The one place a path may show: a failure that hides where it happened cannot be acted on.
      return { kind: 'failed', text: job.message ?? tr('queue.status.failed') };
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
  const aimedAt = done ? platformPreset(job.platform) : undefined;
  const flash = done ? flashLine(job.flash, job.firstFrame ?? 0) : null;
  return {
    id: job.id,
    name: job.label ?? job.templateName,
    preset,
    status: status(job),
    ...(file ? { file } : {}),
    tip: [file ?? job.outputPath, ...job.warnings, ...(flash?.tip ?? [])].join('\n'),
    draggable: done,
    ...(aimedAt ? { handOff: { platform: aimedAt.id, label: aimedAt.label } } : {}),
    ...(flash ? { flash: flash.line } : {}),
  };
}
