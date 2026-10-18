/**
 * Search over a LibraryIndex. Pure functions; no I/O.
 *
 * Query syntax (whitespace separated, double quotes group words):
 *   lower third          free-text terms, all must match (AND)
 *   tag:news             entry must carry this tag
 *   type:template        template | media | video | image | audio
 *   category:title       template category
 *   "breaking news"      phrase matched as one term
 */

import type { LibraryEntry, LibraryIndex } from './library-types';
import { normalizeTag } from './tags';

export interface ParsedQuery {
  terms: string[];
  tags: string[];
  types: string[];
  categories: string[];
}

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
  const parsed: ParsedQuery = { terms: [], tags: [], types: [], categories: [] };
  for (const token of tokenizeQuery(query)) {
    const colon = token.indexOf(':');
    const key = colon > 0 ? token.slice(0, colon).toLowerCase() : '';
    const value = colon > 0 ? token.slice(colon + 1) : token;
    if (key === 'tag' && value) parsed.tags.push(normalizeTag(value));
    else if (key === 'type' && value) parsed.types.push(value.toLowerCase());
    else if (key === 'category' && value) parsed.categories.push(value.toLowerCase());
    else parsed.terms.push(token.toLowerCase());
  }
  return parsed;
}

function entryName(entry: LibraryEntry): string {
  return entry.kind === 'template' ? entry.manifest.name : entry.name;
}

function entryHaystack(entry: LibraryEntry): { name: string; words: string[]; tags: string[]; text: string } {
  const name = entryName(entry).toLowerCase();
  const extra =
    entry.kind === 'template'
      ? [entry.manifest.id, entry.manifest.description ?? '', entry.manifest.category, entry.manifest.author ?? '']
      : [entry.ext, entry.mediaKind];
  const text = [name, ...entry.tags, ...extra].join(' ').toLowerCase();
  return { name, words: name.split(/[^a-z0-9]+/).filter(Boolean), tags: entry.tags, text };
}

function matchesType(entry: LibraryEntry, type: string): boolean {
  if (type === 'template' || type === 'templates') return entry.kind === 'template';
  if (type === 'media') return entry.kind === 'media';
  return entry.kind === 'media' && entry.mediaKind === type;
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
