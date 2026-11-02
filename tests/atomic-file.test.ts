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

describe('a process killed mid-write (milestone 58)', () => {
  it('leaves the target whole — the old file or the new one — never a mix', async () => {
    // A child writes the same file over and over, each write a fresh 4 MB payload that says which
    // write it is in every byte; it is killed with no warning a moment in. Whatever write it was
    // inside, the file on disk is one complete payload.
    const target = join(dir, 'project.pulp');
    const script = join(dir, 'writer.mjs');
    const atomic = new URL('../src/core/atomic-file.ts', import.meta.url).pathname;
    const { writeFile } = await import('node:fs/promises');
    await writeFile(script, `
      import { writeFileAtomic } from ${JSON.stringify(atomic)};
      let n = 0;
      for (;;) {
        n += 1;
        await writeFileAtomic(${JSON.stringify(target)}, Buffer.alloc(4 * 1024 * 1024, String(n % 10)));
        if (n === 1) process.stdout.write('first\\n');
      }
    `);
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((resolve) => child.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes('first')) resolve(); }));
    // Some writes later, mid-whatever: SIGKILL gives nothing a chance to clean up.
    await new Promise((r) => setTimeout(r, 120));
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));
    const data = await readFile(target);
    expect(data.length, 'a whole payload').toBe(4 * 1024 * 1024);
    const digit = data[0]!;
    expect(data.every((b) => b === digit), 'every byte from the same write').toBe(true);
  }, 30_000);
});
