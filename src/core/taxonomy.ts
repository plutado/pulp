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
export const TAXONOMY_VERSION = 1;

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
] as const;

export const TYPES: readonly TaxonomyType[] = [
  { id: 'lower-third', label: 'Lower third', group: 'titles' },
  { id: 'title', label: 'Title', group: 'titles' },
  { id: 'opener', label: 'Opener', group: 'titles' },
  { id: 'end-card', label: 'End card / credits', group: 'titles' },
  { id: 'callout', label: 'Callout / caption', group: 'titles' },
  { id: 'social', label: 'Social / subscribe', group: 'titles' },
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
] as const;

export interface ThemeGroup {
  id: string;
  label: string;
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
    themes: [
      { id: 'sports', label: 'Sports (general)' },
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
    themes: [
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

/** Folder words that mean a type: the id, the label, each slash-part of the label, and simple plurals. */
function aliases(id: string, label: string): string[] {
  const parts = label.split('/').map((p) => normalizeTag(p)).filter(Boolean);
  const base = [id, normalizeTag(label), ...parts];
  return [...new Set([...base, ...base.map((a) => `${a}s`)])];
}

const typeByAlias = new Map<string, string>();
for (const t of TYPES) for (const a of aliases(t.id, t.label)) if (!typeByAlias.has(a)) typeByAlias.set(a, t.id);

const themeByAlias = new Map<string, string>();
for (const g of THEME_GROUPS) for (const t of g.themes) for (const a of aliases(t.id, t.label)) if (!themeByAlias.has(a)) themeByAlias.set(a, t.id);

/** Which type groups a media kind can carry. */
const KIND_GROUPS: Record<'video' | 'image' | 'audio', readonly string[]> = {
  video: ['video'],
  image: ['stills'],
  audio: ['music', 'sfx'],
};

/**
 * A media item's type from its kind and folder names: the deepest folder that names a
 * type in the kind's groups wins ("sfx/whoosh/…" → whoosh). No folder, no type — the
 * kind alone does not justify calling an mp4 stock footage or a wav a sting.
 */
export function inferMediaType(kind: 'video' | 'image' | 'audio', folderSegments: readonly string[]): string | undefined {
  const allowed = new Set(KIND_GROUPS[kind]);
  for (let i = folderSegments.length - 1; i >= 0; i--) {
    const type = typeByAlias.get(folderSegments[i]!);
    if (type && allowed.has(typeById.get(type)!.group)) return type;
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
