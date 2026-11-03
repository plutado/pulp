/**
 * Music moods (milestone 16's moods): how a piece of sound feels — upbeat,
 * dramatic, calm — beside what it is and what it is about. The built-in list
 * and its aliases, inference from folders and from a file's own metadata, the
 * `mood:` search key and the Mood chip's options, and the bundled catalog's
 * tagging, which travels in each generated file's genre tag.
 */

import { describe, expect, it } from 'vitest';
import { moodOptions } from '../src/core/categories';
import type { LibraryEntry, MediaEntry } from '../src/core/library-types';
import { parseFfprobe } from '../src/core/media-meta';
import { ffprobeArgs } from '../src/core/media-probe';
import { SAMPLE_MEDIA, sampleAudioArgs } from '../src/core/sample-media';
import { parseQuery, searchLibrary, splitFreeText } from '../src/core/search';
import { effectiveQuery, initialAppState } from '../src/core/app-state';
import { entryMoods, inferMoods, isBuiltInMood, moodLabel, MOODS, moodsFromText } from '../src/core/taxonomy';

const media = (id: string, over: Partial<MediaEntry> = {}): MediaEntry => ({
  kind: 'media', key: `media:/m/${id}.wav`, id, path: `/m/${id}.wav`, root: '/m', name: id,
  mediaKind: 'audio', ext: '.wav', size: 1, mtimeMs: 0, tags: [], ...over,
});

describe('the mood list', () => {
  it('is fixed, labeled, and holds the words the ask names', () => {
    const ids = MOODS.map((m) => m.id);
    for (const named of ['upbeat', 'dramatic', 'calm']) expect(ids).toContain(named);
    for (const m of MOODS) {
      expect(isBuiltInMood(m.id)).toBe(true);
      expect(moodLabel(m.id)).toBe(m.label);
    }
    expect(isBuiltInMood('loud')).toBe(false);
  });

  it('infers from folder names by alias, and from metadata text split on tag separators', () => {
    expect(inferMoods(['Music', 'Chill'])).toEqual(['calm']);
    expect(inferMoods(['Suspense', 'Uplifting'])).toEqual(['tense', 'upbeat']);
    expect(inferMoods(['Stock', 'B-roll'])).toEqual([]);
    expect(moodsFromText('Calm, Dramatic')).toEqual(['calm', 'dramatic']);
    expect(moodsFromText('eerie / haunting; rock')).toEqual(['mysterious']);
    expect(moodsFromText(undefined)).toEqual([]);
  });

  it('an entry\'s moods are its folders\' with its own metadata\'s; a template has none', () => {
    const tagged = media('m1', { moods: ['calm'], meta: { moods: ['calm', 'tense'] } });
    expect(entryMoods(tagged)).toEqual(['calm', 'tense']);
    expect(entryMoods(media('m2'))).toEqual([]);
    expect(entryMoods({ kind: 'template' } as LibraryEntry)).toEqual([]);
  });
});

describe('the metadata channel', () => {
  it('ffprobe is asked for the genre, mood and comment tags, and the parser reads moods out of them', () => {
    expect(ffprobeArgs('/m/x.wav').join(' ')).toContain('format_tags=genre,mood,comment');
    const meta = parseFfprobe(JSON.stringify({
      streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '48000', channels: 1 }],
      format: { duration: '8.0', tags: { GENRE: 'Chill', comment: 'suspense build' } },
    }));
    expect(meta?.moods).toEqual(['calm', 'tense']);
    // A genre that is not a mood is simply not a mood, and the field stays absent.
    const rock = parseFfprobe(JSON.stringify({ streams: [], format: { duration: '1', tags: { genre: 'Rock' } } }));
    expect(rock?.moods).toBeUndefined();
  });
});

describe('searching and browsing by mood', () => {
  const index = {
    templates: [], problems: [], roots: [],
    media: [
      media('calm-piece', { moods: ['calm'] }),
      media('tagged-piece', { meta: { duration: 8, moods: ['dramatic'] } }),
      media('plain-piece'),
    ],
  } as unknown as Parameters<typeof searchLibrary>[0];

  it('mood: matches folder-inferred and metadata moods alike, and is a filter to the free-text split', () => {
    expect(parseQuery('mood:Calm').moods).toEqual(['calm']);
    expect(searchLibrary(index, 'mood:calm').map((h) => h.entry.id)).toEqual(['calm-piece']);
    expect(searchLibrary(index, 'mood:dramatic').map((h) => h.entry.id)).toEqual(['tagged-piece']);
    expect(searchLibrary(index, 'mood:upbeat')).toHaveLength(0);
    expect(splitFreeText('calm piano mood:calm')).toEqual({ text: 'calm piano', filters: 'mood:calm' });
  });

  it('the Mood chip carries it into the query, and offers only the moods the library holds', () => {
    expect(effectiveQuery({ ...initialAppState, mood: 'calm' })).toBe('mood:calm');
    const options = moodOptions([...index.media]);
    expect(options.map((o) => o.id)).toEqual(['calm', 'dramatic']);
    expect(options.find((o) => o.id === 'calm')?.count).toBe(1);
    // A chosen mood stays listed at zero, so it can be unchosen.
    expect(moodOptions([], 'tense').map((o) => o.id)).toEqual(['tense']);
  });
});

describe('the bundled audio', () => {
  it('every music piece carries at least one built-in mood, and stems feel as their song does', () => {
    const music = SAMPLE_MEDIA.filter((i) => i.folder[0] === 'Music');
    expect(music.length).toBeGreaterThan(20);
    for (const item of music) {
      expect(item.moods?.length ?? 0, `${item.folder.join('/')}/${item.file}`).toBeGreaterThan(0);
      for (const mood of item.moods ?? []) expect(isBuiltInMood(mood), `${item.file}: ${mood}`).toBe(true);
    }
    const nightDrive = music.filter((i) => i.folder.join('/').includes('Stems/Night drive'));
    expect(nightDrive.length).toBeGreaterThan(0);
    for (const stem of nightDrive) expect(stem.moods).toEqual(['mysterious', 'upbeat']);
    // Every mood in the list names at least one bundled piece, so the chip is never a dead word.
    const used = new Set(SAMPLE_MEDIA.flatMap((i) => i.moods ?? []));
    for (const m of MOODS) expect(used.has(m.id), m.id).toBe(true);
  });

  it('the generator writes the moods into the file\'s own genre tag', () => {
    const calm = SAMPLE_MEDIA.find((i) => i.file === 'boardroom-calm.wav')!;
    expect(calm.moods).toEqual(['calm']);
    const args = sampleAudioArgs(calm.recipe as Parameters<typeof sampleAudioArgs>[0], '/out/x.wav', calm.moods);
    const at = args.indexOf('-metadata');
    expect(at).toBeGreaterThan(0);
    expect(args[at + 1]).toBe('genre=calm');
    // No moods, no tag: a whoosh is a sound, not a feeling.
    expect(sampleAudioArgs(calm.recipe as Parameters<typeof sampleAudioArgs>[0], '/out/x.wav')).not.toContain('-metadata');
  });
});
