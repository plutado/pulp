/**
 * Light and dark appearance in the main process (milestone 62): the saved
 * choice handed to `nativeTheme.themeSource`, which every window's pages read
 * as `prefers-color-scheme` — so a change redraws them all at once, with no
 * restart and no message to each — and the background a window is painted
 * with before its page has drawn, so a launch never shows the other palette.
 */

import { BrowserWindow, nativeTheme } from 'electron';
import { PALETTE_BACKGROUND, resolveAppearance, sanitizeAppearance, type Appearance } from '../core/appearance';
import { loadSettings, updateSettings } from './settings';

/** The windows whose own background follows the palette: the app's, not the offscreen render windows. */
let painted: () => BrowserWindow[] = () => [];

/** The background a window opens on now: the palette the choice and the system come to. */
export function windowBackground(): string {
  return PALETTE_BACKGROUND[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
}

/** Read the saved choice and apply it; before the first window is made, so it opens in it. */
export async function loadAppearance(): Promise<Appearance> {
  const { appearance } = await loadSettings();
  nativeTheme.themeSource = appearance;
  return appearance;
}

export async function getAppearance(): Promise<{ choice: Appearance; palette: 'light' | 'dark' }> {
  const { appearance } = await loadSettings();
  return { choice: appearance, palette: resolveAppearance(appearance, nativeTheme.shouldUseDarkColors) };
}

/** Save and apply a choice; anything that is not one of the three is System. */
export async function setAppearance(raw: unknown): Promise<{ choice: Appearance; palette: 'light' | 'dark' }> {
  const choice = sanitizeAppearance(raw);
  await updateSettings((s) => ({ ...s, appearance: choice }));
  nativeTheme.themeSource = choice;
  return getAppearance();
}

/**
 * Keep the windows' own backgrounds with the palette — what shows for an instant
 * while a window grows, before its page fills the new room. `nativeTheme` says
 * when the palette changes, whether the choice changed or the system did.
 */
export function watchAppearance(windows: () => BrowserWindow[]): void {
  painted = windows;
  nativeTheme.on('updated', () => {
    const color = windowBackground();
    for (const win of painted()) if (!win.isDestroyed()) win.setBackgroundColor(color);
  });
}
