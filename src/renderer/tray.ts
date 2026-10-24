/**
 * The render tray besides the cards: the one-time notice shown the first time
 * something is dragged out, and the render cache. The cards are the drag source
 * themselves (`queue.tsx`); this file no longer owns a handle of its own.
 */

import { effect } from '@preact/signals';
import { hasFinishedJobs } from '../core/app-state';
import { appState } from './store';
import { dragNotice, mountQueue } from './queue';
import { setCacheSummary } from './status-bar';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const NOTICE =
  'Your editor links to that file rather than copying it. Keep the render while the project uses it: clearing the cache, or the cache dropping its oldest files, takes the clip offline there.';

async function refreshCacheStats(): Promise<void> {
  const stats = await window.pulp.renderCacheStats();
  $('cache-summary').textContent = stats.summary;
  $('cache-summary').dataset.tip = stats.dir;
  $<HTMLInputElement>('cache-limit').value = String(stats.maxMB);
  setCacheSummary(stats.summary);
}

/** Said once, the first time a render leaves for an editor; the setting remembers it. */
function initDragNotice(): void {
  const notice = $('drag-notice');
  let seen = true;
  void window.pulp.getDragNoticeSeen().then((value) => {
    seen = value;
  });
  $('drag-notice-dismiss').addEventListener('click', () => {
    notice.hidden = true;
    seen = true;
    void window.pulp.setDragNoticeSeen();
  });
  effect(() => {
    if (!dragNotice.value || seen) return;
    $('drag-notice-text').textContent = NOTICE;
    notice.hidden = false;
  });
}

export function initTray(): void {
  mountQueue($('queue'));
  initDragNotice();

  effect(() => {
    $<HTMLButtonElement>('clear-finished').disabled = !hasFinishedJobs(appState.value);
  });
  $('clear-finished').addEventListener('click', () => void window.pulp.clearFinishedRenders());

  $('cache-clear').addEventListener('click', () => {
    void window.pulp.clearRenderCache().then((stats) => {
      $('cache-summary').textContent = stats.summary;
      setCacheSummary(stats.summary);
    });
  });
  $('cache-dir').addEventListener('click', () => {
    void window.pulp.chooseRenderCacheDir().then((stats) => {
      if (!stats) return;
      $('cache-summary').textContent = stats.summary;
      $('cache-summary').dataset.tip = stats.dir;
      setCacheSummary(stats.summary);
    });
  });
  $<HTMLInputElement>('cache-limit').addEventListener('change', () => {
    void window.pulp.setRenderCacheLimit(Number($<HTMLInputElement>('cache-limit').value)).then((stats) => {
      $('cache-summary').textContent = stats.summary;
      $<HTMLInputElement>('cache-limit').value = String(stats.maxMB);
      setCacheSummary(stats.summary);
    });
  });

  void refreshCacheStats();
  // A render that just finished may have gone into the cache. Counting finished jobs
  // rather than watching the snapshot keeps this off the per-frame progress ticks.
  let finished = 0;
  effect(() => {
    const now = appState.value.jobs.jobs.filter((j) => j.status === 'done').length;
    if (now === finished) return;
    finished = now;
    void refreshCacheStats();
  });
}
