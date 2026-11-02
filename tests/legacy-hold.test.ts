/**
 * A saved "Hold, seconds" translated into the length that matches it
 * (milestone 30's loose end, src/core/legacy-hold.ts).
 *
 * Eleven bundled templates lost the parameter when they declared their parts.
 * Work saved before that still carries a value for it, and used to lose it:
 * the render fell back on the template's own hold and the value was reported
 * as an unknown parameter. These hold the translation and — the point of the
 * exercise — hold it for **every kind of saved work**, each through the
 * reader that kind really goes through.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest, type TemplateManifest } from '../src/core/manifest';
import { parseCollection } from '../src/core/collection';
import { parseProject } from '../src/core/project';
import { planBatch } from '../src/core/batch-csv';
import { applyPreset } from '../src/core/param-presets';
import { LENGTH_KEY } from '../src/core/params';
import { PACK_FILENAME } from '../src/core/pack';
import {
  isLegacyHoldHeader, LEGACY_HOLD_LABEL, LEGACY_HOLD_PARAMS, legacyHoldParam, lengthForLegacyHold, withLegacyHold,
} from '../src/core/legacy-hold';

const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/** Every bundled template's manifest, by its id: the real numbers, not a fixture's. */
async function bundled(): Promise<Map<string, TemplateManifest>> {
  const out = new Map<string, TemplateManifest>();
  const dirs: string[] = [];
  for (const d of await readdir(TEMPLATES_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const names = await readdir(join(TEMPLATES_DIR, d.name));
    if (names.includes(PACK_FILENAME)) {
      for (const sub of await readdir(join(TEMPLATES_DIR, d.name), { withFileTypes: true })) {
        if (sub.isDirectory()) dirs.push(join(d.name, sub.name));
      }
    } else if (names.includes('template.json')) dirs.push(d.name);
  }
  for (const dir of dirs) {
    const parsed = parseManifest(await readFile(join(TEMPLATES_DIR, dir, 'template.json'), 'utf8'));
    if (parsed.ok) out.set(parsed.manifest.id, parsed.manifest);
  }
  return out;
}

const manifests = await bundled();
/** The nine that lost `inOut`, as the one worked example: 6 s long, holding from 1.35 to 3.97. */
const citation = manifests.get('pulp.samples.citation-callout')!;
/** And one of the two that lost `hold`, since the id differs. */
const hairline = manifests.get('pulp.samples.hairline-lower-third')!;

describe('the eleven templates that lost the parameter', () => {
  it('are all still bundled, still declare a hold, and no longer declare the parameter', () => {
    expect(Object.keys(LEGACY_HOLD_PARAMS)).toHaveLength(11);
    for (const [id, param] of Object.entries(LEGACY_HOLD_PARAMS)) {
      const manifest = manifests.get(id);
      expect(manifest, `${id} is bundled`).toBeDefined();
      // Without a hold to stretch there is no length to translate a hold into.
      expect(manifest!.structure?.kind, `${id} declares a hold`).toBe('hold');
      // The whole premise: were it still a parameter, it would be resolved rather than translated.
      expect(manifest!.parameters.some((p) => p.id === param), `${id} no longer declares "${param}"`).toBe(false);
      expect(manifest!.parameters.some((p) => p.label === LEGACY_HOLD_LABEL), `${id} offers no "${LEGACY_HOLD_LABEL}"`).toBe(false);
    }
  });

  it('are the only templates a saved hold is translated for', () => {
    // `inOut` is a live parameter — "Animate in/out" — on many templates, and a value saved for
    // one of those is resolved as it always was rather than read as a hold.
    const live = [...manifests.values()].filter((m) => m.parameters.some((p) => p.id === 'inOut'));
    expect(live.length, 'templates still offering an inOut parameter').toBeGreaterThan(10);
    for (const m of live) expect(legacyHoldParam(m.id), m.id).toBeUndefined();
    const other = live[0]!;
    const raw = { inOut: 5 };
    expect(withLegacyHold(other, raw).params, other.id).toBe(raw);
  });
});

describe('the length a saved hold means', () => {
  it('is the declared entrance and exit with that hold between them', () => {
    // Citation callout: 6 s long, holding from 1.35 to 3.97 — an entrance of 1.35 and an exit of
    // 2.03. A saved hold of 5 s is a graphic that sits still for 5 s between the two.
    expect(lengthForLegacyHold(citation, 5)).toBe(8.38);
    expect(lengthForLegacyHold(citation, 0.5)).toBe(3.88);
    // Hairline lower third: 6 s long, holding from 0.83 to 4.05 — an entrance of 0.83, an exit of 1.95.
    expect(lengthForLegacyHold(hairline, 5)).toBe(7.78);
  });

  it('is held inside the limits the length has anyway, and reads a number however it was written', () => {
    // Below the shortest the parts allow, the length is that shortest: the entrance and the exit
    // play at the speed they were designed at, which is the one thing a length may not change.
    expect(lengthForLegacyHold(citation, 0.001)).toBe(3.43);
    // And no longer than a graphic may be asked for.
    expect(lengthForLegacyHold(citation, 10_000)).toBe(1800);
    // A command line and a CSV cell both hand it over as text.
    expect(lengthForLegacyHold(citation, '5')).toBe(8.38);
    expect(lengthForLegacyHold(citation, ' 5 ')).toBe(8.38);
  });

  it('is nothing at all for what is not a hold', () => {
    for (const bad of ['', 'soon', null, undefined, 0, -2, Number.NaN, {}]) {
      expect(lengthForLegacyHold(citation, bad), String(bad)).toBeNull();
    }
    // A template with nothing to stretch has no length to translate into.
    expect(lengthForLegacyHold({ id: citation.id, duration: 6 }, 5)).toBeNull();
  });
});

describe('each kind of saved work', () => {
  /** What every kind must come out with: the hold gone, the matching length in its place. */
  const translated = (params: Record<string, unknown>) => {
    expect(params[LENGTH_KEY], 'the matching length').toBe(8.38);
    expect('inOut' in params, 'the lost parameter is gone').toBe(false);
  };

  it('a preset saved against the template', () => {
    // A preset stores only what differed from the defaults, so an `inOut` in one was a choice.
    const saved = { quote: 'A line worth keeping', inOut: 5 };
    const applied = applyPreset(citation, saved);
    translated(applied);
    expect(applied.quote, 'the rest of the preset is untouched').toBe('A line worth keeping');
    // The two that used `hold` travel the same way.
    expect(applyPreset(hairline, { hold: 5 })[LENGTH_KEY]).toBe(7.78);
  });

  it('a collection item, from a .pulpcollection file', () => {
    const file = JSON.stringify({
      formatVersion: 1,
      items: [{ uid: 'u1', id: 'abc123', kind: 'template', name: 'Citation Callout', templateId: citation.id, presetId: 'prores-4444', options: {}, params: { quote: 'Saved last year', inOut: 5 } }],
    });
    const parsed = parseCollection(file);
    expect(parsed.ok).toBe(true);
    const item = (parsed as { ok: true; collection: { items: { params: Record<string, unknown> }[] } }).collection.items[0]!;
    translated(withLegacyHold(citation, item.params).params);
  });

  it('a collection item inside a .pulp project', () => {
    const file = JSON.stringify({
      formatVersion: 1,
      libraryFolders: [],
      items: [{ uid: 'u1', id: 'abc123', kind: 'template', name: 'Citation Callout', templateId: citation.id, presetId: 'h264-mp4', options: {}, params: { inOut: 5 } }],
    });
    const parsed = parseProject(file);
    expect(parsed.ok).toBe(true);
    const item = (parsed as { ok: true; project: { collection: { items: { params: Record<string, unknown> }[] } } }).project.collection.items[0]!;
    translated(withLegacyHold(citation, item.params).params);
  });

  it('a CSV row, whose column the template no longer has', () => {
    // Headed with the old label or the old id: either is the length written the old way, and
    // neither is the unknown column it used to be reported as.
    // The label carries a comma, so a real file quotes it; the id needs no quoting.
    for (const header of [`"${LEGACY_HOLD_LABEL}"`, 'inOut']) {
      const plan = planBatch(citation, `Quote,${header}\nFirst,5\nSecond,0.5\nThird,\n`);
      expect(plan.unknownColumns, header).toEqual([]);
      expect(plan.columns.map((c) => c.paramId), header).toEqual(['quote', LENGTH_KEY]);
      expect(plan.warnings.join(' ')).toContain('no longer a parameter');
      translated(plan.rows[0]!.params);
      expect(plan.rows[1]!.params[LENGTH_KEY], 'each row its own length').toBe(3.88);
      // An empty cell asks for nothing, so that row renders at the template's own length.
      expect(plan.rows[2]!.params[LENGTH_KEY]).toBeUndefined();
    }
    // A cell that is not a number is said rather than guessed at.
    const bad = planBatch(citation, `Quote,"${LEGACY_HOLD_LABEL}"\nFirst,soon\n`);
    expect(bad.rows[0]!.params[LENGTH_KEY]).toBeUndefined();
    expect(bad.warnings.join(' ')).toContain('Row 1');
    // And on a template that never had the parameter it is an unknown column, as it always was.
    const other = [...manifests.values()].find((m) => m.parameters.some((p) => p.id === 'inOut'))!;
    expect(planBatch(other, `inOut,x\n5,1\n`).columns.map((c) => c.paramId)).toContain('inOut');
    expect(isLegacyHoldHeader(other, LEGACY_HOLD_LABEL)).toBe(false);
  });

  it('a --param on the command line, which hands every value over as text', () => {
    translated(withLegacyHold(citation, { inOut: '5' }).params);
    // What a render would say about it, since the person asked for something that no longer exists.
    expect(withLegacyHold(citation, { inOut: '5' }).note).toBe('"Hold, seconds" is no longer a parameter: the saved 5 s became a length of 8.38 s.');
  });
});

describe('what the translation leaves alone', () => {
  it('a length that was chosen, which outranks one worked out from a lost parameter', () => {
    const result = withLegacyHold(citation, { inOut: 5, [LENGTH_KEY]: 12 });
    expect(result.params[LENGTH_KEY]).toBe(12);
    expect('inOut' in result.params, 'the lost parameter still goes').toBe(false);
    expect(result.note).toContain('the length saved with this one is used instead');
  });

  it('a bag with nothing to translate, which comes back as the very same object', () => {
    const raw = { quote: 'Hello' };
    expect(withLegacyHold(citation, raw).params).toBe(raw);
    expect(withLegacyHold(citation, raw).note).toBeUndefined();
  });

  it('a value that is not a hold: the parameter goes, the length is not guessed at', () => {
    const result = withLegacyHold(citation, { inOut: 'soon' });
    expect(result.params).toEqual({});
    expect(result.note).toBeUndefined();
  });
});
