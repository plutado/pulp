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

import { tr } from './i18n';
import { decodePng } from './png';
import { PSD_BLENDS, type Inflate, type PsdBlend, type PsdDocument, type PsdLayer } from './psd';
import { findElement, parseXml, type XmlElement } from './xml';
import { readZip } from './zip';

export { isLayeredExtension, LAYERED_EXTENSIONS } from './psd';

// ---------------------------------------------------------------- what Pulp does not read

/**
 * Design formats Pulp does not read, each named with the export that works instead: in the
 * interface's language now (milestone 59), and the library's line for one a whole sentence of its own.
 */
export const UNREADABLE_DESIGN_FORMATS: Record<string, { readonly what: string; readonly exportAs: string; note(fileName: string): string }> = {
  '.afdesign': {
    get what() { return tr('layered.unreadable.afdesign.what'); },
    get exportAs() { return tr('layered.unreadable.afdesign.export-as'); },
    note: (file) => tr('layered.unreadable.afdesign.note', { file }),
  },
  '.afphoto': {
    get what() { return tr('layered.unreadable.afphoto.what'); },
    get exportAs() { return tr('layered.unreadable.afphoto.export-as'); },
    note: (file) => tr('layered.unreadable.afphoto.note', { file }),
  },
  '.xcf': {
    get what() { return tr('layered.unreadable.xcf.what'); },
    get exportAs() { return tr('layered.unreadable.xcf.export-as'); },
    note: (file) => tr('layered.unreadable.xcf.note', { file }),
  },
  '.sketch': {
    get what() { return tr('layered.unreadable.sketch.what'); },
    get exportAs() { return tr('layered.unreadable.sketch.export-as'); },
    note: (file) => tr('layered.unreadable.sketch.note', { file }),
  },
  '.procreate': {
    get what() { return tr('layered.unreadable.procreate.what'); },
    get exportAs() { return tr('layered.unreadable.procreate.export-as'); },
    note: (file) => tr('layered.unreadable.procreate.note', { file }),
  },
  '.eps': {
    get what() { return tr('layered.unreadable.eps.what'); },
    get exportAs() { return tr('layered.unreadable.eps.export-as'); },
    note: (file) => tr('layered.unreadable.eps.note', { file }),
  },
};

/** The library's one line for a file Pulp cannot read, or null for any other extension. */
export function unreadableDesignNote(fileName: string, ext: string): string | null {
  const known = UNREADABLE_DESIGN_FORMATS[ext.toLowerCase()];
  if (!known) return null;
  return known.note(fileName);
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

/** Why an `.ai` without PDF compatibility is refused, with how to re-save it: in the interface's language now. */
export function aiNoPdfMessage(): string {
  return tr('layered.ai.no-pdf');
}

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
  if (!stackXml) throw new Error('not an OpenRaster file (no stack.xml)'); // i18n-exempt(diagnostic)
  const root = parseXml(stackXml.toString('utf8'));
  if (root.name !== 'image') throw new Error('stack.xml does not hold an image'); // i18n-exempt(diagnostic)
  const width = Math.round(Number(root.attrs.w));
  const height = Math.round(Number(root.attrs.h));
  // i18n-exempt(diagnostic)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('an unreadable canvas size');

  const flat: FlatLayer[] = [];
  const walk = (stack: XmlElement, parentAt: number, depth: number): void => {
    for (const child of stack.children) {
      if (child.name === 'stack') {
        const at = flat.length;
        flat.push({
          parentAt,
          layer: {
            name: child.attrs.name ?? tr('layered.layer.default-group'), kind: 'group', visible: child.attrs.visibility !== 'hidden',
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
            limits.push(tr('layered.limit.picture-unreadable', { reason: (err as Error).message }));
          }
        } else if (src) limits.push(tr('layered.limit.picture-missing', { src }));
        const op = child.attrs['composite-op'] ?? 'svg:src-over';
        const blend = ORA_BLENDS[op];
        if (blend === undefined && op) limits.push(tr('psd.limit.blend', { mode: op.replace(/^svg:/, '') }));
        flat.push({
          parentAt,
          layer: {
            name: child.attrs.name ?? tr('layered.layer.default-name'), kind: 'layer', visible: child.attrs.visibility !== 'hidden',
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

/** What a Krita file's layers cannot do here, said once on the document: in the interface's language now. */
export function kraPixelsLimit(): string {
  return tr('layered.kra.pixels');
}

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
  if (!main) throw new Error('not a Krita file (no maindoc.xml)'); // i18n-exempt(diagnostic)
  const doc = parseXml(main.toString('utf8'));
  const image = findElement(doc, 'IMAGE');
  if (!image) throw new Error('maindoc.xml holds no image'); // i18n-exempt(diagnostic)
  const width = Math.round(Number(image.attrs.width));
  const height = Math.round(Number(image.attrs.height));
  // i18n-exempt(diagnostic)
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
          name: child.attrs.name ?? tr(group ? 'layered.layer.default-group' : 'layered.layer.default-name'), kind: group ? 'group' : 'layer',
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
      throw new Error(`the merged picture could not be read: ${(err as Error).message}`, { cause: err }); // i18n-exempt(diagnostic)
    }
  }
  if (!composite) throw new Error('the file holds no merged picture to show'); // i18n-exempt(diagnostic)
  return { width, height, depth: 8, mode: 'rgb', layers: toDocumentLayers(flat), composite, limits: [kraPixelsLimit()] };
}
