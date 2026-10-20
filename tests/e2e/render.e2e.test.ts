/**
 * End-to-end render test: builds the app, renders bundled samples through the
 * headless `--render` mode and checks the files with ffprobe.
 *
 * Runs only when the Electron binary, ffmpeg and ffprobe are available (and a
 * display on Linux); otherwise the suite is skipped with the reason printed.
 * Set PULP_E2E=0 to skip it explicitly.
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

async function findTools(): Promise<{ electron: string; ffmpeg: string; ffprobe: string } | string> {
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
  return { electron, ffmpeg: ffmpeg.path, ffprobe };
}

const tools = await findTools();
if (typeof tools === 'string') console.info(`Skipping end-to-end render tests: ${tools}.`);
const available = typeof tools === 'string' ? null : tools;

interface StreamInfo {
  width: number;
  height: number;
  pix_fmt: string;
  nb_read_frames: string;
  tags?: Record<string, string>;
}

describe.skipIf(!available)('end-to-end render', () => {
  const { electron, ffmpeg, ffprobe } = available ?? { electron: '', ffmpeg: '', ffprobe: '' };
  let out = '';

  beforeAll(async () => {
    // Render the current sources, not a stale build.
    await run(process.execPath, [join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build'], { cwd: ROOT });
    out = await mkdtemp(join(tmpdir(), 'pulp-e2e-'));
  }, 120_000);

  afterAll(async () => {
    if (out) await rm(out, { recursive: true, force: true });
  });

  async function render(templateId: string, preset: string, file: string, ...extra: string[]) {
    const args = ['.', '--render', templateId, '--preset', preset, '--out', join(out, file), ...extra];
    try {
      const { stdout, stderr } = await run(electron, args, { cwd: ROOT, timeout: 90_000 });
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
      '-show_entries', 'stream=width,height,pix_fmt,nb_read_frames:stream_tags',
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
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
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
    const result = await render('pulp.test.throws', 'prores-4444', 'throws.mov', '--library', FIXTURES);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Template "Test Throws" threw an error on frame 5: RangeError: frame 5 is out of range (index.html:8:');
    expect(existsSync(join(out, 'throws.mov'))).toBe(false);
  }, 120_000);

  it('stops a hung template at the frame timeout, and leaves no output', async () => {
    const started = Date.now();
    const result = await render('pulp.test.hangs', 'png-sequence', 'hangs', '--library', FIXTURES, '--frame-timeout', '1');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Template "Test Hangs" did not finish frame 3 within 1 s.');
    expect(Date.now() - started).toBeLessThan(30_000);
    expect((await readdir(out)).filter((f) => basename(f).startsWith('hangs_'))).toEqual([]);
  }, 120_000);
});
