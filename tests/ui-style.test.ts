/**
 * The ui-style guide, enforced (docs/ui-style.md): ALL CAPS display text,
 * three-dot ellipses, raw ids in the label tables, icon-only buttons without an
 * accessible name, and font sizes outside the token block are defects, not style.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILTER_CHIPS } from '../src/core/app-state';
import { STYLES, THEME_GROUPS, TYPE_GROUPS, TYPES } from '../src/core/taxonomy';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFile(join(ROOT, p), 'utf8');

/** Initialisms editors read as words; anything else in caps is shouting. */
const CAPS_ALLOWED = new Set(['CSV']);

describe('stylesheet', () => {
  it('has no uppercase transforms and no font sizes outside the tokens', async () => {
    const css = await read('src/renderer/styles.css');
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    const literals = css.match(/font-size:\s*[0-9][^;]*/g) ?? [];
    expect(literals).toEqual([]);
  });
});

describe('markup', () => {
  it('uses the ellipsis character, never three dots', async () => {
    const html = await read('src/renderer/index.html');
    expect(html.includes('...')).toBe(false);
  });

  it('shows no ALL CAPS text', async () => {
    const html = await read('src/renderer/index.html');
    const text = html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' '); // attributes go with their tags; what remains is what the user reads
    const shouting = [...text.matchAll(/\b[A-Z]{3,}\b/g)].map((m) => m[0]).filter((w) => !CAPS_ALLOWED.has(w));
    expect(shouting).toEqual([]);
  });

  it('gives every icon-only button an accessible name', async () => {
    const html = await read('src/renderer/index.html');
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const offenders = buttons.filter((b) => {
      const open = b.slice(0, b.indexOf('>') + 1);
      if (!open.includes('data-icon')) return false;
      const hasLabelSpan = b.includes('class="label"');
      const inner = b.slice(b.indexOf('>') + 1, b.lastIndexOf('</button>')).replace(/<[^>]*>/g, '').trim();
      return !hasLabelSpan && inner === '' && !open.includes('aria-label');
    });
    expect(offenders).toEqual([]);
  });
});

describe('label tables', () => {
  it('holds display labels, not raw ids', () => {
    const labeled = [
      ...TYPES,
      ...TYPE_GROUPS,
      ...STYLES,
      ...THEME_GROUPS,
      ...THEME_GROUPS.flatMap((g) => g.themes),
      ...FILTER_CHIPS,
    ];
    for (const entry of labeled) {
      expect(entry.label, entry.label).toMatch(/^[A-Z0-9]/);
      expect(entry.label, entry.label).not.toMatch(/^[a-z0-9-]+$/);
    }
  });
});
