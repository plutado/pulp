/**
 * The window without a pointer (milestone 8's accessibility pass): what the
 * markup has to carry for every region to be reachable, operable and
 * announced. Read off `index.html`, so a control added without a name or a
 * group added without a label fails here rather than in somebody's screen
 * reader.
 *
 * What a key *does* is the regions' own tests — the roving arithmetic has
 * `tests/roving.test.ts`, and the end-to-end suite drives the real window.
 */

import { describe, expect, it } from 'vitest';
import { shownMarkup } from './markup';

// As the window shows it: the markup's words are in the catalog (milestone 59; tests/markup.ts).
const html = shownMarkup();

/** Every opening tag in the markup, as its tag name and its attribute text. */
const tags = [...html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)].map((m) => ({ tag: m[1]!, attrs: m[2]! }));

const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? m[1]! : null;
};
const has = (attrs: string, name: string): boolean => new RegExp(`\\b${name}[\\s=>]`).test(`${attrs} `);
const withRole = (role: string) => tags.filter((t) => attr(t.attrs, 'role') === role);
/** A name a screen reader can read: a label of its own, or one pointing at an element that has one. */
const named = (attrs: string): boolean => Boolean(attr(attrs, 'aria-label') || attr(attrs, 'aria-labelledby'));

describe('every region says what it is', () => {
  it('names each region landmark', () => {
    const regions = tags.filter((t) => (attr(t.attrs, 'id') ?? '').startsWith('region-'));
    expect(regions.length).toBeGreaterThanOrEqual(5);
    for (const region of regions) expect(named(region.attrs), attr(region.attrs, 'id') ?? '').toBe(true);
  });

  it('names every group of controls a screen reader steps into', () => {
    for (const role of ['tablist', 'listbox', 'tree', 'toolbar', 'group']) {
      const found = withRole(role);
      for (const el of found) expect(named(el.attrs), `${role}: ${el.attrs.trim().slice(0, 60)}`).toBe(true);
    }
    // The ones this window is built from are all there.
    expect(withRole('tablist').length).toBeGreaterThanOrEqual(1);
    expect(withRole('listbox').length).toBeGreaterThanOrEqual(2);
    expect(withRole('tree').length).toBe(1);
  });
});

describe('the tabs, the splitters and the chips', () => {
  it('gives every tab the pane it controls and whether it is the chosen one', () => {
    const tabs = withRole('tab');
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      const controls = attr(tab.attrs, 'aria-controls');
      expect(controls, tab.attrs).toBeTruthy();
      expect(attr(tab.attrs, 'aria-selected'), tab.attrs).toBeTruthy();
      // The pane it names is there, and names the tab back.
      const pane = tags.find((t) => attr(t.attrs, 'id') === controls);
      expect(pane, `pane ${controls}`).toBeDefined();
      expect(attr(pane!.attrs, 'role')).toBe('tabpanel');
      expect(attr(pane!.attrs, 'aria-labelledby')).toBe(attr(tab.attrs, 'id'));
    }
  });

  it('makes every splitter a focusable separator that says which way it resizes', () => {
    const splitters = withRole('separator');
    expect(splitters.length).toBeGreaterThanOrEqual(4);
    for (const s of splitters) {
      expect(attr(s.attrs, 'tabindex'), s.attrs).toBe('0');
      expect(['vertical', 'horizontal']).toContain(attr(s.attrs, 'aria-orientation'));
      expect(named(s.attrs), s.attrs).toBe(true);
    }
  });

  it('gives every filter chip a pressed state, since each is a switch rather than a button that acts', () => {
    const chips = tags.filter((t) => (attr(t.attrs, 'class') ?? '').split(/\s+/).includes('chip') && t.tag === 'button');
    expect(chips.length).toBeGreaterThanOrEqual(7);
    for (const chip of chips) expect(attr(chip.attrs, 'aria-pressed'), chip.attrs).toBeTruthy();
  });
});

describe('what the keyboard can reach', () => {
  it('uses no positive tabindex, so the tab order is the reading order', () => {
    const positive = tags.filter((t) => Number(attr(t.attrs, 'tabindex') ?? '0') > 0);
    expect(positive.map((t) => t.attrs.trim().slice(0, 60))).toEqual([]);
  });

  it('names every field, by a label of its own or a label element', () => {
    const labelled = new Set([...html.matchAll(/<label\b[^>]*\bfor="([^"]*)"/g)].map((m) => m[1]!));
    const fields = tags.filter((t) => ['input', 'select', 'textarea'].includes(t.tag));
    expect(fields.length).toBeGreaterThan(10);
    const nameless = fields.filter((f) => {
      // A hidden field is not in the accessibility tree at all; the control that opens it is.
      if (named(f.attrs) || attr(f.attrs, 'type') === 'hidden' || has(f.attrs, 'hidden')) return false;
      const id = attr(f.attrs, 'id');
      if (id && labelled.has(id)) return false;
      // A field written inside its own <label> is named by it.
      const at = html.indexOf(`<${f.tag}${f.attrs}>`);
      const before = html.slice(Math.max(0, at - 400), at);
      return !(before.lastIndexOf('<label') > before.lastIndexOf('</label>'));
    });
    expect(nameless.map((f) => f.attrs.trim().slice(0, 70))).toEqual([]);
  });

  it('says what is happening where the window speaks for itself', () => {
    // A region that changes without being touched tells a screen reader it has.
    const live = tags.filter((t) => attr(t.attrs, 'role') === 'status' || has(t.attrs, 'aria-live'));
    expect(live.length).toBeGreaterThanOrEqual(5);
  });
});
