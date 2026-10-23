/** The shared state as signals. All logic lives in src/core/app-state; this file only holds the signal. */

import { computed, signal } from '@preact/signals';
import { deriveResults, initialAppState, type AppState } from '../core/app-state';

export const appState = signal<AppState>(initialAppState);

/** Apply a pure action from core/app-state; an action that returns the same object changes nothing. */
export function dispatch(action: (s: AppState) => AppState): void {
  appState.value = action(appState.value);
}

export const results = computed(() => deriveResults(appState.value));
