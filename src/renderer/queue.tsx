/** The tray's queue list, rendered from the jobs in the shared state, keyed by job id. */

import { render } from 'preact';
import { computed } from '@preact/signals';
import { dragFileFor } from '../core/app-state';
import { OUTPUT_PRESETS, type PresetId } from '../core/render-plan';
import { isFinished, type RenderQueueJob } from '../core/render-queue';
import { appState } from './store';

const jobs = computed(() => appState.value.jobs.jobs);

function jobStatusText(job: RenderQueueJob): string {
  switch (job.status) {
    case 'queued':
      return `Queued · ${job.totalFrames} frames`;
    case 'running':
      return `Rendering frame ${job.frame} of ${job.totalFrames}…`;
    case 'done':
      return `Wrote ${job.output ?? job.outputPath} (${job.frame} frames).${
        job.warnings.length ? ` Warnings: ${job.warnings.join('; ')}` : ''
      }`;
    case 'failed':
    case 'cancelled':
      return job.message ?? job.status;
  }
}

function Job({ job }: { job: RenderQueueJob }) {
  const done = job.status === 'done';
  return (
    <li
      draggable={done}
      data-file={done ? dragFileFor(job) : undefined}
      onDragStart={done ? (e: DragEvent) => {
        e.preventDefault();
        void window.pulp.startDrag(dragFileFor(job), job.templateId);
      } : undefined}
    >
      <div class="job-head">
        <span class="job-name">{job.label ?? job.templateName}</span>
        <span class="job-preset">{OUTPUT_PRESETS[job.presetId as PresetId]?.label ?? job.presetId}</span>
      </div>
      {job.status === 'running' && <progress max={1} value={job.totalFrames > 0 ? job.frame / job.totalFrames : 0} />}
      <div class={`job-status ${job.status === 'failed' ? 'error' : job.status}`} title={job.outputPath}>
        {jobStatusText(job)}
      </div>
      {!isFinished(job) && (
        <button type="button" class="job-cancel" onClick={() => void window.pulp.cancelRender(job.id)}>
          Cancel
        </button>
      )}
    </li>
  );
}

function Queue() {
  const list = jobs.value;
  if (list.length === 0) return <li class="empty">No renders yet.</li>;
  return <>{list.map((job) => <Job key={job.id} job={job} />)}</>;
}

export function mountQueue(container: HTMLElement): void {
  render(<Queue />, container);
}
