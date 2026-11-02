/**
 * The authoring guide and its starter folder (milestone 8): the starter is a
 * valid template that follows every rule the guide gives, and the guide's
 * manifest excerpts are the starter's own, so the two cannot drift apart.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../src/core/manifest';
import { defaultParams } from '../src/core/params';

const ROOT = join(__dirname, '..');
const STARTER = join(ROOT, 'examples', 'pulp-template');

describe('the starter template', () => {
  it('is a valid manifest with no warnings, every shape, a hold, parameters by element and an open block', async () => {
    const raw = JSON.parse(await readFile(join(STARTER, 'template.json'), 'utf8')) as Record<string, unknown>;
    const result = validateManifest(raw);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    if (!result.ok) return;
    const m = result.manifest;
    expect(m.license).toBe('CC0-1.0');
    expect(m.aspects).toEqual(['16:9', '9:16', '1:1', '4:5']);
    expect(m.size).toBeUndefined();
    expect(m.structure).toEqual({ kind: 'hold', holdFrom: 1, holdTo: 5 });
    for (const p of m.parameters) expect(p.element, p.id).toBeTruthy();
    expect(m.parameters.map((p) => p.type)).toEqual(['color', 'color', 'image', 'number']);
    expect(m.blocks[0]!.open).toBe(true);
    expect(m.blocks[0]!.layers.map((l) => l.id)).toEqual(['name', 'title']);
    expect(Object.keys(defaultParams(m))).toHaveLength(m.parameters.length);
  });

  it('follows the rules the guide gives: drawn from the state, no clocks, every shape', async () => {
    const html = await readFile(join(STARTER, 'index.html'), 'utf8');
    expect(html).toContain('window.pulpRender');
    expect(html).toContain('state.width');
    expect(html).toContain('state.height');
    expect(html).toContain('pulpLayoutBlock');
    expect(html).toContain('pulpDrawImage');
    expect(html).not.toMatch(/Date\.now|performance\.now|requestAnimationFrame|Math\.random|setTimeout|setInterval/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<canvas[^>]*\s(width|height)=/);
    expect(html).not.toMatch(/\bH\s*\/\s*1080\b|\bW\s*\/\s*1920\b/);
  });
});

describe('the authoring guide', () => {
  it('points at files that exist and shows the starter\'s own structure and block', async () => {
    const guide = await readFile(join(ROOT, 'docs', 'template-authoring.md'), 'utf8');
    const raw = JSON.parse(await readFile(join(STARTER, 'template.json'), 'utf8')) as { structure: unknown; blocks: unknown[]; parameters: { id: string }[] };
    expect(guide).toContain('examples/pulp-template/');
    expect(guide).toContain('template-format.md');
    expect(guide).toContain('schema/template.schema.json');
    // The excerpts are the starter's own, so a change to one shows up in the other.
    expect(guide).toContain(`"structure": ${JSON.stringify(raw.structure).replace(/,/g, ', ').replace(/{/g, '{ ').replace(/}/g, ' }').replace(/":/g, '": ')}`);
    for (const p of raw.parameters) expect(guide, p.id).toContain(`"id": "${p.id}"`);
    const block = raw.blocks[0] as { id: string; layers: { id: string }[] };
    expect(guide).toContain(`"id": "${block.id}"`);
    for (const l of block.layers) expect(guide).toContain(`"id": "${l.id}"`);
  });
});
