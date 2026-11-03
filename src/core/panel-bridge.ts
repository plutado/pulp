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
 * record 0025). Items are addressed by their library id and the listings carry
 * no file system paths, as the app window's own protocols do (ADR 0013); the
 * one answer that carries one is a prepared file's own, because handing that
 * file into the edit is what the panel is for.
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
import type { TypeOutputDefault } from './output-defaults';
import { OUTPUT_PRESETS, type PresetId, type RenderOptions } from './render-plan';
import type { RenderJobStatus, RenderQueueJob } from './render-queue';
import { searchLibrary } from './search';
import { templateType } from './taxonomy';

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

// ---------------------------------------------------------------- handing a file into the edit (milestone 54's drop)

/**
 * The preset a bare library template renders with when its type has no saved
 * default: ProRes 4444, so what lands on the timeline keeps its alpha.
 */
export const PANEL_ALPHA_PRESET: PresetId = 'prores-4444';

/** The render a prepare starts: the very shape the window's own Prepare for drag sends. */
export interface PanelRenderRequest {
  templateId?: string;
  mediaId?: string;
  presetId: PresetId;
  options?: RenderOptions;
  params: Record<string, unknown>;
}

/**
 * What a POST /v1/prepare body asks for, once vouched for: a media item's own
 * file handed over as it is, a render with the item's own output settings, or
 * a refusal with the status that says why.
 */
export type PanelPrepareTarget =
  | { kind: 'file'; id: string }
  | { kind: 'render'; request: PanelRenderRequest }
  | { kind: 'refused'; status: number; message: string };

/** The remembered slice of the Output tab as render options; the preset travels separately. */
export function optionsFromTypeDefault(d: TypeOutputDefault): RenderOptions {
  return {
    ...(d.aspect ? { aspect: d.aspect } : {}),
    ...(d.width !== undefined && d.height !== undefined ? { width: d.width, height: d.height } : {}),
    ...(d.fps !== undefined ? { fps: d.fps } : {}),
    ...(d.background !== undefined ? { background: d.background } : {}),
    ...(d.matte ? { matte: true } : {}),
  };
}

/**
 * Decide what a prepare body means, with the item's own output settings:
 * a collection item (`uid`) renders with the settings its card carries; a
 * library template (`id`) renders with its type's saved output default, or
 * ProRes 4444 where none is saved, so alpha is kept; a library media item is
 * its own file already and is handed over as it is. Anything the library
 * cannot answer for — unknown, offline, a preset it does not know — is a
 * refusal that says so, never half an answer.
 */
export function panelPrepareTarget(
  body: unknown,
  index: LibraryIndex,
  collection: Collection,
  typeDefaults: Record<string, TypeOutputDefault>,
): PanelPrepareTarget {
  const refused = (status: number, message: string): PanelPrepareTarget => ({ kind: 'refused', status, message });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refused(400, 'The body must be JSON: {"id": …} or {"uid": …}.');
  const { id, uid } = body as { id?: unknown; uid?: unknown };
  if ((typeof id === 'string') === (typeof uid === 'string')) return refused(400, 'Name exactly one of "id" (a library item) or "uid" (a collection item).');

  const all: LibraryEntry[] = [...index.templates, ...index.media];
  const byId = new Map(all.map((e) => [e.id, e]));

  if (typeof uid === 'string') {
    const item = collection.items.find((i) => i.uid === uid);
    if (!item) return refused(404, 'That collection item is no longer in the collection.');
    if (!(item.presetId in OUTPUT_PRESETS)) return refused(409, `The item carries a preset this Pulp does not know ("${item.presetId}").`);
    const resolved = resolveCollection({ items: [item] }, index)[0]!;
    if (resolved.missing || !resolved.entry) return refused(404, `${item.name}: nothing in the library matches it any more.`);
    if (resolved.offline) return refused(409, `${item.name}: its folder is not reachable right now.`);
    return {
      kind: 'render',
      request: {
        ...(resolved.entry.kind === 'template' ? { templateId: resolved.entry.manifest.id } : { mediaId: resolved.entry.id }),
        presetId: item.presetId as PresetId,
        options: item.options,
        params: item.params,
      },
    };
  }

  const entry = byId.get(id as string);
  if (!entry) return refused(404, 'That item is not in the library.');
  if (entry.offline) return refused(409, 'That item’s folder is not reachable right now.');
  if (entry.kind === 'media') return { kind: 'file', id: entry.id };
  const byType = templateType(entry.manifest);
  const saved = byType !== undefined ? typeDefaults[byType] : undefined;
  return {
    kind: 'render',
    request: {
      templateId: entry.manifest.id,
      presetId: saved?.presetId ?? PANEL_ALPHA_PRESET,
      options: saved ? optionsFromTypeDefault(saved) : {},
      params: {},
    },
  };
}

/** What a prepare answers: the file already in hand, or the job to ask after. */
export type PanelPrepareAnswer =
  | { ready: true; file: string; name: string }
  | { ready: false; job: number }
  | { refused: string };

/** How a queued prepare is going, asked by job id. */
export type PanelJobAnswer =
  | { state: 'rendering'; fraction: number | null }
  | { state: 'done'; file: string; name: string }
  | { state: 'failed'; message: string };

// ---------------------------------------------------------------- back and forth (milestone 54's third item)

/** What a POST /v1/open body asks for, vouched for: a library item to show, or a collection card to edit. */
export type PanelOpenTarget =
  | { kind: 'item'; id: string }
  | { kind: 'collection'; uid: string }
  | { kind: 'refused'; status: number; message: string };

/**
 * Open in Pulp: the window shows the item on the stage with its controls, or
 * opens the collection card for editing in the inspector, and comes to the
 * front. Only what the library or the collection really holds; anything else
 * is a refusal that says so.
 */
export function panelOpenTarget(body: unknown, index: LibraryIndex, collection: Collection): PanelOpenTarget {
  const refused = (status: number, message: string): PanelOpenTarget => ({ kind: 'refused', status, message });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refused(400, 'The body must be JSON: {"id": …} or {"uid": …}.');
  const { id, uid } = body as { id?: unknown; uid?: unknown };
  if ((typeof id === 'string') === (typeof uid === 'string')) return refused(400, 'Name exactly one of "id" (a library item) or "uid" (a collection item).');
  if (typeof uid === 'string') {
    return collection.items.some((i) => i.uid === uid) ? { kind: 'collection', uid } : refused(404, 'That collection item is no longer in the collection.');
  }
  const entry = [...index.templates, ...index.media].find((e) => e.id === id);
  if (!entry) return refused(404, 'That item is not in the library.');
  if (entry.offline) return refused(409, 'That item’s folder is not reachable right now.');
  return { kind: 'item', id: entry.id };
}

/** One render queue job as the panel shows it: what it is, how far, and — once done and draggable — its file. */
export interface PanelQueueJob {
  id: number;
  label: string;
  presetId: string;
  status: RenderJobStatus;
  /** Frames done over frames in all; null while that is not known. */
  fraction: number | null;
  message?: string;
  /** The finished file, when Pulp would let its own card drag it. */
  file?: string;
  name?: string;
}

/**
 * The queue as the panel lists it: the tray's own jobs, newest first, each
 * with the file the tray's card would drag once it is done — which the main
 * process names, held to the files the app itself allows dragging.
 */
export function panelQueue(jobs: readonly RenderQueueJob[], fileFor: (job: RenderQueueJob) => string | undefined): PanelQueueJob[] {
  return [...jobs].reverse().map((job) => {
    const file = job.status === 'done' ? fileFor(job) : undefined;
    return {
      id: job.id,
      label: job.label ?? job.templateName,
      presetId: job.presetId,
      status: job.status,
      fraction: job.totalFrames > 0 ? Math.min(1, job.frame / job.totalFrames) : null,
      ...(job.message ? { message: job.message } : {}),
      ...(file ? { file, name: file.split(/[\\/]/).pop() ?? file } : {}),
    };
  });
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
  /** The saved output defaults per template type, for a bare template's own settings. */
  typeDefaults(): Promise<Record<string, TypeOutputDefault>>;
  /** A media item's own file to hand into the edit, or nothing the library can vouch for. */
  itemFile(id: string): Promise<{ file: string; name: string } | undefined>;
  /** Render into the drag cache, or find the same render already there; the window's own Prepare for drag. */
  prepare(request: PanelRenderRequest): Promise<PanelPrepareAnswer>;
  /** How a queued prepare is going; nothing for a job the queue does not hold. */
  job(id: number): PanelJobAnswer | undefined;
  /** Show an item, or open a collection card for editing, in Pulp's window, brought to the front. */
  open(target: { kind: 'item'; id: string } | { kind: 'collection'; uid: string }): Promise<{ ok: true } | { ok: false; message: string }>;
  /** The render queue as the tray shows it. */
  queue(): PanelQueueJob[];
  /** Cancel a queued or running job; false when the queue does not hold it. */
  cancel(id: number): boolean;
}

export interface BridgeRequest {
  method: string;
  /** Path and query, as node:http gives it: "/v1/library?q=…". */
  url: string;
  token: string | null;
  /** The request body, for POST; bounded by the listener before it gets here. */
  body?: string;
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
  'Access-Control-Allow-Methods': 'GET, POST',
  'Access-Control-Allow-Headers': `${BRIDGE_TOKEN_HEADER}, content-type`,
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
  if (req.method !== 'GET' && req.method !== 'POST') return { status: 405, headers: { Allow: 'GET, POST, OPTIONS', ...NO_STORE, ...CORS } };
  if (!tokenMatches(req.token, ctx.token)) return json(401, { error: 'unauthorized' });

  let url: URL;
  try {
    url = new URL(req.url, 'http://bridge');
  } catch {
    return notFound();
  }

  // Back and forth (the milestone's third item): open in Pulp, the queue, and a cancel.
  if (url.pathname === '/v1/open') {
    if (req.method !== 'POST') return { status: 405, headers: { Allow: 'POST, OPTIONS', ...NO_STORE, ...CORS } };
    let body: unknown;
    try {
      body = JSON.parse(req.body ?? '');
    } catch {
      body = null;
    }
    const target = panelOpenTarget(body, await ctx.library(), ctx.collection().collection);
    if (target.kind === 'refused') return json(target.status, { error: target.message });
    const opened = await ctx.open(target);
    return opened.ok ? json(200, { ok: true }) : json(409, { error: opened.message });
  }
  if (url.pathname === '/v1/queue' && req.method === 'GET') return json(200, { jobs: ctx.queue() });
  const cancelAsked = /^\/v1\/queue\/(\d{1,9})\/cancel$/.exec(url.pathname);
  if (cancelAsked) {
    if (req.method !== 'POST') return { status: 405, headers: { Allow: 'POST, OPTIONS', ...NO_STORE, ...CORS } };
    return ctx.cancel(Number(cancelAsked[1])) ? json(200, { ok: true }) : notFound();
  }

  // Preparing a file for the edit (the milestone's drop): POST asks, GET /<job> follows the render.
  if (url.pathname === '/v1/prepare') {
    if (req.method !== 'POST') return { status: 405, headers: { Allow: 'POST, OPTIONS', ...NO_STORE, ...CORS } };
    let body: unknown;
    try {
      body = JSON.parse(req.body ?? '');
    } catch {
      body = null;
    }
    const target = panelPrepareTarget(body, await ctx.library(), ctx.collection().collection, await ctx.typeDefaults());
    if (target.kind === 'refused') return json(target.status, { error: target.message });
    if (target.kind === 'file') {
      const file = await ctx.itemFile(target.id);
      return file ? json(200, { ready: true, ...file }) : notFound();
    }
    const answer = await ctx.prepare(target.request);
    if ('refused' in answer) return json(409, { error: answer.refused });
    return json(200, answer);
  }
  const jobAsked = /^\/v1\/prepare\/(\d{1,9})$/.exec(url.pathname);
  if (jobAsked && req.method === 'GET') {
    const answer = ctx.job(Number(jobAsked[1]));
    return answer ? json(200, answer) : notFound();
  }
  // Every route from here on answers GET alone.
  if (req.method !== 'GET') return { status: 405, headers: { Allow: 'GET, OPTIONS', ...NO_STORE, ...CORS } };

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
/** The most a request body may carry; a prepare names an item, nothing more. */
export const BRIDGE_MAX_BODY_BYTES = 64 * 1024;

export function startPanelServer(ctx: PanelBridgeContext, port = 0): Promise<PanelServer> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const token = req.headers[BRIDGE_TOKEN_HEADER];
    const chunks: Buffer[] = [];
    let read = 0;
    let overflowed = false;
    req.on('data', (chunk: Buffer) => {
      read += chunk.length;
      if (read > BRIDGE_MAX_BODY_BYTES) {
        overflowed = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflowed) {
        res.writeHead(413, { ...NO_STORE, ...CORS });
        res.end();
        return;
      }
      void handleBridgeRequest(
        { method: req.method ?? '', url: req.url ?? '/', token: typeof token === 'string' ? token : null, body: Buffer.concat(chunks).toString('utf8') },
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
