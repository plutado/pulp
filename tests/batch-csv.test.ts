import { describe, expect, it } from 'vitest';
import { parseCsv, planBatch, safeFileName } from '../src/core/batch-csv';
import { parseManifest, validateManifest } from '../src/core/manifest';
import { rawManifest } from './fixtures';

const manifest = (() => {
  const r = parseManifest(JSON.stringify(rawManifest()));
  if (!r.ok) throw new Error('fixture manifest invalid');
  return r.manifest;
})();

describe('parseCsv', () => {
  it('handles quotes, embedded commas and newlines, CRLF and a BOM', () => {
    expect(parseCsv('a,b\r\n1,"two, 2"\n"multi\nline","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['1', 'two, 2'],
      ['multi\nline', 'say "hi"'],
    ]);
    expect(parseCsv('﻿name\nx')).toEqual([['name'], ['x']]);
    expect(parseCsv('a,b\n\n , \n')).toEqual([['a', 'b']]); // blank rows dropped
    expect(parseCsv('')).toEqual([]);
  });
});

describe('planBatch', () => {
  it('matches headers to ids or labels ignoring case, names from the name column, warns on unknown columns', () => {
    const plan = planBatch(manifest, 'Name,TITLE,Size,Mood\nAlex,Hello Alex,60,happy\nSam,Hello Sam,,sad\n');
    expect(plan.columns).toEqual([
      { header: 'TITLE', paramId: 'title' },
      { header: 'Size', paramId: 'size' },
    ]);
    expect(plan.nameColumn).toBe('Name');
    expect(plan.unknownColumns).toEqual(['Mood']);
    expect(plan.warnings).toEqual(['Unknown column ignored: Mood.']);
    expect(plan.rows).toEqual([
      { row: 1, label: 'Alex', fileName: 'Alex', params: { title: 'Hello Alex', size: '60' } },
      { row: 2, label: 'Sam', fileName: 'Sam', params: { title: 'Hello Sam' } },
    ]);
  });

  it('falls back to the first text parameter, then the row number, and keeps file names unique and safe', () => {
    const plan = planBatch(manifest, 'title\nA/B: C?\nA/B: C?\n\n');
    expect(plan.nameColumn).toBeUndefined();
    expect(plan.rows.map((r) => [r.label, r.fileName])).toEqual([
      ['A/B: C?', 'A-B- C-'],
      ['A/B: C?', 'A-B- C--2'],
    ]);
    const numbered = planBatch(manifest, 'size\n10\n20');
    expect(numbered.rows.map((r) => r.label)).toEqual(['Row 1', 'Row 2']);
    expect(numbered.rows.map((r) => r.fileName)).toEqual(['Row 1', 'Row 2']);
  });

  it('a column may name a video layer: each row plays its own clip (milestone 26)', () => {
    const withVideo = validateManifest(
      rawManifest({
        blocks: [{ id: 'stack', label: 'Stack', box: { x: 0, y: 0, width: 1, height: 1 }, layers: [
          { id: 'who', type: 'text', label: 'Who', text: 'Alex' },
          { id: 'plate', type: 'video', label: 'Plate' },
        ] }],
      }),
    );
    if (!withVideo.ok) throw new Error('fixture');
    const plan = planBatch(withVideo.manifest, 'Who,Plate\nSam,abc123\nKim,"def456 ending=once delay=0.5"\nJo,\n');
    expect(plan.columns).toEqual([
      { header: 'Who', paramId: 'who', layer: { block: 'stack', id: 'who', type: 'text' } },
      { header: 'Plate', paramId: 'plate', layer: { block: 'stack', id: 'plate', type: 'video' } },
    ]);
    expect(plan.warnings).toEqual([]);
    const clips = plan.rows.map((r) => (r.params['@layers'] as { stack: { id: string; clip?: unknown }[] }).stack.find((l) => l.id === 'plate')?.clip);
    expect(clips[0]).toMatchObject({ id: 'abc123', ending: 'loop' });
    expect(clips[1]).toMatchObject({ id: 'def456', ending: 'once', delay: 0.5 });
    // An empty cell leaves the layer as the template has it, rather than clearing the clip.
    expect(clips[2]).toBeNull();
    // Rows are named from the words, never from a clip id.
    expect(plan.rows.map((r) => r.label)).toEqual(['Sam', 'Kim', 'Jo']);
  });

  it('a column may name a text layer: the row carries the template\'s stack with that layer\'s words changed', () => {
    const withBlock = validateManifest(
      rawManifest({
        parameters: [{ id: 'size', type: 'number', label: 'Size', default: 50 }],
        blocks: [{ id: 'strap', label: 'Strap', box: { x: 0, y: 0, width: 1, height: 1 }, layers: [
          { id: 'name', type: 'text', label: 'Name', text: 'Alex', required: true },
          { id: 'title', type: 'text', label: 'Title', text: 'Editor' },
        ] }],
      }),
    );
    if (!withBlock.ok) throw new Error('fixture');
    const plan = planBatch(withBlock.manifest, 'Name,TITLE,size\nSam Lee,Producer,40\nKim,,\n');
    expect(plan.columns).toEqual([
      { header: 'Name', paramId: 'name', layer: { block: 'strap', id: 'name', type: 'text' } },
      { header: 'TITLE', paramId: 'title', layer: { block: 'strap', id: 'title', type: 'text' } },
      { header: 'size', paramId: 'size' },
    ]);
    expect(plan.warnings).toEqual([]);
    // The stack travels whole, so the unchanged title keeps the template's words; the row is named by the first layer column.
    const stacks = plan.rows.map((r) => (r.params['@layers'] as { strap: { id: string; text: string }[] }).strap.map((l) => `${l.id}=${l.text}`));
    expect(stacks).toEqual([['name=Sam Lee', 'title=Producer'], ['name=Kim', 'title=Editor']]);
    expect(plan.rows.map((r) => [r.label, r.params.size])).toEqual([['Sam Lee', '40'], ['Kim', undefined]]);
  });

  it('warns about empty input, no matching columns and no rows', () => {
    expect(planBatch(manifest, '').warnings).toEqual(['The CSV is empty.']);
    expect(planBatch(manifest, 'foo,bar\n1,2').warnings).toEqual(['No column matches a parameter or a layer of this template.', 'Unknown columns ignored: foo, bar.']);
    expect(planBatch(manifest, 'title\n').warnings).toEqual(['The CSV has a header but no rows.']);
  });

  it('safeFileName', () => {
    expect(safeFileName('  Breaking: "News" <live>  ', 'x')).toBe('Breaking- -News- -live-');
    expect(safeFileName('...', 'row-3')).toBe('row-3');
    expect(safeFileName('a'.repeat(100), 'x')).toHaveLength(80);
  });
});

describe('a layer\'s settings column (milestone 28)', () => {
  const withBlock = (() => {
    const r = validateManifest(
      rawManifest({
        blocks: [{ id: 'strap', label: 'Strap', box: { x: 0, y: 0, width: 1, height: 1 }, open: true, layers: [
          { id: 'name', type: 'text', label: 'Name', text: 'Alex' },
          { id: 'mark', type: 'image', label: 'Mark' },
        ] }],
      }),
    );
    if (!r.ok) throw new Error('fixture');
    return r.manifest;
  })();

  it('carries a layer\'s span, transitions and look as JSON, beside its words', () => {
    const csv = 'Name,Name settings,mark settings\nSam,"{""span"":{""start"":2,""end"":4},""look"":{""opacity"":0.5}}","{""look"":{""corners"":0.02}}"\nKim,,\n';
    const plan = planBatch(withBlock, csv);
    expect(plan.columns).toEqual([
      { header: 'Name', paramId: 'name', layer: { block: 'strap', id: 'name', type: 'text' } },
      { header: 'Name settings', paramId: 'name', layer: { block: 'strap', id: 'name', type: 'text', settings: true } },
      { header: 'mark settings', paramId: 'mark', layer: { block: 'strap', id: 'mark', type: 'image', settings: true } },
    ]);
    expect(plan.warnings).toEqual([]);
    const stacks = plan.rows.map((r) => (r.params['@layers'] as { strap: Record<string, unknown>[] }).strap);
    expect(stacks[0]![0]).toMatchObject({ id: 'name', text: 'Sam', span: { start: 2, end: 4 }, look: { opacity: 0.5 } });
    expect(stacks[0]![1]).toMatchObject({ id: 'mark', look: { corners: 0.02 } });
    // An empty cell leaves the layer as the template has it; the words still name the row.
    expect(stacks[1]![0]).not.toHaveProperty('span');
    expect(plan.rows.map((r) => r.label)).toEqual(['Sam', 'Kim']);
  });

  it('says when a settings cell is not JSON, and leaves the layer alone', () => {
    const plan = planBatch(withBlock, 'Name settings\nlater\n[1]\n');
    expect(plan.warnings).toEqual(['Row 1: "name settings" is not a JSON object; ignored.', 'Row 2: "name settings" is not a JSON object; ignored.']);
    expect(plan.rows.map((r) => r.params['@layers'])).toEqual([undefined, undefined]);
  });
});
