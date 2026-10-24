/**
 * Milestone 21's rule: every type in the browse tree has between three and
 * five examples across the bundled templates and the sample-media catalogue,
 * the way the themes already do. While the milestone is open, the types still
 * to be filled are named below; that list only shrinks, and a type that
 * reaches three has to be taken off it.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanLibrary } from '../src/core/library';
import { SAMPLE_MEDIA } from '../src/core/sample-media';
import { entryType, TYPE_GROUPS, TYPES, typeInfo } from '../src/core/taxonomy';

const TEMPLATES_DIR = join(__dirname, '..', 'templates');

/** Types the milestone has not reached yet (ROADMAP.md, milestone 21). Empty since the milestone landed; a new type goes here until its examples do. */
const STILL_OPEN = new Set<string>([]);

describe('sample coverage per type', async () => {
  const index = await scanLibrary([TEMPLATES_DIR]);
  const counts = new Map<string, number>();
  for (const t of index.templates) {
    const type = entryType(t);
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  for (const item of SAMPLE_MEDIA) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);

  it.each(TYPES.filter((t) => !STILL_OPEN.has(t.id)).map((t) => [t.id, t.label] as const))('%s has three to five examples', (id, label) => {
    const n = counts.get(id) ?? 0;
    expect(n, `${label}: three is enough to look like a type, not a one-off`).toBeGreaterThanOrEqual(3);
    expect(n, `${label}: past five the type wants splitting or trimming`).toBeLessThanOrEqual(5);
  });

  it('names only types that are really still short, and no type outside the taxonomy', () => {
    for (const id of STILL_OPEN) {
      expect(typeInfo(id), id).toBeDefined();
      expect(counts.get(id) ?? 0, `${id} has reached three: take it off STILL_OPEN`).toBeLessThan(3);
    }
    for (const type of counts.keys()) expect(typeInfo(type), type).toBeDefined();
  });

  it('leaves no group empty, once a group has any type that is not still open', () => {
    for (const group of TYPE_GROUPS) {
      const types = TYPES.filter((t) => t.group === group.id);
      if (types.every((t) => STILL_OPEN.has(t.id))) continue;
      const filled = types.filter((t) => (counts.get(t.id) ?? 0) >= 3);
      expect(filled.length, group.label).toBeGreaterThan(0);
    }
  });
});
