import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPEARANCES, DEFAULT_APPEARANCE, frameColorScheme, isAppearance, PALETTE_BACKGROUND, resolveAppearance, sanitizeAppearance, TEMPLATE_PAGE_SCHEME,
} from '../src/core/appearance';
import { buildMenu, EMPTY_MENU_STATE, itemChecked, itemEnabled, type MenuState } from '../src/core/menu';

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'src', 'renderer', 'styles.css'), 'utf8');
const html = readFileSync(join(root, 'src', 'renderer', 'index.html'), 'utf8');

/** The stylesheet without its comments, which may name a color without using one, or what is inside a url(). */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\((['"]).*?\1\)/g, 'url()');

/** A color written out: a hex value, a functional color, or a named one. */
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|navy|teal|maroon|olive|lime|aqua|fuchsia)\b/;

/** Every rule as its selector and declarations, at-rules unwrapped (the light palette's media block). */
function rules(text: string): { selector: string; declarations: [string, string][] }[] {
  const out: { selector: string; declarations: [string, string][] }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of text.matchAll(re)) {
    const selector = m[1]!.replace(/^[\s\S]*@media[^{]*$/, '').trim();
    const declarations = m[2]!
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d.includes(':'))
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()] as [string, string]);
    out.push({ selector, declarations });
  }
  return out;
}

/** The custom properties of the first `:root` block in a piece of the stylesheet. */
function rootTokens(text: string): Record<string, string> {
  const block = /(?:^|\n):root\s*\{([^}]*)\}/.exec(text)![1]!;
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const dark = rootTokens(code);
const lightBlock = /@media \(prefers-color-scheme: light\) \{\s*(:root\s*\{[^}]*\})\s*\}/.exec(code)![1]!;
const light = { ...dark, ...rootTokens(lightBlock) };
const lightOwn = rootTokens(lightBlock);

/** WCAG relative luminance and contrast ratio, computed rather than trusted. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('the appearance setting (milestone 62)', () => {
  it('offers System, Light and Dark, and a first launch follows the system', () => {
    expect(APPEARANCES.map((a) => [a.id, a.label])).toEqual([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]);
    expect(DEFAULT_APPEARANCE).toBe('system');
  });

  it('reads back only the three choices; anything else in the file is System', () => {
    for (const a of ['system', 'light', 'dark'] as const) expect(sanitizeAppearance(a)).toBe(a);
    for (const junk of [undefined, null, '', 'Dark', 'sepia', 1, true, {}]) expect(sanitizeAppearance(junk)).toBe('system');
    expect(isAppearance('light')).toBe(true);
    expect(isAppearance('auto')).toBe(false);
  });

  it('System follows the operating system; Light and Dark hold whatever it does', () => {
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(resolveAppearance('system', false)).toBe('light');
    for (const systemDark of [true, false]) {
      expect(resolveAppearance('light', systemDark)).toBe('light');
      expect(resolveAppearance('dark', systemDark)).toBe('dark');
    }
  });

  it('is in the View menu as three radios, ticked for the one chosen', () => {
    const state = (over: Partial<MenuState> = {}): MenuState => ({ ...EMPTY_MENU_STATE, ...over });
    const view = buildMenu({ mac: false, development: false, appName: 'Pulp', state: state() }).find((s) => s.label === 'View')!.items;
    const items = view.find((i) => i.label === 'Appearance')!.submenu!;
    expect(items.map((i) => [i.label, i.command, i.arg, i.type])).toEqual([
      ['System', 'view.appearance', 'system', 'radio'],
      ['Light', 'view.appearance', 'light', 'radio'],
      ['Dark', 'view.appearance', 'dark', 'radio'],
    ]);
    expect(items.filter((i) => itemChecked(i, state())).map((i) => i.label), 'System by default').toEqual(['System']);
    expect(items.filter((i) => itemChecked(i, state({ appearance: 'light' }))).map((i) => i.label)).toEqual(['Light']);
    expect(items.every((i) => itemEnabled(i, state()))).toBe(true);
  });

  it('offers the same words in Settings as in the menu: the radios are built from the one list', () => {
    expect(html).toContain('id="settings-appearance"');
    expect(html).toMatch(/<h3 id="settings-appearance-head" class="settings-head">Appearance<\/h3>/);
  });
});

describe('the window\'s palettes (milestone 62)', () => {
  it('writes no color outside the token list: every one is a custom property on :root or the start screen', () => {
    const stray: string[] = [];
    for (const { selector, declarations } of rules(code)) {
      for (const [name, value] of declarations) {
        // A token's name is not a color: `var(--swatch-black)` uses one, it does not write one.
        if (!COLOR.test(value.replace(/var\([^)]*\)/g, ''))) continue;
        const tokenHome = selector === ':root' || selector === '.start-screen';
        if (!(name.startsWith('--') && tokenHome)) stray.push(`${selector} { ${name}: ${value} }`);
      }
    }
    expect(stray, 'colors written outside the tokens').toEqual([]);
  });

  it('gives every color token of the window a light counterpart, but for what belongs to the work', () => {
    // The same in either appearance, on purpose: the stage's chosen backgrounds' buttons, the safe
    // areas over the picture, and the mark. The checkerboard and the poster backdrops follow it.
    const SAME_IN_BOTH = [
      '--swatch-black', '--swatch-white', '--swatch-gray',
      '--safe-line', '--safe-zone', '--safe-zone-edge',
      '--mark-tile', '--mark-bar', '--mark-sub',
    ];
    const colorTokens = Object.entries(dark).filter(([, v]) => !v.startsWith('url(') && COLOR.test(v)).map(([k]) => k);
    expect(colorTokens.filter((k) => !SAME_IN_BOTH.includes(k) && !(k in lightOwn)), 'tokens with no light value').toEqual([]);
    expect(SAME_IN_BOTH.filter((k) => k in lightOwn), 'work colors changed by the light palette').toEqual([]);
    expect(SAME_IN_BOTH.filter((k) => !(k in dark)), 'listed here but not in the stylesheet').toEqual([]);
  });

  for (const [name, t] of [['dark', dark], ['light', light]] as const) {
    it(`holds the ${name} palette to WCAG AA: text, icons, focus rings and the accent`, () => {
      for (const surface of ['--bg', '--panel', '--panel-2']) {
        for (const fg of ['--text', '--text-secondary', '--muted', '--accent-text']) {
          expect(contrast(t[fg]!, t[surface]!), `${fg} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(t['--danger']!, t[surface]!), `--danger on ${surface}`).toBeGreaterThanOrEqual(4.5);
        // A focus ring, a selected tab's underline, a pressed toggle's border: 3:1 for what is not text.
        expect(contrast(t['--accent']!, t[surface]!), `the accent as a ring on ${surface}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(t['--on-accent']!, t['--accent']!), 'a primary button').toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--ink']!, t['--accent']!), 'a label on an accent mark').toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--text']!, t['--warn']!), 'a pressed Mute').toBeGreaterThanOrEqual(4.5);
    });
  }

  it('opens on the same background everywhere: the window, the page head and the --bg tokens agree', () => {
    expect(PALETTE_BACKGROUND.dark).toBe(dark['--bg']);
    expect(PALETTE_BACKGROUND.light).toBe(light['--bg']);
    // The page's head sets it before its stylesheet loads, in each palette.
    const head = html.slice(0, html.indexOf('<link rel="stylesheet"'));
    const inline = /<style>([\s\S]*?)<\/style>/.exec(head)?.[1] ?? '';
    expect(inline, 'the dark background and color-scheme first').toMatch(new RegExp(`^html \\{ background: ${PALETTE_BACKGROUND.dark}; color-scheme: dark; \\}`));
    expect(inline).toContain(`@media (prefers-color-scheme: light) { html { background: ${PALETTE_BACKGROUND.light}; color-scheme: light; } }`);
    expect(head).toContain('<meta name="color-scheme" content="dark light">');
    // Each palette says which it is, so form controls and scroll bars are drawn to match.
    expect(dark['--bg']).toBeDefined();
    expect(lightBlock).toMatch(/color-scheme: light;/);
  });
});

describe('the frames a template is shown in carry the template\'s own color scheme (milestone 62)', () => {
  it('takes what the page declares: its root first, then its meta, and light when it declares nothing', () => {
    expect(frameColorScheme({ root: 'normal', meta: null }), 'every bundled template').toBe('light');
    expect(TEMPLATE_PAGE_SCHEME).toBe('light');
    expect(frameColorScheme({ root: 'dark', meta: 'light' }), 'the property outranks the meta').toBe('dark');
    expect(frameColorScheme({ root: 'normal', meta: 'dark light' })).toBe('dark light');
    expect(frameColorScheme({ root: 'only  LIGHT', meta: null }), 'spacing and case are the page\'s own business').toBe('only light');
    expect(frameColorScheme({ root: 'light dark', meta: null })).toBe('light dark');
  });

  it('reads a page\'s report as what it is — the author\'s own code — and falls back to light on anything else', () => {
    for (const junk of [undefined, null, 'dark', 7, {}, { root: 'sepia' }, { root: 'dark; background: red' }, { meta: 'light dark light dark' }, { root: ['dark'] }]) {
      expect(frameColorScheme(junk), JSON.stringify(junk)).toBe('light');
    }
  });

  it('gives the frames light before the page reports, never normal: the window\'s meta would make that its own palette', () => {
    // The regression: with the meta, a frame at `normal` took dark in the dark appearance while the
    // page stayed light, and Chromium painted solid white behind every transparent graphic.
    expect(html).toMatch(/<meta name="color-scheme" content="[^"]*dark[^"]*">/);
    const frames = rules(code).filter((r) => r.selector === '.preview iframe');
    expect(frames).toHaveLength(1);
    expect(frames[0]!.declarations.find(([name]) => name === 'color-scheme')?.[1]).toBe(TEMPLATE_PAGE_SCHEME);
    // Both frames on the stage are under that rule: the template's and the captions'.
    expect(html).toMatch(/<div[^>]*class="[^"]*\bpreview\b[^"]*"[^>]*>[\s\S]*?<iframe id="preview"[\s\S]*?<iframe id="captions-preview"/);
  });

  it('lets the checkerboard and the poster backdrops follow the appearance, lighter in light', () => {
    for (const token of ['--checker-a', '--checker-b', '--poster-any', '--poster-lower-thirds', '--poster-still-backgrounds']) {
      expect(lightOwn[token], token).toBeDefined();
      expect(luminance(light[token]!), `${token} lighter in light`).toBeGreaterThan(luminance(dark[token]!));
    }
    // The two squares of the board still tell apart, in each.
    for (const t of [dark, light]) expect(contrast(t['--checker-a']!, t['--checker-b']!)).toBeGreaterThan(1.1);
  });
});
