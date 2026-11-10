/**
 * Deinterlacing old footage (milestone 83): what makes a clip interlaced, how
 * that is found in its frames, and the one ffmpeg step that makes it
 * progressive wherever its pixels are read.
 *
 * **Why at all.** Tape, broadcast and old stock discs are interlaced: each
 * frame is two fields, its odd and its even lines, caught a field apart in
 * time. Shown as whole frames on a progressive timeline, anything that moves
 * is drawn twice, line by line — combing. Pulp draws and writes progressive
 * frames throughout, so an interlaced clip is deinterlaced on the way in.
 *
 * **Found in the frames, not only the tags.** A file's `field_order` tag is
 * often wrong both ways: a transfer from tape is written as progressive, and an
 * encoder flags plainly progressive footage as top field first. So the clip's
 * frames are read through ffmpeg's `idet`, which compares each frame's two
 * fields with the frames around it, and the frames decide wherever they are
 * clear. The tag is heard only where they are not — a still shot gives `idet`
 * nothing to measure, and fast, finely drawn graphics can look partly combed
 * to it — and the threshold is set high for exactly that second reason: a
 * progressive test pattern full of moving one-pixel lines reads three quarters
 * "interlaced", where real interlaced footage reads all of it.
 *
 * **The field order is the clip's**: the field that comes first, as the frames
 * show it, or as the tag says where the frames cannot tell. Deinterlacing in
 * the wrong order sends motion back and forth a field every frame.
 *
 * **Deinterlaced on the way in, never in place.** `bwdif` joins the filter
 * chain that already reads the clip, first of all — before an HDR conversion,
 * a speed change, a scale or a crop, any of which would mix the two fields —
 * one frame out for each frame in, so a clip's timing is untouched. The file
 * itself is only ever read. A person can turn it off for a clip.
 *
 * Both filters are ffmpeg's own (no library behind them), so every build has
 * them (src/core/ffmpeg-needs.ts).
 */

/** Which field of an interlaced frame was caught first. */
export type FieldOrder = 'tff' | 'bff';

/** What a clip's scan is: progressive, or interlaced with its first field. */
export type ScanField = 'progressive' | FieldOrder;

/** What `idet`'s multi-frame detection counted over the frames it was shown. */
export interface IdetCounts {
  tff: number;
  bff: number;
  progressive: number;
  undetermined: number;
}

/**
 * What a clip turned out to be (milestone 83), kept with its metadata: its
 * scan, and what decided it — the frames, the file's tag where the frames
 * could not tell, or the clip's shape, which rules interlacing out without a
 * frame being read (a 60 fps phone clip is progressive by what it is).
 */
export interface ScanReading {
  field: ScanField;
  by: 'frames' | 'tag' | 'shape';
  /** The counts `idet` gave, where frames were read. */
  frames?: IdetCounts;
}

/** How many frames are shown to `idet`: two seconds and more of PAL or NTSC. */
export const IDET_FRAMES = 60;
/** The share of decided frames that must look interlaced for the frames alone to say so. */
export const INTERLACED_SHARE = 0.8;
/** At or under this share the frames say progressive; between the two, the tag decides. */
export const PROGRESSIVE_SHARE = 0.5;
/** At least this many frames must be decided, and this share of those read, for the frames to be heard. */
export const MIN_DECIDED_FRAMES = 8;
export const MIN_DECIDED_SHARE = 0.2;

/** ffprobe's `field_order` as a scan: `tt` and `tb` are top first, `bb` and `bt` bottom; anything else says nothing. */
export function fieldOrderFromTag(tag: string | undefined): ScanField | undefined {
  switch (tag?.trim().toLowerCase()) {
    case 'progressive':
      return 'progressive';
    case 'tt':
    case 'tb':
      return 'tff';
    case 'bb':
    case 'bt':
      return 'bff';
    default:
      return undefined;
  }
}

/**
 * Whether a clip could be interlaced at all, from what the probe measured, so
 * frames are read only where the answer could be yes. An interlaced file holds
 * two fields per frame at 25 or 29.97 frames a second — PAL's 50 fields and
 * NTSC's 59.94 — so a clip at any other rate is progressive by what it is,
 * unless its own tag says otherwise. A clip of a frame or two has no motion to
 * read.
 */
export function mayBeInterlaced(meta: { fps?: number; duration?: number; fieldOrder?: ScanField } | undefined): boolean {
  if (!meta) return false;
  if (meta.fieldOrder === 'tff' || meta.fieldOrder === 'bff') return true;
  if (!meta.fps || meta.fps < 24.5 || meta.fps > 30.5) return false;
  return meta.duration === undefined || meta.duration * meta.fps >= 4;
}

/**
 * Where the frames `idet` reads begin, in seconds: a third of the way in, past
 * the black, the slate or the still title a clip so often opens on, and from
 * the start for a clip too short to have any.
 */
export function idetStart(duration: number | undefined, fps: number | undefined): number {
  if (!duration || duration <= 0) return 0;
  const span = IDET_FRAMES / Math.max(1, fps ?? 25);
  const from = duration / 3;
  return from + span > duration ? Math.max(0, duration - span) : Math.round(from * 1000) / 1000;
}

/**
 * ffmpeg's arguments to show a clip's frames to `idet` and nothing else: its
 * first picture stream from `from`, `IDET_FRAMES` of them, no sound, nothing
 * written. `idet` reports at the `info` level as the graph closes, on stderr.
 */
export function idetArgs(file: string, from: number): string[] {
  return [
    '-hide_banner', '-nostdin', '-nostats', '-v', 'info',
    ...(from > 0 ? ['-ss', String(from)] : []),
    '-i', file,
    '-map', '0:v:0', '-an', '-sn', '-dn',
    '-frames:v', String(IDET_FRAMES),
    '-vf', 'idet', '-f', 'null', '-',
  ];
}

/**
 * The multi-frame counts in `idet`'s report, or null when there is none. ffmpeg
 * may build the graph twice and so report twice — the first time over no
 * frames — so the report that counted the most is the one taken.
 */
export function parseIdet(stderr: string): IdetCounts | null {
  const line = /Multi frame detection:\s*TFF:\s*(\d+)\s*BFF:\s*(\d+)\s*Progressive:\s*(\d+)\s*Undetermined:\s*(\d+)/g;
  let best: IdetCounts | null = null;
  for (const m of stderr.matchAll(line)) {
    const counts = { tff: Number(m[1]), bff: Number(m[2]), progressive: Number(m[3]), undetermined: Number(m[4]) };
    const total = counts.tff + counts.bff + counts.progressive + counts.undetermined;
    const bestTotal = best ? best.tff + best.bff + best.progressive + best.undetermined : -1;
    if (total > bestTotal) best = counts;
  }
  return best;
}

/**
 * What a clip's scan is, from what its frames showed and what its tag says.
 * The frames decide where they are clear — interlaced past `INTERLACED_SHARE`
 * of the frames they decided, progressive at or under `PROGRESSIVE_SHARE` —
 * and the tag where they are not: too few frames decided (a still shot), or a
 * share between the two. The field order is the one the frames counted more of
 * by a clear margin, else the tag's, else top first, which is what DV aside
 * most interlaced video is.
 */
export function scanFrom(counts: IdetCounts | null, tag: ScanField | undefined): ScanReading {
  const tagged: ScanReading = { field: tag ?? 'progressive', by: 'tag', ...(counts ? { frames: counts } : {}) };
  if (!counts) return tagged;
  const interlaced = counts.tff + counts.bff;
  const decided = interlaced + counts.progressive;
  const read = decided + counts.undetermined;
  if (decided < MIN_DECIDED_FRAMES || decided < read * MIN_DECIDED_SHARE) return tagged;
  const share = interlaced / decided;
  if (share <= PROGRESSIVE_SHARE) return { field: 'progressive', by: 'frames', frames: counts };
  if (share < INTERLACED_SHARE) return tagged;
  const order: FieldOrder = counts.tff >= 2 * counts.bff ? 'tff' : counts.bff >= 2 * counts.tff ? 'bff' : tag === 'bff' ? 'bff' : 'tff';
  return { field: order, by: 'frames', frames: counts };
}

/** Whether a reading is of an interlaced clip, and so which field comes first; undefined for progressive. */
export function interlacedField(scan: ScanReading | undefined): FieldOrder | undefined {
  return scan && scan.field !== 'progressive' ? scan.field : undefined;
}

/**
 * The step that makes an interlaced picture progressive, in front of whatever
 * the caller does next. `bwdif` in its one-frame-per-frame mode keeps the
 * clip's rate and length exactly; the parity is the clip's own; and every
 * frame is deinterlaced, not only those flagged interlaced, since the flags
 * are what this milestone found it cannot trust.
 */
export function deinterlaceSteps(field: FieldOrder | undefined): string[] {
  return field ? [`bwdif=mode=send_frame:parity=${field}:deint=all`] : [];
}

/** The same as one `-vf` fragment, ending in a comma, for a chain built as a string. */
export function deinterlacePrefix(field: FieldOrder | undefined): string {
  return field ? `${deinterlaceSteps(field).join(',')},` : '';
}
