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
import { clipSetFrameAt, clipSetFramesArgs, clipSetLayersFramesArgs, clipSetLayersNaturalSeconds, clipSetLayersStitchArgs, clipSetMomentAt, clipSetPartOf, clipSetSpans, clipSetStitchArgs, groupClipSetLayers, groupClipSets, stitchHasSound, type FoundClipSet } from '../src/core/clip-set';
import { clipFramePlan, clipMediaTimeAt, clipWindow, EMPTY_CLIP, type ClipSource } from '../src/core/video-layer';
import { detectFfmpeg, nodeRunner } from '../src/core/ffmpeg';
import { LibraryStore } from '../src/core/library-store';
import { ffprobePathFor, probeMedia } from '../src/core/media-probe';
import { searchLibrary } from '../src/core/search';
import { CLIP_SET_COLORS, CLIP_SET_FLARE_COLORS, CLIP_SET_TONES, writeClipSetFixture, writeLayeredClipSetFixture } from './stock-fixture';

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

describe('several layers in one set (milestone 32)', () => {
  const set = (name: string, ext = '.mov'): FoundClipSet => ({ name, files: { intro: `${name} In${ext}`, loop: `${name} Loop${ext}`, outro: `${name} Out${ext}` } });

  it('makes sets whose names extend another\'s the layers of it, the bare name at the bottom', () => {
    const found = groupClipSetLayers([set('Swoosh Glow'), set('Swoosh'), set('Swoosh Flare'), set('Sunset')], 'Titles');
    expect(found.map((f) => f.name)).toEqual(['Sunset', 'Swoosh']);
    const swoosh = found.find((f) => f.name === 'Swoosh')!;
    expect(swoosh.layers.map((l) => l.name)).toEqual(['Swoosh', 'Flare', 'Glow']);
    expect(swoosh.layers[1]!.files.loop).toBe('Swoosh Flare Loop.mov');
    // A set of another format is a set of its own, not a layer.
    expect(groupClipSetLayers([set('Swoosh'), set('Swoosh Flare', '.webm')], 'Titles').map((f) => f.layers.length)).toEqual([1, 1]);
  });

  it('lets the folder name the set when every set in it begins with the folder\'s name, the base layer first', () => {
    const found = groupClipSetLayers([set('Swoosh Flare'), set('Swoosh Main')], 'Swoosh');
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe('Swoosh');
    expect(found[0]!.layers.map((l) => l.name)).toEqual(['Main', 'Flare']);
    // One set alone in a folder of its name is just that set; sets that do not share the folder's name stay apart.
    expect(groupClipSetLayers([set('Swoosh Flare')], 'Swoosh')[0]!.layers).toHaveLength(1);
    expect(groupClipSetLayers([set('Swoosh Flare'), set('Sunset Main')], 'Swoosh')).toHaveLength(2);
  });

  it('runs a layered set for the longest layer\'s own length, the others repeating their loops to meet it', () => {
    expect(clipSetLayersNaturalSeconds([{ intro: 1, loop: 0.5, outro: 1 }, { intro: 0.5, loop: 2, outro: 0.5 }])).toBe(3);
    const args = clipSetLayersStitchArgs([
      { files: { intro: 'a-in.mov', loop: 'a-loop.mov', outro: 'a-out.mov' }, timing: { intro: 1, loop: 0.5, outro: 1 } },
      { files: { loop: 'b-loop.mov' }, timing: { intro: 0, loop: 2, outro: 0 } },
    ], 4, { fps: 10, width: 64, height: 36 });
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    // Each layer concatenated on its own, then the second laid over the first with both alphas kept.
    expect(graph).toContain('concat=n=3:v=1:a=0[l0]');
    expect(graph).toContain('concat=n=1:v=1:a=0[l1]');
    expect(graph).toMatch(/\[l0\]\[l1\]overlay=format=rgb:eof_action=pass,format=rgba\[set\]$/);
    expect(args.slice(-1)[0]).toBe('40');
    // One layer is the plain stitch, unchanged.
    expect(clipSetLayersStitchArgs([{ files: { loop: 'x.mov' }, timing: { intro: 0, loop: 1, outro: 0 } }], 2, { fps: 10, width: 8, height: 8 }))
      .toEqual(clipSetStitchArgs({ loop: 'x.mov' }, { intro: 0, loop: 1, outro: 0 }, 2, { fps: 10, width: 8, height: 8 }));
  });
});

describe.skipIf(!canEncode)('a layered set read from generated clips (needs ffmpeg)', () => {
  let dir = '';
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  const ff = ffmpeg.ok ? ffmpeg.path : '';

  /** The base's part at the center of each frame of a file, and the flare's at its corner. */
  function layersOf(file: string): { base: string; flare: string }[] {
    const pixel = (x: number, y: number) => {
      const run = spawnSync(ff, ['-v', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
      const out: number[][] = [];
      for (let i = 0; i + 2 < run.stdout.length; i += 3) out.push([run.stdout[i]!, run.stdout[i + 1]!, run.stdout[i + 2]!]);
      return out;
    };
    const near = (p: number[], c: readonly number[]) => Math.abs(p[0]! - c[0]!) + Math.abs(p[1]! - c[1]!) + Math.abs(p[2]! - c[2]!) < 90;
    const which = (p: number[], colors: typeof CLIP_SET_COLORS | typeof CLIP_SET_FLARE_COLORS) => near(p, colors.intro) ? 'intro' : near(p, colors.loop) ? 'loop' : near(p, colors.outro) ? 'outro' : `?${p.join(',')}`;
    const centers = pixel(32, 18);
    const corners = pixel(4, 4);
    return centers.map((c, i) => ({ base: which(c, CLIP_SET_COLORS), flare: which(corners[i]!, CLIP_SET_FLARE_COLORS) }));
  }

  it('scans the six files as one item with two layers, the flare over the base, and none of them as items', async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulp-layered-'));
    const lib = join(dir, 'Stock');
    await writeLayeredClipSetFixture(ff, join(lib, 'Titles'), 'Swoosh');
    const store = new LibraryStore(':memory:');
    store.setRoots([lib]);
    await store.scanRoots([lib]);
    const media = store.toIndex().media;
    expect(media.map((m) => m.name)).toEqual(['Swoosh']);
    const item = media[0]!;
    expect(item.clipSet!.loop).toBe(join(lib, 'Titles', 'Swoosh Loop.mov'));
    expect(item.clipSetLayers!.map((l) => l.name)).toEqual(['Swoosh', 'Flare']);
    expect(item.clipSetLayers![1]!.files).toEqual({ intro: join(lib, 'Titles', 'Swoosh Flare In.mov'), loop: join(lib, 'Titles', 'Swoosh Flare Loop.mov'), outro: join(lib, 'Titles', 'Swoosh Flare Out.mov') });
    store.close();
  });

  it('composites the layers at any length, each from its own part at every frame, with the transparency kept', async () => {
    const titles = join(dir, 'Stock', 'Titles');
    const timing = { intro: 1, loop: 0.5, outro: 1 };
    const layers = [
      { files: { intro: join(titles, 'Swoosh In.mov'), loop: join(titles, 'Swoosh Loop.mov'), outro: join(titles, 'Swoosh Out.mov') }, timing },
      { files: { intro: join(titles, 'Swoosh Flare In.mov'), loop: join(titles, 'Swoosh Flare Loop.mov'), outro: join(titles, 'Swoosh Flare Out.mov') }, timing },
    ];
    for (const length of [4, 2.5]) {
      const out = join(dir, `layered-${length}.mov`);
      const run = spawnSync(ff, [...clipSetLayersStitchArgs(layers, length, { fps: 10, width: 64, height: 36 }), '-c:v', 'qtrle', '-pix_fmt', 'argb', '-y', out]);
      expect(run.status, String(run.stderr)).toBe(0);
      const got = layersOf(out);
      const want = Array.from({ length: Math.round(length * 10) }, (_, f) => clipSetMomentAt(f / 10 + 1e-6, timing, length)!.part);
      expect(got.map((g) => g.base), `the base at ${length} s`).toEqual(want);
      expect(got.map((g) => g.flare), `the flare at ${length} s`).toEqual(want);
    }
    // The flare's transparent part leaves the base showing: a pixel off the flare's box is the base's color,
    // and a frame's alpha is whole where either layer paints and empty where neither does.
    const probe = spawnSync(ff, ['-v', 'error', '-i', join(dir, 'layered-2.5.mov'), '-vf', 'crop=1:1:40:30,format=rgba', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']);
    expect(probe.stdout[3], 'the base is opaque under the flare').toBe(255);
    // Handed to a video layer: the composite's frames, each once, as many as the longest layer's parts hold.
    const frames = spawnSync(ff, clipSetLayersFramesArgs(layers, { fps: 10, width: 64, height: 36 }, { first: 0, frames: 25 }, ''), { maxBuffer: 64 * 1024 * 1024 });
    expect(frames.status, String(frames.stderr)).toBe(0);
    expect(frames.stdout.toString('latin1').split('\x89PNG').length - 1).toBe(25);
  });
});

describe('a set\'s sound (milestone 32)', () => {
  const files = { intro: 'a-in.mov', loop: 'a-loop.mov', outro: 'a-out.mov' };
  const timing = { intro: 1, loop: 0.5, outro: 1 };

  it('joins the parts\' sounds as it joins their pictures, silence standing in for a part without any', () => {
    const args = clipSetLayersStitchArgs([{ files, timing, sound: { loop: true, outro: true } }], 4, { fps: 10, width: 64, height: 36 }, true);
    const graph = args[args.indexOf('-filter_complex') + 1]!;
    // The intro has no sound: a second of silence for its span. The loop's and the outro's are trimmed as their pictures are.
    expect(graph).toContain('aevalsrc=0:d=1.000000:s=48000');
    expect(graph).toContain('[1:a]atrim=start=0.000000:duration=2.000000');
    expect(graph).toContain('[2:a]atrim=start=0.000000:duration=1.000000');
    expect(graph).toContain('concat=n=3:v=0:a=1[set_a]');
    expect(args).toContain('[set_a]');
    expect(args).not.toContain('-an');
    // Without sound asked, or with none in any part, the output has no audio stream — as before.
    expect(clipSetLayersStitchArgs([{ files, timing, sound: { loop: true } }], 4, { fps: 10, width: 64, height: 36 })).toContain('-an');
    expect(clipSetLayersStitchArgs([{ files, timing }], 4, { fps: 10, width: 64, height: 36 }, true)).toContain('-an');
    expect(stitchHasSound([{ files, timing }, { files: { loop: 'b.mov' }, timing: { intro: 0, loop: 1, outro: 0 }, sound: { loop: true } }])).toBe(true);
    // Several layers' sounds are mixed, none ducked.
    const two = clipSetLayersStitchArgs([{ files, timing, sound: { loop: true } }, { files: { loop: 'b.mov' }, timing: { intro: 0, loop: 1, outro: 0 }, sound: { loop: true } }], 4, { fps: 10, width: 64, height: 36 }, true);
    expect(two[two.indexOf('-filter_complex') + 1]).toMatch(/\[la0\]\[la1\]amix=inputs=2:duration=longest:normalize=0\[set_a\]/);
  });

  it('plays a set layer\'s sound as the stitched file from the delay, ending with the graphic', () => {
    const source: ClipSource = { frames: 25, fps: 10, set: timing };
    const value = { ...EMPTY_CLIP, id: 'set', delay: 2 };
    expect(clipMediaTimeAt(1, value, source)).toBeNull();
    expect(clipMediaTimeAt(2, value, source)).toBe(0);
    expect(clipMediaTimeAt(5.5, value, source)).toBeCloseTo(3.5, 9);
    // At a speed the file passes faster, as the stitched file was made longer for it.
    expect(clipMediaTimeAt(3, { ...value, speed: 2 }, source)).toBeCloseTo(2, 9);
  });
});

describe.skipIf(!canEncode)('a set\'s sound from generated clips (needs ffmpeg)', () => {
  let dir = '';
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  const ff = ffmpeg.ok ? ffmpeg.path : '';

  /** Zero crossings per second of the file's sound, one figure per second: a tone's pitch, or nothing for silence. */
  function pitchPerSecond(file: string, seconds: number): number[] {
    const run = spawnSync(ff, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
    const pcm = run.stdout;
    const out: number[] = [];
    for (let sec = 0; sec < seconds; sec++) {
      let crossings = 0;
      for (let i = (sec * 8000 + 1) * 2; i + 1 < Math.min(pcm.length, (sec + 1) * 8000 * 2); i += 2) {
        if ((pcm.readInt16LE(i - 2) < 0) !== (pcm.readInt16LE(i) < 0)) crossings += 1;
      }
      out.push(crossings / 2);
    }
    return out;
  }

  it('stitches the parts\' sounds with their pictures: each second of the result hums the part it shows', async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulp-setsound-'));
    const titles = join(dir, 'Titles');
    await writeClipSetFixture(ff, titles, 'Swoosh', { intro: 1, loop: 0.5, outro: 1 }, undefined, true);
    const files = { intro: join(titles, 'Swoosh In.mov'), loop: join(titles, 'Swoosh Loop.mov'), outro: join(titles, 'Swoosh Out.mov') };
    const timing = { intro: 1, loop: 0.5, outro: 1 };
    const out = join(dir, 'stitched.mov');
    const run = spawnSync(ff, [...clipSetLayersStitchArgs([{ files, timing, sound: { intro: true, loop: true, outro: true } }], 4, { fps: 10, width: 64, height: 36 }, true), '-c:v', 'qtrle', '-c:a', 'pcm_s16le', '-y', out]);
    expect(run.status, String(run.stderr)).toBe(0);
    const streams = spawnSync(ffprobePathFor(ff), ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out]).stdout.toString();
    expect(streams).toContain('audio');
    // Intro for a second, the loop for two, the outro for the last: the pitch follows the picture.
    const pitch = pitchPerSecond(out, 4);
    const near = (hz: number, want: number) => Math.abs(hz - want) < want * 0.08;
    expect(pitch.map((hz) => (near(hz, CLIP_SET_TONES.intro) ? 'intro' : near(hz, CLIP_SET_TONES.loop) ? 'loop' : near(hz, CLIP_SET_TONES.outro) ? 'outro' : `?${hz}`))).toEqual(['intro', 'loop', 'loop', 'outro']);

    // A part said to have no sound is silence for its span, whatever its file holds.
    const quiet = join(dir, 'quiet-intro.mov');
    const made = spawnSync(ff, [...clipSetLayersStitchArgs([{ files, timing, sound: { loop: true, outro: true } }], 3, { fps: 10, width: 64, height: 36 }, true), '-c:v', 'qtrle', '-c:a', 'pcm_s16le', '-y', quiet]);
    expect(made.status, String(made.stderr)).toBe(0);
    const [first, second] = pitchPerSecond(quiet, 2);
    expect(first, 'silence, give or take the seam').toBeLessThan(20);
    expect(near(second!, CLIP_SET_TONES.loop)).toBe(true);
  });
});
