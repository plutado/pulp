/**
 * Image slots' access to the library (ADR 0013). Templates are refused the
 * library outright: the media handler turns away every template page, and the
 * template CSP lists no library scheme. The stills chosen for a template's
 * image slots reach the page another way — the main process reads exactly
 * those files, by library id, and hands the page their bytes for the length of
 * a preview or a render. There is no URL a template could vary to reach a
 * neighbour, and nothing is read for an id that was not chosen.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { imageGrantKey, MAX_IMAGE_FILE_BYTES, type ImageGrantRequest, type ImageStamp } from '../core/image-slot';
import { MEDIA_MIME } from '../core/media-serve';
import { resolveImageCell, sanitizeImageValue } from '../core/image-slot';
import type { TemplateManifest } from '../core/manifest';
import { importedImages, lookupMedia } from './library-service';
import { compositePng, isPsdPath, layerPng, readPsdFile } from './psd-service';

/** One still, ready to be handed to a template page: a data URL the bridge decodes through an <img>. */
export interface SlotImageData {
  id: string;
  /** The grant key (src/core/image-slot.ts): the id, and for a layered file which of it. */
  key: string;
  src: string;
}

/**
 * A batch row's image cells: a library id or a value object passes; a file name is looked up in the
 * Imported folder (milestone 22). Cells that name nothing are reported so the row can be skipped by name.
 */
export function resolveRowImages(manifest: Pick<TemplateManifest, 'parameters'>, params: Record<string, unknown>): { params: Record<string, unknown>; problems: string[] } {
  const out = { ...params };
  const problems: string[] = [];
  let imported: ReturnType<typeof importedImages> | undefined;
  for (const p of manifest.parameters) {
    if (p.type !== 'image' || out[p.id] === undefined || out[p.id] === '') continue;
    if (sanitizeImageValue(out[p.id]) !== undefined) continue;
    imported ??= importedImages();
    const value = resolveImageCell(out[p.id], imported);
    if (value === undefined) problems.push(`${p.label}: "${String(out[p.id])}" is not a library id or a file in the Imported folder`);
    else out[p.id] = value;
  }
  return { params: out, problems };
}

/** The size and modification time of each chosen image, for the render cache key; unknown ids stamp as zero. */
export function imageStamps(ids: readonly string[]): ImageStamp[] {
  return ids.map((id) => {
    const found = lookupMedia(id);
    return { id, size: found?.entry.size ?? 0, mtimeMs: found?.entry.mtimeMs ?? 0 };
  });
}

/** Only ids that are online stills in the library right now; anything else is named back as missing. */
export function checkImages(ids: readonly string[]): { ok: string[]; missing: string[] } {
  const ok: string[] = [];
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const found = lookupMedia(id);
    if (found && found.online && found.entry.kind === 'media' && found.entry.mediaKind === 'image') ok.push(id);
    else missing.push(id);
  }
  return { ok, missing };
}

/**
 * Read the chosen stills for a template page. A file that is too large, gone,
 * or not a still is reported as missing rather than read. The SVG and PNG a
 * user brings are only ever decoded by the page through an <img>, which runs
 * no script and loads nothing external. A layered Photoshop file is handed
 * over composited — with the layers the value hides left out, or as the one
 * layer the value names — as a PNG, since nothing in a page decodes a `.psd`
 * (milestone 33).
 */
export async function readSlotImages(requests: readonly (string | ImageGrantRequest)[]): Promise<{ images: SlotImageData[]; missing: string[] }> {
  const wanted = requests.map((r) => (typeof r === 'string' ? { id: r } : r));
  const { ok, missing } = checkImages(wanted.map((r) => r.id));
  const okSet = new Set(ok);
  const images: SlotImageData[] = [];
  const done = new Set<string>();
  for (const request of wanted) {
    const key = imageGrantKey(request);
    if (done.has(key) || !okSet.has(request.id)) continue;
    done.add(key);
    const found = lookupMedia(request.id);
    if (!found) {
      missing.push(request.id);
      continue;
    }
    const ext = extname(found.entry.path).toLowerCase();
    const mime = MEDIA_MIME[ext];
    if (!mime || !mime.startsWith('image/') || (found.entry.size ?? 0) > MAX_IMAGE_FILE_BYTES) {
      missing.push(request.id);
      continue;
    }
    try {
      if (isPsdPath(found.entry.path)) {
        const read = await readPsdFile(found.entry.path);
        if (!read.ok) {
          missing.push(request.id);
          continue;
        }
        const png = request.psd?.layer ? layerPng(read.document, request.psd.layer) : compositePng(read.document, request.psd?.hide);
        if (!png) {
          missing.push(request.id);
          continue;
        }
        images.push({ id: request.id, key, src: `data:image/png;base64,${png.toString('base64')}` });
        continue;
      }
      const bytes = await readFile(found.entry.path);
      if (bytes.length > MAX_IMAGE_FILE_BYTES) {
        missing.push(request.id);
        continue;
      }
      images.push({ id: request.id, key, src: `data:${mime};base64,${bytes.toString('base64')}` });
    } catch {
      missing.push(request.id);
    }
  }
  return { images, missing: [...new Set(missing)] };
}
