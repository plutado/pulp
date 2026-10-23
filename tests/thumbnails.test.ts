import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../src/core/library-types';
import { mediaThumbArgs, posterThumbArgs, THUMB_SIZE, thumbFileName, thumbUrlFor, wantsThumbnail } from '../src/core/thumbnails';

const media = (mediaKind: 'video' | 'image' | 'audio'): LibraryEntry =>
  ({ kind: 'media', key: 'k', id: 'abc', path: '/x', root: '/', name: 'x', mediaKind, ext: '.x', size: 0, mtimeMs: 0, tags: [] }) as LibraryEntry;

describe('thumbnails', () => {
  it('names files and URLs by id', () => {
    expect(thumbUrlFor('abc')).toBe('pulp-thumb://abc/');
    expect(thumbFileName('abc')).toBe('abc.png');
  });

  it('skips audio', () => {
    expect(wantsThumbnail(media('video'))).toBe(true);
    expect(wantsThumbnail(media('image'))).toBe(true);
    expect(wantsThumbnail(media('audio'))).toBe(false);
  });

  it('seeks a tenth into video, not into images or unknown durations, and never enlarges', () => {
    const video = mediaThumbArgs('/in.mov', '/out.png', 20, true);
    expect(video.slice(0, 7)).toEqual(['-v', 'error', '-y', '-ss', '2.000', '-i', '/in.mov']);
    expect(video).toContain('-frames:v');
    expect(video.join(' ')).toContain(`min(iw,${THUMB_SIZE})`);
    expect(video.at(-1)).toBe('/out.png');
    expect(mediaThumbArgs('/in.png', '/out.png', undefined, false)).not.toContain('-ss');
    expect(mediaThumbArgs('/in.mov', '/out.png', undefined, true)).not.toContain('-ss');
    expect(posterThumbArgs('/poster.png', '/out.png').join(' ')).toContain('format=rgba');
  });
});
