import { describe, expect, it } from 'vitest';
import {
  aboutRows,
  aspectLabel,
  creditsRows,
  dateLabel,
  fileRows,
  formatRows,
  INFO_SECTIONS,
  pieceLabel,
  typeRow,
  usageRows,
} from '../src/core/item-info';
import type { MediaEntry, TemplateEntry } from '../src/core/library-types';
import type { TemplateManifest } from '../src/core/manifest';
import { rawManifest } from './fixtures';

function template(over: Record<string, unknown> = {}, entry: Partial<TemplateEntry> = {}): TemplateEntry {
  const manifest = rawManifest({ name: 'Boardroom lower third', ...over }) as unknown as TemplateManifest;
  return { kind: 'template', key: 'k', id: 'id', dir: '/lib/boardroom/lower-third', root: '/lib', manifest, tags: [], warnings: [], ...entry };
}
function media(over: Partial<MediaEntry> = {}): MediaEntry {
  return { kind: 'media', key: 'k', id: 'id', path: '/lib/clips/clip.mov', root: '/lib', name: 'clip', mediaKind: 'video', ext: '.mov', size: 2048, mtimeMs: 1_700_000_000_000, tags: [], ...over };
}

const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value;

describe('Format', () => {
  it('reads a template off its manifest, duration as a length rather than a last frame', () => {
    const rows = formatRows(template({ width: 1920, height: 1080, duration: 6, fps: 30, alpha: true, category: 'lower-third' }));
    expect(value(rows, 'Aspect')).toBe('16:9');
    expect(value(rows, 'Size')).toBe('1920 × 1080');
    expect(value(rows, 'Duration')).toBe('6 s · 00:00:06:00');
    expect(value(rows, 'Frame rate')).toBe('30 fps');
    expect(value(rows, 'Alpha')).toBe('Transparent background');
    expect(rows.find((r) => r.label === 'Duration')?.icon).toBe('duration');
    // A lower third does not loop; a background does.
    expect(value(rows, 'Loop')).toBeUndefined();
    expect(value(formatRows(template({ category: 'background' })), 'Loop')).toBe('Made to loop seamlessly');
  });

  it('reads media off what ffprobe found, and says nothing it has not been told', () => {
    expect(formatRows(media()).map((r) => r.label)).toEqual(['Kind']);
    const rows = formatRows(
      media({ meta: { width: 1080, height: 1920, duration: 95, fps: 25, codec: 'prores', alpha: true, audioCodec: 'pcm_s16le', channels: 2, sampleRate: 48000 } as MediaEntry['meta'] }),
    );
    expect(value(rows, 'Kind')).toBe('Video · MOV');
    expect(value(rows, 'Aspect')).toBe('9:16');
    expect(value(rows, 'Duration')).toBe('1:35 · 00:01:35:00');
    expect(value(rows, 'Codec')).toBe('ProRes');
    expect(value(rows, 'Audio')).toBe('PCM 16-bit · 2 ch · 48 kHz');
  });
});

describe('aspect', () => {
  it('names the common shapes and falls back to a ratio', () => {
    expect(aspectLabel(1920, 1080)).toBe('16:9');
    expect(aspectLabel(1080, 1920)).toBe('9:16');
    expect(aspectLabel(1080, 1080)).toBe('1:1');
    expect(aspectLabel(1080, 1350)).toBe('4:5');
    expect(aspectLabel(1999, 1000)).toBe('2.00:1');
    expect(aspectLabel(undefined, 1080)).toBe('');
  });
});

describe('File', () => {
  it('shows where it is inside its library folder, with the full path for the tooltip', () => {
    const rows = fileRows(template());
    expect(value(rows, 'Location')).toBe('boardroom/lower-third');
    expect(rows.find((r) => r.label === 'Location')?.tip).toBe('/lib/boardroom/lower-third');
    // Nothing is claimed about a size or a date the scan did not record.
    expect(value(rows, 'Size on disk')).toBeUndefined();
    expect(value(fileRows(template({}, { size: 4096, mtimeMs: 1_700_000_000_000 })), 'Size on disk')).toBe('4 KB');
    expect(value(fileRows(media()), 'Location')).toBe('clips/clip.mov');
  });
});

describe('Credits', () => {
  it('badges the license, and warns when its terms are not known to be open', () => {
    const open = creditsRows(template({ author: 'Ada', license: 'CC0-1.0', version: '1.2.0' }));
    expect(value(open, 'Author')).toBe('Ada');
    expect(value(open, 'Version')).toBe('1.2.0');
    expect(open.find((r) => r.label === 'License')).toMatchObject({ value: 'CC0-1.0', badge: true });
    expect(open.find((r) => r.label === 'License')?.tone).toBeUndefined();

    const closed = creditsRows(template({ license: 'Acme-EULA' }));
    expect(closed.find((r) => r.label === 'License')).toMatchObject({ tone: 'warn' });
    expect(closed.find((r) => r.label === 'License')?.tip).toContain('not in the known open list');
    // Media has no manifest, so no credits to show.
    expect(creditsRows(media())).toEqual([]);
  });
});

describe('Usage and About', () => {
  it('says "not yet" rather than nothing', () => {
    const rows = usageRows(template(), 0);
    expect(value(rows, 'Last used')).toBe('Not yet');
    expect(value(rows, 'Renders')).toBe('None yet');
    expect(value(rows, 'Saved presets')).toBe('None yet');
    const used = usageRows(template({}, { lastUsed: '2026-10-24T03:06:00Z', renderCount: 3 }), 2);
    expect(value(used, 'Renders')).toBe('3');
    expect(value(used, 'Saved presets')).toBe('2');
    expect(value(used, 'Last used')).toMatch(/2026/);
    // Media keeps no presets, so that row is left out.
    expect(usageRows(media(), 0).map((r) => r.label)).toEqual(['Last used', 'Renders']);
  });

  it('has nothing to say about a template without a description', () => {
    expect(aboutRows(template({ description: undefined }))).toEqual([]);
    expect(aboutRows(template({ description: 'A quiet strap.' }))[0]?.value).toBe('A quiet strap.');
    expect(aboutRows(media())).toEqual([]);
  });
});

describe('labels', () => {
  it('names a type and says where a media type came from', () => {
    expect(typeRow(template({ category: 'lower-third' }))?.value).toBe('Lower third');
    expect(typeRow(media({ type: 'whoosh' }))?.value).toBe('Whoosh / transition · from its folder');
    expect(typeRow(media())?.value).toBe('Video · no folder said more');
    expect(typeRow(template({ category: 'other' }))).toBeNull();
  });

  it('takes the set name off a piece, which otherwise says it twice', () => {
    expect(pieceLabel('Boardroom lower third', 'Boardroom')).toBe('Lower third');
    expect(pieceLabel('Boardroom wipe', 'Boardroom')).toBe('Wipe');
    // Nothing to take off, or nothing left if it were.
    expect(pieceLabel('Strap', 'Boardroom')).toBe('Strap');
    expect(pieceLabel('Boardroom', 'Boardroom')).toBe('Boardroom');
  });

  it('writes a date a reader can scan', () => {
    expect(dateLabel(Date.UTC(2026, 9, 24, 12, 5))).toMatch(/^24 Oct 2026, \d\d:\d\d$/);
    expect(dateLabel(0)).toBe('');
    expect(dateLabel(Number.NaN)).toBe('');
  });

  it('has a section for every part of the panel, in reading order', () => {
    expect(INFO_SECTIONS.map((s) => s.id)).toEqual(['about', 'format', 'categories', 'tags', 'set', 'file', 'credits', 'usage']);
  });
});
