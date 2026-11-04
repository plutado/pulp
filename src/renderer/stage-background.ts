/**
 * What the stage draws behind a transparent graphic, as one button on its
 * corner: the button wears the current choice — the checkerboard, black,
 * white, gray or a color of one's own — and opens a small picker of the five,
 * so the corner is a row of four buttons of one size rather than a strip of
 * swatches. The choices inside are the same elements they always were
 * (`#bg-checker` … `#bg-custom`), pressed by the View menu and read by both
 * menus by id; this module only opens and closes the picker and paints the
 * button. The stage applies a choice (src/renderer/stage.ts).
 *
 * The stage can be popped out into a window of its own (milestone 43), so
 * everything is found through the button's own document at the time.
 */

import { STAGE_BACKGROUND_COLORS, STAGE_BACKGROUNDS, type PlayerState } from '../core/player';

/** Paint the button with the current choice, and say it in its label and tooltip. */
export function showBackgroundChoice(button: HTMLElement, player: Pick<PlayerState, 'background' | 'customBackground'>): void {
  const current = button.querySelector<HTMLElement>('.bg-current');
  const bg = player.background;
  if (current) {
    current.classList.toggle('checker', bg === 'checker');
    current.style.backgroundColor = bg === 'checker' ? '' : bg === 'custom' ? player.customBackground : STAGE_BACKGROUND_COLORS[bg];
  }
  const name = player.background === 'custom' ? `custom color ${player.customBackground}` : (STAGE_BACKGROUNDS.find((b) => b.id === player.background)?.label ?? '');
  button.setAttribute('aria-label', `Preview background: ${name}`);
  button.dataset.tip = `Background: ${name}`;
}

/** Open and close the picker from its button: a choice, Escape or a press anywhere else closes it. */
export function mountBackgroundPicker(button: HTMLButtonElement, picker: HTMLElement): void {
  let listening: Document | null = null;
  const onPointer = (e: PointerEvent): void => {
    const target = e.target as Node;
    if (!picker.contains(target) && !button.contains(target)) close(false);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // The picker's, not theater's or the results': one Escape closes one thing.
    e.preventDefault();
    e.stopPropagation();
    close(true);
  };
  function open(): void {
    picker.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    listening = button.ownerDocument;
    listening.addEventListener('pointerdown', onPointer, true);
    listening.addEventListener('keydown', onKey, true);
    // The keyboard starts on the choice that is on.
    picker.querySelector<HTMLElement>('[aria-pressed="true"], .active')?.focus();
  }
  function close(refocus: boolean): void {
    if (picker.hidden) return;
    picker.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    listening?.removeEventListener('pointerdown', onPointer, true);
    listening?.removeEventListener('keydown', onKey, true);
    listening = null;
    if (refocus) button.focus();
  }
  button.addEventListener('click', () => (picker.hidden ? open() : close(false)));
  for (const choice of picker.querySelectorAll('button')) choice.addEventListener('click', () => close(true));
  // A color of one's own is tried live while the system's chooser is open, and settles on change.
  picker.querySelector('input[type="color"]')?.addEventListener('change', () => close(true));
}
