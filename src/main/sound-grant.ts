/**
 * Audio layers' access to the library (milestone 48), under ADR 0013's rule:
 * the main process reads only the sounds a layer named, by library id, and
 * nothing a template page could ask for. A sound is simpler than a clip —
 * there are no frames to decode and hand over, only a file for ffmpeg to read
 * while the render runs — so this is the path and the length, and that is all.
 *
 * The length matters: a layer's in and out points are held to what the file
 * holds, and a looping sound's pass has to be measured before it can be
 * looped. Metadata comes from a background pass a headless render never runs,
 * so the one file a layer names is probed here if it must be. The result is
 * not stored: this is a render's own business, and the library's own pass
 * fills its cache in its own time.
 */

import { resolve, sep } from 'node:path';
import { nodeRunner } from '../core/ffmpeg';
import { probeMedia } from '../core/media-probe';
import type { SoundSource } from '../core/sound-layer';
import { isSafeRelativePath } from '../core/manifest-path';
import { isTemplateSoundFile } from '../core/template-sound';
import { lookupMedia } from './library-service';

/** The size and modification time of each chosen sound, for the render cache key; unknown ids stamp as zero. */
export function soundStamps(ids: readonly string[]): { id: string; size: number; mtimeMs: number }[] {
  return ids.map((id) => {
    const found = lookupMedia(id);
    return { id, size: found?.entry.size ?? 0, mtimeMs: found?.entry.mtimeMs ?? 0 };
  });
}

/** The file behind a sound layer and how long it runs, or null when the library cannot answer for it. */
export async function resolveSoundSource(ffprobePath: string, id: string): Promise<{ path: string; source: SoundSource } | null> {
  const found = lookupMedia(id);
  // A sound is a file with sound in it: an audio item, or a clip whose own track is being used.
  if (!found || !found.online || found.entry.sequence) return null;
  const { entry } = found;
  if (entry.mediaKind !== 'audio' && entry.mediaKind !== 'video') return null;
  const meta = entry.meta ?? (ffprobePath ? await probeMedia(ffprobePath, entry.path, nodeRunner) : null);
  if (!meta?.duration || meta.duration <= 0) return null;
  // A video file chosen as a sound must actually carry one; an audio file is sound by definition.
  if (entry.mediaKind === 'video' && !meta.audioCodec) return null;
  return { path: entry.path, source: { duration: meta.duration } };
}

/**
 * The file behind a template's own sound (milestone 16): a path inside the
 * template folder, named by the manifest and nothing else, probed for its
 * length as a layer's sound is. Held inside the folder the way the template
 * protocol holds its requests, so a manifest cannot name a file outside it.
 */
export async function resolveTemplateSoundFile(
  ffprobePath: string,
  template: { dir: string },
  file: string,
): Promise<{ path: string; source: SoundSource } | null> {
  if (!isSafeRelativePath(file) || !isTemplateSoundFile(file)) return null;
  const root = resolve(template.dir);
  const filePath = resolve(root, file);
  if (filePath !== root && !filePath.startsWith(root + sep)) return null;
  const meta = ffprobePath ? await probeMedia(ffprobePath, filePath, nodeRunner) : null;
  if (!meta?.duration || meta.duration <= 0) return null;
  return { path: filePath, source: { duration: meta.duration } };
}
