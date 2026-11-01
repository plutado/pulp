/**
 * Exporting the edit (milestone 49): the cut track written as FCPXML and an
 * EDL beside a ProRes 4444 render of the graphics alone — the project with
 * its track taken out, so the editing app gets the shots referenced in place
 * and the titles above them with alpha, and an assembly started in Pulp is
 * finished there. The window names a template and a bag of parameters, never
 * a path (ADR 0013); the save dialog asks where, or a test and the command
 * line say outright.
 */

import { dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { healedTrack, trackDuration } from '../core/cut-track';
import { edlEdit, fcpxmlEdit, type EditClip } from '../core/edit-export';
import { lengthIn, trackIn, withTrack } from '../core/params';
import { resolveLength } from '../core/timing';
import { templateDefaultSize } from '../core/aspect';
import type { TemplateEntry } from '../core/library-types';
import { findMediaIdByPath, findTemplate, lookupClipItem } from './library-service';
import { ffprobePathFor } from '../core/media-probe';
import { detectFfmpeg } from '../core/ffmpeg';
import { resolveClipAudio, resolveClipSource } from './clip-grant';
import { renderTemplate } from './render';

export type ExportEditResult = { ok: true; fcpxml: string; edl: string; graphics: string } | { ok: false; cancelled?: boolean; message: string };

/**
 * Write `<base>.fcpxml`, `<base>.edl` and `<base>-graphics.mov` for the
 * project's cut track. `answer` names the base path for tests and the command
 * line; without one the save dialog asks.
 */
export async function exportEdit(raw: unknown, answer?: string, found?: TemplateEntry): Promise<ExportEditResult> {
  const request = raw as Partial<{ templateId: string; name: string; params: Record<string, unknown> }>;
  const params = (typeof request?.params === 'object' && request.params !== null ? request.params : {}) as Record<string, unknown>;
  // The command line hands the entry it already found; the window names an id for the library.
  const template = found ?? (typeof request?.templateId === 'string' ? await findTemplate(request.templateId) : undefined);
  if (!template) return { ok: false, message: 'The template being edited is not in the library.' };
  let track = trackIn(params);
  if (!track || track.cuts.length === 0) return { ok: false, message: 'The project has no cut track to export.' };

  let base = answer;
  if (!base) {
    const pick = await dialog.showSaveDialog({
      title: 'Export the edit for an editing app',
      defaultPath: join(homedir(), `${request?.name ?? template.manifest.name}.fcpxml`),
      filters: [{ name: 'Final Cut Pro XML', extensions: ['fcpxml'] }],
    });
    if (pick.canceled || !pick.filePath) return { ok: false, cancelled: true, message: '' };
    base = pick.filePath;
  }
  base = base.replace(/\.(fcpxml|edl)$/i, '');

  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, message: 'FFmpeg was not found, so the graphics cannot be rendered.' };

  // A saved project's clips may have moved: heal each cut by the path it remembers before anything
  // is referenced, the same healing a render runs.
  track = healedTrack(track, (cut) => {
    if (lookupClipItem(cut.id)) return null;
    const found = cut.path ? findMediaIdByPath(cut.path) : undefined;
    return found ? { id: found.id, path: found.path } : null;
  });

  const clips: Record<string, EditClip> = {};
  for (const cut of track.cuts) {
    if (clips[cut.id]) continue;
    const found = lookupClipItem(cut.id);
    if (!found || found.kind !== 'media' || found.entry.sequence) {
      return { ok: false, message: 'A clip on the cut track is not in the library, is offline, or is not a file an editor can reference.' };
    }
    const source = await resolveClipSource(ffprobePathFor(ffmpeg.path), cut.id);
    const audio = await resolveClipAudio(ffprobePathFor(ffmpeg.path), cut.id);
    clips[cut.id] = {
      path: found.entry.path,
      name: found.entry.name,
      duration: source ? source.frames / Math.max(1, source.fps) : cut.to,
      audio: audio?.hasAudio === true,
    };
  }

  // The graphics alone, with alpha: the project minus its track, at the piece's own length.
  const graphics = `${base}-graphics.mov`;
  const rendered = await renderTemplate({
    template,
    params: withTrack(params, null),
    presetId: 'prores-4444',
    outputPath: graphics,
    overwrite: true,
  });
  if (!rendered.ok) return { ok: false, message: `The graphics could not be rendered: ${rendered.message}` };

  const name = (request?.name ?? template.manifest.name) || basename(base);
  const manifest = template.manifest;
  const size = templateDefaultSize(manifest);
  const seconds = resolveLength(manifest.duration, manifest.structure ?? null, lengthIn(params) ?? trackDuration(track));
  const input = {
    name, fps: manifest.fps, width: size.width, height: size.height, track, clips,
    graphics: { path: graphics, seconds },
  };
  const fcpxml = `${base}.fcpxml`;
  const edl = `${base}.edl`;
  try {
    await writeFile(fcpxml, fcpxmlEdit(input));
    await writeFile(edl, edlEdit(input));
  } catch (err) {
    return { ok: false, message: `The edit could not be written beside ${basename(dirname(base))}: ${(err as Error).message}` };
  }
  return { ok: true, fcpxml, edl, graphics };
}
