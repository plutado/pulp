import { describe, expect, it } from 'vitest';
import {
  cardHeight,
  columnsFor,
  DEFAULT_RESULTS_VIEW,
  entryBadges,
  entryDuration,
  listRow,
  resultsKind,
  sanitizeResultsView,
  snapThumbSize,
  THUMB_SIZES,
  viewModeFor,
  withThumbSize,
  withViewMode,
  CARD_PADDING,
} from '../src/core/results-view';
import type { MediaEntry, TemplateEntry } from '../src/core/library-types';
import { validManifest } from './fixtures';

function template(name: string, manifestOverrides: Record<string, unknown> = {}, overrides: Partial<TemplateEntry> = {}): TemplateEntry {
  const manifest = validManifest({ id: `test.${name.toLowerCase()}`, name, ...manifestOverrides });
  return { kind: 'template', key: name, id: `id-${name}`, dir: `/lib/packs/boardroom/${name}`, root: '/lib', manifest, tags: [...manifest.tags], warnings: [], ...overrides };
}

function media(name: string, overrides: Partial<MediaEntry> = {}): MediaEntry {
  return { kind: 'media', key: name, id: `id-${name}`, path: `/lib/clips/${name}.mov`, root: '/lib', name, mediaKind: 'video', ext: '.mov', size: 1024, mtimeMs: 0, tags: [], ...overrides };
}

describe('view mode', () => {
  it('starts as a grid for anything visual and a list for audio only', () => {
    expect(resultsKind([])).toBe('visual');
    expect(resultsKind([media('song', { mediaKind: 'audio' })])).toBe('audio');
    // A mixed set is visual: one audio file must not turn the whole grid into a list.
    expect(resultsKind([media('song', { mediaKind: 'audio' }), media('clip')])).toBe('visual');
    expect(viewModeFor(DEFAULT_RESULTS_VIEW, [media('clip')])).toBe('grid');
    expect(viewModeFor(DEFAULT_RESULTS_VIEW, [media('song', { mediaKind: 'audio' })])).toBe('list');
  });

  it('remembers the toggle per kind and returns the same object when nothing changes', () => {
    const listed = withViewMode(DEFAULT_RESULTS_VIEW, 'visual', 'list');
    expect(listed.mode).toEqual({ visual: 'list', audio: 'list' });
    expect(withViewMode(listed, 'visual', 'list')).toBe(listed);
    // The audio toggle is untouched by the visual one.
    const both = withViewMode(listed, 'audio', 'grid');
    expect(both.mode).toEqual({ visual: 'list', audio: 'grid' });
    expect(viewModeFor(both, [media('song', { mediaKind: 'audio' })])).toBe('grid');
  });

  it('snaps the thumbnail size to an offered step', () => {
    expect(snapThumbSize(161)).toBe(160);
    expect(snapThumbSize(999)).toBe(THUMB_SIZES[THUMB_SIZES.length - 1]);
    expect(snapThumbSize(0)).toBe(THUMB_SIZES[0]);
    expect(snapThumbSize('big')).toBe(DEFAULT_RESULTS_VIEW.thumbSize);
    expect(withThumbSize(DEFAULT_RESULTS_VIEW, 158)).toBe(DEFAULT_RESULTS_VIEW);
    expect(withThumbSize(DEFAULT_RESULTS_VIEW, 200).thumbSize).toBe(200);
  });

  it('falls back to the defaults for missing or damaged settings', () => {
    expect(sanitizeResultsView(undefined)).toEqual(DEFAULT_RESULTS_VIEW);
    expect(sanitizeResultsView({ mode: { visual: 'cards' }, thumbSize: null })).toEqual(DEFAULT_RESULTS_VIEW);
    expect(sanitizeResultsView({ mode: { audio: 'grid' }, thumbSize: 260 })).toEqual({ mode: { visual: 'grid', audio: 'grid' }, thumbSize: 260 });
  });
});

describe('card geometry', () => {
  it('fits as many cards across as the width allows, never fewer than one', () => {
    expect(columnsFor(640, 160)).toBe(4);
    expect(columnsFor(639, 160)).toBe(3);
    expect(columnsFor(100, 160)).toBe(1);
    expect(columnsFor(0, 160)).toBe(1);
    expect(columnsFor(Number.NaN, 160)).toBe(1);
  });

  it('is a 16:9 thumbnail plus the text block, padding included', () => {
    const width = 160;
    const thumb = Math.round(((width - CARD_PADDING * 2) * 9) / 16);
    expect(cardHeight(width)).toBe(CARD_PADDING * 2 + thumb + 4 + 40);
    expect(cardHeight(260)).toBeGreaterThan(cardHeight(160));
  });
});

describe('badges', () => {
  it('shows alpha, loop, duration, resolution and pack for a template', () => {
    const entry = template('Background', { category: 'background', alpha: false, duration: 6, width: 1920, height: 1080 }, { pack: { name: 'Boardroom', slug: 'boardroom' } });
    expect(entryBadges(entry).map((b) => [b.id, b.label])).toEqual([
      // "background" maps to the animated-loop type, which is what the loop badge reads.
      ['loop', 'Loop'],
      ['duration', '6 s'],
      ['resolution', '1080p'],
      ['pack', 'Boardroom'],
    ]);
    const alpha = template('Strap', { category: 'lower-third', alpha: true, duration: 6, width: 1920, height: 1080 }, { pack: undefined });
    expect(entryBadges(alpha).map((b) => b.id)).toEqual(['alpha', 'duration', 'resolution']);
    expect(entryBadges(alpha).find((b) => b.id === 'resolution')?.tip).toBe('1920 × 1080');
  });

  it('badges vertical and square shapes, so a tall item is recognizable without reading its size', () => {
    const shapes = (over: Record<string, unknown>) => entryBadges(template('Shape', { alpha: false, duration: 1, ...over })).filter((b) => b.id === 'vertical' || b.id === 'square');
    // A declared landscape size: nothing to say.
    expect(shapes({ width: 1920, height: 1080 })).toEqual([]);
    const tall = { aspects: ['9:16'], width: undefined, height: undefined };
    expect(shapes(tall)).toEqual([{ id: 'vertical', label: 'Vertical', tip: 'Vertical' }]);
    // Several shapes: the poster is landscape, so the badge says what else it draws.
    expect(shapes({ aspects: ['16:9', '9:16', '4:5'], width: undefined, height: undefined })).toEqual([{ id: 'vertical', label: 'Vertical', tip: 'Draws tall as well (9:16, 4:5)' }]);
    expect(shapes({ aspects: ['16:9', '1:1'], width: undefined, height: undefined })).toEqual([{ id: 'square', label: 'Square', tip: 'Draws square as well (1:1)' }]);
    // Media: from the probed size.
    expect(entryBadges(media('tall', { meta: { width: 1080, height: 1920 } as MediaEntry['meta'] })).map((b) => b.id)).toEqual(['resolution', 'vertical']);
    expect(entryBadges(media('sq', { meta: { width: 720, height: 720 } as MediaEntry['meta'] })).map((b) => b.id)).toEqual(['resolution', 'square']);
    expect(entryBadges(media('wide', { meta: { width: 1920, height: 1080 } as MediaEntry['meta'] })).map((b) => b.id)).toEqual(['resolution']);
  });

  it('shows what a media file has been probed for, and nothing it has not', () => {
    const bare = media('clip');
    expect(entryBadges(bare)).toEqual([]);
    const probed = media('clip', { meta: { duration: 95.4, width: 1920, height: 1080, alpha: true } as MediaEntry['meta'] });
    expect(entryBadges(probed).map((b) => [b.id, b.label])).toEqual([
      ['alpha', 'Alpha'],
      ['duration', '1:35'],
      ['resolution', '1080p'],
    ]);
    // A folder-typed loop badges as one, like a template of the same type.
    expect(entryBadges(media('loop', { type: 'animated-loop' })).map((b) => b.id)).toEqual(['loop']);
  });

  it('reads the duration a template declares and a media file was probed for', () => {
    expect(entryDuration(template('Strap', { duration: 6 }))).toBe(6);
    expect(entryDuration(media('clip'))).toBeUndefined();
    expect(entryDuration(media('clip', { meta: { duration: 2 } as MediaEntry['meta'] }))).toBe(2);
  });
});

describe('list columns', () => {
  it('names, times and types a template, and says which folder it is in', () => {
    const entry = template('Strap', { category: 'lower-third', duration: 6, themes: ['corporate'] }, { themes: ['corporate', 'my-show'] });
    expect(listRow(entry)).toEqual({ name: 'Strap', duration: '6 s', type: 'Lower third', themes: 'Corporate, My show', file: 'Strap' });
  });

  it('falls back to the media kind when no folder typed the file', () => {
    expect(listRow(media('clip'))).toEqual({ name: 'clip', duration: '', type: 'Video', themes: '', file: 'clip.mov' });
    const typed = media('swipe', { mediaKind: 'audio', ext: '.wav', path: '/lib/sfx/whoosh/swipe.wav', type: 'whoosh', meta: { duration: 1.25 } as MediaEntry['meta'] });
    expect(listRow(typed)).toMatchObject({ duration: '1.3 s', type: 'Whoosh / transition', file: 'swipe.wav' });
  });
});
