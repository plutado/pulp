/**
 * An SVG as layers (milestone 33): its top-level groups — Illustrator writes
 * each layer as a named `<g>`, Inkscape marks its layers outright — shown,
 * hidden and placed like a Photoshop file's layers, and drawn by the renderer
 * itself so the picture stays sharp at any size. A file with no top-level
 * groups is one layer.
 *
 * The pure part: the structure, and the document text rebuilt for a given set
 * of shown layers (or one layer alone) by splicing groups out and clearing the
 * hiding styles of ones being shown. The rasterizing happens in the main
 * process (src/main/layered-service.ts), where the rebuilt text is drawn
 * through an `<img>` — Chromium's SVG-as-image mode, which runs no scripts and
 * fetches nothing external — so a file from anywhere stays a picture.
 */

import type { PsdOutline } from './psd';
import { parseXml, type XmlElement } from './xml';

export interface SvgLayerSource {
  /** "L0" bottom first, as the PSD model numbers; L0 is the first group in the file (painted first). */
  id: string;
  name: string;
  /** As the file has it (display:none or visibility:hidden on the group). */
  visible: boolean;
  /** The group's source range, for splicing. */
  start: number;
  end: number;
  openEnd: number;
}

export interface SvgDocument {
  width: number;
  height: number;
  layers: SvgLayerSource[];
  limits: string[];
  source: string;
}

/** A dimension attribute in CSS pixels; pt and other units converted, percentages refused. */
function dimension(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^\s*([\d.]+)\s*(px|pt|mm|cm|in)?\s*$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? 'px';
  const scale = unit === 'pt' ? 96 / 72 : unit === 'in' ? 96 : unit === 'mm' ? 96 / 25.4 : unit === 'cm' ? 96 / 2.54 : 1;
  return Number.isFinite(n) && n > 0 ? n * scale : null;
}

function hiddenByAttrs(attrs: Record<string, string>): boolean {
  if (attrs.display === 'none' || attrs.visibility === 'hidden') return true;
  const style = attrs.style ?? '';
  return /(?:^|;)\s*display\s*:\s*none/.test(style) || /(?:^|;)\s*visibility\s*:\s*hidden/.test(style);
}

function layerName(attrs: Record<string, string>, index: number): string {
  return attrs['inkscape:label'] || attrs['aria-label'] || attrs['data-name'] || attrs.id || `Layer ${index + 1}`;
}

function findAll(root: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  if (root.name === name) out.push(root);
  for (const child of root.children) findAll(child, name, out);
  return out;
}

/** Read an SVG's size and top-level groups, and what of it is named rather than drawn. */
export function parseSvgLayers(source: string): SvgDocument {
  const root = parseXml(source);
  if (root.name !== 'svg' && !root.name.endsWith(':svg')) throw new Error('not an SVG (no <svg> root)');
  let width = dimension(root.attrs.width);
  let height = dimension(root.attrs.height);
  const viewBox = (root.attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
  if ((!width || !height) && viewBox.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0) {
    // Keep the shape the viewBox declares; one given side scales the other.
    if (width && !height) height = (width * viewBox[3]!) / viewBox[2]!;
    else if (height && !width) width = (height * viewBox[2]!) / viewBox[3]!;
    else {
      width = viewBox[2]!;
      height = viewBox[3]!;
    }
  }
  if (!width || !height) throw new Error('the file declares no size and no viewBox');

  const groups = root.children.filter((c) => c.name === 'g');
  const layers: SvgLayerSource[] = groups.map((g, i) => ({
    id: `L${i}`,
    name: layerName(g.attrs, i),
    visible: !hiddenByAttrs(g.attrs),
    start: g.start,
    end: g.end,
    openEnd: g.openEnd,
  }));

  const limits: string[] = [];
  if (findAll(root, 'script').length > 0) limits.push('scripts inside the file are not run');
  if (findAll(root, 'foreignObject').length > 0) limits.push('embedded HTML (foreignObject) is not drawn');
  if (/@font-face|font-family\s*:/.test(source) || findAll(root, 'text').length > 0) {
    if (/@font-face/.test(source)) limits.push('fonts the file carries or names are not loaded; its text draws in a default face');
  }
  return { width: Math.round(width), height: Math.round(height), layers, limits, source };
}

/** The outline the window shows, in the shape every layered format shares. */
export function svgOutline(doc: SvgDocument): PsdOutline {
  return {
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map((l) => ({
      id: l.id, name: l.name, kind: 'layer' as const, visible: l.visible, opacity: 1, blend: 'normal' as const, blendKey: 'norm',
      left: 0, top: 0, width: doc.width, height: doc.height, parent: null, depth: 0, limits: [],
    })),
    limits: doc.limits,
    hasComposite: true,
  };
}

/** A group's opening tag with its hiding attributes and style declarations cleared, so a shown layer really shows. */
export function shownOpeningTag(tag: string): string {
  return tag
    .replace(/\s(?:display|visibility)\s*=\s*(?:"[^"]*"|'[^']*')/g, '')
    .replace(/(\sstyle\s*=\s*")([^"]*)(")/g, (_m, a: string, style: string, z: string) => `${a}${style.replace(/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*/g, ';')}${z}`)
    .replace(/(\sstyle\s*=\s*')([^']*)(')/g, (_m, a: string, style: string, z: string) => `${a}${style.replace(/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*/g, ';')}${z}`);
}

/**
 * The document with exactly these top-level groups shown: the others spliced
 * out, hidden ones being shown re-styled to show, everything that is not a
 * top-level group (defs, styles, gradients, loose elements) kept. `isolate`
 * keeps one group and drops the rest, for a layer placed on its own.
 */
export function svgWithLayers(doc: SvgDocument, shown: ReadonlySet<string>, isolate?: string): string {
  let out = '';
  let at = 0;
  for (const layer of doc.layers) {
    out += doc.source.slice(at, layer.start);
    const keep = isolate !== undefined ? layer.id === isolate : shown.has(layer.id);
    if (keep) {
      const tag = doc.source.slice(layer.start, layer.openEnd);
      out += shownOpeningTag(tag) + doc.source.slice(layer.openEnd, layer.end);
    }
    at = layer.end;
  }
  return out + doc.source.slice(at);
}

/** The `<image>` hrefs that point at files, for the main process to inline or name missing. Data URLs pass through. */
export function svgImageHrefs(source: string): string[] {
  const out: string[] = [];
  const tags = source.match(/<image\b[^>]*>/g) ?? [];
  for (const tag of tags) {
    const m = /(?:xlink:)?href\s*=\s*(?:"([^"]+)"|'([^']+)')/.exec(tag);
    const href = m?.[1] ?? m?.[2];
    if (href && !/^data:/i.test(href) && !/^[a-z][a-z0-9+.-]*:/i.test(href)) out.push(href);
  }
  return [...new Set(out)];
}

/** The source with each resolvable image href replaced by a data URL; what stays is named missing. */
export function inlineSvgImages(source: string, resolve: (href: string) => string | null): { source: string; missing: string[] } {
  const missing: string[] = [];
  const out = source.replace(/(<image\b[^>]*?(?:xlink:)?href\s*=\s*)("([^"]+)"|'([^']+)')/g, (whole, head: string, _q: string, dq?: string, sq?: string) => {
    const href = dq ?? sq ?? '';
    if (/^data:/i.test(href) || /^[a-z][a-z0-9+.-]*:/i.test(href)) return whole;
    const data = resolve(href);
    if (data === null) {
      if (!missing.includes(href)) missing.push(href);
      return whole;
    }
    return `${head}"${data}"`;
  });
  return { source: out, missing };
}
