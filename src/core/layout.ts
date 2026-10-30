/**
 * Shell pane layout: sizes and collapsed state of the resizable regions
 * (docs/ui-layout.md). Pure; the renderer applies it as CSS custom properties
 * and the main process keeps it in settings.json.
 */

/** The inspector drawer's sections (milestone 38): three buttons in the transport row. */
export const INSPECTOR_TABS = ['parameters', 'output', 'info'] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

export interface LayoutState {
  /** Browse panel width in px. */
  browseWidth: number;
  /** The inspector drawer's height in px when open (milestone 38). */
  inspectorHeight: number;
  /** The drawer's last tab, so it opens where it was left. Whether it is open is not kept: it starts closed. */
  inspectorTab: InspectorTab;
  /** The stage's share of the center column height, 0..1. */
  stageShare: number;
  /** Collection tray height in px when open. */
  trayHeight: number;
  /** The transport row's height in px (milestone 37): the controls, and under them the lanes for the bars per layer. */
  transportHeight: number;
  browseCollapsed: boolean;
  stageCollapsed: boolean;
  /** The tray starts collapsed to its one-line summary and opens when the first job arrives. */
  trayCollapsed: boolean;
  /** The results hidden to give the stage everything (milestone 38); the search bar's toggle brings them back. */
  resultsCollapsed: boolean;
}

export const LAYOUT_LIMITS = {
  browseWidth: { min: 180, max: 480 },
  inspectorHeight: { min: 160, max: 560 },
  stageShare: { min: 0.2, max: 0.85 },
  trayHeight: { min: 120, max: 480 },
  // The floor is the controls line alone; anything above it is lanes for the bars per layer.
  transportHeight: { min: 40, max: 320 },
} as const;

export const DEFAULT_LAYOUT: LayoutState = {
  // Browse stays narrow until milestone 10 fills it with the tree.
  browseWidth: 220,
  inspectorHeight: 320,
  inspectorTab: 'parameters',
  // The split leans to the stage (milestone 38): the picture is why the window is open,
  // and the results are a strip to pick from, scrolling inside their own pane.
  stageShare: 0.72,
  trayHeight: 220,
  // The controls line and room for three layers' bars under the scrub bar.
  transportHeight: 92,
  browseCollapsed: false,
  stageCollapsed: false,
  trayCollapsed: true,
  resultsCollapsed: false,
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
    inspectorHeight: number(r.inspectorHeight, DEFAULT_LAYOUT.inspectorHeight, L.inspectorHeight.min, L.inspectorHeight.max),
    inspectorTab: INSPECTOR_TABS.includes(r.inspectorTab as InspectorTab) ? (r.inspectorTab as InspectorTab) : DEFAULT_LAYOUT.inspectorTab,
    stageShare: number(r.stageShare, DEFAULT_LAYOUT.stageShare, L.stageShare.min, L.stageShare.max),
    trayHeight: number(r.trayHeight, DEFAULT_LAYOUT.trayHeight, L.trayHeight.min, L.trayHeight.max),
    transportHeight: number(r.transportHeight, DEFAULT_LAYOUT.transportHeight, L.transportHeight.min, L.transportHeight.max),
    browseCollapsed: r.browseCollapsed === true,
    stageCollapsed: r.stageCollapsed === true,
    trayCollapsed: r.trayCollapsed !== false,
    resultsCollapsed: r.resultsCollapsed === true,
  };
}

export type SizedPane = 'browseWidth' | 'inspectorHeight' | 'stageShare' | 'trayHeight' | 'transportHeight';
export type CollapsiblePane = 'browse' | 'stage' | 'tray' | 'results';

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
    '--inspector-h': `${l.inspectorHeight}px`,
    '--stage-share': `${Math.round(l.stageShare * 1000) / 10}%`,
    '--tray-h': `${l.trayHeight}px`,
    '--transport-h': `${l.transportHeight}px`,
  };
}
