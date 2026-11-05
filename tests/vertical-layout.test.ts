/**
 * Layouts made for vertical video (milestone 65): the safe box and the zones a
 * tall frame's words keep clear of, how a check finds the words in a picture,
 * which moments it looks at — and the bundled templates made for vertical held
 * to the rules a manifest can show. Where their words really land is the
 * end-to-end check (tests/e2e/vertical.e2e.test.ts), which draws them.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { scanLibrary } from '../src/core/library';
import { searchLibrary } from '../src/core/search';
import { VERTICAL_ZONES } from '../src/core/player';
import {
  ARM_LENGTH_TYPE, differingRect, MADE_FOR_VERTICAL_TAG, madeForVertical, otherWords, placementCaptions, placementFrames,
  placementProblems, VERTICAL_CHECK_SIZE, VERTICAL_SAFE_BOX, withOtherWords,
} from '../src/core/vertical-layout';

const { width: W, height: H } = VERTICAL_CHECK_SIZE;

describe('the safe box', () => {
  it('is 900 × 1400 centered in 1080 × 1920, below the header strip', () => {
    expect(Math.round(VERTICAL_SAFE_BOX.width * W)).toBe(900);
    expect(Math.round(VERTICAL_SAFE_BOX.height * H)).toBe(1400);
    expect(VERTICAL_SAFE_BOX.left * 2 + VERTICAL_SAFE_BOX.width).toBeCloseTo(1, 10);
    expect(VERTICAL_SAFE_BOX.top * 2 + VERTICAL_SAFE_BOX.height).toBeCloseTo(1, 10);
    const header = VERTICAL_ZONES.find((z) => z.id === 'header')!;
    expect(VERTICAL_SAFE_BOX.top, 'the box starts under the header strip').toBeGreaterThan(header.height);
  });

  it('is not clear on its own: the controls column and the caption band reach into it', () => {
    // Which is why words are held to both: the box, and out of every zone.
    const right = VERTICAL_SAFE_BOX.left + VERTICAL_SAFE_BOX.width;
    const bottom = VERTICAL_SAFE_BOX.top + VERTICAL_SAFE_BOX.height;
    expect(VERTICAL_ZONES.find((z) => z.id === 'controls')!.left).toBeLessThan(right);
    expect(VERTICAL_ZONES.find((z) => z.id === 'caption')!.top).toBeLessThan(bottom);
  });
});

describe('where words may sit', () => {
  it('passes words in the clear middle of the frame', () => {
    expect(placementProblems({ x: 200, y: 400, width: 600, height: 300 }, W, H)).toEqual([]);
    expect(placementProblems({ x: 108, y: 288, width: 864, height: 200 }, W, H), 'a hook across the top third').toEqual([]);
  });

  it('names each side of the box a word crosses, and by how much', () => {
    expect(placementProblems({ x: 40, y: 400, width: 300, height: 100 }, W, H)).toEqual(["50 px past the safe box's left edge"]);
    expect(placementProblems({ x: 200, y: 100, width: 300, height: 400 }, W, H)).toEqual(["160 px past the safe box's top edge", '300 × 130 px inside the header strip']);
  });

  it('names a zone the box lets a word into: the controls column, the caption band', () => {
    // Inside the box, but under the buttons down the right.
    expect(placementProblems({ x: 700, y: 1000, width: 250, height: 100 }, W, H)).toEqual(['64 × 100 px inside the controls column']);
    // Inside the box, but where the app prints its own caption.
    expect(placementProblems({ x: 200, y: 1450, width: 400, height: 100 }, W, H)).toEqual(['400 × 52 px inside the caption band']);
    // The column starts mid-frame: the same words higher up are clear.
    expect(placementProblems({ x: 700, y: 500, width: 250, height: 100 }, W, H)).toEqual([]);
  });

  it("forgives a pixel or two of antialiasing, as another machine's fonts draw it", () => {
    expect(placementProblems({ x: 88, y: 400, width: 300, height: 100 }, W, H)).toEqual([]);
    expect(placementProblems({ x: 86, y: 400, width: 300, height: 100 }, W, H)).toHaveLength(1);
  });
});

describe('finding the words in a picture', () => {
  it('moves every letter and digit one along, keeping the spaces, the case and the length', () => {
    expect(otherWords('Stop scrolling')).toBe('Tupq tdspmmjoh');
    expect(otherWords('3 things, 2026!')).toBe('4 uijoht, 3137!');
    expect(otherWords('Zz9')).toBe('Aa0');
    expect(otherWords('why?')).toHaveLength(4);
    // Every character that is a glyph of a word changes, so nothing of a word is missed.
    for (const c of 'abcxyzABCXYZ0189') expect(otherWords(c)).not.toBe(c);
  });

  it("changes every word a frame's state carries and nothing else", () => {
    const state = {
      frame: 12,
      params: { keyword: 'habit', accent: '#facc15', size: 0.1 },
      blocks: { hook: { box: { x: 1 }, layers: [{ type: 'text', text: 'The one habit' }, { type: 'image', text: 'not words' }] } },
      captions: { time: 1, spoken: 0, line: { text: 'say it', start: 0, end: 1, words: [{ text: 'say' }, { text: 'it' }] } },
    };
    const changed = withOtherWords(state, ['keyword']);
    expect(changed.params).toEqual({ keyword: 'ibcju', accent: '#facc15', size: 0.1 });
    expect(changed.blocks.hook.layers.map((l) => l.text)).toEqual(['Uif pof ibcju', 'not words']);
    expect(changed.captions.line.words.map((w) => w.text)).toEqual(['tbz', 'ju']);
    expect(changed.captions.line.text).toBe('tbz ju');
    // The keyword still names a word of the headline, changed the same way.
    expect(changed.blocks.hook.layers[0]!.text).toContain(changed.params.keyword);
    expect(state.params.keyword, 'the original is left alone').toBe('habit');
  });

  it('finds where two pictures differ, and nothing when they do not', () => {
    const w = 20, h = 10;
    const a = new Uint8Array(w * h * 4);
    const b = new Uint8Array(a);
    expect(differingRect(a, b, w, h)).toBeNull();
    const put = (x: number, y: number, v: number) => { b[(y * w + x) * 4 + 3] = v; };
    put(3, 2, 255);
    put(11, 7, 255);
    put(15, 1, 10); // under the threshold: antialiasing, not a glyph
    expect(differingRect(a, b, w, h)).toEqual({ x: 3, y: 2, width: 9, height: 6 });
  });
});

describe('the moments checked', () => {
  it('checks a holding title where it has settled — the hold — not mid-entrance', () => {
    expect(placementFrames({ duration: 5, fps: 30, structure: { kind: 'hold', holdFrom: 1.2, holdTo: 4.4 } })).toEqual([36, 84, 132]);
  });

  it('checks anything else at its middle', () => {
    expect(placementFrames({ duration: 4, fps: 30, structure: { kind: 'loop' } })).toEqual([60]);
    expect(placementFrames({ duration: 3, fps: 25 })).toEqual([38]);
  });

  it('checks a caption style with the first, a middle and the last word of a long line spoken, each while it is at its largest', () => {
    const box = { x: 54, y: 1075, width: 831, height: 422 };
    const moments = placementCaptions(box);
    expect(moments.map((m) => m.spoken)).toEqual([0, 4, 8]);
    for (const m of moments) {
      const word = m.line.words[m.spoken]!;
      expect(m.time - word.start).toBeCloseTo(0.05, 10);
      expect(m.box).toBe(box);
    }
    expect(moments[0]!.line.words.some((w) => w.text.length >= 9), 'a long word, to test a style that fits one').toBe(true);
  });
});

describe('the bundled templates made for vertical', async () => {
  const index = await scanLibrary([join(__dirname, '..', 'templates')]);
  const vertical = index.templates.filter((t) => madeForVertical(t.manifest));
  const hooks = vertical.filter((t) => t.manifest.tags?.includes('hook'));
  const captions = vertical.filter((t) => t.manifest.captions);

  it('are the six hook titles and four caption styles, each tagged and each drawn at 9:16', () => {
    expect(hooks.map((t) => t.manifest.name).sort()).toEqual(['Hook Bar', 'Hook Bold', 'Hook Keyword', 'Hook List', 'Hook Question', 'Hook Quote']);
    expect(captions.map((t) => t.manifest.name).sort()).toEqual(['Caption Beside', 'Caption Duo', 'Caption One Word', 'Caption Sticker']);
    for (const t of vertical) {
      expect(t.manifest.tags, t.manifest.id).toContain(MADE_FOR_VERTICAL_TAG);
      expect(t.manifest.aspects, `${t.manifest.id}: made tall first, and only tall`).toEqual(['9:16']);
      expect(t.manifest.license).toBe('CC0-1.0');
    }
  });

  it('set every hook for a phone at arm\'s length: a headline of 7% of the short side or more, nothing under 4%', () => {
    for (const t of hooks) {
      const sizes = (t.manifest.blocks ?? []).flatMap((b) => (b.layers ?? []).filter((l) => l.type === 'text').map((l) => ('size' in l && typeof l.size === 'number' ? l.size : b.typography?.size ?? 0.06)));
      expect(sizes.length, t.manifest.id).toBeGreaterThan(0);
      expect(Math.max(...sizes), `${t.manifest.id}: the headline`).toBeGreaterThanOrEqual(ARM_LENGTH_TYPE.headline);
      expect(Math.min(...sizes), `${t.manifest.id}: the smallest line`).toBeGreaterThanOrEqual(ARM_LENGTH_TYPE.smallest);
    }
  });

  it('keep every hook\'s words in a block inside the safe box, in the top part of the frame', () => {
    for (const t of hooks) {
      for (const b of t.manifest.blocks ?? []) {
        const box = (b.box as Record<string, { x: number; y: number; width: number; height: number }>).default!;
        expect(box.x, t.manifest.id).toBeGreaterThanOrEqual(VERTICAL_SAFE_BOX.left);
        expect(box.x + box.width, t.manifest.id).toBeLessThanOrEqual(VERTICAL_SAFE_BOX.left + VERTICAL_SAFE_BOX.width);
        expect(box.y, t.manifest.id).toBeGreaterThanOrEqual(VERTICAL_SAFE_BOX.top);
        // The top third, give or take the room a big number needs.
        expect(box.y + box.height, t.manifest.id).toBeLessThanOrEqual(0.42);
      }
    }
  });

  it('are found by their tag, typed as words or as a filter', () => {
    const ids = (q: string) => new Set(searchLibrary(index, q).map((h) => h.entry.id));
    const all = vertical.map((t) => t.id);
    for (const q of ['made for vertical', 'tag:made-for-vertical']) {
      const found = ids(q);
      for (const id of all) expect(found.has(id), `${q} finds ${id}`).toBe(true);
    }
  });

  it('let a caption style be set no smaller than a viewer can read at arm\'s length', () => {
    for (const t of captions) {
      const size = t.manifest.parameters.find((p) => p.id === 'size');
      expect(size?.type, t.manifest.id).toBe('number');
      if (size?.type !== 'number') continue;
      expect(size.min!, t.manifest.id).toBeGreaterThanOrEqual(ARM_LENGTH_TYPE.smallest);
      expect(t.manifest.alpha, `${t.manifest.id}: a caption style is drawn over the shot`).toBe(true);
    }
  });
});
