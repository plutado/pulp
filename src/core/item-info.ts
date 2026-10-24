/**
 * What the Info tab says about an item: the sections, and the key–value rows
 * inside them (docs/ui-style.md). Pure, so every string the panel shows goes
 * through the display module once, here, where the style test can read it —
 * rather than being assembled in JSX where it cannot.
 *
 * A row whose value is not known is left out. An empty section is left out too:
 * a panel of "Unknown" tells the reader nothing they could not already see.
 */

import {
  audioLabel,
  clockLabel,
  codecLabel,
  dimensionsLabel,
  durationLabel,
  extensionLabel,
  frameRateLabel,
  mediaKindLabel,
  sizeLabel,
  typeLabel,
} from './display';
import type { LibraryEntry } from './library-types';
import { licenseWarning } from './pack';
import { entryType } from './taxonomy';
import { formatTimecode } from './timecode';

/** The sections of the panel, in the order they are shown. */
export const INFO_SECTIONS = [
  { id: 'about', label: 'About' },
  { id: 'format', label: 'Format' },
  { id: 'categories', label: 'Categories' },
  { id: 'tags', label: 'Tags' },
  { id: 'set', label: 'Set' },
  { id: 'file', label: 'File' },
  { id: 'credits', label: 'Credits and license' },
  { id: 'usage', label: 'Usage' },
] as const;

export type InfoSectionId = (typeof INFO_SECTIONS)[number]['id'];

/** One fact: a muted label and its value, with an optional badge icon and tone. */
export interface InfoRow {
  label: string;
  value: string;
  /** A badge icon from the card vocabulary: alpha, loop, duration. */
  icon?: 'alpha' | 'loop' | 'duration';
  /** Warn about a value that needs a second look, such as an unknown license. */
  tone?: 'warn';
  /** The long form, when the value is shortened. */
  tip?: string;
  /** Shown as a chip rather than plain text: a license, which is a label on the work. */
  badge?: boolean;
}

/** Sections the panel builds from the entry alone; chips and actions are the component's. */
export function aboutRows(entry: LibraryEntry): InfoRow[] {
  const rows: InfoRow[] = [];
  if (entry.kind === 'template' && entry.manifest.description) rows.push({ label: 'Description', value: entry.manifest.description });
  return rows;
}

/** Format: what the item *is*, in numbers. Templates declare theirs; media is probed. */
export function formatRows(entry: LibraryEntry): InfoRow[] {
  const rows: InfoRow[] = [];
  if (entry.kind === 'template') {
    const m = entry.manifest;
    rows.push({ label: 'Aspect', value: aspectLabel(m.width, m.height) });
    rows.push({ label: 'Size', value: dimensionsLabel(m.width, m.height) });
    // The length as timecode, not the last frame's: "6 s · 00:00:06:00" reads as a duration.
    rows.push({ label: 'Duration', value: `${durationLabel(m.duration)} · ${formatTimecode(Math.round(m.duration * m.fps), m.fps)}`, icon: 'duration' });
    rows.push({ label: 'Frame rate', value: frameRateLabel(m.fps) });
    rows.push({ label: 'Alpha', value: m.alpha ? 'Transparent background' : 'Opaque', ...(m.alpha ? { icon: 'alpha' as const } : {}) });
    if (entryType(entry) === 'animated-loop') rows.push({ label: 'Loop', value: 'Made to loop seamlessly', icon: 'loop' });
    return rows;
  }
  const meta = entry.meta;
  rows.push({ label: 'Kind', value: `${mediaKindLabel(entry.mediaKind)} · ${extensionLabel(entry.ext)}` });
  if (meta?.width && meta.height) {
    rows.push({ label: 'Aspect', value: aspectLabel(meta.width, meta.height) });
    rows.push({ label: 'Size', value: dimensionsLabel(meta.width, meta.height) });
  }
  if (meta?.duration) {
    const fps = meta.fps ?? 25;
    rows.push({ label: 'Duration', value: `${clockLabel(meta.duration)} · ${formatTimecode(Math.round(meta.duration * fps), fps)}`, icon: 'duration' });
  }
  if (meta?.fps && entry.mediaKind === 'video') rows.push({ label: 'Frame rate', value: frameRateLabel(meta.fps) });
  if (meta?.codec) rows.push({ label: 'Codec', value: codecLabel(meta.codec) });
  if (meta?.alpha) rows.push({ label: 'Alpha', value: 'Transparent background', icon: 'alpha' });
  if (entryType(entry) === 'animated-loop') rows.push({ label: 'Loop', value: 'Made to loop seamlessly', icon: 'loop' });
  if (meta?.audioCodec) rows.push({ label: 'Audio', value: audioLabel(meta.audioCodec, meta.channels, meta.sampleRate) });
  return rows;
}

/** "16:9", "9:16", "1:1" where it is one of the common shapes; the ratio otherwise. */
export function aspectLabel(width: number | undefined, height: number | undefined): string {
  if (!width || !height) return '';
  const divisor = gcd(width, height);
  const w = width / divisor;
  const h = height / divisor;
  // Past a point the exact ratio says less than a rounded one: 1920 × 1080 is 16:9, not 16:9.0001.
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  const ratio = width / height;
  const near = [
    [16, 9],
    [9, 16],
    [1, 1],
    [4, 5],
    [4, 3],
    [3, 4],
    [21, 9],
  ].find(([a, b]) => Math.abs(ratio - a! / b!) < 0.01);
  return near ? `${near[0]}:${near[1]}` : `${ratio.toFixed(2)}:1`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** File: where it is and what the filesystem says about it. The location is a tooltip, never a card's text. */
export function fileRows(entry: LibraryEntry): InfoRow[] {
  const rows: InfoRow[] = [];
  const where = entry.kind === 'template' ? entry.dir : entry.path;
  // The value is a breadcrumb inside the library folder, not a path: it reads
  // "boardroom/lower-third" on every platform, while the tooltip keeps the
  // native path (with backslashes on Windows) for anyone who wants the real thing.
  const inside = where.slice(entry.root.length).split(/[\\/]+/).filter(Boolean).join('/');
  rows.push({ label: 'Location', value: inside || where, tip: where });
  if (entry.size !== undefined) rows.push({ label: 'Size on disk', value: sizeLabel(entry.size) });
  if (entry.mtimeMs !== undefined && entry.mtimeMs > 0) rows.push({ label: 'Modified', value: dateLabel(entry.mtimeMs) });
  return rows;
}

/** Credits: who made it and under what terms, with a warning where the terms are unclear. */
export function creditsRows(entry: LibraryEntry): InfoRow[] {
  if (entry.kind !== 'template') return [];
  const m = entry.manifest;
  const rows: InfoRow[] = [];
  if (m.author) rows.push({ label: 'Author', value: m.author });
  rows.push({ label: 'Version', value: m.version });
  const warning = licenseWarning(m.license);
  rows.push({ label: 'License', value: m.license, badge: true, ...(warning ? { tone: 'warn' as const, tip: warning } : {}) });
  return rows;
}

/** Usage: what this item has been part of. */
export function usageRows(entry: LibraryEntry, presets: number): InfoRow[] {
  const rows: InfoRow[] = [];
  rows.push({ label: 'Last used', value: entry.lastUsed ? dateLabel(Date.parse(entry.lastUsed)) : 'Not yet' });
  rows.push({ label: 'Renders', value: entry.renderCount ? `${entry.renderCount}` : 'None yet' });
  if (entry.kind === 'template') rows.push({ label: 'Saved presets', value: presets > 0 ? `${presets}` : 'None yet' });
  return rows;
}

/** A date as a reader scans it: "24 Oct 2026, 14:05". */
export function dateLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const d = new Date(ms);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${month} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A sibling's name with the set's own name taken off the front: in a list of
 * pieces under "Boardroom", "Boardroom lower third" says one word of use.
 */
export function pieceLabel(name: string, packName: string): string {
  const prefix = `${packName} `;
  if (!name.toLowerCase().startsWith(prefix.toLowerCase())) return name;
  const rest = name.slice(prefix.length).trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : name;
}

/** The item's own type, named, and — for media — where that type came from. */
export function typeRow(entry: LibraryEntry): InfoRow | null {
  const type = entryType(entry);
  if (!type) return entry.kind === 'media' ? { label: 'Type', value: `${mediaKindLabel(entry.mediaKind)} · no folder said more` } : null;
  const from = entry.kind === 'media' ? ' · from its folder' : '';
  return { label: 'Type', value: `${typeLabel(type)}${from}` };
}
