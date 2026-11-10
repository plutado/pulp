/**
 * Softening a render's flashing (milestone 84): the dialog a card's Soften…
 * opens. It names the strong moments, has the main process calm them into a
 * draft beside the render and check it again, shows the worst moment before
 * and after — and only then offers to put the draft in the render's place,
 * save it as a copy beside it, or throw it away. Nothing is written over until
 * the person chooses; closing the dialog any other way throws the draft away.
 */

import { flashSpanText } from '../core/queue-card';
import type { RenderQueueJob } from '../core/render-queue';
import { t } from './i18n';

interface Els {
  dialog: HTMLDialogElement;
  moments: HTMLParagraphElement;
  spans: HTMLUListElement;
  stills: HTMLDivElement;
  before: HTMLImageElement;
  after: HTMLImageElement;
  progress: HTMLProgressElement;
  status: HTMLParagraphElement;
  replace: HTMLButtonElement;
  copy: HTMLButtonElement;
  discard: HTMLButtonElement;
}

let els: Els | null = null;
/** The job whose draft the dialog holds, and whether a choice was made for it. */
let open: { id: number; chosen: boolean; ready: boolean } | null = null;
let say: (text: string) => void = () => undefined;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setBusy(busy: boolean): void {
  if (!els) return;
  els.progress.hidden = !busy;
  els.replace.disabled = busy || !open?.ready;
  els.copy.disabled = busy || !open?.ready;
}

async function choose(choice: 'replace' | 'copy' | 'discard'): Promise<void> {
  if (!els || !open) return;
  const id = open.id;
  open.chosen = true;
  setBusy(true);
  els.discard.disabled = true;
  const kept = await window.pulp.keepSoftened(id, choice);
  els.discard.disabled = false;
  setBusy(false);
  if (!kept.ok) {
    els.status.textContent = t('flash-dialog.failed', { reason: kept.message });
    els.status.classList.add('error');
    return;
  }
  if (choice === 'replace') say(t('flash-dialog.kept.replace'));
  else if (choice === 'copy' && kept.file) say(t('flash-dialog.kept.copy', { name: kept.file.split(/[\\/]/).pop()! }));
  // The session ends here, before the dialog closes: its close event comes later, and must not
  // mistake a session opened in the meantime for this one.
  if (open?.id === id) open = null;
  els.dialog.close();
}

/** Open the dialog for a checked render with strong moments, and start softening it. */
export function openFlashDialog(job: RenderQueueJob): void {
  if (!els || job.flash?.state !== 'checked' || job.flash.spans.length === 0) return;
  const flash = job.flash;
  open = { id: job.id, chosen: false, ready: false };
  els.moments.textContent = t('flash-dialog.moments', { count: flash.spans.length });
  els.spans.replaceChildren(...flash.spans.map((s) => {
    const li = document.createElement('li');
    li.textContent = flashSpanText(s, flash.fps, job.firstFrame ?? 0);
    return li;
  }));
  els.stills.hidden = true;
  els.status.textContent = t('flash-dialog.working');
  els.status.classList.remove('error');
  setBusy(true);
  els.dialog.showModal();
  const id = job.id;
  void window.pulp.softenFlashes(id).then((made) => {
    if (!els || open?.id !== id) return;
    if (!made.ok) {
      setBusy(false);
      els.status.textContent = t('flash-dialog.failed', { reason: made.message });
      els.status.classList.add('error');
      return;
    }
    open.ready = true;
    els.before.src = made.before;
    els.after.src = made.after;
    els.stills.hidden = !made.before || !made.after;
    const left = made.recheck.spans;
    els.status.textContent = left.length === 0
      ? t('flash-dialog.recheck.clear')
      : t('flash-dialog.recheck.found', { count: left.length, first: flashSpanText(left[0]!, made.recheck.fps, job.firstFrame ?? 0) });
    setBusy(false);
  });
}

export function initFlashDialog(note: (text: string) => void): void {
  say = note;
  els = {
    dialog: $('flash-dialog'),
    moments: $('flash-moments'),
    spans: $('flash-spans'),
    stills: $('flash-stills'),
    before: $('flash-before'),
    after: $('flash-after'),
    progress: $('flash-progress'),
    status: $('flash-status'),
    replace: $('flash-replace'),
    copy: $('flash-copy'),
    discard: $('flash-discard'),
  };
  els.replace.addEventListener('click', () => void choose('replace'));
  els.copy.addEventListener('click', () => void choose('copy'));
  els.discard.addEventListener('click', () => void choose('discard'));
  // Closed without a choice — Escape, or while it was still softening — the draft is thrown away.
  // A close event arrives after the close itself: if the dialog is open again by then, the event is
  // an earlier session's and the one open now is left alone.
  els.dialog.addEventListener('close', () => {
    if (els?.dialog.open) return;
    if (open && !open.chosen) void window.pulp.keepSoftened(open.id, 'discard');
    open = null;
  });
}
