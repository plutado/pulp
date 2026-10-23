/**
 * End-to-end render test: builds the app, renders bundled samples through the
 * headless `--render` mode and checks the files with ffprobe.
 *
 * Runs only when the Electron binary, ffmpeg and ffprobe are available (and a
 * display on Linux); otherwise the suite is skipped with the reason printed.
 * Set PULP_E2E=0 to skip it explicitly, or PULP_E2E=1 to fail instead of
 * skipping when something is missing (used in CI).
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFfmpeg } from '../../src/core/ffmpeg';

const run = promisify(execFile);
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
    await run(ffprobe, ['-version']);
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
    await run(process.execPath, [join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build'], { cwd: ROOT });
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
    try {
      const { stdout, stderr } = await run(electron, args, {
        cwd: ROOT,
        timeout: opts.timeoutMs ?? 90_000,
        env: { ...process.env, ...opts.env },
      });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  }

  async function probe(file: string): Promise<StreamInfo> {
    const { stdout } = await run(ffprobe, [
      '-v', 'error',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,codec_tag_string,width,height,pix_fmt,nb_read_frames,r_frame_rate,color_range,color_space,color_transfer,color_primaries:stream_tags',
      '-of', 'json',
      file,
    ]);
    return (JSON.parse(stdout) as { streams: StreamInfo[] }).streams[0]!;
  }

  /** Lowest and highest alpha value in one decoded frame. */
  async function alphaRange(file: string, frame: number, decoder?: string): Promise<[number, number]> {
    const { stdout } = await run(
      ffmpeg,
      [
        '-v', 'error',
        ...(decoder ? ['-c:v', decoder] : []),
        '-i', file,
        '-vf', `select=eq(n\\,${frame})`,
        '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
      ],
      // One raw RGBA frame; 8K needs 7680 * 4320 * 4 = ~127 MiB.
      { encoding: 'buffer', maxBuffer: 192 * 1024 * 1024 },
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
    const { stdout } = await run(
      ffmpeg,
      ['-v', 'error', '-i', file, '-vf', `format=rgba,crop=${count}:1:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
      { encoding: 'buffer' },
    );
    expect(stdout.length).toBe(count * 4);
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

  it('renders QuickTime Animation losslessly with alpha', async () => {
    const result = await render('pulp.test.size-portrait', 'qt-animation', 'anim.mov', { extra: ['--library', FIXTURES] });
    expect(result.code, result.stderr).toBe(0);
    const file = join(out, 'anim.mov');
    expect(await probe(file)).toMatchObject({ codec_name: 'qtrle', pix_fmt: 'argb', width: 1080, height: 1920, nb_read_frames: '3' });
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
