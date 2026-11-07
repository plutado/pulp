// @vitest-environment happy-dom
/**
 * The collection tray's status line, in the DOM (the known issue in docs/ideas.md).
 * The rules are pure (src/core/tray-note.ts, unit tested); what this covers is the
 * wiring: that the element really is written, really is cleared when the collection
 * moves under it, and that Apply to all is only offered when it can act.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addItem, emptyCollection, itemFor, removeItem } from '../../src/core/collection';
import { setCollection, setEditing, initialAppState } from '../../src/core/app-state';
import { NOTE_MS } from '../../src/core/tray-note';
import type { TemplateEntry } from '../../src/core/library-types';
import { validManifest } from '../fixtures';
import { initCollection, sayInTray } from '../../src/renderer/tray';
import { appState } from '../../src/renderer/store';

function template(key: string): TemplateEntry {
  return { kind: 'template', key, id: `id-${key}`, dir: `/lib/${key}`, root: '/lib', manifest: validManifest({ id: `t.${key}`, name: key }), tags: [], warnings: [] };
}

const MARKUP = `
  <div id="app" class="app"></div>
  <div id="say-strip" hidden><span id="say-strip-text"></span></div>
  <progress id="tray-progress"></progress>
  <button id="collection-render"></button>
  <button id="collection-apply"></button>
  <button id="collection-open"></button>
  <button id="collection-save"></button>
  <ul id="collection"></ul>
  <p id="collection-note" class="note"></p>
`;

const note = () => document.getElementById('collection-note')!;
const apply = () => document.getElementById('collection-apply') as HTMLButtonElement;
/** The tray's own `say`, reached the way the app reaches it: through an action that reports. */
const applyToAllClick = () => apply().click();

describe('the collection tray\'s status line', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = MARKUP;
    appState.value = initialAppState;
    initCollection();
  });
  afterEach(() => {
    vi.useRealTimers();
    appState.value = initialAppState;
  });

  const collect = (...keys: string[]) => {
    let c = emptyCollection;
    for (const key of keys) c = addItem(c, itemFor(template(key), 'png-sequence'));
    appState.value = setCollection(appState.value, c);
    return c;
  };

  it('offers Apply to all only with something to apply it to', () => {
    collect('a');
    appState.value = setEditing(appState.value, appState.value.collection.items[0]!.uid);
    expect(apply().disabled, 'one item has nothing to apply to').toBe(true);
    collect('a', 'b');
    appState.value = setEditing(appState.value, appState.value.collection.items[0]!.uid);
    expect(apply().disabled).toBe(false);
    // Nothing being edited: there are no settings to copy from.
    appState.value = setEditing(appState.value, null);
    expect(apply().disabled).toBe(true);
  });

  it('confirms an action, then fades on its own', () => {
    collect('a', 'b');
    appState.value = setEditing(appState.value, appState.value.collection.items[0]!.uid);
    applyToAllClick();
    expect(note().textContent).toBe('Every item now has those output settings.');
    vi.advanceTimersByTime(NOTE_MS - 1);
    expect(note().textContent, 'still there a moment before').not.toBe('');
    vi.advanceTimersByTime(2);
    expect(note().textContent, 'and gone after').toBe('');
  });

  it('drops the confirmation the moment the collection changes', () => {
    collect('a', 'b');
    appState.value = setEditing(appState.value, appState.value.collection.items[0]!.uid);
    applyToAllClick();
    expect(note().textContent).not.toBe('');
    // A third item: the message described a collection that no longer exists.
    collect('a', 'b', 'c');
    expect(note().textContent).toBe('');
  });

  it('says nothing at all once the collection is empty', () => {
    collect('a', 'b');
    appState.value = setEditing(appState.value, appState.value.collection.items[0]!.uid);
    applyToAllClick();
    expect(note().textContent).not.toBe('');
    const uid = appState.value.collection.items[0]!.uid;
    appState.value = setCollection(appState.value, removeItem(appState.value.collection, uid));
    expect(note().textContent, 'one left, and the message is stale').toBe('');
    appState.value = setCollection(appState.value, emptyCollection);
    expect(note().textContent, 'nothing collected: only the summary speaks').toBe('');
  });
});

/**
 * The same line while it is not in the window (the tray away, or collapsed to its head): the
 * message shows in a strip over the window instead, with the line's own manners.
 */
describe('a message said while the tray\'s line is not in the window', () => {
  const strip = () => document.getElementById('say-strip')!;
  const app = () => document.getElementById('app')!;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = MARKUP;
    appState.value = initialAppState;
    initCollection();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows over the window only while the line is away, and says the same words', () => {
    sayInTray('Saved.');
    expect(strip().hidden, 'the line is in the window: no second copy').toBe(true);
    app().classList.add('tray-empty');
    sayInTray('Recorded 0:02 into Recordings.');
    expect(strip().hidden).toBe(false);
    expect(strip().textContent).toContain('Recorded 0:02 into Recordings.');
    expect(strip().classList.contains('error')).toBe(false);
  });

  it('fades a confirmation, keeps an error, and covers the collapsed tray too', () => {
    app().classList.add('tray-collapsed');
    sayInTray('Done.');
    vi.advanceTimersByTime(6100);
    expect(strip().hidden, 'a confirmation gets out of the way').toBe(true);
    sayInTray('The recording could not be saved: disk full', true);
    expect(strip().classList.contains('error')).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(strip().hidden, 'an error waits to be read').toBe(false);
  });

  it('goes the moment the tray\'s own line is back to carry the message', () => {
    app().classList.add('tray-empty');
    sayInTray('The recording could not be saved: disk full', true);
    expect(strip().hidden).toBe(false);
    app().classList.remove('tray-empty');
    vi.advanceTimersByTime(600);
    expect(strip().hidden).toBe(true);
  });
});
