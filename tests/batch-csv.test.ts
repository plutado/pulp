import { describe, expect, it } from 'vitest';
import { parseCsv, planBatch, safeFileName } from '../src/core/batch-csv';
import { parseManifest } from '../src/core/manifest';
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

  it('warns about empty input, no matching columns and no rows', () => {
    expect(planBatch(manifest, '').warnings).toEqual(['The CSV is empty.']);
    expect(planBatch(manifest, 'foo,bar\n1,2').warnings).toEqual(['No column matches a parameter id or label of this template.', 'Unknown columns ignored: foo, bar.']);
    expect(planBatch(manifest, 'title\n').warnings).toEqual(['The CSV has a header but no rows.']);
  });

  it('safeFileName', () => {
    expect(safeFileName('  Breaking: "News" <live>  ', 'x')).toBe('Breaking- -News- -live-');
    expect(safeFileName('...', 'row-3')).toBe('row-3');
    expect(safeFileName('a'.repeat(100), 'x')).toHaveLength(80);
  });
});
