import { describe, expect, it } from 'vitest';
import { browseSqueezesStage, DEFAULT_LAYOUT, LAYOUT_LIMITS, layoutCssVariables, sanitizeLayout, shownPanes, startupLayout, withCollapsed, withPaneSize } from '../src/core/layout';

describe('sanitizeLayout', () => {
  it('falls back to the defaults for garbage', () => {
    expect(sanitizeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    // A settings file from before the transport row (milestone 37) has no height for it: the default serves.
    expect(sanitizeLayout({ browseWidth: 200 }).transportHeight).toBe(DEFAULT_LAYOUT.transportHeight);
    // And one from before the drawer (milestone 38): the old inspectorWidth is ignored, the drawer takes its defaults.
    const old = sanitizeLayout({ inspectorWidth: 350, inspectorTab: 'sideways' });
    expect(old.inspectorHeight).toBe(DEFAULT_LAYOUT.inspectorHeight);
    expect(old.inspectorTab).toBe('parameters');
    expect(old.resultsCollapsed).toBe(false);
    expect(sanitizeLayout('nope')).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout({ browseWidth: 'wide', stageShare: NaN, trayCollapsed: 1 })).toEqual(DEFAULT_LAYOUT);
  });

  it('clamps sizes to the limits and keeps valid values', () => {
    const l = sanitizeLayout({ browseWidth: 5000, inspectorHeight: 10, inspectorTab: 'output', stageShare: 0.5, trayHeight: 300, transportHeight: 1000, browseCollapsed: true, trayCollapsed: false });
    expect(l.browseWidth).toBe(LAYOUT_LIMITS.browseWidth.max);
    expect(l.inspectorHeight).toBe(LAYOUT_LIMITS.inspectorHeight.min);
    expect(l.inspectorTab).toBe('output');
    expect(l.stageShare).toBe(0.5);
    expect(l.trayHeight).toBe(300);
    expect(l.transportHeight).toBe(LAYOUT_LIMITS.transportHeight.max);
    expect(l.browseCollapsed).toBe(true);
    expect(l.trayCollapsed).toBe(false);
  });
});

describe('withPaneSize and withCollapsed', () => {
  it('clamps and preserves identity when unchanged', () => {
    const l = DEFAULT_LAYOUT;
    expect(withPaneSize(l, 'browseWidth', 99999).browseWidth).toBe(LAYOUT_LIMITS.browseWidth.max);
    expect(withPaneSize(l, 'stageShare', 0)).toHaveProperty('stageShare', LAYOUT_LIMITS.stageShare.min);
    expect(withPaneSize(l, 'browseWidth', l.browseWidth)).toBe(l);
    expect(withPaneSize(l, 'trayHeight', NaN)).toBe(l);
    expect(withPaneSize(l, 'transportHeight', 10).transportHeight).toBe(LAYOUT_LIMITS.transportHeight.min);
    expect(withPaneSize(l, 'inspectorHeight', 9999).inspectorHeight).toBe(LAYOUT_LIMITS.inspectorHeight.max);
    expect(withCollapsed(l, 'results', true).resultsCollapsed).toBe(true);
    expect(withCollapsed(l, 'results', false)).toBe(l);
    expect(withCollapsed(l, 'tray', true)).toBe(l);
    expect(withCollapsed(l, 'tray', false).trayCollapsed).toBe(false);
  });
});

describe('layoutCssVariables', () => {
  it('maps sizes to custom properties', () => {
    expect(layoutCssVariables({ ...DEFAULT_LAYOUT, browseWidth: 200, stageShare: 0.625 })).toEqual({
      '--browse-w': '200px',
      '--inspector-h': '320px',
      '--stage-share': '62.5%',
      '--tray-h': '220px',
      '--transport-h': '124px',
    });
  });
});

describe('shownPanes: nothing empty takes room from the stage (milestone 42)', () => {
  it('shows the tray only when it has something, and opens it only then', () => {
    const open = { ...DEFAULT_LAYOUT, trayCollapsed: false };
    expect(shownPanes(open, { trayItems: 0, resultItems: 5 })).toMatchObject({ trayShown: false, trayOpen: false });
    // A tray saved open does not reopen empty; it comes back open with the first item.
    expect(shownPanes(open, { trayItems: 1, resultItems: 5 })).toMatchObject({ trayShown: true, trayOpen: true });
    expect(shownPanes(DEFAULT_LAYOUT, { trayItems: 1, resultItems: 5 })).toMatchObject({ trayShown: true, trayOpen: false });
  });

  it('folds empty results to their heading whatever was saved', () => {
    expect(shownPanes(DEFAULT_LAYOUT, { trayItems: 0, resultItems: 0 })).toMatchObject({ resultsFolded: true, resultsOpen: false });
    expect(shownPanes(DEFAULT_LAYOUT, { trayItems: 0, resultItems: 3 })).toMatchObject({ resultsFolded: false, resultsOpen: true });
    expect(shownPanes({ ...DEFAULT_LAYOUT, resultsCollapsed: true }, { trayItems: 0, resultItems: 3 })).toMatchObject({ resultsFolded: false, resultsOpen: false });
  });
});

describe('startupLayout: the left panel starts folded on a small window (milestone 42)', () => {
  it('folds the browse panel where it would squeeze the stage, and leaves it where it would not', () => {
    // The default window: the picture is bounded by its height, so the panel costs it nothing.
    expect(browseSqueezesStage(DEFAULT_LAYOUT, { width: 1280, height: 788 })).toBe(false);
    expect(startupLayout(DEFAULT_LAYOUT, { width: 1280, height: 788 })).toBe(DEFAULT_LAYOUT);
    // The window CI runs at: short as well as narrow, so the picture still fits beside the panel.
    expect(browseSqueezesStage(DEFAULT_LAYOUT, { width: 1008, height: 655 })).toBe(false);
    // Tall and narrow: the panel takes width the picture wants.
    expect(browseSqueezesStage(DEFAULT_LAYOUT, { width: 1000, height: 788 })).toBe(true);
    expect(startupLayout(DEFAULT_LAYOUT, { width: 1000, height: 788 }).browseCollapsed).toBe(true);
    // A wider panel squeezes sooner.
    expect(browseSqueezesStage({ ...DEFAULT_LAYOUT, browseWidth: 480 }, { width: 1280, height: 788 })).toBe(true);
    // Already folded: the same object, nothing to change.
    const folded = { ...DEFAULT_LAYOUT, browseCollapsed: true };
    expect(startupLayout(folded, { width: 960, height: 788 })).toBe(folded);
  });
});
