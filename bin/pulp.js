#!/usr/bin/env node
/**
 * The `pulp` command in a checkout: starts the built app headless with the
 * arguments given (`pulp render …`, `pulp collection …`, `pulp help`), and
 * exits with its exit code — 0 done, 1 failed, 2 the command line was wrong.
 * A packaged Pulp takes the same arguments on its own binary; this file is for
 * `npm link` and `node bin/pulp.js` against a build (`npm run build`).
 */
'use strict';

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
if (!existsSync(path.join(root, 'out', 'main', 'index.js'))) {
  process.stderr.write('pulp: no build found. Run "npm run build" first.\n');
  process.exit(2);
}

let electron;
try {
  // In a Node process `require('electron')` is the path of the Electron binary.
  electron = require('electron');
} catch {
  process.stderr.write('pulp: Electron is not installed. Run "npm install" first.\n');
  process.exit(2);
}
if (typeof electron !== 'string') {
  process.stderr.write('pulp: could not find the Electron binary.\n');
  process.exit(2);
}

const env = { ...process.env };
// A `pulp` run from inside an Electron app's own shell would otherwise be told to behave as Node.
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [root, ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: true });
child.on('error', (err) => {
  process.stderr.write(`pulp: could not start Electron: ${err.message}\n`);
  process.exit(2);
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.stderr.write(`pulp: stopped by ${signal}\n`);
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});
