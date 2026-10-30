/**
 * The browse panel's top level (milestone 34): plain categories that say what
 * you get — Lower thirds, Titles and openers, Animated backgrounds, Overlays
 * and frames, Music — in the order a stock library would show them, rather
 * than the taxonomy's own groups, which a person had to learn before they
 * could find anything. The 66 types underneath stay exactly as they are
 * (src/core/taxonomy.ts); a category is a named set of them, and its scope is
 * those types as alternatives, so saved searches and settings keep working.
 *
 * Themes and styles leave the tree here: they narrow a category as the "For…"
 * and "Look" chips in the search bar rather than being trees of their own, so
 * browsing is one path (Lower thirds › For: Wedding › Look: Elegant). Pure.
 */

import type { Scope } from './app-state';
import { styleLabel, themeLabel, typeLabel } from './display';
import type { LibraryEntry } from './library-types';
import { entryType, isBuiltInTheme, STYLES, THEME_GROUPS, TYPES, themeGroupOf } from './taxonomy';

export interface BrowseCategory {
  /** Permanent, like a taxonomy id: a tree node is "category:<id>" and a scope carries it as its group. */
  id: string;
  label: string;
  /** One line on what the category holds, shown under its heading and on hover. */
  description: string;
  /** The icon that stands for it (a Phosphor name the renderer knows). */
  icon: string;
  /** The taxonomy types it gathers; empty for Matching sets, which gathers packs instead. */
  types: readonly string[];
}

export const BROWSE_CATEGORIES: readonly BrowseCategory[] = [
  { id: 'lower-thirds', label: 'Lower thirds', description: 'Name and title bars that sit at the bottom of the frame.', icon: 'subtitles', types: ['lower-third'] },
  { id: 'titles-openers', label: 'Titles and openers', description: 'Title cards, openers, captions, logo reveals and social call-outs.', icon: 'text-t', types: ['title', 'opener', 'callout', 'social', 'logo-reveal'] },
  { id: 'end-cards', label: 'End cards', description: 'Closing cards and credits to end a video on.', icon: 'film-slate', types: ['end-card'] },
  { id: 'matching-sets', label: 'Matching sets', description: 'Templates designed together — an opener, a lower third, a bug and more in one look.', icon: 'package', types: [] },
  { id: 'animated-backgrounds', label: 'Animated backgrounds', description: 'Moving loops to sit behind titles and graphics.', icon: 'film-reel', types: ['animated-loop'] },
  { id: 'still-backgrounds', label: 'Still backgrounds', description: 'Gradients, textures and patterns that hold still.', icon: 'image-square', types: ['still-background', 'texture'] },
  { id: 'overlays-frames', label: 'Overlays and frames', description: 'Light, grain, borders, bugs and vignettes laid over the whole picture.', icon: 'stack', types: ['overlay', 'frame', 'light-particles', 'film-grunge', 'logo-bug', 'vignette'] },
  { id: 'transitions-wipes', label: 'Transitions and wipes', description: 'Wipes, reveals, flashes and glitches that take one shot to the next.', icon: 'arrows-left-right', types: ['wipe', 'reveal', 'flash', 'glitch'] },
  { id: 'design-elements', label: 'Design elements', description: 'Shapes, icons, arrows, charts, counters and countdowns.', icon: 'shapes', types: ['shapes', 'icons', 'arrows', 'infographic', 'counter', 'countdown'] },
  { id: 'effects', label: 'Effects', description: 'Fire, smoke, sparks, splashes and confetti on transparency, placed on a frame.', icon: 'fire', types: ['fire', 'smoke', 'sparks', 'explosion-asset', 'energy', 'light-asset', 'weather-asset', 'liquid', 'confetti', 'brush'] },
  { id: 'objects', label: 'Objects', description: 'Props on transparency, by what they are for: sports, celebrations, business, nature and more.', icon: 'cube', types: ['sports-objects', 'celebration-objects', 'holiday-objects', 'business-objects', 'science-objects', 'media-objects', 'nature-objects', 'travel-objects', 'home-objects', 'community-objects'] },
  { id: 'stock-video', label: 'Stock video', description: 'Footage and B-roll clips.', icon: 'film-strip', types: ['stock-footage'] },
  { id: 'photos-stills', label: 'Photos and stills', description: 'Photographs, illustrations and layered graphics.', icon: 'image', types: ['photo', 'illustration', 'layered-graphic'] },
  { id: 'music', label: 'Music', description: 'Full mixes, stems and stings.', icon: 'music-notes', types: ['full-mix', 'stems', 'sting'] },
  { id: 'sound-effects', label: 'Sound effects', description: 'Hits, whooshes, ambiences, alarms and every other sound a cut needs.', icon: 'speaker-high', types: ['ambience', 'impact', 'whoosh', 'ui-tech', 'alarm', 'nature-weather', 'animals', 'vehicles', 'crowd', 'foley', 'explosion', 'sci-fi', 'musical-phrase'] },
];

/** The id of a tree node for a category, "category:lower-thirds". */
export const MATCHING_SETS = 'matching-sets';

const categoryById = new Map(BROWSE_CATEGORIES.map((c) => [c.id, c]));
const categoryByType = new Map(BROWSE_CATEGORIES.flatMap((c) => c.types.map((t) => [t, c] as const)));

export function categoryInfo(id: string): BrowseCategory | undefined {
  return categoryById.get(id);
}

/** The category a taxonomy type is shown under, or undefined for an id the taxonomy does not have. */
export function categoryOfType(typeId: string): BrowseCategory | undefined {
  return categoryByType.get(typeId);
}

/** The category an entry sits in, from its type; untyped entries sit in none. */
export function categoryOfEntry(entry: LibraryEntry): BrowseCategory | undefined {
  const type = entryType(entry);
  return type ? categoryByType.get(type) : undefined;
}

/**
 * A category's scope: its types as alternatives (`type:a type:b`), which the
 * search already reads that way. A category of one type scopes exactly as the
 * type does, so it is the same place with the plainer name.
 */
export function categoryScope(category: BrowseCategory): Scope | null {
  if (category.types.length === 0) return null;
  return { label: category.label, filter: category.types.map((t) => `type:${t}`).join(' '), kind: 'category', group: category.id };
}

/** A type's scope, carrying its category so the icon and the description can be found from it. */
export function typeScope(typeId: string): Scope {
  const category = categoryByType.get(typeId);
  return { label: typeLabel(typeId), filter: `type:${typeId}`, kind: 'type', ...(category ? { group: category.id } : {}) };
}

/** The category a scope is in, if it is a category's own or one of its types'. */
export function scopeCategory(scope: Scope | null): BrowseCategory | undefined {
  if (!scope || !scope.group) return undefined;
  if (scope.kind === 'category' || scope.kind === 'type') return categoryById.get(scope.group);
  return undefined;
}

// ---------------------------------------------------------------- category cards

export interface CategoryCard {
  id: string;
  label: string;
  description: string;
  count: number;
  scope: Scope;
  /** An entry whose picture stands for the card; null when nothing here has one yet. */
  sample: LibraryEntry | null;
  icon: string;
}

/** The entry whose picture best stands for a set: one with a thumbnail, a template before a clip. */
function representative(entries: readonly LibraryEntry[]): LibraryEntry | null {
  const pictured = entries.filter((e) => e.thumbnail && !e.offline);
  return pictured.find((e) => e.kind === 'template') ?? pictured[0] ?? null;
}

/**
 * The cards the results show when a category is chosen with nothing searched:
 * its subcategories, each with a picture and a count, so a picture explains
 * what a name might not. With nothing chosen, the categories themselves. An
 * empty set is left out — a card for nothing explains nothing. Null when the
 * scope is somewhere cards do not apply (a folder, Favorites, a single type).
 */
export function categoryCards(entries: readonly LibraryEntry[], scope: Scope | null): CategoryCard[] | null {
  if (scope === null) {
    return BROWSE_CATEGORIES.flatMap((category) => {
      const own = category.types.length > 0 ? entries.filter((e) => categoryOfEntry(e)?.id === category.id) : entries.filter((e) => e.kind === 'template' && e.pack);
      const cardScope = categoryScope(category);
      if (own.length === 0 || !cardScope) return [];
      return [{ id: `category:${category.id}`, label: category.label, description: category.description, count: own.length, scope: cardScope, sample: representative(own), icon: category.icon }];
    });
  }
  if (scope.kind !== 'category' || !scope.group) return null;
  const category = categoryById.get(scope.group);
  if (!category || category.types.length < 2) return null;
  return category.types.flatMap((type) => {
    const own = entries.filter((e) => entryType(e) === type);
    if (own.length === 0) return [];
    return [{ id: `type:${type}`, label: typeLabel(type), description: '', count: own.length, scope: typeScope(type), sample: representative(own), icon: category.icon }];
  });
}

// ---------------------------------------------------------------- For… and Look

export interface ChipOption {
  id: string;
  label: string;
  count: number;
}

export interface ChipOptionGroup {
  label: string;
  options: ChipOption[];
}

/**
 * What the "For…" chip offers: the themes the entries carry, in their groups,
 * with counts. A group's own theme ("sports") leads its group. Custom themes
 * come last under their own heading. A theme nothing carries is left out,
 * except the one already chosen, which must stay choosable to be cleared.
 */
export function forOptions(entries: readonly LibraryEntry[], chosen: string | null = null): ChipOptionGroup[] {
  const byTheme = new Map<string, number>();
  for (const entry of entries) for (const theme of entry.themes ?? []) byTheme.set(theme, (byTheme.get(theme) ?? 0) + 1);
  const count = (id: string) => byTheme.get(id) ?? 0;
  const keep = (id: string) => count(id) > 0 || id === chosen;
  const groups: ChipOptionGroup[] = THEME_GROUPS.map((g) => ({
    label: g.label,
    options: g.themes.filter((t) => keep(t.id)).map((t) => ({ id: t.id, label: themeLabel(t.id), count: count(t.id) })),
  })).filter((g) => g.options.length > 0);
  const custom = [...byTheme.keys()].filter((t) => !isBuiltInTheme(t) && themeGroupOf(t) === undefined).sort((a, b) => a.localeCompare(b));
  if (chosen && !isBuiltInTheme(chosen) && !custom.includes(chosen)) custom.push(chosen);
  if (custom.length > 0) groups.push({ label: 'Custom', options: custom.map((t) => ({ id: t, label: themeLabel(t), count: count(t) })) });
  return groups;
}

/** What the "Look" chip offers: the styles the templates declare, with counts; the chosen one stays. */
export function lookOptions(entries: readonly LibraryEntry[], chosen: string | null = null): ChipOption[] {
  const byStyle = new Map<string, number>();
  for (const entry of entries) if (entry.kind === 'template') for (const style of entry.manifest.styles ?? []) byStyle.set(style, (byStyle.get(style) ?? 0) + 1);
  return STYLES.filter((s) => (byStyle.get(s.id) ?? 0) > 0 || s.id === chosen).map((s) => ({ id: s.id, label: styleLabel(s.id), count: byStyle.get(s.id) ?? 0 }));
}

/** Every taxonomy type has exactly one category; the test holds this, and the tree relies on it. */
export function uncategorizedTypes(): string[] {
  return TYPES.map((t) => t.id).filter((id) => !categoryByType.has(id));
}
