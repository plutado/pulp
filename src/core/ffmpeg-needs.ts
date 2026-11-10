/**
 * What Pulp needs of the ffmpeg in use, feature by feature (milestone 88),
 * and what one build turns out to have.
 *
 * Pulp runs the person's own ffmpeg, and builds differ: Homebrew's macOS
 * build has no zimg, so HDR clips cannot be converted; vid.stab and libwebp
 * are add-ons a build may or may not be configured with; a Windows build has
 * no VideoToolbox. Before this, each feature asked for itself — a filter list
 * read by the HDR code, another by the stabilize dialog, the encoder list by
 * the presets — and a feature added without asking simply failed at render
 * time. Now there is **one table**: each feature names the filters, encoders
 * and decoders it needs, the ffmpeg is read once (`detectFfmpeg`), and every
 * feature asks the same answer through `featureStatus`.
 *
 * **The table is held to the code**, both ways (tests/ffmpeg-needs.test.ts):
 * every filter and codec the planners write must be named here, and every
 * library-backed filter or encoder that appears anywhere in the source must
 * be. A new feature that forgets to say what it needs fails a test, rather
 * than failing on somebody's machine.
 *
 * Pure: reading a build is src/core/ffmpeg.ts; what the window shows is the
 * Settings dialog and each feature's own place.
 */

import { tr } from './i18n';

/** Each feature that depends on something a build may lack. */
export const FFMPEG_FEATURES = [
  'hdr', 'stabilize', 'webp', 'h264', 'vp9', 'webm-alpha', 'opus', 'mp3', 'hevc-alpha', 'take', 'set-preview',
] as const;
export type FfmpegFeature = (typeof FFMPEG_FEATURES)[number];

/** What one feature needs of a build. */
export interface FfmpegNeed {
  id: FfmpegFeature;
  /** What the person would call it, in the interface's language. */
  readonly label: string;
  filters?: readonly string[];
  encoders?: readonly string[];
  decoders?: readonly string[];
  /** Any one of these encoders will do (a camera take is converted by whichever H.264 encoder there is). */
  anyEncoder?: readonly string[];
  /**
   * The library a build is configured with to carry it, as ffmpeg's own
   * `--enable-` flag names it: what to look for in a build's description.
   */
  library?: string;
  /** Platforms the feature exists on at all; absent is every platform. */
  platforms?: readonly string[];
}

export const FFMPEG_NEEDS: readonly FfmpegNeed[] = [
  { id: 'hdr', get label() { return tr('ffmpeg.feature.hdr'); }, filters: ['zscale', 'tonemap'], library: 'libzimg' },
  { id: 'stabilize', get label() { return tr('ffmpeg.feature.stabilize'); }, filters: ['vidstabdetect', 'vidstabtransform'], library: 'libvidstab' },
  { id: 'webp', get label() { return tr('ffmpeg.feature.webp'); }, encoders: ['libwebp_anim'], library: 'libwebp' },
  { id: 'h264', get label() { return tr('ffmpeg.feature.h264'); }, encoders: ['libx264'], library: 'libx264' },
  { id: 'vp9', get label() { return tr('ffmpeg.feature.vp9'); }, encoders: ['libvpx-vp9'], library: 'libvpx' },
  // A WebM with alpha is read through libvpx, or its picture comes back opaque (milestone 32).
  { id: 'webm-alpha', get label() { return tr('ffmpeg.feature.webm-alpha'); }, decoders: ['libvpx-vp9', 'libvpx'], library: 'libvpx' },
  { id: 'opus', get label() { return tr('ffmpeg.feature.opus'); }, encoders: ['libopus'], library: 'libopus' },
  { id: 'mp3', get label() { return tr('ffmpeg.feature.mp3'); }, encoders: ['libmp3lame'], library: 'libmp3lame' },
  { id: 'hevc-alpha', get label() { return tr('ffmpeg.feature.hevc-alpha'); }, encoders: ['hevc_videotoolbox'], library: 'videotoolbox', platforms: ['darwin'] },
  // A camera take (milestone 64) is converted by the first H.264 encoder the build has.
  { id: 'take', get label() { return tr('ffmpeg.feature.take'); }, anyEncoder: ['libx264', 'h264_videotoolbox', 'h264_mf', 'h264_nvenc', 'h264_amf'] },
  // A clip set's stitched preview (milestone 32) is VP9 with alpha, or VP8 where there is no VP9.
  { id: 'set-preview', get label() { return tr('ffmpeg.feature.set-preview'); }, anyEncoder: ['libvpx-vp9', 'libvpx'], library: 'libvpx' },
];

/**
 * Encoders used only as a second choice, whose absence costs nothing a
 * feature promises: a clip set's preview takes Vorbis sound where there is no
 * Opus, and goes without sound where there is neither.
 */
export const FALLBACK_CODECS: readonly string[] = ['libvorbis'];

/**
 * The filters every ffmpeg build carries that Pulp uses: the plumbing of its
 * graphs. Named here so the table is whole — a planner that writes a filter
 * neither here nor in a feature fails tests/ffmpeg-needs.test.ts — and held
 * to being used, so the list says what Pulp writes and no more.
 */
export const CORE_FILTERS: readonly string[] = [
  // Picture: shape, place, time and color.
  'scale', 'format', 'crop', 'pad', 'setsar', 'overlay', 'color', 'null', 'anull', 'split', 'fps', 'trim', 'setpts', 'tpad', 'concat',
  'xfade', 'fade', 'select', 'showinfo', 'setparams', 'unpremultiply', 'alphaextract', 'colorchannelmixer', 'lut3d', 'tile',
  'palettegen', 'paletteuse', 'minterpolate', 'chromakey', 'despill', 'unsharp',
  // Sound: the mix, the dips, the voices, the leveling, the silences.
  'aresample', 'atrim', 'asetpts', 'adelay', 'afade', 'aloop', 'amix', 'anullsrc', 'apad', 'atempo', 'volume', 'loudnorm',
  'asplit', 'acrossfade', 'aformat', 'acompressor', 'afftdn', 'deesser', 'equalizer', 'highpass', 'lowpass', 'silencedetect',
  // The sample media's sounds, generated from expressions and shaped.
  'aevalsrc', 'bandpass', 'bass', 'treble',
];

/** The encoders and decoders every build carries: ffmpeg's own, with no library behind them. */
export const CORE_CODECS: readonly string[] = [
  'png', 'apng', 'gif', 'prores_ks', 'dnxhd', 'qtrle', 'aac', 'pcm_s16le', 'pcm_s24le', 'rawvideo', 'mjpeg', 'copy', 'flac',
];

/** What one build was found to have. A list that could not be read is null, and is not held against it. */
export interface FfmpegCapabilities {
  filters: readonly string[] | null;
  encoders: readonly string[] | null;
  decoders: readonly string[] | null;
}

/** One feature against one build: whether it can run, and the names it lacks if not. */
export interface FfmpegFeatureStatus {
  id: FfmpegFeature;
  ok: boolean;
  missing: string[];
  library?: string;
}

export function needFor(id: FfmpegFeature): FfmpegNeed {
  return FFMPEG_NEEDS.find((n) => n.id === id)!;
}

/** The features that exist on this platform. */
export function needsOn(platform: string): FfmpegNeed[] {
  return FFMPEG_NEEDS.filter((n) => !n.platforms || n.platforms.includes(platform));
}

/** One feature's answer from one build. */
export function featureStatus(caps: FfmpegCapabilities, id: FfmpegFeature): FfmpegFeatureStatus {
  const need = needFor(id);
  const missing: string[] = [];
  const lacks = (list: readonly string[] | null, names: readonly string[] | undefined) => {
    if (!names || list === null) return;
    for (const name of names) if (!list.includes(name)) missing.push(name);
  };
  lacks(caps.filters, need.filters);
  lacks(caps.encoders, need.encoders);
  // A decoder is needed by name only where the build lists its decoders; one of them is enough.
  if (need.decoders && caps.decoders !== null && !need.decoders.some((d) => caps.decoders!.includes(d))) missing.push(need.decoders[0]!);
  if (need.anyEncoder && caps.encoders !== null && !need.anyEncoder.some((e) => caps.encoders!.includes(e))) missing.push(need.anyEncoder[0]!);
  return { id, ok: missing.length === 0, missing, ...(need.library ? { library: need.library } : {}) };
}

/** Every feature on this platform against one build, in the table's order. */
export function featureStatuses(caps: FfmpegCapabilities, platform: string): FfmpegFeatureStatus[] {
  return needsOn(platform).map((n) => featureStatus(caps, n.id));
}

export function featureAvailable(caps: FfmpegCapabilities, id: FfmpegFeature): boolean {
  return featureStatus(caps, id).ok;
}

/** The feature an encoder belongs to, for a preset whose encoder is missing; undefined for one every build has. */
export function featureForEncoder(encoder: string): FfmpegFeature | undefined {
  return FFMPEG_NEEDS.find((n) => n.encoders?.includes(encoder))?.id;
}

/**
 * What a missing feature says, in one sentence a person can act on: what is
 * missing, as the build would have to be configured, and the way to a build
 * that has it.
 */
export function missingSentence(status: FfmpegFeatureStatus): string {
  const label = needFor(status.id).label;
  return status.library
    ? tr('ffmpeg.feature.missing', { feature: label, library: status.library, names: status.missing.join(', ') })
    : tr('ffmpeg.feature.missing.no-library', { feature: label, names: status.missing.join(', ') });
}

// ---------------------------------------------------------------- reading what a plan uses

/**
 * The filter names in an ffmpeg filter graph, in order of first use: the word
 * before each filter's options, with the labels and the arguments taken away.
 * Quoting and escaping are honored, so an expression's commas and a
 * `select='between(n\,0\,9)'` stay inside their filter.
 */
export function graphFilters(graph: string): string[] {
  const out: string[] = [];
  let depthQuote = false;
  let piece = '';
  const flush = () => {
    // Labels in front of a filter are [names]; the filter name is what comes before its "=".
    // and before its output labels, where it has no options: `[0:v]null[src]`.
    const name = piece.replace(/^(\s*\[[^\]]*\])+/, '').trim().split(/[=[]/)[0]!.trim();
    if (/^[a-z][a-z0-9_]*$/.test(name) && !out.includes(name)) out.push(name);
    piece = '';
  };
  for (let i = 0; i < graph.length; i++) {
    const c = graph[i]!;
    if (c === '\\') {
      piece += c + (graph[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === "'") depthQuote = !depthQuote;
    if (!depthQuote && (c === ',' || c === ';')) {
      flush();
      continue;
    }
    piece += c;
  }
  flush();
  return out;
}

/** Every filter and codec an ffmpeg argument list uses: the graphs after -vf, -af, -filter_complex and lavfi inputs, and each -c value. */
export function argsUse(args: readonly string[]): { filters: string[]; codecs: string[] } {
  const filters = new Set<string>();
  const codecs = new Set<string>();
  for (let i = 0; i < args.length - 1; i++) {
    const flag = args[i]!;
    const value = args[i + 1]!;
    if (flag === '-vf' || flag === '-af' || flag === '-filter_complex' || flag === '-lavfi') for (const f of graphFilters(value)) filters.add(f);
    if (flag === '-i' && args[i - 1] === 'lavfi') for (const f of graphFilters(value)) filters.add(f);
    if (/^-c(:[va](:\d+)?)?$/.test(flag) || flag === '-vcodec' || flag === '-acodec') codecs.add(value);
  }
  return { filters: [...filters], codecs: [...codecs] };
}

/** Every name the table knows: the features' needs and the core lists. */
export function tableNames(): { filters: Set<string>; codecs: Set<string> } {
  const filters = new Set(CORE_FILTERS);
  const codecs = new Set([...CORE_CODECS, ...FALLBACK_CODECS]);
  for (const n of FFMPEG_NEEDS) {
    for (const f of n.filters ?? []) filters.add(f);
    for (const c of [...(n.encoders ?? []), ...(n.decoders ?? []), ...(n.anyEncoder ?? [])]) codecs.add(c);
  }
  return { filters, codecs };
}
