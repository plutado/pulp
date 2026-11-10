/**
 * HDR clips made ready to use (milestone 81): what the probe makes of a
 * phone's HDR file, the one conversion recipe, and that it reaches every
 * place a clip's pixels are read — the preview's frames, the render's cut
 * track, an item rendered on its own — always in front of everything else,
 * and never by writing to the file.
 */

import { describe, expect, it } from 'vitest';
import { featureStatus } from '../src/core/ffmpeg-needs';
import { hdrFromTransfer, HDR_TRANSFERS, TONEMAP_PEAK_NITS, tonemapPrefix, tonemapSteps } from '../src/core/hdr';
import { parseFfprobe } from '../src/core/media-meta';
import { ffprobeArgs } from '../src/core/media-probe';
import { clipFramesArgs } from '../src/main/clip-grant';
import { buildRenderPlan } from '../src/core/render-plan';
import { buildMediaRenderPlan, sourceFromEntry } from '../src/core/media-render';
import { entryBadges } from '../src/core/results-view';
import { formatRows } from '../src/core/item-info';
import type { LibraryEntry, MediaEntry } from '../src/core/library-types';

/** ffprobe 8's own output for a clip as an iPhone records it: HLG, BT.2020, 10-bit HEVC. */
const PHONE_HLG = `{
    "streams": [
        { "codec_name": "hevc", "codec_type": "video", "width": 1920, "height": 1080, "pix_fmt": "yuv420p10le", "color_transfer": "arib-std-b67", "r_frame_rate": "30/1", "avg_frame_rate": "30/1" },
        { "codec_name": "aac", "codec_type": "audio", "sample_rate": "44100", "channels": 2 }
    ],
    "format": { "duration": "2.000000" }
}`;

/** The same shape of file recorded as HDR10: PQ. */
const PHONE_PQ = PHONE_HLG.replace('arib-std-b67', 'smpte2084');

/** And an ordinary standard-range clip, which must stay exactly as it was. */
const SDR = PHONE_HLG.replace('"color_transfer": "arib-std-b67", ', '');

const media = (over: Partial<MediaEntry> = {}): MediaEntry => ({
  kind: 'media',
  id: 'clip',
  name: 'IMG_0042',
  path: '/lib/IMG_0042.mov',
  ext: '.mov',
  mediaKind: 'video',
  size: 1024,
  mtimeMs: 1,
  tags: [],
  themes: [],
  ...over,
} as MediaEntry);

describe('seen for what it is', () => {
  it('reads the transfer the file tags itself with, and leaves standard range alone', () => {
    expect(parseFfprobe(PHONE_HLG)?.hdr).toBe('hlg');
    expect(parseFfprobe(PHONE_PQ)?.hdr).toBe('pq');
    expect(parseFfprobe(SDR)).not.toHaveProperty('hdr');
    // The probe has to ask for it, or there is nothing to read.
    expect(ffprobeArgs('/lib/IMG_0042.mov').join(' ')).toContain('color_transfer');
  });

  it('knows the names a transfer is written under, and nothing else', () => {
    expect(hdrFromTransfer('smpte2084')).toBe('pq');
    expect(hdrFromTransfer('SMPTE-ST-2084')).toBe('pq');
    expect(hdrFromTransfer('arib-std-b67')).toBe('hlg');
    expect(hdrFromTransfer('bt709')).toBeUndefined();
    expect(hdrFromTransfer('')).toBeUndefined();
    expect(hdrFromTransfer(undefined)).toBeUndefined();
  });

  it('marks it in the library: a word on the card and a row in the Info tab, saying what becomes of it', () => {
    const hdr = media({ meta: { width: 1920, height: 1080, duration: 2, fps: 30, hdr: 'hlg' } }) as LibraryEntry;
    expect(entryBadges(hdr).map((b) => b.id)).toContain('hdr');
    expect(entryBadges(hdr).find((b) => b.id === 'hdr')?.tip).toContain('HDR (HLG)');
    const row = () => formatRows(hdr, { tonemap: true }).find((r) => r.label === 'Range')!;
    expect(row().value).toContain('converted to standard range');
    expect(row().value).toContain('file itself is left as it is');
    expect(row().tone).toBeUndefined();
    // Without zimg the row says so plainly, with what to do, and is marked as wanting a second look.
    const without = formatRows(hdr, { tonemap: false }).find((r) => r.label === 'Range')!;
    expect(without.value).toContain('without zimg');
    expect(without.value).toContain('Install an FFmpeg built with zimg');
    expect(without.tone).toBe('warn');
    // A standard-range clip says nothing about range at all, and wears no badge.
    const sdr = media({ meta: { width: 1920, height: 1080, duration: 2, fps: 30 } }) as LibraryEntry;
    expect(formatRows(sdr).find((r) => r.label === 'Range')).toBeUndefined();
    expect(entryBadges(sdr).map((b) => b.id)).not.toContain('hdr');
  });
});

describe('the conversion itself', () => {
  it('undoes the file\'s own curve, brings the gamut over, and maps the range to Rec. 709', () => {
    const steps = tonemapSteps('hlg');
    expect(steps[0]).toContain(`tin=${HDR_TRANSFERS.hlg}`);
    expect(steps[0]).toContain(`npl=${TONEMAP_PEAK_NITS}`);
    expect(steps[0]).toContain('t=linear');
    // The curve runs in float, or a sky bands.
    expect(steps).toContain('format=gbrpf32le');
    expect(steps).toContain('tonemap=tonemap=hable:desat=0');
    expect(steps[steps.length - 1]).toBe('zscale=t=bt709:m=bt709:r=tv');
    // PQ differs only in what it undoes.
    expect(tonemapSteps('pq')[0]).toContain(`tin=${HDR_TRANSFERS.pq}`);
    expect(tonemapSteps('pq').slice(1)).toEqual(steps.slice(1));
    expect(tonemapPrefix(undefined)).toBe('');
    expect(tonemapPrefix('pq')).toBe(`${tonemapSteps('pq').join(',')},`);
  });

  it('is offered only by an ffmpeg that carries zimg and the curve, through the feature table (milestone 88)', () => {
    const caps = (filters: string[]) => ({ filters, encoders: null, decoders: null });
    expect(featureStatus(caps(['scale', 'zscale', 'tonemap']), 'hdr').ok).toBe(true);
    expect(featureStatus(caps(['scale']), 'hdr')).toMatchObject({ ok: false, missing: ['zscale', 'tonemap'], library: 'libzimg' });
    expect(featureStatus(caps(['tonemap']), 'hdr').missing).toEqual(['zscale']);
  });
});

describe('everywhere a clip is read', () => {
  const source = { frames: 60, fps: 30 };
  const window = { first: 0, frames: 10 };

  it('converts the preview\'s and the render\'s frames before anything else sees them', () => {
    const entry = media({ meta: { width: 1920, height: 1080, fps: 30, duration: 2, hdr: 'hlg' } });
    const vf = (args: string[]) => args[args.indexOf('-vf') + 1]!;
    const converted = vf(clipFramesArgs(entry, source, window, 512, { tonemap: 'hlg' }));
    expect(converted.startsWith(tonemapPrefix('hlg'))).toBe(true);
    // The grade is a look drawn for standard range, so it comes after the conversion, before the scale.
    const graded = vf(clipFramesArgs(entry, source, window, 512, { tonemap: 'hlg', lut: '/looks/warm.cube' }));
    expect(graded.indexOf('tonemap=')).toBeLessThan(graded.indexOf('lut3d'));
    expect(graded.indexOf('lut3d')).toBeLessThan(graded.indexOf('scale=w='));
    // Not asked for — a standard-range clip, or an ffmpeg that cannot — and the arguments are what they always were.
    expect(vf(clipFramesArgs(entry, source, window, 512))).not.toContain('tonemap');
    expect(vf(clipFramesArgs(entry, source, window, 512))).toBe(vf(clipFramesArgs(media(), source, window, 512)));
  });

  it('converts a cut on the track before its speed, its framing and the graphic over it', () => {
    const plan = (tonemap: boolean) => buildRenderPlan({
      manifest: { fps: 30, duration: 2, alpha: true, aspects: ['16:9'], size: { width: 320, height: 180 } },
      presetId: 'h264-mp4',
      outputPath: '/out/render.mp4',
      track: { cuts: [{ path: '/lib/IMG_0042.mov', from: 0, to: 2, ...(tonemap ? { tonemap: 'pq' as const } : {}) }] },
    });
    const graph = plan(true).args[plan(true).args.indexOf('-filter_complex') + 1]!;
    const cut = graph.split(';').find((c) => c.startsWith('[1:v]'))!;
    expect(cut.startsWith(`[1:v]${tonemapSteps('pq').join(',')},`)).toBe(true);
    // The letterbox scale — not zscale, which is part of the conversion — comes after it.
    expect(cut.indexOf('tonemap=')).toBeLessThan(cut.indexOf(',scale='));
    // A standard-range cut is rendered exactly as it was before any of this.
    const plain = plan(false).args[plan(false).args.indexOf('-filter_complex') + 1]!;
    expect(plain).not.toContain('zscale');
  });

  it('converts an item rendered on its own, and warns instead where the ffmpeg cannot', () => {
    const entry = media({ meta: { width: 1920, height: 1080, fps: 30, duration: 2, hdr: 'pq' } });
    const source = sourceFromEntry(entry);
    expect(source.hdr).toBe('pq');
    const made = (tonemap: boolean) => buildMediaRenderPlan({ source, presetId: 'h264-mp4', outputPath: '/out/clip.mp4', tonemap });
    const args = made(true).stages[0]!.args.join(' ');
    expect(args).toContain('tonemap=tonemap=hable');
    expect(made(true).warnings).toEqual([]);
    const without = made(false);
    expect(without.stages[0]!.args.join(' ')).not.toContain('zscale');
    expect(without.warnings.join(' ')).toContain('without zimg');
    // And a standard-range item is untouched either way.
    const sdr = sourceFromEntry(media({ meta: { width: 1920, height: 1080, fps: 30, duration: 2 } }));
    expect(buildMediaRenderPlan({ source: sdr, presetId: 'h264-mp4', outputPath: '/out/clip.mp4', tonemap: false }).warnings).toEqual([]);
  });

  it('never writes to the file it read: every argument list reads the original and writes elsewhere', () => {
    const entry = media({ meta: { width: 1920, height: 1080, fps: 30, duration: 2, hdr: 'hlg' } });
    const args = clipFramesArgs(entry, source, window, 512, { tonemap: 'hlg' });
    expect(args).toContain('pipe:1');
    expect(args.filter((a) => a === entry.path)).toHaveLength(1);
    expect(args[args.indexOf(entry.path) - 1]).toBe('-i');
    expect(args).not.toContain('-y');
  });
});
