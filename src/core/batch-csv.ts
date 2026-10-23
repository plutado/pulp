/**
 * Batch rendering from CSV: one render per row, each row a set of parameter
 * values. Pure. Column headers match a parameter's id or label, ignoring
 * case; a column named name, file, filename or output that is not a
 * parameter names the job and the output file; unknown columns are reported
 * so the user sees them before anything is queued.
 */

import type { TemplateManifest } from './manifest';

export interface BatchRow {
  /** 1-based row number in the CSV, excluding the header. */
  row: number;
  /** Shown in the queue: from the name column, else the first text parameter, else the row number. */
  label: string;
  /** Output file name without extension, unique within the batch. */
  fileName: string;
  params: Record<string, unknown>;
}

export interface BatchPlan {
  /** CSV header to parameter id, for the columns that matched. */
  columns: { header: string; paramId: string }[];
  /** The column used for job and file names, if any. */
  nameColumn?: string;
  unknownColumns: string[];
  rows: BatchRow[];
  /** Human-readable, shown before queuing. */
  warnings: string[];
}

const NAME_HEADERS = new Set(['name', 'file', 'filename', 'output']);

/** RFC 4180 style: commas, double quotes (doubled to escape), newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** A safe file name: no path separators or reserved characters, trimmed, bounded. */
export function safeFileName(text: string, fallback: string): string {
  const cleaned = Array.from(text, (ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '-' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}

export function planBatch(manifest: Pick<TemplateManifest, 'parameters'>, csv: string): BatchPlan {
  const plan: BatchPlan = { columns: [], unknownColumns: [], rows: [], warnings: [] };
  const table = parseCsv(csv);
  if (table.length === 0) {
    plan.warnings.push('The CSV is empty.');
    return plan;
  }
  const headers = table[0]!.map((h) => h.trim());
  const byKey = new Map<string, string>();
  for (const p of manifest.parameters) {
    byKey.set(p.id.toLowerCase(), p.id);
    byKey.set(p.label.trim().toLowerCase(), p.id);
  }
  let nameIndex = -1;
  const columnIds: (string | null)[] = headers.map((h, i) => {
    const key = h.toLowerCase();
    const id = byKey.get(key);
    if (id) {
      plan.columns.push({ header: h, paramId: id });
      return id;
    }
    if (nameIndex === -1 && NAME_HEADERS.has(key)) {
      nameIndex = i;
      plan.nameColumn = h;
      return null;
    }
    if (h !== '') plan.unknownColumns.push(h);
    return null;
  });
  if (plan.columns.length === 0) plan.warnings.push('No column matches a parameter id or label of this template.');
  if (plan.unknownColumns.length > 0) {
    plan.warnings.push(`Unknown column${plan.unknownColumns.length > 1 ? 's' : ''} ignored: ${plan.unknownColumns.join(', ')}.`);
  }
  const firstText = manifest.parameters.find((p) => p.type === 'text' && columnIds.includes(p.id))?.id;
  if (table.length === 1) plan.warnings.push('The CSV has a header but no rows.');

  const used = new Map<string, number>();
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const params: Record<string, unknown> = {};
    columnIds.forEach((id, i) => {
      const v = cells[i];
      if (id && v !== undefined && v.trim() !== '') params[id] = v;
    });
    const rawName = nameIndex >= 0 ? cells[nameIndex]?.trim() : firstText ? String(params[firstText] ?? '').trim() : '';
    const label = rawName || `Row ${r}`;
    let fileName = safeFileName(label, `row-${r}`);
    const count = used.get(fileName.toLowerCase()) ?? 0;
    used.set(fileName.toLowerCase(), count + 1);
    if (count > 0) fileName = `${fileName}-${count + 1}`;
    plan.rows.push({ row: r, label, fileName, params });
  }
  return plan;
}
