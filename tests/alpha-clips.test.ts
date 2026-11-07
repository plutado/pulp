/**
 * Clips that work as they are (milestone 32): video with transparency — QuickTime Animation and
 * PNG, ProRes 4444, VP9 with alpha — at whatever size and rate the library used, including a
 * size that is no standard frame, read for a video layer with its alpha, its shape and its rate
 * kept, and placed to fit the frame. Every clip is generated (tests/stock-fixture.ts).
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { clipFramesArgs, splitPngStream } from '../src/main/clip-grant';
import { detectFfmpeg, nodeRunner } from '../src/core/ffmpeg';
import { itemId } from '../src/core/library-scan';
import type { MediaEntry } from '../src/core/library-types';
import { ffprobePathFor, probeMedia } from '../src/core/media-probe';
import { alphaDecoderFor } from '../src/core/media-meta';
import { clipFitsFrame, clipFrameAt, EMPTY_CLIP, type ClipSource } from '../src/core/video-layer';
import { ALPHA_CLIP_SIZE, writeAlphaClipsFixture } from './stock-fixture';

const media = (path: string, extra: Partial<MediaEntry> = {}): MediaEntry => {
  const key = `media:${path}`;
  return { kind: 'media', key, id: itemId(key), path, root: '/lib', name: basename(path), mediaKind: 'video', ext: path.slice(path.lastIndexOf('.')), size: 0, mtimeMs: 0, tags: [], ...extra };
};

/** A PNG's size and whether it carries alpha, from its header. */
function pngHeader(png: Buffer): { width: number; height: number; alpha: boolean } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), alpha: png[25] === 6 || png[25] === 4 };
}

describe('placing a clip from the library', () => {
  it('fits a transparent clip, a clip set or a frame sequence to the frame, and leaves opaque footage a picture to place', () => {
    expect(clipFitsFrame(media('/lib/Lower Third.mov', { meta: { alpha: true, width: 1000, height: 400 } }))).toBe(true);
    expect(clipFitsFrame(media('/lib/Swoosh.mov', { clipSet: { loop: '/lib/Swoosh Loop.mov' } }))).toBe(true);
    expect(clipFitsFrame(media('/lib/fire_0001.png', { sequence: { dir: '/lib', stem: 'fire_', ext: '.png', digits: 4, start: 1, count: 20 } }))).toBe(true);
    expect(clipFitsFrame(media('/lib/Interview.mp4', { meta: { alpha: false, width: 1920, height: 1080 } }))).toBe(false);
    expect(clipFitsFrame(media('/lib/Unprobed.mov'))).toBe(false);
  });

  it('counts a clip\'s frames at its own rate inside a graphic at another', () => {
    const source: ClipSource = { frames: 12, fps: 12 };
    const value = { ...EMPTY_CLIP, id: 'clip', ending: 'once' as const };
    // At 30 fps the graphic asks for a frame every 1/30 s; the clip answers with the frame of its own 1/12 s that holds it.
    expect([0, 1, 2, 3, 4, 5].map((f) => clipFrameAt(f / 30, value, source))).toEqual([0, 0, 0, 1, 1, 2]);
    expect(clipFrameAt(11 / 12, value, source)).toBe(11);
    expect(clipFrameAt(1, value, source)).toBeNull();
  });
});

const ffmpeg = await detectFfmpeg();

describe.skipIf(!ffmpeg.ok)('transparent clips read as they are (needs ffmpeg)', () => {
  let dir = '';
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('keeps the alpha, the size that is no standard frame and the rate of each format, decoded for a video layer', async () => {
    if (!ffmpeg.ok) return;
    dir = await mkdtemp(join(tmpdir(), 'pulp-alpha-'));
    const files = await writeAlphaClipsFixture(ffmpeg.path, ffmpeg.encoders, join(dir, 'Overlays'));
    expect(files.length, 'at least Animation and PNG, which every ffmpeg writes').toBeGreaterThanOrEqual(2);
    const { width, height, fps, seconds } = ALPHA_CLIP_SIZE;
    for (const file of files) {
      // Measured as made: transparent, 300 × 120, 12 fps.
      const meta = (await probeMedia(ffprobePathFor(ffmpeg.path), file, nodeRunner))!;
      expect(meta, basename(file)).toMatchObject({ alpha: true, width, height, fps });
      expect(meta.duration, basename(file)).toBeCloseTo(seconds, 1);
      // Decoded for a layer drawn small: its shape kept, scaled to fit without enlarging, alpha in every frame.
      const entry = media(file, { meta });
      const source: ClipSource = { frames: Math.round(meta.duration! * fps), fps };
      const small = spawnSync(ffmpeg.path, clipFramesArgs(entry, source, { first: 0, frames: 6 }, 150), { maxBuffer: 64 * 1024 * 1024 });
      expect(small.status, `${basename(file)}: ${small.stderr}`).toBe(0);
      const pngs = splitPngStream(small.stdout);
      expect(pngs, basename(file)).toHaveLength(6);
      expect(pngHeader(pngs[0]!), basename(file)).toEqual({ width: 150, height: 60, alpha: true });
      // Drawn large, it is read at its own size and no larger: nothing is padded to a standard frame.
      const large = spawnSync(ffmpeg.path, clipFramesArgs(entry, source, { first: 6, frames: 2 }, 1080), { maxBuffer: 64 * 1024 * 1024 });
      expect(large.status, basename(file)).toBe(0);
      expect(pngHeader(splitPngStream(large.stdout)[0]!), basename(file)).toEqual({ width, height, alpha: true });
      // The pixels say so too, through Pulp's own decode: the box is opaque, the rest of the frame
      // clear. A WebM's alpha needs libvpx (alphaDecoderFor); ffmpeg's own VP9 decoder leaves it out.
      const full = splitPngStream(large.stdout)[0]!;
      const rgba = spawnSync(ffmpeg.path, ['-v', 'error', '-f', 'image2pipe', '-i', 'pipe:0', '-vf', 'format=rgba', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], { input: full, maxBuffer: 64 * 1024 * 1024 }).stdout;
      const at = (x: number, y: number) => rgba[(y * width + x) * 4 + 3]!;
      expect(at(10, 10), `${basename(file)}: the box`).toBeGreaterThan(200);
      expect(at(width - 10, height - 10), `${basename(file)}: the clear part`).toBeLessThan(40);
      expect(alphaDecoderFor(meta), basename(file)).toBe(file.endsWith('.webm') ? 'libvpx-vp9' : undefined);
    }
  });
});
