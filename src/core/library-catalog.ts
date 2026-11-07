/**
 * A stock library's own catalog (milestone 32): the list of everything the
 * collection contains, which a library may carry at its root as
 * `catalog.csv` or `catalog.json`. Pulp lists every item in it — the files on
 * this computer as usual, and the ones that are not as known but missing,
 * shown grayed out — so a person sees the whole collection and what is
 * missing from it.
 *
 * - **CSV**: a header row naming the columns. `path` (or `file`, `filename`)
 *   is required: the item's path inside the library, with / or \ between
 *   folders. `name` (or `title`), `keywords` (or `tags`, separated by
 *   semicolons or commas) and `preview` (or `thumbnail`, `thumb`: the path of
 *   the item's small preview, milestone 32) are optional. Quoted fields as
 *   spreadsheets write them.
 * - **JSON**: an array of rows, or `{ "items": [...] }`, each with `path` and
 *   optionally `name`, `keywords` (an array or a separated string) and
 *   `preview`.
 *
 * A path that would leave the library, or names no media Pulp reads, is left
 * out. Pure: the store reads the file and hands the text here.
 */

/** The file names a catalog may have at a library's root, in the order they are looked for. */
export const CATALOG_FILES = ['catalog.json', 'catalog.csv', 'Catalog.json', 'Catalog.csv', 'CATALOG.CSV'] as const;

export interface CatalogRow {
  /** Inside the library, forward slashes, no `..`. */
  path: string;
  name?: string;
  keywords: string[];
  /** The item's small preview inside the library, when the catalog names one; the same form as `path`. */
  preview?: string;
}

/** A path inside the library, or null when it would leave it. */
function safeRelative(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (p === '' || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split('/').filter((x) => x !== '');
  if (parts.some((x) => x === '..' || x === '.')) return null;
  return parts.join('/');
}

const keywordsOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/[;,]/) : []).map((k) => k.trim()).filter(Boolean);

/** Split CSV text into rows of fields, honoring quotes and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** A catalog's rows, from its text and its file name. Throws only on JSON that is not JSON. */
export function parseCatalog(text: string, fileName: string): CatalogRow[] {
  const out: CatalogRow[] = [];
  const push = (path: unknown, name: unknown, keywords: unknown, preview: unknown) => {
    const p = typeof path === 'string' ? safeRelative(path) : null;
    if (!p) return;
    const n = typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined;
    const v = typeof preview === 'string' ? safeRelative(preview) : null;
    out.push({ path: p, ...(n ? { name: n } : {}), keywords: keywordsOf(keywords), ...(v ? { preview: v } : {}) });
  };
  if (/\.json$/i.test(fileName)) {
    const data = JSON.parse(text) as unknown;
    const items = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items) ? (data as { items: unknown[] }).items : [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      push(r.path ?? r.file, r.name ?? r.title, r.keywords ?? r.tags, r.preview ?? r.thumbnail ?? r.thumb);
    }
    return out;
  }
  const [head, ...rows] = parseCsv(text);
  if (!head) return out;
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h.trim().toLowerCase()));
  const pathAt = col('path', 'file', 'filename', 'file name');
  if (pathAt < 0) return out;
  const nameAt = col('name', 'title');
  const keysAt = col('keywords', 'tags', 'keyword');
  const previewAt = col('preview', 'thumbnail', 'thumb');
  for (const r of rows) push(r[pathAt], nameAt >= 0 ? r[nameAt] : undefined, keysAt >= 0 ? r[keysAt] : undefined, previewAt >= 0 ? r[previewAt] : undefined);
  return out;
}
