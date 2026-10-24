/**
 * The render tray besides the cards: the one-time notice shown the first time
 * something is dragged out, and the render cache. The cards are the drag source
 * themselves (`queue.tsx`); this file no longer owns a handle of its own.
 */

import { effect } from '@preact/signals';
import { hasFinishedJobs, setCollection, setEditing } from '../core/app-state';
import { applyToAll, COLLECTION_DRAG_TYPE, renderableItems, resolveCollection } from '../core/collection';
import { appState, dispatch } from './store';
import { editing, mountCollection, resolved } from './collection';
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

/** The collection's own actions: Render all, Apply to all, Open and Save. */
function initCollection(): void {
  mountCollection($('collection'));
  const note = $('collection-note');
  const say = (text: string, bad = false) => {
    note.classList.toggle('error', bad);
    note.textContent = text;
  };

  // Total progress across whatever is queued, beside the per-item bars on the cards.
  const total = $<HTMLProgressElement>('tray-progress');
  effect(() => {
    const jobs = appState.value.jobs.jobs;
    const running = jobs.some((j) => j.status === 'running' || j.status === 'queued');
    total.hidden = !running;
    if (!running) return;
    const frames = jobs.reduce((sum, j) => sum + j.totalFrames, 0);
    const done = jobs.reduce((sum, j) => sum + (j.status === 'done' ? j.totalFrames : j.frame), 0);
    total.value = frames > 0 ? done / frames : 0;
  });

  effect(() => {
    const list = resolved.value;
    $<HTMLButtonElement>('collection-save').disabled = list.length === 0;
    $<HTMLButtonElement>('collection-render').disabled = renderableItems(list).length === 0;
    $<HTMLButtonElement>('collection-apply').disabled = list.length < 2 || appState.value.editing === null;
  });

  $('collection-render').addEventListener('click', () => {
    void (async () => {
      const items = renderableItems(resolved.value).map((r) => r.item);
      say('');
      const result = await window.pulp.renderCollection(items, appState.value.collectionName);
      if (!result.ok) {
        if (!result.cancelled) say(result.message, true);
        return;
      }
      const skipped = result.skipped.length > 0 ? ` Skipped: ${result.skipped.join('; ')}.` : '';
      say(`Rendering ${result.jobIds.length} ${result.jobIds.length === 1 ? 'item' : 'items'}.${skipped}`);
    })();
  });

  $('collection-apply').addEventListener('click', () => {
    const item = editing.value;
    if (!item) return;
    dispatch((s) => setCollection(s, applyToAll(s.collection, { presetId: item.presetId, options: item.options })));
    say('Every item now has those output settings.');
  });

  $('collection-save').addEventListener('click', () => {
    void (async () => {
      const result = await window.pulp.saveCollection(appState.value.collection, appState.value.collectionName || 'collection');
      if (!result.ok) {
        if (!result.cancelled) say(result.message, true);
        return;
      }
      dispatch((s) => setCollection(s, s.collection, result.name));
      say(`Saved as ${result.name}.`);
    })();
  });

  $('collection-open').addEventListener('click', () => {
    void (async () => {
      const result = await window.pulp.openCollection();
      if (!result.ok) {
        if (!result.cancelled) say(result.message, true);
        return;
      }
      dispatch((s) => setEditing(setCollection(s, result.collection ?? s.collection, result.name), null));
      // What the library can no longer answer for is on the cards; this is the count.
      const list = resolveCollection(result.collection ?? { items: [] }, appState.value.index);
      const lost = list.filter((r) => r.missing || r.offline).length;
      say(lost > 0 ? `Opened ${result.name}. ${lost} ${lost === 1 ? 'item is' : 'items are'} not available here.` : `Opened ${result.name}.`);
    })();
  });
}

/** Dropping a library card into the tray collects it, with the Output tab's current settings. */
function initDropTarget(onDrop: (id: string) => void): void {
  const tray = $('region-tray');
  tray.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(COLLECTION_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    tray.classList.add('drop-target');
  });
  tray.addEventListener('dragleave', (e) => {
    if (e.target === tray) tray.classList.remove('drop-target');
  });
  tray.addEventListener('drop', (e) => {
    const id = e.dataTransfer?.getData(COLLECTION_DRAG_TYPE);
    tray.classList.remove('drop-target');
    if (!id) return;
    e.preventDefault();
    onDrop(id);
  });
}

export function initTray(onDropItem: (id: string) => void): void {
  mountQueue($('queue'));
  initCollection();
  initDropTarget(onDropItem);
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
