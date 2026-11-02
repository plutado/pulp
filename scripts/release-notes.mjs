#!/usr/bin/env node
/**
 * Print a release's notes from CHANGELOG.md (milestone 17), for the release
 * workflow to put on the draft release page.
 *
 *   node scripts/release-notes.mjs            the version package.json declares
 *   node scripts/release-notes.mjs 0.2.0      that one
 *
 * The notes are never written twice: this reads the section `npm run release`
 * already dated, which is also what the tag's own message carries. The
 * arithmetic is `src/core/release.ts`, where the tests are.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let core;
try {
  core = await import('../src/core/release.ts');
} catch (err) {
  process.stderr.write(`This script reads src/core/release.ts directly, which needs Node 22.18 or newer (this is ${process.version}): ${err.message}\n`);
  process.exit(1);
}
const { notesFor, versionIn } = core;

try {
  const asked = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const version = (asked ?? versionIn(readFileSync(join(ROOT, 'package.json'), 'utf8'))).replace(/^v/, '');
  process.stdout.write(`${notesFor(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version)}\n`);
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
