/**
 * The built-in taxonomy: what an item IS (type, one per item, grouped on two
 * levels), what it is ABOUT (themes, zero or more) and how it LOOKS (styles,
 * zero or more). ADR 0010 records the three axes and the extension rule:
 * the type and style lists are fixed per app version; themes are open — any
 * normalized word that is not built in is a custom theme, stored like a tag,
 * so nobody waits for a release. Pure; no DOM, no Electron, no Node.
 */

import { normalizeTag } from './tags';

/** Bumped when the built-in lists change, so stored data can say what it was written against. */
/**
 * 2: logo-reveal added to Titles and text (milestone 22).
 * 3: the Assets group and its Effects categories (milestone 26) — isolated elements on
 *    transparency, placed on a frame, as distinct from Overlays, which cover the whole frame.
 * 4: the Assets group's Objects categories (milestone 26) — themed props, each tagged with the
 *    themes it fits, so every theme has assets of its own.
 * Ids are permanent; the list only grows (ADR 0010).
 */
export const TAXONOMY_VERSION = 4;

export interface TypeGroup {
  id: string;
  label: string;
}

export interface TaxonomyType {
  id: string;
  label: string;
  group: string;
}

export const TYPE_GROUPS: readonly TypeGroup[] = [
  { id: 'titles', label: 'Titles and text' },
  { id: 'backgrounds', label: 'Backgrounds' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'elements', label: 'Design elements' },
  { id: 'video', label: 'Video clips' },
  { id: 'stills', label: 'Stills' },
  { id: 'music', label: 'Music' },
  { id: 'sfx', label: 'Sound effects' },
  { id: 'assets', label: 'Assets' },
] as const;

export const TYPES: readonly TaxonomyType[] = [
  { id: 'lower-third', label: 'Lower third', group: 'titles' },
  { id: 'title', label: 'Title', group: 'titles' },
  { id: 'opener', label: 'Opener', group: 'titles' },
  { id: 'end-card', label: 'End card / credits', group: 'titles' },
  { id: 'callout', label: 'Callout / caption', group: 'titles' },
  { id: 'social', label: 'Social / subscribe', group: 'titles' },
  { id: 'logo-reveal', label: 'Logo reveal', group: 'titles' },
  { id: 'animated-loop', label: 'Animated loop', group: 'backgrounds' },
  { id: 'still-background', label: 'Still background', group: 'backgrounds' },
  { id: 'texture', label: 'Texture / pattern', group: 'backgrounds' },
  { id: 'wipe', label: 'Wipe', group: 'transitions' },
  { id: 'reveal', label: 'Reveal / matte', group: 'transitions' },
  { id: 'flash', label: 'Flash / light', group: 'transitions' },
  { id: 'glitch', label: 'Glitch', group: 'transitions' },
  { id: 'overlay', label: 'Overlay', group: 'overlays' },
  { id: 'frame', label: 'Frame / border', group: 'overlays' },
  { id: 'light-particles', label: 'Light and particles', group: 'overlays' },
  { id: 'film-grunge', label: 'Film / grunge', group: 'overlays' },
  { id: 'logo-bug', label: 'Logo bug / corner', group: 'overlays' },
  { id: 'vignette', label: 'Vignette', group: 'overlays' },
  { id: 'shapes', label: 'Shapes and accents', group: 'elements' },
  { id: 'icons', label: 'Icons', group: 'elements' },
  { id: 'arrows', label: 'Arrows and pointers', group: 'elements' },
  { id: 'infographic', label: 'Infographic and charts', group: 'elements' },
  { id: 'counter', label: 'Counter / timer', group: 'elements' },
  { id: 'countdown', label: 'Countdown leader', group: 'elements' },
  { id: 'stock-footage', label: 'Stock footage', group: 'video' },
  { id: 'photo', label: 'Photo', group: 'stills' },
  { id: 'illustration', label: 'Illustration', group: 'stills' },
  { id: 'layered-graphic', label: 'Layered graphic', group: 'stills' },
  { id: 'full-mix', label: 'Full mix', group: 'music' },
  { id: 'stems', label: 'Stems / layers', group: 'music' },
  { id: 'sting', label: 'Sting', group: 'music' },
  { id: 'ambience', label: 'Ambience', group: 'sfx' },
  { id: 'impact', label: 'Impact / hit', group: 'sfx' },
  { id: 'whoosh', label: 'Whoosh / transition', group: 'sfx' },
  { id: 'ui-tech', label: 'UI / tech', group: 'sfx' },
  { id: 'alarm', label: 'Alarm / beep', group: 'sfx' },
  { id: 'nature-weather', label: 'Nature / weather', group: 'sfx' },
  { id: 'animals', label: 'Animals', group: 'sfx' },
  { id: 'vehicles', label: 'Vehicles', group: 'sfx' },
  { id: 'crowd', label: 'Crowd / human', group: 'sfx' },
  { id: 'foley', label: 'Foley / household', group: 'sfx' },
  { id: 'explosion', label: 'Explosion / weapons', group: 'sfx' },
  { id: 'sci-fi', label: 'Sci-fi', group: 'sfx' },
  { id: 'musical-phrase', label: 'Musical phrase', group: 'sfx' },
  // Assets (milestone 26): isolated elements on transparency, dropped onto a frame. Effects
  // first -- generic, tagged with whatever themes fit; the themed Objects follow.
  { id: 'fire', label: 'Fire and flames', group: 'assets' },
  { id: 'smoke', label: 'Smoke and steam', group: 'assets' },
  { id: 'sparks', label: 'Sparks and embers', group: 'assets' },
  { id: 'explosion-asset', label: 'Explosions and impacts', group: 'assets' },
  { id: 'energy', label: 'Energy and magic', group: 'assets' },
  { id: 'light-asset', label: 'Light and flares', group: 'assets' },
  { id: 'weather-asset', label: 'Weather effects', group: 'assets' },
  { id: 'liquid', label: 'Liquids and splashes', group: 'assets' },
  { id: 'confetti', label: 'Confetti and celebration', group: 'assets' },
  { id: 'brush', label: 'Brush and ink strokes', group: 'assets' },
  // The Objects kind: themed props, organised along the theme groups. A label is a plain noun
  // phrase on purpose — "Business objects", not "Business and work" — because every part of a
  // label split on "and" becomes a folder alias for the type (see `aliases`), and a person's
  // "Business" or "Travel" folder of stills must not be read as a folder of assets. Each
  // category covers more than its name says: Science takes in health and technology, Media
  // takes in entertainment, Nature the ocean and space, Travel the city, Home the kitchen, and
  // Community education, faith, charity and civic life; the theme subfolders say which.
  { id: 'sports-objects', label: 'Sports equipment', group: 'assets' },
  { id: 'celebration-objects', label: 'Celebration objects', group: 'assets' },
  { id: 'holiday-objects', label: 'Holiday objects', group: 'assets' },
  { id: 'business-objects', label: 'Business objects', group: 'assets' },
  { id: 'science-objects', label: 'Science objects', group: 'assets' },
  { id: 'media-objects', label: 'Media objects', group: 'assets' },
  { id: 'nature-objects', label: 'Nature objects', group: 'assets' },
  { id: 'travel-objects', label: 'Travel objects', group: 'assets' },
  { id: 'home-objects', label: 'Home objects', group: 'assets' },
  { id: 'community-objects', label: 'Community objects', group: 'assets' },
] as const;

export interface ThemeGroup {
  id: string;
  label: string;
  /**
   * The theme that means the group itself, where the vocabulary has one
   * ("sports", "holiday"). It is a theme like any other — items carry it, search
   * matches it — but it belongs to the group's own node, not under it: a child
   * must never repeat its parent (ADR 0010, docs/ui-style.md).
   */
  general?: string;
  themes: readonly { id: string; label: string }[];
}

export const THEME_GROUPS: readonly ThemeGroup[] = [
  {
    id: 'business',
    label: 'Business',
    themes: [
      { id: 'corporate', label: 'Corporate' },
      { id: 'finance', label: 'Finance' },
      { id: 'real-estate', label: 'Real estate' },
      { id: 'technology', label: 'Technology' },
      { id: 'medical', label: 'Medical / health' },
      { id: 'science', label: 'Science' },
      { id: 'legal', label: 'Legal' },
    ],
  },
  {
    id: 'media',
    label: 'Media',
    themes: [
      { id: 'news', label: 'News / broadcast' },
      { id: 'documentary', label: 'Documentary' },
      { id: 'podcast', label: 'Podcast / interview' },
      { id: 'social-media', label: 'Social media' },
      { id: 'gaming', label: 'Gaming / esports' },
    ],
  },
  {
    id: 'sports',
    label: 'Sports',
    general: 'sports',
    themes: [
      { id: 'sports', label: 'Sports' },
      { id: 'football', label: 'Football' },
      { id: 'basketball', label: 'Basketball' },
      { id: 'baseball', label: 'Baseball' },
      { id: 'soccer', label: 'Soccer' },
      { id: 'hockey', label: 'Hockey' },
      { id: 'golf', label: 'Golf' },
      { id: 'tennis', label: 'Tennis' },
      { id: 'motorsport', label: 'Motorsport' },
      { id: 'fitness', label: 'Fitness' },
    ],
  },
  {
    id: 'life-events',
    label: 'Life events',
    themes: [
      { id: 'wedding', label: 'Wedding' },
      { id: 'birthday', label: 'Birthday' },
      { id: 'graduation', label: 'Graduation' },
      { id: 'family', label: 'Baby / family' },
      { id: 'memorial', label: 'Memorial' },
    ],
  },
  {
    id: 'holidays',
    label: 'Holidays and seasons',
    general: 'holiday',
    themes: [
      { id: 'holiday', label: 'Holiday' },
      { id: 'christmas', label: 'Christmas / winter holidays' },
      { id: 'new-year', label: 'New Year' },
      { id: 'valentines', label: "Valentine's Day" },
      { id: 'easter', label: 'Easter / spring' },
      { id: 'halloween', label: 'Halloween / autumn' },
      { id: 'thanksgiving', label: 'Thanksgiving' },
      { id: 'summer', label: 'Summer' },
      { id: 'patriotic', label: 'National holidays / patriotic' },
    ],
  },
  {
    id: 'community',
    label: 'Community',
    themes: [
      { id: 'faith', label: 'Faith / worship' },
      { id: 'education', label: 'Education / school' },
      { id: 'nonprofit', label: 'Nonprofit / charity' },
      { id: 'civic', label: 'Government / civic' },
    ],
  },
  {
    id: 'world-nature',
    label: 'World and nature',
    themes: [
      { id: 'travel', label: 'Travel / world' },
      { id: 'nature', label: 'Nature' },
      { id: 'ocean', label: 'Ocean' },
      { id: 'space', label: 'Space' },
      { id: 'weather', label: 'Weather' },
      { id: 'city', label: 'City / urban' },
    ],
  },
  {
    id: 'entertainment',
    label: 'Entertainment',
    themes: [
      { id: 'concert', label: 'Music / concert' },
      { id: 'cinema', label: 'Film / cinema' },
      { id: 'kids', label: 'Kids' },
      { id: 'food', label: 'Food / cooking' },
      { id: 'fashion', label: 'Fashion / beauty' },
    ],
  },
] as const;

export const STYLES: readonly { id: string; label: string }[] = [
  { id: 'clean', label: 'Clean / minimal' },
  { id: 'corporate', label: 'Corporate' },
  { id: 'elegant', label: 'Elegant' },
  { id: 'high-energy', label: 'High-energy' },
  { id: 'grunge', label: 'Grunge' },
  { id: 'retro', label: 'Retro / vintage' },
  { id: 'tech', label: 'Tech / digital' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'playful', label: 'Playful / cartoon' },
  { id: 'hand-drawn', label: 'Hand-drawn' },
  { id: 'organic', label: 'Organic / soft' },
] as const;

const typeById = new Map(TYPES.map((t) => [t.id, t]));
const themeIds = new Set(THEME_GROUPS.flatMap((g) => g.themes.map((t) => t.id)));
const styleIds = new Set(STYLES.map((s) => s.id));

export function isBuiltInType(id: string): boolean {
  return typeById.has(id);
}

export function typeInfo(id: string): TaxonomyType | undefined {
  return typeById.get(id);
}

const themeGroupById = new Map(THEME_GROUPS.map((g) => [g.id, g]));
const groupByTheme = new Map(THEME_GROUPS.flatMap((g) => g.themes.map((t) => [t.id, g.id] as const)));

/** The themes shown under a group: all of them but the one that means the group itself. */
export function groupChildThemes(group: ThemeGroup): readonly { id: string; label: string }[] {
  return group.general === undefined ? group.themes : group.themes.filter((t) => t.id !== group.general);
}

/** Which theme group a theme belongs to, or undefined for a custom one. */
export function themeGroupOf(themeId: string): string | undefined {
  return groupByTheme.get(themeId);
}

export function isThemeGroup(id: string): boolean {
  return themeGroupById.has(id);
}

/**
 * Every theme a group's node covers: the one that means the group itself and all
 * its children. Selecting Sports finds generally-sporting items and the football
 * ones alike.
 */
export function themesInGroup(groupId: string): string[] {
  return themeGroupById.get(groupId)?.themes.map((t) => t.id) ?? [];
}

export function isBuiltInTheme(id: string): boolean {
  return themeIds.has(id);
}

export function isBuiltInStyle(id: string): boolean {
  return styleIds.has(id);
}

/** Themes are open: user input becomes a normalized id; built-in or not, it is valid. */
export function normalizeTheme(value: string): string {
  return normalizeTag(value);
}

/** Splits a theme list for display: built-ins sort into their groups, the rest go to the custom group. */
export function splitThemes(themes: readonly string[]): { builtIn: string[]; custom: string[] } {
  const builtIn: string[] = [];
  const custom: string[] = [];
  for (const theme of themes) (themeIds.has(theme) ? builtIn : custom).push(theme);
  return { builtIn, custom };
}

/**
 * Folder words that mean an id: the id, the label, each part of the label split on "/"
 * and " and ", and the singular and plural forms of all of those ("icons" and "icon",
 * "whoosh" and "whooshes").
 */
function aliases(id: string, label: string): string[] {
  const parts = label.split(/\s*\/\s*|\s+and\s+/).map((p) => normalizeTag(p)).filter(Boolean);
  const base = [...new Set([id, normalizeTag(label), ...parts])];
  const forms = base.flatMap((a) => [a, `${a}s`, `${a}es`, ...(a.endsWith('s') ? [a.slice(0, -1)] : [])]);
  return [...new Set(forms)];
}

/** Folder words editors use that the labels do not say. */
const TYPE_SYNONYMS: Record<string, string> = {
  'light-leaks': 'light-particles',
  'light-leak': 'light-particles',
  leaks: 'light-particles',
  'lens-flares': 'light-particles',
  'lens-flare': 'light-particles',
  flares: 'light-particles',
  bokeh: 'light-particles',
  loop: 'animated-loop',
  loops: 'animated-loop',
  looping: 'animated-loop',
  'motion-backgrounds': 'animated-loop',
  'motion-background': 'animated-loop',
  'b-roll': 'stock-footage',
  footage: 'stock-footage',
  stinger: 'sting',
  stingers: 'sting',
  'lower-thirds': 'lower-third',
  l3rd: 'lower-third',
  l3rds: 'lower-third',
  'logo-bugs': 'logo-bug',
  bugs: 'logo-bug',
  watermark: 'logo-bug',
  watermarks: 'logo-bug',
  'end-cards': 'end-card',
  credits: 'end-card',
  grain: 'film-grunge',
  scratches: 'film-grunge',
};

const typeByAlias = new Map<string, string>();
for (const t of TYPES) for (const a of aliases(t.id, t.label)) if (!typeByAlias.has(a)) typeByAlias.set(a, t.id);
for (const [word, type] of Object.entries(TYPE_SYNONYMS)) typeByAlias.set(word, type);

const groupByAlias = new Map<string, string>();
for (const g of TYPE_GROUPS) for (const a of aliases(g.id, g.label)) if (!groupByAlias.has(a)) groupByAlias.set(a, g.id);

const themeByAlias = new Map<string, string>();
for (const g of THEME_GROUPS) for (const t of g.themes) for (const a of aliases(t.id, t.label)) if (!themeByAlias.has(a)) themeByAlias.set(a, t.id);

type MediaKind = 'video' | 'image' | 'audio';

/**
 * Which type groups a media kind can carry. Library video is as often a background, an
 * overlay, a transition or a lower third as it is stock footage; stills are backgrounds,
 * textures, frames and icons as often as photos.
 */
const KIND_GROUPS: Record<MediaKind, readonly string[]> = {
  video: ['video', 'backgrounds', 'overlays', 'transitions', 'titles', 'elements', 'assets'],
  image: ['stills', 'backgrounds', 'overlays', 'elements', 'assets'],
  audio: ['music', 'sfx'],
};

/** A folder that names a whole group ("Backgrounds/loop.mov") gets the group's plain type for the kind. */
const GROUP_DEFAULT_TYPE: Record<string, Partial<Record<MediaKind, string>>> = {
  backgrounds: { video: 'animated-loop', image: 'still-background' },
  overlays: { video: 'overlay', image: 'overlay' },
  transitions: { video: 'wipe' },
  titles: { video: 'title' },
  elements: { video: 'shapes', image: 'shapes' },
  video: { video: 'stock-footage' },
  stills: { image: 'photo' },
  music: { audio: 'full-mix' },
  // Sound effects have no plain member; "SFX/x.wav" stays untyped until a folder says which.
};

/**
 * A media item's type from its kind and folder names: the deepest folder that names a
 * type in the kind's groups wins ("Overlays/Light leaks/…" → light and particles), and a
 * folder that names a group gives the group's plain type ("Backgrounds/…" → animated loop
 * for video, still background for an image). No folder, no type — the kind alone does not
 * justify calling an mp4 stock footage or a wav a sting.
 */
export function inferMediaType(kind: MediaKind, folderSegments: readonly string[]): string | undefined {
  const allowed = new Set(KIND_GROUPS[kind]);
  for (let i = folderSegments.length - 1; i >= 0; i--) {
    const segment = folderSegments[i]!;
    const type = typeByAlias.get(segment);
    if (type && allowed.has(typeById.get(type)!.group)) return type;
    const group = groupByAlias.get(segment);
    const fallback = group ? GROUP_DEFAULT_TYPE[group]?.[kind] : undefined;
    if (fallback) return fallback;
  }
  return undefined;
}

/** Built-in themes named by folders, in path order ("Sports/Hockey/…" → sports, hockey). */
export function inferThemes(folderSegments: readonly string[]): string[] {
  const themes: string[] = [];
  for (const segment of folderSegments) {
    const theme = themeByAlias.get(segment);
    if (theme && !themes.includes(theme)) themes.push(theme);
  }
  return themes;
}

/** Today's manifest category mapped onto the type list; "other" has no type. */
export const CATEGORY_TO_TYPE: Readonly<Record<string, string | undefined>> = {
  'lower-third': 'lower-third',
  title: 'title',
  transition: 'wipe',
  overlay: 'overlay',
  background: 'animated-loop',
  other: undefined,
};

/** A template's type: the declared one, or the one its category maps to. */
export function templateType(manifest: { type?: string; category: string }): string | undefined {
  return manifest.type ?? CATEGORY_TO_TYPE[manifest.category];
}

/**
 * A library entry's type: a template's declared or category-mapped one, a media
 * file's folder-inferred one. Structural, so this module still knows nothing
 * about the index.
 */
export function entryType(entry: { kind: 'template'; manifest: { type?: string; category: string } } | { kind: 'media'; type?: string }): string | undefined {
  return entry.kind === 'template' ? templateType(entry.manifest) : entry.type;
}
