/**
 * The render tray's cards, one per job, keyed by job id.
 *
 * A finished card is itself the drag source — grip, whole card draggable, a hint
 * on hover and focus — so there is one place to drag from rather than a card and
 * a separate handle (docs/ui-style.md). What the card does not show, it offers:
 * the path lives in the tooltip and behind Reveal and Copy path, which are also
 * how a keyboard reaches a render, since dragging needs a pointer.
 */

import { render } from 'preact';
import { computed, effect, signal } from '@preact/signals';
import { revealLabel } from '../core/display';
import { queueCard, type QueueCard } from '../core/queue-card';
import { isFinished, type RenderQueueJob } from '../core/render-queue';
import { Icon } from './icons';
import { appState } from './store';
import { mountRovingGroup, paintRovingStops } from './roving';
import { t } from './i18n';

const jobs = computed(() => appState.value.jobs.jobs);

/** Poster of the template a job renders — or of the media item rendered itself (milestone 15) — so a card is recognizable at a glance. */
const thumbnails = computed(() => {
  const index = appState.value.index;
  return new Map([
    ...(index?.templates ?? []).map((t) => [t.manifest.id, t.thumbnail] as const),
    ...(index?.media ?? []).map((m) => [`media:${m.id}`, m.thumbnail] as const),
  ]);
});

/** The card a native drag is running from, so it can show that it is the source. */
const dragging = signal<number | null>(null);

/** Told once, the first time something leaves for an editor. */
export const dragNotice = signal(false);

function startDrag(job: RenderQueueJob, card: QueueCard): void {
  if (!card.file) return;
  dragging.value = card.id;
  dragNotice.value = true;
  void window.pulp.startDrag(card.file, job.templateId || undefined);
  // The native drag takes over from here, so there is no dragend to wait for.
  const done = () => {
    dragging.value = null;
    window.removeEventListener('pointerup', done);
  };
  window.addEventListener('pointerup', done);
  setTimeout(done, 2_000);
}

function Actions({ card }: { card: QueueCard }) {
  if (!card.file) return null;
  const file = card.file;
  // The hand-off (milestone 20, ADR 0020): the file goes to where it was made for, by the system's
  // own doors. Share… is the macOS share sheet, the one place there is one; Open upload page shows
  // the file in the file manager and opens the platform's page in the browser, ready to drop.
  const handOff = card.handOff;
  return (
    <span class="job-actions">
      {handOff && (
        <button
          type="button"
          class="icon-button"
          aria-label={t('queue.upload.aria-label', { platform: handOff.label })}
          data-tip={t('queue.upload.data-tip', { platform: handOff.label })}
          onClick={() => void window.pulp.openUploadPage(file, handOff.platform)}
        >
          <Icon name="upload-simple" />
        </button>
      )}
      {window.pulp.platform === 'darwin' && (
        <button type="button" class="icon-button" aria-label={t('queue.share.aria-label')} onClick={() => void window.pulp.shareFile(file)}>
          <Icon name="share-network" />
        </button>
      )}
      <button type="button" class="icon-button" aria-label={revealLabel(window.pulp.platform)} onClick={() => void window.pulp.revealFile(file)}>
        <Icon name="folder" />
      </button>
      <button type="button" class="icon-button" aria-label={t('queue.copy-path.aria-label')} onClick={() => void window.pulp.copyFilePath(file)}>
        <Icon name="copy" />
      </button>
      <button type="button" class="icon-button" aria-label={t('queue.remove.aria-label')} onClick={() => void window.pulp.removeRender(card.id)}>
        <Icon name="x" />
      </button>
    </span>
  );
}

function Job({ job }: { job: RenderQueueJob }) {
  const card = queueCard(job);
  const thumbnail = thumbnails.value.get(job.mediaId ? `media:${job.mediaId}` : job.templateId);
  return (
    <li
      class={`job-card ${card.status.kind}${dragging.value === card.id ? ' dragging' : ''}`}
      draggable={card.draggable}
      // Every card is reachable, draggable or not (milestone 8): the list is one tab stop and Up
      // and Down walk it, so a render in progress can be read and canceled without a pointer.
      tabIndex={-1}
      data-file={card.file}
      data-job={card.id}
      data-tip={card.tip}
      onKeyDown={
        card.file
          ? (e: KeyboardEvent) => {
              // Dragging needs a pointer, so a focused card offers the same file by keyboard.
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter') void window.pulp.revealFile(card.file!);
              else if (e.key === 'c' && (e.metaKey || e.ctrlKey)) void window.pulp.copyFilePath(card.file!);
              else return;
              e.preventDefault();
            }
          : undefined
      }
      onDragStart={
        card.draggable
          ? (e: DragEvent) => {
              // The real drag is native and starts in the main process (docs/platform-notes.md).
              e.preventDefault();
              startDrag(job, card);
            }
          : undefined
      }
    >
      {card.draggable && (
        <span class="grip" aria-hidden="true">
          <Icon name="dots-six-vertical" />
        </span>
      )}
      <span class="job-thumb checker">{thumbnail ? <img src={thumbnail} alt="" /> : <Icon name="film-strip" />}</span>
      <span class="job-text">
        <span class="job-head">
          <span class="job-name">{card.name}</span>
          <span class="badge preset">{card.preset}</span>
        </span>
        {card.status.progress !== undefined && <progress max={1} value={card.status.progress} />}
        <span class={`job-status ${card.status.kind}`}>{card.status.text}</span>
      </span>
      {card.draggable && <span class="drag-hint">{t('queue.drag-hint')}</span>}
      <Actions card={card} />
      {!isFinished(job) && (
        <button type="button" class="job-cancel" onClick={() => void window.pulp.cancelRender(job.id)}>
          {t('queue.cancel')}
        </button>
      )}
    </li>
  );
}

function Queue() {
  const list = jobs.value;
  // The tray's one-line summary already says when there is nothing; this message is
  // only worth showing when the tray is otherwise bare.
  if (list.length === 0) return appState.value.collection.items.length > 0 ? null : <li class="empty">{t('queue.empty')}</li>;
  return (
    <>
      {list.map((job) => (
        <Job key={job.id} job={job} />
      ))}
    </>
  );
}

export function mountQueue(container: HTMLElement): void {
  render(<Queue />, container);
  mountRovingGroup(container, { shape: 'list', items: () => [...container.querySelectorAll<HTMLElement>('.job-card')] });
  // Cards come and go as renders finish; the stop follows, so tabbing in always lands somewhere.
  effect(() => {
    void jobs.value;
    requestAnimationFrame(() => paintRovingStops([...container.querySelectorAll<HTMLElement>('.job-card')], 0));
  });
}
