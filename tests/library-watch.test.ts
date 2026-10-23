import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { watchRoot } from '../src/core/library-watch';

describe('watchRoot', () => {
  it('reports a change once per quiet period, or is absent where recursive watching is unsupported', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulp-watch-'));
    let changes = 0;
    const watcher = watchRoot(dir, () => (changes += 1), 200);
    try {
      if (!watcher) {
        console.info(`recursive fs.watch not supported on ${process.platform} ${process.version}; watcher absent.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 100)); // let the watcher attach
      await writeFile(join(dir, 'a.mov'), 'x');
      await writeFile(join(dir, 'b.mov'), 'y');
      await new Promise((r) => setTimeout(r, 1200));
      expect(changes).toBe(1);
    } finally {
      watcher?.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);
});
