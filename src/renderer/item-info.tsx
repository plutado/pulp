/**
 * Favorite, tag chips and quick-add for the shown item, rendered from the shared
 * state. Mounted twice — the strip under the stage and the Info tab — so an edit
 * in one place shows in the other; the Info tab's instance adds the details line.
 * Edits go to the library; the changed index flows back through the shared state.
 */

import { render } from 'preact';
import { computed, effect } from '@preact/signals';
import { itemDetails, shownEntry } from '../core/app-state';
import { tagLabel } from '../core/display';
import type { LibraryEntry } from '../core/library-types';
import { appState } from './store';
import { Icon } from './icons';

const shown = computed(() => shownEntry(appState.value));

/** Element ids, for the instance the end-to-end test drives (the strip). */
interface Ids {
  favorite?: string;
  chips?: string;
  input?: string;
}

function Tools({ entry, ids }: { entry: LibraryEntry; ids: Ids }) {
  const user = new Set(entry.userTags ?? []);
  const addTags = (input: HTMLInputElement) => {
    const added = input.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (added.length === 0) return;
    input.value = '';
    void window.pulp.setItemTags(entry.id, [...(entry.userTags ?? []), ...added]);
  };
  return (
    <>
      <button
        id={ids.favorite}
        type="button"
        class="favorite"
        aria-pressed={entry.favorite === true ? 'true' : 'false'}
        aria-label="Favorite"
        onClick={() => void window.pulp.setItemFavorite(entry.id, !entry.favorite)}
      >
        <Icon name={entry.favorite ? 'star-fill' : 'star'} />
      </button>
      <div id={ids.chips} class="tag-chips">
        {entry.tags.map((tag) => (
          <span key={tag} class={user.has(tag) ? 'tag-chip user' : 'tag-chip folder'} data-tag={tag} title={user.has(tag) ? 'Your tag' : 'From the folder or manifest'}>
            {tagLabel(tag)}
            {user.has(tag) && (
              <button
                type="button"
                aria-label={`Remove ${tagLabel(tag)}`}
                onClick={() => void window.pulp.setItemTags(entry.id, (entry.userTags ?? []).filter((t) => t !== tag))}
              >
                <Icon name="x" />
              </button>
            )}
          </span>
        ))}
      </div>
      <input
        key={entry.key}
        id={ids.input}
        type="text"
        class="tag-input"
        placeholder="Add tag, Enter"
        autocomplete="off"
        spellcheck={false}
        aria-label="Add tag"
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          addTags(e.target as HTMLInputElement);
        }}
      />
    </>
  );
}

function ItemInfo({ ids, withDetails }: { ids: Ids; withDetails: boolean }) {
  const entry = shown.value;
  if (!entry) return null;
  // The strip's container is itself the .item-tools row; the Info tab's instance brings its own.
  if (!withDetails) return <Tools entry={entry} ids={ids} />;
  return (
    <>
      <div id="details" class="details">
        {itemDetails(entry)}
      </div>
      <div class="item-tools">
        <Tools entry={entry} ids={ids} />
      </div>
    </>
  );
}

/** The container keeps its own hidden attribute, which the end-to-end test reads. */
export function mountItemInfo(container: HTMLElement, ids: Ids, withDetails: boolean): void {
  render(<ItemInfo ids={ids} withDetails={withDetails} />, container);
  effect(() => {
    container.hidden = shown.value === null;
  });
}
