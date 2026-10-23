/**
 * Display names for stored values (docs/ui-style.md): no id, slug, extension or
 * codec name reaches the user as it is stored. Search syntax keeps the stored
 * ids on purpose; everything shown goes through here. Pure.
 */

import { THEME_GROUPS, STYLES, typeInfo } from './taxonomy';

/** "lower-third" or "my_show" → "Lower third", "My show": dashes and underscores to spaces, first letter capitalized. */
export function humanize(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Tags and themes are stored normalized for search and shown humanized. */
export const tagLabel = humanize;

export function typeLabel(id: string): string {
  return typeInfo(id)?.label ?? humanize(id);
}

export function categoryLabel(category: string): string {
  return humanize(category);
}

const themeLabels = new Map(THEME_GROUPS.flatMap((g) => g.themes.map((t) => [t.id, t.label] as const)));
const styleLabels = new Map(STYLES.map((s) => [s.id, s.label] as const));

export function themeLabel(id: string): string {
  return themeLabels.get(id) ?? humanize(id);
}

export function styleLabel(id: string): string {
  return styleLabels.get(id) ?? humanize(id);
}

export function mediaKindLabel(kind: string): string {
  return humanize(kind);
}

/** ".mov" or "mov" → "MOV". */
export function extensionLabel(ext: string): string {
  return ext.replace(/^\./, '').toUpperCase();
}

const CODEC_LABELS: Record<string, string> = {
  prores: 'ProRes',
  h264: 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  vp9: 'VP9',
  vp8: 'VP8',
  av1: 'AV1',
  qtrle: 'QuickTime Animation',
  png: 'PNG',
  mjpeg: 'Motion JPEG',
  dnxhd: 'DNxHD',
  aac: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  flac: 'FLAC',
  vorbis: 'Vorbis',
  alac: 'ALAC',
  pcm_s16le: 'PCM 16-bit',
  pcm_s24le: 'PCM 24-bit',
  pcm_f32le: 'PCM 32-bit float',
};

/** ffprobe's codec name as editors say it; unknown names are shown in capitals rather than invented. */
export function codecLabel(codec: string): string {
  const key = codec.toLowerCase();
  if (CODEC_LABELS[key]) return CODEC_LABELS[key];
  const pcm = /^pcm_[sfu](\d+)/.exec(key);
  if (pcm) return `PCM ${pcm[1]}-bit`;
  return codec.toUpperCase();
}

/** "1920 × 1080", with a real multiplication sign. */
export function dimensionsLabel(width: number, height: number): string {
  return `${width} × ${height}`;
}

export function frameRateLabel(fps: number): string {
  return `${fps} fps`;
}

/** Seconds as a template declares them: "6 s", "1.5 s". */
export function durationLabel(seconds: number): string {
  return `${seconds} s`;
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2).replace(/\.?0+$/, '')} GB`;
}

/** Audio facts: "PCM 16-bit · 2 ch · 48 kHz" (parts that are known). */
export function audioLabel(codec: string, channels?: number, sampleRate?: number): string {
  return [codecLabel(codec), channels ? `${channels} ch` : '', sampleRate ? `${sampleRate / 1000} kHz` : ''].filter(Boolean).join(' · ');
}

/** A library root as a browse node: the bundled samples are "Built-in templates"; user folders keep their own names. */
export function rootLabel(root: string, builtInRoot: string | undefined): string {
  if (builtInRoot !== undefined && root === builtInRoot) return 'Built-in templates';
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}
