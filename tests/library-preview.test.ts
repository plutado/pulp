/**
 * Previews before full media (milestone 32): a huge stock library is indexed from the small previews
 * and thumbnails it carries, browsable straight away, and its full-quality files are read only when
 * an item is placed or rendered. Every file here is generated (tests/stock-fixture.ts); each "full"
 * file is bytes of nothing, so a test that pictured or measured one would fail.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { detectFfmpeg, nodeRunner } from '../src/core/ffmpeg';
import { canHaveStrip, wantsStrip } from '../src/core/hover-scrub';
import { formatRows } from '../src/core/item-info';
import { parseCatalog } from '../src/core/library-catalog';
import { catalogPreview, isPreviewFolder, metadataFromPreview, PreviewFolder, previewClip, previewSound, previewStem, sidecarPreviews, thumbnailPreview } from '../src/core/library-preview';
import { itemId } from '../src/core/library-scan';
import { LibraryStore } from '../src/core/library-store';
import type { MediaEntry } from '../src/core/library-types';
import { ffprobePathFor, probeMedia } from '../src/core/media-probe';
import { serveMedia, type MediaLookup } from '../src/core/media-serve';
import { mediaPreviewUrlFor, mediaUrlFor } from '../src/core/media-url';
import { entryBadges } from '../src/core/results-view';
import { PREVIEW_FIXTURE_ITEMS, PREVIEW_FIXTURE_MISSING, snapshotTree, writePreviewFixture } from './stock-fixture';

const media = (path: string, mediaKind: MediaEntry['mediaKind'], extra: Partial<MediaEntry> = {}): MediaEntry => {
  const key = `media:${path}`;
  return { kind: 'media', key, id: itemId(key), path, root: '/lib', name: 'x', mediaKind, ext: path.slice(path.lastIndexOf('.')), size: 0, mtimeMs: 0, tags: [], ...extra };
};

describe('which files are an item\'s previews', () => {
  it('knows the folders collections keep previews in, and the words after a name that make a file one', () => {
    expect(['Previews', 'thumbnails', 'Thumbs', 'Low Res', 'Proxies'].every(isPreviewFolder)).toBe(true);
    expect(['Clips', 'Backgrounds', 'Preview Pack'].some(isPreviewFolder)).toBe(false);
    expect(previewStem('Fire 01_preview.mp4')).toEqual({ stem: 'fire 01', marked: true });
    expect(previewStem('Fire 01 (low res).mov')).toEqual({ stem: 'fire 01', marked: true });
    expect(previewStem('Fire 01.thumb.jpg')).toEqual({ stem: 'fire 01', marked: true });
    expect(previewStem('Fire 01.mov')).toEqual({ stem: 'fire 01', marked: false });
    // A file that is only a word is itself, not a preview of nothing.
    expect(previewStem('thumb.jpg')).toEqual({ stem: 'thumb', marked: false });
  });

  it('finds a clip\'s poster and preview clip beside it, and leaves alike names and other kinds alone', () => {
    const siblings = ['Fire 01.mov', 'Fire 01.jpg', 'Fire 01_preview.mp4', 'Fire 01.wav', 'Fire 02.jpg', 'Fire 01 thumb.png'];
    const found = sidecarPreviews('Fire 01', 'video', ['Fire 01.mov'], siblings);
    // What says it is a preview comes first; the JPEG beside the clip is its poster even unsaid.
    expect(found.preview).toEqual({ still: 'Fire 01 thumb.png', media: 'Fire 01_preview.mp4' });
    expect(found.claimed.sort()).toEqual(['Fire 01 thumb.png', 'Fire 01.jpg', 'Fire 01_preview.mp4']);
    // A PNG beside a clip may be a deliverable of its own: not claimed unless it says so.
    expect(sidecarPreviews('Logo', 'video', ['Logo.mov'], ['Logo.mov', 'Logo.png'])).toEqual({ preview: {}, claimed: [] });
    // A clip of the same name in another format is a second clip, not a preview.
    expect(sidecarPreviews('Fire 01', 'video', ['Fire 01.mov'], ['Fire 01.mov', 'Fire 01.mp4'])).toEqual({ preview: {}, claimed: [] });
    // A name that ends in a preview word is still its own name.
    expect(sidecarPreviews('Movie Poster', 'video', ['Movie Poster.mov'], ['Movie Poster.mov', 'Movie.jpg'])).toEqual({ preview: {}, claimed: [] });
  });

  it('gives a still only a thumbnail that says it is one, and a sound its cover and its preview sound', () => {
    expect(sidecarPreviews('Blue Wash', 'image', ['Blue Wash.png'], ['Blue Wash.png', 'Blue Wash.jpg', 'Blue Wash_thumb.jpg']))
      .toEqual({ preview: { still: 'Blue Wash_thumb.jpg' }, claimed: ['Blue Wash_thumb.jpg'] });
    expect(sidecarPreviews('Sunrise', 'audio', ['Sunrise.wav'], ['Sunrise.wav', 'Sunrise.jpg', 'Sunrise (preview).mp3', 'Sunrise_preview.mp4']))
      .toEqual({ preview: { still: 'Sunrise.jpg', media: 'Sunrise (preview).mp3' }, claimed: ['Sunrise (preview).mp3', 'Sunrise.jpg'] });
  });

  it('matches a preview folder by the mirrored path, else by name where the name is unique', () => {
    const folder = new PreviewFolder('/lib');
    folder.add('Clips/Fire 01.jpg', '/lib/Previews/Clips/Fire 01.jpg');
    folder.add('Clips/Fire 01_preview.mp4', '/lib/Previews/Clips/Fire 01_preview.mp4');
    folder.add('Stills/Dusk.jpg', '/lib/Previews/Stills/Dusk.jpg');
    folder.add('Other/Dusk.jpg', '/lib/Previews/Other/Dusk.jpg');
    folder.add('Sunrise.png', '/lib/Previews/Sunrise.png');
    folder.add('Readme.txt', '/lib/Previews/Readme.txt');
    expect(folder.find('Clips', 'Fire 01', 'video').preview).toEqual({ still: '/lib/Previews/Clips/Fire 01.jpg', media: '/lib/Previews/Clips/Fire 01_preview.mp4' });
    // Flat: the name alone finds it from any folder.
    expect(folder.find('Music/Calm', 'Sunrise', 'audio').preview).toEqual({ still: '/lib/Previews/Sunrise.png' });
    // Two of the name in different folders, and no mirrored one: neither is taken.
    expect(folder.find('Backgrounds', 'Dusk', 'image').preview).toEqual({});
    expect(folder.find('Stills', 'Dusk', 'image').preview).toEqual({ still: '/lib/Previews/Stills/Dusk.jpg' });
    expect(folder.files).not.toContain('/lib/Previews/Readme.txt');
    expect(catalogPreview('/lib/Extras/small.png', 'video')).toEqual({ still: '/lib/Extras/small.png' });
    expect(catalogPreview('/lib/Extras/small.mp4', 'audio')).toEqual({});
  });

  it('reads the preview column of a catalog', () => {
    expect(parseCatalog('Path,Thumbnail\nClips/A.mov,Previews/A.jpg\nClips/B.mov,\n', 'catalog.csv')).toEqual([
      { path: 'Clips/A.mov', keywords: [], category: [], preview: 'Previews/A.jpg' },
      { path: 'Clips/B.mov', keywords: [], category: [] },
    ]);
    expect(parseCatalog('[{"path":"a.mov","preview":"../out.jpg"},{"path":"b.mov","thumb":"t/b.png"}]', 'catalog.json').map((r) => r.preview)).toEqual([undefined, 't/b.png']);
  });
});

describe('what browsing reads, and what waits for use', () => {
  it('takes from a preview only the length, and records that nothing was read when there is none to take it from', () => {
    expect(metadataFromPreview({ duration: 4.2, width: 320, height: 180, fps: 15, alpha: false, codec: 'h264' })).toEqual({ duration: 4.2, fromPreview: true });
    expect(metadataFromPreview(null)).toEqual({ fromPreview: true });
  });

  it('pictures an item from its still, else from a frame of its preview clip, and never from the file', () => {
    expect(thumbnailPreview(media('/lib/Fire.mov', 'video', { preview: { still: '/lib/Fire.jpg', media: '/lib/Fire_preview.mp4' } }))).toEqual({ file: '/lib/Fire.jpg', isClip: false });
    expect(thumbnailPreview(media('/lib/Fire.mov', 'video', { preview: { media: '/lib/Fire_preview.mp4' } }))).toEqual({ file: '/lib/Fire_preview.mp4', isClip: true });
    expect(thumbnailPreview(media('/lib/Fire.mov', 'video'))).toBeNull();
    expect(previewClip(media('/lib/Fire.mov', 'video', { preview: { media: '/lib/Fire_preview.mp4' } }))).toBe('/lib/Fire_preview.mp4');
    expect(previewSound(media('/lib/Sunrise.wav', 'audio', { preview: { media: '/lib/Sunrise_preview.mp3' } }))).toBe('/lib/Sunrise_preview.mp3');
    expect(previewSound(media('/lib/Fire.mov', 'video', { preview: { media: '/lib/Fire_preview.mp4' } }))).toBeNull();
  });

  it('scrubs a clip through its preview clip, and has nothing to scrub when its preview is a still alone', () => {
    const withClip = media('/lib/Fire.mov', 'video', { preview: { media: '/lib/Fire_preview.mp4' }, meta: { duration: 2, fromPreview: true } });
    expect(canHaveStrip(withClip) && wantsStrip(withClip)).toBe(true);
    const stillOnly = media('/lib/Fire.mov', 'video', { preview: { still: '/lib/Fire.jpg' }, meta: { fromPreview: true } });
    expect(canHaveStrip(stillOnly)).toBe(false);
    expect(canHaveStrip(media('/lib/Fire.mov', 'video'))).toBe(true);
  });

  it('says on the card and in Info that the item is browsed from its preview, and when the file has since been read', () => {
    const entry = media('/lib/Clips/Fire.mov', 'video', { preview: { still: '/lib/Clips/Fire.jpg' }, meta: { fromPreview: true } });
    expect(entryBadges(entry).map((b) => b.id)).toContain('preview');
    const row = () => formatRows(entry).find((r) => r.label === 'Preview')!.value;
    expect(row()).toMatch(/^Shown from Fire\.jpg, the library's own preview\. Its picture size, rate and transparency are read from the full file/);
    entry.meta = { duration: 3, width: 3840, height: 2160, alpha: true };
    expect(row()).toMatch(/the full file has been read$/);
    // What the catalog lists and is not here is Missing, not Preview, even with a picture.
    expect(entryBadges(media('/lib/Clips/Gone.mov', 'video', { missing: true, preview: { still: '/lib/Previews/Gone.jpg' } })).map((b) => b.id)).not.toContain('preview');
  });
});

describe('a library browsed from its previews', () => {
  let base = '';
  afterEach(async () => {
    if (base) await rm(base, { recursive: true, force: true });
  });

  const byPath = (store: LibraryStore, lib: string, rel: string) => store.toIndex().media.find((m) => m.path === join(lib, ...rel.split('/')));

  it('lists each item once with its previews, lists no preview as an item but one nothing claims, and writes nothing', async () => {
    base = await mkdtemp(join(tmpdir(), 'pulp-preview-'));
    const lib = join(base, 'Big Stock');
    await writePreviewFixture(lib);
    const before = await snapshotTree(lib);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    const first = await store.scanRoots([lib]);
    const index = store.toIndex();

    expect(index.media.filter((m) => !m.missing).map((m) => m.path).sort()).toEqual(PREVIEW_FIXTURE_ITEMS.map((f) => join(lib, ...f.split('/'))).sort());
    // Beside the clip, by name; beside the still, by a word; in a Thumbs folder beside the stills.
    expect(byPath(store, lib, 'Clips/Fire 01.mov')!.preview).toEqual({ still: join(lib, 'Clips', 'Fire 01_thumb.png') });
    expect(byPath(store, lib, 'Stills/Deep Sea.png')!.preview).toEqual({ still: join(lib, 'Stills', 'Deep Sea_thumb.png') });
    expect(byPath(store, lib, 'Stills/Warm Glow.png')!.preview).toEqual({ still: join(lib, 'Stills', 'Thumbs', 'Warm Glow.png') });
    // A root-level Previews folder mirroring the layout gives the track its cover; its preview sound is beside it.
    expect(byPath(store, lib, 'Music/Sunrise.wav')!.preview).toEqual({ still: join(lib, 'Previews', 'Music', 'Sunrise.png'), media: join(lib, 'Music', 'Sunrise_preview.wav') });
    // The catalog names a preview wherever it lies.
    expect(byPath(store, lib, 'Clips/Fire 04.mov')!.preview).toEqual({ still: join(lib, 'Extras', 'fire04-small.png') });
    // No preview clip was made for Fire 02 (no ffmpeg here): nothing stands for it, so it has none.
    expect(byPath(store, lib, 'Clips/Fire 02.mov')!.preview).toBeUndefined();
    // Listed by the catalog and not here, but pictured by the preview it names.
    const gone = byPath(store, lib, PREVIEW_FIXTURE_MISSING)!;
    expect(gone.missing).toBe(true);
    expect(gone.preview).toEqual({ still: join(lib, 'Previews', 'Clips', 'Fire 03.png') });
    expect(gone.tags).toEqual(expect.arrayContaining(['fire', 'embers']));
    // The one preview nothing claims is an item of its own, tagged by its folder.
    expect(byPath(store, lib, 'Previews/Orphan.png')!.tags).toEqual(['previews']);
    // Nothing added, changed or touched in the library.
    expect(await snapshotTree(lib)).toEqual(before);

    // A second scan keeps everything without reading it again.
    const again = await store.scanRoots([lib]);
    expect(again.loaded).toBe(0);
    expect(again.kept).toBe(first.loaded);
    expect(store.toIndex().media.length).toBe(index.media.length);

    // A preview arriving later is noticed: the item is read again and carries it.
    await writeFile(join(lib, 'Clips', 'Fire 02_thumb.png'), Buffer.from(before['Clips/Fire 01_thumb.png']!.slice(0, 1)));
    const third = await store.scanRoots([lib]);
    expect(third.loaded).toBe(1);
    expect(byPath(store, lib, 'Clips/Fire 02.mov')!.preview).toEqual({ still: join(lib, 'Clips', 'Fire 02_thumb.png') });
    expect(store.toIndex().media.some((m) => m.path.endsWith('Fire 02_thumb.png'))).toBe(false);
    store.close();
  });

  it('wants a thumbnail for a missing item that has a preview, and measures an item from its preview until it is used', async () => {
    base = await mkdtemp(join(tmpdir(), 'pulp-preview-'));
    const lib = join(base, 'Big Stock');
    await writePreviewFixture(lib);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const pictured = store.pendingThumbnails(100).map((e) => (e.kind === 'media' ? e.path : ''));
    expect(pictured).toContain(join(lib, 'Clips', 'Fire 03.mov'));
    expect(pictured).toContain(join(lib, 'Clips', 'Fire 01.mov'));
    expect(pictured).not.toContain(join(lib, 'Music', 'Sunrise.wav'));

    // The probe pass records what the preview gave; the item then wants no probe, and says what it knows.
    const fire = byPath(store, lib, 'Clips/Fire 01.mov')!;
    expect(store.pendingMetadata(100).map((e) => e.key)).toContain(fire.key);
    store.setMetadata(fire, metadataFromPreview(null));
    expect(store.pendingMetadata(100).map((e) => e.key)).not.toContain(fire.key);
    expect(byPath(store, lib, 'Clips/Fire 01.mov')!.meta).toEqual({ fromPreview: true });
    // Used, the file is read, and its own measurements replace the preview's.
    store.setMetadata(fire, { duration: 12, width: 3840, height: 2160, fps: 25, alpha: true });
    expect(byPath(store, lib, 'Clips/Fire 01.mov')!.meta).toEqual({ duration: 12, width: 3840, height: 2160, fps: 25, alpha: true });
    store.close();
  });

  it('serves the preview at /preview and the file itself at /, each checked as what it is', async () => {
    base = await mkdtemp(join(tmpdir(), 'pulp-preview-'));
    const lib = join(base, 'Big Stock');
    await writePreviewFixture(lib);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const lookup = (id: string): MediaLookup | undefined => store.findMediaById(id);
    const read = async (stream: Readable | undefined) => {
      const chunks: Buffer[] = [];
      for await (const c of stream ?? []) chunks.push(c as Buffer);
      return Buffer.concat(chunks);
    };
    const fire = byPath(store, lib, 'Clips/Fire 01.mov')!;
    const preview = await serveMedia({ method: 'GET', url: mediaPreviewUrlFor(fire.id) }, lookup);
    expect(preview.status).toBe(200);
    expect(preview.headers['Content-Type']).toBe('image/png');
    expect((await read(preview.body)).subarray(1, 4).toString()).toBe('PNG');
    // The item itself is still the full file, for what places or renders it.
    const full = await serveMedia({ method: 'GET', url: mediaUrlFor(fire.id) }, lookup);
    expect(full.status).toBe(200);
    expect(full.headers['Content-Type']).toBe('video/quicktime');
    // A sound's preview is its preview sound before its cover; an item with no preview has nothing there.
    const sunrise = byPath(store, lib, 'Music/Sunrise.wav')!;
    expect((await serveMedia({ method: 'GET', url: mediaPreviewUrlFor(sunrise.id) }, lookup)).headers['Content-Type']).toBe('audio/wav');
    expect((await serveMedia({ method: 'GET', url: mediaPreviewUrlFor(byPath(store, lib, 'Clips/Fire 02.mov')!.id) }, lookup)).status).toBe(404);
    store.close();
  });

  it('with ffmpeg: a preview clip gives the item its length, and the thumbnail is a frame of it, the full file never read', async () => {
    const ffmpeg = await detectFfmpeg();
    if (!ffmpeg.ok) return;
    base = await mkdtemp(join(tmpdir(), 'pulp-preview-'));
    const lib = join(base, 'Big Stock');
    await writePreviewFixture(lib, ffmpeg.path);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const fire = byPath(store, lib, 'Clips/Fire 02.mov')!;
    expect(fire.preview).toEqual({ media: join(lib, 'Clips', 'Fire 02_preview.mp4') });
    // What the main process's probe pass does for it: the preview clip measured, the length kept.
    const probed = await probeMedia(ffprobePathFor(ffmpeg.path), fire.preview!.media!, nodeRunner);
    const meta = metadataFromPreview(probed);
    expect(meta.duration).toBeCloseTo(2, 1);
    expect(meta).not.toHaveProperty('width');
    // And its thumbnail pass: a frame of the preview clip, made with the item's own arguments.
    const { mediaThumbArgs } = await import('../src/core/thumbnails');
    const small = thumbnailPreview(fire)!;
    const out = join(base, 'thumb.png');
    const made = await nodeRunner(ffmpeg.path, mediaThumbArgs(small.file, out, meta.duration, small.isClip));
    expect(made.code).toBe(0);
    // The full file is bytes of nothing: measuring it would have failed.
    expect(await probeMedia(ffprobePathFor(ffmpeg.path), fire.path, nodeRunner)).toBeNull();
    store.close();
  });
});
