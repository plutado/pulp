/**
 * The line under the results that says what sample media would add
 * (milestone 34): while the category being browsed has catalog files that
 * have not been made, it reads "N more with sample media" and offers to make
 * just those. Which files are left is the main process's answer — it looks in
 * the sample-media folder — and the words and the arithmetic are
 * `src/core/sample-hint.ts`; this file only shows them and runs the button.
 *
 * The count is asked for once at startup and again after a run, which is the
 * only thing that changes it: it is a few hundred `existsSync` calls on the
 * other side, so it is read on a change rather than polled.
 */

import { computed, effect, signal } from '@preact/signals';
import { sampleHint, sampleHintOutcome, type UnmadeByType } from '../core/sample-hint';
import { NOTE_MS } from '../core/tray-note';
import type { Scope } from '../core/app-state';
import type { LibraryIndex } from '../core/library-types';
import { appState } from './store';
import { bindText, t } from './i18n';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** How many catalog files each type still lacks; empty until the first answer arrives. */
const unmade = signal<UnmadeByType>({});

/**
 * Some of the catalog is still to make, so Add has sample media to offer
 * (milestone 47). Empty while the first answer is awaited, which reads as
 * "nothing left" — so the choice appears when the answer says it should
 * rather than flickering away a moment after launch.
 */
export const someSampleMediaUnmade = computed(() => Object.values(unmade.value).some((n) => n > 0));

/**
 * What a run is doing or did, and where it was started. Kept with its scope so
 * "Made 20 files." is still readable afterwards, and goes when somewhere else
 * is browsed — where the count speaks for itself. Its words are worked out when
 * they are shown, so a change of language reaches them too.
 */
const run = signal<{ scope: Scope | null; say: () => string; busy: boolean } | null>(null);

const hint = computed(() => sampleHint(appState.value.scope, unmade.value));
const note = computed(() => {
  const current = run.value;
  return current && current.scope === appState.value.scope ? current : null;
});

/**
 * A sentence on this line that nothing else in the window can carry: the collection's own line is in
 * the tray, which is not in the window while the collection is empty. Brief, like that line's notes.
 */
export function sayUnderResults(say: () => string): void {
  const mine = { scope: appState.value.scope, say, busy: false };
  run.value = mine;
  setTimeout(() => {
    if (run.value === mine) run.value = null;
  }, NOTE_MS);
}

export async function refreshSampleHint(): Promise<void> {
  unmade.value = (await window.pulp.sampleMediaStatus()).unmade;
}

/** What the line asks of the rest of the app: a library it made bigger. */
export interface SampleHintActions {
  onIndex: (index: LibraryIndex | null) => void;
}

export function initSampleHint(actions: SampleHintActions): void {
  const host = $('results-hint');
  const text = $('results-hint-text');
  const button = $<HTMLButtonElement>('results-hint-make');
  const app = $('app');

  effect(() => {
    const offer = hint.value;
    const running = note.value;
    const show = offer !== null || running !== null;
    host.hidden = !show;
    // The window's own floor counts this line when the results fold to their heading (milestone 42).
    app.classList.toggle('sample-hint', show);
    if (!show) return;
    text.textContent = running ? running.say() : offer!.label;
    // Nothing left to make and nothing running: the button goes and the line is the outcome alone.
    button.hidden = offer === null;
    if (!offer) return;
    const busy = running?.busy === true;
    // Bound, not merely written: the markup names this button's message, which a change of language would put back.
    bindText(button, busy ? 'sample-hint.making' : 'ui.results-hint-make');
    button.dataset.tip = offer.tip;
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  });

  button.addEventListener('click', () => {
    const offer = hint.value;
    if (!offer || note.value?.busy) return;
    const scope = appState.value.scope;
    const count = offer.count;
    run.value = { scope, say: () => t('sample-hint.making-files', { count }), busy: true };
    void window.pulp
      .makeSampleMedia(offer.types)
      .then(async (outcome) => {
        // Canceled at the folder question: nothing was asked for, so nothing is said.
        if (!outcome) {
          run.value = null;
          return;
        }
        if (outcome.failed.length > 0) console.warn(`Sample media: ${outcome.failed.length} file(s) could not be made: ${outcome.failed.join('; ')}`);
        const written = outcome.written;
        const failed = outcome.failed.length;
        run.value = { scope, say: () => sampleHintOutcome(written, failed), busy: false };
        actions.onIndex(outcome.index);
        await refreshSampleHint();
      })
      .catch((err: Error) => {
        // The reason is the main process's own detail, in a frame of this window's.
        run.value = { scope, say: () => t('sample-hint.failed', { reason: err.message }), busy: false };
      });
  });

  void refreshSampleHint();
}
