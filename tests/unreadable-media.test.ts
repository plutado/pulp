/**
 * What is out of scope is said, not hidden (milestone 32): a file Pulp cannot read is listed with a
 * plain note of what it needs and its preview where one exists. Every file here is generated.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { embeddedPreview, sidecarPreview, UNREADABLE_FORMATS, unreadableFormat, unreadableNote } from '../src/core/unreadable-media';
import { UNREADABLE_DESIGN_FORMATS } from '../src/core/layered';
import { LibraryStore } from '../src/core/library-store';
import { searchLibrary, searchPlaceable } from '../src/core/search';
import { entryBadges } from '../src/core/results-view';
import { setCurrentLocale, SOURCE_LOCALE } from '../src/core/i18n';
import { snapshotTree, writeUnreadableFixture } from './stock-fixture';

describe('which files, and what they need', () => {
  it('knows the formats kept beside stock media, and leaves what is not media alone', () => {
    expect(unreadableFormat('Title.AEP')).toMatchObject({ kind: 'video', ext: '.aep' });
    expect(unreadableFormat('Pack.mogrt')!.kind).toBe('video');
    expect(unreadableFormat('Poster.sketch')!.kind).toBe('image');
    for (const f of ['License.txt', 'clip.mov', 'still.png', 'noext']) expect(unreadableFormat(f), f).toBeNull();
    // Every design format milestone 33 named is still listed, now as an item.
    for (const ext of Object.keys(UNREADABLE_DESIGN_FORMATS)) expect(UNREADABLE_FORMATS[ext], ext).toBeDefined();
  });

  it('says plainly what it is and what it needs, in the interface\'s language', () => {
    expect(unreadableNote('Title Reveal.aep', '.aep')).toBe('Title Reveal.aep is an After Effects project, which Pulp cannot open; render it from After Effects (as ProRes 4444 or a PNG sequence, to keep its transparency) and add the render.');
    expect(unreadableNote('Old.iso', '.iso')).toMatch(/^Old\.iso is a disc image, which Pulp cannot open; open it/);
    setCurrentLocale('de');
    expect(unreadableNote('Title Reveal.aep', '.aep')).toContain('ein After-Effects-Projekt, das Pulp nicht öffnen kann');
    setCurrentLocale(SOURCE_LOCALE);
  });

  it('finds a preview beside a file, a picture before a clip, and one inside a zip-based file', () => {
    expect(sidecarPreview('Title.aep', ['Title.aep', 'Title.mp4', 'Title.jpg', 'Other.png'])).toBe('Title.jpg');
    expect(sidecarPreview('Title.aep', ['Title.aep', 'Title_preview.mov'])).toBe('Title_preview.mov');
    expect(sidecarPreview('Title.aep', ['Title.aep', 'Titles.png'])).toBeNull();
    expect(embeddedPreview(['definition.json', 'assets/a.png', 'thumb.png'])).toBe('thumb.png');
    expect(embeddedPreview(['only.png'])).toBe('only.png');
    expect(embeddedPreview(['a.png', 'b.png'])).toBeNull();
  });
});

describe('in the library', () => {
  let base = '';
  afterEach(async () => { if (base) await rm(base, { recursive: true, force: true }); base = ''; });

  it('lists each one as an item with its note and preview, refused for use, and writes nothing', async () => {
    base = await mkdtemp(join(tmpdir(), 'pulp-unreadable-'));
    const lib = join(base, 'Stock');
    await writeUnreadableFixture(lib);
    const before = await snapshotTree(lib);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const index = store.toIndex();
    const byName = (n: string) => index.media.filter((m) => m.name === n);
    // The project, the template and the disc are items; the readme is not; the project's poster is
    // its preview and still a picture of its own.
    expect(index.media.map((m) => m.name).sort()).toEqual(['Lower Third', 'Old Collection', 'Title Reveal', 'Title Reveal']);
    const aep = byName('Title Reveal').find((m) => m.unreadable)!;
    expect(aep.unreadable).toEqual({ ext: '.aep', preview: { file: join(lib, 'Projects', 'Title Reveal.png') } });
    expect(byName('Lower Third')[0]!.unreadable).toEqual({ ext: '.mogrt', preview: { zip: join(lib, 'Projects', 'Lower Third.mogrt'), member: 'thumb.png' } });
    expect(byName('Old Collection')[0]!.unreadable).toEqual({ ext: '.iso' });
    // Said, not hidden: a badge whose words say what it needs; found by search; never offered to place.
    expect(entryBadges(aep).find((b) => b.id === 'unreadable')!.tip).toContain('render it from After Effects');
    expect(aep.offline).toBe(true);
    expect(searchLibrary(index, 'title reveal').some((h) => h.entry.key === aep.key)).toBe(true);
    expect(searchPlaceable(index, { layers: ['image', 'video'] }).some((p) => p.id === aep.id)).toBe(false);
    // Not a problem to diagnose any more: an item.
    expect(index.problems.some((p) => p.path.endsWith('.aep'))).toBe(false);
    // Thumbnailed from its preview where it has one, never probed; nothing for the disc.
    const thumbs = store.pendingThumbnails(50).map((e) => (e as { name: string }).name);
    expect(thumbs).toEqual(expect.arrayContaining(['Title Reveal', 'Lower Third']));
    expect(thumbs).not.toContain('Old Collection');
    expect(store.pendingMetadata(50).some((m) => m.unreadable)).toBe(false);
    expect(await snapshotTree(lib)).toEqual(before);
    store.close();
  });
});
