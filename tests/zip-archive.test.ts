/**
 * Zipped downloads in a stock library (milestone 32): browsed without unpacking, and a file
 * unpacked into the library's folder — beside the archive, in a folder named after it — only when
 * it is used. Every archive here is generated (tests/stock-fixture.ts).
 */

import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractZipMember, extractZipMemberOrElsewhere, fallbackUnpackPath, listZipFile, readZipMember, unpackedPath, unpackFolder } from '../src/core/zip-archive';
import { readZip, writeZip } from '../src/core/zip';
import { LibraryStore } from '../src/core/library-store';
import { searchLibrary } from '../src/core/search';
import { entryBadges } from '../src/core/results-view';
import { LOCKED_ZIP_MEDIA, snapshotTree, writeLockedZipFixture, writeZip64Fixture, writeZipFixture, ZIP_FIXTURE_MEDIA } from './stock-fixture';
import { formatRows } from '../src/core/item-info';

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

describe('an archive over 4 GB (ZIP64)', () => {
  it('reads the ZIP64 end record and each entry\'s extra field, and lists and unpacks as any archive', async () => {
    const dir = await scratch();
    const zip = join(dir, 'Huge Pack.zip');
    await writeZip64Fixture(zip);
    const bytes = await readFile(zip);
    // The structures a 4 GB download carries: the end record says "see the ZIP64 record", which is there.
    expect(bytes.readUInt16LE(bytes.length - 22 + 10)).toBe(0xffff);
    expect(bytes.readUInt32LE(bytes.length - 22 - 20)).toBe(0x07064b50);
    const members = await listZipFile(zip);
    expect(members.map((m) => m.name).sort()).toEqual([...ZIP_FIXTURE_MEDIA].sort());
    // The true sizes and offsets came from the extra fields, not the 0xffffffff placeholders.
    for (const m of members) {
      expect(m.size).toBeLessThan(0xffffffff);
      expect(m.offset).toBeLessThan(bytes.length);
      expect(m.encrypted).toBe(false);
    }
    const out = await extractZipMember(zip, 'Backgrounds/Ocean Wash.png', unpackedPath(zip, 'Backgrounds/Ocean Wash.png'));
    expect((await readFile(out)).subarray(1, 4).toString()).toBe('PNG');
    // Streamed and checked: a member tampered with in the archive is refused, and nothing is left under its name.
    const broken = join(dir, 'Broken.zip');
    const copy = Buffer.from(bytes);
    const at = copy.indexOf(Buffer.from('Riser Short.wav')) + 'Riser Short.wav'.length;
    copy[at + 4] = copy[at + 4]! ^ 0xff;
    await writeFile(broken, copy);
    // The inflater refuses a damaged stream before the CRC gets a say; a byte that slips past it meets the CRC.
    await expect(extractZipMember(broken, 'Sound Effects/Riser Short.wav', join(dir, 'riser.wav'))).rejects.toThrow(/corrupt|invalid/);
    expect(existsSync(join(dir, 'riser.wav'))).toBe(false);
    expect(existsSync(join(dir, 'riser.wav.pulp-part'))).toBe(false);
  });

  it('lists a ZIP64 archive in the library like any other', async () => {
    const lib = join(await scratch(), 'Stock');
    const zip = join(lib, 'Downloads', 'Huge Pack.zip');
    await writeZip64Fixture(zip);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    expect(store.toIndex().media.map((m) => m.name).sort()).toEqual(['Ember Glow', 'Ocean Wash', 'Riser Short']);
    expect(store.toIndex().problems).toEqual([]);
    store.close();
  });
});

describe('a password-protected archive', () => {
  it('lists the protected members by name, marked, and refuses to read them', async () => {
    const zip = join(await scratch(), 'Locked Pack.zip');
    await writeLockedZipFixture(zip);
    const members = await listZipFile(zip);
    expect(members.filter((m) => m.encrypted).map((m) => m.name).sort()).toEqual([...LOCKED_ZIP_MEDIA].sort());
    expect(members.find((m) => m.name === 'Stills/Open Sky.png')!.encrypted).toBe(false);
    const locked = members.find((m) => m.name === 'Stills/Dawn Mist.png')!;
    await expect(readZipMember(zip, locked)).rejects.toThrow(/password-protected/);
    await expect(extractZipMember(zip, locked.name, unpackedPath(zip, locked.name))).rejects.toThrow(/password-protected/);
    expect(existsSync(unpackFolder(zip))).toBe(false);
  });

  it('shows each protected file as an item Pulp cannot open, with a plain note, never read or offered to place', async () => {
    const lib = join(await scratch(), 'Stock');
    const zip = join(lib, 'Downloads', 'Locked Pack.zip');
    await writeLockedZipFixture(zip);
    const before = await snapshotTree(lib);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const index = store.toIndex();
    expect(index.media.map((m) => m.name).sort()).toEqual(['Dawn Mist', 'Dusk Haze', 'Open Sky']);
    const dawn = index.media.find((m) => m.name === 'Dawn Mist')!;
    expect(dawn.unreadable).toEqual({ ext: '.png', encrypted: true });
    expect(dawn.offline, 'refused for use as an offline item is').toBe(true);
    expect(entryBadges(dawn).map((b) => b.id)).toEqual(expect.arrayContaining(['unreadable', 'archive']));
    expect(entryBadges(dawn).find((b) => b.id === 'unreadable')!.tip).toMatch(/password-protected archive.*unpack the archive with the password/);
    expect(formatRows(dawn).map((r) => r.value).join(' ')).toContain('which is password-protected: Pulp cannot unpack it');
    // Never probed or thumbnailed; still searchable, so the collection is seen whole.
    expect(store.pendingMetadata(100).map((m) => m.name)).not.toContain('Dawn Mist');
    expect(store.pendingThumbnails(100).map((m) => (m as { name?: string }).name)).not.toContain('Dawn Mist');
    expect(searchLibrary(index, 'dusk').map((h) => h.entry.key)).toEqual([index.media.find((m) => m.name === 'Dusk Haze')!.key]);
    // The one open member is an ordinary item of the archive.
    const open = index.media.find((m) => m.name === 'Open Sky')!;
    expect(open.unreadable).toBeUndefined();
    expect(open.offline).toBeUndefined();
    expect(await snapshotTree(lib)).toEqual(before);
    store.close();
  });
});

const canLockFolders = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;

describe.skipIf(!canLockFolders)('an archive on a drive that cannot be written to', () => {
  it('unpacks into the place of Pulp\'s own it is given when the library refuses the write, and says so', async () => {
    const dir = await scratch();
    const lib = join(dir, 'Disc');
    const zip = join(lib, 'Downloads', 'Motion Pack.zip');
    await writeZipFixture(zip);
    const own = join(dir, 'pulp-data', 'archive-unpacked');
    const elsewhere = fallbackUnpackPath(own, zip, 'Backgrounds/Ocean Wash.png');
    expect(elsewhere.endsWith(join('Backgrounds', 'Ocean Wash.png')), 'the member keeps its own folders and name').toBe(true);
    expect(fallbackUnpackPath(own, join(lib, 'Other.zip'), 'Backgrounds/Ocean Wash.png'), 'another archive\'s same name is another place').not.toBe(elsewhere);
    await chmod(join(lib, 'Downloads'), 0o555);
    try {
      const before = await snapshotTree(lib);
      const made = await extractZipMemberOrElsewhere(zip, 'Backgrounds/Ocean Wash.png', unpackedPath(zip, 'Backgrounds/Ocean Wash.png'), elsewhere);
      expect(made).toEqual({ path: elsewhere, elsewhere: true });
      expect((await readFile(elsewhere)).subarray(1, 4).toString()).toBe('PNG');
      // Nothing beside the archive, not even a folder, and the library byte for byte as it was.
      expect(existsSync(unpackFolder(zip))).toBe(false);
      expect(await snapshotTree(lib)).toEqual(before);

      // The library lists the file from there: the same item, unpacked, once, and saying where it is.
      const store = new LibraryStore(':memory:');
      store.setArchiveFallback((z, m) => fallbackUnpackPath(own, z, m));
      store.setRoots([lib]);
      await store.scanRoots([lib]);
      const ocean = store.toIndex().media.filter((m) => m.name === 'Ocean Wash');
      expect(ocean).toHaveLength(1);
      expect(ocean[0]!.path).toBe(elsewhere);
      expect(ocean[0]!.archive).toEqual({ zip, member: 'Backgrounds/Ocean Wash.png', unpacked: true, elsewhere: true });
      expect(entryBadges(ocean[0]!).map((b) => b.id), 'no longer "In archive"').not.toContain('archive');
      expect(formatRows(ocean[0]!).map((r) => r.value).join(' ')).toContain("unpacked into Pulp's own data");
      // A second scan keeps it; a folder that can be written to again is unpacked beside as ever.
      expect((await store.scanRoots([lib])).loaded).toBe(0);
      store.close();
    } finally {
      await chmod(join(lib, 'Downloads'), 0o755);
    }
    const beside = await extractZipMemberOrElsewhere(zip, 'Backgrounds/Ember Glow.png', unpackedPath(zip, 'Backgrounds/Ember Glow.png'), fallbackUnpackPath(own, zip, 'Backgrounds/Ember Glow.png'));
    expect(beside.elsewhere).toBe(false);
    expect(existsSync(unpackedPath(zip, 'Backgrounds/Ember Glow.png'))).toBe(true);
    // Any other failure is still a failure: a destination whose parent is a file.
    await writeFile(join(dir, 'not-a-folder'), 'x');
    await expect(extractZipMemberOrElsewhere(zip, 'Backgrounds/Ember Glow.png', join(dir, 'not-a-folder', 'x.png'), join(dir, 'else', 'x.png'))).rejects.toThrow();
  });
});
