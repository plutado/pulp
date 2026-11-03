/**
 * Semantic search in the window (milestone 9): watches the search field, and —
 * while the setting is on and the model is there — asks the main process to
 * embed the free text and score the library, folding the answer into the
 * results through the state (src/core/app-state.ts), where the blend itself
 * is pure and tested. Debounced behind the keystroke: meaning is worth a
 * moment, letters are not allowed to wait for it.
 */

import { effect } from '@preact/signals';
import { setSemanticHits } from '../core/app-state';
import { SEMANTIC_MIN_QUERY } from '../core/semantic';
import { splitFreeText } from '../core/search';
import { appState, dispatch } from './store';

/** Letters settle before meaning is asked for; the word search never waits. */
const ASK_DELAY_MS = 250;

/** The setting as the window last heard it; the Settings dialog keeps it current. */
let enabled = false;
let ready = false;

export function semanticSetAvailable(on: boolean, modelReady: boolean): void {
  enabled = on;
  ready = modelReady;
  if (!on || !modelReady) dispatch((s) => setSemanticHits(s, null));
  else ask();
}

let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

function ask(): void {
  const asked = ++generation;
  clearTimeout(timer);
  const { text } = splitFreeText(appState.peek().query);
  if (!enabled || !ready || text.length < SEMANTIC_MIN_QUERY) {
    if (appState.peek().semantic !== null) dispatch((s) => setSemanticHits(s, null));
    return;
  }
  // The same text answered already: keep what stands rather than flickering the order.
  if (appState.peek().semantic?.text === text) return;
  timer = setTimeout(() => {
    void window.pulp.semanticSearch(text).then(({ hits }) => {
      if (asked !== generation) return;
      const { text: now } = splitFreeText(appState.peek().query);
      if (now !== text) return;
      dispatch((s) => setSemanticHits(s, hits.length > 0 ? { text, scores: new Map(hits.map((h) => [h.id, h.score])) } : null));
    });
  }, ASK_DELAY_MS);
}

export function initSemantic(): void {
  // What the setting and the model stand at, once at boot; Settings keeps it current after.
  void window.pulp.semanticStatus().then((status) => {
    semanticSetAvailable(status.enabled, status.runner.ok && status.model.installed);
  });
  let lastQuery: string | null = null;
  effect(() => {
    const query = appState.value.query;
    if (query === lastQuery) return;
    lastQuery = query;
    ask();
  });
}
