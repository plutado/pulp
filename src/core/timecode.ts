/**
 * Frame rates and timecode, following editing-app conventions.
 *
 * - Frame rates are picked from the standard list below (film, PAL/SECAM,
 *   NTSC and their high-frame-rate multiples), never typed freely.
 * - In and out points are frames. They are entered as SMPTE timecode
 *   HH:MM:SS:FF, as a plain frame number, or as seconds with an "s" suffix.
 *   The frames field has three digits at 100 fps and above (HH:MM:SS:FFF), as
 *   DaVinci Resolve and Premiere Pro display it.
 * - Drop-frame timecode (semicolons) exists for the NTSC rates 29.97 and
 *   59.94, which skip frame numbers 0-1 (0-3 at 59.94) of the first second of
 *   each minute except every tenth, so the count stays close to clock time.
 *   119.88 follows the same rule with 8 frames. No frames are ever dropped
 *   from the picture; only numbers are skipped.
 */

export interface FrameRate {
  fps: number;
  label: string;
  /** Exact rate for ffmpeg. */
  rational: string;
  /** Frames per timecode second: the integer the timecode counts to. */
  nominal: number;
  /** Frame numbers skipped per minute in drop-frame timecode; 0 where drop-frame is not defined. */
  dropPerMinute: number;
}

export const STANDARD_FRAME_RATES: readonly FrameRate[] = [
  { fps: 23.976, label: '23.976 fps (NTSC film)', rational: '24000/1001', nominal: 24, dropPerMinute: 0 },
  { fps: 24, label: '24 fps (film, DCI)', rational: '24', nominal: 24, dropPerMinute: 0 },
  { fps: 25, label: '25 fps (PAL, SECAM)', rational: '25', nominal: 25, dropPerMinute: 0 },
  { fps: 29.97, label: '29.97 fps (NTSC)', rational: '30000/1001', nominal: 30, dropPerMinute: 2 },
  { fps: 30, label: '30 fps', rational: '30', nominal: 30, dropPerMinute: 0 },
  { fps: 47.952, label: '47.952 fps (NTSC HFR film)', rational: '48000/1001', nominal: 48, dropPerMinute: 0 },
  { fps: 48, label: '48 fps (HFR film)', rational: '48', nominal: 48, dropPerMinute: 0 },
  { fps: 50, label: '50 fps (PAL HFR)', rational: '50', nominal: 50, dropPerMinute: 0 },
  { fps: 59.94, label: '59.94 fps (NTSC HFR)', rational: '60000/1001', nominal: 60, dropPerMinute: 4 },
  { fps: 60, label: '60 fps', rational: '60', nominal: 60, dropPerMinute: 0 },
  { fps: 100, label: '100 fps (PAL double rate)', rational: '100', nominal: 100, dropPerMinute: 0 },
  { fps: 119.88, label: '119.88 fps (NTSC double rate)', rational: '120000/1001', nominal: 120, dropPerMinute: 8 },
  { fps: 120, label: '120 fps', rational: '120', nominal: 120, dropPerMinute: 0 },
];

/** The standard entry for a rate, matched to three decimals, or undefined for a non-standard rate. */
export function standardFrameRate(fps: number): FrameRate | undefined {
  return STANDARD_FRAME_RATES.find((r) => Math.abs(r.fps - fps) < 0.0005);
}

export function isStandardFrameRate(fps: number): boolean {
  return standardFrameRate(fps) !== undefined;
}

/** Frames per timecode second for any rate: the standard nominal, or the rate rounded up. */
export function nominalRate(fps: number): number {
  return standardFrameRate(fps)?.nominal ?? Math.ceil(fps);
}

/** ffmpeg-friendly frame rate: NTSC rates become exact rationals. */
export function fpsToRational(fps: number): string {
  return standardFrameRate(fps)?.rational ?? String(fps);
}

export class TimecodeError extends Error {
  override name = 'TimecodeError';
}

const FRAME_DIGITS = (fps: number) => (nominalRate(fps) > 99 ? 3 : 2);

/** "HH:MM:SS:FF" or "HH:MM:SS:FFF", for placeholders and help. */
export function timecodePattern(fps: number): string {
  return `HH:MM:SS:${'F'.repeat(FRAME_DIGITS(fps))}`;
}

/**
 * Frame index for an in or out point. Accepts timecode (HH:MM:SS:FF, shorter
 * forms such as MM:SS:FF or SS:FF, semicolons for drop-frame), a plain frame
 * number, or seconds with an "s" suffix (rounded to the nearest frame).
 */
export function parseTimecode(text: string, fps: number): number {
  const s = text.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const seconds = /^(\d+(?:\.\d+)?)\s*s$/i.exec(s);
  if (seconds) return Math.round(Number(seconds[1]) * fps);
  if (!/^\d+(?:[:;]\d+){1,3}$/.test(s)) {
    throw new TimecodeError(`"${text}" is not a frame number, seconds ("2.5s") or timecode (${timecodePattern(fps)})`);
  }
  const dropFrame = s.includes(';');
  const parts = s.split(/[:;]/).map(Number);
  while (parts.length < 4) parts.unshift(0);
  const [hh, mm, ss, ff] = parts as [number, number, number, number];
  const nominal = nominalRate(fps);
  if (mm > 59 || ss > 59) throw new TimecodeError(`"${text}": minutes and seconds must be below 60`);
  if (ff >= nominal) throw new TimecodeError(`"${text}": the frames field must be below ${nominal} at ${fps} fps`);
  const drop = standardFrameRate(fps)?.dropPerMinute ?? 0;
  if (dropFrame && drop === 0) throw new TimecodeError(`"${text}": drop-frame timecode (semicolons) is only defined for 29.97, 59.94 and 119.88 fps`);
  let frames = ((hh * 60 + mm) * 60 + ss) * nominal + ff;
  if (dropFrame) {
    const minutes = hh * 60 + mm;
    if (ss === 0 && mm % 10 !== 0 && ff < drop) {
      throw new TimecodeError(`"${text}" does not exist in drop-frame timecode: frames 0-${drop - 1} are skipped at the start of this minute`);
    }
    frames -= drop * (minutes - Math.floor(minutes / 10));
  }
  return frames;
}

/** Timecode for a frame index. Drop-frame (semicolons) is used only where it is defined and asked for. */
export function formatTimecode(frames: number, fps: number, dropFrame = false): string {
  const nominal = nominalRate(fps);
  const drop = dropFrame ? (standardFrameRate(fps)?.dropPerMinute ?? 0) : 0;
  let n = Math.max(0, Math.floor(frames));
  if (drop > 0) {
    // Standard conversion: add back the skipped numbers for each full ten-minute block and each minute inside it.
    const perMinute = 60 * nominal - drop;
    const perTenMinutes = 10 * perMinute + drop;
    const tens = Math.floor(n / perTenMinutes);
    const rest = n % perTenMinutes;
    n += drop * 9 * tens + (rest >= drop ? drop * Math.floor((rest - drop) / perMinute) : 0);
  }
  const ff = n % nominal;
  const totalSeconds = Math.floor(n / nominal);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const sep = drop > 0 ? ';' : ':';
  const two = (v: number) => String(v).padStart(2, '0');
  return `${two(hh)}:${two(mm)}:${two(ss)}${sep}${String(ff).padStart(FRAME_DIGITS(fps), '0')}`;
}
