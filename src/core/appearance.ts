/**
 * Light and dark appearance (milestone 62), the pure part: the three choices,
 * what a saved one may be, which palette a choice comes to on this system, and
 * the one background color each palette opens on.
 *
 * The choice is carried to every window by Electron's `nativeTheme.themeSource`,
 * so the pages see it as `prefers-color-scheme` from their first style pass —
 * the main window, the popped-out stage, the Settings dialog and the start
 * screen all read it there, and System follows the operating system as it
 * changes with nothing listening for it. The stylesheet's palettes are the
 * `:root` tokens and their light counterpart in src/renderer/styles.css.
 */

import { tr } from './i18n';

export type Appearance = 'system' | 'light' | 'dark';
export type Palette = 'light' | 'dark';

/** The three, named in the interface's language now: a getter reads the catalog each time (milestone 59). */
export const APPEARANCES: readonly { id: Appearance; readonly label: string; readonly hint: string }[] = [
  { id: 'system', get label() { return tr('appearance.system'); }, get hint() { return tr('appearance.system.hint'); } },
  { id: 'light', get label() { return tr('appearance.light'); }, get hint() { return tr('appearance.light.hint'); } },
  { id: 'dark', get label() { return tr('appearance.dark'); }, get hint() { return tr('appearance.dark.hint'); } },
];

/** A first launch follows the system. */
export const DEFAULT_APPEARANCE: Appearance = 'system';

export function isAppearance(value: unknown): value is Appearance {
  return APPEARANCES.some((a) => a.id === value);
}

/** What a settings file may say: one of the three, and anything else is the default. */
export function sanitizeAppearance(raw: unknown): Appearance {
  return isAppearance(raw) ? raw : DEFAULT_APPEARANCE;
}

/** The palette a choice comes to, given whether the operating system is dark right now. */
export function resolveAppearance(choice: Appearance, systemDark: boolean): Palette {
  if (choice === 'system') return systemDark ? 'dark' : 'light';
  return choice;
}

/**
 * The color scheme a frame showing a template page must carry: the page's own.
 * Chromium paints an opaque backdrop — white, or near-black — behind a frame
 * whose element's color scheme differs from its document's, which turns a
 * transparent graphic into one on solid white. The window declares
 * `<meta name="color-scheme" content="dark light">`, so a frame left at
 * `normal` would take the window's palette; it is given the page's instead.
 *
 * The page says what it declares (the bridge's `pulp:ready`): its root's
 * `color-scheme` where that is not `normal`, else its own color-scheme meta,
 * else nothing — and a page that declares nothing is light, which is every
 * bundled template. What the page sends is checked against the property's
 * grammar, since a template's page is the author's own code.
 */
export const TEMPLATE_PAGE_SCHEME = 'light';

const SCHEME_VALUE = /^(?:only )?(?:light|dark)(?: (?:light|dark))?(?: only)?$/;

export function frameColorScheme(report: unknown): string {
  const declared = report && typeof report === 'object' ? (report as { root?: unknown; meta?: unknown }) : {};
  for (const value of [declared.root, declared.meta]) {
    const scheme = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
    if (SCHEME_VALUE.test(scheme)) return scheme;
  }
  return TEMPLATE_PAGE_SCHEME;
}

/**
 * The window's background in each palette: the `--bg` token, which the main
 * process paints a window with before its page has drawn anything and the
 * page's own head sets before its stylesheet arrives, so no frame ever shows
 * the other palette. A unit test holds all three to the same value.
 */
export const PALETTE_BACKGROUND: Record<Palette, string> = {
  dark: '#16181d',
  light: '#f3f4f6',
};
