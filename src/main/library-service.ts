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
import { performance } from 'node:perf_hooks';
import type { MainPerformance } from '../core/perf';
import { tr } from '../core/i18n';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { clipSetNaturalSeconds, type ClipSetTiming } from '../core/clip-set';
import { listZipFile, readZipMember } from '../core/zip-archive';
import { browsable, browsableFile, unpackForUse, whenUnpacked } from './archive-service';
import { canAddLibrary, defaultLibraryName, driveOf, samePlace, type StockLibrary, type StockLibraryState } from '../core/stock-library';
import { detectFfmpeg, nodeRunner, runForBuffer, runWithInput, runWithInputForBuffer } from '../core/ffmpeg';
import { MAX_IMAGE_FILE_BYTES, type ImportedImage } from '../core/image-slot';
import { itemId, mediaKindForPath } from '../core/library-scan';
import { metadataFromPreview, previewClip, previewSound, thumbnailPreview } from '../core/library-preview';
import { LibraryStore, type ScanStats } from '../core/library-store';
import { ffprobePathFor, probeMedia } from '../core/media-probe';
import { mediaThumbArgs, thumbFileName } from '../core/thumbnails';
import { choosePosterFrame, contentCrop, isNearlyUniform, measureFrame, posterCandidateFrames, posterFromFrameArgs, PROBE_HEIGHT, PROBE_WIDTH, probeFrameArgs, type FrameMeasure } from '../core/poster';
import { canHaveStrip, framesStripArgs, mediaStripArgs, sequenceStripArgs, stripFileName, stripFrameIndices, stripUrlFor, wantsStrip } from '../core/hover-scrub';
import { SEQUENCE_FPS, sequenceFrameName, sequenceMetadata, sequencePatternName, sequencePosterFrame } from '../core/media-sequence';
import { encodePeaks, peaksFromPcm, wantsWaveform, waveformArgs } from '../core/waveform';
import { captureTemplateFrames } from './render';
import { templateDefaultSize } from '../core/aspect';
import { isLayeredPath, layeredFileFor } from './layered-service';

/** A layered file's size and transparency, read from the file itself: ffprobe is not asked (milestone 33). */
async function layeredMetadata(path: string): Promise<MediaMetadata | null> {
  const read = await layeredFileFor(path);
  if (!read.ok) return null;
  return { width: read.handle.outline.width, height: read.handle.outline.height, codec: extname(path).slice(1).toLowerCase(), alpha: true };
}
import type { LibraryEntry, LibraryIndex, MediaEntry, TemplateEntry } from '../core/library-types';
import type { MediaMetadata } from '../core/media-meta';
import type { HoverStripResult, WaveformResult } from '../shared/api';
import type { MediaLookup } from '../core/media-serve';
import { watchRoot, type RootWatcher } from '../core/library-watch';
import { normalizeTag } from '../core/tags';
import { normalizeTheme } from '../core/taxonomy';
import { placeableTemplate } from '../core/search';
import { loadSettings, updateSettings } from './settings';
import { bundledFontsDir, bundledTemplatesDir } from './resources';
import { isPolished, studioCrop } from '../core/polished';

export { bundledFontsDir, bundledTemplatesDir };

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
  if (mediaKindForPath(source) !== 'image') return { error: tr('import.image.not-an-image') };
  let info;
  try {
    info = await stat(source);
  } catch {
    return { error: tr('import.image.unreadable') };
  }
  if (!info.isFile()) return { error: tr('import.image.not-a-file') };
  if (info.size > MAX_IMAGE_FILE_BYTES) return { error: tr('import.image.too-large', { max: MAX_IMAGE_FILE_BYTES / 1048576 }) };
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
  const roots = [bundledTemplatesDir(), ...settings.libraryFolders, ...settings.stockLibraries.map((l) => l.path), ...extraRoots];
  if (persistent && existsSync(packsRoot())) roots.splice(1, 0, packsRoot());
  // The Imported folder joins headless runs too: a CSV batch names its logos from it.
  if (existsSync(importedRoot())) roots.splice(1, 0, importedRoot());
  return [...new Set(roots)];
}

/**
 * The index as the window gets it: the store's, and every stock library with whether it is there
 * now and how many items Pulp knows in it, so one on a drive that is not connected stays listed.
 */
async function withLibraries(index: LibraryIndex): Promise<LibraryIndex> {
  const settings = await loadSettings();
  if (settings.stockLibraries.length === 0) return index;
  const roots = new Map(getStore().roots().map((r) => [resolve(r.path), r.online]));
  const counted = new Map<string, number>();
  const missing = new Map<string, number>();
  for (const e of [...index.templates, ...index.media]) counted.set(e.root, (counted.get(e.root) ?? 0) + 1);
  for (const m of index.media) if (m.missing) missing.set(m.root, (missing.get(m.root) ?? 0) + 1);
  const stockLibraries: StockLibraryState[] = settings.stockLibraries.map((l) => {
    const drive = driveOf(l.path);
    return { ...l, online: roots.get(resolve(l.path)) ?? existsSync(l.path), items: counted.get(resolve(l.path)) ?? 0, ...(missing.get(resolve(l.path)) ? { missing: missing.get(resolve(l.path)) } : {}), ...(drive ? { drive: drive.name } : {}) };
  });
  return { ...index, stockLibraries };
}

function broadcast(index: LibraryIndex): void {
  void withLibraries(index).then(send);
}

function send(index: LibraryIndex): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('library:changed', index);
    // A scan may have brought or changed items: the semantic pass catches up (milestone 9),
    // and only runs when its setting is on. Imported lazily: a cycle would hold the boot.
    void import('./semantic-service').then((m) => m.semanticOnLibraryChanged());
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
            // An item with a preview is measured from it (milestone 32): the length a preview clip
            // or sound shares with the file, and nothing more. The file itself is read when the
            // item is placed or rendered (prepareForUse).
            if (entry.preview) {
              const small = entry.preview.media;
              st.setMetadata(entry, metadataFromPreview(small ? await probeMedia(ffprobe!, small, nodeRunner) : null));
              return;
            }
            // A sequence is probed through its first frame; the run says how long it runs for.
            // A clip set is probed part by part, and measured as the three once (milestone 32).
            if (entry.clipSet) {
              st.setMetadata(entry, await probeClipSet(ffprobe!, entry));
              return;
            }
            // A file inside an archive is read from Pulp's scratch copy: browsing never unpacks (milestone 32).
            const file = await browsableFile(entry).catch(() => entry.path);
            const probed = isLayeredPath(file) ? await layeredMetadata(file) : await probeMedia(ffprobe!, file, nodeRunner);
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
 * A clip set's measurements (milestone 32): each part probed, the loop's picture and rate standing
 * for the set's, its length the three parts once, and each part's own length kept for the timing.
 * Null when the loop cannot be read, as for any unreadable clip.
 */
export async function probeClipSet(ffprobePath: string, entry: MediaEntry): Promise<MediaMetadata | null> {
  // A set of several layers (milestone 32) is probed layer by layer; the bottom one's picture and
  // rate stand for the set's, and the longest layer's parts are its timing.
  const sets = entry.clipSetLayers?.map((l) => l.files) ?? [entry.clipSet!];
  const probed = await Promise.all(sets.map((set) => Promise.all([
    set.intro ? probeMedia(ffprobePath, set.intro, nodeRunner) : Promise.resolve(null),
    probeMedia(ffprobePath, set.loop, nodeRunner),
    set.outro ? probeMedia(ffprobePath, set.outro, nodeRunner) : Promise.resolve(null),
  ])));
  const [, baseLoop] = probed[0]!;
  if (!baseLoop?.duration || probed.some(([, loop]) => !loop?.duration)) return null;
  const timings: ClipSetTiming[] = probed.map(([intro, loop, outro]) => ({ intro: intro?.duration ?? 0, loop: loop!.duration!, outro: outro?.duration ?? 0 }));
  const parts = timings.reduce((longest, t) => (clipSetNaturalSeconds(t) > clipSetNaturalSeconds(longest) ? t : longest));
  const alpha = probed.some(([intro, loop, outro]) => Boolean(loop?.alpha || intro?.alpha || outro?.alpha));
  return { ...baseLoop, duration: clipSetNaturalSeconds(parts), parts, ...(timings.length > 1 ? { layers: timings } : {}), alpha };
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
      // What the person selected comes first: posters are made one per heavy turn, in library
      // order, and a template's takes several captured frames — on a slow machine a whole
      // library's queue can outlast any sensible wait for the one poster being looked at
      // (Windows CI, October 2026). Selection (markItemUsed) asks for that item's turn.
      const ahead = thumbnailsFirst.length > 0 ? st.pendingThumbnails(2000).filter((e) => thumbnailsFirst.includes(e.id)) : [];
      thumbnailsFirst.length = 0;
      for (const listed of ahead.length > 0 ? ahead : pending) {
        // An archive's file is thumbnailed from the scratch copy (milestone 32).
        const entry = listed.kind === 'media' ? await browsable(listed).catch(() => listed) : listed;
        const out = join(dir, thumbFileName(entry.id));
        let ok = false;
        try {
          // A turn per item, not for the whole queue, so a hover-scrub strip can get in between.
          ok = await heavyWork(async () => {
            // A file Pulp cannot read shows its preview (milestone 32): a picture or clip beside it,
            // or the thumbnail inside it; read for the poster only, never written into the library.
            if (entry.kind === 'media' && entry.unreadable?.preview) {
              const preview = entry.unreadable.preview;
              if ('file' in preview) {
                const result = await nodeRunner(ffmpegPath!, mediaThumbArgs(preview.file, out, undefined, /\.(mp4|mov|m4v|webm)$/i.test(preview.file)));
                return result.code === 0 && existsSync(out);
              }
              const member = (await listZipFile(preview.zip)).find((m) => m.name === preview.member);
              if (!member) return false;
              const scaled = await runWithInput(ffmpegPath!, posterFromFrameArgs(out, null), await readZipMember(preview.zip, member));
              return scaled.code === 0 && existsSync(out);
            }
            // An item with a preview is pictured from it (milestone 32): its still, else a frame of its
            // preview clip. The full file is not read.
            const small = entry.kind === 'media' ? thumbnailPreview(entry) : null;
            if (small && entry.kind === 'media') {
              const result = await nodeRunner(ffmpegPath!, mediaThumbArgs(small.file, out, small.isClip ? entry.meta?.duration : undefined, small.isClip));
              return result.code === 0 && existsSync(out);
            }
            if (entry.kind === 'media' && isLayeredPath(entry.path)) {
              // A layered file's thumbnail is its composite as the file shows it, shrunk like a poster (milestone 33).
              const read = await layeredFileFor(entry.path);
              if (!read.ok) return false;
              const scaled = await runWithInput(ffmpegPath!, posterFromFrameArgs(out, null), await read.handle.composite());
              return scaled.code === 0 && existsSync(out);
            }
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
        // A selection arriving mid-batch jumps ahead at the next item, not after the batch.
        if (thumbnailsFirst.length > 0) break;
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
  // A polished piece takes the set's one framing (milestone 61); every other transparent poster is cropped to what it draws.
  const crop = !manifest.alpha ? null : isPolished(entry) ? studioCrop(templateDefaultSize(manifest)) : contentCrop(chosen.bbox, templateDefaultSize(manifest));
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
/**
 * The media item at a path a project remembered (milestone 49's relinking):
 * an id is the hash of its path, so the path a cut kept names the id the file
 * has wherever it is now — once its folder is back in the library.
 */
export function findMediaIdByPath(path: string): { id: string; path: string } | undefined {
  const id = itemId(`media:${path}`);
  const found = getStore().findMediaById(id);
  return found && found.online ? { id, path: found.entry.path } : undefined;
}

export function itemPath(id: string): string | undefined {
  const entry = getStore().findEntryById(id);
  if (!entry) return undefined;
  return entry.kind === 'template' ? (entry.lottie?.path ?? entry.dir) : entry.path;
}

/** Selections waiting to jump the thumbnail queue, newest kept; see generatePendingThumbnails. */
const thumbnailsFirst: string[] = [];

/** Record use now and push the index, so `recent:` sorts on current times. */
export function markItemUsed(id: string): void {
  const st = getStore();
  const key = st.keyForId(id);
  if (!key) return;
  st.setUserData(key, { lastUsed: new Date().toISOString() });
  // The poster of what was just selected should not wait for the whole library's queue.
  if (!thumbnailsFirst.includes(id)) thumbnailsFirst.push(id);
  if (thumbnailsFirst.length > 16) thumbnailsFirst.shift();
  void generatePendingThumbnails();
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
  if (!persistent) return { url: null, reason: 'headless mode keeps no cache' }; // i18n-exempt(diagnostic)
  const st = getStore();
  const cached = st.findStripById(id);
  if (cached) return cached.file ? { url: stripUrlFor(id) } : { url: null, reason: 'a strip for this item failed before and is not retried until it changes' }; // i18n-exempt(diagnostic)
  const entry = st.findEntryById(id);
  if (!entry) return { url: null, reason: `no library item with id ${id}` }; // i18n-exempt(diagnostic)
  // "Nothing to scrub" is only final for a still or a sound. A clip waiting to be
  // probed, or a folder that has gone offline, is "not yet": the card must ask again.
  if (!wantsStrip(entry)) {
    return canHaveStrip(entry)
      ? { url: null, reason: entry.offline ? 'its folder is offline' : 'the clip has not been probed for a duration yet', transient: true } // i18n-exempt(diagnostic)
      : { url: null };
  }
  if (ffmpegPath === undefined) {
    const status = await detectFfmpeg();
    ffmpegPath = status.ok ? status.path : null;
  }
  if (!ffmpegPath) return transientFailure('ffmpeg was not found'); // i18n-exempt(diagnostic)

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

async function mediaStrip(listed: MediaEntry, out: string): Promise<HoverStripResult> {
  const entry = await browsable(listed);
  const duration = entry.meta?.duration ?? 0;
  const seq = entry.sequence;
  // A clip with a preview clip scrubs through it (milestone 32); the full file stays unread.
  const small = previewClip(entry);
  const args = small
    ? mediaStripArgs(small, out, duration)
    : seq
      ? sequenceStripArgs(join(seq.dir, sequencePatternName(seq)), seq.start, out, duration, entry.meta?.fps ?? SEQUENCE_FPS)
      : mediaStripArgs(entry.path, out, duration);
  const result = await nodeRunner(ffmpegPath!, args);
  if (result.code !== 0) return { url: null, reason: `ffmpeg exited with ${result.code}: ${result.stderr.trim() || 'no error output'}` }; // i18n-exempt(diagnostic)
  if (!existsSync(out)) return { url: null, reason: 'ffmpeg wrote no strip' }; // i18n-exempt(diagnostic)
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
  if (tiled.code !== 0) return { url: null, reason: `ffmpeg exited with ${tiled.code}: ${tiled.stderr.trim() || 'no error output'}` }; // i18n-exempt(diagnostic)
  if (!existsSync(out)) return { url: null, reason: 'ffmpeg wrote no strip' }; // i18n-exempt(diagnostic)
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
  if (!persistent) return { peaks: null, reason: 'headless mode keeps no cache' }; // i18n-exempt(diagnostic)
  const st = getStore();
  const cached = st.findWaveformById(id);
  if (cached) return cached.peaks ? { peaks: cached.peaks } : { peaks: null, reason: 'ffmpeg could not read this file\'s audio' }; // i18n-exempt(diagnostic)
  const entry = st.findEntryById(id);
  if (!entry) return { peaks: null, reason: `no library item with id ${id}` }; // i18n-exempt(diagnostic)
  if (!wantsWaveform(entry)) return { peaks: null };
  if (ffmpegPath === undefined) {
    const status = await detectFfmpeg();
    ffmpegPath = status.ok ? status.path : null;
  }
  if (!ffmpegPath) return { peaks: null, reason: 'ffmpeg was not found', transient: true }; // i18n-exempt(diagnostic)

  let result: WaveformResult;
  try {
    result = await heavyWork(async () => {
      // A sound with a preview sound is drawn from it (milestone 32); the full file stays unread.
      const sound = entry as Extract<LibraryEntry, { kind: 'media' }>;
      const decoded = await runForBuffer(ffmpegPath!, waveformArgs(previewSound(sound) ?? (await browsableFile(sound))));
      if (decoded.code !== 0) return { peaks: null, reason: `ffmpeg exited with ${decoded.code}: ${decoded.stderr.trim() || 'no error output'}` }; // i18n-exempt(diagnostic)
      if (decoded.stdout.length === 0) return { peaks: null, reason: 'the file decoded to no audio' }; // i18n-exempt(diagnostic)
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
    const index = await withLibraries(st.toIndex());
    send(index);
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

/**
 * Rescan when a root has come or gone: one that was offline exists again (a drive plugged back in),
 * or one that was online does not (a drive ejected). Either way the window is told at once, so a
 * stock library says it is not connected while it is not, and comes back when it is.
 */
export async function rescanIfRootReturned(): Promise<void> {
  const changed = getStore()
    .roots()
    .filter((r) => r.online !== existsSync(r.path));
  if (changed.length > 0) await rescan();
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
  if (st.itemCount() > 0) return withLibraries(st.toIndex());
  return scan;
}

/** Pulp's own folders, which are never a stock library: its data and the bundled templates. */
function ownFolders(): string[] {
  return [app.getPath('userData'), bundledTemplatesDir()];
}

/**
 * Add a stock library (milestone 32): remembered by its path and read where it lies. Nothing in it
 * is copied, moved or written: the scan reads it, and what Pulp learns stays in its own data.
 */
export async function addStockLibrary(path: string): Promise<{ ok: true; index: LibraryIndex } | { ok: false; why: 'already' | 'inside' | 'contains' | 'own' | 'missing' }> {
  if (!existsSync(path)) return { ok: false, why: 'missing' };
  const settings = await loadSettings();
  const allowed = canAddLibrary(path, settings.stockLibraries, ownFolders());
  if (!allowed.ok) return allowed;
  const library: StockLibrary = { path, name: defaultLibraryName(path), addedAt: new Date().toISOString() };
  // Checked again inside the write: two quick adds both read the settings before either wrote them.
  await updateSettings((s) => (s.stockLibraries.some((l) => samePlace(l.path, path)) ? s : { ...s, stockLibraries: [...s.stockLibraries, library] }));
  return { ok: true, index: await rescan() };
}

/** Forget a stock library: its items leave the window. Its files are not touched. */
export async function removeStockLibrary(path: string): Promise<LibraryIndex> {
  await updateSettings((s) => ({ ...s, stockLibraries: s.stockLibraries.filter((l) => !samePlace(l.path, path)) }));
  return rescan();
}

export async function addLibraryFolder(folder: string): Promise<LibraryIndex> {
  await updateSettings((s) => (s.libraryFolders.includes(folder) ? s : { ...s, libraryFolders: [...s.libraryFolders, folder] }));
  return rescan();
}

/**
 * Make the items among `ids` ready to be used — placed in a graphic, rendered, exported — where
 * browsing left them short (milestone 32): an archive member is unpacked into the library's folder,
 * and an item browsed from its preview has its full file read for its metadata now, in place of
 * what the preview could say. Ids that need neither, or are not media at all, are left alone.
 * Returns the ids that could not be unpacked.
 */
export async function prepareForUse(ids: readonly (string | null | undefined)[]): Promise<string[]> {
  const failed: string[] = [];
  let changed = false;
  for (const id of new Set(ids.filter((i): i is string => typeof i === 'string' && i !== ''))) {
    const found = getStore().findMediaById(id);
    if (!found || !found.online || found.entry.missing || found.entry.unreadable) continue;
    if (found.entry.archive && !(await unpackForUse(found.entry))) {
      failed.push(id);
      continue;
    }
    if (found.entry.preview && (await readFullMetadata(found.entry))) changed = true;
  }
  if (changed) broadcast(getStore().toIndex());
  return failed;
}

/**
 * Read the full file of an item browsed from its preview (milestone 32), once: its size, rate, codec
 * and alpha replace the length its preview gave. True when the index changed. Nothing without ffprobe,
 * and nothing when the file has been read already.
 */
async function readFullMetadata(entry: MediaEntry): Promise<boolean> {
  const st = getStore();
  const known = st.findEntryById(entry.id);
  if (known?.kind === 'media' && known.meta && !known.meta.fromPreview) return false;
  if (ffprobe === undefined) {
    const status = await detectFfmpeg();
    ffprobe = status.ok ? ffprobePathFor(status.path) : null;
  }
  if (!ffprobe) return false;
  let meta: MediaMetadata | null;
  if (entry.clipSet) meta = await probeClipSet(ffprobe, entry);
  else {
    const file = await browsableFile(entry).catch(() => entry.path);
    const probed = isLayeredPath(file) ? await layeredMetadata(file) : await probeMedia(ffprobe, file, nodeRunner);
    meta = entry.sequence ? sequenceMetadata(probed, entry.sequence) : probed;
  }
  if (!meta) return false;
  st.setMetadata(entry, meta);
  return true;
}

/** For the pulp-media:// handler: the stored media item behind an id, if any. */
export function lookupMedia(id: string): MediaLookup | undefined {
  return getStore().findMediaById(id);
}

/**
 * What a layer may play, by library id (milestone 35): a clip from the media,
 * or a Lottie animation, which is a template read from one file and plays like
 * a clip. One lookup, so everything a video layer does — timing, in and out,
 * loop or once, speed, delay, the render cache key — works for either without
 * knowing which it has.
 */
export type ClipLookup =
  | { kind: 'media'; entry: MediaEntry; size: number; mtimeMs: number }
  /** A template drawn offscreen into frames: a Lottie, or an effect or object on transparency. */
  | { kind: 'drawn'; entry: TemplateEntry; size: number; mtimeMs: number };

export function lookupClipItem(id: string): ClipLookup | undefined {
  const media = getStore().findMediaById(id);
  if (media) {
    if (!media.online || media.entry.mediaKind !== 'video') return undefined;
    return { kind: 'media', entry: media.entry, size: media.entry.size, mtimeMs: media.entry.mtimeMs };
  }
  // A template that is a finished thing on transparency — a Lottie, or a bundled effect or object
  // (milestone 45) — plays as a layer, drawn offscreen rather than decoded. A graphic with words to
  // fill in is not one. Its root must be reachable, which is a fact about the root rather than the
  // row, so it is asked for here.
  const found = getStore().findTemplateById(id);
  if (!found || !found.online || !placeableTemplate(found.entry)) return undefined;
  const { entry } = found;
  return { kind: 'drawn', entry, size: entry.size ?? 0, mtimeMs: entry.mtimeMs ?? 0 };
}

export async function findTemplate(id: string): Promise<TemplateEntry | undefined> {
  await (firstScan ?? rescan());
  return getStore()
    .toIndex()
    .templates.find((t) => t.manifest.id === id);
}

/** Watch for returning roots. Idempotent. */
/** The semantic pass's view of the store (milestone 9): what still needs a vector, every vector, one written. */
export function semanticStoreMissing(model: string): { key: string; id: string }[] {
  return getStore().embeddingsMissing(model);
}

export function semanticStoreAll(model: string): { id: string; vec: Uint8Array }[] {
  return getStore().embeddingsAll(model);
}

export function semanticStoreSet(key: string, model: string, vec: Uint8Array): void {
  getStore().setEmbedding(key, model, vec);
}

// A member unpacked because it was used (milestone 32): the library reads its folder again, so
// the item says it is there. Coalesced: a render that uses a dozen files rescans once.
let unpackRescan: ReturnType<typeof setTimeout> | null = null;
whenUnpacked(() => {
  if (unpackRescan) clearTimeout(unpackRescan);
  unpackRescan = setTimeout(() => { unpackRescan = null; void rescan(); }, 500);
});

export function startLibraryMonitor(): void {
  monitor ??= setInterval(() => void rescanIfRootReturned(), OFFLINE_ROOT_POLL_MS);
}

export function lastScanStats(): ScanStats | null {
  return lastStats;
}

/**
 * What the main process knows about speed and weight (milestone 58), for the
 * diagnostics' Performance section: the library's size, the last scan's
 * numbers, how long the index takes to build and how large it is as the
 * window receives it — measured now, since asking is rare and the answer is
 * then today's — and what each of Electron's processes holds.
 */
export function libraryPerformance(): MainPerformance {
  const st = getStore();
  const started = performance.now();
  const index = st.toIndex();
  const indexMs = performance.now() - started;
  const indexBytes = JSON.stringify(index).length;
  const metrics = app.getAppMetrics().map((m) => ({ type: m.type, workingSetMB: m.memory.workingSetSize / 1024 }));
  return {
    library: { templates: index.templates.length, media: index.media.length, problems: index.problems.length },
    lastScan: lastStats ? { visited: lastStats.visited, loaded: lastStats.loaded, kept: lastStats.kept, removed: lastStats.removed, ms: lastStats.ms } : null,
    indexMs,
    indexBytes,
    memory: { mainHeapMB: process.memoryUsage().heapUsed / 1_000_000, processes: metrics },
    uptimeSeconds: process.uptime(),
  };
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
