/**
 * The render tray besides the cards: the one-time notice shown the first time
 * something is dragged out, and the render cache. The cards are the drag source
 * themselves (`queue.tsx`); this file no longer owns a handle of its own.
 */

import { effect } from '@preact/signals';
import { hasFinishedJobs, setCollection } from '../core/app-state';
import { applyToAll, COLLECTION_DRAG_TYPE, renderableItems } from '../core/collection';
import { noteAfterChange, noteFades, NOTE_MS, NO_NOTE, sayNote, type TrayNote } from '../core/tray-note';
import { appState, dispatch } from './store';
import { editing, mountCollection, resolved } from './collection';
import { openProjectFrom, rememberRenderFolder } from './project';
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

/**
 * The tray's status line, once the tray is mounted. The project's messages go
 * here too — saved, opened, relinked — since it is the one line in the window
 * that already says what became of a file.
 */
let trayNote: (text: string, isError?: boolean) => void = () => {};

export function sayInTray(text: string, isError = false): void {
  trayNote(text, isError);
}

/** The collection's own actions: Render all, Apply to all, Open and Save. */
export function initCollection(): void {
  mountCollection($('collection'));
  const note = $('collection-note');
  // The rules for this line are in src/core/tray-note.ts; the tray owns the element and the clock.
  let shown: TrayNote = NO_NOTE;
  let noteFor = appState.value.collection;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  const paint = (next: TrayNote) => {
    clearTimeout(noteTimer);
    noteTimer = undefined;
    shown = next;
    note.classList.toggle('error', next.kind === 'error');
    note.textContent = next.text;
    if (noteFades(next)) noteTimer = setTimeout(() => paint(NO_NOTE), NOTE_MS);
  };
  const say = (text: string, bad = false) => {
    noteFor = appState.value.collection;
    paint(sayNote(text, bad));
  };
  // The project's messages land on the same line: it is the one place in the window that already
  // says what happened to a file (milestone 27).
  trayNote = say;

  effect(() => {
    const collection = appState.value.collection;
    const next = noteAfterChange(shown, collection.items.length, collection !== noteFor);
    noteFor = collection;
    if (next !== shown) paint(next);
  });

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
      const result = await window.pulp.renderCollection(items, appState.value.project.name);
      if (!result.ok) {
        if (!result.cancelled) say(result.message, true);
        return;
      }
      // Where this project's renders go, kept with it so a reopened project knows.
      rememberRenderFolder(result.folder);
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
      const result = await window.pulp.saveCollection(appState.value.collection, appState.value.project.name || 'collection');
      if (!result.ok) {
        if (!result.cancelled) say(result.message, true);
        return;
      }
      dispatch((s) => setCollection(s, s.collection, result.name));
      say(`Saved as ${result.name}.`);
    })();
  });

  // Opening goes through the project (milestone 27), so the same door takes a .pulp and a
  // .pulpcollection and the unsaved changes of whatever is open are asked about first.
  $('collection-open').addEventListener('click', () => {
    void openProjectFrom(null);
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

  // The cache's controls are a dialog (milestone 42): the tray is in the window only while it has
  // something in it, and the cache outlives any one session's renders, so the dialog opens from the
  // status item in the transport row as well as from the tray's foot.
  const cacheDialog = $<HTMLDialogElement>('cache-dialog');
  const openCache = () => {
    void refreshCacheStats();
    if (!cacheDialog.open) cacheDialog.showModal();
  };
  $('cache-open').addEventListener('click', openCache);
  $('status-cache').addEventListener('click', openCache);
  $('cache-close').addEventListener('click', () => cacheDialog.close());

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
