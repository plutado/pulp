/**
 * Display names for stored values (docs/ui-style.md): no id, slug, extension or
 * codec name reaches the user as it is stored. Search syntax keeps the stored
 * ids on purpose; everything shown goes through here. Pure.
 *
 * Words are read from the message catalog when they are asked for (milestone 59),
 * so each call answers in the interface's language now. Numbers are still
 * formatted as they were; only the words and units around them are messages.
 */

import type { HdrFormat } from './hdr';
import type { FieldOrder } from './interlace';
import { formatNumber } from './locale-format';
import { tr, type MessageId } from './i18n';
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

/** A manifest's category (src/core/manifest.ts), named. */
const CATEGORY_MESSAGES: Record<string, MessageId> = {
  'lower-third': 'display.category.lower-third',
  title: 'display.category.title', // i18n-exempt(technical): a message id
  transition: 'display.category.transition',
  overlay: 'display.category.overlay',
  background: 'display.category.background',
  other: 'display.category.other',
};

export function categoryLabel(category: string): string {
  const id = CATEGORY_MESSAGES[category];
  return id ? tr(id) : humanize(category);
}

// The entries themselves, not their labels: a label is a getter, read when it is shown.
const themes = new Map(THEME_GROUPS.flatMap((g) => g.themes.map((t) => [t.id, t] as const)));
const styles = new Map(STYLES.map((s) => [s.id, s] as const));

export function themeLabel(id: string): string {
  return themes.get(id)?.label ?? humanize(id);
}

export function styleLabel(id: string): string {
  return styles.get(id)?.label ?? humanize(id);
}

const MEDIA_KIND_MESSAGES: Record<string, MessageId> = {
  video: 'display.media-kind.video',
  image: 'display.media-kind.image',
  audio: 'display.media-kind.audio',
};

export function mediaKindLabel(kind: string): string {
  const id = MEDIA_KIND_MESSAGES[kind];
  return id ? tr(id) : humanize(kind);
}

/** ".mov" or "mov" → "MOV". */
export function extensionLabel(ext: string): string {
  return ext.replace(/^\./, '').toUpperCase();
}

/** Codecs by the names editors use: names, the same in every language. */
const CODEC_LABELS: Record<string, string> = {
  prores: 'ProRes',
  h264: 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  vp9: 'VP9',
  vp8: 'VP8',
  av1: 'AV1',
  png: 'PNG',
  dnxhd: 'DNxHD',
  aac: 'AAC',
  mp3: 'MP3',
  opus: 'Opus',
  flac: 'FLAC',
  vorbis: 'Vorbis',
  alac: 'ALAC',
};

/** Codecs whose names carry words, which are the catalog's. */
const CODEC_MESSAGES: Record<string, MessageId> = {
  qtrle: 'display.codec.qtrle',
  mjpeg: 'display.codec.mjpeg',
};

/** ffprobe's codec name as editors say it; unknown names are shown in capitals rather than invented. */
export function codecLabel(codec: string): string {
  const key = codec.toLowerCase();
  if (CODEC_LABELS[key]) return CODEC_LABELS[key];
  const words = CODEC_MESSAGES[key];
  if (words) return tr(words);
  // PCM by its sample size ("pcm_s16le" is 16-bit); 32-bit float is said as such.
  if (key === 'pcm_f32le') return tr('display.codec.pcm-float', { bits: 32 });
  const pcm = /^pcm_[sfu](\d+)/.exec(key);
  if (pcm) return tr('display.codec.pcm', { bits: pcm[1]! });
  return codec.toUpperCase();
}

/**
 * What an HDR clip's own transfer is called (milestone 81): the two are known
 * by their initials wherever video is talked about, so the label keeps them
 * and says what they are once, in the tooltip that goes with it.
 */
export function hdrLabel(hdr: HdrFormat): string {
  return hdr === 'pq' ? tr('display.hdr.pq') : tr('display.hdr.hlg');
}

/** Which field an interlaced clip shows first, in words (milestone 83). */
export function fieldOrderLabel(field: FieldOrder): string {
  return field === 'tff' ? tr('display.field.tff') : tr('display.field.bff');
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
  return tr('display.frame-rate', { fps });
}

/** Seconds as a template declares them: "6 s", "1.5 s". */
export function durationLabel(seconds: number): string {
  return tr('display.duration', { seconds: formatNumber(seconds, 3) });
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

/**
 * A running time as a clock reads it, the way a video site prints a length over a thumbnail:
 * "0:04", "1:30", "1:02:03" — no unit, nothing to misread (milestone 66). Whole seconds,
 * rounded, and never "0:00" for something that runs at all.
 */
export function runningTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const whole = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const ss = String(whole % 60).padStart(2, '0');
  if (minutes < 60) return `${minutes}:${ss}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${ss}`;
}

export function sizeLabel(bytes: number): string {
  // The number in the interface's language: "1.5 MB", "1,5 MB".
  if (bytes < 1024) return tr('display.size.bytes', { size: formatNumber(bytes, 0) });
  if (bytes < 1024 ** 2) return tr('display.size.kb', { size: formatNumber(bytes / 1024, 0) });
  if (bytes < 1024 ** 3) return tr('display.size.mb', { size: formatNumber(bytes / 1024 ** 2, 1) });
  return tr('display.size.gb', { size: formatNumber(bytes / 1024 ** 3, 2) });
}

/** Audio facts: "PCM 16-bit · 2 ch · 48 kHz" (parts that are known). */
export function audioLabel(codec: string, channels?: number, sampleRate?: number): string {
  return [codecLabel(codec), channels ? tr('display.audio.channels', { count: channels }) : '', sampleRate ? tr('display.audio.sample-rate', { rate: sampleRate / 1000 }) : ''].filter(Boolean).join(' · ');
}

/**
 * What the file manager is called here, for the Reveal action. The platform's
 * own word, because the user is about to see that application.
 */
export function revealLabel(platform: string): string {
  if (platform === 'darwin') return tr('display.reveal.darwin');
  if (platform === 'win32') return tr('display.reveal.win32');
  return tr('display.reveal.other');
}

/**
 * A library root as a browse node: the bundled samples are "Built-in templates"; a user
 * folder's name is humanized like a tag ("media-library" → "Media library"), which leaves
 * names already in readable form alone ("News Pack"). The full path belongs in the tooltip.
 */
export function rootLabel(root: string, builtInRoot: string | undefined): string {
  if (builtInRoot !== undefined && root === builtInRoot) return tr('display.root.built-in');
  return humanize(root.split(/[\\/]/).filter(Boolean).pop() ?? root);
}

/**
 * A count of items in words, for somewhere it is read rather than seen: a
 * browse node's accessible name says "Lower third, 5 items", where the panel
 * shows the bare number beside the label.
 */
export function itemCount(count: number): string {
  return tr('display.item-count', { count });
}
