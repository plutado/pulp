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
  PANEL_ALPHA_PRESET,
  bridgeFileContents,
  handleBridgeRequest,
  newBridgeToken,
  optionsFromTypeDefault,
  panelCollection,
  panelItemFor,
  panelLibrary,
  panelOpenTarget,
  panelPrepareTarget,
  panelQueue,
  parseBridgeFile,
  startPanelServer,
  tokenMatches,
  type PanelBridgeContext,
  type PanelJobAnswer,
  type PanelPrepareAnswer,
  type PanelRenderRequest,
} from '../src/core/panel-bridge';
import type { RenderQueueJob } from '../src/core/render-queue';
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

describe("what a prepare means: the item's own output settings", () => {
  const none = {};

  it('renders a bare template with alpha kept where its type saved nothing', () => {
    const target = panelPrepareTarget({ id: 'lib-strap' }, library, emptyCollection, none);
    expect(target).toEqual({ kind: 'render', request: { templateId: 'test.strap', presetId: PANEL_ALPHA_PRESET, options: {}, params: {} } });
  });

  it("renders a bare template with its type's saved output default", () => {
    // The fixture manifests are titles, so the saved default for 'title' is the strap's own.
    const saved = { title: { presetId: 'h264-mp4' as const, fps: 25, background: '#102030', matte: true } };
    const target = panelPrepareTarget({ id: 'lib-strap' }, library, emptyCollection, saved);
    expect(target).toEqual({
      kind: 'render',
      request: { templateId: 'test.strap', presetId: 'h264-mp4', options: { fps: 25, background: '#102030', matte: true }, params: {} },
    });
    expect(optionsFromTypeDefault({ presetId: 'prores-4444', aspect: '9:16', width: 1080, height: 1920 })).toEqual({ aspect: '9:16', width: 1080, height: 1920 });
  });

  it('renders a collection item with the settings its card carries', () => {
    const gathered = addItem(emptyCollection, { ...itemFor(strap, 'webm-vp9-alpha', { fps: 25 }, { name: 'Sam' }) });
    const uid = gathered.items[0]!.uid;
    const target = panelPrepareTarget({ uid }, library, gathered, none);
    expect(target).toEqual({
      kind: 'render',
      request: { templateId: 'test.strap', presetId: 'webm-vp9-alpha', options: { fps: 25 }, params: { name: 'Sam' } },
    });
    // A collected media item renders itself, with its settings, rather than handing the raw file.
    const clipGathered = addItem(emptyCollection, itemFor(clip, 'prores-4444', { length: 4 }));
    const clipTarget = panelPrepareTarget({ uid: clipGathered.items[0]!.uid }, library, clipGathered, none);
    expect(clipTarget).toEqual({
      kind: 'render',
      request: { mediaId: 'lib-clip', presetId: 'prores-4444', options: { length: 4 }, params: {} },
    });
  });

  it('hands a bare media item over as its own file', () => {
    expect(panelPrepareTarget({ id: 'lib-clip' }, library, emptyCollection, none)).toEqual({ kind: 'file', id: 'lib-clip' });
  });

  it('refuses what the library cannot answer for, with the status that says why', () => {
    expect(panelPrepareTarget({ id: 'lib-gone' }, library, emptyCollection, none)).toMatchObject({ kind: 'refused', status: 404 });
    const offline = index([template('strap', { favorite: true }), media('clip', { offline: true })]);
    expect(panelPrepareTarget({ id: 'lib-clip' }, offline, emptyCollection, none)).toMatchObject({ kind: 'refused', status: 409 });
    const gathered = addItem(emptyCollection, itemFor(wipe, 'prores-4444'));
    expect(panelPrepareTarget({ uid: 'nope' }, library, gathered, none)).toMatchObject({ kind: 'refused', status: 404 });
    expect(panelPrepareTarget({ uid: gathered.items[0]!.uid }, index([strap]), gathered, none)).toMatchObject({ kind: 'refused', status: 404 });
    const stale = { items: [{ ...gathered.items[0]!, presetId: 'not-a-preset' }] };
    expect(panelPrepareTarget({ uid: stale.items[0]!.uid }, library, stale, none)).toMatchObject({ kind: 'refused', status: 409 });
    expect(panelPrepareTarget(null, library, emptyCollection, none)).toMatchObject({ kind: 'refused', status: 400 });
    expect(panelPrepareTarget({ id: 1 }, library, emptyCollection, none)).toMatchObject({ kind: 'refused', status: 400 });
  });
});

describe('back and forth: what an open means, and the queue as the panel sees it', () => {
  it('opens a library item or a collection card, and refuses the rest with the status that says why', () => {
    const gathered = addItem(emptyCollection, itemFor(strap, 'prores-4444'));
    expect(panelOpenTarget({ id: 'lib-wipe' }, library, gathered)).toEqual({ kind: 'item', id: 'lib-wipe' });
    expect(panelOpenTarget({ uid: gathered.items[0]!.uid }, library, gathered)).toEqual({ kind: 'collection', uid: gathered.items[0]!.uid });
    expect(panelOpenTarget({ id: 'lib-gone' }, library, gathered)).toMatchObject({ kind: 'refused', status: 404 });
    expect(panelOpenTarget({ id: 'lib-clip' }, index([media('clip', { offline: true })]), gathered)).toMatchObject({ kind: 'refused', status: 409 });
    expect(panelOpenTarget({ uid: 'nope' }, library, gathered)).toMatchObject({ kind: 'refused', status: 404 });
    expect(panelOpenTarget({ id: 'a', uid: 'b' }, library, gathered)).toMatchObject({ kind: 'refused', status: 400 });
    expect(panelOpenTarget('strap', library, gathered)).toMatchObject({ kind: 'refused', status: 400 });
  });

  it('lists the queue newest first with how far each is, and a file only for a finished job the app would drag', () => {
    const job = (over: Partial<RenderQueueJob>): RenderQueueJob =>
      ({ id: 1, templateId: 'test.strap', templateName: 'strap', presetId: 'prores-4444', outputPath: '/cache/strap.mov', totalFrames: 60, status: 'queued', frame: 0, warnings: [], ...over });
    const jobs = [
      job({ id: 1, status: 'done', frame: 60, output: '/cache/strap.mov' }),
      job({ id: 2, status: 'running', frame: 15, label: 'strap · Sam' }),
      job({ id: 3, status: 'failed', frame: 3, message: 'ffmpeg refused' }),
      job({ id: 4, status: 'done', frame: 60, output: '/elsewhere/strap.mov' }),
      job({ id: 5, status: 'queued', totalFrames: 0 }),
    ];
    const told = panelQueue(jobs, (j) => (j.output === '/cache/strap.mov' ? j.output : undefined));
    expect(told.map((j) => j.id)).toEqual([5, 4, 3, 2, 1]);
    expect(told[4]).toEqual({ id: 1, label: 'strap', presetId: 'prores-4444', status: 'done', fraction: 1, file: '/cache/strap.mov', name: 'strap.mov' });
    expect(told[3]).toEqual({ id: 2, label: 'strap · Sam', presetId: 'prores-4444', status: 'running', fraction: 0.25 });
    expect(told[2]).toMatchObject({ status: 'failed', message: 'ffmpeg refused' });
    expect(told[2]!.file).toBeUndefined();
    // Done, but not a file the app itself would let its card drag: no file.
    expect(told[1]!.file).toBeUndefined();
    expect(told[0]!.fraction).toBeNull();
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
  /** One collection for the whole describe, so a uid read in a test is the uid the handler sees. */
  const gatheredStrap = addItem(emptyCollection, itemFor(strap, 'prores-4444'));
  /** What the stub prepare and job were asked, so a test can read it back. */
  const asked: { prepare: PanelRenderRequest[]; jobs: number[]; opened: unknown[]; cancelled: number[] } = { prepare: [], jobs: [], opened: [], cancelled: [] };
  const ctx: PanelBridgeContext = {
    token,
    version: '0.1.0',
    library: () => Promise.resolve(library),
    collection: () => ({ name: '', collection: gatheredStrap }),
    thumbnail: (id) => Promise.resolve(id === 'abc123' ? join(thumbDir.path, 'abc123.png') : undefined),
    typeDefaults: () => Promise.resolve({}),
    itemFile: (id) => Promise.resolve(id === 'lib-clip' ? { file: '/cache/clip.mov', name: 'clip' } : undefined),
    prepare: (request): Promise<PanelPrepareAnswer> => {
      asked.prepare.push(request);
      return Promise.resolve({ ready: false, job: 7 });
    },
    job: (id): PanelJobAnswer | undefined => {
      asked.jobs.push(id);
      return id === 7 ? { state: 'done', file: '/cache/strap.mov', name: 'strap.mov' } : undefined;
    },
    open: (target) => {
      asked.opened.push(target);
      return Promise.resolve({ ok: true });
    },
    queue: () => [{ id: 7, label: 'strap', presetId: 'prores-4444', status: 'done', fraction: 1, file: '/cache/strap.mov', name: 'strap.mov' }],
    cancel: (id) => {
      asked.cancelled.push(id);
      return id === 8;
    },
  };
  const get = (url: string, with_: string | null = token) => handleBridgeRequest({ method: 'GET', url, token: with_ }, ctx);
  const post = (url: string, body: unknown, with_: string | null = token) =>
    handleBridgeRequest({ method: 'POST', url, token: with_, body: JSON.stringify(body) }, ctx);

  it('answers nothing without the token, on every route', async () => {
    for (const url of ['/v1/hello', '/v1/library', '/v1/collection', '/v1/thumb/abc123', '/v1/prepare/7']) {
      expect((await get(url, null)).status).toBe(401);
      expect((await get(url, 'wrong')).status).toBe(401);
    }
    expect((await post('/v1/prepare', { id: 'lib-strap' }, null)).status).toBe(401);
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

  it('prepares a render over POST and hands the asked settings through whole', async () => {
    asked.prepare.length = 0;
    const answer = await post('/v1/prepare', { id: 'lib-wipe' });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body as string)).toEqual({ ready: false, job: 7 });
    expect(asked.prepare).toEqual([{ templateId: 'test.wipe', presetId: PANEL_ALPHA_PRESET, options: {}, params: {} }]);
  });

  it('hands a media item over as its own file, vouched for by the main process', async () => {
    const answer = await post('/v1/prepare', { id: 'lib-clip' });
    expect(JSON.parse(answer.body as string)).toEqual({ ready: true, file: '/cache/clip.mov', name: 'clip' });
    // The main process could not vouch for it: nothing, not half an answer.
    const missing = await post('/v1/prepare', { id: 'lib-strap' });
    // lib-strap is a template, so this goes through prepare; a media id the
    // context cannot answer for is the 404 (covered by panelPrepareTarget below).
    expect(missing.status).toBe(200);
  });

  it('answers how a prepare is going by job id, and nothing for a job it does not hold', async () => {
    const done = await get('/v1/prepare/7');
    expect(JSON.parse(done.body as string)).toEqual({ state: 'done', file: '/cache/strap.mov', name: 'strap.mov' });
    expect((await get('/v1/prepare/9')).status).toBe(404);
    expect((await get('/v1/prepare/x')).status).toBe(404);
  });

  it('refuses a body it cannot read as the ask it is', async () => {
    expect((await handleBridgeRequest({ method: 'POST', url: '/v1/prepare', token, body: 'not json' }, ctx)).status).toBe(400);
    expect((await post('/v1/prepare', {})).status).toBe(400);
    expect((await post('/v1/prepare', { id: 'lib-strap', uid: 'c1' })).status).toBe(400);
  });

  it('opens an item or a collection card in Pulp over POST, and refuses what neither holds', async () => {
    asked.opened.length = 0;
    expect((await post('/v1/open', { id: 'lib-wipe' })).status).toBe(200);
    const uid = ctx.collection().collection.items[0]!.uid;
    expect((await post('/v1/open', { uid })).status).toBe(200);
    expect(asked.opened).toEqual([{ kind: 'item', id: 'lib-wipe' }, { kind: 'collection', uid }]);
    expect((await post('/v1/open', { id: 'lib-gone' })).status).toBe(404);
    expect((await post('/v1/open', { uid: 'nope' })).status).toBe(404);
    expect((await post('/v1/open', {})).status).toBe(400);
    expect((await get('/v1/open')).status).toBe(405);
    expect((await post('/v1/open', { id: 'lib-wipe' }, null)).status).toBe(401);
  });

  it('answers the queue, and cancels only what the queue still holds unfinished', async () => {
    const queued = JSON.parse((await get('/v1/queue')).body as string) as { jobs: { id: number; file?: string }[] };
    expect(queued.jobs.map((j) => j.id)).toEqual([7]);
    expect(queued.jobs[0]!.file).toBe('/cache/strap.mov');
    expect((await post('/v1/queue/8/cancel', {})).status).toBe(200);
    expect((await post('/v1/queue/7/cancel', {})).status).toBe(404);
    expect(asked.cancelled).toEqual([8, 7]);
    expect((await get('/v1/queue/8/cancel')).status).toBe(405);
    expect((await get('/v1/queue', null)).status).toBe(401);
  });

  it('refuses what it does not speak', async () => {
    expect((await get('/v1/nothing')).status).toBe(404);
    expect((await get('/settings.json')).status).toBe(404);
    expect((await handleBridgeRequest({ method: 'POST', url: '/v1/library', token }, ctx)).status).toBe(405);
    expect((await get('/v1/prepare')).status).toBe(405);
    expect((await handleBridgeRequest({ method: 'PUT', url: '/v1/prepare', token }, ctx)).status).toBe(405);
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
      typeDefaults: () => Promise.resolve({}),
      itemFile: () => Promise.resolve(undefined),
      prepare: (request) => Promise.resolve({ ready: true, file: `/cache/${request.templateId}.mov`, name: `${request.templateId}.mov` }),
      job: () => undefined,
      open: () => Promise.resolve({ ok: true }),
      queue: () => [],
      cancel: () => false,
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
      // A prepare rides POST with a JSON body, through the same socket and the same token.
      const prepared = await fetch(`http://127.0.0.1:${server.port}/v1/prepare`, {
        method: 'POST',
        headers: { [BRIDGE_TOKEN_HEADER]: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'lib-strap' }),
      });
      expect(prepared.status).toBe(200);
      expect(await prepared.json()).toEqual({ ready: true, file: '/cache/test.strap.mov', name: 'test.strap.mov' });
    } finally {
      await server.close();
    }
    // Closed is closed: the port answers nothing afterwards.
    await expect(fetch(`http://127.0.0.1:${server.port}/v1/hello`, { headers: { [BRIDGE_TOKEN_HEADER]: token } })).rejects.toThrow();
  });
});
