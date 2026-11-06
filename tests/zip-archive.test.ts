/**
 * Zipped downloads in a stock library (milestone 32): browsed without unpacking, and a file
 * unpacked into the library's folder — beside the archive, in a folder named after it — only when
 * it is used. Every archive here is generated (tests/stock-fixture.ts).
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractZipMember, listZipFile, unpackedPath, unpackFolder } from '../src/core/zip-archive';
import { readZip, writeZip } from '../src/core/zip';
import { LibraryStore } from '../src/core/library-store';
import { searchLibrary } from '../src/core/search';
import { entryBadges } from '../src/core/results-view';
import { snapshotTree, writeZipFixture, ZIP_FIXTURE_MEDIA } from './stock-fixture';

let base = '';
afterEach(async () => { if (base) await rm(base, { recursive: true, force: true }); base = ''; });
const scratch = async () => (base = await mkdtemp(join(tmpdir(), 'pulp-zip-')));

describe('reading an archive without unpacking it', () => {
  it('lists what is inside from the central directory, leaving folders and resource-fork junk out', async () => {
    const zip = join(await scratch(), 'Motion Pack.zip');
    await writeZipFixture(zip);
    const members = await listZipFile(zip);
    expect(members.map((m) => m.name).sort()).toEqual([...ZIP_FIXTURE_MEDIA, 'License.txt'].sort());
    for (const m of members) expect(m.size).toBeGreaterThan(0);
  });

  it('never reads the files themselves to list them: an archive whose contents are garbage still lists', async () => {
    const zip = join(await scratch(), 'Damaged.zip');
    await writeZipFixture(zip);
    const bytes = await readFile(zip);
    const members = await listZipFile(zip);
    // Overwrite every member's data with noise; the central directory at the end is kept.
    const cdStart = bytes.readUInt32LE(bytes.length - 22 + 16);
    for (let i = 64; i < cdStart; i++) bytes[i] = (i * 31) & 0xff;
    await writeFile(zip, bytes);
    expect((await listZipFile(zip)).map((m) => m.name)).toEqual(members.map((m) => m.name));
    // Reading one now finds the damage, and leaves nothing half-written.
    const dest = join(base, 'out', 'x.png');
    await expect(extractZipMember(zip, 'Backgrounds/Ocean Wash.png', dest)).rejects.toThrow();
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.pulp-part`)).toBe(false);
  });

  it('says plainly what it cannot read, rather than failing the library', async () => {
    const bad = join(await scratch(), 'not-a.zip');
    await writeFile(bad, 'this is not an archive');
    await expect(listZipFile(bad)).rejects.toThrow(/not a zip/);
  });

  it('refuses names that would land outside the folder, and lists the rest', async () => {
    const zip = join(await scratch(), 'Sneaky.zip');
    // writeZip trusts its names; a hand-made archive need not.
    const archive = writeZip([{ name: 'ok/fine.png', data: Buffer.from('a') }, { name: 'xx/evil.png', data: Buffer.from('b') }]);
    const at = archive.indexOf('xx/evil.png', archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
    archive.write('../evil.png', at, 'latin1');
    await writeFile(zip, archive);
    expect((await listZipFile(zip)).map((m) => m.name)).toEqual(['ok/fine.png']);
  });
});

describe('unpacking one file when it is used', () => {
  it('writes exactly that file beside the archive, in a folder named after it, and nothing else', async () => {
    const dir = await scratch();
    const zip = join(dir, 'Motion Pack.zip');
    await writeZipFixture(zip);
    const dest = unpackedPath(zip, 'Backgrounds/Ocean Wash.png');
    expect(dest).toBe(join(dir, 'Motion Pack', 'Backgrounds', 'Ocean Wash.png'));
    expect(unpackFolder(zip)).toBe(join(dir, 'Motion Pack'));
    await extractZipMember(zip, 'Backgrounds/Ocean Wash.png', dest);
    const want = readZip(await readFile(zip)).find((e) => e.name === 'Backgrounds/Ocean Wash.png')!.data;
    expect(Buffer.compare(await readFile(dest), want)).toBe(0);
    const tree = await snapshotTree(dir);
    expect(Object.keys(tree).sort()).toEqual(['Motion Pack.zip', 'Motion Pack/', 'Motion Pack/Backgrounds/', 'Motion Pack/Backgrounds/Ocean Wash.png'].sort());
    // A second time leaves it as it is.
    const before = await snapshotTree(dir);
    await extractZipMember(zip, 'Backgrounds/Ocean Wash.png', dest);
    expect(await snapshotTree(dir)).toEqual(before);
  });
});

describe('an archive in the library', () => {
  it('lists each media file inside as an item, browsable and searchable, and unpacks nothing to do it', async () => {
    const lib = join(await scratch(), 'Stock');
    await writeZipFixture(join(lib, 'Downloads', 'Motion Pack.zip'));
    const before = await snapshotTree(lib);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const index = store.toIndex();
    expect(index.media.map((m) => m.name).sort()).toEqual(['Ember Glow', 'Ocean Wash', 'Riser Short']);
    const ocean = index.media.find((m) => m.name === 'Ocean Wash')!;
    expect(ocean.archive).toEqual({ zip: join(lib, 'Downloads', 'Motion Pack.zip'), member: 'Backgrounds/Ocean Wash.png', unpacked: false });
    expect(ocean.path).toBe(join(lib, 'Downloads', 'Motion Pack', 'Backgrounds', 'Ocean Wash.png'));
    expect(ocean.mediaKind).toBe('image');
    // Its folders — where the download sits, the archive's name, the folder inside — are its tags.
    expect(ocean.tags).toEqual(expect.arrayContaining(['downloads', 'motion-pack', 'backgrounds']));
    expect(index.media.find((m) => m.name === 'Riser Short')!.mediaKind).toBe('audio');
    expect(searchLibrary(index, 'ocean').map((h) => h.entry.key)).toEqual([ocean.key]);
    expect(searchLibrary(index, 'motion pack').length).toBe(3);
    expect(entryBadges(ocean).map((b) => b.id)).toContain('archive');
    // Nothing was unpacked, written or touched.
    expect(await snapshotTree(lib)).toEqual(before);
    store.close();
  });

  it('once a file is unpacked, it is the same item — not a second one — and the rest stay in the archive', async () => {
    const lib = join(await scratch(), 'Stock');
    const zip = join(lib, 'Motion Pack.zip');
    await writeZipFixture(zip);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const ocean = store.toIndex().media.find((m) => m.name === 'Ocean Wash')!;
    store.setUserData(ocean.key, { favorite: true });

    // Used: unpacked where its path says.
    await extractZipMember(zip, ocean.archive!.member, ocean.path);
    await store.scanRoots([lib]);
    const after = store.toIndex().media;
    expect(after.map((m) => m.name).sort(), 'no second Ocean Wash').toEqual(['Ember Glow', 'Ocean Wash', 'Riser Short']);
    const again = after.find((m) => m.name === 'Ocean Wash')!;
    expect(again.key).toBe(ocean.key);
    expect(again.archive?.unpacked).toBe(true);
    expect(again.favorite, 'what was said about it kept').toBe(true);
    expect(entryBadges(again).map((b) => b.id)).not.toContain('archive');
    expect(after.find((m) => m.name === 'Ember Glow')!.archive?.unpacked).toBe(false);
    // A file of the person's own in that folder, not from the archive, is listed as itself.
    await writeFile(join(lib, 'Motion Pack', 'My Notes.png'), (await readFile(ocean.path)));
    await store.scanRoots([lib]);
    expect(store.toIndex().media.map((m) => m.name).sort()).toEqual(['Ember Glow', 'My Notes', 'Ocean Wash', 'Riser Short']);
    store.close();
  });

  it('names an archive it cannot read as a problem, and goes on with the rest of the folder', async () => {
    const lib = join(await scratch(), 'Stock');
    await writeZipFixture(join(lib, 'Good.zip'));
    await writeFile(join(lib, 'Broken.zip'), 'not really');
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const index = store.toIndex();
    expect(index.media).toHaveLength(3);
    expect(index.problems.some((p) => p.path.endsWith('Broken.zip') && /could not read archive/.test(p.message))).toBe(true);
    store.close();
  });
});
