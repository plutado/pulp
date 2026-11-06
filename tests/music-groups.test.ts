/**
 * Music and sound effects in a stock library (milestone 32): tracks in several lengths as one
 * item with the right one picked for the work, a song's stems as one item, and sounds paired with
 * the transitions they were made for. Names only here; the scan is checked with generated files.
 */

import { describe, expect, it } from 'vitest';
import { groupMusicVersions, groupStems, musicLengthOf, pairTransitionSounds, pickVersion } from '../src/core/music-groups';

describe('a track in several lengths', () => {
  it('reads the length a name says, in the ways stock music writes it', () => {
    expect(musicLengthOf('Sunrise 30s.wav')).toEqual({ base: 'sunrise', label: '30 s', seconds: 30 });
    expect(musicLengthOf('Sunrise_60.wav')).toEqual({ base: 'sunrise', label: '1:00', seconds: 60 });
    expect(musicLengthOf('Sunrise - 15 sec.mp3')).toEqual({ base: 'sunrise', label: '15 s', seconds: 15 });
    expect(musicLengthOf('Sunrise 2m14.wav')).toEqual({ base: 'sunrise', label: '2:14', seconds: 134 });
    expect(musicLengthOf('Sunrise 2:14.wav')).toEqual({ base: 'sunrise', label: '2:14', seconds: 134 });
    expect(musicLengthOf('Sunrise (Full).wav')).toEqual({ base: 'sunrise', label: 'Full' });
    expect(musicLengthOf('Sunrise Sting.wav')).toEqual({ base: 'sunrise', label: 'Sting' });
    // Not lengths: a track number, a name alone.
    expect(musicLengthOf('Track 2.wav')).toBeNull();
    // A numbered series, not cuts.
    expect(musicLengthOf('clip-3-5.wav')).toBeNull();
    expect(musicLengthOf('clip-3-10.wav')).toBeNull();
    expect(musicLengthOf('Sunrise.wav')).toBeNull();
  });

  it('groups two or more cuts of one track, the plain name as its full version, and leaves the rest', () => {
    const found = groupMusicVersions(['Sunrise 15s.wav', 'Sunrise 30s.wav', 'Sunrise.wav', 'Track 1.wav', 'Track 2.wav', 'Lonely 30s.wav', 'notes.txt']);
    expect(found).toEqual([{
      name: 'Sunrise',
      versions: [{ file: 'Sunrise.wav', label: '' }, { file: 'Sunrise 30s.wav', label: '30 s', seconds: 30 }, { file: 'Sunrise 15s.wav', label: '15 s', seconds: 15 }],
    }]);
  });

  it('picks the shortest version that covers the work, or the longest when none does', () => {
    const v = [{ id: 'full', seconds: 134 }, { id: '30', seconds: 30 }, { id: '15', seconds: 15 }];
    expect(pickVersion(v, 12)!.id).toBe('15');
    expect(pickVersion(v, 15)!.id).toBe('15');
    expect(pickVersion(v, 20)!.id).toBe('30');
    expect(pickVersion(v, 90)!.id).toBe('full');
    expect(pickVersion(v, 600)!.id, 'none long enough: the longest').toBe('full');
    expect(pickVersion(v, undefined)!.id, 'no length asked: the longest').toBe('full');
    // A version not measured yet is passed over while others are.
    expect(pickVersion([{ id: 'a' }, { id: 'b', seconds: 30 }], 10)!.id).toBe('b');
    // None measured long enough: the unmeasured one ("Full") rather than a cut known to be short.
    expect(pickVersion([{ id: 'full' }, { id: '15', seconds: 15 }], 45)!.id).toBe('full');
  });
});

describe("a song's stems", () => {
  it('reads a Stems folder as one song, each stem named by what is left of its file name', () => {
    expect(groupStems('Sunrise Stems', 'Music', ['Sunrise Drums.wav', 'Sunrise Bass.wav', 'Sunrise Keys.wav'])).toEqual([{
      name: 'Sunrise', stems: [{ file: 'Sunrise Drums.wav', label: 'Drums' }, { file: 'Sunrise Bass.wav', label: 'Bass' }, { file: 'Sunrise Keys.wav', label: 'Keys' }],
    }]);
    expect(groupStems('Stems', 'Sunrise', ['Drums.wav', 'Bass.wav'])[0]!.name).toBe('Sunrise');
  });

  it('reads files that say "stem" as one song\'s, elsewhere, and needs two of them', () => {
    expect(groupStems('Music', 'Stock', ['Sunrise Stem Drums.wav', 'Sunrise Stem Bass.wav', 'Sunrise.wav', 'Other Stem Pad.wav'])).toEqual([{
      name: 'Sunrise', stems: [{ file: 'Sunrise Stem Drums.wav', label: 'Drums' }, { file: 'Sunrise Stem Bass.wav', label: 'Bass' }],
    }]);
  });
});

describe('a sound made for a transition', () => {
  it('pairs a clip with the sound named after it, or after it and SFX, in the same folder', () => {
    const pairs = pairTransitionSounds(['Swipe Left.mov', 'Ink Wipe.mov', 'Smoke.mov'], ['Swipe Left.wav', 'Ink Wipe SFX.wav', 'Thunder.wav']);
    expect([...pairs]).toEqual([['Swipe Left.mov', 'Swipe Left.wav'], ['Ink Wipe.mov', 'Ink Wipe SFX.wav']]);
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { LibraryStore } from '../src/core/library-store';
import { searchLibrary } from '../src/core/search';
import { soundIdsFor } from '../src/core/music-groups';
import { entryBadges } from '../src/core/results-view';
import { detectFfmpeg } from '../src/core/ffmpeg';
import { snapshotTree, writeMusicFixture } from './stock-fixture';

const ffmpeg = await detectFfmpeg();

describe('music and sound effects in a library (generated files)', () => {
  let dir = '';
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('shows a track in several lengths and a song\'s stems as one item each, and pairs a transition with its sound', async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulp-music-'));
    const lib = join(dir, 'Stock');
    await writeMusicFixture(lib, ffmpeg.ok && ffmpeg.encoders.includes('qtrle') ? ffmpeg.path : undefined);
    const before = await snapshotTree(lib);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const index = store.toIndex();
    const shown = searchLibrary(index, '').map((h) => h.entry);
    const names = shown.filter((e) => e.kind === 'media').map((e) => (e as { name: string }).name).sort();
    // One Sunrise for the three cuts, one for the stems; the files themselves are not shown.
    expect(names.filter((n) => n.startsWith('Sunrise'))).toEqual(['Sunrise', 'Sunrise']);
    expect(names).not.toEqual(expect.arrayContaining(['Sunrise 6s', 'Sunrise Drums']));
    const cuts = index.media.find((m) => m.versions)!;
    const stems = index.media.find((m) => m.stemParts)!;
    expect(cuts.versions!.map((v) => v.label)).toEqual(['', '15 s', '6 s']);
    expect(stems.stemParts!.map((s) => s.label)).toEqual(['Bass', 'Drums', 'Keys']);
    // The members stay in the index, so a layer can play them by id.
    for (const v of cuts.versions!) expect(index.media.some((m) => m.id === v.id && m.partOf === cuts.key)).toBe(true);
    expect(entryBadges(cuts).map((b) => b.id)).toContain('versions');
    expect(entryBadges(stems).map((b) => b.id)).toContain('stems');
    // Searching finds the group, never its cuts.
    expect(searchLibrary(index, 'sunrise').filter((h) => (h.entry as { partOf?: string }).partOf)).toEqual([]);

    // Placed for a 10 s graphic, the 15 s cut; for 4 s, the 6 s one; for a minute, the full track.
    const byId = (id: string) => ({ meta: { duration: { [cuts.versions![0]!.id]: 30, [cuts.versions![1]!.id]: 15, [cuts.versions![2]!.id]: 6 }[id] } });
    const cutFor = (length: number) => cuts.versions!.find((v) => v.id === soundIdsFor(cuts, length, byId).id)!.label;
    expect([cutFor(10), cutFor(4), cutFor(60)]).toEqual(['15 s', '6 s', '']);
    // The stems arrive as stems, each on, so each can be switched off on its lane.
    const placed = soundIdsFor(stems, 10, byId);
    expect(placed.stems!.map((s) => [s.label, s.muted, s.solo, s.gain])).toEqual([['Bass', false, false, 1], ['Drums', false, false, 1], ['Keys', false, false, 1]]);

    if (ffmpeg.ok && ffmpeg.encoders.includes('qtrle')) {
      const clip = index.media.find((m) => m.name === 'Swipe Left' && m.mediaKind === 'video')!;
      const whoosh = index.media.find((m) => m.name === 'Swipe Left' && m.mediaKind === 'audio')!;
      expect(clip.pairedSound).toBe(whoosh.id);
      expect(entryBadges(clip).map((b) => b.id)).toContain('sound');
      // The sound is still an item of its own, to use anywhere.
      expect(whoosh.partOf).toBeUndefined();
    }
    // Read where they are: nothing written into the library.
    expect(await snapshotTree(lib)).toEqual(before);
    store.close();
  });
});
