import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { injectBridge, TEMPLATE_CSP } from '../core/runtime';
import { TEMPLATE_SCHEME } from '../shared/api';
import { findTemplate } from './library-service';

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

/** Must run before app "ready". */
export function registerTemplateScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: TEMPLATE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
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
