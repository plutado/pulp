/** The results region: renders the #results list from the shared state (ADR 0009). */

import { render } from 'preact';
import { entryLabel } from '../core/app-state';
import { tagLabel } from '../core/display';
import type { LibraryEntry } from '../core/library-types';
import { templateType, typeInfo } from '../core/taxonomy';
import { Icon, MEDIA_KIND_ICONS, TYPE_GROUP_ICONS, type IconName } from './icons';
import { hasIndex, results, selectedKey } from './store';

/** The empty-thumbnail placeholder: the template's type-group icon, or the media kind's. */
function placeholderIcon(entry: LibraryEntry): IconName {
  if (entry.kind === 'media') return MEDIA_KIND_ICONS[entry.mediaKind] ?? 'image';
  const type = templateType(entry.manifest);
  const group = type ? typeInfo(type)?.group : undefined;
  return group ? (TYPE_GROUP_ICONS[group] ?? 'shapes') : 'shapes';
}

interface RowProps {
  entry: LibraryEntry;
  selected: boolean;
  onSelect: (entry: LibraryEntry) => void;
}

function Row({ entry, selected, onSelect }: RowProps) {
  const { name, meta } = entryLabel(entry);
  const withTags = entry.tags.length ? `${meta} · ${entry.tags.map(tagLabel).join(', ')}` : meta;
  return (
    <li
      class={entry.offline ? 'offline' : undefined}
      role="option"
      data-id={entry.id}
      data-kind={entry.kind}
      aria-selected={selected ? 'true' : 'false'}
      onClick={() => onSelect(entry)}
    >
      <span class={`thumb checker${entry.thumbnail ? '' : ' empty'}`}>
        {entry.thumbnail ? <img src={entry.thumbnail} alt="" /> : <Icon name={placeholderIcon(entry)} size={20} />}
      </span>
      <span class="text">
        <span class="name-row">
          <span class="fav" hidden={!entry.favorite} aria-label="Favorite">{entry.favorite && <Icon name="star-fill" />}</span>
          <span class="name">{name}</span>
        </span>
        <span class="meta">{entry.offline ? `Offline · ${withTags}` : withTags}</span>
      </span>
    </li>
  );
}

function Results({ onSelect }: { onSelect: (entry: LibraryEntry) => void }) {
  if (!hasIndex.value) return null;
  const { entries } = results.value;
  if (entries.length === 0) return <li class="meta">No matches.</li>;
  const selected = selectedKey.value;
  return (
    <>
      {entries.map((entry) => (
        <Row key={entry.key} entry={entry} selected={selected === entry.key} onSelect={onSelect} />
      ))}
    </>
  );
}

/** Mounts into the existing <ul id="results">, which from then on belongs to Preact. */
export function mountResults(container: HTMLElement, onSelect: (entry: LibraryEntry) => void): void {
  render(<Results onSelect={onSelect} />, container);
}
