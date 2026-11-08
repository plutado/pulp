/**
 * Stock media stays the person's (milestone 32): referenced where it lies, never sent anywhere,
 * never copied into a pack, an export or this repository, and every fixture generated. One test
 * per clause, so the promise is held by the suite rather than by a sentence in the docs.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBrowseTree } from '../src/core/browse-tree';
import { edlEdit, fcpxmlEdit, fileUrl } from '../src/core/edit-export';
import { validateBlock } from '../src/core/layers';
import { LibraryStore } from '../src/core/library-store';
import type { ValidationIssue } from '../src/core/manifest';
import { searchLibrary } from '../src/core/search';
import { listZipFile } from '../src/core/zip-archive';
import { snapshotTree, writeCatalogFixture, writeLockedZipFixture, writeMusicFixture, writePreviewFixture, writeStockFixture, writeUnreadableFixture, writeZipFixture } from './stock-fixture';

const ROOT = join(import.meta.dirname, '..');

let base = '';
afterEach(async () => { if (base) await rm(base, { recursive: true, force: true }); base = ''; });

describe('stock media stays the person\'s (milestone 32)', () => {
  it('is referenced in place: every item of every kind points into its library, and browsing it writes nothing', async () => {
    base = await mkdtemp(join(tmpdir(), 'pulp-rights-'));
    const lib = join(base, 'Stock');
    // A library of every kind the milestone reads: plain files, a catalog with missing items, previews,
    // files Pulp cannot read, a zipped download, a password-protected one, and music in cuts and stems.
    await writeStockFixture(lib);
    await writeCatalogFixture(lib);
    await writePreviewFixture(join(lib, 'Previewed'));
    await writeUnreadableFixture(lib);
    await writeZipFixture(join(lib, 'Downloads', 'Motion Pack.zip'));
    await writeLockedZipFixture(join(lib, 'Downloads', 'Locked Pack.zip'));
    await writeMusicFixture(lib);
    const before = await snapshotTree(lib);

    // Everything browsing does short of ffmpeg: scan twice, build the index and the tree, search,
    // list what the background passes would read, and read an archive's directory.
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    await store.scanRoots([lib]);
    const index = store.toIndex();
    expect(index.media.length).toBeGreaterThan(20);
    buildBrowseTree(index.media, index.roots, undefined, [{ path: lib, name: 'Stock', addedAt: '', online: true, items: index.media.length }]);
    searchLibrary(index, 'whoosh');
    searchLibrary(index, 'tag:backgrounds');
    store.pendingMetadata(1000);
    store.pendingThumbnails(1000);
    await listZipFile(join(lib, 'Downloads', 'Motion Pack.zip'));
    store.close();

    // Every item — present, missing, inside an archive, a preview's owner, a set, a group — is a path in the library.
    for (const m of index.media) {
      expect(m.root, m.name).toBe(lib);
      expect(m.path.startsWith(lib + sep), `${m.name} at ${m.path}`).toBe(true);
      for (const p of [m.preview?.still, m.preview?.media, m.clipSet?.intro, m.clipSet?.loop, m.clipSet?.outro, m.archive?.zip]) {
        if (p) expect(p.startsWith(lib + sep), `${m.name}'s ${p}`).toBe(true);
      }
    }
    // Not a byte of it changed, nothing was added, and no modification time moved.
    expect(await snapshotTree(lib)).toEqual(before);
  });

  it('is never sent anywhere: every use of the network in the source is one of four named, and the panel bridge speaks only to this machine', () => {
    // What reaches a network, or listens on one.
    const NETWORK = /\bnet\.fetch\(|(?<![\w.])fetch\(|\bhttps?\.(?:request|get)\(|\bcreateServer\(|\.listen\(|new WebSocket\(|sendBeacon\(|XMLHttpRequest|\bdgram\b|\bnet\.(?:connect|createConnection)\(/;
    const ALLOWED: Record<string, string> = {
      'src/main/ffmpeg-service.ts': 'fetches a build of FFmpeg, when asked, from its publisher',
      'src/main/speech-service.ts': 'fetches the speech model, when asked (decision record 0021)',
      'src/main/semantic-service.ts': 'fetches the semantic search model, when asked (decision record 0024)',
      'src/core/panel-bridge.ts': 'serves the editor panels, on this machine alone',
    };
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) files.push(full);
      }
    };
    walk(join(ROOT, 'src'));
    const hits = new Map<string, string[]>();
    for (const file of files) {
      const code = readFileSync(file, 'utf8').split('\n').filter((line) => {
        const t = line.trim();
        return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
      });
      const lines = code.filter((line) => NETWORK.test(line));
      if (lines.length > 0) hits.set(relative(ROOT, file).split(sep).join('/'), lines);
    }
    const unexpected = [...hits.keys()].filter((f) => !(f in ALLOWED));
    expect(unexpected, `network use outside the four named: ${unexpected.map((f) => `${f}: ${hits.get(f)!.join(' | ')}`).join('; ')}`).toEqual([]);
    // And the four are really there, so the list stays an honest account rather than a stale one.
    expect([...hits.keys()].sort()).toEqual(Object.keys(ALLOWED).sort());
    // The three fetches download; nothing of the library goes with them. Each is a bare GET of a fixed URL.
    for (const file of ['src/main/ffmpeg-service.ts', 'src/main/speech-service.ts', 'src/main/semantic-service.ts']) {
      for (const line of hits.get(file)!) {
        expect(line, `${file}: ${line}`).not.toMatch(/method:|body:|POST|entry\.path|lookupMedia/);
      }
    }
    // The panel bridge binds the loopback address, hands an item over as its path for the editor to
    // reference in place, and streams one kind of file: Pulp's own thumbnail of an item.
    const bridge = readFileSync(join(ROOT, 'src/core/panel-bridge.ts'), 'utf8');
    expect(bridge).toContain("server.listen(port, '127.0.0.1'");
    expect(bridge).toMatch(/itemFile\(id: string\): Promise<\{ file: string; name: string \} \| undefined>/);
    const streams = bridge.match(/createReadStream\([^)]*\)/g) ?? [];
    expect(streams, 'one stream, the thumbnail\'s').toEqual(['createReadStream(file)']);
    expect(bridge.slice(0, bridge.indexOf('createReadStream(file)')).lastIndexOf('ctx.thumbnail(')).toBeGreaterThan(bridge.slice(0, bridge.indexOf('createReadStream(file)')).lastIndexOf('ctx.itemFile('));
    expect(bridge).not.toMatch(/entry\.path|lookupMedia|pulp-media/);
  });

  it('is never copied into a pack: a template refuses a library id, so a pack of templates cannot carry media', () => {
    // A pack is template folders zipped (src/main/pack-service.ts, `exportPackTo(templates)`), and a
    // template may name no clip, image or sound of its own — the validator refuses each.
    const errors: ValidationIssue[] = [];
    validateBlock({ id: 'b', label: 'B', box: { x: 0, y: 0, width: 1, height: 1 }, layers: [
      { id: 'clip', type: 'video', label: 'Clip', clip: 'stock-clip-id' },
      { id: 'still', type: 'image', label: 'Still', image: 'stock-still-id' },
      { id: 'music', type: 'audio', label: 'Music', sound: 'stock-track-id' },
    ] }, 'blocks[0]', errors);
    expect(errors.map((e) => e.path).sort()).toEqual(['blocks[0].layers[0].clip', 'blocks[0].layers[1].image', 'blocks[0].layers[2].sound']);
    expect(errors.map((e) => e.message).join(' ')).toMatch(/no clip of its own.*no image of its own.*no sound of its own|no sound of its own/s);
  });

  it('is never copied into an export: an exported edit references each file where it lies', () => {
    const stock = process.platform === 'win32' ? 'E:\\Stock\\Clips\\Dawn Flight.mov' : '/Volumes/Stock 2019/Clips/Dawn Flight.mov';
    const input = {
      name: 'Rights', fps: 25, width: 1920, height: 1080,
      track: { cuts: [{ id: 'dawn', from: 0, to: 4 }] },
      clips: { dawn: { path: stock, name: 'Dawn Flight', duration: 10, audio: true } },
    };
    const xml = fcpxmlEdit(input);
    expect(xml).toContain(fileUrl(stock));
    expect(fileUrl(stock)).toMatch(/^file:\/\//);
    const edl = edlEdit(input);
    expect(edl).toContain('Dawn Flight');
    // Neither format carries bytes of the clip, only where it is: a few hundred characters for a ten-second clip.
    expect(xml.length).toBeLessThan(8000);
    expect(edl.length).toBeLessThan(2000);
  });

  it('never enters the repository: the tracked media files are the bundled templates\' own sounds and the speech test\'s recordings, and the stock fixtures are generated', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const MEDIA = /\.(wav|mp3|m4a|aac|flac|ogg|aif|aiff|mov|mp4|m4v|mkv|webm|avi|mxf|zip|psd|ora|kra|exr|dpx|tif|tiff|aep|prproj|mogrt|iso|dmg)$/i;
    const media = tracked.filter((f) => MEDIA.test(f)).sort();
    // Every one made for this repository: a wipe's three swooshes, and two recordings for the speech test.
    expect(media).toEqual([
      'templates/diagonal-wipe/sounds/swoosh-airy.wav',
      'templates/diagonal-wipe/sounds/swoosh-sharp.wav',
      'templates/diagonal-wipe/sounds/swoosh-soft.wav',
      'tests/e2e/templates/media/silence.wav',
      'tests/e2e/templates/media/spoken.wav',
    ]);
    // The stock fixtures write every byte they use: nothing is read from the repository to make them.
    const fixture = readFileSync(join(ROOT, 'tests/stock-fixture.ts'), 'utf8');
    expect(fixture).toMatch(/Every byte is made here/);
    expect(fixture).not.toMatch(/readFileSync\(|from '\.\/media|tests\/e2e\/templates\/media/);
  });
});
