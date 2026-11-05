/**
 * End-to-end UI test: starts the app with Chromium's remote debugging port,
 * drives the inspector through the DevTools protocol and reads pixels back
 * from the preview's canvas. Covers what the headless render path cannot:
 * the controls themselves.
 *
 * Needs the Electron binary (and a display on Linux). PULP_E2E=0 skips,
 * PULP_E2E=1 fails instead of skipping.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, existsSync, openSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { solid, writePsd } from '../psd-fixture';
import { writePdf } from '../pdf-fixture';
import { encodePng } from '../../src/core/png';
import { detectFfmpeg } from '../../src/core/ffmpeg';
import { ffprobePathFor } from '../../src/core/media-probe';
import { writeZip } from '../../src/core/zip';
import { rawManifest } from '../fixtures';
import { sampleMediaPath, samplesForTypes } from '../../src/core/sample-media';
import { BRIDGE_TOKEN_HEADER, parseBridgeFile } from '../../src/core/panel-bridge';
import { frameHash, hammingDistance, looksSame } from '../../src/core/visual-hash';
import { categoryInfo } from '../../src/core/categories';
import { ffmpegArgs, killTree, runBounded } from './process';

const ROOT = join(__dirname, '..', '..');

async function findElectron(): Promise<string> {
  if (process.env.PULP_E2E === '0') return 'PULP_E2E=0';
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return 'no display';
  try {
    const electron = (await import('electron')).default as unknown as string;
    if (typeof electron === 'string' && existsSync(electron)) return electron;
  } catch {
    // fall through
  }
  return 'Electron binary not installed';
}

const electronOrReason = await findElectron();
const electron = existsSync(electronOrReason) ? electronOrReason : null;
if (!electron && process.env.PULP_E2E === '1') throw new Error(`UI tests are required (PULP_E2E=1) but cannot run: ${electronOrReason}.`);
if (!electron) console.info(`Skipping UI tests: ${electronOrReason}.`);

/** Minimal DevTools protocol client over Node's global WebSocket. */
interface Ws {
  send(data: string): void;
  close(): void;
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}
const WebSocketCtor = (globalThis as unknown as { WebSocket: new (url: string) => Ws }).WebSocket;

interface Target { id: string; parentId?: string; type: string; url: string; title?: string; webSocketDebuggerUrl: string }
interface Context { id: number; origin?: string }

class Session {
  private id = 0;
  private pending = new Map<number, (message: { result?: unknown }) => void>();
  readonly contexts: Context[] = [];
  private constructor(private readonly ws: Ws) {}

  static connect(url: string): Promise<Session> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocketCtor(url);
      const session = new Session(ws);
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data) as { id?: number; method?: string; params?: { context?: Context }; result?: unknown };
        if (d.id !== undefined && session.pending.has(d.id)) {
          session.pending.get(d.id)!(d);
          session.pending.delete(d.id);
        } else if (d.method === 'Runtime.executionContextCreated' && d.params?.context) {
          session.contexts.push(d.params.context);
        }
      };
      ws.onopen = () => resolve(session);
      ws.onerror = (e) => reject(e instanceof Error ? e : new Error('WebSocket error'));
    });
  }

  /**
   * Every call has a time limit (docs/platform-notes.md, "Windows CI"): a page that does not answer
   * — a paused window, a promise that never settles — fails the test with the call named, rather than
   * holding it until the test's own timeout with nothing said.
   */
  send(method: string, params: Record<string, unknown> = {}, timeoutMs = EVAL_TIMEOUT_MS): Promise<{ result?: unknown }> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const what = typeof params.expression === 'string' ? ` for ${String(params.expression).replace(/\s+/g, ' ').slice(0, 160)}` : '';
        reject(new Error(`the window did not answer ${method} within ${timeoutMs / 1000} s${what}`));
      }, timeoutMs);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate in the page (or a given context) and return the JSON value. */
  async eval<T>(expression: string, contextId?: number, timeoutMs = EVAL_TIMEOUT_MS): Promise<T> {
    const r = (await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      ...(contextId !== undefined ? { contextId } : {}),
    }, timeoutMs)) as { result?: { result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } } };
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error(ex.exception?.description ?? ex.text ?? 'evaluation failed');
    return r.result?.result?.value as T;
  }

  close(): void {
    this.ws.close();
  }
}

/** How long one page call may take. Sweeps across the whole list stay well inside it at any sane frame rate. */
const EVAL_TIMEOUT_MS = 10_000;
/** The default wall-clock budget of one wait. */
const DEFAULT_WAIT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A valid 2x2 RGBA PNG of one color. */
function solidPng([r, g, b]: [number, number, number]): Buffer {
  return pngOf([r, g, b, 255, r, g, b, 255, r, g, b, 255, r, g, b, 255]);
}

/** A valid 2x2 RGBA PNG: red, green on the top row; blue, white below. */
function tinyPng(): Buffer {
  return pngOf([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
}

/** A 2x2 RGBA PNG from sixteen channel values, built so it is a valid file. */
function pngOf(pixels: number[]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.from([0, ...pixels.slice(0, 8), 0, ...pixels.slice(8, 16)]); // filter byte + 2 px per row
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A port nothing is listening on, as the system hands one out: a random pick could be another app's. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe.skipIf(!electron)('inspector UI', () => {
  let port = 0;
  let app: ChildProcess | null = null;
  let page: Session;
  /** Scratch userData folder, so the app under test never reads or writes the real settings.json. */
  let userData = '';
  /** Where the sample-media hint would write; empty, so everything in the catalog is still to make. */
  let sampleRoot = '';
  /** The app window's own target, so the preview iframe can be told from a background render's window. */
  let appTargetId = '';
  /** A library folder with a tiny PNG and, when ffmpeg is available, a 2 s MP4. */
  let mediaDir = '';
  let haveVideo = false;
  let appLog = '';

  // 2x2 opaque PNG (red, green / blue, white), built here so it is a valid file: a hand-written base64
  // PNG with a damaged zlib stream was accepted by Chromium's lenient decoder but refused by ffmpeg.
  const TINY_PNG = tinyPng();

  async function targets(): Promise<Target[]> {
    try {
      return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Target[];
    } catch {
      return [];
    }
  }

  /**
   * Poll until a condition holds, for at most `budgetMs` of wall-clock time (not a count of tries:
   * a slow check must not stretch the wait past the test's own timeout, or the test dies without
   * naming what it was waiting for — docs/platform-notes.md, "Windows CI"). The default leaves room
   * for three waits inside a 60 s test.
   */
  async function until(check: () => Promise<boolean>, what: string, budgetMs = DEFAULT_WAIT_MS): Promise<void> {
    const started = Date.now();
    let checks = 0;
    for (;;) {
      checks++;
      if (await check()) return;
      const elapsed = Date.now() - started;
      if (elapsed >= budgetMs) throw new Error(`timed out waiting for ${what} (${(elapsed / 1000).toFixed(1)} s, ${checks} checks)`);
      await sleep(250);
    }
  }

  // The results are windowed: only the cards and rows the viewport covers are in the
  // DOM, so a test has to scroll to an item the way a user would before touching it.

  /** The expression for the rendered <li> of a named result, or undefined. */
  const liFor = (name: string) => `[...document.querySelectorAll('#results li[data-id]')].find((li) => li.querySelector('.name')?.textContent === ${JSON.stringify(name)})`;

  /**
   * Scrolling through the windowed list, in page code. The step is most of a screen but never
   * under SWEEP_MIN_STEP px, and the pass is bounded by how many such steps the list holds, not by
   * a fixed count: a results box squeezed to a few pixels once made 200 steps fall short of the
   * last rows on Windows CI (docs/platform-notes.md). The end is reached within a pixel, since a
   * fractional layout can leave scrollTop just under scrollHeight - clientHeight for ever.
   */
  const SWEEP_MIN_STEP = 40;
  const sweep = `
    const box = document.getElementById('results');
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const step = Math.max(${SWEEP_MIN_STEP}, box.clientHeight * 0.8);
    const atEnd = () => box.scrollTop >= box.scrollHeight - box.clientHeight - 1;
    const steps = Math.ceil(box.scrollHeight / step) + 2;
    box.scrollTop = 0;
    await settle();`;

  /** One pass down the results, a screen at a time, stopping where the named item is rendered. */
  const sweepTo = (name: string) =>
    page.eval<boolean>(
      `(async () => {
        ${sweep}
        for (let i = 0; i < steps; i++) {
          if (${liFor(name)}) return true;
          if (atEnd()) return false;
          box.scrollTop = Math.min(box.scrollHeight - box.clientHeight, box.scrollTop + step);
          await settle();
        }
        return false;
      })()`,
    );

  /** Scrolls the results until the named item is rendered, waiting for one that has not arrived yet. */
  const scrollToResult = (name: string, budgetMs = DEFAULT_WAIT_MS) => until(() => sweepTo(name), `the result "${name}"`, budgetMs);

  /** Scrolls to a result, then evaluates `fn` — a function source taking its <li> — on it. */
  async function onResult<T>(name: string, fn: string): Promise<T> {
    await scrollToResult(name);
    return page.eval<T>(`(${fn})(${liFor(name)})`);
  }

  const clickResult = (name: string) => onResult(name, '(li) => li.click()');

  /** Open the inspector drawer on a tab (milestone 38). The row's buttons toggle, so a bare
   * click on the already-open tab would close it; this clicks only when that moves forward. */
  const openTab = (tab: 'parameters' | 'output' | 'info') =>
    page.eval(
      "(() => { const b = document.getElementById('tab-" + tab + "');" +
      " if (b.getAttribute('aria-selected') !== 'true' || !document.getElementById('app').classList.contains('inspector-open')) b.click(); })()",
    );
  /**
   * Bring a category into view whatever the tree is folded to: typing in the find field filters
   * the tree to the matches and opens every section holding one. `clearFindField` puts the tree
   * back. Tests that need a particular node use these rather than assuming the tree is open,
   * which it no longer is (the panel shows only where you are).
   */
  // The field sits under the funnel in the Browse heading (milestone 41): opened before typing,
  // and the funnel pressed again to put it away, which also clears it.
  /**
   * The layer overlay holds the layout of the latest frame the stage asked the page for, and nothing is
   * in flight or queued. The page lays a frame out before its reply reaches the overlay, so a test that
   * saw the page draw something can still click an overlay holding the layout from before — and an edit
   * redraws the frame it is on, so the frame number alone cannot tell the two apart. Each request is
   * numbered (src/renderer/stage.ts) and the overlay says which one it holds.
   */
  const overlayCurrent = `(() => { const o = document.getElementById('layer-overlay'), f = document.getElementById('preview-frame');
    return !!o && !!f && f.dataset.inFlight === 'false' && f.dataset.pending === '' && o.dataset.laidRequest !== undefined && o.dataset.laidRequest === f.dataset.requested; })()`;
  const findCategory = (text: string) =>
    page.eval(`(() => { if (document.getElementById('browse-find').hidden) document.getElementById('browse-filter-toggle').click();
      const f = document.querySelector('#browse-find input'); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const clearFindField = () =>
    page.eval(`(() => { if (!document.getElementById('browse-find').hidden) document.getElementById('browse-filter-toggle').click();
      else { const f = document.querySelector('#browse-find input'); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); } })()`);

  /**
   * Every result name, in list order, collected by scrolling through the window.
   * Items are kept apart by their library id, so two items of the same name both count.
   */
  function resultNames(): Promise<string[]> {
    return page.eval<string[]>(
      `(async () => {
        ${sweep}
        const seen = new Map();
        const collect = () => { for (const li of box.querySelectorAll('li[data-id]')) seen.set(li.dataset.id, li.querySelector('.name').textContent); };
        collect();
        for (let i = 0; i < steps && !atEnd(); i++) {
          box.scrollTop += step;
          await settle();
          collect();
        }
        box.scrollTop = 0;
        await settle();
        return [...seen.values()];
      })()`,
    );
  }

  /**
   * Evaluate inside the template's own page. The preview iframe is its own target when Chromium puts
   * it out of process, otherwise a context on the page. The background poster queue opens offscreen
   * windows on `pulp-template://` as well, and one of those is not the preview: the iframe is the
   * target whose parent is the app window, which is how it is told apart here.
   */
  async function inTemplate<T>(expr: string, templateId: string): Promise<T> {
    const frame = (await targets()).find((t) => t.type !== 'page' && t.parentId === appTargetId && t.url.startsWith(`pulp-template://${templateId}/`));
    if (frame) {
      const s = await Session.connect(frame.webSocketDebuggerUrl);
      try {
        return await s.eval<T>(expr);
      } finally {
        s.close();
      }
    }
    const ctx = [...page.contexts].reverse().find((c) => (c.origin ?? '').startsWith(`pulp-template://${templateId}`));
    return page.eval<T>(expr, ctx?.id);
  }

  /**
   * Read one preview pixel (straight RGBA, as the template's canvas holds it) in template coordinates.
   * A template page that exists before its canvas does (a slow CI machine) answers [-1, -1, -1, -1],
   * which no check accepts, so an `until` keeps polling instead of throwing out of the wait.
   */
  function previewPixel(x: number, y: number, templateId = 'pulp.samples.lower-third-bar'): Promise<number[]> {
    return inTemplate<number[]>(`(() => { const c = document.getElementById('c'); if (!c) return [-1, -1, -1, -1]; const d = c.getContext('2d').getImageData(${x}, ${y}, 1, 1).data; return [...d]; })()`, templateId);
  }

  /** Move the scrubber and give the preview a moment to draw the frame. */
  const scrubTo = async (frame: number) => {
    await page.eval(`(() => { const el = document.getElementById('scrub'); el.value = '${frame}'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(500);
  };

  beforeAll(async () => {
    const built = await runBounded(process.execPath, [join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build'], { cwd: ROOT, timeoutMs: 100_000 });
    if (built.code !== 0) throw new Error(`build failed: ${built.stderr}`);
    userData = await mkdtemp(join(tmpdir(), 'pulp-ui-'));
    mediaDir = join(userData, 'media-library');
    await mkdir(mediaDir, { recursive: true });
    await writeFile(join(mediaDir, 'tiny.png'), TINY_PNG);
    // A solid red 2 × 2 as well: a picture whose every pixel says where it is, with no white to read as text.
    await writeFile(join(mediaDir, 'mark.png'), solidPng([255, 0, 0]));
    // A template of one declared size, now that every bundled template draws for all four shapes:
    // the Output tab's "no aspect to choose" case and the orientation filter's landscape-only case.
    await mkdir(join(mediaDir, 'wide-only'), { recursive: true });
    await writeFile(
      join(mediaDir, 'wide-only', 'template.json'),
      JSON.stringify({ formatVersion: 1, id: 'pulp.test.wide-only', name: 'Wide only', version: '1.0.0', license: 'CC0-1.0', category: 'title', duration: 1, fps: 30, width: 320, height: 180, alpha: true, parameters: [] }),
    );
    await writeFile(
      join(mediaDir, 'wide-only', 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent}canvas{display:block;width:100%;height:100%}</style></head><body><canvas id="c"></canvas><script>var c=document.getElementById("c"),x=c.getContext("2d");window.pulpRender=function(s){if(c.width!==s.width||c.height!==s.height){c.width=s.width;c.height=s.height;}x.clearRect(0,0,s.width,s.height);x.fillStyle="#4f7cac";x.fillRect(s.width*0.1,s.height*0.6,s.width*0.5,s.height*0.2);};</script></body></html>',
    );
    await writeFile(join(mediaDir, 'silence.wav'), await readFile(join(ROOT, 'tests', 'e2e', 'templates', 'media', 'silence.wav')));
    // A spoken sample (milestone 50): a sentence synthesised with the system voice, 16 kHz mono, for the transcription test.
    await writeFile(join(mediaDir, 'spoken.wav'), await readFile(join(ROOT, 'tests', 'e2e', 'templates', 'media', 'spoken.wav')));
    // The other layered stills (milestone 33), generated like the Photoshop one: an OpenRaster of
    // the same picture, an SVG whose top-level groups are the layers, a PDF with two optional
    // content groups (one off), and a Sketch file Pulp names rather than reads.
    const oraPng = (rgba: Uint8Array, w: number, h: number) => Buffer.from(encodePng(rgba, w, h, (b) => new Uint8Array(deflateSync(b))));
    await writeFile(join(mediaDir, 'painted.ora'), writeZip([
      { name: 'mimetype', data: Buffer.from('image/openraster') },
      { name: 'stack.xml', data: Buffer.from('<image w="8" h="6"><stack><stack name="Marks"><layer name="Green mark" src="data/green.png" visibility="hidden" x="4" y="3"/><layer name="Blue mark" src="data/blue.png"/></stack><layer name="Backdrop" src="data/backdrop.png"/></stack></image>') },
      { name: 'data/backdrop.png', data: oraPng(solid(8, 6, [255, 0, 0, 255]), 8, 6) },
      { name: 'data/blue.png', data: oraPng(solid(4, 3, [0, 0, 255, 255]), 4, 3) },
      { name: 'data/green.png', data: oraPng(solid(4, 3, [0, 255, 0, 255]), 4, 3) },
      { name: 'mergedimage.png', data: oraPng(solid(8, 6, [255, 0, 0, 255]), 8, 6) },
    ]));
    await writeFile(join(mediaDir, 'grouped.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><g id="Backplate"><rect width="80" height="60" fill="#f00"/></g><g id="Badge" display="none"><circle cx="40" cy="30" r="20" fill="#00f"/></g></svg>');
    await writeFile(join(mediaDir, 'drawn.pdf'), writePdf());
    await writeFile(join(mediaDir, 'design.sketch'), Buffer.from('not really a sketch file'));
    // A layered Photoshop file (milestone 33), generated: a red backdrop and a group holding a shown blue mark and a hidden green one.
    await writeFile(join(mediaDir, 'layered.psd'), writePsd({
      width: 8, height: 6,
      layers: [
        { name: 'Backdrop', left: 0, top: 0, width: 8, height: 6, rgba: solid(8, 6, [255, 0, 0, 255]) },
        { group: 'Marks', layers: [
          { name: 'Blue mark', left: 0, top: 0, width: 4, height: 3, rgba: solid(4, 3, [0, 0, 255, 255]) },
          { name: 'Green mark', left: 4, top: 3, width: 4, height: 3, rgba: solid(4, 3, [0, 255, 0, 255]), visible: false },
        ] },
      ],
      composite: solid(8, 6, [255, 0, 0, 255]),
    }));
    const ffmpeg = await detectFfmpeg();
    if (ffmpeg.ok) {
      const wide = await runBounded(ffmpeg.path, ffmpegArgs(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=10', '-t', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', join(mediaDir, 'clip.mp4')]), { timeoutMs: 60_000 });
      // A tall clip too, for the orientation filter and the portrait cards.
      const tall = await runBounded(ffmpeg.path, ffmpegArgs(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=36x64:rate=10', '-t', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', join(mediaDir, 'tall.mp4')]), { timeoutMs: 60_000 });
      // A clip with its own sound (milestone 48), so a video layer has something to keep.
      await runBounded(ffmpeg.path, ffmpegArgs([
        '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-t', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', join(mediaDir, 'noisy.mp4'),
      ]), { timeoutMs: 60_000 });
      // A clip whose sound goes quiet after 0.8 s (milestone 49), for the silence removal flow —
      // named to sort after everything else, like the clean-up fixtures, so the stage menu's
      // first eight assets stay what they were, and mpeg4 like them, so the codec searches keep
      // counting only what they counted.
      await runBounded(ffmpeg.path, ffmpegArgs([
        '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2',
        '-af', "volume=enable='gte(t,0.8)':volume=0", '-t', '2', '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', join(mediaDir, 'zz-gappy.mp4'),
      ]), { timeoutMs: 60_000 });
      // A green-screen take and footage with two hard cuts (milestone 52) — mpeg4, so the codec
      // searches keep counting only what they counted, and named to sort after everything else,
      // so the stage menu's first eight assets stay what they were.
      await runBounded(ffmpeg.path, ffmpegArgs([
        '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=green:s=64x36:d=0.9:r=10',
        '-f', 'lavfi', '-i', 'color=c=red:s=16x16:d=0.9:r=10',
        '-filter_complex', '[0][1]overlay=x=24:y=10', '-c:v', 'mpeg4', '-qscale:v', '2', join(mediaDir, 'weathercast.mp4'),
      ]), { timeoutMs: 60_000 });
      await runBounded(ffmpeg.path, ffmpegArgs([
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=red:s=64x36:d=2:r=10',
        '-f', 'lavfi', '-i', 'color=c=blue:s=64x36:d=2:r=10',
        '-f', 'lavfi', '-i', 'color=c=green:s=64x36:d=2:r=10',
        '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0', '-c:v', 'mpeg4', '-qscale:v', '2', '-g', '5', join(mediaDir, 'yearbook.mp4'),
      ]), { timeoutMs: 60_000 });
      // A run of numbered frames (milestone 26), so the stage has a sequence to step through.
      await mkdir(join(mediaDir, 'frames'), { recursive: true });
      await runBounded(ffmpeg.path, ffmpegArgs([
        '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=10', '-t', '1.2',
        '-start_number', '1', join(mediaDir, 'frames', 'walk_%04d.png'),
      ]), { timeoutMs: 60_000 });
      haveVideo = wide.code === 0 && tall.code === 0;
    }
    // A template that declares an animate-in, a hold and an animate-out (milestone 30), so the
    // Length control has something to act on; the bundled ones do not declare their parts yet.
    await mkdir(join(mediaDir, 'structure'), { recursive: true });
    for (const file of ['template.json', 'index.html']) {
      await writeFile(join(mediaDir, 'structure', file), await readFile(join(__dirname, 'templates', 'structure', file)));
    }
    // The hand-written twin of a composition the editor builds (milestone 55's test).
    await mkdir(join(mediaDir, 'twin-canvas'), { recursive: true });
    for (const file of ['template.json', 'index.html']) {
      await writeFile(join(mediaDir, 'twin-canvas', file), await readFile(join(__dirname, 'templates', 'twin-canvas', file)));
    }
    // The start screen stays out of the way: this suite drives the window underneath it,
    // and the screen has its own test, which shows it through File → Home.
    // Where sample media would go (milestone 34): the folder exists and is empty, so the results'
    // hint counts the whole catalog as still to make and its button writes here rather than
    // opening a folder dialog, which cannot be driven from the protocol.
    sampleRoot = join(userData, 'Sample media');
    await mkdir(sampleRoot, { recursive: true });
    // The editor panel's bridge is on, so its describe can speak to the app from outside (milestone 54);
    // one bundled example is seeded as a recent project, so Continue has a card to lead with (milestone 60).
    await writeFile(join(userData, 'settings.json'), JSON.stringify({
      // The empty sample-media folder is a root too, so this install reads as set up (milestone 60's returning arrangement).
      libraryFolders: [mediaDir, sampleRoot], showStartScreen: false, sampleMediaRoot: sampleRoot, editorPanel: true,
      // Dark, whatever the machine's own appearance (milestone 62): a CI runner's desktop is light, and
      // the suite's tests were written against the dark palette. The appearance tests switch it and put it back.
      appearance: 'dark',
      // US English, whatever the machine's own language (milestone 59): the suite reads the window's
      // words, written in the source catalog's. The language test switches it and puts it back.
      language: 'en-US',
      recentProjects: [join(ROOT, 'examples', 'interview.pulp')],
      recentProjectTimes: { [join(ROOT, 'examples', 'interview.pulp')]: new Date().toISOString() },
    }));
    // A font already imported: a real TTF in the managed folder under a family of its own, with a
    // license note, as fonts:import would leave it. The import dialog itself cannot be driven here.
    await mkdir(join(userData, 'fonts'), { recursive: true });
    await writeFile(join(userData, 'fonts', 'PulpTestFace.ttf'), await readFile(join(ROOT, 'fonts', 'bebas-neue', 'BebasNeue-Regular.ttf')));
    await writeFile(
      join(userData, 'fonts', 'fonts.json'),
      JSON.stringify([{ family: 'Pulp Test Face', file: 'PulpTestFace.ttf', style: 'normal', weight: 400, note: 'Bought from the foundry, desktop license', importedAt: '2026-10-24T00:00:00Z' }]),
    );
    // The app's own output goes to a file, so a failing test can print what the main process said.
    appLog = join(userData, 'app.log');
    const logFd = openSync(appLog, 'a');
    port = await freePort();
    app = spawn(electron!, ['.', `--remote-debugging-port=${port}`], {
      cwd: ROOT,
      stdio: ['ignore', logFd, logFd],
      // The fake devices: a microphone's steady tone (milestone 63) and a camera's moving test card
      // (milestone 64), from Chromium itself, so recording needs no device and no prompt on any runner.
      env: { ...process.env, PULP_USER_DATA: userData, PULP_FAKE_MEDIA: '1' },
    });
    closeSync(logFd);
    let target: Target | undefined;
    await until(async () => {
      // This checkout's window and no other: should the port be taken after all, the app that holds it
      // is another copy of Pulp, and a test driving it would be testing something else entirely.
      target = (await targets()).find((t) => t.type === 'page' && decodeURIComponent(t.url).includes(join(ROOT, 'out', 'renderer', 'index.html').replace(/\\/g, '/')));
      return target !== undefined;
    }, 'the app window');
    appTargetId = target!.id;
    page = await Session.connect(target!.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    await until(() => page.eval<boolean>(`document.querySelectorAll('#results li[data-id]').length > 0`), 'the library list');
    // On a display small enough that the browse panel would squeeze the stage, the window opens with
    // the panel folded to its rail (milestone 42); the tests drive the panel, so they want it open.
    await page.eval(`(() => { if (document.getElementById('app').classList.contains('browse-collapsed')) document.getElementById('browse-expand').click(); return true; })()`);
    await until(() => page.eval<boolean>(`!document.getElementById('app').classList.contains('browse-collapsed')`), 'the browse panel open');
    await clickResult('Lower Third Bar');
    await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview to be ready');
  }, 120_000);

  /**
   * When a test fails, say what the app was doing: the window's visibility and whether its frame
   * callbacks run, the background queue, the render queue, and the main process's last lines.
   * Each probe is short and guarded, so the dump itself cannot hang (docs/platform-notes.md, "Windows CI").
   */
  afterEach(async (ctx) => {
    if (ctx.task.result?.state !== 'fail' || !page) return;
    const probe = async <T,>(what: string, fn: () => Promise<T>): Promise<T | string> => {
      try {
        return await fn();
      } catch (err) {
        return `${what}: ${(err as Error).message}`;
      }
    };
    const lines: string[] = [`--- state after "${ctx.task.name}" failed at ${new Date().toISOString()} ---`];
    lines.push(`window: ${JSON.stringify(await probe('window', () => page.eval(`({ visibility: document.visibilityState, hidden: document.hidden, focus: document.hasFocus(), inner: [window.innerWidth, window.innerHeight], screen: [screen.width, screen.height], results: document.querySelectorAll('#results li[data-id]').length, search: document.getElementById('search').value })`, undefined, 5_000)))}`);
    // The results box: a list squeezed to a few pixels is what made the sweeps fall short on Windows CI.
    lines.push(`results box: ${JSON.stringify(await probe('results box', () => page.eval(`(() => { const b = document.getElementById('results'); return { clientHeight: b.clientHeight, scrollHeight: b.scrollHeight, scrollTop: b.scrollTop, cols: b.style.getPropertyValue('--cols'), rowHeight: b.style.getPropertyValue('--card-h'), stage: document.getElementById('region-stage').clientHeight, tray: document.getElementById('region-tray').clientHeight }; })()`, undefined, 5_000)))}`);
    lines.push(`frame callback: ${JSON.stringify(await probe('rAF', () => page.eval(`new Promise((r) => { const t = performance.now(); const timer = setTimeout(() => r('no frame callback within 3 s'), 3000); requestAnimationFrame(() => { clearTimeout(timer); r(Math.round(performance.now() - t) + ' ms'); }); })`, undefined, 5_000)))}`);
    // The preview: what frame the stage asked for, whether it is still waiting, and what the page last drew.
    // The preview's own box and the layer overlay over it: a stage squeezed by the tray can leave
    // the picture a few dozen pixels tall, or no room at all, which is what a click then misses.
    lines.push(`preview box: ${JSON.stringify(await probe('preview box', () => page.eval(`(() => { const f = document.getElementById('preview-frame'); const o = document.getElementById('layer-overlay'); const fr = f.getBoundingClientRect(); const or = o.getBoundingClientRect(); return { frame: [Math.round(fr.width), Math.round(fr.height)], overlay: [Math.round(or.width), Math.round(or.height)], visible: getComputedStyle(f).visibility, active: o.classList.contains('active'), laidFrame: o.dataset.laidFrame }; })()`, undefined, 5_000)))}`);
    lines.push(`preview: ${JSON.stringify(await probe('preview', () => page.eval(`(() => { const f = document.getElementById('preview-frame'); return { frame: f.dataset.frame, inFlight: f.dataset.inFlight, pending: f.dataset.pending, watchdogFired: f.dataset.watchdog, src: document.getElementById('preview').getAttribute('src') }; })()`, undefined, 5_000)))}`);
    const previewSrc = await probe('preview src', () => page.eval<string | null>(`document.getElementById('preview').getAttribute('src')`, undefined, 5_000));
    const templateId = typeof previewSrc === 'string' ? /^pulp-template:\/\/([^/]+)\//.exec(previewSrc)?.[1] : undefined;
    if (templateId) {
      lines.push(`template page: ${JSON.stringify(await probe('template page', () => inTemplate(`({ drawn: window.__pulp && window.__pulp.drawn, fonts: [...document.fonts].filter((f) => f.status !== 'unloaded').map((f) => f.family + ':' + f.status) })`, templateId)))}`);
    }
    lines.push(`library: ${JSON.stringify(await probe('diagnostics', () => page.eval(`window.pulp.libraryDiagnostics()`, undefined, 5_000)))}`);
    lines.push(`render queue: ${JSON.stringify(await probe('queue', () => page.eval(`window.pulp.getRenderQueue().then((q) => q.jobs.map((j) => j.status + ' ' + j.templateId))`, undefined, 5_000)))}`);
    if (appLog && existsSync(appLog)) {
      const tail = (await readFile(appLog, 'utf8')).split('\n').filter(Boolean).slice(-40);
      lines.push('app log (last 40 lines):', ...tail.map((l) => `  ${l}`));
    }
    console.error(lines.join('\n'));
  });

  afterAll(async () => {
    page?.close();
    if (app && app.exitCode === null && app.signalCode === null) {
      // kill() returns before the process is gone. Windows refuses to delete a folder while any
      // process holds a file in it open (EBUSY), and Chromium's helper processes can outlive the
      // main process by a moment, so wait for the exit and then delete with retries.
      const exited = once(app, 'exit');
      // The whole tree: on Windows kill() reaches the main process only, and the GPU and renderer
      // helpers would keep the profile folder busy.
      killTree(app.pid);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
    }
    if (userData) await rm(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  });

  it('shows the lower third with its 85% panel at the default color', async () => {
    await scrubTo(90);
    const px = await previewPixel(120, 840);
    // Canvas stores premultiplied pixels and rounds back on read, so colors can be a step or two off.
    for (const [i, v] of [17, 24, 39].entries()) expect(Math.abs(px[i]! - v), `channel ${i}`).toBeLessThanOrEqual(2);
    expect(px[3]).toBe(217);
    // The color control reflects the value: RGB in the picker, 85% on the slider, the whole value in the text field.
    const control = await page.eval<{ picker: string; alpha: string; percent: string; hex: string }>(
      `(() => { const f = document.querySelector('#params [data-param=panel] .color-field'); return { picker: f.querySelector('input[type=color]').value, alpha: f.querySelector('.alpha').value, percent: f.querySelector('.alpha-value').textContent, hex: f.querySelector('.hex').value }; })()`,
    );
    expect(control).toEqual({ picker: '#111827', alpha: '85', percent: '85%', hex: '#111827d9' });
  }, 60_000);

  it('keeps the alpha when the color is changed with the native picker', async () => {
    await page.eval(`(() => { const el = document.querySelector('#params [data-param=panel] .color-field').querySelector('input[type=color]'); el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await scrubTo(90);
    expect(await previewPixel(120, 840)).toEqual([255, 0, 0, 217]);
  }, 60_000);

  it('changes the alpha with the slider and shows it in the text field', async () => {
    await page.eval(`(() => { const el = document.querySelector('#params [data-param=panel] .color-field').querySelector('.alpha'); el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await scrubTo(90);
    const px = await previewPixel(120, 840);
    expect(px.slice(0, 3)).toEqual([255, 0, 0]);
    expect(px[3]).toBe(128);
    expect(await page.eval<string>(`document.querySelector('#params [data-param=panel] .color-field').querySelector('.hex').value`)).toBe('#ff000080');
  }, 60_000);

  it('accepts a full #RRGGBBAA value in the text field and rejects garbage without changing the color', async () => {
    await page.eval(`(() => { const el = document.querySelector('#params [data-param=panel] .color-field').querySelector('.hex'); el.value = '#00FF0040'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await scrubTo(90);
    expect(await previewPixel(120, 840)).toEqual([0, 255, 0, 64]);
    const synced = await page.eval<{ picker: string; alpha: string }>(
      `(() => { const f = document.querySelector('#params [data-param=panel] .color-field'); return { picker: f.querySelector('input[type=color]').value, alpha: f.querySelector('.alpha').value }; })()`,
    );
    expect(synced).toEqual({ picker: '#00ff00', alpha: '25' });

    await page.eval(`(() => { const el = document.querySelector('#params [data-param=panel] .color-field').querySelector('.hex'); el.value = 'teal'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await scrubTo(90);
    expect(await previewPixel(120, 840)).toEqual([0, 255, 0, 64]);
    expect(await page.eval<boolean>(`document.querySelector('#params [data-param=panel] .color-field').querySelector('.hex').classList.contains('error')`)).toBe(true);
  }, 60_000);

  /** Value of the first element matching the selector. */
  const valueOf = (selector: string) => page.eval<string>(`document.querySelector(${JSON.stringify(selector)}).value`);
  /** Set a value and dispatch an event on the first element matching the selector. */
  const fire = (selector: string, value: string | null, event: string) =>
    page.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (${JSON.stringify(value)} !== null) el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); })()`,
    );

  it('keeps a number slider and its entry in sync', async () => {
    await fire('[data-param=inOut] input[type=range]', '1.5', 'input');
    expect(await valueOf('[data-param=inOut] input[type=number]')).toBe('1.5');
    await fire('[data-param=inOut] input[type=number]', '0.4', 'input');
    expect(await valueOf('[data-param=inOut] input[type=range]')).toBe('0.4');
    await fire('[data-param=inOut] input[type=number]', null, 'change');
  }, 60_000);

  it('counts characters for a text parameter with a maximum length', async () => {
    // The name is a layer's words now (milestone 23); its row's text input edits it like a parameter.
    await fire('.layer-row[data-layer=name] .layer-text', 'Ada Lovelace', 'input');
    await fire('.layer-row[data-layer=name] .layer-text', null, 'change'); // commits the edit as one history step
  }, 60_000);

  it('undoes and redoes committed edits by button and by keyboard, but leaves text fields their own undo', async () => {
    expect(await page.eval<boolean>(`document.getElementById('undo').disabled`)).toBe(false);
    await page.eval(`document.getElementById('undo').click()`);
    expect(await valueOf('.layer-row[data-layer=name] .layer-text')).toBe('Alex Rivera');
    await page.eval(`document.getElementById('redo').click()`);
    expect(await valueOf('.layer-row[data-layer=name] .layer-text')).toBe('Ada Lovelace');
    // Ctrl+Z with focus outside a text field undoes through the app history.
    await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
    expect(await valueOf('.layer-row[data-layer=name] .layer-text')).toBe('Alex Rivera');
    // Shift+Ctrl+Z redoes.
    await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }))`);
    expect(await valueOf('.layer-row[data-layer=name] .layer-text')).toBe('Ada Lovelace');
    // The same shortcut dispatched on the text field is left to the field; the app history does not move.
    await page.eval(`document.querySelector('.layer-row[data-layer=name] .layer-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
    expect(await valueOf('.layer-row[data-layer=name] .layer-text')).toBe('Ada Lovelace');
  }, 60_000);

  it('resets one field, then everything, and both are undoable', async () => {
    // inOut was changed earlier, so its reset is visible; the untouched position has none.
    expect(await page.eval<boolean>(`document.querySelector('[data-param=inOut] .field-reset').hidden`)).toBe(false);
    expect(await page.eval<boolean>(`document.querySelector('[data-param=side] .field-reset').hidden`)).toBe(true);
    await page.eval(`document.querySelector('[data-param=inOut] .field-reset').click()`);
    expect(await valueOf('[data-param=inOut] input[type=number]')).toBe('0.6');
    expect(await page.eval<boolean>(`document.querySelector('[data-param=inOut] .field-reset').hidden`)).toBe(true);

    expect(await page.eval<boolean>(`document.getElementById('reset-all').disabled`)).toBe(false);
    await page.eval(`document.getElementById('reset-all').click()`);
    expect(await valueOf('.layer-row[data-layer=name] .layer-text')).toBe('Alex Rivera');
    expect(await page.eval<string>(`document.querySelector('#params [data-param=panel] .color-field').querySelector('.hex').value`)).toBe('#111827d9');
    expect(await page.eval<boolean>(`[...document.querySelectorAll('#params .field-reset')].every((b) => b.hidden)`)).toBe(true);
    expect(await page.eval<boolean>(`document.getElementById('reset-all').disabled`)).toBe(true);
    await scrubTo(90);
    expect((await previewPixel(120, 840))[3]).toBe(217);

    // Reset all is one history step: undo brings the edits back.
    await page.eval(`document.getElementById('undo').click()`);
    expect(await valueOf('.layer-row[data-layer=name] .layer-text')).toBe('Ada Lovelace');
    expect(await page.eval<string>(`document.querySelector('#params [data-param=panel] .color-field').querySelector('.hex').value`)).toBe('#00ff0040');
  }, 60_000);

  it('keeps edits and history per template across a switch', async () => {
    await clickResult('Title Card');
    await until(() => page.eval<boolean>(`document.querySelector('#params .layers-block[data-block=card]') !== null`), 'the title card form');
    expect(await page.eval<boolean>(`document.getElementById('undo').disabled`)).toBe(true);
    // The title card's words are layers now, so its title is a layer's text (milestone 23).
    expect(await page.eval<string>(`document.querySelector('#params .layer-row[data-layer=title] .layer-text').value`)).toBe('Field Notes');
    await clickResult('Lower Third Bar');
    await until(() => page.eval<boolean>(`document.querySelector('.layer-row[data-layer=name] .layer-text') !== null`), 'the lower third form');
    expect(await valueOf('.layer-row[data-layer=name] .layer-text')).toBe('Ada Lovelace');
    expect(await page.eval<boolean>(`document.getElementById('undo').disabled`)).toBe(false);
  }, 60_000);

  it('remembers committed colors across fields and templates, and stores them in settings', async () => {
    // Committed earlier in this run through the panel field's text input and picker.
    const rows = await page.eval<string[][]>(
      `[...document.querySelectorAll('#params .color-field')].map((f) => [...f.querySelectorAll('.recent-swatch')].map((b) => b.dataset.color))`,
    );
    // The lower third's two color parameters and the color of each of its two text layers.
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toEqual(rows[0]);
    expect(rows[0]![0]).toBe('#00ff0040'); // most recent first
    expect(rows[0]!.length).toBeLessThanOrEqual(8);

    // Using a recent color on another field (the accent) applies and commits it.
    await page.eval(`document.querySelector('#params [data-param=accent] .color-field').querySelector('.recent-swatch').click()`);
    expect(await page.eval<string>(`document.querySelector('#params [data-param=accent] .color-field').querySelector('.hex').value`)).toBe('#00ff0040');

    // The list is shared in settings.json of the (scratch) user data folder. The save is atomic
    // (temp file renamed over the old one), but it is asynchronous: retry until the file parses
    // and carries the list, rather than reading once at an arbitrary moment.
    let settings: { recentColors?: string[] } = {};
    await until(async () => {
      try {
        settings = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { recentColors?: string[] };
        return settings.recentColors?.[0] === '#00ff0040';
      } catch {
        return false;
      }
    }, 'settings.json to carry the recent colors');
    expect(settings.recentColors).toEqual(rows[0]);

    // The same list shows on another template's color fields.
    await clickResult('Title Card');
    await until(() => page.eval<boolean>(`document.querySelector('#params .color-field .recent-swatch') !== null`), 'recent colors on the title card');
    expect(await page.eval<string>(`document.querySelector('#params .color-field .recent-swatch').dataset.color`)).toBe('#00ff0040');
  }, 60_000);

  describe('the player', () => {
    const frameNow = () => page.eval<number>(`Number(document.getElementById('scrub').value)`);
    /** The preview draws one frame at a time, so a step shows up when the frame in flight lands. */
    const atFrame = (n: number) => until(async () => (await frameNow()) === n, `the preview to reach frame ${n}`);
    const pressed = (id: string) => page.eval<string>(`document.getElementById(${JSON.stringify(id)}).getAttribute('aria-pressed')`);
    const click = (id: string) => page.eval(`document.getElementById(${JSON.stringify(id)}).click()`);

    it('steps a frame at a time, and the loop toggle decides what the ends do', async () => {
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview');
      await scrubTo(90);
      expect(await frameNow()).toBe(90);
      await click('step-forward');
      await atFrame(91);
      await click('step-back');
      await click('step-back');
      await atFrame(89);

      // Looping is on by default, so stepping past the last frame comes round to the first.
      expect(await pressed('loop')).toBe('true');
      await scrubTo(179);
      await click('step-forward');
      await atFrame(0);
      // With it off, the ends hold.
      await click('loop');
      expect(await pressed('loop')).toBe('false');
      await click('step-back');
      await sleep(500);
      expect(await frameNow()).toBe(0);
      await scrubTo(179);
      await click('step-forward');
      await sleep(500);
      expect(await frameNow()).toBe(179);
      await click('loop');
    }, 60_000);

    it('sets the render trim from the playhead, shows it on the scrub bar, and follows the Output tab', async () => {
      await scrubTo(30);
      await click('mark-in');
      await scrubTo(150);
      await click('mark-out');
      // The Output tab holds the same points, as timecode at the template's rate.
      expect(await valueOf('#opt-in')).toBe('00:00:01:00');
      expect(await valueOf('#opt-out')).toBe('00:00:05:00');
      expect(await page.eval<string>(`document.getElementById('options-note').textContent`)).toContain('121 frames at 30 fps');
      // And the bar dims what the render would drop.
      const marks = await page.eval<{ before: string; after: string; inHidden: boolean }>(
        `(() => ({ before: document.getElementById('trim-before').style.width, after: document.getElementById('trim-after').style.width, inHidden: document.getElementById('mark-in-flag').hidden }))()`,
      );
      expect(marks.inHidden).toBe(false);
      expect(Number.parseFloat(marks.before)).toBeCloseTo((30 / 179) * 100, 1);
      expect(Number.parseFloat(marks.after)).toBeCloseTo(100 - (150 / 179) * 100, 1);

      // Editing the Output tab moves the marks back.
      await fire('#opt-in', '00:00:02:00', 'input');
      await until(async () => Number.parseFloat(await page.eval<string>(`document.getElementById('trim-before').style.width`)) > 30, 'the mark to follow the field');
      // Clear puts both ends back to the template's own.
      await click('mark-clear');
      expect(await valueOf('#opt-in')).toBe('');
      expect(await valueOf('#opt-out')).toBe('');
      expect(await page.eval<boolean>(`document.getElementById('mark-out-flag').hidden`)).toBe(true);
    }, 60_000);

    it('puts the stage\'s corner in four buttons of one size, the background one opening a picker that shows the choice', async () => {
      const corner = await page.eval<{ id: string; w: number; h: number; top: number }[]>(`[...document.querySelectorAll('.stage-view > button, .stage-view > .bg-choice > button')].map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; })`);
      expect(corner.map((b) => b.id)).toEqual(['bg-button', 'safe-toggle', 'stage-popout', 'theater']);
      expect(new Set(corner.map((b) => `${b.w}x${b.h}@${b.top}`)).size, `one size, one line: ${JSON.stringify(corner)}`).toBe(1);
      // The swatches are in the picker, which is shut until the button opens it.
      const picker = () => page.eval<boolean>(`document.getElementById('bg-picker').hidden`);
      expect(await picker()).toBe(true);
      expect(await page.eval<number>(`document.getElementById('bg-checker').getBoundingClientRect().width`), 'no swatch on the corner').toBe(0);
      await click('bg-button');
      expect(await picker()).toBe(false);
      expect(await page.eval<string>(`document.getElementById('bg-button').getAttribute('aria-expanded')`)).toBe('true');
      expect(await page.eval<string>(`document.activeElement.id`), 'the keyboard on the choice that is on').toBe('bg-checker');
      // A choice closes it, and the button wears what was chosen.
      await click('bg-white');
      expect(await picker()).toBe(true);
      expect(await page.eval<string>(`document.getElementById('preview-frame').style.backgroundColor`)).toBe('rgb(255, 255, 255)');
      expect(await page.eval<string>(`getComputedStyle(document.querySelector('#bg-button .bg-current')).backgroundColor`)).toBe('rgb(255, 255, 255)');
      expect(await page.eval<string>(`document.getElementById('bg-button').getAttribute('aria-label')`)).toBe('Preview background: White');
      // Escape closes it without choosing, and so does a press anywhere else.
      await click('bg-button');
      await page.eval(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
      expect(await picker()).toBe(true);
      expect(await page.eval<string>(`document.activeElement.id`), 'focus back on the button').toBe('bg-button');
      await click('bg-button');
      await page.eval(`document.getElementById('results').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
      expect(await picker()).toBe(true);
      // The board drawn small on the button when it is the choice.
      await click('bg-checker');
      expect(await page.eval<boolean>(`document.querySelector('#bg-button .bg-current').classList.contains('checker')`)).toBe(true);
      expect(await page.eval<string>(`document.getElementById('bg-button').dataset.tip`)).toBe('Background: Checkerboard');
    }, 60_000);

    it('keeps the background, safe areas and volume in settings', async () => {
      await click('bg-black');
      expect(await pressed('bg-black')).toBe('true');
      expect(await pressed('bg-checker')).toBe('false');
      expect(await page.eval<boolean>(`document.getElementById('preview-frame').classList.contains('checker')`)).toBe(false);
      expect(await page.eval<string>(`document.getElementById('preview-frame').style.backgroundColor`)).toBe('rgb(0, 0, 0)');

      expect(await page.eval<boolean>(`document.getElementById('safe-overlay').hidden`)).toBe(true);
      await click('safe-toggle');
      expect(await page.eval<boolean>(`document.getElementById('safe-overlay').hidden`)).toBe(false);
      // Action safe 3.5% in, title safe 5%.
      expect(await page.eval<string[]>(`[document.getElementById('safe-action').style.inset, document.getElementById('safe-title').style.inset]`)).toEqual(['3.5%', '5%']);

      await fire('#volume', '40', 'input');
      await click('mute');
      expect(await pressed('mute')).toBe('true');

      await until(async () => {
        try {
          const p = (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { player?: { background?: string; safeAreas?: boolean; volume?: number; muted?: boolean } }).player;
          return p?.background === 'black' && p.safeAreas === true && p.volume === 0.4 && p.muted === true;
        } catch {
          return false;
        }
      }, 'the player preferences in settings.json');

      // Put the stage back for the tests that follow.
      await click('bg-checker');
      await click('safe-toggle');
      await click('mute');
      await fire('#volume', '100', 'input');
    }, 60_000);
  });

  describe('aspect and resolution (milestone 19)', () => {
    const note = () => page.eval<string>(`document.getElementById('options-note').textContent`);
    const previewShape = () => page.eval<{ ratio: string; orientation: string }>(`(() => { const f = document.getElementById('preview-frame'); return { ratio: f.style.aspectRatio, orientation: f.dataset.orientation }; })()`);

    it('offers the aspects a template draws for and the sizes of each, and previews the chosen shape', async () => {
      // A shape-only template: four aspects, no declared size.
      await clickResult('Boardroom opener');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the opener preview');
      expect(await page.eval<boolean>(`document.getElementById('opt-aspect-field').hidden`)).toBe(false);
      expect(await page.eval<string[]>(`[...document.getElementById('opt-aspect').options].map((o) => o.value)`)).toEqual(['16:9', '9:16', '1:1', '4:5']);
      expect(await page.eval<string>(`document.getElementById('opt-resolution').selectedOptions[0].textContent`)).toBe('Default · 1920 × 1080');
      expect(await previewShape()).toEqual({ ratio: '1920 / 1080', orientation: 'landscape' });
      expect(await note()).toBe('');

      // Tall: the preview box turns, the note says the size, and the list is the tall list.
      await fire('#opt-aspect', '9:16', 'change');
      await until(async () => (await previewShape()).orientation === 'portrait', 'the preview to turn portrait');
      expect(await previewShape()).toEqual({ ratio: '1080 / 1920', orientation: 'portrait' });
      expect(await note()).toBe('1080 × 1920 (9:16)');
      expect(await page.eval<string[]>(`[...document.getElementById('opt-resolution').options].map((o) => o.value)`)).toEqual(['', '720x1280', '1440x2560', '2160x3840', 'custom']);
      await fire('#opt-resolution', '720x1280', 'change');
      expect(await note()).toBe('720 × 1280 (9:16)');
      expect((await previewShape()).ratio).toBe('720 / 1280');

      // A custom size must be of the chosen aspect; until it is, nothing renders.
      await fire('#opt-resolution', 'custom', 'change');
      expect(await page.eval<boolean>(`document.getElementById('opt-size-custom').hidden`)).toBe(false);
      await fire('#opt-width', '700', 'input');
      await fire('#opt-height', '1000', 'input');
      expect(await note()).toBe('700 × 1000 is 7:10, not 9:16');
      expect(await page.eval<boolean>(`document.getElementById('render').disabled`)).toBe(true);
      await fire('#opt-height', '1244', 'input');
      expect(await note()).toBe('700 × 1244 (9:16)');
      expect(await page.eval<boolean>(`document.getElementById('options-note').classList.contains('error')`)).toBe(false);

      // Safe areas on a tall frame add the zones it keeps clear; a wide frame shows the insets alone.
      await page.eval(`document.getElementById('safe-toggle').click()`);
      await until(() => page.eval<boolean>(`!document.getElementById('safe-zones').hidden`), 'the vertical zones');
      const zones = await page.eval<{ zone: string; left: string; top: string; width: string; height: string; title: string }[]>(
        `[...document.querySelectorAll('#safe-zones .zone')].map((z) => ({ zone: z.dataset.zone, left: z.style.left, top: z.style.top, width: z.style.width, height: z.style.height, title: z.title }))`,
      );
      expect(zones.map((z) => z.zone)).toEqual(['header', 'controls', 'caption']);
      expect(zones[0]).toMatchObject({ top: '0%', height: '12%', width: '100%', title: 'Header strip' });
      expect(zones[1]).toMatchObject({ left: '82%', title: 'Controls column' });
      expect(zones[2]).toMatchObject({ top: '78%', width: '82%', title: 'Caption band' });
      await fire('#opt-aspect', '16:9', 'change');
      await until(() => page.eval<boolean>(`document.getElementById('safe-zones').hidden`), 'the zones to go with the wide shape');
      expect(await page.eval<boolean>(`document.getElementById('safe-overlay').hidden`)).toBe(false);
      await page.eval(`document.getElementById('safe-toggle').click()`);

      // A template with one declared size: no aspect to choose, and the default is its own size.
      await clickResult('Wide only');
      await until(() => page.eval<boolean>(`document.getElementById('opt-aspect-field').hidden`), 'the aspect field to hide');
      expect(await page.eval<string>(`document.getElementById('opt-resolution').selectedOptions[0].textContent`)).toBe('Template size · 320 × 180');
      expect(await note()).toBe('');
      expect(await previewShape()).toEqual({ ratio: '320 / 180', orientation: 'landscape' });
    }, 90_000);

    it('never distorts the preview: the drawn box keeps its ratio squeezed narrow, short and mid-resize, for templates and media', async () => {
      // What is drawn, as the browser lays it out: the box and the room it had.
      const drawn = () =>
        page.eval<{ w: number; h: number; roomW: number; roomH: number; visible: boolean }>(
          `new Promise((r) => requestAnimationFrame(() => { const el = document.getElementById('preview-frame'); const f = el.getBoundingClientRect(); const wrap = document.querySelector('.preview-wrap').getBoundingClientRect(); r({ w: f.width, h: f.height, roomW: wrap.width, roomH: wrap.height, visible: getComputedStyle(el).visibility !== 'hidden' }); }))`,
        );
      /** The box is the declared shape, within a pixel, and inside the room; or it is not drawn at all. */
      const expectShape = async (ratio: number, where: string) => {
        const d = await drawn();
        const label = `${where}: ${JSON.stringify(d)} for ${ratio.toFixed(3)}`;
        expect(d.roomW, label).toBeGreaterThan(0);
        if (d.roomH <= 4) {
          // No room: nothing is drawn, not even the border.
          expect(d.visible, label).toBe(false);
          return;
        }
        expect(d.visible, label).toBe(true);
        expect(d.w, label).toBeGreaterThan(0);
        expect(Math.abs(d.w / d.h - ratio), label).toBeLessThan(ratio / 100 + 2 / d.h);
        expect(d.w, label).toBeLessThanOrEqual(d.roomW + 0.5);
        expect(d.h, label).toBeLessThanOrEqual(d.roomH + 0.5);
      };
      const viewport = (width: number, height: number) => page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      // The size the window really has, to go back to. Clearing the override restores the *window*, and
      // on a small display (the runner's is about 1024 px wide) that is smaller than anything emulated
      // here: a wait for "bigger than 1024" could never come true there (docs/platform-notes.md).
      const own = await page.eval<{ w: number; h: number }>(`({ w: window.innerWidth, h: window.innerHeight })`);
      const squeeze = (key: 'ArrowUp' | 'ArrowDown', times: number) =>
        page.eval(`(() => { const s = document.getElementById('split-stage'); for (let i = 0; i < ${times}; i++) s.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true })); })()`);

      await clickResult('Boardroom opener');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the opener preview');
      const aspects: [string, number][] = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['4:5', 4 / 5]];
      // Steps the stage has been squeezed by and not yet given back, so a failure still restores the layout.
      let squeezed = 0;
      try {
        for (const [aspect, ratio] of aspects) {
          await fire('#opt-aspect', aspect, 'change');
          await until(async () => (await previewShape()).ratio.split(' / ').map(Number).reduce((w, h) => w / h) === ratio, `the ${aspect} box`);
          // Wide and tall rooms, a short one, then a narrow one; checked straight after each change.
          for (const [w, h] of [[1400, 900], [1024, 697], [1024, 600], [960, 600]] as [number, number][]) {
            await viewport(w, h);
            await expectShape(ratio, `${aspect} at ${w}x${h}`);
          }
          // Mid-resize: the stage shrinks a step at a time toward its minimum share, and grows back.
          for (let i = 0; i < 8; i++) {
            await squeeze('ArrowUp', 1);
            squeezed++;
            await expectShape(ratio, `${aspect} squeezed ${i + 1}`);
          }
          await squeeze('ArrowDown', squeezed);
          squeezed = 0;
          await expectShape(ratio, `${aspect} restored`);
        }
        // Media take their own shape from the file: a 2 x 2 still, and when ffmpeg made them a 64 x 36 and a 36 x 64 clip.
        const media: [string, number][] = [['tiny', 1], ...(haveVideo ? ([['clip', 64 / 36], ['tall', 36 / 64]] as [string, number][]) : [])];
        for (const [name, ratio] of media) {
          await clickResult(name);
          await until(async () => Math.abs((await previewShape()).ratio.split(' / ').map(Number).reduce((w, h) => w / h) - ratio) < 0.001, `the box for ${name}`);
          for (const [w, h] of [[1024, 600], [960, 600], [1400, 900]] as [number, number][]) {
            await viewport(w, h);
            await expectShape(ratio, `${name} at ${w}x${h}`);
          }
        }
      } finally {
        // Whatever happened, leave the window, the stage and the Output tab as the tests after this expect:
        // its own size, the stage share it started with, and the opener back at 16:9.
        if (squeezed > 0) await squeeze('ArrowDown', squeezed);
        await page.send('Emulation.clearDeviceMetricsOverride', {});
        await until(async () => {
          const now = await page.eval<{ w: number; h: number }>(`({ w: window.innerWidth, h: window.innerHeight })`);
          return now.w === own.w && now.h === own.h;
        }, `the window back at its own ${own.w} × ${own.h}`);
        await clickResult('Boardroom opener');
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the opener back');
        await fire('#opt-aspect', '16:9', 'change');
        await until(async () => (await previewShape()).orientation === 'landscape', 'the opener back at 16:9');
      }
    }, 120_000);

    it('renders at the chosen shape and size through Prepare for drag', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available; aspect render check skipped.');
        return;
      }
      await clickResult('Boardroom opener');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the opener preview');
      await fire('#opt-aspect', '1:1', 'change');
      await fire('#opt-resolution', '720x720', 'change');
      await page.eval(`(() => { const i = document.getElementById('opt-in'); i.value = '10'; i.dispatchEvent(new Event('input', { bubbles: true })); const o = document.getElementById('opt-out'); o.value = '10'; o.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await fire('#preset', 'png-sequence', 'change');
      await page.eval(`document.getElementById('drag-prepare').click()`);
      await until(() => page.eval<boolean>(`!!document.querySelector('#queue .job-card[draggable="true"][data-file*="boardroom-opener"]')`), 'the square render to finish', 60_000);
      const file = await page.eval<string>(`document.querySelector('#queue .job-card[draggable="true"][data-file*="boardroom-opener"]').dataset.file`);
      const ffmpeg = await detectFfmpeg();
      expect(ffmpeg.ok).toBe(true);
      if (!ffmpeg.ok) return;
      // -nostdin and a time limit: a probe of a finished file must never be what stalls the suite (docs/platform-notes.md).
      const { stderr } = await runBounded(ffmpeg.path, ffmpegArgs(['-hide_banner', '-i', file, '-f', 'null', '-']), { timeoutMs: 60_000 });
      expect(stderr).toMatch(/ 720x720[, ]/);

      // Leave the tray and the Output tab as the tests that follow expect them: no cards, the default preset, no trim.
      await page.eval(`document.getElementById('clear-finished').click()`);
      await until(() => page.eval<boolean>(`document.querySelectorAll('#queue li:not(.empty)').length === 0`), 'the tray to be cleared');
      await page.eval(`document.getElementById('cache-clear').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('cache-summary').textContent.includes('0 files')`), 'the cache to be cleared');
      await fire('#preset', 'prores-4444', 'change');
      await page.eval(`(() => { for (const id of ['opt-in', 'opt-out']) { const el = document.getElementById(id); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
    }, 300_000);
  });

  describe('image slots (milestone 22)', () => {
    const field = `document.querySelector('#params [data-param="logo"] .image-field')`;

    it('searches the library in a chooser the way the search bar does (milestone 40)', async () => {
      await clickResult('Lower Third Bar');
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!${field}`), 'the logo slot field');
      const type = (q: string) =>
        page.eval(`(() => { const s = ${field}.querySelector('.image-picker input[type=search]'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const listed = () => page.eval<string[]>(`[...${field}.querySelectorAll('.image-choice .name')].map((n) => n.textContent)`);
      if (await page.eval<boolean>(`${field}.querySelector('.image-picker').hidden`)) await page.eval(`${field}.querySelector('.image-well').click()`);
      await until(() => page.eval<boolean>(`!!${field}.querySelector('.image-choice')`), 'stills in the chooser');

      // The whole query language, which the chooser's own substring match could never read: a
      // `key:value` term was looked for as a word, so it found nothing whatever the library held.
      const all = await listed();
      expect(all, 'the fixture stills').toContain('tiny');
      await type('type:image');
      expect(await listed(), 'a filter that keeps them all').toEqual(all);
      await type('type:video');
      expect(await listed(), 'a filter that keeps none of them').toEqual([]);
      await type('duration:>9999');
      expect(await listed(), 'a filter nothing can satisfy empties the list').toEqual([]);
      expect(await page.eval<string>(`${field}.querySelector('.image-choices .note').textContent`)).toBe('No stills match.');

      // And the ranking: a still whose whole name is the term comes before one it merely starts.
      await type('mark');
      expect((await listed())[0]).toBe('mark');
      await type('');
      await page.eval(`${field}.querySelector('.image-picker').hidden = true`);
    }, 120_000);

    it('picks a still from the library, treats it, keeps it in a preset by id, and clears', async () => {
      await clickResult('Lower Third Bar');
      // The well's size is measured below, and a closed drawer has no boxes (milestone 38).
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!${field}`), 'the logo slot field');
      // Empty slot: a dashed well the width of the field, inviting a choice or a drop; no Clear, no treatment.
      expect(await page.eval<boolean>(`${field}.querySelector('.image-well').classList.contains('empty')`)).toBe(true);
      expect(await page.eval<string>(`${field}.querySelector('.image-well .empty-label').textContent`)).toBe('Choose or drop an image');
      expect(await page.eval<string>(`${field}.querySelector('.image-name').textContent`)).toBe('No image; the slot shows its fallback');
      expect(await page.eval<boolean>(`${field}.querySelector('[aria-label="Clear image"]').hidden`)).toBe(true);
      expect(await page.eval<boolean>(`${field}.querySelector('.image-treatment').hidden`)).toBe(true);
      // Clicking the well opens the picker, which lists the library's stills; the fixture PNG is one.
      await page.eval(`${field}.querySelector('.image-well').click()`);
      await until(() => page.eval<boolean>(`!!${field}.querySelector('.image-choice')`), 'stills in the picker');
      await page.eval(`(() => { const s = ${field}.querySelector('.image-picker input[type=search]'); s.value = 'tin'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const listed = await page.eval<string[]>(`[...${field}.querySelectorAll('.image-choice .name')].map((n) => n.textContent)`);
      expect(listed).toEqual(['tiny']);
      await page.eval(`${field}.querySelector('.image-choice').click()`);
      await until(() => page.eval<boolean>(`!${field}.querySelector('.image-well').classList.contains('empty')`), 'the chosen image in the well');
      // The library's poster when it has one, the still itself until then: never a broken image.
      expect(await page.eval<string>(`${field}.querySelector('.image-well img').getAttribute('src')`)).toMatch(/^pulp-(thumb|media):\/\/[0-9a-f]{24}\/$/);
      expect(await page.eval<string>(`${field}.querySelector('.image-name').textContent`)).toBe('tiny');
      // The pixel size appears once the background probe has measured the file; without ffprobe there is none to show.
      if (haveVideo) await until(async () => (await page.eval<string>(`${field}.querySelector('.image-dims').textContent`)) === '2 × 2', 'the image size beside the name');
      expect(await page.eval<boolean>(`${field}.querySelector('.image-picker').hidden`)).toBe(true);
      // The image is contained and centered at its own shape, inside a well that keeps its height.
      const drawn = await page.eval<{ well: number[]; img: number[] }>(
        `(() => { const w = ${field}.querySelector('.image-well').getBoundingClientRect(); const i = ${field}.querySelector('.image-well img').getBoundingClientRect();
          return { well: [w.width, w.height, w.left, w.right], img: [i.width, i.height, i.left, i.right] }; })()`,
      );
      expect(drawn.well[1]).toBe(132);
      expect(drawn.img[0]).toBeCloseTo(drawn.img[1]!, 0); // the 2 x 2 fixture is square
      expect(drawn.img[2]! - drawn.well[2]!).toBeCloseTo(drawn.well[3]! - drawn.img[3]!, 0); // centered
      // Treatment is a segmented control and the effects are toggles; both ride along with the choice.
      await page.eval(`${field}.querySelector('.segmented [data-treatment=white]').click()`);
      await page.eval(`${field}.querySelector('.image-effects [data-effect=shadow]').click()`);
      expect(await page.eval<string[]>(`[...${field}.querySelectorAll('.segmented button')].map((b) => b.getAttribute('aria-pressed'))`)).toEqual(['false', 'false', 'true', 'false']);
      expect(await page.eval<boolean>(`${field}.querySelector('.image-treatment .tint').hidden`)).toBe(true);
      // The stage was granted the image and drew the frame with it: no note about a missing image.
      await sleep(600);
      expect(await page.eval<string>(`document.getElementById('stage-note').textContent`)).not.toContain('not in the library');

      // Saved as a preset by library id, with the treatment.
      await page.eval(`(() => { const n = document.getElementById('param-preset-name'); n.value = 'With logo'; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await page.eval(`document.getElementById('param-preset-save').click()`);
      let stored: { id: string; treatment: string; effect: string } | undefined;
      await until(async () => {
        try {
          const f = JSON.parse(await readFile(join(userData, 'presets', 'pulp.samples.lower-third-bar.json'), 'utf8')) as { presets: Record<string, { logo?: { id: string; treatment: string; effect: string } }> };
          stored = f.presets['With logo']?.logo;
          return stored !== undefined;
        } catch {
          return false;
        }
      }, 'the preset with the logo');
      expect(stored).toMatchObject({ treatment: 'white', effect: 'shadow' });
      expect(stored!.id).toMatch(/^[0-9a-f]{24}$/);

      // Tinted is the one treatment with a color, so the swatch appears only for it.
      await page.eval(`${field}.querySelector('.segmented [data-treatment=tinted]').click()`);
      await until(() => page.eval<boolean>(`!${field}.querySelector('.image-treatment .tint').hidden`), 'the tint swatch');
      await page.eval(`${field}.querySelector('.segmented [data-treatment=white]').click()`);
      await until(() => page.eval<boolean>(`${field}.querySelector('.image-treatment .tint').hidden`), 'the tint swatch gone again');

      // Hidden is not cleared: nothing is drawn there, not even the fallback, and the choice is kept.
      await page.eval(`${field}.querySelector('.image-buttons .icon-button[aria-pressed]').click()`);
      await until(() => page.eval<boolean>(`${field}.querySelector('.image-well').classList.contains('hidden-slot')`), 'the slot hidden');
      expect(await page.eval<string>(`${field}.querySelector('.image-name').textContent`)).toBe('tiny · not drawn');
      expect(await page.eval<string>(`${field}.querySelector('.image-buttons .icon-button[aria-pressed]').getAttribute('aria-label')`)).toBe('Show Logo');
      // How it would be treated is not a question worth asking while nothing is drawn.
      expect(await page.eval<boolean>(`${field}.querySelector('.image-treatment').hidden`)).toBe(true);
      // It rides with the parameters, so a preset keeps it.
      await page.eval(`(() => { const n = document.getElementById('param-preset-name'); n.value = 'Hidden logo'; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await page.eval(`document.getElementById('param-preset-save').click()`);
      await until(async () => {
        try {
          const f = JSON.parse(await readFile(join(userData, 'presets', 'pulp.samples.lower-third-bar.json'), 'utf8')) as { presets: Record<string, { logo?: { id: string; hidden: boolean } }> };
          return f.presets['Hidden logo']?.logo?.hidden === true && typeof f.presets['Hidden logo']?.logo?.id === 'string';
        } catch {
          return false;
        }
      }, 'the preset keeping the hidden slot and its image');
      await page.eval(`document.getElementById('param-preset-delete').click()`);
      // Shown again, the image it kept is back.
      await page.eval(`${field}.querySelector('.image-buttons .icon-button[aria-pressed]').click()`);
      await until(() => page.eval<boolean>(`!${field}.querySelector('.image-well').classList.contains('hidden-slot')`), 'the slot shown again');
      expect(await page.eval<string>(`${field}.querySelector('.image-name').textContent`)).toBe('tiny');

      // Clear empties the slot; applying the preset brings the image back.
      await page.eval(`${field}.querySelector('[aria-label="Clear image"]').click()`);
      await until(() => page.eval<boolean>(`${field}.querySelector('.image-well').classList.contains('empty')`), 'the cleared slot');
      await page.eval(`(() => { const s = document.getElementById('param-preset-list'); s.value = 'With logo'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(() => page.eval<boolean>(`!${field}.querySelector('.image-well').classList.contains('empty')`), 'the preset\'s logo back');
      expect(await page.eval<string>(`${field}.querySelector('.segmented [aria-pressed=true]').dataset.treatment`)).toBe('white');
      // Leave the template without a logo for the tests that follow.
      await page.eval(`${field}.querySelector('[aria-label="Clear image"]').click()`);
      await page.eval(`(() => { const s = document.getElementById('param-preset-list'); s.value = 'With logo'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`document.getElementById('param-preset-delete').click()`);
    }, 90_000);
  });

  describe('layers (milestone 23)', () => {
    const CARD = 'pulp.samples.title-card';
    const section = `document.querySelector('#params .layers-block[data-block=card]')`;
    const rows = `[...document.querySelectorAll('#params .layer-row')]`;
    const layerIds = () => page.eval<string[]>(`${rows}.map((r) => r.dataset.layer)`);
    const shape = () => page.eval<string>(`document.getElementById('preview-frame').dataset.orientation`);

    /**
     * The bands of light text the card draws, top to bottom: one per line of type. Counted from the
     * template's own canvas, so it is what was drawn and not what the form says. The rule is thin
     * and colored, so a band has to be a few rows tall to count.
     */
    const bands = async () => (await drawn()).bands;
    /** The light bands and the canvas they were counted on, so a reading from the wrong page is obvious. */
    const drawn = () =>
      inTemplate<{ canvas: number[]; bands: { top: number; height: number; alpha: number }[] }>(
        `(() => {
          const c = document.getElementById('c'); const x = c.getContext('2d');
          const d = x.getImageData(0, 0, c.width, c.height).data;
          const out = []; let start = -1;
          for (let y = 0; y < c.height; y++) {
            let ink = 0, brightest = 0;
            for (let px = 0; px < c.width; px += 3) {
              const i = (y * c.width + px) * 4;
              if (d[i] > 110 && d[i + 1] > 110 && d[i + 2] > 110) { ink++; brightest = Math.max(brightest, d[i]); }
            }
            if (ink > 1) { if (start < 0) { start = y; out.push({ top: y, height: 0, alpha: 0 }); } out[out.length - 1].height = y - start + 1; out[out.length - 1].alpha = Math.max(out[out.length - 1].alpha, brightest); }
            else start = -1;
          }
          // Join bands a few pixels apart: one line of type can leave a thin gap above its
          // descenders in a substitute font (Linux has no Georgia), and a line is not two lines.
          const joined = [];
          for (const b of out) {
            const last = joined[joined.length - 1];
            if (last && b.top - (last.top + last.height) <= 8) { last.height = b.top + b.height - last.top; last.alpha = Math.max(last.alpha, b.alpha); }
            else joined.push({ ...b });
          }
          return { canvas: [c.width, c.height], bands: joined.filter((b) => b.height > 3) };
        })()`,
        CARD,
      );

    /**
     * Scrub, then wait until the template page says it has drawn that frame — not until a guessed
     * number of milliseconds has passed. A frame on a two-core runner can take longer than any
     * guess, and a canvas read before it lands shows the previous frame (docs/platform-notes.md).
     */
    const scrubAndWait = async (frame: number) => {
      await scrubTo(frame);
      await until(() => inTemplate<boolean>(`!!(window.__pulp && window.__pulp.drawn && window.__pulp.drawn.frame === ${frame})`, CARD).catch(() => false), `frame ${frame} to be drawn`);
    };

    /**
     * Put the template's own layers back and drop any edit, whatever happened. A test that fails
     * part way must not leave a layer behind for the next one (docs/platform-notes.md, "Windows CI").
     */
    async function restoreLayers(block = 'card'): Promise<void> {
      const reset = `document.querySelector('#params .layers-block[data-block=${block}] .layers-reset')`;
      await page.eval(`(() => { const b = ${reset}; if (b && !b.hidden) b.click(); })()`);
      await page.eval(`(() => { const b = document.getElementById('reset-all'); if (!b.disabled) b.click(); })()`);
    }

    /** Wait until what the card has drawn satisfies `want`, and return it; the last reading names the failure. */
    async function untilDrawn(want: (d: Awaited<ReturnType<typeof drawn>>) => boolean, what: string): Promise<Awaited<ReturnType<typeof drawn>>> {
      let last = await drawn();
      await until(async () => {
        last = await drawn();
        return want(last);
      }, `${what} (last seen: ${JSON.stringify(last)})`);
      return last;
    }

    it('shows the template\'s layers, draws them, and keeps a required one', async () => {
      await clickResult('Title Card');
      await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
      expect(await layerIds()).toEqual(['title', 'subtitle']);
      expect(await page.eval<string[]>(`${rows}.map((r) => r.querySelector('.layer-text').value)`)).toEqual(['Field Notes', 'Episode 1: Early Light']);
      // The template marks the title required: it has no Remove, and the subtitle does.
      expect(await page.eval<string[]>(`${rows}.map((r) => [...r.querySelectorAll('.layer-actions button')].map((b) => b.getAttribute('aria-label')).join()) `)).toEqual([
        'Hide Title,Move Title up,Move Title down',
        'Hide Subtitle,Move Subtitle up,Move Subtitle down,Remove Subtitle',
      ]);
      // Nothing has been changed yet, so there is nothing to reset.
      expect(await page.eval<boolean>(`${section}.querySelector('.layers-reset').hidden`)).toBe(true);

      await scrubAndWait(110);
      const shown = await untilDrawn((d) => d.canvas[0] === 1920 && d.canvas[1] === 1080 && d.bands.length === 2, 'the wide card with its two lines');
      expect(shown.bands, JSON.stringify(shown)).toHaveLength(2);
      expect(shown.bands[0]!.height).toBeGreaterThan(shown.bands[1]!.height); // the title is set larger than its subtitle
    }, 90_000);

    it('adds a line that rides the same animation, hides it, reorders and removes it, all undoable', async () => {
      try {
      await page.eval(`${section}.querySelector('[data-add=text]').click()`);
      await until(async () => (await layerIds()).length === 3, 'the added layer');
      const added = (await layerIds())[2]!;
      await page.eval(`(() => { const i = ${rows}[2].querySelector('.layer-text'); i.value = 'Recorded on location'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await scrubAndWait(110);
      await until(async () => (await bands()).length === 3, 'the third line in the preview');
      // The page says how many layers the frame on the canvas carried: that, not the pixels, is the direct answer.
      expect(await inTemplate<number>(`window.__pulp.drawn.layers`, CARD)).toBe(3);

      // It rides the stack: each position starts 0.7 s after the one above it, and the card clears at the end.
      await scrubAndWait(36); // 1.2 s: the subtitle is in, the third line starts at 1.4 s
      const early = await bands();
      expect(early.length, JSON.stringify(early)).toBe(2);
      await scrubAndWait(60); // 2 s: all three
      expect(await bands()).toHaveLength(3);
      await scrubAndWait(149); // the last frame: everything has faded out
      expect(await bands()).toHaveLength(0);
      await scrubAndWait(110);

      // Hidden: kept in the list, not drawn, and the stack closes up.
      await page.eval(`${rows}[2].querySelector('[aria-label="Hide Line 3"]').click()`);
      await until(async () => (await bands()).length === 2, 'the hidden line to go from the preview');
      expect(await layerIds()).toEqual(['title', 'subtitle', added]);
      expect(await page.eval<boolean>(`${rows}[2].classList.contains('hidden-layer')`)).toBe(true);
      await page.eval(`${rows}[2].querySelector('[aria-label="Show Line 3"]').click()`);
      await until(async () => (await bands()).length === 3, 'the line back');

      // Reordered: the stack order is the list order, and the drawn order follows.
      await page.eval(`${rows}[2].querySelector('[aria-label="Move Line 3 up"]').click()`);
      await until(async () => (await layerIds())[1] === added, 'the reorder');
      // The middle band is now the added line, which is set at the block's own size: taller than the
      // subtitle. The list reorders before the frame redraws, so wait for the drawn stack, not the list.
      await until(async () => {
        const b = await bands();
        return b.length === 3 && b[1]!.height > b[2]!.height;
      }, 'the middle band drawn taller after the reorder');

      // Removed, then brought back by undo.
      await page.eval(`${rows}[1].querySelector('[aria-label="Remove Line 3"]').click()`);
      await until(async () => (await layerIds()).length === 2, 'the removed layer');
      await page.eval(`document.getElementById('undo').click()`);
      await until(async () => (await layerIds()).length === 3, 'undo bringing it back');
      expect(await page.eval<string>(`${rows}[1].querySelector('.layer-text').value`)).toBe('Recorded on location');

      // Reset layers puts the template's own back, and that is undoable too.
      await page.eval(`${section}.querySelector('.layers-reset').click()`);
      await until(async () => (await layerIds()).length === 2, 'the template\'s own layers');
      expect(await page.eval<boolean>(`${section}.querySelector('.layers-reset').hidden`)).toBe(true);
      expect(await page.eval<boolean>(`document.getElementById('reset-all').disabled`)).toBe(true);
      await page.eval(`document.getElementById('undo').click()`);
      await until(async () => (await layerIds()).length === 3, 'undo bringing the layers back');
      await page.eval(`${section}.querySelector('.layers-reset').click()`);
      await until(async () => (await layerIds()).length === 2, 'the template\'s own layers again');
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('adds an audio layer, with its window, delay, loop, volume and fades, heard in the preview (milestone 48)', async () => {
      await clickResult('Title Card');
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
      const before = await layerIds();
      const sounds = `(window.pulpLayerSounds ? window.pulpLayerSounds() : [])`;
      try {

        // Audio sits beside Text, Image and Video under Add layer.
        expect(await page.eval<string[]>(`[...${section}.querySelectorAll('.layer-add button[data-add]')].map((b) => b.textContent)`))
          .toEqual(['Text', 'Image', 'Video', 'Audio', 'Shape']);
        await page.eval(`${section}.querySelector('.layer-add button[data-add=audio]').click()`);
        await until(async () => (await layerIds()).length === before.length + 1, 'the audio layer');
        const layer = (await layerIds()).find((id) => !before.includes(id))!;
        const card = `document.querySelector('#params .param-card[data-layer="${layer}"]')`;

        // It draws nothing, so it has no size, no alignment and no look — only its sound and when.
        expect(await page.eval<boolean>(`!!${card}.querySelector('.sound-field')`)).toBe(true);
        expect(await page.eval<boolean>(`!!${card}.querySelector('.layer-look')`), 'nothing to style').toBe(false);
        expect(await page.eval<string>(`${card}.querySelector('.sound-field .name').textContent`)).toBe('No sound; the layer is silent');
        // And nothing is heard until one is chosen.
        expect(await page.eval<number>(`${sounds}.length`)).toBe(0);

        // Choose the bundled fixture sound from the layer's own chooser.
        await page.eval(`${card}.querySelector('.sound-field .picker-toggle').click()`);
        await until(() => page.eval<boolean>(`!${card}.querySelector('.image-picker').hidden`), 'the sound chooser');
        await until(
          () => page.eval<boolean>(
            `(() => { const b = [...${card}.querySelectorAll('.image-picker .image-choice')].find((x) => (x.textContent || '').startsWith('silence'));
              if (!b) return false; b.click(); return true; })()`,
          ),
          'the sound chosen from the chooser',
        );

        // Its settings are all there, in seconds, and the preview holds a sound for the layer.
        const labels = () => page.eval<string[]>(`[...${card}.querySelectorAll('.sound-settings > .type-field > span')].map((s) => s.textContent)`);
        await until(async () => (await labels()).length >= 8, 'the sound settings');
        expect(await labels()).toEqual(['In point, s', 'Out point, s', 'At the end', 'Start delay, s', 'Volume, %', 'Muted', 'Fade in, s', 'Fade out, s', 'Voice']);
        await until(() => page.eval<number>(`${sounds}.length`).then((n) => n === 1), 'the layer heard in the preview');
        expect(await page.eval<string>(`${sounds}[0].kind`)).toBe('sound');
        // Paused is silent: a held frame makes no sound.
        expect(await page.eval<boolean>(`${sounds}.every((s) => !s.playing)`)).toBe(true);

        // Its waveform is on its bar under the scrub bar, from milestone 12's peaks (milestone 48).
        const wave = `document.querySelector('#transport-lanes .layer-bar[data-layer="${layer}"] .bar-wave')`;
        await until(
          () => page.eval<boolean>(`(() => { const w = ${wave}; return !!w && !w.hidden && !!w.querySelector('path')?.getAttribute('d'); })()`),
          'the waveform on the layer\'s bar',
          30_000,
        );

        // The loudness meter in the transport row measures the mix (milestone 52).
        await until(
          () => page.eval<boolean>(`(() => { const m = document.getElementById('loudness'); return !m.hidden && /LUFS/.test(m.getAttribute('aria-label') || '') && /LUFS/.test(m.dataset.tip || ''); })()`),
          'the loudness meter on the mix',
          30_000,
        );
        // And the row's controls keep apart at the default width and the narrow ones — the same
        // rule the 1280 × 788 layout test holds the row to with the meter away. The meter is on
        // the line at the default size and folds on a narrow window (below 1150 px), the way the
        // tab labels and the library's counts do: on CI's 1008 px window it sat the Output tab's
        // button 62 px over the project's name (docs/ideas.md, 2026-11-01).
        try {
          for (const [width, height] of [[1280, 788], [1120, 700], [1008, 655], [960, 600]] as const) {
            await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
            await until(() => page.eval<boolean>(`window.innerHeight === ${height} && window.innerWidth === ${width}`), `the ${width} × ${height} window`);
            await page.eval(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
            const meterShown = await page.eval<boolean>(`document.getElementById('loudness').getBoundingClientRect().width > 0`);
            expect(meterShown, `the meter ${width >= 1150 ? 'on the line' : 'folded'} at ${width} px`).toBe(width >= 1150);
            const rowBoxes = await page.eval<{ id: string; left: number; right: number; top: number; bottom: number }[]>(
              `[...document.querySelectorAll('#region-transport .buttons-line button, #region-transport .buttons-line input, #region-transport .buttons-line #timecode, #region-transport .buttons-line #loudness, #region-status > *')]
                 .filter((el) => el.getBoundingClientRect().width > 0)
                 .map((el) => { const b = el.getBoundingClientRect(); return { id: el.id || el.className, left: b.left, right: b.right, top: b.top, bottom: b.bottom }; })`,
            );
            for (let i = 0; i < rowBoxes.length; i++) {
              for (let j = i + 1; j < rowBoxes.length; j++) {
                const a = rowBoxes[i]!;
                const b = rowBoxes[j]!;
                const met = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
                expect(met, `${a.id} does not overlap ${b.id} at ${width} × ${height} with the mix measured`).toBe(0);
              }
            }
          }
        } finally {
          await page.send('Emulation.clearDeviceMetricsOverride', {});
          await page.eval(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
        }

        // The playhead goes to the top, where the sound starts: how loud a layer is is a question
        // about a moment, and the preview answers it for the moment on the stage.
        await page.eval(`(() => { const s = document.getElementById('scrub'); s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        // Volume reaches the element, under the transport's own.
        const field = (name: string) => `${card}.querySelector('input[aria-label$="${name}"]')`;
        await page.eval(`(() => { const v = ${field('volume')}; v.value = '40'; v.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<number>(`${sounds}[0] ? ${sounds}[0].volume : -1`).then((v) => Math.abs(v - 0.4) < 0.01), 'the layer volume on the element');

        // A fade in means silence at the very start, where the full volume was a moment ago.
        await page.eval(`(() => { const f = ${field('fade in')}; f.value = '2'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<number>(`${sounds}[0] ? ${sounds}[0].volume : -1`).then((v) => v === 0), 'silent at the start of its fade in');

        // Muted asks for nothing to be heard, so the element goes and the meter has nothing to
        // measure — but the bar still shows what the layer holds, since the bar is about time.
        await page.eval(`(() => { const m = ${field('muted')}; m.checked = true; m.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<number>(`${sounds}.length`).then((n) => n === 0), 'muted means nothing to hear');
        await until(() => page.eval<boolean>(`document.getElementById('loudness').hidden`), 'and nothing on the meter', 30_000);
        expect(await page.eval<boolean>(`(() => { const w = ${wave}; return !!w && !w.hidden; })()`), 'the waveform stays while muted').toBe(true);
        await page.eval(`(() => { const m = ${field('muted')}; m.checked = false; m.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<number>(`${sounds}.length`).then((n) => n === 1), 'and back when unmuted');

        // Taking it out is one undo step, like any layer.
        await page.eval(`${card}.querySelector('.layer-actions button[aria-label^="Remove"]').click()`);
        await until(async () => (await layerIds()).length === before.length, 'the layer removed');
        await until(() => page.eval<number>(`${sounds}.length`).then((n) => n === 0), 'and nothing left to hear');
        await page.eval(`document.getElementById('undo').click()`);
        await until(async () => (await layerIds()).length === before.length + 1, 'undo bringing it back');
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('treats a voice on a layer with sound, with an amount, and the preview plays the treated file (milestone 53)', async () => {
      await clickResult('Title Card');
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
      const before = await layerIds();
      const sounds = `(window.pulpLayerSounds ? window.pulpLayerSounds() : [])`;
      try {
        // An audio layer with the fixture sound, as milestone 48's test places one.
        await page.eval(`${section}.querySelector('.layer-add button[data-add=audio]').click()`);
        await until(async () => (await layerIds()).length === before.length + 1, 'the audio layer');
        const layer = (await layerIds()).find((id) => !before.includes(id))!;
        const card = `document.querySelector('#params .param-card[data-layer="${layer}"]')`;
        await page.eval(`${card}.querySelector('.sound-field .picker-toggle').click()`);
        await until(
          () => page.eval<boolean>(
            `(() => { const b = [...${card}.querySelectorAll('.image-picker .image-choice')].find((x) => (x.textContent || '').startsWith('silence'));
              if (!b) return false; b.click(); return true; })()`,
          ),
          'the sound chosen from the chooser',
        );
        await until(() => page.eval<number>(`${sounds}.length`).then((n) => n === 1), 'the layer heard in the preview');

        // The Voice select offers the six treatments beside "As recorded", with no amount yet.
        const voice = `${card}.querySelector('select[aria-label$="voice treatment"]')`;
        await until(() => page.eval<boolean>(`!!${voice}`), 'the voice select');
        expect(await page.eval<string[]>(`[...${voice}.options].map((o) => o.textContent)`))
          .toEqual(['As recorded', 'Clean voice', 'Podcast', 'Reduce noise', 'Phone', 'Radio', 'Warm']);
        expect(await page.eval<boolean>(`!!${card}.querySelector('input[aria-label$="voice amount"]')`)).toBe(false);

        // Choosing one brings its amount and its one-line description, and the preview's element
        // swaps to the treated file once the main process has rendered it.
        await page.eval(`(() => { const s = ${voice}; s.value = 'reduce-noise'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<string>(`${card}.querySelector('input[aria-label$="voice amount"]')?.value || ''`).then((v) => v === '100'), 'the amount at its full');
        expect(await page.eval<string>(`${card}.querySelector('.voice-note').textContent`)).toContain('Noise reduction alone');
        await until(() => page.eval<string>(`${sounds}[0] ? ${sounds}[0].voice : ''`).then((v) => v === 'reduce-noise|1'), 'the treated file in the preview', 30_000);

        // The amount travels: half of it is half the recipe, re-rendered.
        await page.eval(`(() => { const a = ${card}.querySelector('input[aria-label$="voice amount"]'); a.value = '50'; a.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<string>(`${sounds}[0] ? ${sounds}[0].voice : ''`).then((v) => v === 'reduce-noise|0.5'), 'the preview at half the treatment', 30_000);

        // Back to "As recorded": the element plays the file as it was, straight away.
        await page.eval(`(() => { const s = ${voice}; s.value = 'none'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<string>(`${sounds}[0] ? ${sounds}[0].voice : 'gone'`).then((v) => v === ''), 'the sound as recorded again');
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('builds the cut track: clips end to end from drops, split at the playhead, trimmed with snapping, rippled out and moved, one undo step each (milestone 49)', async () => {
      await clickResult('Title Card');
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
      const lane = `document.getElementById('cut-track')`;
      const cut = (i: number) => `document.querySelectorAll('#cut-track .cut')[${i}]`;
      const count = () => page.eval<number>(`document.querySelectorAll('#cut-track .cut').length`);
      const labels = () => page.eval<string[]>(`[...document.querySelectorAll('#cut-track .cut .cut-label')].map((l) => l.textContent)`);
      const ends = () => page.eval<string[]>(`[...document.querySelectorAll('#cut-track .cut .cut-trim.end')].map((h) => h.getAttribute('aria-valuenow'))`);
      const clipId = await onResult<string>('clip', '(li) => li.dataset.id');
      const tallId = await onResult<string>('tall', '(li) => li.dataset.id');
      /** A drag over and a drop at a fraction across the lanes, as a real drag from a result card sends them. */
      const dropOn = (fx: number, id: string) =>
        page.eval<boolean>(
          `(() => {
            const el = document.getElementById('transport-lanes');
            const r = el.getBoundingClientRect();
            const dt = new DataTransfer();
            dt.setData('application/x-pulp-item', ${JSON.stringify(id)});
            const at = { clientX: r.left + r.width * ${fx}, clientY: r.top + r.height / 2, dataTransfer: dt, bubbles: true, cancelable: true };
            el.dispatchEvent(new DragEvent('dragover', at));
            el.dispatchEvent(new DragEvent('drop', at));
            return true;
          })()`,
        );
      const scrub = (frame: number) => page.eval(`(() => { const s = document.getElementById('scrub'); s.value = '${frame}'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const splitKey = () => page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true }))`);
      try {
        // No track, no lane: a project without one works as now.
        expect(await page.eval<boolean>(`${lane}.hidden`)).toBe(true);

        // Two clips dropped from the results land end to end, each drop one step. The card is
        // 5 s; the two-second fixtures sit at 0-2 and 2-4 on the scrub bar's own scale.
        await dropOn(0.5, clipId!);
        await until(async () => (await count()) === 1, 'the first cut');
        expect(await page.eval<boolean>(`${lane}.hidden`)).toBe(false);
        await dropOn(0.9, tallId!);
        await until(async () => (await count()) === 2, 'the second cut, after the first');
        expect(await labels()).toEqual(['clip', 'tall']);
        expect(await ends()).toEqual(['2', '4']);
        // The project's length follows the track: two two-second shots are a four-second piece.
        expect(await page.eval<string>(`document.getElementById('scrub').max`)).toBe('119');

        // Split at the playhead (Cmd/Ctrl+B): the cut under one second becomes two meeting there.
        await scrub(30);
        await until(() => page.eval<string>(`document.getElementById('preview-frame').dataset.frame`).then((f) => Number(f) === 30), 'the playhead at one second');
        await splitKey();
        await until(async () => (await count()) === 3, 'the split');
        expect(await ends()).toEqual(['1', '2', '4']);
        // At a boundary there is nothing to split: no third piece, and no undo step to pay later.
        await scrub(60);
        await until(() => page.eval<string>(`document.getElementById('preview-frame').dataset.frame`).then((f) => Number(f) === 60), 'the playhead on the cut');
        await splitKey();
        expect(await count()).toBe(3);

        // Trim the last cut's end by a second: everything is a ripple on an end-to-end track. The
        // lane's scale is the length, and the length follows the track, so it is read fresh per drag.
        const width = await page.eval<number>(`${lane}.getBoundingClientRect().width`);
        const px = async (seconds: number) => {
          const max = Number(await page.eval<string>(`document.getElementById('scrub').max`));
          return Math.round((seconds / ((max + 1) / 30)) * width);
        };
        const drag = async (target: string, dx: number) => {
          await page.eval(`${target}.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 7, clientX: 400, bubbles: true }))`);
          await page.eval(`${target}.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: ${400 + dx}, bubbles: true }))`);
          await page.eval(`${target}.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: ${400 + dx}, bubbles: true }))`);
        };
        await drag(`${cut(2)}.querySelector('.cut-trim.end')`, -(await px(1)));
        await until(async () => Math.abs(parseFloat((await ends())[2]!) - 3) < 0.05, 'the end a second earlier');
        // The length follows the trim too, held to the template's own floor: its entrance, its
        // exit and the sliver of hold a stretched card keeps (3.57 s at 30 fps).
        expect(await page.eval<string>(`document.getElementById('scrub').max`)).toBe('106');

        // And a trim snaps: dragged to within a few pixels of the playhead, it lands exactly on it.
        await scrub(75);
        await until(() => page.eval<string>(`document.getElementById('preview-frame').dataset.frame`).then((f) => Number(f) === 75), 'the playhead at 2.5 s');
        await drag(`${cut(2)}.querySelector('.cut-trim.end')`, -(await px(0.47)));
        await until(async () => (await ends())[2] === '2.5', 'the end snapped to the playhead');

        // Move the last cut to the front by its body: it lands at the nearest boundary.
        await drag(`${cut(2)}.querySelector('.cut-body')`, -(await px(2.3)));
        await until(async () => (await labels()).join() === 'tall,clip,clip', 'the cut moved to the front');

        // Ripple delete: the middle goes and the one after closes up.
        await page.eval(`${cut(1)}.querySelector('.cut-body').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))`);
        await until(async () => (await count()) === 2, 'the middle rippled out');
        expect(await ends()).toEqual(['0.5', '1.5']);

        // Every gesture was one undo step, including the boundary split that wrote none.
        const undo = () => page.eval(`document.getElementById('undo').click()`);
        await undo();
        await until(async () => (await count()) === 3, 'undo brings the deleted cut back');
        await undo();
        await until(async () => (await labels()).join() === 'clip,clip,tall', 'undo puts the move back');
        await undo();
        await until(async () => (await ends())[2] === '3', 'undo takes the snapped trim back');
        await undo();
        await until(async () => (await ends())[2] === '4', 'undo takes the trim back');
        await undo();
        await until(async () => (await count()) === 2, 'undo heals the split');
        await undo();
        await until(async () => (await count()) === 1, 'undo takes the second drop back');
        await undo();
        await until(() => page.eval<boolean>(`${lane}.hidden`), 'undo takes the track away entirely');
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('plays the cut track under the graphic: a stage drop lands on it, the cuts switch to the frame, and a cut\'s sound joins the mix with its waveform (milestone 49)', async () => {
      await clickResult('Title Card');
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
      const before = await layerIds();
      const count = () => page.eval<number>(`document.querySelectorAll('#cut-track .cut').length`);
      const sounds = `(window.pulpLayerSounds ? window.pulpLayerSounds() : [])`;
      const clipId = await onResult<string>('clip', '(li) => li.dataset.id');
      const tallId = await onResult<string>('tall', '(li) => li.dataset.id');
      const noisyId = await onResult<string>('noisy', '(li) => li.dataset.id');
      const dropOnStage = (id: string) =>
        page.eval<boolean>(
          `(() => {
            const el = document.getElementById('preview-frame');
            const r = el.getBoundingClientRect();
            const dt = new DataTransfer();
            dt.setData('application/x-pulp-item', ${JSON.stringify(id)});
            const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, dataTransfer: dt, bubbles: true, cancelable: true };
            el.dispatchEvent(new DragEvent('dragover', at));
            el.dispatchEvent(new DragEvent('drop', at));
            return true;
          })()`,
        );
      const scrub = (frame: number) => page.eval(`(() => { const s = document.getElementById('scrub'); s.value = '${frame}'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const pixel = (fx: number) => page.eval<number[]>(
        `(() => { const c = document.getElementById('track-picture'); const d = c.getContext('2d').getImageData(Math.floor(c.width * ${fx}), Math.floor(c.height / 2), 1, 1).data; return [d[0], d[1], d[2]]; })()`,
      );
      try {
        // A clip dropped on the stage lands on the track — the shots of the project — not as a layer.
        await dropOnStage(clipId!);
        await until(async () => (await count()) === 1, 'the stage drop on the track');
        expect(await layerIds()).toEqual(before);
        await dropOnStage(tallId!);
        await until(async () => (await count()) === 2, 'the second shot after the first');

        // The track's picture sits under the graphic, drawn to the frame on screen: inside the
        // first cut the wide test pattern fills the frame, and inside the second the tall one
        // leaves the sides to the pad — the cut switched on the boundary's own frame.
        await scrub(15);
        // The wide pattern fills the frame: a quarter along sits inside its picture.
        await until(async () => {
          const [r, g, b] = await pixel(0.25);
          return r! + g! + b! > 120;
        }, 'the first cut\'s picture under the graphic', 30_000);
        await scrub(75);
        await until(() => page.eval<string>(`document.getElementById('preview-frame').dataset.frame`).then((f) => Number(f) === 75), 'the playhead inside the second cut');
        // The tall pattern is pillarboxed: a quarter along is the pad now, and the center its picture.
        await until(async () => {
          const [r, g, b] = await pixel(0.25);
          return r! + g! + b! < 60;
        }, 'the tall cut pillarboxed: the side is the pad', 30_000);
        // Its frames arrive as a tile around the playhead (milestone 58), so the center lights when they land.
        await until(async () => {
          const [r, g, b] = await pixel(0.5);
          return r! + g! + b! > 120;
        }, 'and its picture at the center', 30_000);

        // A cut with sound joins the mix through the same elements an audio layer plays by, and
        // its waveform draws on its stretch of the lane; the silent test patterns add nothing.
        await dropOnStage(noisyId!);
        await until(async () => (await count()) === 3, 'the shot with sound');
        await until(() => page.eval<number>(`${sounds}.filter((s) => s.key.startsWith('@track.')).length`).then((n) => n === 1), 'the cut\'s sound in the preview mix', 30_000);
        expect(await page.eval<string>(`${sounds}.find((s) => s.key.startsWith('@track.')).key`)).toBe('@track.2');
        await until(
          () => page.eval<boolean>(
            `(() => { const w = document.querySelectorAll('#cut-track .cut')[2]?.querySelector('.cut-wave'); return !!w && !w.hidden && !!w.querySelector('path')?.getAttribute('d'); })()`,
          ),
          'the waveform on the cut',
          30_000,
        );
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('finishes a cut: transitions from the menu or a wipe dropped on the join, the sound unlinked, and silences shown before they are cut (milestone 49)', async () => {
      await clickResult('Title Card');
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
      const cut = (i: number) => `document.querySelectorAll('#cut-track .cut')[${i}]`;
      const count = () => page.eval<number>(`document.querySelectorAll('#cut-track .cut').length`);
      const ends = () => page.eval<string[]>(`[...document.querySelectorAll('#cut-track .cut .cut-trim.end')].map((h) => h.getAttribute('aria-valuenow'))`);
      const sounds = `(window.pulpLayerSounds ? window.pulpLayerSounds() : []).filter((s) => s.key.startsWith('@track.'))`;
      const clipId = await onResult<string>('clip', '(li) => li.dataset.id');
      const gappyId = await onResult<string>('zz-gappy', '(li) => li.dataset.id');
      const wipeId = await onResult<string>('Diagonal Wipe', '(li) => li.dataset.id');
      const dropOn = (fx: number, id: string) =>
        page.eval<boolean>(
          `(() => {
            const el = document.getElementById('transport-lanes');
            const r = el.getBoundingClientRect();
            const dt = new DataTransfer();
            dt.setData('application/x-pulp-item', ${JSON.stringify(id)});
            const at = { clientX: r.left + r.width * ${fx}, clientY: r.top + r.height / 2, dataTransfer: dt, bubbles: true, cancelable: true };
            el.dispatchEvent(new DragEvent('dragover', at));
            el.dispatchEvent(new DragEvent('drop', at));
            return true;
          })()`,
        );
      const menuOn = async (i: number) => {
        await page.eval(`${cut(i)}.querySelector('.cut-body').dispatchEvent(new MouseEvent('contextmenu', { clientX: 320, clientY: 320, bubbles: true, cancelable: true }))`);
        await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu')`), 'the cut\'s menu');
      };
      const openSub = async (label: string) => {
        await page.eval(`[...document.querySelectorAll('.context-menu > button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
        await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu.submenu')`), `the ${label} submenu`);
      };
      const chooseArg = (command: string, arg: string) =>
        page.eval(`document.querySelector('.context-menu.submenu button[data-command="${command}"][data-arg="${arg}"]').click()`);
      try {
        await dropOn(0.5, clipId!);
        await until(async () => (await count()) === 1, 'the silent shot');
        await dropOn(0.9, gappyId!);
        await until(async () => (await count()) === 2, 'the shot that goes quiet');

        // A dissolve from the cut's own menu, marked on the join — and the way out to an editing
        // app sits beside the edits (milestone 49's hand-off; the save dialog keeps it out of reach here).
        await menuOn(0);
        expect(await page.eval<string[]>(`[...document.querySelectorAll('.context-menu > button')].map((b) => b.textContent)`)).toContain('Export Edit…');
        await openSub('Transition');
        await chooseArg('cut.transition', 'dissolve');
        await until(() => page.eval<boolean>(`(() => { const j = ${cut(0)}.querySelector('.cut-join'); return !!j && !j.hidden; })()`), 'the join marked');
        expect(await page.eval<string>(`${cut(0)}.querySelector('.cut-join').title`)).toBe('Dissolve over 0.5 s');

        // Any bundled wipe, dropped from the results onto the join it should play over.
        await dropOn(0.5, wipeId!);
        await until(() => page.eval<string>(`${cut(0)}.querySelector('.cut-join')?.title || ''`).then((t) => t === 'Wipe over 0.5 s'), 'the wipe on the join');

        // The cut's sound unlinked: muted it leaves the mix, linked again it returns.
        await until(() => page.eval<number>(`${sounds}.length`).then((n) => n === 1), 'the quiet shot\'s sound in the mix', 30_000);
        await menuOn(1);
        await openSub('Sound');
        await chooseArg('cut.sound', 'muted');
        await until(() => page.eval<number>(`${sounds}.length`).then((n) => n === 0), 'muted out of the mix');
        await menuOn(1);
        await openSub('Sound');
        await chooseArg('cut.sound', 'linked');
        await until(() => page.eval<number>(`${sounds}.length`).then((n) => n === 1), 'and linked back in');

        // Speed (milestone 56): a rate from the cut's menu halves the cut's run on the lane and is
        // said on it; its sound keeps its place in the mix at that rate; a ramp says both ends.
        // The cut's run on the timeline, read off its handles: the project's length follows the
        // track, so the lane's own percentages move with every edit and say nothing on their own.
        const runOf = async (i: number) => {
          const [start, end] = await page.eval<number[]>(`[${cut(i)}.querySelector('.cut-trim.start'), ${cut(i)}.querySelector('.cut-trim.end')].map((h) => Number(h.getAttribute('aria-valuenow')))`);
          return end! - start!;
        };
        const badge = (i: number) => page.eval<string>(`${cut(i)}.querySelector('.cut-speed')?.hidden ? '' : ${cut(i)}.querySelector('.cut-speed').textContent`);
        const plainRun = await runOf(1);
        await menuOn(1);
        await openSub('Speed');
        await chooseArg('cut.speed', '2');
        await until(() => badge(1).then((t) => t === '2×'), 'the rate said on the cut');
        expect(await runOf(1), 'half the run at twice the speed').toBeCloseTo(plainRun / 2, 1);
        expect(await page.eval<number>(`${sounds}.find((s) => s.key === '@track.1')?.speed ?? ${sounds}[0]?.speed ?? 0`), 'the sound at the rate').toBe(2);
        await menuOn(1);
        await openSub('Speed');
        await chooseArg('cut.ramp', '0.5');
        await until(() => badge(1).then((t) => t === '2×→½×'), 'the ramp said on the cut');
        await menuOn(1);
        await openSub('Speed');
        await chooseArg('cut.speed', '1');
        await menuOn(1);
        await openSub('Speed');
        await chooseArg('cut.ramp', 'none');
        await until(() => badge(1).then((t) => t === ''), 'real time again, and nothing said');
        // A freeze frame at the playhead, which sits inside the second cut: the shot is split there
        // and the held frame goes between the pieces, so two cuts become four, hatched where it holds.
        await page.eval(`(() => { const s = document.getElementById('scrub'); s.value = String(Math.round(Number(s.max) * 0.6)); s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await menuOn(1);
        await openSub('Freeze Frame');
        await chooseArg('cut.freeze', '1');
        await until(async () => (await count()) === 4, 'the frozen frame as a cut of its own, between the two halves of the shot');
        expect(await page.eval<boolean>(`${cut(2)}.classList.contains('hold')`)).toBe(true);
        expect(await badge(2)).toBe('Hold 1 s');
        // The hold takes its second on the timeline: the shot's end moves out by one.
        const held = await ends();
        expect(Number(held[3]) - Number(held[1])).toBeCloseTo(1 + (Number(held[3]) - Number(held[2])), 1);
        // One undo step for the split and the hold together.
        await page.eval(`document.getElementById('undo').click()`);
        await until(async () => (await count()) === 2, 'undo takes the hold out');

        // Silence removal: the quiet stretch found and shaded on the track before anything is cut,
        // then cut in one undo step.
        await menuOn(1);
        await page.eval(`[...document.querySelectorAll('.context-menu button')].find((b) => b.textContent === 'Remove Silences…').click()`);
        await until(() => page.eval<boolean>(`document.getElementById('silence-dialog').open`), 'the silence dialog');
        await page.eval(`document.getElementById('silence-find').click()`);
        await until(() => page.eval<number>(`document.querySelectorAll('#cut-track .cut-silence').length`).then((n) => n === 1), 'the quiet stretch shaded', 30_000);
        expect(await page.eval<string>(`document.getElementById('silence-found').textContent`)).toContain('1 quiet stretch');
        expect(await count(), 'nothing cut yet: it is shown first').toBe(2);
        await page.eval(`document.getElementById('silence-cut').click()`);
        // Within a few hundredths of the gap: the codec pads the exact moment the tone stops.
        await until(async () => {
          const end = parseFloat((await ends())[1] ?? '0');
          return end > 2.7 && end < 2.95;
        }, 'the quiet tail cut away');
        expect(await page.eval<number>(`document.querySelectorAll('#cut-track .cut-silence').length`), 'the shading went with the dialog').toBe(0);
        // One undo step for the whole of it.
        await page.eval(`document.getElementById('undo').click()`);
        await until(async () => (await ends())[1] === '4', 'undo brings the quiet tail back');
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('previews a ten-minute shot by the tile the playhead is on, holding frames within the budget (milestone 58)', async () => {
      // A ten-minute clip written into a folder of the library and scanned in: longer by far than
      // the 900 frames a whole window may hold, which used to mean the pad. The preview now decodes
      // ten-second tiles around the playhead, so the shot shows at its start, its middle and its end,
      // and the frames held stay under the budget wherever the playhead is.
      const folder = join(mediaDir, 'long');
      await mkdir(folder, { recursive: true });
      const { runBounded: run, ffmpegArgs: ff } = await import('./process');
      const ffmpegPath = (await page.eval<{ path?: string }>(`window.pulp.ffmpegStatus()`)).path!;
      const made = await run(ffmpegPath, ff(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=600', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-movflags', '+faststart', join(folder, 'long-shot.mp4')]), { timeoutMs: 300_000 });
      expect(made.code, made.stderr).toBe(0);
      await page.eval(`document.getElementById('rescan').click()`);
      await until(() => page.eval<boolean>(`window.pulp.getLibrary().then((i) => i.media.some((m) => m.name === 'long-shot'))`), 'the long shot scanned into the library', 60_000);
      await clickResult('Title Card');
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
      const picture = () => page.eval<{ cuts: (number | null)[]; held: number; budget: number }>(`window.pulpTrackPicture()`);
      const pixel = (fx: number) => page.eval<number[]>(
        `(() => { const c = document.getElementById('track-picture'); const d = c.getContext('2d').getImageData(Math.floor(c.width * ${fx}), Math.floor(c.height / 2), 1, 1).data; return [d[0], d[1], d[2]]; })()`,
      );
      const scrub = (fraction: number) => page.eval(`(() => { const s = document.getElementById('scrub'); s.value = String(Math.round(Number(s.max) * ${fraction})); s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const lit = async (fx: number) => { const [r, g, b] = await pixel(fx); return r! + g! + b! > 120; };
      try {
        const longId = await onResult<string>('long-shot', '(li) => li.dataset.id');
        await page.eval(`(() => {
          const el = document.getElementById('transport-lanes');
          const r = el.getBoundingClientRect();
          const dt = new DataTransfer();
          dt.setData('application/x-pulp-item', ${JSON.stringify(longId)});
          const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, dataTransfer: dt, bubbles: true, cancelable: true };
          el.dispatchEvent(new DragEvent('dragover', at));
          el.dispatchEvent(new DragEvent('drop', at));
        })()`);
        await until(() => page.eval<number>(`document.querySelectorAll('#cut-track .cut').length`).then((n) => n === 1), 'the ten-minute shot on the track');
        // The project's length followed the track: ten minutes.
        await until(() => page.eval<string>(`document.getElementById('scrub').max`).then((m) => Number(m) > 17_000), 'a ten-minute scrub bar');
        for (const [fraction, where] of [[0.01, 'the start'], [0.5, 'the middle'], [0.98, 'the end']] as const) {
          await scrub(fraction);
          await until(() => lit(0.5), `the shot's picture at ${where}`, 60_000);
          const held = await picture();
          expect(held.held, `frames held at ${where}`).toBeLessThanOrEqual(held.budget);
          expect(held.cuts[0], 'the cut readable, not the pad').not.toBeNull();
        }
      } finally {
        await page.eval(`(() => { const u = document.getElementById('undo'); u.click(); })()`);
        await rm(folder, { recursive: true, force: true });
        await page.eval(`document.getElementById('rescan').click()`);
        await restoreLayers();
      }
    }, 600_000);

    it('puts a clip over the shots from the picture track\'s lane: a drop at a moment makes a video layer there, cropped and bordered from its card (milestone 57)', async () => {
      await clickResult('Title Card');
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
      const before = await layerIds();
      const lane = `document.getElementById('overlay-track')`;
      const cuts = () => page.eval<number>(`document.querySelectorAll('#cut-track .cut').length`);
      const pips = () => page.eval<number>(`document.querySelectorAll('#overlay-track .pip').length`);
      const clipId = await onResult<string>('clip', '(li) => li.dataset.id');
      const tallId = await onResult<string>('tall', '(li) => li.dataset.id');
      const dropOn = (target: string, fx: number, id: string) =>
        page.eval<boolean>(
          `(() => {
            const el = ${target};
            const r = el.getBoundingClientRect();
            const dt = new DataTransfer();
            dt.setData('application/x-pulp-item', ${JSON.stringify(id)});
            const at = { clientX: r.left + r.width * ${fx}, clientY: r.top + r.height / 2, dataTransfer: dt, bubbles: true, cancelable: true };
            el.dispatchEvent(new DragEvent('dragover', at));
            el.dispatchEvent(new DragEvent('drop', at));
            return true;
          })()`,
        );
      try {
        // No shots yet: no lane to drop over them on.
        expect(await page.eval<boolean>(`${lane}.hidden`)).toBe(true);
        await dropOn(`document.getElementById('transport-lanes')`, 0.5, clipId!);
        await until(async () => (await cuts()) === 1, 'the shot on the cut track');
        await until(() => page.eval<boolean>(`!${lane}.hidden`), 'the picture track\'s lane, now there is a shot to sit over');
        expect(await page.eval<boolean>(`${lane}.classList.contains('empty')`)).toBe(true);

        // A clip dropped on the lane is a video layer starting there — not another shot.
        await dropOn(lane, 0.4, tallId!);
        await until(async () => (await pips()) === 1, 'the clip over the shots');
        expect(await cuts(), 'the cut track is untouched').toBe(1);
        const ids = await layerIds();
        expect(ids.length).toBe(before.length + 1);
        const added = ids.find((id) => !before.includes(id))!;
        // It starts at the moment it was dropped — 0.4 of the piece, whose length followed the
        // track when the shot landed — runs for the clip's own two seconds, and is the selected
        // layer, lit on the lane.
        const length = await page.eval<number>(`Number(document.getElementById('scrub').max) / 30`);
        const left = await page.eval<number>(`parseFloat(document.querySelector('#overlay-track .pip').style.left)`);
        expect(left).toBeCloseTo(40, 0);
        expect(await page.eval<boolean>(`document.querySelector('#overlay-track .pip').classList.contains('selected')`)).toBe(true);
        expect(await page.eval<string>(`document.querySelector('#overlay-track .pip').dataset.layer`)).toBe(added);
        const layer = await page.eval<{ span: { start: number; end: number }; size: number; clip: { delay: number; ending: string } }>(
          `(() => { const l = window.pulpLayerEditor ? window.pulpLayerEditor().get('card', ${JSON.stringify(added)}) : null; return l && { span: l.span, size: l.size, clip: { delay: l.clip.delay, ending: l.clip.ending } }; })()`,
        );
        expect(layer, 'the layer as the editor holds it').not.toBeNull();
        expect(layer!.span.start).toBeCloseTo(0.4 * length, 1);
        expect(layer!.span.end).toBeCloseTo(Math.min(length, 0.4 * length + 2), 1);
        expect(layer!.clip.delay).toBeCloseTo(0.4 * length, 1);
        expect(layer!.clip.ending).toBe('once');

        // Its card carries the crop and the border, which write to the clip and are read back.
        const card = `document.querySelector('#params .param-card[data-layer=${JSON.stringify(added)}]')`;
        await until(() => page.eval<boolean>(`!!${card}`), 'the clip\'s card');
        await page.eval(`(() => { const c = ${card}; const b = c.querySelector('.card-body'); if (b && b.hidden) c.querySelector('.card-toggle').click(); })()`);
        const field = (label: string) => `${card}.querySelector('input[aria-label$=${JSON.stringify(label)}]')`;
        await until(() => page.eval<boolean>(`!!${field('crop left')}`), 'the crop fields');
        await page.eval(`(() => { const f = ${field('crop left')}; f.value = '20'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await page.eval(`(() => { const f = ${field('border width')}; f.value = '1'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<string>(`${field('crop left')}?.value ?? ''`).then((v) => v === '20'), 'the crop kept');
        await until(() => page.eval<string>(`${field('border width')}?.value ?? ''`).then((v) => v === '1'), 'the border kept');
      } finally {
        await restoreLayers();
        await page.eval(`(() => { const u = document.getElementById('undo'); for (let i = 0; i < 6; i++) u.click(); })()`);
      }
    }, 120_000);

    it('keys a layer at the playhead, eases each key its own way, and keyframing writes a key from an edit (milestone 51)', async () => {
      await clickResult('Title Card');
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
      const card = `document.querySelector('#params .param-card[data-layer="title"]')`;
      const animate = `${card}.querySelector('.layer-animate')`;
      const rows = () => page.eval<number>(`${card} ? [...${card}.querySelectorAll('.key-row')].length : -1`);
      try {
        // The card and its Animate disclosure open.
        await until(() => page.eval<boolean>(`!!${card}`), 'the title\'s card');
        await page.eval(`(() => { const c = ${card}; const b = c.querySelector('.card-body'); if (b && b.hidden) c.querySelector('.card-toggle').click(); })()`);
        await page.eval(`(() => { const a = ${animate}; if (a && !a.open) a.querySelector('summary').click(); })()`);
        await until(() => page.eval<boolean>(`${animate} && ${animate}.open`), 'the Animate disclosure');

        // The playhead at the top, drawn there — a key is written where the playhead really is.
        await page.eval(`(() => { const s = document.getElementById('scrub'); s.value = '0'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await until(() => page.eval<string>(`document.getElementById('preview-frame').dataset.frame`).then((f) => Number(f) === 0), 'the playhead at the top');
        await page.eval(`${card}.querySelector('.add-key').click()`);
        await until(async () => (await rows()) === 1, 'the first key');
        expect(await page.eval<string>(`${animate}.querySelector('summary').textContent`)).toBe('Animate · 1 key');

        // Keyframing on: turning the layer writes a key at the playhead rather than a placement.
        await page.eval(`(() => { const t = ${card}.querySelector('.keyframing-toggle'); if (t.getAttribute('aria-pressed') !== 'true') t.click(); })()`);
        await page.eval(`(() => { const s = document.getElementById('scrub'); s.value = String(Math.round(Number(s.max) * 0.8)); s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await until(() => page.eval<string>(`document.getElementById('preview-frame').dataset.frame`).then((f) => Number(f) > 0), 'the playhead along the bar');
        await page.eval(`(() => { const a = ${card}.querySelector('details.layer-advanced'); if (a && !a.open) a.querySelector('summary').click(); })()`);
        await page.eval(`(() => { const f = ${card}.querySelector('input[aria-label="Title angle"]'); f.value = '45'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(async () => (await rows()) === 2, 'the edit written as a second key');

        // Each key travels its own way: Hold on the first, and Curve opens the bezier's own points.
        await page.eval(`(() => { const e = ${card}.querySelectorAll('.key-row select')[0]; e.value = 'hold'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<string>(`${card}.querySelectorAll('.key-row select')[0]?.value || ''`).then((v) => v === 'hold'), 'the hold kept');
        await page.eval(`(() => { const e = ${card}.querySelectorAll('.key-row select')[1]; e.value = 'curve'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<number>(`[...${card}.querySelectorAll('.key-row')[1]?.querySelectorAll('.key-curve') || []].length`).then((n) => n === 4), 'the curve\'s four points');

        // A key comes out again, and the count follows it.
        await page.eval(`${card}.querySelectorAll('.key-row button[aria-label^="Remove"]')[0].click()`);
        await until(async () => (await rows()) === 1, 'one key left');
      } finally {
        await page.eval(`(() => { const t = ${card}?.querySelector('.keyframing-toggle'); if (t && t.getAttribute('aria-pressed') === 'true') t.click(); })()`);
        await restoreLayers();
      }
    }, 120_000);

    it('shows keyframes as marks on the layer\'s bar: dragged in time, copied, pasted and deleted (milestone 51)', async () => {
      await clickResult('Title Card');
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
      const card = `document.querySelector('#params .param-card[data-layer="title"]')`;
      const mark = (i: number) => `document.querySelectorAll('#layer-bars .layer-bar[data-layer=title] .bar-key')[${i}]`;
      const markCount = () => page.eval<number>(`document.querySelectorAll('#layer-bars .layer-bar[data-layer=title] .bar-key').length`);
      const at = (i: number) => page.eval<string>(`${mark(i)}?.getAttribute('aria-valuenow') || ''`);
      const scrub = (frame: number) => page.eval(`(() => { const s = document.getElementById('scrub'); s.value = '${frame}'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      try {
        // A key written in the Animate card appears as a mark on the bar, at its moment.
        await until(() => page.eval<boolean>(`!!${card}`), 'the title\'s card');
        await page.eval(`(() => { const c = ${card}; const b = c.querySelector('.card-body'); if (b && b.hidden) c.querySelector('.card-toggle').click(); })()`);
        await page.eval(`(() => { const a = ${card}.querySelector('.layer-animate'); if (a && !a.open) a.querySelector('summary').click(); })()`);
        await scrub(0);
        await until(() => page.eval<string>(`document.getElementById('preview-frame').dataset.frame`).then((f) => Number(f) === 0), 'the playhead at the top');
        await page.eval(`${card}.querySelector('.add-key').click()`);
        await until(async () => (await markCount()) === 1, 'the key\'s mark on the bar');
        expect(await at(0)).toBe('0');
        expect(await page.eval<string>(`${mark(0)}.style.left`)).toBe('0%');

        // Dragged in time: the bar's scale when the drag began sets how far a pixel goes.
        const width = await page.eval<number>(`document.getElementById('layer-bars').getBoundingClientRect().width`);
        const px = (seconds: number) => Math.round((seconds / 5) * width);
        await page.eval(`${mark(0)}.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 7, clientX: 200, bubbles: true }))`);
        await page.eval(`${mark(0)}.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: ${200 + px(2)}, bubbles: true }))`);
        await page.eval(`${mark(0)}.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: ${200 + px(2)}, bubbles: true }))`);
        // Within a pixel of two seconds: the bar's width need not divide by five.
        await until(async () => Math.abs(parseFloat(await at(0)) - 2) < 0.05, 'the mark dragged to two seconds');
        // The Animate card agrees: the mark and the key row are two views of one key.
        expect(parseFloat(await page.eval<string>(`${card}.querySelector('.key-at').textContent`))).toBeCloseTo(2, 1);

        // Copied, and pasted at the playhead on the same bar.
        await page.eval(`${mark(0)}.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }))`);
        await scrub(120);
        await until(() => page.eval<string>(`document.getElementById('preview-frame').dataset.frame`).then((f) => Number(f) === 120), 'the playhead at four seconds');
        await page.eval(`${mark(0)}.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }))`);
        await until(async () => (await markCount()) === 2, 'the pasted key\'s mark');
        expect(await at(1)).toBe('4');

        // The arrow keys move a mark by a tenth of a second, a second with Shift, one undo step each.
        await page.eval(`${mark(1)}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true }))`);
        await until(async () => (await at(1)) === '3', 'the mark a second earlier');

        // Deleted from its own right-click menu…
        await page.eval(`${mark(1)}.dispatchEvent(new MouseEvent('contextmenu', { clientX: 300, clientY: 300, bubbles: true, cancelable: true }))`);
        await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu button[data-command="key.delete"]')`), 'the mark\'s menu');
        expect(await page.eval<boolean>(`document.querySelector('.context-menu button[data-command="key.paste"]').disabled`), 'paste offered while a key is copied').toBe(false);
        await page.eval(`document.querySelector('.context-menu button[data-command="key.delete"]').click()`);
        await until(async () => (await markCount()) === 1, 'the key gone with its mark');

        // …and with the keyboard; undo brings each one back, a gesture at a time.
        await page.eval(`${mark(0)}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))`);
        await until(async () => (await markCount()) === 0, 'the last key gone');
        await page.eval(`document.getElementById('undo').click()`);
        await until(async () => (await markCount()) === 1, 'the deleted key back');
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('sets a layer\'s type: the family in its own face from the bundled set, and every other property, undoably', async () => {
      const title = `document.querySelector('#params .layer-row[data-layer=title]')`;
      const summary = () => page.eval<string>(`${title}.querySelector('.layer-type summary').textContent`);
      // A face loads only where text is drawn with it, and a closed drawer draws nothing (milestone 38).
      await openTab('parameters');
      try {
      // The type is folded under the words, summed up in one line.
      expect(await page.eval<boolean>(`${title}.querySelector('.layer-type').open`)).toBe(false);
      expect(await summary()).toBe('Georgia · 8.9% · Regular · Uppercase');
      await page.eval(`${title}.querySelector('.layer-type').open = true`);

      // The family list: the bundled ten, each set in itself, then the template's own stacks.
      await page.eval(`${title}.querySelector('.family-current').click()`);
      await until(() => page.eval<boolean>(`!${title}.querySelector('.family-list').hidden`), 'the family list');
      const options = await page.eval<{ label: string; family: string; face: string }[]>(
        `[...${title}.querySelectorAll('.family-list [role=option]')].map((l) => ({ label: l.textContent, family: l.dataset.family, face: l.style.fontFamily }))`,
      );
      expect(options.slice(0, 10).map((o) => o.label)).toEqual(['Inter', 'Montserrat', 'Oswald', 'Bebas Neue', 'Source Serif 4', 'Playfair', 'JetBrains Mono', 'Caveat', 'Dancing Script', 'Noto Sans']);
      // Each set in itself, every name quoted ("Source Serif 4" is not valid unquoted).
      for (const o of options) expect(o.face.replace(/"/g, ''), o.label).toBe(o.family.replace(/"/g, ''));
      expect(options.find((o) => o.label === 'Source Serif 4')?.face).toBe('"Source Serif 4"');
      expect(options.map((o) => o.label)).toContain('Georgia');
      // The app window has the bundled faces, so the list is set in them.
      await until(() => page.eval<boolean>(`document.fonts.check('16px Oswald') && [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Oswald' && f.status === 'loaded')`), 'Oswald loaded in the app window', 30_000);

      // Picking Oswald: the control shows it in itself, the template page loads it, and the title is drawn in it.
      await scrubAndWait(110);
      const inkWidth = () => inTemplate<number>(
        `(() => { const c = document.getElementById('c'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let min = c.width, max = 0;
          for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) { const i = (y * c.width + x) * 4; if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { if (x < min) min = x; if (x > max) max = x; } }
          return max - min; })()`,
        CARD,
      );
      const georgiaWidth = await inkWidth();
      await page.eval(`[...${title}.querySelectorAll('.family-list [role=option]')].find((l) => l.dataset.family === 'Oswald').click()`);
      await until(async () => (await summary()).startsWith('Oswald'), 'the summary to name Oswald');
      expect(await page.eval<string>(`${title}.querySelector('.family-current').style.fontFamily`)).toBe('Oswald');
      await until(() => inTemplate<boolean>(`document.fonts.check('400 16px Oswald') && [...document.fonts].some((f) => f.family === 'Oswald' && f.status === 'loaded')`, CARD), 'Oswald loaded in the template page', 30_000);
      await scrubAndWait(110);
      // Oswald is a condensed face: the same words come out much narrower than they did in Georgia.
      await until(async () => (await inkWidth()) < 0.8 * georgiaWidth, 'the title drawn in Oswald, narrower than in Georgia');

      // The rest: weight, italic, case, size, spacing, color, alignment, overflow — each one undo step.
      await fire('[data-layer=title] select[aria-label="Title weight"]', '700', 'change');
      await page.eval(`${title}.querySelector('input[aria-label="Title italic"]').click()`);
      await fire('[data-layer=title] select[aria-label="Title case"]', 'none', 'change');
      await until(async () => (await summary()) === 'Oswald · 8.9% · Bold · Italic', 'the summary to follow');
      await fire('[data-layer=title] input[aria-label="Title size"]', '5', 'change');
      await fire('[data-layer=title] input[aria-label="Title letter spacing"]', '0.3', 'change');
      await page.eval(`(() => { const f = ${title}.querySelector('.type-field .color-field .hex'); f.value = '#ff0000'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`${title}.querySelector('.segmented [data-align=left]').click()`);
      await fire('[data-layer=title] select[aria-label="Title overflow"]', 'shrink', 'change');
      await until(() => page.eval<boolean>(`${title}.querySelector('input[aria-label="Title lines at most"]').closest('.type-field').hidden`), 'the line limit to go with shrink');
      await scrubAndWait(110);
      // Red, left-aligned, smaller: the first band is red ink near the left edge of the block.
      const red = await inTemplate<{ left: number; found: boolean }>(
        `(() => { const c = document.getElementById('c'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let left = c.width, found = false;
          for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) { const i = (y * c.width + x) * 4; if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) { found = true; if (x < left) left = x; } }
          return { left, found }; })()`,
        CARD,
      );
      expect(red.found).toBe(true);
      expect(red.left).toBeLessThan(0.07 * 1920 + 60); // the block starts at 7% of the width

      // Nine edits, nine steps back to Georgia; Reset layers then leaves nothing to undo about the type.
      for (let i = 0; i < 9; i++) await page.eval(`document.getElementById('undo').click()`);
      await until(async () => (await summary()) === 'Georgia · 8.9% · Regular · Uppercase', 'the type back to the template\'s');
      expect(await page.eval<boolean>(`${section}.querySelector('.layers-reset').hidden`)).toBe(true);
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('offers an imported font with its license note, declares its face, and ends the list with Import font…', async () => {
      const title = `document.querySelector('#params .layer-row[data-layer=title]')`;
      await openTab('parameters');
      try {
        // The managed folder was seeded with one font; the app window declares its face from the index.
        expect(await page.eval<string>(`document.querySelector('style[data-pulp-imported-fonts]').textContent`)).toContain('"Pulp Test Face"');
        await page.eval(`${title}.querySelector('.layer-type').open = true`);
        await page.eval(`${title}.querySelector('.family-current').click()`);
        await until(() => page.eval<boolean>(`!${title}.querySelector('.family-list').hidden`), 'the family list');
        // The imported family sits under its own divider, set in itself, the license note with it.
        const rows = await page.eval<{ kind?: string; label: string; tip?: string; divider: boolean }[]>(
          `[...${title}.querySelectorAll('.family-list > li')].map((l) => ({ kind: l.dataset.kind, label: l.textContent, tip: l.dataset.tip, divider: l.classList.contains('family-divider') }))`,
        );
        const dividerAt = rows.findIndex((r) => r.divider && r.label === 'Imported');
        expect(dividerAt).toBeGreaterThan(0);
        expect(rows[dividerAt + 1]).toMatchObject({ kind: 'imported', label: 'Pulp Test Face', tip: 'Imported · Bought from the foundry, desktop license' });
        // The last row imports a font of your own; the dialog itself cannot be driven here.
        expect(await page.eval<string>(`${title}.querySelector('.family-list > li:last-child .font-import-start').textContent`)).toBe('Import font…');

        // Picking it: the control shows it, and the face really loads — in the app window and the template page.
        await page.eval(`[...${title}.querySelectorAll('.family-list [role=option]')].find((l) => l.dataset.family === 'Pulp Test Face').click()`);
        await until(() => page.eval<string>(`${title}.querySelector('.family-current').style.fontFamily`).then((f) => f === '"Pulp Test Face"'), 'the control set in the imported face');
        await until(() => page.eval<boolean>(`document.fonts.check('16px "Pulp Test Face"')`), 'the imported face loaded in the app window', 30_000);
        await until(() => inTemplate<boolean>(`document.fonts.check('400 16px "Pulp Test Face"')`, CARD), 'the imported face loaded in the template page', 30_000);
        await page.eval(`document.getElementById('undo').click()`);
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('gives one layer a start and an end of its own, on the clock the graphic is watched at (milestone 28)', async () => {
      const subtitle = `document.querySelector('#params .layer-row[data-layer=subtitle]')`;
      const summary = () => page.eval<string>(`${subtitle}.querySelector('.layer-advanced summary').textContent`);
      try {
        // The card is 5 s at 30 fps, and both its lines are well in by 1.5 s (frame 45).
        await scrubAndWait(45);
        const both = await untilDrawn((d) => d.bands.length === 2, 'the title and the subtitle together');
        expect(both.bands, JSON.stringify(both)).toHaveLength(2);

        await page.eval(`${subtitle}.querySelector('.layer-advanced').open = true`);
        // With no span of its own the layer is on screen for the whole graphic, so End starts at
        // the graphic's own length and the folded line says nothing about timing.
        expect(await page.eval<string>(`${subtitle}.querySelector('input[aria-label="Subtitle start"]').value`)).toBe('0');
        expect(await page.eval<string>(`${subtitle}.querySelector('input[aria-label="Subtitle end"]').value`)).toBe('5');
        expect(await summary()).toBe('Advanced');

        await fire('[data-layer=subtitle] input[aria-label="Subtitle start"]', '2', 'change');
        await fire('[data-layer=subtitle] input[aria-label="Subtitle end"]', '3', 'change');
        await until(() => summary().then((t) => t === 'Advanced · 2-3 s'), 'the summary to say when the layer is on screen');

        // The same frame as before, and the line is not there yet.
        await scrubAndWait(45);
        const waiting = await untilDrawn((d) => d.bands.length === 1, 'the title alone before the subtitle starts');
        expect(waiting.bands, JSON.stringify(waiting)).toHaveLength(1);
        // Two seconds in it has arrived, and by three it has gone — the layout never moved, so
        // the title stays exactly where it was all along.
        await scrubAndWait(75);
        const on = await untilDrawn((d) => d.bands.length === 2, 'the subtitle inside its own span');
        expect(on.bands[0]!.top, 'the title did not move when the line below it came and went').toBe(both.bands[0]!.top);
        await scrubAndWait(95);
        const gone = await untilDrawn((d) => d.bands.length === 1, 'the subtitle gone at its own end');
        expect(gone.bands, JSON.stringify(gone)).toHaveLength(1);

        // An end at or past the graphic's own end is no end at all: the layer runs as long as the
        // graphic does, and the summary says so by naming the length.
        await fire('[data-layer=subtitle] input[aria-label="Subtitle end"]', '5', 'change');
        await until(() => summary().then((t) => t === 'Advanced · 2-5 s'), 'the summary back to the end of the graphic');
        await scrubAndWait(95);
        const back = await untilDrawn((d) => d.bands.length === 2, 'the subtitle to the end of the graphic');
        expect(back.bands, JSON.stringify(back)).toHaveLength(2);

        // Each change was one undo step, and the whole graphic comes back.
        await page.eval(`document.getElementById('undo').click()`);
        await page.eval(`document.getElementById('undo').click()`);
        await page.eval(`document.getElementById('undo').click()`);
        await until(() => summary().then((t) => t === 'Advanced'), 'undo back to the whole graphic');
        await scrubAndWait(45);
        const whole = await untilDrawn((d) => d.bands.length === 2, 'both lines again');
        expect(whole.bands, JSON.stringify(whole)).toHaveLength(2);
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('shows a bar per layer under the scrub bar, whose ends set when the layer is on screen (milestone 28)', async () => {
      const bars = `document.querySelectorAll('#layer-bars .layer-bar')`;
      const bar = `document.querySelector('#layer-bars .layer-bar[data-layer=subtitle]')`;
      const subtitle = `document.querySelector('#params .layer-row[data-layer=subtitle]')`;
      try {
        // One bar per layer of the card, the whole width while nothing has been timed.
        await until(() => page.eval<number>(`${bars}.length`).then((n) => n === 2), 'a bar for each of the card\'s two lines');
        expect(await page.eval<string[]>(`[...${bars}].map((b) => b.querySelector('.bar-label').textContent)`)).toEqual(['Title', 'Subtitle']);
        expect(await page.eval<string>(`${bar}.querySelector('.bar-body').style.width`)).toBe('100%');
        // Its ends are sliders over the graphic's five seconds.
        expect(await page.eval<string>(`${bar}.querySelector('.bar-end.end').getAttribute('aria-valuenow')`)).toBe('5');

        // Clicking a bar selects its layer, as clicking it on the stage does.
        await page.eval(`${bar}.querySelector('.bar-body').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }))`);
        await until(() => page.eval<boolean>(`${bar}.classList.contains('selected')`), 'the bar lit as selected');

        // The arrow keys move an end by a tenth of a second, a second with Shift, one undo step each.
        const endHandle = `${bar}.querySelector('.bar-end.end')`;
        await page.eval(`${endHandle}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true }))`);
        await until(() => page.eval<string>(`${endHandle}.getAttribute('aria-valuenow')`).then((v) => v === '4'), 'the end a second earlier');
        expect(await page.eval<string>(`${bar}.querySelector('.bar-body').style.width`)).toBe('80%');
        // And the layer's own card agrees: the bar and the fields are two views of one span.
        await page.eval(`${subtitle}.querySelector('.layer-advanced').open = true`);
        expect(await page.eval<string>(`${subtitle}.querySelector('input[aria-label="Subtitle end"]').value`)).toBe('4');

        // A drag on the start: the bar's scale when the drag began sets how far a pixel goes.
        const startHandle = `${bar}.querySelector('.bar-end.start')`;
        const width = await page.eval<number>(`document.getElementById('layer-bars').getBoundingClientRect().width`);
        const px = (seconds: number) => Math.round((seconds / 5) * width);
        await page.eval(`${startHandle}.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 7, clientX: 100, bubbles: true }))`);
        await page.eval(`${startHandle}.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: ${100 + px(1)}, bubbles: true }))`);
        await page.eval(`${startHandle}.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: ${100 + px(1)}, bubbles: true }))`);
        await until(() => page.eval<string>(`${startHandle}.getAttribute('aria-valuenow')`).then((v) => v === '1'), 'the start a second in');
        // A whole pixel's worth of a second: the bar's width need not divide by five, so the drag lands
        // within a pixel of the second rather than on it, and a pixel of a bar this wide is a quarter of
        // a percent (it was exact while the picture, and so the bar, happened to be a width it divided).
        expect(parseFloat(await page.eval<string>(`${bar}.querySelector('.bar-body').style.left`))).toBeCloseTo(20, 0);
        expect(parseFloat(await page.eval<string>(`${bar}.querySelector('.bar-body').style.width`))).toBeCloseTo(60, 0);

        // An entrance shades the start of the bar for the time it takes.
        await fire('[data-layer=subtitle] select[aria-label="Subtitle entrance"]', 'fade', 'change');
        await fire('[data-layer=subtitle] input[aria-label="Subtitle entrance seconds"]', '1.5', 'change');
        // Half of a window whose start the drag put within a pixel of the second: within half a percent of half.
        await until(() => page.eval<string>(`${bar}.querySelector('.bar-in').style.width`).then((w) => Math.abs(parseFloat(w) - 50) < 0.5), 'the entrance shaded over half the bar');

        // Undo takes it all back, a step at a time, and the bar follows.
        for (let i = 0; i < 4; i++) await page.eval(`document.getElementById('undo').click()`);
        await until(() => page.eval<string>(`${bar}.querySelector('.bar-body').style.width`).then((w) => w === '100%'), 'the bar back to the whole graphic');
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('gives a layer a look of its own, and says which parts of it are in play (milestone 28)', async () => {
      const subtitle = `document.querySelector('#params .layer-row[data-layer=subtitle]')`;
      const summary = () => page.eval<string>(`${subtitle}.querySelector('.layer-look summary').textContent`);
      try {
        await page.eval(`${subtitle}.querySelector('.layer-look').open = true`);
        expect(await summary()).toBe('Look');
        // The controls are built the first time the disclosure opens.
        await until(() => page.eval<boolean>(`!!${subtitle}.querySelector('input[aria-label="Subtitle opacity, %"]')`), 'the look controls');
        // A text layer has no corners or soft edges to set; a picture does.
        expect(await page.eval<boolean>(`!!${subtitle}.querySelector('input[aria-label="Subtitle corners, %"]')`)).toBe(false);
        await fire('[data-layer=subtitle] input[aria-label="Subtitle opacity, %"]', '40', 'change');
        await until(() => summary().then((t) => t === 'Look · 40%'), 'the summary to name the opacity');
        await fire('[data-layer=subtitle] input[aria-label="Subtitle shadow distance, %"]', '1', 'change');
        await fire('[data-layer=subtitle] select[aria-label="Subtitle blend"]', 'multiply', 'change');
        await until(() => summary().then((t) => t === 'Look · 40%, shadow, Multiply'), 'the summary to name the shadow and the blend');
        // Back to full opacity, no shadow and Normal is no look at all.
        await fire('[data-layer=subtitle] input[aria-label="Subtitle opacity, %"]', '100', 'change');
        await fire('[data-layer=subtitle] input[aria-label="Subtitle shadow distance, %"]', '0', 'change');
        await fire('[data-layer=subtitle] select[aria-label="Subtitle blend"]', 'normal', 'change');
        await until(() => summary().then((t) => t === 'Look'), 'the summary back to nothing');
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('gives one layer an entrance and an exit of its own, which still go when the graphic goes', async () => {
      const subtitle = `document.querySelector('#params .layer-row[data-layer=subtitle]')`;
      const summary = () => page.eval<string>(`${subtitle}.querySelector('.layer-advanced summary').textContent`);
      const shown = (selector: string) => page.eval<boolean>(`!${subtitle}.querySelector(${JSON.stringify(selector)}).closest('.type-field').hidden`);
      try {
        // The card is 5 s at 30 fps. The template staggers its lines: at 0.9 s (frame 27) the title
        // is well in and the subtitle, which starts at 0.7 s over a second, is not yet drawn at all.
        await scrubAndWait(27);
        const staggered = await untilDrawn((d) => d.bands.length === 1, 'the title alone while the subtitle is still coming in');
        expect(staggered.bands, JSON.stringify(staggered)).toHaveLength(1);

        // Advanced: the layer's own two ends. "None" means it arrives with no movement at all.
        await page.eval(`${subtitle}.querySelector('.layer-advanced').open = true`);
        expect(await summary()).toBe('Advanced');
        // Seconds mean nothing while the template owns the end, and an edge means nothing to a fade.
        expect(await shown('[aria-label="Subtitle entrance seconds"]')).toBe(false);
        expect(await shown('[aria-label="Subtitle entrance direction"]')).toBe(false);
        await fire('[data-layer=subtitle] select[aria-label="Subtitle entrance"]', 'none', 'change');
        await until(() => summary().then((t) => t === 'Advanced · in None'), 'the summary to name the entrance');
        expect(await shown('[aria-label="Subtitle entrance seconds"]')).toBe(true);
        expect(await shown('[aria-label="Subtitle entrance direction"]')).toBe(false);

        // Same frame: the subtitle is there now, because its own entrance says it simply is.
        await scrubAndWait(27);
        const overridden = await untilDrawn((d) => d.bands.length === 2, 'the subtitle drawn from its own entrance');
        expect(overridden.bands, JSON.stringify(overridden)).toHaveLength(2);

        // The ends. At the first frame the graphic has not arrived, so neither has the layer...
        await scrubAndWait(0);
        expect(await bands(), 'nothing is drawn before the card arrives').toHaveLength(0);
        // ...and at the last the card has cleared, so the layer has gone with it. An end of one's
        // own is never a way to outlive the design (docs/template-format.md).
        await scrubAndWait(149);
        const ended = await untilDrawn((d) => d.bands.length === 0, 'the layer gone with the graphic');
        expect(ended.bands, JSON.stringify(ended)).toHaveLength(0);

        // A slide takes an edge to travel from, and says how long it takes.
        await fire('[data-layer=subtitle] select[aria-label="Subtitle entrance"]', 'slide', 'change');
        await until(() => summary().then((t) => t === 'Advanced · in Slide'), 'the summary to name the slide');
        expect(await shown('[aria-label="Subtitle entrance direction"]')).toBe(true);

        // An exit of its own: a one-second fade into an end of its own at three seconds, so it is
        // over while the template is still showing the card in full.
        await fire('[data-layer=subtitle] select[aria-label="Subtitle entrance"]', 'template', 'change');
        await fire('[data-layer=subtitle] select[aria-label="Subtitle exit"]', 'fade', 'change');
        await fire('[data-layer=subtitle] input[aria-label="Subtitle exit seconds"]', '1', 'change');
        await fire('[data-layer=subtitle] input[aria-label="Subtitle end"]', '3', 'change');
        await until(() => summary().then((t) => t === 'Advanced · out Fade · 0-3 s'), 'the summary to name the exit and the end');
        // Two seconds in, where the fade begins, both lines are as bright as each other...
        await scrubAndWait(60);
        const full = await untilDrawn((d) => d.bands.length === 2 && d.bands[1]!.alpha > 200, 'both lines in full at the start of the fade');
        expect(full.bands[1]!.alpha, JSON.stringify(full)).toBeGreaterThan(200);
        // ...half way through it the subtitle is dimmer than the title, which the template has not
        // touched; and by its end it has gone while the title is still there.
        await scrubAndWait(75);
        const leaving = await untilDrawn((d) => d.bands.length === 2 && d.bands[1]!.alpha < d.bands[0]!.alpha - 40, 'the subtitle fading out under the title');
        expect(leaving.bands[1]!.alpha, JSON.stringify(leaving)).toBeLessThan(leaving.bands[0]!.alpha);
        await scrubAndWait(95);
        const gone = await untilDrawn((d) => d.bands.length === 1, 'the subtitle gone at its own end, the title still there');
        expect(gone.bands, JSON.stringify(gone)).toHaveLength(1);

        // Each change was one undo step, and the template's own movement comes back.
        for (let i = 0; i < 6; i++) await page.eval(`document.getElementById('undo').click()`);
        await until(() => summary().then((t) => t === 'Advanced'), 'undo back to the template\'s own movement');
        await scrubAndWait(27);
        const back = await untilDrawn((d) => d.bands.length === 1, 'the stagger back as the template has it');
        expect(back.bands, JSON.stringify(back)).toHaveLength(1);
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('makes a dropped picture a layer where it was dropped, and a drop on a layer card replaces what it shows (milestone 26)', async () => {
      try {
        // The id of the fixture still, read from its result row rather than computed.
        const tinyId = await onResult<string>('tiny', '(li) => li.dataset.id');
        expect(tinyId, 'the fixture still is in the library').toMatch(/^[0-9a-f]{24}$/);
        await clickResult('Title Card');
        await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
        // A frame drawn first: the drop is placed from what the page reports it laid.
        await scrubAndWait(110);
        const before = await layerIds();

        /** A drag over and a drop at a fraction across an element, as a real drag sends them. */
        const dropAt = (target: string, fx: number, fy: number, id: string) =>
          page.eval<boolean>(
            `(() => {
              const el = ${target};
              const r = el.getBoundingClientRect();
              const dt = new DataTransfer();
              dt.setData('application/x-pulp-item', ${JSON.stringify(id)});
              const at = { clientX: r.left + r.width * ${fx}, clientY: r.top + r.height * ${fy}, dataTransfer: dt, bubbles: true, cancelable: true };
              el.dispatchEvent(new DragEvent('dragover', at));
              el.dispatchEvent(new DragEvent('drop', at));
              return true;
            })()`,
          );

        // Dropped a quarter across and a third down the preview.
        await dropAt(`document.getElementById('preview-frame')`, 0.25, 0.33, tinyId!);
        await until(async () => (await layerIds()).length === before.length + 1, 'a layer added by the drop');
        const added = (await layerIds()).find((id) => !before.includes(id))!;
        const card = `document.querySelector('#params .param-card[data-layer="${added}"]')`;
        // It is an image layer named for what was dropped, already showing that picture.
        expect(await page.eval<string>(`${card}.querySelector('.layer-label').textContent`)).toBe('tiny');
        expect(await page.eval<string>(`${card}.querySelector('.image-name').textContent`)).toBe('tiny');

        // And it was put where the pointer was: the page reports it drawn left of center and above it,
        // which the stack alone (centered, below the two lines) would never do.
        type Laid = { blocks: Record<string, { layers: { id: string; box: { x: number; y: number; width: number; height: number }; draw: { dx: number; dy: number; scale: number } }[] }> };
        const placedCentre = async () => {
          const laid = await inTemplate<Laid>(`window.__pulp.laid`, CARD);
          const layer = laid.blocks.card?.layers.find((l) => l.id === added);
          if (!layer) return null;
          return { x: layer.box.x + layer.draw.dx + layer.box.width / 2, y: layer.box.y + layer.draw.dy + layer.box.height / 2 };
        };
        const frame = await page.eval<{ width: number; height: number }>(
          `(() => { const [w, h] = (document.getElementById('preview-frame').style.aspectRatio || '1920 / 1080').split('/').map(Number); return { width: w, height: h }; })()`,
        );
        await until(async () => {
          const centre = await placedCentre().catch(() => null);
          return centre !== null && Math.abs(centre.x - frame.width * 0.25) < frame.width * 0.06;
        }, 'the dropped layer sitting where it was dropped');
        const centre = (await placedCentre())!;
        expect(centre.y, 'and at the height it was dropped at').toBeCloseTo(frame.height * 0.33, -2);

        // Dropping another still on that layer's card replaces its picture rather than adding a layer.
        const markId = await onResult<string>('mark', '(li) => li.dataset.id');
        await clickResult('Title Card');
        await until(() => page.eval<boolean>(`!!${section}`), 'back on the card');
        await dropAt(card, 0.5, 0.5, markId!);
        await until(() => page.eval<string>(`${card}.querySelector('.image-name').textContent`).then((t) => t === 'mark'), 'the card showing the dropped still');
        expect(await layerIds(), 'no second layer from a drop on a card').toHaveLength(before.length + 1);
      } finally {
        await restoreLayers();
      }
    }, 120_000);

    it('turns a layer by its handle, snapping to 15° with Shift, and by the angle field (milestone 29)', async () => {
      const overlay = `document.getElementById('layer-overlay')`;
      try {
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1008, height: 655, deviceScaleFactor: 1, mobile: false });
        await clickResult('Title Card');
        await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
        await scrubAndWait(110);

        type Laid = { frame: number | null; blocks: Record<string, { box: { x: number; y: number; width: number; height: number }; layers: { id: string; box: { x: number; y: number; width: number; height: number }; ink?: { x: number; y: number; width: number; height: number }; draw: { alpha: number; dx: number; dy: number; scale: number; rotate?: number } }[] }> };
        const laid = () => inTemplate<Laid>(`window.__pulp.laid`, CARD);
        const titleDraw = async () => (await laid()).blocks.card!.layers.find((l) => l.id === 'title')!.draw;
        const box = () => page.eval<{ left: number; top: number; width: number; height: number }>(`(() => { const r = ${overlay}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
        const frameSize = () => page.eval<{ width: number; height: number }>(`(() => { const c = document.getElementById('preview-frame'); const [w, h] = (c.style.aspectRatio || '1920 / 1080').split('/').map(Number); return { width: w, height: h }; })()`);
        const client = async (fx: number, fy: number) => {
          const b = await box();
          const f = await frameSize();
          return { x: b.left + (fx / f.width) * b.width, y: b.top + (fy / f.height) * b.height };
        };
        const pointer = (type: string, x: number, y: number, shift = false, target = overlay) =>
          page.eval(`${target}.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { clientX: ${x}, clientY: ${y}, pointerId: 9, button: 0, shiftKey: ${shift}, bubbles: true }))`);
        const overlayReady = (frame: number) =>
          until(() => page.eval<boolean>(`${overlay}.dataset.laidFrame === '${frame}' && ${overlayCurrent}`), `the overlay holding frame ${frame}, as last asked for`);

        // The page reports what the layer draws beside the slot it sits in: for a line of type
        // the two differ, and the turn goes about the words.
        await overlayReady(110);
        const title = (await laid()).blocks.card!.layers.find((l) => l.id === 'title')!;
        expect(title.ink, 'the page reports the drawn box').toBeDefined();
        expect(title.ink!.width, 'a line is narrower than the block that holds it').toBeLessThan(title.box.width);

        // Select it where it was drawn, then take hold of the rotate handle.
        const inkCentre = { x: title.ink!.x + title.ink!.width / 2, y: title.ink!.y + title.ink!.height / 2 };
        const at = await client(inkCentre.x, inkCentre.y);
        await pointer('pointerdown', at.x, at.y);
        await pointer('pointerup', at.x, at.y);
        await until(() => page.eval<boolean>(`!!${overlay}.querySelector('.stage-handle.rotate')`), 'the rotate handle on the selection');

        // Sweep a quarter turn clockwise about that center: from above it to the right of it.
        const above = await client(inkCentre.x, inkCentre.y - 200);
        const right = await client(inkCentre.x + 200, inkCentre.y);
        const handle = `${overlay}.querySelector('.stage-handle.rotate')`;
        await pointer('pointerdown', above.x, above.y, false, handle);
        await pointer('pointermove', right.x, right.y);
        await pointer('pointerup', right.x, right.y);
        await until(async () => Math.abs(((await titleDraw()).rotate ?? 0) - 90) < 6, 'the sweep turned the layer a quarter');
        // The angle field in the card shows what the drag settled on.
        const angleField = `document.querySelector('#params .param-card[data-layer=title] input[aria-label="Title angle"]')`;
        await until(() => page.eval<boolean>(`!!${angleField}`), 'the angle field');
        expect(Math.abs(Number(await page.eval<string>(`${angleField}.value`)) - (await titleDraw()).rotate!)).toBeLessThan(1);

        // Shift settles it on a 15° step, whatever the sweep lands on.
        const offStep = await client(inkCentre.x + 200, inkCentre.y + 37);
        await pointer('pointerdown', above.x, above.y, false, handle);
        await pointer('pointermove', offStep.x, offStep.y, true);
        await pointer('pointerup', offStep.x, offStep.y, true);
        await until(async () => ((await titleDraw()).rotate ?? 0) % 15 === 0, 'Shift settling the turn on a step');

        // The field sets it exactly, and it is one undo step like any other edit.
        await page.eval(`(() => { const f = ${angleField}; f.value = '-30'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(async () => Math.abs(((await titleDraw()).rotate ?? 0) + 30) < 0.01, 'the angle field setting it exactly');
        await page.eval(`document.getElementById('undo').click()`);
        await until(async () => ((await titleDraw()).rotate ?? 0) !== -30, 'undo stepping back past the field');

        // Reset position clears the turn with everything else.
        await page.eval(`document.querySelector('#params [aria-label="Reset Title position"]').click()`);
        await until(async () => {
          const d = await titleDraw();
          return (d.rotate ?? 0) === 0 && Math.abs(d.dx) < 0.5 && Math.abs(d.scale - 1) < 0.01;
        }, 'Reset position putting the layer back');
        expect(await page.eval<boolean>(`!!document.querySelector('#params [aria-label="Reset Title position"]')`), 'and the button goes with it').toBe(false);
      } finally {
        await restoreLayers();
        await page.send('Emulation.clearDeviceMetricsOverride');
      }
    }, 120_000);

    it('moves, scales and nudges a layer on the stage, one undo step a gesture, and the design still carries it', async () => {
      const overlay = `document.getElementById('layer-overlay')`;
      try {
        // The window CI runs at, with the tray open: the geometry that once left the preview 2 px
        // tall and hidden, so a click had nothing to land on (docs/platform-notes.md). The picture
        // keeps a floor now and the stage's own chrome gives way, so the handles still work here.
        // Classic scroll bars, as the short-window test forces them: Linux and Windows draw bars
        // that take layout room where macOS overlays them, and with the platform's taller chrome
        // the tray is capped harder there to keep the stage's floor.
        await page.eval(`(() => { const st = document.createElement('style'); st.id = 'classic-scrollbars-stage';
          st.textContent = '::-webkit-scrollbar{width:17px;height:17px}::-webkit-scrollbar-thumb{background:#666}';
          document.head.append(st); return true; })()`);
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1008, height: 655, deviceScaleFactor: 1, mobile: false });
        await clickResult('Title Card');
        await page.eval(`document.getElementById('add-to-collection').click()`);
        // Open, with a body on screen: how tall is the layout's business — on Linux and Windows the
        // taller chrome caps the tray under the 100 px this wait once asked for, which is the cap
        // doing its job of keeping the stage's floor (docs/platform-notes.md).
        await until(() => page.eval<boolean>(
          `(() => { const app = document.getElementById('app'); return !app.classList.contains('tray-collapsed') && document.querySelector('.tray-body').getBoundingClientRect().height > 0; })()`,
        ), 'the tray open, squeezing the stage');
        await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
        await scrubAndWait(110);
        expect(await page.eval<number>(`Math.round(document.querySelector('.preview-wrap').getBoundingClientRect().height)`), 'the picture keeps room even here').toBeGreaterThanOrEqual(96);
        await until(() => page.eval<boolean>(`${overlay}.classList.contains('active')`), 'the overlay active over a template with layers');

        type Laid = { frame: number | null; blocks: Record<string, { box: { x: number; y: number; width: number; height: number }; layers: { id: string; type: string; box: { x: number; y: number; width: number; height: number }; draw: { alpha: number; dx: number; dy: number; scale: number } }[] }> };
        const laid = () => inTemplate<Laid>(`window.__pulp.laid`, CARD);
        const titleDraw = async () => (await laid()).blocks.card!.layers.find((l) => l.id === 'title')!.draw;
        const box = () => page.eval<{ left: number; top: number; width: number; height: number }>(`(() => { const r = ${overlay}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
        const frameSize = () => page.eval<{ width: number; height: number }>(`(() => { const c = document.getElementById('preview-frame'); const [w, h] = (c.style.aspectRatio || '1920 / 1080').split('/').map(Number); return { width: w, height: h }; })()`);
        /**
         * The overlay hit-tests the last report the page sent it, which can lag the frame the page
         * has drawn: `drawn` is set before the reply is posted. Waiting for the overlay to hold the
         * same frame is what makes a click land on what is on screen (docs/platform-notes.md).
         */
        const overlayReady = (frame: number) =>
          until(() => page.eval<boolean>(`${overlay}.dataset.laidFrame === '${frame}' && ${overlayCurrent}`), `the overlay holding frame ${frame}, as last asked for`);
        /**
         * The client point of a frame-pixel point, through the overlay's own box and the size the
         * preview really renders at — never an assumed 1920, which a portrait aspect would break.
         */
        const client = async (fx: number, fy: number) => {
          const b = await box();
          const f = await frameSize();
          return { x: b.left + (fx / f.width) * b.width, y: b.top + (fy / f.height) * b.height };
        };
        const pointer = (type: string, x: number, y: number, target = overlay) =>
          page.eval(`${target}.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { clientX: ${x}, clientY: ${y}, pointerId: 7, button: 0, bubbles: true }))`);

        // Click the title where it was really drawn: it is selected on the stage and in the tab.
        await overlayReady(110);
        const before = await laid();
        const t0 = before.blocks.card!.layers.find((l) => l.id === 'title')!;
        const centreF = { x: t0.box.x + t0.draw.dx + t0.box.width / 2, y: t0.box.y + t0.draw.dy + t0.box.height / 2 };
        const at0 = await client(centreF.x, centreF.y);
        await pointer('pointerdown', at0.x, at0.y);
        await until(() => page.eval<boolean>(`!!document.querySelector('#params .param-card.stage-selected[data-layer=title]')`), 'the title card lit by the stage selection');
        expect(await page.eval<boolean>(`!!${overlay}.querySelector('.stage-select')`)).toBe(true);

        // The title starts centered, so a tiny move keeps it inside the snap threshold: the center
        // guide draws while it holds, which is the "say it while it snaps" of the item.
        await pointer('pointermove', at0.x + 2, at0.y + 1);
        await until(() => page.eval<boolean>(`!!${overlay}.querySelector('.stage-guide.x')`), 'the center guide while snapped');
        // A hand pauses mid-drag; the gesture is still one undo step however long it holds. Past
        // the typing commit's 400 ms delay is what split it on a slow runner before.
        await sleep(600);

        // Drag it right and down; the placement lands as frame fractions, snap tolerance allowed.
        const b = await box();
        const toFrame = (await frameSize()).width / b.width;
        await pointer('pointermove', at0.x + 80, at0.y + 40);
        await pointer('pointerup', at0.x + 80, at0.y + 40);
        // Snapping is honest to the eye, not the maths: within 6 screen pixels a line takes the
        // layer, and at a small preview 6 screen pixels is many frame pixels. The tolerance is
        // therefore the snap threshold in frame pixels, plus a little antialiasing room.
        const snapRoom = 6 * toFrame + 12;
        await until(async () => Math.abs((await titleDraw()).dx - 80 * toFrame) < snapRoom, 'the drag landed as an offset');
        expect(Math.abs((await titleDraw()).dy - 40 * toFrame)).toBeLessThan(snapRoom);
        // The card now offers its way back.
        await until(() => page.eval<boolean>(`!!document.querySelector('#params [aria-label="Reset Title position"]')`), 'Reset position on the placed layer');

        // A nudge is a fraction of the frame; Shift is bolder. Each press is one undo step.
        const nudgedFrom = (await titleDraw()).dx;
        await page.eval(`${overlay}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`);
        await until(async () => (await titleDraw()).dx > nudgedFrom + 2, 'the nudge landed');
        expect((await titleDraw()).dx - nudgedFrom).toBeCloseTo(0.002 * 1920, 0);

        // Resize by the corner: drag the south-east handle away from the center.
        const handleAt = await page.eval<{ x: number; y: number }>(`(() => { const r = ${overlay}.querySelector('.stage-handle.se').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        await pointer('pointerdown', handleAt.x, handleAt.y, `${overlay}.querySelector('.stage-handle.se')`);
        await pointer('pointermove', handleAt.x + 60, handleAt.y + 34);
        await pointer('pointerup', handleAt.x + 60, handleAt.y + 34);
        await until(async () => (await titleDraw()).scale > 1.05, 'the corner drag scaled the layer');

        // Three gestures, three steps back: the title sits exactly where the stack put it again.
        for (let i = 0; i < 3; i++) await page.eval(`document.getElementById('undo').click()`);
        await until(async () => {
          const d = await titleDraw();
          return Math.abs(d.dx) < 0.5 && Math.abs(d.dy) < 0.5 && Math.abs(d.scale - 1) < 0.01;
        }, 'undo returning the layer to its stack');

        // The template still owns the entrance: a placed layer is still absent before its turn.
        await page.eval(`${overlay}.focus()`);
        await page.eval(`${overlay}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }))`);
        await until(async () => (await titleDraw()).dx > 20, 'the bold nudge landed');
        await scrubAndWait(2);
        expect((await titleDraw()).alpha, 'placed, but not yet arrived').toBeLessThan(0.2);
        await scrubAndWait(110);

        // Per aspect: what was placed at 16:9 does not move the 9:16 layout.
        await fire('#opt-aspect', '9:16', 'change');
        await until(async () => (await laid()).blocks.card !== undefined && (await inTemplate<number>(`document.getElementById('c').width`, CARD)) < 1200, 'the tall preview');
        await scrubAndWait(110);
        expect((await titleDraw()).dx, 'a 16:9 placement never moves the 9:16 frame').toBe(0);
        await fire('#opt-aspect', '16:9', 'change');
        await scrubAndWait(110);
        await page.eval(`document.getElementById('undo').click()`);
        await until(async () => Math.abs((await titleDraw()).dx) < 0.5, 'the nudge undone');

        // A logo rides the same handles: add an image layer, give it the seeded mark, drag it,
        // and Reset position puts it back where the stack had it.
        const wrap = `document.querySelector('#params .layers-block[data-block=card]')`;
        await page.eval(`${wrap}.querySelector('[data-add=image]').click()`);
        await until(() => page.eval<boolean>(`${wrap}.querySelectorAll('.param-card').length === 3`), 'the image layer');
        const icard = `${wrap}.querySelectorAll('.param-card')[2]`;
        await page.eval(`${icard}.querySelector('.image-well').click()`);
        await until(() => page.eval<boolean>(`!!${icard}.querySelector('.image-choice')`), 'stills to choose from');
        await page.eval(`[...${icard}.querySelectorAll('.image-choice')].find((c) => c.querySelector('.name').textContent === 'mark').click()`);
        await until(() => page.eval<boolean>(`!${icard}.querySelector('.image-well').classList.contains('empty')`), 'the picture chosen');
        const ilabel = await page.eval<string>(`${icard}.querySelector('.layer-label').textContent`);
        await scrubAndWait(110);
        const pictured = await until(async () => {
          const l = await laid();
          return (l.blocks.card?.layers.some((y) => y.type === 'image' && y.box.width > 0)) === true;
        }, 'the picture drawn').then(() => laid());
        await overlayReady(110);
        const logo = pictured.blocks.card!.layers.find((y) => y.type === 'image')!;
        const logoAt = await client(logo.box.x + logo.draw.dx + logo.box.width / 2, logo.box.y + logo.draw.dy + logo.box.height / 2);
        await pointer('pointerdown', logoAt.x, logoAt.y);
        await pointer('pointermove', logoAt.x - 70, logoAt.y + 30);
        await pointer('pointerup', logoAt.x - 70, logoAt.y + 30);
        const logoDraw = async () => (await laid()).blocks.card!.layers.find((y) => y.type === 'image')!.draw;
        await until(async () => (await logoDraw()).dx < -40, 'the logo moved left');
        await page.eval(`document.querySelector('#params [aria-label="Reset ${ilabel} position"]').click()`);
        await until(async () => Math.abs((await logoDraw()).dx) < 0.5, 'Reset position putting the logo back');
      } finally {
        await page.eval(`(() => { document.getElementById('classic-scrollbars-stage')?.remove(); return true; })()`);
        await page.send('Emulation.clearDeviceMetricsOverride', {});
        // Leave the collection as it was found: the tests below count what is in it.
        await page.eval(`(() => { const b = document.querySelector('#collection [aria-label="Remove from the collection"]'); if (b) b.click(); })()`);
        await restoreLayers();
        await fire('#opt-aspect', '16:9', 'change');
      }
    }, 120_000);

    it('organises the tab by element: a card per part, the layers among them, and timing last', async () => {
      const cards = () =>
        page.eval<{ card: string; label: string; params: string[]; open: boolean }[]>(
          `[...document.querySelectorAll('#params .param-card')].map((c) => ({ card: c.dataset.card, label: c.querySelector('.layer-label').textContent,
             params: [...c.querySelectorAll('.card-body > .field')].map((f) => f.dataset.param), open: c.querySelector('.card-toggle').getAttribute('aria-expanded') === 'true' }))`,
        );
      await clickResult('Title Card');
      await until(() => page.eval<boolean>(`!!document.querySelector('#params .param-card')`), 'the title card\'s cards');
      // Its two lines, then the card's own colors, then the logo, and the timing last — the title
      // card declares a hold (milestone 30), so that card holds its Length and no parameter of its
      // own. No "Colors" group, and nothing left over.
      // The Captions card is last of all (milestone 50): the words a project says belong to the
      // whole project rather than to any part of the graphic, so they come after the timing.
      expect((await cards()).map((c) => `${c.label}: ${c.params.join(',')}`)).toEqual(['Title: ', 'Subtitle: ', 'Card: background,rule', 'Logo: logo', 'Layout and timing: ', 'Captions: ']);
      expect(await page.eval<number>(`document.querySelectorAll('#params .group-label').length`)).toBe(0);
      // A line's card holds its words and its type, with what can be done to the layer beside the heading.
      expect(await page.eval<boolean>(`!!document.querySelector('#params .param-card[data-card="layer:card.title"] .layer-text')`)).toBe(true);
      expect(await page.eval<boolean>(`!!document.querySelector('#params .param-card[data-card="layer:card.title"] .layer-type')`)).toBe(true);
      expect(await page.eval<string[]>(`[...document.querySelectorAll('#params .param-card[data-card="layer:card.title"] .card-head .layer-actions button')].map((b) => b.getAttribute('aria-label'))`))
        .toEqual(['Hide Title', 'Move Title up', 'Move Title down']);

      // A card folds by its heading and stays folded while the form is rebuilt.
      await page.eval(`document.querySelector('#params .param-card[data-card="element:Card"] .card-toggle').click()`);
      expect((await cards()).find((c) => c.card === 'element:Card')!.open).toBe(false);
      expect(await page.eval<boolean>(`document.querySelector('#params .param-card[data-card="element:Card"] .card-body').hidden`)).toBe(true);
      await page.eval(`document.querySelector('#params .layers-block [data-add=text]').click()`);
      await until(async () => (await cards()).length === 7, 'the added line\'s card');
      expect((await cards()).find((c) => c.card === 'element:Card')!.open, 'still folded after the rebuild').toBe(false);
      // The added line is a card like the template's own, and can be taken out again.
      const added = (await cards())[2]!;
      expect(added.label).toBe('Line 3');
      expect(await page.eval<boolean>(`!!document.querySelector('#params .param-card[data-card="${added.card}"] .layer-type')`)).toBe(true);
      await page.eval(`document.querySelector('#params .param-card[data-card="${added.card}"] [aria-label="Remove Line 3"]').click()`);
      await until(async () => (await cards()).length === 6, 'the card gone with the layer');
      await page.eval(`document.querySelector('#params .param-card[data-card="element:Card"] .card-toggle').click()`);

      // The lower third: the panel's two colors together, and what belongs to the whole graphic last.
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!!document.querySelector('#params .param-card[data-card="element:Panel"]')`), 'the lower third\'s cards');
      expect((await cards()).map((c) => `${c.label}: ${c.params.join(',')}`)).toEqual(['Name: ', 'Title: ', 'Panel: accent,panel', 'Logo: logo', 'Layout and timing: side,inOut', 'Captions: ']);
      // "Logo" under the Logo card is not shown twice: the field's label is kept for the screen reader only.
      expect(await page.eval<string[]>(`[...document.querySelectorAll('#params .param-card[data-card="element:Logo"] .field > .field-head > span')].map((s) => s.className)`)).toEqual(['visually-hidden']);
      // Nothing visible is left in the head but, when there is one, the field's Reset.
      expect(await page.eval<number>(`document.querySelectorAll('#params .param-card[data-card="element:Logo"] .field > .field-head > span:not(.visually-hidden)').length`)).toBe(0);
      expect(await page.eval<string>(`document.querySelector('#params .param-card[data-card="element:Panel"] [data-param=panel] .field-head > span').textContent`)).toBe('Fill');

      // A template with no layers at all is still a card per part, and still ends with the timing:
      // the opener names its elements in the manifest, "Layout and timing" among them, and naming
      // that one must not make a card of it where it is declared.
      await clickResult('Boardroom opener');
      await until(() => page.eval<boolean>(`!!document.querySelector('#params .param-card')`), 'the opener\'s cards');
      expect((await cards()).map((c) => `${c.label}: ${c.params.join(',')}`))
        .toEqual(['Company: company', 'Tagline: tagline', 'Accent: accent', 'Text: text', 'Layout and timing: inOut', 'Captions: ']);
      expect(await page.eval<number>(`document.querySelectorAll('#params .group-label').length`)).toBe(0);
    }, 90_000);


    // Milestone 50: the captions layer's own card. Transcription itself needs the speech model and
    // whisper.cpp, neither of which a test machine is asked for; what is checked here is the card,
    // the styles it offers, and the promise that nothing is fetched before the person is asked.
    it('offers the captions layer: the bundled styles, and a dialog that names the model before fetching it', async () => {
      await clickResult('Title Card');
      await until(() => page.eval<boolean>(`!!document.querySelector('#params .param-card[data-card="@captions"]')`), 'the captions card');
      expect(await page.eval<string[]>(`[...document.querySelectorAll('#params .captions-card select option')].map((o) => o.textContent)`))
        .toEqual(['None (not drawn)', 'Caption Beside', 'Caption Block', 'Caption Clean', 'Caption Duo', 'Caption One Word', 'Caption Pop', 'Caption Sticker']);
      // Nothing captioned yet: the card says where the words would come from, and says it plainly.
      expect(await page.eval<string>(`document.querySelector('#params .captions-card .caption-actions .note').textContent`))
        .toContain('nothing is sent anywhere');
      await page.eval(`[...document.querySelectorAll('#params .captions-card button')].find((b) => b.textContent.startsWith('Transcribe')).click()`);
      await until(() => page.eval<boolean>(`document.getElementById('captions-dialog').open === true`), 'the captions dialog');
      // The model, its size and its license are said before anything is fetched (ADR 0021).
      await until(() => page.eval<boolean>(`/Whisper .* MB · MIT/.test(document.getElementById('captions-model').textContent)`), 'the model named with its size and license');
      await page.eval(`document.getElementById('captions-dialog').close()`);
    }, 60_000);

    it('an image layer stacks with the lines and rides the animation by its position, on both proofs, wide and tall', async () => {
      /** The "mark" still is solid red, so every pixel of it says where the picture is, and none reads as a line of text. */
      const picture = (tid: string) =>
        inTemplate<{ canvas: number[]; red: number; redTop: number; redBottom: number; bandsTop: number | null; bands: number }>(
          `(() => { const c = document.getElementById('c'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let red = 0, redTop = c.height, redBottom = -1;
            for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x += 2) { const i = (y * c.width + x) * 4;
              if (d[i + 3] > 60 && d[i] > 120 && d[i + 1] < 80 && d[i + 2] < 90) { red++; if (y < redTop) redTop = y; if (y > redBottom) redBottom = y; } }
            let bandsTop = null, bands = 0, run = 0;
            for (let y = 0; y < c.height; y++) { let ink = 0;
              if (red && y >= redTop && y <= redBottom) { run = 0; continue; }
              for (let x = 0; x < c.width; x += 2) { const i = (y * c.width + x) * 4; if (d[i + 3] > 60 && d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) ink++; }
              if (ink > 1) { run++; if (run === 4) { bands++; if (bandsTop === null) bandsTop = y - 3; } } else run = 0; }
            return { canvas: [c.width, c.height], red, redTop, redBottom, bandsTop, bands }; })()`,
          tid,
        );
      const drawnOn = (tid: string, frame: number, layers: number) =>
        until(() => inTemplate<boolean>(`!!(window.__pulp && window.__pulp.drawn && window.__pulp.drawn.frame === ${frame} && window.__pulp.drawn.layers === ${layers})`, tid).catch(() => false), `frame ${frame} with ${layers} layers drawn`);
      const addPicture = async (block: string) => {
        const wrap = `document.querySelector('#params .layers-block[data-block=${block}]')`;
        await page.eval(`${wrap}.querySelector('[data-add=image]').click()`);
        await until(() => page.eval<boolean>(`${wrap}.querySelectorAll('.param-card').length === 3`), 'the image layer\'s card');
        const card = `${wrap}.querySelectorAll('.param-card')[2]`;
        // Its card: the picker, no type, and its own size and alignment.
        expect(await page.eval<boolean>(`!!${card}.querySelector('.image-field') && !${card}.querySelector('.layer-type') && !!${card}.querySelector('.image-layer-controls')`)).toBe(true);
        expect(await page.eval<string>(`${card}.querySelector('.image-field .image-name').textContent`)).toBe('No image; the layer takes no room');
        await page.eval(`${card}.querySelector('.image-well').click()`);
        await until(() => page.eval<boolean>(`!!${card}.querySelector('.image-choice')`), 'stills to choose from');
        await page.eval(`[...${card}.querySelectorAll('.image-choice')].find((b) => b.querySelector('.name').textContent === 'mark').click()`);
        await until(() => page.eval<boolean>(`!${card}.querySelector('.image-well').classList.contains('empty')`), 'the picture in the well');
        // Above the title: two moves up puts it first in the stack.
        const label = await page.eval<string>(`${card}.querySelector('.layer-label').textContent`);
        await page.eval(`${card}.querySelector('[aria-label="Move ${label} up"]').click()`);
        await until(() => page.eval<boolean>(`${wrap}.querySelectorAll('.param-card')[1].querySelector('.layer-label').textContent === ${JSON.stringify(label)}`), 'one step up');
        await page.eval(`${wrap}.querySelectorAll('.param-card')[1].querySelector('[aria-label="Move ${label} up"]').click()`);
        await until(() => page.eval<boolean>(`${wrap}.querySelectorAll('.param-card')[0].querySelector('.layer-label').textContent === ${JSON.stringify(label)}`), 'first in the stack');
        return label;
      };

      // Title Card: the picture takes the first position's fade, which starts at once; the title now waits its turn.
      await clickResult('Title Card');
      await until(() => page.eval<boolean>(`!!${section}`), 'the title card');
      try {
        await addPicture('card');
        await scrubTo(24); // 0.8 s: the first position is three quarters in, the second has barely begun
        await drawnOn(CARD, 24, 3);
        const early = await picture(CARD);
        expect(early.red, JSON.stringify(early)).toBeGreaterThan(100);
        expect(early.bands, 'no words yet: the title moved down the stack and waits its turn').toBe(0);
        await scrubTo(90); // 3 s: every position is in
        await drawnOn(CARD, 90, 3);
        const wide = await picture(CARD);
        expect(wide.canvas).toEqual([1920, 1080]);
        expect(wide.bands, JSON.stringify(wide)).toBe(2);
        expect(wide.redBottom, 'the picture sits above the title').toBeLessThan(wide.bandsTop!);
        await fire('#opt-aspect', '9:16', 'change');
        await until(async () => (await shape()) === 'portrait', 'the tall preview');
        await scrubTo(90);
        await until(async () => { const d = await picture(CARD); return d.canvas[1] === 1920 && d.bands === 2 && d.red > 100; }, 'the tall card with its picture');
        const tall = await picture(CARD);
        expect(tall.redBottom).toBeLessThan(tall.bandsTop!);
        await fire('#opt-aspect', '16:9', 'change');
        await until(async () => (await shape()) === 'landscape', 'the wide preview again');
      } finally {
        await restoreLayers('card');
        await fire('#opt-aspect', '16:9', 'change');
      }

      // Lower Third Bar: the picture joins the panel's stack above the name, and the panel grows to hold it.
      const LT = 'pulp.samples.lower-third-bar';
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!!document.querySelector('#params .layers-block[data-block=strap]')`), 'the strap');
      await page.eval(`document.getElementById('reset-all').disabled || document.getElementById('reset-all').click()`);
      try {
        await addPicture('strap');
        await scrubTo(90);
        await drawnOn(LT, 90, 3);
        const wide = await picture(LT);
        expect(wide.red, JSON.stringify(wide)).toBeGreaterThan(100);
        expect(wide.bands).toBe(2);
        expect(wide.redBottom).toBeLessThan(wide.bandsTop!);
        await fire('#opt-aspect', '9:16', 'change');
        await until(async () => (await shape()) === 'portrait', 'the tall lower third');
        await scrubTo(90);
        await until(async () => { const d = await picture(LT); return d.canvas[1] === 1920 && d.red > 100 && d.bands === 2; }, 'the tall strap with its picture');
        const tall = await picture(LT);
        expect(tall.redBottom).toBeLessThan(tall.bandsTop!);
      } finally {
        await restoreLayers('strap');
        await fire('#opt-aspect', '16:9', 'change');
        await clickResult('Title Card');
        await until(() => page.eval<boolean>(`!!${section}`), 'the title card again');
      }
    }, 150_000);

    it('the render cache tells two stacks apart: changing a line renders afresh', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available; the cache check for layers is skipped.');
        return;
      }
      await clickResult('Title Card');
      await until(() => page.eval<boolean>(`!!${section}`), 'the title card');
      // One frame, so each render here is quick.
      await page.eval(`(() => { const i = document.getElementById('opt-in'); i.value = '110'; i.dispatchEvent(new Event('input', { bubbles: true })); const o = document.getElementById('opt-out'); o.value = '110'; o.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await fire('#preset', 'png-sequence', 'change');
      const cards = () => page.eval<string[]>(`[...document.querySelectorAll('#queue .job-card[draggable="true"]')].map((c) => c.dataset.file)`);
      const prepare = async (what: string) => {
        const before = (await cards()).length;
        await page.eval(`document.getElementById('drag-prepare').click()`);
        await until(async () => (await cards()).length > before, `a draggable card for ${what}`, 60_000);
        return (await cards()).at(-1)!;
      };
      const first = await prepare('the template\'s own words');
      // The same stack is the same render: the cache answers without rendering again, with the same file.
      const again = await prepare('the same words again');
      expect(again).toBe(first);
      expect(await page.eval<string>(`document.getElementById('drag-status').textContent`)).toBe('Ready to drag, in the tray.');

      // A changed line is a different render: the key covers the layers, so the cache cannot hand back the old frame.
      await page.eval(`(() => { const i = ${section}.querySelector('.layer-row[data-layer=title] .layer-text'); i.value = 'Notes from the field'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      const changed = await prepare('the changed line');
      expect(changed).not.toBe(first);

      // Put it all back: the template's own words, an empty tray and an empty cache.
      await page.eval(`${section}.querySelector('.layers-reset').click()`);
      await until(() => page.eval<boolean>(`${section}.querySelector('.layers-reset').hidden`), 'the template\'s own layers');
      await page.eval(`document.getElementById('reset-all').disabled || document.getElementById('reset-all').click()`);
      await page.eval(`document.getElementById('clear-finished').click()`);
      await page.eval(`document.getElementById('cache-clear').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('cache-summary').textContent.includes('0 files')`), 'the cache to be cleared');
    }, 120_000);

    it('the lower third: an added line grows the panel and rides its wipe and fade, wide and tall', async () => {
      const LT = 'pulp.samples.lower-third-bar';
      const strap = `document.querySelector('#params .layers-block[data-block=strap]')`;
      const scrubAndWait = async (frame: number) => {
        await scrubTo(frame);
        await until(() => inTemplate<boolean>(`!!(window.__pulp && window.__pulp.drawn && window.__pulp.drawn.frame === ${frame})`, LT).catch(() => false), `frame ${frame} of the lower third to be drawn`);
      };
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!!${strap}`), 'the strap\'s layers');
      try {
      // Earlier tests leave their edits on this template on purpose (the panel at 25% green, a changed name); start from its own values.
      await page.eval(`document.getElementById('reset-all').disabled || document.getElementById('reset-all').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('reset-all').disabled`), 'the lower third at its defaults');
      expect(await page.eval<string[]>(`[...${strap}.querySelectorAll('.layer-row')].map((r) => r.dataset.layer)`)).toEqual(['name', 'title']);
      /** What the panel holds: its box (the dark panel's extent) and the bands of white text inside it. */
      const panel = () =>
        inTemplate<{ canvas: number[]; panelTop: number; panelBottom: number; panelLeft: number; panelRight: number; bands: number[] }>(
          `(() => {
            const c = document.getElementById('c'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let top = c.height, bottom = 0, left = c.width, right = 0; const rows = [];
            for (let y = 0; y < c.height; y++) { let ink = 0, dark = false;
              for (let x = 0; x < c.width; x += 2) { const i = (y * c.width + x) * 4; const a = d[i + 3];
                if (a > 150 && d[i] < 40 && d[i + 1] < 50 && d[i + 2] < 70) { dark = true; if (x < left) left = x; if (x > right) right = x; }
                if (a > 150 && d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) ink++; }
              if (dark) { if (y < top) top = y; if (y > bottom) bottom = y; }
              rows.push(ink > 1); }
            const bands = []; let run = 0;
            for (let y = 0; y <= rows.length; y++) { if (y < rows.length && rows[y]) run++; else { if (run > 3) bands.push(run); run = 0; } }
            return { canvas: [c.width, c.height], panelTop: top, panelBottom: bottom, panelLeft: left, panelRight: right, bands };
          })()`,
          LT,
        );
      await scrubAndWait(90); // mid-hold
      const before = await panel();
      expect(before.canvas).toEqual([1920, 1080]);
      expect(before.bands, JSON.stringify(before)).toHaveLength(2);
      const panelHeight = before.panelBottom - before.panelTop;
      expect(panelHeight).toBeGreaterThan(140); // 150 at 1080p, within the antialiasing

      // Add a line: the panel grows to hold it and the stack has three bands, all inside the panel.
      await page.eval(`${strap}.querySelector('[data-add=text]').click()`);
      await until(() => page.eval<boolean>(`${strap}.querySelectorAll('.layer-row').length === 3`), 'the added line');
      await page.eval(`(() => { const i = ${strap}.querySelectorAll('.layer-row')[2].querySelector('.layer-text'); i.value = 'Live from the field'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await scrubAndWait(90);
      await until(async () => (await panel()).bands.length === 3, 'the third line in the panel');
      const grown = await panel();
      expect(grown.panelBottom - grown.panelTop).toBeGreaterThan(panelHeight + 40);
      expect(grown.panelBottom).toBeLessThanOrEqual(before.panelBottom + 2); // the panel sits on the same baseline and grows upward

      // It rides the wipe and the fade: while the panel is still wiping out, no words at all; by the end, nothing.
      await scrubAndWait(6); // 0.2 s: the bar has grown, the panel is barely out, the words have not faded in
      const early = await panel();
      expect(early.bands, JSON.stringify(early)).toHaveLength(0);
      await scrubAndWait(179);
      expect((await panel()).bands).toHaveLength(0);

      // Tall: the same three lines, the panel above the caption band, and clear of the controls column.
      await fire('#opt-aspect', '9:16', 'change');
      await until(async () => (await shape()) === 'portrait', 'the tall preview');
      await scrubAndWait(90);
      const tall = await panel();
      expect(tall.canvas).toEqual([1080, 1920]);
      expect(tall.bands, JSON.stringify(tall)).toHaveLength(3);
      expect(tall.panelBottom).toBeLessThanOrEqual(1920 * 0.72 + 2);
      expect(tall.panelRight).toBeLessThanOrEqual(1080 * 0.82 + 2);
      await fire('#opt-aspect', '16:9', 'change');
      await until(async () => (await shape()) === 'landscape', 'the wide preview again');

      } finally {
        // Back to the template's own two lines, so the tests after this find the lower third as it ships.
        await restoreLayers('strap');
        await page.send('Emulation.clearDeviceMetricsOverride', {});
        await clickResult('Title Card');
        await until(() => page.eval<boolean>(`!!${section}`), 'the title card again');
      }
    }, 120_000);

    it('lays the stack out for a tall frame as well, from the block\'s own box', async () => {
      await clickResult('Title Card');
      await until(() => page.eval<boolean>(`!!${section}`), 'the title card');
      await scrubAndWait(110);
      const wide = await untilDrawn((d) => d.canvas[0] === 1920 && d.canvas[1] === 1080, 'the wide card');
      expect(wide.bands, JSON.stringify(wide)).toHaveLength(2);
      await fire('#opt-aspect', '9:16', 'change');
      await until(async () => (await shape()) === 'portrait', 'the tall preview');
      await scrubAndWait(110);
      // The box turns at once; the picture inside it follows when the page has drawn the new shape.
      const tall = await untilDrawn((d) => d.canvas[0] === 1080 && d.canvas[1] === 1920, 'the card drawn tall');
      expect(tall.bands, JSON.stringify(tall)).toHaveLength(2);
      // The tall card keeps its bottom clear for captions, so the stack sits higher up the frame.
      expect(tall.bands[0]!.top / 1920).toBeLessThan(wide.bands[0]!.top / 1080);
      await fire('#opt-aspect', '16:9', 'change');
      await until(async () => (await shape()) === 'landscape', 'the wide preview again');
    }, 90_000);

    /**
     * The stage's right-click menu (milestone 39). It is the application menu's command list
     * arranged for a pointer, so these tests drive the real popup over the real picture: the
     * layer under the pointer is selected and edited, and a layer added lands where the click was.
     */
    describe('the right-click menu (milestone 39)', () => {
      const menu = `document.querySelector('.context-menu-layer .context-menu:not(.submenu)')`;
      const items = `[...document.querySelectorAll('.context-menu-layer .context-menu:not(.submenu) > button')]`;
      const overlay = `document.getElementById('layer-overlay')`;
      const open = () => page.eval<boolean>(`!!${menu}`);
      const labels = () => page.eval<string[]>(`${items}.map((b) => b.textContent)`);
      const enabled = (label: string) =>
        page.eval<boolean>(`!${items}.find((b) => b.textContent === ${JSON.stringify(label)}).disabled`);
      const choose = (label: string) =>
        page.eval(`[...document.querySelectorAll('.context-menu-layer .context-menu > button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);

      /** Where a point of the frame sits on screen, through the picture's own box. */
      const client = async (fx: number, fy: number) => {
        const box = await page.eval<{ left: number; top: number; width: number; height: number }>(
          `(() => { const r = document.getElementById('preview-frame').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`,
        );
        const size = await page.eval<{ width: number; height: number }>(
          `(() => { const [w, h] = (document.getElementById('preview-frame').style.aspectRatio || '1920 / 1080').split('/').map(Number); return { width: w, height: h }; })()`,
        );
        return { x: box.left + (fx / size.width) * box.width, y: box.top + (fy / size.height) * box.height };
      };

      /**
       * Right-click a point of the frame, as a pointer does: on whatever is really on top at that
       * point, not on the frame itself. The picture is an `<iframe>`, and an event aimed straight
       * at the frame would pass a test that a real right-click fails — the iframe would swallow it.
       */
      const rightClick = async (fx: number, fy: number) => {
        const at = await client(fx, fy);
        const landedOn = await page.eval<string>(
          `(() => { const el = document.elementFromPoint(${at.x}, ${at.y});
            if (!el) return 'nothing';
            el.dispatchEvent(new MouseEvent('contextmenu', { clientX: ${at.x}, clientY: ${at.y}, button: 2, bubbles: true, cancelable: true }));
            return el.id || el.className || el.tagName; })()`,
        );
        // The picture must never be the iframe's: nothing on the stage would hear the click.
        expect(landedOn, 'the right-click landed on something that reaches the stage').not.toBe('preview');
        await until(open, `the right-click menu (the click landed on "${landedOn}")`);
      };

      /** What the page last laid out, so a test reads where a layer really is rather than guessing. */
      type Laid = { blocks: Record<string, { layers: { id: string; box: { x: number; y: number; width: number; height: number }; ink?: { x: number; y: number; width: number; height: number }; draw: { dx: number; dy: number } }[] }> };
      const laid = () => inTemplate<Laid>(`window.__pulp.laid`, CARD);
      const laidLayer = async (id: string) => (await laid()).blocks.card?.layers.find((l) => l.id === id) ?? null;
      const overlayReady = (frame: number) => until(() => page.eval<boolean>(`${overlay}.dataset.laidFrame === '${frame}' && ${overlayCurrent}`), `the overlay holding frame ${frame}, as last asked for`);
      /** The middle of what a layer draws, in frame pixels. */
      const inkCentre = async (id: string) => {
        const l = await laidLayer(id);
        if (!l || l.box.width <= 0) return null;
        const ink = l.ink ?? l.box;
        return { x: ink.x + ink.width / 2 + l.draw.dx, y: ink.y + ink.height / 2 + l.draw.dy };
      };

      /**
       * Right-click a layer where it is drawn **now**. Every edit re-lays the stack, so a point
       * read before one is a point some other layer may be sitting at by the time it is clicked;
       * the click is taken again until the layer it was aimed at is the one that came up selected.
       */
      /**
       * The menu for whatever is selected, opened the way the keyboard opens it. Deterministic
       * where a pointer is not: it acts on the selection rather than on what sits under a point.
       */
      const menuForSelected = async () => {
        await page.eval(`(() => { const o = document.getElementById('layer-overlay'); o.focus();
          o.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })); })()`);
        await until(open, 'the menu for the selected layer');
      };

      /**
       * A layer added from the menu lands where it was asked for, and is selected, only when the
       * page's *next* frame report arrives (placeLayerAt). Acting on it before then is a race the
       * Linux runner lost: a right-click aimed at where it would be opened the menu of whatever
       * was there already, and the late placement then flipped the selection to the new layer,
       * so a check on the selection alone passed for a menu that was somebody else's. Wait for
       * both, then ask for the selection's own menu.
       */
      const addedLayerReady = (id: string) =>
        until(
          async () =>
            (await page.eval<boolean>(`!!document.querySelector('#params .param-card.stage-selected[data-layer="${id}"]')`)) &&
            (await inkCentre(id).catch(() => null)) !== null,
          `the added layer ${id} placed and selected`,
        );

      const rightClickLayer = async (id: string) => {
        await until(async () => {
          const centre = await inkCentre(id).catch(() => null);
          if (!centre) return false;
          await rightClick(centre.x, centre.y);
          return page.eval<boolean>(`!!document.querySelector('#params .param-card.stage-selected[data-layer="${id}"]')`);
        }, `the right-click menu on ${id}`);
      };

      beforeEach(async () => {
        await clickResult('Title Card');
        await until(() => page.eval<boolean>(`!!${section}`), 'the layers section');
        await scrubAndWait(110);
        await overlayReady(110);
      });

      afterEach(async () => {
        await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await restoreLayers();
      });

      it('offers the layer under the pointer its own edits, and bare picture only what can be added', async () => {
        const at = (await inkCentre('title'))!;
        await rightClick(at.x, at.y);
        // Right-clicking a layer selects it, exactly as a left-click would.
        await until(() => page.eval<boolean>(`!!document.querySelector('#params .param-card.stage-selected[data-layer=title]')`), 'the title selected by the right-click');
        expect(await labels()).toEqual([
          'Edit Text',
          'Make Words a Parameter', 'Make Color a Parameter',
          'Cut', 'Copy', 'Paste', 'Duplicate', 'Delete',
          'Order',
          'Copy Look', 'Paste Look',
          'Start at Playhead', 'End at Playhead',
          'Animate', 'Record Keyframes',
          'Reset Layer',
          'Add Text Here', 'Add Shape Here', 'Add Asset Here',
        ]);
        // The title is the template's own required layer, so it cannot be cut or deleted — and
        // nothing has been given it, so there is nothing to reset.
        expect(await enabled('Copy')).toBe(true);
        expect(await enabled('Cut')).toBe(false);
        expect(await enabled('Delete')).toBe(false);
        expect(await enabled('Reset Layer')).toBe(false);
        expect(await enabled('Paste Look')).toBe(false);

        // Over bare picture: the selection is dropped and only what can be added is offered.
        await rightClick(40, 40);
        expect(await page.eval<boolean>(`!!document.querySelector('#params .param-card.stage-selected')`)).toBe(false);
        expect(await labels()).toEqual(['Add Text Here', 'Add Shape Here', 'Add Asset Here', 'Paste', 'Add to Collection', 'Background', 'Theater']);
        // Escape puts it away and gives the keyboard back to the stage.
        await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await until(async () => !(await open()), 'the menu closing on Escape');
      }, 120_000);

      it('duplicates, reorders and deletes a layer, each one undo step', async () => {
        const before = await layerIds();
        await rightClickLayer('subtitle');
        await choose('Duplicate');
        await until(async () => (await layerIds()).length === before.length + 1, 'the duplicate');
        const ids = await layerIds();
        const copy = ids.find((id) => !before.includes(id))!;
        // It sits right above the original rather than at the end of the stack, and wears a name of its own.
        expect(ids).toEqual(['title', 'subtitle', copy]);
        expect(await page.eval<string>(`document.querySelector('#params .param-card[data-layer="${copy}"] .layer-label').textContent`)).toBe('Subtitle 2');
        // And it carries the original's words, so it is a copy and not a blank line.
        expect(await page.eval<string>(`document.querySelector('#params .param-card[data-layer="${copy}"] .layer-text').value`)).toBe('Episode 1: Early Light');

        // Order moves it along the stack; the submenu opens from its parent item. The copy is
        // already the selection, so the menu is opened from the keyboard: a copy of a line sits
        // right beside the line it came from, and aiming a pointer between the two is a coin toss.
        await menuForSelected();
        await until(() => page.eval<boolean>(`!!document.querySelector('#params .param-card.stage-selected[data-layer="${copy}"]')`), 'the copy selected');
        await choose('Order');
        await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu.submenu')`), 'the Order submenu');
        await choose('Send to Back');
        await until(async () => (await layerIds()).join() === [copy, 'title', 'subtitle'].join(), 'the copy sent to the back');

        // Undo steps back through each, so the menu's edits are edits like any other.
        await page.eval(`document.getElementById('undo').click()`);
        await until(async () => (await layerIds()).join() === ['title', 'subtitle', copy].join(), 'undo putting the order back');

        // Delete takes the copy out; the required title cannot be deleted at all.
        await menuForSelected();
        await choose('Delete');
        await until(async () => (await layerIds()).join() === before.join(), 'the copy deleted');
      }, 120_000);

      it('cuts a layer and pastes it back, and copies a look from one layer onto another', async () => {
        const before = await layerIds();
        await rightClickLayer('subtitle');
        expect(await enabled('Copy Look')).toBe(true);
        await choose('Copy Look');
        // Pasting the subtitle's own look — the template's own drawing — onto the title is allowed
        // now: "as the template draws it" is a look worth carrying, and only nothing copied is not.
        await rightClickLayer('title');
        expect(await enabled('Paste Look')).toBe(true);
        await choose('Paste Look');

        // Cut takes the subtitle out and holds it; Paste puts it back into the same block.
        await rightClickLayer('subtitle');
        await choose('Cut');
        await until(async () => !(await layerIds()).includes('subtitle'), 'the subtitle cut');
        await rightClick(40, 40);
        expect(await enabled('Paste')).toBe(true);
        await choose('Paste');
        await until(async () => (await layerIds()).length === before.length, 'the subtitle pasted back');
        const ids = await layerIds();
        const back = ids.find((id) => !['title'].includes(id))!;
        expect(await page.eval<string>(`document.querySelector('#params .param-card[data-layer="${back}"] .layer-text').value`)).toBe('Episode 1: Early Light');
      }, 120_000);

      it('starts and ends a layer at the playhead, which is what the bar under the scrub bar shows', async () => {
        // 2 s into the graphic: the playhead is where the layer should start.
        await scrubAndWait(60);
        await overlayReady(60);
        await rightClickLayer('subtitle');
        await choose('Start at Playhead');
        const barStart = `document.querySelector('.layer-bar[data-layer=subtitle] .bar-end.start')`;
        await until(async () => Math.abs(Number(await page.eval<string>(`${barStart}.getAttribute('aria-valuenow')`)) - 2) < 0.2, 'the bar showing the layer starting at the playhead');
        // Its own card says so too: one edit, seen everywhere.
        await page.eval(`document.getElementById('undo').click()`);
        await until(async () => Number(await page.eval<string>(`${barStart}.getAttribute('aria-valuenow')`)) < 0.2, 'undo putting the start back');
      }, 120_000);

      it('edits a line\'s words and replaces a picture from the menu, each on its own kind of layer', async () => {
        // A line of type: Edit Text brings the tab forward with the caret in its words, selected.
        await rightClickLayer('title');
        expect(await labels()).toContain('Edit Text');
        expect(await labels()).not.toContain('Replace Image…');
        await choose('Edit Text');
        await until(() => page.eval<boolean>(`document.getElementById('app').classList.contains('inspector-open')`), 'the Parameters drawer');
        await until(
          () => page.eval<boolean>(`document.activeElement === document.querySelector('#params .param-card[data-layer=title] .layer-text')`),
          'the caret in the title\'s words',
        );
        // Selected, so typing replaces them rather than appending.
        expect(await page.eval<number>(`document.activeElement.selectionEnd - document.activeElement.selectionStart`))
          .toBe(await page.eval<number>(`document.activeElement.value.length`));

        // A picture layer, added through the menu's own asset list: Replace Image… opens its chooser.
        // Asked for well away from the lines, so it does not land on one of them.
        const before = await layerIds();
        const frame = await page.eval<{ width: number; height: number }>(
          `(() => { const [w, h] = (document.getElementById('preview-frame').style.aspectRatio || '1920 / 1080').split('/').map(Number); return { width: w, height: h }; })()`,
        );
        await rightClick(frame.width * 0.8, frame.height * 0.8);
        await choose('Add Asset Here');
        await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu.submenu')`), 'the asset submenu');
        // A plain PNG by name: a layered file or a PDF draws through the rasterizer and would
        // make this test about that instead. It is in the list because the person's own things
        // come before the bundled animations (milestone 35).
        const picked = await page.eval<boolean>(
          `(() => { const b = [...document.querySelectorAll('.context-menu.submenu > button[data-command="layer.addImage"]')].find((x) => x.textContent === 'mark');
            if (!b) return false; b.click(); return true; })()`,
        );
        expect(picked, 'the asset submenu offers the library\'s plain PNG').toBe(true);
        await until(async () => (await layerIds()).length === before.length + 1, 'the picture layer');
        const picture = (await layerIds()).find((id) => !before.includes(id))!;
        await addedLayerReady(picture);
        await menuForSelected();
        expect(await labels()).toContain('Replace Image…');
        expect(await labels()).not.toContain('Edit Text');
        await choose('Replace Image…');
        await until(
          () => page.eval<boolean>(`!document.querySelector('#params .param-card[data-layer="${picture}"] .image-picker').hidden`),
          'the picture chooser open on that layer',
        );
      }, 120_000);

      it('offers Replace Clip… on a video layer, as Replace Image… on a picture', async () => {
        // The fixture clips are made with ffmpeg, so without it there is no clip to choose.
        // Asked in the body, not with skipIf: that is read when the test is collected, before
        // beforeAll has found out whether ffmpeg is here, so it would skip always.
        if (!haveVideo) return;
        // A clip layer from the menu's own asset list, then its own chooser from the menu.
        const before = await layerIds();
        const frame = await page.eval<{ width: number; height: number }>(
          `(() => { const [w, h] = (document.getElementById('preview-frame').style.aspectRatio || '1920 / 1080').split('/').map(Number); return { width: w, height: h }; })()`,
        );
        await rightClick(frame.width * 0.8, frame.height * 0.8);
        await choose('Add Asset Here');
        await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu.submenu')`), 'the asset submenu');
        const picked = await page.eval<boolean>(
          `(() => { const b = document.querySelector('.context-menu.submenu > button[data-command="layer.addVideo"]');
            if (!b) return false; b.click(); return true; })()`,
        );
        expect(picked, 'the asset submenu offers a clip').toBe(true);
        await until(async () => (await layerIds()).length === before.length + 1, 'the clip layer');
        const clip = (await layerIds()).find((id) => !before.includes(id))!;
        await addedLayerReady(clip);
        await menuForSelected();
        expect(await labels()).toContain('Replace Clip…');
        expect(await labels()).not.toContain('Replace Image…');
        expect(await labels()).not.toContain('Edit Text');
        await choose('Replace Clip…');
        await until(
          () => page.eval<boolean>(`!document.querySelector('#params .param-card[data-layer="${clip}"] .image-picker').hidden`),
          'the clip chooser open on that layer',
        );
      }, 120_000);

      it('a video layer keeps its own sound: volume and mute on its card, silence while muted, and a silent clip says so (milestone 48)', async () => {
        if (!haveVideo) return;
        const before = await layerIds();
        const frame = await page.eval<{ width: number; height: number }>(
          `(() => { const [w, h] = (document.getElementById('preview-frame').style.aspectRatio || '1920 / 1080').split('/').map(Number); return { width: w, height: h }; })()`,
        );
        await rightClick(frame.width * 0.8, frame.height * 0.8);
        await choose('Add Asset Here');
        await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu.submenu')`), 'the asset submenu');
        const picked = await page.eval<boolean>(
          `(() => { const b = [...document.querySelectorAll('.context-menu.submenu > button[data-command="layer.addVideo"]')].find((x) => x.textContent === 'noisy');
            if (!b) return false; b.click(); return true; })()`,
        );
        expect(picked, 'the submenu offers the clip with sound').toBe(true);
        await until(async () => (await layerIds()).length === before.length + 1, 'the clip layer');
        const layer = (await layerIds()).find((id) => !before.includes(id))!;
        await addedLayerReady(layer);
        const card = `document.querySelector('#params .param-card[data-layer="${layer}"]')`;

        // The card offers the sound's own two controls, and the preview holds a sound for the layer.
        await until(() => page.eval<boolean>(`!!${card}.querySelector('input[aria-label$="volume"]')`), 'the volume control', 30_000);
        expect(await page.eval<boolean>(`!!${card}.querySelector('input[aria-label$="muted"]')`)).toBe(true);
        const hook = `(window.pulpLayerSounds ? window.pulpLayerSounds() : [])`;
        await until(() => page.eval<number>(`${hook}.length`).then((n) => n >= 1), 'a sound held to the layer', 30_000);
        // Paused is silent: a held frame makes no sound.
        expect(await page.eval<boolean>(`${hook}.every((s) => !s.playing)`)).toBe(true);

        // Half volume reaches the element under the transport's own volume.
        await page.eval(`(() => { const v = ${card}.querySelector('input[aria-label$="volume"]'); v.value = '50'; v.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<number>(`${hook}[0] ? ${hook}[0].volume : -1`).then((v) => Math.abs(v - 0.5) < 0.01), 'the layer volume on the element');

        // Muted asks for no sound at all, so the element goes; unmuting brings it back.
        await page.eval(`(() => { const m = ${card}.querySelector('input[aria-label$="muted"]'); m.checked = true; m.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<number>(`${hook}.length`).then((n) => n === 0), 'muted means nothing to hear');
        await page.eval(`(() => { const m = ${card}.querySelector('input[aria-label$="muted"]'); m.checked = false; m.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<number>(`${hook}.length`).then((n) => n === 1), 'and back when unmuted');

        // A clip the library knows has no audio stream says so, with no dead controls beside it.
        await page.eval(`${card}.querySelector('.picker-toggle').click()`);
        await until(() => page.eval<boolean>(`!${card}.querySelector('.image-picker').hidden`), 'the clip chooser');
        await until(
          () => page.eval<boolean>(
            `(() => { const b = [...${card}.querySelectorAll('.image-picker .image-choice')].find((x) => (x.textContent || '').startsWith('clip'));
              if (!b) return false; b.click(); return true; })()`,
          ),
          'the silent clip chosen from the chooser',
        );
        await until(() => page.eval<boolean>(`!!${card}.querySelector('.clip-no-sound')`), 'the silent clip said plainly', 30_000);
        expect(await page.eval<string>(`${card}.querySelector('.clip-no-sound').textContent`)).toBe('This clip has no sound.');
        expect(await page.eval<boolean>(`!!${card}.querySelector('input[aria-label$="volume"]')`), 'no dead control beside it').toBe(false);
        await until(() => page.eval<number>(`${hook}.length`).then((n) => n === 0), 'and nothing to hear');
      }, 120_000);

      it('offers the stage\'s own background, theater and collection over bare picture', async () => {
        await rightClick(40, 40);
        expect(await labels()).toEqual(['Add Text Here', 'Add Shape Here', 'Add Asset Here', 'Paste', 'Add to Collection', 'Background', 'Theater']);

        // Gray is the new fourth choice, and choosing it really paints the stage.
        await choose('Background');
        await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu.submenu')`), 'the Background submenu');
        expect(await page.eval<string[]>(`[...document.querySelectorAll('.context-menu.submenu > button')].map((b) => b.textContent)`))
          .toEqual(['Checkerboard', 'Black', 'White', 'Gray']);
        await choose('Gray');
        await until(
          () => page.eval<boolean>(`document.getElementById('preview-frame').style.backgroundColor === 'rgb(128, 128, 128)'`),
          'the stage painted gray',
        );
        expect(await page.eval<string>(`document.getElementById('bg-gray').getAttribute('aria-pressed')`)).toBe('true');
        // Re-opened, the menu ticks the one that is on and only that one.
        await rightClick(40, 40);
        await choose('Background');
        await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu.submenu')`), 'the submenu again');
        expect(await page.eval<string[]>(`[...document.querySelectorAll('.context-menu.submenu > button[aria-checked="true"]')].map((b) => b.textContent)`))
          .toEqual(['Gray']);
        await choose('Checkerboard');
        await until(() => page.eval<boolean>(`document.getElementById('bg-checker').getAttribute('aria-pressed') === 'true'`), 'the checkerboard back');

        // Theater toggles the window the way its own button does, and the menu says which it is.
        await rightClick(40, 40);
        expect(await page.eval<string>(`[...document.querySelectorAll('.context-menu > button')].find((b) => b.textContent === 'Theater').getAttribute('aria-checked')`)).toBe('false');
        // Theater, the one item here that can be ticked, starts its label where every other item does.
        const starts = await page.eval<Record<string, number>>(`Object.fromEntries([...document.querySelectorAll('.context-menu:not(.submenu) > button')].map((b) => [b.textContent, Math.round(b.querySelector('.item-label, .item-lines').getBoundingClientRect().left - b.getBoundingClientRect().left)]))`);
        expect(new Set(Object.values(starts)).size, `the labels' starts ${JSON.stringify(starts)}`).toBe(1);
        await choose('Theater');
        await until(() => page.eval<boolean>(`document.getElementById('theater').getAttribute('aria-pressed') === 'true'`), 'theater on');
        await rightClick(40, 40);
        expect(await page.eval<string>(`[...document.querySelectorAll('.context-menu > button')].find((b) => b.textContent === 'Theater').getAttribute('aria-checked')`)).toBe('true');
        await choose('Theater');
        await until(() => page.eval<boolean>(`document.getElementById('theater').getAttribute('aria-pressed') === 'false'`), 'theater off again');
      }, 120_000);

      it('opens from the keyboard on the selected layer, with Shift+F10 and the Menu key', async () => {
        // The overlay takes the keyboard when a layer is chosen on the stage, which is how it
        // hears the key at all; a synthetic event alone would not move focus there.
        const overlayKey = async (key: string, shift: boolean) =>
          page.eval(`(() => { const o = document.getElementById('layer-overlay'); o.focus();
            o.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, shiftKey: ${shift}, bubbles: true, cancelable: true })); })()`);

        // With a layer selected, the menu is that layer's, wherever the pointer happens to be.
        await rightClickLayer('subtitle');
        await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await until(async () => !(await open()), 'the menu closed again');
        await overlayKey('F10', true);
        await until(open, 'the menu from Shift+F10');
        expect(await labels()).toContain('Duplicate');
        expect(await labels()).not.toContain('Theater');
        await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await until(async () => !(await open()), 'closed');

        // The dedicated Menu key does the same.
        await overlayKey('ContextMenu', false);
        await until(open, 'the menu from the Menu key');
        expect(await labels()).toContain('Duplicate');
        // The first item takes the keyboard, so the menu can be walked without a pointer.
        expect(await page.eval<boolean>(`document.activeElement.closest('.context-menu') !== null`)).toBe(true);
        await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await until(async () => !(await open()), 'closed again');
        // And the keyboard goes back to the stage, so the arrows still nudge the layer.
        expect(await page.eval<string>(`document.activeElement.id`)).toBe('layer-overlay');

        // With nothing selected it is the bare-picture menu, at the middle of the picture.
        await page.eval(`document.getElementById('layer-overlay').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await until(() => page.eval<boolean>(`!document.querySelector('#params .param-card.stage-selected')`), 'nothing selected');
        await overlayKey('F10', true);
        await until(open, 'the bare-picture menu from the keyboard');
        expect(await labels()).toEqual(['Add Text Here', 'Add Shape Here', 'Add Asset Here', 'Paste', 'Add to Collection', 'Background', 'Theater']);
      }, 120_000);

      it('adds a line of text where the pointer was, and it lands there', async () => {
        const before = await layerIds();
        // A quarter across and a third down: nowhere the stack would ever put a new line by itself.
        const frame = await page.eval<{ width: number; height: number }>(
          `(() => { const [w, h] = (document.getElementById('preview-frame').style.aspectRatio || '1920 / 1080').split('/').map(Number); return { width: w, height: h }; })()`,
        );
        await rightClick(frame.width * 0.25, frame.height * 0.33);
        await choose('Add Text Here');
        await until(async () => (await layerIds()).length === before.length + 1, 'the line added');
        const added = (await layerIds()).find((id) => !before.includes(id))!;
        // It arrives with words in it, so there is something on the stage to take hold of.
        expect(await page.eval<string>(`document.querySelector('#params .param-card[data-layer="${added}"] .layer-text').value`)).toBe('Text');
        // The Parameters tab comes forward on the new layer, ready to be typed over.
        expect(await page.eval<boolean>(`document.getElementById('app').classList.contains('inspector-open')`)).toBe(true);
        await until(async () => {
          const centre = await inkCentre(added).catch(() => null);
          return centre !== null && Math.abs(centre.x - frame.width * 0.25) < frame.width * 0.08 && Math.abs(centre.y - frame.height * 0.33) < frame.height * 0.08;
        }, 'the line sitting where it was asked for');
      }, 120_000);
    });
  });

  describe('length (milestone 30)', () => {
    const lengthField = `document.querySelector('#params .length-field input[aria-label="Length, seconds"]')`;

    it('offers a length only for a template that says what may stretch, and the preview follows it', async () => {
      // A countdown counts real seconds and so declares no structure: there is nothing to ask.
      await clickResult('Launch Countdown');
      await until(() => page.eval<boolean>(`!!document.querySelector('#params .param-card')`), 'the parameter form');
      expect(await page.eval<boolean>(`!!${lengthField}`), 'no Length where nothing may stretch').toBe(false);

      // The fixture does: two seconds, half a second of entrance and half a second of exit.
      await clickResult('Test Structure');
      await until(() => page.eval<boolean>(`!!${lengthField}`), 'the Length field');
      expect(await page.eval<string>(`${lengthField}.value`)).toBe('2');
      // Its floor is the entrance plus the exit plus the least hold, not zero.
      expect(Number(await page.eval<string>(`${lengthField}.min`))).toBeCloseTo(1.05, 2);
      // The card says what stretches and what does not.
      expect(await page.eval<string>(`document.querySelector('#params .length-field .note').textContent`))
        .toContain('Only the hold stretches');

      // Sixty frames at its own length.
      await until(() => page.eval<string>(`document.getElementById('scrub').max`).then((m) => m === '59'), 'the scrub bar at its own length');

      // Ask for ten seconds: the preview is 300 frames and the transport follows at once.
      await page.eval(`(() => { const f = ${lengthField}; f.value = '10'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(() => page.eval<string>(`document.getElementById('scrub').max`).then((m) => m === '299'), 'the scrub bar at ten seconds');
      await until(() => page.eval<string>(`document.getElementById('timecode').textContent`).then((t) => t.includes('/300')), 'the timecode counting the new length');

      // The frame drawn at the middle is the middle of the template's hold, not of its own
      // timeline: the fixture paints its time in, so the preview can be read back.
      const drawnTime = async () => {
        const px = await previewPixel(10, 10, 'pulp.test.structure');
        return (px[0]! * 256 + px[1]!) / 1000;
      };
      await scrubTo(150);
      await until(async () => Math.abs((await drawnTime()) - 1) < 0.05, 'the middle of ten seconds showing the middle of the hold');
      // The entrance keeps its designed speed: frame 15 is half a second in, as it was before.
      await scrubTo(15);
      await until(async () => Math.abs((await drawnTime()) - 0.5) < 0.05, 'the entrance at its designed speed');

      // The scrub bar shades the parts: a tenth of ten seconds is the entrance, a tenth the exit.
      const parts = () => page.eval<Record<string, number>>(`(() => {
        const read = (id) => { const el = document.getElementById(id); const r = el.getBoundingClientRect(); const bar = document.getElementById('scrub').getBoundingClientRect(); return { left: (r.left - bar.left) / bar.width, width: r.width / bar.width, hidden: el.hidden }; };
        return { entrance: read('part-entrance'), hold: read('part-hold'), exit: read('part-exit') };
      })()`);
      const shaded = await parts() as unknown as Record<string, { left: number; width: number; hidden: boolean }>;
      expect(shaded.entrance!.hidden).toBe(false);
      expect(shaded.entrance!.width).toBeCloseTo(0.05, 1);
      expect(shaded.hold!.width).toBeCloseTo(0.9, 1);
      expect(shaded.exit!.width).toBeCloseTo(0.05, 1);
      // They sit end to end across the whole bar.
      expect(shaded.hold!.left).toBeCloseTo(shaded.entrance!.width, 1);
      expect(shaded.exit!.left + shaded.exit!.width).toBeCloseTo(1, 1);

      // The Output tab says the length too, since that is where a render is set up.
      await openTab('output');
      await until(() => page.eval<string>(`document.getElementById('options-note').textContent`).then((t) => t.includes('10 s long')), 'the Output tab naming the length');
      expect(await page.eval<string>(`document.getElementById('options-note').textContent`)).toContain('designed at 2 s');
      await openTab('parameters');

      // The handle on the scrub bar sets it by hand: a slider, so the arrows move it.
      const handle = `document.getElementById('length-handle')`;
      expect(await page.eval<boolean>(`${handle}.hidden`)).toBe(false);
      expect(await page.eval<string>(`${handle}.getAttribute('aria-valuenow')`)).toBe('10');
      await page.eval(`(() => { ${handle}.focus(); ${handle}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })); })()`);
      await until(() => page.eval<string>(`${handle}.getAttribute('aria-valuenow')`).then((v) => v === '11'), 'a bold arrow step lengthening the graphic');
      expect(await page.eval<string>(`${lengthField}.value`), 'and the field follows it').toBe('11');
      // It cannot be dragged shorter than the entrance and the exit need.
      for (let i = 0; i < 200; i++) {
        await page.eval(`${handle}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true }))`);
      }
      expect(Number(await page.eval<string>(`${handle}.getAttribute('aria-valuenow')`))).toBeCloseTo(1.05, 2);

      // Back to the template's own length, and the transport goes with it.
      await page.eval(`(() => { const f = ${lengthField}; f.value = '2'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(() => page.eval<string>(`document.getElementById('scrub').max`).then((m) => m === '59'), 'the scrub bar back at its own length');
      expect(await page.eval<string>(`${lengthField}.value`)).toBe('2');
      // At its own length there is nothing to reset to, so the button goes.
      expect(await page.eval<boolean>(`!!document.querySelector('#params .length-field .field-reset')`)).toBe(false);
    }, 120_000);

    it('steps a frame sequence on the stage, at a rate that can be changed (milestone 30)', async () => {
      // The fixture frames are made with ffmpeg, so without it there is no sequence to step.
      if (!haveVideo) return;
      await clickResult('walk');
      // Twelve frames at ten a second: the transport counts them rather than sitting on frame one.
      await until(() => page.eval<string>(`document.getElementById('scrub').max`).then((m) => m === '11'), 'the scrub bar over the sequence');
      expect(await page.eval<boolean>(`document.getElementById('scrub').disabled`)).toBe(false);
      expect(await page.eval<boolean>(`document.getElementById('play').disabled`)).toBe(false);
      // Each frame is its own file, asked for by index.
      const src = () => page.eval<string>(`document.getElementById('media-image').getAttribute('src')`);
      expect(await src()).toMatch(/^pulp-media:\/\/[0-9a-f]{24}\/0$/);
      await page.eval(`(() => { const sc = document.getElementById('scrub'); sc.value = '7'; sc.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await until(async () => (await src()).endsWith('/7'), 'the seventh frame after a scrub');

      // Pulp states a rate because the files record none, and it can be changed for this item.
      const rate = `document.getElementById('sequence-fps')`;
      expect(await page.eval<boolean>(`document.getElementById('sequence-rate').hidden`)).toBe(false);
      expect(await page.eval<string>(`${rate}.value`)).toBe('30');
      await page.eval(`(() => { const f = ${rate}; f.value = '12'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(() => page.eval<string>(`${rate}.value`).then((v) => v === '12'), 'the rate it is read at');
      // It is the item's own, so it survives looking at something else and coming back.
      await clickResult('Title Card');
      await until(() => page.eval<boolean>(`document.getElementById('sequence-rate').hidden`), 'the rate control gone with the sequence');
      await clickResult('walk');
      await until(() => page.eval<string>(`${rate}.value`).then((v) => v === '12'), 'the rate remembered for this sequence');
      // And Reset puts the stated rate back.
      await page.eval(`document.getElementById('sequence-fps-reset').click()`);
      await until(() => page.eval<string>(`${rate}.value`).then((v) => v === '30'), 'the stated rate again');
    }, 120_000);
  });

  describe('saved presets and batch', () => {
    const nameValue = () => page.eval<string>(`document.querySelector('.layer-row[data-layer=name] .layer-text').value`);
    const options = () => page.eval<string[]>(`[...document.getElementById('param-preset-list').options].map((o) => o.value).filter(Boolean)`);

    it('saves the values that differ from the defaults, applies them undoably, asks before replacing, deletes', async () => {
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`document.querySelector('.layer-row[data-layer=name] .layer-text') !== null`), 'the lower third form');
      // Start from defaults, change the name, save as "Show A".
      await page.eval(`document.getElementById('reset-all').disabled || document.getElementById('reset-all').click()`);
      await page.eval(`(() => { const i = document.querySelector('.layer-row[data-layer=name] .layer-text'); i.value = 'Show A Name'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`(() => { const n = document.getElementById('param-preset-name'); n.value = 'Show A'; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await page.eval(`document.getElementById('param-preset-save').click()`);
      await until(async () => (await options()).includes('Show A'), 'the preset to appear');
      // The file holds only what changed: the layer stack, since the name is a layer, and no parameter.
      const file = JSON.parse(await readFile(join(userData, 'presets', 'pulp.samples.lower-third-bar.json'), 'utf8')) as { presets: Record<string, Record<string, { strap: { id: string; text: string }[] }>> };
      expect(Object.keys(file.presets['Show A']!)).toEqual(['@layers']);
      expect(file.presets['Show A']!['@layers']!.strap.map((l) => [l.id, l.text])).toEqual([['name', 'Show A Name'], ['title', 'Director of Photography']]);

      // Change the name again, then apply the preset: it comes back, and undo takes it away.
      await page.eval(`(() => { const i = document.querySelector('.layer-row[data-layer=name] .layer-text'); i.value = 'Other'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`(() => { const s = document.getElementById('param-preset-list'); s.value = 'Show A'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      expect(await nameValue()).toBe('Show A Name');
      await page.eval(`document.getElementById('undo').click()`);
      expect(await nameValue()).toBe('Other');

      // Saving under the same name asks first; Replace stores the new values.
      await page.eval(`(() => { const n = document.getElementById('param-preset-name'); n.value = 'Show A'; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await page.eval(`document.getElementById('param-preset-save').click()`);
      expect(await page.eval<boolean>(`!document.getElementById('param-preset-confirm').hidden`)).toBe(true);
      expect(await page.eval<string>(`document.getElementById('param-preset-confirm-text').textContent`)).toContain('Replace the preset "Show A"');
      await page.eval(`document.getElementById('param-preset-replace').click()`);
      await until(async () => {
        try {
          const f = JSON.parse(await readFile(join(userData, 'presets', 'pulp.samples.lower-third-bar.json'), 'utf8')) as { presets: Record<string, Record<string, unknown>> };
          return (f.presets['Show A']?.['@layers'] as { strap?: { text: string }[] } | undefined)?.strap?.[0]?.text === 'Other';
        } catch {
          return false;
        }
      }, 'the replaced preset to be written');
      expect(await page.eval<boolean>(`document.getElementById('param-preset-confirm').hidden`)).toBe(true);

      // Delete.
      await page.eval(`(() => { const s = document.getElementById('param-preset-list'); s.value = 'Show A'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`document.getElementById('param-preset-delete').click()`);
      await until(async () => !(await options()).includes('Show A'), 'the preset to be deleted');
      await page.eval(`document.getElementById('reset-all').click()`);
    }, 90_000);

    it('previews a CSV batch with its columns, names and unknown-column warning before anything is queued', async () => {
      await page.eval(`(() => { const t = document.getElementById('batch-csv'); t.value = 'file,Name,TITLE,Mood\\nAlex,Alex Rivera,Director of Photography,calm\\nSam,Sam Lee,Editor,bright'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await page.eval(`document.getElementById('batch-preview').click()`);
      const summary = await page.eval<string>(`document.getElementById('batch-summary').textContent`);
      expect(summary).toContain('2 rows');
      expect(summary).toContain('Name → name');
      expect(summary).toContain('TITLE → title');
      expect(summary).toContain('names from "file"');
      expect(summary).toContain('Files: Alex, Sam');
      expect(await page.eval<string>(`document.querySelector('#batch-summary .warning').textContent`)).toBe('Unknown column ignored: Mood.');
      expect(await page.eval<string>(`document.getElementById('batch-queue').textContent`)).toBe('Queue 2 renders');
      expect(await page.eval<boolean>(`document.getElementById('batch-queue').disabled`)).toBe(false);
      // Nothing was queued by previewing.
      expect(await page.eval<number>(`document.querySelectorAll('#queue li:not(.empty)').length`)).toBe(0);
    }, 60_000);
  });

  describe('render and drag', () => {
    it('renders a media item itself into a draggable card, with a matte beside it (milestone 15)', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available; media render check skipped.');
        return;
      }
      // A still, held for a moment: the Output tab shows the media fields, the template ones put away.
      await clickResult('tiny');
      await until(() => page.eval<boolean>(`!document.getElementById('media-options').hidden`), 'the media options');
      expect(await page.eval<boolean>(`document.getElementById('batch').hidden`)).toBe(true);
      expect(await page.eval<boolean>(`document.getElementById('opt-speed-field').hidden`), 'a still has no speed').toBe(true);
      expect(await page.eval<boolean>(`document.getElementById('render').disabled`)).toBe(false);
      await page.eval(`(() => { const s = document.getElementById('preset'); s.value = 'png-sequence'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`(() => { const l = document.getElementById('opt-length'); l.value = '0.1'; l.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await page.eval(`(() => { const m = document.getElementById('opt-matte'); m.checked = true; m.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(() => page.eval<boolean>(`document.getElementById('options-note').textContent.includes('3 frames at 30 fps')`), 'the note on the still');
      expect(await page.eval<string>(`document.getElementById('options-note').textContent`)).toContain('with a matte file');

      await page.eval(`document.getElementById('drag-prepare').click()`);
      await until(() => page.eval<boolean>(`!!document.querySelector('#queue .job-card[draggable="true"]')`), 'a draggable card for the still', 60_000);
      const card = `document.querySelector('#queue .job-card[draggable="true"]')`;
      const file = await page.eval<string>(`${card}.dataset.file`);
      expect(file.split(/[\\/]/).pop()).toBe('tiny_00000.png');
      expect(existsSync(file)).toBe(true);
      // The matte is a sequence of its own beside it, gray.
      expect(existsSync(file.replace('tiny_00000.png', 'tiny-matte_00000.png'))).toBe(true);
      expect(await page.eval<string>(`${card}.querySelector('.job-name').textContent`)).toBe('tiny');
      expect(await page.eval<string>(`${card}.querySelector('.job-status').textContent`)).toBe('Done · 3 frames');

      // A clip looped past its length with a crossfade: two stages, one result, the frames asked for.
      await clickResult('clip');
      await until(() => page.eval<boolean>(`!document.getElementById('opt-speed-field').hidden`), 'a clip has speed');
      await page.eval(`(() => { const s = document.getElementById('preset'); s.value = 'png-sequence'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`(() => { const l = document.getElementById('opt-length'); l.value = '3'; l.dispatchEvent(new Event('input', { bubbles: true })); const c = document.getElementById('opt-crossfade'); c.value = '0.5'; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await page.eval(`(() => { const i = document.getElementById('opt-in'); i.value = '26'; i.dispatchEvent(new Event('input', { bubbles: true })); const o = document.getElementById('opt-out'); o.value = '29'; o.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await until(() => page.eval<boolean>(`document.getElementById('options-note').textContent.includes('loops to 3 s with a 0.5 s crossfade')`), 'the loop in the note');
      await page.eval(`(() => { const m = document.getElementById('opt-matte'); m.checked = false; m.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`document.getElementById('drag-prepare').click()`);
      await until(async () => (await page.eval<number>(`document.querySelectorAll('#queue .job-card[draggable="true"]').length`)) >= 2, 'the looped clip rendered', 90_000);
      const clipCard = `[...document.querySelectorAll('#queue .job-card[draggable="true"]')].find((c) => c.querySelector('.job-name').textContent === 'clip')`;
      const clipFile = await page.eval<string>(`${clipCard}.dataset.file`);
      expect(clipFile.split(/[\\/]/).pop()).toBe('clip_00026.png'); // numbered with the in point, past the clip's own two seconds
      expect(existsSync(clipFile)).toBe(true);
      // The clip has no alpha, and the alpha preset says so with a warning on the card.
      expect(await page.eval<string>(`${clipCard}.querySelector('.job-status').textContent`)).toContain('Done · 4 frames');

      await page.eval(`document.getElementById('cache-clear').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('cache-summary').textContent.includes('0 files')`), 'the cache cleared');
      // The tray is left as it was found: no finished cards for the tests that follow to count.
      await page.eval(`document.getElementById('clear-finished').click()`);
      await until(async () => (await page.eval<number>(`document.querySelectorAll('#queue .job-card').length`)) === 0, 'the finished cards cleared');
    }, 180_000);

    it('prepares a render into a draggable card, reuses the cache, and clears it', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available; render-and-drag check skipped.');
        return;
      }
      await clickResult('Diagonal Wipe');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the diagonal wipe preview');
      // A short range keeps the test quick: three frames of the wipe into the cache.
      await page.eval(`(() => { const i = document.getElementById('opt-in'); i.value = '10'; i.dispatchEvent(new Event('input', { bubbles: true })); const o = document.getElementById('opt-out'); o.value = '12'; o.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await page.eval(`(() => { const s = document.getElementById('preset'); s.value = 'png-sequence'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);

      // Prepare for drag is an action on the item, in the Output tab, not a panel of its own.
      await page.eval(`document.getElementById('drag-prepare').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('drag-status').textContent.includes('Rendering for drag')`), 'the drag render to be queued');
      await until(() => page.eval<boolean>(`!!document.querySelector('#queue .job-card[draggable="true"]')`), 'a draggable card', 60_000);

      const card = `document.querySelector('#queue .job-card[draggable="true"]')`;
      const file = await page.eval<string>(`${card}.dataset.file`);
      expect(file.startsWith(join(userData, 'render-cache'))).toBe(true);
      expect(file.split(/[\\/]/).pop()).toBe('diagonal-wipe_00010.png'); // clean name, no hash; a sequence drags as its first frame, numbered with the in point
      expect(existsSync(file)).toBe(true);

      // The card names the item and badges the preset; the path is in the tooltip, not the text.
      const shown = await page.eval<{ name: string; preset: string; status: string; tip: string; grip: boolean; hint: string }>(
        `(() => { const c = ${card}; return { name: c.querySelector('.job-name').textContent, preset: c.querySelector('.badge.preset').textContent, status: c.querySelector('.job-status').textContent, tip: c.dataset.tip, grip: !!c.querySelector('.grip'), hint: c.querySelector('.drag-hint').textContent }; })()`,
      );
      expect(shown.name).toBe('Diagonal Wipe');
      expect(shown.preset).toBe('PNG sequence (alpha)');
      expect(shown.status).toBe('Done · 3 frames');
      expect(`${shown.name} ${shown.status}`).not.toContain('/');
      expect(shown.tip).toContain(file);
      expect(shown.grip, 'the card carries the grip').toBe(true);
      expect(shown.hint).toBe('Drag to your editor');
      // One drag affordance: the old separate handle is gone.
      expect(await page.eval<boolean>(`!!document.getElementById('drag-handle')`)).toBe(false);

      // Reveal and Copy path reach the file without it being on the card, and work by keyboard.
      expect(await page.eval<boolean>(`window.pulp.copyFilePath(${JSON.stringify(file)})`)).toBe(true);
      expect(await page.eval<boolean>(`window.pulp.copyFilePath(${JSON.stringify(join(userData, 'not-ours', 'outside.txt'))})`)).toBe(false);
      await page.eval(`${card}.focus()`);
      expect(await page.eval<boolean>(`document.activeElement === ${card}`)).toBe(true);

      // Three frames plus the template's own swoosh beside them (milestone 16): a sequence has no
      // room for an audio stream, so the mix rides into the cache as the WAV it always writes.
      await until(() => page.eval<boolean>(`document.getElementById('cache-summary').textContent.includes('4 files')`), 'the cache summary');

      // Preparing again with the same inputs reuses the cache, and still leaves a card to drag.
      await page.eval(`document.getElementById('drag-prepare').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('drag-status').textContent === 'Ready to drag, in the tray.'`), 'the cache hit');
      // The card arrives with the next queue broadcast, a tick after the call returns.
      await until(async () => (await page.eval<number>(`document.querySelectorAll('#queue .job-card[draggable="true"]').length`)) >= 2, 'a second draggable card');

      // A drag of something outside the cache and not a finished output is refused.
      expect(await page.eval<boolean>(`window.pulp.startDrag(${JSON.stringify(join(userData, 'not-ours', 'outside.txt'))})`)).toBe(false);

      // Remove takes one card off the tray.
      const before = await page.eval<number>(`document.querySelectorAll('#queue .job-card').length`);
      await page.eval(`${card}.querySelector('.job-actions button:last-child').click()`);
      await until(async () => (await page.eval<number>(`document.querySelectorAll('#queue .job-card').length`)) === before - 1, 'the card to go');

      await page.eval(`document.getElementById('cache-clear').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('cache-summary').textContent.includes('0 files')`), 'the cache to be cleared');
      expect(existsSync(file)).toBe(false);
      // Reset the options for later tests.
      await page.eval(`(() => { for (const id of ['opt-in', 'opt-out']) { const i = document.getElementById(id); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); } const s = document.getElementById('preset'); s.value = 'prores-4444'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`document.getElementById('clear-finished').click()`);
    }, 120_000);

    it('keeps the cache limit in settings and shows it', async () => {
      await page.eval(`(() => { const l = document.getElementById('cache-limit'); l.value = '512'; l.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(() => page.eval<boolean>(`document.getElementById('cache-summary').textContent.includes('of 512 MB')`), 'the new limit in the summary');
      await until(async () => {
        try {
          return (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { renderCacheMaxMB?: number }).renderCacheMaxMB === 512;
        } catch {
          return false;
        }
      }, 'the limit in settings.json');
      // Below the floor falls back to the default.
      await page.eval(`(() => { const l = document.getElementById('cache-limit'); l.value = '5'; l.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(() => page.eval<boolean>(`document.getElementById('cache-limit').value === '2048'`), 'the default limit to be restored');
    }, 60_000);
  });

  describe('collections', () => {
    const card = (n = 0) => `document.querySelectorAll('#collection .collection-card')[${n}]`;
    const names = () => page.eval<string[]>(`[...document.querySelectorAll('#collection .collection-card .job-name')].map((n) => n.textContent)`);

    it('gathers items, reorders them, edits one through the Output tab and applies that to all', async () => {
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('add-to-collection').disabled`), 'the add button');
      await page.eval(`document.getElementById('add-to-collection').click()`);
      await clickResult('Title Card');
      await until(() => page.eval<boolean>(`document.querySelector('#params .layers-block[data-block=card]') !== null`), 'the title card form');
      await page.eval(`document.getElementById('add-to-collection').click()`);
      await until(async () => (await names()).length === 2, 'two collected items');
      expect(await names()).toEqual(['Lower Third Bar', 'Title Card']);
      // The tray says what it holds.
      expect(await page.eval<string>(`document.getElementById('tray-summary').textContent`)).toContain('2 items');

      // A library card can also be dragged into the tray.
      await scrollToResult('Diagonal Wipe');
      await page.eval(
        `(() => { const li = [...document.querySelectorAll('#results li')].find((l) => l.querySelector('.name')?.textContent === 'Diagonal Wipe');
          const data = new DataTransfer();
          li.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
          document.getElementById('region-tray').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })); })()`,
      );
      await until(async () => (await names()).includes('Diagonal Wipe'), 'the dragged item in the collection');
      await page.eval(`[...document.querySelectorAll('#collection .collection-card')].find((c) => c.querySelector('.job-name').textContent === 'Diagonal Wipe').querySelector('.job-actions button').click()`);
      await until(async () => !(await names()).includes('Diagonal Wipe'), 'it removed again');

      // Reorder.
      await page.eval(`${card(1)}.querySelector('[aria-label="Move up"]').click()`);
      await until(async () => (await names())[0] === 'Title Card', 'the reorder');

      // Choosing a card hands it to the Output tab; a change there goes back to the card.
      await page.eval(`${card(0)}.click()`);
      await until(() => page.eval<boolean>(`!document.getElementById('editing-note').hidden`), 'the editing note');
      expect(await page.eval<string>(`document.getElementById('editing-note-text').textContent`)).toContain('Title Card');
      await fire('#preset', 'png-sequence', 'change');
      await until(() => page.eval<boolean>(`${card(0)}.querySelector('.job-status').textContent.startsWith('PNG sequence')`), 'the card to follow the Output tab');
      // The other card keeps its own settings.
      expect(await page.eval<string>(`${card(1)}.querySelector('.job-status').textContent`)).toContain('ProRes 4444');

      // Apply to all hands them round.
      await page.eval(`document.getElementById('collection-apply').click()`);
      await until(() => page.eval<boolean>(`${card(1)}.querySelector('.job-status').textContent.startsWith('PNG sequence')`), 'apply to all');
      await page.eval(`document.getElementById('editing-done').click()`);
      expect(await page.eval<boolean>(`document.getElementById('editing-note').hidden`)).toBe(true);
    }, 90_000);

    it('offers Render all only for what it can render, saves and reopens the file', async () => {
      // Render all itself opens a folder dialog, which cannot be driven here; the render
      // path is covered headlessly in render.e2e.test.ts with --collection.
      expect(await page.eval<boolean>(`document.getElementById('collection-render').disabled`)).toBe(false);
      expect(await page.eval<boolean>(`document.getElementById('collection-save').disabled`)).toBe(false);

      // An empty collection has nothing to render or save.
      await page.eval(`[...document.querySelectorAll('#collection .collection-card .job-actions button')].forEach((b) => b.click())`);
      await until(async () => (await names()).length === 0, 'an empty collection');
      expect(await page.eval<boolean>(`document.getElementById('collection-render').disabled`)).toBe(true);
      expect(await page.eval<boolean>(`document.getElementById('collection-save').disabled`)).toBe(true);
      expect(await page.eval<string>(`document.getElementById('tray-summary').textContent`)).toContain('Nothing collected yet.');

      // A media item renders itself now (milestone 15): its card carries a preset like any other, and Render all takes it.
      await clickResult('tiny');
      await until(() => page.eval<boolean>(`!document.getElementById('add-to-collection').disabled`), 'the add button for a media item');
      await page.eval(`document.getElementById('add-to-collection').click()`);
      await until(async () => (await names()).length === 1, 'the media item');
      // Its status is a preset, whichever the Output tab held, not a note that media cannot render.
      expect(await page.eval<string>(`${card(0)}.querySelector('.job-status').textContent`)).toMatch(/ProRes|PNG sequence|H\.264|WebM|QuickTime|HEVC/);
      expect(await page.eval<boolean>(`document.getElementById('collection-render').disabled`)).toBe(false);
      expect(await page.eval<boolean>(`document.getElementById('collection-save').disabled`)).toBe(false);
      expect(await page.eval<string>(`document.getElementById('tray-summary').textContent`)).toBe('1 item');

      await page.eval(`${card(0)}.querySelector('.job-actions button').click()`);
      await until(async () => (await names()).length === 0, 'an empty collection again');
    }, 90_000);

    it('saves the session as a project, opens one back, and never loses changes quietly (milestone 27)', async () => {
      const projectFile = join(userData, 'Evening News.pulp');
      const label = () => page.eval<string>(`document.getElementById('project-button').querySelector('.label').textContent`);
      const dirty = () => page.eval<boolean>(`document.getElementById('project-button').classList.contains('dirty')`);
      const note = () => page.eval<string>(`document.getElementById('collection-note').textContent`);

      // A session nobody has saved is Untitled, and collecting something is an unsaved change.
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('add-to-collection').disabled`), 'the add button');
      await page.eval(`document.getElementById('add-to-collection').click()`);
      await until(async () => (await names()).length === 1, 'one collected item');
      expect(await label()).toBe('Untitled');
      await until(dirty, 'the unsaved mark once something is collected');

      // Saved: the mark clears, the project takes the file's name, and the file holds the session.
      expect(await page.eval<boolean>(`window.pulpSaveProject(${JSON.stringify(projectFile)})`)).toBe(true);
      await until(async () => (await label()) === 'Evening News', 'the project named after its file');
      expect(await dirty()).toBe(false);
      const written = JSON.parse(await readFile(projectFile, 'utf8')) as { formatVersion: number; items: { name: string; path?: string }[]; libraryFolders: string[] };
      expect(written.formatVersion).toBe(1);
      expect(written.items.map((i) => i.name)).toEqual(['Lower Third Bar']);
      // It records where its items were and which folders it drew from, so a project opened
      // elsewhere can say what it is missing and where to look for it.
      expect(written.items[0]!.path).toBeTruthy();
      expect(written.libraryFolders).toContain(mediaDir);

      // Changed again, then opened back. Opening asks about the unsaved change first — the whole
      // point of the mark — so the question is answered before the file arrives.
      await page.eval(`${card(0)}.querySelector('.job-actions button[aria-label="Remove from the collection"]').click()`);
      await until(async () => (await names()).length === 0, 'the item removed');
      await until(dirty, 'the unsaved mark after removing it');
      // Started, not awaited: the call does not settle until the question below is answered.
      await page.eval(`(() => { window.__opened = window.pulpOpenProject(${JSON.stringify(projectFile)}); return true; })()`);
      await until(() => page.eval<boolean>(`document.getElementById('unsaved-dialog').open`), 'the question before opening another project');
      await page.eval(`document.getElementById('unsaved-discard').click()`);
      expect(await page.eval<boolean>(`window.__opened`)).toBe(true);
      await until(async () => (await names()).length === 1, 'the item back from the file');
      expect(await dirty()).toBe(false);
      expect(await note()).toContain('Opened Evening News.');

      // It is on the recent list, by name, and can be opened from there.
      await page.eval(`document.getElementById('project-button').click()`);
      await until(() => page.eval<number>(`document.querySelectorAll('#project-recent li').length`).then((n) => n >= 1), 'the recent list');
      expect(await page.eval<string[]>(`[...document.querySelectorAll('#project-recent .recent-open')].map((b) => b.textContent)`)).toContain('Evening News');
      await page.eval(`document.getElementById('project-close').click()`);

      // A collection file still opens, as a project holding its items and nothing else.
      const collectionFile = join(userData, 'Old Set.pulpcollection');
      await writeFile(collectionFile, JSON.stringify({ formatVersion: 1, items: [{ uid: 'c1', id: 'deadbeefdeadbeefdeadbeef', kind: 'template', name: 'Gone Away', templateId: 'gone.away', presetId: 'png-sequence', options: {}, params: {} }] }));
      expect(await page.eval<boolean>(`window.pulpOpenProject(${JSON.stringify(collectionFile)})`)).toBe(true);
      await until(async () => (await names()).join() === 'Gone Away', 'the collection opened as a project');
      expect(await note()).toContain('Saving will write a project');
      expect(await label()).toBe('Old Set');

      // An item the library cannot answer for is flagged rather than dropped, and — because the
      // project remembers where it was — offers to be relinked. This one never recorded a path,
      // so there is nothing to relink from and no button, which the card says instead.
      expect(await page.eval<string>(`${card(0)}.querySelector('.job-status').textContent`)).toBe('Not in the library any more');
      expect(await page.eval<boolean>(`!!${card(0)}.querySelector('button[aria-label^="Relink"]')`)).toBe(false);

      // Unsaved changes are asked about before they can be lost: Cancel keeps everything.
      await page.eval(`${card(0)}.querySelector('.job-actions button[aria-label="Remove from the collection"]').click()`);
      await until(dirty, 'something unsaved to be asked about');
      await page.eval(`document.getElementById('project-button').click()`);
      await page.eval(`document.getElementById('project-new').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('unsaved-dialog').open`), 'the unsaved-changes question');
      expect(await page.eval<string>(`document.getElementById('unsaved-text').textContent`)).toContain('"Old Set"');
      await page.eval(`document.getElementById('unsaved-cancel').click()`);
      await until(async () => !(await page.eval<boolean>(`document.getElementById('unsaved-dialog').open`)), 'the question answered');
      expect(await label(), 'canceling leaves the project exactly as it was').toBe('Old Set');
      expect(await dirty()).toBe(true);

      // Discard goes ahead: a new project, empty and clean.
      await page.eval(`document.getElementById('project-button').click()`);
      await page.eval(`document.getElementById('project-new').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('unsaved-dialog').open`), 'the question again');
      await page.eval(`document.getElementById('unsaved-discard').click()`);
      await until(async () => (await label()) === 'Untitled', 'a new project');
      expect(await dirty()).toBe(false);
      expect(await names()).toEqual([]);
    }, 120_000);

    it('relinks media that moved, and everything that moved with it (milestone 27)', async () => {
      // A project off a drive that is not here any more: two items under one folder, recorded by
      // an id this library has never heard of and by where they were.
      const moved = join(userData, 'moved');
      await mkdir(join(moved, 'Assets'), { recursive: true });
      await writeFile(join(moved, 'Assets', 'one.png'), TINY_PNG);
      await writeFile(join(moved, 'Assets', 'two.png'), solidPng([0, 255, 0]));
      const item = (uid: string, name: string, file: string) => ({
        uid, id: `${uid}${'0'.repeat(24 - uid.length)}`, kind: 'media', name,
        path: `/Volumes/Gone/Assets/${file}`, presetId: 'png-sequence', options: {}, params: {},
      });
      const projectFile = join(userData, 'Moved.pulp');
      await writeFile(projectFile, JSON.stringify({
        formatVersion: 1,
        items: [item('m1', 'one', 'one.png'), item('m2', 'two', 'two.png')],
        libraryFolders: ['/Volumes/Gone'],
      }));

      await page.eval(`(() => { window.__opened = window.pulpOpenProject(${JSON.stringify(projectFile)}); return true; })()`);
      // Whatever was open before has unsaved changes or not; answer the question if it is asked.
      await page.eval(`(() => { const d = document.getElementById('unsaved-dialog'); if (d.open) document.getElementById('unsaved-discard').click(); return true; })()`);
      expect(await page.eval<boolean>(`window.__opened`)).toBe(true);
      await until(async () => (await names()).join() === 'one,two', 'the two items from the project');
      // Both are flagged rather than dropped, both offer to be relinked, and the project says
      // which of its folders this computer does not have.
      expect(await page.eval<string>(`${card(0)}.querySelector('.job-status').textContent`)).toBe('Not in the library any more; relink it to where it is now');
      expect(await page.eval<number>(`document.querySelectorAll('#collection button[aria-label^="Relink"]').length`)).toBe(2);
      expect(await page.eval<string>(`document.getElementById('collection-note').textContent`)).toContain('/Volumes/Gone');

      // Found again under another folder: the one chosen is rebound, and the other moved the same
      // way, so a project off a remounted drive is not relinked item by item.
      await page.eval(`window.pulpRelink('m1', ${JSON.stringify(join(moved, 'Assets', 'one.png'))})`);
      await until(() => page.eval<number>(`document.querySelectorAll('#collection button[aria-label^="Relink"]').length`).then((n) => n === 0), 'both items relinked');
      expect(await page.eval<string>(`document.getElementById('collection-note').textContent`)).toContain('and 1 more that moved with it');
      expect(await page.eval<string>(`${card(0)}.querySelector('.job-status').textContent`)).not.toContain('Not in the library');

      // The folder the files were found in is in the library now, and saving records it.
      const after = join(userData, 'Moved Again.pulp');
      expect(await page.eval<boolean>(`window.pulpSaveProject(${JSON.stringify(after)})`)).toBe(true);
      const written = JSON.parse(await readFile(after, 'utf8')) as { items: { path: string }[]; libraryFolders: string[] };
      expect(written.libraryFolders).toContain(moved);
      expect(written.items.map((i) => i.path)).toEqual([join(moved, 'Assets', 'one.png'), join(moved, 'Assets', 'two.png')]);

      await page.eval(`[...document.querySelectorAll('#collection .collection-card .job-actions button[aria-label="Remove from the collection"]')].forEach((b) => b.click())`);
      await until(async () => (await names()).length === 0, 'an empty collection again');
      expect(await page.eval<boolean>(`window.pulpSaveProject(${JSON.stringify(after)})`)).toBe(true);
    }, 120_000);

    it('writes a recovery copy while there are unsaved changes, and clears it when there are none (milestone 27)', async () => {
      const recovery = join(userData, 'recovery.pulp');
      const base = join(userData, 'Recovery Base.pulp');
      const exists = async () => {
        try {
          await readFile(recovery, 'utf8');
          return true;
        } catch {
          return false;
        }
      };
      // From a saved project: nothing unsaved, so nothing to recover.
      expect(await page.eval<boolean>(`window.pulpSaveProject(${JSON.stringify(base)})`)).toBe(true);
      await until(async () => !(await exists()), 'no recovery copy for a saved project');

      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('add-to-collection').disabled`), 'the add button');
      await page.eval(`document.getElementById('add-to-collection').click()`);
      await until(async () => (await names()).length === 1, 'one collected item');
      // Written a moment after the change settles, not on every edit.
      await until(exists, 'the recovery copy', 20_000);
      const saved = JSON.parse(await readFile(recovery, 'utf8')) as { items: { name: string }[]; recoveredFrom: string; savedAt: string };
      expect(saved.items.map((i) => i.name)).toEqual(['Lower Third Bar']);
      // It says which file the changes belong to, and when they were taken.
      expect(saved.recoveredFrom).toBe(base);
      expect(Number.isNaN(Date.parse(saved.savedAt))).toBe(false);

      // Saving leaves nothing to recover.
      expect(await page.eval<boolean>(`window.pulpSaveProject(${JSON.stringify(base)})`)).toBe(true);
      await until(async () => !(await exists()), 'the recovery copy cleared by saving');
      await page.eval(`[...document.querySelectorAll('#collection .collection-card .job-actions button[aria-label="Remove from the collection"]')].forEach((b) => b.click())`);
      await until(async () => (await names()).length === 0, 'an empty collection again');
      expect(await page.eval<boolean>(`window.pulpSaveProject(${JSON.stringify(base)})`)).toBe(true);
    }, 120_000);

    it('keeps the results readable on a short window: the stage yields and the tray is capped', async () => {
      // The tray is open from the tests above. Windows CI runs on a small display, where the tray
      // and the stage's share once left the results list a few pixels tall (docs/platform-notes.md).
      const metrics = () =>
        page.eval<{ inner: number; results: number; stage: number; tray: number; search: number; transport: number; status: number; center: number }>(
          `({ inner: window.innerHeight, results: document.getElementById('results').clientHeight, stage: document.getElementById('region-stage').clientHeight, tray: document.getElementById('region-tray').clientHeight, search: document.getElementById('region-search').clientHeight, transport: document.getElementById('region-transport').getBoundingClientRect().height, status: document.getElementById('region-status').getBoundingClientRect().height, center: document.querySelector('.center').getBoundingClientRect().height })`,
        );
      // The tray must be open for the squeeze, and in the window at all it is only with something
      // in it (milestone 42): collect the shown item, open the tray, and take the item out at the end.
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('add-to-collection').disabled`), 'the add button');
      await page.eval(`document.getElementById('add-to-collection').click()`);
      await until(() => page.eval<boolean>(`!document.getElementById('app').classList.contains('tray-empty')`), 'the tray in the window');
      await page.eval(`(() => { if (document.getElementById('app').classList.contains('tray-collapsed')) document.getElementById('tray-toggle').click(); return true; })()`);
      await until(() => page.eval<boolean>(`!document.getElementById('app').classList.contains('tray-collapsed')`), 'the tray open');
      // Classic scroll bars, on every platform: Linux and Windows draw bars that take layout room
      // (about 12 and 17 px) where macOS overlays them, and the floors once held only where the
      // bars were free (stage 146/141 px on CI, 150 on macOS). Forced here so every platform runs
      // the short window the way the strictest one draws it.
      await page.eval(`(() => { const st = document.createElement('style'); st.id = 'classic-scrollbars';
        st.textContent = '::-webkit-scrollbar{width:17px;height:17px}::-webkit-scrollbar-thumb{background:#666}::-webkit-scrollbar-track{background:#222}';
        document.head.append(st); return true; })()`);
      const own = await metrics();
      try {
        // The narrowest window Pulp allows is last. (The search bar's chips once wrapped to a second
        // line here and took the stage under its floor; the bar lives in the left panel now, milestone 41.)
        for (const [width, height] of [[1024, 697], [1024, 600], [960, 600]] as [number, number][]) {
          await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
          // The floors are polled, not read once: flex settles a few frames after the window does.
          let m = await metrics();
          await until(async () => {
            m = await metrics();
            return m.inner === height && m.results >= 160 && m.stage >= 150 && m.stage + m.results <= height;
          }, `the floors at ${width} × ${height} px (last: ${JSON.stringify(m)})`);
          // And the sweep still reaches the last item at this size.
          const last = (await resultNames()).at(-1)!;
          expect(await sweepTo(last)).toBe(true);
        }
      } finally {
        await page.eval(`(() => { document.getElementById('classic-scrollbars')?.remove(); return true; })()`);
        await page.send('Emulation.clearDeviceMetricsOverride', {});
        await page.eval(`[...document.querySelectorAll('#collection .collection-card button[aria-label="Remove from the collection"]')].forEach((b) => b.click())`);
      }
      await until(async () => (await metrics()).inner === own.inner, `the window back at its own ${own.inner} px`);
    }, 60_000);
  });

  describe('the window shell', () => {
    // Milestone 8's accessibility pass: a group of controls is one tab stop, and the arrows move
    // inside it. The arithmetic has its own unit tests; this is the window really doing it.
    it('moves by the arrows inside the chips, the tabs and the results, with one tab stop each', async () => {
      // The filter chips: seven chips, one tab stop, Left and Right walking them and wrapping.
      const chipStops = () => page.eval<number>(`[...document.querySelectorAll('#filter-chips .chip')].filter((c) => c.tabIndex === 0).length`);
      expect(await chipStops(), 'one tab stop for the row').toBe(1);
      await page.eval(`document.getElementById('chip-templates').focus()`);
      const press = (id: string, key: string) =>
        page.eval(`document.getElementById(${JSON.stringify(id)}).dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);
      await press('chip-templates', 'ArrowRight');
      expect(await page.eval<string>(`document.activeElement.id`)).toBe('chip-video');
      expect(await chipStops(), 'still one tab stop, where the focus is').toBe(1);
      await press('chip-video', 'ArrowLeft');
      await press('chip-templates', 'ArrowLeft');
      expect(await page.eval<string>(`document.activeElement.id`), 'the row wraps at its ends').toBe('chip-favorites');
      await press('chip-favorites', 'Home');
      expect(await page.eval<string>(`document.activeElement.id`)).toBe('chip-templates');
      // Arrowing to a chip does not press it: the filters are untouched.
      expect(await page.eval<string>(`document.getElementById('chip-templates').getAttribute('aria-pressed')`)).toBe('false');

      // The inspector's tabs, the same way; the tab stop is the chosen one.
      await openTab('parameters');
      expect(await page.eval<number>(`[...document.querySelectorAll('#transport-tabs .tab')].filter((t) => t.tabIndex === 0).length`)).toBe(1);
      expect(await page.eval<boolean>(`document.getElementById('tab-parameters').tabIndex === 0`)).toBe(true);
      await page.eval(`document.getElementById('tab-parameters').focus()`);
      await press('tab-parameters', 'ArrowRight');
      expect(await page.eval<string>(`document.activeElement.id`)).toBe('tab-output');

      // The results are a grid, so Down moves a whole row rather than one card along it.
      await page.eval(`document.getElementById('view-grid').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('results').classList.contains('grid')`), 'the grid of cards');
      const names = await resultNames();
      const columns = await page.eval<number>(`Number(getComputedStyle(document.getElementById('results')).getPropertyValue('--cols'))`);
      expect(columns, 'more than one column, or a grid proves nothing').toBeGreaterThan(1);
      await clickResult(names[0]!);
      const shown = () => page.eval<string>(`document.querySelector('#results .card[aria-selected=true] .name').textContent`);
      expect(await shown()).toBe(names[0]);
      await page.eval(`document.getElementById('results').focus()`);
      const arrow = (key: string) => page.eval(`document.getElementById('results').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);
      await arrow('ArrowDown');
      await until(async () => (await shown()) === names[columns], 'a row down, not a card along');
      await arrow('ArrowRight');
      await until(async () => (await shown()) === names[columns + 1], 'one card across');
      await arrow('ArrowUp');
      await until(async () => (await shown()) === names[1], 'a row back up');
      // And the listbox says which option the arrows are on, for a screen reader.
      const active = await page.eval<string>(`document.getElementById('results').getAttribute('aria-activedescendant')`);
      expect(await page.eval<boolean>(`!!document.getElementById(${JSON.stringify(active)})`), 'the active option is in the DOM').toBe(true);
      await arrow('Home');
      await until(async () => (await shown()) === names[0], 'Home goes to the first');
    }, 90_000);

    it('has Pulp\'s own application menu, offering only what can act (milestone 27)', async () => {
      // The menu is built in the main process, so it is read back from there; what it offers is
      // decided by the state the window pushes, which is read off the window's own controls.
      type Item = { label?: string; command?: string; role?: string; accelerator?: string; displayOnly?: boolean; enabled?: boolean; checked?: boolean; submenu?: Item[] };
      const sections = () => page.eval<{ label: string; items: Item[] }[]>(`window.pulp.menuSections()`);
      const item = async (section: string, label: string): Promise<Item> => {
        const found = (await sections()).find((s) => s.label === section)?.items.find((i) => i.label === label);
        if (!found) throw new Error(`no ${section} > ${label}`);
        return found;
      };

      const labels = (await sections()).map((s) => s.label);
      expect(labels).toEqual(expect.arrayContaining(['File', 'Edit', 'View', 'Playback', 'Window', 'Help']));
      // On macOS the app's own menu comes first; elsewhere File does.
      expect(labels[0]).toBe(process.platform === 'darwin' ? 'Pulp' : 'File');

      // Nothing is offered that could not act. The Playback menu waits for a preview, so the
      // stage has to be showing for there to be a timeline at all.
      await page.eval(`(() => { if (document.getElementById('app').classList.contains('stage-collapsed')) document.getElementById('stage-toggle').click(); return true; })()`);
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('render').disabled`), 'a template that can be rendered');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview ready to play');
      await until(async () => (await item('File', 'Render…')).enabled === true, 'Render offered once a template can be');
      await until(async () => (await item('Playback', 'Play')).enabled === true, 'Playback offered once there is a timeline');
      // A menu item and the button for the same thing are never enabled differently: that is what
      // reading the state off the window's own controls buys.
      const pairs: [string, string, string][] = [
        ['File', 'Render…', 'render'], ['File', 'Render All', 'collection-render'], ['File', 'Export as Pack…', 'export-pack'],
        ['Edit', 'Undo', 'undo'], ['Edit', 'Redo', 'redo'], ['Playback', 'Play', 'play'],
      ];
      for (const [section, label, id] of pairs) {
        const button = await page.eval<boolean>(`document.getElementById(${JSON.stringify(id)}).disabled`);
        expect((await item(section, label)).enabled, `${section} > ${label} against #${id}`).toBe(!button);
      }

      // A menu item does what its button does: New Project through the menu empties the session,
      // after asking about the change collecting something made.
      const collected = () => page.eval<number>(`document.querySelectorAll('#collection .collection-card').length`);
      await page.eval(`document.getElementById('add-to-collection').click()`);
      await until(async () => (await collected()) === 1, 'something collected');
      await until(async () => (await item('File', 'Render All')).enabled === true, 'Render All offered once there is something to render');
      await page.eval(`window.pulpMenuCommand('project.new')`);
      await until(() => page.eval<boolean>(`document.getElementById('unsaved-dialog').open`), 'the unsaved question from the menu');
      await page.eval(`document.getElementById('unsaved-discard').click()`);
      await until(async () => (await collected()) === 0, 'a new project from the menu');
      await until(async () => (await item('File', 'Render All')).enabled === false, 'and Render All dim again');

      // A region toggle, and the menu ticks the region as it now is.
      const collapsed = () => page.eval<boolean>(`document.getElementById('app').classList.contains('tray-collapsed')`);
      const before = await collapsed();
      expect((await item('View', 'Collection Tray')).checked).toBe(!before);
      await page.eval(`window.pulpMenuCommand('view.tray')`);
      await until(async () => (await collapsed()) !== before, 'the tray toggled from the menu');
      await until(async () => (await item('View', 'Collection Tray')).checked === before, 'and the tick followed it');
      await page.eval(`window.pulpMenuCommand('view.tray')`);
      await until(async () => (await collapsed()) === before, 'and back');

      // Search (Cmd/Ctrl+F) puts the caret in the Search field, in the left panel (milestone 41) — and
      // unfolds the panel first when it is on its rail, since the field lives in it.
      await page.eval(`window.pulpMenuCommand('search.focus')`);
      expect(await page.eval<boolean>(`document.activeElement === document.getElementById('search')`)).toBe(true);
      await page.eval(`document.activeElement.blur()`);
      await page.eval(`document.getElementById('browse-toggle').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('app').classList.contains('browse-collapsed')`), 'the panel on its rail');
      expect(await page.eval<boolean>(`getComputedStyle(document.getElementById('rail-search')).display !== 'none'`), 'the search icon on the rail').toBe(true);
      await page.eval(`window.pulpMenuCommand('search.focus')`);
      await until(() => page.eval<boolean>(`!document.getElementById('app').classList.contains('browse-collapsed')`), 'the panel unfolded by Search');
      expect(await page.eval<boolean>(`document.activeElement === document.getElementById('search')`)).toBe(true);
      await page.eval(`document.activeElement.blur()`);
      // Filter Categories opens the funnel's field over the tree.
      await page.eval(`window.pulpMenuCommand('browse.filter')`);
      await until(() => page.eval<boolean>(`!document.getElementById('browse-find').hidden`), 'the category filter open');
      expect(await page.eval<boolean>(`document.activeElement === document.querySelector('#browse-find input')`)).toBe(true);
      await page.eval(`document.getElementById('browse-filter-toggle').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('browse-find').hidden`), 'and closed again');

      // A few keys belong to the window rather than to the menu, and are shown without being
      // registered: inside a text field the field's own undo has to win, and a bare T would stop
      // anyone typing one. Everything the menu really registers is a modified or function key.
      const undo = await item('Edit', 'Undo');
      expect(undo.accelerator).toBe('CmdOrCtrl+Z');
      expect(undo.displayOnly).toBe(true);
      const shown: string[] = [];
      for (const section of await sections()) {
        for (const i of section.items) {
          if (!i.accelerator) continue;
          if (i.displayOnly) {
            shown.push(i.label ?? i.role ?? '?');
            continue;
          }
          expect(i.accelerator, `${section.label} > ${i.label ?? i.role}`).toMatch(/^(CmdOrCtrl|Alt|Shift|F\d)/);
        }
      }
      expect(shown, 'the keys the window owns, not the menu').toEqual(['Undo', 'Redo', 'Theater']);

      // Help > Keyboard Shortcuts lists the menu's own keys, so the list cannot drift from them.
      await page.eval(`window.pulpMenuCommand('help.shortcuts')`);
      await until(() => page.eval<boolean>(`document.getElementById('shortcuts-dialog').open`), 'the shortcut list');
      const rows = await page.eval<string[]>(`[...document.querySelectorAll('#shortcuts-list dt')].map((d) => d.textContent)`);
      expect(rows).toContain('New Project');
      expect(rows).toContain('Play or pause');
      expect(await page.eval<number>(`document.querySelectorAll('#shortcuts-list dd').length`)).toBe(rows.length);
      await page.eval(`document.getElementById('shortcuts-close').click()`);

      // Help > Copy Diagnostics says what Pulp knows about itself, on the clipboard. It presses the
      // status item, which is where it says it copied (milestone 8) — the shortcut dialog's own line
      // said it where nobody could see it unless that dialog happened to be open.
      await page.eval(`window.pulpMenuCommand('help.diagnostics')`);
      await until(() => page.eval<string>(`document.querySelector('#status-diagnostics .label').textContent`).then((t) => t === 'Diagnostics copied'), 'the diagnostics confirmation');
      // The Performance section's facts (milestone 58): the main process measures the library and
      // its processes when asked, and the window has recorded what the index cost it to take in.
      const perf = await page.eval<{ library: { templates: number; media: number }; indexMs: number; indexBytes: number; memory: { processes: unknown[]; mainHeapMB: number }; uptimeSeconds: number }>(`window.pulp.appPerformance()`);
      expect(perf.library.templates).toBeGreaterThan(0);
      expect(perf.indexMs).toBeGreaterThanOrEqual(0);
      expect(perf.indexBytes).toBeGreaterThan(1000);
      expect(perf.memory.processes.length).toBeGreaterThan(0);
      expect(perf.memory.mainHeapMB).toBeGreaterThan(0);
      const recorded = await page.eval<{ receiveMs: { count: number } | null; windowMs: { count: number } | null }>(`window.pulpWindowPerformance()`);
      expect(recorded.receiveMs?.count ?? 0, 'the index landed at least once').toBeGreaterThanOrEqual(1);
      expect(recorded.windowMs?.count ?? 0, 'the results drew at least once').toBeGreaterThanOrEqual(1);

      // Settings… (milestone 8): where the platform puts it, and every control reading the very
      // setting the rest of the window keeps — the start screen's own checkbox says the same.
      const settingsIn = process.platform === 'darwin' ? 'Pulp' : 'Edit';
      expect((await item(settingsIn, 'Settings…')).accelerator).toBe('CmdOrCtrl+,');
      await page.eval(`window.pulpMenuCommand('app.settings')`);
      await until(() => page.eval<boolean>(`document.getElementById('settings-dialog').open === true`), 'the settings dialog');
      await until(() => page.eval<string>(`document.getElementById('settings-ffmpeg').textContent`).then((t) => t.startsWith('FFmpeg')), 'the FFmpeg line');

      // Semantic search (milestone 9, ADR 0024): off by default, nothing fetched and nothing sent
      // anywhere until the person says so — the toggle writes the one setting the search reads,
      // and the note says what stands (the runner, or what would be fetched, sized and licensed)
      // before any button exists to press. Nothing is fetched here either.
      expect(await page.eval<boolean>(`document.getElementById('settings-semantic').checked`), 'off by default').toBe(false);
      await until(() => page.eval<string>(`document.getElementById('settings-semantic-note').textContent`).then((t) => t.length > 0), 'the semantic line');
      const semanticSettings = async (): Promise<boolean | undefined> =>
        (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { semanticSearch?: boolean }).semanticSearch;
      await page.eval(`(() => { const c = document.getElementById('settings-semantic'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(async () => (await semanticSettings()) === true, 'the setting on, in settings.json');
      await page.eval(`(() => { const c = document.getElementById('settings-semantic'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(async () => (await semanticSettings()) === false, 'and off again');

      // The download helper (milestone 17, ADR 0022): what Pulp would fetch for this machine,
      // said before there is a button to press. **Nothing is fetched here** — the fetch is the
      // person's own press, and this only proves the asking is in front of it.
      const download = await page.eval<{ build: { label: string; license: string; note: string; bytes: number } | null; installed: boolean }>(
        `window.pulp.ffmpegDownloadStatus()`,
      );
      expect(download.build, `a build is pinned for ${process.platform} ${process.arch}`).not.toBeNull();
      expect(download.build!.license).toMatch(/^GPL/);
      expect(download.build!.bytes).toBeGreaterThan(1_000_000);
      // Which build, from whom, how big and under what license, in the line beside the button.
      for (const said of [download.build!.label, 'GPL', 'MB', 'checksum']) expect(download.build!.note).toContain(said);
      // The button is there exactly when there is something to fetch and nothing already found.
      const ffmpegFound = await page.eval<boolean>(`window.pulp.ffmpegStatus().then((s) => s.ok)`);
      expect(await page.eval<boolean>(`document.getElementById('settings-ffmpeg-get').hidden`)).toBe(ffmpegFound || download.installed);
      expect(await page.eval<string>(`document.getElementById('settings-cache-summary').textContent`)).not.toBe('');
      const startAt = await page.eval<boolean>(`document.getElementById('settings-start-screen').checked`);
      await page.eval(`(() => { const c = document.getElementById('settings-start-screen'); c.checked = ${!startAt}; c.dispatchEvent(new Event('change')); })()`);
      await until(() => page.eval<{ showAtStartup: boolean }>(`window.pulp.getStartScreenPrefs()`).then((p) => p.showAtStartup === !startAt), 'the setting written');
      await page.eval(`(() => { const c = document.getElementById('settings-start-screen'); c.checked = ${startAt}; c.dispatchEvent(new Event('change')); })()`);
      await until(() => page.eval<{ showAtStartup: boolean }>(`window.pulp.getStartScreenPrefs()`).then((p) => p.showAtStartup === startAt), 'the setting put back');
      await page.eval(`document.getElementById('settings-close').click()`);

      // Help > User Guide shows the guide itself, with a strip of its sections (milestone 8).
      await page.eval(`window.pulpMenuCommand('help.userGuide')`);
      await until(() => page.eval<boolean>(`document.getElementById('guide-dialog').open === true`), 'the user guide');
      expect(await page.eval<string[]>(`[...document.querySelectorAll('#guide-contents button')].map((b) => b.textContent)`))
        .toEqual(['The window', 'Making something', 'Keys worth knowing', 'Searching', 'Where your things are', 'More']);
      expect(await page.eval<string>(`document.getElementById('guide-body').textContent`)).toContain('Cmd/Ctrl+F');
      // A section in the strip scrolls the guide to it.
      await page.eval(`[...document.querySelectorAll('#guide-contents button')].find((b) => b.textContent === 'Searching').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('guide-body').scrollTop > 0`), 'the guide scrolled to the section');
      await page.eval(`document.getElementById('guide-close').click()`);

      // Help > Acknowledgements shows the third-party notices file itself.
      await page.eval(`window.pulpMenuCommand('help.acknowledgements')`);
      await until(() => page.eval<boolean>(`document.getElementById('notices-dialog').open === true`), 'the acknowledgements dialog');
      expect(await page.eval<string[]>(`[...document.querySelectorAll('#notices-body h3')].map((h) => h.textContent)`)).toContain('Runtime');
      expect(await page.eval<string>(`document.getElementById('notices-body').textContent`)).toContain('Electron');
      await page.eval(`document.getElementById('notices-close').click()`);
    }, 90_000);

    it('picks the cover frame on the scrub bar and marks it (milestone 20)', async () => {
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview');
      await openTab('output');
      const mark = () => page.eval<{ hidden: boolean; left: string }>(
        `(() => { const m = document.getElementById('cover-flag'); return { hidden: m.hidden, left: m.style.left }; })()`,
      );
      try {
        // Off to begin with: no cover, no mark, and no row of its own.
        expect(await page.eval<boolean>(`document.getElementById('opt-cover').checked`)).toBe(false);
        expect((await mark()).hidden, 'no mark until a cover is asked for').toBe(true);
        expect(await page.eval<boolean>(`document.getElementById('opt-cover-row').hidden`)).toBe(true);

        // Scrub somewhere, then tick the box: the frame is taken from the playhead.
        await page.eval(`(() => { const s = document.getElementById('scrub'); s.value = String(Math.round(Number(s.max) * 0.4)); s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await until(() => page.eval<string>(`document.getElementById('preview-frame').dataset.frame`).then((f) => Number(f) > 0), 'the playhead moved');
        const playhead = Number(await page.eval<string>(`document.getElementById('scrub').value`));
        await page.eval(`(() => { const c = document.getElementById('opt-cover'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(async () => !(await mark()).hidden, 'the cover marked on the scrub bar');
        expect(await page.eval<boolean>(`document.getElementById('opt-cover-row').hidden`), 'its row opens with it').toBe(false);
        expect(await page.eval<string>(`document.getElementById('opt-cover-at').value`), 'filled from the playhead').not.toBe('');
        // The mark sits where the playhead was, as a share of the graphic.
        const total = Number(await page.eval<string>(`document.getElementById('scrub').max`)) + 1;
        expect(parseFloat((await mark()).left)).toBeCloseTo((playhead / Math.max(1, total - 1)) * 100, 0);

        // Typing another frame moves the mark; it is the frame, not the playhead, that decides.
        await fire('#opt-cover-at', '00:00:00:00', 'input');
        await until(async () => parseFloat((await mark()).left) === 0, 'the mark following the field');
        expect(await page.eval<string>(`document.getElementById('scrub').value`), 'the playhead stays where it was').toBe(String(playhead));

        // At the playhead brings it back, and the render says a cover is coming.
        await page.eval(`document.getElementById('opt-cover-here').click()`);
        await until(async () => parseFloat((await mark()).left) > 0, 'the playhead\'s frame again');
        expect(await page.eval<string>(`document.getElementById('options-note').textContent`)).toContain('cover image');

        // Unticking takes the mark away again.
        await page.eval(`(() => { const c = document.getElementById('opt-cover'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(async () => (await mark()).hidden, 'the mark gone with the cover');
      } finally {
        await page.eval(`(() => { const c = document.getElementById('opt-cover'); if (c.checked) { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
        await openTab('parameters');
      }
    }, 90_000);

    it('sets the aspect, size, rate and encoder from one platform, and warns before a render past its limits (milestone 20)', async () => {
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview');
      await openTab('output');
      const warnings = () => page.eval<{ hidden: boolean; text: string }>(
        `(() => { const w = document.getElementById('platform-warnings'); return { hidden: w.hidden, text: w.textContent }; })()`,
      );
      try {
        // Nothing chosen to begin with: no platform, and nothing said about anyone's limits.
        expect(await page.eval<string>(`document.getElementById('opt-platform').value`)).toBe('');
        expect(await page.eval<string>(`document.getElementById('platform-note').textContent`)).toBe('');
        expect((await warnings()).hidden, 'no warnings without a platform').toBe(true);

        // One choice sets the four fields it stands for.
        await fire('#opt-platform', 'tiktok', 'change');
        await until(() => page.eval<string>(`document.getElementById('opt-fps').value`).then((v) => v === '30'), 'the platform\'s frame rate');
        expect(await page.eval<string>(`document.getElementById('opt-aspect').value`), 'its shape').toBe('9:16');
        expect(await page.eval<string>(`document.getElementById('preset').value`), 'its encoder').toBe('h264-mp4');
        expect(
          await page.eval<string>(`(() => { const r = document.getElementById('opt-resolution'); return r.options[r.selectedIndex].textContent; })()`),
          'its resolution',
        ).toContain('1080 × 1920');
        const note = await page.eval<string>(`document.getElementById('platform-note').textContent`);
        expect(note).toContain('9:16 · 1080 × 1920 · 30 fps · H.264 MP4');
        expect(note, 'the date the limits were read, because this is data that ages').toContain('limits checked');
        // Six seconds is inside every limit TikTok has, so nothing is warned about yet.
        expect((await warnings()).hidden).toBe(true);

        // X takes 2:20. Stretch the graphic past that and the Output tab says so before the render.
        await fire('#opt-platform', 'x', 'change');
        await until(() => page.eval<string>(`document.getElementById('opt-aspect').value`).then((v) => v === '16:9'), 'the wide shape');
        await openTab('parameters');
        await fire('#params .length-field input[type=number]', '200', 'change');
        await openTab('output');
        await until(async () => !(await warnings()).hidden, 'the length warning');
        const said = (await warnings()).text;
        expect(said).toContain('Longer than X takes: 3:20, against 2:20');
        expect(said, 'and it says when the limit was read').toContain('limits checked');
        // A warning is not an error: the options still stand, so nothing here blocks the render.
        // A limit may have moved, and the person rendering may know something the list does not.
        expect(await page.eval<boolean>(`document.getElementById('options-note').classList.contains('error')`), 'never blocking').toBe(false);

        // Back inside the limit and the warning goes.
        await openTab('parameters');
        await fire('#params .length-field input[type=number]', '6', 'change');
        await openTab('output');
        await until(async () => (await warnings()).hidden, 'the warning gone with the length');
      } finally {
        await fire('#opt-platform', '', 'change');
        await openTab('parameters');
        await fire('#params .length-field input[type=number]', '6', 'change');
      }
    }, 90_000);

    it('music moods are their own way to browse and search sounds (milestone 16)', async () => {
      // Two sounds in mood-named folders: the folder is the person's own word for how they feel.
      const silence = await readFile(join(ROOT, 'tests', 'e2e', 'templates', 'media', 'silence.wav'));
      await mkdir(join(mediaDir, 'Music', 'Calm'), { recursive: true });
      await mkdir(join(mediaDir, 'Music', 'Upbeat'), { recursive: true });
      await writeFile(join(mediaDir, 'Music', 'Calm', 'still-water.wav'), silence);
      await writeFile(join(mediaDir, 'Music', 'Upbeat', 'bright-run.wav'), silence);
      try {
        await page.eval(`window.pulp.rescanLibrary()`);
        // The Mood chip appears beside For… and Look once the library holds moods, offering only
        // the moods it has, with counts.
        await until(() => page.eval<boolean>(`!document.getElementById('mood-select').parentElement.hidden`), 'the Mood chip');
        const options = await page.eval<string[]>(`[...document.getElementById('mood-select').options].map((o) => o.value)`);
        expect(options).toContain('calm');
        expect(options).toContain('upbeat');
        // Choosing a mood narrows the results to what feels that way.
        await fire('#mood-select', 'calm', 'change');
        await until(async () => {
          const names = await page.eval<string[]>(`[...document.querySelectorAll('#results li[data-id] .name')].map((n) => n.textContent)`);
          return names.includes('still-water') && !names.includes('bright-run');
        }, 'the calm piece alone');
        // And mood: is the same fence in the search field's own words.
        await fire('#mood-select', '', 'change');
        await fire('#search', 'mood:upbeat', 'input');
        await until(async () => {
          const names = await page.eval<string[]>(`[...document.querySelectorAll('#results li[data-id] .name')].map((n) => n.textContent)`);
          return names.includes('bright-run') && !names.includes('still-water');
        }, 'the upbeat piece alone');
      } finally {
        await fire('#search', '', 'input');
        await page.eval(`(() => { const m = document.getElementById('mood-select'); if (m.value !== '') { m.value = ''; m.dispatchEvent(new Event('change', { bubbles: true })); } })()`).catch(() => undefined);
        // The files go, and the library with them, so later counts meet the library they expect.
        await rm(join(mediaDir, 'Music'), { recursive: true, force: true });
        await page.eval(`window.pulp.rescanLibrary()`).catch(() => undefined);
        await until(async () => !(await page.eval<string[]>(`[...document.querySelectorAll('#results li[data-id] .name')].map((n) => n.textContent)`)).includes('still-water'), 'the fixtures gone').catch(() => undefined);
      }
    }, 90_000);

    it('semantic search finds meaning the words miss, entirely on this machine (milestone 9)', async () => {
      // Gated like the speech test: it needs llama.cpp on PATH and a local copy of the pinned
      // model in PULP_SEMANTIC_TEST_MODEL. CI has neither and says so; this machine ran it.
      const status = await page.eval<{ runner: { ok: boolean }; model: { installed: boolean } }>(`window.pulp.semanticStatus()`);
      const modelCopy = process.env.PULP_SEMANTIC_TEST_MODEL ?? '';
      if (!status.runner.ok || modelCopy === '' || !existsSync(modelCopy)) {
        console.info('llama-embedding or PULP_SEMANTIC_TEST_MODEL not available; the semantic end-to-end check ran where it is.');
        return;
      }
      const { SEMANTIC_MODEL } = await import('../../src/core/semantic');
      await mkdir(join(userData, 'semantic-models'), { recursive: true });
      await copyFile(modelCopy, join(userData, 'semantic-models', SEMANTIC_MODEL.file));
      try {
        // Turned on in Settings, the way a person does it, so the window learns it is ready.
        await page.eval(`window.pulpMenuCommand('app.settings')`);
        await until(() => page.eval<boolean>(`document.getElementById('settings-dialog').open === true`), 'the settings dialog');
        await page.eval(`(() => { const c = document.getElementById('settings-semantic'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(() => page.eval<string>(`document.getElementById('settings-semantic-note').textContent`).then((t) => t.includes('on this machine') || t.includes('Indexing')), 'the model found and the pass started');
        await page.eval(`document.getElementById('settings-close').click()`);
        // The library embeds in the background; done when the pass is idle **and** the ask answers —
        // answers alone arrive while later batches (this very template among them) are still going.
        await until(async () => {
          const st = await page.eval<{ indexing: { total: number } }>(`window.pulp.semanticStatus()`);
          if (st.indexing.total > 0) return false;
          return (await page.eval<{ hits: unknown[] }>(`window.pulp.semanticSearch('something calm for a podcast intro')`)).hits.length >= 10;
        }, 'the library indexed', 180_000);

        // On the relevance order (meaning folds into no other), the words match nothing and the
        // meaning finds the podcast close and calm pieces.
        await fire('#sort', 'relevance', 'change');
        await fire('#search', 'something calm for a podcast intro', 'input');
        await until(async () => {
          const names = await page.eval<string[]>(`[...document.querySelectorAll('#results li[data-id] .name')].slice(0, 12).map((n) => n.textContent)`);
          return names.includes('Listen Next');
        }, 'the podcast close among the top results');
      } finally {
        await page.eval(`window.pulp.setSemanticSearch(false)`).catch(() => undefined);
        await page.eval(`(() => { const d = document.getElementById('settings-dialog'); if (d.open) d.close(); })()`).catch(() => undefined);
        await fire('#search', '', 'input');
      }
    }, 300_000);

    it('one-click presets set up common kinds, and Save as default for this type is how every such item opens (milestone 14)', async () => {
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview');
      await openTab('output');
      const typeDefaults = async (): Promise<Record<string, { presetId?: string; matte?: boolean }>> => {
        try {
          return (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { typeOutputDefaults?: Record<string, { presetId?: string; matte?: boolean }> }).typeOutputDefaults ?? {};
        } catch {
          return {};
        }
      };
      try {
        // The quick setup row offers what fits an alpha lower third, by name.
        const labels = await page.eval<string[]>(`[...document.querySelectorAll('#asset-preset-buttons .asset-preset')].map((b) => b.textContent)`);
        expect(labels).toEqual(['Transparent overlay', 'Editor-safe, with matte', 'Web overlay (VP9)']);

        // One click sets the preset, the flatten background and the matte; nothing is written yet.
        await page.eval(`document.querySelector('#asset-preset-buttons [data-preset="editor-safe"]').click()`);
        expect(await page.eval<string>(`document.getElementById('preset').value`)).toBe('h264-mp4');
        expect(await page.eval<boolean>(`document.getElementById('opt-matte').checked`)).toBe(true);
        expect((await typeDefaults())['lower-third']).toBeUndefined();

        // Save as default for this type: into settings.json, said under the button.
        await page.eval(`document.getElementById('type-default-save').click()`);
        await until(() => page.eval<boolean>(`!document.getElementById('type-default-note').hidden`), 'the saved note');
        expect(await page.eval<string>(`document.getElementById('type-default-note').textContent`)).toContain('Lower third items open with the saved default');
        await until(async () => (await typeDefaults())['lower-third']?.presetId === 'h264-mp4', 'the default in settings.json');
        expect((await typeDefaults())['lower-third']?.matte).toBe(true);

        // Point the controls elsewhere, then show another lower third: it opens on the saved default.
        await fire('#preset', 'prores-4444', 'change');
        await page.eval(`(() => { const m = document.getElementById('opt-matte'); m.checked = false; m.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await clickResult('Hairline Lower Third');
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the second lower third');
        await openTab('output');
        expect(await page.eval<string>(`document.getElementById('preset').value`), 'the saved preset').toBe('h264-mp4');
        expect(await page.eval<boolean>(`document.getElementById('opt-matte').checked`), 'the saved matte').toBe(true);
        expect(await page.eval<boolean>(`document.getElementById('type-default-note').hidden`)).toBe(false);

        // A different kind holds no default, and an opaque title is offered no alpha quick setup at all.
        await clickResult('Title Card');
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the title card');
        await openTab('output');
        expect(await page.eval<boolean>(`document.getElementById('type-default-note').hidden`)).toBe(true);
        expect(await page.eval<boolean>(`document.getElementById('asset-presets').hidden`), 'nothing fits, the row hides').toBe(true);

        // Clear takes the default out of settings, and the note with it.
        await clickResult('Lower Third Bar');
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the lower third again');
        await openTab('output');
        await page.eval(`document.getElementById('type-default-clear').click()`);
        await until(() => page.eval<boolean>(`document.getElementById('type-default-note').hidden`), 'the note gone');
        await until(async () => (await typeDefaults())['lower-third'] === undefined, 'the default gone from settings.json');
      } finally {
        // Back to the suite's standing output settings, and no default left behind.
        await page.eval(`window.pulp.setTypeOutputDefault('lower-third', null)`);
        await fire('#preset', 'prores-4444', 'change');
        await page.eval(`(() => { const m = document.getElementById('opt-matte'); m.checked = false; m.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      }
    }, 90_000);

    it('guided setup walks the output step by step, previews live over a checkerboard, and lands on the tab (milestone 14)', async () => {
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview');
      await openTab('output');
      const open = () => page.eval<boolean>(`document.getElementById('guided-dialog').open`);
      const head = () => page.eval<string>(`document.getElementById('guided-step-head').textContent`);
      const next = () => page.eval(`document.getElementById('guided-next').click()`);
      const typeDefaults = async (): Promise<Record<string, { presetId?: string }>> => {
        try {
          return (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { typeOutputDefaults?: Record<string, { presetId?: string }> }).typeOutputDefaults ?? {};
        } catch {
          return {};
        }
      };
      try {
        await page.eval(`document.getElementById('guided-open').click()`);
        await until(open, 'the wizard');
        expect(await head()).toBe('Step 1 of 5 · What is it for?');
        // The purposes are the kind presets that fit an alpha lower third, a social post, and by hand.
        const purposes = await page.eval<string[]>(`[...document.querySelectorAll('#guided-step-body input[name=guided-purpose]')].map((i) => i.value)`);
        expect(purposes).toEqual(['transparent-overlay', 'editor-safe', 'web-alpha', 'social', 'custom']);
        // The preview starts over the checkerboard: transparency kept by the default format.
        expect(await page.eval<boolean>(`document.getElementById('guided-preview-box').classList.contains('checker')`)).toBe(true);
        // Choosing the editor-safe answer flattens: the checkerboard gives way to the flatten color, live.
        await page.eval(`(() => { const i = document.querySelector('#guided-step-body input[name=guided-purpose][value=editor-safe]'); i.click(); })()`);
        await until(async () => !(await page.eval<boolean>(`document.getElementById('guided-preview-box').classList.contains('checker')`)), 'the flatten preview');
        expect(await page.eval<string>(`document.getElementById('guided-preview-caption').textContent`)).toContain('H.264 MP4');

        // Shape and size: picking the vertical shape turns the preview box tall, live.
        await next();
        expect(await head()).toBe('Step 2 of 5 · Shape and size');
        await page.eval(`(() => { const i = document.querySelector('#guided-step-body input[name=guided-aspect][value="9:16"]'); i.click(); })()`);
        await until(() => page.eval<string>(`document.getElementById('guided-preview-box').style.aspectRatio`).then((v) => v.includes('1080 / 1920')), 'the tall preview');
        expect(await page.eval<string>(`document.getElementById('guided-preview-caption').textContent`)).toContain('1080 × 1920');

        // Format: the step holds what the first answer chose, said in plain words.
        await next();
        expect(await head()).toBe('Step 3 of 5 · Format');
        expect(await page.eval<string>(`document.querySelector('#guided-step-body select').value`)).toBe('h264-mp4');
        // Sound: said, not asked — this project holds no sound yet.
        await next();
        expect(await head()).toBe('Step 4 of 5 · Sound');
        expect(await page.eval<string>(`document.getElementById('guided-step-body').textContent`)).toContain('Nothing here makes sound yet');

        // Summary: the sentences, the save-as-default box, and the finish.
        await next();
        expect(await head()).toBe('Step 5 of 5 · Summary');
        const summary = await page.eval<string>(`document.getElementById('guided-step-body').textContent`);
        expect(summary).toContain('flattened over #000000');
        expect(summary).toContain('matte');
        await page.eval(`(() => { const b = document.querySelector('#guided-step-body input[type=checkbox]'); b.click(); })()`);
        expect(await page.eval<string>(`document.getElementById('guided-next').textContent`)).toBe('Use these settings');
        await next();
        await until(async () => !(await open()), 'the wizard closed');

        // The tab holds what the walk chose, and the type's default was saved.
        expect(await page.eval<string>(`document.getElementById('preset').value`)).toBe('h264-mp4');
        expect(await page.eval<string>(`document.getElementById('opt-aspect').value`)).toBe('9:16');
        expect(await page.eval<boolean>(`document.getElementById('opt-matte').checked`)).toBe(true);
        await until(async () => (await typeDefaults())['lower-third']?.presetId === 'h264-mp4', 'the default in settings.json');

        // Cancel applies nothing: reopen, change the purpose, and leave by Cancel.
        await page.eval(`document.getElementById('guided-open').click()`);
        await until(open, 'the wizard again');
        await page.eval(`(() => { const i = document.querySelector('#guided-step-body input[name=guided-purpose][value=transparent-overlay]'); i.click(); })()`);
        await page.eval(`document.getElementById('guided-cancel').click()`);
        await until(async () => !(await open()), 'canceled');
        expect(await page.eval<string>(`document.getElementById('preset').value`)).toBe('h264-mp4');

        // Add to collection at the end: the walk applies and a card lands in the tray.
        const cards = () => page.eval<number>(`document.querySelectorAll('#region-tray [aria-label="Remove from the collection"]').length`);
        const before = await cards();
        await page.eval(`document.getElementById('guided-open').click()`);
        await until(open, 'the wizard a third time');
        for (let i = 0; i < 4; i += 1) await next();
        expect(await head()).toBe('Step 5 of 5 · Summary');
        expect(await page.eval<boolean>(`document.getElementById('guided-collect').hidden`)).toBe(false);
        expect(await page.eval<boolean>(`document.getElementById('add-to-collection').disabled`)).toBe(false);
        await page.eval(`document.getElementById('guided-collect').click()`);
        await until(async () => !(await open()), 'collected and closed');
        await until(async () => (await cards()) === before + 1, 'the card in the tray');
        // Taken out again, so later suites meet the tray they expect.
        await page.eval(`[...document.querySelectorAll('#region-tray [aria-label="Remove from the collection"]')].pop().click()`);
        await until(async () => (await cards()) === before, 'the tray as it was');
      } finally {
        // Resilient on purpose: a cleanup that throws would hide what the walk itself failed on.
        // The default is cleared through the tab's own button, which also clears the window's
        // cache of it — the bare API call would leave the cache reapplying it on the next show.
        for (const expr of [
          `(() => { const d = document.getElementById('guided-dialog'); if (d.open) d.close(); })()`,
          `(() => { const c = document.getElementById('type-default-clear'); if (!c.hidden) c.click(); })()`,
          `(() => { const p = document.getElementById('preset'); p.value = 'prores-4444'; p.dispatchEvent(new Event('change', { bubbles: true })); })()`,
          `(() => { const a = document.getElementById('opt-aspect'); a.value = '16:9'; a.dispatchEvent(new Event('change', { bubbles: true })); })()`,
          `(() => { const m = document.getElementById('opt-matte'); m.checked = false; m.dispatchEvent(new Event('change', { bubbles: true })); })()`,
        ]) {
          await page.eval(expr).catch(() => undefined);
        }
      }
      // The walk leaves no mark: the tab and the stage are back on the wide shape it opened over,
      // and reselecting the template reapplies no default, from the settings or the window's cache.
      expect(await page.eval<string>(`document.getElementById('opt-aspect').value`)).toBe('16:9');
      await until(() => page.eval<number>(`document.getElementById('preview-frame').getBoundingClientRect().width`).then((w) => w > 400), 'the stage wide again');
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'reselected');
      expect(await page.eval<string>(`document.getElementById('opt-aspect').value`), 'no default reapplied').toBe('16:9');
      expect(await page.eval<boolean>(`document.getElementById('type-default-note').hidden`)).toBe(true);
    }, 120_000);

    it('writes what went wrong to a local log, and copies diagnostics from the status items (milestone 8)', async () => {
      const logFile = join(userData, 'logs', 'pulp.log');
      // The log is there from the start: the main process writes a line as it comes up.
      await until(() => Promise.resolve(existsSync(logFile)), 'the log file');
      expect(await readFile(logFile, 'utf8')).toMatch(/INFO \[main\] Pulp .* started on /);

      // An error nobody handled in the window reaches it, on one line, with its stack.
      await page.eval(`setTimeout(() => { throw new Error('a test error nobody caught'); }, 0), true`);
      await until(async () => (await readFile(logFile, 'utf8')).includes('a test error nobody caught'), 'the window\'s error in the log');
      const recorded = (await readFile(logFile, 'utf8')).split('\n').filter((l) => l.includes('a test error nobody caught'));
      expect(recorded, 'said once, on one line').toHaveLength(1);
      expect(recorded[0]).toMatch(/ERROR \[window\] /);

      // Copy diagnostics is a button in the status items, and the menu's item presses that one.
      expect(await page.eval<boolean>(`!!document.querySelector('#region-status #status-diagnostics')`), 'the status item').toBe(true);
      await page.eval(`window.pulpMenuCommand('help.diagnostics')`);
      await until(() => page.eval<string>(`document.querySelector('#status-diagnostics .label').textContent`).then((t) => t === 'Diagnostics copied'), 'the status item saying it copied');
      // What it copied from: the log's own place, and the error just recorded.
      const text = await page.eval<string>(
        `(async () => { const log = await window.pulp.logTail(); return JSON.stringify({ path: log.path, lines: log.lines.length, last: log.lines[log.lines.length - 1] }); })()`,
      );
      const tail = JSON.parse(text) as { path: string; lines: number; last: string };
      expect(tail.path.endsWith('pulp.log')).toBe(true);
      expect(tail.lines).toBeGreaterThan(0);
      expect(tail.last).toContain('a test error nobody caught');
      // The label goes back to nothing, so the row is a row of controls again.
      await until(() => page.eval<string>(`document.querySelector('#status-diagnostics .label').textContent`).then((t) => t === ''), 'the status item quiet again');
    }, 60_000);

    it('keeps the tray\'s resize bar inside the tray, and lines the status items up in the transport row', async () => {
      // The tray is in the window only while it has something (milestone 42), and the bar only
      // exists while the tray is open, which is where it can be dragged.
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('add-to-collection').disabled`), 'the add button');
      await page.eval(`document.getElementById('add-to-collection').click()`);
      await until(() => page.eval<boolean>(`!document.getElementById('app').classList.contains('tray-empty')`), 'the tray in the window');
      await page.eval(`(() => { if (document.getElementById('app').classList.contains('tray-collapsed')) document.getElementById('tray-toggle').click(); return true; })()`);
      await until(() => page.eval<boolean>(`!document.getElementById('app').classList.contains('tray-collapsed')`), 'the tray open');

      // The bar that resizes the tray is the tray's own edge: it used to be given a negative
      // margin to cancel a padding that is on the tray's body rather than on the tray, so it hung
      // a dozen pixels past either side and sat over the regions beside it.
      type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
      const bars = await page.eval<{ tray: Box; splitter: Box }>(
        `(() => { const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
          return { tray: r(document.getElementById('region-tray')), splitter: r(document.getElementById('split-tray')) }; })()`,
      );
      expect(bars.splitter.left, 'the bar does not reach past the tray on the left').toBeGreaterThanOrEqual(bars.tray.left);
      expect(bars.splitter.right, 'nor on the right').toBeLessThanOrEqual(bars.tray.right);
      expect(bars.splitter.width, 'and it still spans the tray').toBeCloseTo(bars.tray.width, 0);
      // Leave the collection as it was found: the tray goes with its last item (milestone 42).
      await page.eval(`document.querySelector('#collection .collection-card button[aria-label="Remove from the collection"]').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('app').classList.contains('tray-empty')`), 'the tray gone with its last item');

      // The status items — a button, a paragraph, a flex summary and three spans, some with icons —
      // sit at the end of the transport row (milestone 42). Aligned on their baselines they once sat
      // at different heights, which reads as a row of things that do not belong together.
      expect(await page.eval<boolean>(`!!document.getElementById('region-status').closest('#region-transport')`), 'the status in the transport row').toBe(true);
      const items = await page.eval<{ id: string; center: number; height: number }[]>(
        `[...document.querySelectorAll('#region-status > *')].filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height > 0)
           .map((el) => { const b = el.getBoundingClientRect(); return { id: el.id || el.className, center: b.top + b.height / 2, height: b.height }; })`,
      );
      // The project, ffmpeg and the cache are always on the line; the library's counts leave it
      // under 1040 px (milestone 42), which is narrower than the window CI runs at.
      expect(items.length, 'the status has items to line up').toBeGreaterThanOrEqual(3);
      const centers = items.map((i) => i.center);
      const spread = Math.max(...centers) - Math.min(...centers);
      expect(spread, `the items sit on one line (${JSON.stringify(items)})`).toBeLessThan(1.5);

      // And they are one size: the bar used to mix 11 px notes with a button that inherited the
      // body's size and line height, so the row read as three kinds of text rather than one.
      const text = await page.eval<{ id: string; size: string; lineHeight: string; family: string }[]>(
        `[...document.querySelectorAll('#region-status > *')].filter((el) => el.offsetParent !== null && el.textContent.trim() !== '')
           .map((el) => { const c = getComputedStyle(el); return { id: el.id || el.className, size: c.fontSize, lineHeight: c.lineHeight, family: c.fontFamily }; })`,
      );
      expect(new Set(text.map((t) => t.size)), `one text size (${JSON.stringify(text)})`).toHaveProperty('size', 1);
      expect(new Set(text.map((t) => t.lineHeight)), `one line height (${JSON.stringify(text)})`).toHaveProperty('size', 1);
      expect(new Set(text.map((t) => t.family)), `one family (${JSON.stringify(text)})`).toHaveProperty('size', 1);
    }, 60_000);

    it('fits at the default 1280 × 788: nothing overlaps, the page never scrolls, the picture gets its share, and nothing empty takes room from the stage (milestones 38 and 42)', async () => {
      type Box = { id: string; left: number; right: number; top: number; bottom: number };
      const boxes = (ids: string[]) =>
        page.eval<Box[]>(
          `(${JSON.stringify(ids)}).map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return { id, left: b.left, right: b.right, top: b.top, bottom: b.bottom }; })`,
        );
      // Two boxes may share an edge (borders, splitters); any real shared area is an overlap.
      const overlap = (a: Box, b: Box) =>
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      // The status is inside the transport row now (milestone 42), so it is not a region of its own here.
      const regions = ['region-browse', 'region-stage', 'region-results', 'region-tray', 'region-transport'];
      const removeCollected = () => page.eval(`[...document.querySelectorAll('#collection .collection-card button[aria-label="Remove from the collection"]')].forEach((b) => b.click())`);
      try {
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 788, deviceScaleFactor: 1, mobile: false });
        await until(() => page.eval<boolean>(`window.innerHeight === 788 && window.innerWidth === 1280`), 'the default window size');
        // Nothing collected: the tray is not in the window at all (milestone 42), and the results
        // reach down to the transport row.
        await removeCollected();
        await until(() => page.eval<boolean>(`document.getElementById('app').classList.contains('tray-empty')`), 'the tray gone, with nothing in it');
        expect(await page.eval<string>(`getComputedStyle(document.getElementById('region-tray')).display`), 'no drawer and no summary line').toBe('none');
        const [resultsAtRest, rowAtRest] = await boxes(['region-results', 'region-transport']);
        expect(resultsAtRest!.bottom, 'the results reach the transport row').toBeCloseTo(rowAtRest!.top, 0);

        // The results and the category cards stay inside their region, and the region clear of
        // whatever is under it — the tray when it has something, the transport row otherwise —
        // measured on the elements, not the regions: on eda45d8 the list itself ran under the
        // tray's buttons while every region box looked right (GitHub issue #40).
        const contained = async (when: string) => {
          const m = await page.eval<{ region: number[]; list: number[]; cards: number[] | null; trayTop: number }>(
            `(() => { const b = (el) => el ? [el.getBoundingClientRect().top, el.getBoundingClientRect().bottom] : null;
              const cards = document.getElementById('category-cards');
              const tray = document.getElementById('region-tray').getBoundingClientRect();
              return { region: b(document.getElementById('region-results')), list: b(document.getElementById('results')),
                cards: cards.hidden || cards.getBoundingClientRect().height === 0 ? null : b(cards),
                trayTop: tray.height > 0 ? tray.top : document.getElementById('region-transport').getBoundingClientRect().top }; })()`,
          );
          expect(m.region[1], `the region clear of what is under it ${when}`).toBeLessThanOrEqual(m.trayTop + 1);
          expect(m.list[1], `the list inside its region ${when}`).toBeLessThanOrEqual(m.region[1]! + 1);
          expect(m.list[1]! - m.list[0]!, `the list at its floor ${when}`).toBeGreaterThanOrEqual(120);
          if (m.cards) expect(m.cards[1], `the cards inside the region ${when}`).toBeLessThanOrEqual(m.region[1]! + 1);
        };
        await contained('on the default view');
        await clickResult('Lower Third Bar');
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview');

        // The page itself never scrolls: every region scrolls inside its own pane.
        const doc = await page.eval<{ sw: number; sh: number; ow: string }>(
          `({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, ow: getComputedStyle(document.body).overflow })`,
        );
        expect(doc.ow).toBe('hidden');
        expect(doc.sw).toBeLessThanOrEqual(1280);
        expect(doc.sh).toBeLessThanOrEqual(788);

        // No region draws over another, and every one is inside the window.
        let all = await boxes(regions);
        for (const b of all) {
          expect(b.left, `${b.id} inside the window`).toBeGreaterThanOrEqual(-1);
          expect(b.right, b.id).toBeLessThanOrEqual(1281);
          expect(b.top, b.id).toBeGreaterThanOrEqual(-1);
          expect(b.bottom, b.id).toBeLessThanOrEqual(789);
        }
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            expect(overlap(all[i]!, all[j]!), `${all[i]!.id} does not overlap ${all[j]!.id}`).toBeLessThanOrEqual(all.length);
          }
        }

        // The right column is gone: the stage and the results reach the window's right edge.
        const [stage, results] = await boxes(['region-stage', 'region-results']);
        expect(stage!.right).toBeGreaterThan(1280 - 2);
        expect(results!.right).toBeGreaterThan(1280 - 2);

        // The row above the stage is gone too (milestone 41): the stage starts at the window's top
        // edge, and everything that row held is in the left panel or the results' heading.
        expect(stage!.top, 'the stage starts at the top').toBeLessThanOrEqual(1);
        const [browse, search] = await boxes(['region-browse', 'region-search']);
        expect(search!.left, 'Search inside the browse panel').toBeGreaterThanOrEqual(browse!.left - 0.5);
        expect(search!.right, 'Search inside the browse panel').toBeLessThanOrEqual(browse!.right + 0.5);
        expect(search!.top).toBeGreaterThanOrEqual(browse!.top - 0.5);
        const panel = await page.eval<{ searchBottom: number; browseTop: number; chipsOneLine: boolean; forLookBelow: boolean }>(
          `(() => { const r = (el) => el.getBoundingClientRect(); const chips = [...document.querySelectorAll('#region-search .filter-chips .chip')].map(r);
            return { searchBottom: r(document.getElementById('region-search')).bottom, browseTop: r(document.querySelector('.browse-section')).top,
              chipsOneLine: new Set(chips.map((c) => Math.round(c.top))).size === 1, forLookBelow: r(document.querySelector('.narrow-chips')).top >= Math.max(...chips.map((c) => c.bottom)) - 0.5 }; })()`,
        );
        expect(panel.browseTop, 'Browse below Search').toBeGreaterThanOrEqual(panel.searchBottom - 0.5);
        expect(panel.chipsOneLine, 'the filter chips in one compact row').toBe(true);
        expect(panel.forLookBelow, 'For… and Look under the chips').toBe(true);
        // Export pack (milestone 47), sort, grid or list and the thumbnail size are in the results'
        // heading, inside it and apart.
        const heading = await page.eval<{ id: string; left: number; right: number; top: number; bottom: number }[]>(
          `[...document.querySelectorAll('#region-results .results-head #export-pack, #region-results .results-head #sort, #region-results .results-head #view-grid, #region-results .results-head #view-list, #region-results .results-head #thumb-size, #region-results .results-head #stage-toggle, #region-results .results-head #results-toggle')]
            .map((el) => { const b = el.getBoundingClientRect(); return { id: el.id, left: b.left, right: b.right, top: b.top, bottom: b.bottom }; })`,
        );
        expect(heading.map((h) => h.id)).toEqual(['export-pack', 'sort', 'view-grid', 'view-list', 'thumb-size', 'stage-toggle', 'results-toggle']);
        const headBox = await page.eval<Box>(`(() => { const b = document.querySelector('#region-results .results-head').getBoundingClientRect(); return { id: 'head', left: b.left, right: b.right, top: b.top, bottom: b.bottom }; })()`);
        for (const h of heading) {
          expect(h.right, `${h.id} inside the heading`).toBeLessThanOrEqual(headBox.right + 0.5);
          expect(h.bottom, `${h.id} inside the heading`).toBeLessThanOrEqual(headBox.bottom + 0.5);
        }
        for (let i = 0; i < heading.length; i++) for (let j = i + 1; j < heading.length; j++) expect(overlap(heading[i] as Box, heading[j] as Box), `${heading[i]!.id} apart from ${heading[j]!.id}`).toBe(0);

        // The stage is all picture — its box holds the preview and nothing else takes a row from it —
        // and the picture gets at least its share of the window.
        const picture = await page.eval<{ h: number; stageH: number }>(
          `(() => { const w = document.querySelector('#region-stage .preview-wrap').getBoundingClientRect(); const s = document.getElementById('region-stage').getBoundingClientRect(); return { h: w.height, stageH: s.height }; })()`,
        );
        expect(picture.stageH - picture.h, 'nothing but padding around the picture').toBeLessThanOrEqual(26);
        expect(picture.h, 'the picture gets its share of the window').toBeGreaterThanOrEqual(788 * 0.38);

        // The scrub bar has a line of its own, lined up one to one under the picture: its ends sit
        // under the picture's edges, so halfway along the bar is halfway along the picture. The
        // buttons sit on their own line below it, in their three clusters.
        const scrubAgainstPicture = () =>
          page.eval<{ scrub: number[]; pic: number[]; scrubTop: number; buttonsTop: number; playX: number; marksX: number; tabsX: number; rowRight: number }>(
            `(() => { const r = (el) => el.getBoundingClientRect(); const sc = r(document.querySelector('#region-transport .scrub-wrap'));
              const pic = r(document.getElementById('preview-frame')); const bl = r(document.querySelector('#region-transport .buttons-line'));
              return { scrub: [sc.left, sc.right], pic: [pic.left, pic.right], scrubTop: sc.top, buttonsTop: bl.top,
                playX: r(document.getElementById('play')).left, marksX: r(document.getElementById('mark-in')).left,
                tabsX: r(document.getElementById('tab-info')).right, rowRight: r(document.getElementById('region-transport')).right }; })()`,
          );
        let lines = await scrubAgainstPicture();
        expect(lines.scrub[0], 'the scrub bar starts at the picture\'s left edge').toBeCloseTo(lines.pic[0]!, 0);
        expect(lines.scrub[1], 'and ends at its right edge').toBeCloseTo(lines.pic[1]!, 0);
        expect(lines.buttonsTop, 'the buttons on a second line below the scrub bar').toBeGreaterThan(lines.scrubTop + 10);
        expect(lines.playX, 'play on the left').toBeLessThan(200);
        // The marks sit between the playback buttons and the tools: in the middle of what is left,
        // which at 1280 px, with the status at the row's end (milestone 42), is little.
        expect(lines.marksX, 'the marks after the playback buttons').toBeGreaterThan(300);
        expect(lines.marksX, 'and before the tools').toBeLessThan(640);
        expect(lines.tabsX, 'the tabs on the right').toBeGreaterThan(lines.rowRight - 300);

        // No two controls in the row draw over one another, and none leaves the row: at 1280 px the
        // in-and-out cluster's Clear once sat on Mute (docs/ideas.md, 2026-10-30). The status items at
        // the row's end (milestone 42) are controls of the line too, and are held to the same.
        const rowControls = () =>
          page.eval<{ id: string; left: number; right: number; top: number; bottom: number }[]>(
            `[...document.querySelectorAll('#region-transport .buttons-line button, #region-transport .buttons-line input, #region-transport .buttons-line #timecode, #region-status > *')]
               .filter((el) => el.getBoundingClientRect().width > 0)
               .map((el) => { const b = el.getBoundingClientRect(); return { id: el.id || el.className, left: b.left, right: b.right, top: b.top, bottom: b.bottom }; })`,
          );
        const heldApart = async (when: string) => {
          const controls = await rowControls();
          expect(controls.length, when).toBeGreaterThan(10);
          const rowBox = (await boxes(['region-transport']))[0]!;
          for (const c of controls) {
            expect(c.left, `${c.id} inside the row ${when}`).toBeGreaterThanOrEqual(rowBox.left - 0.5);
            expect(c.right, `${c.id} inside the row ${when}`).toBeLessThanOrEqual(rowBox.right + 0.5);
            expect(c.top, `${c.id} inside the row ${when}`).toBeGreaterThanOrEqual(rowBox.top - 0.5);
            expect(c.bottom, `${c.id} inside the row ${when}`).toBeLessThanOrEqual(rowBox.bottom + 0.5);
          }
          for (let i = 0; i < controls.length; i++) {
            for (let j = i + 1; j < controls.length; j++) {
              expect(overlap(controls[i] as Box, controls[j] as Box), `${controls[i]!.id} does not overlap ${controls[j]!.id} ${when}`).toBe(0);
            }
          }
        };
        await heldApart('on two lines');
        // The status is in the row, at its end, where the status bar's row used to be below it.
        const [statusBox] = await boxes(['region-status']);
        expect(await page.eval<boolean>(`!!document.getElementById('region-status').closest('#region-transport .buttons-line')`), 'the status on the buttons line').toBe(true);
        expect(statusBox!.right, 'at the row\'s end').toBeGreaterThan(lines.rowRight - 24);
        expect(statusBox!.left, 'after the tabs').toBeGreaterThanOrEqual(lines.tabsX - 0.5);
        expect(await page.eval<string>(`document.querySelector('#region-status #library-summary > div:first-child').textContent`), 'the counts in it').toMatch(/^\d+ items?$/);
        expect(await page.eval<string>(`document.querySelector('#region-status #library-summary > div:first-child').dataset.tip`), 'told apart in the tooltip').toMatch(/\d+ templates? · \d+ media files? · \d+ folders?/);
        // The library's counts are whole, not cut: the status is the cluster that yields, and at the default window it does not have to.
        const summaryBox = await page.eval<{ w: number; sw: number }>(`(() => { const el = document.querySelector('#region-status #library-summary > div:first-child'); return { w: el.clientWidth, sw: el.scrollWidth }; })()`);
        expect(summaryBox.sw, 'the counts whole').toBeLessThanOrEqual(summaryBox.w + 1);
        // The cache is a button on the row that opens the Render cache dialog, which the tray's foot opens too.
        await page.eval(`document.getElementById('status-cache').click()`);
        await until(() => page.eval<boolean>(`document.getElementById('cache-dialog').open`), 'the render cache dialog');
        expect(await page.eval<string>(`document.getElementById('cache-summary').textContent`)).toMatch(/files?/);
        await page.eval(`document.getElementById('cache-close').click()`);
        await until(() => page.eval<boolean>(`!document.getElementById('cache-dialog').open`), 'the dialog closed');

        // Empty results fold to their heading (milestone 42): a search that matches nothing leaves the
        // heading bar — with the reason and the way out in it — and the stage takes the height.
        const stageAtRest = (await boxes(['region-stage']))[0]!;
        await fire('#search', 'nothing matches this at all', 'input');
        await until(() => page.eval<boolean>(`document.getElementById('app').classList.contains('results-empty')`), 'the results folded');
        const folded = await page.eval<{ region: Box; head: Box; stage: Box; list: string; message: string; actions: string[] }>(
          `(() => { const r = (el) => { const b = el.getBoundingClientRect(); return { id: el.id, left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
            return { region: r(document.getElementById('region-results')), head: r(document.querySelector('#region-results .results-head')), stage: r(document.getElementById('region-stage')),
              list: getComputedStyle(document.getElementById('results')).display, message: document.getElementById('results-empty').textContent,
              actions: [...document.querySelectorAll('#results-empty [data-empty-action]')].map((b) => b.dataset.emptyAction) }; })()`,
        );
        expect(folded.list, 'the list gone').toBe('none');
        expect(folded.region.bottom - folded.region.top, 'the region is its heading').toBeLessThanOrEqual(folded.head.bottom - folded.head.top + 1);
        expect(folded.stage.bottom - folded.stage.top, 'the stage took the height').toBeGreaterThan(stageAtRest.bottom - stageAtRest.top + 100);
        expect(folded.stage.bottom, 'the stage reaches the heading').toBeCloseTo(folded.region.top, 0);
        expect(folded.message).toContain('No matches for “nothing matches this at all”');
        expect(folded.actions).toEqual(['clear-search']);
        await page.eval(`document.querySelector('#results-empty [data-empty-action=clear-search]').click()`);
        await until(() => page.eval<boolean>(`!document.getElementById('app').classList.contains('results-empty') && document.getElementById('search').value === ''`), 'the results back');
        const stageBack = (await boxes(['region-stage']))[0]!;
        expect(stageBack.bottom - stageBack.top).toBeCloseTo(stageAtRest.bottom - stageAtRest.top, 0);

        // Scrolled to a chosen card, the heading stays on top: what is painted at the heading is the
        // heading, not a card's name showing through (docs/ideas.md, 2026-10-30).
        await page.eval(`(() => { const r = document.getElementById('results'); r.scrollTop = Math.max(0, Math.min(r.scrollHeight - r.clientHeight, 300)); })()`);
        await until(() => page.eval<number>(`document.getElementById('results').scrollTop`).then((t) => t > 0), 'the list scrolled');
        const atHeading = await page.eval<{ onHeading: boolean; listTop: number; headBottom: number }>(
          `(() => { const h = document.getElementById('results-label').getBoundingClientRect(); const hit = document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2);
            return { onHeading: !!hit && !!hit.closest('.results-head'), listTop: document.getElementById('results').getBoundingClientRect().top, headBottom: document.querySelector('#region-results .results-head').getBoundingClientRect().bottom }; })()`,
        );
        expect(atHeading.onHeading, 'the heading is what is painted at the heading').toBe(true);
        expect(atHeading.listTop, 'the list starts below the heading').toBeGreaterThanOrEqual(atHeading.headBottom - 0.5);
        await page.eval(`document.getElementById('results').scrollTop = 0`);

        // A tall picture would make the bar too short to scrub: it keeps its floor, centered under it.
        await clickResult('Boardroom opener');
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the opener preview');
        await fire('#opt-aspect', '9:16', 'change');
        await until(async () => {
          const m = await scrubAgainstPicture();
          const picW = m.pic[1]! - m.pic[0]!;
          return picW > 0 && picW < 320 && Math.abs(m.scrub[1]! - m.scrub[0]! - 320) <= 0.5;
        }, 'the bar at its floor under the tall picture');
        lines = await scrubAgainstPicture();
        const picMid = (lines.pic[0]! + lines.pic[1]!) / 2;
        const scrubMid = (lines.scrub[0]! + lines.scrub[1]!) / 2;
        expect(Math.abs(scrubMid - picMid), 'the bar centered under the tall picture').toBeLessThanOrEqual(1);
        await fire('#opt-aspect', '16:9', 'change');
        await until(async () => {
          const m = await scrubAgainstPicture();
          return Math.abs(m.scrub[0]! - m.pic[0]!) <= 1 && Math.abs(m.scrub[1]! - m.pic[1]!) <= 1;
        }, 'the bar following the picture back to 16:9');

        // Theater: the button by the stage (and the bare T) folds the browse panel to its rail,
        // hides the results and closes the drawer, so the picture grows; off again, everything
        // comes back as it was — the panel, the results, the open drawer.
        await openTab('parameters');
        await until(() => page.eval<boolean>(`document.getElementById('app').classList.contains('inspector-open')`), 'the drawer open before theater');
        const pictureBefore = await page.eval<number>(`document.querySelector('#region-stage .preview-wrap').getBoundingClientRect().height`);
        await page.eval(`document.getElementById('theater').click()`);
        await until(() => page.eval<boolean>(
          `(() => { const c = document.getElementById('app').classList; return c.contains('results-collapsed') && c.contains('browse-collapsed') && !c.contains('inspector-open'); })()`,
        ), 'theater on: the rail, no results, no drawer');
        expect(await page.eval<string>(`document.getElementById('theater').getAttribute('aria-pressed')`)).toBe('true');
        const grown = await page.eval<number>(`document.querySelector('#region-stage .preview-wrap').getBoundingClientRect().height`);
        expect(grown, 'the picture grows in theater').toBeGreaterThan(pictureBefore + 100);
        await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }))`);
        await until(() => page.eval<boolean>(
          `(() => { const c = document.getElementById('app').classList; return !c.contains('results-collapsed') && !c.contains('browse-collapsed') && c.contains('inspector-open'); })()`,
        ), 'theater off: the panel, the results and the drawer back as they were');
        await page.eval(`document.getElementById('inspector-close').click()`);
        // Typing a t in the search field is typing, not theater.
        await page.eval(`(() => { const s = document.getElementById('search'); s.focus(); s.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true })); s.blur(); })()`);
        expect(await page.eval<boolean>(`document.getElementById('app').classList.contains('results-collapsed')`)).toBe(false);

        // The drawer rises over the results and only the results: the stage keeps its box.
        await openTab('output');
        await until(() => page.eval<boolean>(`document.getElementById('app').classList.contains('inspector-open')`), 'the drawer open');
        all = await boxes(['region-stage', 'region-results', 'region-inspector', 'region-transport']);
        const [stage2, results2, drawer, row] = all;
        expect(overlap(drawer!, stage2!), 'the drawer never covers the stage').toBe(0);
        expect(overlap(drawer!, row!), 'nor the transport row').toBe(0);
        expect(drawer!.left).toBeGreaterThanOrEqual(results2!.left - 1);
        expect(drawer!.right).toBeLessThanOrEqual(results2!.right + 1);
        expect(drawer!.bottom).toBeLessThanOrEqual(results2!.bottom + 1);
        await page.eval(`document.getElementById('inspector-close').click()`);

        // The tray appears with the first item (milestone 42) and, open, the results keep their floor
        // and stay clear of it — the list and the cards themselves, not just the region's box.
        await until(() => page.eval<boolean>(`!document.getElementById('add-to-collection').disabled`), 'the add button');
        await page.eval(`document.getElementById('add-to-collection').click()`);
        await until(() => page.eval<boolean>(`!document.getElementById('app').classList.contains('tray-empty')`), 'the tray in the window with its first item');
        await page.eval(`(() => { if (document.getElementById('app').classList.contains('tray-collapsed')) document.getElementById('tray-toggle').click(); return true; })()`);
        await until(() => page.eval<boolean>(`!document.getElementById('app').classList.contains('tray-collapsed')`), 'the tray open');
        await until(async () => {
          const m = await page.eval<{ regionH: number; sh: number }>(
            `(() => ({ regionH: document.getElementById('region-results').getBoundingClientRect().height, sh: document.documentElement.scrollHeight }))()`,
          );
          return m.regionH >= 184 && m.sh <= 788;
        }, 'the region at its floor with the tray open, nothing to scroll');
        await contained('with the tray open');
        all = await boxes(regions);
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i]!, all[j]!), `${all[i]!.id} does not overlap ${all[j]!.id} with the tray open`).toBeLessThanOrEqual(all.length);
        // And it goes with the last item, the results taking the height back; the open state is kept
        // for the next time it has something, not shown empty.
        await removeCollected();
        await until(() => page.eval<boolean>(`document.getElementById('app').classList.contains('tray-empty')`), 'the tray gone with its last item');
        expect(await page.eval<boolean>(`document.getElementById('app').classList.contains('tray-collapsed')`), 'the saved state untouched').toBe(false);
        const [resultsAgain, rowAgain] = await boxes(['region-results', 'region-transport']);
        expect(resultsAgain!.bottom).toBeCloseTo(rowAgain!.top, 0);
        await page.eval(`document.getElementById('tray-toggle').click()`);
        await until(() => page.eval<boolean>(`document.getElementById('app').classList.contains('tray-collapsed')`), 'the tray back to its default, collapsed');

        // A short window (milestone 42): the transport row's controls share one line, so the height the
        // second line took is the stage's — the scrub bar between the playback buttons and the tools,
        // the lanes under it in its column, the status still at the end, and nothing overlapping.
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 700, deviceScaleFactor: 1, mobile: false });
        await until(() => page.eval<boolean>(`window.innerHeight === 700`), 'the short window');
        await until(async () => (await scrubAgainstPicture()).buttonsTop < (await scrubAgainstPicture()).scrubTop + 10, 'the row on one line');
        const oneLine = await page.eval<{ row: number; scrub: Box; play: Box; tabs: Box; lanes: number[]; status: Box }>(
          `(() => { const r = (el) => { const b = el.getBoundingClientRect(); return { id: el.id, left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
            const c = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return [b.left + parseFloat(s.paddingLeft), b.right - parseFloat(s.paddingRight)]; };
            return { row: document.getElementById('region-transport').getBoundingClientRect().height, scrub: r(document.querySelector('#region-transport .scrub-wrap')),
              play: r(document.getElementById('play')), tabs: r(document.getElementById('tab-info')), lanes: c(document.querySelector('#region-transport .transport-lanes')), status: r(document.getElementById('region-status')) }; })()`,
        );
        // The row keeps its lanes' room and gives up the line: its setting read 36 px shorter.
        expect(oneLine.row, 'the row a line shorter than on two lines').toBeLessThanOrEqual(rowAtRest!.bottom - rowAtRest!.top - 30);
        expect(oneLine.scrub.left, 'the scrub bar after the playback buttons').toBeGreaterThan(oneLine.play.right);
        expect(oneLine.scrub.right, 'and before the tools').toBeLessThan(oneLine.tabs.left);
        expect(oneLine.lanes[0], 'the lanes under the scrub bar').toBeCloseTo(oneLine.scrub.left, 0);
        expect(oneLine.lanes[1]).toBeCloseTo(oneLine.scrub.right, 0);
        expect(oneLine.status.right, 'the status at the row\'s end').toBeGreaterThan(1280 - 24);
        expect(oneLine.scrub.right - oneLine.scrub.left, 'the scrub bar with room to scrub').toBeGreaterThanOrEqual(200);
        await heldApart('on one line');
        const shortDoc = await page.eval<{ sh: number; stage: number }>(`({ sh: document.documentElement.scrollHeight, stage: document.querySelector('#region-stage .preview-wrap').getBoundingClientRect().height })`);
        expect(shortDoc.sh, 'nothing to scroll').toBeLessThanOrEqual(700);
        expect(shortDoc.stage, 'the picture keeps its share').toBeGreaterThanOrEqual(700 * 0.38);
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 788, deviceScaleFactor: 1, mobile: false });
        await until(async () => (await scrubAgainstPicture()).buttonsTop > (await scrubAgainstPicture()).scrubTop + 10, 'the row back on two lines');
      } finally {
        await removeCollected();
        await page.send('Emulation.clearDeviceMetricsOverride', {});
      }
    }, 120_000);

    it('opens the inspector as a drawer from the transport row: tabs, Esc, the pin and the dots (milestone 38)', async () => {
      const open = () => page.eval<boolean>(`document.getElementById('app').classList.contains('inspector-open')`);
      const selected = (tab: string) => page.eval<string>("document.getElementById('tab-" + tab + "').getAttribute('aria-selected')");
      await clickResult('Lower Third Bar');
      expect(await open(), 'choosing a result does not open the drawer').toBe(false);

      // A tab opens the drawer; the same tab again closes it; another switches without closing.
      await page.eval(`document.getElementById('tab-output').click()`);
      await until(open, 'the drawer open on Output');
      expect(await selected('output')).toBe('true');
      await page.eval(`document.getElementById('tab-parameters').click()`);
      expect(await open()).toBe(true);
      expect(await selected('parameters')).toBe('true');
      await page.eval(`document.getElementById('tab-parameters').click()`);
      await until(async () => !(await open()), 'the same tab again closing it');

      // The last tab is remembered in settings.json; the height is a pane size like the others.
      await until(async () => {
        try {
          return (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { layout?: { inspectorTab?: string } }).layout?.inspectorTab === 'parameters';
        } catch {
          return false;
        }
      }, 'the last tab in settings.json');

      // Esc closes it too.
      await openTab('info');
      await until(open, 'the drawer open on Info');
      await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await until(async () => !(await open()), 'Esc closing the drawer');

      // Choosing another item closes an unpinned drawer; the pin holds it through a run of edits.
      await openTab('parameters');
      await clickResult('Title Card');
      await until(async () => !(await open()), 'choosing an item closing the unpinned drawer');
      await openTab('parameters');
      await page.eval(`document.getElementById('inspector-pin').click()`);
      await clickResult('Lower Third Bar');
      await sleep(300);
      expect(await open(), 'the pin holding the drawer open').toBe(true);
      await page.eval(`document.getElementById('inspector-pin').click()`);
      await page.eval(`document.getElementById('inspector-close').click()`);

      // A dot on Parameters says the shown item has edits; Output's says the options differ.
      const dotted = (tab: string) => page.eval<boolean>("document.getElementById('tab-" + tab + "').classList.contains('edited')");
      expect(await dotted('parameters')).toBe(false);
      await page.eval(`(() => { const el = document.querySelector('#params input[type="text"]'); el.value = 'Edited for the dot'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(() => dotted('parameters'), 'the dot on Parameters after an edit');
      expect(await dotted('output')).toBe(false);
      await fire('#opt-in', '00:00:01:00', 'input');
      await until(() => dotted('output'), 'the dot on Output after a trim');
      await fire('#opt-in', '', 'input');
      await until(async () => !(await dotted('output')), 'the dot gone with the trim');
      // Put the parameter back so later tests see the template's own words.
      await page.eval(`(() => { const reset = document.querySelector('#params .field-reset:not([hidden])'); if (reset) reset.click(); })()`);

      // Choosing a collection card is choosing to edit it: the drawer opens on Parameters.
      await until(() => page.eval<boolean>(`!document.getElementById('add-to-collection').disabled`), 'the add button');
      await page.eval(`document.getElementById('add-to-collection').click()`);
      await until(() => page.eval<number>(`document.querySelectorAll('#collection .collection-card').length`).then((n) => n > 0), 'the card in the collection');
      await page.eval(`document.querySelector('#collection .collection-card').click()`);
      await until(open, 'the drawer open from the collection card');
      expect(await selected('parameters')).toBe('true');
      await page.eval(`document.getElementById('inspector-close').click()`);
      // Leave the collection as it was found.
      await page.eval(`document.querySelector('#collection .collection-card button[aria-label="Remove from the collection"]').click()`);
      await until(() => page.eval<number>(`document.querySelectorAll('#collection .collection-card').length`).then((n) => n === 0), 'the collection empty again');
    }, 90_000);

    it('pops the stage out into a window of its own, still driven from the main window, and brings it back (milestone 43)', async () => {
      type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
      const boxIn = (session: Session, selector: string) =>
        session.eval<Box | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; })()`);
      // By its title: the app's own offscreen windows (thumbnails, posters) are pages too, and an idle
      // one sits at about:blank just as the stage's window does.
      const stageTarget = async () => (await targets()).find((t) => t.type === 'page' && t.id !== appTargetId && t.title === 'Stage');
      const settings = async () => (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { stageWindow?: { open: boolean; bounds: Box | null } }).stageWindow;
      let stage: Session | null = null;
      try {
        await clickResult('Lower Third Bar');
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview');

        // The button on the stage's corner: the stage leaves for a window of its own.
        await page.eval(`document.getElementById('stage-popout').click()`);
        let target: Target | undefined;
        await until(async () => {
          target = await stageTarget();
          return target !== undefined;
        }, 'the stage window');
        stage = await Session.connect(target!.webSocketDebuggerUrl);
        await stage.send('Runtime.enable');
        await until(() => stage!.eval<boolean>(`!!document.getElementById('region-stage') && !!document.getElementById('scrub') && !!document.getElementById('layer-bars')`), 'the stage, the scrub bar and the layer bars in the stage window');
        // Moved, not copied: the main window has none of them, and says the stage is out.
        expect(await page.eval<boolean>(`!document.getElementById('region-stage') && !document.getElementById('scrub')`), 'the main window has no second stage').toBe(true);
        expect(await page.eval<boolean>(`document.getElementById('app').classList.contains('stage-out')`)).toBe(true);
        // The stylesheet reached the window: the body is laid out as the picture over its timeline.
        await until(() => stage!.eval<boolean>(`getComputedStyle(document.body).display === 'flex' && document.querySelector('.stage-timeline') !== null`), 'the stage window styled');

        // The main window takes the room: the results fill the center, and the transport row is its
        // buttons line, with the toggle for a stage that is not here gone.
        const centre = (await boxIn(page, '.center'))!;
        const results = (await boxIn(page, '#region-results'))!;
        expect(results.top, 'the results start where the stage was').toBeLessThanOrEqual(centre.top + 1);
        expect(results.bottom).toBeGreaterThanOrEqual(centre.bottom - 1);
        expect((await boxIn(page, '#region-transport'))!.height, 'the row is one line').toBeLessThan(60);
        expect(await page.eval<string>(`getComputedStyle(document.getElementById('stage-toggle')).display`)).toBe('none');

        // Still driven from the main window: the picture reloads in its new window and plays; a card
        // chosen here shows there; the scrub bar there sits one to one under the picture.
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview ready again in its window');
        await clickResult('Title Card');
        await until(() => stage!.eval<boolean>(`document.getElementById('preview').src.includes('title-card')`), 'the chosen card on the popped-out stage');
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the new preview ready');
        await until(async () => {
          const pic = await boxIn(stage!, '#preview-frame');
          const scrub = await boxIn(stage!, '.scrub-wrap');
          return !!pic && !!scrub && pic.width > 100 && Math.abs(scrub.left - pic.left) <= 1 && Math.abs(scrub.right - pic.right) <= 1;
        }, 'the scrub bar lined up under the picture in the stage window');
        const frameBefore = await stage.eval<string>(`document.getElementById('preview-frame').dataset.frame`);
        await page.eval(`document.getElementById('step-forward').click()`);
        await until(async () => (await stage!.eval<string>(`document.getElementById('preview-frame').dataset.frame`)) !== frameBefore, 'a step from the main window moving the popped-out picture');
        // The menu reads the stage's controls where they are: Pop Out Stage is ticked.
        type Item = { label?: string; checked?: boolean; submenu?: Item[] };
        const popOutItem = async () => (await page.eval<{ label: string; items: Item[] }[]>(`window.pulp.menuSections()`)).find((s) => s.label === 'View')?.items.find((i) => i.label === 'Pop Out Stage');
        await until(async () => (await popOutItem())?.checked === true, 'the menu ticking Pop Out Stage');
        // Remembered: out, and where.
        await until(async () => (await settings())?.open === true && !!(await settings())?.bounds, 'the stage window remembered as out, with its place');

        // The window's own close puts the stage back first — nothing is lost with the window — and
        // the setting says it is in. The close is scheduled rather than called in the evaluation: a
        // window that goes before it answers leaves the evaluation waiting on a reply that never comes.
        // Even so, a slow runner can lose the reply as the window goes, so only what follows is held.
        await stage.eval(`setTimeout(() => window.close(), 0), true`).catch(() => undefined);
        await until(() => page.eval<boolean>(`!!document.getElementById('region-stage') && !!document.getElementById('scrub') && !document.getElementById('app').classList.contains('stage-out')`), 'the stage back in the main window');
        await until(async () => (await stageTarget()) === undefined, 'the stage window gone');
        stage = null;
        await until(async () => (await settings())?.open === false, 'remembered as in');
        expect(await page.eval<boolean>(`document.getElementById('scrub-line').nextElementSibling.id === 'transport-lanes' && document.getElementById('transport-lanes').nextElementSibling.classList.contains('buttons-line')`), 'the row\'s first line back above its buttons').toBe(true);
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview ready again at home');
        expect(await page.eval<string>(`getComputedStyle(document.getElementById('stage-toggle')).display`)).not.toBe('none');

        // View → Stage on Display lists the connected displays, and choosing one pops the stage out
        // and fills that display with it. Whether full screen was granted is what the main process
        // says it did, not a guess from the platform name: a Linux session with no window manager
        // grants none, and a Mac with one display grants it only once the window is up and in front
        // — which is why the ask is verified and repeated there rather than fired once.
        const displayItems = async () => (await page.eval<{ label: string; items: Item[] }[]>(`window.pulp.menuSections()`)).find((s) => s.label === 'View')?.items.find((i) => i.label === 'Stage on Display')?.submenu ?? [];
        const displays = await displayItems();
        expect(displays.length, 'one item per connected display').toBeGreaterThanOrEqual(1);
        const first = displays[0] as Item & { arg?: string };
        expect(first.label).toMatch(/\d+ × \d+/);
        expect(Number(first.arg)).not.toBeNaN();
        await page.eval(`window.pulpMenuCommand('view.stageOnDisplay', ${JSON.stringify(first.arg)})`);
        await until(async () => (await stageTarget()) !== undefined, 'the stage out for the chosen display');
        stage = await Session.connect((await stageTarget())!.webSocketDebuggerUrl);
        await stage.send('Runtime.enable');
        // The stage is on that display either way; the picture fills it where full screen is granted.
        const lastOnDisplay = () => page.eval<{ moved: boolean; fullScreen: boolean } | null>(`window.pulpLastStageOnDisplay?.() ?? null`);
        await until(async () => (await lastOnDisplay()) !== null, 'the display answered for');
        const onDisplay = (await lastOnDisplay())!;
        expect(onDisplay.moved, 'the stage moved to the chosen display').toBe(true);
        if (onDisplay.fullScreen) {
          await until(() => stage!.eval<boolean>(`document.getElementById('theater')?.getAttribute('aria-pressed') === 'true'`), 'the stage window full screen on the chosen display');
          // Theater off is the way back from full screen, by the same key the main window uses.
          await page.eval(`window.pulpMenuCommand('view.theater')`);
          await until(() => stage!.eval<boolean>(`document.getElementById('theater')?.getAttribute('aria-pressed') === 'false'`), 'the stage window back from full screen');
        } else {
          console.info('This session did not grant the stage window full screen; the move to the display is all that is held here.');
        }
        await page.eval(`window.pulpMenuCommand('view.popOut')`);
        await until(() => page.eval<boolean>(`!!document.getElementById('region-stage') && !document.getElementById('app').classList.contains('stage-out')`), 'the stage back from the chosen display');
        await until(async () => (await stageTarget()) === undefined, 'that window gone');
        stage = null;

        // Out again from the menu, and back by the same button where it now is: in the stage window.
        await page.eval(`window.pulpMenuCommand('view.popOut')`);
        await until(async () => (await stageTarget()) !== undefined, 'the stage window from the menu');
        stage = await Session.connect((await stageTarget())!.webSocketDebuggerUrl);
        await stage.send('Runtime.enable');
        await until(() => stage!.eval<boolean>(`!!document.getElementById('stage-popout')`), 'the button in the stage window');
        expect(await stage.eval<string>(`document.getElementById('stage-popout').getAttribute('aria-label')`)).toBe('Bring the stage back');
        await stage.eval(`document.getElementById('stage-popout').click()`);
        await until(() => page.eval<boolean>(`!!document.getElementById('region-stage') && !document.getElementById('app').classList.contains('stage-out')`), 'the stage back by its button');
        await until(async () => (await stageTarget()) === undefined, 'the stage window gone again');
        stage = null;
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview ready once more');
        await clickResult('Lower Third Bar');
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview the tests after this expect');
      } finally {
        stage?.close();
        // Whatever happened, the tests after this want the stage at home.
        await page.eval(`(() => { if (document.getElementById('app').classList.contains('stage-out')) window.pulpMenuCommand('view.popOut'); })()`);
        await until(() => page.eval<boolean>(`!!document.getElementById('region-stage')`), 'the stage at home');
      }
    }, 120_000);

    it('puts the transport row across the bottom of the window, above the status bar, resizable and remembered (milestone 37)', async () => {
      type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
      const box = (id: string) =>
        page.eval<Box>(`(() => { const b = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; })()`);

      // What plays or moves through time is in the row — with Add to collection and the inspector's
      // tabs (milestone 38); what views the picture is an overlay on the stage's corner.
      const inRow = ['play', 'step-back', 'step-forward', 'loop', 'scrub', 'timecode', 'mark-in', 'mark-out', 'mark-clear', 'volume', 'mute', 'audition', 'layer-bars', 'length-handle', 'sequence-rate', 'add-to-collection', 'tab-parameters', 'tab-output', 'tab-info'];
      const onStage = ['preview-frame', 'bg-button', 'bg-checker', 'bg-black', 'bg-white', 'bg-custom', 'safe-toggle'];
      const where = await page.eval<Record<string, string>>(
        `(() => { const out = {}; for (const id of ${JSON.stringify([...inRow, ...onStage])}) { const el = document.getElementById(id); out[id] = !el ? 'missing' : el.closest('#region-transport') ? 'transport' : el.closest('#region-stage') ? 'stage' : 'elsewhere'; } return out; })()`,
      );
      for (const id of inRow) expect(where[id], `#${id}`).toBe('transport');
      for (const id of onStage) expect(where[id], `#${id}`).toBe('stage');

      // From the top, the bottom of the window reads: the tray (when it has something in it), then the
      // transport row, with the status items at the row's end (milestone 42) — and the row spans the window.
      const [app, tray, row, status] = await Promise.all([box('app'), box('region-tray'), box('region-transport'), box('region-status')]);
      expect(row.top, 'the row is under the tray').toBeGreaterThanOrEqual(tray.bottom - 1);
      expect(row.bottom, 'and at the window\'s bottom edge').toBeCloseTo(app.bottom, 0);
      expect(status.top, 'the status inside the row').toBeGreaterThanOrEqual(row.top - 0.5);
      expect(status.bottom).toBeLessThanOrEqual(row.bottom + 0.5);
      expect(status.right, 'at the row\'s end').toBeGreaterThan(row.right - 24);
      expect(row.left, 'spanning the window').toBeCloseTo(app.left, 0);
      expect(row.right).toBeCloseTo(app.right, 0);

      // The lanes for the bars per layer share the scrub bar's grid column, so they line up with its time by
      // construction: the lanes' content box (their padding is room for the end handles) is the scrub bar's box.
      const edges = await page.eval<{ scrub: Box; lanes: Box }>(
        `(() => { const r = (el) => { const b = el.getBoundingClientRect(); const c = getComputedStyle(el); return { left: b.left + parseFloat(c.paddingLeft), right: b.right - parseFloat(c.paddingRight) }; };
          return { scrub: r(document.querySelector('#region-transport .scrub-wrap')), lanes: r(document.querySelector('#region-transport .transport-lanes')) }; })()`,
      );
      expect(edges.lanes.left).toBeCloseTo(edges.scrub.left, 0);
      expect(edges.lanes.right).toBeCloseTo(edges.scrub.right, 0);

      // The row resizes from its top edge, by the keyboard as the other panes do, and the height is remembered.
      // The setting is read off the shell's custom property: on a short window (the CI runner's) the row
      // yields below its setting, so its box is a floor on the setting rather than the setting itself.
      const setting = () => page.eval<number>(`parseFloat(getComputedStyle(document.getElementById('app')).getPropertyValue('--transport-h'))`);
      const before = row.height;
      const was = await setting();
      expect(before).toBeLessThanOrEqual(was + 0.5);
      const squeeze = (key: 'ArrowUp' | 'ArrowDown', times: number) =>
        page.eval(`(() => { const s = document.getElementById('split-transport'); for (let i = 0; i < ${times}; i++) s.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true })); })()`);
      try {
        await squeeze('ArrowDown', 2);
        await until(async () => (await setting()) === was + 32, 'the row\'s setting up by two steps');
        expect((await box('region-transport')).height).toBeGreaterThanOrEqual(before - 0.5);
        await until(async () => {
          try {
            return (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { layout?: { transportHeight?: number } }).layout?.transportHeight === was + 32;
          } catch {
            return false;
          }
        }, 'the row\'s height in settings.json');
      } finally {
        await squeeze('ArrowUp', 2);
      }
      await until(async () => (await setting()) === was, 'the row back at its setting');
      await until(async () => Math.abs((await box('region-transport')).height - before) < 1, 'the row back at its height');

      // A still has no time: the row shows no scrub bar, is disabled, and keeps its place.
      await clickResult('tiny');
      await until(() => page.eval<boolean>(`document.getElementById('region-transport').classList.contains('still')`), 'the row told it shows a still');
      expect(await page.eval<string>(`getComputedStyle(document.querySelector('#region-transport .scrub-wrap')).visibility`)).toBe('hidden');
      expect(await page.eval<boolean>(`document.getElementById('play').disabled`)).toBe(true);
      expect(await page.eval<string>(`document.getElementById('timecode').textContent`)).toBe('--');
      expect((await box('region-transport')).height).toBeCloseTo(before, 0);
      // And a template has the bar back.
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview');
      expect(await page.eval<boolean>(`document.getElementById('region-transport').classList.contains('still')`)).toBe(false);
      expect(await page.eval<string>(`getComputedStyle(document.querySelector('#region-transport .scrub-wrap')).visibility`)).toBe('visible');
    }, 90_000);
  });

  describe('template packs', () => {
    const html = Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head><body><canvas id="c" width="320" height="180"></canvas><script>window.pulpRender=function(){};</script></body></html>');
    const tpl = (over: Record<string, unknown>) => Buffer.from(JSON.stringify(rawManifest({ width: 320, height: 180, ...over })));
    const dialogText = (sel: string) => page.eval<string>(`document.querySelector(${JSON.stringify(sel)}).textContent`);

    it('previews a pack with licenses and collisions, installs it into user data, and the templates appear', async () => {
      const zip = writeZip([
        { name: 'pack.json', data: Buffer.from(JSON.stringify({ formatVersion: 1, name: 'News Pack', author: 'Ada', license: 'CC0-1.0', templates: ['strap', 'bug', 'dupe'] })) },
        { name: 'strap/template.json', data: tpl({ id: 'news.strap', name: 'News Strap', license: 'MIT' }) },
        { name: 'strap/index.html', data: html },
        { name: 'bug/template.json', data: tpl({ id: 'news.bug', name: 'Channel Bug', license: 'Acme-EULA' }) },
        { name: 'bug/index.html', data: html },
        // Collides with a bundled template: must be skipped, never replaced.
        { name: 'dupe/template.json', data: tpl({ id: 'pulp.samples.title-card', name: 'Not The Title Card' }) },
        { name: 'dupe/index.html', data: html },
      ]);
      const zipPath = join(userData, 'news-pack.zip');
      await writeFile(zipPath, zip);

      await page.eval(`window.pulpPreviewPack(${JSON.stringify(zipPath)})`);
      await until(() => page.eval<boolean>(`document.getElementById('pack-dialog').open`), 'the pack dialog');
      expect(await dialogText('#pack-title')).toBe('News Pack');
      expect(await dialogText('#pack-meta')).toContain('by Ada · license CC0-1.0');
      expect(await page.eval<boolean>(`document.getElementById('pack-license').hidden`)).toBe(true);
      const rows = await page.eval<{ folder: string; statuses: string[] }[]>(
        `[...document.querySelectorAll('#pack-templates li')].map((li) => ({ folder: li.dataset.folder, statuses: [...li.querySelectorAll('.status')].map((s) => s.textContent) }))`,
      );
      expect(rows.map((r) => r.folder)).toEqual(['strap', 'bug', 'dupe']);
      expect(rows[0]!.statuses).toEqual(['Will install into packs/news-pack/strap.']);
      expect(rows[1]!.statuses[0]).toBe('Will install into packs/news-pack/bug.');
      expect(rows[1]!.statuses[1]).toContain('license "Acme-EULA" is not in the known open list');
      expect(rows[2]!.statuses[0]).toMatch(/^Skipped: a template with this id is already in your library/);
      expect(await page.eval<boolean>(`document.getElementById('pack-confirm').disabled`)).toBe(false);

      await page.eval(`document.getElementById('pack-confirm').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('pack-result').textContent.includes('Installed')`), 'the install to finish');
      const result = await dialogText('#pack-result');
      expect(result).toContain('Installed: strap, bug.');
      expect(result).toContain('Skipped: dupe');
      expect(result).toContain(join(userData, 'packs', 'news-pack'));
      expect(existsSync(join(userData, 'packs', 'news-pack', 'strap', 'index.html'))).toBe(true);
      expect(existsSync(join(userData, 'packs', 'news-pack', 'pack.json'))).toBe(true);
      expect(existsSync(join(userData, 'packs', 'news-pack', 'dupe'))).toBe(false);
      await page.eval(`document.getElementById('pack-close').click()`);
      await until(async () => (await resultNames()).includes('News Strap'), 'the installed templates in the library');
      const listed = await resultNames();
      expect(listed).toContain('Channel Bug');
      // The bundled title card is untouched: the installed pack brought no second one.
      expect(listed.filter((n) => n === 'Title Card')).toHaveLength(1);
      // The installed pack appears in the browse tree, counting its templates; the bundled
      // matched sets are there as well, each counting what its pack.json lists.
      await findCategory('News Pack');
      await until(() => page.eval<boolean>(`!!document.querySelector('#browse-tree .browse-node[data-filter="pack:news-pack"]')`), 'the installed pack in the browse tree');
      expect(Number(await page.eval<string>(`document.querySelector('#browse-tree .browse-node[data-filter="pack:news-pack"]').dataset.count`))).toBe(2);
      for (const slug of ['boardroom', 'newsdesk', 'matchday', 'festival']) {
        const pack = JSON.parse(await readFile(join(__dirname, '..', '..', 'templates', slug, 'pack.json'), 'utf8')) as { name: string; templates: string[] };
        await findCategory(pack.name);
        await until(() => page.eval<boolean>(`!!document.querySelector('#browse-tree .browse-node[data-filter="pack:${slug}"]')`), `${slug} in the tree`);
        expect(Number(await page.eval<string>(`document.querySelector('#browse-tree .browse-node[data-filter="pack:${slug}"]').dataset.count`)), slug).toBe(pack.templates.length);
      }
      await clearFindField();
    }, 90_000);

    it('offers Replace only for templates installed from a pack, and refuses a broken zip with a plain message', async () => {
      const zip = writeZip([
        { name: 'pack.json', data: Buffer.from(JSON.stringify({ formatVersion: 1, name: 'News Pack', license: 'UNLICENSED', templates: ['strap'] })) },
        { name: 'strap/template.json', data: tpl({ id: 'news.strap', name: 'News Strap v2', license: 'MIT' }) },
        { name: 'strap/index.html', data: html },
      ]);
      const zipPath = join(userData, 'news-pack-2.zip');
      await writeFile(zipPath, zip);
      await page.eval(`window.pulpPreviewPack(${JSON.stringify(zipPath)})`);
      await until(() => page.eval<boolean>(`document.getElementById('pack-dialog').open && document.getElementById('pack-title').textContent === 'News Pack'`), 'the second preview');
      expect(await dialogText('#pack-license')).toBe('Pack license: not an open license.');
      expect(await page.eval<boolean>(`!!document.querySelector('#pack-templates li[data-folder=strap] select')`)).toBe(true);
      expect(await dialogText('#pack-templates li[data-folder=strap] .status')).toContain('Already installed from a pack.');
      // Default keeps the installed copy; choose Replace.
      await page.eval(`(() => { const s = document.querySelector('#pack-templates li[data-folder=strap] select'); s.value = 'replace'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`document.getElementById('pack-confirm').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('pack-result').textContent.includes('Replaced')`), 'the replace to finish');
      expect(await dialogText('#pack-result')).toContain('Replaced: strap.');
      await page.eval(`document.getElementById('pack-close').click()`);
      await until(async () => (await resultNames()).includes('News Strap v2'), 'the replaced template name');

      await writeFile(join(userData, 'broken.zip'), Buffer.from('this is not a zip'));
      await page.eval(`window.pulpPreviewPack(${JSON.stringify(join(userData, 'broken.zip'))})`);
      await until(() => page.eval<boolean>(`document.getElementById('pack-problems').textContent.includes('Not a usable pack')`), 'the error for a broken zip');
      expect(await page.eval<boolean>(`document.getElementById('pack-confirm').hidden`)).toBe(true);
      await page.eval(`document.getElementById('pack-close').click()`);
    }, 90_000);

    it('brings things in through one Add menu that names them, and sends them out from the results (milestone 47)', async () => {
      // The browse panel's header is Add, Rescan, Record (milestone 63) and the camera (milestone 64): the
      // four add/import/export buttons are gone, and the live acts — not choosers — stand beside Add.
      const toolbar = await page.eval<string[]>(`[...document.querySelectorAll('.sidebar-actions button')].map((b) => b.id)`);
      expect(toolbar).toEqual(['library-add', 'rescan', 'record-audio', 'record-input', 'record-video']);
      // Export is not among them; it acts on the templates the results list, so it is in their heading.
      expect(await page.eval<boolean>(`!!document.querySelector('#region-results .results-head #export-pack')`), 'Export in the results heading').toBe(true);

      // Add opens a menu naming what each choice brings in, in the words the application menu uses.
      await page.eval(`document.getElementById('library-add').click()`);
      await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu button')`), 'the Add menu');
      const items = await page.eval<string[]>(`[...document.querySelectorAll('.context-menu > button .item-label')].map((b) => b.textContent.trim())`);
      expect(items).toEqual(['Your Media Folder…', 'Templates from a Pack…', 'Sample Media']);
      // Each says what it brings, under its name.
      const details = await page.eval<string[]>(`[...document.querySelectorAll('.context-menu > button .item-detail')].map((b) => b.textContent.trim())`);
      expect(details[0]).toContain('indexed where they are');
      expect(details[1]).toContain('installed');
      expect(details[2]).toContain('made and added');
      // And it is the same list File → Add offers.
      type Item = { label?: string; submenu?: Item[] };
      const fileAdd = (await page.eval<{ label: string; items: Item[] }[]>(`window.pulp.menuSections()`))
        .find((s) => s.label === 'File')?.items.find((i) => i.label === 'Add');
      expect(fileAdd?.submenu?.map((i) => i.label)).toEqual(items);

      // Choosing one runs it: Templates from a pack opens the pack chooser, which cannot be driven
      // here, so the menu is closed instead and the choice checked through the command it names.
      await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await until(async () => !(await page.eval<boolean>(`!!document.querySelector('.context-menu button')`)), 'the menu closed by Escape');

      // The start screen and the empty results call the same things by the same names.
      const startWords = await page.eval<string[]>(`['start-add-folder', 'start-import-pack', 'start-sample-media'].map((id) => document.getElementById(id).textContent.trim())`);
      expect(startWords).toEqual(['Your media folder…', 'Templates from a pack…', 'Sample media…']);
    }, 60_000);

    it('export is offered for the listed templates with a pack name and license', async () => {
      await page.eval(`(() => { const s = document.getElementById('search'); s.value = 'pack:news-pack'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      try {
        expect(await page.eval<boolean>(`document.getElementById('export-pack').disabled`)).toBe(false);
        await page.eval(`document.getElementById('export-pack').click()`);
        await until(() => page.eval<boolean>(`document.getElementById('pack-dialog').open && !document.getElementById('pack-export-fields').hidden`), 'the export dialog');
        expect(await dialogText('#pack-title')).toBe('Export 2 templates as a pack');
        expect(await page.eval<string>(`document.getElementById('pack-export-license').value`)).toBe('CC0-1.0');
        expect(await page.eval<number>(`document.querySelectorAll('#pack-templates li').length`)).toBe(2);
        // The save dialog itself cannot be driven here; close without exporting.
        await page.eval(`document.getElementById('pack-close').click()`);
      } finally {
        await page.eval(`(() => { const s = document.getElementById('search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      }
    }, 60_000);
  });

  describe('tags, favorites and recently used', () => {
    const setSearch = (q: string) => page.eval(`(() => { const s = document.getElementById('search'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);

    it('adds and removes user tags on the shown item, searchable with tag:', async () => {
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('item-tools').hidden`), 'the item tools');
      await page.eval(`(() => { const i = document.getElementById('tag-input'); i.value = 'Show A, keeper'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      await until(() => page.eval<boolean>(`!!document.querySelector('#tag-chips .tag-chip.user[data-tag=show-a]')`), 'the new tag chips');
      expect(await page.eval<string[]>(`[...document.querySelectorAll('#tag-chips .tag-chip.user')].map((c) => c.dataset.tag)`)).toEqual(['show-a', 'keeper']);
      // Manifest tags are shown but not removable.
      expect(await page.eval<boolean>(`!!document.querySelector('#tag-chips .tag-chip.folder[data-tag=interview]') && !document.querySelector('#tag-chips .tag-chip.folder[data-tag=interview] button')`)).toBe(true);
      try {
        await setSearch('tag:show-a');
        expect(await resultNames()).toEqual(['Lower Third Bar']);
      } finally {
        await setSearch('');
      }
      await page.eval(`document.querySelector('#tag-chips .tag-chip.user[data-tag=keeper] button').click()`);
      await until(() => page.eval<boolean>(`!document.querySelector('#tag-chips .tag-chip[data-tag=keeper]')`), 'the tag to be removed');
      expect(await page.eval<string[]>(`[...document.querySelectorAll('#tag-chips .tag-chip.user')].map((c) => c.dataset.tag)`)).toEqual(['show-a']);
    }, 60_000);

    it('toggles favorite, lists favorites and recently used, and keeps it all in the library database', async () => {
      await page.eval(`document.getElementById('favorite').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('favorite').getAttribute('aria-pressed') === 'true'`), 'the favorite to be set');
      try {
        await setSearch('favorite:yes');
        expect(await resultNames()).toEqual(['Lower Third Bar']);
        expect(await page.eval<boolean>(`!document.querySelector('#results li .fav').hidden`)).toBe(true);
        // Selecting marked the lower third used; select the title card too, so it is the most recent.
        await setSearch('');
        await clickResult('Title Card');
        await until(() => page.eval<boolean>(`document.querySelector('#params .layers-block[data-block=card]') !== null`), 'the title card form');
        await setSearch('recent:2 type:template');
        await until(async () => (await resultNames())[0] === 'Title Card', 'the recent list to update');
        expect(await resultNames()).toEqual(['Title Card', 'Lower Third Bar']);
      } finally {
        await setSearch(''); // never leave a filter behind for the next test
      }

      // The user data is in the scratch library.sqlite, apart from the scan results.
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(join(userData, 'library.sqlite'), { readOnly: true });
      try {
        const rows = db.prepare('SELECT key, tags, favorite, last_used FROM user_items ORDER BY key').all() as { key: string; tags: string; favorite: number; last_used: string | null }[];
        const lt = rows.find((r) => r.key.endsWith('lower-third-bar'))!;
        expect(JSON.parse(lt.tags)).toEqual(['show-a']);
        expect(lt.favorite).toBe(1);
        expect(lt.last_used).toMatch(/^\d{4}-/);
        expect(rows.find((r) => r.key.endsWith('title-card'))?.last_used).toMatch(/^\d{4}-/);
      } finally {
        db.close();
      }
    }, 60_000);
  });

  describe('media preview through pulp-media://', () => {
    const selectMedia = async (name: string) => {
      await onResult(name, `(li) => { if (li.dataset.kind !== 'media') throw new Error('${name} is not a media item'); li.click(); }`);
    };

    it('shows an image from the library, addressed by id', async () => {
      await selectMedia('tiny');
      await until(() => page.eval<boolean>(`(() => { const i = document.getElementById('media-image'); return !i.hidden && i.complete && i.naturalWidth > 0; })()`), 'the image to load');
      const src = await page.eval<string>(`document.getElementById('media-image').src`);
      expect(src).toMatch(/^pulp-media:\/\/[0-9a-f]{24}\/$/);
      expect(src).not.toContain('tiny');
      expect(await page.eval<number>(`document.getElementById('media-image').naturalWidth`)).toBe(2);
      expect(await page.eval<boolean>(`document.getElementById('preview').hasAttribute('src')`)).toBe(false);
    }, 60_000);

    it('shows a layered Photoshop file as its composite, lists its layers, and follows a layer being hidden (milestone 33)', async () => {
      await selectMedia('layered');
      const image = () => page.eval<{ src: string; width: number; loaded: boolean }>(`(() => { const i = document.getElementById('media-image'); return { src: i.src, width: i.naturalWidth, loaded: !i.hidden && i.complete && i.naturalWidth > 0 }; })()`);
      await until(async () => (await image()).loaded, 'the composite to load');
      const first = await image();
      // Served as a PNG made from the file, by id, never by path.
      expect(first.src).toMatch(/^pulp-media:\/\/[0-9a-f]{24}\/composite$/);
      expect(first.width).toBe(8);

      // The Info tab lists the layers, top first, groups as groups, the file's own visibility as the boxes.
      await openTab('info');
      await until(async () => (await page.eval<number>(`document.querySelectorAll('#info-item [data-section=layers] .psd-layer').length`)) === 4, 'the layer list');
      const rows = await page.eval<{ id: string; name: string; group: boolean; checked: boolean }[]>(
        `[...document.querySelectorAll('#info-item [data-section=layers] .psd-layer')].map((li) => ({ id: li.dataset.layer, name: li.querySelector('.name').textContent, group: li.classList.contains('group'), checked: li.querySelector('input').checked }))`,
      );
      expect(rows).toEqual([
        { id: 'L3', name: 'Green mark', group: false, checked: false },
        { id: 'L2', name: 'Blue mark', group: false, checked: true },
        { id: 'L1', name: 'Marks', group: true, checked: true },
        { id: 'L0', name: 'Backdrop', group: false, checked: true },
      ]);

      // Hiding the backdrop: the stage asks for the picture with that layer left out.
      await page.eval(`document.querySelector('#info-item [data-section=layers] .psd-layer[data-layer="L0"] input').click()`);
      await until(async () => (await image()).src.includes('hide='), 'the stage to follow');
      const hidden = await image();
      expect(hidden.src).toMatch(/\/composite\?hide=L0\+L3$/);
      await until(async () => (await image()).loaded, 'the new composite to load');
      // Added to the collection unplaced, the item keeps the picture it was collected as: the hidden
      // list goes with it, the card says so and shows that composite, and choosing the card later
      // brings the list back (the follow-up to milestone 33).
      await page.eval(`(() => { if (document.getElementById('app').classList.contains('tray-collapsed')) document.getElementById('tray-toggle').click(); })()`);
      await page.eval(`document.getElementById('add-to-collection').click()`);
      const card = `[...document.querySelectorAll('#collection .collection-card')].find((c) => c.querySelector('.job-name').textContent === 'layered')`;
      await until(() => page.eval<boolean>(`!!${card}`), 'the collected card');
      expect(await page.eval<string>(`${card}.querySelector('.job-status').textContent`)).toContain('2 layers hidden');
      expect(await page.eval<string>(`${card}.querySelector('.job-thumb img').src`)).toMatch(/\/composite\?hide=L0\+L3$/);

      // Showing the backdrop again goes back to the file's own picture; the card keeps what it was collected with.
      await page.eval(`document.querySelector('#info-item [data-section=layers] .psd-layer[data-layer="L0"] input').click()`);
      await until(async () => /\/composite\?hide=L3$/.test((await image()).src), 'the file\'s own hidden list again');
      expect(await page.eval<string>(`${card}.querySelector('.job-thumb img').src`)).toMatch(/\/composite\?hide=L0\+L3$/);

      // Choosing the card brings its hidden list back into the session, and the stage follows.
      await page.eval(`${card}.click()`);
      await until(async () => /\/composite\?hide=L0\+L3$/.test((await image()).src), 'the collected picture back on the stage');
      await page.eval(`document.getElementById('editing-done').click()`);
      // Left as the file has it for the tests that follow.
      await page.eval(`document.querySelector('#info-item [data-section=layers] .psd-layer[data-layer="L0"] input').click()`);
      await until(async () => /\/composite\?hide=L3$/.test((await image()).src), 'the file\'s own picture again');
      await page.eval(`${card}.querySelector('button[aria-label="Remove from the collection"]').click()`);
      await until(() => page.eval<boolean>(`!${card}`), 'the card removed');
      await openTab('parameters');
    }, 60_000);

    it('reads OpenRaster, SVG and PDF as layers too, and names what it cannot read (milestone 33)', async () => {
      const image = () => page.eval<{ src: string; width: number; loaded: boolean }>(`(() => { const i = document.getElementById('media-image'); return { src: i.src, width: i.naturalWidth, loaded: !i.hidden && i.complete && i.naturalWidth > 0 }; })()`);
      const layerRows = () => page.eval<{ id: string; name: string; checked: boolean; disabled: boolean }[]>(
        `[...document.querySelectorAll('#info-item [data-section=layers] .psd-layer')].map((li) => ({ id: li.dataset.layer, name: li.querySelector('.name').textContent, checked: li.querySelector('input').checked, disabled: li.querySelector('input').disabled }))`,
      );

      // An SVG's top-level groups are its layers; a hidden one really shows when its box is ticked.
      await selectMedia('grouped');
      await until(async () => (await image()).loaded, 'the SVG composite, rasterized by the renderer');
      expect((await image()).src).toMatch(/\/composite$/);
      expect((await image()).width).toBe(80);
      await openTab('info');
      await until(async () => (await layerRows()).length === 2, 'the SVG layer list');
      expect(await layerRows()).toEqual([
        { id: 'L1', name: 'Badge', checked: false, disabled: false },
        { id: 'L0', name: 'Backplate', checked: true, disabled: false },
      ]);
      await page.eval(`document.querySelector('#info-item [data-section=layers] .psd-layer[data-layer="L1"] input').click()`);
      await until(async () => /\/composite\?hide=$/.test((await image()).src) || /\/composite$/.test((await image()).src), 'every layer shown');
      await until(async () => (await image()).loaded, 'the recomposited SVG');

      // An OpenRaster reads exactly as the Photoshop file does: groups, visibility, toggling.
      await selectMedia('painted');
      await until(async () => (await layerRows()).length === 4, 'the OpenRaster layer list');
      expect((await layerRows()).map((r) => r.name)).toEqual(['Marks', 'Green mark', 'Blue mark', 'Backdrop']);
      await until(async () => (await image()).loaded, 'the OpenRaster composite');
      expect((await image()).width).toBe(8);

      // A PDF's optional content groups are its layers; the one the file switches off starts unchecked.
      await selectMedia('drawn');
      await until(async () => (await layerRows()).length === 2, `the PDF layer list (section says: ${await page.eval<string>(`document.querySelector('#info-item [data-section=layers]')?.textContent ?? '(no section)'`)})`, 60_000);
      const pdfRows = await layerRows();
      expect(pdfRows.find((r) => r.name === 'Backdrop')).toMatchObject({ checked: true, disabled: false });
      expect(pdfRows.find((r) => r.name === 'Mark')).toMatchObject({ checked: false });
      await until(async () => (await image()).loaded, 'the PDF composite, drawn by pdf.js', 60_000);
      expect((await image()).width).toBe(133); // 100 points at 96 per inch
      // Showing the switched-off group recomposites.
      const markRow = pdfRows.find((r) => r.name === 'Mark')!;
      await page.eval(`document.querySelector('#info-item [data-section=layers] .psd-layer[data-layer="${markRow.id}"] input').click()`);
      await until(async () => (await image()).src.includes('/composite?hide=') || /composite$/.test((await image()).src), 'the PDF recomposited');
      await until(async () => (await image()).loaded, 'the new PDF picture', 60_000);

      // A Sketch file in the folder is named with the export that works, not skipped silently.
      const problems = await page.eval<string[]>(`[...document.querySelectorAll('#library-summary .problem')].map((p) => p.textContent)`);
      expect(problems.some((p) => p.includes('Sketch') && p.includes('export'))).toBe(true);
      await openTab('parameters');
    }, 180_000);

        it('plays and seeks a video, which needs byte ranges', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available to make a test video; video preview check skipped.');
        return;
      }
      await selectMedia('clip');
      await until(() => page.eval<boolean>(`(() => { const v = document.getElementById('media-video'); return !v.hidden && v.readyState >= 1; })()`), 'video metadata');
      const duration = await page.eval<number>(`document.getElementById('media-video').duration`);
      expect(Math.abs(duration - 2)).toBeLessThan(0.3);

      // The transport row plays it (milestone 37): the element has no controls of its own, and the row
      // counts the clip in frames, plays and pauses it, seeks it from the scrub bar and steps it a frame.
      expect(await page.eval<boolean>(`document.getElementById('media-video').controls`)).toBe(false);
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled && Number(document.getElementById('scrub').max) > 0`), 'the row counting the clip');
      const frames = await page.eval<number>(`Number(document.getElementById('scrub').max) + 1`);
      expect(await page.eval<string>(`document.getElementById('timecode').textContent`)).toContain(`/${frames}`);
      await page.eval(`document.getElementById('play').click()`);
      await until(() => page.eval<boolean>(`!document.getElementById('media-video').paused && document.getElementById('play').getAttribute('aria-label') === 'Pause'`), 'the clip playing from the row');
      await page.eval(`document.getElementById('play').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('media-video').paused && document.getElementById('play').getAttribute('aria-label') === 'Play'`), 'the clip paused from the row');
      await page.eval(`(() => { const el = document.getElementById('scrub'); el.value = String(Math.floor(${frames} / 2)); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await until(() => page.eval<boolean>(`Math.abs(document.getElementById('media-video').currentTime - ${duration} / 2) < 0.15`), 'the seek from the scrub bar');
      const at = await page.eval<number>(`document.getElementById('media-video').currentTime`);
      await page.eval(`document.getElementById('step-forward').click()`);
      await until(() => page.eval<boolean>(`(() => { const t = document.getElementById('media-video').currentTime; return t > ${at} + 0.01 && t < ${at} + 0.2; })()`), 'one frame on');

      await page.eval(`document.getElementById('media-video').currentTime = 1.5`);
      await until(() => page.eval<boolean>(`(() => { const v = document.getElementById('media-video'); return !v.seeking && Math.abs(v.currentTime - 1.5) < 0.2 && v.readyState >= 2; })()`), 'the seek to finish');
    }, 60_000);

    it('fills in ffprobe metadata in the background and filters by it', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available; metadata check skipped.');
        return;
      }
      // Probing runs in the background; the card badges what it found as soon as it lands.
      await until(() => onResult<boolean>('clip', '(li) => !!li.querySelector(".badge.resolution")'), 'probed metadata to reach the results', 30_000);
      const badges = await onResult<string[]>('clip', '(li) => [...li.querySelectorAll(".badge")].map((b) => b.textContent)');
      expect(badges, 'the resolution as a tag; the length is not in the row any more').toEqual(['36p']);
      // The length is a clock reading in a pill over the thumbnail's corner (milestone 66), and a still has none.
      const pill = (name: string) => onResult<{ text: string; inThumb: boolean; corner: boolean } | null>(name, `(li) => {
        const p = li.querySelector('.thumb-time'); if (!p) return null;
        const t = li.querySelector('.thumb').getBoundingClientRect(), b = p.getBoundingClientRect();
        return { text: p.textContent, inThumb: !!p.closest('.thumb'), corner: t.right - b.right < 8 && t.bottom - b.bottom < 8 && b.left > t.left + t.width / 2 };
      }`);
      expect(await pill('clip'), "the clip's running time over its thumbnail's bottom-right corner").toEqual({ text: '0:02', inThumb: true, corner: true });
      expect(await pill('tiny'), 'a still shows none').toBeNull();
      // The whole of what ffprobe read is in the Info tab.
      await selectMedia('clip');
      await openTab('info');
      await until(() => page.eval<boolean>(`document.querySelector('#info-item [data-section=format]')?.textContent.includes('64 × 36') === true`), 'the probed facts in the Info tab');
      const facts = await page.eval<string>(`document.querySelector('#info-item [data-section=format]').textContent`);
      expect(facts).toContain('00:00:02:00');
      expect(facts).toContain('10 fps');
      expect(facts).toContain('H.264');
      const setSearch = (q: string) => page.eval(`(() => { const s = document.getElementById('search'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      try {
        await setSearch('codec:h264 duration:>1');
        expect(await resultNames()).toEqual(['clip', 'noisy', 'tall']);
        await setSearch('res:1080p');
        const at1080 = await resultNames();
        expect(at1080).toEqual(expect.arrayContaining(['Diagonal Wipe', 'Lower Third Bar', 'Title Card', 'Boardroom title', 'Newsdesk title']));
        expect(at1080).not.toContain('clip');
      } finally {
        await setSearch('');
      }
    }, 90_000);

    it('shows cached thumbnails for templates and visual media, and refuses unknown ids', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available; thumbnail check skipped.');
        return;
      }
      // Posters and media frames arrive in the background, one at a time, in library order, and a
      // template's poster captures several frames: on a slow machine the whole library's queue can
      // outlast any wait for one late item (Windows CI, October 2026, twice). So each item is
      // selected first — selection pulls its poster to the front of the queue, which is also what a
      // person looking at an item gets — and then waited for specifically.
      const needed = ['Diagonal Wipe', 'Lower Third Bar', 'Title Card', 'clip', 'tiny'];
      // One read per check: the size is taken in the same step that sees the picture loaded, since a
      // poster can be replaced between two calls while the background queue is still at work.
      const read = '(li) => { const i = li.querySelector(".thumb img"); return i && i.complete && i.naturalWidth > 0 ? { src: i.src, w: i.naturalWidth, h: i.naturalHeight } : null; }';
      const byName: Record<string, { src: string; w: number; h: number }> = {};
      for (const name of needed) {
        await clickResult(name);
        await until(async () => {
          const seen = await onResult<{ src: string; w: number; h: number } | null>(name, read);
          if (seen) byName[name] = seen;
          return seen !== null;
        }, `the thumbnail for ${name}`, 120_000);
      }
      for (const i of Object.values(byName)) expect(i.src).toMatch(/^pulp-thumb:\/\/[0-9a-f]{24}\/$/);
      expect(byName['Title Card']).toMatchObject({ w: 240, h: 135 }); // 1920x1080 poster, fit into 240
      expect(byName['clip']).toMatchObject({ w: 64, h: 36 }); // smaller than the thumbnail size: not enlarged
      expect(byName['tiny']).toMatchObject({ w: 2, h: 2 });
      // Audio has no thumbnail, by design.
      expect(await onResult<boolean>('silence', '(li) => !!li.querySelector(".thumb.empty")')).toBe(true);
      // Unknown id and a path on the URL are refused.
      const outcome = (src: string) =>
        page.eval<string>(
          `new Promise((resolve) => { const i = new Image(); i.onload = () => resolve('loaded'); i.onerror = () => resolve('refused'); i.src = ${JSON.stringify(src)}; setTimeout(() => resolve('timeout'), 5000); })`,
        );
      expect(await outcome('pulp-thumb://deadbeefdeadbeefdeadbeef/')).toBe('refused');
      expect(await outcome(`${byName['tiny']!.src}tiny.png`)).toBe('refused');
      expect(await outcome(byName['tiny']!.src)).toBe('loaded');
    }, 180_000);

    it('makes a hover-scrub strip on demand and steps it with the pointer', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available; hover-scrub check skipped.');
        return;
      }
      /** Point at a fraction across a card's picture, as a pointer resting there would. */
      const hover = (name: string, fraction: number) =>
        onResult<void>(
          name,
          `(li) => { const t = li.querySelector('.thumb'); const r = t.getBoundingClientRect();
            t.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
            t.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * ${fraction}, clientY: r.top + r.height / 2 })); }`,
        );
      const frame = (name: string) => onResult<string | null>(name, `(li) => li.querySelector('.strip')?.style.backgroundPositionX ?? null`);

      /**
       * Ask for the strip over the real IPC and wait for it, reporting what the
       * main process says went wrong rather than timing out with an empty log:
       * a slow machine and a failed strip look identical from the DOM alone.
       */
      const strippedFor = async (name: string, budgetMs = 60_000) => {
        const id = await onResult<string>(name, '(li) => li.dataset.id');
        const started = Date.now();
        for (;;) {
          const result = await page.eval<{ url: string | null; reason?: string; transient?: boolean }>(`window.pulp.hoverStrip(${JSON.stringify(id)})`);
          if (result.url) return result.url;
          // Transient means "ask again"; anything else is settled and worth failing on now.
          if (!result.transient) throw new Error(`no hover-scrub strip for ${name}: ${result.reason ?? 'the item has nothing to scrub'}`);
          if (Date.now() - started >= budgetMs) throw new Error(`timed out waiting for the strip of ${name} (${budgetMs / 1000} s); the last word from the main process was "still going"`);
          await sleep(250);
        }
      };

      /** The strip as the window sees it, to check it really holds its tiles. */
      const sizeOf = (url: string) =>
        page.eval<number[]>(
          `new Promise((resolve) => { const i = new Image(); i.onload = () => resolve([i.naturalWidth, i.naturalHeight]); i.onerror = () => resolve([0, 0]); i.src = ${JSON.stringify(url)}; setTimeout(() => resolve([0, 0]), 5000); })`,
        );

      // A template strip is eight frames rendered through one offscreen window, then tiled.
      const wipeUrl = await strippedFor('Diagonal Wipe');
      // Eight tiles of a 1920x1080 template, each fitted to the thumbnail width.
      const [wipeW, wipeH] = await sizeOf(wipeUrl);
      expect(wipeW).toBe(8 * 240);
      expect(wipeH).toBeGreaterThan(100);
      await hover('Diagonal Wipe', 0.05);
      await until(async () => (await frame('Diagonal Wipe')) !== null, 'the strip to reach the card', 15_000);
      expect(await frame('Diagonal Wipe')).toBe('0%');
      const strip = await onResult<string>('Diagonal Wipe', `(li) => li.querySelector('.strip').style.backgroundImage`);
      expect(strip).toMatch(/^url\("pulp-strip:\/\/[0-9a-f]{24}\/"\)$/);
      expect(await onResult<string>('Diagonal Wipe', `(li) => li.querySelector('.strip').style.backgroundSize`)).toBe('800% 100%');

      // Moving across the picture steps through the frames; the right edge is the last one.
      await hover('Diagonal Wipe', 0.5);
      expect(await frame('Diagonal Wipe')).toMatch(/^57\.14/);
      await hover('Diagonal Wipe', 0.99);
      expect(await frame('Diagonal Wipe')).toBe('100%');
      // Leaving puts the poster back.
      await onResult('Diagonal Wipe', `(li) => li.querySelector('.thumb').dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))`);
      expect(await frame('Diagonal Wipe')).toBeNull();

      // Video gets one too, from ffmpeg rather than from a render.
      await strippedFor('clip');
      await hover('clip', 0.99);
      await until(async () => (await frame('clip')) !== null, 'the video strip to reach the card', 15_000);
      expect(await frame('clip')).toBe('100%');

      // Both are cached beside the posters, so the next hover costs nothing.
      const files = await readdir(join(userData, 'thumbnails'));
      expect(files.filter((f) => f.endsWith('-strip.png')).length).toBeGreaterThanOrEqual(2);

      // A still has nothing to step through, so no strip is ever asked for.
      await hover('tiny', 0.5);
      await sleep(1000);
      expect(await frame('tiny')).toBeNull();
    }, 180_000);

    it('keys a color to transparency from the Info tab, the result joining the library as an alpha clip (milestone 52)', async () => {
      if (!haveVideo) return;
      await selectMedia('weathercast');
      await openTab('info');
      await until(() => page.eval<boolean>(`!!document.querySelector('.info-section[data-section=cleanup]')`), 'the clean-up section');
      await page.eval(`(() => { const h = document.querySelector('.info-section[data-section=cleanup] .section-heading'); if (h.getAttribute('aria-expanded') !== 'true') h.click(); })()`);
      await until(() => page.eval<boolean>(`!!document.getElementById('cleanup-key')`), 'the clean-up actions');
      await page.eval(`document.getElementById('cleanup-key').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('key-dialog').open`), 'the key dialog');
      try {
        // Both frames arrive: the plain one the color is picked from, and the keyed result.
        await until(
          () => page.eval<boolean>(`!!document.getElementById('key-plain').getAttribute('src') && !!document.getElementById('key-keyed').getAttribute('src')`),
          'the before and after frames',
          30_000,
        );
        // Studio green is the default; the fixture really is green, so the key goes straight through.
        expect(await page.eval<string>(`document.getElementById('key-color').value`)).toBe('#00ff00');
        await page.eval(`document.getElementById('key-make').click()`);
        await until(
          () => page.eval<string>(`document.getElementById('key-status').textContent`).then((t) => t.includes('weathercast alpha')),
          'the keyed clip made and said',
          60_000,
        );
        // It joined the library beside the original, an asset ready to place.
        await page.eval(`document.getElementById('key-close').click()`);
        await until(() => onResult<boolean>('weathercast alpha', '(li) => true').then(() => true), 'the alpha clip in the results', 30_000);
      } finally {
        await page.eval(`(() => { const d = document.getElementById('key-dialog'); if (d.open) d.close(); })()`);
      }
    }, 120_000);

    it('splits footage at its cuts into clips of the one file, beside it (milestone 52)', async () => {
      if (!haveVideo) return;
      await selectMedia('yearbook');
      await openTab('info');
      await until(() => page.eval<boolean>(`!!document.querySelector('.info-section[data-section=cleanup]')`), 'the clean-up section');
      await page.eval(`(() => { const h = document.querySelector('.info-section[data-section=cleanup] .section-heading'); if (h.getAttribute('aria-expanded') !== 'true') h.click(); })()`);
      await until(() => page.eval<boolean>(`!!document.getElementById('cleanup-split')`), 'the clean-up actions');
      await page.eval(`document.getElementById('cleanup-split').click()`);
      await until(
        () => page.eval<string>(`document.getElementById('cleanup-status')?.textContent || ''`).then((t) => t.includes('Split into 3 clips')),
        'the three scenes said',
        60_000,
      );
      // The clips are in the library, named for the file and numbered in order.
      await until(() => onResult<boolean>('yearbook_000', '(li) => true').then(() => true), 'the first scene in the results', 30_000);
      await until(() => onResult<boolean>('yearbook_002', '(li) => true').then(() => true), 'and the last', 30_000);
    }, 120_000);

    // Milestone 50: the words of a bundled spoken sample, from the model on this machine. The model
    // and whisper.cpp are not asked of a test machine: without them the test says so and stands
    // aside, and PULP_SPEECH=1 makes it fail instead, for a machine that is meant to have them.
    it('transcribes the bundled spoken sample on this machine, with the words on the project\'s clock', async () => {
      const status = await page.eval<{ runner: { ok: boolean }; model: { installed: boolean }; ffmpeg: boolean }>('window.pulp.speechStatus({})');
      if (!status.runner.ok || !status.model.installed || !status.ffmpeg) {
        const why = !status.ffmpeg ? 'ffmpeg not found' : !status.runner.ok ? 'whisper.cpp not found' : 'the speech model is not fetched';
        if (process.env.PULP_SPEECH === '1') throw new Error(`transcription is required (PULP_SPEECH=1) but cannot run: ${why}`);
        console.info(`Skipping the transcription test: ${why}.`);
        return;
      }
      const id = await onResult<string>('spoken', '(li) => li.dataset.id');
      // The sample placed a second and a half into the project: the words come back on that clock.
      const result = await page.eval<{ ok: true; words: { text: string; start: number; end: number }[]; language: string } | { ok: false; message: string }>(
        `window.pulp.transcribe({ segments: [{ kind: 'sound', id: ${JSON.stringify(id)}, from: 0, to: 4, at: 1.5 }], language: 'en' })`,
      );
      expect(result.ok, result.ok ? '' : result.message).toBe(true);
      if (!result.ok) return;
      const said = result.words.map((w) => w.text.toLowerCase().replace(/[^a-z]/g, '')).join(' ');
      expect(said).toContain('captions');
      expect(said).toContain('machine');
      expect(result.words[0]!.start).toBeGreaterThanOrEqual(1.4);
      for (let i = 1; i < result.words.length; i++) expect(result.words[i]!.start).toBeGreaterThanOrEqual(result.words[i - 1]!.start);
      expect(result.language).toBe('en');
    }, 300_000);

    it('draws a waveform for audio, in the row and on the stage, and keeps the peaks', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available; waveform check skipped.');
        return;
      }
      // Peaks are taken on first ask; the reason comes back when there are none.
      const id = await onResult<string>('silence', '(li) => li.dataset.id');
      const asked = await page.eval<{ peaks: string | null; reason?: string }>(`window.pulp.waveform(${JSON.stringify(id)})`);
      expect(asked.reason ?? '').toBe('');
      expect(asked.peaks).toBeTruthy();

      // The row draws it where a thumbnail would be: audio has no picture.
      await until(() => onResult<boolean>('silence', '(li) => !!li.querySelector(".thumb .waveform path")'), 'the waveform in the row');
      const d = await onResult<string>('silence', '(li) => li.querySelector(".thumb .waveform path").getAttribute("d")');
      expect(d.startsWith('M')).toBe(true);
      // A silent file still draws a hairline rather than looking like a failure.
      expect(d.split('M').length - 1).toBe(50);

      // And on the stage, behind the audio transport.
      await selectMedia('silence');
      await until(() => page.eval<boolean>(`!document.getElementById('media-waveform').hasAttribute('hidden')`), 'the waveform on the stage');
      expect(await page.eval<number>(`document.getElementById('media-waveform').querySelector('path').getAttribute('d').split('M').length - 1`)).toBe(400);

      // The peaks are in the library database, so the next run draws them without ffmpeg.
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(join(userData, 'library.sqlite'), { readOnly: true });
      try {
        const rows = db.prepare('SELECT peaks FROM waveforms WHERE peaks IS NOT NULL').all() as { peaks: string }[];
        expect(rows.length).toBeGreaterThanOrEqual(1);
      } finally {
        db.close();
      }
    }, 90_000);

    it('auditions a list of sounds: arrow keys move, picking plays, Escape stops', async () => {
      const playing = () => page.eval<boolean>(`!document.getElementById('media-audio').paused`);
      const shown = () => page.eval<string>(`document.getElementById('info-name')?.textContent ?? ''`);
      const key = (k: string) =>
        page.eval(`document.getElementById('results').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
      const setSearch = (q: string) => page.eval(`(() => { const s = document.getElementById('search'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);

      try {
        // Narrow to audio, which also puts the results in list view — and to the one sound, since
        // the steps below walk a one-item list and milestone 50 added a spoken sample beside it.
        await setSearch('type:audio silence');
        await until(async () => (await resultNames()).includes('silence'), 'the audio results');
        expect(await page.eval<boolean>(`document.getElementById('results').classList.contains('list')`)).toBe(true);

        // Off by default: moving through the list shows an item but plays nothing.
        expect(await page.eval<string>(`document.getElementById('audition').getAttribute('aria-pressed')`)).toBe('false');
        await key('ArrowDown');
        await until(async () => (await shown()).includes('silence'), 'the first sound to be shown');
        expect(await playing()).toBe(false);

        // On, and the arrow keys audition.
        await page.eval(`document.getElementById('audition').click()`);
        expect(await page.eval<string>(`document.getElementById('audition').getAttribute('aria-pressed')`)).toBe('true');
        await key('ArrowUp'); // back to the top of a one-item list: the same sound, played this time
        await until(playing, 'the sound to play');
        // The transport row follows the element (milestone 37), whoever started it.
        await until(() => page.eval<boolean>(`document.getElementById('play').getAttribute('aria-label') === 'Pause'`), 'the row showing the sound playing');
        // Escape stops it.
        await key('Escape');
        await until(async () => !(await playing()), 'the sound to stop');
        await until(() => page.eval<boolean>(`document.getElementById('play').getAttribute('aria-label') === 'Play'`), 'the row showing it stopped');
        await page.eval(`document.getElementById('audition').click()`);
      } finally {
        await setSearch('');
      }
    }, 90_000);

    it('shows the item as a property panel, with the path only in the tooltip and behind the actions', async () => {
      await clickResult('Boardroom lower third');
      await openTab('info');
      await until(() => page.eval<boolean>(`document.getElementById('info-name')?.textContent === 'Boardroom lower third'`), 'the header card');

      // The header names the item and its type; the star sits beside the name.
      expect(await page.eval<string>(`document.querySelector('#info-item .info-type').textContent`)).toBe('Lower third');
      expect(await page.eval<boolean>(`!!document.querySelector('#info-item .info-heading .favorite')`)).toBe(true);

      // Sections, each a heading over a key-value grid, and their open state is remembered.
      const sections = await page.eval<string[]>(`[...document.querySelectorAll('#info-item .info-section')].map((s) => s.dataset.section)`);
      expect(sections).toEqual(['about', 'format', 'categories', 'tags', 'set', 'file', 'credits', 'usage']);
      const factsOf = (id: string) =>
        page.eval<string[]>(
          `[...document.querySelectorAll('#info-item [data-section=${id}] .fact')].map((f) => f.querySelector('dt').textContent + ': ' + f.querySelector('dd').textContent)`,
        );
      expect(await factsOf('format')).toEqual([
        'Aspects: 16:9, 9:16, 1:1, 4:5',
        'Size: Chosen at render time · 1920 × 1080 by default',
        'Duration: 6 s · 00:00:06:00',
        'Frame rate: 30 fps',
        'Alpha: Transparent background',
      ]);

      // File, Credits and Usage start folded: the facts people reach for first are open,
      // the rest wait to be asked for. Open them.
      await page.eval(`document.querySelectorAll('#info-item .section-heading[aria-expanded="false"]').forEach((b) => b.click())`);
      await until(() => page.eval<boolean>(`!!document.querySelector('#info-item [data-section=file] .fact')`), 'the File section');

      // File: a location relative to the library folder, the whole path only in the tooltip.
      const file = await factsOf('file');
      expect(file[0]).toBe('Location: boardroom/lower-third');
      // The tooltip is the native path, so it reads boardroom\lower-third on Windows (docs/platform-notes.md).
      expect(await page.eval<string>(`document.querySelector('#info-item [data-section=file] .fact dd').dataset.tip`)).toMatch(/boardroom[\\/]lower-third$/);
      expect(file.some((f) => f.startsWith('Size on disk: '))).toBe(true);
      // Reveal and Copy path take an item id, so the window never sends a path at all.
      expect(await page.eval<boolean>(`window.pulp.copyItemPath(${JSON.stringify('nope')})`)).toBe(false);
      const id = await onResult<string>('Boardroom lower third', '(li) => li.dataset.id');
      expect(await page.eval<boolean>(`window.pulp.copyItemPath(${JSON.stringify('')} || ${JSON.stringify(id)})`)).toBe(true);

      // The set's other pieces are there, named without repeating the set.
      const pieces = await page.eval<string[]>(`[...document.querySelectorAll('#info-item .set-piece .label')].map((l) => l.textContent)`);
      const boardroom = JSON.parse(await readFile(join(__dirname, '..', '..', 'templates', 'boardroom', 'pack.json'), 'utf8')) as { templates: string[] };
      expect(pieces).toHaveLength(boardroom.templates.length - 1);
      expect(pieces).toEqual(expect.arrayContaining(['Background', 'Frame', 'Title', 'Wipe']));
      expect(pieces).not.toContain('Lower third');
      // Clicking one shows it.
      await page.eval(`[...document.querySelectorAll('#info-item .set-piece')].find((p) => p.querySelector('.label').textContent === 'Title').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('info-name')?.textContent === 'Boardroom title'`), 'the sibling piece');

      // Folding a section is remembered in settings.
      await page.eval(`document.querySelector('#info-item [data-section=format] .section-heading').click()`);
      await until(async () => {
        try {
          const s = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { infoSections?: Record<string, boolean> };
          return s.infoSections?.format === false;
        } catch {
          return false;
        }
      }, 'the folded section in settings.json');
      await page.eval(`document.querySelector('#info-item [data-section=format] .section-heading').click()`);
    }, 90_000);

    it('refuses an unknown id and a path on the URL, and serves a known id, as seen by an <img>', async () => {
      const outcome = (src: string) =>
        page.eval<string>(
          `new Promise((resolve) => { const i = new Image(); i.onload = () => resolve('loaded'); i.onerror = () => resolve('refused'); i.src = ${JSON.stringify(src)}; setTimeout(() => resolve('timeout'), 5000); })`,
        );
      const id = await onResult<string>('tiny', '(li) => li.dataset.id');
      expect(await outcome('pulp-media://deadbeefdeadbeefdeadbeef/')).toBe('refused');
      expect(await outcome(`pulp-media://${id}/tiny.png`)).toBe('refused');
      expect(await outcome(`pulp-media://${id}/`)).toBe('loaded');
      // The scheme is for media elements only: the window cannot read it as data.
      expect(await page.eval<string>(`fetch('pulp-media://${id}/').then(() => 'fetched', () => 'blocked')`)).toBe('blocked');
    }, 60_000);
  });

  describe('search bar scope and filter chips', () => {
    const names = resultNames;
    const clearSearch = () => page.eval(`(() => { const s = document.getElementById('search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);

    it('scopes the results to a browse node, shows the chip, and clears it with the ×', async () => {
      await clearSearch();
      await findCategory('Lower third');
      await until(() => page.eval<boolean>(`!!document.querySelector('#browse-tree .browse-node[data-filter="type:lower-third"]')`), 'the type in the filtered tree');
      await page.eval(`document.querySelector('#browse-tree .browse-node[data-filter="type:lower-third"]').click()`);
      await until(async () => !(await page.eval<boolean>(`document.getElementById('scope-chip').hidden`)), 'the scope chip for a category');
      // Lower thirds is a category of one type: the type's scope under the plainer name (milestone 34).
      expect(await page.eval<string>(`document.getElementById('scope-chip-label').textContent`)).toBe('in: Lower thirds');
      expect(await page.eval<string>(`document.getElementById('results-description').textContent`)).toContain('bottom of the frame');
      const lowerThirds = await names();
      expect(lowerThirds).toContain('Lower Third Bar');
      expect(lowerThirds).not.toContain('Diagonal Wipe');
      expect(lowerThirds).not.toContain('tiny');
      // The node's count agrees with the results it scopes to.
      await findCategory('Lower third');
      expect(Number(await page.eval<string>(`document.querySelector('#browse-tree .browse-node[data-filter="type:lower-third"]').dataset.count`))).toBe(lowerThirds.length);
      await clearFindField();
      await page.eval(`document.getElementById('scope-chip-clear').click()`);
      await until(async () => (await names()).includes('Diagonal Wipe'), 'the full library after clearing the type scope');

      await findCategory('Media library');
      await until(() => page.eval<boolean>(`[...document.querySelectorAll('#browse-tree .browse-node')].some((b) => b.textContent.includes('Media library'))`), 'the folder in the filtered tree');
      await page.eval(`[...document.querySelectorAll('#browse-tree .browse-node')].find((b) => b.textContent.includes('Media library')).click()`);
      await until(async () => !(await page.eval<boolean>(`document.getElementById('scope-chip').hidden`)), 'the scope chip');
      expect(await page.eval<string>(`document.getElementById('scope-chip-label').textContent`)).toBe('in: Media library');
      expect(await page.eval<string>(`document.getElementById('scope-chip-label').dataset.tip`)).toBe(mediaDir);
      const scoped = await names();
      expect(scoped).toContain('tiny');
      expect(scoped).not.toContain('Lower Third Bar');
      await page.eval(`document.getElementById('scope-chip-clear').click()`);
      await until(async () => (await names()).includes('Lower Third Bar'), 'the full library after clearing the scope');
      expect(await page.eval<boolean>(`document.getElementById('scope-chip').hidden`)).toBe(true);
    }, 60_000);

    it('filters the tree as a category is typed, lights what matched, and chooses from it', async () => {
      await clearSearch();
      const input = `document.querySelector('#browse-find input')`;
      const funnel = `document.getElementById('browse-filter-toggle')`;
      // The field is behind the funnel in the Browse heading (milestone 41): closed until asked for,
      // open with the caret in it when pressed, lit while a filter is in force. Put away first, in
      // case a test before this one left it open.
      await page.eval(`(() => { if (!document.getElementById('browse-find').hidden) ${funnel}.click(); })()`);
      await until(() => page.eval<boolean>(`document.getElementById('browse-find').hidden`), 'the filter field closed to begin with');
      expect(await page.eval<string>(`${funnel}.getAttribute('aria-expanded')`)).toBe('false');
      await page.eval(`${funnel}.click()`);
      await until(() => page.eval<boolean>(`!document.getElementById('browse-find').hidden`), 'the filter field open');
      expect(await page.eval<string>(`${funnel}.getAttribute('aria-expanded')`)).toBe('true');
      expect(await page.eval<boolean>(`document.activeElement === ${input}`)).toBe(true);
      expect(await page.eval<string>(`${input}.placeholder`)).toBe('Filter categories');
      const type = (text: string) => page.eval(`(() => { const f = ${input}; f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const press = (key: string) => page.eval(`${input}.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
      const rows = () => page.eval<string[]>(`[...document.querySelectorAll('#browse-tree .browse-node')].map((b) => b.dataset.node)`);
      const headings = () => page.eval<string[]>(`[...document.querySelectorAll('#browse-tree .section-heading')].map((h) => h.dataset.node)`);

      // Before: the whole tree — the categories at the top draw no heading; Quick access and My
      // folders are the sections there to be opened (milestone 34).
      const whole = await headings();
      expect(whole).toEqual(['quick', 'folders']);
      const allRows = await rows();
      expect(allRows[0]).toBe('category:lower-thirds');
      expect(allRows).toContain('untyped');

      // Typing takes away everything that does not match. What is left keeps its category, so it
      // is plain where each lives, and it sits at the top with nothing to scroll.
      await type('glitch');
      await until(async () => (await rows()).includes('type:glitch'), 'the type that matches');
      expect(await page.eval<string>(`${funnel}.getAttribute('aria-pressed')`), 'the funnel lit while a filter is in force').toBe('true');
      const left = await rows();
      expect(left).not.toContain('favorites');
      expect(left.filter((r) => r.startsWith('type:'))).toEqual(['type:glitch']);
      // The category above it stays, unlit, to say where the match lives; the match itself is lit.
      expect(left).toContain('category:transitions-wipes');
      expect(await page.eval<string>(`document.querySelector('#browse-tree [data-node="type:glitch"] mark').textContent`)).toBe('Glitch');
      expect(await page.eval<number>(`document.querySelectorAll('#browse-tree [data-node="category:transitions-wipes"] mark').length`)).toBe(0);
      expect(await headings(), 'no section holds a match, so none is shown').toEqual([]);

      // A section that was folded still shows its matches: the search overrides the folds.
      await type('recen');
      await until(async () => (await rows()).includes('recent'), 'a Quick access match from a folded section');

      // Nothing matches: the tree is empty and says so.
      await type('zzzznope');
      await until(async () => (await rows()).length === 0, 'an empty tree');
      expect(await page.eval<string>(`document.querySelector('#browse-find .find-none').textContent`)).toBe('No category matches');

      // Clearing puts the tree back exactly as it was, folds included.
      await press('Escape');
      await until(async () => (await headings()).join() === whole.join(), 'the tree restored');
      expect(await page.eval<string>(`${input}.value`)).toBe('');

      // Enter takes the first category still standing, and scopes the results by it.
      await type('lower');
      await until(async () => (await rows()).includes('category:lower-thirds'), 'the match again');
      await press('Enter');
      await until(() => page.eval<boolean>(`!document.getElementById('scope-chip').hidden`), 'the scope chip');
      expect(await page.eval<string>(`document.getElementById('scope-chip-label').textContent`)).toBe('in: Lower thirds');
      const scoped = await names();
      expect(scoped).toContain('Lower Third Bar');
      expect(scoped).not.toContain('Diagonal Wipe');
      // The filter, having been answered, is cleared and put away; the tree is whole again, folded
      // to where the choice lives, and the funnel is no longer lit.
      expect(await page.eval<string>(`${input}.value`)).toBe('');
      await until(() => page.eval<boolean>(`document.getElementById('browse-find').hidden`), 'the filter field put away by the choice');
      expect(await page.eval<string>(`${funnel}.getAttribute('aria-pressed')`)).toBe('false');
      await until(() => page.eval<boolean>(`!!document.querySelector('#browse-tree .browse-node[data-filter="type:lower-third"].active')`), 'the chosen category active in the tree');
      await page.eval(`document.getElementById('scope-chip-clear').click()`);
      await until(async () => (await names()).includes('Diagonal Wipe'), 'the full library again');
    }, 60_000);

    it('switches the results between cards and rows, and remembers the choice', async () => {
      await clearSearch();
      // Cards by default for anything visual: a thumbnail with badges under the name.
      expect(await page.eval<boolean>(`document.getElementById('results').classList.contains('grid')`)).toBe(true);
      expect(await page.eval<string>(`document.getElementById('view-grid').getAttribute('aria-pressed')`)).toBe('true');
      const cardBadges = await onResult<string[]>('Lower Third Bar', '(li) => [...li.querySelectorAll(".badge")].map((b) => b.dataset.badge)');
      expect(cardBadges).toEqual(['resolution', 'alpha', 'vertical']); // every bundled template now draws tall as well
      // The resolution is an outlined tag with the pixels in its tooltip; the icons sit apart, after it (milestone 66).
      const tag = await onResult<{ text: string; tip: string; border: string; iconsApart: boolean }>('Lower Third Bar', `(li) => {
        const t = li.querySelector('.badge.tag');
        return { text: t.textContent, tip: t.dataset.tip, border: getComputedStyle(t).borderTopStyle, iconsApart: !!li.querySelector('.badge-icons .badge.alpha') && !li.querySelector('.badge-icons .badge.tag') };
      }`);
      expect(tag).toEqual({ text: 'Full HD', tip: '1920 × 1080', border: 'solid', iconsApart: true });
      expect(await onResult<string>('Lower Third Bar', `(li) => li.querySelector('.thumb-time')?.textContent ?? ''`), 'a template runs for its declared length').toMatch(/^\d+:\d\d$/);

      await page.eval(`document.getElementById('view-list').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('results').classList.contains('list')`), 'the list view');
      const row = await onResult<string[]>('Boardroom title', '(li) => [...li.querySelectorAll(".col")].map((c) => c.textContent)');
      expect(row).toEqual(['Boardroom title', '0:05', 'Title', 'Corporate, Finance, Technology, Real estate', 'title']);
      // The thumbnail size only means anything for cards.
      expect(await page.eval<boolean>(`document.getElementById('thumb-size').disabled`)).toBe(true);

      await until(async () => {
        try {
          const s = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { resultsView?: { mode?: { visual?: string } } };
          return s.resultsView?.mode?.visual === 'list';
        } catch {
          return false;
        }
      }, 'the view mode in settings.json');

      await page.eval(`document.getElementById('view-grid').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('results').classList.contains('grid')`), 'the grid view again');
      // A bigger thumbnail makes the cards taller and fewer fit across.
      const columns = () => page.eval<string>(`document.getElementById('results').style.getPropertyValue('--cols')`);
      const before = Number(await columns());
      await fire('#thumb-size', '3', 'input');
      await until(async () => Number(await columns()) < before, 'fewer, bigger cards across');
      await fire('#thumb-size', '1', 'input'); // back to the default size for the tests that follow
    }, 60_000);

    it('moves through the browse tree with the arrow keys, folding and stepping out with Left', async () => {
      await clearSearch();
      const focused = () => page.eval<string>(`document.activeElement?.dataset.node ?? ''`);
      const key = (k: string) =>
        page.eval(`document.getElementById('browse-tree').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
      const has = (node: string) => page.eval<boolean>(`!!document.querySelector('#browse-tree [data-node=${JSON.stringify(node)}]')`);

      // The tree shows only where you are, so Quick access is opened first and the walk starts there.
      await clearFindField();
      await page.eval(`(() => { const h = document.querySelector('#browse-tree .section-heading[data-node=quick]'); if (h.getAttribute('aria-expanded') === 'false') h.click(); })()`);
      await until(() => page.eval<boolean>(`!!document.querySelector('#browse-tree [data-node=favorites]')`), 'Quick access open');
      await page.eval(`document.querySelector('#browse-tree .section-heading').focus()`);
      expect(await focused()).toBe('quick');
      await key('ArrowDown');
      expect(await focused()).toBe('favorites');
      await key('ArrowDown');
      expect(await focused()).toBe('recent');
      await key('ArrowUp');
      expect(await focused()).toBe('favorites');
      // Home is the top of the panel, which the categories are now (milestone 34).
      await key('Home');
      expect(await focused()).toBe('category:lower-thirds');

      // Right steps into an open category, Left steps back out to it, Left again folds it.
      await page.eval(`(() => { const r = document.querySelector('#browse-tree [data-node="category:titles-openers"]'); if (r.getAttribute('aria-expanded') === 'false') r.closest('.node-row').querySelector('.twisty').click(); })()`);
      await until(() => page.eval<boolean>(`!!document.querySelector('#browse-tree [data-node="type:title"]')`), 'the category open');
      await page.eval(`document.querySelector('#browse-tree [data-node="category:titles-openers"]').focus()`);
      await key('ArrowRight');
      expect(await focused()).toBe('type:title');
      await key('ArrowLeft');
      expect(await focused()).toBe('category:titles-openers');
      await key('ArrowLeft');
      await until(async () => !(await has('type:title')), 'the category to fold');
      await key('ArrowRight');
      await until(() => has('type:title'), 'the category to unfold again');
    }, 60_000);

    it('a filter chip narrows the results while pressed', async () => {
      await clearSearch();
      await page.eval(`document.getElementById('chip-templates').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('chip-templates').getAttribute('aria-pressed') === 'true'`), 'the chip to be pressed');
      const filtered = await names();
      expect(filtered).toContain('Lower Third Bar');
      expect(filtered).not.toContain('tiny');
      await page.eval(`document.getElementById('chip-templates').click()`);
      await until(async () => (await names()).includes('tiny'), 'media back in the results after releasing the chip');
      expect(await page.eval<string>(`document.getElementById('chip-templates').getAttribute('aria-pressed')`)).toBe('false');
    }, 60_000);

    it('the Vertical chip keeps what draws tall, and such cards carry a badge', async () => {
      await clearSearch();
      await page.eval(`document.getElementById('chip-vertical').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('chip-vertical').getAttribute('aria-pressed') === 'true'`), 'the chip to be pressed');
      const vertical = await names();
      expect(vertical).toContain('Boardroom opener'); // declares 9:16 among its shapes
      expect(vertical).not.toContain('Wide only'); // a declared 320 × 180, landscape only
      expect(await onResult<boolean>('Boardroom opener', '(li) => !!li.querySelector(".badge.vertical")')).toBe(true);
      await page.eval(`document.getElementById('chip-vertical').click()`);
      await until(async () => (await names()).includes('Wide only'), 'the landscape items back after releasing the chip');
      expect(await onResult<boolean>('Wide only', '(li) => !!li.querySelector(".badge.vertical")')).toBe(false);
    }, 60_000);

    it('cards take the item\'s own shape, and a grid holding a tall item takes a taller row', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available; portrait card check skipped.');
        return;
      }
      const cardH = () => page.eval<number>(`Number.parseFloat(document.getElementById('results').style.getPropertyValue('--card-h'))`);
      // Every bundled template's poster is landscape, so a grid of templates sits at the 16:9 pitch.
      await fire('#search', 'type:template', 'input');
      await until(async () => (await names()).includes('Lower Third Bar') && !(await names()).includes('tall'), 'templates only');
      const wide = await cardH();
      // At the wide pitch every picture box is the same 16:9, which is what keeps the rows tight.
      expect(await onResult<string>('Lower Third Bar', '(li) => li.querySelector(".thumb").style.aspectRatio')).toBe('16 / 9');
      // The tall fixture clip (36 × 64, once probed) is a portrait item: a grid holding it takes a taller row, and its own picture is tall.
      await fire('#search', 'orientation:portrait type:video', 'input');
      await until(async () => (await names()).join() === 'tall', 'the tall clip alone', 30_000);
      await until(async () => (await cardH()) > wide, 'the taller row pitch');
      expect(await onResult<string>('tall', '(li) => li.querySelector(".thumb").style.aspectRatio')).toBe('36 / 64');
      // With everything showing the grid is mixed, and it stays at the wide pitch rather than
      // giving every wide card a tall cell (docs/ideas.md): the tall picture is contained in the
      // same 16:9 box, and its Vertical badge is what still says it is tall.
      await clearSearch();
      await until(async () => (await cardH()) === wide, 'the wide pitch for the mixed grid');
      expect(await onResult<string>('Lower Third Bar', '(li) => li.querySelector(".thumb").style.aspectRatio')).toBe('16 / 9');
      expect(await onResult<string>('tall', '(li) => li.querySelector(".thumb").style.aspectRatio')).toBe('16 / 9');
      expect(await onResult<string[]>('tall', '(li) => [...li.querySelectorAll(".badge")].map((b) => b.dataset.badge)')).toContain('vertical');

      // The Vertical chip keeps portrait media *and* templates that draw tall, and a template's own
      // poster is wide, so that grid is still mixed and still sits at the wide pitch. The taller
      // pitch belongs to a set that is portrait all through, which the search above showed.
      await page.eval(`document.getElementById('chip-vertical').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('chip-vertical').getAttribute('aria-pressed') === 'true'`), 'the Vertical chip pressed');
      await until(async () => (await names()).includes('tall'), 'the tall clip among the vertical results');
      expect(await cardH(), 'templates draw tall but their posters are wide, so the grid stays mixed').toBe(wide);
      await page.eval(`document.getElementById('chip-vertical').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('chip-vertical').getAttribute('aria-pressed') === 'false'`), 'the chip released');
    }, 60_000);

    // Last in this suite on purpose: under the accordion, opening folds the other sections, and
    // nothing after this test reads the tree, so the folded state cannot trip a neighbor.
    it('shows only where you are: folded to the active path, and one section open at a time', async () => {
      const heading = (id: string) => `document.querySelector('#browse-tree .section-heading[data-node=${JSON.stringify(id)}]')`;
      const openState = () =>
        page.eval<Record<string, string>>(
          `Object.fromEntries([...document.querySelectorAll('#browse-tree .section-heading')].map((h) => [h.dataset.node, h.getAttribute('aria-expanded')]))`,
        );
      await clearSearch();
      await page.eval(`(() => { const b = document.getElementById('scope-chip-clear'); if (b && !document.getElementById('scope-chip').hidden) b.click(); })()`);

      // (What the panel opens on at launch — the active category's path, or Quick access alone —
      // is `foldAllExcept` in src/core/browse-fold.ts, covered by its own unit tests: the app
      // cannot be relaunched mid-suite, so this checks the rule that holds from here on.)

      // Choosing a category folds the tree to the path that holds it. The categories are the
      // panel's top level and never fold (milestone 34), so the sections below them all shut.
      const openSection = async (id: string) => {
        await page.eval(`(() => { const h = document.querySelector('#browse-tree .section-heading[data-node=${JSON.stringify(id)}]'); if (h.getAttribute('aria-expanded') === 'false') h.click(); })()`);
        await until(async () => (await openState())[id] === 'true', `${id} open`);
      };
      await openSection('quick');
      await page.eval(`document.querySelector('#browse-tree .browse-node[data-filter="type:lower-third"]').click()`);
      await until(() => page.eval<boolean>(`!document.getElementById('scope-chip').hidden`), 'the category chosen');
      const afterChoice = await openState();
      for (const [id, open] of Object.entries(afterChoice)) expect(open, id).toBe('false');
      expect(await page.eval<boolean>(`!!document.querySelector('#browse-tree .browse-node[data-node="category:lower-thirds"].active')`), 'the category still on screen, active').toBe(true);

      // Opening another section folds the one that was open: one at a time.
      await openSection('quick');
      await openSection('folders');
      expect((await openState()).quick, 'the section that was open folds').toBe('false');

      // Folding is still free: closing one touches nothing else.
      await page.eval(`${heading('folders')}.click()`);
      await until(async () => (await openState()).folders === 'false', 'My folders folded');
      const allShut = await openState();
      expect(Object.values(allShut).every((v) => v === 'false'), JSON.stringify(allShut)).toBe(true);

      // Among the categories, one open at a time as well: a category's row selects, its twisty folds.
      const twist = (id: string) => page.eval(`document.querySelector('#browse-tree [data-node=${JSON.stringify(id)}]').closest('.node-row').querySelector('.twisty').click()`);
      const groupOpen = (id: string) => page.eval<string>(`document.querySelector('#browse-tree [data-node=${JSON.stringify(id)}]').getAttribute('aria-expanded')`);
      // Open whichever category is shut, and the other folds.
      const shut = (await groupOpen('category:titles-openers')) === 'false' ? 'category:titles-openers' : 'category:transitions-wipes';
      const other = shut === 'category:titles-openers' ? 'category:transitions-wipes' : 'category:titles-openers';
      await twist(shut);
      await until(async () => (await groupOpen(shut)) === 'true', `${shut} opened`);
      expect(await groupOpen(other), 'the other category folds').toBe('false');

      await page.eval(`document.getElementById('scope-chip-clear').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('scope-chip').hidden`), 'the scope cleared');
    }, 60_000);

    it('says what sample media would add to the category being browsed, and makes just those (milestone 34)', async () => {
      const hint = () =>
        page.eval<{ shown: boolean; text: string; button: boolean; tip: string; busy: string | null }>(
          `(() => { const h = document.getElementById('results-hint'); const b = document.getElementById('results-hint-make');
            return { shown: !h.hidden && h.getBoundingClientRect().height > 0, text: document.getElementById('results-hint-text').textContent,
              button: !b.hidden && b.getBoundingClientRect().height > 0, tip: b.dataset.tip || '', busy: b.getAttribute('aria-busy') }; })()`,
        );
      /** How many items the region says it holds, which is the count the heading keeps. */
      const held = () => page.eval<string>(`document.getElementById('results-label').textContent`).then((t) => Number(/(\d+)/.exec(t)?.[1] ?? -1));
      const openNode = async (label: string) => {
        await findCategory(label);
        await until(() => page.eval<boolean>(
          `[...document.querySelectorAll('#browse-tree .browse-node')].some((b) => b.textContent.includes(${JSON.stringify(label)}))`,
        ), `${label} in the filtered tree`);
        await page.eval(`[...document.querySelectorAll('#browse-tree .browse-node')].find((b) => b.textContent.includes(${JSON.stringify(label)})).click()`);
        await until(() => page.eval<string>(`document.getElementById('scope-chip-label').textContent`).then((t) => t.includes(label)), `the scope on ${label}`);
        await clearFindField();
      };
      await clearSearch();
      const samplesFor = (id: string) => samplesForTypes(categoryInfo(id)!.types).length;

      // Nothing has been made, so a category the catalog fills says how many it would add —
      // counted for that category, not for the whole 625-file catalog.
      await openNode('Overlays and frames');
      await until(async () => (await hint()).shown, 'the line under the results');
      const overlays = await hint();
      expect(overlays.text).toBe(`${samplesFor('overlays-frames')} more with sample media`);
      expect(overlays.button, 'with a button beside it').toBe(true);
      expect(overlays.tip).toContain('Overlays and frames');
      expect(overlays.tip).toContain('not the whole catalog');
      // It is the category's own count, not the catalog's, and not another category's.
      await openNode('Design elements');
      await until(async () => (await hint()).text === `${samplesFor('design-elements')} more with sample media`, 'the count for the category in view');

      // A category the catalog has nothing for is offered nothing.
      await openNode('Lower thirds');
      expect((await hint()).shown, 'nothing to add to a template-only category').toBe(false);

      // Hidden results want the room: the line goes with them and comes back.
      await openNode('Overlays and frames');
      await until(async () => (await hint()).shown, 'the line back on a category with samples');
      await page.eval(`document.getElementById('results-toggle').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('app').classList.contains('results-collapsed')`), 'the results hidden');
      expect((await hint()).shown, 'no line while the results are hidden').toBe(false);
      await page.eval(`document.getElementById('results-toggle').click()`);
      await until(async () => (await hint()).shown, 'the line back with the results');

      // The button makes just what is in view. Vignettes are three stills, a second's work; the
      // whole catalog is 625 files, which is why the count and the button are per category.
      await openNode('Vignette');
      await until(async () => (await hint()).text === '3 more with sample media', 'the count for one type');
      const before = await held();
      await page.eval(`document.getElementById('results-hint-make').click()`);
      await until(async () => (await hint()).busy === 'true', 'the button saying it is working');
      await until(async () => (await hint()).text === 'Made 3 files.', 'the three made', 240_000);
      // Nothing left for this type: the button goes, so nobody is offered more than there is. The
      // line can say "Made" before the library has counted the three, so both are waited for.
      await until(async () => (await held()) === before + 3, 'the three in the library');
      await until(async () => !(await hint()).button, 'the button goes once nothing is left');
      // On disk under the sample-media root, and only those three.
      for (const item of samplesForTypes(['vignette'])) expect(existsSync(join(sampleRoot, ...sampleMediaPath(item))), item.file).toBe(true);
      expect(existsSync(join(sampleRoot, ...sampleMediaPath(samplesForTypes(['whoosh'])[0]!))), 'and nothing from another type').toBe(false);

      // Browsing away and back: nothing is said where nothing is left, and the category that held
      // the type counts what remains rather than what it started with.
      await openNode('Frame / border');
      await until(async () => (await hint()).text === '3 more with sample media', 'the next type along, untouched');
      await openNode('Vignette');
      expect((await hint()).shown, 'nothing left for the type that was made').toBe(false);
      await openNode('Overlays and frames');
      await until(async () => (await hint()).text === `${samplesFor('overlays-frames') - 3} more with sample media`, 'the category less the three made');

      await page.eval(`document.getElementById('scope-chip-clear').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('scope-chip').hidden`), 'the scope cleared');
      expect((await hint()).shown, 'nothing offered with nothing scoped').toBe(false);
    }, 300_000);
  });

  describe('the start screen (milestone 31, redesigned by milestone 60)', () => {
    const home = async () => {
      await page.eval(`window.pulpMenuCommand('app.home')`);
      await until(() => page.eval<boolean>(`!document.getElementById('start-screen').hidden`), 'the start screen');
    };
    // The start screen's own New project, not File → New Project: it also clears the shape and the
    // platform a test leaned the session to, which would otherwise reorder the results for every test
    // after it (milestone 65: the work is tall).
    const cleanSession = async () => {
      await page.eval(`window.pulpStartScreen(true)`);
      await page.eval(`document.getElementById('start-new-blank').click()`);
      await until(
        () => page.eval<boolean>(
          `(() => { const d = document.getElementById('unsaved-dialog'); if (d.open) { document.getElementById('unsaved-discard').click(); return false; }
            return document.getElementById('start-screen').hidden && document.querySelector('#project-button .label').textContent === 'Untitled'; })()`,
        ),
        'a clean session',
      );
    };

    it('leads with New project — the one primary — and arranges a first run and a returning user differently', async () => {
      await cleanSession();
      await home();
      // One lead action, focused for the keyboard; Open beside it as the one secondary.
      expect(await page.eval<number>(`document.querySelectorAll('#start-screen .primary').length`)).toBe(1);
      expect(await page.eval<string>(`document.querySelector('#start-screen .primary').id`)).toBe('start-new-blank');
      await until(() => page.eval<boolean>(`document.activeElement === document.getElementById('start-new-blank')`), 'the lead focused');
      expect(await page.eval<boolean>(`!!document.getElementById('start-open')`)).toBe(true);
      // Nothing on the screen jumps the keyboard order: the DOM order is the visual order.
      expect(await page.eval<number>(`[...document.querySelectorAll('#start-screen [tabindex]')].filter((el) => Number(el.tabIndex) > 0).length`)).toBe(0);

      // This suite's app is set up (ffmpeg, a folder, sample media root), so the checklist has left
      // the screen, Continue leads with the seeded recent, and the glance is one quiet line.
      await until(() => page.eval<boolean>(`document.getElementById('start-setup-card').hidden`), 'the checklist gone once set up');
      // The suite's own tests may have opened projects of their own; the seeded one is among them.
      const interviewCard = `[...document.querySelectorAll('#start-recent .start-recent-card')].find((c) => c.querySelector('.start-card-name').textContent === 'interview')`;
      await until(() => page.eval<boolean>(`!!(${interviewCard})`), 'the seeded recent to continue');
      expect(await page.eval<string>(`(${interviewCard}).querySelector('.start-card-meta').textContent`)).toBe('Today');
      expect(await page.eval<boolean>(`document.getElementById('start-invite').hidden`)).toBe(true);
      expect(await page.eval<string>(`document.getElementById('start-glance').textContent`)).toContain('templates');

      // Help still reaches the checklist once it has left the screen.
      await page.eval(`window.pulpMenuCommand('help.setup')`);
      await until(() => page.eval<boolean>(`!document.getElementById('start-setup-card').hidden`), 'the checklist back from Help');
      expect(await page.eval<string>(`document.getElementById('start-progress').textContent`)).toBe('3 of 3 done');
      expect(await page.eval<number>(`document.querySelectorAll('#start-checklist li').length`)).toBe(3);

      // A first run, as the forced arrangement the visual references use: the checklist is a card
      // near the top with its progress, and Continue gives way to a short invitation.
      await page.eval(`window.pulpStartScreen(true, 'first-run')`);
      await until(() => page.eval<boolean>(`!document.getElementById('start-setup-card').hidden && !document.getElementById('start-invite').hidden`), 'the first-run arrangement');
      expect(await page.eval<string>(`document.getElementById('start-progress').textContent`)).toBe('1 of 3 done');
      expect(await page.eval<number>(`document.querySelectorAll('#start-recent .start-recent-card').length`)).toBe(0);
      await page.eval(`window.pulpStartScreen(false)`);
      await home();
      const interviewBack = `[...document.querySelectorAll('#start-recent .start-recent-card')].find((c) => c.querySelector('.start-card-name').textContent === 'interview')`;
      await until(() => page.eval<boolean>(`!!(${interviewBack})`), 'Continue back after the forced arrangement');

      // At every window size, from a large display down to the 960 × 600 the window allows, both
      // arrangements fit: the whole screen without scrolling, Learn and the foot included. The size
      // is set here rather than left to the machine — a CI runner's small screen opens the window
      // well short of the default — and Continue holds however many recents the suite has opened
      // by now, in one row.
      const fitsAt = () => page.eval<{ window: number; scroll: number; wide: number; across: number; rows: number; above: number; below: number } & Record<string, number>>(`(() => {
        const bottom = (el) => el && el.offsetParent ? el.getBoundingClientRect().bottom : -1;
        const screen = document.getElementById('start-screen');
        const inner = screen.querySelector('.start-inner').getBoundingClientRect();
        return {
          above: Math.round(inner.top),
          below: Math.round(window.innerHeight - inner.bottom),
          window: window.innerHeight,
          scroll: screen.scrollHeight,
          wide: screen.scrollWidth,
          across: screen.clientWidth,
          rows: new Set([...document.querySelectorAll('#start-recent .start-recent-card')].map((c) => Math.round(c.getBoundingClientRect().top))).size,
          lead: bottom(document.getElementById('start-new-blank')),
          setup: document.getElementById('start-setup-card').hidden ? 0 : bottom(document.querySelector('#start-checklist li')),
          continueRow: bottom(document.querySelector('#start-recent .start-recent-card') || document.getElementById('start-invite')),
          idea: bottom(document.querySelector('#start-ideas .start-idea')),
          learn: bottom(document.getElementById('start-tour')),
          foot: bottom(document.querySelector('#start-screen .start-foot')),
        };
      })()`);
      const sizes = [[1920, 1080], [1280, 940], [1280, 880], [1280, 788], [1120, 700], [1008, 655], [1280, 645], [960, 600]] as const;
      try {
        for (const mode of ['returning', 'first-run'] as const) {
          if (mode === 'first-run') {
            await page.eval(`window.pulpStartScreen(true, 'first-run')`);
            await until(() => page.eval<boolean>(`!document.getElementById('start-setup-card').hidden`), 'the first-run arrangement to measure');
          } else {
            expect(await page.eval<number>(`document.querySelectorAll('#start-recent .start-recent-card').length`), 'the real recents, not the pinned one').toBeGreaterThanOrEqual(1);
          }
          for (const [width, height] of sizes) {
            await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
            await until(() => page.eval<boolean>(`window.innerHeight === ${height} && window.innerWidth === ${width}`), `${width} × ${height}`);
            const fits = await fitsAt();
            const at = `${mode} at ${width} × ${height}`;
            for (const part of ['lead', 'continueRow', 'idea', 'learn', 'foot', ...(mode === 'first-run' ? ['setup'] : [])]) {
              expect(fits[part]!, `${part} shown, ${at}`).toBeGreaterThan(0);
              expect(fits[part]!, `${part} visible without scrolling, ${at}`).toBeLessThanOrEqual(fits.window);
            }
            expect(fits.scroll, `nothing to scroll, ${at}`).toBeLessThanOrEqual(fits.window);
            // In the middle, top to bottom, not against the top edge.
            expect(Math.abs(fits.above - fits.below), `as much room above as below (${fits.above} and ${fits.below}), ${at}`).toBeLessThanOrEqual(1);
            expect(fits.wide, `nothing to scroll sideways, ${at}`).toBeLessThanOrEqual(fits.across);
            if (mode === 'returning') expect(fits.rows, `Continue in one row, ${at}`).toBe(1);
            // A thin divider above Continue, Start from an idea and Learn, in the screen's own palette (milestone 66).
            const dividers = await page.eval<{ width: string; color: string; room: number }[]>(`(() => {
              const probe = document.createElement('span'); probe.style.color = 'var(--s-border)'; document.getElementById('start-screen').append(probe);
              const want = getComputedStyle(probe).color; probe.remove();
              return [...document.querySelectorAll('#start-screen .start-block')].map((b) => { const st = getComputedStyle(b); return { width: st.borderTopWidth, color: st.borderTopColor === want ? 'the screen border' : st.borderTopColor, room: parseFloat(st.paddingTop) }; });
            })()`);
            expect(dividers.map((d) => d.width), `three sections, each with its divider, ${at}`).toEqual(['1px', '1px', '1px']);
            for (const d of dividers) {
              expect(d.color, at).toBe('the screen border');
              expect(d.room, `room under the divider, ${at}`).toBeGreaterThanOrEqual(6);
            }
          }
        }
      } finally {
        await page.send('Emulation.clearDeviceMetricsOverride', {});
        await page.eval(`window.pulpStartScreen(false)`);
      }
      await home();
      await until(() => page.eval<boolean>(`!!(${interviewBack})`), 'Continue back after measuring');

      // Continue opens the seeded recent.
      await page.eval(`(${interviewBack}).click()`);
      await until(
        () => page.eval<boolean>(
          `(() => { const d = document.getElementById('unsaved-dialog'); if (d.open) { document.getElementById('unsaved-discard').click(); return false; }
            return document.getElementById('start-screen').hidden && document.querySelector('#project-button .label').textContent === 'interview'; })()`,
        ),
        'the recent project open',
      );
      await cleanSession();
    }, 120_000);

    it('starts from an idea: the gallery wears real pictures, an idea lands in browse, an example opens as a copy', async () => {
      await home();
      // One gallery: five ideas and the bundled examples, each card wearing a poster.
      await until(async () => (await page.eval<number>(`document.querySelectorAll('#start-ideas .start-idea').length`)) >= 9, 'the merged gallery');
      // Every card wears a picture well; the idea cards pick a template whose thumbnail is already
      // made, so theirs are real images at once — the examples' fill in as the queue reaches them.
      expect(await page.eval<boolean>(`[...document.querySelectorAll('#start-ideas .start-idea')].every((card) => !!card.querySelector('.start-idea-pic'))`)).toBe(true);
      await until(
        async () => (await page.eval<number>(`document.querySelectorAll('#start-ideas .start-idea-pic[data-pictured]').length`)) >= 11,
        'real pictures on every card — the poster, or the hover strip made on demand',
        120_000,
      );
      // An example opens as a copy: the items arrive, the project takes its name, no path yet.
      const exampleName = await page.eval<string>(`document.querySelector('#start-ideas .start-example .start-card-name').textContent`);
      await page.eval(`document.querySelector('#start-ideas .start-example').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('start-screen').hidden`), 'the screen closed by the example');
      await until(async () => (await page.eval<number>(`document.querySelectorAll('#collection .collection-card').length`)) > 0, 'the example items in the tray');
      expect(await page.eval<string>(`document.querySelector('#project-button .label').textContent`)).toBe(exampleName);
      expect(await page.eval<string>(`document.getElementById('project-button').title`)).toBe('Not saved anywhere yet');

      // An idea lands in browse with its scope set.
      await home();
      await page.eval(`document.querySelector('#start-ideas .start-idea:not(.start-example)').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('start-screen').hidden`), 'the screen closed by the idea');
      await until(() => page.eval<boolean>(`!document.getElementById('scope-chip').hidden`), 'the browse scope set');
      expect(await page.eval<string>(`document.getElementById('scope-chip-label').textContent`)).toBe('in: Lower thirds');
      await page.eval(`document.getElementById('scope-chip-clear').click()`);
      await fire('#for-select', '', 'change');

      // Escape still closes it, and the shapes are tiles drawn in their own proportions.
      await home();
      const shapes = await page.eval<{ label: string; ratio: number }[]>(`[...document.querySelectorAll('#start-shapes .start-shape')].map((b) => { const box = b.querySelector('.shape-box').getBoundingClientRect(); return { label: b.textContent.trim(), ratio: box.width / box.height }; })`);
      expect(shapes.map((s2) => s2.label)).toEqual(['16:9', '9:16', '1:1', '4:5']);
      expect(shapes[0]!.ratio).toBeGreaterThan(1.3);
      expect(shapes[1]!.ratio).toBeLessThan(0.8);
      await page.eval(`document.getElementById('start-close').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('start-screen').hidden`), 'closed');
      await cleanSession();
    }, 120_000);

    it('starts a new project for a platform from the one list, and every item opens set up for it (milestone 20)', async () => {
      await home();
      await until(async () => (await page.eval<number>(`document.querySelectorAll('#start-platform-select option').length`)) >= 5, 'the platforms as one list');
      expect(
        await page.eval<string>(`document.getElementById('start-platforms-note').textContent`),
        'the date the limits were read',
      ).toContain('limits checked');

      await fire('#start-platform-select', 'tiktok', 'change');
      await until(
        () => page.eval<boolean>(
          `(() => { const d = document.getElementById('unsaved-dialog'); if (d.open) { document.getElementById('unsaved-discard').click(); return false; }
            return document.getElementById('start-screen').hidden; })()`,
        ),
        'the screen closed by a new project for TikTok',
      );

      // The making-choice test before this one leaves its "For…" theme set — as a person would be
      // left — so the chip is put back before looking for an item the theme does not carry.
      await page.eval(`(() => { const f = document.getElementById('for-select'); if (f.value !== '') { f.value = ''; f.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
      // The lean, not a lock: every item shown opens at the platform's shape, size, rate and encoder.
      await clickResult('Lower Third Bar');
      await openTab('output');
      await until(() => page.eval<string>(`document.getElementById('opt-platform').value`).then((v) => v === 'tiktok'), 'the platform in the Output tab');
      expect(await page.eval<string>(`document.getElementById('opt-aspect').value`), 'its shape').toBe('9:16');
      expect(await page.eval<string>(`document.getElementById('opt-fps').value`), 'its frame rate').toBe('30');
      expect(await page.eval<string>(`document.getElementById('preset').value`), 'its encoder').toBe('h264-mp4');

      // Left as it was found.
      await fire('#opt-platform', '', 'change');
      await fire('#opt-fps', '', 'change');
      await openTab('parameters');
      await cleanSession();
    }, 90_000);

    it('finds the templates made for vertical first in a vertical project, with their safe areas on, and not in a wide one (milestone 65)', async () => {
      // Which templates are made for vertical, read from their own manifests.
      const vertical = new Set<string>();
      for (const dir of await readdir(join(ROOT, 'templates'))) {
        const file = join(ROOT, 'templates', dir, 'template.json');
        if (!existsSync(file)) continue;
        const m = JSON.parse(await readFile(file, 'utf8')) as { name: string; tags?: string[] };
        if (m.tags?.includes('made-for-vertical')) vertical.add(m.name);
      }
      expect(vertical.size).toBeGreaterThanOrEqual(22);
      const clearNarrowing = async () => {
        await fire('#search', '', 'input');
        await page.eval(`(() => { const f = document.getElementById('for-select'); if (f.value !== '') { f.value = ''; f.dispatchEvent(new Event('change', { bubbles: true })); } if (!document.getElementById('scope-chip').hidden) document.getElementById('scope-chip-clear').click(); })()`);
        await until(() => page.eval<boolean>(`document.getElementById('scope-chip').hidden`), 'no scope');
      };
      const firstNames = async () => (await resultNames()).slice(0, vertical.size);

      // A wide session first: the default order, with what is made for vertical among the rest. The test
      // before leaves a lower third on the stage at the platform's 9:16 — a tall shape chosen for what is
      // shown, which counts — so it is set wide here.
      await cleanSession();
      await clearNarrowing();
      await clickResult('Lower Third Bar');
      await openTab('output');
      await fire('#opt-aspect', '16:9', 'change');
      await openTab('parameters');
      expect((await firstNames()).every((n) => vertical.has(n)), 'not first in a wide session').toBe(false);

      // A new 9:16 project from the start screen's shape tiles.
      await home();
      await page.eval(`[...document.querySelectorAll('#start-shapes .start-shape')].find((b) => b.textContent.trim() === '9:16').click()`);
      await until(
        () => page.eval<boolean>(`(() => { const d = document.getElementById('unsaved-dialog'); if (d.open) { document.getElementById('unsaved-discard').click(); return false; }
          return document.getElementById('start-screen').hidden; })()`),
        'the start screen closed by a new 9:16 project',
      );
      await clearNarrowing();
      await until(async () => (await firstNames()).every((n) => vertical.has(n)), 'every template made for vertical first, under the default order');

      // The browse panel has them in one place, under Quick access.
      const quickWasFolded = await page.eval<boolean>(`document.querySelector('#browse-tree [data-node="quick"]')?.getAttribute('aria-expanded') === 'false'`);
      if (quickWasFolded) await page.eval(`document.querySelector('#browse-tree [data-node="quick"]').click()`);
      await until(() => page.eval<boolean>(`!!document.querySelector('#browse-tree [data-node="vertical"]')`), 'the Made for vertical node');
      expect(await page.eval<string>(`document.querySelector('#browse-tree [data-node="vertical"]')?.textContent ?? ''`)).toContain('Made for vertical');
      if (quickWasFolded) await page.eval(`document.querySelector('#browse-tree [data-node="quick"]').click()`);

      // One chosen: the stage shows the vertical safe areas without being asked, and the saved preference is untouched.
      const shown = () => page.eval<boolean>(`!document.getElementById('safe-overlay').hidden && document.getElementById('safe-toggle').getAttribute('aria-pressed') === 'true'`);
      const savedSafe = async () => (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { player?: { safeAreas?: boolean } }).player?.safeAreas === true;
      const before = await savedSafe();
      expect(before, 'the suite runs with the safe areas off').toBe(false);
      await clickResult('Hook Bold');
      await until(shown, 'the safe areas on for a template made for vertical');
      // Turned off by hand, they stay off for the session — another vertical template too — and the preference is not changed.
      await page.eval(`document.getElementById('safe-toggle').click()`);
      await until(async () => !(await shown()), 'off by hand');
      await clickResult('Caption Duo');
      await until(() => page.eval<boolean>(`(() => { const id = document.getElementById('results').getAttribute('aria-activedescendant'); return document.getElementById(id)?.querySelector('.name')?.textContent === 'Caption Duo'; })()`), 'the next one chosen');
      expect(await shown(), 'still off: the choice is kept for the session').toBe(false);
      expect(await savedSafe()).toBe(before);
      // And back on for the rest of the session's vertical work, still without touching the preference.
      await page.eval(`document.getElementById('safe-toggle').click()`);
      await until(shown, 'back on');
      expect(await savedSafe()).toBe(before);
      // A wide template: the preference again, which is off.
      await clickResult('Lower Third Bar');
      await until(async () => !(await shown()), 'off for a template drawn wide');

      // Clicking a template that draws only 9:16 never reorders the results under it, lean or no lean.
      await cleanSession();
      await clearNarrowing();
      const wide = await resultNames();
      await clickResult('Hook Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the hook on the stage');
      expect(await resultNames(), 'the same order after the click').toEqual(wide);
    }, 180_000);

    it('holds its visual references in both themes, first run and returning (milestone 60)', async () => {
      const REFS = join(ROOT, 'tests', 'visual', 'start-screen.json');
      // Everything the screen shows settles first, so the capture is the screen, not a race.
      await home();
      await until(
        async () => (await page.eval<number>(`document.querySelectorAll('#start-ideas .start-idea-pic[data-pictured]').length`)) >= 11,
        'the gallery pictures made',
        120_000,
      );
      await page.send('Page.enable');
      // The default window at one pixel per point, whatever this machine's screen: a runner's small
      // screen opens the window shorter than the default, and a Retina one doubles the capture.
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 788, deviceScaleFactor: 1, mobile: false });
      await until(() => page.eval<boolean>(`window.innerHeight === 788 && window.innerWidth === 1280 && window.devicePixelRatio === 1`), 'the default window size');
      // The gallery scrolls sideways, and what its scrollbar looks like is the machine's, not the
      // screen's: a Mac without a trackpad — CI's virtual machine — draws a classic bar that takes
      // room and shines across the dark palette, where a Mac with one overlays it only while
      // scrolling. Hidden for the capture, so every Mac draws the same screen.
      await page.eval(`(() => { const s = document.createElement('style'); s.id = 'start-refs-style'; s.textContent = '#start-ideas { scrollbar-width: none; }'; document.head.append(s); })()`);
      const capture = async (mode: 'first-run' | 'returning', scheme: 'dark' | 'light') => {
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        // The gallery is rebuilt for each arrangement, its pictures arriving a moment later: the cards
        // there now are marked, and the capture waits for the new ones, every one wearing its picture,
        // so a slower machine captures the same screen rather than empty wells.
        await page.eval(`document.querySelectorAll('#start-ideas li').forEach((li) => { li.dataset.stale = '1'; })`);
        await page.eval(`window.pulpStartScreen(true, ${JSON.stringify(mode)})`);
        // Settled: the arrangement, the gallery and the switches all in for this showing (start-screen.ts).
        await until(() => page.eval<boolean>(`document.getElementById('start-screen').dataset.settled === ${JSON.stringify(mode)}`), `the ${mode} arrangement settled`);
        expect(await page.eval<boolean>(`document.getElementById('start-setup-card').hidden`)).toBe(mode === 'returning');
        // Every picture on the screen decoded and on its element — the gallery's, and the recent
        // project's in the returning arrangement — which is what "pictured" means (start-screen.ts).
        await until(
          () => page.eval<boolean>(`(() => { const pics = document.querySelectorAll('#start-ideas .start-idea-pic');
            const wells = [...document.querySelectorAll('#start-recent .start-thumb')];
            return !document.querySelector('#start-ideas li[data-stale]') && pics.length >= 11 && document.querySelectorAll('#start-ideas .start-idea-pic[data-pictured]').length === pics.length
              && wells.length === ${mode === 'returning' ? 1 : 0} && wells.every((w) => w.dataset.pictured === '1'); })()`),
          `the ${mode} screen with every picture on it`,
          60_000,
        );
        // No pause for the paint: the capture is DevTools' screenshot from the surface, which draws a
        // fresh frame before copying it, so whatever the page holds now is in it (src/main/capture-window.ts).
        const shot = (await page.send('Page.captureScreenshot', { format: 'png' })).result as { data: string };
        const rgba = await page.eval<number[]>(`(async () => {
          const img = new Image();
          await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = 'data:image/png;base64,${shot.data}'; });
          const c = document.createElement('canvas'); c.width = 64; c.height = 36;
          const x = c.getContext('2d'); x.drawImage(img, 0, 0, 64, 36);
          return [...x.getImageData(0, 0, 64, 36).data];
        })()`, undefined, 60_000);
        shots[`${mode}-${scheme}`] = shot.data;
        return frameHash(Uint8Array.from(rgba), 64, 36);
      };
      const hashes: Record<string, string> = {};
      const shots: Record<string, string> = {};
      try {
        for (const scheme of ['dark', 'light'] as const) {
          for (const mode of ['first-run', 'returning'] as const) hashes[`${mode}-${scheme}`] = await capture(mode, scheme);
        }
      } finally {
        await page.send('Emulation.setEmulatedMedia', { features: [] });
        await page.send('Emulation.clearDeviceMetricsOverride', {});
        await page.eval(`(() => { document.getElementById('start-refs-style')?.remove(); })()`);
        await page.eval(`window.pulpStartScreen(false)`);
      }
      // The two palettes really differ, and so do the two arrangements.
      expect(hammingDistance(hashes['returning-dark']!, hashes['returning-light']!)).toBeGreaterThan(0);
      expect(hammingDistance(hashes['first-run-dark']!, hashes['returning-dark']!)).toBeGreaterThan(0);
      if (process.env.PULP_START_REFS === 'write') {
        await writeFile(REFS, `${JSON.stringify(hashes, null, 2)}\n`);
      } else if (process.platform === 'darwin') {
        // The references were made on the platform the visual suite runs on; elsewhere the fonts differ.
        const refs = JSON.parse(await readFile(REFS, 'utf8')) as Record<string, string>;
        // A capture that does not match is kept, every one of the four beside it, where CI uploads what a
        // failed job leaves (test-artifacts/): sixty-four bits say that the screen moved, not how.
        if (Object.keys(refs).some((key) => !looksSame(hashes[key]!, refs[key]!))) {
          const dir = join(ROOT, 'test-artifacts', 'start-screen');
          await mkdir(dir, { recursive: true });
          for (const [key, data] of Object.entries(shots)) await writeFile(join(dir, `${key}-${hashes[key]}.png`), Buffer.from(data, 'base64'));
        }
        for (const key of Object.keys(refs)) {
          expect(looksSame(hashes[key]!, refs[key]!), `${key}: ${hashes[key]!} vs reference ${refs[key]!} (captures in test-artifacts/start-screen)`).toBe(true);
        }
      }
      await cleanSession();
    }, 180_000);
  });

  describe('light and dark appearance (milestone 62)', () => {
    const DARK_BG = 'rgb(22, 24, 29)';
    const LIGHT_BG = 'rgb(243, 244, 246)';
    const bodyBg = (session: Session) => session.eval<string>(`getComputedStyle(document.body).backgroundColor`);
    const saved = async () => (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { appearance?: string }).appearance;
    /** The tick in the real menu, as the main process built it from the window's state. */
    const ticked = async () => {
      const sections = await page.eval<{ label: string; items: { label?: string; submenu?: { label?: string; checked?: boolean }[] }[] }[]>(`window.pulp.menuSections()`);
      const view = sections.find((sec) => sec.label === 'View')!;
      return view.items.find((i) => i.label === 'Appearance')!.submenu!.filter((i) => i.checked).map((i) => i.label);
    };
    const choose = async (choice: 'system' | 'light' | 'dark') => {
      await page.eval(`window.pulpMenuCommand('view.appearance', ${JSON.stringify(choice)})`);
      await until(async () => (await page.eval<{ choice: string }>(`window.pulp.getAppearance()`)).choice === choice, `${choice} chosen`);
    };

    it('switches from Settings and the View menu, and every window redraws at once — the dialogs, the popped-out stage and the start screen', async () => {
      const stageTarget = async () => (await targets()).find((t) => t.type === 'page' && t.id !== appTargetId && t.title === 'Stage');
      let stage: Session | null = null;
      try {
        // The suite's seeded Dark, from the window's first style pass.
        expect(await page.eval<boolean>(`matchMedia('(prefers-color-scheme: dark)').matches`)).toBe(true);
        expect(await bodyBg(page)).toBe(DARK_BG);
        expect(await ticked()).toEqual(['Dark']);

        // Settings → Appearance → Light: the window, and the dialog it was chosen in, redraw there and then.
        await page.eval(`window.pulpMenuCommand('app.settings')`);
        await until(() => page.eval<boolean>(`document.getElementById('settings-dialog').open && document.getElementById('settings-appearance-dark').checked`), 'Settings, showing Dark');
        expect(await page.eval<string[]>(`[...document.querySelectorAll('#settings-appearance label')].map((l) => l.textContent.trim())`)).toEqual(['System', 'Light', 'Dark']);
        await page.eval(`document.getElementById('settings-appearance-light').click()`);
        await until(async () => (await bodyBg(page)) === LIGHT_BG, 'the window redrawn light');
        expect(await page.eval<boolean>(`matchMedia('(prefers-color-scheme: light)').matches`)).toBe(true);
        expect(await page.eval<string>(`getComputedStyle(document.getElementById('settings-dialog')).backgroundColor`), 'the dialog on the light panel').toBe('rgb(255, 255, 255)');
        expect(await page.eval<string>(`getComputedStyle(document.getElementById('settings-dialog')).color`), 'with dark text').toBe('rgb(27, 31, 38)');
        await until(async () => (await saved()) === 'light', 'Light in settings.json');
        await until(async () => (await ticked()).join() === 'Light', 'the View menu ticking Light');
        await page.eval(`document.getElementById('settings-close').click()`);

        // The start screen comes up in the chosen appearance — Light here, though the suite's system may be dark.
        await page.eval(`window.pulpStartScreen(true)`);
        await until(() => page.eval<boolean>(`!document.getElementById('start-screen').hidden`), 'the start screen');
        expect(await page.eval<string>(`getComputedStyle(document.getElementById('start-screen')).backgroundColor`), 'the start screen light').toBe('rgb(243, 244, 247)');
        await page.eval(`window.pulpStartScreen(false)`);

        // The popped-out stage is in the same appearance, and follows a change made while it is out.
        await page.eval(`window.pulpMenuCommand('view.popOut')`);
        await until(async () => (await stageTarget()) !== undefined, 'the stage window');
        stage = await Session.connect((await stageTarget())!.webSocketDebuggerUrl);
        await stage.send('Runtime.enable');
        await until(() => stage!.eval<boolean>(`!!document.getElementById('region-stage') && document.styleSheets.length > 0`), 'the stage window styled');
        await until(async () => (await bodyBg(stage!)) === LIGHT_BG, 'the stage window light');
        // The View menu, with the stage out: both windows go dark together, and Settings shows it.
        await choose('dark');
        await until(async () => (await bodyBg(page)) === DARK_BG && (await bodyBg(stage!)) === DARK_BG, 'both windows redrawn dark');
        expect(await page.eval<boolean>(`document.getElementById('settings-appearance-dark').checked`), 'the radio follows the menu').toBe(true);
        await page.eval(`window.pulpMenuCommand('view.popOut')`);
        await until(async () => (await stageTarget()) === undefined, 'the stage back');
        stage.close();
        stage = null;

        // System: the palette is whatever the operating system says, and saved as the choice, not a palette.
        await choose('system');
        const systemDark = (await page.eval<{ palette: string }>(`window.pulp.getAppearance()`)).palette === 'dark';
        await until(async () => (await bodyBg(page)) === (systemDark ? DARK_BG : LIGHT_BG), "the window in the system's palette");
        await until(async () => (await saved()) === 'system', 'System in settings.json');
        expect(await ticked()).toEqual(['System']);
      } finally {
        stage?.close();
        await page.eval(`(() => { if (document.getElementById('app').classList.contains('stage-out')) window.pulpMenuCommand('view.popOut'); })()`);
        await until(() => page.eval<boolean>(`!!document.getElementById('region-stage')`), 'the stage at home');
        await choose('dark');
        await until(async () => (await bodyBg(page)) === DARK_BG, 'the suite back on Dark');
      }
    }, 120_000);

    it('shows a transparent graphic over the checkerboard in either appearance, never on an opaque backdrop, and keeps a chosen background as it is', async () => {
      type Rgb = [number, number, number];
      /** The average color of a patch of the stage where the lower third draws nothing: the top-right corner. */
      const stagePatch = async (): Promise<Rgb> => {
        const b = await page.eval<{ x: number; y: number }>(`(() => { const r = document.getElementById('preview-frame').getBoundingClientRect(); return { x: Math.round(r.right - 64), y: Math.round(r.top + 24) }; })()`);
        await sleep(400); // the paint after the palette or the background changes
        const shot = (await page.send('Page.captureScreenshot', { format: 'png', clip: { x: b.x, y: b.y, width: 32, height: 32, scale: 1 } })).result as { data: string };
        return page.eval<Rgb>(`(async () => {
          const img = new Image();
          await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = 'data:image/png;base64,${shot.data}'; });
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const x = c.getContext('2d'); x.drawImage(img, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data; const sum = [0, 0, 0];
          for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
          const n = d.length / 4; return sum.map((v) => Math.round(v / n));
        })()`);
      };
      const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
      const token = (name: string) => page.eval<string>(`getComputedStyle(document.documentElement).getPropertyValue('${name}').trim()`);
      const backgroundWas = await page.eval<string>(`['checker', 'black', 'white', 'gray'].find((b) => document.getElementById('bg-' + b).getAttribute('aria-pressed') === 'true') ?? 'checker'`);
      await page.send('Page.enable');
      try {
        await fire('#search', '', 'input');
        await clickResult('Lower Third Bar');
        await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview');
        await scrubTo(90);
        await page.eval(`document.getElementById('bg-checker').click()`);
        // The page declares no color scheme, so its frame carries light — not the window's palette.
        await until(() => page.eval<boolean>(`document.getElementById('preview').style.colorScheme === 'light'`), 'the frame given the page\'s own scheme');
        for (const choice of ['dark', 'light'] as const) {
          await choose(choice);
          await until(async () => (await bodyBg(page)) === (choice === 'dark' ? DARK_BG : LIGHT_BG), `the window ${choice}`);
          // The checkerboard shows through, in this appearance's squares: between its two colors, not white.
          const [a, b] = [hex(await token('--checker-a')), hex(await token('--checker-b'))];
          const seen = await stagePatch();
          for (let c = 0; c < 3; c++) {
            expect(seen[c]!, `${choice}: channel ${c} of the stage ${JSON.stringify(seen)} within the checkerboard's ${JSON.stringify([a, b])}`).toBeGreaterThanOrEqual(Math.min(a[c]!, b[c]!) - 3);
            expect(seen[c]!).toBeLessThanOrEqual(Math.max(a[c]!, b[c]!) + 3);
          }
          // A chosen background is the work's, not the window's: black is black and gray is gray in both.
          await page.eval(`document.getElementById('bg-black').click()`);
          expect(await stagePatch(), `${choice}: black`).toEqual([0, 0, 0]);
          await page.eval(`document.getElementById('bg-gray').click()`);
          expect(await stagePatch(), `${choice}: gray`).toEqual([128, 128, 128]);
          await page.eval(`document.getElementById('bg-checker').click()`);
        }
        // The two appearances' boards really differ.
        expect(await token('--checker-a'), 'the light board').not.toBe('#2a2d33');
      } finally {
        await choose('dark');
        await page.eval(`document.getElementById(${JSON.stringify(`bg-${backgroundWas}`)}).click()`);
      }
    }, 120_000);

    it('holds visual references of the main window in each appearance (milestone 62)', async () => {
      const REFS = join(ROOT, 'tests', 'visual', 'window.json');
      // A settled window: no search, the lower third on the stage at a set frame, the results at their top.
      await fire('#search', '', 'input');
      await clickResult('Lower Third Bar');
      // At the shape it is meant at, whatever an earlier test chose: the reference was once made with
      // a 9:16 the platform test leaked into every test after it (milestone 65, cleanSession).
      await fire('#opt-aspect', '16:9', 'change');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview');
      await scrubTo(90);
      await page.eval(`document.getElementById('results').scrollTop = 0`);
      await page.send('Page.enable');
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 788, deviceScaleFactor: 1, mobile: false });
      await until(() => page.eval<boolean>(`window.innerHeight === 788 && window.innerWidth === 1280 && window.devicePixelRatio === 1`), 'the default window size');
      const capture = async () => {
        await sleep(500); // the paint after the palette and the size settle
        const shot = (await page.send('Page.captureScreenshot', { format: 'png' })).result as { data: string };
        const rgba = await page.eval<number[]>(`(async () => {
          const img = new Image();
          await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = 'data:image/png;base64,${shot.data}'; });
          const c = document.createElement('canvas'); c.width = 64; c.height = 36;
          const x = c.getContext('2d'); x.drawImage(img, 0, 0, 64, 36);
          return [...x.getImageData(0, 0, 64, 36).data];
        })()`, undefined, 60_000);
        return frameHash(Uint8Array.from(rgba), 64, 36);
      };
      const hashes: Record<string, string> = {};
      try {
        for (const choice of ['dark', 'light'] as const) {
          await choose(choice);
          await until(async () => (await bodyBg(page)) === (choice === 'dark' ? DARK_BG : LIGHT_BG), `the window ${choice}`);
          hashes[choice] = await capture();
        }
      } finally {
        await page.send('Emulation.clearDeviceMetricsOverride', {});
        await choose('dark');
      }
      // The two palettes really differ.
      expect(hammingDistance(hashes.dark!, hashes.light!)).toBeGreaterThan(0);
      if (process.env.PULP_WINDOW_REFS === 'write') {
        await writeFile(REFS, `${JSON.stringify(hashes, null, 2)}\n`);
      } else if (process.platform === 'darwin') {
        // Made on the platform the visual suite runs on; elsewhere the fonts differ.
        const refs = JSON.parse(await readFile(REFS, 'utf8')) as Record<string, string>;
        for (const key of Object.keys(refs)) {
          expect(looksSame(hashes[key]!, refs[key]!), `${key}: ${hashes[key]!} vs reference ${refs[key]!}`).toBe(true);
        }
      }
    }, 120_000);
  });

  describe("the interface's language (milestone 59)", () => {
    const savedLanguage = async () => (JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { language?: string }).language;
    const menuWords = async () => {
      const sections = await page.eval<{ label: string; items: { label?: string }[] }[]>(`window.pulp.menuSections()`);
      return sections.flatMap((sec) => [sec.label, ...sec.items.map((i) => i.label ?? '')]);
    };
    const stageTarget = async () => (await targets()).find((t) => t.type === 'page' && t.id !== appTargetId && t.title === 'Stage');

    it('switches from Settings without a restart: the window, the menu and the popped-out stage in the new words, the choice kept', async () => {
      let stage: Session | null = null;
      try {
        await page.eval(`window.pulpMenuCommand('app.settings')`);
        await until(() => page.eval<boolean>(`document.getElementById('settings-dialog').open`), 'Settings');
        // The system's language first, naming the one it comes to; then each language under its own name.
        const options = await page.eval<{ value: string; text: string }[]>(`[...document.getElementById('settings-language').options].map((o) => ({ value: o.value, text: o.textContent }))`);
        expect(options.map((o) => o.value)).toEqual(['system', 'en-US', 'en-GB']);
        expect(options[0]!.text).toMatch(/^Same as the system \(English \((US|UK)\)\)$/);
        expect(options.slice(1).map((o) => o.text)).toEqual(['English (US)', 'English (UK)']);
        expect(await page.eval<string>(`document.getElementById('settings-language').value`), 'the suite runs in US English').toBe('en-US');
        expect(await page.eval<string>(`document.getElementById('bg-gray').getAttribute('aria-label')`)).toBe('Gray background');

        // The stage out first, so a change reaches the window it is in as well as this one.
        await page.eval(`window.pulpMenuCommand('view.popOut')`);
        await until(async () => (await stageTarget()) !== undefined, 'the stage window');
        stage = await Session.connect((await stageTarget())!.webSocketDebuggerUrl);
        await stage.send('Runtime.enable');
        await until(() => stage!.eval<boolean>(`!!document.getElementById('bg-gray')`), "the stage's elements in its window");

        await fire('#settings-language', 'en-GB', 'change');
        await until(() => page.eval<boolean>(`document.documentElement.lang === 'en-GB'`), 'the window in British English');
        expect(await page.eval<string>(`document.querySelector('[data-i18n="ui.chip-favorites.favorites"]').textContent`)).toBe('Favourites');
        expect(await page.eval<string>(`document.getElementById('chip-favorites').getAttribute('data-tip')`)).toBe('Favourites only');
        // The popped-out stage's words follow, in its own document.
        await until(() => stage!.eval<boolean>(`document.getElementById('bg-gray').getAttribute('aria-label') === 'Grey background' && document.documentElement.lang === 'en-GB'`), 'the stage window in British English');
        // The application menu, built by the main process, is rebuilt in the new words.
        await until(async () => (await menuWords()).includes('Theatre'), 'the View menu saying Theatre');
        expect(await menuWords()).not.toContain('Theater');
        // Words that are not British spelling stay as they are.
        expect(await menuWords()).toContain('Render…');
        await until(async () => (await savedLanguage()) === 'en-GB', 'English (UK) in settings.json');

        // Back to US English, the same way.
        await fire('#settings-language', 'en-US', 'change');
        await until(() => page.eval<boolean>(`document.documentElement.lang === 'en-US'`), 'the window in US English');
        await until(() => stage!.eval<boolean>(`document.getElementById('bg-gray').getAttribute('aria-label') === 'Gray background'`), 'the stage window back');
        await until(async () => (await menuWords()).includes('Theater'), 'the menu back');
        await until(async () => (await savedLanguage()) === 'en-US', 'English (US) in settings.json');
        // The system's: saved as the choice, not as a language, and showing the one it comes to.
        await fire('#settings-language', 'system', 'change');
        await until(async () => (await savedLanguage()) === 'system', 'the system in settings.json');
        const followed = await page.eval<{ locale: string }>(`window.pulp.getLanguage()`);
        await until(() => page.eval<boolean>(`document.documentElement.lang === ${JSON.stringify(followed.locale)}`), "the window in the system's language");
      } finally {
        stage?.close();
        await page.eval(`(() => { if (document.getElementById('app').classList.contains('stage-out')) window.pulpMenuCommand('view.popOut'); })()`);
        await until(() => page.eval<boolean>(`!!document.getElementById('region-stage')`), 'the stage at home');
        await page.eval(`window.pulp.setLanguage('en-US')`);
        await until(() => page.eval<boolean>(`document.documentElement.lang === 'en-US'`), 'the suite back in US English');
        await page.eval(`document.getElementById('settings-dialog').close()`);
      }
    }, 90_000);
  });

  describe('recording a voice (milestone 63)', () => {
    const recordingsDir = () => join(userData, 'Recordings');
    const wavFiles = async () => (existsSync(recordingsDir()) ? (await readdir(recordingsDir())).filter((f) => f.endsWith('.wav')).sort() : []);
    /** A saved WAV's length, read from its own header: data bytes over bytes-per-second. */
    const wavSeconds = async (file: string) => {
      const bytes = await readFile(join(recordingsDir(), file));
      return bytes.readUInt32LE(40) / bytes.readUInt32LE(28);
    };
    const recording = () => page.eval<boolean>(`document.getElementById('record-audio').getAttribute('aria-pressed') === 'true'`);
    const stripTime = () => page.eval<string>(`document.getElementById('rec-time').textContent`);

    it('records from the button: the strip shows the level and the time, the take lands in the library with its length', async () => {
      await fire('#search', '', 'input');
      expect(await wavFiles()).toHaveLength(0);
      await page.eval(`document.getElementById('record-audio').click()`);
      await until(recording, 'the button pressed and listening');
      expect(await page.eval<boolean>(`!document.getElementById('rec-strip').hidden && !document.getElementById('rec-live').hidden`), 'the strip up').toBe(true);
      // The time and the meter are read from the samples themselves: the fake input is a steady tone.
      // The clock floors, so 0:01 means a whole second is really on tape.
      await until(async () => (await stripTime()) >= '0:01', 'a second of samples on the clock');
      await until(() => page.eval<number>(`parseFloat(document.getElementById('rec-level').style.width) || 0`).then((w) => w > 5), 'the level meter moving');
      // While it records, the File menu's item is the way to stop, and says so.
      const fileItems = async () => {
        const sections = await page.eval<{ label: string; items: { label?: string }[] }[]>(`window.pulp.menuSections()`);
        return sections.find((sec) => sec.label === 'File')!.items.map((i) => i.label);
      };
      await until(async () => (await fileItems()).includes('Stop Recording'), 'File reading Stop Recording');

      await page.eval(`document.getElementById('record-audio').click()`);
      await until(async () => !(await recording()), 'the take ended');
      await until(async () => (await wavFiles()).length === 1, 'the take saved into Recordings');
      const [file] = await wavFiles();
      expect(file).toMatch(/^Recording \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.wav$/);
      // The right length: at least the second the strip showed, and nothing runaway.
      expect(await wavSeconds(file!)).toBeGreaterThanOrEqual(1);
      expect(await wavSeconds(file!)).toBeLessThanOrEqual(10);
      expect(await fileItems(), 'the item reads Record Audio again').toContain('Record Audio');

      // Into the library: the Recordings folder joined it, and the take is selected in the results.
      await until(async () => {
        const settings = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { libraryFolders?: string[] };
        return settings.libraryFolders?.includes(recordingsDir()) === true;
      }, 'the Recordings folder in the library');
      // Chosen and scrolled into view: the results' active descendant is the take, by name.
      const activeCard = () => page.eval<string>(`(() => { const id = document.getElementById('results').getAttribute('aria-activedescendant'); return id ? (document.getElementById(id)?.querySelector('.name')?.textContent ?? '') : ''; })()`);
      await until(async () => (await activeCard()).startsWith('Recording '), 'the take chosen and in view in the results');
      // Usable everywhere a sound is: it is an audio card with a waveform drawn from the file itself.
      await until(
        () => page.eval<boolean>(`(() => { const id = document.getElementById('results').getAttribute('aria-activedescendant'); return !!document.getElementById(id)?.querySelector('.thumb svg path'); })()`),
        'its waveform on the card',
      );
    }, 90_000);

    it('records from the menu, stops with Escape, and the chosen input is remembered from the small menu', async () => {
      await page.eval(`window.pulpMenuCommand('record.audio')`);
      await until(recording, 'listening, started from the menu');
      await until(async () => (await stripTime()) >= '0:01', 'a second on the clock');
      await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
      await until(async () => !(await recording()), 'Escape ended the take');
      await until(async () => (await wavFiles()).length === 2, 'the second take saved');

      // The small menu beside the button: the inputs, the default first; a choice is remembered.
      await page.eval(`document.getElementById('record-input').click()`);
      await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu')`), 'the input menu');
      const options = await page.eval<string[]>(`[...document.querySelectorAll('.context-menu > button')].map((b) => b.textContent)`);
      expect(options[0]).toBe('System default');
      expect(await page.eval<string>(`document.querySelector('.context-menu > button').getAttribute('aria-checked')`), 'the default ticked until one is chosen').toBe('true');
      if (options.length > 1) {
        const picked = options[options.length - 1]!;
        await page.eval(`[...document.querySelectorAll('.context-menu > button')].at(-1).click()`);
        await until(async () => {
          const settings = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { recordingInput?: { label?: string } };
          return settings.recordingInput?.label === picked;
        }, 'the chosen input in settings.json');
        // Reopened, the choice is the one ticked.
        await page.eval(`document.getElementById('record-input').click()`);
        await until(() => page.eval<boolean>(`!!document.querySelector('.context-menu')`), 'the menu again');
        expect(await page.eval<string>(`[...document.querySelectorAll('.context-menu > button')].at(-1).getAttribute('aria-checked')`)).toBe('true');
        await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
        await until(() => page.eval<boolean>(`!document.querySelector('.context-menu')`), 'the menu closed');
        // A take still records with the remembered input asked for.
        await page.eval(`document.getElementById('record-audio').click()`);
        await until(recording, 'listening on the chosen input');
        await page.eval(`document.getElementById('rec-stop').click()`);
        await until(async () => !(await recording()), 'stopped from the strip');
        await until(async () => (await wavFiles()).length === 3, 'the third take saved');
      } else {
        await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      }
      // Put the chosen input back to the default for whatever runs after.
      await page.eval(`window.pulp.setRecordingInput(null)`);
    }, 90_000);
  });

  describe('recording from a camera (milestone 64)', () => {
    const recordingsDir = () => join(userData, 'Recordings');
    const takes = async () => (existsSync(recordingsDir()) ? (await readdir(recordingsDir())).filter((f) => /\.(mp4|webm)$/.test(f)).sort() : []);
    const previewOpen = () => page.eval<boolean>(`document.getElementById('camera-dialog').open`);
    const recordingVideo = () => page.eval<boolean>(`document.getElementById('camera-record').getAttribute('aria-pressed') === 'true'`);
    const cameraLive = () => page.eval<boolean>(`(() => { const v = document.getElementById('camera-preview'); return !document.getElementById('camera-record').disabled && v.videoWidth > 0; })()`);
    const clock = () => page.eval<string>(`document.getElementById('camera-time').textContent`);
    const fileItems = async () => {
      const sections = await page.eval<{ label: string; items: { label?: string }[] }[]>(`window.pulp.menuSections()`);
      return sections.find((sec) => sec.label === 'File')!.items.map((i) => i.label);
    };
    /** What ffprobe reads of a take: its streams and its length. */
    const probeTake = async (file: string) => {
      const ffmpeg = await detectFfmpeg();
      expect(ffmpeg.ok).toBe(true);
      if (!ffmpeg.ok) throw new Error('no ffmpeg');
      const result = await runBounded(ffprobePathFor(ffmpeg.path), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(recordingsDir(), file)], { timeoutMs: 60_000 });
      return JSON.parse(result.stdout) as { streams: { codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }[]; format: { duration: string } };
    };
    /** A real Escape, from the input pipeline: a dialog's cancel is not fired by a synthetic event. */
    const pressEscape = async () => {
      for (const type of ['keyDown', 'keyUp'] as const) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    };

    it('records from the camera button: a mirrored live preview, Record and Stop, and a playable clip at the camera size and rate in the library', async () => {
      await fire('#search', '', 'input');
      const before = await takes();
      await page.eval(`document.getElementById('record-video').click()`);
      await until(previewOpen, 'the preview open');
      await until(cameraLive, "the fake camera's picture in the preview", 30_000);
      // A computer's camera faces the person, so the preview is a mirror; the file is not (checked below by the picture's size alone,
      // since the recorder takes the camera's track — the mirror is the preview's styling).
      expect(await page.eval<string>(`getComputedStyle(document.getElementById('camera-preview')).transform`), 'mirrored').toMatch(/^matrix\(-1, 0, 0, 1, 0, 0\)$/);
      // The menus: the cameras, default first; the sound, No sound first, then the default microphone.
      const cameras = await page.eval<string[]>(`[...document.getElementById('camera-source').options].map((o) => o.textContent)`);
      expect(cameras[0]).toBe('System default');
      expect(cameras.length, 'the fake camera listed').toBeGreaterThanOrEqual(2);
      const sounds = await page.eval<string[]>(`[...document.getElementById('camera-sound').options].map((o) => o.textContent)`);
      expect(sounds.slice(0, 2)).toEqual(['No sound', 'System default microphone']);
      expect(await page.eval<string>(`document.getElementById('camera-sound').value`), 'sound on by default').toBe('');
      // What the camera opened at — its own size and rate — is what the file must hold.
      const camera = await page.eval<{ width: number; height: number; frameRate: number }>(`(() => { const s = document.getElementById('camera-preview').srcObject.getVideoTracks()[0].getSettings(); return { width: s.width, height: s.height, frameRate: s.frameRate }; })()`);
      expect(await page.eval<string>(`document.getElementById('camera-status').textContent`)).toContain(`${camera.width} × ${camera.height}`);

      await page.eval(`document.getElementById('camera-record').click()`);
      await until(recordingVideo, 'recording');
      expect(await page.eval<string>(`document.getElementById('camera-record').textContent`)).toBe('Stop');
      expect(await page.eval<boolean>(`!document.getElementById('camera-live').hidden`), 'the clock over the picture').toBe(true);
      expect(await page.eval<boolean>(`document.getElementById('camera-source').disabled && document.getElementById('camera-sound').disabled`), 'the menus held while recording').toBe(true);
      await until(async () => (await fileItems()).includes('Stop Recording'), 'File reading Stop Recording');
      await until(async () => (await clock()) >= '0:02', 'two seconds on the clock', 30_000);

      await page.eval(`document.getElementById('camera-record').click()`);
      await until(async () => !(await previewOpen()), 'the preview closed when the take ended');
      // The camera off at once, not when the save finishes: its light is the person's to trust.
      expect(await page.eval<boolean>(`document.getElementById('camera-preview').srcObject === null`)).toBe(true);
      await until(async () => (await takes()).length === before.length + 1, 'the take converted into Recordings', 90_000);
      const [file] = (await takes()).filter((f) => !before.includes(f));
      expect(file, 'an MP4, converted from the recorder\'s WebM').toMatch(/^Recording \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}( \(\d+\))?\.mp4$/);
      expect(existsSync(join(userData, 'Recordings in progress')) ? await readdir(join(userData, 'Recordings in progress')) : [], 'nothing left staged').toEqual([]);
      expect(await fileItems(), 'the item reads Record Video again').toContain('Record Video');

      // Playable, at the camera's own size and a steady rate at its own, with its sound, for the length recorded.
      const info = await probeTake(file!);
      const video = info.streams.find((st) => st.codec_type === 'video')!;
      expect(video.codec_name).toBe('h264');
      expect([video.width, video.height]).toEqual([camera.width - (camera.width % 2), camera.height - (camera.height % 2)]);
      expect(video.avg_frame_rate, 'a constant rate: its average is its rate').toBe(video.r_frame_rate);
      const [num, den] = video.avg_frame_rate!.split('/').map(Number);
      expect(Math.abs(num! / den! - camera.frameRate) / camera.frameRate, `${video.avg_frame_rate} against the camera's ${camera.frameRate}`).toBeLessThanOrEqual(0.02);
      expect(info.streams.find((st) => st.codec_type === 'audio')?.codec_name, 'its sound, as AAC').toBe('aac');
      expect(Number(info.format.duration)).toBeGreaterThanOrEqual(1.8);
      expect(Number(info.format.duration)).toBeLessThanOrEqual(15);

      // Into the library like any clip: chosen in the results, with a poster and a hover strip.
      const activeId = () => page.eval<string>(`(() => { const id = document.getElementById('results').getAttribute('aria-activedescendant'); return id ? (document.getElementById(id)?.dataset.id ?? document.getElementById(id)?.closest('[data-id]')?.dataset.id ?? '') : ''; })()`);
      const activeName = () => page.eval<string>(`(() => { const id = document.getElementById('results').getAttribute('aria-activedescendant'); return id ? (document.getElementById(id)?.querySelector('.name')?.textContent ?? '') : ''; })()`);
      await until(async () => (await activeName()) === file!.replace(/\.mp4$/, ''), 'the take chosen and in view in the results', 30_000);
      await until(
        () => page.eval<boolean>(`(() => { const id = document.getElementById('results').getAttribute('aria-activedescendant'); return !!document.getElementById(id)?.querySelector('.thumb img[src^="pulp-thumb://"]'); })()`),
        'its poster on the card',
        60_000,
      );
      const id = await activeId();
      expect(id).toMatch(/^[0-9a-f]{24}$/);
      const strip = await page.eval<{ url: string | null; reason?: string }>(`window.pulp.hoverStrip(${JSON.stringify(id)})`, undefined, 60_000);
      expect(strip.url, strip.reason ?? 'a hover strip').toMatch(/^pulp-strip:\/\//);
    }, 180_000);

    it('records from the menu with No sound remembered, stops with Escape, and keeps a voice off the microphone meanwhile', async () => {
      const before = await takes();
      await page.eval(`window.pulpMenuCommand('record.video')`);
      await until(previewOpen, 'the preview open from File → Record Video');
      await until(cameraLive, 'the picture');
      // A voice cannot start while the camera is open, from the menu that still answers with the preview up.
      await page.eval(`window.pulpMenuCommand('record.audio')`);
      await until(() => page.eval<boolean>(`document.getElementById('collection-note').textContent.includes('The camera is open')`), 'the voice refused, and why');
      expect(await page.eval<string>(`document.getElementById('record-audio').getAttribute('aria-pressed')`)).toBe('false');

      // No sound, chosen and remembered.
      await fire('#camera-sound', 'off', 'change');
      await until(async () => {
        const settings = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { videoInputs?: { sound?: boolean } };
        return settings.videoInputs?.sound === false;
      }, 'No sound in settings.json');
      await until(async () => (await cameraLive()) && (await page.eval<number>(`document.getElementById('camera-preview').srcObject.getAudioTracks().length`)) === 0, 'the camera reopened without its microphone');

      // The menu's second press records, a real Escape stops — and the preview under it closes with the take.
      await page.eval(`window.pulpMenuCommand('record.video')`);
      await until(recordingVideo, 'recording from the menu');
      await until(async () => (await clock()) >= '0:01', 'a second on the clock', 30_000);
      await pressEscape();
      await until(async () => !(await previewOpen()), 'Escape ended the take');
      await until(async () => (await takes()).length === before.length + 1, 'the silent take saved', 90_000);
      const [file] = (await takes()).filter((f) => !before.includes(f));
      expect((await probeTake(file!)).streams.map((st) => st.codec_type), 'picture only').toEqual(['video']);

      // Reopened, the preview remembers No sound; Escape with nothing recording just closes it, the camera off.
      await page.eval(`document.getElementById('record-video').click()`);
      await until(cameraLive, 'the preview again');
      expect(await page.eval<string>(`document.getElementById('camera-sound').value`)).toBe('off');
      await pressEscape();
      await until(async () => !(await previewOpen()), 'closed by Escape');
      // The dialog's close event, which turns the camera off, is queued after it closes: waited for, not raced.
      await until(() => page.eval<boolean>(`document.getElementById('camera-preview').srcObject === null`), 'the camera off');
      expect((await takes()).length, 'nothing recorded by closing').toBe(before.length + 1);
      // Sound back on for whatever runs after.
      await page.eval(`window.pulp.setVideoInputs({ camera: null, microphone: null, sound: true })`);
    }, 180_000);
  });

  describe('the polished set in the results (milestone 61)', () => {
    it('leads Objects and Design elements under the default order, on its studio backdrop, and keeps its place under any other', async () => {
      type Card = { id: string; name: string; look: string | null; backdrop: string };
      const cards = () => page.eval<Card[]>(`[...document.querySelectorAll('#results .card')].map((c) => ({ id: c.dataset.id, name: c.querySelector('.name').textContent, look: c.dataset.look ?? null, backdrop: getComputedStyle(c.querySelector('.thumb')).backgroundImage }))`);
      /**
       * The results in order, past the end of the polished set: the grid renders only the cards in
       * view, so it is scrolled a screen at a time and each card kept where it first appears.
       */
      const inOrder = async (): Promise<Card[]> => {
        const seen: Card[] = [];
        await page.eval(`document.getElementById('results').scrollTop = 0`);
        for (let step = 0; step < 30; step++) {
          await sleep(250);
          for (const c of await cards()) if (!seen.some((x) => x.id === c.id)) seen.push(c);
          if (seen.some((c) => c.look !== 'polished')) break;
          const moved = await page.eval<boolean>(`(() => { const r = document.getElementById('results'); const before = r.scrollTop; r.scrollTop += r.clientHeight * 0.8; return r.scrollTop > before; })()`);
          if (!moved) break;
        }
        // One more screen, so a polished piece out of place after the first other would show.
        await page.eval(`(() => { const r = document.getElementById('results'); r.scrollTop += r.clientHeight * 0.8; })()`);
        await sleep(250);
        for (const c of await cards()) if (!seen.some((x) => x.id === c.id)) seen.push(c);
        await page.eval(`document.getElementById('results').scrollTop = 0`);
        return seen;
      };
      const scopeTo = async (label: string) => {
        await findCategory(label);
        await until(() => page.eval<boolean>(`[...document.querySelectorAll('#browse-tree .browse-node')].some((b) => b.textContent.trim().startsWith(${JSON.stringify(label)}))`), `${label} in the tree`);
        await page.eval(`[...document.querySelectorAll('#browse-tree .browse-node')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(label)})).click()`);
        await until(() => page.eval<string>(`document.getElementById('scope-chip-label').textContent`).then((t) => t.includes(label)), `the scope on ${label}`);
      };
      try {
        await fire('#search', '', 'input');
        await fire('#sort', 'relevance', 'change');
        for (const [label, least] of [['Objects', 24], ['Design elements', 7]] as const) {
          await scopeTo(label);
          await until(async () => (await cards()).length > 0, `${label}'s cards`);
          const shown = await inOrder();
          const lead = shown.findIndex((c) => c.look !== 'polished');
          expect(lead, `${label}: polished first, then the rest (${shown.map((c) => c.name).join(', ')})`).toBeGreaterThanOrEqual(least);
          expect(shown.slice(lead).some((c) => c.look === 'polished'), `${label}: none after the first other`).toBe(false);
          // The set's one studio backdrop, not the category's tint.
          expect(shown[0]!.backdrop, `${label}: the studio backdrop`).toContain('radial-gradient');
          expect(shown[lead]!.backdrop, `${label}: the others keep theirs`).not.toContain('radial-gradient');
          await clearFindField();
        }
        // Another order is that order: by name, the Objects' polished pieces sit among the rest.
        await scopeTo('Objects');
        await fire('#sort', 'name', 'change');
        await until(async () => (await cards()).slice(0, 24).some((c) => c.look !== 'polished'), 'the polished pieces among the rest by name');
        const byName = (await cards()).map((c) => c.name.toLowerCase());
        expect(byName).toEqual([...byName].sort());
      } finally {
        await fire('#sort', 'relevance', 'change');
        await page.eval(`document.getElementById('scope-chip-clear').click()`);
        await clearFindField();
      }
    }, 90_000);
  });

  describe('the blank canvas (milestone 55): composing from nothing with layers', () => {
    const CANVAS = 'pulp.samples.blank-canvas';
    const overlay = `document.getElementById('layer-overlay')`;
    type LaidDraw = { alpha: number; dx: number; dy: number; scale: number; rotate?: number };
    type Laid = { frame: number | null; blocks: Record<string, { layers: { id: string; type: string; box: { x: number; y: number; width: number; height: number }; draw: LaidDraw }[] }> };
    /** The frame the preview is drawn at: an earlier test may have left the session at another shape. */
    const frameOf = () => page.eval<{ width: number; height: number }>(`(() => { const c = document.getElementById('preview-frame'); const [w, h] = (c.style.aspectRatio || '1920 / 1080').split('/').map(Number); return { width: w, height: h }; })()`);
    /** Select what is drawn at a frame point: the overlay must hold the current frame first, and a click may need a second go. */
    async function selectOnStage(fx: number, fy: number): Promise<void> {
      await until(() => page.eval<boolean>(`${overlay}.classList.contains('active') && ${overlay}.dataset.laidFrame === document.getElementById('preview-frame').dataset.frame && ${overlayCurrent}`), 'the overlay holding the frame, as last asked for');
      const b = await page.eval<{ left: number; top: number; width: number; height: number }>(`(() => { const r = ${overlay}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
      const f = await frameOf();
      const x = b.left + (fx / f.width) * b.width, y = b.top + (fy / f.height) * b.height;
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.eval(`${overlay}.dispatchEvent(new PointerEvent('pointerdown', { clientX: ${x}, clientY: ${y}, pointerId: 9, button: 0, bubbles: true }))`);
        await page.eval(`${overlay}.dispatchEvent(new PointerEvent('pointerup', { clientX: ${x}, clientY: ${y}, pointerId: 9, button: 0, bubbles: true }))`);
        try {
          await until(() => page.eval<boolean>(`!!${overlay}.querySelector('.stage-handle')`), 'the handles on the selection', 3000);
          return;
        } catch {
          // The overlay was still catching up; the next go lands.
        }
      }
      throw new Error('the shape was not selected on the stage');
    }
    const laidShape = async () => (await inTemplate<Laid>(`window.__pulp.laid`, CANVAS)).blocks.canvas!.layers.find((l) => l.type === 'shape');

    it('opens from File → New Blank Canvas as a transparent frame, and a shape placed, sized, moved and timed on it draws', async () => {
      await page.eval(`window.pulpMenuCommand('canvas.new')`);
      await until(
        () => page.eval<boolean>(`(document.getElementById('preview').getAttribute('src') || '').startsWith('pulp-template://${CANVAS}/')`),
        'the blank canvas on the stage',
      );
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'its preview ready');
      const F = await frameOf();
      const cx = Math.round(F.width / 2), cy = Math.round(F.height / 2), step = Math.round(F.width / 5);
      // Nothing of its own: the frame is fully transparent until something is composed on it.
      await until(async () => (await previewPixel(cx, cy, CANVAS))[3] === 0, 'the empty frame transparent at its center');

      // Add Shape Layer, the same command the Edit menu and the stage's right-click menu run:
      // a fresh shape is the accent rectangle, centered in the canvas block, drawn at once.
      await page.eval(`window.pulpMenuCommand('layer.addShape')`);
      await until(async () => {
        const px = await previewPixel(cx, cy, CANVAS);
        return Math.abs(px[0]! - 232) <= 2 && Math.abs(px[1]! - 163) <= 2 && Math.abs(px[2]! - 61) <= 2 && px[3] === 255;
      }, 'the fresh shape in the accent at the center');

      // Sized by its own ratio: the card's field makes it two and a half times as wide as tall.
      await openTab('parameters');
      const card = `document.querySelector('#params .param-card[data-layer]')`;
      await until(() => page.eval<boolean>(`!!document.querySelector('#params input[aria-label="Shape 1 ratio"]')`), 'the shape card');
      await page.eval(`(() => { const f = document.querySelector('#params input[aria-label="Shape 1 ratio"]'); f.value = '2.5'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(async () => {
        const l = await laidShape();
        return l !== undefined && Math.abs(l.box.width / l.box.height - 2.5) < 0.01;
      }, 'the laid box at the asked ratio');
      void card;

      // An ellipse leaves the box's corner empty where the rectangle filled it.
      const box = (await laidShape())!.box;
      const corner = { x: Math.round(box.x + 4), y: Math.round(box.y + 4) };
      expect((await previewPixel(corner.x, corner.y, CANVAS))[3], 'the rectangle fills its corner').toBe(255);
      await page.eval(`(() => { const f = document.querySelector('#params select[aria-label="Shape 1 shape"]'); f.value = 'ellipse'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(async () => (await previewPixel(corner.x, corner.y, CANVAS))[3] === 0, 'the ellipse leaving the corner empty');
      expect((await previewPixel(cx, cy, CANVAS))[3], 'and still filling its center').toBe(255);

      // Moved with milestone 25's handles: select it on the stage, drag it a fifth of the frame right.
      const client = async (fx: number, fy: number) => {
        const b = await page.eval<{ left: number; top: number; width: number; height: number }>(`(() => { const r = ${overlay}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
        const f = await page.eval<{ width: number; height: number }>(`(() => { const c = document.getElementById('preview-frame'); const [w, h] = (c.style.aspectRatio || '1920 / 1080').split('/').map(Number); return { width: w, height: h }; })()`);
        return { x: b.left + (fx / f.width) * b.width, y: b.top + (fy / f.height) * b.height };
      };
      const pointer = (type: string, x: number, y: number) =>
        page.eval(`${overlay}.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { clientX: ${x}, clientY: ${y}, pointerId: 9, button: 0, bubbles: true }))`);
      await selectOnStage(cx, cy);
      const at = await client(cx, cy);
      const to = await client(cx + step, cy);
      await pointer('pointerdown', at.x, at.y);
      await pointer('pointermove', to.x, to.y);
      await pointer('pointerup', to.x, to.y);
      await until(async () => Math.abs(((await laidShape())!.draw.dx) - step) < 8, 'the drag moving the shape a fifth of the frame');
      await until(async () => (await previewPixel(cx + step, cy, CANVAS))[3] === 255, 'the pixels following the drag');
      expect((await previewPixel(cx - Math.round(step * 0.8), cy, CANVAS))[3], 'and leaving where it was').toBe(0);

      // Timed on the stage: Start at Playhead gives it a beginning, before which it is not there.
      await scrubTo(60);
      await page.eval(`window.pulpMenuCommand('layer.startHere')`);
      await scrubTo(15);
      await until(async () => (await previewPixel(cx + step, cy, CANVAS))[3] === 0, 'nothing before its start');
      await scrubTo(90);
      await until(async () => (await previewPixel(cx + step, cy, CANVAS))[3] === 255, 'the shape from its start on');

      // Left as it was found: a fresh session for the tests after this one.
      await page.eval(`window.pulpMenuCommand('project.new')`);
      await until(
        () => page.eval<boolean>(
          `(() => { const d = document.getElementById('unsaved-dialog'); if (d.open) { document.getElementById('unsaved-discard').click(); return false; }
            return document.querySelector('#project-button .label').textContent === 'Untitled'; })()`,
        ),
        'a clean session left behind',
      );
      await clickResult('Lower Third Bar');
    }, 180_000);

    it('makes a property a parameter by picking it and naming it: color off the stage menu path, words off the card (milestone 55)', async () => {
      await page.eval(`window.pulpMenuCommand('canvas.new')`);
      await until(
        () => page.eval<boolean>(`(document.getElementById('preview').getAttribute('src') || '').startsWith('pulp-template://${CANVAS}/')`),
        'the blank canvas on the stage',
      );
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'its preview ready');
      const F = await frameOf();
      const cx = Math.round(F.width / 2), cy = Math.round(F.height / 2);
      // The canvas as the template ships it, whatever an earlier test composed on it.
      await openTab('parameters');
      await page.eval(`(() => { const b = document.querySelector('#params .layers-block[data-block=canvas] .layers-reset'); if (b && !b.hidden) b.click(); })()`);
      await until(async () => (await previewPixel(cx, cy, CANVAS))[3] === 0, 'the canvas empty again');
      await page.eval(`window.pulpMenuCommand('layer.addShape')`);
      await until(async () => (await previewPixel(cx, cy, CANVAS))[3] === 255, 'the shape drawn');

      // Select the shape on the stage, then run the very command the right-click menu names.
      await selectOnStage(cx, cy);
      await page.eval(`window.pulpMenuCommand('layer.exposeColor')`);

      // Picked: it lands at the top of the Parameters tab, named after the layer, the name focused to rename.
      const row = `document.querySelector('#params .exposed-param[data-expose="shape_1_color"]')`;
      await until(() => page.eval<boolean>(`!!${row}`), 'the picked parameter in the tab');
      expect(await page.eval<string>(`${row}.querySelector('.exposed-name').value`), 'named after the layer to start').toBe('Shape 1 color');
      expect(await page.eval<boolean>(`document.activeElement === ${row}.querySelector('.exposed-name')`), 'the name focused: naming is the other half of picking').toBe(true);
      await page.eval(`(() => { const f = ${row}.querySelector('.exposed-name'); f.value = 'Accent'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(() => page.eval<boolean>(`${row} && ${row}.querySelector('.exposed-name').value === 'Accent'`), 'the parameter renamed');

      // The parameter's control edits the very property it was picked from: the shape recolours.
      await page.eval(`(() => { const f = ${row}.querySelector('.color-field .hex'); f.value = '#2266ff'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(async () => {
        const px = await previewPixel(cx, cy, CANVAS);
        return Math.abs(px[0]! - 34) <= 2 && Math.abs(px[1]! - 102) <= 2 && Math.abs(px[2]! - 255) <= 2;
      }, 'the shape in the parameter\u2019s color');

      // Words off the card's own pick button, and one value with two ways to reach it.
      await page.eval(`window.pulpMenuCommand('layer.addText')`);
      await until(() => page.eval<boolean>(`!!document.querySelector('#params [aria-label="Line 2: make words a parameter"]')`), 'the pick button on the line\u2019s card');
      await page.eval(`document.querySelector('#params [aria-label="Line 2: make words a parameter"]').click()`);
      const words = `document.querySelector('#params .exposed-param[data-expose="line_2_words"]')`;
      await until(() => page.eval<boolean>(`!!${words}`), 'the words parameter in the tab');
      await page.eval(`(() => { const f = ${words}.querySelector('.layer-text'); f.value = 'Ada Lovelace'; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      // The layer card's own input answers with the same value once the form rebuilds on reselect.
      await clickResult('Blank Canvas');
      await until(
        () => page.eval<string>(`(document.querySelector('#params .param-card[data-layer="text_2"] .layer-text') || {}).value || ''`).then((v) => v === 'Ada Lovelace'),
        'the layer holding the parameter\u2019s words',
      );

      // Un-picked: the parameter goes, the layer keeps its words.
      await page.eval(`document.querySelector('#params .exposed-param[data-expose="line_2_words"] [aria-label="Stop Line 2 words being a parameter"]').click()`);
      await until(() => page.eval<boolean>(`!document.querySelector('#params .exposed-param[data-expose="line_2_words"]')`), 'the parameter gone');
      expect(await page.eval<string>(`document.querySelector('#params .param-card[data-layer="text_2"] .layer-text').value`), 'the layer keeping its words').toBe('Ada Lovelace');

      // Left as it was found.
      await page.eval(`window.pulpMenuCommand('project.new')`);
      await until(
        () => page.eval<boolean>(
          `(() => { const d = document.getElementById('unsaved-dialog'); if (d.open) { document.getElementById('unsaved-discard').click(); return false; }
            return document.querySelector('#project-button .label').textContent === 'Untitled'; })()`,
        ),
        'a clean session left behind',
      );
      await clickResult('Lower Third Bar');
    }, 180_000);

    it('gives a layer on the canvas motion: the block\u2019s fade to start with, a preset off the menu, keyframe recording off the menu (milestone 55)', async () => {
      await page.eval(`window.pulpMenuCommand('canvas.new')`);
      await until(
        () => page.eval<boolean>(`(document.getElementById('preview').getAttribute('src') || '').startsWith('pulp-template://${CANVAS}/')`),
        'the blank canvas on the stage',
      );
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'its preview ready');
      const F = await frameOf();
      const cx = Math.round(F.width / 2), cy = Math.round(F.height / 2);
      await openTab('parameters');
      await page.eval(`(() => { const b = document.querySelector('#params .layers-block[data-block=canvas] .layers-reset'); if (b && !b.hidden) b.click(); })()`);
      await until(async () => (await previewPixel(cx, cy, CANVAS))[3] === 0, 'the canvas empty again');
      await page.eval(`window.pulpMenuCommand('layer.addShape')`);
      await until(async () => (await previewPixel(cx, cy, CANVAS))[3] === 255, 'the shape drawn');

      // The canvas has no movement to lend, so its block gives every layer a fade each way: part way
      // through its first half second the shape is translucent; a moment later it is solid.
      await scrubTo(3);
      await until(async () => { const a = (await previewPixel(cx, cy, CANVAS))[3]!; return a > 0 && a < 255; }, 'the shape fading in from the block\u2019s own transition');
      await scrubTo(90);
      await until(async () => (await previewPixel(cx, cy, CANVAS))[3] === 255, 'the shape solid once in');

      // A preset off the menu path: Drift across writes keys that carry the shape from left of its
      // place to right of it over the whole graphic — the same keys milestone 51 draws and edits.
      await selectOnStage(cx, cy);
      await page.eval(`window.pulpMenuCommand('layer.motion', 'drift')`);
      await scrubTo(10);
      await until(async () => ((await laidShape())?.draw.dx ?? 0) < -5, 'the drift left of its place early on');
      await scrubTo(170);
      await until(async () => ((await laidShape())?.draw.dx ?? 0) > 5, 'the drift right of its place late on');
      // The card reads the preset back where the layer stands.
      await until(() => page.eval<string>(`(document.querySelector('#params select[aria-label="Shape 1 motion"]') || {}).value || ''`).then((v) => v === 'drift'), 'the card naming the preset');

      // Recording off the menu is the card's own switch, thrown from the stage.
      const toggle = `document.querySelector('#params .param-card[data-layer="shape_1"] .keyframing-toggle')`;
      expect(await page.eval<string>(`${toggle}.getAttribute('aria-pressed')`)).toBe('false');
      await page.eval(`window.pulpMenuCommand('layer.keyframing')`);
      await until(() => page.eval<boolean>(`${toggle}.getAttribute('aria-pressed') === 'true'`), 'recording on from the menu');
      await page.eval(`window.pulpMenuCommand('layer.keyframing')`);
      await until(() => page.eval<boolean>(`${toggle}.getAttribute('aria-pressed') === 'false'`), 'recording off again');

      // Left as it was found.
      await page.eval(`window.pulpMenuCommand('project.new')`);
      await until(
        () => page.eval<boolean>(
          `(() => { const d = document.getElementById('unsaved-dialog'); if (d.open) { document.getElementById('unsaved-discard').click(); return false; }
            return document.querySelector('#project-button .label').textContent === 'Untitled'; })()`,
        ),
        'a clean session left behind',
      );
      await clickResult('Lower Third Bar');
    }, 180_000);

    /** The canvas as the template ships it, ready for a fresh composition. */
    async function freshCanvas(): Promise<{ cx: number; cy: number }> {
      await page.eval(`window.pulpMenuCommand('canvas.new')`);
      await until(
        () => page.eval<boolean>(`(document.getElementById('preview').getAttribute('src') || '').startsWith('pulp-template://${CANVAS}/')`),
        'the blank canvas on the stage',
      );
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'its preview ready');
      // An earlier test may have left the session leaning to a platform's shape: these tests
      // compose at 16:9 first, so the canvas is pinned there the way a person would pin it.
      await openTab('output');
      await fire('#opt-aspect', '16:9', 'change');
      await until(async () => { const f = await frameOf(); return f.width > f.height; }, 'the canvas wide');
      await openTab('parameters');
      await page.eval(`(() => { const b = document.querySelector('#params .layers-block[data-block=canvas] .layers-reset'); if (b && !b.hidden) b.click(); })()`);
      const F = await frameOf();
      const cx = Math.round(F.width / 2), cy = Math.round(F.height / 2);
      await until(async () => (await previewPixel(cx, cy, CANVAS))[3] === 0, 'the canvas empty again');
      return { cx, cy };
    }

    /** A frame point as overlay client coordinates, at the frame the preview shows now. */
    async function clientAt(fx: number, fy: number): Promise<{ x: number; y: number }> {
      const b = await page.eval<{ left: number; top: number; width: number; height: number }>(`(() => { const r = ${overlay}.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
      const f = await frameOf();
      return { x: b.left + (fx / f.width) * b.width, y: b.top + (fy / f.height) * b.height };
    }

    /** Drag the selected layer from one frame point to another, as the stage's handles do. */
    async function dragLayer(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
      const a = await clientAt(from.x, from.y);
      const b = await clientAt(to.x, to.y);
      const pointer = (type: string, at: { x: number; y: number }) =>
        page.eval(`${overlay}.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { clientX: ${at.x}, clientY: ${at.y}, pointerId: 9, button: 0, bubbles: true }))`);
      await pointer('pointerdown', a);
      await pointer('pointermove', b);
      await pointer('pointerup', b);
    }

    /** Leave the session clean for the tests after this one. */
    async function leaveClean(): Promise<void> {
      await page.eval(`window.pulpMenuCommand('project.new')`);
      await until(
        () => page.eval<boolean>(
          `(() => { const d = document.getElementById('unsaved-dialog'); if (d.open) { document.getElementById('unsaved-discard').click(); return false; }
            return document.querySelector('#project-button .label').textContent === 'Untitled'; })()`,
        ),
        'a clean session left behind',
      );
      await clickResult('Lower Third Bar');
    }

    it('keeps a layout per aspect, and hands one layout to every shape on asking (milestone 55)', async () => {
      const { cx, cy } = await freshCanvas();
      await page.eval(`window.pulpMenuCommand('layer.addShape')`);
      await until(async () => (await previewPixel(cx, cy, CANVAS))[3] === 255, 'the shape drawn');
      const wide = await frameOf();
      const step = Math.round(wide.width / 5);

      // Lay it out at 16:9: a fifth of the frame to the right.
      await selectOnStage(cx, cy);
      await dragLayer({ x: cx, y: cy }, { x: cx + step, y: cy });
      await until(async () => Math.abs(((await laidShape())!.draw.dx) - step) < 8, 'the wide layout placed');

      // 9:16 starts untouched: the stack's own place, not the wide layout's.
      await openTab('output');
      await fire('#opt-aspect', '9:16', 'change');
      await until(async () => (await frameOf()).width < (await frameOf()).height, 'the frame turned tall');
      await until(async () => Math.abs((await laidShape())!.draw.dx) < 2, 'the tall shape where its stack puts it');

      // Lay the tall frame out its own way: a fifth of its height downward.
      const tall = await frameOf();
      const tcx = Math.round(tall.width / 2), tcy = Math.round(tall.height / 2);
      const drop = Math.round(tall.height / 5);
      await selectOnStage(tcx, tcy);
      await dragLayer({ x: tcx, y: tcy }, { x: tcx, y: tcy + drop });
      await until(async () => Math.abs(((await laidShape())!.draw.dy) - drop) < 8, 'the tall layout placed');

      // Back at 16:9 the wide layout stands exactly as it was left.
      await fire('#opt-aspect', '16:9', 'change');
      await until(async () => (await frameOf()).width > (await frameOf()).height, 'the frame wide again');
      await until(async () => {
        const d = (await laidShape())!.draw;
        return Math.abs(d.dx - step) < 8 && Math.abs(d.dy) < 2;
      }, 'the wide layout kept');

      // One layout for every shape, on asking: 1:1 — laid out by nobody — now starts from the wide one.
      await openTab('parameters');
      await until(() => page.eval<boolean>(`!!document.querySelector('#params [aria-label="Shape 1: use this layout on every shape"]')`), 'the every-shape button');
      await page.eval(`document.querySelector('#params [aria-label="Shape 1: use this layout on every shape"]').click()`);
      await openTab('output');
      await fire('#opt-aspect', '1:1', 'change');
      await until(async () => {
        const f = await frameOf();
        return Math.abs(f.width - f.height) < 2;
      }, 'the frame square');
      await until(async () => {
        const d = (await laidShape())!.draw;
        const f = await frameOf();
        return Math.abs(d.dx - f.width / 5) < 8;
      }, 'the square frame starting from the handed layout');
      // The tall frame's own layout outranks the handed one.
      await fire('#opt-aspect', '9:16', 'change');
      await until(async () => {
        const d = (await laidShape())!.draw;
        const f = await frameOf();
        return Math.abs(d.dy - f.height / 5) < 8 && Math.abs(d.dx) < 2;
      }, 'the tall layout still its own');
      await fire('#opt-aspect', '16:9', 'change');
      await leaveClean();
    }, 180_000);

    it('saves the canvas as a template folder that renders the frames its hand-written twin does, reopened for editing (milestone 55)', async () => {
      const { cx, cy } = await freshCanvas();
      // Built step by step in the UI: an amber bar 30% tall and 2.5 wide, a blue square 20% tall,
      // both Still so every frame is the same picture — the twin fixture draws this by hand.
      await page.eval(`window.pulpMenuCommand('layer.addShape')`);
      await until(async () => (await previewPixel(cx, cy, CANVAS))[3] === 255, 'the first shape drawn');
      await until(() => page.eval<boolean>(`!!document.querySelector('#params input[aria-label="Shape 1 size"]')`), 'the first card');
      await page.eval(`(() => { const f = document.querySelector('#params input[aria-label="Shape 1 size"]'); f.value = '30'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`(() => { const f = document.querySelector('#params input[aria-label="Shape 1 ratio"]'); f.value = '2.5'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await selectOnStage(cx, cy);
      await page.eval(`window.pulpMenuCommand('layer.motion', 'still')`);
      await page.eval(`window.pulpMenuCommand('layer.addShape')`);
      await until(() => page.eval<boolean>(`!!document.querySelector('#params input[aria-label="Shape 2 size"]')`), 'the second card');
      await page.eval(`(() => { const f = document.querySelector('#params input[aria-label="Shape 2 size"]'); f.value = '20'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`(() => { const f = document.querySelector('#params .param-card[data-layer="shape_2"] .color-field .hex'); f.value = '#2266ff'; f.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      // The second shape sits below the first: select it where it lands to give it Still too.
      const f = await frameOf();
      const below = { x: cx, y: Math.round(f.height * 0.6481) };
      await until(async () => (await previewPixel(below.x, below.y, CANVAS)).join() === '34,102,255,255', 'the blue square below');
      await selectOnStage(below.x, below.y);
      await page.eval(`window.pulpMenuCommand('layer.motion', 'still')`);
      // And one picked parameter rides along: the second shape's color, named Accent.
      await page.eval(`window.pulpMenuCommand('layer.exposeColor')`);
      await until(() => page.eval<boolean>(`!!document.querySelector('#params .exposed-param[data-expose="shape_2_color"]')`), 'the picked color');

      // Saved as a folder, the test naming where so no dialog opens; the window then shows it.
      const savedDir = join(userData, 'saved-templates', 'Twin Built');
      await page.eval(`window.pulpMenuCommand('canvas.saveTemplate', ${JSON.stringify(savedDir)})`);
      await until(
        () => page.eval<boolean>(`(document.getElementById('preview').getAttribute('src') || '').startsWith('pulp-template://custom.twin-built/')`),
        'the saved template reopened on the stage',
        30_000,
      );
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'its preview ready');
      // The saved template declares every aspect, so a session leaning to a platform's shape would
      // open it tall; the comparison is composed at 16:9, so both sides are pinned there.
      await openTab('output');
      await fire('#opt-aspect', '16:9', 'change');
      await until(async () => { const f = await frameOf(); return f.width > f.height; }, 'the saved template wide');
      const manifest = JSON.parse(await readFile(join(savedDir, 'template.json'), 'utf8')) as { id: string; parameters: { id: string }[] };
      expect(manifest.id).toBe('custom.twin-built');
      expect(manifest.parameters.map((q) => q.id)).toEqual(['shape_2_color']);

      // It renders the frames its hand-written twin does: the same probes, pixel for pixel, at
      // three frames — inside each shape, in the gap between them, and on empty ground. The probes
      // are fractions of the frame, since a session may show the two at different resolutions and
      // the composition is fractions of the frame throughout.
      const probes = [[0.5, 0.3889], [0.5, 0.6481], [0.5, 0.55], [0.15, 0.3889], [0.5, 0.1111]] as const;
      const probePixels = async (templateId: string, frame: number) => {
        await scrubTo(frame);
        const f = await frameOf();
        const out: number[][] = [];
        for (const [fx, fy] of probes) out.push(await previewPixel(Math.round(fx * f.width), Math.round(fy * f.height), templateId));
        return out;
      };
      const built: Record<number, number[][]> = {};
      for (const frame of [5, 90, 170]) built[frame] = await probePixels('custom.twin-built', frame);
      // The built side first, on its own: both shapes Still, so every frame is the same picture.
      for (const frame of [5, 90, 170]) {
        expect(built[frame]![0]!.join(), `built frame ${frame} amber interior`).toBe('232,163,61,255');
        expect(built[frame]![1]!.join(), `built frame ${frame} blue interior`).toBe('34,102,255,255');
        expect(built[frame]![4]![3], `built frame ${frame} empty ground`).toBe(0);
      }
      await clickResult('Twin Canvas');
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the twin ready');
      await until(async () => { const f = await frameOf(); return f.width > f.height; }, 'the twin wide (it declares 16:9 alone)');
      for (const frame of [5, 90, 170]) {
        for (const [i] of probes.entries()) {
          await until(async () => {
            const twin = await probePixels('test.twin-canvas', frame);
            return twin[i]!.join() === built[frame]![i]!.join();
          }, `frame ${frame} probe ${probes[i]!.join(',')} matching the twin`);
        }
      }

      // Reopened for editing: the saved template's own layers edit as the canvas's did.
      await clickResult('Twin Built');
      await until(() => page.eval<boolean>(`!!document.querySelector('#params .param-card[data-layer="shape_1"]')`), 'the saved layers editable');
      await openTab('output');
      await fire('#opt-aspect', '16:9', 'change');
      await until(async () => { const f = await frameOf(); return f.width > f.height; }, 'the reopened template wide');
      await openTab('parameters');
      await page.eval(`(() => { const g = document.querySelector('#params .param-card[data-layer="shape_1"] .color-field .hex'); g.value = '#ff0000'; g.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await scrubTo(90);
      await until(async () => { const f = await frameOf(); return (await previewPixel(Math.round(0.5 * f.width), Math.round(0.3889 * f.height), 'custom.twin-built')).join() === '255,0,0,255'; }, 'the reopened layer recolored');
      // And the picked parameter drives the very layer it was picked from.
      await page.eval(`(() => { const g = document.querySelector('#params [data-param="shape_2_color"] .color-field .hex, #params .exposed-param .color-field .hex, #params [data-param=shape_2_color] input.hex'); if (g) { g.value = '#00ff00'; g.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
      await until(async () => { const f = await frameOf(); return (await previewPixel(Math.round(0.5 * f.width), Math.round(0.6481 * f.height), 'custom.twin-built')).join() === '0,255,0,255'; }, 'the parameter recoloring its layer');
      await leaveClean();
    }, 240_000);
  });
  describe("the editor panel's bridge (milestone 54, ADR 0025)", () => {
    it('answers the library and the collection on loopback, and nothing without the token', async () => {
      // The setting was seeded on, so the running app has written the discovery file beside its settings.
      const bridgePath = join(userData, 'panel-bridge.json');
      await until(() => Promise.resolve(existsSync(bridgePath)), 'the bridge file');
      const bridge = parseBridgeFile(await readFile(bridgePath, 'utf8'));
      expect(bridge, 'the discovery file parses').not.toBeNull();

      // Without the token: 401 and nothing else — what a stray page that can reach loopback gets.
      const refused = await fetch(`http://127.0.0.1:${bridge!.port}/v1/library`);
      expect(refused.status).toBe(401);
      expect(await refused.text()).not.toContain('Lower Third');

      // With it: the bundled library, searched with the app's own syntax, no path in any answer.
      const headers = { [BRIDGE_TOKEN_HEADER]: bridge!.token };
      const library = (await (await fetch(`http://127.0.0.1:${bridge!.port}/v1/library?q=lower third`, { headers })).json()) as { items: { id: string; name: string; thumb?: boolean }[] };
      const strap = library.items.find((i) => i.name === 'Lower Third Bar');
      expect(strap, 'the bundled lower third over the bridge').toBeDefined();
      expect(JSON.stringify(library)).not.toContain(userData);

      // The collection the window holds is what the bridge lists: gather the shown item, ask again.
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('add-to-collection').disabled`), 'Add to collection ready');
      await page.eval(`document.getElementById('add-to-collection').click()`);
      await until(async () => {
        const told = (await (await fetch(`http://127.0.0.1:${bridge!.port}/v1/collection`, { headers })).json()) as { items: { name: string; missing: boolean }[] };
        return told.items.some((i) => i.name === 'Lower Third Bar' && !i.missing);
      }, 'the gathered item over the bridge');

      // Its thumbnail comes by id out of the cache, as PNG bytes.
      if (strap!.thumb) {
        const thumb = await fetch(`http://127.0.0.1:${bridge!.port}/v1/thumb/${strap!.id}`, { headers });
        expect(thumb.status).toBe(200);
        expect(thumb.headers.get('content-type')).toBe('image/png');
      }

      // Left as it was found: the tray empties again.
      await page.eval(`document.querySelector('#region-tray .collection-card [aria-label="Remove from the collection"]').click()`);
      await until(() => page.eval<boolean>(`document.querySelectorAll('#region-tray .collection-card').length === 0`), 'the tray empty again');
    }, 60_000);

    it("prepares a drop: rendered on request with the item's own settings, alpha kept, cached for the next one", async () => {
      // The render is ffmpeg's; without it there is nothing to prepare. Asked in the body,
      // not with skipIf, for the reason the clip tests give.
      const ffmpeg = await detectFfmpeg();
      if (!ffmpeg.ok) return;
      const bridge = parseBridgeFile(await readFile(join(userData, 'panel-bridge.json'), 'utf8'))!;
      const headers = { [BRIDGE_TOKEN_HEADER]: bridge.token, 'Content-Type': 'application/json' };
      const base = `http://127.0.0.1:${bridge.port}`;
      const library = (await (await fetch(`${base}/v1/library?q=lower third`, { headers })).json()) as { items: { id: string; name: string }[] };
      const strap = library.items.find((i) => i.name === 'Lower Third Bar')!;

      // No saved default for lower thirds in this scratch profile, so the alpha preset renders: ProRes 4444.
      const asked = await (await fetch(`${base}/v1/prepare`, { method: 'POST', headers, body: JSON.stringify({ id: strap.id }) })).json() as
        { ready: true; file: string } | { ready: false; job: number };
      let file: string;
      if (asked.ready) {
        file = asked.file;
      } else {
        let answer: { state: string; file?: string; message?: string } = { state: 'rendering' };
        await until(async () => {
          answer = (await (await fetch(`${base}/v1/prepare/${asked.job}`, { headers })).json()) as typeof answer;
          return answer.state !== 'rendering';
        }, 'the prepared render to finish', 150_000);
        expect(answer.state, answer.message ?? '').toBe('done');
        file = answer.file!;
      }
      // The file is real, QuickTime, and inside the managed render cache — never anywhere else.
      expect(file.endsWith('.mov'), file).toBe(true);
      expect(file.startsWith(join(userData, 'render-cache')), file).toBe(true);
      expect(existsSync(file)).toBe(true);

      // The same ask again is the cache answering: ready at once, the very same file.
      const again = (await (await fetch(`${base}/v1/prepare`, { method: 'POST', headers, body: JSON.stringify({ id: strap.id }) })).json()) as { ready: boolean; file?: string };
      expect(again.ready).toBe(true);
      expect(again.file).toBe(file);

      // What the library cannot answer for is a refusal that says so, not half an answer.
      expect((await fetch(`${base}/v1/prepare`, { method: 'POST', headers, body: JSON.stringify({ id: 'ffffffffffffffffffffffff' }) })).status).toBe(404);
    }, 180_000);

    it('goes back the other way: opens an item or a collection card in Pulp, and shows the queue as it stands', async () => {
      const bridge = parseBridgeFile(await readFile(join(userData, 'panel-bridge.json'), 'utf8'))!;
      const headers = { [BRIDGE_TOKEN_HEADER]: bridge.token, 'Content-Type': 'application/json' };
      const base = `http://127.0.0.1:${bridge.port}`;

      // Open a library item: the stage shows it, as a click in the results would.
      const found = (await (await fetch(`${base}/v1/library?q=diagonal wipe`, { headers })).json()) as { items: { id: string; name: string }[] };
      const wipe = found.items.find((i) => i.name === 'Diagonal Wipe')!;
      expect((await fetch(`${base}/v1/open`, { method: 'POST', headers, body: JSON.stringify({ id: wipe.id }) })).status).toBe(200);
      await until(
        () => page.eval<boolean>(`(document.getElementById('preview').getAttribute('src') || '').startsWith('pulp-template://pulp.samples.diagonal-wipe/')`),
        'the wipe on the stage, opened from the panel',
      );

      // Open a collection card: gathered in the window, named by uid over the bridge, chosen for editing.
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!document.getElementById('add-to-collection').disabled`), 'Add to collection ready');
      await page.eval(`document.getElementById('add-to-collection').click()`);
      let uid = '';
      await until(async () => {
        const told = (await (await fetch(`${base}/v1/collection`, { headers })).json()) as { items: { uid: string; name: string }[] };
        uid = told.items.find((i) => i.name === 'Lower Third Bar')?.uid ?? '';
        return uid !== '';
      }, 'the gathered item over the bridge');
      expect((await fetch(`${base}/v1/open`, { method: 'POST', headers, body: JSON.stringify({ uid }) })).status).toBe(200);
      await until(() => page.eval<boolean>(`document.querySelectorAll('#region-tray .collection-card.chosen').length === 1`), 'the card chosen for editing');

      // The queue as the tray shows it: whatever the prepare test left is listed, done, with its file.
      const queue = (await (await fetch(`${base}/v1/queue`, { headers })).json()) as { jobs: { label: string; status: string; file?: string }[] };
      if ((await detectFfmpeg()).ok) {
        const prepared = queue.jobs.find((j) => j.label === 'Lower Third Bar');
        expect(prepared, 'the prepared render in the queue').toBeDefined();
        expect(prepared!.status).toBe('done');
        expect(prepared!.file?.endsWith('.mov'), String(prepared!.file)).toBe(true);
      }
      // What neither holds is refused with its reason, and a finished job cannot be canceled.
      expect((await fetch(`${base}/v1/open`, { method: 'POST', headers, body: JSON.stringify({ uid: 'nope' }) })).status).toBe(404);
      expect((await fetch(`${base}/v1/queue/999999/cancel`, { method: 'POST', headers })).status).toBe(404);

      // Left as it was found.
      await page.eval(`document.querySelector('#region-tray .collection-card [aria-label="Remove from the collection"]').click()`);
      await until(() => page.eval<boolean>(`document.querySelectorAll('#region-tray .collection-card').length === 0`), 'the tray empty again');
    }, 90_000);
  });
});
