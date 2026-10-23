/** The results region: renders the #results list from the shared state (ADR 0009). */

import { render } from 'preact';
import { entryLabel } from '../core/app-state';
import type { LibraryEntry } from '../core/library-types';
import { appState, results } from './store';

interface RowProps {
  entry: LibraryEntry;
  selected: boolean;
  onSelect: (entry: LibraryEntry) => void;
}

function Row({ entry, selected, onSelect }: RowProps) {
  const { name, meta } = entryLabel(entry);
  const withTags = entry.tags.length ? `${meta} · ${entry.tags.join(', ')}` : meta;
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
        {entry.thumbnail ? <img src={entry.thumbnail} alt="" /> : entry.kind === 'template' ? 'T' : entry.mediaKind === 'audio' ? '♫' : ''}
      </span>
      <span class="text">
        <span class="name-row">
          <span class="fav" hidden={!entry.favorite}>{entry.favorite ? '★' : ''}</span>
          <span class="name">{name}</span>
        </span>
        <span class="meta">{entry.offline ? `offline · ${withTags}` : withTags}</span>
      </span>
    </li>
  );
}

function Results({ onSelect }: { onSelect: (entry: LibraryEntry) => void }) {
  if (!appState.value.index) return null;
  const { entries } = results.value;
  if (entries.length === 0) return <li class="meta">No matches.</li>;
  const selectedKey = appState.value.selectedKey;
  return (
    <>
      {entries.map((entry) => (
        <Row key={entry.key} entry={entry} selected={selectedKey === entry.key} onSelect={onSelect} />
      ))}
    </>
  );
}

/** Mounts into the existing <ul id="results">, which from then on belongs to Preact. */
export function mountResults(container: HTMLElement, onSelect: (entry: LibraryEntry) => void): void {
  render(<Results onSelect={onSelect} />, container);
}
