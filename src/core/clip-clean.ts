/**
 * Clip clean-up for compositing (milestone 52): footage made ready to sit in
 * a frame or go to a platform. The pure half — every ffmpeg argument list and
 * every parsed answer — so what a clean-up would run is read by a test rather
 * than hoped for; the main process (src/main/cleanup-service.ts) only spawns.
 *
 * Three jobs live here:
 *
 * - **A LUT**: a `.cube` color grade, as the one `lut3d` step every path
 *   shares — the whole render, a clip rendered itself, and a video layer's
 *   decoded frames, which is how the preview shows it too.
 * - **A chroma key**: a green or blue key rendered to an alpha clip (ProRes
 *   4444, its sound kept), which joins the library beside the original.
 * - **Scene detection**: long footage split at its cuts by stream copy —
 *   no re-encode, so the cuts are held to the file's own keyframes — into a
 *   folder beside it, where the library's rescan picks the clips up.
 */

/** Seconds a clean-up frame preview is decoded at when nothing better is known. */
export const PREVIEW_SECONDS = 1;

// ---------------------------------------------------------------- the LUT

/**
 * A value quoted for an ffmpeg filtergraph: single-quoted, with the quotes
 * themselves escaped, and backslashes turned to forward slashes — which
 * ffmpeg takes on Windows too. A filter's arguments are read twice: the
 * graph strips the quotes, then the filter splits its options at colons, so
 * a drive's colon is escaped as `\:` inside the quotes, where the graph
 * leaves the backslash for the option parser to take off again.
 */
export function filterQuoted(value: string): string {
  return `'${value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")}'`;
}

export function isCubeFile(path: string): boolean {
  return /\.cube$/i.test(path.trim());
}

/** The `lut3d` step that applies a `.cube`. It works on RGB, so it sits before any Rec.709 conversion. */
export function lutFilter(path: string): string {
  return `lut3d=file=${filterQuoted(path)}`;
}

// ---------------------------------------------------------------- the chroma key

export interface ChromaKeySettings {
  /** The color keyed out, #RRGGBB. */
  color: string;
  /** How far from the color still counts as it, 0.01 to 0.9 (ffmpeg's `similarity`). */
  tolerance: number;
  /** How much of the key color's cast is washed out of what remains, 0 to 1 (`despill`'s mix). */
  spill: number;
}

export const KEY_LIMITS = {
  tolerance: { min: 0.01, max: 0.9 },
  spill: { min: 0, max: 1 },
} as const;

/** Where a key starts: studio green, a forgiving tolerance, a gentle wash. */
export const KEY_DEFAULTS: ChromaKeySettings = { color: '#00ff00', tolerance: 0.18, spill: 0.5 };

/** Settings with every field in range, from anything at all. */
export function sanitizeChromaKey(input: unknown): ChromaKeySettings {
  const r = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const clamp = (v: unknown, limit: { min: number; max: number }, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(limit.max, Math.max(limit.min, Math.round(v * 100) / 100)) : fallback;
  const color = typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color.toLowerCase() : KEY_DEFAULTS.color;
  return {
    color,
    tolerance: clamp(r.tolerance, KEY_LIMITS.tolerance, KEY_DEFAULTS.tolerance),
    spill: clamp(r.spill, KEY_LIMITS.spill, KEY_DEFAULTS.spill),
  };
}

/** Which of `despill`'s two washes suits the key color, or null for one that is neither green nor blue. */
export function despillType(color: string): 'green' | 'blue' | null {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  if (g > r && g > b) return 'green';
  if (b > r && b > g) return 'blue';
  return null;
}

/**
 * The filter steps of a key: `chromakey` (which works in Y'CbCr, where a key
 * color is a point rather than a wedge), then `despill` washing the key's
 * cast out of edges and reflections — skipped for a color that is neither
 * green nor blue, which is what the filter knows how to wash.
 */
export function chromaKeyFilter(settings: ChromaKeySettings): string {
  const s = sanitizeChromaKey(settings);
  const steps = [`chromakey=color=0x${s.color.slice(1)}:similarity=${s.tolerance}:blend=${Math.round(s.tolerance * 50) / 100}`];
  const wash = despillType(s.color);
  if (wash && s.spill > 0) steps.push(`despill=type=${wash}:mix=${s.spill}`);
  return steps.join(',');
}

/**
 * The whole command: the clip keyed to an alpha clip, ProRes 4444 — the alpha
 * format every editor and Pulp's own layers read — with its own sound kept
 * untouched where it has one.
 */
export function chromaKeyArgs(input: string, settings: ChromaKeySettings, output: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', input,
    '-vf', `${chromaKeyFilter(settings)},format=yuva444p10le`,
    '-c:v', 'prores_ks', '-profile:v', '4444', '-vendor', 'apl0', '-alpha_bits', '16',
    '-c:a', 'copy',
    output,
  ];
}

/**
 * One frame of the key, as a PNG on stdout, for the dialog's before-and-after:
 * the keyed picture with its alpha, beside which the dialog shows the plain
 * frame the color is picked from.
 */
export function chromaKeyStillArgs(input: string, settings: ChromaKeySettings | null, atSeconds: number): string[] {
  const at = Number.isFinite(atSeconds) && atSeconds >= 0 ? atSeconds : PREVIEW_SECONDS;
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-ss', String(at), '-i', input,
    '-frames:v', '1',
    '-vf', `${settings ? `${chromaKeyFilter(settings)},` : ''}scale=w='min(iw,640)':h='min(ih,640)':force_original_aspect_ratio=decrease,format=rgba`, // i18n-exempt(technical)
    '-f', 'image2pipe', '-c:v', 'png', 'pipe:1',
  ];
}

/** Where the keyed clip goes: beside the original, "<name> alpha.mov", so the library's rescan takes it in. */
export function keyedClipPath(input: string): string {
  const slash = Math.max(input.lastIndexOf('/'), input.lastIndexOf('\\'));
  const dir = input.slice(0, slash + 1);
  const file = input.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return `${dir}${dot > 0 ? file.slice(0, dot) : file} alpha.mov`; // i18n-exempt(content)
}

// ---------------------------------------------------------------- scene detection

/** A cut this close to the one before is the same cut seen twice, or a flash; it is not a scene. */
export const MIN_SCENE_SECONDS = 1;

/** How different two frames must be to be a cut, 0 to 1; ffmpeg's own scene score. */
export const SCENE_THRESHOLD = 0.4;

/** The detection pass: every frame scored against the one before, the cuts said by `showinfo` on stderr. */
export function sceneDetectArgs(input: string, threshold = SCENE_THRESHOLD): string[] {
  return [
    '-hide_banner', '-nostdin',
    '-i', input,
    '-vf', `select='gt(scene,${threshold})',showinfo`,
    '-f', 'null', '-',
  ];
}

/**
 * The cut times `showinfo` printed, in seconds, sorted, with anything inside
 * `MIN_SCENE_SECONDS` of the cut before dropped — a flash scores like a cut,
 * and a one-frame scene is not a scene.
 */
export function parseSceneCuts(stderr: string): number[] {
  const cuts: number[] = [];
  for (const match of stderr.matchAll(/pts_time:\s*(\d+(?:\.\d+)?)/g)) {
    const at = Number(match[1]);
    if (Number.isFinite(at) && at > 0) cuts.push(Math.round(at * 1000) / 1000);
  }
  cuts.sort((a, b) => a - b);
  const kept: number[] = [];
  for (const at of cuts) {
    if (kept.length === 0 ? at >= MIN_SCENE_SECONDS : at - kept[kept.length - 1]! >= MIN_SCENE_SECONDS) kept.push(at);
  }
  return kept;
}

/**
 * The split: the file copied — not re-encoded — into one clip per scene, each
 * stream intact, timestamps starting at zero so every clip plays as its own.
 * Stream copy can only cut where the file has a keyframe, so each cut lands
 * on the nearest one at or after it; footage is shot with keyframes close
 * enough that a scene cut is one.
 */
export function sceneSplitArgs(input: string, cuts: readonly number[], outputPattern: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', input,
    '-map', '0',
    '-c', 'copy',
    '-f', 'segment',
    '-segment_times', cuts.join(','),
    '-reset_timestamps', '1',
    outputPattern,
  ];
}

/** Where the scenes go: a folder beside the original named for it, which the library's rescan picks up. */
export function sceneFolder(input: string): string {
  const slash = Math.max(input.lastIndexOf('/'), input.lastIndexOf('\\'));
  const dir = input.slice(0, slash + 1);
  const file = input.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return `${dir}${dot > 0 ? file.slice(0, dot) : file} scenes`; // i18n-exempt(content)
}

/** The clips' own names inside the folder: "<name>_001.<ext>", numbered in order. */
export function scenePattern(input: string): string {
  const slash = Math.max(input.lastIndexOf('/'), input.lastIndexOf('\\'));
  const file = input.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : '.mp4';
  return `${stem}_%03d${ext}`;
}
