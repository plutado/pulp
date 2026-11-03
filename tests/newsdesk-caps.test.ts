/**
 * All caps as a parameter on the Newsdesk set: every lettered template of the
 * set declares the switch, on by default so existing work is unchanged, and
 * no page uppercases on its own any more — only through the helper the switch
 * governs.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/core/manifest';
import { resolveParams } from '../src/core/params';

const SET = join(__dirname, '..', 'templates', 'newsdesk');

describe('the Newsdesk set and its capitals', () => {
  it('declares All caps, on by default, on every template that letters, and letters only through the switch', async () => {
    const folders = (await readdir(SET, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    let lettered = 0;
    for (const folder of folders) {
      const page = await readFile(join(SET, folder, 'index.html'), 'utf8');
      const parsed = parseManifest(await readFile(join(SET, folder, 'template.json'), 'utf8'));
      expect(parsed.ok, folder).toBe(true);
      if (!parsed.ok) continue;
      const param = parsed.manifest.parameters.find((p) => p.id === 'allCaps');
      const uppercases = page.split('\n').filter((l) => l.includes('.toUpperCase()'));
      if (!page.includes('function caps(text)')) {
        // A template that letters nothing (the background, the flash cut, the glitch, the transition) has no switch and no capitals.
        expect(param, `${folder} has no caps to switch`).toBeUndefined();
        expect(uppercases, folder).toEqual([]);
        continue;
      }
      lettered += 1;
      expect(param, `${folder} declares the switch`).toMatchObject({ type: 'boolean', default: true, label: 'All caps' });
      // The one uppercase in the page is the helper's own, under the switch.
      expect(uppercases, folder).toHaveLength(1);
      expect(uppercases[0]).toContain('allCaps ? text.toUpperCase()');
      // The page reads the switch once per frame, from the parameters.
      expect(page).toContain('allCaps = p.allCaps !== false;');
      // Resolved with nothing said, the switch is on: what every saved project and preset gets.
      expect(resolveParams(parsed.manifest).values.allCaps).toBe(true);
      expect(resolveParams(parsed.manifest, { allCaps: false }).values.allCaps).toBe(false);
    }
    expect(lettered).toBe(11);
  });
});
