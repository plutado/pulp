/**
 * The visual regression safety net (docs/ideas.md): every bundled template, at
 * each aspect it declares, at a few fixed frames, compared with the approved
 * references in `tests/visual/references.json`.
 *
 * The references are perceptual hashes rather than images — this repository
 * ships no binaries, and a hash is a short string a reviewer reads in a diff.
 * What counts as the same picture is `src/core/visual-hash.ts`, which has its
 * own unit tests: antialiasing and a font hinted a shade differently do not
 * fail it, a moved, recoloured or missing element does.
 *
 * When a change to a template is intended, approve it deliberately:
 *
 *     npm run build && npm run visual:approve
 *
 * and the diff shows exactly which templates, aspects and frames moved.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBounded } from './process';

const ROOT = join(__dirname, '..', '..');
const REFERENCES = join(ROOT, 'tests', 'visual', 'references.json');

async function findElectron(): Promise<string | null> {
  if (process.env.PULP_E2E === '0') return null;
  try {
    const electron = (await import('electron')).default as unknown as string;
    return typeof electron === 'string' && existsSync(electron) ? electron : null;
  } catch {
    return null;
  }
}

const electron = await findElectron();
if (!electron && process.env.PULP_E2E === '1') throw new Error('visual regression needs the Electron binary (PULP_E2E=1)');

describe.skipIf(!electron)('every bundled template still looks like itself', () => {
  it('matches the approved references, naming the template, aspect and frame of anything that moved', async () => {
    expect(existsSync(REFERENCES), 'the references are committed; run npm run visual:approve to make them').toBe(true);
    const result = await runBounded(electron!, ['.', '--visual-hashes', REFERENCES, '--check'], { cwd: ROOT, timeoutMs: 600_000 });
    // The check prints a line per template that changed and a line per frame with no reference,
    // which is the whole report: the message below is what a failure shows.
    const report = `${result.stdout}\n${result.stderr}`.trim();
    const noteworthy = report
      .split('\n')
      .filter((line) => line.startsWith('CHANGED') || line.startsWith('NEW') || line.startsWith('could not render'))
      .join('\n');
    expect(result.code, noteworthy || report).toBe(0);
  }, 660_000);

});
