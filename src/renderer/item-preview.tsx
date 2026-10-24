/**
 * The picture of an item, wherever one is shown: its poster, a waveform for
 * audio, a type icon when there is neither — and, while the pointer rests on it,
 * the frames of its hover-scrub strip (`src/core/hover-scrub.ts`).
 *
 * Shared by the results cards and the Info tab's header, so an item looks the
 * same in both and is asked for once.
 */

import { signal } from '@preact/signals';
import { canHaveStrip, HOVER_DWELL_MS, STRIP_RETRY_MS, stripWidthPercent, tileAt, tilePercent } from '../core/hover-scrub';
import type { LibraryEntry } from '../core/library-types';
import { thumbAspect } from '../core/results-view';
import { entryType, typeInfo } from '../core/taxonomy';
import { wantsWaveform, waveformPath } from '../core/waveform';
import { Icon, MEDIA_KIND_ICONS, TYPE_GROUP_ICONS, type IconName } from './icons';
import { peaksFor } from './waveforms';

/** The empty-thumbnail placeholder: the item's type-group icon, or the media kind's. */
export function placeholderIcon(entry: LibraryEntry): IconName {
  const group = typeInfo(entryType(entry) ?? '')?.group;
  if (group) return TYPE_GROUP_ICONS[group] ?? 'shapes';
  return entry.kind === 'media' ? (MEDIA_KIND_ICONS[entry.mediaKind] ?? 'image') : 'shapes';
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

export function Thumb({ entry, scrubbable }: { entry: LibraryEntry; scrubbable?: boolean }) {
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
    <span class={`thumb checker${entry.thumbnail ? '' : ' empty'}`} style={{ aspectRatio: thumbAspect(entry) }} {...handlers}>
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
