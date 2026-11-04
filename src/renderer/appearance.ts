/**
 * Light and dark appearance in the window (milestone 62): the choice, held as a
 * signal so View → Appearance and Settings → Appearance show the same one, and
 * the one call both make to change it. Nothing here paints: the main process
 * hands the choice to every window as `prefers-color-scheme`, and the
 * stylesheet's palettes (src/renderer/styles.css) do the rest — the window, the
 * popped-out stage, the dialogs and the start screen redraw together.
 */

import { signal } from '@preact/signals';
import { DEFAULT_APPEARANCE, isAppearance, type Appearance } from '../core/appearance';

export const appearanceChoice = signal<Appearance>(DEFAULT_APPEARANCE);

/** Save and apply a choice; anything that is not one of the three is ignored. */
export async function chooseAppearance(choice: unknown): Promise<void> {
  if (!isAppearance(choice)) return;
  appearanceChoice.value = choice;
  const state = await window.pulp.setAppearance(choice);
  appearanceChoice.value = state.choice;
}

export function initAppearance(): void {
  void window.pulp.getAppearance().then((state) => {
    appearanceChoice.value = state.choice;
  });
}
