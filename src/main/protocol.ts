import { protocol } from 'electron';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { MEDIA_SCHEME, serveMedia } from '../core/media-serve';
import { THUMB_SCHEME } from '../core/thumbnails';
import { STRIP_SCHEME } from '../core/hover-scrub';
import { injectBridge, TEMPLATE_CSP } from '../core/runtime';
import { TEMPLATE_SCHEME } from '../shared/api';
import { findTemplate, lookupMedia, lookupStrip, lookupThumbnail, thumbnailDir } from './library-service';

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
  ]);
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
 * referrer check in serveMedia refuses any that gets through.
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
    const template = await findTemplate(url.hostname);
    if (!template) return new Response('template not found', { status: 404 });

    const relPath = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || template.manifest.entry;
    const root = resolve(template.dir);
    const filePath = resolve(root, relPath);
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
