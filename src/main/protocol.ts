import { protocol } from 'electron';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { bundledFontFile, FONT_SCHEME, fontMimeType, TEMPLATE_FONTS_PATH } from '../core/fonts';
import { MEDIA_SCHEME, serveMedia } from '../core/media-serve';
import { THUMB_SCHEME } from '../core/thumbnails';
import { STRIP_SCHEME } from '../core/hover-scrub';
import { injectBridge, TEMPLATE_CSP } from '../core/runtime';
import { TEMPLATE_SCHEME } from '../shared/api';
import { bundledFontsDir, findTemplate, lookupMedia, lookupStrip, lookupThumbnail, thumbnailDir } from './library-service';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/** Must run before app "ready", once, with every custom scheme. */
export function registerTemplateScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: TEMPLATE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    // `stream` lets <video> and <audio> play from it. No fetch: only media elements need it, and the
    // scheme enforces CORS, so even the app window cannot read responses as data.
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, stream: true } },
    // Thumbnails and hover-scrub strips: small PNGs for <img> and CSS only, same rules as media
    // (by id, bare 404s, no fetch).
    { scheme: THUMB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false } },
    { scheme: STRIP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false } },
    // The bundled fonts, for the app window's own type (ADR 0014). Template pages get the same files
    // under their own origin instead, which is what their CSP allows.
    // A font load is a CORS request even from the app window, so the scheme is CORS-enabled and
    // its responses say who may read them (any page: the files are public under their licence).
    { scheme: FONT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: true } },
  ]);
}

/**
 * One of the bundled font files, or a 404. The path must be exactly `<slug>/<file>` from the
 * bundled list (src/core/fonts.ts): nothing else under the fonts folder is reachable, and the
 * list is what the credits and the hashes vouch for.
 */
async function serveBundledFont(path: string, method: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const refuse = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (method !== 'GET' && method !== 'HEAD') return refuse();
  const found = bundledFontFile(path);
  if (!found) return refuse();
  let body: Buffer;
  try {
    body = await readFile(resolve(bundledFontsDir(), found.font.slug, found.file.file));
  } catch {
    return refuse();
  }
  const headers = {
    'Content-Type': fontMimeType(found.file.file),
    // The files never change while the app runs; a template page is reloaded often and need not refetch them.
    'Cache-Control': 'max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  };
  return new Response(method === 'HEAD' ? null : new Uint8Array(body), { status: 200, headers });
}

/** The bundled fonts for the app window, at pulp-font://<slug>/<file>. Template pages are refused, as everywhere. */
export function handleFontProtocol(): void {
  protocol.handle(FONT_SCHEME, async (request) => {
    const referrer = request.referrer || request.headers.get('referer') || '';
    if (referrer.startsWith('pulp-template://')) return new Response(null, { status: 404 });
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response(null, { status: 404 });
    }
    if (url.search) return new Response(null, { status: 404 });
    // A standard scheme puts the first segment in the hostname: pulp-font://inter/InterVariable.ttf.
    return serveBundledFont(`${url.hostname}/${decodeURIComponent(url.pathname.replace(/^\/+/, ''))}`, request.method, { 'Access-Control-Allow-Origin': '*' });
  });
}

/**
 * Serve a cached PNG to the app window at <scheme>://<item-id>/. The file must
 * be the store's current one for that id and must really lie in the thumbnail
 * cache folder; anything else — a path or query on the URL, an unknown id, a
 * template referrer, a file outside the cache — is a bare 404.
 */
function handleCachedImage(scheme: string, lookup: (id: string) => string | undefined): void {
  protocol.handle(scheme, async (request) => {
    const refuse = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'GET' && request.method !== 'HEAD') return refuse();
    const referrer = request.referrer || request.headers.get('referer') || '';
    if (referrer.startsWith('pulp-template://')) return refuse();
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return refuse();
    }
    if ((url.pathname !== '' && url.pathname !== '/') || url.search) return refuse();
    const file = lookup(url.hostname);
    if (!file) return refuse();
    let real: string;
    let dir: string;
    try {
      [real, dir] = await Promise.all([realpath(file), realpath(thumbnailDir())]);
    } catch {
      return refuse();
    }
    if (!real.startsWith(dir + sep) || extname(real).toLowerCase() !== '.png') return refuse();
    let body: Buffer;
    try {
      body = await readFile(real);
    } catch {
      return refuse();
    }
    const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), { status: 200, headers });
  });
}

/** Poster thumbnails at pulp-thumb://<item-id>/ and hover-scrub strips at pulp-strip://<item-id>/. */
export function handleThumbProtocol(): void {
  handleCachedImage(THUMB_SCHEME, lookupThumbnail);
  handleCachedImage(STRIP_SCHEME, lookupStrip);
}

/**
 * Serve library media to the app window at pulp-media://<item-id>/ (see
 * core/media-serve.ts for the rules). The template CSP never lists this
 * scheme, so template pages are stopped before a request is made; the
 * referrer check in serveMedia refuses any that gets through. Image slots do
 * not go through here: their stills are handed to the page as bytes (ADR 0013).
 */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const result = await serveMedia(
      {
        method: request.method,
        url: request.url,
        range: request.headers.get('range'),
        referrer: request.referrer || request.headers.get('referer'),
      },
      lookupMedia,
    );
    const body = result.body ? (Readable.toWeb(result.body) as ReadableStream) : null;
    return new Response(body, { status: result.status, headers: result.headers });
  });
}

/**
 * Serve files from template folders at pulp-template://<template-id>/<path>.
 * Requests outside the template folder are refused, the entry HTML gets the
 * runtime bridge injected, and every response carries the template CSP.
 */
export function handleTemplateProtocol(): void {
  protocol.handle(TEMPLATE_SCHEME, async (request) => {
    const url = new URL(request.url);
    const relPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    // The bundled fonts live under every template's origin at a reserved path (ADR 0014), so a
    // template's `font-src 'self'` reaches them. A template folder's own `__pulp` can never be served.
    if (relPath.startsWith(`${TEMPLATE_FONTS_PATH}/`)) {
      // A font load is a CORS request even to its own origin — the request carries an `Origin`
      // header — and a privileged scheme enforces CORS. Same-origin passes on macOS without the
      // header; it did not on Windows, so the answer says who may read it rather than relying on
      // two custom-scheme origins comparing equal (docs/platform-notes.md, "Windows CI").
      return serveBundledFont(relPath.slice(TEMPLATE_FONTS_PATH.length + 1), request.method, {
        'Content-Security-Policy': TEMPLATE_CSP,
        'Access-Control-Allow-Origin': '*',
      });
    }
    const template = await findTemplate(url.hostname);
    if (!template) return new Response('template not found', { status: 404 });

    const entryPath = relPath || template.manifest.entry;
    const root = resolve(template.dir);
    const filePath = resolve(root, entryPath);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      return new Response('forbidden', { status: 403 });
    }

    let body: Buffer;
    try {
      body = await readFile(filePath);
    } catch {
      return new Response('not found', { status: 404 });
    }

    const headers = new Headers({
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Security-Policy': TEMPLATE_CSP,
      'Cache-Control': 'no-store',
    });
    if (filePath === resolve(root, template.manifest.entry)) {
      return new Response(injectBridge(body.toString('utf8')), { headers });
    }
    return new Response(new Uint8Array(body), { headers });
  });
}
