import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { it } from 'vitest';
import { findWords } from './i18n-scan';
const ROOT = join(__dirname, '..');
function sources(dir: string): string[] { const out: string[] = []; for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) out.push(...sources(p)); else if (/\.(ts|tsx)$/.test(n) && !n.endsWith('.d.ts')) out.push(p); } return out; }
it('reports', () => {
  const report: Record<string, { line: number; text: string }[]> = {};
  for (const f of sources(join(ROOT, 'src'))) {
    const rel = relative(ROOT, f);
    if (rel.startsWith('src/locales')) continue;
    const hits = findWords(rel, readFileSync(f, 'utf8'));
    if (hits.length) report[rel] = hits;
  }
  writeFileSync('/tmp/oak-i18n2/report.json', JSON.stringify(report, null, 1));
  const total = Object.values(report).reduce((n, h) => n + h.length, 0);
  console.log('TOTAL', total, 'FILES', Object.keys(report).length);
});
