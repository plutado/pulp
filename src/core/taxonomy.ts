/**
 * The built-in taxonomy: what an item IS (type, one per item, grouped on two
 * levels), what it is ABOUT (themes, zero or more) and how it LOOKS (styles,
 * zero or more). ADR 0010 records the three axes and the extension rule:
 * the type and style lists are fixed per app version; themes are open — any
 * normalized word that is not built in is a custom theme, stored like a tag,
 * so nobody waits for a release. Pure; no DOM, no Electron, no Node.
 *
 * Every name is read from the message catalog in a getter (milestone 59), so a
 * `label` is always the interface's language now — the browse tree, the chips,
 * the Info tab and the tags follow a change of language — while the folder
 * aliases worked out from the labels below, once at load, are the source's US
 * English: a folder or a search typed in English still finds what it meant.
 * Ids are stored values and never change; only the words do.
 */

import { tr } from './i18n';
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
  { id: 'titles', get label() { return tr('taxonomy.group.titles'); } },
  { id: 'backgrounds', get label() { return tr('taxonomy.group.backgrounds'); } },
  { id: 'transitions', get label() { return tr('taxonomy.group.transitions'); } },
  { id: 'overlays', get label() { return tr('taxonomy.group.overlays'); } },
  { id: 'elements', get label() { return tr('taxonomy.group.elements'); } },
  { id: 'video', get label() { return tr('taxonomy.group.video'); } },
  { id: 'stills', get label() { return tr('taxonomy.group.stills'); } },
  { id: 'music', get label() { return tr('taxonomy.group.music'); } },
  { id: 'sfx', get label() { return tr('taxonomy.group.sfx'); } },
  { id: 'assets', get label() { return tr('taxonomy.group.assets'); } },
] as const;

export const TYPES: readonly TaxonomyType[] = [
  { id: 'lower-third', get label() { return tr('taxonomy.type.lower-third'); }, group: 'titles' },
  { id: 'title', get label() { return tr('taxonomy.type.title'); }, group: 'titles' },
  { id: 'opener', get label() { return tr('taxonomy.type.opener'); }, group: 'titles' },
  { id: 'end-card', get label() { return tr('taxonomy.type.end-card'); }, group: 'titles' },
  { id: 'callout', get label() { return tr('taxonomy.type.callout'); }, group: 'titles' },
  { id: 'social', get label() { return tr('taxonomy.type.social'); }, group: 'titles' },
  { id: 'logo-reveal', get label() { return tr('taxonomy.type.logo-reveal'); }, group: 'titles' },
  { id: 'animated-loop', get label() { return tr('taxonomy.type.animated-loop'); }, group: 'backgrounds' },
  { id: 'still-background', get label() { return tr('taxonomy.type.still-background'); }, group: 'backgrounds' },
  { id: 'texture', get label() { return tr('taxonomy.type.texture'); }, group: 'backgrounds' },
  { id: 'wipe', get label() { return tr('taxonomy.type.wipe'); }, group: 'transitions' },
  { id: 'reveal', get label() { return tr('taxonomy.type.reveal'); }, group: 'transitions' },
  { id: 'flash', get label() { return tr('taxonomy.type.flash'); }, group: 'transitions' },
  { id: 'glitch', get label() { return tr('taxonomy.type.glitch'); }, group: 'transitions' },
  { id: 'overlay', get label() { return tr('taxonomy.type.overlay'); }, group: 'overlays' },
  { id: 'frame', get label() { return tr('taxonomy.type.frame'); }, group: 'overlays' },
  { id: 'light-particles', get label() { return tr('taxonomy.type.light-particles'); }, group: 'overlays' },
  { id: 'film-grunge', get label() { return tr('taxonomy.type.film-grunge'); }, group: 'overlays' },
  { id: 'logo-bug', get label() { return tr('taxonomy.type.logo-bug'); }, group: 'overlays' },
  { id: 'vignette', get label() { return tr('taxonomy.type.vignette'); }, group: 'overlays' },
  { id: 'shapes', get label() { return tr('taxonomy.type.shapes'); }, group: 'elements' },
  { id: 'icons', get label() { return tr('taxonomy.type.icons'); }, group: 'elements' },
  { id: 'arrows', get label() { return tr('taxonomy.type.arrows'); }, group: 'elements' },
  { id: 'infographic', get label() { return tr('taxonomy.type.infographic'); }, group: 'elements' },
  { id: 'counter', get label() { return tr('taxonomy.type.counter'); }, group: 'elements' },
  { id: 'countdown', get label() { return tr('taxonomy.type.countdown'); }, group: 'elements' },
  { id: 'stock-footage', get label() { return tr('taxonomy.type.stock-footage'); }, group: 'video' },
  { id: 'photo', get label() { return tr('taxonomy.type.photo'); }, group: 'stills' },
  { id: 'illustration', get label() { return tr('taxonomy.type.illustration'); }, group: 'stills' },
  { id: 'layered-graphic', get label() { return tr('taxonomy.type.layered-graphic'); }, group: 'stills' },
  { id: 'full-mix', get label() { return tr('taxonomy.type.full-mix'); }, group: 'music' },
  { id: 'stems', get label() { return tr('taxonomy.type.stems'); }, group: 'music' },
  { id: 'sting', get label() { return tr('taxonomy.type.sting'); }, group: 'music' },
  { id: 'ambience', get label() { return tr('taxonomy.type.ambience'); }, group: 'sfx' },
  { id: 'impact', get label() { return tr('taxonomy.type.impact'); }, group: 'sfx' },
  { id: 'whoosh', get label() { return tr('taxonomy.type.whoosh'); }, group: 'sfx' },
  { id: 'ui-tech', get label() { return tr('taxonomy.type.ui-tech'); }, group: 'sfx' },
  { id: 'alarm', get label() { return tr('taxonomy.type.alarm'); }, group: 'sfx' },
  { id: 'nature-weather', get label() { return tr('taxonomy.type.nature-weather'); }, group: 'sfx' },
  { id: 'animals', get label() { return tr('taxonomy.type.animals'); }, group: 'sfx' },
  { id: 'vehicles', get label() { return tr('taxonomy.type.vehicles'); }, group: 'sfx' },
  { id: 'crowd', get label() { return tr('taxonomy.type.crowd'); }, group: 'sfx' },
  { id: 'foley', get label() { return tr('taxonomy.type.foley'); }, group: 'sfx' },
  { id: 'explosion', get label() { return tr('taxonomy.type.explosion'); }, group: 'sfx' },
  { id: 'sci-fi', get label() { return tr('taxonomy.type.sci-fi'); }, group: 'sfx' },
  { id: 'musical-phrase', get label() { return tr('taxonomy.type.musical-phrase'); }, group: 'sfx' },
  // Assets (milestone 26): isolated elements on transparency, dropped onto a frame. Effects
  // first -- generic, tagged with whatever themes fit; the themed Objects follow.
  { id: 'fire', get label() { return tr('taxonomy.type.fire'); }, group: 'assets' },
  { id: 'smoke', get label() { return tr('taxonomy.type.smoke'); }, group: 'assets' },
  { id: 'sparks', get label() { return tr('taxonomy.type.sparks'); }, group: 'assets' },
  { id: 'explosion-asset', get label() { return tr('taxonomy.type.explosion-asset'); }, group: 'assets' },
  { id: 'energy', get label() { return tr('taxonomy.type.energy'); }, group: 'assets' },
  { id: 'light-asset', get label() { return tr('taxonomy.type.light-asset'); }, group: 'assets' },
  { id: 'weather-asset', get label() { return tr('taxonomy.type.weather-asset'); }, group: 'assets' },
  { id: 'liquid', get label() { return tr('taxonomy.type.liquid'); }, group: 'assets' },
  { id: 'confetti', get label() { return tr('taxonomy.type.confetti'); }, group: 'assets' },
  { id: 'brush', get label() { return tr('taxonomy.type.brush'); }, group: 'assets' },
  // The Objects kind: themed props, organized along the theme groups. A label is a plain noun
  // phrase on purpose — "Business objects", not "Business and work" — because every part of a
  // label split on "and" becomes a folder alias for the type (see `aliases`), and a person's
  // "Business" or "Travel" folder of stills must not be read as a folder of assets. Each
  // category covers more than its name says: Science takes in health and technology, Media
  // takes in entertainment, Nature the ocean and space, Travel the city, Home the kitchen, and
  // Community education, faith, charity and civic life; the theme subfolders say which.
  { id: 'sports-objects', get label() { return tr('taxonomy.type.sports-objects'); }, group: 'assets' },
  { id: 'celebration-objects', get label() { return tr('taxonomy.type.celebration-objects'); }, group: 'assets' },
  { id: 'holiday-objects', get label() { return tr('taxonomy.type.holiday-objects'); }, group: 'assets' },
  { id: 'business-objects', get label() { return tr('taxonomy.type.business-objects'); }, group: 'assets' },
  { id: 'science-objects', get label() { return tr('taxonomy.type.science-objects'); }, group: 'assets' },
  { id: 'media-objects', get label() { return tr('taxonomy.type.media-objects'); }, group: 'assets' },
  { id: 'nature-objects', get label() { return tr('taxonomy.type.nature-objects'); }, group: 'assets' },
  { id: 'travel-objects', get label() { return tr('taxonomy.type.travel-objects'); }, group: 'assets' },
  { id: 'home-objects', get label() { return tr('taxonomy.type.home-objects'); }, group: 'assets' },
  { id: 'community-objects', get label() { return tr('taxonomy.type.community-objects'); }, group: 'assets' },
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
    get label() { return tr('taxonomy.theme-group.business'); },
    themes: [
      { id: 'corporate', get label() { return tr('taxonomy.theme.corporate'); } },
      { id: 'finance', get label() { return tr('taxonomy.theme.finance'); } },
      { id: 'real-estate', get label() { return tr('taxonomy.theme.real-estate'); } },
      { id: 'technology', get label() { return tr('taxonomy.theme.technology'); } },
      { id: 'medical', get label() { return tr('taxonomy.theme.medical'); } },
      { id: 'science', get label() { return tr('taxonomy.theme.science'); } },
      { id: 'legal', get label() { return tr('taxonomy.theme.legal'); } },
    ],
  },
  {
    id: 'media',
    get label() { return tr('taxonomy.theme-group.media'); },
    themes: [
      { id: 'news', get label() { return tr('taxonomy.theme.news'); } },
      { id: 'documentary', get label() { return tr('taxonomy.theme.documentary'); } },
      { id: 'podcast', get label() { return tr('taxonomy.theme.podcast'); } },
      { id: 'social-media', get label() { return tr('taxonomy.theme.social-media'); } },
      { id: 'gaming', get label() { return tr('taxonomy.theme.gaming'); } },
    ],
  },
  {
    id: 'sports',
    get label() { return tr('taxonomy.theme-group.sports'); },
    general: 'sports',
    themes: [
      { id: 'sports', get label() { return tr('taxonomy.theme.sports'); } },
      { id: 'football', get label() { return tr('taxonomy.theme.football'); } },
      { id: 'basketball', get label() { return tr('taxonomy.theme.basketball'); } },
      { id: 'baseball', get label() { return tr('taxonomy.theme.baseball'); } },
      { id: 'soccer', get label() { return tr('taxonomy.theme.soccer'); } },
      { id: 'hockey', get label() { return tr('taxonomy.theme.hockey'); } },
      { id: 'golf', get label() { return tr('taxonomy.theme.golf'); } },
      { id: 'tennis', get label() { return tr('taxonomy.theme.tennis'); } },
      { id: 'motorsport', get label() { return tr('taxonomy.theme.motorsport'); } },
      { id: 'fitness', get label() { return tr('taxonomy.theme.fitness'); } },
    ],
  },
  {
    id: 'life-events',
    get label() { return tr('taxonomy.theme-group.life-events'); },
    themes: [
      { id: 'wedding', get label() { return tr('taxonomy.theme.wedding'); } },
      { id: 'birthday', get label() { return tr('taxonomy.theme.birthday'); } },
      { id: 'graduation', get label() { return tr('taxonomy.theme.graduation'); } },
      { id: 'family', get label() { return tr('taxonomy.theme.family'); } },
      { id: 'memorial', get label() { return tr('taxonomy.theme.memorial'); } },
    ],
  },
  {
    id: 'holidays',
    get label() { return tr('taxonomy.theme-group.holidays'); },
    general: 'holiday',
    themes: [
      { id: 'holiday', get label() { return tr('taxonomy.theme.holiday'); } },
      { id: 'christmas', get label() { return tr('taxonomy.theme.christmas'); } },
      { id: 'new-year', get label() { return tr('taxonomy.theme.new-year'); } },
      { id: 'valentines', get label() { return tr('taxonomy.theme.valentines'); } },
      { id: 'easter', get label() { return tr('taxonomy.theme.easter'); } },
      { id: 'halloween', get label() { return tr('taxonomy.theme.halloween'); } },
      { id: 'thanksgiving', get label() { return tr('taxonomy.theme.thanksgiving'); } },
      { id: 'summer', get label() { return tr('taxonomy.theme.summer'); } },
      { id: 'patriotic', get label() { return tr('taxonomy.theme.patriotic'); } },
    ],
  },
  {
    id: 'community',
    get label() { return tr('taxonomy.theme-group.community'); },
    themes: [
      { id: 'faith', get label() { return tr('taxonomy.theme.faith'); } },
      { id: 'education', get label() { return tr('taxonomy.theme.education'); } },
      { id: 'nonprofit', get label() { return tr('taxonomy.theme.nonprofit'); } },
      { id: 'civic', get label() { return tr('taxonomy.theme.civic'); } },
    ],
  },
  {
    id: 'world-nature',
    get label() { return tr('taxonomy.theme-group.world-nature'); },
    themes: [
      { id: 'travel', get label() { return tr('taxonomy.theme.travel'); } },
      { id: 'nature', get label() { return tr('taxonomy.theme.nature'); } },
      { id: 'ocean', get label() { return tr('taxonomy.theme.ocean'); } },
      { id: 'space', get label() { return tr('taxonomy.theme.space'); } },
      { id: 'weather', get label() { return tr('taxonomy.theme.weather'); } },
      { id: 'city', get label() { return tr('taxonomy.theme.city'); } },
    ],
  },
  {
    id: 'entertainment',
    get label() { return tr('taxonomy.theme-group.entertainment'); },
    themes: [
      { id: 'concert', get label() { return tr('taxonomy.theme.concert'); } },
      { id: 'cinema', get label() { return tr('taxonomy.theme.cinema'); } },
      { id: 'kids', get label() { return tr('taxonomy.theme.kids'); } },
      { id: 'food', get label() { return tr('taxonomy.theme.food'); } },
      { id: 'fashion', get label() { return tr('taxonomy.theme.fashion'); } },
    ],
  },
] as const;

export const STYLES: readonly { id: string; label: string }[] = [
  { id: 'clean', get label() { return tr('taxonomy.style.clean'); } },
  { id: 'corporate', get label() { return tr('taxonomy.style.corporate'); } },
  { id: 'elegant', get label() { return tr('taxonomy.style.elegant'); } },
  { id: 'high-energy', get label() { return tr('taxonomy.style.high-energy'); } },
  { id: 'grunge', get label() { return tr('taxonomy.style.grunge'); } },
  { id: 'retro', get label() { return tr('taxonomy.style.retro'); } },
  { id: 'tech', get label() { return tr('taxonomy.style.tech'); } },
  { id: 'cinematic', get label() { return tr('taxonomy.style.cinematic'); } },
  // The two looks of Pulp's own art (milestone 61; docs/art-direction.md): polished — soft light,
  // layered depth, glass and metal, restrained palettes — beside the flat, bright playful set.
  { id: 'polished', get label() { return tr('taxonomy.style.polished'); } },
  { id: 'playful', get label() { return tr('taxonomy.style.playful'); } },
  { id: 'hand-drawn', get label() { return tr('taxonomy.style.hand-drawn'); } },
  { id: 'organic', get label() { return tr('taxonomy.style.organic'); } },
] as const;

const typeById = new Map(TYPES.map((t) => [t.id, t]));
/** Each type's name as worked out at load — US English, the source — for what searches by meaning rather than shows (src/core/semantic.ts). */
const typeSourceLabels = new Map(TYPES.map((t) => [t.id, t.label]));
const themeIds = new Set(THEME_GROUPS.flatMap((g) => g.themes.map((t) => t.id)));
const styleIds = new Set(STYLES.map((s) => s.id));

export function isBuiltInType(id: string): boolean {
  return typeById.has(id);
}

export function typeInfo(id: string): TaxonomyType | undefined {
  return typeById.get(id);
}

/** A type's name in US English whatever the interface's language: what an item is embedded as for semantic search, never shown. */
export function typeSourceLabel(id: string): string | undefined {
  return typeSourceLabels.get(id);
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
 * Folder words that mean an id: the id, the label (read at load: US English), each part of the label split on "/"
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

/**
 * The groups a template may belong to: what a graphic on a frame is, not
 * footage, stills or sound. Assets are among them — an animation of confetti
 * or a spark is an isolated element on transparency, which is what the Assets
 * group means, and a Lottie placed as a layer is exactly that use (milestone 35).
 */
const TEMPLATE_GROUPS: readonly string[] = ['titles', 'backgrounds', 'transitions', 'overlays', 'elements', 'assets'];

/**
 * A template's type from its folders alone (milestone 35), for a file read as a
 * template that declares none — a Lottie animation: the deepest folder that
 * names a template type wins, and a folder that names a group gives the
 * group's plain type, as a clip's folders do.
 */
export function inferTemplateType(folderSegments: readonly string[]): string | undefined {
  for (let i = folderSegments.length - 1; i >= 0; i--) {
    const segment = folderSegments[i]!;
    const type = typeByAlias.get(segment);
    if (type && TEMPLATE_GROUPS.includes(typeById.get(type)!.group)) return type;
    const group = groupByAlias.get(segment);
    const fallback = group && TEMPLATE_GROUPS.includes(group) ? GROUP_DEFAULT_TYPE[group]?.video : undefined;
    if (fallback) return fallback;
  }
  return undefined;
}

/** Built-in themes named by folders, in path order ("Sports/Hockey/…" → sports, hockey). */
// ---------------------------------------------------------------- moods (how audio feels)

/**
 * How a piece of sound feels — upbeat, dramatic, calm — beside what it *is*
 * (the type) and what it is *about* (the theme). A fixed list like the styles:
 * a mood is a word two people must reach for the same way, or browsing by it
 * finds nothing. Moods come from two places, both of them the person's own
 * words: a folder named for one ("Music/Calm"), and the file's own metadata —
 * the genre, mood or comment tag ffprobe reads — so a library of real music
 * tagged "Chill" or "Suspense" browses by feel without renaming a thing.
 */
export interface Mood {
  id: string;
  label: string;
  /** Words that mean this mood, matched normalized; the id and label always count. */
  aliases: readonly string[];
}

export const MOODS: readonly Mood[] = [
  { id: 'upbeat', get label() { return tr('taxonomy.mood.upbeat'); }, aliases: ['uplifting', 'energetic', 'driving', 'happy', 'feel-good', 'bouncy'] },
  { id: 'calm', get label() { return tr('taxonomy.mood.calm'); }, aliases: ['chill', 'relaxed', 'relaxing', 'peaceful', 'serene', 'soothing', 'mellow', 'gentle'] },
  { id: 'dramatic', get label() { return tr('taxonomy.mood.dramatic'); }, aliases: ['intense', 'drama'] },
  { id: 'epic', get label() { return tr('taxonomy.mood.epic'); }, aliases: ['heroic', 'triumphant', 'anthemic', 'majestic'] },
  { id: 'tense', get label() { return tr('taxonomy.mood.tense'); }, aliases: ['suspense', 'suspenseful', 'thriller', 'ominous', 'anxious'] },
  { id: 'playful', get label() { return tr('taxonomy.mood.playful'); }, aliases: ['fun', 'quirky', 'whimsical', 'lighthearted', 'cheeky'] },
  { id: 'melancholy', get label() { return tr('taxonomy.mood.melancholy'); }, aliases: ['melancholic', 'sad', 'somber', 'sombre', 'mournful', 'wistful', 'bittersweet'] },
  { id: 'mysterious', get label() { return tr('taxonomy.mood.mysterious'); }, aliases: ['mystery', 'eerie', 'haunting', 'enigmatic'] },
];

const moodByAlias = new Map<string, string>();
for (const m of MOODS) {
  for (const a of [m.id, normalizeTag(m.label), ...m.aliases.map(normalizeTag)]) if (!moodByAlias.has(a)) moodByAlias.set(a, m.id);
}

export function isBuiltInMood(id: string): boolean {
  return MOODS.some((m) => m.id === id);
}

export function moodLabel(id: string): string {
  return MOODS.find((m) => m.id === id)?.label ?? id;
}

/** The moods a path's folders name, in the order found: a folder called "Calm" tags what it holds. */
export function inferMoods(folderSegments: readonly string[]): string[] {
  const moods: string[] = [];
  for (const segment of folderSegments) {
    const mood = moodByAlias.get(normalizeTag(segment));
    if (mood && !moods.includes(mood)) moods.push(mood);
  }
  return moods;
}

/**
 * The moods a metadata string names: a genre of "Chill", a comment of
 * "suspense, eerie". Split on the separators tags use, matched by alias;
 * words that are not moods are simply not moods.
 */
export function moodsFromText(text: string | undefined): string[] {
  if (!text) return [];
  const moods: string[] = [];
  for (const part of text.split(/[,;/|]|\s+/)) {
    const mood = moodByAlias.get(normalizeTag(part));
    if (mood && !moods.includes(mood)) moods.push(mood);
  }
  return moods;
}

/**
 * Every mood an entry carries: a media file's folder-inferred ones with what
 * its own metadata says. Templates carry none — a mood is how sound feels.
 */
export function entryMoods(entry: { kind: 'template' } | { kind: 'media'; moods?: string[]; meta?: { moods?: string[] } }): string[] {
  if (entry.kind !== 'media') return [];
  const fromMeta = entry.meta?.moods ?? [];
  const own = entry.moods ?? [];
  return fromMeta.length === 0 ? own : [...new Set([...own, ...fromMeta])];
}

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
  title: 'title', // i18n-exempt(technical): a type id
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
