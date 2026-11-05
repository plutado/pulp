/**
 * Layouts made for vertical video (milestone 65): every bundled template made
 * for vertical keeps its words inside the safe box and out of the vertical
 * zones at 9:16, at every moment it has settled — drawn for real, the words
 * found by drawing them changed (src/core/vertical-layout.ts).
 *
 * Unlike the visual references this runs on CI as well: it measures where
 * words are, to within a couple of pixels, rather than comparing pictures, so
 * a font drawn a shade differently on another platform does not fail it.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBounded } from './process';

const ROOT = join(__dirname, '..', '..');

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
if (!electron && process.env.PULP_E2E === '1') throw new Error('the vertical layout check needs the Electron binary (PULP_E2E=1)');

describe.skipIf(!electron)('templates made for vertical keep their words where a tall frame is clear', () => {
  it('draws every one at 9:16 and finds its words inside the safe box and out of every zone, naming any that is not', async () => {
    const result = await runBounded(electron!, ['.', 'safe-box'], { cwd: ROOT, timeoutMs: 300_000 });
    const report = `${result.stdout}\n${result.stderr}`.trim();
    // A line per moment out of place, and one per template that could not be checked: the whole story.
    const noteworthy = report.split('\n').filter((line) => line.startsWith('OUTSIDE') || line.startsWith('could not check')).join('\n');
    expect(result.code, noteworthy || report).toBe(0);
    // It looked at what it says it did: the six hooks and four caption styles, at every moment.
    const summary = /(\d+) templates made for vertical, (\d+) moments checked, 0 out of place/.exec(result.stdout);
    expect(summary, report).not.toBeNull();
    expect(Number(summary![1])).toBeGreaterThanOrEqual(10);
    expect(Number(summary![2])).toBeGreaterThanOrEqual(30);
  }, 330_000);
});
