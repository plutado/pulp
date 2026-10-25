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
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { detectFfmpeg } from '../../src/core/ffmpeg';
import { writeZip } from '../../src/core/zip';
import { rawManifest } from '../fixtures';
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

interface Target { id: string; parentId?: string; type: string; url: string; webSocketDebuggerUrl: string }
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

/** A valid 2x2 RGBA PNG of one colour. */
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

describe.skipIf(!electron)('inspector UI', () => {
  const port = 9300 + Math.floor(Math.random() * 500);
  let app: ChildProcess | null = null;
  let page: Session;
  /** Scratch userData folder, so the app under test never reads or writes the real settings.json. */
  let userData = '';
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

  /** Read one preview pixel (straight RGBA, as the template's canvas holds it) in template coordinates. */
  function previewPixel(x: number, y: number, templateId = 'pulp.samples.lower-third-bar'): Promise<number[]> {
    return inTemplate<number[]>(`(() => { const d = document.getElementById('c').getContext('2d').getImageData(${x}, ${y}, 1, 1).data; return [...d]; })()`, templateId);
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
    const ffmpeg = await detectFfmpeg();
    if (ffmpeg.ok) {
      const wide = await runBounded(ffmpeg.path, ffmpegArgs(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=10', '-t', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', join(mediaDir, 'clip.mp4')]), { timeoutMs: 60_000 });
      // A tall clip too, for the orientation filter and the portrait cards.
      const tall = await runBounded(ffmpeg.path, ffmpegArgs(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=36x64:rate=10', '-t', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', join(mediaDir, 'tall.mp4')]), { timeoutMs: 60_000 });
      haveVideo = wide.code === 0 && tall.code === 0;
    }
    await writeFile(join(userData, 'settings.json'), JSON.stringify({ libraryFolders: [mediaDir] }));
    // A font already imported: a real TTF in the managed folder under a family of its own, with a
    // licence note, as fonts:import would leave it. The import dialog itself cannot be driven here.
    await mkdir(join(userData, 'fonts'), { recursive: true });
    await writeFile(join(userData, 'fonts', 'PulpTestFace.ttf'), await readFile(join(ROOT, 'fonts', 'bebas-neue', 'BebasNeue-Regular.ttf')));
    await writeFile(
      join(userData, 'fonts', 'fonts.json'),
      JSON.stringify([{ family: 'Pulp Test Face', file: 'PulpTestFace.ttf', style: 'normal', weight: 400, note: 'Bought from the foundry, desktop licence', importedAt: '2026-10-24T00:00:00Z' }]),
    );
    // The app's own output goes to a file, so a failing test can print what the main process said.
    appLog = join(userData, 'app.log');
    const logFd = openSync(appLog, 'a');
    app = spawn(electron!, ['.', `--remote-debugging-port=${port}`], {
      cwd: ROOT,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, PULP_USER_DATA: userData },
    });
    closeSync(logFd);
    let target: Target | undefined;
    await until(async () => {
      target = (await targets()).find((t) => t.type === 'page' && /renderer\/index\.html/.test(t.url));
      return target !== undefined;
    }, 'the app window');
    appTargetId = target!.id;
    page = await Session.connect(target!.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    await until(() => page.eval<boolean>(`document.querySelectorAll('#results li[data-id]').length > 0`), 'the library list');
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
    // The lower third's two colour parameters and the colour of each of its two text layers.
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

    it('picks a still from the library, treats it, keeps it in a preset by id, and clears', async () => {
      await clickResult('Lower Third Bar');
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
      // The image is contained and centred at its own shape, inside a well that keeps its height.
      const drawn = await page.eval<{ well: number[]; img: number[] }>(
        `(() => { const w = ${field}.querySelector('.image-well').getBoundingClientRect(); const i = ${field}.querySelector('.image-well img').getBoundingClientRect();
          return { well: [w.width, w.height, w.left, w.right], img: [i.width, i.height, i.left, i.right] }; })()`,
      );
      expect(drawn.well[1]).toBe(132);
      expect(drawn.img[0]).toBeCloseTo(drawn.img[1]!, 0); // the 2 x 2 fixture is square
      expect(drawn.img[2]! - drawn.well[2]!).toBeCloseTo(drawn.well[3]! - drawn.img[3]!, 0); // centred
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

      // Tinted is the one treatment with a colour, so the swatch appears only for it.
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
     * and coloured, so a band has to be a few rows tall to count.
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
          return { canvas: [c.width, c.height], bands: out.filter((b) => b.height > 3) };
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

    it('sets a layer\'s type: the family in its own face from the bundled set, and every other property, undoably', async () => {
      const title = `document.querySelector('#params .layer-row[data-layer=title]')`;
      const summary = () => page.eval<string>(`${title}.querySelector('.layer-type summary').textContent`);
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

      // The rest: weight, italic, case, size, spacing, colour, alignment, overflow — each one undo step.
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

    it('offers an imported font with its licence note, declares its face, and ends the list with Import font…', async () => {
      const title = `document.querySelector('#params .layer-row[data-layer=title]')`;
      try {
        // The managed folder was seeded with one font; the app window declares its face from the index.
        expect(await page.eval<string>(`document.querySelector('style[data-pulp-imported-fonts]').textContent`)).toContain('"Pulp Test Face"');
        await page.eval(`${title}.querySelector('.layer-type').open = true`);
        await page.eval(`${title}.querySelector('.family-current').click()`);
        await until(() => page.eval<boolean>(`!${title}.querySelector('.family-list').hidden`), 'the family list');
        // The imported family sits under its own divider, set in itself, the licence note with it.
        const rows = await page.eval<{ kind?: string; label: string; tip?: string; divider: boolean }[]>(
          `[...${title}.querySelectorAll('.family-list > li')].map((l) => ({ kind: l.dataset.kind, label: l.textContent, tip: l.dataset.tip, divider: l.classList.contains('family-divider') }))`,
        );
        const dividerAt = rows.findIndex((r) => r.divider && r.label === 'Imported');
        expect(dividerAt).toBeGreaterThan(0);
        expect(rows[dividerAt + 1]).toMatchObject({ kind: 'imported', label: 'Pulp Test Face', tip: 'Imported · Bought from the foundry, desktop licence' });
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

    it('a layer\'s own motion, behind Advanced: there at the start when the template would still be arriving, gone by the last frame', async () => {
      const subtitle = `document.querySelector('#params .layer-row[data-layer=subtitle]')`;
      try {
        await clickResult('Title Card');
        await until(() => page.eval<boolean>(`!!${subtitle}`), 'the subtitle\'s card');
        // Folded last under the layer; the delay only appears once the motion is the layer's own.
        expect(await page.eval<string>(`${subtitle}.querySelector('.layer-advanced summary').textContent`)).toBe('Advanced');
        await page.eval(`${subtitle}.querySelector('.layer-advanced').open = true`);
        expect(await page.eval<boolean>(`${subtitle}.querySelector('select[aria-label="Subtitle motion"]').closest('.type-field').hidden`)).toBe(false);
        expect(await page.eval<boolean>(`${subtitle}.querySelector('input[aria-label="Subtitle motion delay"]').closest('.type-field').hidden`)).toBe(true);

        // None: a hard cut in. At the first frame the template's own lines are still arriving —
        // nothing is drawn — so the one band is the overridden subtitle, already there.
        await fire('[data-layer=subtitle] select[aria-label="Subtitle motion"]', 'none', 'change');
        await until(() => page.eval<boolean>(`!${subtitle}.querySelector('input[aria-label="Subtitle motion delay"]').closest('.type-field').hidden`), 'the delay field shown');
        await scrubAndWait(0);
        await untilDrawn((d) => d.bands.length === 1, 'the subtitle alone at the first frame');
        // Mid-graphic both lines stand; on the last frame the override has finished inside the
        // template's out, so nothing is left on screen after the graphic has gone.
        await scrubAndWait(60);
        await untilDrawn((d) => d.bands.length === 2, 'both lines mid-graphic');
        await scrubAndWait(149);
        await untilDrawn((d) => d.bands.length === 0, 'an empty last frame');

        // A delay holds the layer back: at 0.8 s the title is in but the subtitle's two seconds are not up.
        await fire('[data-layer=subtitle] input[aria-label="Subtitle motion delay"]', '2', 'change');
        await scrubAndWait(24);
        await untilDrawn((d) => d.bands.length === 1, 'the title alone before the delay is up');
        await scrubAndWait(90);
        await untilDrawn((d) => d.bands.length === 2, 'both lines after the delay');

        // Each change was one undo step; two put the template back in charge of the subtitle.
        await page.eval(`document.getElementById('undo').click()`);
        await page.eval(`document.getElementById('undo').click()`);
        await scrubAndWait(0);
        await untilDrawn((d) => d.bands.length === 0, 'the template\'s own first frame again');
      } finally {
        await restoreLayers();
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
      // Its two lines, then the card's own colours, then the logo. No "Colors" group, and nothing left over.
      expect((await cards()).map((c) => `${c.label}: ${c.params.join(',')}`)).toEqual(['Title: ', 'Subtitle: ', 'Card: background,rule', 'Logo: logo']);
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
      await until(async () => (await cards()).length === 5, 'the added line\'s card');
      expect((await cards()).find((c) => c.card === 'element:Card')!.open, 'still folded after the rebuild').toBe(false);
      // The added line is a card like the template's own, and can be taken out again.
      const added = (await cards())[2]!;
      expect(added.label).toBe('Line 3');
      expect(await page.eval<boolean>(`!!document.querySelector('#params .param-card[data-card="${added.card}"] .layer-type')`)).toBe(true);
      await page.eval(`document.querySelector('#params .param-card[data-card="${added.card}"] [aria-label="Remove Line 3"]').click()`);
      await until(async () => (await cards()).length === 4, 'the card gone with the layer');
      await page.eval(`document.querySelector('#params .param-card[data-card="element:Card"] .card-toggle').click()`);

      // The lower third: the panel's two colours together, and what belongs to the whole graphic last.
      await clickResult('Lower Third Bar');
      await until(() => page.eval<boolean>(`!!document.querySelector('#params .param-card[data-card="element:Panel"]')`), 'the lower third\'s cards');
      expect((await cards()).map((c) => `${c.label}: ${c.params.join(',')}`)).toEqual(['Name: ', 'Title: ', 'Panel: accent,panel', 'Logo: logo', 'Layout and timing: side,inOut']);
      // "Logo" under the Logo card is not shown twice: the field's label is kept for the screen reader only.
      expect(await page.eval<string[]>(`[...document.querySelectorAll('#params .param-card[data-card="element:Logo"] .field > .field-head > span')].map((s) => s.className)`)).toEqual(['visually-hidden']);
      // Nothing visible is left in the head but, when there is one, the field's Reset.
      expect(await page.eval<number>(`document.querySelectorAll('#params .param-card[data-card="element:Logo"] .field > .field-head > span:not(.visually-hidden)').length`)).toBe(0);
      expect(await page.eval<string>(`document.querySelector('#params .param-card[data-card="element:Panel"] [data-param=panel] .field-head > span').textContent`)).toBe('Fill');

      // A template that names no element keeps the plain form it always had.
      await clickResult('Boardroom opener');
      await until(() => page.eval<boolean>(`!!document.querySelector('#params .field')`), 'the opener\'s form');
      expect(await page.eval<number>(`document.querySelectorAll('#params .param-card').length`)).toBe(0);
      expect(await page.eval<string[]>(`[...document.querySelectorAll('#params .group-label')].map((g) => g.textContent)`)).toEqual(['Colors']);
    }, 90_000);

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

      await until(() => page.eval<boolean>(`document.getElementById('cache-summary').textContent.includes('3 files')`), 'the cache summary');

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

      // A collection of nothing but media cannot be rendered yet (converting media is milestone 15).
      await page.eval(`[...document.querySelectorAll('#collection .collection-card .job-actions button')].forEach((b) => b.click())`);
      await until(async () => (await names()).length === 0, 'an empty collection');
      expect(await page.eval<boolean>(`document.getElementById('collection-render').disabled`)).toBe(true);
      expect(await page.eval<boolean>(`document.getElementById('collection-save').disabled`)).toBe(true);
      expect(await page.eval<string>(`document.getElementById('tray-summary').textContent`)).toContain('Nothing collected yet.');

      await clickResult('tiny');
      await until(() => page.eval<boolean>(`!document.getElementById('add-to-collection').disabled`), 'the add button for a media item');
      await page.eval(`document.getElementById('add-to-collection').click()`);
      await until(async () => (await names()).length === 1, 'the media item');
      expect(await page.eval<string>(`${card(0)}.querySelector('.job-status').textContent`)).toBe('Converting media comes later');
      expect(await page.eval<boolean>(`document.getElementById('collection-render').disabled`)).toBe(true);
      // It is still worth saving: a collection is also a record of what a project used.
      expect(await page.eval<boolean>(`document.getElementById('collection-save').disabled`)).toBe(false);
      expect(await page.eval<string>(`document.getElementById('tray-summary').textContent`)).toContain('1 not renderable yet');

      await page.eval(`${card(0)}.querySelector('.job-actions button').click()`);
      await until(async () => (await names()).length === 0, 'an empty collection again');
    }, 90_000);

    it('keeps the results readable on a short window: the stage yields and the tray is capped', async () => {
      // The tray is open from the tests above. Windows CI runs on a small display, where the tray
      // and the stage's share once left the results list a few pixels tall (docs/platform-notes.md).
      const metrics = () =>
        page.eval<{ inner: number; results: number; stage: number; tray: number; search: number }>(
          `({ inner: window.innerHeight, results: document.getElementById('results').clientHeight, stage: document.getElementById('region-stage').clientHeight, tray: document.getElementById('region-tray').clientHeight, search: document.getElementById('region-search').clientHeight })`,
        );
      expect(await page.eval<boolean>(`document.getElementById('app').classList.contains('tray-collapsed')`)).toBe(false);
      const own = await metrics();
      try {
        for (const height of [697, 600]) {
          await page.send('Emulation.setDeviceMetricsOverride', { width: 1024, height, deviceScaleFactor: 1, mobile: false });
          await until(async () => (await metrics()).inner === height, `the window at ${height} px`);
          const m = await metrics();
          expect(m.results, `results at ${height}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(160);
          expect(m.stage, `stage at ${height}: ${JSON.stringify(m)}`).toBeGreaterThanOrEqual(150);
          // Nothing overflows the window: what the column holds adds up to what it has.
          expect(m.search + m.stage + m.results, `fit at ${height}: ${JSON.stringify(m)}`).toBeLessThanOrEqual(height);
          // And the sweep still reaches the last item at this size.
          const last = (await resultNames()).at(-1)!;
          expect(await sweepTo(last)).toBe(true);
        }
      } finally {
        await page.send('Emulation.clearDeviceMetricsOverride', {});
      }
      await until(async () => (await metrics()).inner === own.inner, `the window back at its own ${own.inner} px`);
    }, 60_000);
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
      await until(() => page.eval<boolean>(`!!document.querySelector('#browse-tree .browse-node[data-filter="pack:news-pack"]')`), 'the installed pack in the browse tree');
      expect(Number(await page.eval<string>(`document.querySelector('#browse-tree .browse-node[data-filter="pack:news-pack"]').dataset.count`))).toBe(2);
      for (const slug of ['boardroom', 'newsdesk', 'matchday', 'festival']) {
        const pack = JSON.parse(await readFile(join(__dirname, '..', '..', 'templates', slug, 'pack.json'), 'utf8')) as { templates: string[] };
        expect(Number(await page.eval<string>(`document.querySelector('#browse-tree .browse-node[data-filter="pack:${slug}"]').dataset.count`)), slug).toBe(pack.templates.length);
      }
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

    it('plays and seeks a video, which needs byte ranges', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available to make a test video; video preview check skipped.');
        return;
      }
      await selectMedia('clip');
      await until(() => page.eval<boolean>(`(() => { const v = document.getElementById('media-video'); return !v.hidden && v.readyState >= 1; })()`), 'video metadata');
      const duration = await page.eval<number>(`document.getElementById('media-video').duration`);
      expect(Math.abs(duration - 2)).toBeLessThan(0.3);
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
      expect(badges).toEqual(['2 s', '36p']);
      // The whole of what ffprobe read is in the Info tab.
      await selectMedia('clip');
      await page.eval(`document.getElementById('tab-info').click()`);
      await until(() => page.eval<boolean>(`document.querySelector('#info-item [data-section=format]')?.textContent.includes('64 × 36') === true`), 'the probed facts in the Info tab');
      const facts = await page.eval<string>(`document.querySelector('#info-item [data-section=format]').textContent`);
      expect(facts).toContain('00:00:02:00');
      expect(facts).toContain('10 fps');
      expect(facts).toContain('H.264');
      const setSearch = (q: string) => page.eval(`(() => { const s = document.getElementById('search'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      try {
        await setSearch('codec:h264 duration:>1');
        expect(await resultNames()).toEqual(['clip', 'tall']);
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
      // Posters and media frames arrive in the background, one at a time, in library order. Wait for
      // the five items this test asserts on - not for any five: with the matched sample sets, more than
      // a dozen posters are queued and a slow machine finishes five others first (Windows CI, October 2026).
      const needed = ['Diagonal Wipe', 'Lower Third Bar', 'Title Card', 'clip', 'tiny'];
      const loaded = '(li) => { const i = li.querySelector(".thumb img"); return !!i && i.complete && i.naturalWidth > 0; }';
      const read = '(li) => { const i = li.querySelector(".thumb img"); return { src: i.src, w: i.naturalWidth, h: i.naturalHeight }; }';
      const byName: Record<string, { src: string; w: number; h: number }> = {};
      for (const name of needed) {
        await until(() => onResult<boolean>(name, loaded), `the thumbnail for ${name}`, 120_000);
        byName[name] = await onResult<{ src: string; w: number; h: number }>(name, read);
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
        // Narrow to audio, which also puts the results in list view.
        await setSearch('type:audio');
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
        // Escape stops it.
        await key('Escape');
        await until(async () => !(await playing()), 'the sound to stop');
        await page.eval(`document.getElementById('audition').click()`);
      } finally {
        await setSearch('');
      }
    }, 90_000);

    it('shows the item as a property panel, with the path only in the tooltip and behind the actions', async () => {
      await clickResult('Boardroom lower third');
      await page.eval(`document.getElementById('tab-info').click()`);
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
      await page.eval(`document.querySelector('#browse-tree .browse-node[data-filter="type:lower-third"]').click()`);
      await until(async () => !(await page.eval<boolean>(`document.getElementById('scope-chip').hidden`)), 'the scope chip for a type node');
      expect(await page.eval<string>(`document.getElementById('scope-chip-label').textContent`)).toBe('in: Lower third');
      const lowerThirds = await names();
      expect(lowerThirds).toContain('Lower Third Bar');
      expect(lowerThirds).not.toContain('Diagonal Wipe');
      expect(lowerThirds).not.toContain('tiny');
      // The node's count agrees with the results it scopes to.
      expect(Number(await page.eval<string>(`document.querySelector('#browse-tree .browse-node[data-filter="type:lower-third"]').dataset.count`))).toBe(lowerThirds.length);
      await page.eval(`document.getElementById('scope-chip-clear').click()`);
      await until(async () => (await names()).includes('Diagonal Wipe'), 'the full library after clearing the type scope');

      await page.eval(`[...document.querySelectorAll('#browse-tree .browse-node')].find((b) => b.querySelector('.label')?.textContent === 'Media library').click()`);
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

    it('switches the results between cards and rows, and remembers the choice', async () => {
      await clearSearch();
      // Cards by default for anything visual: a thumbnail with badges under the name.
      expect(await page.eval<boolean>(`document.getElementById('results').classList.contains('grid')`)).toBe(true);
      expect(await page.eval<string>(`document.getElementById('view-grid').getAttribute('aria-pressed')`)).toBe('true');
      const cardBadges = await onResult<string[]>('Lower Third Bar', '(li) => [...li.querySelectorAll(".badge")].map((b) => b.dataset.badge)');
      expect(cardBadges).toEqual(['alpha', 'duration', 'resolution', 'vertical']); // every bundled template now draws tall as well

      await page.eval(`document.getElementById('view-list').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('results').classList.contains('list')`), 'the list view');
      const row = await onResult<string[]>('Boardroom title', '(li) => [...li.querySelectorAll(".col")].map((c) => c.textContent)');
      expect(row).toEqual(['Boardroom title', '5 s', 'Title', 'Corporate, Finance, Technology, Real estate', 'title']);
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

      // Down and Up walk the visible rows, headings included; Home jumps to the first.
      await page.eval(`document.querySelector('#browse-tree .section-heading').focus()`);
      expect(await focused()).toBe('quick');
      await key('ArrowDown');
      expect(await focused()).toBe('favorites');
      await key('ArrowDown');
      expect(await focused()).toBe('recent');
      await key('ArrowUp');
      expect(await focused()).toBe('favorites');
      await key('Home');
      expect(await focused()).toBe('quick');

      // Right steps into an open group, Left steps back out to it, Left again folds it.
      await page.eval(`document.querySelector('#browse-tree [data-node="group:titles"]').focus()`);
      await key('ArrowRight');
      expect(await focused()).toBe('type:lower-third');
      await key('ArrowLeft');
      expect(await focused()).toBe('group:titles');
      await key('ArrowLeft');
      await until(async () => !(await has('type:lower-third')), 'the group to fold');
      await key('ArrowRight');
      await until(() => has('type:lower-third'), 'the group to unfold again');
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
      expect(await onResult<string>('Lower Third Bar', '(li) => li.querySelector(".thumb").style.aspectRatio')).toBe('1920 / 1080');
      // The tall fixture clip (36 × 64, once probed) is a portrait item: a grid holding it takes a taller row, and its own picture is tall.
      await fire('#search', 'orientation:portrait type:video', 'input');
      await until(async () => (await names()).join() === 'tall', 'the tall clip alone', 30_000);
      await until(async () => (await cardH()) > wide, 'the taller row pitch');
      expect(await onResult<string>('tall', '(li) => li.querySelector(".thumb").style.aspectRatio')).toBe('36 / 64');
      // With everything showing, the one tall item sets the pitch for the whole grid; a wide card keeps its own shape inside it.
      await clearSearch();
      await until(async () => (await cardH()) > wide, 'the tall pitch for the mixed grid');
      expect(await onResult<string>('Lower Third Bar', '(li) => li.querySelector(".thumb").style.aspectRatio')).toBe('1920 / 1080');
    }, 60_000);
  });
});
