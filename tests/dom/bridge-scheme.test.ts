// @vitest-environment happy-dom
/**
 * The bridge tells the stage what color scheme its page declares (milestone 62),
 * so the frame showing it can carry the same one and nothing opaque is painted
 * behind a transparent graphic. The very BRIDGE_SCRIPT a template page gets,
 * run in a page whose parent is a stand-in that records what it is sent.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { BRIDGE_SCRIPT } from '../../src/core/runtime';
import { frameColorScheme } from '../../src/core/appearance';

const realParent = Object.getOwnPropertyDescriptor(window, 'parent');

/** Run the bridge as a framed page and answer with the `pulp:ready` it posts to its parent. */
async function readyFrom(head: string, rootStyle = ''): Promise<{ type: string; colorScheme?: unknown }> {
  document.head.innerHTML = head;
  document.documentElement.setAttribute('style', rootStyle);
  const sent: { type: string; colorScheme?: unknown }[] = [];
  Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage: (data: { type: string }) => sent.push(data) } });
  new Function(BRIDGE_SCRIPT)();
  for (let i = 0; i < 50 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  return sent.find((m) => m.type === 'pulp:ready')!;
}

afterEach(() => {
  if (realParent) Object.defineProperty(window, 'parent', realParent);
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('style');
});

describe('the bridge says its page\'s color scheme when it is ready (milestone 62)', () => {
  it('says nothing is declared for a page that declares nothing, which the frame takes as light', async () => {
    const ready = await readyFrom('<title>t</title>');
    expect(ready.type).toBe('pulp:ready');
    expect(frameColorScheme(ready.colorScheme)).toBe('light');
  });

  it('passes on a page\'s own meta and its root\'s color-scheme', async () => {
    expect(frameColorScheme((await readyFrom('<meta name="color-scheme" content="dark">')).colorScheme)).toBe('dark');
    expect(frameColorScheme((await readyFrom('', 'color-scheme: light dark')).colorScheme)).toBe('light dark');
  });
});

describe('a host capture asks for no wait after the draw (capturePresented orders it)', () => {
  it('resolves as soon as the page has drawn, reporting it drawn by the host, with no animation frame', async () => {
    document.head.innerHTML = '';
    let drawnFrame = -1;
    (window as unknown as { pulpRender: (s: { frame: number }) => void }).pulpRender = (s) => { drawnFrame = s.frame; };
    // No animation frame ever runs: a host render must not wait on one.
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (() => 0) as unknown as typeof window.requestAnimationFrame;
    try {
      new Function(BRIDGE_SCRIPT)();
      const bridge = (window as unknown as { __pulp: { render: (s: unknown, o?: unknown) => Promise<string>; drawn: { by: string; frame: number } } }).__pulp;
      const started = Date.now();
      const by = await bridge.render({ frame: 7, params: {} }, { presented: true });
      expect(by).toBe('host');
      expect(drawnFrame).toBe(7);
      expect(bridge.drawn).toMatchObject({ frame: 7, by: 'host' });
      // Not the 250 ms the page's own wait gives up after.
      expect(Date.now() - started).toBeLessThan(200);
    } finally {
      window.requestAnimationFrame = realRaf;
    }
  });
});
