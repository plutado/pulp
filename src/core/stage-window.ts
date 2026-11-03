/**
 * The popped-out stage (milestone 43): the stage can leave the main window for
 * a window of its own, on any display. What is remembered about that window —
 * whether it was out, and where — and what to do with it at the next launch
 * live here, pure, so the fallback for a display that is no longer connected
 * is checked without a screen.
 *
 * The window itself is the renderer's: the stage's own elements are moved into
 * a child window that shares the renderer's page, so everything wired to them
 * keeps working (ADR 0019). The main process only opens, places, watches and
 * closes it.
 */

export interface StageWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StageWindowState {
  /** The stage was out when the window was last closed: it reopens out. */
  open: boolean;
  /** Where the window was, in screen coordinates; null until it has been placed once. */
  bounds: StageWindowBounds | null;
}

/** A display's area, as the main process reports it (its work area: the desktop less the taskbar or dock). */
export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_STAGE_WINDOW: StageWindowState = { open: false, bounds: null };

/** The window's floor: a picture and a scrub bar under it, both still readable. */
export const STAGE_WINDOW_MIN = { width: 480, height: 300 } as const;

/** What the window opens at the first time, before it has been placed by hand. */
export const STAGE_WINDOW_DEFAULT_SIZE = { width: 960, height: 600 } as const;

/**
 * How much of the window must sit on a connected display for it to count as
 * being on one: enough of its title bar to take hold of and drag.
 */
const VISIBLE_MIN = { width: 160, height: 40 } as const;

/** The frame name the renderer opens the window under, which is how the main process knows it. */
export const STAGE_WINDOW_NAME = 'pulp-stage';

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Tolerates a missing or damaged setting: nothing saved means the stage starts in the main window. */
export function sanitizeStageWindow(raw: unknown): StageWindowState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof StageWindowState, unknown>>;
  const b = (r.bounds && typeof r.bounds === 'object' ? r.bounds : null) as Partial<Record<keyof StageWindowBounds, unknown>> | null;
  const bounds =
    b && finite(b.x) && finite(b.y) && finite(b.width) && finite(b.height) && b.width >= STAGE_WINDOW_MIN.width && b.height >= STAGE_WINDOW_MIN.height
      ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
      : null;
  return { open: r.open === true, bounds };
}

/**
 * Whether a window at these bounds would be on a connected display: enough of
 * its top edge on one of them to be seen and taken hold of. A display that was
 * unplugged leaves its windows nowhere, which is what this catches.
 */
export function onADisplay(bounds: StageWindowBounds, displays: readonly DisplayArea[]): boolean {
  // The strip a title bar occupies: the window's top, VISIBLE_MIN.height tall.
  const strip = { left: bounds.x, right: bounds.x + bounds.width, top: bounds.y, bottom: bounds.y + VISIBLE_MIN.height };
  return displays.some((d) => {
    const width = Math.min(strip.right, d.x + d.width) - Math.max(strip.left, d.x);
    const height = Math.min(strip.bottom, d.y + d.height) - Math.max(strip.top, d.y);
    return width >= VISIBLE_MIN.width && height >= VISIBLE_MIN.height;
  });
}

/**
 * What the stage does at launch: out again where it was, or — when that
 * display is no longer connected — back in the main window rather than open
 * off-screen where nothing could reach it. The remembered place is dropped
 * with the display, so the next pop-out opens somewhere visible.
 */
export function stageWindowAtLaunch(saved: StageWindowState, displays: readonly DisplayArea[]): StageWindowState {
  if (!saved.bounds) return saved;
  if (onADisplay(saved.bounds, displays)) return saved;
  return { open: false, bounds: null };
}

/**
 * Where to open the window: the remembered place when it is still on a
 * display, else its remembered size alone (the platform centers it), else the
 * default size. A window remembered on a display since unplugged keeps its
 * size and loses its place.
 */
export function stageWindowPlacement(saved: StageWindowState, displays: readonly DisplayArea[]): Partial<StageWindowBounds> & { width: number; height: number } {
  const { bounds } = saved;
  if (!bounds) return { ...STAGE_WINDOW_DEFAULT_SIZE };
  if (onADisplay(bounds, displays)) return { ...bounds };
  return { width: bounds.width, height: bounds.height };
}

/** A connected display as the menu offers it (milestone 43): View → Stage on Display. */
export interface MenuDisplay {
  id: number;
  label: string;
}

/**
 * How a display reads in the menu: the name the platform gives it, or its
 * number when there is none, with its size and which one is the main display,
 * so two of the same model can be told apart.
 */
export function displayMenuLabel(d: { label?: string; width: number; height: number; primary: boolean; index: number }): string {
  const name = d.label?.trim() || `Display ${d.index + 1}`;
  return `${name} · ${Math.round(d.width)} × ${Math.round(d.height)}${d.primary ? ' (main)' : ''}`;
}

/** The connected displays as the menu lists them, the main one first. */
export function menuDisplays(displays: readonly { id: number; label?: string; width: number; height: number }[], primaryId: number): MenuDisplay[] {
  const ordered = [...displays].sort((a, b) => Number(b.id === primaryId) - Number(a.id === primaryId));
  return ordered.map((d, index) => ({ id: d.id, label: displayMenuLabel({ ...d, primary: d.id === primaryId, index }) }));
}
