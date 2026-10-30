/**
 * The shared state as signals. All logic lives in src/core/app-state; this file holds the one
 * state signal and narrow computed views of it. Regions read the computed views, never
 * `appState.value` as a whole: a computed whose value is unchanged does not notify, so a
 * change to one part of the state (a queue update, say) leaves regions that do not depend
 * on it alone.
 */

import { computed, signal } from '@preact/signals';
import { createFacetSelector, createResultsSelector, createTreeSelector, initialAppState, type AppState } from '../core/app-state';
import type { Size } from '../core/aspect';
import type { TemplateEntry } from '../core/library-types';
import { DEFAULT_RESULTS_VIEW, type ResultsViewState } from '../core/results-view';
import type { ImportedFont } from '../core/fonts';

export const appState = signal<AppState>(initialAppState);

/** Apply a pure action from core/app-state; an action that returns the same object changes nothing. */
export function dispatch(action: (s: AppState) => AppState): void {
  appState.value = action(appState.value);
}

const selectResults = createResultsSelector();

/** Results: searched only when index, query or scope changed; the same object otherwise. */
export const results = computed(() => selectResults(appState.value));
export const hasIndex = computed(() => appState.value.index !== null);

const selectTree = createTreeSelector();
/** The browse tree with counts: rebuilt only when the index, query or chips change. */
export const browseTree = computed(() => selectTree(appState.value));
const selectFacets = createFacetSelector();
/** The entries the typed query and the chips leave, the scope not: what the tree, the For… and Look chips and the category cards count (milestone 34). */
export const facets = computed(() => selectFacets(appState.value));
export const selectedKey = computed(() => appState.value.selectedKey);

/**
 * Grid or list per kind and the thumbnail size (src/core/results-view.ts). Kept
 * apart from the app state: it is a preference the search bar owns and
 * settings.json stores, not something a library change can alter.
 */
export const resultsView = signal<ResultsViewState>(DEFAULT_RESULTS_VIEW);

/** The person's own fonts, as the managed folder has them (milestone 23); the family control lists them and the window declares their faces. */
export const importedFonts = signal<ImportedFont[]>([]);

/**
 * The render's in and out points, in frames of the selected template's timeline.
 * Shared because two regions own the same fact: the Output tab's trim fields set
 * it, and the stage marks it on the scrub bar and sets it from the playhead.
 * Null is an open end — the template's own first or last frame.
 */
export const trim = signal<{ inFrame: number | null; outFrame: number | null }>({ inFrame: null, outFrame: null });

/** True while the Render button is blocked (no template, no ffmpeg, bad options); the tray's Prepare button follows it. */
export const renderBlocked = signal(true);

/**
 * What the stage's transport can do, for anyone outside the stage who has to
 * follow it — the application menu's Playback items (milestone 27). The stage
 * owns these facts and publishes them here as it owns `renderBlocked`: a
 * preview becoming ready changes no other state, so without this nothing else
 * would know it had.
 */
export const transport = signal<{ canPlay: boolean; playing: boolean; loop: boolean }>({ canPlay: false, playing: false, loop: true });

/** The selected template (media items are shown, not selected); regions read this instead of each other. */
export const selectedTemplate = signal<TemplateEntry | null>(null);

/**
 * The frame size the Output tab has chosen for the selected template (aspect and
 * resolution), which the stage previews at. Null until a template is shown; the
 * template's default size then (milestone 19).
 */
export const frameSize = signal<Size | null>(null);

/** Image slots of the selected template whose chosen image is not in the library or is offline: slot label and what is wrong (milestone 22). */
export const slotNotes = signal<{ label: string; note: string }[]>([]);

/**
 * The shape the session leans to (milestone 31): the start screen's "New 9:16
 * project" makes every template open at that shape until it is changed by
 * hand. Only a lean — a template that does not draw the shape keeps its own
 * default, and the Output tab's field stays free to choose.
 */
export const preferredAspect = signal<string | null>(null);
