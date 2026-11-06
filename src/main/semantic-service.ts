/**
 * Semantic search on this machine (milestone 9, decision record 0024): the
 * embedding model fetched on request with its checksum held to the pinned
 * one, run by llama.cpp's command-line program found on PATH the way ffmpeg
 * and whisper.cpp are, the library's vectors kept in the library database,
 * and a query answered as ids with how close each item's meaning came.
 *
 * **Nothing is sent anywhere.** The setting is off by default; turned on, the
 * only network request Pulp ever makes for it is the model file itself, from
 * the publisher named in src/core/semantic.ts, after the person has said yes
 * in Settings — the embedding of the library and of every query is a local
 * child process over local text.
 */

import { BrowserWindow, app, net } from 'electron';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { runForBuffer } from '../core/ffmpeg';
import { tr } from '../core/i18n';
import type { LibraryEntry } from '../core/library-types';
import {
  cosine, embeddingArgs, packVector, parseEmbeddings, SEMANTIC_LIMIT, SEMANTIC_MIN_QUERY, SEMANTIC_MODEL,
  SEMANTIC_QUERY_PREFIX, semanticRunnerMissingMessage, semanticRunnerPaths, semanticTextFor, unpackVector,
  type SemanticHit,
} from '../core/semantic';
import { getLibrary, semanticStoreAll, semanticStoreMissing, semanticStoreSet } from './library-service';
import { loadSettings, updateSettings } from './settings';

const FETCH_TIMEOUT_MS = 10 * 60_000;

/** How many items one run of the runner embeds: a fresh process per batch keeps memory flat and progress honest. */
const BATCH = 64;

let progressTo: BrowserWindow | null = null;

export function setSemanticProgressWindow(window: BrowserWindow | null): void {
  progressTo = window;
}

function report(note: string, fraction: number | null): void {
  if (progressTo && !progressTo.isDestroyed()) progressTo.webContents.send('semantic:progress', { note, fraction });
}

function modelDir(): string {
  return join(app.getPath('userData'), 'semantic-models');
}

async function modelFile(): Promise<{ path: string; installed: boolean }> {
  const path = join(modelDir(), SEMANTIC_MODEL.file);
  try {
    const info = await stat(path);
    return { path, installed: info.size === SEMANTIC_MODEL.bytes };
  } catch {
    return { path, installed: false };
  }
}

async function detectRunner(): Promise<{ ok: boolean; path?: string; message?: string }> {
  for (const candidate of semanticRunnerPaths(process.env)) {
    try {
      const result = await runForBuffer(candidate, ['--help']);
      if (result.code === 0) return { ok: true, path: candidate };
    } catch {
      continue;
    }
  }
  return { ok: false, message: semanticRunnerMissingMessage() };
}

export interface SemanticStatus {
  /** The setting as saved: off by default, nothing runs and nothing is fetched while it is. */
  enabled: boolean;
  runner: { ok: boolean; message?: string };
  model: { label: string; bytes: number; license: string; note: string; installed: boolean };
  /** How far the library's vectors have come, while the pass runs; both zero when idle and complete. */
  indexing: { done: number; total: number };
}

let indexing = { done: 0, total: 0 };

export async function semanticStatus(): Promise<SemanticStatus> {
  const [settings, runner, file] = await Promise.all([loadSettings(), detectRunner(), modelFile()]);
  return {
    enabled: settings.semanticSearch,
    runner: { ok: runner.ok, ...(runner.message ? { message: runner.message } : {}) },
    model: {
      label: SEMANTIC_MODEL.label,
      bytes: SEMANTIC_MODEL.bytes,
      license: SEMANTIC_MODEL.license,
      note: SEMANTIC_MODEL.note,
      installed: file.installed,
    },
    indexing,
  };
}

/** Turn the setting; turning it on starts the library pass when the runner and the model are there. */
export async function setSemanticSearch(raw: unknown): Promise<SemanticStatus> {
  const enabled = raw === true;
  await updateSettings((s) => ({ ...s, semanticSearch: enabled }));
  if (enabled) void indexLibrary();
  return semanticStatus();
}

/** Fetch the model, once the person has said yes; the speech model's own rules (ADR 0021) hold here. */
export async function fetchSemanticModel(): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const dir = modelDir();
  const target = join(dir, SEMANTIC_MODEL.file);
  const existing = await modelFile();
  if (existing.installed) return { ok: true, path: target };
  await mkdir(dir, { recursive: true });
  const partial = `${target}.part`;
  const hash = createHash('sha256');
  let received = 0;
  try {
    const response = await net.fetch(SEMANTIC_MODEL.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!response.ok || !response.body) {
      return { ok: false, message: tr('fetch.semantic.server', { status: response.status }) };
    }
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      received += chunk.length;
      report(tr('fetch.semantic.fetching', { model: SEMANTIC_MODEL.label }), Math.min(1, received / SEMANTIC_MODEL.bytes));
    });
    await pipeline(body, createWriteStream(partial));
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    return { ok: false, message: tr('fetch.semantic.failed', { reason: (error as Error).message }) };
  }
  const digest = hash.digest('hex');
  if (received !== SEMANTIC_MODEL.bytes || digest !== SEMANTIC_MODEL.sha256) {
    await rm(partial, { force: true }).catch(() => undefined);
    return { ok: false, message: tr('fetch.semantic.checksum') };
  }
  await rename(partial, target);
  report(tr('fetch.semantic.ready', { model: SEMANTIC_MODEL.label }), 1);
  void indexLibrary();
  return { ok: true, path: target };
}

/** Run the embedder over one batch of lines, through a prompts file so no text rides a command line. */
async function embed(runner: string, model: string, lines: string[]): Promise<Float32Array[] | null> {
  const file = join(tmpdir(), `pulp-embed-${process.pid}-${Date.now()}.txt`);
  try {
    await writeFile(file, lines.map((l) => l.replace(/[\r\n]+/g, ' ')).join('\n'));
    const run = await runForBuffer(runner, embeddingArgs(model, file));
    if (run.code !== 0) return null;
    return parseEmbeddings(run.stdout.toString('utf8'), lines.length, SEMANTIC_MODEL.dims);
  } finally {
    await rm(file, { force: true }).catch(() => undefined);
  }
}

/** The vectors as last loaded, invalidated when one is written, so a search reads the matrix once. */
let matrix: { ids: string[]; vectors: Float32Array[] } | null = null;

let passRunning = false;

/**
 * Embed what the library holds and has not embedded: after the setting turns
 * on, after the model lands, and after a scan. One pass at a time, in batches,
 * each written under the item's stat signature so a changed file re-embeds.
 */
export async function indexLibrary(): Promise<void> {
  if (passRunning) return;
  passRunning = true;
  try {
    const settings = await loadSettings();
    if (!settings.semanticSearch) return;
    const [runner, file] = await Promise.all([detectRunner(), modelFile()]);
    if (!runner.ok || !runner.path || !file.installed) return;
    const missing = semanticStoreMissing(SEMANTIC_MODEL.id);
    if (missing.length === 0) return;
    const index = await getLibrary();
    const byId = new Map<string, LibraryEntry>([...index.templates, ...index.media].map((e) => [e.id, e]));
    indexing = { done: 0, total: missing.length };
    for (let at = 0; at < missing.length; at += BATCH) {
      const batch = missing.slice(at, at + BATCH).filter((m) => byId.has(m.id));
      if (batch.length === 0) {
        indexing = { done: Math.min(missing.length, at + BATCH), total: missing.length };
        continue;
      }
      const vectors = await embed(runner.path, file.path, batch.map((m) => semanticTextFor(byId.get(m.id)!)));
      if (!vectors) return;
      batch.forEach((m, i) => semanticStoreSet(m.key, SEMANTIC_MODEL.id, packVector(vectors[i]!)));
      matrix = null;
      indexing = { done: Math.min(missing.length, at + BATCH), total: missing.length };
      report(tr('semantic.indexing', { done: indexing.done, total: indexing.total }), indexing.done / indexing.total);
    }
    report(tr('semantic.indexed'), null);
  } finally {
    indexing = { done: 0, total: 0 };
    passRunning = false;
  }
}

/** The last few queries' vectors, so arrowing back through a search costs nothing. */
const queryCache = new Map<string, Float32Array>();

/**
 * The meaning search: the free text embedded (with the prefix the model was
 * trained to take questions in), every indexed item scored, the best answered.
 * An empty answer — setting off, runner or model missing, text too short — is
 * simply no semantic word on the results, never an error in the search path.
 */
export async function semanticSearch(raw: unknown): Promise<{ hits: SemanticHit[] }> {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (text.length < SEMANTIC_MIN_QUERY) return { hits: [] };
  const settings = await loadSettings();
  if (!settings.semanticSearch) return { hits: [] };
  const [runner, file] = await Promise.all([detectRunner(), modelFile()]);
  if (!runner.ok || !runner.path || !file.installed) return { hits: [] };
  let query = queryCache.get(text);
  if (!query) {
    const vectors = await embed(runner.path, file.path, [`${SEMANTIC_QUERY_PREFIX}${text}`]);
    if (!vectors) return { hits: [] };
    query = vectors[0]!;
    queryCache.set(text, query);
    if (queryCache.size > 16) queryCache.delete(queryCache.keys().next().value!);
  }
  if (!matrix) {
    const rows = semanticStoreAll(SEMANTIC_MODEL.id);
    const ids: string[] = [];
    const vectors: Float32Array[] = [];
    for (const row of rows) {
      const vec = unpackVector(row.vec, SEMANTIC_MODEL.dims);
      if (!vec) continue;
      ids.push(row.id);
      vectors.push(vec);
    }
    matrix = { ids, vectors };
  }
  const hits: SemanticHit[] = [];
  for (let i = 0; i < matrix.ids.length; i++) {
    hits.push({ id: matrix.ids[i]!, score: Math.round(cosine(query, matrix.vectors[i]!) * 10_000) / 10_000 });
  }
  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, SEMANTIC_LIMIT) };
}

/** A scan may have brought new items: embed them, when the setting is on. Called beside library:changed. */
export function semanticOnLibraryChanged(): void {
  matrix = null;
  void indexLibrary();
}
