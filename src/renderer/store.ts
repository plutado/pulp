/**
 * The shared state as signals. All logic lives in src/core/app-state; this file holds the one
 * state signal and narrow computed views of it. Regions read the computed views, never
 * `appState.value` as a whole: a computed whose value is unchanged does not notify, so a
 * change to one part of the state (a queue update, say) leaves regions that do not depend
 * on it alone.
 */

import { computed, signal } from '@preact/signals';
import { createResultsSelector, initialAppState, type AppState } from '../core/app-state';

export const appState = signal<AppState>(initialAppState);

/** Apply a pure action from core/app-state; an action that returns the same object changes nothing. */
export function dispatch(action: (s: AppState) => AppState): void {
  appState.value = action(appState.value);
}

const selectResults = createResultsSelector();

/** Results: searched only when index, query or scope changed; the same object otherwise. */
export const results = computed(() => selectResults(appState.value));
export const hasIndex = computed(() => appState.value.index !== null);
export const selectedKey = computed(() => appState.value.selectedKey);

/** True while the Render button is blocked (no template, no ffmpeg, bad options); the tray's Prepare button follows it. */
export const renderBlocked = signal(true);
