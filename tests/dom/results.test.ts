// @vitest-environment happy-dom
/**
 * The first DOM-level component test. ADR 0009 defers these until a region needs
 * one, and the windowed results region is that region: its correctness is what
 * the DOM holds at a scroll position, which no pure test can see and the
 * end-to-end test can only sample. Every other region stays covered end to end.
 *
 * happy-dom does not lay anything out, so the viewport the browser would measure
 * is fixed here with the numbers the real stylesheet would produce.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initialAppState, setIndex, setQuery } from '../../src/core/app-state';
import type { LibraryIndex, MediaEntry } from '../../src/core/library-types';
import { cardHeight, LIST_ROW_HEIGHT, type ResultsViewState } from '../../src/core/results-view';
import { mountResults } from '../../src/renderer/results';
import { appState, resultsView } from '../../src/renderer/store';

const COUNT = 200;
const CARD_WIDTH = 160;
const COLUMNS = 4;
/** Four columns of 160 px cards, three rows of them visible. */
const WIDTH = CARD_WIDTH * COLUMNS;
const CARD_H = cardHeight(CARD_WIDTH);
const HEIGHT = CARD_H * 3;
/** The region's own default (src/core/virtual-list.ts): two rows beyond each edge. */
const OVERSCAN = 2;

const GRID: ResultsViewState = { mode: { visual: 'grid', audio: 'list' }, thumbSize: CARD_WIDTH };

function clip(i: number): MediaEntry {
  const name = `Clip ${String(i).padStart(3, '0')}`;
  return { kind: 'media', key: `clip-${i}`, id: `id-${i}`, path: `/lib/${name}.mov`, root: '/lib', name, mediaKind: 'video', ext: '.mov', size: 1024, mtimeMs: 0, tags: [] };
}

const index: LibraryIndex = { roots: ['/lib'], templates: [], media: Array.from({ length: COUNT }, (_, i) => clip(i)), problems: [], builtAt: '2026-10-23T00:00:00Z' };

let container: HTMLUListElement;

/** What a browser's layout would report; happy-dom has none, so it is declared. */
function fixSize(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
}

/** Preact renders on a microtask after a signal changes; let it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function scrollTo(top: number): Promise<void> {
  container.scrollTop = top;
  container.dispatchEvent(new Event('scroll'));
  await settle();
}

const rendered = () => [...container.querySelectorAll<HTMLElement>('li[data-id]')];
const names = () => rendered().map((li) => li.querySelector('.name')?.textContent);
const spacers = () => [...container.querySelectorAll<HTMLElement>('li.spacer')].map((li) => Number.parseFloat(li.style.height));

beforeAll(async () => {
  container = document.createElement('ul');
  container.id = 'results';
  fixSize(container, WIDTH, HEIGHT);
  document.body.append(container);
  appState.value = setIndex(initialAppState, index);
  resultsView.value = GRID;
  mountResults(container, { onSelect: () => undefined, onStop: () => undefined });
  await settle();
});

afterAll(() => {
  container.remove();
});

beforeEach(async () => {
  resultsView.value = GRID;
  await scrollTo(0);
});

describe('the windowed results region', () => {
  it('builds only the rows in view, plus the overscan', async () => {
    // Three rows visible, two more below as overscan: five rows of four.
    expect(rendered()).toHaveLength((3 + OVERSCAN) * COLUMNS);
    expect(names()[0]).toBe('Clip 000');
    expect(names().at(-1)).toBe('Clip 019');
    // Nothing above the first row, so there is no top spacer; the rest of the list is one below.
    expect(spacers()).toEqual([(COUNT / COLUMNS - 5) * CARD_H]);
    expect(container.querySelector('[data-id="id-120"]')).toBeNull();
  });

  it('moves the window with the scroll position and keeps the list its full height', async () => {
    await scrollTo(CARD_H * 10);
    // Rows 10 to 12 are in view; the overscan reaches 8 to 14, which is items 32 to 59.
    expect(names()[0]).toBe('Clip 032');
    expect(names().at(-1)).toBe('Clip 059');
    const [top, bottom] = spacers();
    expect(top).toBe(8 * CARD_H);
    // Spacers and rendered rows together always measure the whole list, so the scrollbar is honest.
    expect(top! + 7 * CARD_H + bottom!).toBe((COUNT / COLUMNS) * CARD_H);
    // What has scrolled away is gone from the DOM.
    expect(container.querySelector('[data-id="id-0"]')).toBeNull();
  });

  it('stops at the last item rather than at the column boundary', async () => {
    await scrollTo(1e6);
    expect(names().at(-1)).toBe(`Clip ${String(COUNT - 1).padStart(3, '0')}`);
    expect(spacers().at(-1)).not.toBe(0); // only a top spacer is left
    expect(spacers()).toHaveLength(1);
  });

  it('reuses the element of an item that stays in view, and builds one for an item that enters', async () => {
    await scrollTo(CARD_H * 10);
    const stays = container.querySelector('[data-id="id-40"]');
    expect(stays).not.toBeNull();
    expect(container.querySelector('[data-id="id-60"]')).toBeNull();

    await scrollTo(CARD_H * 11);
    // Keyed on the entry, so the item that stayed kept its element — and with it a loaded thumbnail.
    expect(container.querySelector('[data-id="id-40"]')).toBe(stays);
    expect(container.querySelector('[data-id="id-60"]')).not.toBeNull();
  });

  it('windows the list view by its own row height', async () => {
    resultsView.value = { ...GRID, mode: { visual: 'list', audio: 'list' } };
    await settle();
    expect(container.classList.contains('list')).toBe(true);
    // One item per row now: three rows of 44 px fit, plus the overscan below.
    const visibleRows = Math.ceil(HEIGHT / LIST_ROW_HEIGHT);
    expect(rendered()).toHaveLength(visibleRows + OVERSCAN);
    expect(spacers()).toEqual([(COUNT - visibleRows - OVERSCAN) * LIST_ROW_HEIGHT]);
    expect(rendered()[0]?.classList.contains('row')).toBe(true);
  });

  it('returns to the top when the search changes, and shows the empty message when nothing matches', async () => {
    await scrollTo(CARD_H * 10);
    appState.value = setQuery(appState.value, 'Clip 09');
    await settle();
    // The matches fit in one screen, and the view is back at the top rather than
    // where the longer list had been scrolled to.
    expect(container.scrollTop).toBe(0);
    expect(spacers()).toEqual([]);
    expect(names()).toHaveLength(12); // 090 to 099, plus 009 and 109
    for (const name of names()) expect(name).toMatch(/09/);

    appState.value = setQuery(appState.value, 'nothing matches this');
    await settle();
    expect(rendered()).toHaveLength(0);
    expect(container.textContent).toContain('No matches.');

    appState.value = setQuery(appState.value, '');
    await settle();
  });
});
