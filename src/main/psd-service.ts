/**
 * Layered Photoshop files in the main process (milestone 33): reading a `.psd`
 * from the library by id, its structure for the window, and PNGs of its
 * composite — with layers hidden — or of one layer alone, for the stage, the
 * thumbnail and the image grant. What a file *is* lives in src/core/psd.ts;
 * this reads, caches and encodes.
 *
 * Documents are kept decoded for a while, keyed by path and stat signature, so
 * toggling a layer does not re-read a large file; a handful at a time, oldest
 * out first.
 */

import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { encodePng } from '../core/png';
import { compositePsd, fileHiddenLayers, layerOnCanvas, parsePsd, PSD_EXTENSION, psdOutline, type PsdDocument, type PsdOutline } from '../core/psd';
import { lookupMedia } from './library-service';

/** Decoded documents held at once; a layered still is a few tens of megabytes decoded. */
const DOCUMENTS_KEPT = 4;

const documents = new Map<string, { signature: string; document: PsdDocument }>();

export function isPsdPath(path: string): boolean {
  return extname(path).toLowerCase() === PSD_EXTENSION;
}

export type PsdRead = { ok: true; document: PsdDocument } | { ok: false; message: string };

/** The document behind a file, read once per change of the file. */
export async function readPsdFile(path: string): Promise<PsdRead> {
  let signature: string;
  try {
    const info = await stat(path);
    signature = `${info.size}:${info.mtimeMs}`;
  } catch (err) {
    return { ok: false, message: `could not read the file: ${(err as Error).message}` };
  }
  const held = documents.get(path);
  if (held && held.signature === signature) {
    documents.delete(path);
    documents.set(path, held);
    return { ok: true, document: held.document };
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    return { ok: false, message: `could not read the file: ${(err as Error).message}` };
  }
  const parsed = parsePsd(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (!parsed.ok) return parsed;
  documents.set(path, { signature, document: parsed.document });
  while (documents.size > DOCUMENTS_KEPT) {
    const oldest = documents.keys().next().value;
    if (oldest === undefined) break;
    documents.delete(oldest);
  }
  return { ok: true, document: parsed.document };
}

/** A library item's document, by id: only an online `.psd` the library has. */
export async function readPsdItem(id: string): Promise<PsdRead> {
  const found = lookupMedia(id);
  if (!found || found.entry.kind !== 'media' || !isPsdPath(found.entry.path)) return { ok: false, message: 'not a layered file in the library' };
  if (!found.online) return { ok: false, message: 'its folder is offline' };
  return readPsdFile(found.entry.path);
}

export type PsdOutlineResult = { ok: true; outline: PsdOutline } | { ok: false; message: string };

/** The structure for the window: layers without pixels, and what is not reproduced. */
export async function psdOutlineFor(id: string): Promise<PsdOutlineResult> {
  const read = await readPsdItem(id);
  return read.ok ? { ok: true, outline: psdOutline(read.document) } : read;
}

const deflate = (bytes: Uint8Array): Uint8Array => new Uint8Array(deflateSync(bytes));

/** The composite with a hidden list — the file's own when none is given — as a PNG. */
export function compositePng(document: PsdDocument, hidden?: readonly string[]): Buffer {
  const set = new Set(hidden ?? fileHiddenLayers(document.layers));
  return Buffer.from(encodePng(compositePsd(document, set), document.width, document.height, deflate));
}

/** One layer alone, on a transparent canvas the size of the file, as a PNG; null for a layer that draws nothing. */
export function layerPng(document: PsdDocument, layerId: string): Buffer | null {
  const layer = layerOnCanvas(document, layerId);
  if (!layer) return null;
  const canvas = new Uint8Array(document.width * document.height * 4);
  const x0 = Math.max(0, layer.left);
  const y0 = Math.max(0, layer.top);
  const x1 = Math.min(document.width, layer.left + layer.width);
  const y1 = Math.min(document.height, layer.top + layer.height);
  for (let y = y0; y < y1; y += 1) {
    const srcStart = ((y - layer.top) * layer.width + (x0 - layer.left)) * 4;
    canvas.set(layer.pixels.subarray(srcStart, srcStart + (x1 - x0) * 4), (y * document.width + x0) * 4);
  }
  return Buffer.from(encodePng(canvas, document.width, document.height, deflate));
}

/** Parse a `?hide=L1+L4` query into layer ids; anything odd is ignored. */
export function hiddenFromQuery(value: string | null): string[] | undefined {
  if (value === null) return undefined;
  return value.split(/[+,]/).map((s) => s.trim()).filter((s) => /^L\d+$/.test(s));
}
