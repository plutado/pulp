/** The browse panel's node list: Favorites, Recently used and one node per library
 * folder, until milestone 10 replaces it with the full tree. Renders from the shared
 * state; clicking a node sets the scope, clicking the active node clears it. */

import { render } from 'preact';
import { computed } from '@preact/signals';
import { browseScopes, sameScope, setScope, type Scope } from '../core/app-state';
import { appState, dispatch } from './store';
import { Icon, type IconName } from './icons';

const NODE_ICONS: Record<NonNullable<Scope['kind']>, IconName> = { favorites: 'star', recent: 'clock', 'built-in': 'package', folder: 'folder' };

const nodes = computed(() => browseScopes(appState.value.index));
const activeScope = computed(() => appState.value.scope);

function Node({ scope }: { scope: Scope }) {
  const active = sameScope(activeScope.value, scope);
  return (
    <li>
      <button
        type="button"
        class={active ? 'browse-node active' : 'browse-node'}
        aria-pressed={active}
        aria-label={scope.label}
        onClick={() => dispatch((s) => setScope(s, active ? null : scope))}
      >
        <Icon name={NODE_ICONS[scope.kind ?? 'folder']} />
        <span class="label">{scope.label}</span>
      </button>
    </li>
  );
}

function BrowseNodes() {
  return <>{nodes.value.map((scope) => <Node key={scope.root ?? scope.label} scope={scope} />)}</>;
}

export function mountBrowse(container: HTMLElement): void {
  render(<BrowseNodes />, container);
}
