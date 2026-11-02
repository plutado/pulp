/**
 * The third-party notices (milestone 8) held to what is shipped: every
 * runtime dependency the lock file installs is named in
 * `THIRD_PARTY_NOTICES.md`, so a new dependency cannot ship unlisted — this
 * runs in CI with the rest — and the file reads into the sections the
 * Acknowledgements dialog shows.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docSections, isDocTable } from '../src/core/doc-page';
import { BUNDLED_FONTS } from '../src/core/fonts';

const ROOT = join(__dirname, '..');
const notices = await readFile(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');

describe('third-party notices', () => {
  it('names every runtime dependency the lock file installs, and the runtime itself', async () => {
    const lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { dev?: boolean; version: string }> };
    const runtime = Object.entries(lock.packages)
      .filter(([path, info]) => path !== '' && !info.dev)
      .map(([path]) => path.replace(/^.*node_modules\//, ''))
      // A package's per-platform builds are listed under the package that pulls them in.
      .map((name) => name.replace(/^(@napi-rs\/canvas)-.+$/, '$1'));
    const missing = [...new Set(runtime)].filter((name) => !notices.includes(`**${name}**`) && !notices.includes(`**@preact/signals** and **${name}**`));
    expect(missing).toEqual([]);
    for (const name of ['Electron', 'Chromium', 'Node.js', 'FFmpeg', 'whisper.cpp']) expect(notices).toContain(`**${name}**`);
  });

  it('names every bundled font family, with the credits page for the detail', () => {
    for (const font of BUNDLED_FONTS) expect(notices, font.family).toContain(font.family);
    expect(notices).toContain('docs/font-credits.md');
  });

  it('reads into the sections the Acknowledgements dialog shows: a title, paragraphs and tables', () => {
    const sections = docSections(notices);
    expect(sections[0]!.title).toBe('Third-party notices');
    expect(sections.map((s) => s.title)).toContain('Runtime');
    const runtime = sections.find((s) => s.title === 'Runtime')!;
    const table = runtime.blocks.find(isDocTable)!;
    expect(table.header).toEqual(['Component', 'Licence', 'Notes']);
    expect(table.rows.map((r) => r[0])).toEqual(['Electron', 'Chromium', 'Node.js']);
    // Inline marks are taken off: the dialog sets the words plainly.
    expect(JSON.stringify(sections)).not.toMatch(/\*\*|`/);
  });
});
