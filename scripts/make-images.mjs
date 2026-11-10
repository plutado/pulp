/**
 * The pictures in `docs/images/`, made again from the app itself (milestone 86).
 *
 *   npm run images                 # all five
 *   npm run images -- --only window
 *   npm run images -- --only samples,gif --no-build --keep
 *
 * The five were drawn by hand once and then aged: the templates were redrawn,
 * the window gained a start screen and a light appearance, and nobody could
 * tell from the files what had made them. This makes them in one command, so
 * they can be made again whenever the app moves on.
 *
 * **The frames are Pulp's own renders.** Each sample and the GIF's frames come
 * from `pulp render` — the same command line and the same renderer a person
 * would use — at a fixed frame of each template. ffmpeg then does only what a
 * reader needs and a render cannot: it lays the frames over the checkerboard
 * that shows which pixels are transparent, scales them for the page, and packs
 * the GIF (with the palette recipe Pulp's own GIF preset uses, since that
 * preset flattens over one color and the point here is the checkerboard).
 *
 * **The window is the real window**, started with a scratch user-data folder —
 * your own settings, library and cache are neither read nor written — and
 * photographed over the DevTools protocol exactly as the end-to-end suite
 * drives it: a fixed size, the dark appearance, US English, and the bundled
 * templates alone, so the picture is the same on any machine.
 *
 * Needs ffmpeg on the PATH (or at `PULP_FFMPEG_PATH`) and a built app; the
 * build runs first unless `--no-build`. `--keep` leaves the scratch folder.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = join(ROOT, 'docs', 'images');

/** The window the screenshot is taken of: the default size the layout tests hold, at two pixels per point. */
const WINDOW = { width: 1280, height: 788, scale: 2 };

/** The checkerboard behind transparency, as the stage draws it: 48 px squares of two grays. */
const CHECKER = { size: 48, dark: 52, light: 72 };

/** How wide a sample frame is on the page. 1200 of a 16:9 render is 675 high, which ffmpeg rounds up to an even 676. */
const SAMPLE_WIDTH = 1200;

/**
 * One picture per sample: the template, the moment it is caught at, and what
 * the README says about it. The moments are chosen for the picture — the strap
 * held, the wipe part way across, the title landed — not for any rule.
 */
const SAMPLES = [
  { id: 'pulp.samples.lower-third-bar', file: 'sample-lower-third-bar.png', at: 3 },
  { id: 'pulp.samples.diagonal-wipe', file: 'sample-diagonal-wipe.png', at: 0.28 },
  { id: 'pulp.samples.title-card', file: 'sample-title-card.png', at: 2.5 },
];

/** The GIF: the lower third's whole six seconds, cropped to the strap's corner, at half the render's rate. */
const GIF = { id: 'pulp.samples.lower-third-bar', file: 'lower-third.gif', fps: 15, crop: { width: 660, height: 240, x: 0, y: 430 } };

function options() {
  const argv = process.argv.slice(2);
  const o = { only: null, build: true, keep: false, out: IMAGES };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') o.only = argv[++i].split(',').map((s) => s.trim());
    else if (argv[i] === '--no-build') o.build = false;
    else if (argv[i] === '--keep') o.keep = true;
    else if (argv[i] === '--out') o.out = argv[++i];
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return o;
}

function run(command, args, { cwd = ROOT, env = process.env, quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', quiet ? 'pipe' : 'inherit', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout?.on('data', (c) => { out += c; });
    child.stderr?.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${command} ${args.slice(0, 4).join(' ')}… exited with ${code}\n${(err || out).trim().slice(-1500)}`));
    });
  });
}

const ffmpegPath = () => process.env.PULP_FFMPEG_PATH || 'ffmpeg';
const ffmpeg = (args) => run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

/** Pulp's own command line, run on this checkout's build. */
async function pulp(args) {
  const electron = (await import('electron')).default;
  await run(electron, ['.', ...args], { env: { ...process.env, PULP_USER_DATA: scratchUserData } });
}

/** The filter that lays a render with alpha over the checkerboard and scales it for the page. */
function overCheckerboard(width, height) {
  const cell = CHECKER.size;
  const value = `if(eq(mod(floor(X/${cell})+floor(Y/${cell}),2),0),${CHECKER.dark},${CHECKER.light})`;
  return [
    `color=c=black:s=${width}x${height},format=rgb24,geq=r='${value}':g='${value}':b='${value}'[checks]`,
    `[checks][0:v]overlay=shortest=1,scale=${SAMPLE_WIDTH}:-2,format=rgba`,
  ];
}

let scratchUserData = '';

async function makeSamples(scratch, out) {
  const [checks, over] = overCheckerboard(1920, 1080);
  for (const sample of SAMPLES) {
    const flat = join(scratch, `${sample.file}`);
    await pulp(['--render', sample.id, '--preset', 'png-still', '--out', flat, '--size', '1920x1080', '--in-point', `${sample.at}s`]);
    await ffmpeg(['-i', flat, '-filter_complex', `${checks};${over}[out]`, '-map', '[out]', '-frames:v', '1', join(out, sample.file)]);
    console.log(`  ${sample.file}  ${sample.id} at ${sample.at} s`);
  }
}

async function makeGif(scratch, out) {
  const frames = join(scratch, 'gif-frames');
  await mkdir(frames, { recursive: true });
  await pulp(['--render', GIF.id, '--preset', 'png-sequence', '--out', join(frames, 'frame'), '--size', '1920x1080']);
  const [checks, over] = overCheckerboard(1920, 1080);
  const { width, height, x, y } = GIF.crop;
  // The palette is made from every frame of the clip and the frames mapped onto it, as Pulp's own
  // GIF preset does (src/core/render-plan.ts): a stock palette bands the panel's soft edges.
  const palette = 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle';
  await ffmpeg([
    '-framerate', '30', '-i', join(frames, 'frame_%05d.png'),
    '-filter_complex', `${checks};${over}[flat];[flat]crop=${width}:${height}:${x}:${y},fps=${GIF.fps},${palette}[out]`,
    '-map', '[out]', '-loop', '0', '-f', 'gif', join(out, GIF.file),
  ]);
  const count = (await readdir(frames)).length;
  console.log(`  ${GIF.file}  ${count} rendered frames at ${GIF.fps} fps, cropped to the strap`);
}

// ---------------------------------------------------------------- the window

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** One DevTools connection to the window, with the handful of calls this script makes. */
class Page {
  #id = 0;
  #pending = new Map();
  constructor(ws) {
    this.ws = ws;
    ws.onmessage = (m) => {
      const data = JSON.parse(m.data);
      const settle = this.#pending.get(data.id);
      if (settle) {
        this.#pending.delete(data.id);
        settle(data);
      }
    };
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const page = new Page(ws);
      ws.onopen = () => resolve(page);
      ws.onerror = () => reject(new Error('could not connect to the window'));
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.#id;
      const timer = setTimeout(() => reject(new Error(`the window did not answer ${method}`)), 30_000);
      this.#pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message.result ?? {});
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'the window refused it');
    return r.result?.value;
  }

  close() {
    this.ws.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(check, what, budgetMs = 60_000) {
  const started = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - started > budgetMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

async function makeWindow(scratch, out) {
  const electron = (await import('electron')).default;
  const userData = join(scratch, 'window-data');
  await mkdir(userData, { recursive: true });
  // The bundled templates alone, no start screen, and the appearance and language the picture is
  // described in — so the window is the same here as on anyone else's machine.
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    libraryFolders: [], showStartScreen: false, appearance: 'dark', language: 'en-US',
    // The split a person would drag for this picture: the window leans to the stage by default, which
    // leaves the results behind the open drawer, and the picture is meant to show both at once.
    layout: { stageShare: 0.44, inspectorHeight: 200 },
  }));
  const port = await freePort();
  const app = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, PULP_USER_DATA: userData },
  });
  let page = null;
  try {
    let target;
    await until(async () => {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        target = list.find((t) => t.type === 'page' && decodeURIComponent(t.url).includes(join(ROOT, 'out', 'renderer', 'index.html').replace(/\\/g, '/')));
      } catch {
        target = undefined;
      }
      return Boolean(target);
    }, 'the app window');
    page = await Page.connect(target.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    // The size the layout is held to, at two pixels per point, so the picture is sharp on a page.
    await page.send('Emulation.setDeviceMetricsOverride', { width: WINDOW.width, height: WINDOW.height, deviceScaleFactor: WINDOW.scale, mobile: false });
    await until(() => page.eval(`document.querySelectorAll('#results li[data-id]').length > 0`), 'the library');
    await page.eval(`(() => { const b = document.getElementById('browse-expand'); if (document.getElementById('app').classList.contains('browse-collapsed')) b.click(); return true; })()`);
    // Browsing lower thirds, with one chosen: the scope chip, the tree, the cards and the stage all say so.
    await page.eval(`(() => { const h = document.querySelector('#browse-tree .section-heading[data-node=categories]'); if (h && h.getAttribute('aria-expanded') === 'false') h.click(); return true; })()`);
    await until(() => page.eval(`!!document.querySelector('#browse-tree [data-node="category:lower-thirds"]')`), 'the lower thirds in the tree');
    await page.eval(`document.querySelector('#browse-tree [data-node="category:lower-thirds"]').click()`);
    await until(() => page.eval(`!document.getElementById('scope-chip').hidden`), 'the scope chip');
    await until(() => page.eval(`[...document.querySelectorAll('#results li[data-id] .name')].some((n) => n.textContent === 'Lower Third Bar')`), 'the lower third in the results');
    await page.eval(`[...document.querySelectorAll('#results li[data-id]')].find((li) => li.querySelector('.name')?.textContent === 'Lower Third Bar').click()`);
    await until(() => page.eval(`!document.getElementById('play').disabled`), 'the preview');
    // The inspector open on Parameters, the drawer the README's caption describes.
    await page.eval(`(() => { const b = document.getElementById('tab-parameters'); if (b.getAttribute('aria-selected') !== 'true' || !document.getElementById('app').classList.contains('inspector-open')) b.click(); return true; })()`);
    await until(() => page.eval(`!!document.querySelector('#params .param-card')`), 'the parameters');
    // Part way into the graphic, so the strap is on screen rather than animating in.
    await page.eval(`(() => { const s = document.getElementById('scrub'); s.value = String(Math.round(Number(s.max) / 2)); s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    // The posters are drawn in the background, one at a time, for a library seen for the first time:
    // the picture waits for the cards in view to have theirs, rather than showing their placeholders.
    await until(async () => {
      const [shown, withPoster] = await page.eval(`(() => { const cards = [...document.querySelectorAll('#results li[data-id]')].slice(0, 6);
        return [cards.length, cards.filter((c) => c.querySelector('.thumb img')).length]; })()`);
      return shown > 0 && withPoster === shown;
    }, 'the cards in view to have their posters', 10 * 60_000);
    // And a moment for the preview frame and the layer bars to settle.
    await sleep(1500);
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(out, 'app-window.png'), Buffer.from(shot.data, 'base64'));
    console.log(`  app-window.png  ${WINDOW.width} × ${WINDOW.height} at ${WINDOW.scale}×`);
  } finally {
    page?.close();
    app.kill();
  }
}

// ---------------------------------------------------------------- the run

const o = options();
const wanted = (what) => !o.only || o.only.includes(what);

try {
  await run(ffmpegPath(), ['-version']);
} catch {
  throw new Error(`ffmpeg was not found (${ffmpegPath()}); set PULP_FFMPEG_PATH or install it`);
}
if (o.build) {
  console.log('Building…');
  await run(process.execPath, [join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build']);
} else if (!existsSync(join(ROOT, 'out', 'renderer', 'index.html'))) {
  throw new Error('there is no build in out/; run npm run build, or drop --no-build');
}

const scratch = await mkdtemp(join(tmpdir(), 'pulp-images-'));
scratchUserData = join(scratch, 'render-data');
await mkdir(scratchUserData, { recursive: true });
await mkdir(o.out, { recursive: true });
try {
  if (wanted('samples')) {
    console.log('Sample frames…');
    await makeSamples(scratch, o.out);
  }
  if (wanted('gif')) {
    console.log('The GIF…');
    await makeGif(scratch, o.out);
  }
  if (wanted('window')) {
    console.log('The window…');
    await makeWindow(scratch, o.out);
  }
} finally {
  if (o.keep) console.log(`Scratch kept at ${scratch}`);
  else await rm(scratch, { recursive: true, force: true });
}
console.log(`Written into ${o.out}`);
