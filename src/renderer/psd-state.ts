/**
 * Layered Photoshop files in the window (milestone 33): what the window knows
 * about each — its structure, asked of the main process once per item — and
 * which layers are hidden while it is browsed. The browsed hidden list is the
 * session's: it shows on the stage, and a picture placed from here starts with
 * it; once placed, the list lives in the image value like any other edit, so
 * presets, collections, undo and the render cache key carry it.
 */

import { signal } from '@preact/signals';
import type { LibraryEntry } from '../core/library-types';
import { fileHiddenLayers, PSD_EXTENSION, type PsdOutline } from '../core/psd';

export type OutlineState = { ok: true; outline: PsdOutline } | { ok: false; message: string } | { ok: 'pending' };

/** Structures by item id, as they arrive. */
export const psdOutlines = signal<Readonly<Record<string, OutlineState>>>({});

/** Hidden layers by item id while browsing; an item with no entry shows the file's own visibility. */
export const psdHidden = signal<Readonly<Record<string, string[]>>>({});

/** Not a type guard on purpose: a media entry is still a media entry when it is not layered. */
export function isPsdEntry(entry: LibraryEntry | null | undefined): boolean {
  return !!entry && entry.kind === 'media' && entry.ext.toLowerCase() === PSD_EXTENSION;
}

/** The outline for an item, asking for it the first time; `pending` until it lands. */
export function psdOutlineFor(id: string): OutlineState {
  const known = psdOutlines.value[id];
  if (known) return known;
  psdOutlines.value = { ...psdOutlines.value, [id]: { ok: 'pending' } };
  void window.pulp.psdOutline(id).then((result) => {
    psdOutlines.value = { ...psdOutlines.value, [id]: result.ok ? { ok: true, outline: result.outline } : { ok: false, message: result.message } };
  });
  return { ok: 'pending' };
}

/** A changed file is read again the next time it is asked about. */
export function forgetPsdOutline(id: string): void {
  if (!(id in psdOutlines.value)) return;
  const next = { ...psdOutlines.value };
  delete next[id];
  psdOutlines.value = next;
}

/** The hidden layers an item is browsed with: the session's list, or the file's own. */
export function hiddenFor(id: string, outline: PsdOutline): string[] {
  return psdHidden.value[id] ?? fileHiddenLayers(outline.layers);
}

/** True when the browsed list differs from the file's own, which is when a placed picture needs to carry it. */
export function hiddenDiffersFromFile(id: string, outline: PsdOutline): boolean {
  const own = fileHiddenLayers(outline.layers).join('+');
  const now = hiddenFor(id, outline).join('+');
  return own !== now;
}

export function setPsdHidden(id: string, hidden: readonly string[]): void {
  psdHidden.value = { ...psdHidden.value, [id]: [...hidden].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))) };
}

export function togglePsdLayer(id: string, outline: PsdOutline, layer: string): void {
  const now = new Set(hiddenFor(id, outline));
  if (now.has(layer)) now.delete(layer);
  else now.add(layer);
  setPsdHidden(id, [...now]);
}
