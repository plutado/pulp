/**
 * The panel packages (milestone 54's last item): what `scripts/package-panels.mjs`
 * writes, read back with the ZIP reader the app itself uses for template packs,
 * so an archive the script makes is one Pulp's own code can open — and holds
 * exactly what a checkout install copies into place, nothing of Blackmagic's,
 * and manifests whose version is the app's.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readZip, safeZipPath } from '../src/core/zip';
// Plain Node ESM, shared with the command so the two cannot drift.
import { PANEL_EXTENSION_ID, panelPackage, panelPackageEntries, panelVersion, writeZip } from '../scripts/panel-package.mjs';

const ROOT = join(__dirname, '..');
const version = panelVersion(ROOT);

describe('the panel packages', () => {
  it('stamp the app’s own version, and the manifests agree with it', () => {
    expect(version).toBe((JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version);
    const cep = readFileSync(join(ROOT, 'panels', 'premiere', 'CSXS', 'manifest.xml'), 'utf8');
    expect(cep).toContain(`ExtensionBundleVersion="${version}"`);
    expect(cep).toContain(`<Extension Id="${PANEL_EXTENSION_ID}" Version="${version}" />`);
    const resolve = readFileSync(join(ROOT, 'panels', 'resolve', 'manifest.xml'), 'utf8');
    expect(resolve).toContain(`<Id>${PANEL_EXTENSION_ID}</Id>`);
    expect(resolve).toContain(`<Version>${version}</Version>`);
    expect((JSON.parse(readFileSync(join(ROOT, 'panels', 'resolve', 'package.json'), 'utf8')) as { version: string }).version).toBe(version);
  });

  it('carry the shared page and each host’s own files, with its install steps, and nothing else', () => {
    const shared = ['connect.js', 'host.js', 'panel.css', 'panel.html', 'panel.js'];
    const premiere = panelPackageEntries(ROOT, 'premiere').map((e) => e.name);
    expect([...premiere].sort()).toEqual([...shared, 'CSXS/manifest.xml', 'INSTALL.md', 'host.jsx'].sort());
    const resolve = panelPackageEntries(ROOT, 'resolve').map((e) => e.name);
    expect([...resolve].sort()).toEqual([...shared, 'INSTALL.md', 'main.js', 'manifest.xml', 'package.json', 'preload.js'].map((n) => `${PANEL_EXTENSION_ID}/${n}`).sort());
    // Blackmagic's native module is theirs to ship, never ours to package.
    for (const name of [...premiere, ...resolve]) expect(name).not.toContain('WorkflowIntegration.node');
  });

  it('are archives Pulp’s own ZIP reader opens, byte for byte what the files hold, under safe names', () => {
    for (const host of ['premiere', 'resolve'] as const) {
      const made = panelPackage(ROOT, host, version);
      expect(made.name).toBe(`pulp-panel-${host}-${version}.zip`);
      const read = readZip(made.zip);
      expect(read.map((e) => e.name)).toEqual(made.entries.map((e) => e.name));
      for (const entry of read) {
        expect(safeZipPath(entry.name)).toBe(entry.name);
        expect(entry.data.equals(made.entries.find((e) => e.name === entry.name)!.data)).toBe(true);
      }
    }
    // The same files make the same archive, so a release's checksum means something.
    expect(panelPackage(ROOT, 'premiere', version).zip.equals(panelPackage(ROOT, 'premiere', version).zip)).toBe(true);
  });

  it('write an archive whose stored and deflated entries both read back', () => {
    const tiny = Buffer.from('x'); // deflating one byte grows it, so this is stored
    const long = Buffer.from('the same words over and over '.repeat(50));
    const read = readZip(writeZip([{ name: 'a/tiny.txt', data: tiny }, { name: 'b/long.txt', data: long }]));
    expect(read.map((e) => [e.name, e.data.toString()])).toEqual([['a/tiny.txt', 'x'], ['b/long.txt', long.toString()]]);
  });

  it('describe their own install steps, saying what the host needs and what is not inside', () => {
    const premiere = readFileSync(join(ROOT, 'panels', 'premiere', 'INSTALL.md'), 'utf8');
    expect(premiere).toContain('PlayerDebugMode');
    expect(premiere).toContain('.zxp');
    expect(premiere).toContain('Serve the editor panel');
    const resolve = readFileSync(join(ROOT, 'panels', 'resolve', 'INSTALL.md'), 'utf8');
    expect(resolve).toContain('WorkflowIntegration.node');
    expect(resolve).toContain('Studio');
    expect(resolve).toContain('Serve the editor panel');
  });
});
