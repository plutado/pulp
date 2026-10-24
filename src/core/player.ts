/**
 * The stage player's pure parts (docs/ui-layout.md, milestone 12): what the
 * loop toggle and the frame-step buttons do to the current frame, where the in
 * and out marks sit on the scrub bar, the safe-area insets, and the preferences
 * the player keeps in settings.json. No DOM; the stage turns these into
 * elements and the main process stores the settings.
 */

/** What shows behind a preview with transparency. */
export type StageBackground = 'checker' | 'black' | 'white' | 'custom';

const BACKGROUNDS: StageBackground[] = ['checker', 'black', 'white', 'custom'];

export interface PlayerState {
  /** Playback returns to the start at the end instead of stopping on the last frame. */
  loop: boolean;
  background: StageBackground;
  /** The colour the "custom" background uses, `#rrggbb`. */
  customBackground: string;
  /** Title-safe and action-safe rectangles over the preview. */
  safeAreas: boolean;
  /** Media volume, 0 to 1. */
  volume: number;
  muted: boolean;
}

export const DEFAULT_PLAYER: PlayerState = {
  loop: true,
  background: 'checker',
  customBackground: '#808080',
  safeAreas: false,
  volume: 1,
  muted: false,
};

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Tolerates missing or damaged settings: every field falls back to its default. */
export function sanitizePlayer(raw: unknown): PlayerState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PlayerState, unknown>>;
  const volume = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : DEFAULT_PLAYER.volume;
  return {
    loop: r.loop !== false,
    background: BACKGROUNDS.includes(r.background as StageBackground) ? (r.background as StageBackground) : DEFAULT_PLAYER.background,
    customBackground: typeof r.customBackground === 'string' && HEX6.test(r.customBackground) ? r.customBackground.toLowerCase() : DEFAULT_PLAYER.customBackground,
    safeAreas: r.safeAreas === true,
    volume,
    muted: r.muted === true,
  };
}

/**
 * Safe areas for HD, as the EBU and SMPTE practice has settled: action safe
 * 3.5% in from each edge, title safe 5%. Fractions of the frame, so they hold
 * at any size.
 */
export const SAFE_AREAS = [
  { id: 'action', label: 'Action safe', inset: 0.035 },
  { id: 'title', label: 'Title safe', inset: 0.05 },
] as const;

/**
 * Where playback is after some time: frames advance at the output rate from
 * where play started. Null means the end was reached with looping off, so the
 * player stops on the last frame.
 */
export function playheadAt(startFrame: number, elapsedMs: number, fps: number, totalFrames: number, loop: boolean): number | null {
  if (totalFrames <= 0 || fps <= 0 || !Number.isFinite(elapsedMs)) return null;
  const advanced = startFrame + Math.floor((Math.max(0, elapsedMs) / 1000) * fps);
  if (advanced < totalFrames) return advanced;
  return loop ? advanced % totalFrames : null;
}

/** One step of the frame-step buttons. With looping on the ends wrap; without it they stick. */
export function steppedFrame(frame: number, delta: number, totalFrames: number, loop: boolean): number {
  if (totalFrames <= 0) return 0;
  const next = frame + delta;
  if (next >= 0 && next < totalFrames) return next;
  if (!loop) return Math.min(totalFrames - 1, Math.max(0, next));
  return ((next % totalFrames) + totalFrames) % totalFrames;
}

/** Where a frame sits along the scrub bar, as a percentage of its travel. */
export function markPercent(frame: number, totalFrames: number): number {
  if (totalFrames <= 1) return 0;
  return (Math.min(totalFrames - 1, Math.max(0, frame)) / (totalFrames - 1)) * 100;
}

/**
 * The part of the scrub bar the in and out marks leave out, as percentages from
 * each end, so the stage can dim what a render would drop. Open ends dim nothing.
 */
export function trimmedAway(inFrame: number | null, outFrame: number | null, totalFrames: number): { before: number; after: number } {
  return {
    before: inFrame === null ? 0 : markPercent(inFrame, totalFrames),
    after: outFrame === null ? 0 : 100 - markPercent(outFrame, totalFrames),
  };
}
