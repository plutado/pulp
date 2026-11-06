/**
 * Platform presets (milestone 20): where a render is going, chosen once.
 *
 * A platform preset is mostly an aspect, a resolution and a frame rate, with
 * the encoder every platform takes — H.264 video in an MP4, carrying AAC
 * where there is sound. Choosing one in the Output tab sets all four
 * together, so "this is for TikTok" is one choice rather than four.
 *
 * **The file, not the account.** Nothing here logs in or posts. A preset is a
 * shape, a size and a rate, and the limits are what the platform publishes
 * about the file it will take.
 *
 * **This data ages.** Platforms move their limits without telling anyone, so
 * the list carries the date it was last checked and the window shows that
 * date beside it. Every limit is a warning and never a refusal: a limit may
 * have moved since the list was written, and the person rendering may know
 * something the list does not.
 *
 * Pure: no Node, no DOM.
 */

import { aspectById } from './aspect';
import { clockLabel, sizeLabel } from './display';
import { isStandardFrameRate } from './timecode';
import { OUTPUT_PRESETS, type PresetId } from './render-plan';
import { tr, type MessageId } from './i18n';

/** Bumped when an entry's meaning changes rather than its numbers; a saved render records the id, not the row. */
export const PLATFORM_LIST_VERSION = 1;

/** The day every limit below was last read from the platforms themselves. Shown wherever a limit is. */
export const PLATFORM_LIMITS_CHECKED = '2026-11-01';

export interface PlatformPreset {
  /** Permanent; a saved render and a collection card carry it. Add, never rename. */
  id: string;
  /** The platform, as it writes its own name. */
  label: string;
  /** What this one is for, in a few words, for the start screen and the tooltip. */
  hint: string;
  /** One of the built-in aspects (src/core/aspect.ts). */
  aspect: string;
  width: number;
  height: number;
  fps: number;
  /** The output preset chosen with it: H.264 in an MP4 everywhere, which is what every platform takes. */
  presetId: PresetId;
  /** The sound codec the container carries, for a render that has sound (src/core/media-render.ts). */
  audioCodec: 'aac';
  /** The video bitrate the platform's own guidance aims at, in megabits per second; the size estimate uses it. */
  bitrateMbps: number;
  /** The longest file the platform takes, in seconds. */
  maxSeconds: number;
  /** The largest file the platform takes, in MB (1024 × 1024 bytes). */
  maxFileMB: number;
  /**
   * The platform's own upload page (milestone 20, hand-off): where "Open
   * upload page" sends the browser while the file manager shows the file.
   * Always https, and only ever one of these built-in values — the main
   * process opens it by the preset's id, never a URL the window sends.
   */
  uploadUrl: string;
  /**
   * The integrated loudness the platform plays everything back at, LUFS (EBU
   * R128): what a render aimed here has its mix leveled to (milestone 52).
   * The platforms normalize on playback anyway; leveling first means what is
   * uploaded is what is heard, with no surprise gain on their side.
   */
  loudnessLufs: number;
  /** The true-peak ceiling the leveling holds the mix under, dBTP. */
  truePeakDb: number;
}

/**
 * The list. Every one is H.264 in an MP4 at 30 fps, which is the rate the
 * vertical platforms publish and the one a 25 or 24 fps template resamples to
 * without surprises; the frame rate stays a free choice in the Output tab
 * afterwards.
 */
export const PLATFORM_PRESETS: readonly PlatformPreset[] = [
  {
    id: 'tiktok', get label() { return tr('platform.tiktok'); }, get hint() { return tr('platform.tiktok.hint'); },
    aspect: '9:16', width: 1080, height: 1920, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 10, maxSeconds: 600, maxFileMB: 287,
    uploadUrl: 'https://www.tiktok.com/upload',
    loudnessLufs: -14, truePeakDb: -1,
  },
  {
    id: 'instagram-reels', get label() { return tr('platform.instagram-reels'); }, get hint() { return tr('platform.instagram-reels.hint'); },
    aspect: '9:16', width: 1080, height: 1920, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 10, maxSeconds: 180, maxFileMB: 4096,
    uploadUrl: 'https://www.instagram.com/',
    loudnessLufs: -14, truePeakDb: -1,
  },
  {
    id: 'instagram-feed', get label() { return tr('platform.instagram-feed'); }, get hint() { return tr('platform.instagram-feed.hint'); },
    aspect: '4:5', width: 1080, height: 1350, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 8, maxSeconds: 3600, maxFileMB: 4096,
    uploadUrl: 'https://www.instagram.com/',
    loudnessLufs: -14, truePeakDb: -1,
  },
  {
    id: 'youtube-shorts', get label() { return tr('platform.youtube-shorts'); }, get hint() { return tr('platform.youtube-shorts.hint'); },
    aspect: '9:16', width: 1080, height: 1920, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 10, maxSeconds: 180, maxFileMB: 262_144,
    uploadUrl: 'https://www.youtube.com/upload',
    loudnessLufs: -14, truePeakDb: -1,
  },
  {
    id: 'youtube', get label() { return tr('platform.youtube'); }, get hint() { return tr('platform.youtube.hint'); },
    aspect: '16:9', width: 1920, height: 1080, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 8, maxSeconds: 43_200, maxFileMB: 262_144,
    uploadUrl: 'https://www.youtube.com/upload',
    loudnessLufs: -14, truePeakDb: -1,
  },
  {
    id: 'x', get label() { return tr('platform.x'); }, get hint() { return tr('platform.x.hint'); },
    aspect: '16:9', width: 1920, height: 1080, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 8, maxSeconds: 140, maxFileMB: 512,
    uploadUrl: 'https://x.com/compose/post',
    loudnessLufs: -14, truePeakDb: -1,
  },
  {
    id: 'linkedin', get label() { return tr('platform.linkedin'); }, get hint() { return tr('platform.linkedin.hint'); },
    aspect: '16:9', width: 1920, height: 1080, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 8, maxSeconds: 600, maxFileMB: 5120,
    uploadUrl: 'https://www.linkedin.com/feed/?shareActive=true',
    loudnessLufs: -14, truePeakDb: -1,
  },
  {
    id: 'facebook-feed', get label() { return tr('platform.facebook-feed'); }, get hint() { return tr('platform.facebook-feed.hint'); },
    aspect: '1:1', width: 1080, height: 1080, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 8, maxSeconds: 7200, maxFileMB: 10_240,
    uploadUrl: 'https://www.facebook.com/',
    loudnessLufs: -14, truePeakDb: -1,
  },
];

export const PLATFORM_IDS: readonly string[] = PLATFORM_PRESETS.map((p) => p.id);

export function platformPreset(id: string | undefined): PlatformPreset | undefined {
  return id === undefined ? undefined : PLATFORM_PRESETS.find((p) => p.id === id);
}

const MONTHS = [
  'platform.month.january', 'platform.month.february', 'platform.month.march', 'platform.month.april',
  'platform.month.may', 'platform.month.june', 'platform.month.july', 'platform.month.august',
  'platform.month.september', 'platform.month.october', 'platform.month.november', 'platform.month.december',
] as const satisfies readonly MessageId[];

/** The date the limits were checked, in words: "1 November 2026" (or the text as given, when it is not a date). */
export function limitsCheckedDate(checked: string = PLATFORM_LIMITS_CHECKED): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checked);
  if (!m) return checked;
  const month = MONTHS[Number(m[2]) - 1];
  return tr('platform.date', { day: Number(m[3]), month: month ? tr(month) : String(month), year: m[1]! });
}

/** The date the limits were checked, as a sentence fragment: "checked 1 November 2026". */
export function limitsCheckedLabel(checked: string = PLATFORM_LIMITS_CHECKED): string {
  return tr('platform.limits.checked', { date: limitsCheckedDate(checked) });
}

/** What a preset amounts to, under the chooser: "9:16 · 1080 × 1920 · 30 fps · H.264 MP4 · leveled to -14 LUFS". */
export function platformSummary(preset: PlatformPreset): string {
  return tr('platform.summary', { aspect: preset.aspect, width: preset.width, height: preset.height, fps: preset.fps, preset: OUTPUT_PRESETS[preset.presetId].label, lufs: preset.loudnessLufs });
}

/** What the platform takes, in words: "up to 10:00 and 287 MB (limits checked 1 November 2026)". */
export function platformLimitsLabel(preset: PlatformPreset, checked: string = PLATFORM_LIMITS_CHECKED): string {
  return tr('platform.limits', { length: clockLabel(preset.maxSeconds), size: sizeLabel(preset.maxFileMB * 1024 ** 2), date: limitsCheckedDate(checked) });
}

// ---------------------------------------------------------------- length and file size

/** The file size a render of this length is expected to come to, from the preset's bitrate target. */
export function expectedBytes(preset: PlatformPreset, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  // Megabits as the platforms quote them: 10^6 bits, converted to bytes.
  return Math.round((preset.bitrateMbps * 1_000_000 * seconds) / 8);
}

export function maxFileBytes(preset: PlatformPreset): number {
  return preset.maxFileMB * 1024 ** 2;
}

function tooLong(preset: PlatformPreset, seconds: number, checked: string): string | null {
  if (!Number.isFinite(seconds) || seconds <= preset.maxSeconds) return null;
  return tr('platform.warning.too-long', { platform: preset.label, length: clockLabel(seconds), limit: clockLabel(preset.maxSeconds), date: limitsCheckedDate(checked) });
}

/**
 * What to say before a render: how long it will run, and what it is likely to
 * weigh at the preset's bitrate. "Likely", because the encoder is given a
 * quality target rather than a bitrate — the estimate is the platform's own
 * guidance applied to this length, not a measurement.
 */
export function platformWarningsBefore(preset: PlatformPreset, seconds: number, checked: string = PLATFORM_LIMITS_CHECKED): string[] {
  const out: string[] = [];
  const long = tooLong(preset, seconds, checked);
  if (long) out.push(long);
  const bytes = expectedBytes(preset, seconds);
  if (bytes > maxFileBytes(preset)) {
    out.push(tr('platform.warning.likely-too-large', {
      platform: preset.label, size: sizeLabel(bytes), bitrate: preset.bitrateMbps, limit: sizeLabel(maxFileBytes(preset)), date: limitsCheckedDate(checked),
    }));
  }
  return out;
}

/** What to say about the file that was written: its real length and its real size against the limits. */
export function platformWarningsAfter(preset: PlatformPreset, seconds: number, bytes: number, checked: string = PLATFORM_LIMITS_CHECKED): string[] {
  const out: string[] = [];
  const long = tooLong(preset, seconds, checked);
  if (long) out.push(long);
  if (bytes > maxFileBytes(preset)) {
    out.push(tr('platform.warning.too-large', { platform: preset.label, size: sizeLabel(bytes), limit: sizeLabel(maxFileBytes(preset)), date: limitsCheckedDate(checked) }));
  }
  return out;
}

// ---------------------------------------------------------------- the list, checked

/**
 * Everything wrong with a list of presets, in words — empty for a sound one.
 * The built-in list is held to this by a unit test, so a resolution that does
 * not match its aspect, a rate the renderer will not accept or an encoder
 * that is not an output preset cannot be typed in and shipped.
 */
export function platformPresetProblems(presets: readonly PlatformPreset[] = PLATFORM_PRESETS, checked: string = PLATFORM_LIMITS_CHECKED): string[] {
  const problems: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checked)) problems.push(`the checked date "${checked}" is not YYYY-MM-DD`); // i18n-exempt(diagnostic)
  if (presets.length === 0) problems.push('the list is empty'); // i18n-exempt(diagnostic)
  const seen = new Set<string>();
  for (const p of presets) {
    const where = p.id || '(no id)'; // i18n-exempt(diagnostic)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id)) problems.push(`${where}: an id is lowercase letters, digits and dashes`); // i18n-exempt(diagnostic)
    if (seen.has(p.id)) problems.push(`${where}: the id is used twice`); // i18n-exempt(diagnostic)
    seen.add(p.id);
    if (!p.label.trim()) problems.push(`${where}: no label`); // i18n-exempt(diagnostic)
    if (!p.hint.trim()) problems.push(`${where}: no hint`); // i18n-exempt(diagnostic)
    const aspect = aspectById(p.aspect);
    if (!aspect) problems.push(`${where}: ${p.aspect} is not one of the built-in aspects`); // i18n-exempt(diagnostic)
    else if (p.width * aspect.h !== p.height * aspect.w) problems.push(`${where}: ${p.width} × ${p.height} is not ${p.aspect}`); // i18n-exempt(diagnostic)
    if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width <= 0 || p.height <= 0) problems.push(`${where}: the resolution is not whole pixels`); // i18n-exempt(diagnostic)
    if (p.width % 2 !== 0 || p.height % 2 !== 0) problems.push(`${where}: ${p.width} × ${p.height} is odd, which H.264 cannot encode`); // i18n-exempt(diagnostic)
    if (!isStandardFrameRate(p.fps)) problems.push(`${where}: ${p.fps} is not one of the standard frame rates`); // i18n-exempt(diagnostic)
    if (!OUTPUT_PRESETS[p.presetId]) problems.push(`${where}: "${p.presetId}" is not an output preset`); // i18n-exempt(diagnostic)
    else if (OUTPUT_PRESETS[p.presetId].sequence || OUTPUT_PRESETS[p.presetId].still) problems.push(`${where}: a platform takes one video file, not ${OUTPUT_PRESETS[p.presetId].label}`); // i18n-exempt(diagnostic)
    for (const [name, value] of [['bitrate', p.bitrateMbps], ['length limit', p.maxSeconds], ['file-size limit', p.maxFileMB]] as const) { // i18n-exempt(diagnostic)
      if (!Number.isFinite(value) || value <= 0) problems.push(`${where}: the ${name} must be more than 0`); // i18n-exempt(diagnostic)
    }
    // The hand-off opens this in the browser, so nothing but https may ever be typed in here.
    if (!/^https:\/\/[^\s]+$/.test(p.uploadUrl)) problems.push(`${where}: the upload page must be an https URL`); // i18n-exempt(diagnostic)
    // Loudness targets live in the range the platforms and broadcasters actually use; a typo outside it would crush or blast a mix.
    if (!Number.isFinite(p.loudnessLufs) || p.loudnessLufs < -36 || p.loudnessLufs > -6) problems.push(`${where}: the loudness target must be between -36 and -6 LUFS`); // i18n-exempt(diagnostic)
    if (!Number.isFinite(p.truePeakDb) || p.truePeakDb > 0 || p.truePeakDb < -9) problems.push(`${where}: the true-peak ceiling must be between -9 and 0 dBTP`); // i18n-exempt(diagnostic)
  }
  return problems;
}
