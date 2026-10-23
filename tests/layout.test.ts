import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_LIMITS, layoutCssVariables, sanitizeLayout, withCollapsed, withPaneSize } from '../src/core/layout';

describe('sanitizeLayout', () => {
  it('falls back to the defaults for garbage', () => {
    expect(sanitizeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout('nope')).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout({ browseWidth: 'wide', stageShare: NaN, trayCollapsed: 1 })).toEqual(DEFAULT_LAYOUT);
  });

  it('clamps sizes to the limits and keeps valid values', () => {
    const l = sanitizeLayout({ browseWidth: 5000, inspectorWidth: 10, stageShare: 0.5, trayHeight: 300, browseCollapsed: true, trayCollapsed: false });
    expect(l.browseWidth).toBe(LAYOUT_LIMITS.browseWidth.max);
    expect(l.inspectorWidth).toBe(LAYOUT_LIMITS.inspectorWidth.min);
    expect(l.stageShare).toBe(0.5);
    expect(l.trayHeight).toBe(300);
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
    expect(withCollapsed(l, 'tray', true)).toBe(l);
    expect(withCollapsed(l, 'tray', false).trayCollapsed).toBe(false);
  });
});

describe('layoutCssVariables', () => {
  it('maps sizes to custom properties', () => {
    expect(layoutCssVariables({ ...DEFAULT_LAYOUT, browseWidth: 200, stageShare: 0.625 })).toEqual({
      '--browse-w': '200px',
      '--inspector-w': '350px',
      '--stage-share': '62.5%',
      '--tray-h': '220px',
    });
  });
});
