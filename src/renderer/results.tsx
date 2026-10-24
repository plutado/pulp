/**
 * The results region: a grid of cards or a list of rows, rendered from the shared
 * state (ADR 0009). Which one, and how big the cards are, comes from
 * `src/core/results-view.ts`; this file only turns those facts into elements.
 * The container owns the scroll, so the geometry it needs goes on it as custom
 * properties rather than being measured back out of the rendered cards.
 */

import { render } from 'preact';
import { effect, signal } from '@preact/signals';
import { entryLabel } from '../core/app-state';
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
import { entryType, typeInfo } from '../core/taxonomy';
import { Icon, MEDIA_KIND_ICONS, TYPE_GROUP_ICONS, type IconName } from './icons';
import { hasIndex, results, resultsView, selectedKey } from './store';

/** Width of the results region, so the column count and the layout agree on one number. */
const regionWidth = signal(0);

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

function Thumb({ entry }: { entry: LibraryEntry }) {
  return (
    <span class={`thumb checker${entry.thumbnail ? '' : ' empty'}`}>
      {entry.thumbnail ? <img src={entry.thumbnail} alt="" /> : <Icon name={placeholderIcon(entry)} size={20} />}
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
      onClick={() => onSelect(entry)}
    >
      <Thumb entry={entry} />
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

function Results({ onSelect }: { onSelect: (entry: LibraryEntry) => void }) {
  if (!hasIndex.value) return null;
  const { entries } = results.value;
  if (entries.length === 0) return <li class="meta empty">No matches.</li>;
  const grid = viewModeFor(resultsView.value, entries) === 'grid';
  const selected = selectedKey.value;
  const Item = grid ? Card : Row;
  return (
    <>
      {entries.map((entry) => (
        <Item key={entry.key} entry={entry} selected={selected === entry.key} onSelect={onSelect} />
      ))}
    </>
  );
}

/** Mounts into the existing #results element, which from then on belongs to Preact. */
export function mountResults(container: HTMLElement, onSelect: (entry: LibraryEntry) => void): void {
  const measure = () => {
    regionWidth.value = container.clientWidth;
  };
  measure();
  new ResizeObserver(measure).observe(container);

  // The card size and the column count drive both the layout and, once the list is
  // windowed, the row pitch; they live on the container so the two cannot disagree.
  effect(() => {
    const view = resultsView.value;
    const grid = viewModeFor(view, results.value.entries) === 'grid';
    container.classList.toggle('grid', grid);
    container.classList.toggle('list', !grid);
    container.style.setProperty('--cols', String(grid ? columnsFor(regionWidth.value, view.thumbSize) : 1));
    container.style.setProperty('--card-h', `${cardHeight(view.thumbSize)}px`);
    container.style.setProperty('--row-h', `${LIST_ROW_HEIGHT}px`);
  });

  render(<Results onSelect={onSelect} />, container);
}
