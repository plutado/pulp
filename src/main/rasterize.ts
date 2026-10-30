/**
 * The rasterizer (milestone 33): one hidden window that turns vector documents
 * into PNG pixels — an SVG drawn through an `<img>` (Chromium's SVG-as-image
 * mode: no scripts run, nothing external is fetched), a PDF page drawn by
 * pdf.js with its optional content groups switched as asked. The page hands
 * back a canvas data URL, so nothing is captured off the screen.
 *
 * pdf.js (Apache-2.0, version 6) is imported into the page from a blob of its
 * own module text once per window; its worker runs from another blob of the
 * same build, so no scheme and no network is involved, and it is opened with
 * `isEvalSupported: false`, so the PDF's own functions are interpreted rather
 * than compiled. Calls run one at a time: the page is shared state.
 */

import { app, BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where pdf.js's build lives: node_modules in a checkout; packaging (milestone 17) must carry these two files. */
function pdfJsBuildDir(): string {
  return join(app.getAppPath(), 'node_modules', 'pdfjs-dist', 'build');
}

let win: BrowserWindow | null = null;
let pdfJsLoaded = false;
let chain: Promise<unknown> = Promise.resolve();

async function rasterizerWindow(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) return win;
  pdfJsLoaded = false;
  win = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  await win.loadURL('about:blank');
  return win;
}

/** Run one page job; the next waits, since the page is one. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job);
  chain = next.catch(() => undefined);
  return next;
}

async function run<T>(script: string): Promise<T> {
  const w = await rasterizerWindow();
  return (await w.webContents.executeJavaScript(script, true)) as T;
}

function dataUrlToPng(dataUrl: string): Buffer {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('the rasterizer answered something that is not a PNG');
  return Buffer.from(dataUrl.slice(prefix.length), 'base64');
}

/** An SVG's pixels at a size, drawn through an <img> so scripts never run and nothing external loads. */
export function rasterizeSvg(svg: string, width: number, height: number): Promise<Buffer> {
  return enqueue(async () => {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const src = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
    const dataUrl = await run<string>(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = ${w}; c.height = ${h};
          c.getContext('2d').drawImage(img, 0, 0, ${w}, ${h});
          resolve(c.toDataURL('image/png'));
        } catch (err) { reject(new Error(String(err && err.message || err))); }
      };
      img.onerror = () => reject(new Error('the SVG could not be drawn'));
      img.src = ${JSON.stringify(src)};
    })`);
    return dataUrlToPng(dataUrl);
  });
}

async function ensurePdfJs(): Promise<void> {
  if (pdfJsLoaded && win && !win.isDestroyed()) return;
  await rasterizerWindow();
  // pdf.js 6 ships as ES modules: the library is imported from a blob of its own text and its
  // worker started from another, so the sandboxed page reaches no scheme and no network for either.
  const lib = await readFile(join(pdfJsBuildDir(), 'pdf.min.mjs'), 'utf8');
  const worker = await readFile(join(pdfJsBuildDir(), 'pdf.worker.min.mjs'), 'utf8');
  await run(`(async () => {
    const libUrl = URL.createObjectURL(new Blob([${JSON.stringify(lib)}], { type: 'text/javascript' }));
    const workerUrl = URL.createObjectURL(new Blob([${JSON.stringify(worker)}], { type: 'text/javascript' }));
    window.pdfjsLib = await import(libUrl);
    // A blob worker is refused from about:blank's opaque origin, so pdf.js runs its worker module on
    // the page's own thread instead, imported from the same blob — slower, and all inside the sandbox.
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    window.pdfjsLib.GlobalWorkerOptions.workerPort = null;
    return true;
  })()`);
  pdfJsLoaded = true;
}

export interface PdfInfo {
  /** Page 1's size in CSS pixels (PDF points at 96 per inch). */
  width: number;
  height: number;
  pages: number;
  /** The optional content groups in the order the file lists them (the layer panel's order, top first). */
  groups: { ocgId: string; name: string; visible: boolean; depth: number }[];
}

const PDF_PAGE_HELPERS = `
  async function pulpOpenPdf(base64) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    // Eval stays off: the PDF's own functions are interpreted, never compiled.
    const task = window.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: false });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    // pdf.js 6 closes a document through its loading task.
    return { doc, page, close: () => { task.destroy().catch(() => undefined); } };
  }
  function pulpFlattenOrder(order, depth, out) {
    for (const entry of order || []) {
      if (typeof entry === 'string') out.push({ id: entry, depth });
      else if (entry && entry.order) pulpFlattenOrder(entry.order, depth + 1, out);
    }
    return out;
  }
`;

/** Page 1's size, page count and layer groups, read by pdf.js in the page. */
export function pdfInfo(bytes: Buffer): Promise<PdfInfo> {
  return enqueue(async () => {
    await ensurePdfJs();
    return run<PdfInfo>(`(async () => { ${PDF_PAGE_HELPERS}
      const { doc, page, close } = await pulpOpenPdf(${JSON.stringify(bytes.toString('base64'))});
      const viewport = page.getViewport({ scale: 96 / 72 });
      const config = await doc.getOptionalContentConfig();
      const flat = pulpFlattenOrder(config.getOrder(), 0, []);
      const groups = flat.map((f) => {
        const group = config.getGroup(f.id) || {};
        const visible = typeof group.visible === 'boolean' ? group.visible : config.isVisible({ type: 'OCG', id: f.id }) !== false;
        return { ocgId: f.id, name: String(group.name || 'Layer'), visible, depth: f.depth };
      });
      const out = { width: Math.round(viewport.width), height: Math.round(viewport.height), pages: doc.numPages, groups };
      close();
      return out;
    })()`);
  });
}

/**
 * Page 1 as a PNG at a scale, over transparency, with exactly these groups
 * visible (undefined leaves the file's own switches alone).
 */
export function rasterizePdf(bytes: Buffer, scale: number, visibleOcgIds?: readonly string[]): Promise<Buffer> {
  return enqueue(async () => {
    await ensurePdfJs();
    const dataUrl = await run<string>(`(async () => { ${PDF_PAGE_HELPERS}
      const { doc, page, close } = await pulpOpenPdf(${JSON.stringify(bytes.toString('base64'))});
      const viewport = page.getViewport({ scale: ${Math.max(0.05, scale)} * 96 / 72 });
      const config = await doc.getOptionalContentConfig();
      const shown = ${visibleOcgIds ? JSON.stringify(visibleOcgIds) : 'null'};
      if (shown) {
        const flat = pulpFlattenOrder(config.getOrder(), 0, []);
        for (const f of flat) config.setVisibility(f.id, shown.includes(f.id));
      }
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(viewport.width));
      c.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport, background: 'rgba(0,0,0,0)', optionalContentConfigPromise: Promise.resolve(config) }).promise;
      const out = c.toDataURL('image/png');
      close();
      return out;
    })()`);
    return dataUrlToPng(dataUrl);
  });
}

/** For tests and shutdown: drop the window; the next call makes a fresh one. */
export function closeRasterizer(): void {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
  pdfJsLoaded = false;
}
