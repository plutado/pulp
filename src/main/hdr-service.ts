/**
 * Converting HDR clips in the main process (milestone 81): whether the
 * ffmpeg in use can do it, and what each clip needs.
 *
 * The recipe itself is pure (`src/core/hdr.ts`) and joins the filter chain
 * wherever a clip's pixels are read — the preview's proxy frames, the
 * render's cut track, an item rendered on its own. What cannot be pure is
 * **whether this build carries zimg**: that is a fact about a program on this
 * machine, which the one reading of the build answers (src/main/ffmpeg-caps.ts).
 */

import { nodeRunner } from '../core/ffmpeg';
import { ffmpegHas } from './ffmpeg-caps';
import { ffprobePathFor, probeMedia } from '../core/media-probe';
import type { HdrFormat } from '../core/hdr';
import type { MediaEntry } from '../core/library-types';

/**
 * Whether this ffmpeg can convert HDR to standard range: zimg's `zscale` and
 * the `tonemap` filter, as the feature table names them (milestone 88), from
 * the one reading of the build every feature shares. A build whose filter
 * list could not be read is not held to it; one that lacks them is a no — the
 * clip is then read as it is, and said to be.
 */
export function canTonemap(ffmpegPath: string): Promise<boolean> {
  return ffmpegHas(ffmpegPath, 'hdr');
}

/** Forget what was learned, for a test that changes the ffmpeg or a file under it. */
export function forgetTonemapping(): void {
  files.clear();
}

/** What a file turned out to be, keyed by path and modification time, so it is read once. */
const files = new Map<string, Promise<HdrFormat | undefined>>();

/**
 * The HDR a clip's file carries. The library's own reading where it has one —
 * and otherwise the file itself, probed here: the background pass that
 * measures a library never runs in a headless render, and a shot quietly
 * delivered washed out because nobody had read it yet is exactly the surprise
 * this milestone is about. A reading taken from a small preview rather than
 * the file (milestone 32) says nothing about color, so it is read too.
 */
export function hdrOf(ffmpegPath: string, entry: Pick<MediaEntry, 'meta' | 'path' | 'mtimeMs'>): Promise<HdrFormat | undefined> {
  if (entry.meta && !entry.meta.fromPreview) return Promise.resolve(entry.meta.hdr);
  const key = `${entry.path}|${entry.mtimeMs}`;
  const asked = files.get(key);
  if (asked) return asked;
  const work = probeMedia(ffprobePathFor(ffmpegPath), entry.path, nodeRunner).then((meta) => meta?.hdr).catch(() => undefined);
  files.set(key, work);
  return work;
}

/**
 * The conversion one clip needs, or undefined: its own HDR when the file is
 * HDR and this ffmpeg can convert it. A standard-range clip, and an HDR one
 * on an ffmpeg without zimg, both answer undefined — the first because there
 * is nothing to do, the second because there is nothing that can be done, and
 * the caller says so.
 */
export async function tonemapFor(ffmpegPath: string, entry: Pick<MediaEntry, 'meta' | 'path' | 'mtimeMs'>): Promise<HdrFormat | undefined> {
  if (ffmpegPath === '') return undefined;
  const hdr = await hdrOf(ffmpegPath, entry);
  if (!hdr) return undefined;
  return (await canTonemap(ffmpegPath)) ? hdr : undefined;
}
