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
/** The product's name, as it is written everywhere it is shown. */
export const APP_NAME = 'Pulp';

export function dimensionsLabel(width: number, height: number): string {
  return `${width} × ${height}`;
}

/**
 * What the window is called. A packaged build is just "Pulp"; run from source
 * it names the checkout it is running from — "Pulp — feature-x" — so two copies side
 * by side can be told apart in the Dock, the task bar and a window list. The
 * folder is the app path's own name; anything unusable leaves the plain name.
 */
export function windowTitle(appPath: string, packaged: boolean): string {
  if (packaged) return APP_NAME;
  const folder = appPath.split(/[\\/]/).filter((part) => part.trim() !== '').pop();
  return folder ? `${APP_NAME} — ${folder}` : APP_NAME;
}

export function frameRateLabel(fps: number): string {
  return `${fps} fps`;
}

/** Seconds as a template declares them: "6 s", "1.5 s". */
export function durationLabel(seconds: number): string {
  return `${seconds} s`;
}

/**
 * A running time where space is tight (cards, list rows): seconds up to a
 * minute ("6 s", "1.5 s"), minutes and seconds beyond it ("3:24"). Timecode is
 * for the player, which counts frames; this only has to be read at a glance.
 */
export function clockLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return durationLabel(Math.round(seconds * 10) / 10);
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
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

/**
 * What the file manager is called here, for the Reveal action. The platform's
 * own word, because the user is about to see that application.
 */
export function revealLabel(platform: string): string {
  if (platform === 'darwin') return 'Reveal in Finder';
  if (platform === 'win32') return 'Show in Explorer';
  return 'Show in file manager';
}

/**
 * A library root as a browse node: the bundled samples are "Built-in templates"; a user
 * folder's name is humanized like a tag ("media-library" → "Media library"), which leaves
 * names already in readable form alone ("News Pack"). The full path belongs in the tooltip.
 */
export function rootLabel(root: string, builtInRoot: string | undefined): string {
  if (builtInRoot !== undefined && root === builtInRoot) return 'Built-in templates';
  return humanize(root.split(/[\\/]/).filter(Boolean).pop() ?? root);
}
