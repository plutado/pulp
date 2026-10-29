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
import { templateDefaultSize, type Size } from '../core/aspect';
import { chosenImageIds, imageRequests, imageSlots, MAX_IMAGE_FILE_BYTES } from '../core/image-slot';
import { blockStates, layerImageChoices, layerImageIds, layerTexts } from '../core/layer-layout';
import { resolveLayers } from '../core/layers';
import { checkImages, readSlotImages } from './image-grant';
import { lookupMedia } from './library-service';
import { checkPresetSupport, detectFfmpeg } from '../core/ffmpeg';
import { CAPTURE_PROBE_SIZE, CAPTURE_PROBE_URL, classifyCapture, describeCaptureFormat, describeProbePixels, type CaptureFormat } from '../core/capture-format';
import { buildRenderPlan, type FrameFormat, type RenderOptions } from '../core/render-plan';
import { resolveParams, splitLayers } from '../core/params';
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
export function offscreenDeviceScaleFactor(): number {
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

  // The layer stacks ride in the same bag as the parameters (src/core/params.ts), so a render gets
  // the layers the person built wherever the parameters came from: the form, a card, a CSV row.
  const { params: rawParams, layers: rawLayers } = splitLayers(job.params);
  const { values, issues } = resolveParams(manifest, rawParams);
  const { values: layers, issues: layerIssues } = resolveLayers(manifest, rawLayers);
  warnings.push(...layerIssues.map((i) => `layer ${i.layer ? `${i.block}.${i.layer}` : i.block}: ${i.message}`));
  warnings.push(...plan.warnings, ...issues.map((i) => `parameter ${i.id}: ${i.message}`));

  // Image slots (ADR 0013): the chosen stills must be in the library, online and within the size
  // bound before anything is loaded; then the template is granted exactly those ids while it renders.
  const renderSize = { width: plan.width, height: plan.height };
  const blocks = blockStates(manifest, layers, renderSize);
  const slots = imageSlots(manifest.parameters, values, renderSize, layerTexts(blocks));
  const imageIds = [...new Set([...chosenImageIds(slots), ...layerImageIds(blocks)])];
  const refused = imageProblem(manifest, slots, imageIds);
  if (refused) return { ok: false, message: refused };

  // The frame size is the plan's, not the manifest's: a template draws for a shape and the
  // size is chosen per render (ADR 0012). The window, the capture check and ffmpeg agree on it.
  const frameSize = { name: manifest.name, width: plan.width, height: plan.height };
  const win = new BrowserWindow({
    show: false,
    width: plan.width,
    height: plan.height,
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
    win.setContentSize(plan.width, plan.height);
    // Begin-frame cadence, not the output rate. Each frame waits two animation frames and one paint
    // (see captureFrame), which at the default 60 Hz caps the render near 30 frames/s; at Electron's
    // maximum of 240 the waits cost ~4 ms. The offscreen.frameRate web preference has no effect here;
    // setFrameRate does.
    win.webContents.setFrameRate(240);
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
    // Every chosen image is read by the main process, handed to the page as bytes, and decoded now,
    // before the first frame, under the load budget rather than a frame's (ADR 0013).
    const requests = [...imageRequests(slots), ...layerImageChoices(blocks).map((c) => ({ id: c.id, treatment: c.treatment, tint: c.tint }))]
      .filter((r, i, all) => all.findIndex((o) => o.id === r.id && o.treatment === r.treatment && o.tint === r.tint) === i);
    if (requests.length > 0) {
      try {
        const handed = await readSlotImages(imageIds);
        if (handed.missing.length > 0) return { ok: false, message: `The image for "${slotLabel(manifest, slots, handed.missing[0]!)}" could not be read.` };
        const srcById = new Map(handed.images.map((i) => [i.id, i.src]));
        const withBytes = requests.map((r) => ({ ...r, src: srcById.get(r.id) }));
        await withTimeout(
          win.webContents.executeJavaScript(`window.__pulp.prepare(${JSON.stringify(withBytes)})`),
          loadTimeoutMs,
          `Template "${manifest.name}": its images did not load within ${Math.round(loadTimeoutMs / 1000)} s`,
        );
      } catch (err) {
        return { ok: false, message: err instanceof RenderTimeoutError ? err.message : `Template "${manifest.name}": ${(err as Error).message}` };
      }
    }

    // The page is loaded and its images are in: let the paints that cost queue up arrive before the
    // first frame waits for one of its own, or it can be handed the frame from before the draw.
    await drainPaints(win);

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
      const state = frameState(timeline, frame, values, frameSize, layers);
      let pixels: Buffer;
      try {
        pixels = await withTimeout(
          captureFrame(win, state, frameSize, plan.frameFormat),
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

/** The label of the slot an image id fills, for messages. */
function slotLabel(manifest: TemplateEntry['manifest'], slots: ReturnType<typeof imageSlots>, id: string): string {
  const slot = Object.entries(slots).find(([, s]) => s.id === id)?.[0];
  return manifest.parameters.find((p) => p.id === slot)?.label ?? slot ?? id;
}

/** Why a render cannot start with these images, or null when all is well. */
function imageProblem(manifest: TemplateEntry['manifest'], slots: ReturnType<typeof imageSlots>, ids: string[]): string | null {
  if (ids.length === 0) return null;
  const { missing } = checkImages(ids);
  if (missing.length > 0) return `The image for "${slotLabel(manifest, slots, missing[0]!)}" is not in the library, or its folder is offline.`;
  for (const id of ids) {
    const size = lookupMedia(id)?.entry.size ?? 0;
    if (size > MAX_IMAGE_FILE_BYTES) return `The image for "${slotLabel(manifest, slots, id)}" is ${Math.round(size / 1048576)} MB; images over ${MAX_IMAGE_FILE_BYTES / 1048576} MB are not loaded.`;
  }
  return null;
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
/** How long the paint stream must be quiet before the backlog counts as drained, and the cap on waiting. */
const PAINT_QUIET_MS = 48;
const PAINT_DRAIN_CAP_MS = 2000;

/**
 * Wait for the offscreen paint stream to go quiet.
 *
 * `paintComposited` resolves on the *next* `paint` event, which it takes to be
 * the frame it just invalidated for. That holds only when nothing else is in
 * flight. Loading the page, and handing a template its images, each queue
 * paints of their own; on a slow machine one of those can still be travelling
 * when the first frame's wait begins, satisfy it, and leave `capturePage`
 * returning the state from *before* the draw — a blank first frame
 * (docs/platform-notes.md, "macOS CI").
 *
 * So the backlog is drained once, after the page is loaded and prepared and
 * before the first frame. The drain asks for a repaint of its own and waits for
 * the paint that answers it: paints arrive in the order they were produced, so
 * that one is behind every paint the load queued, and when it is in, so are
 * they. Only then does the quiet period start counting — paints are watched
 * until none has arrived for PAINT_QUIET_MS — so that a late straggler is
 * taken too. The last one is by definition the newest state, so from then on a
 * paint can only be the frame that was asked for.
 *
 * The first version started the quiet period at once, so on a loaded runner,
 * where a paint of a 1080p surface can take longer than PAINT_QUIET_MS to
 * arrive, the drain could finish *before* its own paint did, and that paint
 * then satisfied the first frame's wait: a blank single-frame render on the
 * macOS runner even after the drain was in place (CI run 40244410162).
 *
 * The cost is one quiet period per render, not per frame; the cap keeps a
 * window that never paints, or paints continuously, from holding the render up.
 */
export function drainPaints(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    let quiet: NodeJS.Timeout | undefined;
    const done = (): void => {
      if (quiet) clearTimeout(quiet);
      clearTimeout(cap);
      win.webContents.removeListener('paint', onPaint);
      resolve();
    };
    const onPaint = (): void => {
      if (quiet) clearTimeout(quiet);
      quiet = setTimeout(done, PAINT_QUIET_MS);
    };
    const cap = setTimeout(done, PAINT_DRAIN_CAP_MS);
    win.webContents.on('paint', onPaint);
    win.webContents.invalidate();
  });
}

export function paintComposited(win: BrowserWindow): Promise<void> {
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

/**
 * What came of capturing frames. `timedOut` marks a run that ran out of time
 * rather than one that failed on the template itself: the caller can try again
 * on a quieter machine instead of writing the item off.
 */
export type CaptureFramesResult = { ok: true; frames: Buffer[] } | { ok: false; message: string; timedOut?: boolean };

/**
 * Capture named frames of a template as PNGs through **one** offscreen window.
 * For the hover-scrub strip, which wants a handful of frames spread over the
 * timeline rather than a contiguous range: a render per frame would pay the
 * window's load cost every time, and the frame-rate override cannot express
 * "eight frames across this duration" because it only takes standard rates.
 *
 * PNG, not raw pixels: there is no ffmpeg pipe to feed here, and eight image
 * encodes cost less than the capture-format probe they would replace.
 */
export async function captureTemplateFrames(
  template: TemplateEntry,
  frames: readonly number[],
  options: { params?: Record<string, unknown>; size?: Size; frameTimeoutMs?: number; loadTimeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CaptureFramesResult> {
  const { manifest } = template;
  const { params: rawParams, layers: rawLayers } = splitLayers(options.params ?? {});
  const { values } = resolveParams(manifest, rawParams);
  const { values: layers } = resolveLayers(manifest, rawLayers);
  // The template's default size unless told otherwise: the hover strip wants the same frame the poster shows.
  const frameSize = { name: manifest.name, ...(options.size ?? templateDefaultSize(manifest)) };
  const win = new BrowserWindow({
    show: false,
    width: frameSize.width,
    height: frameSize.height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: { deviceScaleFactor: offscreenDeviceScaleFactor() },
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    win.setContentSize(frameSize.width, frameSize.height);
    win.webContents.setFrameRate(240);
    const loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
    try {
      await withTimeout(
        win.loadURL(templateUrlFor(manifest.id, manifest.entry)).then(() => win.webContents.executeJavaScript('window.__pulp.ready')),
        loadTimeoutMs,
        loadTimeoutMessage(manifest.name, loadTimeoutMs),
      );
    } catch (err) {
      // A load that ran out of time says the machine was busy, not that the template is broken.
      if (err instanceof RenderTimeoutError) return { ok: false, message: err.message, timedOut: true };
      return { ok: false, message: `Could not load template "${manifest.name}": ${(err as Error).message}` };
    }
    // The load's own paints, out of the way before the first frame waits for one (see drainPaints).
    await drainPaints(win);
    const frameTimeoutMs = options.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
    const captured: Buffer[] = [];
    for (const frame of frames) {
      if (options.signal?.aborted) return { ok: false, message: 'Cancelled.' };
      try {
        captured.push(await withTimeout(captureFrame(win, frameState(manifest, frame, values, frameSize, layers), frameSize, 'png'), frameTimeoutMs, frameTimeoutMessage(manifest.name, frame, frameTimeoutMs)));
      } catch (err) {
        if (err instanceof RenderTimeoutError) {
          win.webContents.forcefullyCrashRenderer();
          return { ok: false, message: err.message, timedOut: true };
        }
        return { ok: false, message: err instanceof TemplateError ? templateThrewMessage(manifest.name, frame, err.detail) : (err as Error).message };
      }
    }
    return { ok: true, frames: captured };
  } finally {
    win.destroy();
  }
}

/**
 * Draw one picture from a self-contained page (a data URL defining
 * `window.pulpRender`, like the sample-media stills) at an exact size and
 * return it as PNG. The page is not a library template, so there is no bridge:
 * the call goes straight to the function, then two animation frames and a
 * paint settle the capture the same way as a template frame.
 */
export async function captureStillPage(url: string, size: Size, params: Record<string, unknown>, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS): Promise<{ ok: true; png: Buffer } | { ok: false; message: string }> {
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: { deviceScaleFactor: offscreenDeviceScaleFactor() }, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  try {
    win.setContentSize(size.width, size.height);
    const state = { frame: 0, time: 0, progress: 0, fps: 1, duration: 1, totalFrames: 1, width: size.width, height: size.height, params };
    await withTimeout(win.loadURL(url), timeoutMs, `the page did not load within ${Math.round(timeoutMs / 1000)} s`);
    await drainPaints(win);
    await withTimeout(
      win.webContents.executeJavaScript(
        `Promise.resolve(window.pulpRender(${JSON.stringify(state)})).then(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); })`,
      ),
      timeoutMs,
      `the page did not draw within ${Math.round(timeoutMs / 1000)} s`,
    );
    await paintComposited(win);
    const image = await win.webContents.capturePage();
    const got = image.getSize();
    if (got.width !== size.width || got.height !== size.height) {
      return { ok: false, message: `captured at ${got.width}x${got.height} instead of ${size.width}x${size.height}` };
    }
    return { ok: true, png: image.toPNG() };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  } finally {
    win.destroy();
  }
}

/**
 * Every frame of an animated asset page, as PNGs with alpha (milestone 26).
 * The same offscreen, transparent window a still uses, stepped through the
 * clip's own time: the page draws from `state.time` and `state.duration`, so a
 * looping asset meets its first frame again and a one-shot clears. PNG keeps
 * the alpha that makes an asset an asset.
 */
export async function captureAssetFrames(
  url: string,
  size: Size,
  params: Record<string, unknown>,
  clip: { seconds: number; fps: number },
  timeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
): Promise<{ ok: true; frames: Buffer[] } | { ok: false; message: string }> {
  const total = Math.max(1, Math.round(clip.seconds * clip.fps));
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: { deviceScaleFactor: offscreenDeviceScaleFactor() }, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  try {
    win.setContentSize(size.width, size.height);
    await withTimeout(win.loadURL(url), timeoutMs, `the page did not load within ${Math.round(timeoutMs / 1000)} s`);
    await drainPaints(win);
    const frames: Buffer[] = [];
    for (let frame = 0; frame < total; frame++) {
      const time = frame / clip.fps;
      const state = { frame, time, progress: time / clip.seconds, fps: clip.fps, duration: clip.seconds, totalFrames: total, width: size.width, height: size.height, params };
      await withTimeout(
        win.webContents.executeJavaScript(
          `Promise.resolve(window.pulpRender(${JSON.stringify(state)})).then(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); })`,
        ),
        timeoutMs,
        `the page did not draw frame ${frame} within ${Math.round(timeoutMs / 1000)} s`,
      );
      await paintComposited(win);
      const image = await win.webContents.capturePage();
      const got = image.getSize();
      if (got.width !== size.width || got.height !== size.height) {
        return { ok: false, message: `captured at ${got.width}x${got.height} instead of ${size.width}x${size.height}` };
      }
      frames.push(image.toPNG());
    }
    return { ok: true, frames };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function existingFiles(paths: string[]): Promise<Set<string>> {
  const found = await Promise.all(paths.map((p) => access(p).then(() => p, () => null)));
  return new Set(found.filter((p): p is string => p !== null));
}
