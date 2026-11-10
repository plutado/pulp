/**
 * Fetching FFmpeg, for the machine that has none (milestone 17, ADR 0022).
 *
 * Pulp ships no FFmpeg and installs nothing on the system. This fetches the
 * build `src/core/ffmpeg-download.ts` pins for this platform **after the
 * person has pressed the button**, checks every archive against its published
 * checksum as it arrives, takes the two programs out of it, proves the
 * encoder runs, and only then moves it into `ffmpeg/` beside the settings —
 * where `candidatePaths` looks last unless the person chose it — which a
 * fetch does for them, since it was asked for (ADR 0026); Settings switches
 * back to the first one found in one click.
 *
 * Nothing is left behind by a fetch that fails: the staging folder is inside
 * the same folder as the end place, so moving in is a rename rather than a
 * copy across filesystems, and a failure takes the whole folder with it.
 */

import { createHash } from 'node:crypto';
import { app, net, type BrowserWindow } from 'electron';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  downloadBytes, FFMPEG_DIR_NAME, ffmpegBinaryName, ffmpegBuildFor, ffmpegDownloadNote,
  type FfmpegArchive, type FfmpegBuild,
} from '../core/ffmpeg-download';
import { capabilitiesOf, detectFfmpeg, forgetFfmpegBuilds, nodeRunner, parseFfmpegVersion, setChosenFfmpeg, setManagedFfmpeg, type FfmpegStatus } from '../core/ffmpeg';
import { featureStatuses, type FfmpegFeatureStatus } from '../core/ffmpeg-needs';
import { loadSettings, updateSettings, type FfmpegChoice } from './settings';
import { tr } from '../core/i18n';
import { readZip } from '../core/zip';
// What the window is told — the build on offer for this machine, and whether it is already
// here — is the shape the preload hands it, so there is one declaration of it, not two.
import type { FfmpegDownloadInfo } from '../shared/api';

/** A hundred megabytes over whatever connection there is, as the speech model's fetch allows. */
const FETCH_TIMEOUT_MS = 30 * 60_000;

/** Where a fetched build is kept: beside the settings, with the speech models. */
export function managedFfmpegDir(): string {
  return join(app.getPath('userData'), FFMPEG_DIR_NAME);
}

function managedPath(binary: 'ffmpeg' | 'ffprobe'): string {
  return join(managedFfmpegDir(), ffmpegBinaryName(binary, process.platform));
}

/** The window hears how the fetch is going through this; the main window is the only listener. */
let progressTo: BrowserWindow | null = null;

export function setFfmpegProgressWindow(window: BrowserWindow | null): void {
  progressTo = window;
}

function report(note: string, fraction: number | null): void {
  if (progressTo && !progressTo.isDestroyed()) progressTo.webContents.send('ffmpeg:progress', { note, fraction });
}

async function installed(): Promise<boolean> {
  try {
    const [encoder, prober] = await Promise.all([stat(managedPath('ffmpeg')), stat(managedPath('ffprobe'))]);
    return encoder.size > 0 && prober.size > 0;
  } catch {
    return false;
  }
}

/**
 * Tell the rest of the app about a build fetched in an earlier session, at
 * startup. Without this a fetched ffmpeg would be found only after a restart
 * of the restart it already saved the person.
 */
export async function registerManagedFfmpeg(): Promise<void> {
  setManagedFfmpeg((await installed()) ? managedPath('ffmpeg') : null);
  applyFfmpegChoice((await loadSettings()).ffmpegChoice);
}

// ---------------------------------------------------------------- which ffmpeg (milestone 88)

/** Put a choice into effect: the chosen file first among the candidates, and every build read again. */
function applyFfmpegChoice(choice: FfmpegChoice): void {
  setChosenFfmpeg(choice.kind === 'file' ? choice.path : choice.kind === 'fetched' ? managedPath('ffmpeg') : null);
  forgetFfmpegBuilds();
}

export async function ffmpegChoice(): Promise<FfmpegChoice> {
  return (await loadSettings()).ffmpegChoice;
}

export type FfmpegChoiceResult = { ok: true; choice: FfmpegChoice } | { ok: false; message: string };

/**
 * Choose which ffmpeg Pulp uses, from Settings: automatic, the fetched build,
 * or a file. A file is held to running as an ffmpeg before it is kept — a
 * choice that cannot start would leave every render to find out — and the
 * fetched build to being here. Kept in settings, in effect at once.
 */
export async function chooseFfmpeg(raw: unknown): Promise<FfmpegChoiceResult> {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  let choice: FfmpegChoice;
  if (r.kind === 'fetched') {
    if (!(await installed())) return { ok: false, message: tr('settings.ffmpeg.choice.no-fetched') };
    choice = { kind: 'fetched' };
  } else if (r.kind === 'file' && typeof r.path === 'string' && r.path.trim() !== '') {
    const version = await runsAsFfmpeg(r.path);
    if (version === null) return { ok: false, message: tr('settings.ffmpeg.choice.not-ffmpeg', { path: r.path }) };
    choice = { kind: 'file', path: r.path };
  } else {
    choice = { kind: 'auto' };
  }
  await updateSettings((s) => {
    s.ffmpegChoice = choice;
  });
  applyFfmpegChoice(choice);
  return { ok: true, choice };
}

async function runsAsFfmpeg(path: string): Promise<string | null> {
  try {
    const result = await nodeRunner(path, ['-hide_banner', '-version']);
    return result.code === 0 ? parseFfmpegVersion(result.stdout) : null;
  } catch {
    return null;
  }
}

/**
 * What a build that is not in use can do — the fetched one, before it is
 * switched to — read the way the build in use is, so Settings can say what a
 * switch would gain.
 */
async function featuresOf(path: string): Promise<FfmpegFeatureStatus[]> {
  const status: FfmpegStatus = await detectFfmpeg(nodeRunner, { PULP_FFMPEG_PATH: path });
  return status.ok && status.path === path ? featureStatuses(capabilitiesOf(status), process.platform) : [];
}

export async function ffmpegDownloadStatus(): Promise<FfmpegDownloadInfo> {
  const build = ffmpegBuildFor(process.platform, process.arch);
  const here = await installed();
  return {
    build: build
      ? {
          id: build.id,
          label: build.label,
          version: build.version,
          publisher: build.publisher,
          publisherUrl: build.publisherUrl,
          license: build.license,
          bytes: downloadBytes(build),
          note: ffmpegDownloadNote(build),
        }
      : null,
    installed: here,
    ...(here ? { path: managedPath('ffmpeg'), features: await featuresOf(managedPath('ffmpeg')) } : {}),
  };
}

export type FfmpegFetchResult =
  /** `lacks`: what the table needs that the fetched build turned out not to have, read from the build itself. */
  | { ok: true; path: string; version: string; lacks: FfmpegFeatureStatus[] }
  | { ok: false; message: string };

/** One fetch at a time: a second would race the first into the same folder. */
let running: Promise<FfmpegFetchResult> | null = null;

export function fetchFfmpeg(): Promise<FfmpegFetchResult> {
  if (running) return Promise.resolve({ ok: false, message: tr('fetch.ffmpeg.running') });
  const work = run().catch((error: Error): FfmpegFetchResult => ({ ok: false, message: error.message }));
  running = work;
  return work.finally(() => {
    running = null;
  });
}

/**
 * Fetch one archive to a file of its own, hashing as it arrives. What comes
 * back is the file, or a sentence saying why there is none; nothing is kept
 * that does not hash to the published checksum.
 */
async function fetchArchive(
  archive: FfmpegArchive,
  to: string,
  onBytes: (received: number) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const hash = createHash('sha256');
  let received = 0;
  try {
    // Electron's own fetch rather than Node's: it goes through the session, so a proxy, a
    // corporate certificate store and the app's network settings all hold for this request.
    const response = await net.fetch(archive.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!response.ok || !response.body) {
      return { ok: false, message: tr('fetch.ffmpeg.server', { status: response.status }) };
    }
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      received += chunk.length;
      onBytes(received);
    });
    await pipeline(body, createWriteStream(to));
  } catch (error) {
    return { ok: false, message: tr('fetch.ffmpeg.failed', { reason: (error as Error).message }) };
  }
  if (received !== archive.bytes || hash.digest('hex') !== archive.sha256) {
    return {
      ok: false,
      message: tr('fetch.ffmpeg.checksum'),
    };
  }
  return { ok: true };
}

/** Take one named file out of a zip. Nothing else in the archive is inflated or looked at. */
async function unpack(archivePath: string, member: string, to: string): Promise<void> {
  const [entry] = readZip(await readFile(archivePath), { wanted: (name) => name === member });
  if (!entry) throw new Error(tr('fetch.ffmpeg.member-missing', { member }));
  await writeFile(to, entry.data);
  // Unpacked from a zip, so nothing carries a mode: it has to be made runnable here.
  if (process.platform !== 'win32') await chmod(to, 0o755);
}

async function run(): Promise<FfmpegFetchResult> {
  const build: FfmpegBuild | null = ffmpegBuildFor(process.platform, process.arch);
  if (!build) {
    return { ok: false, message: tr('fetch.ffmpeg.no-build', { platform: process.platform, arch: process.arch }) };
  }
  const dir = managedFfmpegDir();
  await mkdir(dir, { recursive: true });
  // Staged inside the same folder as the end place: moving in is then a rename on one
  // filesystem, which either happens or does not, rather than a copy that can stop half way.
  const staging = await mkdtemp(`${dir}-`);
  try {
    const total = downloadBytes(build);
    // The Windows build is one archive holding both programs: fetched once, unpacked twice.
    const archives = new Map<string, FfmpegArchive>();
    for (const archive of build.archives) if (!archives.has(archive.url)) archives.set(archive.url, archive);
    let done = 0;
    const files = new Map<string, string>();
    for (const [url, archive] of archives) {
      const file = join(staging, `archive-${files.size}.zip`);
      const fetched = await fetchArchive(archive, file, (received) => {
        report(tr('fetch.ffmpeg.fetching', { version: build.version }), Math.min(1, (done + received) / total));
      });
      if (!fetched.ok) return fetched;
      done += archive.bytes;
      files.set(url, file);
    }

    report(tr('fetch.ffmpeg.unpacking'), null);
    for (const archive of build.archives) {
      await unpack(files.get(archive.url)!, archive.member, join(staging, ffmpegBinaryName(archive.binary, process.platform)));
    }
    // The archives are no longer needed, and the Windows one is 115 MB holding two programs
    // of a hundred each: dropping them here keeps the staging folder to what is being kept.
    for (const file of files.values()) await rm(file, { force: true });

    // It is only ffmpeg if it runs as one: a build that cannot start on this machine is
    // better said here than at the end of somebody's first render. The staged file is asked
    // directly rather than through `detectFfmpeg`, which would answer for whatever ffmpeg
    // the machine already has — the very thing that is missing here.
    report(tr('fetch.ffmpeg.checking'), null);
    const staged = join(staging, ffmpegBinaryName('ffmpeg', process.platform));
    let version: string | null = null;
    try {
      const result = await nodeRunner(staged, ['-hide_banner', '-version']);
      if (result.code === 0) version = parseFfmpegVersion(result.stdout);
    } catch {
      version = null;
    }
    if (version === null) {
      return { ok: false, message: tr('fetch.ffmpeg.would-not-run') };
    }

    for (const binary of ['ffmpeg', 'ffprobe'] as const) {
      const name = ffmpegBinaryName(binary, process.platform);
      await rm(join(dir, name), { force: true });
      await rename(join(staging, name), join(dir, name));
    }
    setManagedFfmpeg(managedPath('ffmpeg'));
    // Fetched because it was asked for — by someone with none, or with one that lacks a feature —
    // so it is the one used from now on; Settings switches back to automatic in one click.
    await updateSettings((s) => {
      s.ffmpegChoice = { kind: 'fetched' };
    });
    applyFfmpegChoice({ kind: 'fetched' });
    // The build is held to the feature table as it really is, not as it was described: whatever
    // it lacks is said now, by name, rather than at the first render that needs it.
    const lacks = (await featuresOf(managedPath('ffmpeg'))).filter((f) => !f.ok);
    report(tr(lacks.length === 0 ? 'fetch.ffmpeg.ready' : 'fetch.ffmpeg.ready-lacking', { version, lacks: lacks.map((f) => f.library ?? f.missing.join(', ')).join(', ') }), 1);
    return { ok: true, path: managedPath('ffmpeg'), version, lacks };
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}
