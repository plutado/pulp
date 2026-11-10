/**
 * Deinterlacing old footage (milestone 83): what the tag says and what the
 * frames show, how the two are weighed, the one step that makes whole frames
 * and that it reaches every place a clip's pixels are read — first of all —
 * the clip marked in the library, and the person's way to turn it off. Then
 * the same against the ffmpeg on this machine, with generated clips: an
 * interlaced one found and measured free of combing after, in its own field
 * order, and a progressive one — even one tagged interlaced — left alone.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFfmpeg } from '../src/core/ffmpeg';
import {
  deinterlacePrefix, deinterlaceSteps, fieldOrderFromTag, IDET_FRAMES, idetArgs, idetStart, interlacedField, mayBeInterlaced, parseIdet, scanFrom,
} from '../src/core/interlace';
import { tonemapPrefix } from '../src/core/hdr';
import { parseFfprobe } from '../src/core/media-meta';
import { ffprobeArgs } from '../src/core/media-probe';
import { buildRenderPlan } from '../src/core/render-plan';
import { buildMediaRenderPlan, sourceFromEntry } from '../src/core/media-render';
import { entryBadges } from '../src/core/results-view';
import { formatRows } from '../src/core/item-info';
import { LibraryStore } from '../src/core/library-store';
import { mediaCacheKey } from '../src/core/render-cache';
import type { MediaEntry } from '../src/core/library-types';
import { clipFramesArgs } from '../src/main/clip-grant';
import { deinterlaceFor, forgetScans, onScanMeasured, scanOf } from '../src/main/interlace-service';
import { boxLeftEdge, combScore, fixtureClipArgs, IL_BOX, IL_FPS, IL_HEIGHT, IL_STEP, IL_WIDTH } from './interlace-fixture';

const media = (over: Partial<MediaEntry> = {}): MediaEntry => ({
  kind: 'media',
  key: 'k',
  id: 'tape',
  name: 'Tape 3',
  path: '/lib/Tape 3.mpg',
  root: '/lib',
  ext: '.mpg',
  mediaKind: 'video',
  size: 1024,
  mtimeMs: 1,
  tags: [],
  themes: [],
  ...over,
} as MediaEntry);

/** ffmpeg 8's own report for a woven top-first clip: the graph built twice, the first time over nothing. */
const IDET_TFF = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'tff.mp4':
  Stream #0:0[0x1](und): Video: mpeg4 (Simple Profile) (mp4v / 0x7634706D), yuv420p, 720x576 [SAR 1:1 DAR 5:4], 1101 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
[Parsed_idet_0 @ 0xb8487c480] Repeated Fields: Neither:     0 Top:     0 Bottom:     0
[Parsed_idet_0 @ 0xb8487c480] Single frame detection: TFF:     0 BFF:     0 Progressive:     0 Undetermined:     0
[Parsed_idet_0 @ 0xb8487c480] Multi frame detection: TFF:     0 BFF:     0 Progressive:     0 Undetermined:     0
[out#0/null @ 0xb84c08180] video:22KiB audio:0KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
[Parsed_idet_0 @ 0xb84d086c0] Repeated Fields: Neither:    50 Top:     0 Bottom:     0
[Parsed_idet_0 @ 0xb84d086c0] Single frame detection: TFF:    29 BFF:     0 Progressive:     0 Undetermined:    21
[Parsed_idet_0 @ 0xb84d086c0] Multi frame detection: TFF:    50 BFF:     0 Progressive:     0 Undetermined:     0
`;

const counts = (tff: number, bff: number, progressive: number, undetermined = 0) => ({ tff, bff, progressive, undetermined });

describe('what the file says, and what its frames show', () => {
  it('reads the field_order tag as a scan, and asks ffprobe for it', () => {
    expect(['tt', 'tb', 'bb', 'bt', 'progressive', 'unknown', undefined, ' TT '].map(fieldOrderFromTag)).toEqual(['tff', 'tff', 'bff', 'bff', 'progressive', undefined, undefined, 'tff']);
    expect(ffprobeArgs('/lib/a.mpg').join(' ')).toContain('field_order');
    const probe = (fieldOrder: string) => JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'mpeg2video', width: 720, height: 576, field_order: fieldOrder, r_frame_rate: '25/1' }], format: { duration: '2' } });
    expect(parseFfprobe(probe('tt'))!.fieldOrder).toBe('tff');
    expect(parseFfprobe(probe('bb'))!.fieldOrder).toBe('bff');
    expect(parseFfprobe(probe('progressive'))!.fieldOrder).toBe('progressive');
    expect(parseFfprobe(probe('unknown'))!.fieldOrder).toBeUndefined();
    // The tag is a hint: no probe alone ever says a clip is interlaced.
    expect(parseFfprobe(probe('tt'))!.scan).toBeUndefined();
  });

  it('reads frames only where a clip could be interlaced: 25 or 29.97 frames a second, or a tag that says so', () => {
    expect(mayBeInterlaced({ fps: 25, duration: 10 })).toBe(true);
    expect(mayBeInterlaced({ fps: 29.97, duration: 10 })).toBe(true);
    expect(mayBeInterlaced({ fps: 30, duration: 10 })).toBe(true);
    for (const fps of [23.976, 24, 50, 59.94, 60, 120]) expect(mayBeInterlaced({ fps, duration: 10 }), `${fps}`).toBe(false);
    expect(mayBeInterlaced({ fps: 50, duration: 10, fieldOrder: 'tff' })).toBe(true);
    expect(mayBeInterlaced({ fps: 25, duration: 0.08 })).toBe(false);
    expect(mayBeInterlaced(undefined)).toBe(false);
  });

  it('shows idet a stretch a third of the way in, from the start of a short clip, and nothing else', () => {
    expect(idetStart(30, 25)).toBe(10);
    expect(idetStart(3, 25)).toBeCloseTo(0.6, 6);
    expect(idetStart(1, 25)).toBe(0);
    expect(idetStart(undefined, 25)).toBe(0);
    const args = idetArgs('/lib/Tape 3.mpg', 10);
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4)).toEqual(['-ss', '10', '-i', '/lib/Tape 3.mpg']);
    expect(args[args.indexOf('-frames:v') + 1]).toBe(String(IDET_FRAMES));
    expect(args[args.indexOf('-vf') + 1]).toBe('idet');
    expect(args.slice(-3)).toEqual(['-f', 'null', '-']);
    expect(args).not.toContain('-y');
    expect(idetArgs('/lib/a.mpg', 0)).not.toContain('-ss');
  });

  it('takes the report that counted, where ffmpeg reports twice', () => {
    expect(parseIdet(IDET_TFF)).toEqual(counts(50, 0, 0, 0));
    expect(parseIdet('no report here')).toBeNull();
  });

  it('lets the frames decide where they are clear, and the tag only where they are not', () => {
    // Woven fields: interlaced by the frames, whatever the tag.
    expect(scanFrom(counts(50, 0, 0), undefined)).toMatchObject({ field: 'tff', by: 'frames' });
    expect(scanFrom(counts(0, 48, 2), 'progressive')).toMatchObject({ field: 'bff', by: 'frames' });
    // A tag that lies: progressive by the frames, though it says top first.
    expect(scanFrom(counts(0, 0, 50), 'tff')).toMatchObject({ field: 'progressive', by: 'frames' });
    // A progressive test pattern of moving one-pixel lines reads three quarters "top first" to
    // idet (ffmpeg's testsrc2: 38 to 12); that is not enough to call it interlaced.
    expect(scanFrom(counts(38, 0, 12), undefined)).toMatchObject({ field: 'progressive', by: 'tag' });
    expect(scanFrom(counts(38, 0, 12), 'tff')).toMatchObject({ field: 'tff', by: 'tag' });
    // A still shot gives idet nothing to measure: the tag decides, and nothing is guessed without one.
    expect(scanFrom(counts(0, 0, 0, 50), 'bff')).toMatchObject({ field: 'bff', by: 'tag' });
    expect(scanFrom(counts(2, 0, 1, 47), undefined)).toMatchObject({ field: 'progressive', by: 'tag' });
    expect(scanFrom(null, 'tff')).toEqual({ field: 'tff', by: 'tag' });
    expect(scanFrom(null, undefined)).toEqual({ field: 'progressive', by: 'tag' });
    // The field order is the one the frames counted more of by a clear margin, else the tag's.
    expect(scanFrom(counts(26, 24, 0), 'bff').field).toBe('bff');
    expect(scanFrom(counts(26, 24, 0), undefined).field).toBe('tff');
    expect(scanFrom(counts(10, 40, 0), 'tff').field).toBe('bff');
    // What it reads as for the places that draw.
    expect(interlacedField({ field: 'bff', by: 'frames' })).toBe('bff');
    expect(interlacedField({ field: 'progressive', by: 'frames' })).toBeUndefined();
    expect(interlacedField(undefined)).toBeUndefined();
  });

  it('makes whole frames with bwdif, one out per frame in, in the clip\'s own order, every frame', () => {
    expect(deinterlaceSteps('tff')).toEqual(['bwdif=mode=send_frame:parity=tff:deint=all']);
    expect(deinterlaceSteps('bff')).toEqual(['bwdif=mode=send_frame:parity=bff:deint=all']);
    expect(deinterlaceSteps(undefined)).toEqual([]);
    expect(deinterlacePrefix('tff')).toBe('bwdif=mode=send_frame:parity=tff:deint=all,');
    expect(deinterlacePrefix(undefined)).toBe('');
  });
});

describe('everywhere a clip is read, first of all', () => {
  const source = { frames: 50, fps: 25 };
  const window = { first: 0, frames: 10 };
  const vf = (args: string[]) => args[args.indexOf('-vf') + 1]!;

  it('deinterlaces the preview\'s and a layer\'s frames before the HDR conversion, the grade and the scale', () => {
    const entry = media({ meta: { width: 720, height: 576, fps: 25, duration: 2 } });
    const all = vf(clipFramesArgs(entry, source, window, 512, { deinterlace: 'bff', tonemap: 'hlg', lut: '/looks/warm.cube' }));
    expect(all.startsWith(`${deinterlacePrefix('bff')}${tonemapPrefix('hlg')}`)).toBe(true);
    expect(all.indexOf('bwdif')).toBeLessThan(all.indexOf('lut3d'));
    expect(all.indexOf('lut3d')).toBeLessThan(all.indexOf('scale=w='));
    // A progressive clip's arguments are what they always were.
    expect(vf(clipFramesArgs(entry, source, window, 512))).not.toContain('bwdif');
    expect(vf(clipFramesArgs(entry, source, window, 512, { deinterlace: undefined }))).toBe(vf(clipFramesArgs(entry, source, window, 512)));
  });

  it('deinterlaces a shot on the cut track before its conversion, its speed and its framing', () => {
    const plan = (deinterlace: boolean) => buildRenderPlan({
      manifest: { fps: 25, duration: 2, alpha: true, aspects: ['16:9'], size: { width: 320, height: 180 } },
      presetId: 'h264-mp4',
      outputPath: '/out/render.mp4',
      track: { cuts: [{ path: '/lib/Tape 3.mpg', from: 0, to: 2, tonemap: 'pq', speed: { rate: 0.5 }, ...(deinterlace ? { deinterlace: 'tff' as const } : {}) }] },
    });
    const graph = (p: ReturnType<typeof plan>) => p.args[p.args.indexOf('-filter_complex') + 1]!;
    const cut = graph(plan(true)).split(';').find((c) => c.startsWith('[1:v]'))!;
    expect(cut.startsWith(`[1:v]${deinterlacePrefix('tff')}zscale=`)).toBe(true);
    expect(cut.indexOf('bwdif')).toBeLessThan(cut.indexOf('setpts=PTS'));
    expect(cut.indexOf('bwdif')).toBeLessThan(cut.indexOf(',scale='));
    expect(graph(plan(false))).not.toContain('bwdif');
  });

  it('deinterlaces an item rendered on its own before everything, and leaves a progressive one alone', () => {
    const interlaced = { ...sourceFromEntry(media({ meta: { width: 720, height: 576, fps: 25, duration: 2 } })), deinterlace: 'tff' as const };
    const args = buildMediaRenderPlan({ source: interlaced, presetId: 'h264-mp4', outputPath: '/out/clip.mp4', options: { speed: 2 } }).stages[0]!.args;
    const chain = args.join(' ');
    expect(chain).toContain(deinterlacePrefix('tff'));
    expect(chain.indexOf('bwdif')).toBeLessThan(chain.indexOf('setpts=PTS/2'));
    expect(chain.indexOf('bwdif')).toBeLessThan(chain.indexOf('fps=25'));
    const plain = sourceFromEntry(media({ meta: { width: 720, height: 576, fps: 25, duration: 2 } }));
    expect(plain.deinterlace).toBeUndefined();
    expect(buildMediaRenderPlan({ source: plain, presetId: 'h264-mp4', outputPath: '/out/clip.mp4' }).stages[0]!.args.join(' ')).not.toContain('bwdif');
  });

  it('asks nothing of a clip that is off, and nothing of what has no scan', async () => {
    const interlaced = media({ meta: { width: 720, height: 576, fps: 25, duration: 2, scan: { field: 'tff', by: 'frames' } } });
    expect(await deinterlaceFor('/usr/bin/ffmpeg', interlaced)).toBe('tff');
    expect(await deinterlaceFor('/usr/bin/ffmpeg', { ...interlaced, deinterlace: false })).toBeUndefined();
    expect(await deinterlaceFor('/usr/bin/ffmpeg', interlaced, true)).toBeUndefined();
    expect(await deinterlaceFor('/usr/bin/ffmpeg', media({ meta: { scan: { field: 'progressive', by: 'frames' } } }))).toBeUndefined();
    expect(await scanOf('/usr/bin/ffmpeg', media({ mediaKind: 'audio' }))).toBeUndefined();
    expect(await scanOf('/usr/bin/ffmpeg', media({ sequence: { dir: '/lib', prefix: 'f_', digits: 4, ext: '.png', start: 1, count: 10 } as unknown as MediaEntry['sequence'] }))).toBeUndefined();
    expect(await scanOf('', media())).toBeUndefined();
  });
});

describe('marked in the library, and the person\'s to turn off', () => {
  const at = (over: Partial<MediaEntry>) => media({ meta: { width: 720, height: 576, fps: 25, duration: 2, scan: { field: 'tff', by: 'frames' } }, ...over });

  it('names the resolution as video people do — 576i, 1080i — with what becomes of it in the tooltip', () => {
    const badge = entryBadges(at({})).find((b) => b.id === 'resolution')!;
    expect(badge.label).toBe('576i');
    expect(badge.tip).toBe('720 × 576 · Interlaced, top field first; Pulp deinterlaces it wherever it is used, and leaves the file as it is');
    const hd = entryBadges(at({ meta: { width: 1920, height: 1080, fps: 29.97, duration: 2, scan: { field: 'bff', by: 'frames' } } })).find((b) => b.id === 'resolution')!;
    expect(hd.label).toBe('1080i');
    expect(hd.tip).toContain('bottom field first');
    expect(entryBadges(at({ deinterlace: false })).find((b) => b.id === 'resolution')!.tip).toContain('deinterlacing is off for this clip');
    // Progressive, or not yet read: the resolution as ever.
    expect(entryBadges(at({ meta: { width: 1920, height: 1080, fps: 25, duration: 2, scan: { field: 'progressive', by: 'frames' } } })).find((b) => b.id === 'resolution')!.label).toBe('Full HD');
    expect(entryBadges(at({ meta: { width: 1920, height: 1080, fps: 25, duration: 2 } })).find((b) => b.id === 'resolution')!.label).toBe('Full HD');
  });

  it('says in the Info tab how it was found and what becomes of it', () => {
    const scan = (entry: MediaEntry) => formatRows(entry).find((r) => r.label === 'Scan')?.value;
    expect(scan(at({}))).toBe('Interlaced, top field first, as its frames show. Deinterlaced wherever it is drawn or rendered; the file itself is left as it is.');
    expect(scan(at({ meta: { width: 720, height: 576, fps: 25, duration: 2, scan: { field: 'bff', by: 'tag' } } }))).toContain('bottom field first, as the file says; its frames could not tell');
    expect(scan(at({ deinterlace: false }))).toContain('Deinterlacing is off for this clip');
    // A tag the frames contradict is said; an ordinary progressive clip has no row.
    expect(scan(at({ meta: { width: 720, height: 576, fps: 25, duration: 2, fieldOrder: 'tff', scan: { field: 'progressive', by: 'frames' } } }))).toBe('Progressive, as its frames show, though the file is tagged interlaced. Left as it is.');
    expect(scan(at({ meta: { width: 720, height: 576, fps: 25, duration: 2, scan: { field: 'progressive', by: 'frames' } } }))).toBeUndefined();
    expect(scan(at({ meta: { width: 720, height: 576, fps: 25, duration: 2 } }))).toBeUndefined();
  });

  it('keeps the frames\' reading with the metadata, lists what is still to read, and keeps the choice to turn it off apart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulp-interlace-store-'));
    try {
      await mkdir(join(dir, 'Archive'), { recursive: true });
      for (const name of ['Tape 3.mpg', 'Phone.mp4', 'Song.wav']) await writeFile(join(dir, 'Archive', name), 'not really media');
      const store = new LibraryStore(':memory:');
      store.setRoots([dir]);
      await store.scanRoots([dir]);
      const byName = (name: string) => store.toIndex().media.find((m) => m.name === name)!;
      const tape = byName('Tape 3');
      const song = byName('Song');
      // Nothing is to read until the probe has measured a clip; a sound never is.
      expect(store.pendingScans()).toEqual([]);
      store.setMetadata(tape, { width: 720, height: 576, fps: 25, duration: 2, fieldOrder: 'progressive' });
      store.setMetadata(byName('Phone'), { width: 1080, height: 1920, fps: 60, duration: 2, fromPreview: true });
      store.setMetadata(song, { duration: 2, audioCodec: 'pcm_s16le' });
      expect(store.pendingScans().map((e) => e.name)).toEqual(['Tape 3']);
      expect(store.pendingScans()[0]!.meta?.fieldOrder).toBe('progressive');
      // Kept with the metadata of the file as it is, and so no longer to read.
      expect(store.recordScan(tape.key, tape.size, tape.mtimeMs, { field: 'tff', by: 'frames', frames: counts(50, 0, 0) }, 'progressive')).toBe(true);
      expect(store.pendingScans()).toEqual([]);
      expect(byName('Tape 3').meta?.scan).toEqual({ field: 'tff', by: 'frames', frames: counts(50, 0, 0) });
      expect(byName('Tape 3').meta?.width).toBe(720);
      // A file that changed since is not written over.
      expect(store.recordScan(tape.key, tape.size + 1, tape.mtimeMs, { field: 'progressive', by: 'frames' })).toBe(false);
      // Turned off, and on again: on the index, on a lookup by id, and kept apart from the scan.
      store.setUserData(tape.key, { deinterlace: false });
      expect(byName('Tape 3').deinterlace).toBe(false);
      expect(store.findMediaById(tape.id)!.entry.deinterlace).toBe(false);
      expect(store.findMediaById(tape.id)!.entry.meta?.scan?.field).toBe('tff');
      store.setUserData(tape.key, { tags: ['archive'] });
      expect(byName('Tape 3').deinterlace).toBe(false);
      store.setUserData(tape.key, { deinterlace: undefined });
      expect(byName('Tape 3').deinterlace).toBeUndefined();
      expect(store.findMediaById(tape.id)!.entry.deinterlace).toBeUndefined();
      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('renders afresh for the drag cache when deinterlacing is turned off, and keeps every other key as it was', () => {
    const base = { id: 'tape', size: 1, mtimeMs: 1, presetId: 'prores-4444', params: {} };
    expect(mediaCacheKey({ ...base, deinterlace: false })).not.toBe(mediaCacheKey(base));
    expect(mediaCacheKey({ ...base, deinterlace: undefined })).toBe(mediaCacheKey(base));
  });
});

const ffmpeg = await detectFfmpeg();
const canMake = ffmpeg.ok && ffmpeg.encoders.includes('mpeg4') && ffmpeg.encoders.includes('mpeg2video');

describe.skipIf(!canMake)('generated footage against the ffmpeg here (needs ffmpeg)', () => {
  const ff = ffmpeg.ok ? ffmpeg.path : '';
  let dir = '';
  const clips: Record<string, string> = {};
  const learned: { path: string; field: string }[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulp-interlace-'));
    const make = (name: string, args: string[]) => {
      const run = spawnSync(ff, args);
      expect(run.status, String(run.stderr)).toBe(0);
      clips[name] = args[args.length - 1]!;
    };
    make('tff', fixtureClipArgs('tff', join(dir, 'tff.mp4')));
    make('bff', fixtureClipArgs('bff', join(dir, 'bff.mp4')));
    make('progressive', fixtureClipArgs('progressive', join(dir, 'progressive.mp4')));
    make('tagged', fixtureClipArgs('tff', join(dir, 'tagged.mpg'), { tagged: true }));
    make('lying', fixtureClipArgs('progressive', join(dir, 'lying.mpg'), { tagged: true }));
    make('phone', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=60:d=1', '-c:v', 'mpeg4', join(dir, 'phone.mp4')]);
    forgetScans();
    onScanMeasured((entry, scan) => learned.push({ path: entry.path, field: scan.field }));
  });

  afterAll(async () => {
    onScanMeasured(() => undefined);
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const entry = (name: string): MediaEntry => media({ id: name, key: name, path: clips[name]!, ext: clips[name]!.slice(-4) });

  /** The window's frames as the preview and the render read them, at full size, as gray. */
  function frames(name: string, deinterlace: 'tff' | 'bff' | undefined, count = 10): Uint8Array[] {
    const args = clipFramesArgs(entry(name), { frames: 50, fps: IL_FPS }, { first: 0, frames: count }, 2048, deinterlace ? { deinterlace } : {});
    // The same arguments, the PNG pipe swapped for raw gray so the test can read the rows.
    const vfAt = args.indexOf('-vf');
    const raw = [...args.slice(0, vfAt), '-vf', args[vfAt + 1]!.replace(/format=rgba$/, 'format=gray'), '-f', 'rawvideo', 'pipe:1'];
    const run = spawnSync(ff, raw, { maxBuffer: 64 * 1024 * 1024 });
    expect(run.status, String(run.stderr)).toBe(0);
    const size = IL_WIDTH * IL_HEIGHT;
    return Array.from({ length: Math.floor(run.stdout.length / size) }, (_, i) => new Uint8Array(run.stdout.buffer, run.stdout.byteOffset + i * size, size));
  }

  it('finds woven fields in the frames, top or bottom first, with no tag to say so', async () => {
    expect(await scanOf(ff, entry('tff'))).toMatchObject({ field: 'tff', by: 'frames' });
    expect(await scanOf(ff, entry('bff'))).toMatchObject({ field: 'bff', by: 'frames' });
    expect(await scanOf(ff, entry('tagged'))).toMatchObject({ field: 'tff', by: 'frames' });
    // And what was learned is handed on, for the library to keep.
    expect(learned.find((l) => l.path === clips.tff)?.field).toBe('tff');
  }, 60_000);

  it('leaves progressive footage progressive, even tagged top field first, and reads no frames of a 60 fps clip', async () => {
    expect(await scanOf(ff, entry('progressive'))).toMatchObject({ field: 'progressive', by: 'frames' });
    const lying = await scanOf(ff, entry('lying'));
    expect(lying).toMatchObject({ field: 'progressive', by: 'frames' });
    expect(lying?.frames?.progressive).toBeGreaterThan(30);
    expect(await scanOf(ff, entry('phone'))).toEqual({ field: 'progressive', by: 'shape' });
    expect(await deinterlaceFor(ff, entry('progressive'))).toBeUndefined();
  }, 60_000);

  it('measures the interlaced clip combed as it is and free of combing after, in the preview\'s own frames', async () => {
    for (const name of ['tff', 'bff'] as const) {
      const field = await deinterlaceFor(ff, entry(name));
      expect(field).toBe(name);
      const before = frames(name, undefined);
      const after = frames(name, field);
      expect(after).toHaveLength(before.length);
      for (let i = 1; i < before.length; i++) {
        expect(combScore(before[i]!, IL_WIDTH, IL_HEIGHT), `${name} frame ${i}, as it is`).toBeGreaterThan(100);
        expect(combScore(after[i]!, IL_WIDTH, IL_HEIGHT), `${name} frame ${i}, deinterlaced`).toBeLessThan(2);
      }
    }
  }, 60_000);

  it('keeps the motion in its order: each frame shows the box where its first field caught it', () => {
    // In a woven frame the top field is the even rows and the bottom the odd. Deinterlaced in the
    // clip's own order, every row of the frame shows the box where the first field caught it; in the
    // other order, where the second did — a field later, so motion would step back and forth.
    const even = IL_BOX.top + 2 * Math.round(IL_BOX.height / 4);
    for (const name of ['tff', 'bff'] as const) {
      const woven = frames(name, undefined);
      const got = frames(name, name);
      const wrong = frames(name, name === 'tff' ? 'bff' : 'tff');
      for (let k = 0; k < woven.length; k++) {
        const top = boxLeftEdge(woven[k]!, IL_WIDTH, even);
        const bottom = boxLeftEdge(woven[k]!, IL_WIDTH, even + 1);
        const [first, second] = name === 'tff' ? [top, bottom] : [bottom, top];
        // The first field caught the box a field earlier, which is a step to the left.
        expect(second - first, `${name} frame ${k}: the fields a field apart`).toBe(IL_STEP);
        for (const row of [even, even + 1]) {
          expect(Math.abs(boxLeftEdge(got[k]!, IL_WIDTH, row) - first), `${name} frame ${k} row ${row}`).toBeLessThanOrEqual(2);
          expect(Math.abs(boxLeftEdge(wrong[k]!, IL_WIDTH, row) - second), `${name} frame ${k} row ${row}, the other order`).toBeLessThanOrEqual(2);
        }
      }
      // And frame to frame the box moves on two fields' worth, evenly.
      for (let k = 1; k < got.length; k++) expect(boxLeftEdge(got[k]!, IL_WIDTH, even) - boxLeftEdge(got[k - 1]!, IL_WIDTH, even)).toBe(2 * IL_STEP);
    }
  });

  it('reads the progressive clip exactly as it was: clean, every row of a frame at one moment, moving evenly', () => {
    const plain = frames('progressive', undefined);
    const row = IL_BOX.top + 2 * Math.round(IL_BOX.height / 4);
    for (let k = 0; k < plain.length; k++) {
      expect(combScore(plain[k]!, IL_WIDTH, IL_HEIGHT)).toBeLessThan(1);
      expect(boxLeftEdge(plain[k]!, IL_WIDTH, row + 1)).toBe(boxLeftEdge(plain[k]!, IL_WIDTH, row));
      if (k > 0) expect(boxLeftEdge(plain[k]!, IL_WIDTH, row) - boxLeftEdge(plain[k - 1]!, IL_WIDTH, row)).toBe(2 * IL_STEP);
    }
  });
});
