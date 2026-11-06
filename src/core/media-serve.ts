/**
 * Serving a library media file to the app window at pulp-media://<item-id>.
 *
 * Items are addressed by their library id, never by path. The file's real
 * location is resolved (following symlinks) and must still lie inside the
 * item's registered root; its real extension must be a recognized media
 * extension of the item's kind. A frame sequence is addressed one frame at a
 * time (`pulp-media://<id>/12`), by index into the run and never by name. Only GET and HEAD, no folder listings, byte
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
import { extname, join, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { MediaEntry } from './library-types';
import { mediaKindForPath } from './library-scan';
import { sequenceFrameName } from './media-sequence';
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
  // Nothing in a browser decodes these: the handler serves a PNG composite instead (src/main/layered-service.ts).
  '.psd': 'image/vnd.adobe.photoshop',
  '.ora': 'image/openraster',
  '.kra': 'application/x-krita',
  '.ai': 'application/pdf',
  '.pdf': 'application/pdf',
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

export async function serveMedia(
  req: ServeRequest,
  lookup: (id: string) => MediaLookup | undefined,
  /**
   * For a file inside an archive not unpacked yet (milestone 32): the scratch copy to serve and the
   * folder it must lie in, so browsing previews it without writing into the library.
   */
  archived?: (entry: MediaEntry) => Promise<{ file: string; root: string } | null>,
): Promise<ServeResult> {
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
  if (url.protocol !== `${MEDIA_SCHEME}:` || url.search || url.username || url.password) return notFound();
  const path = url.pathname === '' ? '/' : url.pathname;
  const found = lookup(url.hostname);
  if (!found || !found.online || found.entry.kind !== 'media') return notFound();

  // A sequence is addressed a frame at a time, "/12"; everything else has one file and
  // only "/". The number is an index into the run and the handler builds the file name
  // from it, so no part of a request ever reaches the file system as text.
  const seq = found.entry.sequence;
  let file = found.entry.path;
  if (path !== '/') {
    if (!seq || !/^\/\d{1,9}$/.test(path)) return notFound();
    const frame = Number(path.slice(1));
    if (frame >= seq.count) return notFound();
    file = join(seq.dir, sequenceFrameName(seq, frame));
  }

  let root = found.root;
  if (found.entry.archive && archived) {
    const scratch = await archived(found.entry).catch(() => null);
    if (scratch) [file, root] = [scratch.file, scratch.root];
  }
  let real: string;
  let realRoot: string;
  try {
    [real, realRoot] = await Promise.all([realpath(file), realpath(root)]);
  } catch {
    return notFound();
  }
  if (!real.startsWith(realRoot + sep)) return notFound();
  const ext = extname(real).toLowerCase();
  // A sequence entry is a video made of image files, so its frames are checked as what
  // they are rather than against the kind the clip browses as.
  const wantKind = seq ? 'image' : found.entry.mediaKind;
  if (mediaKindForPath(real) !== wantKind || !(ext in MEDIA_MIME)) return notFound();

  return serveFile(real, req.method, req.range, MEDIA_MIME[ext]!);
}

/** One local file streamed with byte ranges honoured, so audio and video can seek. */
async function serveFile(real: string, method: string, rangeHeader: string | null | undefined, mime: string): Promise<ServeResult> {
  let size: number;
  try {
    const info = await stat(real);
    if (!info.isFile()) return notFound();
    size = info.size;
  } catch {
    return notFound();
  }

  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') {
    return { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } };
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  headers['Content-Length'] = String(end - start + 1);
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  const status = range ? 206 : 200;
  if (method === 'HEAD') return { status, headers };
  return { status, headers, body: createReadStream(real, { start, end }) };
}

// ---------------------------------------------------------------- treated voice previews (milestone 53)

/** The host a treated voice preview is served under; a library id is a 24-hex hash and can never be this. */
export const VOICE_PREVIEW_HOST = 'voice';

/** The file names the voice cache writes and the only shape the handler serves. */
export const VOICE_PREVIEW_FILE = /^[a-f0-9]{40}\.m4a$/;

/** pulp-media://voice/<hash>.m4a — a file the voice service wrote into its own cache folder. */
export function voicePreviewUrlFor(file: string): string {
  return `${MEDIA_SCHEME}://${VOICE_PREVIEW_HOST}/${file}`;
}

/**
 * Serve a treated voice preview, or nothing: the name is held to exactly a hex
 * hash and the extension the cache writes, so no part of a request reaches the
 * file system as anything but a name the voice service made up. Same rules as
 * the library's media otherwise — GET and HEAD, no template pages, ranges
 * honoured so the element can seek.
 */
export async function serveVoicePreview(req: ServeRequest, dir: string): Promise<ServeResult | null> {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  if (url.protocol !== `${MEDIA_SCHEME}:` || url.hostname !== VOICE_PREVIEW_HOST) return null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } };
  }
  if (req.referrer && req.referrer.startsWith('pulp-template://')) {
    return { status: 403, headers: { 'Cache-Control': 'no-store' } };
  }
  if (url.search || url.username || url.password) return notFound();
  const name = url.pathname.replace(/^\/+/, '');
  if (!VOICE_PREVIEW_FILE.test(name)) return notFound();
  return serveFile(join(dir, name), req.method, req.range, MEDIA_MIME['.m4a']!);
}

// ---------------------------------------------------------------- clip-set previews (milestone 32)

/** The host a clip set's stitched preview is served under; never a library id. */
export const CLIP_SET_PREVIEW_HOST = 'clipset';

/** The file names the clip-set preview cache writes and the only shape the handler serves. */
export const CLIP_SET_PREVIEW_FILE = /^[a-f0-9]{40}\.webm$/;

/** pulp-media://clipset/<hash>.webm — a preview the main process stitched into its own cache folder. */
export function clipSetPreviewUrlFor(file: string): string {
  return `${MEDIA_SCHEME}://${CLIP_SET_PREVIEW_HOST}/${file}`;
}

/** Serve a stitched clip-set preview, or nothing: the same rules as a treated voice preview. */
export async function serveClipSetPreview(req: ServeRequest, dir: string): Promise<ServeResult | null> {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  if (url.protocol !== `${MEDIA_SCHEME}:` || url.hostname !== CLIP_SET_PREVIEW_HOST) return null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } };
  }
  if (req.referrer && req.referrer.startsWith('pulp-template://')) {
    return { status: 403, headers: { 'Cache-Control': 'no-store' } };
  }
  if (url.search || url.username || url.password) return notFound();
  const name = url.pathname.replace(/^\/+/, '');
  if (!CLIP_SET_PREVIEW_FILE.test(name)) return notFound();
  return serveFile(join(dir, name), req.method, req.range, 'video/webm');
}
