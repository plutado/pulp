/**
 * The collection: the items gathered while browsing, as cards in the tray.
 *
 * A card is the same shape as a render card (docs/ui-style.md) — thumbnail,
 * display name, preset badge, one line of settings — and carries the item's own
 * output settings. Choosing a card hands it to the inspector's Output and
 * Parameters tabs, so a collection item is edited with the same controls as
 * anything else rather than a second, smaller copy of them inside the card.
 */

import { render } from 'preact';
import { computed } from '@preact/signals';
import { editingItem, setCollection, setEditing } from '../core/app-state';
import { moveItem, removeItem, resolveCollection, type ResolvedItem } from '../core/collection';
import { durationLabel, frameRateLabel } from '../core/display';
import { OUTPUT_PRESETS, type PresetId } from '../core/render-plan';
import { formatTimecode } from '../core/timecode';
import { Icon } from './icons';
import { appState, dispatch } from './store';

/** Each item paired with what the library has for it now. */
export const resolved = computed(() => resolveCollection(appState.value.collection, appState.value.index));

const editingUid = computed(() => appState.value.editing);

/** What a card says about its settings: only what differs from the template's own. */
function settingsLine(r: ResolvedItem): string {
  const { options, presetId } = r.item;
  const parts = [OUTPUT_PRESETS[presetId as PresetId]?.label ?? presetId];
  const fps = options.fps;
  if (fps !== undefined) parts.push(frameRateLabel(fps));
  if (options.inFrame !== undefined || options.outFrame !== undefined) {
    const rate = fps ?? (r.entry?.kind === 'template' ? r.entry.manifest.fps : 25);
    const from = formatTimecode(options.inFrame ?? 0, rate);
    const to = options.outFrame === undefined ? 'end' : formatTimecode(options.outFrame, rate);
    parts.push(`${from} to ${to}`);
  }
  if (r.entry?.kind === 'template' && Object.keys(r.item.params).length > 0) parts.push('edited');
  return parts.join(' · ');
}

/** Why a card cannot render, in a few words, or an empty string when it can. */
function problem(r: ResolvedItem): string {
  if (r.missing) return 'Not in the library any more';
  if (r.offline) return 'Its folder is offline';
  if (r.missingImages.length > 0) return `${r.missingImages.join(', ')}: the chosen image is not in the library`;
  if (r.item.kind === 'media') return 'Converting media comes later';
  return '';
}

function Item({ r, first, last }: { r: ResolvedItem; first: boolean; last: boolean }) {
  const { item } = r;
  const chosen = editingUid.value === item.uid;
  const trouble = problem(r);
  const thumbnail = r.entry?.thumbnail;
  const move = (delta: number) => dispatch((s) => setCollection(s, moveItem(s.collection, item.uid, delta)));
  return (
    <li
      class={`job-card collection-card${chosen ? ' chosen' : ''}${trouble ? ' unusable' : ''}`}
      data-uid={item.uid}
      aria-selected={chosen ? 'true' : 'false'}
      onClick={() => dispatch((s) => setEditing(s, chosen ? null : item.uid))}
    >
      <span class="order">
        <button type="button" class="icon-button" aria-label="Move up" disabled={first} onClick={(e: MouseEvent) => { e.stopPropagation(); move(-1); }}>
          <Icon name="caret-up" />
        </button>
        <button type="button" class="icon-button" aria-label="Move down" disabled={last} onClick={(e: MouseEvent) => { e.stopPropagation(); move(1); }}>
          <Icon name="caret-down" />
        </button>
      </span>
      <span class="job-thumb checker">{thumbnail ? <img src={thumbnail} alt="" /> : <Icon name={item.kind === 'media' ? 'film-strip' : 'shapes'} />}</span>
      <span class="job-text">
        <span class="job-head">
          <span class="job-name">{item.name}</span>
          {r.entry?.kind === 'template' && <span class="badge preset">{durationLabel(r.entry.manifest.duration)}</span>}
        </span>
        <span class={`job-status ${trouble ? 'failed' : 'done'}`}>{trouble || settingsLine(r)}</span>
      </span>
      <span class="job-actions">
        <button
          type="button"
          class="icon-button"
          aria-label="Remove from the collection"
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            dispatch((s) => setEditing(setCollection(s, removeItem(s.collection, item.uid)), s.editing === item.uid ? null : s.editing));
          }}
        >
          <Icon name="x" />
        </button>
      </span>
    </li>
  );
}

function CollectionList() {
  const list = resolved.value;
  if (list.length === 0) return null;
  return (
    <>
      {list.map((r, i) => (
        <Item key={r.item.uid} r={r} first={i === 0} last={i === list.length - 1} />
      ))}
    </>
  );
}

export function mountCollection(container: HTMLElement): void {
  render(<CollectionList />, container);
}

/** The item the inspector is editing, for the Output and Parameters tabs. */
export const editing = computed(() => editingItem(appState.value));
