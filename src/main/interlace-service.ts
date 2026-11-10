/**
 * Deinterlacing in the main process (milestone 83): a clip's frames read
 * through `idet` to learn its scan, and what each place that reads its pixels
 * should do with it.
 *
 * The rules are pure (src/core/interlace.ts). What cannot be pure is running
 * ffmpeg over the file, which happens once per file as it is now — by the
 * library's background pass, or on the spot when a clip is used before that
 * pass reached it, so the first frame on the stage or in a render is already
 * right. A headless render never runs the background pass, so it measures here
 * too. What is learned is handed to whoever listens (the library, which keeps
 * it with the clip's metadata and shows it).
 */

import { nodeRunner, runForBuffer } from '../core/ffmpeg';
import { idetArgs, idetStart, interlacedField, mayBeInterlaced, parseIdet, scanFrom, type FieldOrder, type ScanReading } from '../core/interlace';
import { ffprobePathFor, probeMedia } from '../core/media-probe';
import type { MediaEntry } from '../core/library-types';

/** How long one clip's frames may take to read before the tag is taken instead. */
const IDET_TIMEOUT_MS = 60_000;

/** What a file turned out to be, keyed by path, size and modification time, so it is read once. */
const files = new Map<string, Promise<ScanReading | undefined>>();

type Measured = (entry: Pick<MediaEntry, 'key' | 'path' | 'size' | 'mtimeMs'>, scan: ScanReading, fieldOrder: ScanReading['field'] | undefined) => void;
let measured: Measured = () => undefined;

/** Who keeps what is learned: the library, which stores it with the clip and shows it. */
export function onScanMeasured(listener: Measured): void {
  measured = listener;
}

/** Forget what was learned, for a test that changes a file under the same name. */
export function forgetScans(): void {
  files.clear();
}

type ScannedEntry = Pick<MediaEntry, 'key' | 'path' | 'size' | 'mtimeMs' | 'meta' | 'mediaKind' | 'sequence' | 'clipSet'>;

/**
 * A clip's scan: the library's reading where it has one, and otherwise the
 * file's own — probed afresh, for its rate, length and `field_order` tag, and
 * where it could be interlaced at all, its frames shown to `idet`. A file the
 * frames cannot be read from is what its tag says. Undefined for what has no
 * scan to speak of: a sound, a still, a run of frames, a clip set.
 */
export function scanOf(ffmpegPath: string, entry: ScannedEntry): Promise<ScanReading | undefined> {
  if (entry.mediaKind !== 'video' || entry.sequence || entry.clipSet || ffmpegPath === '') return Promise.resolve(undefined);
  if (entry.meta?.scan) return Promise.resolve(entry.meta.scan);
  const key = `${entry.path}|${entry.size}|${entry.mtimeMs}`;
  const asked = files.get(key);
  if (asked) return asked;
  const work = measure(ffmpegPath, entry).catch(() => undefined);
  files.set(key, work);
  return work;
}

async function measure(ffmpegPath: string, entry: ScannedEntry): Promise<ScanReading | undefined> {
  const meta = await probeMedia(ffprobePathFor(ffmpegPath), entry.path, nodeRunner);
  if (!meta) return undefined;
  let scan: ScanReading;
  if (!mayBeInterlaced(meta)) scan = { field: 'progressive', by: 'shape' };
  else {
    const run = await Promise.race([
      runForBuffer(ffmpegPath, idetArgs(entry.path, idetStart(meta.duration, meta.fps))),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), IDET_TIMEOUT_MS)),
    ]).catch(() => null);
    scan = scanFrom(run && run.code === 0 ? parseIdet(run.stderr) : null, meta.fieldOrder);
  }
  measured(entry, scan, meta.fieldOrder);
  return scan;
}

/**
 * The field order to deinterlace a clip by, or undefined to read it as it is:
 * a progressive clip, one whose deinterlacing a person turned off — for the
 * clip in the library, or for a whole render (`off`) — and anything without a
 * scan.
 */
export async function deinterlaceFor(ffmpegPath: string, entry: ScannedEntry & Pick<MediaEntry, 'deinterlace'>, off = false): Promise<FieldOrder | undefined> {
  if (off || entry.deinterlace === false) return undefined;
  return interlacedField(await scanOf(ffmpegPath, entry));
}
