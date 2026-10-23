/**
 * End-to-end UI test: starts the app with Chromium's remote debugging port,
 * drives the inspector through the DevTools protocol and reads pixels back
 * from the preview's canvas. Covers what the headless render path cannot:
 * the controls themselves.
 *
 * Needs the Electron binary (and a display on Linux). PULP_E2E=0 skips,
 * PULP_E2E=1 fails instead of skipping.
 */

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFfmpeg } from '../../src/core/ffmpeg';
import { writeZip } from '../../src/core/zip';
import { rawManifest } from '../fixtures';

const run = promisify(execFile);
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

interface Target { type: string; url: string; webSocketDebuggerUrl: string }
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

  send(method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown }> {
    return new Promise((resolve) => {
      const id = ++this.id;
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate in the page (or a given context) and return the JSON value. */
  async eval<T>(expression: string, contextId?: number): Promise<T> {
    const r = (await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      ...(contextId !== undefined ? { contextId } : {}),
    })) as { result?: { result?: { value?: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } } };
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error(ex.exception?.description ?? ex.text ?? 'evaluation failed');
    return r.result?.result?.value as T;
  }

  close(): void {
    this.ws.close();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A valid 2x2 RGBA PNG: red, green on the top row; blue, white below. */
function tinyPng(): Buffer {
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
  const rows = Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255]); // filter byte + 2 px per row
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
  /** A library folder with a tiny PNG and, when ffmpeg is available, a 2 s MP4. */
  let mediaDir = '';
  let haveVideo = false;

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

  async function until(check: () => Promise<boolean>, what: string, tries = 80): Promise<void> {
    for (let i = 0; i < tries; i++) {
      if (await check()) return;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  /** Read one preview pixel (straight RGBA, as the template's canvas holds it) in template coordinates. */
  async function previewPixel(x: number, y: number, templateId = 'pulp.samples.lower-third-bar'): Promise<number[]> {
    const expr = `(() => { const d = document.getElementById('c').getContext('2d').getImageData(${x}, ${y}, 1, 1).data; return [...d]; })()`;
    // The preview iframe is its own target when Chromium puts it out of process, otherwise a context on the
    // page. Background poster renders open offscreen windows on pulp-template:// too; those are 'page'
    // targets and are not the preview.
    const frame = (await targets()).find((t) => t.type !== 'page' && t.url.startsWith(`pulp-template://${templateId}/`));
    if (frame) {
      const s = await Session.connect(frame.webSocketDebuggerUrl);
      try {
        return await s.eval<number[]>(expr);
      } finally {
        s.close();
      }
    }
    const ctx = [...page.contexts].reverse().find((c) => (c.origin ?? '').startsWith(`pulp-template://${templateId}`));
    return page.eval<number[]>(expr, ctx?.id);
  }

  /** Move the scrubber and give the preview a moment to draw the frame. */
  const scrubTo = async (frame: number) => {
    await page.eval(`(() => { const el = document.getElementById('scrub'); el.value = '${frame}'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(500);
  };

  beforeAll(async () => {
    await run(process.execPath, [join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build'], { cwd: ROOT });
    userData = await mkdtemp(join(tmpdir(), 'pulp-ui-'));
    mediaDir = join(userData, 'media-library');
    await mkdir(mediaDir, { recursive: true });
    await writeFile(join(mediaDir, 'tiny.png'), TINY_PNG);
    await writeFile(join(mediaDir, 'silence.wav'), await readFile(join(ROOT, 'tests', 'e2e', 'templates', 'media', 'silence.wav')));
    const ffmpeg = await detectFfmpeg();
    if (ffmpeg.ok) {
      try {
        await run(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x36:rate=10', '-t', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', join(mediaDir, 'clip.mp4')]);
        haveVideo = true;
      } catch {
        haveVideo = false;
      }
    }
    await writeFile(join(userData, 'settings.json'), JSON.stringify({ libraryFolders: [mediaDir] }));
    app = spawn(electron!, ['.', `--remote-debugging-port=${port}`], {
      cwd: ROOT,
      stdio: 'ignore',
      env: { ...process.env, PULP_USER_DATA: userData },
    });
    let target: Target | undefined;
    await until(async () => {
      target = (await targets()).find((t) => t.type === 'page' && /renderer\/index\.html/.test(t.url));
      return target !== undefined;
    }, 'the app window');
    page = await Session.connect(target!.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    await until(
      () => page.eval<boolean>(`[...document.querySelectorAll('#results li .name')].some((n) => n.textContent === 'Lower Third Bar')`),
      'the library list',
    );
    await page.eval(`[...document.querySelectorAll('#results li')].find((li) => li.querySelector('.name')?.textContent === 'Lower Third Bar').click()`);
    await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the preview to be ready');
  }, 120_000);

  afterAll(async () => {
    page?.close();
    if (app && app.exitCode === null && app.signalCode === null) {
      // kill() returns before the process is gone. Windows refuses to delete a folder while any
      // process holds a file in it open (EBUSY), and Chromium's helper processes can outlive the
      // main process by a moment, so wait for the exit and then delete with retries.
      const exited = once(app, 'exit');
      app.kill('SIGKILL');
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
      `(() => { const f = document.querySelectorAll('#params .color-field')[1]; return { picker: f.querySelector('input[type=color]').value, alpha: f.querySelector('.alpha').value, percent: f.querySelector('.alpha-value').textContent, hex: f.querySelector('.hex').value }; })()`,
    );
    expect(control).toEqual({ picker: '#111827', alpha: '85', percent: '85%', hex: '#111827d9' });
  }, 60_000);

  it('keeps the alpha when the color is changed with the native picker', async () => {
    await page.eval(`(() => { const el = document.querySelectorAll('#params .color-field')[1].querySelector('input[type=color]'); el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await scrubTo(90);
    expect(await previewPixel(120, 840)).toEqual([255, 0, 0, 217]);
  }, 60_000);

  it('changes the alpha with the slider and shows it in the text field', async () => {
    await page.eval(`(() => { const el = document.querySelectorAll('#params .color-field')[1].querySelector('.alpha'); el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await scrubTo(90);
    const px = await previewPixel(120, 840);
    expect(px.slice(0, 3)).toEqual([255, 0, 0]);
    expect(px[3]).toBe(128);
    expect(await page.eval<string>(`document.querySelectorAll('#params .color-field')[1].querySelector('.hex').value`)).toBe('#ff000080');
  }, 60_000);

  it('accepts a full #RRGGBBAA value in the text field and rejects garbage without changing the color', async () => {
    await page.eval(`(() => { const el = document.querySelectorAll('#params .color-field')[1].querySelector('.hex'); el.value = '#00FF0040'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await scrubTo(90);
    expect(await previewPixel(120, 840)).toEqual([0, 255, 0, 64]);
    const synced = await page.eval<{ picker: string; alpha: string }>(
      `(() => { const f = document.querySelectorAll('#params .color-field')[1]; return { picker: f.querySelector('input[type=color]').value, alpha: f.querySelector('.alpha').value }; })()`,
    );
    expect(synced).toEqual({ picker: '#00ff00', alpha: '25' });

    await page.eval(`(() => { const el = document.querySelectorAll('#params .color-field')[1].querySelector('.hex'); el.value = 'teal'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await scrubTo(90);
    expect(await previewPixel(120, 840)).toEqual([0, 255, 0, 64]);
    expect(await page.eval<boolean>(`document.querySelectorAll('#params .color-field')[1].querySelector('.hex').classList.contains('error')`)).toBe(true);
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
    expect(await page.eval<string>(`document.querySelector('[data-param=name] .counter').textContent`)).toBe('11/60');
    await fire('[data-param=name] input', 'Ada Lovelace', 'input');
    expect(await page.eval<string>(`document.querySelector('[data-param=name] .counter').textContent`)).toBe('12/60');
    await fire('[data-param=name] input', null, 'change'); // commits the edit as one history step
  }, 60_000);

  it('undoes and redoes committed edits by button and by keyboard, but leaves text fields their own undo', async () => {
    expect(await page.eval<boolean>(`document.getElementById('undo').disabled`)).toBe(false);
    await page.eval(`document.getElementById('undo').click()`);
    expect(await valueOf('[data-param=name] input')).toBe('Alex Rivera');
    expect(await page.eval<string>(`document.querySelector('[data-param=name] .counter').textContent`)).toBe('11/60');
    await page.eval(`document.getElementById('redo').click()`);
    expect(await valueOf('[data-param=name] input')).toBe('Ada Lovelace');
    // Ctrl+Z with focus outside a text field undoes through the app history.
    await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
    expect(await valueOf('[data-param=name] input')).toBe('Alex Rivera');
    // Shift+Ctrl+Z redoes.
    await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }))`);
    expect(await valueOf('[data-param=name] input')).toBe('Ada Lovelace');
    // The same shortcut dispatched on the text field is left to the field; the app history does not move.
    await page.eval(`document.querySelector('[data-param=name] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
    expect(await valueOf('[data-param=name] input')).toBe('Ada Lovelace');
  }, 60_000);

  it('resets one field, then everything, and both are undoable', async () => {
    // inOut was changed earlier, so its reset is visible; the untouched title has none.
    expect(await page.eval<boolean>(`document.querySelector('[data-param=inOut] .field-reset').hidden`)).toBe(false);
    expect(await page.eval<boolean>(`document.querySelector('[data-param=title] .field-reset').hidden`)).toBe(true);
    await page.eval(`document.querySelector('[data-param=inOut] .field-reset').click()`);
    expect(await valueOf('[data-param=inOut] input[type=number]')).toBe('0.6');
    expect(await page.eval<boolean>(`document.querySelector('[data-param=inOut] .field-reset').hidden`)).toBe(true);

    expect(await page.eval<boolean>(`document.getElementById('reset-all').disabled`)).toBe(false);
    await page.eval(`document.getElementById('reset-all').click()`);
    expect(await valueOf('[data-param=name] input')).toBe('Alex Rivera');
    expect(await page.eval<string>(`document.querySelectorAll('#params .color-field')[1].querySelector('.hex').value`)).toBe('#111827d9');
    expect(await page.eval<boolean>(`[...document.querySelectorAll('#params .field-reset')].every((b) => b.hidden)`)).toBe(true);
    expect(await page.eval<boolean>(`document.getElementById('reset-all').disabled`)).toBe(true);
    await scrubTo(90);
    expect((await previewPixel(120, 840))[3]).toBe(217);

    // Reset all is one history step: undo brings the edits back.
    await page.eval(`document.getElementById('undo').click()`);
    expect(await valueOf('[data-param=name] input')).toBe('Ada Lovelace');
    expect(await page.eval<string>(`document.querySelectorAll('#params .color-field')[1].querySelector('.hex').value`)).toBe('#00ff0040');
  }, 60_000);

  it('keeps edits and history per template across a switch', async () => {
    await page.eval(`[...document.querySelectorAll('#results li')].find((li) => li.querySelector('.name')?.textContent === 'Title Card').click()`);
    await until(() => page.eval<boolean>(`document.querySelector('[data-param=title] input') !== null`), 'the title card form');
    expect(await page.eval<boolean>(`document.getElementById('undo').disabled`)).toBe(true);
    expect(await valueOf('[data-param=title] input')).toBe('Field Notes');
    await page.eval(`[...document.querySelectorAll('#results li')].find((li) => li.querySelector('.name')?.textContent === 'Lower Third Bar').click()`);
    await until(() => page.eval<boolean>(`document.querySelector('[data-param=name] input') !== null`), 'the lower third form');
    expect(await valueOf('[data-param=name] input')).toBe('Ada Lovelace');
    expect(await page.eval<boolean>(`document.getElementById('undo').disabled`)).toBe(false);
  }, 60_000);

  it('remembers committed colors across fields and templates, and stores them in settings', async () => {
    // Committed earlier in this run through the panel field's text input and picker.
    const rows = await page.eval<string[][]>(
      `[...document.querySelectorAll('#params .color-field')].map((f) => [...f.querySelectorAll('.recent-swatch')].map((b) => b.dataset.color))`,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(rows[1]);
    expect(rows[1]).toEqual(rows[2]);
    expect(rows[0]![0]).toBe('#00ff0040'); // most recent first
    expect(rows[0]!.length).toBeLessThanOrEqual(8);

    // Using a recent color on another field (the accent) applies and commits it.
    await page.eval(`document.querySelectorAll('#params .color-field')[0].querySelector('.recent-swatch').click()`);
    expect(await page.eval<string>(`document.querySelectorAll('#params .color-field')[0].querySelector('.hex').value`)).toBe('#00ff0040');

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
    await page.eval(`[...document.querySelectorAll('#results li')].find((li) => li.querySelector('.name')?.textContent === 'Title Card').click()`);
    await until(() => page.eval<boolean>(`document.querySelector('#params .color-field .recent-swatch') !== null`), 'recent colors on the title card');
    expect(await page.eval<string>(`document.querySelector('#params .color-field .recent-swatch').dataset.color`)).toBe('#00ff0040');
  }, 60_000);

  describe('saved presets and batch', () => {
    const nameValue = () => page.eval<string>(`document.querySelector('[data-param=name] input').value`);
    const options = () => page.eval<string[]>(`[...document.getElementById('param-preset-list').options].map((o) => o.value).filter(Boolean)`);

    it('saves the values that differ from the defaults, applies them undoably, asks before replacing, deletes', async () => {
      await page.eval(`[...document.querySelectorAll('#results li')].find((li) => li.querySelector('.name')?.textContent === 'Lower Third Bar').click()`);
      await until(() => page.eval<boolean>(`document.querySelector('[data-param=name] input') !== null`), 'the lower third form');
      // Start from defaults, change the name, save as "Show A".
      await page.eval(`document.getElementById('reset-all').disabled || document.getElementById('reset-all').click()`);
      await page.eval(`(() => { const i = document.querySelector('[data-param=name] input'); i.value = 'Show A Name'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.eval(`(() => { const n = document.getElementById('param-preset-name'); n.value = 'Show A'; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await page.eval(`document.getElementById('param-preset-save').click()`);
      await until(async () => (await options()).includes('Show A'), 'the preset to appear');
      // The file holds only the changed value.
      const file = JSON.parse(await readFile(join(userData, 'presets', 'pulp.samples.lower-third-bar.json'), 'utf8')) as { presets: Record<string, Record<string, unknown>> };
      expect(file.presets['Show A']).toEqual({ name: 'Show A Name' });

      // Change the name again, then apply the preset: it comes back, and undo takes it away.
      await page.eval(`(() => { const i = document.querySelector('[data-param=name] input'); i.value = 'Other'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
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
          return f.presets['Show A']?.name === 'Other';
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
    it('prepares a render into the cache, arms the drag handle, reuses the cache, and clears it', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available; render-and-drag check skipped.');
        return;
      }
      await page.eval(`[...document.querySelectorAll('#results li')].find((li) => li.querySelector('.name')?.textContent === 'Diagonal Wipe').click()`);
      await until(() => page.eval<boolean>(`!document.getElementById('play').disabled`), 'the diagonal wipe preview');
      // A short range keeps the test quick: three frames of the wipe into the cache.
      await page.eval(`(() => { const i = document.getElementById('opt-in'); i.value = '10'; i.dispatchEvent(new Event('input', { bubbles: true })); const o = document.getElementById('opt-out'); o.value = '12'; o.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await page.eval(`(() => { const s = document.getElementById('preset'); s.value = 'png-sequence'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      expect(await page.eval<string>(`document.getElementById('drag-handle').getAttribute('draggable')`)).toBe('false');
      await page.eval(`document.getElementById('drag-prepare').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('drag-status').textContent.includes('Rendering into the cache')`), 'the drag render to be queued');
      await until(() => page.eval<boolean>(`document.getElementById('drag-handle').getAttribute('draggable') === 'true'`), 'the drag handle to be armed', 240);
      const file = await page.eval<string>(`document.getElementById('drag-handle').dataset.file`);
      expect(file.startsWith(join(userData, 'render-cache'))).toBe(true);
      expect(file.split(/[\\/]/).pop()).toBe('diagonal-wipe_00010.png'); // clean name, no hash; a sequence drags as its first frame, numbered with the in point
      expect(existsSync(file)).toBe(true);
      expect(await page.eval<string>(`document.getElementById('drag-handle-text').textContent`)).toMatch(/^Drag .*\.png into your editor$/);
      // The finished job in the queue is draggable too.
      expect(await page.eval<boolean>(`!!document.querySelector('#queue li[draggable="true"]')`)).toBe(true);
      await until(() => page.eval<boolean>(`document.getElementById('cache-summary').textContent.includes('3 files')`), 'the cache summary');

      // Preparing again with the same inputs finds the cached render without a new job.
      const jobsBefore = await page.eval<number>(`document.querySelectorAll('#queue li:not(.empty)').length`);
      await page.eval(`document.getElementById('drag-prepare').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('drag-status').textContent === 'Already rendered; ready to drag.'`), 'the cache hit');
      expect(await page.eval<number>(`document.querySelectorAll('#queue li:not(.empty)').length`)).toBe(jobsBefore);

      // A drag of something outside the cache and not a finished output is refused; the cached file is allowed.
      expect(await page.eval<boolean>(`window.pulp.startDrag('/etc/hosts')`)).toBe(false);
      // (A real native drag cannot be observed here; startDrag with the cached file is exercised by the handle's dragstart.)

      await page.eval(`document.getElementById('cache-clear').click()`);
      await until(() => page.eval<boolean>(`document.getElementById('cache-summary').textContent.includes('0 files')`), 'the cache to be cleared');
      expect(existsSync(file)).toBe(false);
      expect(await page.eval<string>(`document.getElementById('drag-handle').getAttribute('draggable')`)).toBe('false');
      expect(await page.eval<string>(`document.getElementById('drag-status').textContent`)).toBe(
        'Cache cleared; prepare again to drag. Clips linked to the old files are now offline in your editor.',
      );
      // Reset the options for later tests.
      await page.eval(`(() => { for (const id of ['opt-in', 'opt-out']) { const i = document.getElementById(id); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); } const s = document.getElementById('preset'); s.value = 'prores-4444'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
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
      await until(
        () => page.eval<boolean>(`[...document.querySelectorAll('#results li .name')].some((n) => n.textContent === 'News Strap') && [...document.querySelectorAll('#results li .name')].some((n) => n.textContent === 'Channel Bug')`),
        'the installed templates in the library',
      );
      // The bundled title card is untouched.
      expect(await page.eval<number>(`[...document.querySelectorAll('#results li .name')].filter((n) => n.textContent === 'Title Card').length`)).toBe(1);
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
      await until(() => page.eval<boolean>(`[...document.querySelectorAll('#results li .name')].some((n) => n.textContent === 'News Strap v2')`), 'the replaced template name');

      await writeFile(join(userData, 'broken.zip'), Buffer.from('this is not a zip'));
      await page.eval(`window.pulpPreviewPack(${JSON.stringify(join(userData, 'broken.zip'))})`);
      await until(() => page.eval<boolean>(`document.getElementById('pack-problems').textContent.includes('Not a usable pack')`), 'the error for a broken zip');
      expect(await page.eval<boolean>(`document.getElementById('pack-confirm').hidden`)).toBe(true);
      await page.eval(`document.getElementById('pack-close').click()`);
    }, 90_000);

    it('export is offered for the listed templates with a pack name and license', async () => {
      await page.eval(`(() => { const s = document.getElementById('search'); s.value = 'type:template news'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
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
    const results = () => page.eval<string[]>(`[...document.querySelectorAll('#results li .name')].map((n) => n.textContent)`);
    const setSearch = (q: string) => page.eval(`(() => { const s = document.getElementById('search'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);

    it('adds and removes user tags on the shown item, searchable with tag:', async () => {
      await page.eval(`[...document.querySelectorAll('#results li')].find((li) => li.querySelector('.name')?.textContent.endsWith('Lower Third Bar')).click()`);
      await until(() => page.eval<boolean>(`!document.getElementById('item-tools').hidden`), 'the item tools');
      await page.eval(`(() => { const i = document.getElementById('tag-input'); i.value = 'Show A, keeper'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      await until(() => page.eval<boolean>(`!!document.querySelector('#tag-chips .tag-chip.user[data-tag=show-a]')`), 'the new tag chips');
      expect(await page.eval<string[]>(`[...document.querySelectorAll('#tag-chips .tag-chip.user')].map((c) => c.dataset.tag)`)).toEqual(['show-a', 'keeper']);
      // Manifest tags are shown but not removable.
      expect(await page.eval<boolean>(`!!document.querySelector('#tag-chips .tag-chip.folder[data-tag=interview]') && !document.querySelector('#tag-chips .tag-chip.folder[data-tag=interview] button')`)).toBe(true);
      try {
        await setSearch('tag:show-a');
        expect(await results()).toEqual(['Lower Third Bar']);
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
        expect(await results()).toEqual(['Lower Third Bar']);
        expect(await page.eval<boolean>(`!document.querySelector('#results li .fav').hidden`)).toBe(true);
        // Selecting marked the lower third used; select the title card too, so it is the most recent.
        await setSearch('');
        await page.eval(`[...document.querySelectorAll('#results li')].find((li) => li.querySelector('.name')?.textContent === 'Title Card').click()`);
        await until(() => page.eval<boolean>(`document.querySelector('[data-param=title] input') !== null`), 'the title card form');
        await setSearch('recent:2 type:template');
        await until(async () => (await results())[0] === 'Title Card', 'the recent list to update');
        expect(await results()).toEqual(['Title Card', 'Lower Third Bar']);
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
      await until(
        () => page.eval<boolean>(`[...document.querySelectorAll('#results li[data-kind=media] .name')].some((n) => n.textContent === ${JSON.stringify(name)})`),
        `media item ${name} in the library`,
      );
      await page.eval(`[...document.querySelectorAll('#results li[data-kind=media]')].find((li) => li.querySelector('.name')?.textContent === ${JSON.stringify(name)}).click()`);
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
      await until(
        () => page.eval<boolean>(`[...document.querySelectorAll('#results li[data-kind=media]')].some((li) => li.querySelector('.name')?.textContent === 'clip' && li.querySelector('.meta').textContent.includes('64 × 36'))`),
        'probed metadata to reach the list',
        120,
      );
      const meta = await page.eval<string>(`[...document.querySelectorAll('#results li[data-kind=media]')].find((li) => li.querySelector('.name')?.textContent === 'clip').querySelector('.meta').textContent`);
      expect(meta).toContain('64 × 36');
      expect(meta).toContain('00:00:02:00');
      expect(meta).toContain('10 fps');
      expect(meta).toContain('H.264');
      const setSearch = (q: string) => page.eval(`(() => { const s = document.getElementById('search'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      try {
        await setSearch('codec:h264 duration:>1');
        expect(await page.eval<string[]>(`[...document.querySelectorAll('#results li .name')].map((n) => n.textContent)`)).toEqual(['clip']);
        await setSearch('res:1080p');
        expect(await page.eval<string[]>(`[...document.querySelectorAll('#results li .name')].map((n) => n.textContent)`)).toEqual(['Diagonal Wipe', 'Lower Third Bar', 'Title Card']);
      } finally {
        await setSearch('');
      }
    }, 90_000);

    it('shows cached thumbnails for templates and visual media, and refuses unknown ids', async () => {
      if (!haveVideo) {
        console.info('ffmpeg not available; thumbnail check skipped.');
        return;
      }
      // Posters for the three bundled templates and frames for tiny.png and clip.mp4 arrive in the background.
      await until(
        () => page.eval<boolean>(`(() => { const imgs = [...document.querySelectorAll('#results li .thumb img')]; return imgs.length >= 5 && imgs.every((i) => i.complete && i.naturalWidth > 0); })()`),
        'thumbnails for every template and visual media item',
        240,
      );
      const info = await page.eval<{ name: string; src: string; w: number; h: number }[]>(
        `[...document.querySelectorAll('#results li')].filter((li) => li.querySelector('.thumb img')).map((li) => { const i = li.querySelector('.thumb img'); return { name: li.querySelector('.name').textContent, src: i.src, w: i.naturalWidth, h: i.naturalHeight }; })`,
      );
      const byName = Object.fromEntries(info.map((i) => [i.name, i]));
      // Templates installed from packs earlier in this run get posters too; the bundled ones and the media must be there.
      expect(Object.keys(byName)).toEqual(expect.arrayContaining(['Diagonal Wipe', 'Lower Third Bar', 'Title Card', 'clip', 'tiny']));
      for (const i of info) expect(i.src).toMatch(/^pulp-thumb:\/\/[0-9a-f]{24}\/$/);
      expect(byName['Title Card']).toMatchObject({ w: 240, h: 135 }); // 1920x1080 poster, fit into 240
      expect(byName['clip']).toMatchObject({ w: 64, h: 36 }); // smaller than the thumbnail size: not enlarged
      expect(byName['tiny']).toMatchObject({ w: 2, h: 2 });
      // Audio has no thumbnail, by design.
      expect(await page.eval<boolean>(`[...document.querySelectorAll('#results li[data-kind=media]')].some((li) => li.querySelector('.thumb.empty'))`)).toBe(true);
      // Unknown id and a path on the URL are refused.
      const outcome = (src: string) =>
        page.eval<string>(
          `new Promise((resolve) => { const i = new Image(); i.onload = () => resolve('loaded'); i.onerror = () => resolve('refused'); i.src = ${JSON.stringify(src)}; setTimeout(() => resolve('timeout'), 5000); })`,
        );
      expect(await outcome('pulp-thumb://deadbeefdeadbeefdeadbeef/')).toBe('refused');
      expect(await outcome(`${byName['tiny']!.src}tiny.png`)).toBe('refused');
      expect(await outcome(byName['tiny']!.src)).toBe('loaded');
    }, 180_000);

    it('refuses an unknown id and a path on the URL, and serves a known id, as seen by an <img>', async () => {
      const outcome = (src: string) =>
        page.eval<string>(
          `new Promise((resolve) => { const i = new Image(); i.onload = () => resolve('loaded'); i.onerror = () => resolve('refused'); i.src = ${JSON.stringify(src)}; setTimeout(() => resolve('timeout'), 5000); })`,
        );
      const id = await page.eval<string>(`[...document.querySelectorAll('#results li[data-kind=media]')].find((li) => li.querySelector('.name')?.textContent === 'tiny').dataset.id`);
      expect(await outcome('pulp-media://deadbeefdeadbeefdeadbeef/')).toBe('refused');
      expect(await outcome(`pulp-media://${id}/tiny.png`)).toBe('refused');
      expect(await outcome(`pulp-media://${id}/`)).toBe('loaded');
      // The scheme is for media elements only: the window cannot read it as data.
      expect(await page.eval<string>(`fetch('pulp-media://${id}/').then(() => 'fetched', () => 'blocked')`)).toBe('blocked');
    }, 60_000);
  });

  describe('search bar scope and filter chips', () => {
    const names = () => page.eval<string[]>(`[...document.querySelectorAll('#results li .name')].map((n) => n.textContent)`);
    const clearSearch = () => page.eval(`(() => { const s = document.getElementById('search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);

    it('scopes the results to a browse node, shows the chip, and clears it with the ×', async () => {
      await clearSearch();
      await page.eval(`[...document.querySelectorAll('#browse-nodes .browse-node')].find((b) => b.textContent === 'Media library').click()`);
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
  });
});
