/**
 * Shell pane layout: sizes and collapsed state of the resizable regions
 * (docs/ui-layout.md). Pure; the renderer applies it as CSS custom properties
 * and the main process keeps it in settings.json.
 */

export interface LayoutState {
  /** Browse panel width in px. */
  browseWidth: number;
  /** Inspector width in px. */
  inspectorWidth: number;
  /** The stage's share of the center column height, 0..1. */
  stageShare: number;
  /** Collection tray height in px when open. */
  trayHeight: number;
  browseCollapsed: boolean;
  stageCollapsed: boolean;
  /** The tray starts collapsed to its one-line summary and opens when the first job arrives. */
  trayCollapsed: boolean;
}

export const LAYOUT_LIMITS = {
  browseWidth: { min: 180, max: 480 },
  inspectorWidth: { min: 240, max: 560 },
  stageShare: { min: 0.2, max: 0.85 },
  trayHeight: { min: 120, max: 480 },
} as const;

export const DEFAULT_LAYOUT: LayoutState = {
  browseWidth: 280,
  inspectorWidth: 300,
  stageShare: 0.6,
  trayHeight: 220,
  browseCollapsed: false,
  stageCollapsed: false,
  trayCollapsed: true,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function number(raw: unknown, fallback: number, min: number, max: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, min, max) : fallback;
}

/** Tolerates missing or damaged settings: every field falls back to its default, sizes are clamped. */
export function sanitizeLayout(raw: unknown): LayoutState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof LayoutState, unknown>>;
  const L = LAYOUT_LIMITS;
  return {
    browseWidth: number(r.browseWidth, DEFAULT_LAYOUT.browseWidth, L.browseWidth.min, L.browseWidth.max),
    inspectorWidth: number(r.inspectorWidth, DEFAULT_LAYOUT.inspectorWidth, L.inspectorWidth.min, L.inspectorWidth.max),
    stageShare: number(r.stageShare, DEFAULT_LAYOUT.stageShare, L.stageShare.min, L.stageShare.max),
    trayHeight: number(r.trayHeight, DEFAULT_LAYOUT.trayHeight, L.trayHeight.min, L.trayHeight.max),
    browseCollapsed: r.browseCollapsed === true,
    stageCollapsed: r.stageCollapsed === true,
    trayCollapsed: r.trayCollapsed !== false,
  };
}

export type SizedPane = 'browseWidth' | 'inspectorWidth' | 'stageShare' | 'trayHeight';
export type CollapsiblePane = 'browse' | 'stage' | 'tray';

/** A drag or keyboard resize; the value is clamped to the pane's limits. Same object when unchanged. */
export function withPaneSize(l: LayoutState, pane: SizedPane, value: number): LayoutState {
  const { min, max } = LAYOUT_LIMITS[pane];
  const next = Number.isFinite(value) ? clamp(value, min, max) : l[pane];
  return next === l[pane] ? l : { ...l, [pane]: next };
}

export function withCollapsed(l: LayoutState, pane: CollapsiblePane, collapsed: boolean): LayoutState {
  const key = `${pane}Collapsed` as const;
  return l[key] === collapsed ? l : { ...l, [key]: collapsed };
}

/**
 * The custom properties the stylesheet reads. Collapsed panes keep their stored
 * size (reopening restores it); the collapsed classes, not the variables, hide them.
 */
export function layoutCssVariables(l: LayoutState): Record<string, string> {
  return {
    '--browse-w': `${l.browseWidth}px`,
    '--inspector-w': `${l.inspectorWidth}px`,
    '--stage-share': `${Math.round(l.stageShare * 1000) / 10}%`,
    '--tray-h': `${l.trayHeight}px`,
  };
}
