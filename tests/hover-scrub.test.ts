import { describe, expect, it } from 'vitest';
import {
  framesStripArgs,
  mediaStripArgs,
  STRIP_FRAMES,
  stripFileName,
  stripFrameIndices,
  stripUrlFor,
  stripWidthPercent,
  tileAt,
  tilePercent,
  wantsStrip,
} from '../src/core/hover-scrub';
import type { MediaEntry, TemplateEntry } from '../src/core/library-types';
import { validManifest } from './fixtures';

function template(over: Record<string, unknown> = {}, entry: Partial<TemplateEntry> = {}): TemplateEntry {
  const manifest = validManifest(over);
  return { kind: 'template', key: 'k', id: 'id-t', dir: '/lib/t', root: '/lib', manifest, tags: [], warnings: [], ...entry };
}
function media(over: Partial<MediaEntry> = {}): MediaEntry {
  return { kind: 'media', key: 'k', id: 'id-m', path: '/lib/clip.mov', root: '/lib', name: 'clip', mediaKind: 'video', ext: '.mov', size: 1, mtimeMs: 0, tags: [], ...over };
}

describe('what gets a strip', () => {
  it('is what moves and is reachable', () => {
    expect(wantsStrip(template())).toBe(true);
    expect(wantsStrip(media({ meta: { duration: 4 } as MediaEntry['meta'] }))).toBe(true);
    // Not probed yet: there is no duration to spread frames over, so it waits.
    expect(wantsStrip(media())).toBe(false);
    expect(wantsStrip(media({ mediaKind: 'image', meta: { width: 8, height: 8 } as MediaEntry['meta'] }))).toBe(false);
    expect(wantsStrip(media({ mediaKind: 'audio', meta: { duration: 4 } as MediaEntry['meta'] }))).toBe(false);
    expect(wantsStrip(template({}, { offline: true }))).toBe(false);
  });

  it('addresses a strip by id, apart from the poster of the same item', () => {
    expect(stripUrlFor('abc')).toBe('pulp-strip://abc/');
    expect(stripFileName('abc')).toBe('abc-strip.png');
  });
});

describe('frames sampled from a template', () => {
  it('spreads evenly from the first frame to the last', () => {
    expect(stripFrameIndices(180)).toEqual([0, 26, 51, 77, 102, 128, 153, 179]);
    expect(stripFrameIndices(8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('always fills the strip, repeating frames when the template is shorter than it', () => {
    // Eight tiles whatever the template: the card places a tile without knowing how many there are.
    expect(stripFrameIndices(3)).toEqual([0, 0, 1, 1, 1, 1, 2, 2]);
    expect(stripFrameIndices(1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(stripFrameIndices(0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(stripFrameIndices(180, 1)).toEqual([89]);
  });
});

describe('ffmpeg arguments', () => {
  it('asks a clip for a little more than the strip holds, so the last tile is never blank', () => {
    const args = mediaStripArgs('/in.mov', '/out.png', 4);
    const vf = args[args.indexOf('-vf') + 1]!;
    // 8 tiles over 4 s is 2 fps; the 8% margin covers a clip that ends a frame early.
    expect(vf).toContain('fps=2.160000');
    expect(vf).toContain(`tile=${STRIP_FRAMES}x1`);
    expect(args).toContain('-an');
    expect(args.at(-1)).toBe('/out.png');
    // A duration of zero would divide by nothing; it is floored instead.
    expect(mediaStripArgs('/in.mov', '/out.png', 0).join(' ')).toContain('fps=86.400000');
  });

  it('tiles frames that arrive on stdin, with no scratch folder to name', () => {
    const args = framesStripArgs('/out.png', 5);
    expect(args[args.indexOf('-i') + 1]).toBe('pipe:0');
    expect(args.join(' ')).toContain('-f image2pipe -c:v png');
    expect(args[args.indexOf('-vf') + 1]).toContain('tile=5x1');
    expect(args.at(-1)).toBe('/out.png');
  });
});

describe('sprite arithmetic', () => {
  it('maps a pointer across the picture onto a frame, clamped at both ends', () => {
    expect(tileAt(0)).toBe(0);
    expect(tileAt(0.5)).toBe(4);
    expect(tileAt(0.99)).toBe(7);
    // The right edge and anything past it is the last frame, not one off the end.
    expect(tileAt(1)).toBe(STRIP_FRAMES - 1);
    expect(tileAt(1.4)).toBe(STRIP_FRAMES - 1);
    expect(tileAt(-0.2)).toBe(0);
    expect(tileAt(Number.NaN)).toBe(0);
  });

  it('places a frame with the percentage CSS wants: the last tile is 100%, not 800%', () => {
    expect(stripWidthPercent()).toBe(800);
    expect(tilePercent(0)).toBe(0);
    expect(tilePercent(STRIP_FRAMES - 1)).toBe(100);
    expect(tilePercent(4)).toBeCloseTo((4 / 7) * 100, 6);
    expect(tilePercent(99)).toBe(100);
    expect(tilePercent(0, 1)).toBe(0);
  });
});
