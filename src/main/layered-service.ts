/**
 * Layered stills in the main process (milestone 33): one door for every format
 * — Photoshop, OpenRaster, Krita, SVG, and the PDF an `.ai` carries — behind
 * which each is read into the same shape: an outline for the window, a
 * composite with a hidden list, one layer alone. The raster formats composite
 * in pixels (src/core/psd.ts); the vector ones are rebuilt and drawn by the
 * renderer (src/main/rasterize.ts), so they stay sharp at any scale asked.
 *
 * Documents are kept decoded for a while, keyed by path and stat signature,
 * as the Photoshop service keeps its own.
 */

import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { inflateSync } from 'node:zlib';
import { AI_NO_PDF_MESSAGE, isLayeredExtension, parseKra, parseOra, sniffPdf } from '../core/layered';
import { MEDIA_MIME } from '../core/media-serve';
import { fileHiddenLayers, psdOutline, type PsdOutline } from '../core/psd';
import { inlineSvgImages, parseSvgLayers, svgImageHrefs, svgOutline, svgWithLayers, type SvgDocument } from '../core/svg-layers';
import { compositePng, isPsdPath, layerPng, readPsdFile } from './psd-service';
import { lookupMedia } from './library-service';
import { pdfInfo, rasterizePdf, rasterizeSvg, type PdfInfo } from './rasterize';

const inflate = (b: Uint8Array): Uint8Array => new Uint8Array(inflateSync(b));

export function isLayeredPath(path: string): boolean {
  return isLayeredExtension(extname(path));
}

/** One layered file, whatever its format, read and ready to answer. */
export interface LayeredHandle {
  outline: PsdOutline;
  /** The composite as a PNG: the file's own visibility, or exactly these layers hidden. Vector formats draw at `scale`. */
  composite(hide?: readonly string[], scale?: number): Promise<Buffer>;
  /** One layer alone on the whole canvas, or null for one that draws nothing on its own. */
  layer(id: string): Promise<Buffer | null>;
}

export type LayeredResult = { ok: true; handle: LayeredHandle } | { ok: false; message: string };

/** Decoded documents held at once, beside the Photoshop service's own. */
const HELD = 4;
const held = new Map<string, { signature: string; handle: LayeredHandle }>();

async function signatureOf(path: string): Promise<string> {
  const info = await stat(path);
  return `${info.size}:${info.mtimeMs}`;
}

// ---------------------------------------------------------------- per format

async function psdHandle(path: string): Promise<LayeredResult> {
  const read = await readPsdFile(path);
  if (!read.ok) return { ok: false, message: read.message };
  const document = read.document;
  return {
    ok: true,
    handle: {
      outline: psdOutline(document),
      composite: (hide) => Promise.resolve(compositePng(document, hide)),
      layer: (id) => Promise.resolve(layerPng(document, id)),
    },
  };
}

function zipHandle(path: string, bytes: Buffer): LayeredResult {
  try {
    const document = extname(path).toLowerCase() === '.ora' ? parseOra(bytes, inflate) : parseKra(bytes, inflate);
    return {
      ok: true,
      handle: {
        outline: psdOutline(document),
        composite: (hide) => Promise.resolve(compositePng(document, hide)),
        layer: (id) => Promise.resolve(layerPng(document, id)),
      },
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** An image the SVG links, inlined when its file sits beside it (never outside the SVG's folder), as a data URL. */
async function resolveSvgImage(svgPath: string, href: string): Promise<string | null> {
  const dir = resolve(dirname(svgPath));
  const file = resolve(dir, decodeURIComponent(href));
  if (file !== dir && !file.startsWith(dir + sep)) return null;
  const mime = MEDIA_MIME[extname(file).toLowerCase()];
  if (!mime || !mime.startsWith('image/')) return null;
  try {
    const bytes = await readFile(file);
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

async function svgHandle(path: string, text: string): Promise<LayeredResult> {
  let doc: SvgDocument;
  try {
    doc = parseSvgLayers(text);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  // Linked pictures are inlined once, up front, so every composite and layer draws the same file.
  const hrefs = svgImageHrefs(doc.source);
  if (hrefs.length > 0) {
    const resolved = new Map<string, string | null>();
    for (const href of hrefs) resolved.set(href, await resolveSvgImage(path, href));
    const inlined = inlineSvgImages(doc.source, (href) => resolved.get(href) ?? null);
    doc = { ...doc, source: inlined.source };
    if (inlined.missing.length > 0) doc.limits.push(`linked pictures it names are not beside it and are not drawn: ${inlined.missing.join(', ')}`);
  }
  const outline = svgOutline(doc);
  const shownSet = (hide?: readonly string[]): Set<string> => {
    if (hide === undefined) return new Set(doc.layers.filter((l) => l.visible).map((l) => l.id));
    return new Set(doc.layers.map((l) => l.id).filter((id) => !hide.includes(id)));
  };
  return {
    ok: true,
    handle: {
      outline,
      composite: (hide, scale = 1) =>
        rasterizeSvg(doc.layers.length > 0 ? svgWithLayers(doc, shownSet(hide)) : doc.source, doc.width * scale, doc.height * scale),
      layer: (id) => (doc.layers.some((l) => l.id === id) ? rasterizeSvg(svgWithLayers(doc, new Set(), id), doc.width, doc.height) : Promise.resolve(null)),
    },
  };
}

async function pdfHandle(path: string, bytes: Buffer): Promise<LayeredResult> {
  const sniffed = sniffPdf(new Uint8Array(bytes.buffer, bytes.byteOffset, Math.min(1024, bytes.byteLength)));
  const isAi = extname(path).toLowerCase() === '.ai';
  if (sniffed !== 'pdf') {
    if (isAi && sniffed === 'postscript') return { ok: false, message: AI_NO_PDF_MESSAGE };
    return { ok: false, message: isAi ? AI_NO_PDF_MESSAGE : 'not a PDF (no %PDF header)' };
  }
  let info: PdfInfo;
  try {
    info = await pdfInfo(bytes);
  } catch (err) {
    return { ok: false, message: `pdf.js could not read it: ${(err as Error).message}` };
  }
  const limits: string[] = [];
  if (info.pages > 1) limits.push(`only the first of its ${info.pages} pages is read`);
  if (info.groups.length === 0) {
    limits.push(isAi ? 'saved without PDF layers (Illustrator asks when saving), so it is one picture' : 'the file has no layers; only the flattened picture');
  }
  // The file lists groups top first; the shared document is bottom first, so the panel's
  // top-first reversal shows them exactly as the file's layer panel would.
  const bottomFirst = [...info.groups].reverse();
  const layers: PsdOutline['layers'] = bottomFirst.map((g, i) => ({
    id: `L${i}`, name: g.name, kind: 'layer' as const, visible: g.visible, opacity: 1, blend: 'normal' as const, blendKey: 'norm',
    left: 0, top: 0, width: info.width, height: info.height, parent: null, depth: g.depth, limits: [], hasPixels: true,
  }));
  const ocgByLayer = new Map(layers.map((l, i) => [l.id, bottomFirst[i]!.ocgId]));
  const outline: PsdOutline = { width: info.width, height: info.height, layers, limits, hasComposite: true };
  const shownOcgs = (hide?: readonly string[]): readonly string[] | undefined => {
    if (hide === undefined) return undefined; // the file's own switches
    return layers.filter((l) => !hide.includes(l.id)).map((l) => ocgByLayer.get(l.id)!);
  };
  return {
    ok: true,
    handle: {
      outline,
      composite: (hide, scale = 1) => rasterizePdf(bytes, scale, shownOcgs(hide)),
      layer: (id) => (ocgByLayer.has(id) ? rasterizePdf(bytes, 1, [ocgByLayer.get(id)!]) : Promise.resolve(null)),
    },
  };
}

// ---------------------------------------------------------------- the one door

/** The handle for a layered file, read once per change of the file. */
export async function layeredFileFor(path: string): Promise<LayeredResult> {
  if (!isLayeredPath(path)) return { ok: false, message: `${basename(path)} is not a layered still` };
  if (isPsdPath(path)) return psdHandle(path); // the Photoshop service keeps its own cache
  let signature: string;
  try {
    signature = await signatureOf(path);
  } catch (err) {
    return { ok: false, message: `could not read the file: ${(err as Error).message}` };
  }
  const kept = held.get(path);
  if (kept && kept.signature === signature) {
    held.delete(path);
    held.set(path, kept);
    return { ok: true, handle: kept.handle };
  }
  const ext = extname(path).toLowerCase();
  let made: LayeredResult;
  try {
    if (ext === '.svg') made = await svgHandle(path, await readFile(path, 'utf8'));
    else if (ext === '.ora' || ext === '.kra') made = zipHandle(path, await readFile(path));
    else made = await pdfHandle(path, await readFile(path));
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  if (made.ok) {
    held.set(path, { signature, handle: made.handle });
    while (held.size > HELD) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) break;
      held.delete(oldest);
    }
  }
  return made;
}

/** A library item's outline, by id (milestone 33): any layered format, or why it cannot be read. */
export async function layeredOutlineFor(id: string): Promise<{ ok: true; outline: PsdOutline } | { ok: false; message: string }> {
  const found = lookupMedia(id);
  if (!found || found.entry.kind !== 'media' || !isLayeredPath(found.entry.path)) return { ok: false, message: 'not a layered file in the library' };
  if (!found.online) return { ok: false, message: 'its folder is offline' };
  const read = await layeredFileFor(found.entry.path);
  return read.ok ? { ok: true, outline: read.handle.outline } : read;
}

/** The hidden list a composite starts from when none is given: the file's own. */
export function fileHiddenOf(outline: PsdOutline): string[] {
  return fileHiddenLayers(outline.layers);
}
