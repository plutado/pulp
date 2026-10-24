import { describe, expect, it } from 'vitest';
import {
  addItem,
  applyToAll,
  collectionSummary,
  COLLECTION_FORMAT_VERSION,
  emptyCollection,
  itemFor,
  moveItem,
  parseCollection,
  removeItem,
  renderableItems,
  resolveCollection,
  serializeCollection,
  updateItem,
  type Collection,
} from '../src/core/collection';
import type { LibraryIndex, MediaEntry, TemplateEntry } from '../src/core/library-types';
import { validManifest } from './fixtures';

function template(name: string, id = `test.${name}`): TemplateEntry {
  const manifest = validManifest({ id, name });
  return { kind: 'template', key: name, id: `lib-${name}`, dir: `/lib/${name}`, root: '/lib', manifest, tags: [], warnings: [] };
}
function media(name: string): MediaEntry {
  return { kind: 'media', key: name, id: `lib-${name}`, path: `/lib/${name}.mov`, root: '/lib', name, mediaKind: 'video', ext: '.mov', size: 1, mtimeMs: 0, tags: [] };
}
function index(entries: (TemplateEntry | MediaEntry)[]): LibraryIndex {
  return {
    roots: ['/lib'],
    templates: entries.filter((e): e is TemplateEntry => e.kind === 'template'),
    media: entries.filter((e): e is MediaEntry => e.kind === 'media'),
    problems: [],
    builtAt: '2026-10-24T00:00:00Z',
  };
}

const strap = template('strap');
const wipe = template('wipe');
const clip = media('clip');

function gathered(...entries: (TemplateEntry | MediaEntry)[]): Collection {
  return entries.reduce((c, e) => addItem(c, itemFor(e, 'prores-4444')), emptyCollection);
}

describe('gathering', () => {
  it('records what travels and what does not', () => {
    const item = itemFor(strap, 'png-sequence', { fps: 25 }, { name: 'Alex' });
    // The library id is this machine's; the manifest id is the author's and goes with the file.
    expect(item).toMatchObject({ id: 'lib-strap', templateId: 'test.strap', kind: 'template', name: 'strap', presetId: 'png-sequence' });
    expect(itemFor(clip, 'prores-4444').templateId).toBeUndefined();
  });

  it('lets the same item in twice, with its own settings each time', () => {
    const c = addItem(gathered(strap), itemFor(strap, 'h264-mp4'));
    expect(c.items).toHaveLength(2);
    expect(c.items[0]!.uid).not.toBe(c.items[1]!.uid);
    const changed = updateItem(c, c.items[1]!.uid, { options: { fps: 30 } });
    expect(changed.items[0]!.options).toEqual({});
    expect(changed.items[1]!.options).toEqual({ fps: 30 });
  });

  it('removes, reorders and leaves the collection alone when nothing moves', () => {
    const c = gathered(strap, wipe, clip);
    const uids = c.items.map((i) => i.uid);
    expect(moveItem(c, uids[2]!, -1).items.map((i) => i.name)).toEqual(['strap', 'clip', 'wipe']);
    expect(moveItem(c, uids[0]!, 1).items.map((i) => i.name)).toEqual(['wipe', 'strap', 'clip']);
    // At the ends, and for an item that is not there, nothing happens — the same object comes back.
    expect(moveItem(c, uids[0]!, -1)).toBe(c);
    expect(moveItem(c, uids[2]!, 1)).toBe(c);
    expect(moveItem(c, 'nope', 1)).toBe(c);
    expect(removeItem(c, uids[1]!).items.map((i) => i.name)).toEqual(['strap', 'clip']);
    expect(removeItem(c, 'nope')).toBe(c);
  });

  it('applies one item\'s output settings to all of them, leaving parameters alone', () => {
    let c = gathered(strap, wipe);
    c = updateItem(c, c.items[0]!.uid, { params: { name: 'Alex' } });
    const applied = applyToAll(c, { presetId: 'h264-mp4', options: { fps: 25, inFrame: 10 } });
    expect(applied.items.map((i) => i.presetId)).toEqual(['h264-mp4', 'h264-mp4']);
    expect(applied.items.map((i) => i.options)).toEqual([{ fps: 25, inFrame: 10 }, { fps: 25, inFrame: 10 }]);
    expect(applied.items[0]!.params).toEqual({ name: 'Alex' });
    // Each item gets its own copy, not a shared one.
    expect(applied.items[0]!.options).not.toBe(applied.items[1]!.options);
    expect(applyToAll(emptyCollection, { presetId: 'h264-mp4', options: {} })).toBe(emptyCollection);
  });
});

describe('saving and loading', () => {
  it('survives a round trip', () => {
    let c = gathered(strap, clip);
    c = updateItem(c, c.items[0]!.uid, { options: { fps: 25, outFrame: 40 }, params: { name: 'Alex' } });
    const parsed = parseCollection(serializeCollection(c));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.collection).toEqual(c);
  });

  it('refuses what it cannot vouch for, and says why', () => {
    expect(parseCollection('not json')).toEqual({ ok: false, error: 'That file is not a collection: it is not readable JSON.' });
    expect(parseCollection('[]')).toMatchObject({ ok: false });
    expect(parseCollection(JSON.stringify({ formatVersion: 99, items: [] })).ok).toBe(false);
    expect((parseCollection(JSON.stringify({ formatVersion: 99, items: [] })) as { error: string }).error).toContain('format 99');
    expect(parseCollection(JSON.stringify({ formatVersion: COLLECTION_FORMAT_VERSION })).ok).toBe(false);
  });

  it('skips an item it cannot read rather than refusing the file', () => {
    const text = JSON.stringify({ formatVersion: COLLECTION_FORMAT_VERSION, items: [{ id: 'a', presetId: 'png-sequence' }, { nonsense: true }] });
    const parsed = parseCollection(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.collection.items).toHaveLength(1);
    expect(parsed.collection.items[0]).toMatchObject({ id: 'a', kind: 'template', name: 'a', options: {}, params: {} });
    expect(parsed.collection.items[0]!.uid).toBeTruthy();
  });
});

describe('resolving against the library', () => {
  it('finds an item by its library id, and a template by its manifest id when the library moved', () => {
    const c = gathered(strap, wipe);
    const moved: TemplateEntry = { ...template('strap'), id: 'different-install-id' };
    const resolved = resolveCollection(c, index([moved]));
    expect(resolved[0]).toMatchObject({ missing: false, offline: false });
    expect(resolved[0]!.entry?.id).toBe('different-install-id');
    // Nothing answers for the second one.
    expect(resolved[1]).toMatchObject({ missing: true, offline: false });
    expect(resolved[1]!.item.name).toBe('wipe');
  });

  it('flags a slot whose chosen image is not in the library or is offline, and keeps such an item out of Render all', () => {
    const slotted = validManifest({ id: 'test.slotted', name: 'Slotted', parameters: [{ id: 'name', type: 'text', label: 'Name', default: 'Acme' }, { id: 'logo', type: 'image', label: 'Logo', box: { x: 0, y: 0, width: 0.2, height: 0.2 }, fallbackText: 'name' }] });
    const template: TemplateEntry = { kind: 'template', key: 'k-slotted', id: 'id-slotted', dir: '/lib/slotted', root: '/lib', manifest: slotted, tags: [], warnings: [] };
    const logo: MediaEntry = { kind: 'media', key: 'k-logo', id: 'abcdefabcdefabcdefabcdef', path: '/lib/logo.png', root: '/lib', name: 'logo', mediaKind: 'image', ext: '.png', size: 10, mtimeMs: 0, tags: [] };
    const index: LibraryIndex = { roots: ['/lib'], templates: [template], media: [logo], problems: [], builtAt: '' };
    const withLogo = { items: [itemFor(template, 'prores-4444', {}, { logo: logo.id })] };
    expect(resolveCollection(withLogo, index)[0]!.missingImages).toEqual([]);
    expect(renderableItems(resolveCollection(withLogo, index))).toHaveLength(1);
    // The image gone from the library.
    const gone = resolveCollection(withLogo, { ...index, media: [] })[0]!;
    expect(gone.missingImages).toEqual(['Logo']);
    expect(gone.missing).toBe(false);
    expect(renderableItems([gone])).toEqual([]);
    // Or offline.
    expect(resolveCollection(withLogo, { ...index, media: [{ ...logo, offline: true }] })[0]!.missingImages).toEqual(['Logo']);
    // No image chosen: nothing to flag.
    expect(resolveCollection({ items: [itemFor(template, 'prores-4444')] }, { ...index, media: [] })[0]!.missingImages).toEqual([]);
    // The choice, treatment and all, survives the file.
    const value = { id: logo.id, treatment: 'white', tint: '#ffffff', effect: 'glow' };
    const round = parseCollection(serializeCollection({ items: [itemFor(template, 'prores-4444', {}, { logo: value })] }));
    expect(round.ok && round.collection.items[0]!.params.logo).toEqual(value);
  });

  it('flags an offline item instead of losing it', () => {
    const resolved = resolveCollection(gathered(strap), index([{ ...strap, offline: true }]));
    expect(resolved[0]).toMatchObject({ missing: false, offline: true });
  });

  it('renders the templates it can reach, and says what it is holding', () => {
    const c = gathered(strap, clip, wipe);
    const resolved = resolveCollection(c, index([strap, clip]));
    expect(renderableItems(resolved).map((r) => r.item.name)).toEqual(['strap']);
    expect(collectionSummary(resolved)).toBe('3 items · 1 missing · 1 not renderable yet');
    expect(collectionSummary([])).toBe('Nothing collected yet.');
    expect(collectionSummary(resolveCollection(gathered(strap), index([strap])))).toBe('1 item');
  });
});
