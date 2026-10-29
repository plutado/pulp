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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFfmpeg, nodeRunner } from '../../src/core/ffmpeg';
import { probeMedia } from '../../src/core/media-probe';
import { SEQUENCE_FPS, sequenceMetadata, sequencePatternName } from '../../src/core/media-sequence';
import { sequenceStripArgs } from '../../src/core/hover-scrub';
import { itemId } from '../../src/core/library-scan';
import { mediaUrlFor } from '../../src/core/media-url';
import { scanLibrary } from '../../src/core/library';
import { SAMPLE_MEDIA, sampleMediaPath } from '../../src/core/sample-media';
import { ffmpegArgs, runBounded, runBoundedBuffer } from './process';

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

  it('makes the whole sample-media folder, and every file lands with the type its folder means', async () => {
    const folder = join(out, 'Sample media');
    const makeAll = async () => {
      // 481 files, 55 of them transparent clips captured frame by frame: about three minutes on a
      // Mac, two and a half times that on a CI runner, so the bound sits well above both.
      const r = await runBounded(electron, ['.', '--sample-media', folder], { cwd: ROOT, timeoutMs: 840_000 });
      return { code: r.code ?? -1, stdout: r.stdout, stderr: r.stderr };
    };
    const result = await makeAll();
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\d+ written, 0 already there, 0 failed/);
    // Every catalogue file exists, and the library gives it the type the catalogue meant.
    const index = await scanLibrary([folder]);
    expect(index.problems).toEqual([]);
    const byPath = new Map(index.media.map((m) => [m.path, m]));
    for (const item of SAMPLE_MEDIA) {
      const path = join(folder, ...sampleMediaPath(item));
      expect(existsSync(path), path).toBe(true);
      expect(byPath.get(path)?.type, path).toBe(item.type);
    }
    expect(existsSync(join(folder, 'LICENSE-CC0.txt'))).toBe(true);
    // One of each kind through ffprobe: a clip at the catalogue size, a stereo mix, a still with alpha.
    const clip = await probe(join(folder, 'Video clips', 'Stock footage', 'boardroom-loop.mp4'));
    expect(clip).toMatchObject({ codec_name: 'h264', width: 1280, height: 720 });
    const { stdout: mix } = await runBounded(available!.ffprobe, ['-v', 'error', '-show_entries', 'stream=channels,sample_rate:format=duration', '-of', 'json', join(folder, 'Music', 'Full mix', 'night-drive.wav')], { timeoutMs: TOOL_TIMEOUT_MS });
    const mixInfo = JSON.parse(mix) as { streams: { channels: number; sample_rate: string }[]; format: { duration: string } };
    expect(mixInfo.streams[0]).toMatchObject({ channels: 2, sample_rate: '48000' });
    expect(Number(mixInfo.format.duration)).toBeCloseTo(16, 0);
    expect(await probe(join(folder, 'Stills', 'Layered graphics', 'badge.png'))).toMatchObject({ width: 1080, height: 1080, pix_fmt: 'rgba' });
    // The centre of the badge is opaque red, the corner transparent: the page drew, and alpha survived.
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
    expect((await pixels(objectStill, 256, 256))[3], 'an object is opaque at its centre').toBe(255);
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
    expect(result.stderr).toContain('skipped Some clip: only templates render today');

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

  it('image slots: draws the granted still, refuses its neighbour, and grants nothing when nothing is chosen (ADR 0013)', async () => {
    // Two stills in a scratch library: the logo the user picks, and its neighbour the template must not see.
    const logos = join(out, 'logos');
    await mkdir(logos, { recursive: true });
    await runBounded(ffmpeg, ffmpegArgs(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=64x64', '-frames:v', '1', join(logos, 'logo.png')]), { timeoutMs: TOOL_TIMEOUT_MS });
    await runBounded(ffmpeg, ffmpegArgs(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xff0000:s=64x64', '-frames:v', '1', join(logos, 'secret.png')]), { timeoutMs: TOOL_TIMEOUT_MS });
    const logoId = itemId(`media:${join(logos, 'logo.png')}`);
    const secretId = itemId(`media:${join(logos, 'secret.png')}`);
    const libs = ['--library', FIXTURES, '--library', logos];

    // Chosen: the logo fills the slot's box (the middle half of a 320x180 frame), while the neighbour is refused.
    const a = await render('pulp.test.logo-slot', 'png-sequence', 'slot-granted', { extra: [...libs, '--param', `logo=${logoId}`, '--param', `other=${secretId}`] });
    expect(a.code, a.stderr).toBe(0);
    const granted = join(out, 'slot-granted_00000.png');
    // Within a step: the fixture's pure green comes through the image decode a shade under 255.
    const near = (px: number[], want: number[]) => px.every((v, i) => Math.abs(v - want[i]!) <= 2);
    expect(near(await pixels(granted, 160, 90), [0, 255, 0, 255]), 'the logo in its box').toBe(true);
    expect((await pixels(granted, 60, 90))[3]).toBe(0); // outside the box
    expect(await pixels(granted, 8, 8)).toEqual([255, 0, 0, 255]); // the probe for the neighbour: refused

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
});
