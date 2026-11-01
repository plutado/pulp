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
}

/**
 * The list. Every one is H.264 in an MP4 at 30 fps, which is the rate the
 * vertical platforms publish and the one a 25 or 24 fps template resamples to
 * without surprises; the frame rate stays a free choice in the Output tab
 * afterwards.
 */
export const PLATFORM_PRESETS: readonly PlatformPreset[] = [
  {
    id: 'tiktok', label: 'TikTok', hint: 'Vertical, up to 10 min',
    aspect: '9:16', width: 1080, height: 1920, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 10, maxSeconds: 600, maxFileMB: 287,
    uploadUrl: 'https://www.tiktok.com/upload',
  },
  {
    id: 'instagram-reels', label: 'Instagram Reels', hint: 'Vertical, up to 3 min',
    aspect: '9:16', width: 1080, height: 1920, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 10, maxSeconds: 180, maxFileMB: 4096,
    uploadUrl: 'https://www.instagram.com/',
  },
  {
    id: 'instagram-feed', label: 'Instagram feed', hint: 'Tall 4:5, up to 60 min',
    aspect: '4:5', width: 1080, height: 1350, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 8, maxSeconds: 3600, maxFileMB: 4096,
    uploadUrl: 'https://www.instagram.com/',
  },
  {
    id: 'youtube-shorts', label: 'YouTube Shorts', hint: 'Vertical, up to 3 min',
    aspect: '9:16', width: 1080, height: 1920, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 10, maxSeconds: 180, maxFileMB: 262_144,
    uploadUrl: 'https://www.youtube.com/upload',
  },
  {
    id: 'youtube', label: 'YouTube', hint: 'Widescreen 1080p',
    aspect: '16:9', width: 1920, height: 1080, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 8, maxSeconds: 43_200, maxFileMB: 262_144,
    uploadUrl: 'https://www.youtube.com/upload',
  },
  {
    id: 'x', label: 'X', hint: 'Widescreen, up to 2:20',
    aspect: '16:9', width: 1920, height: 1080, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 8, maxSeconds: 140, maxFileMB: 512,
    uploadUrl: 'https://x.com/compose/post',
  },
  {
    id: 'linkedin', label: 'LinkedIn', hint: 'Widescreen, up to 10 min',
    aspect: '16:9', width: 1920, height: 1080, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 8, maxSeconds: 600, maxFileMB: 5120,
    uploadUrl: 'https://www.linkedin.com/feed/?shareActive=true',
  },
  {
    id: 'facebook-feed', label: 'Facebook feed', hint: 'Square, up to 2 h',
    aspect: '1:1', width: 1080, height: 1080, fps: 30,
    presetId: 'h264-mp4', audioCodec: 'aac', bitrateMbps: 8, maxSeconds: 7200, maxFileMB: 10_240,
    uploadUrl: 'https://www.facebook.com/',
  },
];

export const PLATFORM_IDS: readonly string[] = PLATFORM_PRESETS.map((p) => p.id);

export function platformPreset(id: string | undefined): PlatformPreset | undefined {
  return id === undefined ? undefined : PLATFORM_PRESETS.find((p) => p.id === id);
}

/** The date the limits were checked, as a sentence fragment: "checked 1 November 2026". */
export function limitsCheckedLabel(checked: string = PLATFORM_LIMITS_CHECKED): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checked);
  if (!m) return `checked ${checked}`;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `checked ${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** What a preset amounts to, under the chooser: "9:16 · 1080 × 1920 · 30 fps · H.264 MP4". */
export function platformSummary(preset: PlatformPreset): string {
  return `${preset.aspect} · ${preset.width} × ${preset.height} · ${preset.fps} fps · ${OUTPUT_PRESETS[preset.presetId].label}`;
}

/** What the platform takes, in words: "up to 10:00 and 287 MB (limits checked 1 November 2026)". */
export function platformLimitsLabel(preset: PlatformPreset, checked: string = PLATFORM_LIMITS_CHECKED): string {
  return `up to ${clockLabel(preset.maxSeconds)} and ${sizeLabel(preset.maxFileMB * 1024 ** 2)} (limits ${limitsCheckedLabel(checked)})`;
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
  return `Longer than ${preset.label} takes: ${clockLabel(seconds)}, against ${clockLabel(preset.maxSeconds)} (limits ${limitsCheckedLabel(checked)}).`;
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
    out.push(
      `Likely larger than ${preset.label} takes: about ${sizeLabel(bytes)} at ${preset.bitrateMbps} Mb/s, ` +
      `against ${sizeLabel(maxFileBytes(preset))} (limits ${limitsCheckedLabel(checked)}).`,
    );
  }
  return out;
}

/** What to say about the file that was written: its real length and its real size against the limits. */
export function platformWarningsAfter(preset: PlatformPreset, seconds: number, bytes: number, checked: string = PLATFORM_LIMITS_CHECKED): string[] {
  const out: string[] = [];
  const long = tooLong(preset, seconds, checked);
  if (long) out.push(long);
  if (bytes > maxFileBytes(preset)) {
    out.push(`Larger than ${preset.label} takes: ${sizeLabel(bytes)}, against ${sizeLabel(maxFileBytes(preset))} (limits ${limitsCheckedLabel(checked)}).`);
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checked)) problems.push(`the checked date "${checked}" is not YYYY-MM-DD`);
  if (presets.length === 0) problems.push('the list is empty');
  const seen = new Set<string>();
  for (const p of presets) {
    const where = p.id || '(no id)';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id)) problems.push(`${where}: an id is lowercase letters, digits and dashes`);
    if (seen.has(p.id)) problems.push(`${where}: the id is used twice`);
    seen.add(p.id);
    if (!p.label.trim()) problems.push(`${where}: no label`);
    if (!p.hint.trim()) problems.push(`${where}: no hint`);
    const aspect = aspectById(p.aspect);
    if (!aspect) problems.push(`${where}: ${p.aspect} is not one of the built-in aspects`);
    else if (p.width * aspect.h !== p.height * aspect.w) problems.push(`${where}: ${p.width} × ${p.height} is not ${p.aspect}`);
    if (!Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width <= 0 || p.height <= 0) problems.push(`${where}: the resolution is not whole pixels`);
    if (p.width % 2 !== 0 || p.height % 2 !== 0) problems.push(`${where}: ${p.width} × ${p.height} is odd, which H.264 cannot encode`);
    if (!isStandardFrameRate(p.fps)) problems.push(`${where}: ${p.fps} is not one of the standard frame rates`);
    if (!OUTPUT_PRESETS[p.presetId]) problems.push(`${where}: "${p.presetId}" is not an output preset`);
    else if (OUTPUT_PRESETS[p.presetId].sequence || OUTPUT_PRESETS[p.presetId].still) problems.push(`${where}: a platform takes one video file, not ${OUTPUT_PRESETS[p.presetId].label}`);
    for (const [name, value] of [['bitrate', p.bitrateMbps], ['length limit', p.maxSeconds], ['file-size limit', p.maxFileMB]] as const) {
      if (!Number.isFinite(value) || value <= 0) problems.push(`${where}: the ${name} must be more than 0`);
    }
    // The hand-off opens this in the browser, so nothing but https may ever be typed in here.
    if (!/^https:\/\/[^\s]+$/.test(p.uploadUrl)) problems.push(`${where}: the upload page must be an https URL`);
  }
  return problems;
}
