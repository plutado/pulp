/**
 * The render cache behind "render and drag": renders made for dragging into
 * an editing app, kept in a folder so the same template with the same
 * parameters, preset and options is rendered once. Pure: keys, file names,
 * the size limit and which files to evict. The main process owns the folder.
 */

import { createHash } from 'node:crypto';
import type { TemplateManifest } from './manifest';
import type { RenderOptions } from './render-plan';

export const DEFAULT_CACHE_MAX_MB = 2048;

export interface CacheKeyInput {
  templateId: string;
  /** The whole manifest, so a manifest change (defaults, duration, size) gives a new key. */
  manifest: Pick<TemplateManifest, 'version' | 'duration' | 'fps' | 'width' | 'height' | 'parameters' | 'entry'>;
  params: Record<string, unknown>;
  presetId: string;
  options?: RenderOptions;
}

/** Stable key for a render: same inputs, same key. 24 hex characters. */
export function cacheKey(input: CacheKeyInput): string {
  const params = Object.fromEntries(Object.entries(input.params).sort(([a], [b]) => a.localeCompare(b)));
  const payload = JSON.stringify({ t: input.templateId, m: input.manifest, p: params, preset: input.presetId, o: input.options ?? {} });
  return createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

/** File (or, for sequences, folder) name for a key: `<key>-<template-id-tail>.<ext>`. */
export function cacheFileName(key: string, templateId: string, extension: string): string {
  const tail = templateId.split('.').pop() ?? 'render';
  return `${key}-${tail}${extension}`;
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

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}
