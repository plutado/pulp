/**
 * Layered stills beyond Photoshop (milestone 33): which formats Pulp reads as
 * layers, the OpenRaster and Krita readers (a zip of PNGs and an XML stack,
 * decoded into the same document the `.psd` reader produces, so everything
 * downstream — the layer list, hiding, placing, splitting, rendering — is one
 * path), the sniff that tells a PDF-compatible `.ai` from one that is not, and
 * the formats Pulp does not read, each named with the export that works.
 *
 * Pure: bytes in (with zlib injected), structure and pixels out. The vector
 * formats' pixels come from the rasterizer in the main process
 * (src/main/layered-service.ts); their structure is read here (SVG) or by
 * pdf.js in the rasterizer page (PDF).
 */

import { decodePng } from './png';
import { PSD_BLENDS, type Inflate, type PsdBlend, type PsdDocument, type PsdLayer } from './psd';
import { findElement, parseXml, type XmlElement } from './xml';
import { readZip } from './zip';

export { isLayeredExtension, LAYERED_EXTENSIONS } from './psd';

// ---------------------------------------------------------------- what Pulp does not read

/** Design formats Pulp does not read, each named with the export that works instead. */
export const UNREADABLE_DESIGN_FORMATS: Record<string, { what: string; exportAs: string }> = {
  '.afdesign': { what: 'an Affinity Designer file', exportAs: 'export it as PSD, SVG or PDF from Affinity Designer' },
  '.afphoto': { what: 'an Affinity Photo file', exportAs: 'export it as PSD from Affinity Photo' },
  '.xcf': { what: 'a GIMP file', exportAs: 'export it as PSD (File → Export As) from GIMP' },
  '.sketch': { what: 'a Sketch file', exportAs: 'export its artboards as SVG or PDF from Sketch' },
  '.procreate': { what: 'a Procreate canvas', exportAs: 'share it as PSD from Procreate' },
  '.eps': { what: 'an EPS file', exportAs: 'save it as .ai with "Create PDF Compatible File" on, or export SVG or PDF' },
};

/** The library's one line for a file Pulp cannot read, or null for any other extension. */
export function unreadableDesignNote(fileName: string, ext: string): string | null {
  const known = UNREADABLE_DESIGN_FORMATS[ext.toLowerCase()];
  if (!known) return null;
  return `${fileName} is ${known.what}, which Pulp does not read; ${known.exportAs} and add that instead.`;
}

// ---------------------------------------------------------------- a PDF, or an .ai that carries one

export type PdfSniff = 'pdf' | 'postscript' | 'neither';

/** What the first bytes say: a PDF (an `.ai` saved with PDF compatibility is one), PostScript (one saved without), or neither. */
export function sniffPdf(bytes: Uint8Array): PdfSniff {
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(1024, bytes.length)));
  if (head.includes('%PDF-')) return 'pdf';
  if (head.startsWith('%!PS')) return 'postscript';
  return 'neither';
}

/** Why an `.ai` without PDF compatibility is refused, with how to re-save it. */
export const AI_NO_PDF_MESSAGE =
  'this .ai was saved without PDF compatibility, so only Illustrator can read it; re-save it with "Create PDF Compatible File" on (Illustrator has it on by default)';

// ---------------------------------------------------------------- OpenRaster

const ORA_BLENDS: Record<string, PsdBlend> = Object.fromEntries(PSD_BLENDS.map((b) => [`svg:${b}`, b]));
ORA_BLENDS['svg:src-over'] = 'normal';

interface FlatLayer {
  layer: Omit<PsdLayer, 'id' | 'parent'>;
  /** Index into the top-first list of the group this sits in, or -1. */
  parentAt: number;
}

/** Top-first tree entries into the bottom-first array the PSD model uses, ids and parents assigned. */
function toDocumentLayers(topFirst: FlatLayer[]): PsdLayer[] {
  const count = topFirst.length;
  const idAt = (topFirstIndex: number) => `L${count - 1 - topFirstIndex}`;
  return topFirst
    .map((entry, i) => ({ ...entry.layer, id: idAt(i), parent: entry.parentAt === -1 ? null : idAt(entry.parentAt) }))
    .reverse();
}

/**
 * Read an OpenRaster file: `stack.xml` names the layers top first, each a PNG
 * in the archive; groups are nested stacks. The merged picture is the stored
 * composite. Blend modes that are the canvas set draw; the rest are named.
 */
export function parseOra(bytes: Buffer, inflate: Inflate): PsdDocument {
  const entries = readZip(bytes);
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const stackXml = byName.get('stack.xml');
  if (!stackXml) throw new Error('not an OpenRaster file (no stack.xml)');
  const root = parseXml(stackXml.toString('utf8'));
  if (root.name !== 'image') throw new Error('stack.xml does not hold an image');
  const width = Math.round(Number(root.attrs.w));
  const height = Math.round(Number(root.attrs.h));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('an unreadable canvas size');

  const flat: FlatLayer[] = [];
  const walk = (stack: XmlElement, parentAt: number, depth: number): void => {
    for (const child of stack.children) {
      if (child.name === 'stack') {
        const at = flat.length;
        flat.push({
          parentAt,
          layer: {
            name: child.attrs.name ?? 'Group', kind: 'group', visible: child.attrs.visibility !== 'hidden',
            opacity: child.attrs.opacity === undefined ? 1 : Math.max(0, Math.min(1, Number(child.attrs.opacity))),
            blend: 'normal', blendKey: child.attrs['composite-op'] ?? 'svg:src-over', left: 0, top: 0, width: 0, height: 0, depth, limits: [],
          },
        });
        walk(child, at, depth + 1);
      } else if (child.name === 'layer') {
        const src = child.attrs.src ?? '';
        const data = byName.get(src.replace(/^\.\//, ''));
        const limits: string[] = [];
        let pixels: Uint8Array | undefined;
        let w = 0;
        let h = 0;
        if (data) {
          try {
            const png = decodePng(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), inflate);
            pixels = png.rgba;
            w = png.width;
            h = png.height;
          } catch (err) {
            limits.push(`its picture could not be read: ${(err as Error).message}`);
          }
        } else if (src) limits.push(`the archive is missing its picture (${src})`);
        const op = child.attrs['composite-op'] ?? 'svg:src-over';
        const blend = ORA_BLENDS[op];
        if (blend === undefined && op) limits.push(`blend mode "${op.replace(/^svg:/, '')}" drawn as normal`);
        flat.push({
          parentAt,
          layer: {
            name: child.attrs.name ?? 'Layer', kind: 'layer', visible: child.attrs.visibility !== 'hidden',
            opacity: child.attrs.opacity === undefined ? 1 : Math.max(0, Math.min(1, Number(child.attrs.opacity))),
            blend: blend ?? 'normal', blendKey: op,
            left: Math.round(Number(child.attrs.x ?? 0)) || 0, top: Math.round(Number(child.attrs.y ?? 0)) || 0,
            width: w, height: h, depth, limits, ...(pixels ? { pixels } : {}),
          },
        });
      }
    }
  };
  const rootStack = root.children.find((c) => c.name === 'stack');
  if (rootStack) walk(rootStack, -1, 0);

  let composite: Uint8Array | null = null;
  const merged = byName.get('mergedimage.png');
  if (merged) {
    try {
      const png = decodePng(new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength), inflate);
      if (png.width === width && png.height === height) composite = png.rgba;
    } catch {
      // The layers composite instead; nothing to say.
    }
  }
  return { width, height, depth: 8, mode: 'rgb', layers: toDocumentLayers(flat), composite, limits: [] };
}

// ---------------------------------------------------------------- Krita

/** What a Krita file's layers cannot do here, said once on the document. */
export const KRA_PIXELS_LIMIT =
  'Krita keeps layer pixels in its own tile format, which Pulp does not read: the merged picture stands in, and layers cannot be shown or hidden here. Export OpenRaster (.ora) from Krita for workable layers.';

/**
 * Read a Krita file: `maindoc.xml` names the layers (top first, groups nested),
 * and `mergedimage.png` is the picture. The layers list what the file holds —
 * the pixels themselves are Krita's own format, which is said rather than
 * half-read.
 */
export function parseKra(bytes: Buffer, inflate: Inflate): PsdDocument {
  const entries = readZip(bytes);
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const main = byName.get('maindoc.xml');
  if (!main) throw new Error('not a Krita file (no maindoc.xml)');
  const doc = parseXml(main.toString('utf8'));
  const image = findElement(doc, 'IMAGE');
  if (!image) throw new Error('maindoc.xml holds no image');
  const width = Math.round(Number(image.attrs.width));
  const height = Math.round(Number(image.attrs.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('an unreadable canvas size');

  const flat: FlatLayer[] = [];
  const walk = (layers: XmlElement, parentAt: number, depth: number): void => {
    for (const child of layers.children) {
      if (child.name !== 'layer') continue;
      const group = child.attrs.nodetype === 'grouplayer';
      const at = flat.length;
      flat.push({
        parentAt,
        layer: {
          name: child.attrs.name ?? (group ? 'Group' : 'Layer'), kind: group ? 'group' : 'layer',
          visible: child.attrs.visible !== '0', opacity: child.attrs.opacity === undefined ? 1 : Math.max(0, Math.min(1, Number(child.attrs.opacity) / 255)),
          blend: 'normal', blendKey: child.attrs.compositeop ?? 'normal',
          left: Math.round(Number(child.attrs.x ?? 0)) || 0, top: Math.round(Number(child.attrs.y ?? 0)) || 0,
          width: 0, height: 0, depth, limits: [],
        },
      });
      if (group) {
        const inner = child.children.find((c) => c.name === 'layers');
        if (inner) walk(inner, at, depth + 1);
      }
    }
  };
  const layersEl = findElement(image, 'layers');
  if (layersEl) walk(layersEl, -1, 0);

  let composite: Uint8Array | null = null;
  const merged = byName.get('mergedimage.png');
  if (merged) {
    try {
      composite = decodePng(new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength), inflate).rgba;
    } catch (err) {
      throw new Error(`the merged picture could not be read: ${(err as Error).message}`, { cause: err });
    }
  }
  if (!composite) throw new Error('the file holds no merged picture to show');
  return { width, height, depth: 8, mode: 'rgb', layers: toDocumentLayers(flat), composite, limits: [KRA_PIXELS_LIMIT] };
}
