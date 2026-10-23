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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

describe.skipIf(!electron)('inspector UI', () => {
  const port = 9300 + Math.floor(Math.random() * 500);
  let app: ChildProcess | null = null;
  let page: Session;
  /** Scratch userData folder, so the app under test never reads or writes the real settings.json. */
  let userData = '';

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
  async function previewPixel(x: number, y: number): Promise<number[]> {
    const expr = `(() => { const d = document.getElementById('c').getContext('2d').getImageData(${x}, ${y}, 1, 1).data; return [...d]; })()`;
    // The template frame is its own target when Chromium puts it out of process, otherwise a context on the page.
    const frame = (await targets()).find((t) => t.url.startsWith('pulp-template://'));
    if (frame) {
      const s = await Session.connect(frame.webSocketDebuggerUrl);
      try {
        return await s.eval<number[]>(expr);
      } finally {
        s.close();
      }
    }
    const ctx = page.contexts.find((c) => (c.origin ?? '').startsWith('pulp-template'));
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

    // The list is shared in settings.json of the (scratch) user data folder.
    await until(async () => existsSync(join(userData, 'settings.json')), 'settings.json to be written');
    const settings = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')) as { recentColors?: string[] };
    expect(settings.recentColors?.[0]).toBe('#00ff0040');
    expect(settings.recentColors).toEqual(rows[0]);

    // The same list shows on another template's color fields.
    await page.eval(`[...document.querySelectorAll('#results li')].find((li) => li.querySelector('.name')?.textContent === 'Title Card').click()`);
    await until(() => page.eval<boolean>(`document.querySelector('#params .color-field .recent-swatch') !== null`), 'recent colors on the title card');
    expect(await page.eval<string>(`document.querySelector('#params .color-field .recent-swatch').dataset.color`)).toBe('#00ff0040');
  }, 60_000);
});
