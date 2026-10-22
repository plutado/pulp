/**
 * Render queue: several renders run one after another, each with its own
 * progress and result. Pure bookkeeping; the main process runs the jobs and
 * forwards snapshots to the UI.
 */

export type RenderJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface RenderQueueJob {
  id: number;
  templateId: string;
  templateName: string;
  presetId: string;
  outputPath: string;
  totalFrames: number;
  status: RenderJobStatus;
  /** Frames finished so far. */
  frame: number;
  /** Final output path or pattern, once done. */
  output?: string;
  /** Why the job failed or was cancelled. */
  message?: string;
  warnings: string[];
}

export interface RenderQueueSnapshot {
  jobs: RenderQueueJob[];
}

/** What a finished render reports; structurally the same as RenderResult in the shared API. */
export type RenderOutcome =
  | { ok: true; output: string; frames: number; warnings: string[] }
  | { ok: false; cancelled?: boolean; message: string };

export type NewRenderJob = Pick<RenderQueueJob, 'templateId' | 'templateName' | 'presetId' | 'outputPath' | 'totalFrames'>;

export const FINISHED_STATUSES: readonly RenderJobStatus[] = ['done', 'failed', 'cancelled'];

export function isFinished(job: RenderQueueJob): boolean {
  return FINISHED_STATUSES.includes(job.status);
}

export class RenderQueue {
  private jobs: RenderQueueJob[] = [];
  private nextId = 1;

  constructor(private readonly onChange: (snapshot: RenderQueueSnapshot) => void = () => undefined) {}

  /** Append a job in the queued state. */
  add(input: NewRenderJob): RenderQueueJob {
    const job: RenderQueueJob = { ...input, id: this.nextId++, status: 'queued', frame: 0, warnings: [] };
    this.jobs.push(job);
    this.changed();
    return { ...job };
  }

  /** The job currently rendering, if any. */
  running(): RenderQueueJob | undefined {
    const job = this.jobs.find((j) => j.status === 'running');
    return job ? { ...job } : undefined;
  }

  /** Mark the oldest queued job as running and return it; null while another runs or nothing waits. */
  startNext(): RenderQueueJob | null {
    if (this.jobs.some((j) => j.status === 'running')) return null;
    const job = this.jobs.find((j) => j.status === 'queued');
    if (!job) return null;
    job.status = 'running';
    this.changed();
    return { ...job };
  }

  progress(id: number, frame: number): void {
    const job = this.find(id);
    if (!job || job.status !== 'running') return;
    job.frame = Math.min(Math.max(0, frame), job.totalFrames);
    this.changed();
  }

  finish(id: number, outcome: RenderOutcome): void {
    const job = this.find(id);
    if (!job || job.status !== 'running') return;
    if (outcome.ok) {
      job.status = 'done';
      job.frame = outcome.frames;
      job.output = outcome.output;
      job.warnings = [...outcome.warnings];
    } else {
      job.status = outcome.cancelled ? 'cancelled' : 'failed';
      job.message = outcome.message;
    }
    this.changed();
  }

  /**
   * Cancel a job. A queued job is marked cancelled here. For a running job the
   * caller must stop the render; the result then arrives through `finish`.
   */
  cancel(id: number): 'cancelled' | 'running' | 'ignored' {
    const job = this.find(id);
    if (!job) return 'ignored';
    if (job.status === 'running') return 'running';
    if (job.status !== 'queued') return 'ignored';
    job.status = 'cancelled';
    job.message = 'Cancelled before it started.';
    this.changed();
    return 'cancelled';
  }

  /** Drop done, failed and cancelled jobs from the list. */
  clearFinished(): void {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => !isFinished(j));
    if (this.jobs.length !== before) this.changed();
  }

  snapshot(): RenderQueueSnapshot {
    return { jobs: this.jobs.map((j) => ({ ...j, warnings: [...j.warnings] })) };
  }

  private find(id: number): RenderQueueJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  private changed(): void {
    this.onChange(this.snapshot());
  }
}
