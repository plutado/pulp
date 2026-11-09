/**
 * End-to-end render test: builds the app, renders bundled samples through the
 * headless `--render` mode and checks the files with ffprobe.
 *
 * Runs only when the Electron binary, ffmpeg and ffprobe are available (and a
 * display on Linux); otherwise the suite is skipped with the reason printed.
 * Set PULP_E2E=0 to skip it explicitly, or PULP_E2E=1 to fail instead of
 * skipping when something is missing (used in CI).
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFfmpeg, nodeRunner } from '../../src/core/ffmpeg';
import { probeMedia } from '../../src/core/media-probe';
import { SEQUENCE_FPS, sequenceMetadata, sequencePatternName } from '../../src/core/media-sequence';
import { sequenceStripArgs } from '../../src/core/hover-scrub';
import { itemId } from '../../src/core/library-scan';
import { mediaUrlFor } from '../../src/core/media-url';
import { scanLibrary } from '../../src/core/library';
import { SAMPLE_MEDIA, sampleAudioArgs, sampleMediaPath, samplesForTypes } from '../../src/core/sample-media';
import { ffmpegArgs, runBounded, runBoundedBuffer } from './process';
import { lottieEditables, lottieInfo, lottieManifest, lottieManifestId, parseLottie, prepareLottieData } from '../../src/core/lottie';
import { LOTTIE_TEMPLATE_PLAYER, lottieTemplateFiles } from '../../src/core/lottie-template';
import { IDENTITY_KEY } from '../../src/core/layer-keys';
import type { MotionTrack } from '../../src/core/motion-track';
import { pinKeys } from '../../src/core/track-pin';
import { dotLottieFixture, lottieFixture } from '../lottie-fixture';

const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(__dirname, 'templates');

async function findTools(): Promise<{ electron: string; ffmpeg: string; ffprobe: string; encoders: string[] } | string> {
  if (process.env.PULP_E2E === '0') return 'PULP_E2E=0';
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return 'no display';
  let electron: string;
  try {
    // The electron package exports the binary path, and throws if the binary was not downloaded.
    electron = (await import('electron')).default as unknown as string;
  } catch {
    return 'Electron binary not installed';
  }
  if (typeof electron !== 'string' || !existsSync(electron)) return 'Electron binary not installed';
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return 'ffmpeg not found';
  const sibling = join(dirname(ffmpeg.path), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  const ffprobe = ffmpeg.path.includes('/') || ffmpeg.path.includes('\\') ? sibling : 'ffprobe';
  try {
    const probeOk = await runBounded(ffprobe, ['-version'], { timeoutMs: 20_000 });
    if (probeOk.code !== 0) throw new Error('ffprobe did not run');
  } catch {
    return 'ffprobe not found next to ffmpeg';
  }
  return { electron, ffmpeg: ffmpeg.path, ffprobe, encoders: ffmpeg.encoders };
}

const tools = await findTools();
if (typeof tools === 'string' && process.env.PULP_E2E === '1') {
  throw new Error(`End-to-end render tests are required (PULP_E2E=1) but cannot run: ${tools}.`);
}
if (typeof tools === 'string') console.info(`Skipping end-to-end render tests: ${tools}.`);
const available = typeof tools === 'string' ? null : tools;

interface StreamInfo {
  codec_name?: string;
  codec_tag_string?: string;
  width: number;
  height: number;
  pix_fmt: string;
  nb_read_frames: string;
  r_frame_rate?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  tags?: Record<string, string>;
}

describe.skipIf(!available)('end-to-end render', () => {
  const { electron, ffmpeg, ffprobe, encoders } = available ?? { electron: '', ffmpeg: '', ffprobe: '', encoders: [] };
  let out = '';

  beforeAll(async () => {
    // Render the current sources, not a stale build.
    const built = await runBounded(process.execPath, [join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build'], { cwd: ROOT, timeoutMs: 100_000 });
    if (built.code !== 0) throw new Error(`build failed: ${built.stderr}`);
    out = await mkdtemp(join(tmpdir(), 'pulp-e2e-'));
  }, 120_000);

  afterAll(async () => {
    // Retries: on Windows a just-exited ffmpeg or Electron can still hold a file for a moment (EBUSY).
    if (out) await rm(out, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });

  async function render(
    templateId: string,
    preset: string,
    file: string,
    opts: { timeoutMs?: number; extra?: string[]; env?: Record<string, string> } = {},
  ) {
    const args = ['.', '--render', templateId, '--preset', preset, '--out', join(out, file), ...(opts.extra ?? [])];
    const r = await runBounded(electron, args, { cwd: ROOT, timeoutMs: opts.timeoutMs ?? 90_000, env: { ...process.env, ...opts.env } });
    return { code: r.code ?? -1, stdout: r.stdout, stderr: r.stderr };
  }

  /** ffprobe and ffmpeg reads of a finished file: quick, so a short limit; a stall here is a bug, not slowness. */
  const TOOL_TIMEOUT_MS = 60_000;

  async function probe(file: string): Promise<StreamInfo> {
    const { stdout, stderr } = await runBounded(ffprobe, [
      '-v', 'error',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,codec_tag_string,width,height,pix_fmt,nb_read_frames,r_frame_rate,color_range,color_space,color_transfer,color_primaries:stream_tags',
      '-of', 'json',
      file,
    ], { timeoutMs: TOOL_TIMEOUT_MS });
    expect(stdout, stderr).not.toBe('');
    return (JSON.parse(stdout) as { streams: StreamInfo[] }).streams[0]!;
  }

  /** Lowest and highest alpha value in one decoded frame. */
  async function alphaRange(file: string, frame: number, decoder?: string): Promise<[number, number]> {
    const { stdout } = await runBoundedBuffer(
      ffmpeg,
      ffmpegArgs([
        '-v', 'error',
        ...(decoder ? ['-c:v', decoder] : []),
        '-i', file,
        '-vf', `select=eq(n\\,${frame})`,
        '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
      ]),
      // One raw RGBA frame; 8K needs 7680 * 4320 * 4 = ~127 MiB.
      { timeoutMs: 180_000, maxBuffer: 192 * 1024 * 1024 },
    );
    let min = 255;
    let max = 0;
    for (let i = 3; i < stdout.length; i += 4) {
      const a = stdout[i]!;
      if (a < min) min = a;
      if (a > max) max = a;
    }
    expect(stdout.length).toBeGreaterThan(0);
    return [min, max];
  }

  /**
   * RGBA values of `count` pixels in a row starting at (x, y) of the first frame.
   * Converts to RGBA before cropping: on chroma-subsampled video a 1px crop would round to nothing.
   */
  async function pixels(file: string, x: number, y: number, count = 1): Promise<number[]> {
    const { stdout, stderr } = await runBoundedBuffer(
      ffmpeg,
      ffmpegArgs(['-v', 'error', '-i', file, '-vf', `format=rgba,crop=${count}:1:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']),
      { timeoutMs: TOOL_TIMEOUT_MS },
    );
    expect(stdout.length, stderr).toBe(count * 4);
    return [...stdout];
  }

  /** Check the size-probe fixture's pattern in a lossless RGBA frame. */
  async function expectProbeMarkers(file: string, width: number, height: number) {
    // Opaque corner markers prove the full canvas is present and not rotated.
    expect(await pixels(file, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(await pixels(file, width - 1, 0)).toEqual([0, 255, 0, 255]);
    expect(await pixels(file, 0, height - 1)).toEqual([0, 0, 255, 255]);
    expect(await pixels(file, width - 1, height - 1)).toEqual([255, 255, 255, 255]);
    // Away from the markers the frame is fully transparent. The fixture marks the center if the
    // page saw a devicePixelRatio other than 1, so this also checks the explicit scale 1.
    expect((await pixels(file, Math.floor(width / 2), Math.floor(height / 2)))[3]).toBe(0);
    // The 1px checkerboard at (32, 32) survives exactly only if the frame was never rescaled.
    const row = await pixels(file, 32, 40, 16);
    for (let i = 0; i < 16; i++) {
      const v = (i + 8) % 2 === 0 ? 255 : 0;
      expect(row.slice(i * 4, (i + 1) * 4), `checkerboard pixel ${i}`).toEqual([v, v, v, 255]);
    }
  }

  // The bundled samples are all 1920x1080, so larger and portrait sizes use the
  // size-probe fixtures (ROADMAP milestone 1: verify 4K and above).
  const sizes = [
    { label: '4K', id: 'pulp.test.size-4k', file: 'size-4k', width: 3840, height: 2160, timeoutMs: 180_000 },
    { label: '8K', id: 'pulp.test.size-8k', file: 'size-8k', width: 7680, height: 4320, timeoutMs: 300_000 },
    { label: 'portrait 1080x1920', id: 'pulp.test.size-portrait', file: 'size-portrait', width: 1080, height: 1920, timeoutMs: 180_000 },
  ] as const;

  for (const { label, id, file, width, height, timeoutMs } of sizes) {
    it(`renders a pixel-exact PNG sequence at ${label}`, async () => {
      const result = await render(id, 'png-sequence', file, { extra: ['--library', FIXTURES], timeoutMs });
      expect(result.code, result.stderr).toBe(0);
      const frames = (await readdir(out)).filter((f) => f.startsWith(`${file}_`)).sort();
      expect(frames).toHaveLength(3);
      const frame = join(out, frames[1]!);
      expect(await probe(frame)).toMatchObject({ width, height, pix_fmt: 'rgba' });
      await expectProbeMarkers(frame, width, height);
    }, timeoutMs + 60_000);
  }

  // A template that declares shapes and no size (ADR 0012): the renderer sizes its window from the
  // chosen aspect and resolution, and the capture check follows, so these prove the whole path.
  it('renders a shape-only template at its first aspect\'s default size when nothing is chosen', async () => {
    const result = await render('pulp.test.aspect-probe', 'png-sequence', 'aspect-default', { extra: ['--library', FIXTURES] });
    expect(result.code, result.stderr).toBe(0);
    const frames = (await readdir(out)).filter((f) => f.startsWith('aspect-default_')).sort();
    expect(frames).toHaveLength(3);
    const frame = join(out, frames[1]!);
    expect(await probe(frame)).toMatchObject({ width: 1920, height: 1080, pix_fmt: 'rgba' });
    await expectProbeMarkers(frame, 1920, 1080);
  }, 180_000);

  it('renders the same template tall with --aspect, and at an exact square with --size', async () => {
    const tall = await render('pulp.test.aspect-probe', 'png-sequence', 'aspect-tall', { extra: ['--aspect', '9:16', '--library', FIXTURES] });
    expect(tall.code, tall.stderr).toBe(0);
    const tallFrame = join(out, (await readdir(out)).filter((f) => f.startsWith('aspect-tall_')).sort()[1]!);
    expect(await probe(tallFrame)).toMatchObject({ width: 1080, height: 1920, pix_fmt: 'rgba' });
    await expectProbeMarkers(tallFrame, 1080, 1920);

    const square = await render('pulp.test.aspect-probe', 'png-sequence', 'aspect-square', { extra: ['--size', '720x720', '--library', FIXTURES] });
    expect(square.code, square.stderr).toBe(0);
    const squareFrame = join(out, (await readdir(out)).filter((f) => f.startsWith('aspect-square_')).sort()[1]!);
    expect(await probe(squareFrame)).toMatchObject({ width: 720, height: 720, pix_fmt: 'rgba' });
    await expectProbeMarkers(squareFrame, 720, 720);
  }, 240_000);

  it('refuses an aspect a template does not draw for, and a malformed --size, before rendering', async () => {
    // The portrait size probe declared 1080x1920, so it is 9:16 and nothing else.
    const wrong = await render('pulp.test.size-portrait', 'png-sequence', 'aspect-wrong', { extra: ['--aspect', '16:9', '--library', FIXTURES] });
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain('aspect 16:9 is not one the template draws for (9:16)');
    const malformed = await render('pulp.test.aspect-probe', 'png-sequence', 'aspect-bad', { extra: ['--size', '1080', '--library', FIXTURES] });
    expect(malformed.code).toBe(2);
    expect(malformed.stderr).toContain('--size 1080');
    expect((await readdir(out)).filter((f) => f.startsWith('aspect-wrong_') || f.startsWith('aspect-bad_'))).toEqual([]);
  }, 120_000);

  it('writes a cover image beside the render, at the same size, from the frame that was picked (milestone 20)', async () => {
    // A thumbnail a platform asks for separately: one still beside the video, the same size, taken
    // at a frame of the graphic — which need not be inside the trim.
    const result = await render('pulp.samples.lower-third-bar', 'h264-mp4', 'with-cover', { extra: ['--cover-at', '2.0s'] });
    expect(result.code, result.stderr).toBe(0);
    const video = join(out, 'with-cover.mp4');
    const cover = join(out, 'with-cover-cover.png');
    expect(existsSync(video), 'the video').toBe(true);
    expect(existsSync(cover), 'the cover beside it').toBe(true);
    const shot = await probe(cover);
    expect(shot).toMatchObject({ codec_name: 'png', width: 1920, height: 1080 });
    // H.264 has no alpha, so the cover is flattened over the same background the video was: opaque.
    expect((await pixels(cover, 4, 4))[3], 'opaque beside an opaque render').toBe(255);
    // It is the frame that was picked: the same frame the still-image preset writes at that point.
    const still = await render('pulp.samples.lower-third-bar', 'png-still', 'cover-check', { extra: ['--in-point', '2.0s'] });
    expect(still.code, still.stderr).toBe(0);
    // The still keeps its alpha where the cover was flattened, so the two are compared on the
    // picture rather than byte for byte: the strap's own color, where the graphic is drawn.
    const at = { x: 300, y: 900 };
    const [cr, cg, cb] = await pixels(cover, at.x, at.y);
    const [sr, sg, sb, sa] = await pixels(join(out, 'cover-check.png'), at.x, at.y);
    expect(sa, 'the graphic is drawn there at that frame').toBeGreaterThan(200);
    for (const [c, s2, name] of [[cr, sr, 'red'], [cg, sg, 'green'], [cb, sb, 'blue']] as const) {
      expect(Math.abs(c! - s2!), `the cover shows the picked frame (${name})`).toBeLessThanOrEqual(2);
    }

    // An alpha render keeps its alpha in the cover too.
    const alpha = await render('pulp.samples.lower-third-bar', 'prores-4444', 'alpha-cover', { extra: ['--cover-at', '2.0s'] });
    expect(alpha.code, alpha.stderr).toBe(0);
    expect((await pixels(join(out, 'alpha-cover-cover.png'), 4, 4))[3], 'transparent where the graphic draws nothing').toBe(0);

    // Without the option there is no cover beside the render.
    const plain = await render('pulp.samples.lower-third-bar', 'h264-mp4', 'no-cover');
    expect(plain.code, plain.stderr).toBe(0);
    expect(existsSync(join(out, 'no-cover-cover.png'))).toBe(false);
  }, 240_000);

  it('renders for a platform: --platform sets the shape, size, rate and encoder together (milestone 20)', async () => {
    // One flag instead of four. The limits ride with it, so the finished file is measured against
    // them — 6 seconds of a lower third is inside every one of TikTok's, so nothing is warned about.
    const made = await runBounded(
      electron,
      ['.', '--render', 'pulp.samples.lower-third-bar', '--platform', 'tiktok', '--out', join(out, 'for-tiktok')],
      { cwd: ROOT, timeoutMs: 90_000 },
    );
    expect(made.code, made.stderr).toBe(0);
    expect(made.stderr).not.toContain('warning:');
    const video = join(out, 'for-tiktok.mp4');
    expect(existsSync(video), 'the H.264 MP4 the platform asks for').toBe(true);
    const shot = await probe(video);
    expect(shot).toMatchObject({ codec_name: 'h264', width: 1080, height: 1920 });
    expect(shot.r_frame_rate).toBe('30/1');
    expect(shot.nb_read_frames).toBe('180');

    // A flag given beside it wins: the platform stays what the file is measured against.
    const resized = await runBounded(
      electron,
      ['.', '--render', 'pulp.samples.lower-third-bar', '--platform', 'tiktok', '--size', '720x1280', '--out', join(out, 'tiktok-720')],
      { cwd: ROOT, timeoutMs: 90_000 },
    );
    expect(resized.code, resized.stderr).toBe(0);
    expect(await probe(join(out, 'tiktok-720.mp4'))).toMatchObject({ codec_name: 'h264', width: 720, height: 1280 });

    // A platform Pulp does not know is named with the list, before anything renders.
    const unknown = await render('pulp.samples.lower-third-bar', 'h264-mp4', 'bad-platform', { extra: ['--platform', 'myspace'] });
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Unknown platform "myspace"');
    expect(unknown.stderr).toContain('tiktok');
    expect(existsSync(join(out, 'bad-platform.mp4'))).toBe(false);
  }, 240_000);

  it('writes a still image: one RGBA PNG of the frame at the in point, the same frame the sequence would write (milestone 44)', async () => {
    // A background that holds still renders as a picture rather than a clip, and any template gives
    // a frame at the playhead — a poster or a thumbnail — which the CLI names with --in-point.
    const still = await render('pulp.samples.lower-third-bar', 'png-still', 'strap-still', { extra: ['--in-point', '2.0s'] });
    expect(still.code, still.stderr).toBe(0);
    const file = join(out, 'strap-still.png');
    expect(existsSync(file), 'one file, not a numbered sequence').toBe(true);
    expect(existsSync(join(out, 'strap-still_00060.png'))).toBe(false);
    expect(await probe(file)).toMatchObject({ codec_name: 'png', width: 1920, height: 1080, pix_fmt: 'rgba' });
    // Transparent where the graphic draws nothing: the top-left corner of a lower third.
    expect((await pixels(file, 4, 4))[3], 'alpha survives').toBe(0);
    // The frame is the in point's: the sequence's frame 60 at 30 fps, byte for byte.
    const seq = await render('pulp.samples.lower-third-bar', 'png-sequence', 'strap-seq', { extra: ['--in-point', '2.0s', '--out-point', '2.0s'] });
    expect(seq.code, seq.stderr).toBe(0);
    const frame = (await readdir(out)).find((f) => f.startsWith('strap-seq_') && f.endsWith('.png'));
    expect(frame).toBeDefined();
    expect((await readFile(file)).equals(await readFile(join(out, frame!))), 'the still is the sequence\'s frame').toBe(true);
    // A background holds still: its still output is the picture at its default size.
    const bg = await render('pulp.samples.mesh-gradient', 'png-still', 'mesh-still');
    expect(bg.code, bg.stderr).toBe(0);
    expect(await probe(join(out, 'mesh-still.png'))).toMatchObject({ width: 1920, height: 1080 });
    expect((await pixels(join(out, 'mesh-still.png'), 960, 540))[3], 'a background is opaque').toBe(255);
  }, 240_000);

  it('makes just one category\'s sample media, and leaves the rest of the catalog alone (milestone 34)', async () => {
    // What the results' "N more with sample media" button asks for: the types in view, not the
    // whole 625-file catalog. Vignettes are three stills from one page, so this stays quick.
    const folder = join(out, 'Sample media by type');
    const r = await runBounded(electron, ['.', '--sample-media', folder, '--types', 'vignette'], { cwd: ROOT, timeoutMs: 180_000 });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/3 written, 0 already there, 0 failed/);
    const wanted = samplesForTypes(['vignette']);
    expect(wanted).toHaveLength(3);
    for (const item of wanted) expect(existsSync(join(folder, ...sampleMediaPath(item))), sampleMediaPath(item).join('/')).toBe(true);
    // And nothing else: every other catalog file is still to make.
    for (const item of SAMPLE_MEDIA) {
      if (item.type === 'vignette') continue;
      expect(existsSync(join(folder, ...sampleMediaPath(item))), sampleMediaPath(item).join('/')).toBe(false);
    }
    // The library gives them the type the catalog meant, so the hint's count falls by three.
    const index = await scanLibrary([folder]);
    expect(index.problems).toEqual([]);
    expect(index.media.map((m) => m.type).filter(Boolean)).toEqual(['vignette', 'vignette', 'vignette']);
    // A second run has nothing left to do, which is what makes the line go.
    const again = await runBounded(electron, ['.', '--sample-media', folder, '--types', 'vignette'], { cwd: ROOT, timeoutMs: 180_000 });
    expect(again.stdout).toMatch(/0 written, 3 already there, 0 failed/);
    // A type with no sample media is said, not quietly taken as the whole catalog.
    const none = await runBounded(electron, ['.', '--sample-media', folder, '--types', 'lower-third'], { cwd: ROOT, timeoutMs: 60_000 });
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('No sample media for --types lower-third');
  }, 300_000);

  it('makes the whole sample-media folder, and every file lands with the type its folder means', async () => {
    const folder = join(out, 'Sample media');
    const makeAll = async () => {
      // 626 files, 120 of them clips captured frame by frame and streamed raw into ffmpeg: about three
      // minutes on a Mac, under three times that on the macOS runner, so the bound sits well above both.
      const r = await runBounded(electron, ['.', '--sample-media', folder], { cwd: ROOT, timeoutMs: 840_000 });
      return { code: r.code ?? -1, stdout: r.stdout, stderr: r.stderr };
    };
    const result = await makeAll();
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\d+ written, 0 already there, 0 failed/);
    // Every catalog file exists, and the library gives it the type the catalog meant.
    const index = await scanLibrary([folder]);
    expect(index.problems).toEqual([]);
    const byPath = new Map(index.media.map((m) => [m.path, m]));
    for (const item of SAMPLE_MEDIA) {
      const path = join(folder, ...sampleMediaPath(item));
      expect(existsSync(path), path).toBe(true);
      expect(byPath.get(path)?.type, path).toBe(item.type);
    }
    expect(existsSync(join(folder, 'LICENSE-CC0.txt'))).toBe(true);
    // One of each kind through ffprobe: a clip at the catalog size, a stereo mix, a still with alpha.
    const clip = await probe(join(folder, 'Video clips', 'Stock footage', 'boardroom-loop.mp4'));
    expect(clip).toMatchObject({ codec_name: 'h264', width: 1280, height: 720 });
    const { stdout: mix } = await runBounded(available!.ffprobe, ['-v', 'error', '-show_entries', 'stream=channels,sample_rate:format=duration', '-of', 'json', join(folder, 'Music', 'Full mix', 'night-drive.wav')], { timeoutMs: TOOL_TIMEOUT_MS });
    const mixInfo = JSON.parse(mix) as { streams: { channels: number; sample_rate: string }[]; format: { duration: string } };
    expect(mixInfo.streams[0]).toMatchObject({ channels: 2, sample_rate: '48000' });
    expect(Number(mixInfo.format.duration)).toBeCloseTo(16, 0);
    expect(await probe(join(folder, 'Stills', 'Layered graphics', 'badge.png'))).toMatchObject({ width: 1080, height: 1080, pix_fmt: 'rgba' });
    // The center of the badge is opaque red, the corner transparent: the page drew, and alpha survived.
    expect((await pixels(join(folder, 'Stills', 'Layered graphics', 'badge.png'), 540, 540))[3]).toBe(255);
    expect((await pixels(join(folder, 'Stills', 'Layered graphics', 'badge.png'), 2, 2))[3]).toBe(0);
    // Milestone 24's plates draw too, each in the way its kind should: a backdrop covers the frame,
    // a vignette leaves the middle clear and darkens the corner, an icon has its mark in the middle.
    const backdrop = join(folder, 'Backgrounds', 'mesh-gradient.png');
    expect((await pixels(backdrop, 960, 540))[3], 'a backdrop is opaque').toBe(255);
    expect((await pixels(backdrop, 20, 20))[3], 'a backdrop reaches its corners').toBe(255);
    const vignette = join(folder, 'Overlays', 'Vignettes', 'vignette-heavy.png');
    expect((await pixels(vignette, 960, 540))[3], 'a vignette leaves the middle clear').toBeLessThan(20);
    expect((await pixels(vignette, 8, 8))[3], 'a vignette darkens the corner').toBeGreaterThan(150);
    const icon = join(folder, 'Design elements', 'Icons', 'icon-star.png');
    expect((await pixels(icon, 540, 540))[3], 'an icon has its mark in the middle').toBe(255);
    expect((await pixels(icon, 6, 6))[3], 'an icon leaves its corner clear').toBe(0);

    // Milestone 26's assets are isolated elements on transparency, so the alpha is the point.
    // A still asset is RGBA with its corner clear; a clip carries a real alpha layer, which in
    // WebM is the container's alpha_mode and the libvpx decoder's business — ffprobe's pix_fmt
    // says yuv420p for a VP9 alpha file and always will (docs/platform-notes.md).
    const assetStill = join(folder, 'Assets', 'Fire and flames', 'torch-flame.png');
    expect(await probe(assetStill)).toMatchObject({ width: 512, height: 512, pix_fmt: 'rgba' });
    expect((await pixels(assetStill, 4, 4))[3], 'an asset still leaves its corner clear').toBe(0);
    // An object (the Objects kind, taxonomy 4): its mark in the middle, its corner clear, and its
    // theme subfolder read by the scan.
    const objectStill = join(folder, 'Assets', 'Sports equipment', 'Soccer', 'soccer-ball.png');
    expect(await probe(objectStill)).toMatchObject({ width: 512, height: 512, pix_fmt: 'rgba' });
    expect((await pixels(objectStill, 256, 256))[3], 'an object is opaque at its center').toBe(255);
    expect((await pixels(objectStill, 4, 4))[3], 'an object leaves its corner clear').toBe(0);
    expect(byPath.get(objectStill)?.themes, 'the theme folder tags the object').toContain('soccer');
    const assetClip = join(folder, 'Assets', 'Confetti and celebration', 'confetti-burst.webm');
    const clipInfo = await probe(assetClip);
    expect(clipInfo).toMatchObject({ width: 640, height: 360 });
    expect(clipInfo.tags?.alpha_mode ?? clipInfo.tags?.ALPHA_MODE, 'an asset clip carries alpha').toBe('1');
    const [aMin, aMax] = await alphaRange(assetClip, 20, 'libvpx-vp9');
    expect(aMin, 'transparent where nothing is drawn').toBe(0);
    expect(aMax, 'opaque where the confetti is').toBeGreaterThan(200);
    // And it moves: how much of the frame the burst covers changes as it spreads. Peak alpha
    // cannot show that — confetti is opaque from the first frame — so the covered area is what
    // is measured.
    const covered = async (frame: number): Promise<number> => {
      const { stdout } = await runBoundedBuffer(
        ffmpeg,
        ffmpegArgs(['-v', 'error', '-c:v', 'libvpx-vp9', '-i', assetClip, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']),
        // One raw RGBA frame has to fit, as it does for alphaRange above.
        { timeoutMs: 180_000, maxBuffer: 192 * 1024 * 1024 },
      );
      let n = 0;
      for (let i = 3; i < stdout.length; i += 4) if (stdout[i]! > 8) n++;
      return n;
    };
    const [atStart, atEnd] = [await covered(2), await covered(30)];
    expect(atStart, 'the asset draws something early on').toBeGreaterThan(0);
    expect(atEnd, 'and a different amount later: the asset moves').not.toBe(atStart);
    // No sound clips and none is near silence: a gain that stacks harmonics past full scale shows up here.
    for (const item of SAMPLE_MEDIA) {
      if (item.recipe.kind !== 'audio') continue;
      const wav = join(folder, ...sampleMediaPath(item));
      const { stderr } = await runBounded(ffmpeg, ffmpegArgs(['-hide_banner', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-']), { timeoutMs: TOOL_TIMEOUT_MS });
      const max = Number(/max_volume: (-?[\d.]+) dB/.exec(stderr)?.[1]);
      const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(stderr)?.[1]);
      expect(max, `${item.file} peaks at ${max} dB`).toBeLessThan(-0.2);
      expect(mean, `${item.file} averages ${mean} dB`).toBeGreaterThan(-50);
    }
    // Running it again writes nothing.
    const again = await makeAll();
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/0 written, \d+ already there, 0 failed/);
  }, 900_000);

  it('keeps frames pixel-exact when the display is scaled to 150%', async () => {
    // Chromium's switch makes the primary display report scale 1.5, as Windows does at 150% scaling.
    // The offscreen window is pinned to scale 1, so the output must be identical to the unscaled render.
    const result = await render('pulp.test.size-portrait', 'png-sequence', 'scaled150', {
      extra: ['--force-device-scale-factor=1.5', '--library', FIXTURES],
    });
    expect(result.code, result.stderr).toBe(0);
    const frames = (await readdir(out)).filter((f) => f.startsWith('scaled150_')).sort();
    expect(frames).toHaveLength(3);
    const frame = join(out, frames[1]!);
    expect(await probe(frame)).toMatchObject({ width: 1080, height: 1920, pix_fmt: 'rgba' });
    await expectProbeMarkers(frame, 1080, 1920);
  }, 180_000);

  it('refuses a HiDPI offscreen surface instead of resizing the frames', async () => {
    // PULP_OFFSCREEN_SCALE simulates a display that renders the offscreen window at 2x.
    const result = await render('pulp.test.size-portrait', 'png-sequence', 'scaled', {
      extra: ['--library', FIXTURES],
      env: { PULP_OFFSCREEN_SCALE: '2' },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'Template "Test Size Portrait" frame 0 was captured at 2160x3840 instead of 1080x1920 (scale 2).',
    );
    expect((await readdir(out)).filter((f) => f.startsWith('scaled_'))).toEqual([]);
  }, 120_000);

  it('tags video output as Rec.709 limited range and keeps saturated colors', async () => {
    // The size probe's corner markers are pure sRGB red, green, blue and white. Converted with the
    // BT.709 matrix and tagged, they decode back to the same values; the untagged BT.601 default
    // would read red as about (255, 25, 0).
    const expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
    const spots = [[4, 4], [1080 - 5, 4], [4, 1920 - 5], [1080 - 5, 1920 - 5]];
    const check = async (file: string, tolerance: number) => {
      expect(await probe(file)).toMatchObject({ color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709' });
      for (const [i, [x, y]] of spots.entries()) {
        const px = await pixels(file, x!, y!);
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(px[c]! - expected[i]![c]!), `${basename(file)} marker ${i} channel ${c}`).toBeLessThanOrEqual(tolerance);
        }
      }
    };
    // H.264 flattens the alpha fixture over black, so this covers the composite-then-convert chain.
    const mp4 = await render('pulp.test.size-portrait', 'h264-mp4', 'color.mp4', { extra: ['--library', FIXTURES] });
    expect(mp4.code, mp4.stderr).toBe(0);
    expect((await probe(join(out, 'color.mp4'))).color_range).toBe('tv');
    await check(join(out, 'color.mp4'), 4);
    const mov = await render('pulp.test.size-portrait', 'prores-4444', 'color.mov', { extra: ['--library', FIXTURES] });
    expect(mov.code, mov.stderr).toBe(0);
    await check(join(out, 'color.mov'), 2);
  }, 240_000);

  it('samples the template at an overridden frame rate', async () => {
    // The fixture is 0.1 s at 30 fps (3 frames); at 60 fps it is 6 frames at 60 fps.
    const result = await render('pulp.test.size-portrait', 'prores-4444', 'fps60.mov', { extra: ['--fps', '60', '--library', FIXTURES] });
    expect(result.code, result.stderr).toBe(0);
    expect(await probe(join(out, 'fps60.mov'))).toMatchObject({ width: 1080, height: 1920, nb_read_frames: '6', r_frame_rate: '60/1' });
    expect(result.stdout).toContain('(6 frames in');
  }, 180_000);

  it('renders one template from each matched sample set with alpha', async () => {
    // Boardroom lower third at mid-hold: content where the graphic sits, clear air in the top corner.
    const a = await render('pulp.samples.boardroom.lower-third', 'png-sequence', 'set-board', {
      extra: ['--in-point', '00:00:03:00', '--out-point', '00:00:03:02'],
    });
    expect(a.code, a.stderr).toBe(0);
    const boardFrames = (await readdir(out)).filter((f) => /^set-board_\d{5}\.png$/.test(f)).sort();
    expect(boardFrames).toHaveLength(3);
    expect((await pixels(join(out, 'set-board_00090.png'), 40, 40))[3]).toBe(0); // transparent away from the graphic
    expect((await pixels(join(out, 'set-board_00090.png'), 130, 900))[3]).toBeGreaterThan(0); // the backing tint

    // Newsdesk slash wipe at its midpoint: the frame is fully covered by the opaque navy panel.
    const b = await render('pulp.samples.newsdesk.transition', 'png-sequence', 'set-news', {
      extra: ['--in-point', '17', '--out-point', '19'],
    });
    expect(b.code, b.stderr).toBe(0);
    const newsFrames = (await readdir(out)).filter((f) => /^set-news_\d{5}\.png$/.test(f)).sort();
    expect(newsFrames).toHaveLength(3);
    expect(await pixels(join(out, 'set-news_00018.png'), 960, 540)).toEqual([14, 21, 38, 255]); // #0e1526, opaque

    // Matchday chevron wipe at its midpoint: covered by the opaque near-black panel.
    const c = await render('pulp.samples.matchday.transition', 'png-sequence', 'set-match', {
      extra: ['--in-point', '18', '--out-point', '18'],
    });
    expect(c.code, c.stderr).toBe(0);
    expect(await pixels(join(out, 'set-match_00018.png'), 960, 540)).toEqual([16, 16, 16, 255]); // #101010, opaque

    // Festival iris wipe at its midpoint: the plum circle covers the center.
    const f = await render('pulp.samples.festival.transition', 'png-sequence', 'set-fest', {
      extra: ['--in-point', '21', '--out-point', '21'],
    });
    expect(f.code, f.stderr).toBe(0);
    // Off center: at the exact midpoint the gold rim sits collapsed at the center point itself.
    expect(await pixels(join(out, 'set-fest_00021.png'), 700, 540)).toEqual([52, 31, 62, 255]); // #341f3e, opaque
    expect((await pixels(join(out, 'set-fest_00021.png'), 10, 540))[3]).toBe(255); // edges covered too at the midpoint
  }, 240_000);

  it('renders a matched set\'s lower third and title tall, re-laid out above the caption band', async () => {
    // Milestone 19: the same template at 9:16. The graphic sits above the bottom 22% (the caption band)
    // and left of the right 18% (the controls column), and the frame is transparent there.
    const lt = await render('pulp.samples.boardroom.lower-third', 'png-sequence', 'tall-board', { extra: ['--aspect', '9:16', '--in-point', '90', '--out-point', '90'] });
    expect(lt.code, lt.stderr).toBe(0);
    const ltFrame = join(out, 'tall-board_00090.png');
    expect(await probe(ltFrame)).toMatchObject({ width: 1080, height: 1920 });
    expect((await pixels(ltFrame, 100, 1270))[3]).toBeGreaterThan(0); // the backing tint
    expect((await pixels(ltFrame, 540, 1700))[3]).toBe(0); // the caption band
    expect((await pixels(ltFrame, 1000, 1300))[3]).toBe(0); // the controls column
    expect((await pixels(ltFrame, 40, 40))[3]).toBe(0);

    const title = await render('pulp.samples.matchday.title', 'png-sequence', 'tall-match', { extra: ['--aspect', '9:16', '--in-point', '90', '--out-point', '90'] });
    expect(title.code, title.stderr).toBe(0);
    const titleFrame = join(out, 'tall-match_00090.png');
    expect(await probe(titleFrame)).toMatchObject({ width: 1080, height: 1920 });
    expect((await pixels(titleFrame, 200, 780))[3]).toBe(255); // a headline glyph, wrapped onto the tall frame
    expect((await pixels(titleFrame, 540, 1600))[3]).toBe(0); // the caption band
  }, 240_000);

  it('runs a graphic for the length asked for, stretching only its hold (milestone 30)', async () => {
    // The fixture paints its own time into every frame — whole seconds in red, thousandths in
    // green — so a render can be read back moment by moment. It is designed at two seconds with
    // half a second of entrance and half a second of exit.
    const templateTime = async (file: string): Promise<number> => {
      // Milliseconds across two channels: the high byte in red, the low one in green.
      const [r, g] = await pixels(file, 10, 10);
      return (r! * 256 + g!) / 1000;
    };

    const own = await render('pulp.test.structure', 'png-sequence', 'len-own', { extra: ['--library', FIXTURES] });
    expect(own.code, own.stderr).toBe(0);
    expect((await readdir(out)).filter((f) => /^len-own_\d{5}\.png$/.test(f))).toHaveLength(60);

    const long = await render('pulp.test.structure', 'png-sequence', 'len-long', { extra: ['--library', FIXTURES, '--length', '10'] });
    expect(long.code, long.stderr).toBe(0);
    // Ten seconds at 30 fps, where its own two seconds were sixty frames.
    expect((await readdir(out)).filter((f) => /^len-long_\d{5}\.png$/.test(f))).toHaveLength(300);

    // The entrance plays at the speed it was designed at: frame 15 is half a second in, either way.
    expect(await templateTime(join(out, 'len-long_00015.png'))).toBeCloseTo(await templateTime(join(out, 'len-own_00015.png')), 3);
    expect(await templateTime(join(out, 'len-long_00015.png'))).toBeCloseTo(0.5, 2);
    // The exit begins half a second before the end, wherever the end is, and both renders finish
    // on the same moment of the template.
    expect(await templateTime(join(out, 'len-long_00285.png'))).toBeCloseTo(1.5, 2);
    expect(await templateTime(join(out, 'len-long_00299.png'))).toBeCloseTo(await templateTime(join(out, 'len-own_00059.png')), 3);
    // And only the hold stretched: the middle of ten seconds is the middle of its one-second hold.
    expect(await templateTime(join(out, 'len-long_00150.png'))).toBeCloseTo(1, 2);

    // A trim is taken within the chosen length, not within the template's own two seconds.
    const trimmed = await render('pulp.test.structure', 'png-sequence', 'len-trim', {
      extra: ['--library', FIXTURES, '--length', '10', '--in-point', '150', '--out-point', '159'],
    });
    expect(trimmed.code, trimmed.stderr).toBe(0);
    expect((await readdir(out)).filter((f) => /^len-trim_\d{5}\.png$/.test(f))).toHaveLength(10);
    expect(await templateTime(join(out, 'len-trim_00150.png'))).toBeCloseTo(1, 2);

    // A "Hold, seconds" saved before the eleven templates lost it becomes the matching length
    // (src/core/legacy-hold.ts) rather than being dropped: the citation callout holds from 1.35 s
    // to 3.97 s of its own six, so a saved hold of 5 s is an entrance of 1.35, five seconds still
    // and an exit of 2.03 — 8.38 s, 251 frames at 30 fps, where the template's own length is 180.
    const legacy = await render('pulp.samples.citation-callout', 'png-sequence', 'len-hold', { extra: ['--param', 'inOut=5', '--size', '320x180'] });
    expect(legacy.code, legacy.stderr).toBe(0);
    expect((await readdir(out)).filter((f) => /^len-hold_\d{5}\.png$/.test(f))).toHaveLength(251);
    // And it says what it did, since the person asked for something that no longer exists.
    expect(legacy.stdout + legacy.stderr).toContain('the saved 5 s became a length of 8.38 s');

    // A template that declares nothing to stretch — a countdown counts real seconds — says so
    // rather than quietly ignoring the ask.
    const fixed = await render('pulp.samples.launch-countdown', 'png-sequence', 'len-fixed', { extra: ['--length', '20'] });
    expect(fixed.code).toBe(1);
    expect(fixed.stderr).toContain('does not declare an animate-in, hold and animate-out');
  }, 240_000);

  it('repeats a loop and scales a transition to the length asked for (milestone 30)', async () => {
    const diff = async (a: string, b: string): Promise<number> => {
      const read = async (file: string) => {
        const { stdout } = await runBoundedBuffer(ffmpeg, ffmpegArgs(['-v', 'error', '-i', file, '-vf', 'format=rgba', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), { timeoutMs: TOOL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
        return stdout;
      };
      const [x, y] = await Promise.all([read(a), read(b)]);
      let total = 0;
      for (let i = 0; i < x.length; i += 4) total += Math.abs(x[i]! - y[i]!) + Math.abs(x[i + 3]! - y[i + 3]!);
      return total / (x.length / 4);
    };
    const small = ['--fps', '25', '--size', '192x108'];

    // Scanlines is an eight-second loop. Asked for twenty, it goes round rather than slowing:
    // a whole pass later the frame is the same one again.
    const loop = await render('pulp.samples.scanlines', 'png-sequence', 'loop-20', { extra: [...small, '--length', '20'] });
    expect(loop.code, loop.stderr).toBe(0);
    expect((await readdir(out)).filter((f) => /^loop-20_\d{5}\.png$/.test(f))).toHaveLength(500);
    expect(await diff(join(out, 'loop-20_00000.png'), join(out, 'loop-20_00200.png')), 'one whole pass later, the same frame').toBeLessThan(0.01);
    expect(await diff(join(out, 'loop-20_00000.png'), join(out, 'loop-20_00100.png')), 'and in between, a different one').toBeGreaterThan(0.05);

    // A wipe keeps its shape and plays slower: at twice its length every second frame is one of
    // its own, in order — frame 2n of the slowed render is the moment frame n shows at its own
    // length, out to the last frame the template draws. Only the moments that line up are
    // compared: the slowed render samples twice as finely, so its final frame falls half a frame
    // of the template's clock past the native one's, at the point where the circle is a fraction
    // of a pixel across and each platform rounds it its own way.
    const own = await render('pulp.samples.circle-wipe', 'png-sequence', 'wipe-own', { extra: small });
    expect(own.code, own.stderr).toBe(0);
    const slower = await render('pulp.samples.circle-wipe', 'png-sequence', 'wipe-slow', { extra: [...small, '--length', '2.8'] });
    expect(slower.code, slower.stderr).toBe(0);
    expect((await readdir(out)).filter((f) => /^wipe-slow_\d{5}\.png$/.test(f))).toHaveLength(70);
    const frame = (name: string, n: number) => join(out, `${name}_${String(n).padStart(5, '0')}.png`);
    for (const n of [5, 9, 17, 26, 34]) {
      expect(await diff(frame('wipe-slow', 2 * n), frame('wipe-own', n)), `frame ${2 * n} at half speed is frame ${n} at its own`).toBeLessThan(0.01);
    }
    // Half speed rather than merely alike: where the circle grows fastest, the frames either side
    // of the one it matches look nothing like it.
    expect(await diff(frame('wipe-slow', 18), frame('wipe-own', 8)), 'not the frame before').toBeGreaterThan(1);
    expect(await diff(frame('wipe-slow', 18), frame('wipe-own', 10)), 'nor the one after').toBeGreaterThan(1);

    // How far a transition may be pushed is bounded, so it never becomes a still or a flicker.
    const tooSlow = await render('pulp.samples.circle-wipe', 'png-sequence', 'wipe-cap', { extra: [...small, '--length', '60'] });
    expect(tooSlow.code, tooSlow.stderr).toBe(0);
    expect((await readdir(out)).filter((f) => /^wipe-cap_\d{5}\.png$/.test(f)), 'held at four times its own length').toHaveLength(140);
  }, 300_000);

  it('holds still right through the hold a bundled template declares, however it is set (milestone 30)', async () => {
    // One ffmpeg pass for the whole sequence: a hold runs to dozens of frames and a call for each
    // would cost more than the render that made them.
    const sequence = async (name: string, width: number, height: number) => {
      const { stdout } = await runBoundedBuffer(ffmpeg, ffmpegArgs(['-v', 'error', '-i', join(out, `${name}_%05d.png`), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), { timeoutMs: TOOL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
      const stride = width * height * 4;
      return Array.from({ length: Math.floor(stdout.length / stride) }, (_, i) => stdout.subarray(i * stride, (i + 1) * stride));
    };
    const fps = 25;
    const [width, height] = [192, 108];

    // A declared hold promises that stretching those moments changes nothing but how long they
    // are on screen, so nothing inside it may move — and it has to keep that promise however the
    // template is set, not only as it ships. Both ways it can be contradicted are squeezed here:
    // the parameter that decides how long the entrance and exit take, at the slowest it goes, and
    // a line added to an open block, which a stack that staggers its layers brings in after its own.
    const cases = [
      { folder: 'lower-third-bar', file: 'hold-strap', params: ['--param', 'inOut=2', '--param', '@layers={"strap":[{"id":"extra","type":"text","text":"One more line"}]}'] },
      { folder: 'title-card', file: 'hold-card', params: ['--param', '@layers={"card":[{"id":"extra","type":"text","text":"One more line"}]}'] },
    ];
    for (const c of cases) {
      const manifest = JSON.parse(await readFile(join(ROOT, 'templates', c.folder, 'template.json'), 'utf8')) as { id: string; structure: { holdFrom: number; holdTo: number } };
      const r = await render(manifest.id, 'png-sequence', c.file, { extra: ['--fps', String(fps), '--size', `${width}x${height}`, ...c.params] });
      expect(r.code, r.stderr).toBe(0);
      const frames = await sequence(c.file, width, height);
      const first = Math.ceil(manifest.structure.holdFrom * fps);
      const last = Math.floor(manifest.structure.holdTo * fps);
      expect(last, `${manifest.id} declares a hold with frames in it`).toBeGreaterThan(first);
      let worst = 0;
      let at = first;
      for (let i = first + 1; i <= last; i++) {
        let total = 0;
        for (let p = 0; p < frames[first]!.length; p++) total += Math.abs(frames[first]![p]! - frames[i]![p]!);
        const mean = total / (width * height);
        if (mean > worst) { worst = mean; at = i; }
      }
      // A mean level per pixel, over all four channels: a hold that really holds reads 0 or close to it.
      expect(worst, `${manifest.id} moves at frame ${at}, inside the hold it declares`).toBeLessThan(0.05);
    }
  }, 240_000);

  it('draws a layer only between its own start and end, on the clock the graphic is watched at (milestone 28)', async () => {
    // One line of a lower third is given a start and an end; the rest of the graphic is untouched,
    // so a frame either side of the span differs from one inside it by exactly that line.
    const timed = ['--param', `@layers=${JSON.stringify({ strap: [{ id: 'name', span: { start: 2, end: 4 } }] })}`];
    const small = ['--fps', '25', '--size', '192x108'];
    const diff = async (a: string, b: string): Promise<number> => {
      const read = async (file: string) => {
        const { stdout } = await runBoundedBuffer(ffmpeg, ffmpegArgs(['-v', 'error', '-i', file, '-vf', 'format=rgba', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), { timeoutMs: TOOL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
        return stdout;
      };
      const [x, y] = await Promise.all([read(a), read(b)]);
      let total = 0;
      for (let i = 0; i < x.length; i++) total += Math.abs(x[i]! - y[i]!);
      return total / (x.length / 4);
    };
    const frame = (name: string, n: number) => join(out, `${name}_${String(n).padStart(5, '0')}.png`);

    const plain = await render('pulp.samples.lower-third-bar', 'png-sequence', 'span-plain', { extra: small });
    expect(plain.code, plain.stderr).toBe(0);
    const span = await render('pulp.samples.lower-third-bar', 'png-sequence', 'span-cut', { extra: [...small, ...timed] });
    expect(span.code, span.stderr).toBe(0);

    // Inside the span the two renders are the same picture; outside it the line is missing.
    for (const n of [50, 75, 99]) {
      expect(await diff(frame('span-cut', n), frame('span-plain', n)), `frame ${n} is inside the span`).toBeLessThan(0.01);
    }
    for (const n of [25, 49, 100, 125]) {
      expect(await diff(frame('span-cut', n), frame('span-plain', n)), `frame ${n} is outside the span`).toBeGreaterThan(1);
    }

    // The clock is the one a person is watching, not the template's own: asked for twenty seconds,
    // the line still comes at two and goes at four of those twenty, rather than being stretched
    // along with the hold. Frame 50 is 2.00 s and frame 100 is 4.00 s either way.
    const long = await render('pulp.samples.lower-third-bar', 'png-sequence', 'span-long', { extra: [...small, '--length', '20', ...timed] });
    expect(long.code, long.stderr).toBe(0);
    expect((await readdir(out)).filter((f) => /^span-long_\d{5}\.png$/.test(f))).toHaveLength(500);
    const inside = await diff(frame('span-long', 75), frame('span-long', 60));
    expect(inside, 'the line is there right through its own two seconds').toBeLessThan(0.01);
    for (const n of [49, 100, 300, 480]) {
      expect(await diff(frame('span-long', n), frame('span-long', 75)), `frame ${n} of five hundred is outside the span`).toBeGreaterThan(1);
    }
  }, 240_000);

  it('brings a layer in and takes it out the way the layer says, not the template (milestone 28)', async () => {
    // The title card's subtitle, wiped in from the left over a second and cut at four, so what the
    // transition did can be read straight off the frame: a wipe uncovers rather than fades, so the
    // lit columns of the subtitle's band grow from one edge while its brightness never changes.
    const timed = ['--param', `@layers=${JSON.stringify({
      card: [{ id: 'subtitle', transition: { in: { type: 'wipe', seconds: 1, direction: 'left' } }, span: { start: 1, end: 4 } }],
    })}`];
    const [width, height] = [192, 108];
    const band = async (n: number) => {
      const { stdout } = await runBoundedBuffer(ffmpeg, ffmpegArgs(['-v', 'error', '-i', join(out, `wipe-in_${String(n).padStart(5, '0')}.png`), '-vf', 'format=rgba', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), { timeoutMs: TOOL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
      // The subtitle sits below the middle of the card; the title is above it and never moves.
      let first = width, last = -1, lit = 0, brightest = 0;
      for (let y = Math.floor(height * 0.55); y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (stdout[i]! <= 110 || stdout[i + 1]! <= 110 || stdout[i + 2]! <= 110) continue;
          lit++;
          brightest = Math.max(brightest, stdout[i]!);
          first = Math.min(first, x);
          last = Math.max(last, x);
        }
      }
      return { lit, first, last, brightest };
    };

    const r = await render('pulp.samples.title-card', 'png-sequence', 'wipe-in', { extra: ['--fps', '25', '--size', `${width}x${height}`, ...timed] });
    expect(r.code, r.stderr).toBe(0);

    // Nothing before the layer's own start, however far into the template's own stagger that is.
    expect((await band(20)).lit, 'nothing before the layer starts').toBe(0);
    const opening = await band(37);
    const half = await band(45);
    const whole = await band(50);
    // Uncovered from the left: the lit part starts at the same column throughout and reaches
    // further to the right as the wipe runs, rather than appearing all at once or fading up.
    expect(opening.lit, 'the wipe has begun').toBeGreaterThan(0);
    expect(opening.last, 'and has not finished').toBeLessThan(whole.last);
    expect(half.last).toBeGreaterThan(opening.last);
    expect([opening.first, half.first], 'uncovered from one edge, which does not move').toEqual([whole.first, whole.first]);
    // A wipe does not fade: what is shown is as bright at a quarter of the way through as at the end.
    expect(Math.abs(opening.brightest - whole.brightest), 'a wipe uncovers rather than fades').toBeLessThan(8);
    // Still whole just before the layer's end, and gone at it.
    expect((await band(99)).lit).toBe(whole.lit);
    expect((await band(100)).lit, 'gone at the layer\'s own end').toBe(0);
  }, 240_000);

  it('draws a layer with the look it was given: a shadow falls the way it is pointed (milestone 28)', async () => {
    // The title card's title, plain and then with a look. What a shadow does is measured against
    // the plain render of the same frame rather than against an absolute darkness, and by **where**
    // it falls rather than how many pixels it covers: a count is a number about this machine's font
    // and this machine's blur, and the first version of this test was tuned on one of them
    // (docs/platform-notes.md). The geometry is the same everywhere.
    const [width, height] = [384, 216];
    const frame = async (name: string): Promise<Buffer> => {
      const { stdout } = await runBoundedBuffer(ffmpeg, ffmpegArgs(['-v', 'error', '-i', join(out, `${name}_00075.png`), '-vf', 'format=rgba', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), { timeoutMs: TOOL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
      return stdout;
    };
    const lit = (b: Buffer, x: number, y: number) => {
      const i = (y * width + x) * 4;
      return b[i]! > 60 || b[i + 1]! > 60 || b[i + 2]! > 60;
    };
    /** The title's own rows: the first unbroken run of lit rows from the top, so the rule under it
     *  and the subtitle below are left out without naming a row number. */
    const titleRows = (b: Buffer) => {
      let top = -1, bottom = -1;
      for (let y = 0; y < height; y++) {
        const any = [...Array(width).keys()].some((x) => lit(b, x, y));
        if (any) { if (top < 0) top = y; bottom = y; } else if (top >= 0) break;
      }
      return { top, bottom };
    };
    const brightest = (b: Buffer, rows: { top: number; bottom: number }) => {
      let most = 0;
      for (let y = rows.top; y <= rows.bottom; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (lit(b, x, y)) most = Math.max(most, b[i]!);
        }
      }
      return most;
    };
    /** Where the title's ink sits, as one row: what a shadow's own middle is measured against. */
    const inkCentre = (b: Buffer, rows: { top: number; bottom: number }) => {
      let total = 0, weighted = 0;
      for (let y = rows.top; y <= rows.bottom; y++) {
        for (let x = 0; x < width; x++) if (lit(b, x, y)) { total++; weighted += y; }
      }
      return weighted / total;
    };
    /**
     * Where the look darkened the frame, against the plain render of the same thing. A shadow is
     * black over a ground of (15, 23, 42), so it takes about 69 off the three channels together;
     * drawing the glyph once for the shadow pass and once for itself thickens its antialiased
     * edges, which goes the other way. Twelve is well above that and well below a shadow.
     */
    const darkening = (plain: Buffer, look: Buffer) => {
      let total = 0, weighted = 0, first = height, last = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const d = (plain[i]! - look[i]!) + (plain[i + 1]! - look[i + 1]!) + (plain[i + 2]! - look[i + 2]!);
          if (d <= 12) continue;
          total++;
          weighted += y;
          first = Math.min(first, y);
          last = Math.max(last, y);
        }
      }
      return { total, first, last, centre: total === 0 ? -1 : weighted / total };
    };

    const one = ['--fps', '25', '--size', `${width}x${height}`, '--in-point', '75', '--out-point', '75'];
    const styled = (look: unknown) => ['--param', `@layers=${JSON.stringify({ card: [{ id: 'title', look }] })}`];
    const shadow = (angle: number) => styled({ shadowColor: '#000000ff', shadowDistance: 0.03, shadowAngle: angle, shadowSoftness: 0.01 });

    const plainRun = await render('pulp.samples.title-card', 'png-sequence', 'look-plain', { extra: one });
    expect(plainRun.code, plainRun.stderr).toBe(0);
    const plain = await frame('look-plain');
    const rows = titleRows(plain);
    expect(rows.bottom, 'the title is drawn').toBeGreaterThan(rows.top);
    const ground = brightest(plain, rows);

    // The same shadow pointed down and pointed up. Which way it lands is the thing being tested,
    // and the pair is symmetric, so whatever this machine's font and blur do falls out of it.
    const downRun = await render('pulp.samples.title-card', 'png-sequence', 'look-down', { extra: [...one, ...shadow(90)] });
    expect(downRun.code, downRun.stderr).toBe(0);
    const upRun = await render('pulp.samples.title-card', 'png-sequence', 'look-up', { extra: [...one, ...shadow(-90)] });
    expect(upRun.code, upRun.stderr).toBe(0);
    const downFrame = await frame('look-down');
    const down = darkening(plain, downFrame);
    const up = darkening(plain, await frame('look-up'));

    // Both darken the frame, which only a shadow can do: the title's own ink is drawn the same.
    expect(down.total, 'a shadow pointed down darkens the frame').toBeGreaterThan(50);
    expect(up.total, 'and so does one pointed up').toBeGreaterThan(50);

    // Where each one lands. A blur spreads a shadow evenly about itself, so it cannot move the
    // middle of one: only the offset does, which is the thing being tested. Every comparison here
    // is either of that middle, or of a reach that a wider blur would only make truer.
    const middle = inkCentre(plain, rows);
    expect(down.centre, 'a shadow pointed down has its middle below the title').toBeGreaterThan(middle);
    expect(up.centre, 'and one pointed up has its middle above').toBeLessThan(middle);
    expect(down.centre - up.centre, 'the two land twice the offset apart').toBeGreaterThan(6);
    // And each reaches past the title the way it is pointed.
    expect(down.last, 'a shadow falling down reaches below the title\'s ink').toBeGreaterThan(rows.bottom);
    expect(up.first, 'and one falling up reaches above it').toBeLessThan(rows.top);

    // The title's own fill is untouched by the shadow behind it.
    expect(Math.abs(brightest(downFrame, rows) - ground), 'the title itself is as bright as it was').toBeLessThan(4);

    // Half opacity: the same ink, half as bright against the ground.
    const thin = await render('pulp.samples.title-card', 'png-sequence', 'look-thin', { extra: [...one, ...styled({ opacity: 0.5 })] });
    expect(thin.code, thin.stderr).toBe(0);
    const half = brightest(await frame('look-thin'), rows);
    expect(half, 'half way between the fill and the ground').toBeLessThan(ground * 0.65);
    expect(half).toBeGreaterThan(ground * 0.35);

    // A look that says nothing is no look at all, so the layer takes the very same path: not a
    // frame that looks the same, the same frame, to the byte.
    const none = await render('pulp.samples.title-card', 'png-sequence', 'look-none', { extra: [...one, ...styled({ opacity: 1, blend: 'normal' })] });
    expect(none.code, none.stderr).toBe(0);
    expect(Buffer.compare(await frame('look-none'), plain), 'a look that says nothing draws what no look draws').toBe(0);
  }, 240_000);

  it('shapes Arabic, Hebrew and the Indic scripts in text layers, in the right order, through the bundled fonts (milestone 70)', async () => {
    // The title card's title, which carries letter spacing — the path that used to draw a character
    // at a time and so undo the shaping. Everything is measured against a sibling render on this
    // same machine, never against an absolute width, so the font rasterizer cannot tune the test.
    const [width, height] = [384, 216];
    const one = ['--fps', '25', '--size', `${width}x${height}`, '--in-point', '75', '--out-point', '75'];
    const titled = (text: string) => ['--param', `@layers=${JSON.stringify({ card: [{ id: 'title', text }, { id: 'subtitle', hidden: true }] })}`];
    /**
     * The title's ink: the lit extent of the whole frame, across and down. Lit means the red
     * channel, since the title is near white (#f8fafc) and the card's rule under it is sky blue
     * (#38bdf8, red 56): a stacked Indic form reaches down into the rule, which must not lend the
     * title its width. The subtitle is hidden, so nothing else on the card is white.
     */
    const ink = async (name: string, text: string) => {
      const r = await render('pulp.samples.title-card', 'png-sequence', name, { extra: [...one, ...titled(text)] });
      expect(r.code, r.stderr).toBe(0);
      const { stdout } = await runBoundedBuffer(ffmpeg, ffmpegArgs(['-v', 'error', '-i', join(out, `${name}_00075.png`), '-vf', 'format=rgba', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), { timeoutMs: TOOL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
      let first = width, last = -1, top = height, bottom = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (stdout[(y * width + x) * 4]! <= 100) continue;
          first = Math.min(first, x); last = Math.max(last, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      expect(bottom, `${name}: the line is drawn at all`).toBeGreaterThan(top);
      return { width: last - first + 1, rows: bottom - top + 1 };
    };

    // Arabic joins: five kaf in a row take their initial, medial and final forms, which are much
    // narrower than the five isolated forms the same letters wear when a ZWNJ keeps them apart.
    // A renderer that drew characters one at a time (or had no Arabic font) would draw the two
    // the same width.
    const joined = await ink('script-arabic-joined', 'ككككك');
    const isolated = await ink('script-arabic-isolated', ['ك','ك','ك','ك','ك'].join('\u200c'));
    expect(joined.width, 'joined Arabic is narrower than the same letters kept isolated').toBeLessThan(isolated.width * 0.9);

    // The Indic scripts stack. Ka + virama + ka (in Gurmukhi ka + virama + ha, in Tamil ka +
    // virama + ssa) form one conjunct: a side ligature narrower than the two plain letters where
    // the script joins across, or a below-base form taller than them where it joins down. Two
    // separate letters are neither. Devanagari comes from the bundled Noto Sans; each of the
    // other seven from its own Noto, found through the fallback stack.
    // The margin is small on purpose: at this size Gujarati's ligature is 18 pixels against 20 on
    // Windows, and an unshaped pair, its virama showing, would be at least as wide as the plain one.
    const conjuncts: [string, string, string, 'narrower' | 'taller'][] = [
      ['deva', 'क्क', 'कक', 'narrower'],
      ['bengali', 'ক্ক', 'কক', 'narrower'],
      ['gurmukhi', 'ਕ੍ਹ', 'ਕਹ', 'taller'],
      ['gujarati', 'ક્ક', 'કક', 'narrower'],
      ['tamil', 'க்ஷ', 'கஷ', 'narrower'],
      ['telugu', 'క్క', 'కక', 'taller'],
      ['kannada', 'ಕ್ಕ', 'ಕಕ', 'taller'],
      ['malayalam', 'ക്ക', 'കക', 'narrower'],
    ];
    for (const [script, stacked, apart, how] of conjuncts) {
      const conjunct = await ink(`script-${script}-conjunct`, stacked);
      const plain = await ink(`script-${script}-plain`, apart);
      if (how === 'narrower') expect(conjunct.width, `${script}: the conjunct is one joined form, narrower than two letters`).toBeLessThan(plain.width * 0.95);
      else expect(conjunct.rows, `${script}: the conjunct hangs below its base, taller than two letters`).toBeGreaterThan(plain.rows * 1.2);
    }

    // Hebrew points are marks on the letters, not characters in the row: the pointed word takes
    // no more room across than the bare one. Drawn a character at a time, each mark would have
    // taken a column of its own (plus the title's letter spacing) and pushed the word wide.
    const bare = await ink('script-hebrew-bare', 'שלום');
    const pointed = await ink('script-hebrew-pointed', 'שָׁלוֹם');
    expect(Math.abs(pointed.width - bare.width), 'the points ride the letters').toBeLessThanOrEqual(8);
  }, 360_000);

  it('draws a layer turned, about the words rather than the block (milestone 29)', async () => {
    // The hairline lower third is alpha, and its "who" line is aligned at the left of a block
    // that spans most of the frame — the case where turning about the slot would swing the line
    // away instead of spinning it where it sits.
    const turn = (angle: number) => ['--param', `@layers=${JSON.stringify({ name: [{ id: 'who', placement: { '16:9': { rotate: angle } } }] })}`];
    const ink = async (file: string) => {
      // The drawn extent of the frame, from its alpha: where the graphic is, and how big.
      const { stdout } = await runBoundedBuffer(ffmpeg, ffmpegArgs(['-v', 'error', '-i', file, '-vf', 'format=rgba', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), { timeoutMs: TOOL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      for (let y = 0; y < 1080; y++) {
        for (let x = 0; x < 1920; x++) {
          if (stdout[(y * 1920 + x) * 4 + 3]! <= 16) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      return { x0, y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
    };

    const flat = await render('pulp.samples.hairline-lower-third', 'png-sequence', 'turn-0', { extra: ['--in-point', '90', '--out-point', '90', ...turn(0)] });
    expect(flat.code, flat.stderr).toBe(0);
    const upright = await ink(join(out, 'turn-0_00090.png'));
    // Flat, the graphic is a wide, short band: a rule with two lines under it.
    expect(upright.height).toBeLessThan(200);

    const quarter = await render('pulp.samples.hairline-lower-third', 'png-sequence', 'turn-90', { extra: ['--in-point', '90', '--out-point', '90', ...turn(90)] });
    expect(quarter.code, quarter.stderr).toBe(0);
    const turned = await ink(join(out, 'turn-90_00090.png'));
    // Turned a quarter, the line stands on end, so the graphic is far taller than it was.
    expect(turned.height, 'the turned line makes the graphic taller').toBeGreaterThan(upright.height * 2);
    // And it spun where it sat: the line stays over the left of the frame rather than swinging
    // to the middle of its block, so the drawn area starts about where it did.
    expect(Math.abs(turned.x0 - upright.x0), 'the graphic still starts at the same edge').toBeLessThan(60);
    expect(turned.width, 'and it did not swing across the frame').toBeLessThan(upright.width + 60);

    // A whole turn says nothing at all, so it draws exactly what no placement draws.
    const full = await render('pulp.samples.hairline-lower-third', 'png-sequence', 'turn-360', { extra: ['--in-point', '90', '--out-point', '90', ...turn(360)] });
    expect(full.code, full.stderr).toBe(0);
    expect(await ink(join(out, 'turn-360_00090.png'))).toEqual(upright);
  }, 240_000);

  it('a video layer keeps its sound: mixed into the render in step with its delay and loop, scaled by volume, gone when muted (milestone 48)', async () => {
    // One second of red picture with a full-scale 440 Hz tone, so the sound's presence, level and
    // timing can all be read back off the written file.
    const lib = join(out, 'sound-library');
    await mkdir(lib, { recursive: true });
    const noisy = join(lib, 'noisy.mp4');
    const built = await runBounded(ffmpeg, ffmpegArgs([
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=160x160:d=1:r=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', noisy,
    ]), { timeoutMs: TOOL_TIMEOUT_MS });
    expect(built.code, built.stderr).toBe(0);
    const noisyId = itemId(`media:${noisy}`);
    const layers = (value: unknown) => ['--param', `@layers=${JSON.stringify({ stack: [{ id: 'plate', clip: value }] })}`];
    const common = ['--library', FIXTURES, '--library', lib];

    /** The first audio stream of a file, or null where there is none. */
    const probeAudio = async (file: string): Promise<{ codec_name?: string; duration?: string } | null> => {
      const { stdout, stderr } = await runBounded(ffprobe, [
        '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,duration', '-of', 'json', file,
      ], { timeoutMs: TOOL_TIMEOUT_MS });
      expect(stdout, stderr).not.toBe('');
      return (JSON.parse(stdout) as { streams?: { codec_name?: string; duration?: string }[] }).streams?.[0] ?? null;
    };
    /** Loudest moment of a stretch of the file's sound, in dB (0 is full scale). */
    const maxVolume = async (file: string, from = 0, to?: number): Promise<number> => {
      const trim = `atrim=start=${from}${to !== undefined ? `:end=${to}` : ''},asetpts=PTS-STARTPTS,`;
      const r = await runBounded(ffmpeg, ffmpegArgs(['-i', file, '-af', `${trim}volumedetect`, '-f', 'null', '-']), { timeoutMs: TOOL_TIMEOUT_MS });
      const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
      expect(m, r.stderr.slice(-2000)).not.toBeNull();
      return Number(m![1]);
    };

    // The looping default: the one-second clip sounds through the whole two-second render.
    const mixed = await render('pulp.test.video-layer', 'h264-mp4', 'sound-loop', { extra: [...common, ...layers(noisyId)] });
    expect(mixed.code, mixed.stderr).toBe(0);
    const stream = await probeAudio(join(out, 'sound-loop.mp4'));
    expect(stream?.codec_name, 'AAC beside H.264').toBe('aac');
    expect(Number(stream?.duration), 'the sound runs the render\'s own length').toBeCloseTo(2, 0);
    // ffmpeg's sine source generates at an eighth of full scale, about -18 dB; presence is anything near it.
    const loud = await maxVolume(join(out, 'sound-loop.mp4'));
    expect(loud, 'the tone is there').toBeGreaterThan(-24);
    expect(await maxVolume(join(out, 'sound-loop.mp4'), 1.2, 1.8), 'and still there in the second pass of the loop').toBeGreaterThan(loud - 3);

    // Volume scales the layer: a quarter is about 12 dB down from full.
    const quiet = await render('pulp.test.video-layer', 'h264-mp4', 'sound-quiet', { extra: [...common, ...layers({ id: noisyId, volume: 0.25 })] });
    expect(quiet.code, quiet.stderr).toBe(0);
    const quietLevel = await maxVolume(join(out, 'sound-quiet.mp4'));
    expect(Math.abs(quietLevel - (loud - 12)), `quarter volume is about 12 dB down (${quietLevel} against ${loud})`).toBeLessThan(2);

    // A start delay holds the sound back exactly as it holds the picture.
    const delayed = await render('pulp.test.video-layer', 'h264-mp4', 'sound-delay', { extra: [...common, ...layers({ id: noisyId, delay: 1, ending: 'once' })] });
    expect(delayed.code, delayed.stderr).toBe(0);
    expect(await maxVolume(join(out, 'sound-delay.mp4'), 0, 0.9), 'silence before the delay').toBeLessThan(-50);
    expect(await maxVolume(join(out, 'sound-delay.mp4'), 1.1, 1.9), 'the tone after it').toBeGreaterThan(loud - 3);

    // Muted, the render carries no audio stream at all — exactly what a silent project writes.
    const muted = await render('pulp.test.video-layer', 'h264-mp4', 'sound-muted', { extra: [...common, ...layers({ id: noisyId, muted: true })] });
    expect(muted.code, muted.stderr).toBe(0);
    expect(await probeAudio(join(out, 'sound-muted.mp4'))).toBeNull();

    // An editing preset carries the mix as PCM, alpha picture and all.
    const pro = await render('pulp.test.video-layer', 'prores-4444', 'sound-pro', { extra: [...common, ...layers(noisyId)] });
    expect(pro.code, pro.stderr).toBe(0);
    expect((await probeAudio(join(out, 'sound-pro.mov')))?.codec_name).toBe('pcm_s16le');
  }, 240_000);

  it('an audio layer puts music or a voice-over in the project, with its window, delay, loop and fades, and the whole mix is rendered (milestone 48)', async () => {
    // A one-second tone and a four-second one at another pitch, so each can be told from the
    // other in the mix, and a two-second silent clip for the picture under them.
    const lib = join(out, 'audio-layer-library');
    await mkdir(lib, { recursive: true });
    const tone = async (file: string, frequency: number, seconds: number) => {
      const r = await runBounded(ffmpeg, ffmpegArgs([
        '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${seconds}`, '-c:a', 'pcm_s16le', join(lib, file),
      ]), { timeoutMs: TOOL_TIMEOUT_MS });
      expect(r.code, r.stderr).toBe(0);
      return itemId(`media:${join(lib, file)}`);
    };
    const shortId = await tone('blip.wav', 880, 1);
    const longId = await tone('bed.wav', 220, 4);
    const common = ['--library', FIXTURES, '--library', lib];
    /** One audio layer added to the fixture's open block. */
    const audio = (sound: unknown, over: Record<string, unknown> = {}) =>
      ['--param', `@layers=${JSON.stringify({ stack: [{ id: 'music', type: 'audio', sound, ...over }] })}`];

    /** Loudest moment of a stretch of the file's sound, in dB (0 is full scale). */
    const maxVolume = async (file: string, from = 0, to?: number): Promise<number> => {
      const trim = `atrim=start=${from}${to !== undefined ? `:end=${to}` : ''},asetpts=PTS-STARTPTS,`;
      const r = await runBounded(ffmpeg, ffmpegArgs(['-i', file, '-af', `${trim}volumedetect`, '-f', 'null', '-']), { timeoutMs: TOOL_TIMEOUT_MS });
      const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
      expect(m, r.stderr.slice(-2000)).not.toBeNull();
      return Number(m![1]);
    };
    const probeAudio = async (file: string) => {
      const { stdout, stderr } = await runBounded(ffprobe, [
        '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,duration', '-of', 'json', file,
      ], { timeoutMs: TOOL_TIMEOUT_MS });
      expect(stdout, stderr).not.toBe('');
      return (JSON.parse(stdout) as { streams?: { codec_name?: string; duration?: string }[] }).streams?.[0] ?? null;
    };

    // A bed under the whole two-second graphic: the layer is heard throughout and the file is AAC.
    const bed = await render('pulp.test.video-layer', 'h264-mp4', 'audio-bed', { extra: [...common, ...audio(longId)] });
    expect(bed.code, bed.stderr).toBe(0);
    const stream = await probeAudio(join(out, 'audio-bed.mp4'));
    expect(stream?.codec_name).toBe('aac');
    expect(Number(stream?.duration), 'the mix is the graphic\'s own length').toBeCloseTo(2, 0);
    const level = await maxVolume(join(out, 'audio-bed.mp4'));
    expect(level, 'the bed is there').toBeGreaterThan(-24);

    // In and out points take a stretch of the file; a start delay holds it back.
    const windowed = await render('pulp.test.video-layer', 'h264-mp4', 'audio-window', {
      extra: [...common, ...audio({ id: longId, inPoint: 1, outPoint: 2, ending: 'once', delay: 1 })],
    });
    expect(windowed.code, windowed.stderr).toBe(0);
    expect(await maxVolume(join(out, 'audio-window.mp4'), 0, 0.9), 'silence before the delay').toBeLessThan(-50);
    expect(await maxVolume(join(out, 'audio-window.mp4'), 1.1, 1.9), 'and the second it was given').toBeGreaterThan(-24);

    // Looping: a one-second sound fills a two-second graphic, so its second pass is there too.
    const looped = await render('pulp.test.video-layer', 'h264-mp4', 'audio-loop', {
      extra: [...common, ...audio({ id: shortId, ending: 'loop' })],
    });
    expect(looped.code, looped.stderr).toBe(0);
    expect(await maxVolume(join(out, 'audio-loop.mp4'), 1.2, 1.9), 'the loop comes round').toBeGreaterThan(-24);

    // Fades: a two-second fade in over a two-second graphic is quiet at the start and full at the end.
    const faded = await render('pulp.test.video-layer', 'h264-mp4', 'audio-fade', {
      extra: [...common, ...audio({ id: longId, fadeIn: 2 })],
    });
    expect(faded.code, faded.stderr).toBe(0);
    const early = await maxVolume(join(out, 'audio-fade.mp4'), 0, 0.3);
    const late = await maxVolume(join(out, 'audio-fade.mp4'), 1.6, 2);
    expect(late - early, 'the fade in really rises').toBeGreaterThan(8);

    // The layer's span holds its sound: dragging the bar under the scrub bar moves the music.
    const spanned = await render('pulp.test.video-layer', 'h264-mp4', 'audio-span', {
      extra: [...common, ...audio(longId, { span: { start: 1, end: null } })],
    });
    expect(spanned.code, spanned.stderr).toBe(0);
    expect(await maxVolume(join(out, 'audio-span.mp4'), 0, 0.9), 'silent before its span').toBeLessThan(-50);
    expect(await maxVolume(join(out, 'audio-span.mp4'), 1.2, 1.9), 'and heard inside it').toBeGreaterThan(-24);

    // Muted, and hidden: the render carries no audio stream at all, as a silent project does.
    for (const [name, value] of [['audio-muted', { id: longId, muted: true }], ['audio-hidden', { id: longId, hidden: true }]] as const) {
      const silent = await render('pulp.test.video-layer', 'h264-mp4', name, { extra: [...common, ...audio(value)] });
      expect(silent.code, silent.stderr).toBe(0);
      expect(await probeAudio(join(out, `${name}.mp4`)), name).toBeNull();
    }

    // An output with no room for sound gets the mix beside it as a WAV, of the same length.
    const seq = await render('pulp.test.video-layer', 'png-sequence', 'audio-seq', { extra: [...common, ...audio(longId)] });
    expect(seq.code, seq.stderr).toBe(0);
    const wav = join(out, 'audio-seq-audio.wav');
    expect(existsSync(wav), 'the mix beside the sequence').toBe(true);
    expect(Number((await probeAudio(wav))?.duration)).toBeCloseTo(2, 0);
    expect(await maxVolume(wav)).toBeGreaterThan(-24);
    // And a silent project writes none.
    const quiet = await render('pulp.test.video-layer', 'png-sequence', 'audio-seq-quiet', { extra: common });
    expect(quiet.code, quiet.stderr).toBe(0);
    expect(existsSync(join(out, 'audio-seq-quiet-audio.wav'))).toBe(false);

    // Two layers together: a clip's own sound and an audio layer, one mix.
    const both = await render('pulp.test.video-layer', 'h264-mp4', 'audio-both', {
      extra: [
        ...common,
        '--param',
        `@layers=${JSON.stringify({ stack: [{ id: 'plate', clip: null }, { id: 'music', type: 'audio', sound: { id: longId, volume: 0.5 } }] })}`,
      ],
    });
    expect(both.code, both.stderr).toBe(0);
    expect((await probeAudio(join(out, 'audio-both.mp4')))?.codec_name).toBe('aac');
    expect(await maxVolume(join(out, 'audio-both.mp4'))).toBeGreaterThan(-30);

    // A sound the library cannot answer for stops the render by name rather than going quiet.
    const missing = await render('pulp.test.video-layer', 'h264-mp4', 'audio-missing', { extra: [...common, ...audio('not-a-real-id')] });
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('the sound chosen for "music"');
  }, 300_000);

  it('music as stems: mute and solo decide what the mix holds, and --stems files writes one WAV per stem beside the render (milestone 16)', async () => {
    // Two tones at different pitches stand in for two stems of one piece.
    const lib = join(out, 'stems-library');
    await mkdir(lib, { recursive: true });
    const tone = async (file: string, frequency: number) => {
      const r = await runBounded(ffmpeg, ffmpegArgs([
        '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=2`, '-c:a', 'pcm_s16le', join(lib, file),
      ]), { timeoutMs: TOOL_TIMEOUT_MS });
      expect(r.code, r.stderr).toBe(0);
      return itemId(`media:${join(lib, file)}`);
    };
    const drumsId = await tone('drums.wav', 220);
    const keysId = await tone('keys.wav', 1760);
    const common = ['--library', FIXTURES, '--library', lib];
    const stems = (over: { muted?: boolean; solo?: boolean }[] = [{}, {}]) => ['--param', `@layers=${JSON.stringify({
      stack: [{ id: 'music', type: 'audio', sound: { id: drumsId, stems: [
        { id: drumsId, label: 'Drums', ...over[0] },
        { id: keysId, label: 'Keys', ...over[1] },
      ] } }],
    })}`];
    const probeAudio = async (file: string) => {
      const { stdout, stderr } = await runBounded(ffprobe, [
        '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'json', file,
      ], { timeoutMs: TOOL_TIMEOUT_MS });
      expect(stdout, stderr).not.toBe('');
      return (JSON.parse(stdout) as { streams?: { codec_name?: string }[] }).streams?.[0] ?? null;
    };
    /** Loudest moment of one pitch's narrow band, in dB: tells one stem from the other in a mix. */
    const bandLevel = async (file: string, frequency: number): Promise<number> => {
      const r = await runBounded(ffmpeg, ffmpegArgs([
        '-i', file, '-af', `bandpass=f=${frequency}:width_type=q:w=5,volumedetect`, '-f', 'null', '-',
      ]), { timeoutMs: TOOL_TIMEOUT_MS });
      const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
      expect(m, r.stderr.slice(-2000)).not.toBeNull();
      return Number(m![1]);
    };

    // Both stems in the mix by default; soloing one takes the other out.
    const mixed = await render('pulp.test.video-layer', 'h264-mp4', 'stems-mix', { extra: [...common, ...stems()] });
    expect(mixed.code, mixed.stderr).toBe(0);
    expect(await bandLevel(join(out, 'stems-mix.mp4'), 220), 'the drums are in the mix').toBeGreaterThan(-30);
    expect(await bandLevel(join(out, 'stems-mix.mp4'), 1760), 'and the keys').toBeGreaterThan(-30);
    const soloed = await render('pulp.test.video-layer', 'h264-mp4', 'stems-solo', { extra: [...common, ...stems([{}, { solo: true }])] });
    expect(soloed.code, soloed.stderr).toBe(0);
    const drumsInSolo = await bandLevel(join(out, 'stems-solo.mp4'), 220);
    const keysInSolo = await bandLevel(join(out, 'stems-solo.mp4'), 1760);
    expect(keysInSolo, 'the soloed stem is there').toBeGreaterThan(-30);
    expect(keysInSolo - drumsInSolo, 'and the other is gone').toBeGreaterThan(20);

    // --stems files: the stems leave the render's own audio and land one WAV each beside it.
    const files = await render('pulp.test.video-layer', 'h264-mp4', 'stems-files', { extra: [...common, ...stems(), '--stems', 'files'] });
    expect(files.code, files.stderr).toBe(0);
    expect(await probeAudio(join(out, 'stems-files.mp4')), 'no stems in the render itself').toBeNull();
    for (const [name, frequency] of [['stems-files-drums.wav', 220], ['stems-files-keys.wav', 1760]] as const) {
      const wav = join(out, name);
      expect(existsSync(wav), name).toBe(true);
      expect((await probeAudio(wav))?.codec_name).toBe('pcm_s16le');
      expect(await bandLevel(wav, frequency), `${name} holds its own pitch`).toBeGreaterThan(-30);
    }
    // A muted stem writes no file: what is beside the render is what would have been heard.
    const partial = await render('pulp.test.video-layer', 'h264-mp4', 'stems-part', { extra: [...common, ...stems([{}, { muted: true }]), '--stems', 'files'] });
    expect(partial.code, partial.stderr).toBe(0);
    expect(existsSync(join(out, 'stems-part-drums.wav'))).toBe(true);
    expect(existsSync(join(out, 'stems-part-keys.wav'))).toBe(false);
  }, 300_000);

  it('levels the mix to the platform preset\'s loudness target, and leaves a render aimed nowhere as mixed (milestone 52)', async () => {
    // A tone under the whole graphic, well off the -14 LUFS target, so leveling is legible.
    const lib = join(out, 'loudness-library');
    await mkdir(lib, { recursive: true });
    const bed = join(lib, 'quiet-bed.wav');
    const made = await runBounded(ffmpeg, ffmpegArgs([
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-af', 'volume=0.5', '-c:a', 'pcm_s16le', bed,
    ]), { timeoutMs: TOOL_TIMEOUT_MS });
    expect(made.code, made.stderr).toBe(0);
    const bedId = itemId(`media:${bed}`);
    const common = ['--library', FIXTURES, '--library', lib];
    const audio = ['--param', `@layers=${JSON.stringify({ stack: [{ id: 'music', type: 'audio', sound: { id: bedId, ending: 'loop' } }] })}`];

    /** Integrated loudness of a file, LUFS, read with ffmpeg's own EBU R128 meter. */
    const integrated = async (file: string): Promise<number> => {
      const r = await runBounded(ffmpeg, ffmpegArgs(['-i', file, '-af', 'ebur128', '-f', 'null', '-']), { timeoutMs: TOOL_TIMEOUT_MS });
      const m = /I:\s*(-?[\d.]+) LUFS/.exec(r.stderr.slice(r.stderr.lastIndexOf('Summary:')));
      expect(m, r.stderr.slice(-1500)).not.toBeNull();
      return Number(m![1]);
    };

    // Aimed nowhere, the mix is written as mixed: nowhere near the target.
    const plain = await render('pulp.test.video-layer', 'h264-mp4', 'level-plain', { extra: [...common, ...audio] });
    expect(plain.code, plain.stderr).toBe(0);
    const unlevelled = await integrated(join(out, 'level-plain.mp4'));
    expect(Math.abs(unlevelled - -14), `as mixed it measures ${unlevelled} LUFS`).toBeGreaterThan(3);

    // Aimed at a platform, it is measured and leveled to the platform's target — on the file itself.
    const aimed = await runBounded(
      electron,
      ['.', '--render', 'pulp.test.video-layer', '--platform', 'x', '--out', join(out, 'level-aimed'), ...common, ...audio],
      { cwd: ROOT, timeoutMs: 180_000 },
    );
    expect(aimed.code, aimed.stderr).toBe(0);
    const levelled = await integrated(join(out, 'level-aimed.mp4'));
    expect(Math.abs(levelled - -14), `leveled it measures ${levelled} LUFS`).toBeLessThan(1.5);
  }, 300_000);

  it('treats a voice on a layer with sound: Reduce noise lowers the bundled noisy sample\'s noise floor (milestone 53)', async () => {
    // The bundled noisy sample, written by its own recipe into a test library: voice-like phrases
    // over a steady hiss, with the last stretch hiss alone — where a noise floor can be read.
    const lib = join(out, 'voice-library');
    await mkdir(lib, { recursive: true });
    const noisy = SAMPLE_MEDIA.find((i) => i.file === 'noisy-voice-memo.wav');
    expect(noisy, 'the bundled noisy sample').toBeTruthy();
    const file = join(lib, 'noisy-voice-memo.wav');
    const made = await runBounded(ffmpeg, ffmpegArgs(sampleAudioArgs(noisy!.recipe as Parameters<typeof sampleAudioArgs>[0], file)), { timeoutMs: TOOL_TIMEOUT_MS });
    expect(made.code, made.stderr).toBe(0);
    const noisyId = itemId(`media:${file}`);
    const common = ['--library', FIXTURES, '--library', lib];
    // In from 4.5 s: the graphic's two seconds hold hiss alone, so the floor is legible in the file.
    const voiced = (voice?: unknown) =>
      ['--param', `@layers=${JSON.stringify({ stack: [{ id: 'memo', type: 'audio', sound: { id: noisyId, inPoint: 4.5, ...(voice ? { voice } : {}) } }] })}`];
    const maxVolume = async (name: string): Promise<number> => {
      const r = await runBounded(ffmpeg, ffmpegArgs(['-i', join(out, name), '-af', 'atrim=start=0.3:end=1.3,asetpts=PTS-STARTPTS,volumedetect', '-f', 'null', '-']), { timeoutMs: TOOL_TIMEOUT_MS });
      const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
      expect(m, r.stderr.slice(-2000)).not.toBeNull();
      return Number(m![1]);
    };

    const plain = await render('pulp.test.video-layer', 'h264-mp4', 'voice-plain', { extra: [...common, ...voiced()] });
    expect(plain.code, plain.stderr).toBe(0);
    const floor = await maxVolume('voice-plain.mp4');
    expect(floor, 'the hiss is there to remove').toBeGreaterThan(-45);

    // Reduce noise at full amount drops the floor by a margin no drift can fake.
    const treated = await render('pulp.test.video-layer', 'h264-mp4', 'voice-treated', { extra: [...common, ...voiced({ treatment: 'reduce-noise', amount: 1 })] });
    expect(treated.code, treated.stderr).toBe(0);
    const lowered = await maxVolume('voice-treated.mp4');
    expect(lowered, `the floor fell from ${floor} to ${lowered} dB`).toBeLessThan(floor - 8);

    // An amount of nothing is the sound as recorded.
    const none = await render('pulp.test.video-layer', 'h264-mp4', 'voice-none', { extra: [...common, ...voiced({ treatment: 'reduce-noise', amount: 0 })] });
    expect(none.code, none.stderr).toBe(0);
    expect(Math.abs((await maxVolume('voice-none.mp4')) - floor), 'amount 0 leaves the floor alone').toBeLessThan(1);
  }, 300_000);

  it('grades the whole render through a .cube LUT, named on the command line (milestone 52)', async () => {
    // A two-point inverting LUT: red in, cyan out — a grade that cannot be mistaken for drift.
    const lib = join(out, 'lut-library');
    await mkdir(lib, { recursive: true });
    const cube = join(lib, 'invert.cube');
    await writeFile(cube, ['LUT_3D_SIZE 2', '1 1 1', '0 1 1', '1 0 1', '0 0 1', '1 1 0', '0 1 0', '1 0 0', '0 0 0', ''].join('\n'));
    const solid = join(lib, 'lut-solid.mov');
    const madeSolid = await runBounded(ffmpeg, ffmpegArgs(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x160:d=1:r=30,format=rgba', '-c:v', 'qtrle', solid]), { timeoutMs: TOOL_TIMEOUT_MS });
    expect(madeSolid.code, madeSolid.stderr).toBe(0);
    const solidId = itemId(`media:${solid}`);
    const layers = ['--param', `@layers=${JSON.stringify({ stack: [{ id: 'plate', clip: solidId }] })}`];
    const common = ['--library', FIXTURES, '--library', lib];
    const middle = [160, 90] as const;

    const plain = await render('pulp.test.video-layer', 'png-sequence', 'lut-off', { extra: [...common, ...layers] });
    expect(plain.code, plain.stderr).toBe(0);
    const [r0, g0, b0] = await pixels(join(out, 'lut-off_00000.png'), ...middle);
    expect(r0, 'red as shot').toBeGreaterThan(200);
    expect(g0).toBeLessThan(60);

    const graded = await render('pulp.test.video-layer', 'png-sequence', 'lut-on', { extra: [...common, ...layers, '--lut', cube] });
    expect(graded.code, graded.stderr).toBe(0);
    const [r1, g1, b1] = await pixels(join(out, 'lut-on_00000.png'), ...middle);
    expect(r1, 'and cyan through the grade').toBeLessThan(60);
    expect(g1).toBeGreaterThan(200);
    expect(b1).toBeGreaterThan(200);
    void b0;

    // The wrong kind of file is refused by name before anything renders.
    const wrong = await render('pulp.test.video-layer', 'png-sequence', 'lut-bad', { extra: [...common, ...layers, '--lut', join(lib, 'invert.look')] });
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain('.cube');
  }, 240_000);

  it('moves a layer by its keys: position, scale, rotation and opacity over time, eased (milestone 51)', async () => {
    // The solid red square again, keyed across the frame; where it lands is read off the pixels,
    // so the preview's arithmetic and the render's bridge are held to the same answer.
    const lib = join(out, 'keys-library');
    await mkdir(lib, { recursive: true });
    const solid = join(lib, 'keys-solid.mov');
    const made = await runBounded(ffmpeg, ffmpegArgs(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x160:d=1:r=30,format=rgba', '-c:v', 'qtrle', solid]), { timeoutMs: TOOL_TIMEOUT_MS });
    expect(made.code, made.stderr).toBe(0);
    const solidId = itemId(`media:${solid}`);
    const common = ['--library', FIXTURES, '--library', lib];
    const keyed = (keys: unknown) => ['--param', `@layers=${JSON.stringify({ stack: [{ id: 'plate', clip: solidId, keys }] })}`];
    // The 320 x 180 fixture draws the plate 90 px square at its center, x 160.
    const left = [80, 90] as const;
    const right = [240, 90] as const;
    const middle = [160, 90] as const;

    // Linear travel: left at the first frame, right at the last, passing the middle half way.
    const moved = await render('pulp.test.video-layer', 'png-sequence', 'keys-move', {
      extra: [...common, ...keyed([{ at: 0, dx: -0.25, easing: 'linear' }, { at: 2, dx: 0.25 }])],
    });
    expect(moved.code, moved.stderr).toBe(0);
    expect((await pixels(join(out, 'keys-move_00000.png'), ...left))[3], 'left at the start').toBe(255);
    expect((await pixels(join(out, 'keys-move_00000.png'), ...right))[3]).toBe(0);
    expect((await pixels(join(out, 'keys-move_00030.png'), ...middle))[3], 'half way at one second').toBe(255);
    expect((await pixels(join(out, 'keys-move_00059.png'), ...right))[3], 'right at the end').toBe(255);
    expect((await pixels(join(out, 'keys-move_00059.png'), ...left))[3]).toBe(0);

    // A hold stays put until the next key.
    const held = await render('pulp.test.video-layer', 'png-sequence', 'keys-hold', {
      extra: [...common, ...keyed([{ at: 0, dx: -0.25, easing: 'hold' }, { at: 1.5, dx: 0.25 }])],
    });
    expect(held.code, held.stderr).toBe(0);
    expect((await pixels(join(out, 'keys-hold_00030.png'), ...left))[3], 'still left at one second').toBe(255);
    expect((await pixels(join(out, 'keys-hold_00059.png'), ...right))[3], 'and across after the key').toBe(255);

    // Scale, rotation and opacity key too: grown and faded by the end.
    const posed = await render('pulp.test.video-layer', 'png-sequence', 'keys-pose', {
      extra: [...common, ...keyed([{ at: 0, scale: 1, opacity: 1, easing: 'linear' }, { at: 2, scale: 2, rotate: 45, opacity: 0.4 }])],
    });
    expect(posed.code, posed.stderr).toBe(0);
    // At the start the corner beyond the 90 px plate is empty; grown to nearly double it is covered.
    const corner = [160, 25] as const;
    expect((await pixels(join(out, 'keys-pose_00000.png'), ...corner))[3]).toBe(0);
    const late = (await pixels(join(out, 'keys-pose_00059.png'), ...middle))[3]!;
    expect(late, 'faded by the end').toBeGreaterThan(60);
    expect(late).toBeLessThan(160);
    expect((await pixels(join(out, 'keys-pose_00059.png'), ...corner))[3], 'and grown past its old edge').toBeGreaterThan(0);

    // Together with the rest (milestone 51): the keys compose with the layer's own entrance,
    // exit and span — the span gates it, the fades multiply the keyed opacity, and the keyed
    // travel goes on underneath, read off the same pixels the preview's arithmetic answers for.
    const together = await render('pulp.test.video-layer', 'png-sequence', 'keys-together', {
      extra: [...common, '--param', `@layers=${JSON.stringify({
        stack: [{
          id: 'plate', clip: solidId,
          keys: [{ at: 0, dx: -0.25, easing: 'linear' }, { at: 2, dx: 0.25 }],
          transition: { in: { type: 'fade', seconds: 0.5 }, out: { type: 'fade', seconds: 0.5 } },
          span: { start: 0.5, end: 1.5 },
        }],
      })}`],
    });
    expect(together.code, together.stderr).toBe(0);
    // Before its span the layer is not there at all, however loud the keys.
    expect((await pixels(join(out, 'keys-together_00000.png'), ...middle))[3]).toBe(0);
    expect((await pixels(join(out, 'keys-together_00000.png'), ...left))[3]).toBe(0);
    // Inside the fade in, part way up, at the keys' position for that moment (which covers the middle).
    const arriving = (await pixels(join(out, 'keys-together_00022.png'), ...middle))[3]!;
    expect(arriving, 'part way through its own fade in').toBeGreaterThan(40);
    expect(arriving).toBeLessThan(220);
    // Between the fades it is whole, half way along its keyed travel.
    expect((await pixels(join(out, 'keys-together_00030.png'), ...middle))[3], 'whole between the fades').toBeGreaterThan(240);
    // Inside the fade out, part way down again.
    const leaving = (await pixels(join(out, 'keys-together_00040.png'), ...middle))[3]!;
    expect(leaving, 'part way through its own fade out').toBeGreaterThan(40);
    expect(leaving).toBeLessThan(220);
    // And past its span it is gone, wherever the keys would have put it.
    expect((await pixels(join(out, 'keys-together_00055.png'), ...middle))[3]).toBe(0);
    expect((await pixels(join(out, 'keys-together_00055.png'), ...right))[3]).toBe(0);
  }, 300_000);

  it('renders the cut track under the graphic as one file, each cut\'s sound in the mix (milestone 49)', async () => {
    // Two solid one-second clips, each with its own tone, so the picture and the sound both say
    // which cut is playing; the blue cut is trimmed to half a second, so the track ends before
    // the graphic and the pad shows.
    const lib = join(out, 'track-library');
    await mkdir(lib, { recursive: true });
    const clip = async (file: string, color: string, tone: number) => {
      const r = await runBounded(ffmpeg, ffmpegArgs([
        '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=160x160:d=1:r=30`, '-f', 'lavfi', '-i', `sine=frequency=${tone}:duration=1`,
        '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', join(lib, file),
      ]), { timeoutMs: TOOL_TIMEOUT_MS });
      expect(r.code, r.stderr).toBe(0);
      return itemId(`media:${join(lib, file)}`);
    };
    const redId = await clip('red.mp4', 'red', 440);
    const blueId = await clip('blue.mp4', 'blue', 880);
    const common = ['--library', FIXTURES, '--library', lib];
    const trackArg = ['--param', `@track=${JSON.stringify({ cuts: [{ id: redId, from: 0, to: 1 }, { id: blueId, from: 0, to: 0.5 }] })}`];
    const middle = [160, 90] as const;
    const side = [30, 90] as const;

    // The picture: red, then blue, then the pad once the track has ended — opaque under the
    // graphic's own transparency, with the square clip letterboxed into the frame.
    const seq = await render('pulp.test.video-layer', 'png-sequence', 'track-seq', { extra: [...common, ...trackArg] });
    expect(seq.code, seq.stderr).toBe(0);
    const at = async (frame: number, x: number, y: number) => pixels(join(out, `track-seq_${String(frame).padStart(5, '0')}.png`), x, y);
    const red = await at(15, ...middle);
    expect(red[0], 'the first cut').toBeGreaterThan(180);
    expect(red[2]).toBeLessThan(80);
    expect(red[3], 'the track is opaque under the graphic').toBe(255);
    const blue = await at(40, ...middle);
    expect(blue[2], 'the second cut after the first').toBeGreaterThan(180);
    expect(blue[0]).toBeLessThan(80);
    const padded = await at(55, ...middle);
    expect(padded[0]! + padded[1]! + padded[2]!, 'the pad once the track ends').toBeLessThan(60);
    expect(padded[3]).toBe(255);
    // The square clip is letterboxed: the frame's sides are the pad, not the picture.
    const bar = await at(15, ...side);
    expect(bar[0]! + bar[1]! + bar[2]!).toBeLessThan(60);
    // And the graphic still draws on top: the fixture's yellow marker at the corner.
    const marker = await at(15, 2, 2);
    expect(marker[0], 'the graphic over the footage').toBeGreaterThan(180);
    expect(marker[1]).toBeGreaterThan(180);

    // One file in a delivery preset too, with each cut's sound following it into the mix.
    const mp4 = await render('pulp.test.video-layer', 'h264-mp4', 'track-mix', { extra: [...common, ...trackArg] });
    expect(mp4.code, mp4.stderr).toBe(0);
    const level = async (from: number, to: number) => {
      const r = await runBounded(ffmpeg, ffmpegArgs(['-i', join(out, 'track-mix.mp4'), '-af', `atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS,volumedetect`, '-f', 'null', '-']), { timeoutMs: TOOL_TIMEOUT_MS });
      const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
      expect(m, r.stderr.slice(-1500)).not.toBeNull();
      return Number(m![1]);
    };
    expect(await level(0.2, 0.8), 'the first cut is heard').toBeGreaterThan(-24);
    expect(await level(1.1, 1.4), 'and the second where it plays').toBeGreaterThan(-24);
    expect(await level(1.6, 1.9), 'and silence once the track has ended').toBeLessThan(-50);
  }, 300_000);

  it('renders a 30-minute cut track within a memory budget, and a render killed half way leaves only a file that says it is partial (milestone 58)', async () => {
    // One ten-minute clip, cut three times end to end: thirty minutes of track under a graphic.
    // The rendered range is the last ten seconds, so the capture is a hundred frames — but the
    // track is trimmed after it is joined, so ffmpeg still decodes and concatenates the whole
    // thirty minutes to reach them, which is the cost the budget is about.
    const lib = join(out, 'long-library');
    await mkdir(lib, { recursive: true });
    const made = await runBounded(ffmpeg, ffmpegArgs([
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=600', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=600',
      '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', join(lib, 'ten-minutes.mp4'),
    ]), { timeoutMs: 300_000 });
    expect(made.code, made.stderr).toBe(0);
    const longId = itemId(`media:${join(lib, 'ten-minutes.mp4')}`);
    const track = { cuts: [{ id: longId, from: 0, to: 600 }, { id: longId, from: 0, to: 600 }, { id: longId, from: 0, to: 600 }] };
    const common = ['--library', FIXTURES, '--library', lib, '--param', `@track=${JSON.stringify(track)}`, '--length', '1800', '--in-point', '53700', '--out-point', '53999'];
    const long = await render('pulp.test.structure', 'h264-mp4', 'long-track', { extra: common, timeoutMs: 600_000 });
    expect(long.code, long.stderr).toBe(0);
    const info = await probe(join(out, 'long-track.mp4'));
    expect(Number(info.nb_read_frames)).toBe(300);
    // The main process's high-water mark, printed by the render: the budget a long track must fit.
    const peak = /peak memory \(main process\): (\d+) MB/.exec(long.stdout);
    expect(peak, long.stdout.slice(-400)).not.toBeNull();
    console.info(`30-minute track render: ${long.stdout.split('\n').filter((l) => l.startsWith('wrote') || l.startsWith('peak')).join('; ')}`);
    expect(Number(peak![1]), 'peak main-process memory for a 30-minute track').toBeLessThan(1536);

    // Killed mid-render: ffmpeg was writing to a staged name, so the finished name never exists
    // half-written — and running the same render again clears the stage and finishes.
    const { spawn } = await import('node:child_process');
    const target = join(out, 'killed.mp4');
    const child = spawn(electron!, ['.', '--render', 'pulp.samples.lower-third-bar', '--preset', 'h264-mp4', '--out', target, '--library', FIXTURES, '--length', '20'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error(`the render never reached frame 90: ${text.slice(-300)}`)), 120_000);
      child.stdout.on('data', (chunk: Buffer) => {
        text += chunk.toString();
        if (/frame (9|1\d)\d\//.test(text)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', () => {
        clearTimeout(timer);
        reject(new Error(`the render ended before it could be killed: ${text.slice(-300)}`));
      });
    });
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));
    expect(existsSync(target), 'nothing wears the finished name').toBe(false);
    expect(existsSync(join(out, 'killed.partial.mp4')), 'the staged file says what it is').toBe(true);
    const again = await render('pulp.samples.lower-third-bar', 'h264-mp4', 'killed', { extra: ['--library', FIXTURES, '--length', '20'], timeoutMs: 180_000 });
    expect(again.code, again.stderr).toBe(0);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(out, 'killed.partial.mp4')), 'the stage cleared by the render that finished').toBe(false);
  }, 900_000);

  it('renders a frame the screen\'s own size, and one larger than it, on a small Linux screen (milestone 58)', async () => {
    // On X11 a window the desktop's size is shrunk by a pixel, so a 1080p render on a 1080p desktop
    // was captured at 1919 × 1079 and refused. The render now fits the screen with a smaller
    // window at a higher scale (src/core/capture-fit.ts). Each case runs the app under a virtual
    // screen of its own, the way a person's desktop would be; without xvfb-run — macOS, Windows,
    // and a Linux without it — there is no small screen to try, and the test says so.
    const { spawnSync } = await import('node:child_process');
    if (process.platform !== 'linux' || spawnSync('which', ['xvfb-run']).status !== 0) {
      console.info('small Linux screen: skipped, no xvfb-run here');
      return;
    }
    const under = async (screen: string, file: string, extra: string[]) => {
      const r = await runBounded('xvfb-run', ['-a', '--server-args', `-screen 0 ${screen}x24`, electron!, '.', '--render', 'pulp.samples.lower-third-bar', '--preset', 'png-sequence', '--out', join(out, file), '--in-point', '30', '--out-point', '30', '--param', 'panel=#ffffffd9', ...extra], { cwd: ROOT, timeoutMs: 240_000 });
      // Both streams: the render's own refusal is on stderr, what it managed on stdout, and D-Bus
      // noise on a runner without a system bus can crowd either.
      expect(r.code, `${r.stdout.slice(-400)}\n${r.stderr.split('\n').filter((l) => !l.includes('dbus/bus.cc')).join('\n').slice(-800)}`).toBe(0);
      return join(out, `${file}_00030.png`);
    };
    // The frame's pixels, so a fitted render can be held to a plain one: the same picture, exactly.
    const bytes = async (file: string) => (await runBoundedBuffer(ffmpeg, ffmpegArgs(['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), { timeoutMs: TOOL_TIMEOUT_MS })).stdout;

    // 1080p on a 1080p desktop: the case the issue was filed for.
    const small = await under('1920x1080', 'screen-small', []);
    expect(await probe(small)).toMatchObject({ width: 1920, height: 1080 });
    // Against the same frame on a screen with room to spare: pixel for pixel the same.
    const roomy = await under('2000x1200', 'screen-roomy', []);
    expect((await bytes(small)).equals(await bytes(roomy)), 'a fitted capture is the plain capture, byte for byte').toBe(true);

    // 4K on the same desktop: a window halved is still the screen's size, so it is a third.
    const big = await under('1920x1080', 'screen-4k', ['--size', '3840x2160']);
    expect(await probe(big)).toMatchObject({ width: 3840, height: 2160 });
    const bigRoomy = await under('4000x2400', 'screen-4k-roomy', ['--size', '3840x2160']);
    expect((await bytes(big)).equals(await bytes(bigRoomy)), '4K fitted at a third is the plain 4K').toBe(true);
  }, 900_000);

  it('plays a cut at a speed with its pitch kept, holds a frozen frame, and renders a smooth ramp (milestone 56)', async () => {
    // The same two toned clips as the track test: red at 440 Hz, blue at 880 Hz. Red plays at 2×
    // — half a second of timeline — blue at ½× for a second, then red's first frame is held for
    // half a second. If the speed changed the pitch, red's tone would sit at 880 and blue's at 440;
    // with the pitch kept each stays where it was recorded, which the band levels say.
    const lib = join(out, 'speed-library');
    await mkdir(lib, { recursive: true });
    const clip = async (file: string, color: string, tone: number) => {
      const r = await runBounded(ffmpeg, ffmpegArgs([
        '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=160x160:d=1:r=30`, '-f', 'lavfi', '-i', `sine=frequency=${tone}:duration=1`,
        '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', join(lib, file),
      ]), { timeoutMs: TOOL_TIMEOUT_MS });
      expect(r.code, r.stderr).toBe(0);
      return itemId(`media:${join(lib, file)}`);
    };
    const redId = await clip('red.mp4', 'red', 440);
    const blueId = await clip('blue.mp4', 'blue', 880);
    const common = ['--library', FIXTURES, '--library', lib];
    const track = { cuts: [
      { id: redId, from: 0, to: 1, speed: { rate: 2 } },
      { id: blueId, from: 0, to: 0.5, speed: { rate: 0.5 } },
      { id: redId, from: 0, to: 0.05, hold: 0.5 },
    ] };
    const trackArg = ['--param', `@track=${JSON.stringify(track)}`];
    const middle = [160, 90] as const;

    const seq = await render('pulp.test.video-layer', 'png-sequence', 'speed-seq', { extra: [...common, ...trackArg] });
    expect(seq.code, seq.stderr).toBe(0);
    const at = async (frame: number, x: number, y: number) => pixels(join(out, `speed-seq_${String(frame).padStart(5, '0')}.png`), x, y);
    // Red for half a second, blue for the next second, red's held frame for half a second, then the pad.
    const red = await at(8, ...middle);
    expect(red[0], 'the fast cut').toBeGreaterThan(180);
    expect(red[2]).toBeLessThan(80);
    const blue = await at(30, ...middle);
    expect(blue[2], 'the slow cut where the fast one ended').toBeGreaterThan(180);
    expect(blue[0]).toBeLessThan(80);
    // The hold runs to the end of the track, which is also the end of the two-second graphic: the
    // last frame is still the held one, red to the last.
    for (const frame of [52, 59]) {
      const held = await at(frame, ...middle);
      expect(held[0], `the frozen frame after the slow cut (frame ${frame})`).toBeGreaterThan(180);
      expect(held[2]).toBeLessThan(80);
    }

    const mp4 = await render('pulp.test.video-layer', 'h264-mp4', 'speed-mix', { extra: [...common, ...trackArg] });
    expect(mp4.code, mp4.stderr).toBe(0);
    const band = async (from: number, to: number, hz: number) => {
      const r = await runBounded(ffmpeg, ffmpegArgs(['-i', join(out, 'speed-mix.mp4'), '-af', `atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS,bandpass=f=${hz}:width_type=q:w=8,volumedetect`, '-f', 'null', '-']), { timeoutMs: TOOL_TIMEOUT_MS });
      const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
      expect(m, r.stderr.slice(-1500)).not.toBeNull();
      return Number(m![1]);
    };
    // Red at 2× is still 440 Hz, not 880; blue at ½× is still 880, not 440.
    expect((await band(0.1, 0.4, 440)) - (await band(0.1, 0.4, 880)), 'the fast cut keeps its pitch').toBeGreaterThan(12);
    expect((await band(0.7, 1.3, 880)) - (await band(0.7, 1.3, 440)), 'the slow cut keeps its pitch').toBeGreaterThan(12);
    // A frozen frame has no sound.
    const level = async (from: number, to: number) => {
      const r = await runBounded(ffmpeg, ffmpegArgs(['-i', join(out, 'speed-mix.mp4'), '-af', `atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS,volumedetect`, '-f', 'null', '-']), { timeoutMs: TOOL_TIMEOUT_MS });
      return Number(/max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr)![1]);
    };
    expect(await level(1.6, 1.9), 'silence under the hold').toBeLessThan(-50);

    // A ramp from ½× to 2× with smooth slow motion: the interpolated frames render, the cut takes
    // its mean-rate length (a second of file at a mean of 1.25× is 0.8 s), and the pad follows.
    const ramp = { cuts: [{ id: blueId, from: 0, to: 1, speed: { rate: 0.5, to: 2, smooth: true } }] };
    const smooth = await render('pulp.test.video-layer', 'png-sequence', 'ramp-seq', { extra: [...common, '--param', `@track=${JSON.stringify(ramp)}`], timeoutMs: 180_000 });
    expect(smooth.code, smooth.stderr).toBe(0);
    const rampAt = async (frame: number) => pixels(join(out, `ramp-seq_${String(frame).padStart(5, '0')}.png`), ...middle);
    expect((await rampAt(12))[2], 'blue through the ramp').toBeGreaterThan(180);
    expect((await rampAt(20))[2]).toBeGreaterThan(180);
    const after = await rampAt(30);
    expect(after[0]! + after[1]! + after[2]!, 'the pad once the ramp has run its 0.8 s').toBeLessThan(60);
  }, 300_000);

  it('writes the captions into the render, beside it as SRT and WebVTT, and on their own as an alpha track (milestone 50)', async () => {
    // Two lines on the project's clock, drawn by a bundled caption style over the video-layer
    // fixture — 320 × 180, transparent but for its corner marker — so the caption band is the only
    // thing that can light up, and a moment between the lines must leave it clear.
    const captions = {
      style: 'pulp.samples.caption-clean',
      lines: [
        { words: [{ text: 'Hello', start: 0.2, end: 0.6 }, { text: 'there.', start: 0.6, end: 1.0 }] },
        { words: [{ text: 'Again', start: 1.4, end: 1.8 }] },
      ],
    };
    const common = ['--library', FIXTURES, '--param', `@captions=${JSON.stringify(captions)}`];
    // The band for 320 × 180 (src/core/player.ts): x 16, y 131, 288 wide, 40 tall; the style sets its
    // row at the band's foot, so a row of pixels a little above the foot crosses the words.
    const bandRow = async (file: string) => (await pixels(file, 16, 165, 288)).filter((_, i) => i % 4 === 3).reduce((sum, a) => sum + a, 0);
    const frameFile = (base: string, frame: number) => join(out, `${base}_${String(frame).padStart(5, '0')}.png`);

    // Burned in, the default: the words in the band while a line is on screen, nothing between lines.
    const burn = await render('pulp.test.video-layer', 'png-sequence', 'caps-burn', { extra: common });
    expect(burn.code, burn.stderr).toBe(0);
    expect(await bandRow(frameFile('caps-burn', 15)), 'the first line, at half a second').toBeGreaterThan(0);
    expect(await bandRow(frameFile('caps-burn', 36)), 'nothing between the lines').toBe(0);
    expect(await bandRow(frameFile('caps-burn', 48)), 'the second line').toBeGreaterThan(0);
    // Above the band the graphic is as it was: its corner marker and nothing else.
    const above = await pixels(frameFile('caps-burn', 15), 16, 90, 288);
    expect(above.filter((_, i) => i % 4 === 3).reduce((sum, a) => sum + a, 0)).toBe(0);
    // The subtitle files beside it, timed against the render.
    const srt = await readFile(join(out, 'caps-burn.srt'), 'utf8');
    expect(srt).toContain('1\n00:00:00,200 --> 00:00:01,000\nHello there.\n');
    expect(srt).toContain('2\n00:00:01,400 --> 00:00:01,900\nAgain\n');
    const vtt = await readFile(join(out, 'caps-burn.vtt'), 'utf8');
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:00.200 --> 00:00:01.000\nHello there.');
    expect(burn.stdout).toContain('caps-burn.srt');

    // As an alpha track: the picture left alone, the captions rendered on their own beside it, the
    // same size and rate, with alpha, so they lay over the video in an editing app.
    const track = await render('pulp.test.video-layer', 'png-sequence', 'caps-track', { extra: [...common, '--captions', 'track'], timeoutMs: 180_000 });
    expect(track.code, track.stderr).toBe(0);
    expect(await bandRow(frameFile('caps-track', 15)), 'the picture without the words').toBe(0);
    const trackFile = join(out, 'caps-track-captions.mov');
    expect(track.stdout).toContain(trackFile);
    const info = await probe(trackFile);
    expect(info).toMatchObject({ codec_name: 'prores', width: 320, height: 180, nb_read_frames: '60' });
    expect(info.pix_fmt, 'ProRes 4444 with its alpha').toMatch(/^yuva444p1[02]le$/);
    // Its frame at half a second carries the words, and its frame between the lines carries nothing.
    const at = async (seconds: number) => {
      const { stdout, stderr } = await runBoundedBuffer(ffmpeg, ffmpegArgs(['-v', 'error', '-ss', String(seconds), '-i', trackFile, '-vf', 'format=rgba,crop=288:1:16:165', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), { timeoutMs: TOOL_TIMEOUT_MS });
      expect(stdout.length, stderr).toBe(288 * 4);
      return [...stdout].filter((_, i) => i % 4 === 3).reduce((sum, a) => sum + a, 0);
    };
    expect(await at(0.5), 'the words on the track').toBeGreaterThan(0);
    expect(await at(1.2), 'and clear between the lines').toBe(0);
    expect(existsSync(join(out, 'caps-track.srt'))).toBe(true);

    // Drawn nowhere: the subtitle files alone.
    const none = await render('pulp.test.video-layer', 'png-sequence', 'caps-none', { extra: [...common, '--captions', 'none'] });
    expect(none.code, none.stderr).toBe(0);
    expect(await bandRow(frameFile('caps-none', 15))).toBe(0);
    expect(existsSync(join(out, 'caps-none.vtt'))).toBe(true);
    expect(existsSync(join(out, 'caps-none-captions.mov'))).toBe(false);

    // Read strictly on the command line, as the track is.
    const bad = await render('pulp.test.video-layer', 'png-sequence', 'caps-bad', { extra: ['--library', FIXTURES, '--param', '@captions={"lines":[]}'] });
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('@captions');
    const badMode = await render('pulp.test.video-layer', 'png-sequence', 'caps-bad-mode', { extra: [...common, '--captions', 'sideways'] });
    expect(badMode.code).toBe(2);
    expect(badMode.stderr).toContain('--captions');
  }, 400_000);

  it('plays transitions on a cut — a dissolve, a dip to a color, a bundled wipe — and an unlinked sound for a J cut (milestone 49)', async () => {
    const lib = join(out, 'transition-library');
    await mkdir(lib, { recursive: true });
    const clip = async (file: string, color: string, tone?: number) => {
      const r = await runBounded(ffmpeg, ffmpegArgs([
        '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=160x160:d=1:r=30`,
        ...(tone ? ['-f', 'lavfi', '-i', `sine=frequency=${tone}:duration=1`, '-c:a', 'aac'] : []),
        '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-shortest', '-movflags', '+faststart', join(lib, file),
      ]), { timeoutMs: TOOL_TIMEOUT_MS });
      expect(r.code, r.stderr).toBe(0);
      return itemId(`media:${join(lib, file)}`);
    };
    const redId = await clip('t-red.mp4', 'red', 440);
    const blueId = await clip('t-blue.mp4', 'blue', 880);
    const muteId = await clip('t-mute.mp4', 'gray');
    const common = ['--library', FIXTURES, '--library', lib];
    const middle = [160, 90] as const;
    const trackArg = (first: Record<string, unknown>, second: Record<string, unknown> = {}) =>
      ['--param', `@track=${JSON.stringify({ cuts: [{ id: redId, from: 0, to: 1, ...first }, { id: blueId, from: 0, to: 1, ...second }] })}`];
    const at = async (name: string, frame: number) => pixels(join(out, `${name}_${String(frame).padStart(5, '0')}.png`), ...middle);

    // A dissolve: pure red before it, pure blue after, and both shots in the frame at the boundary.
    const dissolved = await render('pulp.test.video-layer', 'png-sequence', 'join-dissolve', {
      extra: [...common, ...trackArg({ transition: { type: 'dissolve', seconds: 0.5 } })],
    });
    expect(dissolved.code, dissolved.stderr).toBe(0);
    expect((await at('join-dissolve', 10))[0], 'red before the transition').toBeGreaterThan(180);
    expect((await at('join-dissolve', 50))[2], 'blue after it').toBeGreaterThan(180);
    const blended = await at('join-dissolve', 30);
    expect(blended[0]!, `at the boundary both shots show: ${blended.join(',')}`).toBeGreaterThan(60);
    expect(blended[2]!).toBeGreaterThan(60);
    expect(blended[0]!).toBeLessThan(200);

    // A dip to a color: at the boundary the frame is the color, with the shots whole either side.
    const dipped = await render('pulp.test.video-layer', 'png-sequence', 'join-dip', {
      extra: [...common, ...trackArg({ transition: { type: 'dip', seconds: 0.5, color: '#00ff00' } })],
    });
    expect(dipped.code, dipped.stderr).toBe(0);
    const dip = await at('join-dip', 30);
    expect(dip[1]!, `the dip's color at the boundary: ${dip.join(',')}`).toBeGreaterThan(180);
    expect(dip[0]!).toBeLessThan(70);
    expect((await at('join-dip', 10))[0]).toBeGreaterThan(180);
    expect((await at('join-dip', 50))[2]).toBeGreaterThan(180);

    // A bundled wipe: the wipe fixture covers the frame at the boundary, and the shots stand either side.
    const wiped = await render('pulp.test.video-layer', 'png-sequence', 'join-wipe', {
      extra: [...common, ...trackArg({ transition: { type: 'wipe', seconds: 0.5, template: 'pulp.test.wipe' } })],
    });
    expect(wiped.code, wiped.stderr).toBe(0);
    const wipe = await at('join-wipe', 30);
    expect(wipe[0]!, `the wipe over the boundary: ${wipe.join(',')}`).toBeGreaterThan(180);
    expect(wipe[2]!).toBeGreaterThan(180);
    expect(wipe[1]!).toBeLessThan(70);
    expect((await at('join-wipe', 10))[0]).toBeGreaterThan(180);
    expect((await at('join-wipe', 50))[2]).toBeGreaterThan(180);

    // An unlinked sound: the second cut's tone leads under the silent first shot — a J cut — and a
    // muted cut's sound is out of the mix with its numbers kept.
    const level = async (name: string, from: number, to: number) => {
      const r = await runBounded(ffmpeg, ffmpegArgs(['-i', join(out, name), '-af', `atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS,volumedetect`, '-f', 'null', '-']), { timeoutMs: TOOL_TIMEOUT_MS });
      const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
      expect(m, r.stderr.slice(-1500)).not.toBeNull();
      return Number(m![1]);
    };
    // The second cut's picture is trimmed in by 0.4 s, and its sound leads by that much: the lead
    // plays the material before the picture's in point, under the end of the silent first shot.
    const led = await render('pulp.test.video-layer', 'h264-mp4', 'join-lead', {
      extra: [...common, '--param', `@track=${JSON.stringify({ cuts: [{ id: muteId, from: 0, to: 1 }, { id: blueId, from: 0.4, to: 1, sound: { lead: 0.4 } }] })}`],
    });
    expect(led.code, led.stderr).toBe(0);
    expect(await level('join-lead.mp4', 0.1, 0.5), 'quiet before the lead reaches').toBeLessThan(-45);
    expect(await level('join-lead.mp4', 0.7, 0.95), 'the next shot heard under the silent one').toBeGreaterThan(-30);
    expect(await level('join-lead.mp4', 1.1, 1.5), 'and on through its own shot').toBeGreaterThan(-30);
    const mutedCut = await render('pulp.test.video-layer', 'h264-mp4', 'join-muted', {
      extra: [...common, '--param', `@track=${JSON.stringify({ cuts: [{ id: muteId, from: 0, to: 1 }, { id: blueId, from: 0, to: 1, sound: { muted: true } }] })}`],
    });
    expect(mutedCut.code, mutedCut.stderr).toBe(0);
    // With the only sound muted the project is silent, and a silent project carries no audio stream at all.
    const probed = await runBounded(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'json', join(out, 'join-muted.mp4')], { timeoutMs: TOOL_TIMEOUT_MS });
    expect(((JSON.parse(probed.stdout || '{}') as { streams?: unknown[] }).streams ?? []).length, 'a muted cut adds nothing to the mix').toBe(0);
  }, 300_000);

  it('exports the edit for an editing app: FCPXML and an EDL with the clips in place, the graphics rendered with alpha beside them (milestone 49)', async () => {
    const lib = join(out, 'edit-library');
    await mkdir(lib, { recursive: true });
    const clip = async (file: string, color: string, tone: number) => {
      const r = await runBounded(ffmpeg, ffmpegArgs([
        '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=160x160:d=1:r=30`, '-f', 'lavfi', '-i', `sine=frequency=${tone}:duration=1`,
        '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', join(lib, file),
      ]), { timeoutMs: TOOL_TIMEOUT_MS });
      expect(r.code, r.stderr).toBe(0);
      return itemId(`media:${join(lib, file)}`);
    };
    const redId = await clip('e-red.mp4', 'red', 440);
    const blueId = await clip('e-blue.mp4', 'blue', 880);
    // Both sides hold handles past their windows, so the dissolve travels into the FCPXML too.
    const track = { cuts: [{ id: redId, from: 0.2, to: 0.8, transition: { type: 'dissolve', seconds: 0.2 } }, { id: blueId, from: 0.2, to: 0.8 }] };
    const base = join(out, 'edit-out');
    const run = await runBounded(electron, [
      '.', '--render', 'pulp.test.video-layer', '--export-edit', base,
      '--library', FIXTURES, '--library', lib, '--param', `@track=${JSON.stringify(track)}`,
    ], { cwd: ROOT, timeoutMs: 180_000 });
    expect(run.code, run.stderr).toBe(0);

    // The FCPXML: the spine of cuts, the clips referenced where they lie, the dissolve between
    // them, and the graphics connected above the first cut.
    const xml = await readFile(`${base}.fcpxml`, 'utf8');
    expect(xml).toContain('<fcpxml version="1.10">');
    // Node's own file URL, so a Windows path is checked as file:///C:/… rather than a backslashed
    // guess — compared decoded, since Node writes a short name's ~ as %7E where the export keeps it.
    const sources = [...xml.matchAll(/src="([^"]+)"/g)].map((m) => decodeURI(m[1]!));
    expect(sources).toContain(decodeURI(pathToFileURL(join(lib, 'e-red.mp4')).href));
    expect(sources).toContain(decodeURI(pathToFileURL(join(lib, 'e-blue.mp4')).href));
    expect(xml).toContain('<transition name="Cross Dissolve"');
    expect(xml).toContain('lane="1"');
    expect(xml).toContain('start="6/30s" duration="18/30s"');

    // The EDL: one event per cut with the files named.
    const edl = await readFile(`${base}.edl`, 'utf8');
    expect(edl).toContain('TITLE: Test Video Layer');
    expect(edl).toContain('001  AX       V     C ');
    expect(edl).toContain('002  AX       V     D    006');
    expect(edl).toContain(`* SOURCE FILE: ${join(lib, 'e-red.mp4')}`);
    expect(edl).toContain(`* GRAPHICS WITH ALPHA: ${base}-graphics.mov`);

    // The graphics beside them: ProRes 4444 with alpha, the piece's own length, and the track
    // nowhere in it — the fixture's yellow marker over transparency, not over footage.
    const probed = await runBounded(ffprobe, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,duration', '-of', 'json', `${base}-graphics.mov`,
    ], { timeoutMs: TOOL_TIMEOUT_MS });
    const stream = (JSON.parse(probed.stdout) as { streams: { codec_name: string; pix_fmt: string; duration: string }[] }).streams[0]!;
    expect(stream.codec_name).toBe('prores');
    expect(stream.pix_fmt).toContain('yuva');
    expect(Number(stream.duration)).toBeCloseTo(2, 0);
  }, 300_000);

  it('heals a saved track whose clips moved, by the path each cut remembers (milestone 49)', async () => {
    const lib = join(out, 'heal-library');
    await mkdir(lib, { recursive: true });
    const file = join(lib, 'moved.mp4');
    const made = await runBounded(ffmpeg, ffmpegArgs(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x160:d=1:r=30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', file]), { timeoutMs: TOOL_TIMEOUT_MS });
    expect(made.code, made.stderr).toBe(0);
    // The stored id is stale — the file "moved" here from somewhere else — but the cut remembers
    // this path, and an id is the hash of a path, so the render answers for it.
    const stale = { cuts: [{ id: 'f'.repeat(24), from: 0, to: 1, path: file }] };
    const healed = await render('pulp.test.video-layer', 'png-sequence', 'heal-track', {
      extra: ['--library', FIXTURES, '--library', lib, '--param', `@track=${JSON.stringify(stale)}`],
    });
    expect(healed.code, healed.stderr).toBe(0);
    const px = await pixels(join(out, 'heal-track_00010.png'), 160, 90);
    expect(px[0], 'the moved clip plays under the graphic').toBeGreaterThan(180);
  }, 240_000);

  it('plays a clip inside a graphic, on the template\'s own time (milestone 26)', async () => {
    // A transparent clip whose red square moves left to right over its 30 frames, so which frame
    // was drawn can be read off the rendered picture. The library sees it by path, as any clip.
    const lib = join(out, 'clip-library');
    await mkdir(lib, { recursive: true });
    const clip = join(lib, 'plate.mov');
    const built = await runBounded(ffmpeg, ffmpegArgs([
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black@0:s=160x160:d=1:r=30,format=rgba',
      '-f', 'lavfi', '-i', 'color=c=red:s=40x40:d=1:r=30,format=rgba',
      '-filter_complex', "[0][1]overlay=x='floor(t*120)':y=60:format=auto",
      '-c:v', 'qtrle', clip,
    ]), { timeoutMs: TOOL_TIMEOUT_MS });
    expect(built.code, built.stderr).toBe(0);
    const clipId = itemId(`media:${clip}`);

    const layers = (value: unknown) => ['--param', `@layers=${JSON.stringify({ stack: [{ id: 'plate', clip: value }] })}`];
    const common = ['--library', FIXTURES, '--library', lib];
    // Where the clip's square lands on the rendered frame at its first frame, and the corner
    // marker the fixture paints every frame: that tells a missing layer from a blank render.
    const square = [125, 90] as const;
    const marker = [2, 2] as const;

    // Looping: the template runs twice as long as the clip, so frame 30 is the clip's frame 0 again.
    const loop = await render('pulp.test.video-layer', 'png-sequence', 'vid-loop', { extra: [...common, ...layers(clipId)] });
    expect(loop.code, loop.stderr).toBe(0);
    expect((await pixels(join(out, 'vid-loop_00000.png'), ...square))[3], 'the clip draws from the first frame').toBe(255);
    expect(await pixels(join(out, 'vid-loop_00030.png'), ...square)).toEqual(await pixels(join(out, 'vid-loop_00000.png'), ...square));
    // And it really moves: a later frame has the square somewhere else.
    expect((await pixels(join(out, 'vid-loop_00020.png'), ...square))[3], 'the square has moved on').toBe(0);

    // Played once, it clears at its end rather than freezing — the frame still renders.
    const once = await render('pulp.test.video-layer', 'png-sequence', 'vid-once', {
      extra: [...common, ...layers({ id: clipId, ending: 'once' })],
    });
    expect(once.code, once.stderr).toBe(0);
    expect((await pixels(join(out, 'vid-once_00000.png'), ...square))[3]).toBe(255);
    expect((await pixels(join(out, 'vid-once_00045.png'), ...square))[3], 'gone once it has played').toBe(0);
    expect((await pixels(join(out, 'vid-once_00045.png'), ...marker))[3], 'but the frame was drawn').toBe(255);

    // A start delay holds it back; the graphic is drawn throughout either way.
    const delayed = await render('pulp.test.video-layer', 'png-sequence', 'vid-delay', {
      extra: [...common, ...layers({ id: clipId, delay: 1 })],
    });
    expect(delayed.code, delayed.stderr).toBe(0);
    expect((await pixels(join(out, 'vid-delay_00000.png'), ...square))[3], 'not yet').toBe(0);
    expect((await pixels(join(out, 'vid-delay_00000.png'), ...marker))[3]).toBe(255);
    expect((await pixels(join(out, 'vid-delay_00030.png'), ...square))[3], 'and away it goes').toBe(255);

    // Rounded corners and soft edges (milestone 28) shape the clip's picture. A solid clip shows
    // them plainly: the layer is 90 px tall in the 320 x 180 frame, so its picture runs from
    // (115, 45), and a corner of it is cut away by a radius and faded by a feather while its
    // middle is untouched by either.
    const solid = join(lib, 'solid.mov');
    const madeSolid = await runBounded(ffmpeg, ffmpegArgs(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x160:d=1:r=30,format=rgba', '-c:v', 'qtrle', solid]), { timeoutMs: TOOL_TIMEOUT_MS });
    expect(madeSolid.code, madeSolid.stderr).toBe(0);
    const solidId = itemId(`media:${solid}`);
    const shapedLayers = (look: unknown) => ['--param', `@layers=${JSON.stringify({ stack: [{ id: 'plate', clip: solidId, look }] })}`];
    const pictureCorner = [117, 47] as const;
    const pictureEdge = [120, 90] as const;
    const pictureMiddle = [160, 90] as const;
    const plainSolid = await render('pulp.test.video-layer', 'png-sequence', 'vid-solid', { extra: [...common, ...shapedLayers({})] });
    expect(plainSolid.code, plainSolid.stderr).toBe(0);
    expect((await pixels(join(out, 'vid-solid_00000.png'), ...pictureCorner))[3], 'the picture\'s corner is drawn plain').toBe(255);
    const shaped = await render('pulp.test.video-layer', 'png-sequence', 'vid-shaped', { extra: [...common, ...shapedLayers({ corners: 0.08 })] });
    expect(shaped.code, shaped.stderr).toBe(0);
    expect((await pixels(join(out, 'vid-shaped_00000.png'), ...pictureCorner))[3], 'and rounded away').toBe(0);
    expect((await pixels(join(out, 'vid-shaped_00000.png'), ...pictureMiddle))[3], 'the middle stays').toBe(255);
    const soft = await render('pulp.test.video-layer', 'png-sequence', 'vid-soft', { extra: [...common, ...shapedLayers({ feather: 0.06 })] });
    expect(soft.code, soft.stderr).toBe(0);
    const edge = (await pixels(join(out, 'vid-soft_00000.png'), ...pictureEdge))[3]!;
    expect(edge, 'the edge is faded, neither solid nor gone').toBeGreaterThan(0);
    expect(edge).toBeLessThan(200);
    expect((await pixels(join(out, 'vid-soft_00000.png'), ...pictureMiddle))[3], 'the middle stays solid').toBe(255);

    // A clip that is not in the library stops the render by name rather than drawing nothing.
    const missing = await render('pulp.test.video-layer', 'png-sequence', 'vid-missing', {
      extra: [...common, ...layers('deadbeefdeadbeefdeadbeef')],
    });
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('clip chosen for a layer');
  }, 300_000);

  it('indexes a folder of frames as one transparent clip, not a card per frame', async () => {
    // Milestone 26: asset stock often ships as numbered frames. A real alpha sequence is what the
    // renderer itself writes, so the fixture is a PNG-sequence render placed in a library folder.
    const root = join(out, 'frame-library');
    const folder = join(root, 'Assets', 'Fire and flames');
    await mkdir(folder, { recursive: true });
    const made = await render('pulp.samples.boardroom.lower-third', 'png-sequence', join('frame-library', 'Assets', 'Fire and flames', 'flame'), {
      extra: ['--in-point', '60', '--out-point', '119'],
    });
    expect(made.code, made.stderr).toBe(0);
    expect((await readdir(folder)).filter((f) => f.endsWith('.png'))).toHaveLength(60);
    // Files that are not frames of the run stay pictures of their own: two variants and a poster.
    for (const name of ['logo-1.png', 'logo-2.png', 'poster.png']) {
      await copyFile(join(folder, 'flame_00060.png'), join(folder, name));
    }

    const index = await scanLibrary([root]);
    expect(index.problems).toEqual([]);
    const clips = index.media.filter((m) => m.sequence);
    expect(clips, 'one entry for the whole run').toHaveLength(1);
    const clip = clips[0]!;
    expect(clip).toMatchObject({ name: 'flame', mediaKind: 'video', ext: '.png', type: 'fire' });
    expect(clip.sequence).toMatchObject({ start: 60, count: 60, digits: 5, stem: 'flame_' });
    // Its path is the first frame, and the three loose pictures are indexed separately.
    expect(basename(clip.path)).toBe('flame_00060.png');
    expect(index.media.filter((m) => !m.sequence).map((m) => m.name).sort()).toEqual(['logo-1', 'logo-2', 'poster']);

    // The run's first frame says it is transparent, and the run says how long it plays for.
    const meta = sequenceMetadata(await probeMedia(ffprobe, clip.path, nodeRunner), clip.sequence!);
    expect(meta).toMatchObject({ codec: 'png', alpha: true, fps: SEQUENCE_FPS, duration: 60 / SEQUENCE_FPS });

    // A hover-scrub strip is made from the run itself, eight tiles wide, with its alpha kept.
    const strip = join(out, 'sequence-strip.png');
    const args = sequenceStripArgs(join(folder, sequencePatternName(clip.sequence!)), clip.sequence!.start, strip, meta!.duration!, SEQUENCE_FPS);
    const built = await runBounded(ffmpeg, ffmpegArgs(args), { timeoutMs: TOOL_TIMEOUT_MS });
    expect(built.code, built.stderr).toBe(0);
    const stripInfo = await probe(strip);
    expect(stripInfo.pix_fmt).toBe('rgba');
    expect(stripInfo.width / stripInfo.height, 'eight 16:9 tiles side by side').toBeCloseTo(8 * (16 / 9), 0);
    // The panel is drawn in every tile and the top corner is clear in all of them: this is the
    // clip through its hold, not one frame repeated or a blank sheet.
    const tile = stripInfo.width / 8;
    for (const t of [0, 4, 7]) {
      expect((await pixels(strip, Math.round(t * tile + tile * 0.07), Math.round(stripInfo.height * 0.83)))[3], `tile ${t} draws the panel`).toBeGreaterThan(0);
      expect((await pixels(strip, Math.round(t * tile + tile * 0.5), Math.round(stripInfo.height * 0.1)))[3], `tile ${t} is clear above it`).toBe(0);
    }
  }, 240_000);

  it('renders between in and out points, numbering the files with the template frame indices', async () => {
    // Lower third: 6 s at 30 fps. 00:00:02:00 to 00:00:02:29 is mid-hold, so the panel is fully visible
    // from the first rendered frame; at frame 0 that pixel is transparent. Inclusive out point: 30 frames.
    const result = await render('pulp.samples.lower-third-bar', 'png-sequence', 'trim', {
      extra: ['--in-point', '00:00:02:00', '--out-point', '00:00:02:29', '--param', 'panel=#ffffffd9'],
    });
    expect(result.code, result.stderr).toBe(0);
    const frames = (await readdir(out)).filter((f) => /^trim_\d{5}\.png$/.test(f)).sort();
    expect(frames).toHaveLength(30);
    expect(frames[0]).toBe('trim_00060.png');
    expect(frames.at(-1)).toBe('trim_00089.png');
    expect((await pixels(join(out, 'trim_00060.png'), 120, 840))[3]).toBe(217);
    expect((await pixels(join(out, 'trim_00089.png'), 120, 840))[3]).toBe(217);
  }, 180_000);

  it('flattens an alpha template over the chosen background color', async () => {
    const result = await render('pulp.test.size-portrait', 'h264-mp4', 'bg.mp4', { extra: ['--background', '#336699', '--library', FIXTURES] });
    expect(result.code, result.stderr).toBe(0);
    const file = join(out, 'bg.mp4');
    expect(await probe(file)).toMatchObject({ width: 1080, height: 1920, pix_fmt: 'yuv420p', nb_read_frames: '3' });
    // Transparent center takes the background; the opaque red marker is unaffected. H.264 is lossy.
    const center = await pixels(file, 540, 960);
    const expected = [0x33, 0x66, 0x99];
    for (let c = 0; c < 3; c++) expect(Math.abs(center[c]! - expected[c]!), `background channel ${c}`).toBeLessThanOrEqual(4);
    const red = await pixels(file, 4, 4);
    expect(Math.abs(red[0]! - 255)).toBeLessThanOrEqual(4);
    expect(red[1]).toBeLessThanOrEqual(4);
  }, 180_000);

  it('rejects impossible render options before rendering', async () => {
    const bad = await render('pulp.test.size-portrait', 'prores-4444', 'bad.mov', { extra: ['--fps', '31', '--library', FIXTURES] });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('frame rate must be one of 23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 100, 119.88, 120, got 31');
    expect(existsSync(join(out, 'bad.mov'))).toBe(false);
    const tc = await render('pulp.test.size-portrait', 'prores-4444', 'bad2.mov', { extra: ['--out-point', 'soon', '--library', FIXTURES] });
    expect(tc.code).toBe(2);
    expect(tc.stderr).toContain('--out-point: "soon" is not a frame number, seconds ("2.5s") or timecode (HH:MM:SS:FF)');
    const field = await render('pulp.test.size-portrait', 'prores-4444', 'bad3.mov', { extra: ['--in-point', '00:00:00:30', '--library', FIXTURES] });
    expect(field.code).toBe(2);
    expect(field.stderr).toContain('--in-point: "00:00:00:30": the frames field must be below 30 at 30 fps');
  }, 180_000);

  it('renders a batch from CSV, one file per row named from the name column, warning about unknown columns', async () => {
    const csv = join(out, 'batch.csv');
    // A Logo column picks an image per row (milestone 22): by file name from the Imported folder under user
    // data, or by library id; a row whose logo cannot be found is named and skipped, not rendered blank.
    const userData = join(out, 'batch-user-data');
    await mkdir(join(userData, 'imported'), { recursive: true });
    await runBounded(ffmpeg, ffmpegArgs(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=256x256', '-frames:v', '1', join(userData, 'imported', 'Acme.png')]), { timeoutMs: TOOL_TIMEOUT_MS });
    // "name" and "title" are text layers of this template (milestone 23), so they map to the layers' words; "file" names the outputs.
    await writeFile(csv, 'file,Name,title,Mood,Logo\nAlex,Alex Rivera,Director of Photography,calm,\nSam,Sam Lee,Editor,bright,acme.png\nKim,Kim Osei,Producer,,nowhere.png\n');
    const result = await render('pulp.samples.lower-third-bar', 'png-sequence', 'batch-out', {
      extra: ['--batch', csv, '--in-point', '90', '--out-point', '90'],
      timeoutMs: 180_000,
      env: { PULP_USER_DATA: userData },
    });
    expect(result.code).toBe(1); // one row skipped
    expect(result.stderr).toContain('warning: Unknown column ignored: Mood.');
    expect(result.stderr).toContain('Kim: skipped: Logo: "nowhere.png" is not a library id or a file in the Imported folder');
    expect(result.stdout).toContain('batch: 3 renders of Lower Third Bar into');
    const files = (await readdir(join(out, 'batch-out'))).sort();
    expect(files).toEqual(['Alex_00090.png', 'Sam_00090.png']);
    // Different names give different panel widths: the pixel past a short name's panel is transparent only for one of them.
    const alex = await pixels(join(out, 'batch-out', 'Alex_00090.png'), 120, 840);
    expect(alex[3]).toBe(217);
    // Sam's row named the imported logo by file: the badge at the head of the panel is the green square.
    const badge = await pixels(join(out, 'batch-out', 'Sam_00090.png'), 199, 891);
    expect(badge[1]).toBeGreaterThan(200);
    expect(badge[0]).toBeLessThan(40);
    // In the panel's padding before the text, where no badge sits: the panel's dark blue for Alex.
    const noBadge = await pixels(join(out, 'batch-out', 'Alex_00090.png'), 120, 900);
    expect(noBadge[1]).toBeLessThan(60);
    expect(noBadge[3]).toBe(217);
  }, 240_000);

  it('renders a saved collection, each item with its own settings, skipping what the library cannot answer for', async () => {
    const file = join(out, 'show.pulpcollection');
    await writeFile(
      file,
      JSON.stringify({
        formatVersion: 1,
        items: [
          // Two of the same template with different parameters and trims: each must come out its own way.
          // The words are layers (milestone 23): a collection carries them in the same bag as the parameters.
          { uid: 'a', id: 'whatever', kind: 'template', name: 'Opening strap', templateId: 'pulp.samples.lower-third-bar', presetId: 'png-sequence', options: { inFrame: 90, outFrame: 90 }, params: { '@layers': { strap: [{ id: 'name', text: 'Alex Rivera' }, { id: 'title' }] } } },
          { uid: 'b', id: 'whatever', kind: 'template', name: 'Closing strap', templateId: 'pulp.samples.lower-third-bar', presetId: 'png-sequence', options: { inFrame: 100, outFrame: 100 }, params: { '@layers': { strap: [{ id: 'name', text: 'Sam Lee' }, { id: 'title' }] } } },
          // Nothing in the library answers for these two.
          { uid: 'c', id: 'gone', kind: 'template', name: 'Missing one', templateId: 'nobody.has.this', presetId: 'png-sequence', options: {}, params: {} },
          { uid: 'd', id: 'clip', kind: 'media', name: 'Some clip', presetId: 'png-sequence', options: {}, params: {} },
        ],
      }),
    );
    const folder = join(out, 'collection-out');
    const result = await runBounded(electron, ['.', '--collection', file, '--out', folder], { cwd: ROOT, timeoutMs: 180_000 });
    expect(result.stdout).toContain('collection: 4 items from show into');
    expect(result.stdout).toContain('collection: 2 rendered, 0 failed');
    // Named and skipped, not silently dropped.
    expect(result.stderr).toContain('skipped Missing one: its template is not in the library');
    // A media item renders itself now (milestone 15); this one names an id the library does not have.
    expect(result.stderr).toContain('skipped Some clip: it is not in the library, or its folder is offline');

    const files = (await readdir(folder)).sort();
    expect(files).toEqual(['closing-strap_00100.png', 'opening-strap_00090.png']);
    // Each item kept its own parameters: different names make different panel widths.
    const openingPanel = await pixels(join(folder, 'opening-strap_00090.png'), 120, 840);
    expect(openingPanel[3]).toBe(217);
  }, 240_000);

  it('renders QuickTime Animation losslessly with alpha', async () => {
    const result = await render('pulp.test.size-portrait', 'qt-animation', 'anim.mov', { extra: ['--library', FIXTURES] });
    expect(result.code, result.stderr).toBe(0);
    const file = join(out, 'anim.mov');
    // MOV has no range flag for RGB codecs; the colr atom's GBR matrix is what declares full-range RGB.
    expect(await probe(file)).toMatchObject({ codec_name: 'qtrle', pix_fmt: 'argb', width: 1080, height: 1920, nb_read_frames: '3', color_space: 'gbr', color_primaries: 'bt709' });
    // RLE is lossless and stays RGB, so the probe markers must come back exactly, alpha included.
    await expectProbeMarkers(file, 1080, 1920);
  }, 180_000);

  it.skipIf(!encoders.includes('hevc_videotoolbox'))('renders HEVC with alpha through VideoToolbox, tagged hvc1 and Rec.709', async () => {
    const result = await render('pulp.test.size-portrait', 'hevc-alpha', 'hevc.mov', { extra: ['--library', FIXTURES] });
    expect(result.code, result.stderr).toBe(0);
    const file = join(out, 'hevc.mov');
    const info = await probe(file);
    expect(info).toMatchObject({
      codec_name: 'hevc', codec_tag_string: 'hvc1', width: 1080, height: 1920, nb_read_frames: '3',
      color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709',
    });
    // Lossy, so colors within a few steps; this also proves the matrix was BT.709 (an untagged
    // VideoToolbox conversion decodes pure red as about 233).
    const expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
    const spots = [[4, 4], [1080 - 5, 4], [4, 1920 - 5], [1080 - 5, 1920 - 5]];
    for (const [i, [x, y]] of spots.entries()) {
      const px = await pixels(file, x!, y!);
      for (let c = 0; c < 3; c++) expect(Math.abs(px[c]! - expected[i]![c]!), `marker ${i} channel ${c}`).toBeLessThanOrEqual(6);
    }
    // The alpha layer is an HEVC auxiliary layer. ffmpeg 8 and later decode it; older builds return
    // the base layer only, which reads as fully opaque, so the alpha check is skipped there.
    const [min, max] = await alphaRange(file, 1);
    if (min === 255 && max === 255) {
      console.info('ffmpeg here does not decode the HEVC alpha layer; alpha check skipped.');
    } else {
      expect(min).toBe(0);
      expect(max).toBe(255);
      // And the library can tell: the stream reads yuv420p like any opaque file, so a scan has only
      // the auxiliary layer to go on. A file this app wrote is the one certain alpha HEVC to test with.
      const meta = await probeMedia(ffprobe, file, nodeRunner);
      expect(meta?.codec).toBe('hevc');
      expect(meta?.pixelFormat).toBe('yuv420p');
      expect(meta?.alpha, 'an HEVC alpha clip earns the Alpha badge').toBe(true);
    }
  }, 180_000);

  it('renders ProRes 4444 with alpha at 8K', async () => {
    const result = await render('pulp.test.size-8k', 'prores-4444', 'size-8k.mov', { extra: ['--library', FIXTURES], timeoutMs: 300_000 });
    expect(result.code, result.stderr).toBe(0);
    const file = join(out, 'size-8k.mov');
    const info = await probe(file);
    expect(info).toMatchObject({ width: 7680, height: 4320, nb_read_frames: '3' });
    expect(info.pix_fmt).toMatch(/^yuva444p/);
    const [min, max] = await alphaRange(file, 1);
    expect(min).toBe(0);
    expect(max).toBeGreaterThan(200);
  }, 360_000);

  it('renders H.264 in portrait orientation, flattened over the background', async () => {
    const result = await render('pulp.test.size-portrait', 'h264-mp4', 'size-portrait.mp4', { extra: ['--library', FIXTURES], timeoutMs: 180_000 });
    expect(result.code, result.stderr).toBe(0);
    const info = await probe(join(out, 'size-portrait.mp4'));
    expect(info).toMatchObject({ width: 1080, height: 1920, pix_fmt: 'yuv420p', nb_read_frames: '3' });
  }, 240_000);

  it('keeps straight alpha on the raw frame path: a semi-transparent pixel matches the PNG path', async () => {
    // The lower-third panel is 85% opaque. Captured pixels are premultiplied, so a white panel left
    // as-is would read 217 per channel instead of 255; the PNG encoder undoes it, the raw path must too.
    const panel = ['--param', 'panel=#ffffffd9'];
    for (const [format, file] of [['raw', 'lt-raw'], ['png', 'lt-png']] as const) {
      const result = await render('pulp.samples.lower-third-bar', 'png-sequence', file, {
        extra: ['--frame-format', format, ...panel],
      });
      expect(result.code, result.stderr).toBe(0);
      const transport = /^frames: .*$/m.exec(result.stdout)?.[0] ?? '(no frames line)';
      // Shown when the reporter prints console output; the Windows CI job also prints this line in its own step.
      console.info(`${process.platform} ${format} path: ${transport}`);
      // The raw path must really be raw here; a PNG fallback would hide a platform the probe cannot read.
      if (format === 'raw') expect(transport, result.stderr).toMatch(/^frames: raw \((bgra|rgba), (premultiplied|straight) alpha\)$/);
      else expect(transport).toBe('frames: png');
    }
    // Frame 90 is mid-hold; (120, 840) is inside the panel, clear of the text and the accent bar.
    const png = await pixels(join(out, 'lt-png_00090.png'), 120, 840);
    const raw = await pixels(join(out, 'lt-raw_00090.png'), 120, 840);
    expect(png[3]).toBe(217);
    for (let i = 0; i < 3; i++) expect(Math.abs(png[i]! - 255), `png channel ${i}`).toBeLessThanOrEqual(1);
    for (let i = 0; i < 4; i++) expect(Math.abs(raw[i]! - png[i]!), `raw vs png channel ${i}`).toBeLessThanOrEqual(1);
  }, 240_000);

  it('renders ProRes 4444 with a real alpha channel', async () => {
    const result = await render('pulp.samples.lower-third-bar', 'prores-4444', 'lower-third.mov');
    expect(result.code, result.stderr).toBe(0);
    const file = join(out, 'lower-third.mov');
    const info = await probe(file);
    expect(info).toMatchObject({ width: 1920, height: 1080, nb_read_frames: '180' });
    expect(info.pix_fmt).toMatch(/^yuva444p/);
    // Mid-animation: transparent background plus an opaque or near-opaque panel.
    const [min, max] = await alphaRange(file, 90);
    expect(min).toBe(0);
    expect(max).toBeGreaterThan(200);
  }, 120_000);

  it('renders VP9 WebM with alpha', async () => {
    const result = await render('pulp.samples.diagonal-wipe', 'webm-vp9-alpha', 'wipe.webm');
    expect(result.code, result.stderr).toBe(0);
    const file = join(out, 'wipe.webm');
    const info = await probe(file);
    expect(info).toMatchObject({ width: 1920, height: 1080, nb_read_frames: '45' });
    expect(info.tags?.alpha_mode ?? info.tags?.ALPHA_MODE).toBe('1');
    // Frame 10 is partly covered by the wipe. The native VP9 decoder ignores the alpha layer; libvpx reads it.
    const [min, max] = await alphaRange(file, 10, 'libvpx-vp9');
    expect(min).toBe(0);
    expect(max).toBe(255);
  }, 120_000);

  it('renders a PNG sequence with one RGBA file per frame', async () => {
    const result = await render('pulp.samples.diagonal-wipe', 'png-sequence', 'wipe');
    expect(result.code, result.stderr).toBe(0);
    const frames = (await readdir(out)).filter((f) => /^wipe_\d{5}\.png$/.test(f)).sort();
    expect(frames).toHaveLength(45);
    expect(frames[0]).toBe('wipe_00000.png');
    const info = await probe(join(out, frames[22]!));
    expect(info).toMatchObject({ width: 1920, height: 1080, pix_fmt: 'rgba' });
  }, 120_000);

  it('a template\'s own sound is mixed into the render, follows the chosen variant, and "none" silences it (milestone 16)', async () => {
    // Diagonal Wipe ships three swooshes and defaults to the soft one.
    /** The first audio stream of a file, or null where there is none. */
    const probeAudio = async (file: string): Promise<{ codec_name?: string } | null> => {
      const { stdout, stderr } = await runBounded(ffprobe, [
        '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'json', file,
      ], { timeoutMs: TOOL_TIMEOUT_MS });
      expect(stdout, stderr).not.toBe('');
      return (JSON.parse(stdout) as { streams?: { codec_name?: string }[] }).streams?.[0] ?? null;
    };
    const maxVolume = async (file: string): Promise<number> => {
      const r = await runBounded(ffmpeg, ffmpegArgs(['-i', file, '-af', 'volumedetect', '-f', 'null', '-']), { timeoutMs: TOOL_TIMEOUT_MS });
      const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
      expect(m, r.stderr.slice(-2000)).not.toBeNull();
      return Number(m![1]);
    };

    // The default variant, mixed in without being asked for: AAC beside H.264, and audibly there.
    const mixed = await render('pulp.samples.diagonal-wipe', 'h264-mp4', 'swoosh.mp4');
    expect(mixed.code, mixed.stderr).toBe(0);
    expect((await probeAudio(join(out, 'swoosh.mp4')))?.codec_name).toBe('aac');
    expect(await maxVolume(join(out, 'swoosh.mp4')), 'the swoosh is there').toBeGreaterThan(-20);

    // A chosen variant rides @sound; "none" renders no audio stream at all, as a silent project does.
    const chosen = await render('pulp.samples.diagonal-wipe', 'h264-mp4', 'swoosh-sharp.mp4', { extra: ['--param', '@sound=sharp'] });
    expect(chosen.code, chosen.stderr).toBe(0);
    expect((await probeAudio(join(out, 'swoosh-sharp.mp4')))?.codec_name).toBe('aac');
    const silent = await render('pulp.samples.diagonal-wipe', 'h264-mp4', 'swoosh-none.mp4', { extra: ['--param', '@sound=none'] });
    expect(silent.code, silent.stderr).toBe(0);
    expect(await probeAudio(join(out, 'swoosh-none.mp4'))).toBeNull();

    // An image sequence has no room for an audio stream: the swoosh is the WAV beside it.
    const sequence = await render('pulp.samples.diagonal-wipe', 'png-sequence', 'swoosh-seq');
    expect(sequence.code, sequence.stderr).toBe(0);
    expect((await probeAudio(join(out, 'swoosh-seq-audio.wav')))?.codec_name).toBe('pcm_s16le');
  }, 240_000);

  it('is a proper pulp command: subcommands, help, the version, and exit codes a script can read (milestone 8)', async () => {
    const pulp = (args: string[]) => runBounded(electron!, ['.', ...args], { cwd: ROOT, timeoutMs: 120_000 });
    // Help and the version print and exit clean.
    const help = await pulp(['help']);
    expect(help.code, help.stderr).toBe(0);
    expect(help.stdout).toContain('Usage: pulp <command> [arguments]');
    expect(help.stdout).toContain('  render ');
    expect(help.stdout).toContain('Exit codes: 0 the work was done');
    const renderHelp = await pulp(['help', 'render']);
    expect(renderHelp.code).toBe(0);
    expect(renderHelp.stdout).toContain('Usage: pulp render <template-id> --out <path> [options]');
    expect(renderHelp.stdout).toContain('--stems mix|files');
    const version = await pulp(['--version']);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toMatch(/^pulp \d+\.\d+\.\d+/);

    // A wrong command line is exit 2, says what was wrong and where to read more, and renders nothing.
    const unknown = await pulp(['frobnicate']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('pulp: unknown command "frobnicate"');
    expect(unknown.stderr).toContain('Run "pulp help" for the commands.');
    const option = await pulp(['render', 'pulp.samples.title-card', '--out', join(out, 'never.mov'), '--bogus', '1']);
    expect(option.code).toBe(2);
    expect(option.stderr).toContain('pulp render: unknown option "--bogus"');
    expect(option.stderr).toContain('Run "pulp help render" for its options.');
    expect(existsSync(join(out, 'never.mov'))).toBe(false);
    const missing = await pulp(['render', 'no.such.template', '--out', join(out, 'never.mov')]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Template "no.such.template" not found.');

    // The subcommand form renders exactly as the older flag form does.
    const still = await pulp(['render', 'pulp.samples.title-card', '--preset', 'png-still', '--out', join(out, 'command-form.png')]);
    expect(still.code, still.stderr).toBe(0);
    expect(still.stdout).toContain('wrote ');
    expect(existsSync(join(out, 'command-form.png'))).toBe(true);
    // And a collection that cannot be read is a usage error too, not a crash.
    const collection = await pulp(['collection', join(out, 'no-such.pulpcollection'), '--out', join(out, 'collection-out')]);
    expect(collection.code).toBe(2);
    expect(collection.stderr).toContain('Could not read');
  }, 300_000);

  it('a media slot plays a library clip frame-accurately inside the graphic, with its trim, loop, once-through and delay (milestone 22)', async () => {
    // A one-second clip whose every frame says which frame it is: red climbs eight a frame, green
    // holds at 100, kept lossless (PNG in a .mov) so the number reads back exactly off the render.
    const lib = join(out, 'media-slot-library');
    await mkdir(lib, { recursive: true });
    const coded = join(lib, 'coded.mov');
    const built = await runBounded(ffmpeg, ffmpegArgs([
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=30:d=1',
      '-vf', "format=rgb24,geq=r='N*8':g=100:b=0",
      '-c:v', 'png', '-pix_fmt', 'rgb24', coded,
    ]), { timeoutMs: TOOL_TIMEOUT_MS });
    expect(built.code, built.stderr).toBe(0);
    const codedId = itemId(`media:${coded}`);
    const common = ['--library', FIXTURES, '--library', lib];
    const plate = (value: Record<string, unknown>) => ['--param', `plate=${JSON.stringify({ id: codedId, ...value })}`];
    /** The pixel at the center of the slot's box, where the square clip sits, on frame `k` of a render. */
    const centre = (name: string, k: number) => pixels(join(out, `${name}_${String(k).padStart(5, '0')}.png`), 160, 90);
    /** Which clip frame a pixel's red says it is. */
    const clipFrame = (px: number[]) => Math.round(px[0]! / 8);

    // The whole clip, looping: frame k of the graphic shows clip frame k, round again after thirty.
    const whole = await render('pulp.test.media-slot', 'png-sequence', 'slot-loop', { extra: [...common, ...plate({})] });
    expect(whole.code, whole.stderr).toBe(0);
    for (const [k, want] of [[0, 0], [5, 5], [29, 29], [30, 0], [47, 17]] as const) {
      const px = await centre('slot-loop', k);
      expect(px[3], `frame ${k} is drawn`).toBe(255);
      expect(clipFrame(px), `frame ${k} shows clip frame ${want}`).toBe(want);
    }
    // The marker is painted every frame, so a blank slot is told from an absent template.
    expect((await pixels(join(out, 'slot-loop_00000.png'), 2, 2)).slice(0, 3)).toEqual([255, 255, 0]);

    // Trimmed to frames 10-19 and looping: the window plays from its in point and comes round.
    const trimmed = await render('pulp.test.media-slot', 'png-sequence', 'slot-trim', { extra: [...common, ...plate({ inPoint: 10, outPoint: 19 })] });
    expect(trimmed.code, trimmed.stderr).toBe(0);
    for (const [k, want] of [[0, 10], [9, 19], [10, 10], [25, 15]] as const) {
      expect(clipFrame(await centre('slot-trim', k)), `frame ${k} shows clip frame ${want}`).toBe(want);
    }

    // Played once, the same window ends where it ends, and the slot draws nothing after it.
    const once = await render('pulp.test.media-slot', 'png-sequence', 'slot-once', { extra: [...common, ...plate({ inPoint: 10, outPoint: 19, ending: 'once' })] });
    expect(once.code, once.stderr).toBe(0);
    expect(clipFrame(await centre('slot-once', 9))).toBe(19);
    expect((await centre('slot-once', 10))[3], 'transparent once the clip has played out').toBe(0);
    expect((await centre('slot-once', 40))[3]).toBe(0);

    // A start delay holds the clip back half a second: nothing before, its first frame on the dot.
    const delayed = await render('pulp.test.media-slot', 'png-sequence', 'slot-delay', { extra: [...common, ...plate({ delay: 0.5 })] });
    expect(delayed.code, delayed.stderr).toBe(0);
    expect((await centre('slot-delay', 14))[3], 'nothing before the delay').toBe(0);
    const first = await centre('slot-delay', 15);
    expect(first[3]).toBe(255);
    expect(clipFrame(first), 'the first clip frame the moment it starts').toBe(0);
    expect(clipFrame(await centre('slot-delay', 25))).toBe(10);

    // A clip the library cannot answer for stops the render by the slot's name rather than going blank.
    const missing = await render('pulp.test.media-slot', 'png-sequence', 'slot-missing', { extra: [...common, '--param', 'plate={"id":"not-a-real-id"}'] });
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('the clip chosen for "plate"');
  }, 300_000);

  it('All caps on the Newsdesk set is a switch: on by default and the frame is what it always was, off and the words stay as typed', async () => {
    // One frame of the lower third three ways. Said nothing, the switch is on, and that frame is
    // byte for byte the frame the switch says on gives — so saved work renders exactly as before;
    // off, a name typed in lower case draws different letters, and the frame changes.
    const frame = ['--in-point', '90', '--out-point', '90', '--param', 'name=Sam Okafor'];
    const asBefore = await render('pulp.samples.newsdesk.lower-third', 'png-sequence', 'caps-default', { extra: frame });
    expect(asBefore.code, asBefore.stderr).toBe(0);
    const on = await render('pulp.samples.newsdesk.lower-third', 'png-sequence', 'caps-on', { extra: [...frame, '--param', 'allCaps=true'] });
    expect(on.code, on.stderr).toBe(0);
    const off = await render('pulp.samples.newsdesk.lower-third', 'png-sequence', 'caps-off', { extra: [...frame, '--param', 'allCaps=false'] });
    expect(off.code, off.stderr).toBe(0);
    const [byDefault, switchedOn, switchedOff] = await Promise.all([
      readFile(join(out, 'caps-default_00090.png')),
      readFile(join(out, 'caps-on_00090.png')),
      readFile(join(out, 'caps-off_00090.png')),
    ]);
    expect(byDefault.equals(switchedOn), 'nothing said is the switch on').toBe(true);
    expect(byDefault.equals(switchedOff), 'off draws other letters').toBe(false);
  }, 240_000);

  it('renders H.264 without alpha', async () => {
    const result = await render('pulp.samples.title-card', 'h264-mp4', 'title.mp4');
    expect(result.code, result.stderr).toBe(0);
    const info = await probe(join(out, 'title.mp4'));
    expect(info).toMatchObject({ width: 1920, height: 1080, pix_fmt: 'yuv420p', nb_read_frames: '150' });
  }, 120_000);

  it('layers travel to a headless render through --param @layers, and a typo is named rather than ignored', async () => {
    // One line changed and one added, as JSON: the stack patches the template's rather than replacing it.
    const stack = JSON.stringify({ strap: [{ id: 'name', text: 'Ada Lovelace' }, { type: 'text', text: 'Third line' }] });
    const result = await render('pulp.samples.lower-third-bar', 'png-sequence', 'layers', {
      extra: ['--param', `@layers=${stack}`, '--param', 'panel=#ffffffd9', '--in-point', '90', '--out-point', '90'],
    });
    expect(result.code, result.stderr).toBe(0);
    const file = join(out, 'layers_00090.png');
    const info = await probe(file);
    expect(info).toMatchObject({ width: 1920, height: 1080 });
    // Three lines make a taller panel than two: the graphic reaches a row that two lines leave clear.
    expect((await pixels(file, 200, 820))[3], 'the taller panel covers that row').toBeGreaterThan(0);
    const plain = await render('pulp.samples.lower-third-bar', 'png-sequence', 'plain', {
      extra: ['--param', 'panel=#ffffffd9', '--in-point', '90', '--out-point', '90'],
    });
    expect(plain.code, plain.stderr).toBe(0);
    expect((await pixels(join(out, 'plain_00090.png'), 200, 820))[3], 'the template\'s own two lines leave that row clear').toBe(0);

    // A layer the template does not have is an error with the layers it does, and nothing is rendered.
    const typo = await render('pulp.samples.lower-third-bar', 'png-sequence', 'typo', {
      extra: ['--param', '@layers={"strap":[{"id":"nmae","text":"x"}]}'],
    });
    expect(typo.code).toBe(2);
    expect(typo.stderr).toContain('"strap" has no layer "nmae"');
    expect(typo.stderr).toContain('"name"');
    expect(existsSync(join(out, 'typo_00000.png'))).toBe(false);

    // Bad JSON says so, with the parser's own complaint.
    const bad = await render('pulp.samples.lower-third-bar', 'png-sequence', 'bad', { extra: ['--param', '@layers={"strap":'] });
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/layers: not valid JSON/);
  }, 180_000);

  it('image slots: draws the granted still, refuses its neighbor, and grants nothing when nothing is chosen (ADR 0013)', async () => {
    // Two stills in a scratch library: the logo the user picks, and its neighbor the template must not see.
    const logos = join(out, 'logos');
    await mkdir(logos, { recursive: true });
    await runBounded(ffmpeg, ffmpegArgs(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=64x64', '-frames:v', '1', join(logos, 'logo.png')]), { timeoutMs: TOOL_TIMEOUT_MS });
    await runBounded(ffmpeg, ffmpegArgs(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xff0000:s=64x64', '-frames:v', '1', join(logos, 'secret.png')]), { timeoutMs: TOOL_TIMEOUT_MS });
    const logoId = itemId(`media:${join(logos, 'logo.png')}`);
    const secretId = itemId(`media:${join(logos, 'secret.png')}`);
    const libs = ['--library', FIXTURES, '--library', logos];

    // Chosen: the logo fills the slot's box (the middle half of a 320x180 frame), while the neighbor is refused.
    const a = await render('pulp.test.logo-slot', 'png-sequence', 'slot-granted', { extra: [...libs, '--param', `logo=${logoId}`, '--param', `other=${secretId}`] });
    expect(a.code, a.stderr).toBe(0);
    const granted = join(out, 'slot-granted_00000.png');
    // Within a step: the fixture's pure green comes through the image decode a shade under 255.
    const near = (px: number[], want: number[]) => px.every((v, i) => Math.abs(v - want[i]!) <= 2);
    expect(near(await pixels(granted, 160, 90), [0, 255, 0, 255]), 'the logo in its box').toBe(true);
    expect((await pixels(granted, 60, 90))[3]).toBe(0); // outside the box
    expect(await pixels(granted, 8, 8)).toEqual([255, 0, 0, 255]); // the probe for the neighbor: refused

    // Nothing chosen: the slot shows its fallback text, and no image is granted — not even the one above.
    const b = await render('pulp.test.logo-slot', 'png-sequence', 'slot-empty', { extra: [...libs, '--param', `other=${logoId}`] });
    expect(b.code, b.stderr).toBe(0);
    const empty = join(out, 'slot-empty_00000.png');
    expect(await pixels(empty, 8, 8)).toEqual([255, 0, 0, 255]);
    const row = await pixels(empty, 100, 90, 120);
    const blue = Array.from({ length: 120 }, (_, i) => row.slice(i * 4, i * 4 + 4)).filter((px) => px[2] === 255 && px[0] === 0 && px[3]! > 0);
    expect(blue.length).toBeGreaterThan(0);

    // A treatment travels with the choice: flattened to white, the same box is white.
    const c = await render('pulp.test.logo-slot', 'png-sequence', 'slot-white', { extra: [...libs, '--param', `logo={"id":"${logoId}","treatment":"white"}`] });
    expect(c.code, c.stderr).toBe(0);
    expect(near(await pixels(join(out, 'slot-white_00000.png'), 160, 90), [255, 255, 255, 255]), 'the treated logo').toBe(true);

    // Something that is not a still in the library is refused before anything renders.
    const wav = itemId(`media:${join(FIXTURES, 'media', 'silence.wav')}`);
    const d = await render('pulp.test.logo-slot', 'png-sequence', 'slot-bad', { extra: [...libs, '--param', `logo=${wav}`] });
    expect(d.code).toBe(1);
    expect(d.stderr).toContain('The image for "Logo" is not in the library');
    expect((await readdir(out)).filter((f) => f.startsWith('slot-bad_'))).toEqual([]);
  }, 240_000);

  it('refuses pulp-media:// to template pages, even for a valid library id', async () => {
    // The fixtures folder is a library root for this run, so its media/silence.wav has an id the
    // template could only have been told; the template tries fetch and <audio> and paints green on success.
    const id = itemId(`media:${join(FIXTURES, 'media', 'silence.wav')}`);
    const result = await render('pulp.test.media-leak', 'png-sequence', 'leak', {
      extra: ['--library', FIXTURES, '--param', `url=${mediaUrlFor(id)}`],
    });
    expect(result.code, result.stderr).toBe(0);
    const frames = (await readdir(out)).filter((f) => f.startsWith('leak_'));
    expect(frames).toHaveLength(1);
    expect(await pixels(join(out, frames[0]!), 160, 90)).toEqual([255, 0, 0, 255]);
  }, 120_000);

  it('reports a template error with frame and location, and leaves no output', async () => {
    const result = await render('pulp.test.throws', 'prores-4444', 'throws.mov', { extra: ['--library', FIXTURES] });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Template "Test Throws" threw an error on frame 5: RangeError: frame 5 is out of range (index.html:8:');
    expect(existsSync(join(out, 'throws.mov'))).toBe(false);
  }, 120_000);

  it('stops a hung template at the frame timeout, and leaves no output', async () => {
    const started = Date.now();
    const result = await render('pulp.test.hangs', 'png-sequence', 'hangs', { extra: ['--library', FIXTURES, '--frame-timeout', '1'] });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Template "Test Hangs" did not finish frame 3 within 1 s.');
    expect(Date.now() - started).toBeLessThan(30_000);
    expect((await readdir(out)).filter((f) => basename(f).startsWith('hangs_'))).toEqual([]);
  }, 120_000);

  /**
   * Lottie animations (milestone 35): a `.json` and a `.lottie` written by the test are indexed
   * as templates and rendered through the same path, stepped frame by frame by the player. The
   * fixture's square crosses the frame on linear keyframes, so where it is on a given frame is
   * known exactly; its text and colors are the parameters the file exposes.
   */
  it('renders a layer pinned to a motion track over the target it follows (milestone 76)', async () => {
    // A clip whose red square crosses a green picture at 4 px a frame, and a track made from the
    // expression that drew it — the same track the UI suite's tracker recovers from the frames.
    // The shape's keys are baked from it as a pin bakes them, and the render draws the shape over
    // the square on every frame checked: the keys are what the preview shows too, so the two agree.
    const lib = join(out, 'track-library');
    await mkdir(lib, { recursive: true });
    const clip = join(lib, 'mover.mp4');
    const built = await runBounded(ffmpeg, ffmpegArgs([
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=green:s=160x90:d=1:r=30',
      '-f', 'lavfi', '-i', 'color=c=red:s=24x24:d=1:r=30',
      '-filter_complex', "[0][1]overlay=x='floor(t*40)':y=32", '-c:v', 'mpeg4', '-qscale:v', '2', clip,
    ]), { timeoutMs: TOOL_TIMEOUT_MS });
    expect(built.code, built.stderr).toBe(0);
    const clipId = itemId(`media:${clip}`);
    const truth = (t: number) => (Math.floor(t * 40 + 1e-6) + 12) / 160;
    const track: MotionTrack = {
      id: 'track_1', clip: clipId, kind: 'point', size: { w: 0.05, h: 0.0889 }, from: 0, to: 1, fps: 30,
      samples: Array.from({ length: 30 }, (_, i) => ({ at: Math.round((i / 30) * 1000) / 1000, x: truth(i / 30), y: 44 / 90, c: 1 })),
    };
    // The fixture's frame is 320 × 180 and the clip 160 × 90: its picture fills the frame at twice
    // the size. The shape starts at the stack's center and is moved onto the square's first place.
    const frame = { width: 320, height: 180 };
    const keys = pinKeys({ track, cut: { from: 0, to: 1 }, cutStart: 0, frame, clip: { width: 160, height: 90 }, at: 0, pose: { ...IDENTITY_KEY, dx: (truth(0) * 320 - 160) / 320, dy: (88 - 90) / 180 } });
    expect(keys.length).toBeGreaterThanOrEqual(2);
    const layers = ['--param', `@layers=${JSON.stringify({ stack: [{ id: 'plate', hidden: true }, { id: 'dot', type: 'shape', shape: 'ellipse', color: '#0000ff', size: 0.2, ratio: 1, keys, pin: { track: 'track_1' } }] })}`];
    const project = ['--param', `@track=${JSON.stringify({ cuts: [{ id: clipId, from: 0, to: 1 }] })}`, '--param', `@tracks=${JSON.stringify([track])}`];
    const result = await render('pulp.test.video-layer', 'png-sequence', 'pinned', { extra: ['--library', FIXTURES, '--library', lib, '--out-point', '29', ...project, ...layers] });
    expect(result.code, result.stderr).toBe(0);
    for (const i of [0, 15, 29]) {
      const t = i / 30;
      const x = Math.round(truth(t) * 320);
      const file = join(out, `pinned_${String(i).padStart(5, '0')}.png`);
      // The blue shape sits on the square's center, and the green picture is beside it.
      expect(await pixels(file, x, 88), `frame ${i}: the shape over the square`).toEqual([0, 0, 255, 255]);
      const beside = await pixels(file, Math.min(319, x + 60), 20);
      expect(beside[1], `frame ${i}: the picture beside it`).toBeGreaterThan(100);
      expect(beside[2]).toBeLessThan(80);
    }
    // And a frame the shape has left: where it was on frame 0 is red or green by frame 29, not blue.
    expect((await pixels(join(out, 'pinned_00029.png'), Math.round(truth(0) * 320), 88))[2]).toBeLessThan(80);
  }, 240_000);

  describe('Lottie animations', () => {
    let lib = '';
    let jsonId = '';
    let dotId = '';
    const frameFiles = async (prefix: string) => (await readdir(out)).filter((f) => f.startsWith(`${prefix}_`)).sort().map((f) => join(out, f));
    const alphaAt = async (file: string, x: number, y: number) => (await pixels(file, x, y))[3];
    /** Whether any pixel of a row is drawn with more than half alpha. */
    const rowDrawn = async (file: string, x: number, y: number, count: number) => {
      const row = await pixels(file, x, y, count);
      return row.some((_, i) => i % 4 === 3 && row[i]! > 128);
    };

    beforeAll(async () => {
      lib = await mkdtemp(join(tmpdir(), 'pulp-lottie-e2e-'));
      await mkdir(join(lib, 'Lower thirds'), { recursive: true });
      const jsonPath = join(lib, 'Lower thirds', 'box.json');
      await writeFile(jsonPath, JSON.stringify(lottieFixture({ fps: 10, frames: 10 })));
      const dotPath = join(lib, 'box.lottie');
      await writeFile(dotPath, dotLottieFixture({ box: lottieFixture({ fps: 10, frames: 10, fill: [0, 1, 0] }) }));
      jsonId = lottieManifestId(itemId(`lottie:${jsonPath}`));
      dotId = lottieManifestId(itemId(`lottie:${dotPath}`));
    });

    afterAll(async () => {
      if (lib) await rm(lib, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    });

    it('renders a .json frame-accurately with alpha: the square is where its keyframes put it on every frame', async () => {
      const result = await render(jsonId, 'png-sequence', 'lottie-json', { extra: ['--library', lib] });
      expect(result.code, result.stderr).toBe(0);
      const frames = await frameFiles('lottie-json');
      expect(frames).toHaveLength(10);
      const [first] = frames;
      const sixth = frames[5]!;
      expect(await probe(first!)).toMatchObject({ width: 1920, height: 1080, pix_fmt: 'rgba' });
      // Frame 0: the 200 px square is centered at x = 100; frame 5, halfway along 100 → 900, at x = 500.
      expect(await pixels(first!, 100, 540)).toEqual([255, 0, 0, 255]);
      expect(await alphaAt(first!, 500, 540)).toBe(0);
      expect(await pixels(sixth, 500, 540)).toEqual([255, 0, 0, 255]);
      expect(await alphaAt(sixth, 390, 540)).toBe(0);
      expect(await pixels(sixth, 410, 540)).toEqual([255, 0, 0, 255]);
      expect(await alphaAt(sixth, 610, 540)).toBe(0);
      // The solid in the corner, and the text drawn along its row; everything else transparent.
      expect(await pixels(first!, 100, 1060)).toEqual([0, 0, 255, 255]);
      expect(await rowDrawn(first!, 200, 160, 400)).toBe(true);
      const [min, max] = await alphaRange(first!, 0);
      expect([min, max]).toEqual([0, 255]);
    }, 180_000);

    it('takes its text and colors as parameters', async () => {
      const result = await render(jsonId, 'png-sequence', 'lottie-edit', {
        extra: ['--library', lib, '--out-point', '0', '--param', 'text1=', '--param', 'color2=#00ff00', '--param', 'color3=#ffff00'],
      });
      expect(result.code, result.stderr).toBe(0);
      const [first] = await frameFiles('lottie-edit');
      expect(await pixels(first!, 100, 540)).toEqual([0, 255, 0, 255]);
      expect(await pixels(first!, 100, 1060)).toEqual([255, 255, 0, 255]);
      expect(await rowDrawn(first!, 200, 160, 400)).toBe(false);
    }, 180_000);

    it('stretches to a new length where its markers say it may, and keeps its own where they do not', async () => {
      // The fixture's markers name an intro, a loop and an end, so the loop between them holds:
      // milestone 30's structure, read from the file (milestone 35). Asked for twice its own
      // length, it renders twice the frames, and the entrance still plays at its designed speed.
      const stretched = await render(jsonId, 'png-sequence', 'lottie-long', { extra: ['--library', lib, '--length', '2'] });
      expect(stretched.code, stretched.stderr).toBe(0);
      const frames = await frameFiles('lottie-long');
      expect(frames, 'twice the length is twice the frames').toHaveLength(20);

      // The square crosses the frame from x = 100 to x = 900 over the animation's own second.
      // The entrance runs to 0.2 s as designed, so frame 2 is where it always was; the hold
      // between 0.2 s and 0.7 s is stretched over the middle, so at frame 10 — one second in —
      // the square is only about a third of the way across rather than at the far side.
      const centreX = async (file: string) => {
        const row = await pixels(file, 0, 540, 1920);
        let first = -1;
        let last = -1;
        for (let x = 0; x < 1920; x++) {
          if (row[x * 4 + 3]! > 128) {
            if (first < 0) first = x;
            last = x;
          }
        }
        return first < 0 ? null : (first + last) / 2;
      };
      expect(await centreX(frames[2]!), 'the entrance plays as designed').toBeCloseTo(260, -2);
      const middle = await centreX(frames[10]!);
      expect(middle, 'the hold is stretched, not played through').toBeGreaterThan(380);
      expect(middle, 'and nowhere near the end it would have reached unstretched').toBeLessThan(640);

      // The same animation with its markers taken out has nothing to stretch, so asking for a
      // length is refused in the same words a template without a structure is refused in — not
      // quietly ignored — and it renders at its own length.
      const plainPath = join(lib, 'no-markers.json');
      await writeFile(plainPath, JSON.stringify({ ...lottieFixture({ fps: 10, frames: 10 }), markers: [] }));
      const plainId = lottieManifestId(itemId(`lottie:${plainPath}`));
      const asked = await render(plainId, 'png-sequence', 'lottie-fixed', { extra: ['--library', lib, '--length', '2'] });
      expect(asked.code).toBe(1);
      expect(asked.stderr).toContain('its length is fixed');
      const own = await render(plainId, 'png-sequence', 'lottie-own', { extra: ['--library', lib] });
      expect(own.code, own.stderr).toBe(0);
      expect(await frameFiles('lottie-own'), 'no markers, its own length').toHaveLength(10);
    }, 180_000);

    it('is placed on a template as a layer, timed and looped like any clip', async () => {
      // A Lottie is a template read from one file, so it is not media — but it plays, so a layer
      // takes it exactly as it takes a clip (milestone 35): the id in a video layer's `clip`.
      const lottieItemId = itemId(`lottie:${join(lib, 'Lower thirds', 'box.json')}`);
      const stack = JSON.stringify({
        strap: [{ id: 'name', text: 'Ada Lovelace' }, { type: 'video', size: 0.3, clip: { id: lottieItemId, ending: 'loop' } }],
      });
      const result = await render('pulp.samples.lower-third-bar', 'png-sequence', 'lottie-layer', {
        extra: ['--library', lib, '--param', `@layers=${stack}`, '--param', 'panel=#ffffffd9', '--in-point', '90', '--out-point', '90'],
      });
      expect(result.code, result.stderr).toBe(0);
      const file = join(out, 'lottie-layer_00090.png');
      expect(await probe(file)).toMatchObject({ width: 1920, height: 1080 });

      // The animation's own red square is drawn into the graphic: a row the template alone leaves
      // clear now holds the layer, and the layer is the Lottie's color rather than the panel's.
      const row = await pixels(file, 0, 820, 1920);
      let found: number[] | null = null;
      for (let x = 0; x < 1920; x++) {
        const [r, g, b, a] = [row[x * 4]!, row[x * 4 + 1]!, row[x * 4 + 2]!, row[x * 4 + 3]!];
        if (a > 200 && r > 150 && g < 90 && b < 90) {
          found = [r, g, b, a];
          break;
        }
      }
      expect(found, 'the animation drawn as a layer on the lower third').not.toBeNull();

      // And a layer naming something that is not in the library is refused before anything is
      // written, as a missing clip is.
      const gone = await render('pulp.samples.lower-third-bar', 'png-sequence', 'lottie-gone', {
        extra: ['--library', lib, '--param', '@layers={"strap":[{"type":"video","clip":{"id":"0123456789abcdef01234567"}}]}'],
      });
      expect(gone.code).toBe(1);
      expect(gone.stderr).toMatch(/clip chosen for a layer/);
      expect(existsSync(join(out, 'lottie-gone_00000.png'))).toBe(false);
    }, 180_000);

    it('draws a clip layer cropped and bordered, in the render as in the preview (milestone 57)', async () => {
      // The same Lottie as a layer, once whole and once cropped to its middle half with a green
      // border: the border's color appears on the row through the layer, and the cropped
      // picture's red run is narrower than the whole one's.
      const lottieItemId = itemId(`lottie:${join(lib, 'Lower thirds', 'box.json')}`);
      const stack = (framing: object) => JSON.stringify({
        strap: [{ id: 'name', text: 'Ada Lovelace' }, { type: 'video', size: 0.3, clip: { id: lottieItemId, ending: 'loop', ...framing } }],
      });
      const redRun = async (file: string): Promise<{ red: number; green: number }> => {
        const row = await pixels(file, 0, 820, 1920);
        let red = 0;
        let green = 0;
        for (let x = 0; x < 1920; x++) {
          const [r, g, b, a] = [row[x * 4]!, row[x * 4 + 1]!, row[x * 4 + 2]!, row[x * 4 + 3]!];
          if (a > 200 && r > 150 && g < 90 && b < 90) red += 1;
          if (a > 200 && g > 150 && r < 90 && b < 90) green += 1;
        }
        return { red, green };
      };
      const whole = await render('pulp.samples.lower-third-bar', 'png-sequence', 'pip-whole', {
        extra: ['--library', lib, '--param', `@layers=${stack({})}`, '--param', 'panel=#ffffffd9', '--in-point', '90', '--out-point', '90'],
      });
      expect(whole.code, whole.stderr).toBe(0);
      const framed = await render('pulp.samples.lower-third-bar', 'png-sequence', 'pip-framed', {
        extra: ['--library', lib, '--param', `@layers=${stack({ crop: { left: 0.25, top: 0, right: 0.25, bottom: 0 }, border: { width: 0.01, color: '#00ff00' } })}`, '--param', 'panel=#ffffffd9', '--in-point', '90', '--out-point', '90'],
      });
      expect(framed.code, framed.stderr).toBe(0);
      const plain = await redRun(join(out, 'pip-whole_00090.png'));
      const cropped = await redRun(join(out, 'pip-framed_00090.png'));
      expect(plain.red, 'the whole animation drawn').toBeGreaterThan(20);
      expect(plain.green, 'and no border on it').toBe(0);
      expect(cropped.green, 'the border\'s color where the picture\'s edge is').toBeGreaterThan(0);
      expect(cropped.red, 'the cropped picture narrower than the whole').toBeLessThan(plain.red * 0.8);
    }, 180_000);

    it('renders a .lottie archive fitted into another aspect', async () => {
      const result = await render(dotId, 'png-sequence', 'lottie-dot', { extra: ['--library', lib, '--aspect', '1:1', '--out-point', '0'] });
      expect(result.code, result.stderr).toBe(0);
      const [first] = await frameFiles('lottie-dot');
      expect(await probe(first!)).toMatchObject({ width: 1080, height: 1080 });
      // A 16:9 animation fitted into a square scales by 1080 / 1920 and sits in the middle: the square's
      // center lands at (56, 540), and the letterbox above it is transparent.
      expect(await pixels(first!, 56, 540)).toEqual([0, 255, 0, 255]);
      expect(await alphaAt(first!, 540, 100)).toBe(0);
    }, 180_000);

    it('applies a dotLottie theme as a parameter, a changed color still winning over it (milestone 35)', async () => {
      // A slotted square: the theme turns its red fill blue through the slot; color parameters at
      // their defaults are left to the theme, and one the render changes wins over it.
      const path = join(lib, 'themed.lottie');
      await writeFile(path, dotLottieFixture(
        { badge: lottieFixture({ fps: 10, frames: 10, withSlots: true }) },
        {},
        {},
        { midnight: { rules: [{ id: 'accent', type: 'Color', value: [0, 0, 1] }] } },
      ));
      const id = lottieManifestId(itemId(`lottie:${path}`));
      const themed = await render(id, 'png-sequence', 'lottie-theme', { extra: ['--library', lib, '--out-point', '0', '--param', 'theme=midnight'] });
      expect(themed.code, themed.stderr).toBe(0);
      expect(await pixels((await frameFiles('lottie-theme'))[0]!, 100, 540)).toEqual([0, 0, 255, 255]);
      const edited = await render(id, 'png-sequence', 'lottie-theme-edit', { extra: ['--library', lib, '--out-point', '0', '--param', 'theme=midnight', '--param', 'color1=#00ff00'] });
      expect(edited.code, edited.stderr).toBe(0);
      expect(await pixels((await frameFiles('lottie-theme-edit'))[0]!, 100, 540)).toEqual([0, 255, 0, 255]);
    }, 180_000);

    it('renders each animation of a multi-animation archive as an item of its own (milestone 35)', async () => {
      const path = join(lib, 'pair.lottie');
      await writeFile(path, dotLottieFixture({
        red: lottieFixture({ fps: 10, frames: 10 }),
        green: lottieFixture({ fps: 10, frames: 10, fill: [0, 1, 0] }),
      }));
      // The first animation keeps the file's own id; the second is keyed by the file plus its name.
      const second = lottieManifestId(itemId(`lottie:${path}#green`));
      const result = await render(second, 'png-sequence', 'lottie-second', { extra: ['--library', lib, '--out-point', '0'] });
      expect(result.code, result.stderr).toBe(0);
      expect(await pixels((await frameFiles('lottie-second'))[0]!, 100, 540)).toEqual([0, 255, 0, 255]);
      const first = await render(lottieManifestId(itemId(`lottie:${path}`)), 'png-sequence', 'lottie-first', { extra: ['--library', lib, '--out-point', '0'] });
      expect(first.code, first.stderr).toBe(0);
      expect(await pixels((await frameFiles('lottie-first'))[0]!, 100, 540)).toEqual([255, 0, 0, 255]);
    }, 240_000);

    it('draws text in the family a font parameter picks (milestone 35)', async () => {
      // The fixture asks for Arial and does not carry it. Set in two bundled families of very
      // different letterforms — a monospace and a handwritten script — the headline's ink must
      // take different shapes, and each must differ from the fallback the bare file falls to:
      // proof the picked family is what draws, whatever this machine has installed. Shapes, not
      // widths: two faces at one size can span the same width and still share no letterform.
      const headline = async (file: string) => {
        const { stdout } = await runBoundedBuffer(ffmpeg, ffmpegArgs(['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), { timeoutMs: TOOL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
        // The headline's region only: y 60..300 at 120 px size; the square and solid sit lower.
        const bits: boolean[] = [];
        for (let y = 60; y < 300; y++) for (let x = 100; x < 800; x++) bits.push(stdout[(y * 1920 + x) * 4 + 3]! > 128);
        return bits;
      };
      const ink = (bits: boolean[]) => bits.filter(Boolean).length;
      const differs = (a: boolean[], b: boolean[]) => a.filter((bit, i) => bit !== b[i]).length;
      for (const [name, param] of [['lottie-font-plain', []], ['lottie-font-mono', ['--param', 'font1=JetBrains Mono']], ['lottie-font-script', ['--param', 'font1=Caveat']]] as const) {
        const run = await render(jsonId, 'png-sequence', name, { extra: ['--library', lib, '--out-point', '0', ...param] });
        expect(run.code, run.stderr).toBe(0);
      }
      const plain = await headline((await frameFiles('lottie-font-plain'))[0]!);
      const mono = await headline((await frameFiles('lottie-font-mono'))[0]!);
      const script = await headline((await frameFiles('lottie-font-script'))[0]!);
      expect(ink(plain), 'the headline is drawn').toBeGreaterThan(2000);
      expect(ink(mono)).toBeGreaterThan(2000);
      expect(ink(script)).toBeGreaterThan(2000);
      // Each face shapes at least a third of some other's ink differently.
      const floor = Math.min(ink(plain), ink(mono), ink(script)) / 3;
      expect(differs(mono, script), 'mono and script are different faces').toBeGreaterThan(floor);
      expect(differs(plain, mono), 'mono is not the fallback').toBeGreaterThan(floor);
      expect(differs(plain, script), 'script is not the fallback').toBeGreaterThan(floor);
    }, 240_000);

    it('saves as an editable template folder that renders on its own (milestone 35)', async () => {
      // The builder is pure, so the test writes the folder the way the save dialog's path does:
      // the manifest, the generated page, and the player beside it — then renders it as a
      // template, with no Lottie file behind it.
      const doc = parseLottie(JSON.stringify(lottieFixture({ fps: 10, frames: 10 })));
      const editables = lottieEditables(doc.data);
      const made = lottieManifest(doc, { id: itemId('lottie:/x/box.json'), name: 'Box', format: 'json', editables, limits: [] });
      expect(made.ok).toBe(true);
      if (!made.ok) return;
      const files = lottieTemplateFiles({
        name: 'Saved Box',
        manifest: made.manifest,
        info: lottieInfo(doc, '/x/box.json', 'json', editables.bindings, []),
        data: prepareLottieData(doc.data),
      });
      const folder = join(lib, 'Saved box template');
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'template.json'), files.manifest);
      await writeFile(join(folder, 'index.html'), files.page);
      await copyFile(join(ROOT, 'node_modules', 'lottie-web', 'build', 'player', 'lottie_light.min.js'), join(folder, LOTTIE_TEMPLATE_PLAYER));
      const result = await render(files.templateId, 'png-sequence', 'lottie-saved', { extra: ['--library', lib, '--out-point', '0', '--param', 'color2=#00ffff'] });
      expect(result.code, result.stderr).toBe(0);
      const [first] = await frameFiles('lottie-saved');
      // The same square, drawn by the saved folder, its parameters still live.
      expect(await pixels(first!, 100, 540)).toEqual([0, 255, 255, 255]);
      expect(await alphaAt(first!, 500, 540)).toBe(0);
    }, 240_000);
  });
});
