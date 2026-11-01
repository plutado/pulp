/**
 * Silence on the cut track (milestone 49): the quiet stretches of each cut's
 * sound, found with ffmpeg's own silence detection at a threshold and a
 * minimum length, mapped onto the project's timeline — so the lane can show
 * them before anything is cut, and one edit then cuts them all. The window
 * names clips by id, never by path (ADR 0013); a cut whose clip has no audio
 * stream is left alone, since silence detection over footage with no sound
 * would cut the whole shot.
 */

import { sanitizeCutTrack, cutWindows } from '../core/cut-track';
import { detectFfmpeg, runForBuffer } from '../core/ffmpeg';
import { ffprobePathFor } from '../core/media-probe';
import { resolveSoundSource } from './sound-grant';
import { lookupClipItem } from './library-service';

export interface TrackSilenceRequest {
  cuts: { id: string; from: number; to: number }[];
  /** Quieter than this is silence, dBFS; -40 hears a room, -60 only a void. */
  thresholdDb: number;
  /** Stretches shorter than this are breath, not silence, and stay. */
  minSeconds: number;
}

/** Quiet stretches of the timeline, merged where they touch; empty when there is nothing quiet enough. */
export async function trackSilences(raw: unknown): Promise<{ ranges: { start: number; end: number }[] }> {
  const request = raw as Partial<TrackSilenceRequest>;
  const track = sanitizeCutTrack({ cuts: request?.cuts });
  const thresholdDb = typeof request?.thresholdDb === 'number' && Number.isFinite(request.thresholdDb)
    ? Math.min(-6, Math.max(-90, Math.round(request.thresholdDb)))
    : -40;
  const minSeconds = typeof request?.minSeconds === 'number' && Number.isFinite(request.minSeconds)
    ? Math.min(30, Math.max(0.1, Math.round(request.minSeconds * 100) / 100))
    : 0.5;
  const ffmpeg = await detectFfmpeg();
  if (!track || !ffmpeg.ok) return { ranges: [] };
  const windows = cutWindows(track);
  const found: { start: number; end: number }[] = [];
  for (const [index, cut] of track.cuts.entries()) {
    // Only a cut whose clip really carries sound is scanned; resolveSoundSource is that question.
    if (lookupClipItem(cut.id)?.kind !== 'media') continue;
    const source = await resolveSoundSource(ffprobePathFor(ffmpeg.path), cut.id);
    if (!source) continue;
    const length = Math.max(0.001, cut.to - cut.from);
    const run = await runForBuffer(ffmpeg.path, [
      '-v', 'info', '-ss', String(cut.from), '-t', String(length), '-i', source.path,
      '-vn', '-af', `silencedetect=noise=${thresholdDb}dB:d=${minSeconds}`, '-f', 'null', '-',
    ]);
    if (run.code !== 0) continue;
    // Starts and ends come in pairs on the cut's own clock (the seek reset it to zero); a start
    // with no end is quiet to the end of the cut.
    let openedAt: number | null = null;
    for (const line of run.stderr.split('\n')) {
      const started = /silence_start:\s*(-?[\d.]+)/.exec(line);
      const ended = /silence_end:\s*(-?[\d.]+)/.exec(line);
      if (started) openedAt = Math.max(0, Number(started[1]));
      if (ended && openedAt !== null) {
        found.push({ start: windows[index]!.start + openedAt, end: windows[index]!.start + Math.min(length, Number(ended[1])) });
        openedAt = null;
      }
    }
    if (openedAt !== null) found.push({ start: windows[index]!.start + openedAt, end: windows[index]!.end });
  }
  // Merged where they touch — a silence running across a boundary is one stretch to the eye.
  found.sort((a, b) => a.start - b.start);
  const ranges: { start: number; end: number }[] = [];
  for (const range of found) {
    const last = ranges[ranges.length - 1];
    if (last && range.start - last.end < 0.02) last.end = Math.max(last.end, range.end);
    else ranges.push({ ...range });
  }
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { ranges: ranges.filter((r) => r.end - r.start > 0.01).map((r) => ({ start: round(r.start), end: round(r.end) })) };
}
