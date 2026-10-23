/**
 * Headless renderer: steps a template frame by frame in an offscreen
 * BrowserWindow, captures each frame and pipes it into ffmpeg as raw pixels
 * (or as PNG with frameFormat 'png', kept for comparison). The raw bitmap's
 * byte order and premultiplication are measured once per process with a
 * probe page (core/capture-format.ts); if the result fits no known layout,
 * the render falls back to PNG frames and says so in its warnings.
 *
 * Status: first working version. Verified on macOS (Retina display) with the
 * bundled samples for all presets (1920x1080, alpha preserved in ProRes 4444,
 * PNG and VP9) and with pixel-exact size fixtures at 4K, 8K and portrait
 * 1080x1920. The offscreen window renders at device scale 1 on purpose, so
 * captures are exactly the template's size; any other size fails the render.
 * Not yet verified: Windows/Linux (including Windows at 150% scaling), color
 * management, and long renders. See milestone 1 in ROADMAP.md.
 */

import { BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { checkPresetSupport, detectFfmpeg } from '../core/ffmpeg';
import { CAPTURE_PROBE_SIZE, CAPTURE_PROBE_URL, classifyCapture, describeCaptureFormat, describeProbePixels, type CaptureFormat } from '../core/capture-format';
import { buildRenderPlan, type FrameFormat, type RenderOptions } from '../core/render-plan';
import { resolveParams } from '../core/params';
import {
  captureBytesMessage,
  captureSizeMessage,
  DEFAULT_FRAME_TIMEOUT_MS,
  DEFAULT_LOAD_TIMEOUT_MS,
  frameCallScript,
  frameTimeoutMessage,
  loadTimeoutMessage,
  partialOutputFiles,
  RenderTimeoutError,
  templateThrewMessage,
  withTimeout,
  type TemplateErrorDetail,
} from '../core/render-guard';
import { frameState } from '../core/runtime';
import type { TemplateEntry } from '../core/library';
import type { RenderProgress, RenderResult } from '../shared/api';
import { templateUrlFor } from '../shared/api';

export interface RenderJob {
  template: TemplateEntry;
  params: Record<string, unknown>;
  presetId: string;
  outputPath: string;
  /** Frame rate override, background for flattening, start/end trim. */
  options?: RenderOptions;
  overwrite?: boolean;
  signal?: AbortSignal;
  /** Time allowed per frame before the template is treated as hung. */
  frameTimeoutMs?: number;
  /** Time allowed for the template page to load. */
  loadTimeoutMs?: number;
  /** How frames travel to ffmpeg. Default raw BGRA; 'png' is the slower reference path. */
  frameFormat?: FrameFormat;
  onProgress?: (progress: RenderProgress) => void;
}

/**
 * Device scale factor of the offscreen window. Always 1; PULP_OFFSCREEN_SCALE
 * exists only so tests can simulate a HiDPI surface and check that such a
 * render is refused rather than resized.
 */
function offscreenDeviceScaleFactor(): number {
  const override = Number(process.env.PULP_OFFSCREEN_SCALE);
  return Number.isFinite(override) && override > 0 ? override : 1;
}

/** Result of the capture probe: the bitmap layout, or why it could not be classified. */
type CaptureProbe = { format: CaptureFormat } | { format: null; reason: string };

let captureProbe: Promise<CaptureProbe> | null = null;

/**
 * Measure what capturePage().toBitmap() returns on this platform, once per
 * process: draw known pixels in a tiny offscreen window and classify the bytes.
 */
function detectCaptureFormat(): Promise<CaptureProbe> {
  captureProbe ??= (async () => {
    const win = new BrowserWindow({
      show: false,
      width: CAPTURE_PROBE_SIZE,
      height: CAPTURE_PROBE_SIZE,
      useContentSize: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: { deviceScaleFactor: 1 }, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    try {
      win.setContentSize(CAPTURE_PROBE_SIZE, CAPTURE_PROBE_SIZE);
      await withTimeout(win.loadURL(CAPTURE_PROBE_URL), 10_000, 'capture probe did not load within 10 s');
      // Two animation frames so the drawn canvas is composited before capture.
      await win.webContents.executeJavaScript('new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); })');
      const image = await win.webContents.capturePage();
      const size = image.getSize();
      if (size.width !== CAPTURE_PROBE_SIZE || size.height !== CAPTURE_PROBE_SIZE) {
        return { format: null, reason: `probe captured at ${size.width}x${size.height} instead of ${CAPTURE_PROBE_SIZE}x${CAPTURE_PROBE_SIZE}` };
      }
      const bytes = image.toBitmap();
      const format = classifyCapture(bytes);
      return format ? { format } : { format: null, reason: describeProbePixels(bytes) };
    } catch (err) {
      return { format: null, reason: (err as Error).message };
    } finally {
      win.destroy();
    }
  })();
  return captureProbe;
}

export async function renderTemplate(job: RenderJob): Promise<RenderResult> {
  const { manifest } = job.template;

  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, message: ffmpeg.message };

  // Raw frames need the capture layout. If it cannot be determined, PNG frames are always right.
  let frameFormat: FrameFormat = job.frameFormat ?? 'raw';
  let transport = 'png';
  const warnings: string[] = [];
  let probe: CaptureProbe | null = null;
  if (frameFormat === 'raw') {
    probe = await detectCaptureFormat();
    if (probe.format) {
      transport = `raw (${describeCaptureFormat(probe.format)})`;
    } else {
      frameFormat = 'png';
      warnings.push(`Could not determine the capture pixel format (${probe.reason}); frames are sent to ffmpeg as PNG instead.`);
    }
  }

  let plan;
  try {
    plan = buildRenderPlan({
      manifest,
      presetId: job.presetId,
      outputPath: job.outputPath,
      overwrite: job.overwrite ?? false,
      frameFormat,
      tagAlphaMode: ffmpeg.alphaModeAware,
      ...(job.options ? { options: job.options } : {}),
      ...(probe?.format ? { rawInput: probe.format } : {}),
    });
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  const unsupported = checkPresetSupport(ffmpeg, plan.preset);
  if (unsupported) return { ok: false, message: unsupported };

  const { values, issues } = resolveParams(manifest, job.params);
  warnings.push(...plan.warnings, ...issues.map((i) => `parameter ${i.id}: ${i.message}`));

  const win = new BrowserWindow({
    show: false,
    width: manifest.width,
    height: manifest.height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      // Scale 1 on purpose: a 1920x1080 template is captured as 1920x1080 pixels on any display,
      // and window.devicePixelRatio is 1 inside the template.
      offscreen: { deviceScaleFactor: offscreenDeviceScaleFactor() },
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const overwrite = job.overwrite ?? false;
  const frameTimeoutMs = job.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
  const loadTimeoutMs = job.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  let child: ReturnType<typeof spawn> | null = null;
  let exited: Promise<[number | null, NodeJS.Signals | null]> | null = null;
  let existedBefore = new Set<string>();

  /** Stop ffmpeg and remove whatever it wrote, then report the failure. */
  const fail = async (result: Extract<RenderResult, { ok: false }>): Promise<RenderResult> => {
    if (child && exited) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
      const files = partialOutputFiles({
        output: plan.output,
        sequence: plan.preset.sequence,
        totalFrames: plan.totalFrames,
        firstFrame: plan.firstFrame,
        overwrite,
        existedBefore,
      });
      await Promise.all(files.map((f) => rm(f, { force: true })));
    }
    return result;
  };

  try {
    // Offscreen windows are not clamped to the screen size, so 4K templates still get a full-size surface.
    win.setContentSize(manifest.width, manifest.height);
    try {
      await withTimeout(
        win.loadURL(templateUrlFor(manifest.id, manifest.entry)).then(() =>
          win.webContents.executeJavaScript('window.__pulp.ready'),
        ),
        loadTimeoutMs,
        loadTimeoutMessage(manifest.name, loadTimeoutMs),
      );
    } catch (err) {
      if (err instanceof RenderTimeoutError) return { ok: false, message: err.message };
      return { ok: false, message: `Could not load template "${manifest.name}": ${(err as Error).message}` };
    }

    await mkdir(dirname(plan.output), { recursive: true });
    existedBefore = await existingFiles(
      partialOutputFiles({
        output: plan.output,
        sequence: plan.preset.sequence,
        totalFrames: plan.totalFrames,
        firstFrame: plan.firstFrame,
        overwrite: false,
        existedBefore: new Set(),
      }),
    );
    child = spawn(ffmpeg.path, plan.args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    exited = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>;
    // Writes after ffmpeg exits raise EPIPE; the exit code is reported below instead.
    child.stdin?.on('error', () => undefined);

    // Frames are sampled at the output frame rate; indices stay on the template's timeline, so a
    // trimmed render starts at plan.firstFrame rather than 0.
    const timeline = { ...manifest, fps: plan.fps };
    for (let i = 0; i < plan.totalFrames; i++) {
      if (job.signal?.aborted) return await fail({ ok: false, cancelled: true, message: 'Render cancelled.' });
      if (child.exitCode !== null) break;

      const frame = plan.firstFrame + i;
      const state = frameState(timeline, frame, values);
      let pixels: Buffer;
      try {
        pixels = await withTimeout(
          captureFrame(win, state, manifest, plan.frameFormat),
          frameTimeoutMs,
          frameTimeoutMessage(manifest.name, frame, frameTimeoutMs),
        );
      } catch (err) {
        // A template stuck in a synchronous loop blocks its renderer; crash it so the window can be destroyed.
        if (err instanceof RenderTimeoutError) win.webContents.forcefullyCrashRenderer();
        const message = err instanceof TemplateError ? templateThrewMessage(manifest.name, frame, err.detail) : (err as Error).message;
        return await fail({ ok: false, message });
      }
      if (!child.stdin?.write(pixels)) await once(child.stdin!, 'drain');
      job.onProgress?.({ frame: i + 1, totalFrames: plan.totalFrames });
    }

    child.stdin?.end();
    const [code] = await exited;
    if (code !== 0) {
      return await fail({ ok: false, message: `ffmpeg exited with code ${code}: ${stderr.trim() || 'no error output'}` });
    }
    return { ok: true, output: plan.output, frames: plan.totalFrames, warnings, transport };
  } catch (err) {
    return await fail({ ok: false, message: `Render failed: ${(err as Error).message}` });
  } finally {
    win.destroy();
  }
}

class TemplateError extends Error {
  constructor(readonly detail: TemplateErrorDetail) {
    super(detail.message ?? 'template error');
  }
}

/**
 * Make sure the offscreen backing store holds the frame the page just drew:
 * force a repaint and wait for it to arrive. The renderer-side double
 * requestAnimationFrame (see BRIDGE_SCRIPT) orders the draw before the next
 * commit; this closes the remaining browser-side gap, because capturePage on
 * an offscreen window returns the last painted frame, not a fresh one. The
 * timeout keeps an occluded or otherwise non-painting window from hanging the
 * frame; the capture then behaves as before the wait existed.
 */
function paintComposited(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      win.webContents.removeListener('paint', done);
      resolve();
    };
    const timer = setTimeout(done, 500);
    win.webContents.once('paint', done);
    win.webContents.invalidate();
  });
}

/**
 * Draw one frame in the template page and capture it, which must be exactly the
 * template's size. Raw frames are the capture's own bitmap, in the layout the
 * probe measured (the render plan undoes premultiplication in ffmpeg if needed),
 * so no image codec runs per frame.
 */
async function captureFrame(
  win: BrowserWindow,
  state: ReturnType<typeof frameState>,
  manifest: { name: string; width: number; height: number },
  frameFormat: FrameFormat,
): Promise<Buffer> {
  const detail = (await win.webContents.executeJavaScript(frameCallScript(state))) as TemplateErrorDetail | null;
  if (detail) throw new TemplateError(detail);
  await paintComposited(win);
  const image = await win.webContents.capturePage();
  const size = image.getSize();
  if (size.width !== manifest.width || size.height !== manifest.height) {
    // The window is at scale 1 (see offscreenDeviceScaleFactor), so a different size means the
    // platform scaled or clamped it. Resampling would hide that and soften every frame.
    throw new Error(captureSizeMessage(manifest.name, state.frame, manifest, size));
  }
  if (frameFormat === 'png') return image.toPNG();
  const pixels = image.toBitmap();
  const expectedBytes = manifest.width * manifest.height * 4;
  if (pixels.length !== expectedBytes) {
    throw new Error(captureBytesMessage(manifest.name, state.frame, expectedBytes, pixels.length));
  }
  return pixels;
}

async function existingFiles(paths: string[]): Promise<Set<string>> {
  const found = await Promise.all(paths.map((p) => access(p).then(() => p, () => null)));
  return new Set(found.filter((p): p is string => p !== null));
}
