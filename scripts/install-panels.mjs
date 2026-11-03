#!/usr/bin/env node
/**
 * Install the editor panels (milestone 54, docs/editor-panels.md): assemble
 * each host's panel from `panels/shared` plus its wrapper and copy it where
 * the host looks.
 *
 *   node scripts/install-panels.mjs                 both panels
 *   node scripts/install-panels.mjs --premiere      only Premiere Pro's
 *   node scripts/install-panels.mjs --resolve       only Resolve's
 *   node scripts/install-panels.mjs --uninstall     remove what this script installed
 *
 * Premiere Pro: the per-user CEP extensions folder; the extension is unsigned,
 * so CEP's PlayerDebugMode must be on — the script prints the exact command.
 * DaVinci Resolve Studio: the machine's Workflow Integration Plugins folder,
 * which may need elevation (sudo on macOS, an administrator shell on Windows);
 * the script says so instead of half-installing. Resolve's own native module,
 * WorkflowIntegration.node, is copied from the Resolve developer sample where
 * one is installed — the panel lists without it, so missing is a note, not a
 * failure.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = join(ROOT, 'panels', 'shared');
const EXTENSION_ID = 'com.pulp.panel';

const platform = process.platform;
const args = new Set(process.argv.slice(2));
const uninstall = args.has('--uninstall');
const both = !args.has('--premiere') && !args.has('--resolve');

function cepExtensionsDir() {
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
  if (platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Adobe', 'CEP', 'extensions');
  return null;
}

function resolvePluginsDir() {
  if (platform === 'darwin') return '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins';
  if (platform === 'win32') return join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Workflow Integration Plugins');
  return null;
}

/** Where Resolve's developer sample keeps the native module the later milestone items will need. */
function resolveNativeModule() {
  const roots = platform === 'darwin'
    ? ['/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Workflow Integrations']
    : platform === 'win32'
      ? [join(process.env.PROGRAMDATA ?? 'C:\\ProgramData', 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Developer', 'Workflow Integrations')]
      : [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    // The sample's name has moved between Resolve versions, so any folder holding the module counts.
    const queue = [root];
    while (queue.length > 0) {
      const dir = queue.shift();
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isFile() && entry.name === 'WorkflowIntegration.node') return path;
        if (entry.isDirectory()) queue.push(path);
      }
    }
  }
  return null;
}

function assemble(target, hostDir) {
  mkdirSync(target, { recursive: true });
  cpSync(SHARED, target, { recursive: true });
  cpSync(hostDir, target, { recursive: true });
}

function installPremiere() {
  const extensions = cepExtensionsDir();
  if (!extensions) {
    console.log('Premiere Pro: CEP runs on macOS and Windows only; nothing to install here.');
    return;
  }
  const target = join(extensions, EXTENSION_ID);
  if (uninstall) {
    rmSync(target, { recursive: true, force: true });
    console.log(`Premiere Pro: removed ${target}`);
    return;
  }
  rmSync(target, { recursive: true, force: true });
  assemble(target, join(ROOT, 'panels', 'premiere'));
  console.log(`Premiere Pro: installed to ${target}`);
  console.log('  The panel is unsigned, so CEP must be told to load it once per CEP version:');
  if (platform === 'darwin') {
    console.log('    defaults write com.adobe.CSXS.11 PlayerDebugMode 1');
    console.log('    defaults write com.adobe.CSXS.12 PlayerDebugMode 1');
  } else {
    console.log('    reg add HKCU\\SOFTWARE\\Adobe\\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f');
    console.log('    reg add HKCU\\SOFTWARE\\Adobe\\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f');
  }
  console.log('  Then restart Premiere Pro: Window → Extensions → Pulp.');
}

function installResolve() {
  const plugins = resolvePluginsDir();
  if (!plugins) {
    console.log('DaVinci Resolve: Workflow Integrations run on macOS and Windows only; nothing to install here.');
    return;
  }
  const target = join(plugins, EXTENSION_ID);
  try {
    if (uninstall) {
      rmSync(target, { recursive: true, force: true });
      console.log(`DaVinci Resolve: removed ${target}`);
      return;
    }
    rmSync(target, { recursive: true, force: true });
    assemble(target, join(ROOT, 'panels', 'resolve'));
  } catch (err) {
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      console.error(`DaVinci Resolve: ${plugins} is not writable by this user.`);
      console.error(platform === 'darwin'
        ? `  Run again as:  sudo node scripts/install-panels.mjs --resolve${uninstall ? ' --uninstall' : ''}`
        : '  Run again from an administrator shell.');
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  const native = resolveNativeModule();
  if (native) {
    cpSync(native, join(target, 'WorkflowIntegration.node'));
    console.log(`DaVinci Resolve: installed to ${target} (WorkflowIntegration.node from the Resolve sample)`);
  } else {
    console.log(`DaVinci Resolve: installed to ${target}`);
    console.log('  WorkflowIntegration.node was not found in the Resolve developer sample; the panel lists fine without it.');
  }
  console.log('  Workflow Integrations are a Resolve Studio feature. Restart Resolve: Workspace → Workflow Integrations → Pulp.');
}

if (both || args.has('--premiere')) installPremiere();
if (both || args.has('--resolve')) installResolve();
console.log('In Pulp: Settings → "Serve the editor panel (local)" must be on for the panels to find it.');
