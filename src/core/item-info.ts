/**
 * What the Info tab says about an item: the sections, and the key–value rows
 * inside them (docs/ui-style.md). Pure, so every string the panel shows goes
 * through the display module once, here, where the style test can read it —
 * rather than being assembled in JSX where it cannot.
 *
 * A row whose value is not known is left out. An empty section is left out too:
 * a panel of "Unknown" tells the reader nothing they could not already see.
 */

import { versionLabel } from './music-groups';
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
import { templateDefaultSize } from './aspect';
import type { LibraryEntry } from './library-types';
import type { LottieInfo } from './lottie-types';
import { licenseWarning } from './pack';
import { entryType } from './taxonomy';
import { formatTimecode } from './timecode';
import { lottieFormatLabel } from './lottie-types';
import { tr } from './i18n';
import { unreadableNote } from './unreadable-media';
import { formatDateTime, formatNumber } from './locale-format';

/** The sections of the panel, in the order they are shown; each named in the interface's language now (a getter). */
export const INFO_SECTIONS = [
  { id: 'about', get label() { return tr('info.section.about'); } },
  { id: 'format', get label() { return tr('info.section.format'); } },
  { id: 'layers', get label() { return tr('info.section.layers'); } },
  { id: 'categories', get label() { return tr('info.section.categories'); } },
  { id: 'tags', get label() { return tr('info.section.tags'); } },
  { id: 'set', get label() { return tr('info.section.set'); } },
  { id: 'file', get label() { return tr('info.section.file'); } },
  { id: 'cleanup', get label() { return tr('info.section.cleanup'); } },
  { id: 'images', get label() { return tr('info.section.images'); } },
  { id: 'credits', get label() { return tr('info.section.credits'); } },
  { id: 'usage', get label() { return tr('info.section.usage'); } },
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
  if (entry.kind === 'template' && entry.manifest.description) rows.push({ label: tr('info.row.description'), value: entry.manifest.description });
  return rows;
}

/** Format: what the item *is*, in numbers. Templates declare theirs; media is probed. */
export function formatRows(entry: LibraryEntry): InfoRow[] {
  const rows: InfoRow[] = [];
  if (entry.kind === 'template') {
    const m = entry.manifest;
    // A template is a shape, or several; a pixel size only where the manifest declared one (ADR 0012).
    rows.push({ label: (m.aspects.length > 1 ? tr('info.row.aspects') : tr('info.row.aspect')), value: m.aspects.join(', ') });
    if (m.size) rows.push({ label: tr('info.row.size'), value: dimensionsLabel(m.size.width, m.size.height) });
    else rows.push({ label: tr('info.row.size'), value: tr('info.value.size-at-render', { size: dimensionsLabel(templateDefaultSize(m).width, templateDefaultSize(m).height) }) });
    // The length as timecode, not the last frame's: "6 s · 00:00:06:00" reads as a duration.
    rows.push({ label: tr('info.row.duration'), value: `${durationLabel(m.duration)} · ${formatTimecode(Math.round(m.duration * m.fps), m.fps)}`, icon: 'duration' });
    rows.push({ label: tr('info.row.frame-rate'), value: frameRateLabel(m.fps) });
    rows.push({ label: tr('info.row.alpha'), value: m.alpha ? tr('info.value.transparent') : tr('info.value.opaque'), ...(m.alpha ? { icon: 'alpha' as const } : {}) });
    if (entryType(entry) === 'animated-loop') rows.push({ label: tr('info.row.loop'), value: tr('info.value.loop'), icon: 'loop' });
    if (entry.lottie) rows.push(...lottieRows(entry.lottie));
    return rows;
  }
  const meta = entry.meta;
  rows.push({ label: tr('info.row.kind'), value: `${mediaKindLabel(entry.mediaKind)} · ${extensionLabel(entry.ext)}` });
  if (meta?.width && meta.height) {
    rows.push({ label: tr('info.row.aspect'), value: aspectLabel(meta.width, meta.height) });
    rows.push({ label: tr('info.row.size'), value: dimensionsLabel(meta.width, meta.height) });
  }
  if (meta?.duration) {
    const fps = meta.fps ?? 25;
    rows.push({ label: tr('info.row.duration'), value: `${clockLabel(meta.duration)} · ${formatTimecode(Math.round(meta.duration * fps), fps)}`, icon: 'duration' });
  }
  // A file Pulp cannot read: what it is, what it needs, and that the picture is only its preview (milestone 32).
  if (entry.unreadable) rows.push({ label: tr('info.row.unreadable'), value: [unreadableNote(entry.path.split(/[\\/]/).pop()!, entry.unreadable.ext), entry.unreadable.preview ? tr('info.value.unreadable.preview') : ''].filter(Boolean).join(' '), tone: 'warn' });
  if (entry.missing) rows.push({ label: tr('info.row.missing'), value: tr('info.value.missing', { path: entry.path }), tone: 'warn' });
  // A track's cuts, a song's stems, a transition's sound (milestone 32).
  if (entry.versions?.length) rows.push({ label: tr('info.row.versions'), value: tr('info.value.versions', { lengths: entry.versions.map((v) => versionLabel(v.label, tr('music.version.full'))).join(' · ') }) });
  if (entry.stemParts?.length) rows.push({ label: tr('info.row.stems'), value: tr('info.value.stems', { stems: entry.stemParts.map((v) => v.label).join(' · ') }) });
  if (entry.pairedSound) rows.push({ label: tr('info.row.paired-sound'), value: tr('info.value.paired-sound') });
  // Where a file inside an archive lives, and whether it has been unpacked yet (milestone 32).
  if (entry.archive) {
    const zip = entry.archive.zip.split(/[\\/]/).pop()!;
    rows.push({ label: tr('info.row.archive'), value: entry.archive.unpacked ? tr('info.value.archive.unpacked', { zip, member: entry.archive.member }) : tr('info.value.archive.packed', { zip, member: entry.archive.member }) });
  }
  // A clip set's parts, each with its own length, and what it does with a length (milestone 32).
  if (entry.clipSet) {
    const p = meta?.parts;
    const name = (path: string | undefined) => (path ? path.split(/[\\/]/).pop()! : '');
    const part = (id: 'intro' | 'loop' | 'outro', path: string | undefined, seconds: number | undefined) =>
      path ? tr(`info.value.clip-set.${id}`, { file: name(path), seconds: seconds !== undefined ? durationLabel(Math.round(seconds * 100) / 100) : '—' }) : '';
    rows.push({ label: tr('info.row.clip-set'), value: [part('intro', entry.clipSet.intro, p?.intro), part('loop', entry.clipSet.loop, p?.loop), part('outro', entry.clipSet.outro, p?.outro)].filter(Boolean).join(' · '), icon: 'loop' });
    rows.push({ label: tr('info.row.loop'), value: tr('info.value.clip-set.stretches') });
  }
  if (meta?.fps && entry.mediaKind === 'video') rows.push({ label: tr('info.row.frame-rate'), value: frameRateLabel(meta.fps) });
  if (meta?.codec) rows.push({ label: tr('info.row.codec'), value: codecLabel(meta.codec) });
  if (meta?.alpha) rows.push({ label: tr('info.row.alpha'), value: tr('info.value.transparent'), icon: 'alpha' });
  if (entryType(entry) === 'animated-loop') rows.push({ label: tr('info.row.loop'), value: tr('info.value.loop'), icon: 'loop' });
  if (meta?.audioCodec) rows.push({ label: tr('info.row.audio'), value: audioLabel(meta.audioCodec, meta.channels, meta.sampleRate) });
  return rows;
}

/**
 * What a Lottie animation says of itself beyond its manifest (milestone 35):
 * the file it was read from, its own size where the manifest rounded it, its
 * markers, what of it is editable, and what the player cannot draw.
 */
export function lottieRows(info: LottieInfo): InfoRow[] {
  const rows: InfoRow[] = [{ label: tr('info.row.source'), value: lottieFormatLabel(info.format) }];
  if (info.width % 2 !== 0 || info.height % 2 !== 0) rows.push({ label: tr('info.row.own-size'), value: tr('info.value.own-size', { size: dimensionsLabel(info.width, info.height) }) });
  if (info.animations && info.animations.length > 1) rows.push({ label: tr('info.row.animations'), value: tr('info.value.animations', { count: info.animations.length, first: info.animations[0]! }) });
  if (info.markers.length > 0) {
    rows.push({
      label: tr('info.row.markers'),
      value: info.markers
        .map((m) => (m.duration > 0
          ? tr('info.value.marker-span', { name: m.name, from: trimSeconds(m.time), to: trimSeconds(m.time + m.duration) })
          : tr('info.value.marker-at', { name: m.name, time: trimSeconds(m.time) })))
        .join(' · '),
    });
  }
  const texts = info.bindings.filter((b) => b.type === 'text').length;
  const colours = info.bindings.filter((b) => b.type === 'color').length;
  const editable = texts > 0 && colours > 0
    ? tr('info.value.editable-both', { texts: tr('info.value.editable-texts', { count: texts }), colors: tr('info.value.editable-colors', { count: colours }) })
    : texts > 0 ? tr('info.value.editable-texts', { count: texts }) : colours > 0 ? tr('info.value.editable-colors', { count: colours }) : '';
  rows.push({ label: tr('info.row.editable'), value: editable !== '' ? editable : tr('info.value.editable-none') });
  // What the player cannot draw, each said in the interface's language (src/core/lottie.ts).
  if (info.limits.length > 0) rows.push({ label: tr('info.row.not-drawn'), value: info.limits.map((l) => tr('lottie.limit.sentence', { limit: capitalized(tr(l.id, l.values)) })).join(tr('lottie.description.separator')), tone: 'warn' });
  return rows;
}

/** A clause as the start of a sentence: its first letter capitalized, where its script has capitals. */
const capitalized = (s: string): string => s.charAt(0).toLocaleUpperCase() + s.slice(1);

const trimSeconds = (s: number): string => String(Math.round(s * 100) / 100);

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
  // A Lottie animation is one file, not a folder (milestone 35), so its location is the file.
  const where = entry.kind === 'template' ? (entry.lottie?.path ?? entry.dir) : entry.path;
  // The value is a breadcrumb inside the library folder, not a path: it reads
  // "boardroom/lower-third" on every platform, while the tooltip keeps the
  // native path (with backslashes on Windows) for anyone who wants the real thing.
  const inside = where.slice(entry.root.length).split(/[\\/]+/).filter(Boolean).join('/');
  rows.push({ label: tr('info.row.location'), value: inside || where, tip: where });
  if (entry.size !== undefined) rows.push({ label: tr('info.row.size-on-disk'), value: sizeLabel(entry.size) });
  if (entry.mtimeMs !== undefined && entry.mtimeMs > 0) rows.push({ label: tr('info.row.modified'), value: dateLabel(entry.mtimeMs) });
  return rows;
}

/** Credits: who made it and under what terms, with a warning where the terms are unclear. */
export function creditsRows(entry: LibraryEntry): InfoRow[] {
  if (entry.kind !== 'template') return [];
  const m = entry.manifest;
  const rows: InfoRow[] = [];
  if (m.author) rows.push({ label: tr('info.row.author'), value: m.author });
  rows.push({ label: tr('info.row.version'), value: m.version });
  const warning = licenseWarning(m.license);
  rows.push({ label: tr('info.row.license'), value: m.license, badge: true, ...(warning ? { tone: 'warn' as const, tip: warning } : {}) });
  return rows;
}

/** Usage: what this item has been part of. */
export function usageRows(entry: LibraryEntry, presets: number): InfoRow[] {
  const rows: InfoRow[] = [];
  rows.push({ label: tr('info.row.last-used'), value: entry.lastUsed ? dateLabel(Date.parse(entry.lastUsed)) : tr('info.value.not-yet') });
  rows.push({ label: tr('info.row.renders'), value: entry.renderCount ? formatNumber(entry.renderCount, 0) : tr('info.value.none-yet') });
  if (entry.kind === 'template') rows.push({ label: tr('info.row.saved-presets'), value: presets > 0 ? formatNumber(presets, 0) : tr('info.value.none-yet') });
  return rows;
}

/** A date as a reader scans it, the way the interface's language writes it (src/core/locale-format.ts). */
export function dateLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return formatDateTime(ms);
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
  if (!type) return entry.kind === 'media' ? { label: tr('info.row.type'), value: tr('info.value.type-untyped', { kind: mediaKindLabel(entry.mediaKind) }) } : null;
  return { label: tr('info.row.type'), value: entry.kind === 'media' ? tr('info.value.type-from-folder', { type: typeLabel(type) }) : typeLabel(type) };
}
