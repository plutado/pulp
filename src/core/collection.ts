/**
 * Collections: the items gathered while browsing, each with its own output
 * settings, saved and loaded as a file and rendered in one go (ROADMAP
 * milestone 13). Pure — the tray renders this, the main process writes it.
 *
 * An item is recorded three ways over: by **library id**, which is a hash of
 * where the file sits and so survives a rescan but not another machine; for a
 * template, by its **manifest id**, which is the author's own and travels; and
 * by the **path** it was at, which is the only one that survives the file
 * moving. Loading tries them in that order, and flags what it cannot find
 * rather than dropping it, so a collection is also a record of what a project
 * used — and the path is what a missing item is relinked from (milestone 27).
 */

import type { LibraryEntry, LibraryIndex } from './library-types';
import { sanitizeImageValue } from './image-slot';
import type { RenderOptions } from './render-plan';

export const COLLECTION_FORMAT_VERSION = 1;

/** Drag type for dropping a library item into the tray; a library id travels, not a file. */
export const COLLECTION_DRAG_TYPE = 'application/x-pulp-item';

export interface CollectionItem {
  /** Unique within the collection, so the same item can be in it twice with different settings. */
  uid: string;
  /** Library id: a hash of the item's path, stable while it stays there. */
  id: string;
  kind: 'template' | 'media';
  /** What it was called when it was added, so a missing item can still be named. */
  name: string;
  /** Templates only: the manifest id, which travels between libraries. */
  templateId?: string;
  /**
   * Where the item's file was when it was collected (milestone 27). A third
   * way to name it, after the library id and the manifest id, and the only one
   * that survives the file moving: an item the library cannot answer for can
   * still say where it used to be, and be relinked from there.
   */
  path?: string;
  presetId: string;
  options: RenderOptions;
  /**
   * A template's parameter values, which it renders with. For a layered
   * Photoshop still collected unplaced (milestone 33), `params.psd` keeps the
   * layers it was browsed with hidden, so the choice survives the project and
   * is what a later conversion renders.
   */
  params: Record<string, unknown>;
}

export interface Collection {
  items: CollectionItem[];
}

export const emptyCollection: Collection = { items: [] };

let counter = 0;

/** Unique for the session; a saved file keeps whatever it was given. */
export function newUid(): string {
  counter += 1;
  return `c${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Where an entry's file is: a media file itself, a template's folder — or a Lottie animation's file (milestone 35). */
export function entryPath(entry: LibraryEntry): string {
  return entry.kind === 'template' ? (entry.lottie?.path ?? entry.dir) : entry.path;
}

/** What an entry becomes when it is added, before any settings are changed. */
export function itemFor(entry: LibraryEntry, presetId: string, options: RenderOptions = {}, params: Record<string, unknown> = {}): CollectionItem {
  return {
    uid: newUid(),
    id: entry.id,
    kind: entry.kind,
    name: entry.kind === 'template' ? entry.manifest.name : entry.name,
    ...(entry.kind === 'template' ? { templateId: entry.manifest.id } : {}),
    ...(entryPath(entry) ? { path: entryPath(entry) } : {}),
    presetId,
    options,
    params,
  };
}

// Changes. Each returns a new collection, or the same one when nothing moved,
// so an unchanged collection never causes a re-render.

export function addItem(c: Collection, item: CollectionItem): Collection {
  return { items: [...c.items, item] };
}

export function removeItem(c: Collection, uid: string): Collection {
  const items = c.items.filter((i) => i.uid !== uid);
  return items.length === c.items.length ? c : { items };
}

export function clearCollection(c: Collection): Collection {
  return c.items.length === 0 ? c : emptyCollection;
}

/** Move an item by one place; at either end it stays put. */
export function moveItem(c: Collection, uid: string, delta: number): Collection {
  const at = c.items.findIndex((i) => i.uid === uid);
  const to = at + delta;
  if (at === -1 || to < 0 || to >= c.items.length) return c;
  const items = [...c.items];
  const [moved] = items.splice(at, 1);
  items.splice(to, 0, moved!);
  return { items };
}

export function updateItem(c: Collection, uid: string, patch: Partial<Omit<CollectionItem, 'uid'>>): Collection {
  let changed = false;
  const items = c.items.map((i) => {
    if (i.uid !== uid) return i;
    changed = true;
    return { ...i, ...patch };
  });
  return changed ? { items } : c;
}

/** Apply to all: one item's output settings become everyone's. Parameters stay each item's own. */
export function applyToAll(c: Collection, settings: { presetId: string; options: RenderOptions }): Collection {
  if (c.items.length === 0) return c;
  return { items: c.items.map((i) => ({ ...i, presetId: settings.presetId, options: { ...settings.options } })) };
}

// Saving and loading.

export function serializeCollection(c: Collection): string {
  return `${JSON.stringify({ formatVersion: COLLECTION_FORMAT_VERSION, items: c.items }, null, 2)}\n`;
}

export type ParsedCollection = { ok: true; collection: Collection } | { ok: false; error: string };

/** Reads a saved collection, refusing anything it cannot vouch for rather than half-loading it. */
export function parseCollection(text: string): ParsedCollection {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not a collection: it is not readable JSON.' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'That file is not a collection.' };
  const r = raw as { formatVersion?: unknown; items?: unknown };
  if (r.formatVersion !== COLLECTION_FORMAT_VERSION) {
    return { ok: false, error: `This collection was written in format ${String(r.formatVersion)}; this version of Pulp reads ${COLLECTION_FORMAT_VERSION}.` };
  }
  if (!Array.isArray(r.items)) return { ok: false, error: 'That collection has no items.' };
  const items: CollectionItem[] = [];
  for (const entry of r.items) {
    const i = entry as Partial<CollectionItem>;
    if (typeof i.id !== 'string' || typeof i.presetId !== 'string') continue;
    items.push({
      uid: typeof i.uid === 'string' && i.uid ? i.uid : newUid(),
      id: i.id,
      kind: i.kind === 'media' ? 'media' : 'template',
      name: typeof i.name === 'string' ? i.name : i.id,
      ...(typeof i.templateId === 'string' ? { templateId: i.templateId } : {}),
      ...(typeof i.path === 'string' && i.path ? { path: i.path } : {}),
      presetId: i.presetId,
      options: i.options && typeof i.options === 'object' ? (i.options as RenderOptions) : {},
      params: i.params && typeof i.params === 'object' ? (i.params as Record<string, unknown>) : {},
    });
  }
  return { ok: true, collection: { items } };
}

/** An item paired with what the library currently has for it. */
export interface ResolvedItem {
  item: CollectionItem;
  entry: LibraryEntry | null;
  /** Nothing in the library matches it any more. */
  missing: boolean;
  /** Found, but its folder is not reachable right now. */
  offline: boolean;
  /** Image slots whose chosen image is not in the library, or is offline: the slot labels (milestone 22). */
  missingImages: string[];
  /** Families the item's layers are set in that are nowhere to be found: an imported font that has gone. */
  missingFonts: string[];
}

/**
 * Pair each item with its library entry: by library id, then — for a template —
 * by the manifest id, which survives the library being rebuilt somewhere else.
 */
export function resolveCollection(c: Collection, index: LibraryIndex | null, availableFamilies: readonly string[] = []): ResolvedItem[] {
  const all: LibraryEntry[] = index ? [...index.templates, ...index.media] : [];
  const byId = new Map(all.map((e) => [e.id, e]));
  const byTemplateId = new Map(all.filter((e) => e.kind === 'template').map((e) => [e.manifest.id, e]));
  return c.items.map((item) => {
    const entry = byId.get(item.id) ?? (item.templateId ? byTemplateId.get(item.templateId) : undefined) ?? null;
    const missingImages: string[] = [];
    if (entry?.kind === 'template') {
      for (const p of entry.manifest.parameters) {
        if (p.type !== 'image') continue;
        const v = sanitizeImageValue(item.params[p.id]);
        // A hidden slot draws nothing, so a missing image behind it is nothing to flag.
        if (!v?.id || v.hidden) continue;
        const image = byId.get(v.id);
        if (!image || image.kind !== 'media' || image.mediaKind !== 'image' || image.offline) missingImages.push(p.label);
      }
    }
    // A layer's family that is neither bundled, nor imported, nor one the template itself names has gone;
    // the item is drawn in a fallback face if rendered, so it is said here first. Only when the caller
    // says which families exist: a headless render has no font list and keeps the old behaviour.
    const missingFonts: string[] = [];
    if (availableFamilies.length > 0 && entry && entry.kind === 'template') {
      const own = new Set<string>();
      for (const block of entry.manifest.blocks) {
        own.add(block.typography.family);
        for (const layer of block.layers) if (layer.type === 'text') own.add(layer.family);
      }
      for (const param of entry.manifest.parameters) if (param.type === 'font') for (const f of [param.default, ...(param.options ?? [])]) own.add(f);
      const stacks = (item.params['@layers'] ?? {}) as Record<string, unknown>;
      for (const stack of Object.values(stacks)) {
        if (!Array.isArray(stack)) continue;
        for (const layer of stack) {
          const family = (layer as { family?: unknown })?.family;
          if (typeof family === 'string' && !own.has(family) && !availableFamilies.includes(family) && !missingFonts.includes(family)) missingFonts.push(family);
        }
      }
    }
    return { item, entry, missing: entry === null, offline: entry?.offline === true, missingImages, missingFonts };
  });
}

/** What a collection can render now: items that are present and reachable — templates, and media rendered itself (milestone 15). */
export function renderableItems(resolved: readonly ResolvedItem[]): ResolvedItem[] {
  return resolved.filter((r) => !r.missing && !r.offline && r.missingImages.length === 0);
}

/** One line for the tray: "4 items · 1 missing", "3 items". */
export function collectionSummary(resolved: readonly ResolvedItem[]): string {
  if (resolved.length === 0) return 'Nothing collected yet.';
  const parts = [`${resolved.length} ${resolved.length === 1 ? 'item' : 'items'}`];
  const missing = resolved.filter((r) => r.missing).length;
  const offline = resolved.filter((r) => r.offline).length;
  if (missing > 0) parts.push(`${missing} missing`);
  if (offline > 0) parts.push(`${offline} offline`);
  return parts.join(' · ');
}
