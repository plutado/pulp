/**
 * The tray body besides the queue list: the drag-out handle and the render cache.
 * Renders from the shared state (drag target, jobs); what to render comes from the
 * inspector through the request builder, never by reaching into its DOM.
 */

import { effect } from '@preact/signals';
import { hasFinishedJobs, resolveDragJob, setDrag } from '../core/app-state';
import { appState, dispatch, renderBlocked } from './store';
import { mountQueue } from './queue';
import { setCacheSummary } from './status-bar';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** The render request the drag would carry, or null when nothing can be rendered now. */
export type DragRequestBuilder = () => Parameters<typeof window.pulp.prepareDrag>[0] | null;

async function refreshCacheStats(): Promise<void> {
  const stats = await window.pulp.renderCacheStats();
  $('cache-summary').textContent = `${stats.summary} · ${stats.dir}`;
  $<HTMLInputElement>('cache-limit').value = String(stats.maxMB);
  setCacheSummary(stats.summary);
}

export function initTray(buildRequest: DragRequestBuilder): void {
  mountQueue($('queue'));

  const dragStatus = $('drag-status');
  const handle = $('drag-handle');
  const prepare = $<HTMLButtonElement>('drag-prepare');

  effect(() => {
    $<HTMLButtonElement>('clear-finished').disabled = !hasFinishedJobs(appState.value);
  });
  $('clear-finished').addEventListener('click', () => void window.pulp.clearFinishedRenders());

  effect(() => {
    const d = appState.value.drag;
    prepare.disabled = renderBlocked.value || (d !== null && 'jobId' in d);
  });

  // The handle follows the drag target in the shared state.
  effect(() => {
    const d = appState.value.drag;
    const ready = d !== null && 'file' in d;
    handle.setAttribute('draggable', String(ready));
    handle.dataset.file = ready ? d.file : '';
    $('drag-handle-text').textContent = ready ? `Drag ${d.file.split(/[\\/]/).pop()} into your editor` : d ? 'Rendering for drag…' : 'Drag to editor';
  });

  // When the job the handle waits for leaves the queue's active states, arm or report.
  effect(() => {
    const outcome = resolveDragJob(appState.value);
    if (!outcome) return;
    dispatch((s) => setDrag(s, outcome.drag));
    dragStatus.classList.toggle('error', outcome.error);
    dragStatus.textContent = outcome.status;
    if (outcome.cacheChanged) void refreshCacheStats();
  });

  prepare.addEventListener('click', () => {
    void (async () => {
      const request = buildRequest();
      if (!request) return;
      dragStatus.classList.remove('error');
      dragStatus.textContent = '';
      const result = await window.pulp.prepareDrag(request);
      if (!result.ok) {
        dragStatus.classList.add('error');
        dragStatus.textContent = result.message;
        return;
      }
      if (result.cached) {
        dispatch((s) => setDrag(s, { file: result.file, templateId: request.templateId }));
        dragStatus.textContent = 'Already rendered; ready to drag.';
      } else {
        dispatch((s) => setDrag(s, { jobId: result.jobId }));
        dragStatus.textContent = 'Rendering into the cache; progress is in the queue.';
      }
      void refreshCacheStats();
    })();
  });

  handle.addEventListener('dragstart', (e) => {
    e.preventDefault();
    const d = appState.value.drag;
    if (d && 'file' in d) void window.pulp.startDrag(d.file, d.templateId);
  });

  $('cache-clear').addEventListener('click', () => {
    void window.pulp.clearRenderCache().then((stats) => {
      $('cache-summary').textContent = `${stats.summary} · ${stats.dir}`;
      setCacheSummary(stats.summary);
      const d = appState.value.drag;
      if (d && 'file' in d) {
        dispatch((s) => setDrag(s, null));
        dragStatus.textContent = 'Cache cleared; prepare again to drag. Clips linked to the old files are now offline in your editor.';
      }
    });
  });
  $('cache-dir').addEventListener('click', () => {
    void window.pulp.chooseRenderCacheDir().then((stats) => {
      if (stats) {
        $('cache-summary').textContent = `${stats.summary} · ${stats.dir}`;
        setCacheSummary(stats.summary);
      }
    });
  });
  $<HTMLInputElement>('cache-limit').addEventListener('change', () => {
    void window.pulp.setRenderCacheLimit(Number($<HTMLInputElement>('cache-limit').value)).then((stats) => {
      $('cache-summary').textContent = `${stats.summary} · ${stats.dir}`;
      $<HTMLInputElement>('cache-limit').value = String(stats.maxMB);
      setCacheSummary(stats.summary);
    });
  });

  void refreshCacheStats();
}
