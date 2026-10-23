import { describe, expect, it } from 'vitest';
import {
  browseScopes,
  createResultsSelector,
  deriveResults,
  effectiveQuery,
  sameScope,
  setSort,
  toggleFilter,
  hasFinishedJobs,
  initialAppState,
  RESULT_CAP,
  setIndex,
  setJobs,
  setQuery,
  setScope,
  setSelection,
  traySummary,
} from '../src/core/app-state';
import type { LibraryIndex, MediaEntry, TemplateEntry } from '../src/core/library-types';
import type { TemplateManifest } from '../src/core/manifest';
import type { RenderJobStatus, RenderQueueJob } from '../src/core/render-queue';
import { rawManifest } from './fixtures';

function template(key: string, overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  const manifest = rawManifest({ id: `test.${key}`, name: key }) as unknown as TemplateManifest;
  return { kind: 'template', key, id: `id-${key}`, dir: `/lib/${key}`, root: '/lib', manifest, tags: [...manifest.tags], warnings: [], ...overrides };
}

function media(key: string, overrides: Partial<MediaEntry> = {}): MediaEntry {
  return { kind: 'media', key, id: `id-${key}`, path: `/lib/${key}.mov`, root: '/lib', name: key, mediaKind: 'video', ext: '.mov', size: 1024, mtimeMs: 0, tags: [], ...overrides };
}

function index(templates: TemplateEntry[], mediaEntries: MediaEntry[] = []): LibraryIndex {
  return { roots: ['/lib'], templates, media: mediaEntries, problems: [], builtAt: new Date().toISOString() };
}

describe('app-state actions', () => {
  it('returns a new state on change and the same object when nothing changed', () => {
    const s = initialAppState;
    const changed = setQuery(s, 'news');
    expect(changed).not.toBe(s);
    expect(changed.query).toBe('news');
    expect(s.query).toBe('');
    expect(setQuery(changed, 'news')).toBe(changed);
    expect(setIndex(s, null)).toBe(s);
    expect(setScope(s, null)).toBe(s);
    expect(setSelection(s, null)).toBe(s);
    expect(setJobs(s, s.jobs)).toBe(s);
  });
});

describe('effectiveQuery', () => {
  it('joins the scope filter, pressed chips and the typed query', () => {
    let s = setQuery(initialAppState, 'lower');
    expect(effectiveQuery(s)).toBe('lower');
    s = setScope(s, { label: 'Favorites', filter: 'favorite:yes' });
    expect(effectiveQuery(s)).toBe('favorite:yes lower');
    expect(effectiveQuery(setQuery(s, ''))).toBe('favorite:yes');
    s = toggleFilter(toggleFilter(s, 'templates'), 'alpha');
    expect(effectiveQuery(s)).toBe('favorite:yes type:template alpha:yes lower');
    expect(effectiveQuery(toggleFilter(s, 'templates'))).toBe('favorite:yes alpha:yes lower');
  });

  it('a root scope adds no query text; it is matched structurally', () => {
    const s = setScope(setQuery(initialAppState, 'clip'), { label: 'media', root: '/lib/media' });
    expect(effectiveQuery(s)).toBe('clip');
  });
});

describe('sorting', () => {
  const entries = () => [
    media('bbb', { meta: { duration: 9 } as MediaEntry['meta'], lastUsed: '2026-10-20T00:00:00Z' }),
    media('aaa', { meta: { duration: 3 } as MediaEntry['meta'] }),
    media('ccc', { lastUsed: '2026-10-23T00:00:00Z' }),
  ];

  it('sorts by name, recently used and duration; missing values go last', () => {
    const s = setIndex(initialAppState, index([], entries()));
    const keys = (sort: Parameters<typeof setSort>[1]) => deriveResults(setSort(s, sort)).entries.map((e) => e.key);
    expect(keys('name')).toEqual(['aaa', 'bbb', 'ccc']);
    expect(keys('recent')).toEqual(['ccc', 'bbb', 'aaa']);
    expect(keys('duration')).toEqual(['aaa', 'bbb', 'ccc']);
  });
});

describe('scopes', () => {
  it('browseScopes lists favorites, recent and one node per folder', () => {
    expect(browseScopes(null).map((n) => n.label)).toEqual(['Favorites', 'Recently used']);
    const idx = { ...index([], []), roots: ['/lib/News Pack/', 'C:\\Media\\b-roll'] };
    const nodes = browseScopes(idx);
    expect(nodes.map((n) => n.label)).toEqual(['Favorites', 'Recently used', 'News Pack', 'b-roll']);
    expect(nodes[2]?.root).toBe('/lib/News Pack/');
  });

  it('a root scope narrows results to that folder', () => {
    const inside = media('clip a', { root: '/lib/a' });
    const outside = media('clip b', { root: '/lib/b' });
    const s = setIndex(initialAppState, { ...index([], [inside, outside]), roots: ['/lib/a', '/lib/b'] });
    const scoped = setScope(s, { label: 'a', root: '/lib/a' });
    expect(deriveResults(scoped).entries.map((e) => e.key)).toEqual(['clip a']);
    expect(deriveResults(scoped).canExportPack).toBe(false);
  });

  it('sameScope compares by content', () => {
    expect(sameScope({ label: 'a', root: '/x' }, { label: 'a', root: '/x' })).toBe(true);
    expect(sameScope({ label: 'a', root: '/x' }, { label: 'a', root: '/y' })).toBe(false);
    expect(sameScope(null, { label: 'a' })).toBe(false);
  });
});

describe('deriveResults', () => {
  it('is empty without an index', () => {
    expect(deriveResults(initialAppState)).toEqual({ entries: [], total: 0, capped: false, canExportPack: false });
  });

  it('searches with the scope applied', () => {
    const fav = media('kept footage', { favorite: true });
    let s = setIndex(initialAppState, index([template('straps')], [fav, media('other footage')]));
    expect(deriveResults(s).entries).toHaveLength(3);
    s = setScope(s, { label: 'Favorites', filter: 'favorite:yes' });
    expect(deriveResults(s).entries.map((e) => e.key)).toEqual(['kept footage']);
  });

  it('caps the entries and reports the full total', () => {
    const many = Array.from({ length: RESULT_CAP + 20 }, (_, i) => media(`clip ${String(i).padStart(4, '0')}`));
    const view = deriveResults(setIndex(initialAppState, index([], many)));
    expect(view.entries).toHaveLength(RESULT_CAP);
    expect(view.total).toBe(RESULT_CAP + 20);
    expect(view.capped).toBe(true);
  });

  it('allows a pack export only when a listed template is online', () => {
    const offline = template('gone', { offline: true });
    const s = setIndex(initialAppState, index([offline], [media('clip')]));
    expect(deriveResults(s).canExportPack).toBe(false);
    expect(deriveResults(setIndex(s, index([offline, template('here')]))).canExportPack).toBe(true);
  });
});

describe('createResultsSelector', () => {
  const job: RenderQueueJob = { id: 1, templateId: 't', templateName: 'T', presetId: 'prores-4444', outputPath: '/x.mov', totalFrames: 60, status: 'running', frame: 10, warnings: [] };

  it('does not recompute the results for a jobs or selection update', () => {
    const select = createResultsSelector();
    const s = setIndex(initialAppState, index([template('straps')], [media('clip')]));
    const first = select(s);
    expect(first.entries).toHaveLength(2);
    expect(select(setJobs(s, { jobs: [job] }))).toBe(first);
    expect(select(setSelection(s, 'clip'))).toBe(first);
  });

  it('recomputes when the index, query, scope, filters or sort changes', () => {
    const select = createResultsSelector();
    const s = setIndex(initialAppState, index([template('straps')], [media('clip')]));
    const first = select(s);
    const byQuery = select(setQuery(s, 'clip'));
    expect(byQuery).not.toBe(first);
    expect(byQuery.entries.map((e) => e.key)).toEqual(['clip']);
    expect(select(setScope(s, { label: 'Favorites', filter: 'favorite:yes' }))).not.toBe(first);
    expect(select(toggleFilter(s, 'templates')).entries.map((e) => e.key)).toEqual(['straps']);
    expect(select(setSort(s, 'name'))).not.toBe(first);
    expect(select(setIndex(s, index([], [media('other')]))).entries.map((e) => e.key)).toEqual(['other']);
  });
});

describe('hasFinishedJobs', () => {
  it('reflects the queue snapshot', () => {
    const job = (status: RenderJobStatus): RenderQueueJob => ({ id: 1, templateId: 't', templateName: 'T', presetId: 'prores-4444', outputPath: '/x.mov', totalFrames: 60, status, frame: 0, warnings: [] });
    expect(hasFinishedJobs(initialAppState)).toBe(false);
    expect(hasFinishedJobs(setJobs(initialAppState, { jobs: [job('running')] }))).toBe(false);
    expect(hasFinishedJobs(setJobs(initialAppState, { jobs: [job('done')] }))).toBe(true);
  });
});

describe('traySummary', () => {
  it('counts jobs by status in a fixed order', () => {
    const job = (id: number, status: RenderJobStatus): RenderQueueJob => ({ id, templateId: 't', templateName: 'T', presetId: 'prores-4444', outputPath: `/x${id}.mov`, totalFrames: 60, status, frame: 0, warnings: [] });
    expect(traySummary(initialAppState)).toBe('No renders yet.');
    expect(traySummary(setJobs(initialAppState, { jobs: [job(1, 'done')] }))).toBe('1 render · 1 done');
    expect(traySummary(setJobs(initialAppState, { jobs: [job(1, 'done'), job(2, 'running'), job(3, 'done'), job(4, 'queued')] })))
      .toBe('4 renders · 1 running · 1 queued · 2 done');
  });
});
