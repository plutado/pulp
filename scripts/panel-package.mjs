/**
 * Packaging the editor panels (milestone 54): what goes into each host's
 * package and the ZIP that carries it. A library, so `package-panels.mjs`
 * (the command) and `tests/panel-package.test.ts` (the proof) share one
 * answer about what a package holds.
 *
 * A Premiere package is a CEP extension folder — `CSXS/manifest.xml`, the
 * shared page, `host.jsx`, its INSTALL.md — zipped at the folder's root, which
 * is also exactly what a `.zxp` is before signing (ZXPSignCmd signs a folder
 * into one; `package-panels.mjs` does that where it can). A Resolve package is
 * the Workflow Integration plugin folder zipped under its own id, so it
 * unzips straight into the plugins folder. Resolve's own native module,
 * WorkflowIntegration.node, is never packaged: it is Blackmagic's to ship,
 * and the install steps say where it comes from.
 *
 * Plain Node ESM, node:zlib only; the ZIP writer here is the one
 * `src/core/zip.ts` reads back in the test.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

export const PANEL_EXTENSION_ID = 'com.pulp.panel';

/** The hosts a package is made for, and what each package is named. */
export const PANEL_HOSTS = {
  premiere: { dir: 'premiere', artifact: (version) => `pulp-panel-premiere-${version}`, zipRoot: '' },
  resolve: { dir: 'resolve', artifact: (version) => `pulp-panel-resolve-${version}`, zipRoot: `${PANEL_EXTENSION_ID}/` },
};

/** Files that must never travel in a package, wherever they are found. */
const NEVER_PACKAGED = new Set(['WorkflowIntegration.node', '.DS_Store', 'Thumbs.db']);

function walk(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, base));
    else if (entry.isFile() && !NEVER_PACKAGED.has(entry.name)) files.push(relative(base, path).split(sep).join('/'));
  }
  return files;
}

/**
 * Every file a host's package holds, as { name, data }: the shared page first,
 * then the host's own files — the same union the install script copies into
 * place, so a package installs what a checkout installs.
 */
export function panelPackageEntries(root, host) {
  const facts = PANEL_HOSTS[host];
  if (!facts) throw new Error(`unknown panel host "${host}"`);
  const shared = join(root, 'panels', 'shared');
  const own = join(root, 'panels', facts.dir);
  const entries = [];
  for (const name of walk(shared)) entries.push({ name: facts.zipRoot + name, data: readFileSync(join(shared, name)) });
  for (const name of walk(own)) entries.push({ name: facts.zipRoot + name, data: readFileSync(join(own, name)) });
  return entries;
}

// ---------------------------------------------------------------- a ZIP writer

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date and time for a fixed moment, so the same files make the same archive byte for byte. */
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1 | ((2026 - 1980) << 9);

/** Deflated entries, a central directory, no ZIP64: what every unzip and every CEP installer reads. */
export function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.data);
    const store = deflated.length >= entry.data.length;
    const body = store ? entry.data : deflated;
    const method = store ? 0 : 8;
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

/** The version a package is stamped with: the app's own, from package.json. */
export function panelVersion(root) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

/** What `package-panels.mjs` writes for a host, before any signing: the archive's name and bytes. */
export function panelPackage(root, host, version = panelVersion(root)) {
  const facts = PANEL_HOSTS[host];
  const entries = panelPackageEntries(root, host);
  return { name: `${facts.artifact(version)}.zip`, entries, zip: writeZip(entries) };
}

/** True when the path is a readable file; the signing tool and its certificate are looked for this way. */
export function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
