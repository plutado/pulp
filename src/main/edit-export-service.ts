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
import { tr } from '../core/i18n';
import { homedir } from 'node:os';
import { healedTrack, trackDuration } from '../core/cut-track';
import { edlEdit, fcpxmlEdit, type EditClip, type EditOverlay } from '../core/edit-export';
import { lengthIn, splitLayers, trackIn, withLayers, withTrack } from '../core/params';
import { resolveLength } from '../core/timing';
import { aspectOf, templateDefaultSize } from '../core/aspect';
import { placementFor, type Layer, type LayerValues } from '../core/layers';
import { clipWindow } from '../core/video-layer';
import type { TemplateEntry } from '../core/library-types';
import { findMediaIdByPath, findTemplate, lookupClipItem } from './library-service';
import { ffprobePathFor } from '../core/media-probe';
import { detectFfmpeg } from '../core/ffmpeg';
import { resolveClipAudio, resolveClipSource } from './clip-grant';
import { clipSetFile } from './clip-set-service';
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
  if (!template) return { ok: false, message: tr('export-edit.no-template') };
  let track = trackIn(params);
  if (!track || track.cuts.length === 0) return { ok: false, message: tr('export-edit.no-track') };

  let base = answer;
  if (!base) {
    const pick = await dialog.showSaveDialog({
      title: tr('dialog.export-edit.title'),
      defaultPath: join(homedir(), `${request?.name ?? template.manifest.name}.fcpxml`),
      filters: [{ name: tr('dialog.export-edit.filter'), extensions: ['fcpxml'] }],
    });
    if (pick.canceled || !pick.filePath) return { ok: false, cancelled: true, message: '' };
    base = pick.filePath;
  }
  base = base.replace(/\.(fcpxml|edl)$/i, '');

  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg.ok) return { ok: false, message: tr('export-edit.no-ffmpeg') };

  const manifest = template.manifest;
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
      return { ok: false, message: tr('export-edit.clip-unreadable') };
    }
    // A clip set on the track goes to the editor as its set file (milestone 32): the parts stitched
    // once, with their sound, in Pulp's own cache — one clip the editor can reference.
    if (found.entry.clipSet) {
      const made = await clipSetFile(cut.id);
      if (!made.ok) return { ok: false, message: tr('export-edit.clip-unreadable') };
      clips[cut.id] = { path: made.path, name: found.entry.name, duration: made.seconds, audio: made.hasAudio };
      continue;
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
  // The piece's own length, which a clip set placed as a layer is stitched to for the editor.
  const pieceSeconds = resolveLength(manifest.duration, manifest.structure ?? null, lengthIn(params) ?? trackDuration(track));

  // The second picture track (milestone 57): every video layer with a clip, as a connected clip
  // of its own in the exported edit — so the graphics are rendered **without** them, and the
  // editor gets the clips in place rather than burned into the titles.
  const size = templateDefaultSize(manifest);
  const { layers: rawLayers } = splitLayers(params);
  const overlays: EditOverlay[] = [];
  const withoutOverlays: LayerValues = {};
  for (const block of manifest.blocks) {
    const stack = rawLayers[block.id] ?? block.layers;
    const kept: Layer[] = [];
    for (const layer of stack) {
      if (layer.type !== 'video' || !layer.clip?.id || layer.hidden || layer.clip.hidden) {
        kept.push(layer);
        continue;
      }
      const found = lookupClipItem(layer.clip.id);
      // A drawn asset or a Lottie is a layer of the graphics, not a clip an editor can reference.
      if (!found || found.kind !== 'media' || found.entry.sequence) {
        kept.push(layer);
        continue;
      }
      let source = await resolveClipSource(ffprobePathFor(ffmpeg.path), layer.clip.id);
      if (!source) {
        kept.push(layer);
        continue;
      }
      // A clip set placed as a layer goes to the editor stitched to the stretch it plays for, from
      // its delay to the end of the piece at its speed (milestone 32): one clip, as the render shows it.
      const setKey = `${layer.clip.id}@${block.id}.${layer.id}`;
      let clipId = layer.clip.id;
      let clipValue = layer.clip;
      if (found.entry.clipSet) {
        const speed = layer.clip.speed > 0 ? layer.clip.speed : 1;
        const seconds = Math.max(0, (pieceSeconds - Math.max(0, layer.clip.delay)) * speed);
        const made = seconds > 0 ? await clipSetFile(layer.clip.id, seconds) : null;
        if (!made?.ok) {
          kept.push(layer);
          continue;
        }
        clipId = setKey;
        clips[clipId] = { path: made.path, name: found.entry.name, duration: made.seconds, audio: made.hasAudio };
        source = { frames: Math.max(1, Math.round(made.seconds * source.fps)), fps: source.fps };
        clipValue = { ...layer.clip, inPoint: 0, outPoint: -1 };
      } else if (!clips[layer.clip.id]) {
        const audio = await resolveClipAudio(ffprobePathFor(ffmpeg.path), layer.clip.id);
        clips[layer.clip.id] = { path: found.entry.path, name: found.entry.name, duration: source.frames / Math.max(1, source.fps), audio: audio?.hasAudio === true };
      }
      const window = clipWindow(clipValue, source);
      const placement = placementFor(layer.placement, aspectOf(size.width, size.height));
      const short = Math.min(size.width, size.height);
      overlays.push({
        id: clipId,
        name: layer.label,
        from: window.first / Math.max(1, source.fps),
        to: (window.last + 1) / Math.max(1, source.fps),
        at: layer.span?.start ?? Math.max(0, layer.clip.delay),
        speed: layer.clip.speed > 0 ? layer.clip.speed : 1,
        dx: placement.dx,
        dy: placement.dy,
        height: (layer.size * short * placement.scale) / size.height,
        ...(layer.clip.crop ? { crop: layer.clip.crop } : {}),
      });
      kept.push({ ...layer, hidden: true });
    }
    if (rawLayers[block.id] || kept.some((l) => l.hidden)) withoutOverlays[block.id] = kept;
  }

  // The graphics alone, with alpha: the project minus its track and its picture track, at the
  // piece's own length.
  const graphics = `${base}-graphics.mov`;
  const rendered = await renderTemplate({
    template,
    params: withLayers(withTrack(params, null), Object.keys(withoutOverlays).length > 0 ? withoutOverlays : undefined),
    presetId: 'prores-4444',
    outputPath: graphics,
    overwrite: true,
  });
  if (!rendered.ok) return { ok: false, message: tr('export-edit.render-failed', { reason: rendered.message }) };

  const name = (request?.name ?? template.manifest.name) || basename(base);
  const seconds = resolveLength(manifest.duration, manifest.structure ?? null, lengthIn(params) ?? trackDuration(track));
  const input = {
    name, fps: manifest.fps, width: size.width, height: size.height, track, clips,
    graphics: { path: graphics, seconds },
    ...(overlays.length > 0 ? { overlays } : {}),
  };
  const fcpxml = `${base}.fcpxml`;
  const edl = `${base}.edl`;
  try {
    await writeFile(fcpxml, fcpxmlEdit(input));
    await writeFile(edl, edlEdit(input));
  } catch (err) {
    return { ok: false, message: tr('export-edit.write-failed', { folder: basename(dirname(base)), reason: (err as Error).message }) };
  }
  return { ok: true, fcpxml, edl, graphics };
}
