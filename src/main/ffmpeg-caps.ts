/**
 * What the ffmpeg in use can do, asked the one way (milestone 88): the build
 * `detectFfmpeg` found — read once per build and kept while the file is
 * unchanged — held against the feature table (src/core/ffmpeg-needs.ts).
 * Every feature that might be missing asks here, so the HDR conversion, the
 * stabilize dialog, the preset list and Settings all give the same answer.
 */

import { capabilitiesOf, detectFfmpeg, type FfmpegStatus } from '../core/ffmpeg';
import { FFMPEG_NEEDS, featureStatus, featureStatuses, graphFilters, type FfmpegFeature, type FfmpegFeatureStatus } from '../core/ffmpeg-needs';

/** One feature on the ffmpeg in use, or null when there is no ffmpeg at all. */
export async function ffmpegFeature(id: FfmpegFeature): Promise<FfmpegFeatureStatus | null> {
  const status = await detectFfmpeg();
  return status.ok ? featureStatus(capabilitiesOf(status), id) : null;
}

/**
 * One feature on a given ffmpeg, by its path: the build in use when the path
 * is its own — the case every caller is in, since each was handed the path
 * by `detectFfmpeg` — and otherwise an honest no, rather than a second read.
 */
export async function ffmpegHas(ffmpegPath: string, id: FfmpegFeature): Promise<boolean> {
  if (ffmpegPath === '') return false;
  const status = await detectFfmpeg();
  return status.ok && status.path === ffmpegPath && featureStatus(capabilitiesOf(status), id).ok;
}

/** Every feature on this platform against the ffmpeg in use, for Settings; empty when there is none. */
export function allFeatures(status: FfmpegStatus): FfmpegFeatureStatus[] {
  return status.ok ? featureStatuses(capabilitiesOf(status), process.platform) : [];
}

/**
 * What an argument list asks of the ffmpeg in use that it does not have
 * (milestone 88): every feature whose filters the graphs name, whose encoders
 * the outputs name, or whose decoders the inputs name, held against the
 * build. Run on a render's finished plan, so what would only fail inside
 * ffmpeg — an Opus track with no libopus — is said before anything starts,
 * in the table's own words.
 */
export async function planLacks(args: readonly string[]): Promise<FfmpegFeatureStatus[]> {
  const status = await detectFfmpeg();
  if (!status.ok) return [];
  const caps = capabilitiesOf(status);
  const lastInput = args.lastIndexOf('-i');
  const filters = new Set<string>();
  const encoders = new Set<string>();
  const decoders = new Set<string>();
  for (let i = 0; i < args.length - 1; i++) {
    const flag = args[i]!;
    const value = args[i + 1]!;
    if (flag === '-vf' || flag === '-af' || flag === '-filter_complex' || flag === '-lavfi') for (const f of graphFilters(value)) filters.add(f);
    if (/^-c(:[va](:\d+)?)?$/.test(flag)) (i > lastInput ? encoders : decoders).add(value);
  }
  const out: FfmpegFeatureStatus[] = [];
  for (const need of FFMPEG_NEEDS) {
    const used = need.filters?.some((f) => filters.has(f))
      || need.encoders?.some((e) => encoders.has(e))
      || need.decoders?.some((d) => decoders.has(d));
    if (!used) continue;
    const answer = featureStatus(caps, need.id);
    if (!answer.ok) out.push(answer);
  }
  return out;
}
