/**
 * The render cache behind "render and drag": renders made for dragging into
 * an editing app, kept in a folder so the same template with the same
 * parameters, preset and options is rendered once. Pure: keys, file names,
 * the size limit and which files to evict. The main process owns the folder.
 */

import { createHash } from 'node:crypto';
import type { ImageStamp } from './image-slot';
import type { TemplateManifest } from './manifest';
import type { RenderOptions } from './render-plan';

export const DEFAULT_CACHE_MAX_MB = 2048;

export interface CacheKeyInput {
  templateId: string;
  /** The whole manifest, so a manifest change (defaults, duration, size) gives a new key. */
  manifest: Pick<TemplateManifest, 'version' | 'duration' | 'fps' | 'aspects' | 'size' | 'parameters' | 'entry'>;
  params: Record<string, unknown>;
  presetId: string;
  options?: RenderOptions;
  /** The chosen images' id, size and modification time (milestone 22), so a replaced logo is a new render. */
  images?: readonly ImageStamp[];
  /** The same for clips a video layer plays (milestone 26): a re-exported clip is a new render. */
  clips?: readonly ImageStamp[];
}

/** Stable key for a render: same inputs, same key. 24 hex characters. */
/** The key for a media item rendered itself (milestone 15): the file as it is, the preset, the options and the collected choice. */
export function mediaCacheKey(input: { id: string; size: number; mtimeMs: number; presetId: string; options?: RenderOptions; params: Record<string, unknown> }): string {
  const params = Object.fromEntries(Object.entries(input.params).sort(([a], [b]) => a.localeCompare(b)));
  const payload = JSON.stringify({ media: input.id, size: input.size, mtime: input.mtimeMs, preset: input.presetId, o: input.options ?? {}, p: params });
  return createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

export function cacheKey(input: CacheKeyInput): string {
  const params = Object.fromEntries(Object.entries(input.params).sort(([a], [b]) => a.localeCompare(b)));
  const images = [...(input.images ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const clips = [...(input.clips ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const payload = JSON.stringify({ t: input.templateId, m: input.manifest, p: params, preset: input.presetId, o: input.options ?? {}, i: images, c: clips });
  return createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

/**
 * A clean file name for a cached render: the template's name, lowercased with
 * dashes, plus the extension; "-2", "-3" when another render already uses
 * that name. Editors show this name as the clip name, so no hash prefix.
 */
export function cacheFileName(templateName: string, extension: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    templateName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'render';
  let name = `${base}${extension}`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}-${n}${extension}`;
  return name;
}

/** The index file in the cache folder: cache key to file name, so the same render is found again by key. */
export const CACHE_INDEX_FILE = '.index.json';

export function sanitizeCacheIndex(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/^[0-9a-f]{24}$/.test(k) && typeof v === 'string' && v && !v.includes('/') && !v.includes('\\') && !v.startsWith('.')) out[k] = v;
  }
  return out;
}

export interface CachedFile {
  path: string;
  bytes: number;
  mtimeMs: number;
}

/** Oldest files to delete so the total fits under the limit. */
export function planEviction(files: readonly CachedFile[], maxBytes: number, keep: ReadonlySet<string> = new Set()): string[] {
  let total = files.reduce((n, f) => n + f.bytes, 0);
  if (total <= maxBytes) return [];
  const victims: string[] = [];
  for (const f of [...files].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= maxBytes) break;
    if (keep.has(f.path)) continue;
    victims.push(f.path);
    total -= f.bytes;
  }
  return victims;
}

/** A cache limit from settings: a positive number of MiB, else the default. */
export function sanitizeCacheMaxMB(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 64 ? Math.round(n) : DEFAULT_CACHE_MAX_MB;
}

