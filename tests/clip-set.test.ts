/**
 * Clip sets as one asset (milestone 32): an intro, a loop and an outro in separate files, shown
 * as one item that stretches. The timing is pure and checked here exactly; the stitching and the
 * scan are checked against real ffmpeg with generated clips (tests/stock-fixture.ts), each part
 * one flat color, so a frame of the result says which part it came from.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { clipSetFrameAt, clipSetFramesArgs, clipSetMomentAt, clipSetPartOf, clipSetSpans, clipSetStitchArgs, groupClipSets } from '../src/core/clip-set';
import { clipFramePlan, clipWindow, EMPTY_CLIP, type ClipSource } from '../src/core/video-layer';
import { detectFfmpeg, nodeRunner } from '../src/core/ffmpeg';
import { LibraryStore } from '../src/core/library-store';
import { ffprobePathFor, probeMedia } from '../src/core/media-probe';
import { searchLibrary } from '../src/core/search';
import { CLIP_SET_COLORS, writeClipSetFixture } from './stock-fixture';

describe('which files make a set', () => {
  it('reads the part from a word at the end or the start of the name, as stock libraries write them', () => {
    expect(clipSetPartOf('Swoosh_In.mov')).toEqual({ part: 'intro', base: 'swoosh' });
    expect(clipSetPartOf('Swoosh - Loop.mov')).toEqual({ part: 'loop', base: 'swoosh' });
    expect(clipSetPartOf('Swoosh (Outro).mov')).toEqual({ part: 'outro', base: 'swoosh' });
    expect(clipSetPartOf('Lower Third Entry.mov')).toEqual({ part: 'intro', base: 'lower third' });
    expect(clipSetPartOf('exit-lower-third.mov')).toEqual({ part: 'outro', base: 'lower third' });
    expect(clipSetPartOf('Lower Third Anim In.mov')).toEqual({ part: 'intro', base: 'lower third' });
    expect(clipSetPartOf('Loop.mov')).toEqual({ part: 'loop', base: '' });
    expect(clipSetPartOf('Sunset.mov')).toBeNull();
  });

  it('groups an intro, a loop and an outro that share a name into one set, and leaves the rest alone', () => {
    const sets = groupClipSets(['Swoosh_In.mov', 'Swoosh_Loop.mov', 'Swoosh_Out.mov', 'Sunset.mov', 'Flare Loop.mov', 'Flare Out.mov', 'Lonely Loop.mov'], 'Titles');
    expect(sets).toEqual([
      { name: 'Flare', files: { loop: 'Flare Loop.mov', outro: 'Flare Out.mov' } },
      { name: 'Swoosh', files: { intro: 'Swoosh_In.mov', loop: 'Swoosh_Loop.mov', outro: 'Swoosh_Out.mov' } },
    ]);
  });

  it('keeps sets apart by name and by format, names a bare set after its folder, and refuses an ambiguous one', () => {
    expect(groupClipSets(['A In.mov', 'A Loop.mov', 'B Loop.mov', 'B Out.mov'], 'f').map((s) => s.name)).toEqual(['A', 'B']);
    // Different formats are different exports, not one set.
    expect(groupClipSets(['A In.mov', 'A Loop.webm'], 'f')).toEqual([]);
    expect(groupClipSets(['In.mov', 'Loop.mov', 'Out.mov'], 'Neon Sign')).toEqual([{ name: 'Neon Sign', files: { intro: 'In.mov', loop: 'Loop.mov', outro: 'Out.mov' } }]);
    // Two loops by the same name: which would play? Not a set.
    expect(groupClipSets(['A In.mov', 'A Loop.mov', 'A Hold.mov'], 'f')).toEqual([]);
  });
});

describe('how a set plays for a chosen length', () => {
  const timing = { intro: 1, loop: 0.5, outro: 1 };

  it('plays the intro once, repeats the loop to fill the length, and ends on the outro', () => {
    const L = 4;
    expect(clipSetMomentAt(0, timing, L)).toEqual({ part: 'intro', at: 0 });
    expect(clipSetMomentAt(0.9, timing, L)).toEqual({ part: 'intro', at: 0.9 });
    expect(clipSetMomentAt(1, timing, L)).toEqual({ part: 'loop', at: 0 });
    expect(clipSetMomentAt(1.6, timing, L)!.part).toBe('loop');
    expect(clipSetMomentAt(1.6, timing, L)!.at).toBeCloseTo(0.1);
    expect(clipSetMomentAt(2.75, timing, L)!.at).toBeCloseTo(0.25);
    // The outro ends exactly at the end, its first frame at length - outro.
    expect(clipSetMomentAt(3, timing, L)).toEqual({ part: 'outro', at: 0 });
    expect(clipSetMomentAt(3.99, timing, L)!.part).toBe('outro');
    expect(clipSetMomentAt(4, timing, L)).toBeNull();
    expect(clipSetMomentAt(-0.1, timing, L)).toBeNull();
  });

  it('cuts the last loop where the outro begins, so any length is exact', () => {
    expect(clipSetSpans(timing, 3.3)).toEqual({ intro: 1, loop: expect.closeTo(1.3), outroFrom: 0, outro: 1 });
    expect(clipSetMomentAt(2.29, timing, 3.3)!.part).toBe('loop');
    expect(clipSetMomentAt(2.3, timing, 3.3)!.part).toBe('outro');
  });

  it('keeps the outro whole when the length is too short for both ends, the intro taking what is left', () => {
    expect(clipSetSpans(timing, 1.5)).toEqual({ intro: 0.5, loop: 0, outroFrom: 0, outro: 1 });
    expect(clipSetMomentAt(0.4, timing, 1.5)).toEqual({ part: 'intro', at: 0.4 });
    expect(clipSetMomentAt(0.5, timing, 1.5)).toEqual({ part: 'outro', at: 0 });
    // Shorter than the outro alone: its last moments.
    expect(clipSetSpans(timing, 0.4)).toEqual({ intro: 0, loop: 0, outroFrom: expect.closeTo(0.6), outro: 0.4 });
    expect(clipSetMomentAt(0, timing, 0.4)!.at).toBeCloseTo(0.6);
  });

  it('plays a set with only an intro or only an outro the same way', () => {
    expect(clipSetMomentAt(5, { intro: 1, loop: 2, outro: 0 }, 6)).toEqual({ part: 'loop', at: 0 });
    expect(clipSetMomentAt(5.5, { intro: 0, loop: 2, outro: 1 }, 6)).toEqual({ part: 'outro', at: 0.5 });
  });

  it('counts frames in the parts laid end to end, as a video layer is handed them', () => {
    // 10 fps: intro frames 0-9, loop 10-14, outro 15-24.
    expect(clipSetFrameAt(0, timing, 4, 10)).toBe(0);
    expect(clipSetFrameAt(1.2, timing, 4, 10)).toBe(12);
    expect(clipSetFrameAt(1.7, timing, 4, 10)).toBe(12);
    expect(clipSetFrameAt(3.95, timing, 4, 10)).toBe(24);
    expect(clipSetFrameAt(4, timing, 4, 10)).toBeNull();
  });
});

const ffmpeg = await detectFfmpeg();
const canEncode = ffmpeg.ok && ffmpeg.encoders.includes('qtrle');

describe.skipIf(!canEncode)('a set read from generated clips (needs ffmpeg)', () => {
  let dir = '';
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  const ff = ffmpeg.ok ? ffmpeg.path : '';

  /** The color of each frame of a file, as the part it says it came from. */
  function partsOf(file: string): string[] {
    const run = spawnSync(ff, ['-v', 'error', '-i', file, '-vf', 'scale=1:1,format=rgb24', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
    const bytes = run.stdout;
    const out: string[] = [];
    for (let i = 0; i + 2 < bytes.length; i += 3) {
      const [r, g, b] = [bytes[i]!, bytes[i + 1]!, bytes[i + 2]!];
      const near = (c: readonly number[]) => Math.abs(r - c[0]!) + Math.abs(g - c[1]!) + Math.abs(b - c[2]!) < 90;
      out.push(near(CLIP_SET_COLORS.intro) ? 'intro' : near(CLIP_SET_COLORS.loop) ? 'loop' : near(CLIP_SET_COLORS.outro) ? 'outro' : `?${r},${g},${b}`);
    }
    return out;
  }

  it('scans the three files as one item, found by its name, with the parts measured', async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulp-clipset-'));
    const lib = join(dir, 'Stock');
    await writeClipSetFixture(ff, join(lib, 'Titles'), 'Swoosh');
    // A plain clip beside it stays a clip of its own.
    spawnSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=64x36:r=10:d=1', '-c:v', 'qtrle', join(lib, 'Titles', 'Sunset.mov')]);
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const media = store.toIndex().media;
    expect(media.map((m) => m.name).sort()).toEqual(['Sunset', 'Swoosh']);
    const set = media.find((m) => m.name === 'Swoosh')!;
    expect(set.clipSet).toEqual({ intro: join(lib, 'Titles', 'Swoosh In.mov'), loop: join(lib, 'Titles', 'Swoosh Loop.mov'), outro: join(lib, 'Titles', 'Swoosh Out.mov') });
    expect(set.mediaKind).toBe('video');
    expect(searchLibrary(store.toIndex(), 'swoosh').map((h) => h.entry.key)).toEqual([set.key]);
    store.close();
  });

  it('stitches to any length: the intro once, the loop repeated, the outro ending it, frame for frame', async () => {
    const titles = join(dir, 'Stock', 'Titles');
    const files = { intro: join(titles, 'Swoosh In.mov'), loop: join(titles, 'Swoosh Loop.mov'), outro: join(titles, 'Swoosh Out.mov') };
    const parts = {
      intro: (await probeMedia(ffprobePathFor(ff), files.intro, nodeRunner))!.duration!,
      loop: (await probeMedia(ffprobePathFor(ff), files.loop, nodeRunner))!.duration!,
      outro: (await probeMedia(ffprobePathFor(ff), files.outro, nodeRunner))!.duration!,
    };
    expect(parts).toEqual({ intro: 1, loop: 0.5, outro: 1 });
    for (const length of [4, 2.5, 6.3, 1.5]) {
      const out = join(dir, `stitched-${length}.mov`);
      const run = spawnSync(ff, [...clipSetStitchArgs(files, parts, length, { fps: 10, width: 64, height: 36 }), '-c:v', 'qtrle', '-y', out]);
      expect(run.status, String(run.stderr)).toBe(0);
      const got = partsOf(out);
      // One frame per tenth of a second, each from the part the pure timing says.
      const want = Array.from({ length: Math.round(length * 10) }, (_, f) => clipSetMomentAt(f / 10 + 1e-6, parts, length)!.part);
      expect(got, `at ${length} s`).toEqual(want);
      expect(got[0], 'it starts on the intro').toBe('intro');
      expect(got.at(-1), 'and ends on the outro').toBe('outro');
    }
  });

  it('hands a video layer the parts end to end, and plays them to fill the graphic\'s length', async () => {
    const titles = join(dir, 'Stock', 'Titles');
    const files = { intro: join(titles, 'Swoosh In.mov'), loop: join(titles, 'Swoosh Loop.mov'), outro: join(titles, 'Swoosh Out.mov') };
    const timing = { intro: 1, loop: 0.5, outro: 1 };
    const source: ClipSource = { frames: 25, fps: 10, set: timing };
    // The whole set, whatever in and out points the layer carries.
    expect(clipWindow({ inPoint: 7, outPoint: 9 }, source)).toEqual({ first: 0, last: 24, frames: 25 });
    const run = spawnSync(ff, clipSetFramesArgs(files, timing, { fps: 10, width: 64, height: 36 }, { first: 0, frames: 25 }, ''), { maxBuffer: 64 * 1024 * 1024 });
    expect(run.status, String(run.stderr)).toBe(0);
    const pngs = run.stdout.toString('latin1').split('\x89PNG').length - 1;
    expect(pngs, 'every frame of the three, once').toBe(25);
    // A window from the middle: the loop's frames, then the outro's.
    const mid = spawnSync(ff, clipSetFramesArgs(files, timing, { fps: 10, width: 64, height: 36 }, { first: 12, frames: 6 }, 'scale=8:8'), { maxBuffer: 64 * 1024 * 1024 });
    expect(mid.status, String(mid.stderr)).toBe(0);
    expect(mid.stdout.toString('latin1').split('\x89PNG').length - 1).toBe(6);

    // In a 6 s graphic it stretches: intro, the loop repeated, the outro at the end — never a stop.
    const value = { ...EMPTY_CLIP, id: 'set' };
    const plan = clipFramePlan(value, source, 60, 10);
    const partOf = (f: number | null) => (f === null ? 'none' : f < 10 ? 'intro' : f < 15 ? 'loop' : 'outro');
    expect(plan.slice(0, 10).map(partOf).every((p) => p === 'intro')).toBe(true);
    expect(plan.slice(10, 50).map(partOf).every((p) => p === 'loop')).toBe(true);
    expect(plan.slice(50).map(partOf).every((p) => p === 'outro')).toBe(true);
    expect(plan.at(-1)).toBe(24);
    // Delayed two seconds, it starts then and still ends with the graphic.
    const late = clipFramePlan({ ...value, delay: 2 }, source, 60, 10);
    expect(late.slice(0, 20).every((f) => f === null)).toBe(true);
    expect(late[20]).toBe(0);
    expect(late.at(-1)).toBe(24);
  });
});
