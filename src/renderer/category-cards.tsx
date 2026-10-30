/**
 * Category cards (milestone 34): with nothing searched, a category chosen in
 * the browse panel shows its subcategories as a row of cards above the items,
 * each with a representative picture and a count, so a picture explains what a
 * name might not; with nothing chosen, the categories themselves. Which cards,
 * and what picture, is pure (src/core/categories.ts); choosing one scopes the
 * results exactly as the tree row does.
 */

import { render } from 'preact';
import { computed } from '@preact/signals';
import { setScope } from '../core/app-state';
import { categoryCards } from '../core/categories';
import { browseFoldToActive } from './browse';
import { Icon, isIconName } from './icons';
import { appState, dispatch, facets, hasIndex } from './store';

/** Cards apply with nothing typed; a search is already an answer, and the cards would only push it down. */
const cards = computed(() => {
  if (!hasIndex.value || appState.value.query.trim() !== '') return null;
  return categoryCards(facets.value, appState.value.scope);
});

function Cards() {
  const list = cards.value;
  if (!list || list.length === 0) return null;
  return (
    <>
      {list.map((card) => (
        <button
          key={card.id}
          type="button"
          class="category-card"
          data-card={card.id}
          data-tip={card.description || undefined}
          aria-label={`${card.label}, ${card.count} ${card.count === 1 ? 'item' : 'items'}`}
          onClick={() => {
            dispatch((s) => setScope(s, card.scope));
            browseFoldToActive();
          }}
        >
          <span class="category-thumb">
            {card.sample?.thumbnail ? <img src={card.sample.thumbnail} alt="" /> : <Icon name={isIconName(card.icon) ? card.icon : 'shapes'} size={24} />}
          </span>
          <span class="category-name">{card.label}</span>
          <span class="category-count">{card.count}</span>
        </button>
      ))}
    </>
  );
}

export function mountCategoryCards(container: HTMLElement): void {
  render(<Cards />, container);
  // The container hides itself when there is nothing to show, so the results take the room back.
  const sync = () => {
    const list = cards.value;
    container.hidden = !list || list.length === 0;
  };
  cards.subscribe(sync);
}
