/**
 * The editor panel's bridge (milestone 54): Pulp's library and collection,
 * answered to a panel running inside Premiere Pro or DaVinci Resolve over a
 * connection that never leaves this machine.
 *
 * The listener binds to 127.0.0.1 only, on a port the system picks, and every
 * request must carry a token made fresh each time the bridge starts. Port and
 * token are written to `panel-bridge.json` beside the settings, readable only
 * by the user, which is how the panels find the bridge and the only place the
 * token ever is — so a web page in a browser, which can reach 127.0.0.1 but
 * cannot read the user's files, is answered 401 and nothing else (decision
 * record 0025). Items are addressed by their library id and the answers carry
 * no file system paths, as the app window's own protocols do (ADR 0013).
 *
 * Pure apart from node:http and node:fs; the main process supplies the live
 * library, the collection and the thumbnail files through PanelBridgeContext.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import type { Collection } from './collection';
import { resolveCollection } from './collection';
import type { LibraryEntry, LibraryIndex } from './library-types';
import { searchLibrary } from './search';

/** Bumped when an answer's shape changes, so a panel can say "this Pulp is newer than me" instead of misreading it. */
export const BRIDGE_PROTOCOL_VERSION = 1;

/** Beside settings.json; holds the port and the token, and is removed when the bridge stops. */
export const BRIDGE_FILE_NAME = 'panel-bridge.json';

/** The header a panel sends the token in. A bare name, so no CORS-exempt form can carry it by accident. */
export const BRIDGE_TOKEN_HEADER = 'x-pulp-token';

/** How many items one answer carries at most; the panel searches rather than pages. */
export const BRIDGE_MAX_ITEMS = 500;

/** What `panel-bridge.json` holds: where the bridge is and the word that opens it. */
export interface BridgeFile {
  app: 'pulp';
  bridge: number;
  version: string;
  port: number;
  token: string;
  startedAt: string;
}

export function bridgeFileContents(info: { version: string; port: number; token: string; startedAt: string }): string {
  const file: BridgeFile = { app: 'pulp', bridge: BRIDGE_PROTOCOL_VERSION, ...info };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Reads a bridge file back, vouching for every field; null for anything else. Mirrored in panels/shared/connect.js. */
export function parseBridgeFile(text: string): BridgeFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<BridgeFile>;
  if (r.app !== 'pulp' || typeof r.bridge !== 'number') return null;
  if (typeof r.version !== 'string' || typeof r.startedAt !== 'string') return null;
  if (typeof r.token !== 'string' || !/^[0-9a-f]{64}$/.test(r.token)) return null;
  if (typeof r.port !== 'number' || !Number.isInteger(r.port) || r.port < 1 || r.port > 65535) return null;
  return { app: 'pulp', bridge: r.bridge, version: r.version, port: r.port, token: r.token, startedAt: r.startedAt };
}

/** 256 bits of randomness as hex, new for every start of the bridge. */
export function newBridgeToken(): string {
  return randomBytes(32).toString('hex');
}

/** Compared in constant time through fixed-length digests, so a wrong token learns nothing from the clock. */
export function tokenMatches(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- what the panel is told

/** One library item as the panel lists it: the id to ask more by, and what a card says. Never a path. */
export interface PanelItem {
  id: string;
  /** What it is: a template, or the media kind. */
  kind: 'template' | 'video' | 'image' | 'audio';
  name: string;
  /** Taxonomy type — 'lower-third', 'whoosh' — when one is known. */
  type?: string;
  /** Seconds, when known; absent for stills and unprobed media. */
  duration?: number;
  pack?: string;
  favorite?: boolean;
  /** True when /v1/thumb/<id> has a picture for it. */
  thumb?: boolean;
}

export interface PanelLibrary {
  builtAt: string;
  /** How many matched, before the answer was cut to BRIDGE_MAX_ITEMS. */
  total: number;
  items: PanelItem[];
}

/** One gathered item as the panel lists it; missing and offline exactly as the tray flags them. */
export interface PanelCollectionItem {
  uid: string;
  id: string;
  kind: 'template' | 'media';
  name: string;
  presetId: string;
  missing: boolean;
  offline: boolean;
}

export interface PanelCollection {
  name: string;
  items: PanelCollectionItem[];
}

export function panelItemFor(entry: LibraryEntry): PanelItem {
  if (entry.kind === 'template') {
    return {
      id: entry.id,
      kind: 'template',
      name: entry.manifest.name,
      type: entry.manifest.category,
      duration: entry.manifest.duration,
      ...(entry.pack ? { pack: entry.pack.name } : {}),
      ...(entry.favorite ? { favorite: true } : {}),
      ...(entry.thumbnail ? { thumb: true } : {}),
    };
  }
  return {
    id: entry.id,
    kind: entry.mediaKind,
    name: entry.name,
    ...(entry.type ? { type: entry.type } : {}),
    ...(entry.meta?.duration !== undefined ? { duration: entry.meta.duration } : {}),
    ...(entry.favorite ? { favorite: true } : {}),
    ...(entry.thumbnail ? { thumb: true } : {}),
  };
}

/**
 * The library as the panel lists it: the whole index sorted by name, or — with
 * a query — the very search the app's own field runs, syntax and all, so
 * `type:lower-third` fences the same items in both places. Offline items are
 * left out: the panel exists to hand over files that are there.
 */
export function panelLibrary(index: LibraryIndex, query: string, limit = BRIDGE_MAX_ITEMS): PanelLibrary {
  const q = query.trim();
  const entries = q === ''
    ? [...index.templates, ...index.media].sort((a, b) => panelItemFor(a).name.localeCompare(panelItemFor(b).name))
    : searchLibrary(index, q).map((hit) => hit.entry);
  const online = entries.filter((e) => !e.offline);
  return { builtAt: index.builtAt, total: online.length, items: online.slice(0, Math.max(1, limit)).map(panelItemFor) };
}

/** The collection as the panel lists it, each item resolved against the index so what has gone says so. */
export function panelCollection(name: string, collection: Collection, index: LibraryIndex | null): PanelCollection {
  return {
    name,
    items: resolveCollection(collection, index).map((r) => ({
      uid: r.item.uid,
      id: r.item.id,
      kind: r.item.kind,
      name: r.item.name,
      presetId: r.item.presetId,
      missing: r.missing,
      offline: r.offline,
    })),
  };
}

// ---------------------------------------------------------------- answering a request

/** What the main process supplies: the token, the version, and the live data the answers are made from. */
export interface PanelBridgeContext {
  token: string;
  version: string;
  library(): Promise<LibraryIndex>;
  collection(): { name: string; collection: Collection };
  /** An item's thumbnail as a real PNG inside the cache, or nothing; the caller holds it to the cache folder. */
  thumbnail(id: string): Promise<string | undefined>;
}

export interface BridgeRequest {
  method: string;
  /** Path and query, as node:http gives it: "/v1/library?q=…". */
  url: string;
  token: string | null;
}

export interface BridgeResponse {
  status: number;
  headers: Record<string, string>;
  body?: string | Readable;
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

/**
 * The panels run inside each host's own Chromium, whose pages are not http
 * origins, so the browser asks before sending the token header. The answer
 * names only that header; without the token every route is still a 401, so
 * being readable cross-origin gives a page nothing it could use.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Access-Control-Allow-Headers': BRIDGE_TOKEN_HEADER,
};

function json(status: number, payload: unknown): BridgeResponse {
  return {
    status,
    headers: { ...NO_STORE, ...CORS, 'Content-Type': 'application/json' },
    body: `${JSON.stringify(payload)}\n`,
  };
}

const notFound = (): BridgeResponse => json(404, { error: 'not found' });

/** A library id as the store mints them: hex, bounded; nothing else reaches a lookup. */
const ITEM_ID = /^[0-9a-f]{1,64}$/;

export async function handleBridgeRequest(req: BridgeRequest, ctx: PanelBridgeContext): Promise<BridgeResponse> {
  // The preflight is how a hosted page earns the right to send the token header; it carries no data either way.
  if (req.method === 'OPTIONS') return { status: 204, headers: { ...NO_STORE, ...CORS } };
  if (req.method !== 'GET') return { status: 405, headers: { Allow: 'GET, OPTIONS', ...NO_STORE, ...CORS } };
  if (!tokenMatches(req.token, ctx.token)) return json(401, { error: 'unauthorized' });

  let url: URL;
  try {
    url = new URL(req.url, 'http://bridge');
  } catch {
    return notFound();
  }

  if (url.pathname === '/v1/hello') {
    return json(200, { app: 'pulp', bridge: BRIDGE_PROTOCOL_VERSION, version: ctx.version });
  }

  if (url.pathname === '/v1/library') {
    const limitRaw = Number(url.searchParams.get('limit') ?? BRIDGE_MAX_ITEMS);
    const limit = Number.isFinite(limitRaw) ? Math.min(BRIDGE_MAX_ITEMS, Math.max(1, Math.floor(limitRaw))) : BRIDGE_MAX_ITEMS;
    return json(200, panelLibrary(await ctx.library(), url.searchParams.get('q') ?? '', limit));
  }

  if (url.pathname === '/v1/collection') {
    const { name, collection } = ctx.collection();
    return json(200, panelCollection(name, collection, await ctx.library()));
  }

  const thumb = /^\/v1\/thumb\/([^/]+)$/.exec(url.pathname);
  if (thumb) {
    const id = thumb[1]!;
    if (!ITEM_ID.test(id)) return notFound();
    const file = await ctx.thumbnail(id);
    if (!file) return notFound();
    let size: number;
    try {
      const info = await stat(file);
      if (!info.isFile()) return notFound();
      size = info.size;
    } catch {
      return notFound();
    }
    return {
      status: 200,
      headers: { ...NO_STORE, ...CORS, 'Content-Type': 'image/png', 'Content-Length': String(size) },
      body: createReadStream(file),
    };
  }

  return notFound();
}

// ---------------------------------------------------------------- the listener

export interface PanelServer {
  port: number;
  close(): Promise<void>;
}

/**
 * The bridge itself: node:http bound to 127.0.0.1 and nothing else, every
 * request answered through handleBridgeRequest. Port 0 (the default) lets the
 * system pick a free one; the discovery file is how anyone learns which.
 */
export function startPanelServer(ctx: PanelBridgeContext, port = 0): Promise<PanelServer> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const token = req.headers[BRIDGE_TOKEN_HEADER];
    void handleBridgeRequest(
      { method: req.method ?? '', url: req.url ?? '/', token: typeof token === 'string' ? token : null },
      ctx,
    )
      .catch(() => json(500, { error: 'bridge error' }))
      .then((answer) => {
        res.writeHead(answer.status, answer.headers);
        if (answer.body === undefined || typeof answer.body === 'string') {
          res.end(answer.body);
        } else {
          answer.body.on('error', () => res.destroy());
          answer.body.pipe(res);
        }
      });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const chosen = address && typeof address === 'object' ? address.port : port;
      resolve({
        port: chosen,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
