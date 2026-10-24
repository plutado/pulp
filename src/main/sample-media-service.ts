/**
 * Makes the sample-media folder (milestone 21): runs every recipe in the
 * catalogue that has no file yet, so a library gets three to five original
 * CC0 files per media type without shipping binaries. Sounds and music come
 * from ffmpeg's lavfi sources, stills from canvas pages through the offscreen
 * renderer, clips from the bundled background templates through the normal
 * render path at a small size.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectFfmpeg, nodeRunner, runWithInput } from '../core/ffmpeg';
import { SAMPLE_MEDIA, SAMPLE_MEDIA_LICENSE, sampleAudioArgs, sampleJpegArgs, sampleMediaPath, sampleMediaReadme, type SampleMediaItem } from '../core/sample-media';
import { stillPageUrl } from '../core/sample-stills';
import { findTemplate } from './library-service';
import { captureStillPage, renderTemplate } from './render';

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

async function makeOne(item: SampleMediaItem, out: string, ffmpegPath: string): Promise<string | null> {
  const { recipe } = item;
  if (recipe.kind === 'audio') {
    const result = await nodeRunner(ffmpegPath, sampleAudioArgs(recipe, out));
    return result.code === 0 ? null : `ffmpeg exited with ${result.code}: ${result.stderr.trim() || 'no error output'}`;
  }
  if (recipe.kind === 'still') {
    const shot = await captureStillPage(stillPageUrl(recipe.page), { width: recipe.width, height: recipe.height }, { variant: recipe.variant });
    if (!shot.ok) return shot.message;
    if (recipe.format === 'png') {
      await writeFile(out, shot.png);
      return null;
    }
    const encoded = await runWithInput(ffmpegPath, sampleJpegArgs(out), shot.png);
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

/**
 * Write every missing sample file under `root`, creating the folder tree, the
 * license and the README. Files that exist are skipped, so running it again
 * only fills gaps. One failure does not stop the rest.
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
  let done = 0;
  for (const item of SAMPLE_MEDIA) {
    const rel = sampleMediaPath(item);
    const file = rel.join('/');
    const out = join(root, ...rel);
    let outcome: SampleMediaProgress['outcome'];
    if (existsSync(out)) {
      report.skipped.push(file);
      outcome = 'skipped';
    } else {
      await mkdir(join(root, ...item.folder), { recursive: true });
      let reason: string | null;
      try {
        reason = await makeOne(item, out, ffmpeg.path);
      } catch (err) {
        reason = (err as Error).message;
      }
      if (reason === null && existsSync(out)) {
        report.written.push(file);
        outcome = 'written';
      } else {
        report.failed.push({ file, reason: reason ?? 'nothing was written' });
        outcome = 'failed';
      }
    }
    done++;
    onProgress?.({ done, total, file, outcome });
  }
  return report;
}
