/**
 * Makes the sample-media folder (milestone 21): runs every recipe in the
 * catalogue that has no file yet, so a library gets at least six original
 * CC0 files per media type without shipping binaries. Sounds and music come
 * from ffmpeg's lavfi sources, stills from canvas pages through the offscreen
 * renderer, clips from the bundled background templates through the normal
 * render path at a small size.
 *
 * The catalogue is made in two lanes at once, because its two halves need
 * different machines: a sound is an ffmpeg subprocess and nothing else, while
 * a still, an asset or a clip goes through an offscreen window. The sounds run
 * several at a time — they are more than half the catalogue and each one is
 * idle waiting on a child process — and the drawn files stay strictly one at a
 * time, since several offscreen windows competing for the compositor is what
 * makes a capture come back stale (docs/platform-notes.md). The two lanes
 * overlap, so ffmpeg works while the renderer draws.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { detectFfmpeg, nodeRunner, runWithInput } from '../core/ffmpeg';
import { SAMPLE_MEDIA, SAMPLE_MEDIA_LICENSE, sampleAssetArgs, sampleAudioArgs, sampleJpegArgs, sampleMediaPath, sampleMediaReadme, type SampleMediaItem } from '../core/sample-media';
import { stillPageUrl } from '../core/sample-stills';
import { findTemplate } from './library-service';
import { openCapturePage, renderTemplate, type CapturePage } from './render';

export interface SampleMediaProgress {
  done: number;
  total: number;
  /** The file just finished, relative to the root. */
  file: string;
  outcome: 'written' | 'skipped' | 'failed';
}

export interface SampleMediaReport {
  root: string;
  written: string[];
  /** Files that already existed and were left alone. */
  skipped: string[];
  failed: { file: string; reason: string }[];
}

/**
 * The capture pages a run keeps open, one per page and size: the catalogue's
 * hundreds of drawn files come from a handful of pages, and a window per file
 * paid the load and its paint drain every time — most of a slow runner's
 * minutes. Used strictly one at a time, like every drawn file before them.
 */
const capturePool = new Map<string, CapturePage>();

async function pooledPage(page: string, width: number, height: number): Promise<{ ok: true; page: CapturePage } | { ok: false; message: string }> {
  const key = `${page}|${width}x${height}`;
  const open = capturePool.get(key);
  if (open) return { ok: true, page: open };
  const opened = await openCapturePage(stillPageUrl(page as Parameters<typeof stillPageUrl>[0]), { width, height });
  if (opened.ok) capturePool.set(key, opened.page);
  return opened;
}

function closeCapturePool(): void {
  for (const page of capturePool.values()) page.close();
  capturePool.clear();
}

async function makeOne(item: SampleMediaItem, out: string, ffmpegPath: string): Promise<string | null> {
  const { recipe } = item;
  if (recipe.kind === 'audio') {
    const result = await nodeRunner(ffmpegPath, sampleAudioArgs(recipe, out));
    return result.code === 0 ? null : `ffmpeg exited with ${result.code}: ${result.stderr.trim() || 'no error output'}`;
  }
  if (recipe.kind === 'still') {
    const opened = await pooledPage(recipe.page, recipe.width, recipe.height);
    if (!opened.ok) return opened.message;
    const shot = await opened.page.still({ variant: recipe.variant });
    if (!shot.ok) return shot.message;
    if (recipe.format === 'png') {
      await writeFile(out, shot.png);
      return null;
    }
    const encoded = await runWithInput(ffmpegPath, sampleJpegArgs(out), shot.png);
    return encoded.code === 0 ? null : `ffmpeg exited with ${encoded.code}: ${encoded.stderr.trim() || 'no error output'}`;
  }
  if (recipe.kind === 'asset') {
    // A still asset is one frame of the same page; a clip is every frame, piped to ffmpeg as PNGs
    // so the alpha survives into the WebM (or, for footage and loops, opaque H.264).
    const opened = await pooledPage(recipe.page, recipe.width, recipe.height);
    if (!opened.ok) return opened.message;
    if (recipe.format === 'png') {
      const shot = await opened.page.still({ variant: recipe.variant });
      if (!shot.ok) return shot.message;
      await writeFile(out, shot.png);
      return null;
    }
    const shot = await opened.page.frames({ variant: recipe.variant }, { seconds: recipe.seconds, fps: recipe.fps });
    if (!shot.ok) return shot.message;
    const encoded = await runWithInput(ffmpegPath, sampleAssetArgs(recipe, out), Buffer.concat(shot.frames));
    return encoded.code === 0 ? null : `ffmpeg exited with ${encoded.code}: ${encoded.stderr.trim() || 'no error output'}`;
  }
  const template = await findTemplate(recipe.templateId);
  if (!template) return `template "${recipe.templateId}" is not in the library`;
  const fps = template.manifest.fps;
  const result = await renderTemplate({
    template,
    params: {},
    presetId: 'h264-mp4',
    outputPath: out,
    overwrite: true,
    options: { width: recipe.width, height: recipe.height, inFrame: 0, outFrame: Math.max(0, Math.round(recipe.seconds * fps) - 1) },
  });
  return result.ok ? null : result.message;
}

/** How many sounds ffmpeg is asked for at once; the drawn files are always one at a time. */
function audioLanes(): number {
  // One left for the renderer lane and the main process, and a ceiling: past a handful these are
  // waiting on each other's disk and CPU rather than on nothing.
  return Math.max(1, Math.min(4, availableParallelism() - 1));
}

/** What became of one item, kept by its place in the catalogue so the report reads in catalogue order. */
interface ItemOutcome {
  file: string;
  outcome: SampleMediaProgress['outcome'];
  reason?: string;
}

/**
 * Write every missing sample file under `root`, creating the folder tree, the
 * license and the README. Files that exist are skipped, so running it again
 * only fills gaps. One failure does not stop the rest.
 *
 * The report lists files in catalogue order however the work was interleaved,
 * and `onProgress` counts every item once, in the order they finish.
 */
export async function generateSampleMedia(root: string, onProgress?: (p: SampleMediaProgress) => void): Promise<SampleMediaReport> {
  const report: SampleMediaReport = { root, written: [], skipped: [], failed: [] };
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) {
    report.failed.push({ file: '', reason: ffmpeg.message });
    return report;
  }
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'LICENSE-CC0.txt'), SAMPLE_MEDIA_LICENSE);
  await writeFile(join(root, 'README.md'), sampleMediaReadme());

  const total = SAMPLE_MEDIA.length;
  const outcomes = new Array<ItemOutcome | undefined>(total);
  let done = 0;

  const runItem = async (index: number): Promise<void> => {
    const item = SAMPLE_MEDIA[index]!;
    const rel = sampleMediaPath(item);
    const file = rel.join('/');
    const out = join(root, ...rel);
    let result: ItemOutcome;
    if (existsSync(out)) {
      result = { file, outcome: 'skipped' };
    } else {
      await mkdir(join(root, ...item.folder), { recursive: true });
      let reason: string | null;
      try {
        reason = await makeOne(item, out, ffmpeg.path);
      } catch (err) {
        reason = (err as Error).message;
      }
      result = reason === null && existsSync(out) ? { file, outcome: 'written' } : { file, outcome: 'failed', reason: reason ?? 'nothing was written' };
    }
    outcomes[index] = result;
    done++;
    onProgress?.({ done, total, file, outcome: result.outcome });
  };

  /** Take from `queue` until it is empty; `lanes` of these run side by side. */
  const drain = async (queue: number[], lanes: number): Promise<void> => {
    const next = async (): Promise<void> => {
      for (;;) {
        const index = queue.shift();
        if (index === undefined) return;
        await runItem(index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(lanes, queue.length) }, next));
  };

  const sounds = SAMPLE_MEDIA.map((item, i) => ({ item, i })).filter((e) => e.item.recipe.kind === 'audio').map((e) => e.i);
  const drawn = SAMPLE_MEDIA.map((item, i) => ({ item, i })).filter((e) => e.item.recipe.kind !== 'audio').map((e) => e.i);
  try {
    await Promise.all([drain(sounds, audioLanes()), drain(drawn, 1)]);
  } finally {
    closeCapturePool();
  }

  for (const result of outcomes) {
    if (!result) continue;
    if (result.outcome === 'written') report.written.push(result.file);
    else if (result.outcome === 'skipped') report.skipped.push(result.file);
    else report.failed.push({ file: result.file, reason: result.reason ?? 'nothing was written' });
  }
  return report;
}
