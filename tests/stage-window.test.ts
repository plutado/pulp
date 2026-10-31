import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STAGE_WINDOW,
  displayMenuLabel,
  menuDisplays,
  onADisplay,
  sanitizeStageWindow,
  STAGE_WINDOW_DEFAULT_SIZE,
  STAGE_WINDOW_MIN,
  stageWindowAtLaunch,
  stageWindowPlacement,
  type DisplayArea,
} from '../src/core/stage-window';

/** A laptop screen and a second display to its right. */
const laptop: DisplayArea = { x: 0, y: 0, width: 1440, height: 900 };
const second: DisplayArea = { x: 1440, y: -200, width: 2560, height: 1440 };
const onSecond = { x: 1800, y: 100, width: 960, height: 600 };

describe('sanitizeStageWindow', () => {
  it('falls back to the main window for garbage, and keeps a sound place', () => {
    expect(sanitizeStageWindow(undefined)).toEqual(DEFAULT_STAGE_WINDOW);
    expect(sanitizeStageWindow('out')).toEqual(DEFAULT_STAGE_WINDOW);
    expect(sanitizeStageWindow({ open: 1, bounds: { x: 'a' } })).toEqual(DEFAULT_STAGE_WINDOW);
    expect(sanitizeStageWindow({ open: true, bounds: onSecond })).toEqual({ open: true, bounds: onSecond });
    // Rounded: a fractional place from a scaled display is a whole pixel.
    expect(sanitizeStageWindow({ open: false, bounds: { x: 10.4, y: 20.6, width: 800.2, height: 500.7 } }).bounds).toEqual({ x: 10, y: 21, width: 800, height: 501 });
  });

  it('refuses a size below the floor, which is not a window anyone could use', () => {
    expect(sanitizeStageWindow({ open: true, bounds: { x: 0, y: 0, width: STAGE_WINDOW_MIN.width - 1, height: 600 } }).bounds).toBeNull();
    expect(sanitizeStageWindow({ open: true, bounds: { x: 0, y: 0, width: 800, height: STAGE_WINDOW_MIN.height - 1 } }).bounds).toBeNull();
  });
});

describe('onADisplay', () => {
  it('is on a display when enough of its title bar is', () => {
    expect(onADisplay(onSecond, [laptop, second])).toBe(true);
    expect(onADisplay({ x: 100, y: 100, width: 800, height: 500 }, [laptop])).toBe(true);
    // Hanging off the right edge with a hand's width still on screen.
    expect(onADisplay({ x: 1440 - 200, y: 100, width: 800, height: 500 }, [laptop])).toBe(true);
  });

  it('is off every display when its display has gone, or only a sliver is left', () => {
    expect(onADisplay(onSecond, [laptop])).toBe(false);
    // A sliver on the right edge, too little to take hold of.
    expect(onADisplay({ x: 1440 - 100, y: 100, width: 800, height: 500 }, [laptop])).toBe(false);
    // The title bar above the top of the screen, where nothing can reach it.
    expect(onADisplay({ x: 100, y: -300, width: 800, height: 500 }, [laptop])).toBe(false);
    expect(onADisplay(onSecond, [])).toBe(false);
  });
});

describe('stageWindowAtLaunch', () => {
  it('reopens out where it was while that display is connected', () => {
    const saved = { open: true, bounds: onSecond };
    expect(stageWindowAtLaunch(saved, [laptop, second])).toBe(saved);
  });

  it('comes back into the main window when the display is missing, and forgets the place', () => {
    expect(stageWindowAtLaunch({ open: true, bounds: onSecond }, [laptop])).toEqual({ open: false, bounds: null });
    // Closed, but remembered on a missing display: the place goes so the next pop-out is visible.
    expect(stageWindowAtLaunch({ open: false, bounds: onSecond }, [laptop])).toEqual({ open: false, bounds: null });
    // Never placed: nothing to check.
    expect(stageWindowAtLaunch(DEFAULT_STAGE_WINDOW, [laptop])).toBe(DEFAULT_STAGE_WINDOW);
  });
});

describe('stageWindowPlacement', () => {
  it('opens where it was, at its size alone when the display has gone, and at the default the first time', () => {
    expect(stageWindowPlacement({ open: true, bounds: onSecond }, [laptop, second])).toEqual(onSecond);
    expect(stageWindowPlacement({ open: true, bounds: onSecond }, [laptop])).toEqual({ width: 960, height: 600 });
    expect(stageWindowPlacement(DEFAULT_STAGE_WINDOW, [laptop])).toEqual(STAGE_WINDOW_DEFAULT_SIZE);
  });
});

describe('the displays in the View menu', () => {
  it('names a display by the platform\'s label, its size and whether it is the main one', () => {
    expect(displayMenuLabel({ label: 'Built-in Retina Display', width: 1440, height: 900, primary: true, index: 0 })).toBe('Built-in Retina Display · 1440 × 900 (main)');
    expect(displayMenuLabel({ label: 'DELL U2723QE', width: 2560, height: 1440, primary: false, index: 1 })).toBe('DELL U2723QE · 2560 × 1440');
    // No label from the platform: numbered, so two of the same model are still told apart.
    expect(displayMenuLabel({ label: '', width: 1920, height: 1080, primary: false, index: 2 })).toBe('Display 3 · 1920 × 1080');
    expect(displayMenuLabel({ width: 1920.4, height: 1079.6, primary: false, index: 0 })).toBe('Display 1 · 1920 × 1080');
  });

  it('lists the main display first, keeping the rest in order', () => {
    const list = menuDisplays(
      [
        { id: 7, label: 'Left', width: 1920, height: 1080 },
        { id: 2, label: 'Laptop', width: 1440, height: 900 },
        { id: 9, label: '', width: 1920, height: 1080 },
      ],
      2,
    );
    expect(list.map((d) => d.id)).toEqual([2, 7, 9]);
    expect(list[0]!.label).toBe('Laptop · 1440 × 900 (main)');
    expect(list[2]!.label).toBe('Display 3 · 1920 × 1080');
    expect(menuDisplays([], 0)).toEqual([]);
  });
});
