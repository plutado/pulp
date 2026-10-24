/**
 * The results region: a grid of cards or a list of rows, rendered from the shared
 * state (ADR 0009). Which one, and how big the cards are, comes from
 * `src/core/results-view.ts`; this file only turns those facts into elements.
 * The container owns the scroll, so the geometry it needs goes on it as custom
 * properties rather than being measured back out of the rendered cards.
 *
 * Only the rows and cards the viewport covers are in the DOM
 * (`src/core/virtual-list.ts`); two spacers stand in for the rest, so the
 * scrollbar still measures the whole list however long it is. Keys are the
 * entries', so an item that stays in the window keeps its element — and its
 * loaded thumbnail — while the window moves around it.
 */

import { render } from 'preact';
import { effect, signal } from '@preact/signals';
import { entryLabel, neighbourEntry } from '../core/app-state';
import { tagLabel } from '../core/display';
import type { LibraryEntry } from '../core/library-types';
import {
  cardHeight,
  columnsFor,
  entryBadges,
  listRow,
  tallestRatio,
  thumbHeight,
  viewModeFor,
  LIST_ROW_HEIGHT,
  type BadgeId,
  type ResultBadge,
} from '../core/results-view';
import { COLLECTION_DRAG_TYPE } from '../core/collection';
import { virtualWindow } from '../core/virtual-list';
import { Icon, type IconName } from './icons';
import { Thumb } from './item-preview';
import { appState, hasIndex, results, resultsView, selectedKey } from './store';

/** The scrolling viewport, measured: the column count, the window and the layout agree on one number. */
const viewport = signal({ width: 0, height: 0 });
const scrollTop = signal(0);

const BADGE_ICONS: Partial<Record<BadgeId, IconName>> = { alpha: 'checkerboard', loop: 'repeat', vertical: 'device-mobile', square: 'square', pack: 'package' };

function Badges({ badges }: { badges: ResultBadge[] }) {
  return (
    <span class="badges">
      {badges.map((badge) => {
        const icon = BADGE_ICONS[badge.id];
        return (
          <span key={badge.id} class={`badge ${badge.id}`} data-badge={badge.id} data-tip={badge.tip}>
            {icon && <Icon name={icon} />}
            <span class="label">{badge.label}</span>
          </span>
        );
      })}
    </span>
  );
}

function Favorite({ entry }: { entry: LibraryEntry }) {
  return (
    <span class="fav" hidden={!entry.favorite} aria-label="Favorite">
      {entry.favorite && <Icon name="star-fill" />}
    </span>
  );
}

interface ItemProps {
  entry: LibraryEntry;
  selected: boolean;
  onSelect: (entry: LibraryEntry) => void;
}

/** Everything the card and the row drop for space, kept on the name as a tooltip. */
function summary(entry: LibraryEntry): string {
  const { name, meta } = entryLabel(entry);
  const tags = entry.tags.length ? ` · ${entry.tags.map(tagLabel).join(', ')}` : '';
  return `${name} — ${entry.offline ? 'Offline · ' : ''}${meta}${tags}`;
}

function Card({ entry, selected, onSelect }: ItemProps) {
  return (
    <li
      class={`card${entry.offline ? ' offline' : ''}`}
      role="option"
      data-id={entry.id}
      data-kind={entry.kind}
      aria-selected={selected ? 'true' : 'false'}
      draggable
      onDragStart={(e: DragEvent) => {
        // Into the collection tray. Not a file drag — that is a finished render's job.
        e.dataTransfer?.setData(COLLECTION_DRAG_TYPE, entry.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onSelect(entry)}
    >
      <Thumb entry={entry} scrubbable />
      <span class="card-text">
        <span class="name-row">
          <Favorite entry={entry} />
          <span class="name" data-tip={summary(entry)}>{entryLabel(entry).name}</span>
        </span>
        <Badges badges={entryBadges(entry)} />
      </span>
    </li>
  );
}

function Row({ entry, selected, onSelect }: ItemProps) {
  const row = listRow(entry);
  return (
    <li
      class={`row${entry.offline ? ' offline' : ''}`}
      role="option"
      data-id={entry.id}
      data-kind={entry.kind}
      aria-selected={selected ? 'true' : 'false'}
      onClick={() => onSelect(entry)}
    >
      <span class="col name-row">
        <Thumb entry={entry} />
        <Favorite entry={entry} />
        <span class="name" data-tip={summary(entry)}>{row.name}</span>
      </span>
      <span class="col duration">{row.duration}</span>
      <span class="col type">{row.type}</span>
      <span class="col themes">{row.themes}</span>
      <span class="col file" data-tip={row.file}>{row.file}</span>
    </li>
  );
}

/** Grid or list, how many items a row holds and how tall a row is: one answer for the layout and the window. */
function geometry(entries: readonly LibraryEntry[]) {
  const view = resultsView.value;
  const grid = viewModeFor(view, entries) === 'grid';
  // One row pitch for the whole grid: the tallest picture in it decides, and each card draws its own shape inside that.
  const ratio = grid ? tallestRatio(entries) : 0;
  return {
    grid,
    columns: grid ? columnsFor(viewport.value.width, view.thumbSize) : 1,
    rowHeight: grid ? cardHeight(view.thumbSize, ratio) : LIST_ROW_HEIGHT,
    thumbHeight: grid ? thumbHeight(view.thumbSize, ratio) : 0,
  };
}

function Results({ onSelect }: { onSelect: (entry: LibraryEntry) => void }) {
  if (!hasIndex.value) return null;
  const { entries } = results.value;
  if (entries.length === 0) return <li class="meta empty">No matches.</li>;
  const { grid, columns, rowHeight } = geometry(entries);
  const win = virtualWindow({ total: entries.length, columns, rowHeight, viewportHeight: viewport.value.height, scrollTop: scrollTop.value });
  const selected = selectedKey.value;
  const Item = grid ? Card : Row;
  return (
    <>
      {win.topPad > 0 && <li class="spacer" role="presentation" aria-hidden="true" style={{ height: `${win.topPad}px` }} />}
      {entries.slice(win.start, win.end).map((entry) => (
        <Item key={entry.key} entry={entry} selected={selected === entry.key} onSelect={onSelect} />
      ))}
      {win.bottomPad > 0 && <li class="spacer" role="presentation" aria-hidden="true" style={{ height: `${win.bottomPad}px` }} />}
    </>
  );
}

/**
 * Up and Down walk the results and show each item as they go — which is what
 * audition mode listens through — and Escape stops whatever is playing.
 */
function onKeyDown(event: KeyboardEvent, actions: ResultsActions): void {
  if (event.key === 'Escape') {
    actions.onStop();
    return;
  }
  const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (delta === 0) return;
  event.preventDefault();
  const next = neighbourEntry(results.value.entries, appState.value.shownKey, delta);
  if (next) actions.onSelect(next);
}

/** What the region asks of the rest of the app; it knows no other region. */
export interface ResultsActions {
  onSelect: (entry: LibraryEntry) => void;
  /** Escape: stop whatever the stage is playing. */
  onStop: () => void;
}

/** Mounts into the existing #results element, which from then on belongs to Preact. */
export function mountResults(container: HTMLElement, actions: ResultsActions): void {
  container.tabIndex = 0;
  container.addEventListener('keydown', (e) => onKeyDown(e, actions));
  const measure = () => {
    const { clientWidth: width, clientHeight: height } = container;
    if (width !== viewport.value.width || height !== viewport.value.height) viewport.value = { width, height };
  };
  measure();
  new ResizeObserver(measure).observe(container);
  container.addEventListener(
    'scroll',
    () => {
      scrollTop.value = container.scrollTop;
    },
    { passive: true },
  );

  // The card size and the column count drive both the layout and the row pitch the
  // window is computed from; they live on the container so the two cannot disagree.
  // A narrower region or a bigger card can also leave the scroll past the end, where
  // the window clamps it — the element follows, so the two stay in step.
  effect(() => {
    const entries = results.value.entries;
    const { grid, columns, rowHeight, thumbHeight: thumbH } = geometry(entries);
    container.classList.toggle('grid', grid);
    container.classList.toggle('list', !grid);
    container.style.setProperty('--cols', String(columns));
    container.style.setProperty('--card-h', `${rowHeight}px`);
    container.style.setProperty('--thumb-h', `${thumbH}px`);
    container.style.setProperty('--row-h', `${LIST_ROW_HEIGHT}px`);
    const max = Math.max(0, Math.ceil(entries.length / columns) * rowHeight - viewport.value.height);
    if (container.scrollTop > max) container.scrollTop = max;
  });

  // A new search starts at the top. A rescan or a thumbnail arriving in the background
  // changes the results too, and must not pull the list out from under the pointer.
  let search = '';
  effect(() => {
    const s = appState.value;
    const next = `${s.query}\u0000${s.sort}\u0000${s.filters.join()}\u0000${s.scope?.label ?? ''}\u0000${s.scope?.filter ?? ''}\u0000${s.scope?.root ?? ''}`;
    if (next === search) return;
    search = next;
    container.scrollTop = 0;
    scrollTop.value = 0;
  });

  render(<Results onSelect={actions.onSelect} />, container);
}
