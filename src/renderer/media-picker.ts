/**
 * Choosing something from the library (milestone 40): one picker, wherever
 * there is something to choose.
 *
 * The Parameters tab's picture well and its clip well each had a chooser of
 * their own — the same box, the same search field, the same list of thumbnails
 * and names, the same two empty lines, written twice and drifting: one sat its
 * search field in a head row and the other did not, one ranked nothing at all.
 * They are this, now, and so is the stage's Add Asset list, through the one
 * `searchMedia` in src/core/search.ts.
 *
 * What a chooser searches is therefore the library the way the search bar
 * searches it: the same query language, the same ranking.
 */

import { PICKER_LIMIT, searchPlaceable, type PlaceableItem } from '../core/search';
import { mediaUrlFor } from '../shared/api';
import { appState } from './store';

export interface MediaPickerOptions {
  /** Which kind of layer may be made here; a clip chooser takes Lotties too (milestone 35). */
  layers: readonly ('image' | 'video')[];
  /** What these are called, for the search box and the empty lines: "stills", "clips". */
  noun: string;
  /** What the chooser is for, for the search box's accessible name: "Logo". */
  label: string;
  /** What to say when the library holds none of them at all. */
  emptyLibrary: string;
  /** The id chosen now, so the list can mark it. */
  chosen: () => string | undefined;
  /** Chosen. The picker closes itself first, so this is free to rebuild the card around it. */
  onPick: (entry: PlaceableItem) => void;
  /** Anything else that belongs beside the search box (the stills chooser's File…). */
  head?: readonly HTMLElement[];
}

export interface MediaPicker {
  /** The element to put in the field; hidden until it is opened. */
  el: HTMLElement;
  open(): void;
  close(): void;
  /** Open it, or close it if it is open — what the well and the Choose button do. */
  toggle(): void;
  isOpen(): boolean;
}

export function mediaPicker(options: MediaPickerOptions): MediaPicker {
  const el = document.createElement('div');
  el.className = 'image-picker';
  el.hidden = true;

  const head = document.createElement('div');
  head.className = 'picker-head';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = `Search ${options.noun}`;
  search.setAttribute('aria-label', `Search ${options.noun} for ${options.label}`);
  head.append(search, ...(options.head ?? []));

  const choices = document.createElement('ul');
  choices.className = 'image-choices';
  el.append(head, choices);

  function list(): void {
    choices.replaceChildren();
    const found = searchPlaceable(appState.value.index, { layers: options.layers, query: search.value, limit: PICKER_LIMIT });
    if (found.length === 0) {
      const li = document.createElement('li');
      li.className = 'note';
      li.textContent = search.value.trim() ? `No ${options.noun} match.` : options.emptyLibrary;
      choices.append(li);
      return;
    }
    const chosen = options.chosen();
    for (const entry of found) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'image-choice';
      button.dataset.id = entry.id;
      button.setAttribute('aria-pressed', String(chosen === entry.id));
      const thumb = document.createElement('span');
      thumb.className = 'thumb checker';
      const img = document.createElement('img');
      img.alt = '';
      // A clip has no picture of its own to show, only the poster the library took of it:
      // a <video> here would decode a whole clip for one thumbnail. A Lottie's poster is
      // likewise drawn, so it is never the file.
      if (entry.thumbnail) img.src = entry.thumbnail;
      else if (entry.layer === 'image' && !entry.lottie) img.src = mediaUrlFor(entry.id);
      thumb.append(img);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.name;
      button.append(thumb, name);
      // The one word that says this is an animation rather than a clip from a file.
      if (entry.lottie) {
        const badge = document.createElement('span');
        badge.className = 'choice-badge';
        badge.textContent = 'Lottie';
        button.append(badge);
      }
      button.addEventListener('click', () => {
        close();
        options.onPick(entry);
      });
      li.append(button);
      choices.append(li);
    }
  }

  function open(): void {
    el.hidden = false;
    list();
    search.focus();
  }

  function close(): void {
    el.hidden = true;
  }

  search.addEventListener('input', list);
  return {
    el,
    open,
    close,
    toggle: () => (el.hidden ? open() : close()),
    isOpen: () => !el.hidden,
  };
}
