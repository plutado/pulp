/**
 * The Lottie starter set (milestone 35): twenty small animations made for
 * Pulp, built by `src/core/lottie-starter.ts` and written into `templates/`.
 *
 * The files on disk are what ships, and the builder is what a person reads, so
 * the first test holds the two together: a change to the builder that was not
 * written out with `npm run lottie:write` fails here rather than shipping a
 * stale file. The rest hold the set to what the milestone promised — every one
 * readable as a template, CC0, typed, with a colour to change.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/core/library';
import { lottieEditables, lottieStructure, markerPart, parseLottie } from '../src/core/lottie';
import { STARTER_ANIMATIONS, STARTER_FPS, STARTER_SIZE } from '../src/core/lottie-starter';

const TEMPLATES = join(__dirname, '..', 'templates');
const STARTER = join(TEMPLATES, 'animated');

describe('the files on disk are what the builder makes', () => {
  it.each(STARTER_ANIMATIONS.map((a) => [a.id, a] as const))('%s is written out as it is built', async (_id, animation) => {
    const file = join(TEMPLATES, animation.folder, `${animation.id}.json`);
    const written = JSON.parse(await readFile(file, 'utf8')) as unknown;
    expect(written, `${animation.id} is stale: run npm run lottie:write`).toEqual(animation.build());
  });

  it('has no file the builder does not make, and none missing', async () => {
    const onDisk: string[] = [];
    for (const folder of await readdir(STARTER, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      for (const file of await readdir(join(STARTER, folder.name))) onDisk.push(`animated/${folder.name}/${file}`);
    }
    const built = STARTER_ANIMATIONS.map((a) => `${a.folder}/${a.id}.json`);
    expect(onDisk.sort()).toEqual([...built].sort());
  });
});

describe('what the set is', () => {
  it('is about twenty animations, each with an id and a folder of its own', () => {
    expect(STARTER_ANIMATIONS.length).toBeGreaterThanOrEqual(18);
    expect(STARTER_ANIMATIONS.length).toBeLessThanOrEqual(24);
    const ids = STARTER_ANIMATIONS.map((a) => a.id);
    expect(new Set(ids).size, 'every id is its own').toBe(ids.length);
    for (const a of STARTER_ANIMATIONS) {
      expect(a.id, a.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(a.folder, a.id).toMatch(/^animated\/[a-z-]+$/);
    }
  });

  it('covers the places templates are weakest: icons, arrows, social marks, confetti and underlines', () => {
    const folders = new Set(STARTER_ANIMATIONS.map((a) => a.folder.split('/')[1]));
    expect([...folders].sort()).toEqual(['arrows', 'confetti', 'icons', 'shapes', 'social']);
  });

  it('builds a readable Lottie every time, and the same one twice', () => {
    for (const animation of STARTER_ANIMATIONS) {
      const doc = parseLottie(JSON.stringify(animation.build()));
      expect(doc.width, animation.id).toBe(STARTER_SIZE);
      expect(doc.height, animation.id).toBe(STARTER_SIZE);
      expect(doc.fps, animation.id).toBe(STARTER_FPS);
      expect(doc.outPoint, animation.id).toBeGreaterThan(doc.inPoint);
      // Built twice, the same bytes: a file that changed between runs could never be checked in.
      expect(JSON.stringify(animation.build()), animation.id).toBe(JSON.stringify(animation.build()));
    }
  });

  it('gives every one something to recolour, named for what it is', () => {
    for (const animation of STARTER_ANIMATIONS) {
      const { parameters } = lottieEditables(animation.build());
      const colours = parameters.filter((p) => p.type === 'color');
      expect(colours.length, `${animation.id} has a colour to change`).toBeGreaterThan(0);
      for (const p of colours) {
        // "Fill" or "Group 1" would tell a person nothing; the label names the part.
        expect(p.label, `${animation.id}: ${p.label}`).not.toMatch(/^(fill|stroke|group|shape)\b/i);
      }
    }
  });
});

describe('as the library reads it', () => {
  it('indexes every one as a typed, CC0 animation that can be recoloured', async () => {
    const index = await scanLibrary([TEMPLATES]);
    const starter = index.templates.filter((t) => t.lottie !== undefined);
    expect(index.problems).toEqual([]);
    expect(starter).toHaveLength(STARTER_ANIMATIONS.length);
    for (const t of starter) {
      expect(t.manifest.license, t.manifest.name).toBe('CC0-1.0');
      expect(t.manifest.author, t.manifest.name).toBe('Pulp');
      // Its folder says what it is, so it files itself in the browse panel like anything else.
      expect(t.manifest.type, t.manifest.name).toBeDefined();
      expect(t.manifest.alpha, t.manifest.name).toBe(true);
      expect(t.tags, t.manifest.name).toContain('animated');
      // Every one is square, and draws for every shape, so it fits any frame it is dropped on.
      expect(t.manifest.size, t.manifest.name).toEqual({ width: STARTER_SIZE, height: STARTER_SIZE });
      expect(t.manifest.aspects, t.manifest.name).toEqual(expect.arrayContaining(['16:9', '9:16', '1:1']));
    }
    const types = new Set(starter.map((t) => t.manifest.type));
    expect([...types].sort()).toEqual(['arrows', 'confetti', 'icons', 'shapes', 'social']);
  });

  it('stretches the ones whose markers say so, and leaves the one-shot burst alone', async () => {
    const index = await scanLibrary([TEMPLATES]);
    const by = (name: string) => index.templates.find((t) => t.manifest.name === name)!;
    // A drawn-on icon holds between its intro and its outro, so it can be any length.
    const check = by('Check draw').manifest;
    expect(check.structure?.kind).toBe('hold');
    // A graphic that goes round says so instead.
    expect(by('Spinner loop').manifest.structure).toEqual({ kind: 'loop' });
    expect(by('Bell ring').manifest.structure).toEqual({ kind: 'loop' });
    // A burst is over when it is over: no markers, no stretching, its own length.
    expect(by('Confetti burst').manifest.structure).toBeUndefined();
    const kinds = index.templates.filter((t) => t.lottie).map((t) => t.manifest.structure?.kind ?? 'none');
    expect(kinds.filter((k) => k === 'hold')).toHaveLength(13);
    expect(kinds.filter((k) => k === 'loop')).toHaveLength(6);
    expect(kinds.filter((k) => k === 'none')).toHaveLength(1);
  });
});

describe('markers become the way a graphic stretches', () => {
  const at = (name: string, time: number, duration = 0) => ({ name, time, duration });

  it('reads the words people use for each part, however they are written', () => {
    for (const word of ['intro', 'In', ' ENTRANCE ', 'start']) expect(markerPart(word), word).toBe('intro');
    for (const word of ['loop', 'Hold', 'idle']) expect(markerPart(word), word).toBe('loop');
    for (const word of ['outro', 'out', 'Exit', 'end']) expect(markerPart(word), word).toBe('outro');
    for (const word of ['chorus', 'frame 12', '']) expect(markerPart(word), word).toBeNull();
  });

  it('holds between an intro and an outro', () => {
    expect(lottieStructure([at('intro', 0, 0.5), at('outro', 1.2, 0.3)], 1.5)).toEqual({ kind: 'hold', holdFrom: 0.5, holdTo: 1.2 });
    // A marker for the hold itself says the same thing from the other side.
    expect(lottieStructure([at('loop', 0.5, 0.7)], 1.5)).toEqual({ kind: 'hold', holdFrom: 0.5, holdTo: 1.2 });
    // One end alone is not a structure: there is no hold to stretch without both.
    expect(lottieStructure([at('intro', 0, 0.5)], 1.5)).toBeNull();
  });

  it('loops where a loop marker covers the whole of it', () => {
    expect(lottieStructure([at('loop', 0, 2)], 2)).toEqual({ kind: 'loop' });
    // A point marker named loop says the same: it goes round.
    expect(lottieStructure([at('loop', 0)], 2)).toEqual({ kind: 'loop' });
  });

  it('says nothing where the markers do not, rather than guessing', () => {
    expect(lottieStructure([], 2)).toBeNull();
    expect(lottieStructure([at('bounce', 0.5, 0.5)], 2)).toBeNull();
    // Markers out of order, or leaving no hold worth the name, are the animator's own business.
    expect(lottieStructure([at('intro', 0, 1.4), at('outro', 0.2, 0.2)], 1.5)).toBeNull();
    expect(lottieStructure([at('intro', 0, 1), at('outro', 1.01, 0.4)], 1.5)).toBeNull();
    expect(lottieStructure([at('loop', 0, 2)], 0)).toBeNull();
  });
});
