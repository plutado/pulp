/**
 * Stock libraries (milestone 32): stock media a person already owns, added from
 * a folder or a drive and read where it lies. Pulp never copies, moves or
 * writes into one. It reads the files, and keeps what it learns (thumbnails,
 * metadata) in its own data folder.
 *
 * A library on a drive that is not connected stays listed, with its items
 * still searchable, and says so in plain words: which drive to connect. When
 * the drive is back, the library comes back by itself (the main process
 * watches for it). This is the pure part: what a library is, where its drive
 * is, and what to say about it.
 */


/** A stock library as settings keep it. */
export interface StockLibrary {
  /** The folder or the drive's root, as chosen. */
  path: string;
  /** What it is called in the window: the folder's name unless the person says otherwise. */
  name: string;
  /** When it was added, ISO 8601. */
  addedAt: string;
}

/** A stock library as the window sees it: settings, and whether it is there now. */
export interface StockLibraryState extends StockLibrary {
  online: boolean;
  /** The removable drive it lives on, by its name ("Stock 2019"), when it is on one. */
  drive?: string;
  /** How many items Pulp knows in it, reachable or not. */
  items: number;
  /** How many of them its catalog lists but are not on this computer (milestone 32). */
  missing?: number;
}

/** Read back from settings.json: only well-formed entries, each path once. */
export function sanitizeStockLibraries(raw: unknown): StockLibrary[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: StockLibrary[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const { path, name, addedAt } = r as Record<string, unknown>;
    if (typeof path !== 'string' || path.trim() === '' || seen.has(path)) continue;
    seen.add(path);
    out.push({ path, name: typeof name === 'string' && name.trim() !== '' ? name.trim() : defaultLibraryName(path), addedAt: typeof addedAt === 'string' ? addedAt : '' });
  }
  return out;
}

/** A library's name before anyone renames it: the folder's own name, or the drive's when it is a drive's root. */
export function defaultLibraryName(path: string): string {
  const drive = driveOf(path);
  const own = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return own || drive?.name || path;
}

/**
 * The removable drive a path lives on, by the platform's conventions: `/Volumes/<name>` on macOS,
 * `/media/<user>/<name>` or `/run/media/<user>/<name>` on Linux, and a drive letter other than C on
 * Windows ("E:"). A path on the system's own disk is on no drive.
 */
export function driveOf(path: string): { name: string; root: string } | undefined {
  const win = /^([A-Za-z]):[\\/]?/.exec(path);
  if (win) {
    const letter = win[1]!.toUpperCase();
    return letter === 'C' ? undefined : { name: `${letter}:`, root: `${letter}:\\` };
  }
  const p = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const mac = /^\/Volumes\/([^/]+)/.exec(p);
  if (mac) return { name: mac[1]!, root: `/Volumes/${mac[1]}` };
  const linux = /^(\/run)?\/media\/[^/]+\/([^/]+)/.exec(p) ?? /^\/mnt\/([^/]+)/.exec(p);
  if (linux) {
    const name = linux[2] ?? linux[1]!;
    return { name, root: p.slice(0, p.indexOf(name) + name.length) };
  }
  return undefined;
}

/** The same place, however it was written: for telling whether a library is already added. */
export function samePlace(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Whether a folder may be added as a library, and why not when it may not. Pulp's own folders —
 * its data, the bundled templates — are not stock, and a folder inside a library already added,
 * or holding one, would list the same files twice.
 */
export function canAddLibrary(path: string, existing: readonly StockLibrary[], own: readonly string[]): { ok: true } | { ok: false; why: 'already' | 'inside' | 'contains' | 'own' } {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() + '/';
  const p = norm(path);
  for (const o of own) if (p.startsWith(norm(o)) || norm(o).startsWith(p)) return { ok: false, why: 'own' };
  for (const l of existing) {
    const q = norm(l.path);
    if (p === q) return { ok: false, why: 'already' };
    if (p.startsWith(q)) return { ok: false, why: 'inside' };
    if (q.startsWith(p)) return { ok: false, why: 'contains' };
  }
  return { ok: true };
}
