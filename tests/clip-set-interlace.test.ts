/**
 * Clip sets made clean (milestone 83 for milestone 32's sets): a set's parts
 * are separate files, so each is read for its own scan and an interlaced one
 * deinterlaced alone, by its own field order, before the parts are joined —
 * never a progressive one — and the set keeps its rate and length. The stitch
 * (the stage's preview, the set file, an item render) and a video layer's
 * frames both take it, and a file stitched before is named apart from the
 * clean one. Then the same against the ffmpeg here, with generated parts.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFfmpeg } from '../src/core/ffmpeg';
import { clipSetLayersFramesArgs, clipSetLayersStitchArgs, stitchDeinterlaceKey, type ClipSetTiming, type StitchLayer } from '../src/core/clip-set';
import { deinterlacePrefix } from '../src/core/interlace';
import type { MediaEntry } from '../src/core/library-types';
import { clipFramesArgs } from '../src/main/clip-grant';
import { clipSetFieldsFor, forgetScans, scanOfPart, withClipSetFields } from '../src/main/interlace-service';
import { combScore, fixtureClipArgs, IL_FPS, IL_HEIGHT, IL_WIDTH } from './interlace-fixture';

const ffmpeg = await detectFfmpeg();
const canMake = ffmpeg.ok;

const timing: ClipSetTiming = { intro: 1, loop: 1, outro: 1 };
const files = { intro: '/lib/Swoosh In.mov', loop: '/lib/Swoosh Loop.mov', outro: '/lib/Swoosh Out.mov' };
const video = { fps: 25, width: 720, height: 576 };
const graphOf = (args: string[]) => args[args.indexOf('-filter_complex') + 1]!;
/** Each part's own chain in a graph: the one reading input `n`. */
const chainOf = (args: string[], n: number) => graphOf(args).split(';').find((c) => c.startsWith(`[${n}:v]`))!;

const setEntry = (over: Partial<MediaEntry> = {}): MediaEntry => ({
  kind: 'media', key: 'set', id: 'set', name: 'Swoosh', path: files.loop, root: '/lib', ext: '.mov', mediaKind: 'video',
  size: 1, mtimeMs: 1, tags: [], themes: [], clipSet: files,
  meta: { width: 720, height: 576, fps: 25, duration: 3, parts: timing },
  ...over,
} as MediaEntry);

describe('each part deinterlaced on its own, in the stitch', () => {
  it('puts an interlaced part\'s own step first in its own chain, and none in a progressive part\'s', () => {
    const layer: StitchLayer = { files, timing, deinterlace: { intro: 'tff', outro: 'bff' } };
    const args = clipSetLayersStitchArgs([layer], 3, video);
    expect(chainOf(args, 0).startsWith(`[0:v]${deinterlacePrefix('tff')}trim=`)).toBe(true);
    expect(chainOf(args, 1)).not.toContain('bwdif');
    expect(chainOf(args, 2).startsWith(`[2:v]${deinterlacePrefix('bff')}trim=`)).toBe(true);
    // Before the rate and the scale, which would mix the fields.
    expect(chainOf(args, 0).indexOf('bwdif')).toBeLessThan(chainOf(args, 0).indexOf('fps='));
    expect(chainOf(args, 0).indexOf('bwdif')).toBeLessThan(chainOf(args, 0).indexOf('scale='));
  });

  it('keeps the set\'s rate and length: only the deinterlacing differs from the plain stitch', () => {
    for (const length of [3, 7.5, 1.2]) {
      const plain = clipSetLayersStitchArgs([{ files, timing }], length, video, true);
      const clean = clipSetLayersStitchArgs([{ files, timing, deinterlace: { intro: 'tff', loop: 'bff', outro: 'tff' } }], length, video, true);
      expect(graphOf(clean).replace(/bwdif=[^,]*,/g, '')).toBe(graphOf(plain));
      expect(clean.filter((a) => a !== graphOf(clean))).toEqual(plain.filter((a) => a !== graphOf(plain)));
      expect(clean[clean.indexOf('-frames:v') + 1]).toBe(String(Math.round(length * 25)));
    }
  });

  it('reads each layer of a layered set by its own parts', () => {
    const flare: StitchLayer = { files: { intro: '/lib/Swoosh Flare In.mov', loop: '/lib/Swoosh Flare Loop.mov' }, timing: { intro: 1, loop: 2, outro: 0 }, deinterlace: { loop: 'tff' } };
    const args = clipSetLayersStitchArgs([{ files, timing }, flare], 3, video);
    for (const n of [0, 1, 2, 3]) expect(chainOf(args, n)).not.toContain('bwdif');
    expect(chainOf(args, 4).startsWith(`[4:v]${deinterlacePrefix('tff')}`)).toBe(true);
  });

  it('carries each part\'s step into a video layer\'s frames, never one over the joined picture', () => {
    const args = clipSetLayersFramesArgs([{ files, timing, deinterlace: { outro: 'bff' } }], video, { first: 0, frames: 10 }, 'scale=320:-2');
    expect(chainOf(args, 2).startsWith(`[2:v]${deinterlacePrefix('bff')}`)).toBe(true);
    expect(graphOf(args).split(';').filter((c) => c.includes('bwdif'))).toHaveLength(1);
    expect(graphOf(args).split(';').at(-1)).not.toContain('bwdif');
  });

  it('names a clean stitch apart from one made before, and a progressive set as it always was', () => {
    expect(stitchDeinterlaceKey([{}, { deinterlace: {} }])).toBe('');
    const intro = stitchDeinterlaceKey([{ deinterlace: { intro: 'tff' } }]);
    expect(intro).not.toBe('');
    expect(stitchDeinterlaceKey([{ deinterlace: { intro: 'bff' } }])).not.toBe(intro);
    expect(stitchDeinterlaceKey([{ deinterlace: { outro: 'tff' } }])).not.toBe(intro);
    expect(stitchDeinterlaceKey([{}, { deinterlace: { intro: 'tff' } }])).not.toBe(intro);
  });
});

describe('a video layer\'s frames of a set', () => {
  const source = { frames: 75, fps: 25, set: timing };
  const window = { first: 0, frames: 10 };

  it('deinterlaces the parts its reading names, and only those', () => {
    const args = clipFramesArgs(setEntry(), source, window, 512, { setFields: [{ intro: 'tff' }], tonemap: 'hlg' });
    expect(chainOf(args, 0).startsWith(`[0:v]${deinterlacePrefix('tff')}`)).toBe(true);
    expect(chainOf(args, 1)).not.toContain('bwdif');
    expect(chainOf(args, 2)).not.toContain('bwdif');
    // The HDR step stays after the join; no deinterlacing of the joined picture, even if asked.
    const asked = clipFramesArgs(setEntry(), source, window, 512, { deinterlace: 'tff' });
    expect(graphOf(asked)).not.toContain('bwdif');
  });

  it('reads nothing when a person turned it off, for the set or for the render', async () => {
    const layers = [{ files }];
    expect(await clipSetFieldsFor('/nowhere/ffmpeg', setEntry({ deinterlace: false }), layers)).toEqual([{}]);
    expect(await clipSetFieldsFor('/nowhere/ffmpeg', setEntry(), layers, true)).toEqual([{}]);
    expect(await withClipSetFields('/nowhere/ffmpeg', setEntry(), [{ files, timing }], true)).toEqual([{ files, timing }]);
    // A part that cannot be read is read as it is.
    expect(await scanOfPart('/nowhere/ffmpeg', '/nowhere/Swoosh In.mov')).toBeUndefined();
  });
});

describe.skipIf(!canMake)('generated parts against the ffmpeg here (needs ffmpeg)', () => {
  const ff = ffmpeg.ok ? ffmpeg.path : '';
  let dir = '';
  let parts = { intro: '', loop: '', outro: '' };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulp-set-interlace-'));
    parts = { intro: join(dir, 'Swoosh In.mp4'), loop: join(dir, 'Swoosh Loop.mp4'), outro: join(dir, 'Swoosh Out.mp4') };
    const make = (args: string[]) => {
      const run = spawnSync(ff, args);
      expect(run.status, String(run.stderr)).toBe(0);
    };
    // An interlaced intro top first, an interlaced loop bottom first, and a progressive outro.
    make(fixtureClipArgs('tff', parts.intro, { seconds: 1 }));
    make(fixtureClipArgs('bff', parts.loop, { seconds: 1 }));
    make(fixtureClipArgs('progressive', parts.outro, { seconds: 1 }));
    forgetScans();
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /** A stitch's frames as gray, the output swapped for raw frames so the rows can be read. */
  function stitched(layers: StitchLayer[], length: number): Uint8Array[] {
    const args = [...clipSetLayersStitchArgs(layers, length, { fps: IL_FPS, width: IL_WIDTH, height: IL_HEIGHT }), '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'];
    const run = spawnSync(ff, args, { maxBuffer: 256 * 1024 * 1024 });
    expect(run.status, String(run.stderr)).toBe(0);
    const size = IL_WIDTH * IL_HEIGHT;
    return Array.from({ length: Math.floor(run.stdout.length / size) }, (_, i) => new Uint8Array(run.stdout.buffer, run.stdout.byteOffset + i * size, size));
  }

  it('reads each part on its own: the interlaced ones in their own order, the progressive one left alone', async () => {
    expect(await scanOfPart(ff, parts.intro)).toMatchObject({ field: 'tff', by: 'frames' });
    expect(await scanOfPart(ff, parts.loop)).toMatchObject({ field: 'bff', by: 'frames' });
    expect(await scanOfPart(ff, parts.outro)).toMatchObject({ field: 'progressive' });
    expect(await clipSetFieldsFor(ff, setEntry(), [{ files: parts }])).toEqual([{ intro: 'tff', loop: 'bff' }]);
  }, 60_000);

  it('stitches the set clean, at its own rate and length, the loop repeated and the progressive outro untouched', async () => {
    const length = 4.4; // the loop plays twice and a bit.
    const [clean] = await withClipSetFields(ff, setEntry(), [{ files: parts, timing }]);
    const plain = stitched([{ files: parts, timing }], length);
    const after = stitched([clean!], length);
    expect(after).toHaveLength(Math.round(length * IL_FPS));
    expect(after).toHaveLength(plain.length);
    const outroFrom = Math.round((length - timing.outro) * IL_FPS);
    for (let i = 1; i < outroFrom - 1; i++) {
      expect(combScore(plain[i]!, IL_WIDTH, IL_HEIGHT), `frame ${i}, as it is`).toBeGreaterThan(100);
      expect(combScore(after[i]!, IL_WIDTH, IL_HEIGHT), `frame ${i}, deinterlaced`).toBeLessThan(2);
    }
    // The progressive outro is read exactly as it was: the same pixels with the reading as without.
    for (let i = outroFrom; i < after.length; i++) {
      expect(Buffer.from(after[i]!).equals(Buffer.from(plain[i]!)), `outro frame ${i}`).toBe(true);
      expect(combScore(after[i]!, IL_WIDTH, IL_HEIGHT)).toBeLessThan(1);
    }
  }, 120_000);
});
