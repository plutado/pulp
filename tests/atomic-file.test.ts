import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../src/core/atomic-file';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pulp-atomic-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('writeFileAtomic', () => {
  it('writes the content, creates folders, and leaves no temporary file behind', async () => {
    const file = join(dir, 'deep', 'settings.json');
    await writeFileAtomic(file, '{"a":1}\n');
    expect(await readFile(file, 'utf8')).toBe('{"a":1}\n');
    expect(await readdir(join(dir, 'deep'))).toEqual(['settings.json']);
  });

  it('replaces an existing file whole', async () => {
    const file = join(dir, 'f.json');
    await writeFileAtomic(file, JSON.stringify({ v: 1, pad: 'x'.repeat(10_000) }));
    await writeFileAtomic(file, JSON.stringify({ v: 2 }));
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ v: 2 });
  });

  it('never lets a reader see a partial file while many writes race', async () => {
    const file = join(dir, 'f.json');
    const big = 'y'.repeat(200_000);
    const writes = Array.from({ length: 20 }, (_, i) => writeFileAtomic(file, JSON.stringify({ i, big })));
    let reads = 0;
    const reader = (async () => {
      while (reads < 200) {
        try {
          const text = await readFile(file, 'utf8');
          const parsed = JSON.parse(text) as { i: number; big: string };
          expect(parsed.big).toBe(big);
          reads += 1;
        } catch (err) {
          // Only "not there yet" is acceptable; a parse error would mean a partial file was visible.
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
      }
    })();
    await Promise.all(writes);
    await reader;
    const final = JSON.parse(await readFile(file, 'utf8')) as { i: number };
    expect(final.i).toBeGreaterThanOrEqual(0);
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('cleans up its temporary file when the write cannot complete', async () => {
    // Writing "into" a path whose parent is a file cannot succeed.
    const blocker = join(dir, 'blocker');
    await writeFileAtomic(blocker, 'x');
    await expect(writeFileAtomic(join(blocker, 'child.json'), 'y')).rejects.toThrow();
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});
