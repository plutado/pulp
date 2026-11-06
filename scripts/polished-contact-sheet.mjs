/**
 * The polished set's contact sheet (milestone 67, docs/art-direction.md):
 * every `templates/polished-*` piece at its poster moment, with its default
 * parameters, at one size on the studio backdrop the results draw behind it,
 * in one PNG — so a piece that breaks the look is seen beside the others
 * before it ships.
 *
 *   npx electron scripts/polished-contact-sheet.mjs [--out file.png] [--only a,b] [--cell 240]
 *                                                   [--set key=value] [--light] [--appearance light]
 *
 * Run with Electron rather than Node: each piece is drawn by its own page,
 * exactly as Pulp draws it. `--only` limits the sheet to some pieces (by
 * folder name without `polished-`), `--set` overrides a parameter for every
 * piece (e.g. `--set material=frosted-glass`), and `--light` draws each piece
 * three times, lit from the left, the top and the right. The sheet is written
 * to `test-artifacts/polished-contact-sheet.png` unless `--out` says
 * otherwise; it is a working picture, not committed.
 */

import { app, BrowserWindow } from 'electron';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(ROOT, 'templates');

function args() {
  const a = process.argv.slice(2);
  const o = { out: join(ROOT, 'test-artifacts', 'polished-contact-sheet.png'), only: null, cell: 240, set: {}, light: false, appearance: 'dark' };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--out') o.out = a[++i];
    else if (a[i] === '--only') o.only = a[++i].split(',');
    else if (a[i] === '--cell') o.cell = Number(a[++i]);
    else if (a[i] === '--set') { const [k, v] = a[++i].split('='); o.set[k] = v; }
    else if (a[i] === '--light') o.light = true;
    else if (a[i] === '--appearance') o.appearance = a[++i];
  }
  return o;
}

async function pieces(only) {
  const names = (await readdir(TEMPLATES)).filter((n) => n.startsWith('polished-')).sort();
  const out = [];
  for (const n of names) {
    if (only && !only.includes(n.replace(/^polished-/, ''))) continue;
    const manifest = JSON.parse(await readFile(join(TEMPLATES, n, 'template.json'), 'utf8'));
    out.push({ dir: join(TEMPLATES, n), manifest });
  }
  return out;
}

/** One piece at its poster moment, at 1920 × 1080, cropped as the results crop it (studioCrop). */
async function drawPiece(win, piece, set, light) {
  const m = piece.manifest;
  const params = Object.fromEntries(m.parameters.map((p) => [p.id, p.default]));
  Object.assign(params, set);
  if (light) params.light = light;
  await win.loadURL(pathToFileURL(join(piece.dir, m.entry)).href);
  const state = { width: 1920, height: 1080, time: m.posterAt ?? 2.5, duration: m.duration, fps: m.fps, aspect: '16:9', params, frame: Math.round((m.posterAt ?? 2.5) * m.fps) };
  return win.webContents.executeJavaScript(`(async () => {
    await document.fonts.ready;
    const r = window.pulpRender(${JSON.stringify(state)}); if (r && r.then) await r;
    const src = document.querySelector('canvas');
    // studioCrop: half the short side tall, 16:9, centered.
    const h = 540, w = 960, c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(src, (1920 - w) / 2, (1080 - h) / 2, w, h, 0, 0, w, h);
    return c.toDataURL('image/png');
  })()`);
}

const SHEET = `<!doctype html><meta charset="utf-8"><body><script>
  window.compose = async function (cells, cols, cw, appearance) {
    const ch = Math.round(cw * 9 / 16), label = 22, rows = Math.ceil(cells.length / cols);
    const c = document.createElement('canvas'); c.width = cols * cw; c.height = rows * (ch + label);
    const x = c.getContext('2d');
    const key = appearance === 'light' ? '#f4f5f7' : '#4a5059', floor = appearance === 'light' ? '#bcc2ca' : '#1d2025';
    x.fillStyle = appearance === 'light' ? '#e4e7eb' : '#15171b'; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < cells.length; i++) {
      const cx = (i % cols) * cw, cy = Math.floor(i / cols) * (ch + label);
      // The studio backdrop: a soft key from above falling off to the floor (styles.css).
      x.save(); x.beginPath(); x.rect(cx + 2, cy + 2, cw - 4, ch - 4); x.clip();
      x.fillStyle = floor; x.fillRect(cx, cy, cw, ch);
      x.translate(cx + cw / 2, cy + ch * 0.32); x.scale(0.85 * cw / 2, 0.8 * ch / 2);
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 1.2); g.addColorStop(0, key); g.addColorStop(1, floor);
      x.fillStyle = g; x.fillRect(-2, -2, 4, 4); x.restore();
      const img = new Image(); img.src = cells[i].url; await img.decode();
      x.drawImage(img, cx + 2, cy + 2, cw - 4, ch - 4);
      x.fillStyle = appearance === 'light' ? '#222' : '#c9ced6'; x.font = '12px system-ui, sans-serif';
      x.fillText(cells[i].label, cx + 6, cy + ch + 15);
    }
    return c.toDataURL('image/png');
  };
</script>`;

app.whenReady().then(async () => {
  const o = args();
  const list = await pieces(o.only);
  const win = new BrowserWindow({ show: false, width: 640, height: 360, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } });
  const cells = [];
  for (const p of list) {
    const lights = o.light ? ['left', 'top', 'right'] : [null];
    for (const l of lights) {
      try {
        cells.push({ url: await drawPiece(win, p, o.set, l), label: p.manifest.name + (l ? ` (${l})` : '') });
      } catch (e) {
        console.error(`could not draw ${p.manifest.id}: ${e.message}`);
      }
    }
  }
  const cols = o.light ? 3 : Math.min(cells.length, 6);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SHEET)}`);
  const url = await win.webContents.executeJavaScript(`window.compose(${JSON.stringify(cells)}, ${cols}, ${o.cell}, ${JSON.stringify(o.appearance)})`);
  await mkdir(dirname(o.out), { recursive: true });
  await writeFile(o.out, Buffer.from(url.slice('data:image/png;base64,'.length), 'base64'));
  console.log(`${cells.length} pieces → ${o.out}`);
  win.destroy();
  app.quit();
});
