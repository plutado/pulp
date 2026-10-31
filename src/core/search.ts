/**
 * Search over a LibraryIndex. Pure functions; no I/O.
 *
 * Query syntax (whitespace separated, double quotes group words):
 *   lower third          free-text terms, all must match (AND)
 *   tag:news             entry must carry this tag
 *   type:template        template | media | video | image | audio, or a taxonomy type (type:whoosh)
 *                        or type group (type:sfx), or untyped; several type: terms are alternatives
 *   theme:news           entry carries this theme (built-in id or a custom word; all theme: terms must match)
 *   style:grunge         template declares this style (templates only; all style: terms must match)
 *   pack:news-pack       template installed from or found under this pack (its folder slug); pack:any for any pack
 *   category:title       template category
 *   "breaking news"      phrase matched as one term
 *   duration:>5          seconds; also <, >=, <=, =, and ranges such as 5-10
 *   width:>=1920         picture width, same comparisons
 *   height:1080          picture height
 *   fps:29.97            frame rate
 *   res:1080p            shorter side with "p" (also 4k, uhd, 8k, hd, fhd)
 *   codec:prores         video codec as ffprobe names it (media only)
 *   alpha:yes            alpha channel; yes | no
 *   orientation:portrait portrait | landscape | square; a template matches when any of its aspects does
 *   favorite:yes         favorites only (favorite:no for the rest)
 *   recent:yes           items used before, most recent first (recent:10 for the ten most recent)
 * The numeric and alpha filters apply to templates through their manifest
 * and to media through probed metadata; media not yet probed does not match.
 */

import { ORIENTATIONS, orientationOf, templateDefaultSize, templateOrientations, type Orientation } from './aspect';
import type { LibraryEntry, LibraryIndex, MediaEntry, MediaKind } from './library-types';
import { RESOLUTION_ALIASES, resolutionLabel } from './media-meta';
import { normalizeTag } from './tags';
import { entryType, isThemeGroup, normalizeTheme, themesInGroup, typeInfo } from './taxonomy';

export type NumericField = 'duration' | 'width' | 'height' | 'fps';

export interface Comparison {
  op: '<' | '<=' | '>' | '>=' | '=' | 'range';
  value: number;
  /** Upper bound for ranges. */
  to?: number;
}

export interface ParsedQuery {
  terms: string[];
  tags: string[];
  types: string[];
  themes: string[];
  styles: string[];
  packs: string[];
  categories: string[];
  numeric: { field: NumericField; cmp: Comparison }[];
  resolutions: string[];
  codecs: string[];
  alpha?: boolean;
  orientation?: Orientation;
  favorite?: boolean;
  /** Items used before, newest first; a number limits how many. */
  recent?: number | true;
}

/** ">=1920", "5-10", "25" and the like; null if not a comparison. */
export function parseComparison(text: string): Comparison | null {
  const t = text.trim();
  const range = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(t);
  if (range) return { op: 'range', value: Number(range[1]), to: Number(range[2]) };
  const m = /^(<=|>=|<|>|=)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  return { op: (m[1] as Comparison['op'] | undefined) ?? '=', value: Number(m[2]) };
}

export function compare(actual: number | undefined, cmp: Comparison): boolean {
  if (actual === undefined) return false;
  switch (cmp.op) {
    case '<': return actual < cmp.value;
    case '<=': return actual <= cmp.value;
    case '>': return actual > cmp.value;
    case '>=': return actual >= cmp.value;
    case '=': return Math.abs(actual - cmp.value) < 0.001;
    case 'range': return actual >= cmp.value && actual <= (cmp.to ?? cmp.value);
  }
}

const NUMERIC_FIELDS = new Set<string>(['duration', 'width', 'height', 'fps']);

export interface SearchHit {
  entry: LibraryEntry;
  score: number;
}

export function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  const re = /(\S+?:)?"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    if (m[2] !== undefined) tokens.push(`${m[1] ?? ''}${m[2]}`);
    else if (m[3] !== undefined) tokens.push(m[3]);
  }
  return tokens.map((t) => t.trim()).filter((t) => t.length > 0);
}

export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], tags: [], types: [], themes: [], styles: [], packs: [], categories: [], numeric: [], resolutions: [], codecs: [] };
  for (const token of tokenizeQuery(query)) {
    const colon = token.indexOf(':');
    const key = colon > 0 ? token.slice(0, colon).toLowerCase() : '';
    const value = colon > 0 ? token.slice(colon + 1) : token;
    const cmp = NUMERIC_FIELDS.has(key) ? parseComparison(value) : null;
    if (key === 'tag' && value) parsed.tags.push(normalizeTag(value));
    else if (key === 'type' && value) parsed.types.push(normalizeTag(value));
    else if (key === 'theme' && value) parsed.themes.push(normalizeTheme(value));
    else if (key === 'style' && value) parsed.styles.push(normalizeTag(value));
    else if (key === 'pack' && value) parsed.packs.push(normalizeTag(value));
    else if (key === 'category' && value) parsed.categories.push(value.toLowerCase());
    else if (cmp) parsed.numeric.push({ field: key as NumericField, cmp });
    else if (key === 'res' && value) {
      const v = value.toLowerCase();
      parsed.resolutions.push(RESOLUTION_ALIASES[v] ?? (/^\d+$/.test(v) ? `${v}p` : v));
    } else if (key === 'codec' && value) parsed.codecs.push(value.toLowerCase());
    else if (key === 'alpha' && value) parsed.alpha = ['yes', 'true', '1', 'on'].includes(value.toLowerCase());
    else if (key === 'orientation' && value) {
      const v = value.toLowerCase();
      const o = v === 'vertical' || v === 'tall' ? 'portrait' : v === 'horizontal' || v === 'wide' ? 'landscape' : v;
      if ((ORIENTATIONS as readonly string[]).includes(o)) parsed.orientation = o as Orientation;
    }
    else if (key === 'favorite' && value) parsed.favorite = ['yes', 'true', '1', 'on'].includes(value.toLowerCase());
    else if (key === 'recent' && value) parsed.recent = /^\d+$/.test(value) ? Number(value) : true;
    else parsed.terms.push(token.toLowerCase());
  }
  return parsed;
}

/** The comparable facts about an entry: manifest values for templates, probed metadata for media. */
function facts(entry: LibraryEntry): { duration?: number; width?: number; height?: number; fps?: number; alpha?: boolean; codec?: string; orientations: Orientation[] } {
  if (entry.kind === 'template') {
    const m = entry.manifest;
    const size = templateDefaultSize(m);
    return { duration: m.duration, width: size.width, height: size.height, fps: m.fps, alpha: m.alpha, orientations: templateOrientations(m) };
  }
  const meta = entry.meta;
  if (!meta) return { orientations: [] };
  return {
    duration: meta.duration, width: meta.width, height: meta.height, fps: meta.fps, alpha: meta.alpha, codec: meta.codec,
    orientations: meta.width && meta.height ? [orientationOf(meta.width, meta.height)] : [],
  };
}

function entryName(entry: LibraryEntry): string {
  return entry.kind === 'template' ? entry.manifest.name : entry.name;
}

function entryHaystack(entry: LibraryEntry): { name: string; words: string[]; tags: string[]; text: string } {
  const name = entryName(entry).toLowerCase();
  const extra =
    entry.kind === 'template'
      ? [entry.manifest.id, entry.manifest.description ?? '', entry.manifest.category, entry.manifest.author ?? '', ...(entry.manifest.styles ?? [])]
      : [entry.ext, entry.mediaKind, entry.meta?.codec ?? '', resolutionLabel(entry.meta?.width, entry.meta?.height) ?? ''];
  extra.push(entryType(entry) ?? '', ...(entry.themes ?? []));
  const text = [name, ...entry.tags, ...extra].join(' ').toLowerCase();
  return { name, words: name.split(/[^a-z0-9]+/).filter(Boolean), tags: entry.tags, text };
}

/**
 * A `theme:` term matches the theme itself, or — when it names a theme group —
 * anything in that group: its general theme and every child. Selecting Sports in
 * the browse tree finds the generally-sporting items and the football ones alike.
 */
function matchesTheme(entry: LibraryEntry, theme: string): boolean {
  const mine = entry.themes;
  if (!mine || mine.length === 0) return false;
  if (mine.includes(theme)) return true;
  if (!isThemeGroup(theme)) return false;
  const inGroup = themesInGroup(theme);
  return mine.some((t) => inGroup.includes(t));
}

function matchesType(entry: LibraryEntry, type: string): boolean {
  if (type === 'template' || type === 'templates') return entry.kind === 'template';
  if (type === 'media') return entry.kind === 'media';
  if (entry.kind === 'media' && entry.mediaKind === type) return true;
  // A taxonomy type, a whole type group, or the items that have neither.
  const own = entryType(entry);
  if (type === 'untyped') return own === undefined;
  if (!own) return false;
  return own === type || typeInfo(own)?.group === type;
}

/**
 * Score a single term against an entry; 0 means no match. Components add up,
 * so a term that is both a tag and a word in the name outranks either alone.
 */
function scoreTerm(h: ReturnType<typeof entryHaystack>, term: string): number {
  if (h.name === term) return 10;
  let score = 0;
  if (h.tags.includes(term) || h.tags.includes(normalizeTag(term))) score += 5;
  if (h.words.some((w) => w.startsWith(term))) score += 3;
  if (score === 0 && h.text.includes(term)) score = 1;
  return score;
}

export function searchLibrary(index: LibraryIndex, query: string): SearchHit[] {
  const q = parseQuery(query);
  const entries: LibraryEntry[] = [...index.templates, ...index.media];
  const hits: SearchHit[] = [];

  for (const entry of entries) {
    if (q.types.length > 0 && !q.types.some((t) => matchesType(entry, t))) continue;
    if (q.categories.length > 0 && (entry.kind !== 'template' || !q.categories.includes(entry.manifest.category))) continue;
    if (!q.tags.every((t) => entry.tags.includes(t))) continue;
    if (q.themes.length > 0 && !q.themes.every((t) => matchesTheme(entry, t))) continue;
    if (q.styles.length > 0 && (entry.kind !== 'template' || !q.styles.every((s) => entry.manifest.styles?.includes(s)))) continue;
    // `pack:any` is everything that came from a matching set, whichever one (milestone 34's card).
    if (q.packs.length > 0 && (entry.kind !== 'template' || !q.packs.some((p) => p === entry.pack?.slug || (p === 'any' && entry.pack !== undefined)))) continue;
    if (q.favorite !== undefined && (entry.favorite === true) !== q.favorite) continue;
    if (q.recent !== undefined && !entry.lastUsed) continue;
    if (q.numeric.length > 0 || q.resolutions.length > 0 || q.codecs.length > 0 || q.alpha !== undefined || q.orientation !== undefined) {
      const f = facts(entry);
      if (!q.numeric.every((n) => compare(f[n.field], n.cmp))) continue;
      if (q.resolutions.length > 0 && !q.resolutions.includes(resolutionLabel(f.width, f.height) ?? '')) continue;
      if (q.codecs.length > 0 && (f.codec === undefined || !q.codecs.includes(f.codec.toLowerCase()))) continue;
      if (q.alpha !== undefined && f.alpha !== q.alpha) continue;
      if (q.orientation !== undefined && !f.orientations.includes(q.orientation)) continue;
    }

    const h = entryHaystack(entry);
    let score = 0;
    let all = true;
    for (const term of q.terms) {
      const s = scoreTerm(h, term);
      if (s === 0) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) hits.push({ entry, score });
  }

  if (q.recent !== undefined) {
    hits.sort((a, b) => (b.entry.lastUsed ?? '').localeCompare(a.entry.lastUsed ?? ''));
    return typeof q.recent === 'number' ? hits.slice(0, q.recent) : hits;
  }
  hits.sort((a, b) => b.score - a.score || entryName(a.entry).localeCompare(entryName(b.entry)));
  return hits;
}

/**
 * What may be chosen from the library here (milestone 40): media of certain
 * kinds that answers a query, best first.
 *
 * The one way anything in the window asks the library for media to choose —
 * the picture and clip choosers in the Parameters tab, the stage's Add Asset
 * list. It is the same `searchLibrary` the results use, over the media of
 * those kinds, so the query language and the ranking a person has learned in
 * the search bar hold wherever they type: `logo` ranks an exact name above a
 * tag above a word that starts with it, and `alpha:yes` or `duration:<5`
 * narrow a chooser exactly as they narrow the results. Before this each
 * chooser had a plain substring match of its own.
 */
/** Choices a chooser lists at once: enough to scroll through, few enough to build on a keystroke. */
export const PICKER_LIMIT = 60;

export interface MediaSearch {
  /** Which kinds may be chosen; every kind when it is not said. */
  kinds?: readonly MediaKind[];
  /** The query, in the language the search bar takes. */
  query?: string;
  /** Put what was used most recently first, keeping the query's ranking within. */
  recentFirst?: boolean;
  /** Most to hand back. */
  limit?: number;
}

export function searchMedia(index: LibraryIndex | null | undefined, options: MediaSearch = {}): MediaEntry[] {
  if (!index) return [];
  const { kinds, recentFirst, limit } = options;
  // An item whose folder is offline cannot be loaded, so it is never offered.
  const media = index.media.filter((m) => !m.offline && (!kinds || kinds.includes(m.mediaKind)));
  const found = searchLibrary({ ...index, templates: [], media }, options.query ?? '').map((h) => h.entry as MediaEntry);
  // A stable sort, so items used equally long ago keep the order the search put them in.
  const ordered = recentFirst ? [...found].sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '')) : found;
  return limit === undefined ? ordered : ordered.slice(0, limit);
}

/** Tag counts across the index, most used first. */
export function tagCounts(index: LibraryIndex): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of [...index.templates, ...index.media]) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
