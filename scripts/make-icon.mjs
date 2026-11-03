/**
 * Draw Pulp's app icon (milestone 17) and write what each platform asks for:
 * `build/icon.icns` (macOS), `build/icon.ico` (Windows) and
 * `build/icons/<size>x<size>.png` (Linux), from one drawing.
 *
 *   npx electron scripts/make-icon.mjs
 *
 * Run with Electron rather than Node: the mark is drawn on a canvas in a
 * hidden page, which is the same way Pulp draws everything else, and the
 * pixels come back as PNG through the canvas rather than off a screen. The
 * files it writes are committed, since a build cannot draw them.
 *
 * **The mark** is Pulp's own: a lower third — the thing Pulp makes most — on
 * a dark tile. An amber bar stands at the left, a bright bar for the name
 * beside it and a shorter, dimmer one for the title under that, in the
 * window's own colors (`src/renderer/styles.css`). At 16 px the three bars
 * still read as a strap of type; nothing in it is borrowed from anyone.
 */

import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'build');

/** Pulp's own colors (src/renderer/styles.css): the panel, the accent, the type. */
const TILE_TOP = '#262b35';
const TILE_BOTTOM = '#14171d';
const ACCENT = '#f59e0b';
const NAME = '#f2f4f8';
const TITLE = '#98a3b6';

/**
 * The drawing, in fractions of the tile, so one description serves every
 * size. The page draws into a canvas of whatever size it is asked for and
 * hands back the PNG; the window it lives in is a fixed, comfortable size and
 * is never captured, so no platform's minimum window size can crop anything
 * (docs/platform-notes.md).
 */
const PAGE = `<!doctype html><meta charset="utf-8"><body>
<script>
  function rr(x, px, py, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r);
    x.closePath();
  }
  window.drawIcon = function (S) {
    var c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    var x = c.getContext('2d');
    // The tile: a rounded square in the window's panel colors, lit from the top.
    var g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, ${JSON.stringify(TILE_TOP)});
    g.addColorStop(1, ${JSON.stringify(TILE_BOTTOM)});
    rr(x, 0, 0, S, S, S * 0.22);
    x.fillStyle = g;
    x.fill();
    // A hairline inside the edge, so the tile has a shape on a dark desktop.
    x.save();
    rr(x, S * 0.015, S * 0.015, S * 0.97, S * 0.97, S * 0.205);
    x.strokeStyle = 'rgba(255,255,255,0.10)';
    x.lineWidth = Math.max(1, S * 0.012);
    x.stroke();
    x.restore();
    // The strap: the accent bar, the name beside it, the title under that.
    rr(x, S * 0.230, S * 0.344, S * 0.056, S * 0.312, S * 0.028);
    x.fillStyle = ${JSON.stringify(ACCENT)};
    x.fill();
    rr(x, S * 0.330, S * 0.383, S * 0.446, S * 0.082, S * 0.020);
    x.fillStyle = ${JSON.stringify(NAME)};
    x.fill();
    rr(x, S * 0.330, S * 0.508, S * 0.290, S * 0.056, S * 0.018);
    x.fillStyle = ${JSON.stringify(TITLE)};
    x.fill();
    return c.toDataURL('image/png');
  };
</script>`;

/** The page, loaded once; every size is drawn in it. */
async function openPage() {
  const win = new BrowserWindow({
    show: false,
    width: 480,
    height: 480,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
  return {
    async draw(size) {
      const url = await win.webContents.executeJavaScript(`window.drawIcon(${size})`);
      return Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
    },
    close: () => win.destroy(),
  };
}

/**
 * An `.icns`: the magic, the total length, then one entry per image —
 * a four-letter type, the entry's whole length, and the PNG itself. macOS
 * reads PNG payloads for every type used here.
 */
function icns(byType) {
  const entries = [...byType].map(([type, png]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(entries);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/** An `.ico`: a directory of entries, each a PNG. 256 is written as 0, which is what the format says. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // an icon, not a cursor
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const directory = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // a PNG has its own palette
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    directory.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...directory, ...images.map((i) => i.png)]);
}

// Closing the page must not take the app with it: Electron quits when the last window goes, and
// the writes below would be cut off half way through. The script says when it is done.
app.on('window-all-closed', () => undefined);

/**
 * Everything happens once the app is ready — and nothing is awaited at the
 * top of the file: Electron's ESM main script hangs if the module waits for
 * anything before the ready event, so the work hangs off the promise instead.
 */
app.whenReady().then(async () => {
  try {
    // Every size anything here asks for, drawn once.
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
    const page = await openPage();
    const png = new Map();
    try {
      for (const size of sizes) png.set(size, await page.draw(size));
    } finally {
      page.close();
    }

    await mkdir(join(BUILD, 'icons'), { recursive: true });
    // Linux takes the PNGs by name; electron-builder reads the folder.
    for (const size of sizes.filter((s) => s <= 512)) {
      await writeFile(join(BUILD, 'icons', `${size}x${size}.png`), png.get(size));
    }
    // macOS: the plain sizes and the @2x ones, which are the same pixels at twice the number.
    await writeFile(join(BUILD, 'icon.icns'), icns([
      ['icp4', png.get(16)], ['icp5', png.get(32)], ['icp6', png.get(64)],
      ['ic07', png.get(128)], ['ic08', png.get(256)], ['ic09', png.get(512)], ['ic10', png.get(1024)],
      ['ic11', png.get(32)], ['ic12', png.get(64)], ['ic13', png.get(256)], ['ic14', png.get(512)],
    ]));
    // Windows: 16 to 256, which is what the Start menu, the task bar and the installer ask for.
    await writeFile(join(BUILD, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png.get(size) }))));
    process.stdout.write(`wrote build/icon.icns, build/icon.ico and ${sizes.filter((s) => s <= 512).length} PNGs in build/icons\n`);
    app.exit(0);
  } catch (err) {
    process.stderr.write(`${err.stack ?? err}\n`);
    app.exit(1);
  }
});
