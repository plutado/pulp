/**
 * The `.pulp` project file (milestone 27): a whole session saved, as against a
 * `.pulpcollection`, which saves only what was gathered and how each item
 * renders. A project is a **superset** of a collection — the same items, with
 * every one's parameters, layers, stage placements and placed assets, and its
 * output settings — plus what the session itself knows: which library folders
 * it draws from, and where Render all last wrote.
 *
 * Pure: this is what a project *is*, how it is written and how it is read
 * back. The main process owns the dialogs, the file and the recovery copy.
 *
 * **Versioned like the template format:** fields are added rather than
 * repurposed, and an incompatible change takes a new `formatVersion`. A file
 * written by a later Pulp is refused by name rather than half-read, and a
 * field a later Pulp added is ignored by an earlier one.
 *
 * A collection file still opens — as a project with items and nothing else —
 * and a project can still be saved back out as a collection, so a project is
 * never a one-way door for anyone on an older build.
 */

import { emptyCollection, parseCollection, type Collection, type CollectionItem } from './collection';

export const PROJECT_FORMAT_VERSION = 1;

export interface Project {
  /** The gathered items, exactly as a collection holds them (src/core/collection.ts). */
  collection: Collection;
  /**
   * Library folders this project draws from, as they were when it was saved.
   * Opening a project somewhere else can then say which it is missing rather
   * than showing an empty library and no reason.
   */
  libraryFolders: string[];
  /** Where Render all last wrote, so a project remembers where its output goes. */
  renderFolder?: string;
}

export const emptyProject: Project = { collection: emptyCollection, libraryFolders: [] };

/** A collection file read as a project: its items, and nothing else to know. */
export function projectFromCollection(collection: Collection): Project {
  return { collection, libraryFolders: [] };
}

export function serializeProject(p: Project): string {
  return `${JSON.stringify({
    formatVersion: PROJECT_FORMAT_VERSION,
    items: p.collection.items,
    libraryFolders: p.libraryFolders,
    ...(p.renderFolder ? { renderFolder: p.renderFolder } : {}),
  }, null, 2)}\n`;
}

export type ParsedProject = { ok: true; project: Project } | { ok: false; error: string };

/**
 * Read a saved project, refusing anything it cannot vouch for rather than
 * half-loading it. The items are read by the collection's own reader, so one
 * place says what an item is and a project cannot drift from a collection.
 */
export function parseProject(text: string): ParsedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not a project: it is not readable JSON.' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'That file is not a project.' };
  const r = raw as { formatVersion?: unknown; items?: unknown; libraryFolders?: unknown; renderFolder?: unknown };
  if (r.formatVersion !== PROJECT_FORMAT_VERSION) {
    return { ok: false, error: `This project was written in format ${String(r.formatVersion)}; this version of Pulp reads ${PROJECT_FORMAT_VERSION}.` };
  }
  // The items are a collection's items, so they are read by the collection's reader.
  const items = parseCollection(JSON.stringify({ formatVersion: 1, items: Array.isArray(r.items) ? r.items : [] }));
  if (!items.ok) return { ok: false, error: items.error };
  return {
    ok: true,
    project: {
      collection: items.collection,
      libraryFolders: Array.isArray(r.libraryFolders) ? r.libraryFolders.filter((f): f is string => typeof f === 'string' && f.trim() !== '') : [],
      ...(typeof r.renderFolder === 'string' && r.renderFolder.trim() ? { renderFolder: r.renderFolder } : {}),
    },
  };
}

/** Whether two projects would be written to exactly the same file. */
export function sameProject(a: Project, b: Project): boolean {
  return serializeProject(a) === serializeProject(b);
}

/**
 * Whether there are changes a person would mind losing — what the mark on the
 * title means, and what is asked about before a project is closed.
 *
 * Compared as they would be written, so a difference that would not survive
 * saving warns nobody. The **library folders are left out**: they record which
 * folders the machine had when the project was written, not anything edited
 * here, so adding a folder to the library — or opening a project on a computer
 * with different folders — is not an unsaved change to the work.
 */
export function hasUnsavedChanges(now: Project, saved: Project): boolean {
  return !sameProject({ ...now, libraryFolders: [] }, { ...saved, libraryFolders: [] });
}

// ---------------------------------------------------------------- media that moved

/**
 * The folders a project's items say they were in, for the relink dialogs: the
 * remembered path of everything the library can no longer answer for.
 */
export function missingPaths(items: readonly CollectionItem[], missingUids: ReadonlySet<string>): { uid: string; path: string }[] {
  return items.filter((i) => missingUids.has(i.uid) && typeof i.path === 'string' && i.path !== '').map((i) => ({ uid: i.uid, path: i.path! }));
}

/** A path split on either separator, so a project written on Windows relinks on macOS and back. */
function segments(path: string): string[] {
  return path.split(/[\\/]/);
}

export interface PathShift {
  /** The part of the old path that moved. */
  from: string;
  /** What it moved to. */
  to: string;
  /** The separator the new path is written with, so a shifted path reads like its neighbours. */
  separator: string;
}

/**
 * Where a folder went, worked out from one file that was found again: the
 * longest run of trailing path segments the two have in common is what did
 * *not* move, and what is left on either side is the shift.
 *
 * A file that was **renamed** has no trailing segment in common, and nothing
 * can be said about where its neighbours went, so there is no shift — that one
 * item is relinked and the rest are left to be relinked themselves. Guessing
 * from a rename would quietly rebind items to the wrong files.
 */
export function pathShift(oldPath: string, newPath: string): PathShift | null {
  const from = segments(oldPath);
  const to = segments(newPath);
  let common = 0;
  while (common < from.length - 1 && common < to.length - 1 && from[from.length - 1 - common] === to[to.length - 1 - common]) common += 1;
  if (common === 0) return null;
  const separator = newPath.includes('\\') && !newPath.includes('/') ? '\\' : '/';
  return { from: from.slice(0, from.length - common).join('/'), to: to.slice(0, to.length - common).join(separator), separator };
}

/** Where a path lands under a shift, or null when the shift says nothing about it. */
export function shiftPath(path: string, shift: PathShift): string | null {
  const prefix = shift.from;
  const normal = segments(path).join('/');
  const fromNormal = segments(prefix).join('/');
  if (normal !== fromNormal && !normal.startsWith(`${fromNormal}/`)) return null;
  const rest = segments(normal.slice(fromNormal.length).replace(/^\//, '')).filter((p) => p !== '');
  return [shift.to, ...rest].join(shift.separator);
}

/**
 * An item rebound to the file it was found at: a new library id and the path
 * it is at now, so relinking it twice starts from where it is rather than from
 * where it used to be.
 */
export function relinkItem(c: Collection, uid: string, to: { id: string; path: string }): Collection {
  let changed = false;
  const items = c.items.map((i) => {
    if (i.uid !== uid) return i;
    changed = true;
    return { ...i, id: to.id, path: to.path };
  });
  return changed ? { items } : c;
}
