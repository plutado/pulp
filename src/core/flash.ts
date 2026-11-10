/**
 * A flash warning before export (milestone 84): where a finished render
 * flashes strongly, and the one ffmpeg graph that calms those moments.
 *
 * **What it is, and is not.** Rapid flashing can be unsafe for some viewers.
 * This is a warning to help a person catch it, built on the published rule
 * broadcasters and the web share (Ofcom's guidance, WCAG 2.2's "three flashes"
 * and its general and red flash definitions) — **not a certified broadcast
 * test**, which measures with calibrated tools and judges what a pass over
 * frames cannot, and the interface says so wherever the result is shown.
 *
 * **The rule, as measured here.** A *transition* is a change in relative
 * luminance of at least a tenth of white, where the darker of the two is
 * below 0.80; a *red transition* is a change of at least 20 in WCAG's
 * saturated-red measure, (R − G − B) × 320 over a pixel at least 80% red. A
 * frame counts a transition when a quarter of the picture made one together,
 * in the same direction, within a tenth of a second; and transitions must
 * alternate, so a fade is one, not many. A flash is a pair of opposing
 * transitions, and more than three flashes in any one second is strong: so
 * more than six transitions within a second.
 *
 * **Measured small and over both black and white.** The render is read back
 * at a 32 × 32 grid, each cell the mean of its part of the frame, which is all
 * a quarter-of-the-picture rule needs (and the same for any shape, since the
 * share of an area survives stretching). A render with transparency is
 * measured composited over black and over white: what will be under it is not
 * known, and a graphic that flashes from transparent to white is a strobe over
 * dark footage and nothing over light.
 *
 * **Calmed by averaging over time.** Within each strong moment, a little
 * padded, each frame becomes a weighted average of the third of a second on
 * either side — a triangle of weights, which leaves almost nothing of any
 * flicker above three a second — centered on the frame, so nothing is
 * delayed, and switched in and out exactly at the moment's edges. Outside the
 * moments the picture is the render's own, written again in its own format:
 * exactly so for a lossless one (QuickTime Animation, ProRes near enough), and
 * within that codec's own loss for H.264 or VP9.
 *
 * Pure: ffmpeg's arguments and the arithmetic. Running it is
 * src/main/flash-service.ts.
 */

import { OUTPUT_PRESETS, REC709_TAGS, RGB_FULL_TAGS, type PresetId } from './render-plan';

/** The grid a frame is measured at: this many cells across and down. */
export const FLASH_GRID = 32;
/** A transition: at least this change in relative luminance (0..1). */
export const FLASH_LUMINANCE_STEP = 0.1;
/** …where the darker of the two states is below this. */
export const FLASH_DARK_LIMIT = 0.8;
/** A red transition: at least this change in (R − G − B) × 320. */
export const RED_STEP = 20;
/** A pixel is saturated red where red is at least this share of R + G + B. */
export const RED_SATURATION = 0.8;
/** The share of the picture that must make a transition together. */
export const FLASH_AREA = 0.25;
/** More than this many flashes in any one second is strong. */
export const FLASHES_PER_SECOND_LIMIT = 3;
/** Seconds each strong moment is widened by on both sides before it is calmed. */
export const SOFTEN_PAD = 0.25;
/** Seconds averaged on each side of a calmed frame. */
export const SOFTEN_REACH = 1 / 3;

export type FlashKind = 'general' | 'red';

/** One strong moment, in seconds of the file. */
export interface FlashSpan {
  from: number;
  to: number;
  /** The most flashes counted in any one second inside it. */
  perSecond: number;
  /** What flashed: light and dark, saturated red, or both. */
  kinds: FlashKind[];
}

export interface FlashReport {
  /** The rate the render was read at, and how many frames. */
  fps: number;
  frames: number;
  /** Whether any frame had transparency, so it was measured over black and white. */
  transparent: boolean;
  spans: FlashSpan[];
}

/** What a render's file is to ffmpeg: one file, or a numbered sequence from its first frame. */
export type FlashInput = { file: string; decoder?: string } | { pattern: string; start: number };

/**
 * ffmpeg's arguments to read a render back as the grid: every frame at the
 * render's own rate (an animated image's held frames repeated, so time is the
 * render's), scaled by area to 32 × 32, as RGBA, raw, to stdout.
 */
export function flashFramesArgs(input: FlashInput, fps: number): string[] {
  const source = 'pattern' in input
    ? ['-framerate', String(fps), '-start_number', String(input.start), '-i', input.pattern]
    : [...(input.decoder ? ['-c:v', input.decoder] : []), '-i', input.file];
  return [
    '-v', 'error', '-nostdin',
    ...source,
    '-map', '0:v:0', '-an', '-sn',
    '-vf', `fps=${fps},scale=${FLASH_GRID}:${FLASH_GRID}:flags=area,format=rgba`,
    '-f', 'rawvideo', 'pipe:1',
  ];
}

/** The grid frames in a raw RGBA stream; a partial frame at the end is dropped. */
export function splitGridFrames(bytes: Uint8Array): Uint8Array[] {
  const size = FLASH_GRID * FLASH_GRID * 4;
  const out: Uint8Array[] = [];
  for (let at = 0; at + size <= bytes.length; at += size) out.push(bytes.subarray(at, at + size));
  return out;
}

/** sRGB code value (0..255) to linear light (0..1). */
const LINEAR = Float64Array.from({ length: 256 }, (_, c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

/** One cell's two measures over a backdrop: relative luminance, and the saturated-red measure. */
function cellMeasures(frame: Uint8Array, cell: number, backdrop: number): { luminance: number; red: number } {
  const at = cell * 4;
  const a = frame[at + 3]! / 255;
  // Composited in sRGB code values, as a picture over another is seen and as editing apps blend.
  const mix = (c: number) => Math.round(c * a + backdrop * (1 - a));
  const r = LINEAR[mix(frame[at]!)]!;
  const g = LINEAR[mix(frame[at + 1]!)]!;
  const b = LINEAR[mix(frame[at + 2]!)]!;
  const sum = r + g + b;
  const red = sum > 0 && r / sum >= RED_SATURATION ? Math.max(0, r - g - b) * 320 : 0;
  return { luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b, red };
}

/**
 * Per cell, the transitions one measure makes: each a change of at least
 * `step` against the extreme since the last one, alternating in direction, the
 * darker state below `darkLimit` where one is given. Answers, per frame, which
 * cells completed a rise (+1) or a fall (−1) there.
 */
function cellTransitions(values: Float64Array[], step: number, darkLimit: number | null): Int8Array[] {
  const cells = values[0]?.length ?? 0;
  const ext = new Float64Array(cells);
  const lo = new Float64Array(cells);
  const hi = new Float64Array(cells);
  const dir = new Int8Array(cells);
  const dark = (v: number) => darkLimit === null || v < darkLimit;
  return values.map((frame, f) => {
    const out = new Int8Array(cells);
    for (let c = 0; c < cells; c++) {
      const v = frame[c]!;
      if (f === 0) {
        ext[c] = lo[c] = hi[c] = v;
        continue;
      }
      if (dir[c] === 0) {
        lo[c] = Math.min(lo[c]!, v);
        hi[c] = Math.max(hi[c]!, v);
        if (v - lo[c]! >= step && dark(lo[c]!)) [dir[c], ext[c], out[c]] = [1, v, 1];
        else if (hi[c]! - v >= step && dark(v)) [dir[c], ext[c], out[c]] = [-1, v, -1];
      } else if (dir[c] === 1) {
        if (v > ext[c]!) ext[c] = v;
        else if (ext[c]! - v >= step && dark(v)) [dir[c], ext[c], out[c]] = [-1, v, -1];
      } else {
        if (v < ext[c]!) ext[c] = v;
        else if (v - ext[c]! >= step && dark(ext[c]!)) [dir[c], ext[c], out[c]] = [1, v, 1];
      }
    }
    return out;
  });
}

/**
 * The frames where the picture made a transition: a quarter of the cells
 * completed one in the same direction within the last tenth of a second, and
 * the picture's last transition was the other way.
 */
export function frameTransitions(cells: Int8Array[], fps: number): number[] {
  const count = cells[0]?.length ?? 0;
  const reach = Math.max(1, Math.round(fps / 10));
  const lastRise = new Int32Array(count).fill(-1e9);
  const lastFall = new Int32Array(count).fill(-1e9);
  const need = Math.ceil(FLASH_AREA * count);
  const out: number[] = [];
  let last = 0;
  cells.forEach((frame, f) => {
    let rises = 0;
    let falls = 0;
    for (let c = 0; c < count; c++) {
      if (frame[c] === 1) lastRise[c] = f;
      else if (frame[c] === -1) lastFall[c] = f;
      if (f - lastRise[c]! < reach) rises += 1;
      if (f - lastFall[c]! < reach) falls += 1;
    }
    if (rises >= need && last !== 1) {
      out.push(f);
      last = 1;
    } else if (falls >= need && last !== -1) {
      out.push(f);
      last = -1;
    }
  });
  return out;
}

/**
 * Where transitions come more than six to a second: each run of them, from its
 * first transition to just past its last, with the most flashes any one second
 * of it held.
 */
export function strongSpans(transitions: readonly number[], fps: number, kind: FlashKind): FlashSpan[] {
  const limit = 2 * FLASHES_PER_SECOND_LIMIT;
  const spans: FlashSpan[] = [];
  let j = 0;
  for (let i = 0; i < transitions.length; i++) {
    if (j < i) j = i;
    while (j + 1 < transitions.length && transitions[j + 1]! < transitions[i]! + fps) j += 1;
    const inSecond = j - i + 1;
    if (inSecond <= limit) continue;
    const from = transitions[i]! / fps;
    const to = (transitions[j]! + 1) / fps;
    const perSecond = Math.floor(inSecond / 2);
    const prev = spans[spans.length - 1];
    if (prev && from <= prev.to) {
      prev.to = Math.max(prev.to, to);
      prev.perSecond = Math.max(prev.perSecond, perSecond);
    } else spans.push({ from, to, perSecond, kinds: [kind] });
  }
  return spans.map((s) => ({ ...s, from: round(s.from), to: round(s.to) }));
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

/** Spans of either kind merged where they overlap, each saying every kind it holds. */
export function mergeSpans(spans: readonly FlashSpan[]): FlashSpan[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const out: FlashSpan[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && s.from <= prev.to) {
      prev.to = Math.max(prev.to, s.to);
      prev.perSecond = Math.max(prev.perSecond, s.perSecond);
      prev.kinds = [...new Set([...prev.kinds, ...s.kinds])].sort();
    } else out.push({ ...s, kinds: [...s.kinds] });
  }
  return out;
}

/**
 * The whole check over a render's grid frames: each frame's cells measured —
 * over black and over white where any frame has transparency — the
 * transitions found for light and for saturated red, and where they are
 * strong.
 */
export function detectFlashes(frames: readonly Uint8Array[], fps: number): FlashReport {
  const cells = FLASH_GRID * FLASH_GRID;
  let transparent = false;
  for (const f of frames) {
    for (let c = 0; c < cells && !transparent; c++) if (f[c * 4 + 3]! < 250) transparent = true;
    if (transparent) break;
  }
  const spans: FlashSpan[] = [];
  for (const backdrop of transparent ? [0, 255] : [0]) {
    const luminance: Float64Array[] = [];
    const red: Float64Array[] = [];
    for (const f of frames) {
      const l = new Float64Array(cells);
      const r = new Float64Array(cells);
      for (let c = 0; c < cells; c++) {
        const m = cellMeasures(f, c, backdrop);
        l[c] = m.luminance;
        r[c] = m.red;
      }
      luminance.push(l);
      red.push(r);
    }
    spans.push(...strongSpans(frameTransitions(cellTransitions(luminance, FLASH_LUMINANCE_STEP, FLASH_DARK_LIMIT), fps), fps, 'general'));
    spans.push(...strongSpans(frameTransitions(cellTransitions(red, RED_STEP, null), fps), fps, 'red'));
  }
  return { fps, frames: frames.length, transparent, spans: mergeSpans(spans) };
}

/** The moments to calm: each strong span widened by `SOFTEN_PAD`, held inside the file and merged. */
export function softenWindows(spans: readonly FlashSpan[], duration: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    const from = round(Math.max(0, s.from - SOFTEN_PAD));
    const to = round(Math.min(duration, s.to + SOFTEN_PAD));
    const prev = out[out.length - 1];
    if (prev && from <= prev.to) prev.to = Math.max(prev.to, to);
    else out.push({ from, to });
  }
  return out;
}

/**
 * The filter graph that calms the windows, from `[0:v]` to `[soft]`: the
 * picture split in two; one copy led by `SOFTEN_REACH` and averaged over
 * twice that with triangular weights, so its frame at a moment is centered on
 * that moment; and per frame, inside a window the averaged copy, outside it
 * the picture untouched — on every plane, alpha included.
 */
export function softenGraph(windows: readonly { from: number; to: number }[], fps: number): string {
  const reach = Math.max(1, Math.round(fps * SOFTEN_REACH));
  const frames = 2 * reach + 1;
  const weights = Array.from({ length: frames }, (_, i) => Math.min(i + 1, frames - i)).join(' ');
  const inside = windows.map((w) => `between(T\\,${w.from}\\,${w.to})`).join('+') || '0';
  return [
    '[0:v]split[flasha][flashb]',
    `[flashb]trim=start_frame=${reach},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${reach},tmix=frames=${frames}:weights='${weights}'[flashm]`,
    `[flasha][flashm]blend=all_expr='if(${inside}\\,B\\,A)'[soft]`,
  ].join(';');
}

/** The presets a softened copy can be written in: the video files. A sequence, a still and an animated image are checked, not softened. */
export function canSoften(presetId: string): boolean {
  const preset = OUTPUT_PRESETS[presetId as PresetId];
  return Boolean(preset && !preset.sequence && !preset.still && !preset.animatedImage);
}

/**
 * ffmpeg's arguments to write the render calmed: read as it was, the
 * windows averaged, the picture tagged and stored exactly as its preset
 * stores it, the sound copied untouched. Throws for a preset that cannot be
 * softened (`canSoften`).
 */
export function softenArgs(input: { file: string; decoder?: string }, presetId: string, windows: readonly { from: number; to: number }[], fps: number, output: string): string[] {
  const preset = OUTPUT_PRESETS[presetId as PresetId];
  if (!preset || !canSoften(presetId)) throw new Error(`cannot soften a ${presetId} render`); // i18n-exempt(diagnostic)
  const tags = preset.color === 'rec709' ? REC709_TAGS : RGB_FULL_TAGS;
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...(input.decoder ? ['-c:v', input.decoder] : []),
    '-i', input.file,
    '-filter_complex', `${softenGraph(windows, fps)};[soft]${tags},format=${preset.pixelFormat}[out]`,
    '-map', '[out]', '-map', '0:a?',
    ...preset.codecArgs,
    '-c:a', 'copy',
    output,
  ];
}

/**
 * Where a softened copy goes: beside the render, " softened" before the
 * extension, numbered if that is taken — so saving a copy never writes over
 * anything.
 */
export function softenedCopyPath(output: string, exists: (path: string) => boolean): string {
  const dot = output.lastIndexOf('.');
  const slash = Math.max(output.lastIndexOf('/'), output.lastIndexOf('\\'));
  const [base, ext] = dot > slash ? [output.slice(0, dot), output.slice(dot)] : [output, ''];
  for (let n = 1; ; n++) {
    const candidate = `${base} softened${n === 1 ? '' : ` ${n}`}${ext}`;
    if (!exists(candidate)) return candidate;
  }
}
