/**
 * The app's library: a persistent SQLite index in user data (ADR 0007), kept
 * current by incremental rescans. Rescans run on demand, when a watched root
 * changes, when the app window gains focus (if the last scan is older than a
 * few seconds), and when a root that had gone missing is back. Every scan
 * result is pushed to the UI as `library:changed`.
 *
 * Headless mode uses an in-memory store so `--library` folders are indexed
 * for that run only and nothing in user data is touched.
 */

import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { detectFfmpeg, nodeRunner, runForBuffer, runWithInput, runWithInputForBuffer } from '../core/ffmpeg';
import { MAX_IMAGE_FILE_BYTES, type ImportedImage } from '../core/image-slot';
import { itemId, mediaKindForPath } from '../core/library-scan';
import { LibraryStore, type ScanStats } from '../core/library-store';
import { ffprobePathFor, probeMedia } from '../core/media-probe';
import { mediaThumbArgs, thumbFileName } from '../core/thumbnails';
import { choosePosterFrame, contentCrop, isNearlyUniform, measureFrame, posterCandidateFrames, posterFromFrameArgs, PROBE_HEIGHT, PROBE_WIDTH, probeFrameArgs, type FrameMeasure } from '../core/poster';
import { canHaveStrip, framesStripArgs, mediaStripArgs, sequenceStripArgs, stripFileName, stripFrameIndices, stripUrlFor, wantsStrip } from '../core/hover-scrub';
import { SEQUENCE_FPS, sequenceFrameName, sequenceMetadata, sequencePatternName, sequencePosterFrame } from '../core/media-sequence';
import { encodePeaks, peaksFromPcm, wantsWaveform, waveformArgs } from '../core/waveform';
import { captureTemplateFrames } from './render';
import { templateDefaultSize } from '../core/aspect';
import type { LibraryEntry, LibraryIndex, MediaEntry, TemplateEntry } from '../core/library-types';
import type { HoverStripResult, WaveformResult } from '../shared/api';
import type { MediaLookup } from '../core/media-serve';
import { watchRoot, type RootWatcher } from '../core/library-watch';
import { normalizeTag } from '../core/tags';
import { normalizeTheme } from '../core/taxonomy';
import { loadSettings, updateSettings } from './settings';

/** Folder of sample templates shipped with the app. */
export function bundledTemplatesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'templates') : join(app.getAppPath(), 'templates');
}

/** The bundled fonts (src/core/fonts.ts, ADR 0014), beside the bundled templates. */
export function bundledFontsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'fonts') : join(app.getAppPath(), 'fonts');
}

/** How long a scan result counts as fresh when the window regains focus. */
export const FOCUS_RESCAN_AGE_MS = 5_000;
/** How often missing roots are checked for having come back. */
export const OFFLINE_ROOT_POLL_MS = 15_000;
/** ffprobe processes run at once while filling in metadata. */
const PROBE_CONCURRENCY = 2;
/** Metadata results are pushed to the UI in batches of this many. */
const PROBE_BATCH = 25;

let store: LibraryStore | null = null;
let persistent = true;
let extraRoots: string[] = [];
let firstScan: Promise<LibraryIndex> | null = null;
let lastScanAt = 0;
let lastStats: ScanStats | null = null;
const watchers = new Map<string, RootWatcher>();
let monitor: ReturnType<typeof setInterval> | null = null;
/** Scans run one at a time, in order. */
let chain: Promise<unknown> = Promise.resolve();
let probing = false;
let ffprobe: string | null | undefined;
let thumbnailing = false;
let ffmpegPath: string | null | undefined;

/**
 * Offscreen renders and ffmpeg runs take turns. A poster queue working through
 * a whole library and a hover-scrub strip rendering at the same time share one
 * machine badly: on a two-core runner each made the other slow enough to outlast
 * any sensible wait (docs/platform-notes.md). The queue takes a turn per item,
 * so a hover waits for the poster in progress, not for the whole queue.
 */
let heavyChain: Promise<unknown> = Promise.resolve();
/** What the heavy chain is doing, for diagnostics: how many are waiting, and what runs now since when. */
let heavyWaiting = 0;
let heavyCurrent: { label: string; since: number } | null = null;

function heavyWork<T>(work: () => Promise<T>, label = 'work'): Promise<T> {
  heavyWaiting++;
  const next = heavyChain.then(async () => {
    heavyWaiting--;
    heavyCurrent = { label, since: Date.now() };
    try {
      return await work();
    } finally {
      heavyCurrent = null;
    }
  });
  heavyChain = next.catch(() => undefined);
  return next;
}

/** A snapshot of the background work, for the status bar's diagnostics and for a stuck test to print. */
export interface LibraryDiagnostics {
  thumbnailing: boolean;
  probing: boolean;
  pendingThumbnails: number;
  pendingMetadata: number;
  heavyWaiting: number;
  heavyCurrent: { label: string; forMs: number } | null;
  roots: { path: string; online: boolean }[];
}

export function libraryDiagnostics(): LibraryDiagnostics {
  const st = getStore();
  return {
    thumbnailing,
    probing,
    pendingThumbnails: st.pendingThumbnails(1000).length,
    pendingMetadata: st.pendingMetadata(1000).length,
    heavyWaiting,
    heavyCurrent: heavyCurrent ? { label: heavyCurrent.label, forMs: Date.now() - heavyCurrent.since } : null,
    roots: st.roots().map((r) => ({ path: r.path, online: r.online })),
  };
}

/** Folder of cached thumbnails inside user data. */
export function thumbnailDir(): string {
  return join(app.getPath('userData'), 'thumbnails');
}

/** Headless mode: no database on disk; `--library` folders are indexed for the run only. */
export function useInMemoryLibrary(): void {
  persistent = false;
}

function getStore(): LibraryStore {
  if (!store) {
    store = new LibraryStore(persistent ? join(app.getPath('userData'), 'library.sqlite') : ':memory:');
    store.setBuiltInRoot(bundledTemplatesDir());
  }
  return store;
}

/** Installed template packs; an implicit root like the bundled samples. */
export function packsRoot(): string {
  return join(app.getPath('userData'), 'packs');
}

/** Files chosen from outside the library for an image slot are copied here, so the library stays the only thing a template may see. */
export function importedRoot(): string {
  return join(app.getPath('userData'), 'imported');
}

/** The stills in the Imported folder, by file name, for CSV cells that name a logo by file (milestone 22). */
export function importedImages(): ImportedImage[] {
  const root = importedRoot();
  return getStore()
    .toIndex()
    .media.filter((m) => m.mediaKind === 'image' && m.root === root && !m.offline)
    .map((m) => ({ name: basename(m.path), id: m.id }));
}

/**
 * Copy a file into the Imported folder and index it; resolves to the item's id,
 * or null when the file is not an image. A name clash keeps both files.
 */
export async function importImageFile(source: string): Promise<{ id: string } | { error: string }> {
  if (mediaKindForPath(source) !== 'image') return { error: 'Only image files can be used in an image slot.' };
  let info;
  try {
    info = await stat(source);
  } catch {
    return { error: 'That file could not be read.' };
  }
  if (!info.isFile()) return { error: 'That is not a file.' };
  if (info.size > MAX_IMAGE_FILE_BYTES) return { error: `Images over ${MAX_IMAGE_FILE_BYTES / 1048576} MB are not loaded.` };
  await mkdir(importedRoot(), { recursive: true });
  const ext = extname(source);
  const stem = basename(source, ext).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  let target = join(importedRoot(), `${stem}${ext}`);
  for (let n = 2; existsSync(target); n++) target = join(importedRoot(), `${stem}-${n}${ext}`);
  await copyFile(source, target);
  await rescan();
  return { id: itemId(`media:${target}`) };
}

async function configuredRoots(): Promise<string[]> {
  const settings = await loadSettings();
  const roots = [bundledTemplatesDir(), ...settings.libraryFolders, ...extraRoots];
  if (persistent && existsSync(packsRoot())) roots.splice(1, 0, packsRoot());
  // The Imported folder joins headless runs too: a CSV batch names its logos from it.
  if (existsSync(importedRoot())) roots.splice(1, 0, importedRoot());
  return [...new Set(roots)];
}

function broadcast(index: LibraryIndex): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('library:changed', index);
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task);
  chain = next.catch(() => undefined);
  return next;
}

/** Keep one watcher per online root; drop watchers for roots that are gone or no longer configured. */
function syncWatchers(): void {
  const st = getStore();
  const wanted = new Set(st.roots().filter((r) => r.online).map((r) => r.path));
  for (const [root, watcher] of watchers) {
    if (!wanted.has(root)) {
      watcher.close();
      watchers.delete(root);
    }
  }
  for (const root of wanted) {
    if (watchers.has(root)) continue;
    const watcher = watchRoot(root, () => void rescanRoot(root));
    if (watcher) watchers.set(root, watcher);
  }
}

/**
 * Fill in ffprobe metadata for media that has none for its current size and
 * mtime. Runs after scans in the background, a few files at a time, and
 * pushes the index to the UI after each batch. Skipped in headless mode and
 * without ffmpeg.
 */
async function probePendingMetadata(): Promise<void> {
  if (probing || !persistent) return;
  probing = true;
  try {
    if (ffprobe === undefined) {
      const status = await detectFfmpeg();
      ffprobe = status.ok ? ffprobePathFor(status.path) : null;
    }
    if (!ffprobe) return;
    const st = getStore();
    for (;;) {
      const pending = st.pendingMetadata(PROBE_BATCH);
      if (pending.length === 0) break;
      for (let i = 0; i < pending.length; i += PROBE_CONCURRENCY) {
        await Promise.all(
          pending.slice(i, i + PROBE_CONCURRENCY).map(async (entry) => {
            // A sequence is probed through its first frame; the run says how long it runs for.
            const probed = await probeMedia(ffprobe!, entry.path, nodeRunner);
            const meta = entry.sequence ? sequenceMetadata(probed, entry.sequence) : probed;
            st.setMetadata(entry, meta);
          }),
        );
      }
      broadcast(st.toIndex());
    }
  } finally {
    probing = false;
    void generatePendingThumbnails();
  }
}

/**
 * Make thumbnails for items that have none for their current size and mtime,
 * one at a time, in the background after metadata. Media frames come from
 * ffmpeg; template posters are one frame rendered at mid-progress through the
 * normal renderer, then shrunk. Skipped in headless mode and without ffmpeg.
 */
async function generatePendingThumbnails(): Promise<void> {
  if (thumbnailing || !persistent) return;
  thumbnailing = true;
  try {
    if (ffmpegPath === undefined) {
      const status = await detectFfmpeg();
      ffmpegPath = status.ok ? status.path : null;
    }
    if (!ffmpegPath) return;
    const st = getStore();
    const dir = thumbnailDir();
    await mkdir(dir, { recursive: true });
    for (;;) {
      const pending = st.pendingThumbnails(10);
      if (pending.length === 0) break;
      for (const entry of pending) {
        const out = join(dir, thumbFileName(entry.id));
        let ok = false;
        try {
          // A turn per item, not for the whole queue, so a hover-scrub strip can get in between.
          ok = await heavyWork(async () => {
            if (entry.kind === 'media') {
              // A sequence posters from the frame a tenth in, as a clip is sampled a tenth in;
              // that frame is a still image, so nothing is sought within it.
              const seq = entry.sequence;
              const input = seq ? join(seq.dir, sequenceFrameName(seq, sequencePosterFrame(seq.count))) : entry.path;
              const result = await nodeRunner(ffmpegPath!, mediaThumbArgs(input, out, entry.meta?.duration, !seq && entry.mediaKind === 'video'));
              return result.code === 0 && existsSync(out);
            }
            return renderPoster(entry, out);
          }, `thumbnail ${entry.kind === 'media' ? entry.name : entry.manifest.id}`);
        } catch {
          ok = false;
        }
        // Re-read the row: the item may have changed while we worked, in which case the next scan makes it pending again.
        st.setThumbnail(entry, ok ? out : null);
      }
      broadcast(st.toIndex());
    }
  } finally {
    thumbnailing = false;
  }
}

/**
 * A template's poster (milestone 34): frames spread over the timeline — or the
 * one moment `posterAt` names — captured through one offscreen window, each
 * measured for how much it shows, the best taken, and a transparent template's
 * cropped to what it draws. The choosing is pure (src/core/poster.ts).
 */
async function renderPoster(entry: TemplateEntry, out: string): Promise<boolean> {
  const { manifest } = entry;
  const total = Math.max(1, Math.round(manifest.duration * manifest.fps));
  const candidates = posterCandidateFrames(total, manifest.fps, manifest.posterAt);
  const shot = await captureTemplateFrames(entry, candidates, { frameTimeoutMs: 10_000 });
  if (!shot.ok || shot.frames.length === 0) return false;
  const measures: FrameMeasure[] = [];
  for (const frame of shot.frames) {
    const probe = await runWithInputForBuffer(ffmpegPath!, probeFrameArgs(), frame);
    const bytes = new Uint8Array(probe.stdout.buffer, probe.stdout.byteOffset, probe.stdout.byteLength);
    measures.push(probe.code === 0 && bytes.length >= PROBE_WIDTH * PROBE_HEIGHT * 4 ? measureFrame(bytes, PROBE_WIDTH, PROBE_HEIGHT) : { coverage: 0, spread: 0, bbox: null });
  }
  const pick = choosePosterFrame(measures);
  const chosen = measures[pick]!;
  if (isNearlyUniform(chosen)) console.warn(`Poster for ${manifest.id} is nearly uniform at every frame tried; a posterAt in its manifest may help.`);
  const crop = manifest.alpha ? contentCrop(chosen.bbox, templateDefaultSize(manifest)) : null;
  const scaled = await runWithInput(ffmpegPath!, posterFromFrameArgs(out, crop), shot.frames[pick]!);
  return scaled.code === 0 && existsSync(out);
}

/** Replace an item's user tags (normalized, deduplicated) and tell the UI. */
export function setItemTags(id: string, tags: string[]): LibraryIndex {
  const st = getStore();
  const key = st.keyForId(id);
  if (key) st.setUserData(key, { tags: [...new Set(tags.map(normalizeTag).filter((t) => t.length > 0))] });
  const index = st.toIndex();
  broadcast(index);
  return index;
}

export function setItemThemes(id: string, themes: string[]): LibraryIndex {
  const st = getStore();
  const key = st.keyForId(id);
  if (key) st.setUserData(key, { themes: [...new Set(themes.map(normalizeTheme).filter((t) => t.length > 0))] });
  const index = st.toIndex();
  broadcast(index);
  return index;
}

/**
 * The rate a frame sequence is read at (milestone 30). A folder of frames
 * records none, so Pulp states one; this keeps a person's own answer with the
 * item, like a tag. `undefined` goes back to the stated default.
 */
export function setItemSequenceFps(id: string, fps: number | undefined): LibraryIndex {
  const st = getStore();
  const key = st.keyForId(id);
  const clamped = fps === undefined || !Number.isFinite(fps) || fps <= 0 ? undefined : Math.min(240, Math.max(1, Math.round(fps * 1000) / 1000));
  if (key) st.setUserData(key, { sequenceFps: clamped });
  const index = st.toIndex();
  broadcast(index);
  return index;
}

export function setItemFavorite(id: string, favorite: boolean): LibraryIndex {
  const st = getStore();
  const key = st.keyForId(id);
  if (key) st.setUserData(key, { favorite });
  const index = st.toIndex();
  broadcast(index);
  return index;
}

/** One more finished render of this item; the Info tab's Usage section counts them. */
export function markItemRendered(id: string): void {
  const st = getStore();
  const key = st.keyForId(id);
  if (!key) return;
  st.countRender(key);
  broadcast(st.toIndex());
}

/**
 * Where a library item lives on disk, by id. The window never sends a path for
 * Reveal or Copy path — it sends the id and the main process looks it up, so
 * there is nothing to allow-list and nothing to get wrong.
 */
export function itemPath(id: string): string | undefined {
  const entry = getStore().findEntryById(id);
  if (!entry) return undefined;
  return entry.kind === 'template' ? entry.dir : entry.path;
}

/** Record use now and push the index, so `recent:` sorts on current times. */
export function markItemUsed(id: string): void {
  const st = getStore();
  const key = st.keyForId(id);
  if (!key) return;
  st.setUserData(key, { lastUsed: new Date().toISOString() });
  broadcast(st.toIndex());
}

/** For the pulp-thumb:// handler: the cache file behind an id, if any. */
export function lookupThumbnail(id: string): string | undefined {
  return getStore().findThumbnailById(id);
}

/** For the pulp-strip:// handler: the cached hover-scrub strip behind an id, if one was made. */
export function lookupStrip(id: string): string | undefined {
  return getStore().findStripById(id)?.file ?? undefined;
}

/** Strips in flight, so two cards hovered in a row do not render the same template twice. */
const stripsInFlight = new Map<string, Promise<HoverStripResult>>();

/**
 * The hover-scrub strip of an item, made now if it does not exist. Says either
 * where to load it from or why there is none, so a caller — and the end-to-end
 * test — can tell "nothing to scrub" from "it did not work" from "still going".
 *
 * On demand rather than in the background: a template strip costs a render, and
 * most of a library is never pointed at.
 */
export function hoverStrip(id: string): Promise<HoverStripResult> {
  const existing = stripsInFlight.get(id);
  if (existing) return existing;
  const work = makeStrip(id).finally(() => stripsInFlight.delete(id));
  stripsInFlight.set(id, work);
  return work;
}

/** A failure worth remembering: this item cannot produce a strip until it changes. */
function recordFailure(key: string, reason: string): HoverStripResult {
  getStore().setStrip(key, null);
  console.warn(`Hover-scrub strip failed: ${reason}`);
  return { url: null, reason };
}

/**
 * A failure that says nothing about the item: the machine was busy, a timeout
 * ran out. Not recorded, so the next hover tries again — recording it would
 * leave a card that can never scrub, and would look exactly like slowness.
 */
function transientFailure(reason: string): HoverStripResult {
  console.warn(`Hover-scrub strip did not finish: ${reason}`);
  return { url: null, reason, transient: true };
}

async function makeStrip(id: string): Promise<HoverStripResult> {
  if (!persistent) return { url: null, reason: 'headless mode keeps no cache' };
  const st = getStore();
  const cached = st.findStripById(id);
  if (cached) return cached.file ? { url: stripUrlFor(id) } : { url: null, reason: 'a strip for this item failed before and is not retried until it changes' };
  const entry = st.findEntryById(id);
  if (!entry) return { url: null, reason: `no library item with id ${id}` };
  // "Nothing to scrub" is only final for a still or a sound. A clip waiting to be
  // probed, or a folder that has gone offline, is "not yet": the card must ask again.
  if (!wantsStrip(entry)) {
    return canHaveStrip(entry)
      ? { url: null, reason: entry.offline ? 'its folder is offline' : 'the clip has not been probed for a duration yet', transient: true }
      : { url: null };
  }
  if (ffmpegPath === undefined) {
    const status = await detectFfmpeg();
    ffmpegPath = status.ok ? status.path : null;
  }
  if (!ffmpegPath) return transientFailure('ffmpeg was not found');

  const dir = thumbnailDir();
  await mkdir(dir, { recursive: true });
  const out = join(dir, stripFileName(id));
  let result: HoverStripResult;
  try {
    // One piece of heavy work at a time: a strip that fought the poster queue for a
    // two-core machine could outlast any sensible wait (docs/platform-notes.md).
    result = await heavyWork(() =>
      entry.kind === 'media' ? mediaStrip(entry, out) : templateStrip(entry, out),
    );
  } catch (err) {
    return recordFailure(entry.key, `${entry.key}: ${(err as Error).message}`);
  }
  if (result.url === null && !result.transient) return recordFailure(entry.key, `${entry.key}: ${result.reason ?? 'unknown'}`);
  if (result.url === null) return result;
  st.setStrip(entry.key, out);
  return { url: stripUrlFor(id) };
}

async function mediaStrip(entry: MediaEntry, out: string): Promise<HoverStripResult> {
  const duration = entry.meta?.duration ?? 0;
  const seq = entry.sequence;
  const args = seq
    ? sequenceStripArgs(join(seq.dir, sequencePatternName(seq)), seq.start, out, duration, entry.meta?.fps ?? SEQUENCE_FPS)
    : mediaStripArgs(entry.path, out, duration);
  const result = await nodeRunner(ffmpegPath!, args);
  if (result.code !== 0) return { url: null, reason: `ffmpeg exited with ${result.code}: ${result.stderr.trim() || 'no error output'}` };
  if (!existsSync(out)) return { url: null, reason: 'ffmpeg wrote no strip' };
  return { url: out };
}

/**
 * Frames spread over the template's timeline, captured through one offscreen
 * window, then piped to ffmpeg as one PNG stream and tiled. No scratch folder:
 * nothing to name, nothing to clean up, nothing to get wrong on Windows.
 */
async function templateStrip(entry: TemplateEntry, out: string): Promise<HoverStripResult> {
  const total = Math.max(1, Math.round(entry.manifest.duration * entry.manifest.fps));
  const shot = await captureTemplateFrames(entry, stripFrameIndices(total), { frameTimeoutMs: 10_000 });
  if (!shot.ok) {
    // A timeout means the machine was busy, not that the template cannot be drawn.
    return shot.timedOut ? { url: null, reason: shot.message, transient: true } : { url: null, reason: shot.message };
  }
  const tiled = await runWithInput(ffmpegPath!, framesStripArgs(out, shot.frames.length), Buffer.concat(shot.frames));
  if (tiled.code !== 0) return { url: null, reason: `ffmpeg exited with ${tiled.code}: ${tiled.stderr.trim() || 'no error output'}` };
  if (!existsSync(out)) return { url: null, reason: 'ffmpeg wrote no strip' };
  return { url: out };
}

/** Waveforms in flight, so a list of audio rows asks for each file once. */
const waveformsInFlight = new Map<string, Promise<WaveformResult>>();

/**
 * An audio file's waveform peaks, taken now if they have not been. Like strips:
 * on demand, cached against the file's size and mtime, and saying why when
 * there are none rather than leaving the caller to guess.
 */
export function waveform(id: string): Promise<WaveformResult> {
  const existing = waveformsInFlight.get(id);
  if (existing) return existing;
  const work = makeWaveform(id).finally(() => waveformsInFlight.delete(id));
  waveformsInFlight.set(id, work);
  return work;
}

async function makeWaveform(id: string): Promise<WaveformResult> {
  if (!persistent) return { peaks: null, reason: 'headless mode keeps no cache' };
  const st = getStore();
  const cached = st.findWaveformById(id);
  if (cached) return cached.peaks ? { peaks: cached.peaks } : { peaks: null, reason: 'ffmpeg could not read this file\'s audio' };
  const entry = st.findEntryById(id);
  if (!entry) return { peaks: null, reason: `no library item with id ${id}` };
  if (!wantsWaveform(entry)) return { peaks: null };
  if (ffmpegPath === undefined) {
    const status = await detectFfmpeg();
    ffmpegPath = status.ok ? status.path : null;
  }
  if (!ffmpegPath) return { peaks: null, reason: 'ffmpeg was not found', transient: true };

  let result: WaveformResult;
  try {
    result = await heavyWork(async () => {
      const decoded = await runForBuffer(ffmpegPath!, waveformArgs((entry as Extract<LibraryEntry, { kind: 'media' }>).path));
      if (decoded.code !== 0) return { peaks: null, reason: `ffmpeg exited with ${decoded.code}: ${decoded.stderr.trim() || 'no error output'}` };
      if (decoded.stdout.length === 0) return { peaks: null, reason: 'the file decoded to no audio' };
      return { peaks: encodePeaks(peaksFromPcm(decoded.stdout)) };
    });
  } catch (err) {
    result = { peaks: null, reason: (err as Error).message };
  }
  if (result.peaks === null && result.transient) return result;
  if (result.peaks === null) console.warn(`Waveform failed: ${entry.key}: ${result.reason ?? 'unknown'}`);
  st.setWaveform(entry.key, result.peaks);
  return result;
}

/** Rescan every configured root (plus `extraFolders` for this run) incrementally and tell the UI. */
export function rescan(extraFolders: string[] = []): Promise<LibraryIndex> {
  if (extraFolders.length > 0) extraRoots = [...new Set([...extraRoots, ...extraFolders])];
  const scan = enqueue(async () => {
    const st = getStore();
    const roots = await configuredRoots();
    st.setRoots(roots);
    lastStats = await st.scanRoots(roots);
    lastScanAt = Date.now();
    syncWatchers();
    const index = st.toIndex();
    broadcast(index);
    void probePendingMetadata();
    return index;
  });
  firstScan ??= scan;
  return scan;
}

/** Rescan one root after its watcher fired. */
function rescanRoot(root: string): Promise<void> {
  return enqueue(async () => {
    const st = getStore();
    await st.scanRoots([root]);
    lastScanAt = Date.now();
    syncWatchers();
    broadcast(st.toIndex());
    void probePendingMetadata();
  });
}

/** Rescan if the last scan is older than `maxAgeMs` (window focus). */
export async function rescanIfStale(maxAgeMs = FOCUS_RESCAN_AGE_MS): Promise<void> {
  if (Date.now() - lastScanAt < maxAgeMs) return;
  await rescan();
}

/** Rescan when a root that was offline exists again. */
export async function rescanIfRootReturned(): Promise<void> {
  const returned = getStore()
    .roots()
    .filter((r) => !r.online && existsSync(r.path));
  if (returned.length > 0) await rescan();
}

/**
 * The index. Stored items are returned at once; the first scan of the session
 * starts in the background and arrives as `library:changed`. With nothing
 * stored yet (first run, headless), the first scan is awaited instead.
 */
export async function getLibrary(): Promise<LibraryIndex> {
  const st = getStore();
  st.setRoots(await configuredRoots());
  const scan = firstScan ?? rescan();
  if (st.itemCount() > 0) return st.toIndex();
  return scan;
}

export async function addLibraryFolder(folder: string): Promise<LibraryIndex> {
  await updateSettings((s) => (s.libraryFolders.includes(folder) ? s : { ...s, libraryFolders: [...s.libraryFolders, folder] }));
  return rescan();
}

/** For the pulp-media:// handler: the stored media item behind an id, if any. */
export function lookupMedia(id: string): MediaLookup | undefined {
  return getStore().findMediaById(id);
}

export async function findTemplate(id: string): Promise<TemplateEntry | undefined> {
  await (firstScan ?? rescan());
  return getStore()
    .toIndex()
    .templates.find((t) => t.manifest.id === id);
}

/** Watch for returning roots. Idempotent. */
export function startLibraryMonitor(): void {
  monitor ??= setInterval(() => void rescanIfRootReturned(), OFFLINE_ROOT_POLL_MS);
}

export function lastScanStats(): ScanStats | null {
  return lastStats;
}

/** Stop watching and close the database (app quit). */
export function closeLibrary(): void {
  if (monitor) clearInterval(monitor);
  monitor = null;
  for (const watcher of watchers.values()) watcher.close();
  watchers.clear();
  store?.close();
  store = null;
}
