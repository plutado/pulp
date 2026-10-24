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
  viewModeFor,
  LIST_ROW_HEIGHT,
  type BadgeId,
  type ResultBadge,
} from '../core/results-view';
import { COLLECTION_DRAG_TYPE } from '../core/collection';
import { canHaveStrip, HOVER_DWELL_MS, STRIP_RETRY_MS, stripWidthPercent, tileAt, tilePercent } from '../core/hover-scrub';
import { entryType, typeInfo } from '../core/taxonomy';
import { wantsWaveform, waveformPath } from '../core/waveform';
import { peaksFor } from './waveforms';
import { virtualWindow } from '../core/virtual-list';
import { Icon, MEDIA_KIND_ICONS, TYPE_GROUP_ICONS, type IconName } from './icons';
import { appState, hasIndex, results, resultsView, selectedKey } from './store';

/** The scrolling viewport, measured: the column count, the window and the layout agree on one number. */
const viewport = signal({ width: 0, height: 0 });
const scrollTop = signal(0);

/** The empty-thumbnail placeholder: the item's type-group icon, or the media kind's. */
function placeholderIcon(entry: LibraryEntry): IconName {
  const group = typeInfo(entryType(entry) ?? '')?.group;
  if (group) return TYPE_GROUP_ICONS[group] ?? 'shapes';
  return entry.kind === 'media' ? (MEDIA_KIND_ICONS[entry.mediaKind] ?? 'image') : 'shapes';
}

const BADGE_ICONS: Partial<Record<BadgeId, IconName>> = { alpha: 'checkerboard', loop: 'repeat', pack: 'package' };

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

// Hover-scrub. Strips are asked for when the pointer rests on a card and kept for
// the session; until one arrives the card shows its poster, so a hover never blinks.
//
// Only a settled answer is kept. "Not ready" — a busy machine, a clip still to be
// probed — is asked again while the pointer stays on the card, because a card that
// remembered it would never scrub again however long the item sat there.
const strips = signal<ReadonlyMap<string, string | null>>(new Map());
/** The card being scrubbed and which of its frames is showing. */
const scrub = signal<{ id: string; tile: number } | null>(null);
const asking = new Set<string>();
/** A dwell timer per card: entering or leaving one card must not cancel another's request. */
const dwells = new Map<string, ReturnType<typeof setTimeout>>();

function cancelDwell(id: string): void {
  const timer = dwells.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  dwells.delete(id);
}

function requestStrip(entry: LibraryEntry, delay = HOVER_DWELL_MS): void {
  // canHaveStrip, not wantsStrip: an unprobed clip could still scrub in a moment,
  // and the main process is the one that knows whether it can yet.
  if (!canHaveStrip(entry) || strips.value.has(entry.id) || asking.has(entry.id) || dwells.has(entry.id)) return;
  dwells.set(
    entry.id,
    setTimeout(() => {
      dwells.delete(entry.id);
      asking.add(entry.id);
      void window.pulp.hoverStrip(entry.id).then((result) => {
        asking.delete(entry.id);
        if (result.reason) console.warn(`No hover-scrub strip for ${entry.id}: ${result.reason}`);
        if (result.url === null && result.transient) {
          // Not possible yet, rather than not possible: try again if the pointer is still here.
          if (scrub.value?.id === entry.id) requestStrip(entry, STRIP_RETRY_MS);
          return;
        }
        strips.value = new Map(strips.value).set(entry.id, result.url);
      });
    }, delay),
  );
}

/** Pointer position across the picture picks the frame; the signal only moves when the frame does. */
function onScrub(entry: LibraryEntry, event: PointerEvent): void {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const tile = tileAt((event.clientX - box.left) / Math.max(1, box.width));
  const current = scrub.value;
  if (current?.id === entry.id && current.tile === tile) return;
  scrub.value = { id: entry.id, tile };
}

function endScrub(entry: LibraryEntry): void {
  cancelDwell(entry.id);
  if (scrub.value?.id === entry.id) scrub.value = null;
}

/** Audio has no picture; its waveform goes where the thumbnail would be. */
function Waveform({ entry }: { entry: LibraryEntry }) {
  const peaks = peaksFor(entry);
  if (!peaks || peaks.length === 0) return <Icon name={placeholderIcon(entry)} size={20} />;
  return (
    <svg class="waveform" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path d={waveformPath(peaks, 100, 32, 50)} />
    </svg>
  );
}

function Thumb({ entry, scrubbable }: { entry: LibraryEntry; scrubbable?: boolean }) {
  const at = scrubbable ? scrub.value : null;
  const strip = at?.id === entry.id ? strips.value.get(entry.id) : undefined;
  const handlers = scrubbable
    ? {
        onPointerEnter: () => requestStrip(entry),
        onPointerMove: (e: PointerEvent) => onScrub(entry, e),
        onPointerLeave: () => endScrub(entry),
      }
    : {};
  return (
    <span class={`thumb checker${entry.thumbnail ? '' : ' empty'}`} {...handlers}>
      {entry.thumbnail ? <img src={entry.thumbnail} alt="" /> : wantsWaveform(entry) ? <Waveform entry={entry} /> : <Icon name={placeholderIcon(entry)} size={20} />}
      {/* Over the poster, not instead of it: the checkerboard behind stays visible through alpha. */}
      {strip && (
        <span
          class="strip"
          style={{ backgroundImage: `url("${strip}")`, backgroundSize: `${stripWidthPercent()}% 100%`, backgroundPositionX: `${tilePercent(at!.tile)}%` }}
        />
      )}
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
  return {
    grid,
    columns: grid ? columnsFor(viewport.value.width, view.thumbSize) : 1,
    rowHeight: grid ? cardHeight(view.thumbSize) : LIST_ROW_HEIGHT,
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
    const { grid, columns, rowHeight } = geometry(entries);
    container.classList.toggle('grid', grid);
    container.classList.toggle('list', !grid);
    container.style.setProperty('--cols', String(columns));
    container.style.setProperty('--card-h', `${cardHeight(resultsView.value.thumbSize)}px`);
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
