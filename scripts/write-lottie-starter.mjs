/**
 * Write the starter set of Lottie animations into `templates/` (milestone 35).
 *
 * The readable source is `src/core/lottie-starter.ts`; these files are what it
 * builds, checked in so the bundled library has them without a build step.
 * `tests/lottie-starter.test.ts` holds the two together, so a change to the
 * builder that is not written out is a failing test rather than a surprise.
 *
 * Run with `npm run lottie:write`. Node reads the TypeScript directly — the
 * builder imports nothing, so there is nothing to resolve or compile.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTER_ANIMATIONS } from '../src/core/lottie-starter.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let written = 0;
for (const animation of STARTER_ANIMATIONS) {
  const folder = join(root, 'templates', animation.folder);
  await mkdir(folder, { recursive: true });
  // Two spaces and a trailing newline: the shape every other JSON in the repo is written in.
  await writeFile(join(folder, `${animation.id}.json`), `${JSON.stringify(animation.build(), null, 2)}\n`);
  written += 1;
}
console.log(`wrote ${written} starter animations into templates/animated`);
