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

export type Appearance = 'system' | 'light' | 'dark';
export type Palette = 'light' | 'dark';

export const APPEARANCES: readonly { id: Appearance; label: string; hint: string }[] = [
  { id: 'system', label: 'System', hint: 'Follows the operating system, and changes when it does' },
  { id: 'light', label: 'Light', hint: 'Light surfaces and dark text, whatever the system uses' },
  { id: 'dark', label: 'Dark', hint: 'Dark surfaces and light text, whatever the system uses' },
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
 * The window's background in each palette: the `--bg` token, which the main
 * process paints a window with before its page has drawn anything and the
 * page's own head sets before its stylesheet arrives, so no frame ever shows
 * the other palette. A unit test holds all three to the same value.
 */
export const PALETTE_BACKGROUND: Record<Palette, string> = {
  dark: '#16181d',
  light: '#f3f4f6',
};
