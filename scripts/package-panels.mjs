#!/usr/bin/env node
/**
 * Package the editor panels (milestone 54) for people who are not working
 * from a checkout: one archive per host into `release/panels/`.
 *
 *   node scripts/package-panels.mjs              both hosts
 *   node scripts/package-panels.mjs --premiere   one host
 *   node scripts/package-panels.mjs --resolve
 *   node scripts/package-panels.mjs --out <dir>  somewhere other than release/panels
 *
 * Premiere Pro: `pulp-panel-premiere-<version>.zip`, the CEP extension folder
 * at the archive's root — unzipped into the CEP extensions folder with
 * PlayerDebugMode on, it loads as a checkout install does. Where Adobe's
 * ZXPSignCmd is found (on PATH, or named by PULP_ZXPSIGNCMD) a signed
 * `pulp-panel-premiere-<version>.zxp` is written beside it, which an
 * extension manager installs with no debug flag at all: with a certificate
 * named by PULP_ZXP_CERT and PULP_ZXP_PASSWORD, or — for a build of your own
 * — a self-signed one made for the run. Without the tool, the zip is written
 * and the signing step is printed rather than pretended.
 *
 * DaVinci Resolve Studio: `pulp-panel-resolve-<version>.zip`, the plugin under
 * its own folder, unzipped straight into the Workflow Integration Plugins
 * folder. Resolve's WorkflowIntegration.node is not inside — it is
 * Blackmagic's, and the INSTALL.md in the archive says where it comes from.
 *
 * What goes in each archive is `panel-package.mjs`'s to say, and the test's
 * to hold.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFile, panelPackage, panelPackageEntries, panelVersion, PANEL_EXTENSION_ID } from './panel-package.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const both = !args.includes('--premiere') && !args.includes('--resolve');
const outAt = args.indexOf('--out');
const OUT = outAt !== -1 && args[outAt + 1] ? args[outAt + 1] : join(ROOT, 'release', 'panels');
const version = panelVersion(ROOT);

mkdirSync(OUT, { recursive: true });

/** Adobe's signing tool, if it is anywhere this machine would find it. */
function zxpSignCmd() {
  if (process.env.PULP_ZXPSIGNCMD && isFile(process.env.PULP_ZXPSIGNCMD)) return process.env.PULP_ZXPSIGNCMD;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ZXPSignCmd'], { encoding: 'utf8' });
  const found = which.status === 0 ? which.stdout.split(/\r?\n/).find((l) => l.trim()) : null;
  return found ? found.trim() : null;
}

/** Sign the Premiere folder into a .zxp; the certificate is the one named, or one made for this run. */
function signZxp(tool, folder, out) {
  const scratch = mkdtempSync(join(tmpdir(), 'pulp-zxp-'));
  try {
    let cert = process.env.PULP_ZXP_CERT;
    let password = process.env.PULP_ZXP_PASSWORD;
    if (!cert || !password) {
      cert = join(scratch, 'self-signed.p12');
      password = 'pulp-self-signed';
      const made = spawnSync(tool, ['-selfSignedCert', 'US', 'CA', 'Pulp', 'Pulp panel', password, cert], { encoding: 'utf8' });
      if (made.status !== 0) return { ok: false, message: `ZXPSignCmd could not make a certificate: ${made.stderr || made.stdout}` };
    }
    const signed = spawnSync(tool, ['-sign', folder, out, cert, password, '-tsa', 'http://timestamp.digicert.com'], { encoding: 'utf8' });
    if (signed.status !== 0) return { ok: false, message: `ZXPSignCmd refused: ${signed.stderr || signed.stdout}` };
    return { ok: true, selfSigned: !process.env.PULP_ZXP_CERT };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

for (const host of ['premiere', 'resolve']) {
  if (!both && !args.includes(`--${host}`)) continue;
  const made = panelPackage(ROOT, host, version);
  const zipPath = join(OUT, made.name);
  writeFileSync(zipPath, made.zip);
  console.log(`${host}: ${zipPath} (${made.entries.length} files)`);

  if (host === 'premiere') {
    const tool = zxpSignCmd();
    if (!tool) {
      console.log('  No ZXPSignCmd found, so no .zxp: unzip the archive into the CEP extensions folder with PlayerDebugMode on,');
      console.log('  or install Adobe\'s ZXPSignCmd (github.com/Adobe-CEP/CEP-Resources) and run this again to sign one.');
      continue;
    }
    // ZXPSignCmd signs a folder, so the package is laid out once more in a scratch folder.
    const scratch = mkdtempSync(join(tmpdir(), 'pulp-panel-'));
    try {
      const folder = join(scratch, PANEL_EXTENSION_ID);
      for (const entry of panelPackageEntries(ROOT, host)) {
        const at = join(folder, entry.name);
        mkdirSync(dirname(at), { recursive: true });
        writeFileSync(at, entry.data);
      }
      const zxpPath = zipPath.replace(/\.zip$/, '.zxp');
      const signed = signZxp(tool, folder, zxpPath);
      if (signed.ok) {
        console.log(`  signed: ${zxpPath}${signed.selfSigned ? ' (self-signed: installs through an extension manager on this machine; a distributed build wants a real certificate in PULP_ZXP_CERT)' : ''}`);
      } else {
        console.error(`  ${signed.message}`);
        process.exitCode = 1;
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
