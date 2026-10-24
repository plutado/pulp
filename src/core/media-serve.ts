/**
 * Serving a library media file to the app window at pulp-media://<item-id>.
 *
 * Items are addressed by their library id, never by path. The file's real
 * location is resolved (following symlinks) and must still lie inside the
 * item's registered root; its real extension must be a recognized media
 * extension of the item's kind. Only GET and HEAD, no folder listings, byte
 * ranges honored so video can seek. Anything unknown, offline, missing or
 * out of bounds is a bare 404 with no file system detail. Pages served from
 * pulp-template:// are refused, so a template pack cannot read the library;
 * the stills a template's image slots use are handed to the page as bytes by
 * the main process instead, never as a URL into the library (ADR 0013).
 *
 * Pure apart from node:fs; the Electron protocol handler is a thin adapter.
 */

import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { MediaEntry } from './library-types';
import { mediaKindForPath } from './library-scan';
import { MEDIA_SCHEME } from './media-url';

export { MEDIA_SCHEME, mediaUrlFor } from './media-url';

/** What the handler knows about an id: the stored entry, its root, and whether the root is reachable. */
export interface MediaLookup {
  entry: MediaEntry;
  root: string;
  online: boolean;
}

export interface ServeRequest {
  method: string;
  url: string;
  range?: string | null;
  /** The requesting page, as the Referer header or the request's referrer. */
  referrer?: string | null;
}

export interface ServeResult {
  status: number;
  headers: Record<string, string>;
  /** Present for a successful GET. */
  body?: Readable;
}

export const MEDIA_MIME: Record<string, string> = {
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mxf': 'application/mxf',
  '.avi': 'video/x-msvideo',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.exr': 'image/x-exr',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.dpx': 'image/x-dpx',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
};

const notFound = (): ServeResult => ({ status: 404, headers: { 'Cache-Control': 'no-store' } });

/** Parse a single byte range against `size`; null if absent or malformed (then the whole file is served), 416 if unsatisfiable. */
export function parseRange(header: string | null | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    // Suffix range: the last N bytes.
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

export async function serveMedia(req: ServeRequest, lookup: (id: string) => MediaLookup | undefined): Promise<ServeResult> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } };
  }
  // Only the app's own window may load media; template pages run under their own rules.
  if (req.referrer && req.referrer.startsWith('pulp-template://')) {
    return { status: 403, headers: { 'Cache-Control': 'no-store' } };
  }

  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return notFound();
  }
  if (url.protocol !== `${MEDIA_SCHEME}:` || (url.pathname !== '' && url.pathname !== '/') || url.search || url.username || url.password) {
    return notFound();
  }
  const found = lookup(url.hostname);
  if (!found || !found.online || found.entry.kind !== 'media') return notFound();

  let real: string;
  let realRoot: string;
  try {
    [real, realRoot] = await Promise.all([realpath(found.entry.path), realpath(found.root)]);
  } catch {
    return notFound();
  }
  if (!real.startsWith(realRoot + sep)) return notFound();
  const ext = extname(real).toLowerCase();
  if (mediaKindForPath(real) !== found.entry.mediaKind || !(ext in MEDIA_MIME)) return notFound();

  let size: number;
  try {
    const info = await stat(real);
    if (!info.isFile()) return notFound();
    size = info.size;
  } catch {
    return notFound();
  }

  const headers: Record<string, string> = {
    'Content-Type': MEDIA_MIME[ext]!,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const range = parseRange(req.range, size);
  if (range === 'unsatisfiable') {
    return { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } };
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  headers['Content-Length'] = String(end - start + 1);
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  const status = range ? 206 : 200;
  if (req.method === 'HEAD') return { status, headers };
  return { status, headers, body: createReadStream(real, { start, end }) };
}
