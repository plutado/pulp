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
import { AUDIO_PRESETS, isAudioPresetId } from '../core/media-render';
import { formatTimecode } from '../core/timecode';
import { Icon } from './icons';
import { BUNDLED_FAMILIES, importedFamilies } from '../core/fonts';
import { appState, dispatch, importedFonts } from './store';
import { relinkMissing } from './project';
import { sanitizePsdChoice } from '../core/image-slot';
import { psdCompositeUrlFor } from '../core/media-url';

/** Each item paired with what the library has for it now. */
export const resolved = computed(() => resolveCollection(appState.value.collection, appState.value.index, [...BUNDLED_FAMILIES, ...importedFamilies(importedFonts.value)]));

const editingUid = computed(() => appState.value.editing);

/** What a card says about its settings: only what differs from the template's own. */
function settingsLine(r: ResolvedItem): string {
  const { options, presetId } = r.item;
  const parts = [isAudioPresetId(presetId) ? AUDIO_PRESETS[presetId].label : OUTPUT_PRESETS[presetId as PresetId]?.label ?? presetId];
  // What a media item renders with, beyond the preset (milestone 15).
  if (options.length !== undefined) parts.push(`${options.length} s`);
  if (options.speed !== undefined && options.speed !== 1) parts.push(`×${options.speed}`);
  if (options.matte) parts.push('matte');
  const fps = options.fps;
  if (fps !== undefined) parts.push(frameRateLabel(fps));
  if (options.inFrame !== undefined || options.outFrame !== undefined) {
    const rate = fps ?? (r.entry?.kind === 'template' ? r.entry.manifest.fps : 25);
    const from = formatTimecode(options.inFrame ?? 0, rate);
    const to = options.outFrame === undefined ? 'end' : formatTimecode(options.outFrame, rate);
    parts.push(`${from} to ${to}`);
  }
  if (r.entry?.kind === 'template' && Object.keys(r.item.params).length > 0) parts.push('edited');
  const psd = collectedHide(r.item);
  if (psd) parts.push(`${psd.length} ${psd.length === 1 ? 'layer' : 'layers'} hidden`);
  return parts.join(' · ');
}

/** The hidden layers a layered still was collected with (milestone 33), or null. */
function collectedHide(item: ResolvedItem['item']): string[] | null {
  if (item.kind !== 'media') return null;
  const psd = sanitizePsdChoice((item.params as { psd?: unknown }).psd);
  return psd?.hide ?? null;
}

/** Why a card cannot render, in a few words, or an empty string when it can. */
function problem(r: ResolvedItem): string {
  if (r.missing) return r.item.path ? 'Not in the library any more; relink it to where it is now' : 'Not in the library any more';
  if (r.offline) return 'Its folder is offline';
  if (r.missingImages.length > 0) return `${r.missingImages.join(', ')}: the chosen image is not in the library`;
  if (r.missingFonts.length > 0) return `Set in ${r.missingFonts.join(' and ')}, which is not on this computer; it would render in a fallback face`;
  return '';
}

function Item({ r, first, last }: { r: ResolvedItem; first: boolean; last: boolean }) {
  const { item } = r;
  const chosen = editingUid.value === item.uid;
  const trouble = problem(r);
  // A layered still collected with layers hidden shows the picture it was collected as, composited on demand.
  const hide = collectedHide(item);
  const thumbnail = hide && r.entry && !r.missing && !r.offline ? psdCompositeUrlFor(r.entry.id, hide) : r.entry?.thumbnail;
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
        {r.missing && item.path && (
          <button
            type="button"
            class="icon-button"
            aria-label={`Relink ${item.name}`}
            data-tip={`It was at ${item.path}. Choose it where it is now; anything that moved with it follows.`}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              void relinkMissing(item.uid);
            }}
          >
            <Icon name="link" />
          </button>
        )}
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
