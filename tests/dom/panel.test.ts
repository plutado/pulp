// @vitest-environment happy-dom
/**
 * The panel against a stand-in host (milestone 54's last item). The very
 * scripts the editing apps load — connect.js, host.js, panel.js, as packaged
 * — run in a DOM, over a real bridge on 127.0.0.1 (startPanelServer with a
 * stub context), with the host stood in for twice: Premiere's CEP surface
 * (`__adobe_cep__.evalScript`, `cep.fs`) and the Resolve plugin's preload
 * (`pulpPanelHost`). What is held is the whole contract between panel and
 * host: how the panel finds Pulp, what it lists, which ExtendScript or
 * preload verb each button and drag ends in, and with which file.
 *
 * Nothing here needs Premiere, Resolve or Electron — the same connection,
 * spoken by a stand-in.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addItem, emptyCollection, itemFor } from '../../src/core/collection';
import type { LibraryIndex, TemplateEntry } from '../../src/core/library-types';
import { bridgeFileContents, newBridgeToken, startPanelServer, type PanelBridgeContext, type PanelQueueJob, type PanelServer } from '../../src/core/panel-bridge';
import { validManifest } from '../fixtures';
import { panelPackageEntries } from '../../scripts/panel-package.mjs';

const ROOT = join(__dirname, '..', '..');

function template(name: string): TemplateEntry {
  return { kind: 'template', key: name, id: `ab${name.length}${'0'.repeat(10)}`, dir: `/lib/${name}`, root: '/lib', manifest: validManifest({ id: `test.${name.toLowerCase()}`, name }), tags: [], warnings: [] };
}
const strap = template('Strap');
const wipe = template('Diagonal');
const library: LibraryIndex = { roots: ['/lib'], templates: [strap, wipe], media: [], problems: [], builtAt: '2026-11-03T00:00:00Z' };
const gathered = addItem(emptyCollection, itemFor(strap, 'webm-vp9-alpha'));

/** What the stub Pulp was asked, so a test reads the contract off it. */
const asked = { prepare: [] as unknown[], opened: [] as unknown[], cancelled: [] as number[] };
let queue: PanelQueueJob[] = [];
/** How the prepare answers: a file at once, or a job the panel must follow. */
let prepareAnswer: 'ready' | 'job' = 'ready';

const token = newBridgeToken();
const ctx: PanelBridgeContext = {
  token,
  version: '0.1.0-test',
  library: () => Promise.resolve(library),
  collection: () => ({ name: 'show', collection: gathered }),
  thumbnail: () => Promise.resolve(undefined),
  typeDefaults: () => Promise.resolve({}),
  itemFile: () => Promise.resolve(undefined),
  prepare: (request) => {
    asked.prepare.push(request);
    return Promise.resolve(prepareAnswer === 'ready' ? { ready: true, file: `/cache/${request.templateId}.mov`, name: `${request.templateId}.mov` } : { ready: false, job: 42 });
  },
  job: (id) => (id === 42 ? { state: 'done', file: '/cache/followed.mov', name: 'followed.mov' } : undefined),
  open: (target) => {
    asked.opened.push(target);
    return Promise.resolve({ ok: true });
  },
  queue: () => queue,
  cancel: (id) => {
    asked.cancelled.push(id);
    return true;
  },
};

let server: PanelServer;
let userData: string;

/** The host's surface, as each editing app presents it, recorded. */
interface Host {
  evalScript: string[];
  imports: string[];
  appends: string[];
  drags: string[];
}
let host: Host;

/** Mount the packaged panel page for a host, scripts and all, exactly as the host would load it. */
function mountPanel(kind: 'premiere' | 'resolve'): void {
  host = { evalScript: [], imports: [], appends: [], drags: [] };
  const w = window as unknown as Record<string, unknown>;
  delete w.__adobe_cep__;
  delete w.cep;
  delete w.pulpPanelHost;
  delete w.pulpBridge;
  delete w.pulpHost;
  if (kind === 'premiere') {
    // CEP: the user-data root as SystemPath.USER_DATA gives it, a file read as cep.fs does, evalScript recorded.
    w.__adobe_cep__ = {
      getSystemPath: () => `file://${userData}`,
      evalScript: (code: string, done: (answer: string) => void) => {
        host.evalScript.push(code);
        done('ok');
      },
    };
    w.cep = {
      fs: {
        readFile: (path: string) => {
          try {
            return { err: 0, data: readFileSync(path, 'utf8') };
          } catch {
            return { err: 3, data: '' };
          }
        },
      },
    };
  } else {
    // The Resolve plugin's preload: the bridge file read for the page, the three verbs recorded.
    w.pulpPanelHost = {
      readBridge: () => readFileSync(join(userData, 'Pulp', 'panel-bridge.json'), 'utf8'),
      importToBin: (file: string) => {
        host.imports.push(file);
        return Promise.resolve({ ok: true });
      },
      appendToTimeline: (file: string) => {
        host.appends.push(file);
        return Promise.resolve({ ok: true });
      },
      startDrag: (file: string) => {
        host.drags.push(file);
      },
    };
  }
  const entries = panelPackageEntries(ROOT, kind);
  const file = (name: string) => entries.find((e) => e.name.endsWith(`/${name}`) || e.name === name)!.data.toString('utf8');
  const html = file('panel.html');
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[^>]*><\/script>/g, '');
  // The scripts in the order the page lists them, run in the page's own global scope.
  for (const name of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]!)) (0, eval)(file(name));
}

async function until(check: () => boolean, what: string, budgetMs = 5000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > budgetMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const text = (selector: string) => document.querySelector(selector)?.textContent ?? '';
const rows = () => [...document.querySelectorAll<HTMLElement>('#library-list li')];
const rowNamed = (name: string) => rows().find((li) => li.querySelector('.name')?.textContent === name)!;
const button = (li: HTMLElement, label: string) => [...li.querySelectorAll('button')].find((b) => b.textContent === label)!;

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), 'pulp-panel-dom-'));
  server = await startPanelServer(ctx);
  // The discovery file where a packaged Pulp writes it: <user data>/Pulp/panel-bridge.json.
  await mkdir(join(userData, 'Pulp'), { recursive: true });
  await writeFile(join(userData, 'Pulp', 'panel-bridge.json'), bridgeFileContents({ version: '0.1.0-test', port: server.port, token, startedAt: 'now' }));
});

afterAll(async () => {
  await server.close();
  await rm(userData, { recursive: true, force: true });
});

beforeEach(() => {
  asked.prepare.length = 0;
  asked.opened.length = 0;
  asked.cancelled.length = 0;
  queue = [];
  prepareAnswer = 'ready';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the panel in a stand-in Premiere Pro (CEP)', () => {
  beforeEach(() => mountPanel('premiere'));

  it('finds Pulp through the CEP user-data root, says so, and lists the library and the collection', async () => {
    await until(() => rows().length === 2, 'the library rows');
    expect(text('#status-line')).toBe(`Pulp 0.1.0-test on 127.0.0.1:${server.port} · in Premiere Pro`);
    expect(rows().map((li) => li.querySelector('.name')!.textContent)).toEqual(['Diagonal', 'Strap']);
    expect(text('#collection-name')).toBe('show');
    expect([...document.querySelectorAll('#collection-list .name')].map((n) => n.textContent)).toEqual(['Strap']);
  });

  it('Bin renders with the item’s own settings and imports through ExtendScript, quoting the file', async () => {
    await until(() => rows().length === 2, 'the library rows');
    button(rowNamed('Strap'), 'Bin').click();
    await until(() => host.evalScript.length === 1, 'the import call');
    expect(asked.prepare).toEqual([{ templateId: 'test.strap', presetId: 'prores-4444', options: {}, params: {} }]);
    expect(host.evalScript[0]).toBe("pulpImportToBin('/cache/test.strap.mov')");
    await until(() => rowNamed('Strap').querySelector('.status')!.textContent === 'in the bin', 'the row saying so');
  });

  it('Playhead inserts at the playhead; a collection row renders the card’s own preset', async () => {
    await until(() => rows().length === 2, 'the library rows');
    const card = document.querySelector<HTMLElement>('#collection-list li')!;
    button(card, 'Playhead').click();
    await until(() => host.evalScript.length === 1, 'the insert call');
    expect(asked.prepare).toEqual([{ templateId: 'test.strap', presetId: 'webm-vp9-alpha', options: {}, params: {} }]);
    expect(host.evalScript[0]).toBe("pulpInsertAtPlayhead('/cache/test.strap.mov')");
  });

  it('follows a render that is not ready yet, then hands the finished file over', async () => {
    prepareAnswer = 'job';
    await until(() => rows().length === 2, 'the library rows');
    button(rowNamed('Diagonal'), 'Bin').click();
    await until(() => host.evalScript.length === 1, 'the import after the job', 8000);
    expect(host.evalScript[0]).toBe("pulpImportToBin('/cache/followed.mov')");
  });

  it('Open asks Pulp to show the item, or the collection card', async () => {
    await until(() => rows().length === 2, 'the library rows');
    button(rowNamed('Diagonal'), 'Open').click();
    await until(() => asked.opened.length === 1, 'the open');
    expect(asked.opened[0]).toEqual({ kind: 'item', id: wipe.id });
    button(document.querySelector<HTMLElement>('#collection-list li')!, 'Open').click();
    await until(() => asked.opened.length === 2, 'the card open');
    expect(asked.opened[1]).toEqual({ kind: 'collection', uid: gathered.items[0]!.uid });
  });

  it('shows Pulp’s queue as it runs, with a cancel, and a finished job that drops', async () => {
    queue = [
      { id: 3, label: 'Strap · Sam', presetId: 'prores-4444', status: 'running', fraction: 0.4 },
      { id: 2, label: 'Diagonal', presetId: 'prores-4444', status: 'done', fraction: 1, file: '/cache/done.mov', name: 'done.mov' },
      { id: 1, label: 'Old', presetId: 'h264-mp4', status: 'failed', fraction: 0.1, message: 'ffmpeg refused' },
    ];
    await until(() => document.querySelectorAll('#queue-list li').length === 3, 'the queue rows');
    expect(document.querySelector('#queue-section')!.hasAttribute('hidden')).toBe(false);
    const [running, done, failed] = [...document.querySelectorAll<HTMLElement>('#queue-list li')];
    expect(running!.querySelector('.badge')!.textContent).toBe('40%');
    expect((running!.querySelector<HTMLElement>('.progress > span')!).style.width).toBe('40%');
    button(running!, 'Cancel').click();
    await until(() => asked.cancelled.length === 1, 'the cancel');
    expect(asked.cancelled).toEqual([3]);
    expect(failed!.querySelector('.status.bad')!.textContent).toBe('ffmpeg refused');
    // The finished job is a row like any item's: Bin hands its file over without rendering again.
    button(done!, 'Bin').click();
    await until(() => host.evalScript.length === 1, 'the finished file imported');
    expect(host.evalScript[0]).toBe("pulpImportToBin('/cache/done.mov')");
    expect(asked.prepare).toEqual([]);
  });
});

describe('the panel in a stand-in DaVinci Resolve (Workflow Integration)', () => {
  beforeEach(() => mountPanel('resolve'));

  it('finds Pulp through the plugin’s preload and offers Append, since Resolve’s API appends', async () => {
    await until(() => rows().length === 2, 'the library rows');
    expect(text('#status-line')).toContain('· in DaVinci Resolve');
    expect(button(rowNamed('Strap'), 'Append')).toBeDefined();
  });

  it('Bin and Append speak the preload’s verbs with the rendered file', async () => {
    await until(() => rows().length === 2, 'the library rows');
    button(rowNamed('Strap'), 'Bin').click();
    await until(() => host.imports.length === 1, 'the import');
    expect(host.imports).toEqual(['/cache/test.strap.mov']);
    button(rowNamed('Diagonal'), 'Append').click();
    await until(() => host.appends.length === 1, 'the append');
    expect(host.appends).toEqual(['/cache/test.diagonal.mov']);
  });

  it('a drag renders first and says to drag again; the next drag is a native drag of the file', async () => {
    await until(() => rows().length === 2, 'the library rows');
    const row = rowNamed('Strap');
    expect(row.draggable).toBe(true);
    const drag = () => row.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    drag();
    await until(() => row.querySelector('.status')!.textContent === 'ready — drag again', 'the render on the first drag');
    expect(host.drags).toEqual([]);
    drag();
    expect(host.drags).toEqual(['/cache/test.strap.mov']);
  });
});

describe('the panel with no host around it', () => {
  it('says there is none and offers nothing that would break, but still lists', async () => {
    const w = window as unknown as Record<string, unknown>;
    delete w.__adobe_cep__;
    delete w.pulpPanelHost;
    mountPanel('premiere');
    delete w.__adobe_cep__;
    delete w.cep;
    (0, eval)(panelPackageEntries(ROOT, 'premiere').find((e) => e.name === 'host.js')!.data.toString('utf8'));
    // No way to read the discovery file either, so the panel says what to do.
    document.body.innerHTML = '';
    mountPanel('premiere');
    delete w.__adobe_cep__;
    delete w.cep;
    (0, eval)(panelPackageEntries(ROOT, 'premiere').find((e) => e.name === 'host.js')!.data.toString('utf8'));
    (0, eval)(panelPackageEntries(ROOT, 'premiere').find((e) => e.name === 'panel.js')!.data.toString('utf8'));
    await until(() => text('#connect-message') !== '', 'the message');
    expect(text('#connect-message')).toContain('Settings → "Serve the editor panel (local)"');
  });
});
