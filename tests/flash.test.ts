/**
 * The flash warning (milestone 84): the rule as the arithmetic counts it, the
 * moments merged and padded, the graph that calms them and the copy's name —
 * then against the ffmpeg on this machine, with generated clips: a strobe
 * flagged where it runs and softened until it is not, a red-only flash and a
 * strobe over transparency flagged, and steady footage — a picture that moves,
 * a slow pulse, a flash at the limit, a small flashing box — left unmarked.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFfmpeg } from '../src/core/ffmpeg';
import {
  canSoften, detectFlashes, FLASH_GRID, flashFramesArgs, frameTransitions, mergeSpans, softenArgs, softenedCopyPath, softenGraph, softenWindows, splitGridFrames, strongSpans,
} from '../src/core/flash';
import { OUTPUT_PRESETS, PRESET_IDS, REC709_TAGS, RGB_FULL_TAGS } from '../src/core/render-plan';
import { checkRender, draftPathFor, keepSoftened, softenRender } from '../src/main/flash-service';
import { flashSpanText, queueCard } from '../src/core/queue-card';
import { RenderQueue, type RenderQueueJob } from '../src/core/render-queue';
import { cacheKey, mediaCacheKey } from '../src/core/render-cache';
import { helpText, parseCommandLine } from '../src/core/cli';
import { alphaStrobeArgs, colorStrobeArgs, FL_FPS, grayClipArgs, strobeExpr } from './flash-fixture';

const CELLS = FLASH_GRID * FLASH_GRID;

/** A grid frame of one gray (or color) everywhere, opaque unless an alpha is given. */
function flat(v: number | [number, number, number], alpha = 255, share = 1): Uint8Array {
  const [r, g, b] = typeof v === 'number' ? [v, v, v] : v;
  const f = new Uint8Array(CELLS * 4);
  for (let c = 0; c < CELLS; c++) {
    const on = c < CELLS * share;
    f.set(on ? [r, g, b, alpha] : [0, 0, 0, 255], c * 4);
  }
  return f;
}

/** Frames of a strobe: `hz` flashes a second at 30 fps for `seconds`, between two grays. */
function strobe(hz: number, seconds: number, dark = 0, light = 255, share = 1): Uint8Array[] {
  const period = 30 / hz;
  return Array.from({ length: Math.round(seconds * 30) }, (_, n) => flat(n % period < period / 2 ? light : dark, 255, share));
}

describe('the rule, as counted', () => {
  it('flags more than three flashes a second over the whole picture, and says how many', () => {
    const report = detectFlashes([...strobe(1, 1), ...strobe(5, 2), ...strobe(1, 1)].map((f, i) => (i < 30 || i >= 90 ? flat(0) : f)), 30);
    expect(report.spans).toHaveLength(1);
    const [span] = report.spans;
    expect(span!.kinds).toEqual(['general']);
    expect(span!.perSecond).toBe(5);
    // From the first rise at frame 30 to just past the last fall, at frame 87.
    expect(span!.from).toBe(1);
    expect(span!.to).toBe(2.933);
    expect(report).toMatchObject({ fps: 30, frames: 120, transparent: false });
  });

  it('leaves a flash at the limit, a slow pulse, a small flashing area, a dim flicker and a bright one alone', () => {
    expect(detectFlashes(strobe(3, 3), 30).spans, 'three a second is the limit, not past it').toEqual([]);
    expect(detectFlashes(strobe(1, 3), 30).spans).toEqual([]);
    expect(detectFlashes(strobe(6, 3, 0, 255, 0.2), 30).spans, 'a fifth of the picture').toEqual([]);
    // Under a tenth of white in relative luminance: sRGB 20 to 50 is 0.007 to 0.032.
    expect(detectFlashes(strobe(8, 3, 20, 50), 30).spans, 'too small a change').toEqual([]);
    // Both states above 0.80: sRGB 235 to 255 is 0.83 to 1.
    expect(detectFlashes(strobe(8, 3, 235, 255), 30).spans, 'the darker state too bright').toEqual([]);
    expect(detectFlashes(strobe(4, 3), 30).spans).toHaveLength(1);
    expect(detectFlashes(strobe(6, 3, 0, 255, 0.3), 30).spans, 'a third of the picture').toHaveLength(1);
  });

  it('counts a fade as one transition however many frames it takes, and the picture must alternate', () => {
    const fade = Array.from({ length: 30 }, (_, n) => flat(Math.round((n / 29) * 255)));
    const cells = fade.map(() => new Int8Array(CELLS));
    expect(detectFlashes(fade, 30).spans).toEqual([]);
    // Two rises in a row are one: the second waits for a fall.
    cells[3]!.fill(1);
    cells[10]!.fill(1);
    cells[15]!.fill(-1);
    expect(frameTransitions(cells, 30)).toEqual([3, 15]);
    // A quarter of the cells within a tenth of a second (three frames at 30) is enough; an eighth at
    // a time, three frames apart, never is, though every cell rises in the end.
    const spread = Array.from({ length: 24 }, () => new Int8Array(CELLS));
    for (let c = 0; c < CELLS; c++) spread[(c % 8) * 3]![c] = 1;
    expect(frameTransitions(spread, 30)).toEqual([]);
    const close = Array.from({ length: 12 }, () => new Int8Array(CELLS));
    for (let c = 0; c < CELLS / 2; c++) close[c % 2]![c] = 1;
    expect(frameTransitions(close, 30)).toEqual([0]);
  });

  it('flags a saturated red flash that light and dark alone would pass, and names both where both flash', () => {
    // Red against a gray of the same luminance: no light flash, all red flash.
    const red = Array.from({ length: 90 }, (_, n) => flat(n % 6 < 3 ? [255, 0, 0] : [127, 127, 127]));
    expect(detectFlashes(red, 30).spans.map((s) => s.kinds)).toEqual([['red']]);
    const redBlack = Array.from({ length: 90 }, (_, n) => flat(n % 6 < 3 ? [255, 0, 0] : [0, 0, 0]));
    expect(detectFlashes(redBlack, 30).spans.map((s) => s.kinds)).toEqual([['general', 'red']]);
  });

  it('measures transparency over black and over white, and flags what flashes over either', () => {
    const appearing = Array.from({ length: 90 }, (_, n) => flat(255, n % 6 < 3 ? 255 : 0));
    const report = detectFlashes(appearing, 30);
    expect(report.transparent).toBe(true);
    expect(report.spans).toHaveLength(1);
    // A black graphic blinking on transparency flashes over white, not over black.
    expect(detectFlashes(Array.from({ length: 90 }, (_, n) => flat(0, n % 6 < 3 ? 255 : 0)), 30).spans).toHaveLength(1);
  });

  it('runs a second\'s worth together: one span per run, merged across kinds, each held to the file', () => {
    expect(strongSpans([0, 3, 6, 9, 12, 15, 18], 30, 'general')).toHaveLength(1);
    expect(strongSpans([0, 3, 6, 9, 12, 15], 30, 'general'), 'six transitions are three flashes').toEqual([]);
    expect(strongSpans([0, 3, 6, 9, 12, 15, 18, 100, 103, 106, 109, 112, 115, 118], 30, 'general').map((s) => [s.from, s.to])).toEqual([[0, 0.633], [3.333, 3.967]]);
    expect(mergeSpans([{ from: 1, to: 2, perSecond: 4, kinds: ['red'] }, { from: 1.5, to: 3, perSecond: 6, kinds: ['general'] }, { from: 5, to: 6, perSecond: 4, kinds: ['general'] }]))
      .toEqual([{ from: 1, to: 3, perSecond: 6, kinds: ['general', 'red'] }, { from: 5, to: 6, perSecond: 4, kinds: ['general'] }]);
    expect(softenWindows([{ from: 0.1, to: 1, perSecond: 4, kinds: ['general'] }, { from: 1.3, to: 2, perSecond: 4, kinds: ['general'] }, { from: 3.9, to: 4, perSecond: 4, kinds: ['general'] }], 4))
      .toEqual([{ from: 0, to: 2.25 }, { from: 3.65, to: 4 }]);
  });
});

describe('ffmpeg\'s arguments', () => {
  it('reads a render back at its own rate as the grid, a file or a sequence from its first frame', () => {
    const file = flashFramesArgs({ file: '/out/a.webm', decoder: 'libvpx-vp9' }, 30);
    expect(file.slice(file.indexOf('-c:v'), file.indexOf('-c:v') + 4)).toEqual(['-c:v', 'libvpx-vp9', '-i', '/out/a.webm']);
    expect(file[file.indexOf('-vf') + 1]).toBe(`fps=30,scale=${FLASH_GRID}:${FLASH_GRID}:flags=area,format=rgba`);
    expect(file.slice(-3)).toEqual(['-f', 'rawvideo', 'pipe:1']);
    const seq = flashFramesArgs({ pattern: '/out/a_%05d.png', start: 60 }, 25);
    expect(seq.slice(seq.indexOf('-framerate'), seq.indexOf('-framerate') + 6)).toEqual(['-framerate', '25', '-start_number', '60', '-i', '/out/a_%05d.png']);
    expect(splitGridFrames(new Uint8Array(CELLS * 4 * 2 + 7))).toHaveLength(2);
  });

  it('calms only inside the windows, centered, on every plane, and writes the preset\'s own format with the sound copied', () => {
    const graph = softenGraph([{ from: 0.75, to: 3.25 }, { from: 5, to: 6 }], 30);
    expect(graph).toContain('trim=start_frame=10,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=10,tmix=frames=21:weights=\'1 2 3 4 5 6 7 8 9 10 11 10 9 8 7 6 5 4 3 2 1\'');
    expect(graph).toContain("blend=all_expr='if(between(T\\,0.75\\,3.25)+between(T\\,5\\,6)\\,B\\,A)'[soft]");
    for (const id of PRESET_IDS) {
      const preset = OUTPUT_PRESETS[id];
      expect(canSoften(id), id).toBe(!preset.sequence && !preset.still && !preset.animatedImage);
      if (!canSoften(id)) {
        expect(() => softenArgs({ file: '/out/a' }, id, [], 30, '/out/b')).toThrow();
        continue;
      }
      const args = softenArgs({ file: `/out/a${preset.extension}` }, id, [{ from: 1, to: 2 }], 30, `/out/b${preset.extension}`);
      const chain = args[args.indexOf('-filter_complex') + 1]!;
      expect(chain.endsWith(`[soft]${preset.color === 'rec709' ? REC709_TAGS : RGB_FULL_TAGS},format=${preset.pixelFormat}[out]`), id).toBe(true);
      expect(args.join(' ')).toContain(preset.codecArgs.join(' '));
      expect(args.join(' ')).toContain('-map 0:a? ');
      expect(args[args.length - 1]).toBe(`/out/b${preset.extension}`);
    }
    expect(canSoften('png-still')).toBe(false);
    expect(canSoften('wav')).toBe(false);
  });

  it('names a copy beside the render, never over anything, and a draft beside it as a hidden file', () => {
    const taken = new Set(['/out/strap softened.mov', '/out/strap softened 2.mov']);
    expect(softenedCopyPath('/out/strap.mov', (p) => taken.has(p))).toBe('/out/strap softened 3.mov');
    expect(softenedCopyPath('/out/strap.mov', () => false)).toBe('/out/strap softened.mov');
    expect(softenedCopyPath('C:\\out\\strap.mp4', () => false)).toBe('C:\\out\\strap softened.mp4');
    expect(draftPathFor('/out/strap.mov')).toBe('/out/.strap.mov.softening.mov');
  });
});

describe('on the card, in the queue and in the cache', () => {
  const done = (over: Partial<RenderQueueJob> = {}): RenderQueueJob => ({
    id: 1, templateId: 't', templateName: 'Strobe', presetId: 'h264-mp4', outputPath: '/out/s.mp4', output: '/out/s.mp4', totalFrames: 120, firstFrame: 30, status: 'done', frame: 120, warnings: [], ...over,
  });
  const span = { from: 1, to: 2.5, perSecond: 5, kinds: ['general' as const] };

  it('names each moment in the render\'s own timecode, from where the render began, and what flashed', () => {
    expect(flashSpanText(span, 30, 30)).toBe('00:00:02:00–00:00:03:15: 5 flashes a second, light and dark');
    // 2.5 s at 25 fps is frame 62.5, which rounds up to 63: 2 s and 13 frames.
    expect(flashSpanText({ ...span, kinds: ['red'] }, 25)).toBe('00:00:01:00–00:00:02:13: 5 flashes a second, saturated red');
    expect(flashSpanText({ ...span, kinds: ['general', 'red'] }, 30)).toContain('light and dark, and saturated red');
  });

  it('says on the card what the check found, offers Soften… for a video file, and says it is not a certified test', () => {
    expect(queueCard(done()).flash).toBeUndefined();
    expect(queueCard(done({ flash: { state: 'checking' } })).flash).toEqual({ tone: 'muted', text: 'Checking for flashing…', soften: false, busy: true });
    const found = queueCard(done({ flash: { state: 'checked', spans: [span, { ...span, from: 3, to: 3.6 }], fps: 30, transparent: false, canSoften: true } }));
    expect(found.flash).toEqual({ tone: 'warn', text: 'Strong flashing at 00:00:02:00–00:00:03:15: 5 flashes a second, light and dark, and 1 more moment', soften: true, busy: false });
    expect(found.tip).toContain('00:00:04:00–00:00:04:18');
    expect(found.tip).toContain('not a certified broadcast test');
    // A sequence or an animated image is checked, not softened, and says how to soften it.
    const sequence = queueCard(done({ presetId: 'gif', flash: { state: 'checked', spans: [span], fps: 30, transparent: false, canSoften: false } }));
    expect(sequence.flash?.soften).toBe(false);
    expect(sequence.tip).toContain('render this as a video to soften it');
    expect(queueCard(done({ flash: { state: 'checked', spans: [], fps: 30, transparent: false, canSoften: true } })).flash?.text).toBe('No strong flashing found');
    expect(queueCard(done({ flash: { state: 'checked', spans: [], fps: 30, transparent: false, canSoften: true, softened: true } })).flash).toMatchObject({ tone: 'ok', text: 'Softened · no strong flashing found now' });
    expect(queueCard(done({ flash: { state: 'unchecked', reason: 'unreadable' } })).flash?.text).toBe('Not checked for flashing: FFmpeg could not read this file back whole');
    expect(queueCard(done({ flash: { state: 'softening', spans: [span], fps: 30, transparent: false, canSoften: true } })).flash).toMatchObject({ busy: true, soften: false });
    // Nothing is said of a render still running.
    expect(queueCard(done({ status: 'running', flash: { state: 'checking' } })).flash).toBeUndefined();
  });

  it('keeps the check with a finished job only, and a copy as a card of its own', () => {
    const q = new RenderQueue();
    const job = q.add({ templateId: 't', templateName: 'Strobe', presetId: 'h264-mp4', outputPath: '/out/s.mp4', totalFrames: 120 });
    q.setFlash(job.id, { state: 'checking' });
    expect(q.get(job.id)!.flash).toBeUndefined();
    q.startNext();
    q.finish(job.id, { ok: true, output: '/out/s.mp4', frames: 120, warnings: [] });
    q.setFlash(job.id, { state: 'checked', spans: [span], fps: 30, transparent: false, canSoften: true });
    const snapshot = q.snapshot().jobs[0]!;
    expect(snapshot.flash).toMatchObject({ state: 'checked', spans: [span] });
    // The snapshot is a copy: what the window holds cannot change the queue's.
    (snapshot.flash as { spans: unknown[] }).spans.length = 0;
    expect(q.get(job.id)!.flash).toMatchObject({ spans: [span] });
    const copy = q.addFinished({ templateId: 't', templateName: 'Strobe', presetId: 'h264-mp4', outputPath: '/out/s softened.mp4', totalFrames: 120 }, '/out/s softened.mp4', 120, { state: 'checked', spans: [], fps: 30, transparent: false, canSoften: true, softened: true });
    expect(q.get(copy.id)!.flash).toMatchObject({ softened: true });
  });

  it('renders once for the drag cache whether or not the flash check was asked for', () => {
    const base = { templateId: 't', manifest: { version: '1', duration: 4, fps: 30, aspects: ['16:9'], parameters: [], entry: 'index.html' } as never, params: {}, presetId: 'h264-mp4' };
    expect(cacheKey({ ...base, options: { fps: 30, flashCheck: 'warn' } })).toBe(cacheKey({ ...base, options: { fps: 30 } }));
    expect(cacheKey({ ...base, options: { fps: 25 } })).not.toBe(cacheKey({ ...base, options: { fps: 30 } }));
    const media = { id: 'm', size: 1, mtimeMs: 1, presetId: 'h264-mp4', params: {} };
    expect(mediaCacheKey({ ...media, options: { flashCheck: 'soften' } })).toBe(mediaCacheKey(media));
  });

  it('takes --flash-check from the command line, and says in its help that it is not a certified test', () => {
    const parsed = parseCommandLine(['render', 'pulp.samples.strobe', '--out', '/out/s.mp4', '--flash-check', 'soften']);
    expect(parsed).toMatchObject({ kind: 'command', command: 'render', values: { '--flash-check': 'soften' } });
    expect(helpText('render')).toContain('--flash-check warn|soften');
    expect(helpText('render')).toContain('not a certified broadcast test');
  });
});

const ffmpeg = await detectFfmpeg();
const canMake = ffmpeg.ok && ['libx264', 'qtrle', 'aac'].every((e) => ffmpeg.encoders.includes(e));

describe.skipIf(!canMake)('generated footage against the ffmpeg here (needs ffmpeg)', () => {
  const ff = ffmpeg.ok ? ffmpeg.path : '';
  let dir = '';
  const make = (args: string[]) => {
    const run = spawnSync(ff, args);
    expect(run.status, String(run.stderr)).toBe(0);
    return args[args.length - 1]!;
  };
  const target = (output: string, presetId = 'h264-mp4', seconds = 4) => ({ output, presetId, fps: FL_FPS, firstFrame: 0, frames: seconds * FL_FPS });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulp-flash-'));
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('flags a generated strobe where it runs, and softens it until the check passes, the rest and the sound kept', async () => {
    const file = make(grayClipArgs(strobeExpr({ hz: 5, from: 1, to: 2.5 }), 4, join(dir, 'strobe.mp4')));
    const checked = await checkRender(ff, target(file));
    if (!checked.ok) throw new Error(checked.reason);
    expect(checked.report.spans).toHaveLength(1);
    const [span] = checked.report.spans;
    expect(span).toMatchObject({ kinds: ['general'], perSecond: 5 });
    expect(span!.from).toBeGreaterThanOrEqual(0.95);
    expect(span!.from).toBeLessThan(1.1);
    expect(span!.to).toBeGreaterThan(2.3);
    expect(span!.to).toBeLessThanOrEqual(2.55);

    const softened = await softenRender(ff, target(file), checked.report.spans);
    if (!softened.ok) throw new Error(softened.message);
    const { draft } = softened;
    expect(draft.draft).toBe(draftPathFor(file));
    expect(draft.recheck.spans, 'nothing strong left').toEqual([]);
    expect(draft.before.startsWith('data:image/png;base64,')).toBe(true);
    expect(draft.after.startsWith('data:image/png;base64,')).toBe(true);
    // The draft is the render's shape and length, its sound copied, and the render itself untouched.
    const probe = (f: string) => spawnSync(ffmpeg.ok ? ffmpeg.path.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1') : 'ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_frames', '-of', 'csv=p=0', f]).stdout.toString().trim();
    expect(probe(draft.draft)).toBe(probe(file));
    expect((await checkRender(ff, target(file))).ok && (await checkRender(ff, target(file)))).toMatchObject({ report: { spans: [{ perSecond: 5 }] } });
    /** The mean brightness of each frame of a file. */
    const means = (f: string) => [...spawnSync(ff, ['-v', 'error', '-i', f, '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 24 }).stdout];
    const before = means(file);
    const after = means(draft.draft);
    // Outside the padded moment the picture is the render's, within H.264's own loss.
    for (const i of [0, 10, 20, 85, 100, 119]) expect(Math.abs(after[i]! - before[i]!), `frame ${i}`).toBeLessThanOrEqual(3);
    // Inside it, the strobe's swing is gone: steady to within a few levels.
    const inside = after.slice(40, 70);
    expect(Math.max(...inside) - Math.min(...inside)).toBeLessThan(12);
    expect(Math.max(...before.slice(40, 70)) - Math.min(...before.slice(40, 70))).toBeGreaterThan(150);

    // Kept as a copy: beside the render, never over it, the draft gone.
    const copy = await keepSoftened(ff, target(file), draft.draft, 'copy');
    expect(copy).toEqual({ ok: true, file: join(dir, 'strobe softened.mp4') });
    expect(existsSync(draft.draft)).toBe(false);
    expect(existsSync(file)).toBe(true);
    const copied = await checkRender(ff, target(join(dir, 'strobe softened.mp4')));
    expect(copied.ok && copied.report.spans).toEqual([]);
  }, 120_000);

  it('puts a softened render in the render\'s place only when asked, makes its matte again, and throws a draft away', async () => {
    const file = make(alphaStrobeArgs(6, 3, join(dir, 'blink.mov')));
    const t = target(file, 'qt-animation', 3);
    // A matte beside it, as a render with a matte writes one.
    make([...['-v', 'error', '-y', '-i', file, '-vf', 'format=rgba,alphaextract,format=rgb24', '-c:v', 'qtrle'], join(dir, 'blink-matte.mov')]);
    const checked = await checkRender(ff, t);
    if (!checked.ok) throw new Error(checked.reason);
    expect(checked.report.transparent).toBe(true);
    expect(checked.report.spans).toHaveLength(1);
    const thrown = await softenRender(ff, t, checked.report.spans);
    if (!thrown.ok) throw new Error(thrown.message);
    expect(await keepSoftened(ff, t, thrown.draft.draft, 'discard')).toEqual({ ok: true });
    expect(existsSync(thrown.draft.draft)).toBe(false);
    const again = await checkRender(ff, t);
    expect(again.ok && again.report.spans).toHaveLength(1);

    const softened = await softenRender(ff, t, checked.report.spans);
    if (!softened.ok) throw new Error(softened.message);
    expect(softened.draft.recheck.spans).toEqual([]);
    expect(await keepSoftened(ff, t, softened.draft.draft, 'replace')).toEqual({ ok: true, file });
    const replaced = await checkRender(ff, t);
    expect(replaced.ok && replaced.report.spans).toEqual([]);
    // The matte follows the picture: its own blinking is calmed with it.
    const matte = await checkRender(ff, { ...t, output: join(dir, 'blink-matte.mov') });
    expect(matte.ok && matte.report.spans).toEqual([]);
  }, 120_000);

  it('flags a red-only flash, and leaves steady footage unmarked', async () => {
    const red = make(colorStrobeArgs([255, 0, 0], [127, 127, 127], 5, 3, join(dir, 'red.mov')));
    const redCheck = await checkRender(ff, target(red, 'qt-animation', 3));
    expect(redCheck.ok && redCheck.report.spans.map((s) => s.kinds)).toEqual([['red']]);
    const steady = [
      ['moving picture', make(['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=160x90:r=${FL_FPS}:d=4`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'moving.mp4')])],
      ['three a second', make(grayClipArgs(strobeExpr({ hz: 3, from: 0, to: 4 }), 4, join(dir, 'three.mp4')))],
      ['a slow pulse', make(grayClipArgs(strobeExpr({ hz: 1, from: 0, to: 4 }), 4, join(dir, 'pulse.mp4')))],
      ['a fifth of the picture', make(grayClipArgs(strobeExpr({ hz: 8, from: 0, to: 4, area: 0.2 }), 4, join(dir, 'box.mp4')))],
    ] as const;
    for (const [what, file] of steady) {
      const checked = await checkRender(ff, target(file));
      expect(checked.ok && checked.report.spans, what).toEqual([]);
    }
  }, 120_000);

  it('says a render could not be checked rather than passing it: a still, and a file read back short', async () => {
    expect(await checkRender(ff, { ...target('/nowhere.png', 'png-still'), frames: 1 })).toEqual({ ok: false, reason: 'still' });
    const short = make(grayClipArgs(strobeExpr({ hz: 5, from: 0, to: 1 }), 1, join(dir, 'short.mp4')));
    expect(await checkRender(ff, { ...target(short), frames: 120 })).toEqual({ ok: false, reason: 'unreadable' });
    await writeFile(join(dir, 'broken.mp4'), 'not a video');
    expect(await checkRender(ff, target(join(dir, 'broken.mp4')))).toMatchObject({ ok: false, reason: 'failed' });
  }, 60_000);
});
