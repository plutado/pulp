/**
 * The line under the results that says what sample media would add
 * (milestone 34): while the category being browsed has catalogue files that
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
import type { Scope } from '../core/app-state';
import type { LibraryIndex } from '../core/library-types';
import { appState } from './store';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

/** How many catalogue files each type still lacks; empty until the first answer arrives. */
const unmade = signal<UnmadeByType>({});

/**
 * What a run is doing or did, and where it was started. Kept with its scope so
 * "Made 20 files." is still readable afterwards, and goes when somewhere else
 * is browsed — where the count speaks for itself.
 */
const run = signal<{ scope: Scope | null; text: string; busy: boolean } | null>(null);

const hint = computed(() => sampleHint(appState.value.scope, unmade.value));
const note = computed(() => {
  const current = run.value;
  return current && current.scope === appState.value.scope ? current : null;
});

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
    text.textContent = running?.text ?? offer!.label;
    // Nothing left to make and nothing running: the button goes and the line is the outcome alone.
    button.hidden = offer === null;
    if (!offer) return;
    const busy = running?.busy === true;
    button.textContent = busy ? 'Making…' : offer.action;
    button.dataset.tip = offer.tip;
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  });

  button.addEventListener('click', () => {
    const offer = hint.value;
    if (!offer || note.value?.busy) return;
    const scope = appState.value.scope;
    run.value = { scope, text: `Making ${offer.count} ${offer.count === 1 ? 'file' : 'files'}…`, busy: true };
    void window.pulp
      .makeSampleMedia(offer.types)
      .then(async (outcome) => {
        // Cancelled at the folder question: nothing was asked for, so nothing is said.
        if (!outcome) {
          run.value = null;
          return;
        }
        if (outcome.failed.length > 0) console.warn(`Sample media: ${outcome.failed.length} file(s) could not be made: ${outcome.failed.join('; ')}`);
        run.value = { scope, text: sampleHintOutcome(outcome.written, outcome.failed.length), busy: false };
        actions.onIndex(outcome.index);
        await refreshSampleHint();
      })
      .catch((err: Error) => {
        run.value = { scope, text: `Could not make them: ${err.message}`, busy: false };
      });
  });

  void refreshSampleHint();
}
