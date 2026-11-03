import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addItem, emptyCollection, itemFor, type Collection } from '../src/core/collection';
import type { LibraryIndex, MediaEntry, TemplateEntry } from '../src/core/library-types';
import {
  BRIDGE_MAX_ITEMS,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_TOKEN_HEADER,
  bridgeFileContents,
  handleBridgeRequest,
  newBridgeToken,
  panelCollection,
  panelItemFor,
  panelLibrary,
  parseBridgeFile,
  startPanelServer,
  tokenMatches,
  type PanelBridgeContext,
} from '../src/core/panel-bridge';
import { validManifest } from './fixtures';

function template(name: string, overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  const manifest = validManifest({ id: `test.${name}`, name });
  return { kind: 'template', key: name, id: `lib-${name}`, dir: `/lib/${name}`, root: '/lib', manifest, tags: [], warnings: [], ...overrides };
}
function media(name: string, overrides: Partial<MediaEntry> = {}): MediaEntry {
  return { kind: 'media', key: name, id: `lib-${name}`, path: `/lib/${name}.mov`, root: '/lib', name, mediaKind: 'video', ext: '.mov', size: 1, mtimeMs: 0, tags: [], ...overrides };
}
function index(entries: (TemplateEntry | MediaEntry)[]): LibraryIndex {
  return {
    roots: ['/lib'],
    templates: entries.filter((e): e is TemplateEntry => e.kind === 'template'),
    media: entries.filter((e): e is MediaEntry => e.kind === 'media'),
    problems: [],
    builtAt: '2026-11-03T00:00:00Z',
  };
}

const strap = template('strap', { favorite: true, thumbnail: 'pulp-thumb://lib-strap/' });
const wipe = template('wipe');
const clip = media('clip', { meta: { duration: 12 } });
const library = index([strap, wipe, clip]);

describe('the discovery file', () => {
  it('round-trips through its own parser', () => {
    const token = newBridgeToken();
    const parsed = parseBridgeFile(bridgeFileContents({ version: '0.1.0', port: 45123, token, startedAt: '2026-11-03T10:00:00Z' }));
    expect(parsed).toEqual({ app: 'pulp', bridge: BRIDGE_PROTOCOL_VERSION, version: '0.1.0', port: 45123, token, startedAt: '2026-11-03T10:00:00Z' });
  });

  it('vouches for every field or answers nothing', () => {
    expect(parseBridgeFile('not json')).toBeNull();
    expect(parseBridgeFile('{}')).toBeNull();
    const good = JSON.parse(bridgeFileContents({ version: '1', port: 1024, token: newBridgeToken(), startedAt: 'now' })) as Record<string, unknown>;
    expect(parseBridgeFile(JSON.stringify({ ...good, app: 'other' }))).toBeNull();
    expect(parseBridgeFile(JSON.stringify({ ...good, token: 'short' }))).toBeNull();
    expect(parseBridgeFile(JSON.stringify({ ...good, port: 0 }))).toBeNull();
    expect(parseBridgeFile(JSON.stringify({ ...good, port: 70000 }))).toBeNull();
  });

  it('mints a fresh 256-bit token each time', () => {
    const a = newBridgeToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newBridgeToken()).not.toBe(a);
    expect(tokenMatches(a, a)).toBe(true);
    expect(tokenMatches(newBridgeToken(), a)).toBe(false);
    expect(tokenMatches(null, a)).toBe(false);
    expect(tokenMatches('', a)).toBe(false);
  });
});

describe('what the panel is told', () => {
  it('describes an item by id and what a card says, never a path', () => {
    expect(panelItemFor(strap)).toEqual({ id: 'lib-strap', kind: 'template', name: 'strap', type: 'title', duration: 2, favorite: true, thumb: true });
    expect(panelItemFor(clip)).toEqual({ id: 'lib-clip', kind: 'video', name: 'clip', duration: 12 });
    expect(JSON.stringify(panelLibrary(library, ''))).not.toContain('/lib');
  });

  it('lists everything by name, or answers the very search the app runs', () => {
    const all = panelLibrary(library, '');
    expect(all.items.map((i) => i.name)).toEqual(['clip', 'strap', 'wipe']);
    expect(all.total).toBe(3);
    const matched = panelLibrary(library, 'wipe');
    expect(matched.items.map((i) => i.name)).toEqual(['wipe']);
    expect(matched.total).toBe(1);
  });

  it('cuts a long answer and says how many matched', () => {
    const cut = panelLibrary(library, '', 2);
    expect(cut.items).toHaveLength(2);
    expect(cut.total).toBe(3);
  });

  it('leaves offline items out: the panel hands over what is there', () => {
    const withOffline = index([strap, media('gone', { offline: true })]);
    expect(panelLibrary(withOffline, '').items.map((i) => i.name)).toEqual(['strap']);
  });

  it('lists the collection with what has gone flagged, not dropped', () => {
    const gathered: Collection = addItem(addItem(emptyCollection, itemFor(strap, 'prores-4444')), itemFor(clip, 'h264-mp4'));
    const told = panelCollection('show open', gathered, index([strap]));
    expect(told.name).toBe('show open');
    expect(told.items.map((i) => ({ name: i.name, missing: i.missing }))).toEqual([
      { name: 'strap', missing: false },
      { name: 'clip', missing: true },
    ]);
    expect(JSON.stringify(told)).not.toContain('/lib');
  });
});

describe('answering a request', () => {
  const thumbDir = { path: '' };
  beforeAll(async () => {
    thumbDir.path = await mkdtemp(join(tmpdir(), 'pulp-panel-test-'));
    await writeFile(join(thumbDir.path, 'abc123.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
  afterAll(() => rm(thumbDir.path, { recursive: true, force: true }));

  const token = newBridgeToken();
  const ctx: PanelBridgeContext = {
    token,
    version: '0.1.0',
    library: () => Promise.resolve(library),
    collection: () => ({ name: '', collection: addItem(emptyCollection, itemFor(strap, 'prores-4444')) }),
    thumbnail: (id) => Promise.resolve(id === 'abc123' ? join(thumbDir.path, 'abc123.png') : undefined),
  };
  const get = (url: string, with_: string | null = token) => handleBridgeRequest({ method: 'GET', url, token: with_ }, ctx);

  it('answers nothing without the token, on every route', async () => {
    for (const url of ['/v1/hello', '/v1/library', '/v1/collection', '/v1/thumb/abc123']) {
      expect((await get(url, null)).status).toBe(401);
      expect((await get(url, 'wrong')).status).toBe(401);
    }
    const refused = await get('/v1/library', null);
    expect(refused.body).not.toContain('strap');
  });

  it('says what it is on /v1/hello', async () => {
    const answer = await get('/v1/hello');
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body as string)).toEqual({ app: 'pulp', bridge: BRIDGE_PROTOCOL_VERSION, version: '0.1.0' });
  });

  it('answers the library, searched and bounded', async () => {
    const all = JSON.parse((await get('/v1/library')).body as string) as { total: number; items: { name: string }[] };
    expect(all.total).toBe(3);
    const searched = JSON.parse((await get('/v1/library?q=wipe')).body as string) as { items: { name: string }[] };
    expect(searched.items.map((i) => i.name)).toEqual(['wipe']);
    const bounded = JSON.parse((await get('/v1/library?limit=1')).body as string) as { total: number; items: unknown[] };
    expect(bounded.items).toHaveLength(1);
    expect(bounded.total).toBe(3);
    const silly = JSON.parse((await get(`/v1/library?limit=${BRIDGE_MAX_ITEMS * 10}`)).body as string) as { items: unknown[] };
    expect(silly.items.length).toBeLessThanOrEqual(BRIDGE_MAX_ITEMS);
  });

  it('answers the collection as the window last reported it', async () => {
    const told = JSON.parse((await get('/v1/collection')).body as string) as { items: { name: string }[] };
    expect(told.items.map((i) => i.name)).toEqual(['strap']);
  });

  it('serves a thumbnail by id and a bare 404 for everything else', async () => {
    const ok = await get('/v1/thumb/abc123');
    expect(ok.status).toBe(200);
    expect(ok.headers['Content-Type']).toBe('image/png');
    expect((await get('/v1/thumb/ffffff')).status).toBe(404);
    expect((await get('/v1/thumb/..%2Fsettings')).status).toBe(404);
    expect((await get('/v1/thumb/lib-strap')).status).toBe(404);
  });

  it('refuses what it does not speak', async () => {
    expect((await get('/v1/nothing')).status).toBe(404);
    expect((await get('/settings.json')).status).toBe(404);
    expect((await handleBridgeRequest({ method: 'POST', url: '/v1/library', token }, ctx)).status).toBe(405);
    expect((await handleBridgeRequest({ method: 'OPTIONS', url: '/v1/library', token: null }, ctx)).status).toBe(204);
  });
});

describe('the listener', () => {
  it('answers over real HTTP on 127.0.0.1, token required', async () => {
    const token = newBridgeToken();
    const ctx: PanelBridgeContext = {
      token,
      version: '0.1.0',
      library: () => Promise.resolve(library),
      collection: () => ({ name: '', collection: emptyCollection }),
      thumbnail: () => Promise.resolve(undefined),
    };
    const server = await startPanelServer(ctx);
    try {
      expect(server.port).toBeGreaterThan(0);
      const refused = await fetch(`http://127.0.0.1:${server.port}/v1/library`);
      expect(refused.status).toBe(401);
      const answered = await fetch(`http://127.0.0.1:${server.port}/v1/library`, { headers: { [BRIDGE_TOKEN_HEADER]: token } });
      expect(answered.status).toBe(200);
      const body = (await answered.json()) as { total: number };
      expect(body.total).toBe(3);
    } finally {
      await server.close();
    }
    // Closed is closed: the port answers nothing afterwards.
    await expect(fetch(`http://127.0.0.1:${server.port}/v1/hello`, { headers: { [BRIDGE_TOKEN_HEADER]: token } })).rejects.toThrow();
  });
});
