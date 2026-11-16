/**
 * A library clip rendered to an RGB format keeps its colors (issue #93). The
 * clip is Y'CbCr, limited range as most video is; the RGB preset's full-range
 * tags describe the frames after the conversion, never before it, so the
 * conversion reads the clip by its own range and matrix. Real ffmpeg: a red
 * patch is written as each kind of clip, rendered to a PNG still, and read
 * back against the same clip decoded straight.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectFfmpeg } from '../src/core/ffmpeg';
import { buildMediaRenderPlan, type MediaSource } from '../src/core/media-render';

const ffmpeg = await detectFfmpeg();
const SIZE = 64;

/** The first pixel of a picture file (or a clip's first frame), as 8-bit RGB. */
function firstPixel(path: string): number[] {
  const out = spawnSync(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 16 * 1024 * 1024 });
  expect(out.status, String(out.stderr)).toBe(0);
  return [...out.stdout.subarray(0, 3)];
}

describe.skipIf(!ffmpeg.ok)('an RGB render of a clip keeps its colors (needs ffmpeg)', () => {
  let dir = '';
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('matches each clip decoded by its own tags: limited BT.709, limited BT.601 and full range', async () => {
    if (!ffmpeg.ok) return;
    dir = await mkdtemp(join(tmpdir(), 'pulp-rgb-color-'));
    const clips = [
      { name: 'bt709-limited', matrix: 'bt709', tag: 'bt709', range: 'tv' },
      { name: 'bt601-limited', matrix: 'bt601', tag: 'bt470bg', range: 'tv' },
      { name: 'bt601-full', matrix: 'bt601', tag: 'bt470bg', range: 'pc' },
    ];
    for (const clip of clips) {
      const file = join(dir, `${clip.name}.mkv`);
      const made = spawnSync(ffmpeg.path, [
        '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0xC52727:s=${SIZE}x${SIZE}:r=25:d=0.4`,
        '-vf', `scale=out_color_matrix=${clip.matrix}:out_range=${clip.range},format=yuv444p`,
        '-colorspace', clip.tag, '-color_range', clip.range, '-c:v', 'ffv1', file,
      ]);
      expect(made.status, String(made.stderr)).toBe(0);
      const straight = firstPixel(file);

      const source: MediaSource = { kind: 'video', input: { path: file }, width: SIZE, height: SIZE, duration: 0.4, fps: 25, alpha: false, hasAudio: false };
      const plan = buildMediaRenderPlan({ source, presetId: 'png-still', outputPath: join(dir, `${clip.name}-still`), overwrite: true });
      for (const stage of plan.stages) {
        const ran = spawnSync(ffmpeg.path, stage.args);
        expect(ran.status, `${clip.name}: ${ran.stderr}`).toBe(0);
      }
      const rendered = firstPixel(plan.output);
      // Within 8-bit rounding of the clip as decoded straight: before the fix limited BT.709 red came out 178, 36, 52.
      for (let c = 0; c < 3; c += 1) expect(Math.abs(rendered[c]! - straight[c]!), `${clip.name}: ${rendered} against ${straight}`).toBeLessThanOrEqual(2);
    }
  });
});
