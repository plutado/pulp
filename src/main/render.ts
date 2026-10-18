/**
 * Headless renderer: steps a template frame by frame in an offscreen
 * BrowserWindow, captures each frame as PNG and pipes it into ffmpeg.
 *
 * Status: first working version. Verified on macOS with the bundled samples
 * for all presets (1920x1080, alpha preserved in ProRes 4444, PNG and VP9).
 * Not yet verified: Windows/Linux, HiDPI capture, 4K and above, color
 * management, and long renders. See milestone 1 in ROADMAP.md.
 */

import { BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { checkPresetSupport, detectFfmpeg } from '../core/ffmpeg';
import { buildRenderPlan } from '../core/render-plan';
import { resolveParams } from '../core/params';
import { frameState } from '../core/runtime';
import type { TemplateEntry } from '../core/library';
import type { RenderProgress, RenderResult } from '../shared/api';
import { templateUrlFor } from '../shared/api';

export interface RenderJob {
  template: TemplateEntry;
  params: Record<string, unknown>;
  presetId: string;
  outputPath: string;
  background?: string;
  overwrite?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}

export async function renderTemplate(job: RenderJob): Promise<RenderResult> {
  const { manifest } = job.template;

  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, message: ffmpeg.message };

  let plan;
  try {
    plan = buildRenderPlan({
      manifest,
      presetId: job.presetId,
      outputPath: job.outputPath,
      overwrite: job.overwrite ?? false,
      ...(job.background ? { background: job.background } : {}),
    });
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  const unsupported = checkPresetSupport(ffmpeg, plan.preset);
  if (unsupported) return { ok: false, message: unsupported };

  const { values, issues } = resolveParams(manifest, job.params);
  const warnings = [...plan.warnings, ...issues.map((i) => `parameter ${i.id}: ${i.message}`)];

  const win = new BrowserWindow({
    show: false,
    width: manifest.width,
    height: manifest.height,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  let child: ReturnType<typeof spawn> | null = null;
  try {
    // Offscreen windows are not clamped to the screen size, so 4K templates still get a full-size surface.
    win.setContentSize(manifest.width, manifest.height);
    await win.loadURL(templateUrlFor(manifest.id, manifest.entry));
    await win.webContents.executeJavaScript('window.__pulp.ready');

    await mkdir(dirname(plan.output), { recursive: true });
    child = spawn(ffmpeg.path, plan.args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-8000);
    });
    const exited = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>;
    // Writes after ffmpeg exits raise EPIPE; the exit code is reported below instead.
    child.stdin?.on('error', () => undefined);

    for (let frame = 0; frame < plan.totalFrames; frame++) {
      if (job.signal?.aborted) {
        child.kill('SIGKILL');
        await exited;
        return { ok: false, cancelled: true, message: 'Render cancelled.' };
      }
      if (child.exitCode !== null) break;

      const state = frameState(manifest, frame, values);
      await win.webContents.executeJavaScript(`window.__pulp.render(${JSON.stringify(state)})`);
      let image = await win.webContents.capturePage();
      const size = image.getSize();
      if (size.width !== manifest.width || size.height !== manifest.height) {
        // HiDPI or a clamped window; scale to the template's declared size.
        image = image.resize({ width: manifest.width, height: manifest.height, quality: 'best' });
      }
      const png = image.toPNG();
      if (!child.stdin?.write(png)) await once(child.stdin!, 'drain');
      job.onProgress?.({ frame: frame + 1, totalFrames: plan.totalFrames });
    }

    child.stdin?.end();
    const [code] = await exited;
    if (code !== 0) {
      return { ok: false, message: `ffmpeg exited with code ${code}: ${stderr.trim() || 'no error output'}` };
    }
    return { ok: true, output: plan.output, frames: plan.totalFrames, warnings };
  } catch (err) {
    child?.kill('SIGKILL');
    return { ok: false, message: `Render failed: ${(err as Error).message}` };
  } finally {
    win.destroy();
  }
}
