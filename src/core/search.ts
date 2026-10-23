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
 *   pack:news-pack       template installed from or found under this pack (its folder slug)
 *   category:title       template category
 *   "breaking news"      phrase matched as one term
 *   duration:>5          seconds; also <, >=, <=, =, and ranges such as 5-10
 *   width:>=1920         picture width, same comparisons
 *   height:1080          picture height
 *   fps:29.97            frame rate
 *   res:1080p            shorter side with "p" (also 4k, uhd, 8k, hd, fhd)
 *   codec:prores         video codec as ffprobe names it (media only)
 *   alpha:yes            alpha channel; yes | no
 *   favorite:yes         favorites only (favorite:no for the rest)
 *   recent:yes           items used before, most recent first (recent:10 for the ten most recent)
 * The numeric and alpha filters apply to templates through their manifest
 * and to media through probed metadata; media not yet probed does not match.
 */

import type { LibraryEntry, LibraryIndex } from './library-types';
import { RESOLUTION_ALIASES, resolutionLabel } from './media-meta';
import { normalizeTag } from './tags';
import { normalizeTheme, templateType, typeInfo } from './taxonomy';

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
    else if (key === 'favorite' && value) parsed.favorite = ['yes', 'true', '1', 'on'].includes(value.toLowerCase());
    else if (key === 'recent' && value) parsed.recent = /^\d+$/.test(value) ? Number(value) : true;
    else parsed.terms.push(token.toLowerCase());
  }
  return parsed;
}

/** The comparable facts about an entry: manifest values for templates, probed metadata for media. */
function facts(entry: LibraryEntry): { duration?: number; width?: number; height?: number; fps?: number; alpha?: boolean; codec?: string } {
  if (entry.kind === 'template') {
    const m = entry.manifest;
    return { duration: m.duration, width: m.width, height: m.height, fps: m.fps, alpha: m.alpha };
  }
  const meta = entry.meta;
  if (!meta) return {};
  return { duration: meta.duration, width: meta.width, height: meta.height, fps: meta.fps, alpha: meta.alpha, codec: meta.codec };
}

function entryName(entry: LibraryEntry): string {
  return entry.kind === 'template' ? entry.manifest.name : entry.name;
}

/** The taxonomy type of an entry: a template's declared or category-mapped type, a media file's folder-inferred one. */
function entryType(entry: LibraryEntry): string | undefined {
  return entry.kind === 'template' ? templateType(entry.manifest) : entry.type;
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
    if (q.themes.length > 0 && !q.themes.every((t) => entry.themes?.includes(t))) continue;
    if (q.styles.length > 0 && (entry.kind !== 'template' || !q.styles.every((s) => entry.manifest.styles?.includes(s)))) continue;
    if (q.packs.length > 0 && (entry.kind !== 'template' || !q.packs.includes(entry.pack?.slug ?? ''))) continue;
    if (q.favorite !== undefined && (entry.favorite === true) !== q.favorite) continue;
    if (q.recent !== undefined && !entry.lastUsed) continue;
    if (q.numeric.length > 0 || q.resolutions.length > 0 || q.codecs.length > 0 || q.alpha !== undefined) {
      const f = facts(entry);
      if (!q.numeric.every((n) => compare(f[n.field], n.cmp))) continue;
      if (q.resolutions.length > 0 && !q.resolutions.includes(resolutionLabel(f.width, f.height) ?? '')) continue;
      if (q.codecs.length > 0 && (f.codec === undefined || !q.codecs.includes(f.codec.toLowerCase()))) continue;
      if (q.alpha !== undefined && f.alpha !== q.alpha) continue;
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
