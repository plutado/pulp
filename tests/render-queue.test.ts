import { describe, expect, it, vi } from 'vitest';
import { isFinished, RenderQueue, type RenderQueueSnapshot } from '../src/core/render-queue';

const job = (n: number) => ({
  templateId: `t.${n}`,
  templateName: `Template ${n}`,
  presetId: 'prores-4444',
  outputPath: `/out/${n}.mov`,
  totalFrames: 30,
});

describe('RenderQueue', () => {
  it('runs jobs one at a time in the order they were added', () => {
    const q = new RenderQueue();
    const a = q.add(job(1));
    const b = q.add(job(2));
    expect(a.id).toBe(1);
    expect(b.status).toBe('queued');

    expect(q.startNext()?.id).toBe(a.id);
    expect(q.startNext()).toBeNull();
    expect(q.running()?.id).toBe(a.id);

    q.finish(a.id, { ok: true, output: '/out/1.mov', frames: 30, warnings: ['w'] });
    expect(q.startNext()?.id).toBe(b.id);
    expect(q.startNext()).toBeNull();
    q.finish(b.id, { ok: false, message: 'boom' });
    expect(q.startNext()).toBeNull();

    const [first, second] = q.snapshot().jobs;
    expect(first).toMatchObject({ status: 'done', frame: 30, output: '/out/1.mov', warnings: ['w'] });
    expect(second).toMatchObject({ status: 'failed', message: 'boom' });
  });

  it('tracks progress only for the running job, clamped to the frame count', () => {
    const q = new RenderQueue();
    const a = q.add(job(1));
    q.progress(a.id, 5);
    expect(q.snapshot().jobs[0]?.frame).toBe(0);
    q.startNext();
    q.progress(a.id, 12);
    expect(q.snapshot().jobs[0]?.frame).toBe(12);
    q.progress(a.id, 99);
    expect(q.snapshot().jobs[0]?.frame).toBe(30);
  });

  it('cancels a queued job itself and hands a running one back to the caller', () => {
    const q = new RenderQueue();
    const a = q.add(job(1));
    const b = q.add(job(2));
    q.startNext();
    expect(q.cancel(a.id)).toBe('running');
    expect(q.snapshot().jobs[0]?.status).toBe('running');
    expect(q.cancel(b.id)).toBe('cancelled');
    expect(q.snapshot().jobs[1]).toMatchObject({ status: 'cancelled', message: 'Cancelled before it started.' });
    expect(q.cancel(b.id)).toBe('ignored');
    expect(q.cancel(42)).toBe('ignored');

    q.finish(a.id, { ok: false, cancelled: true, message: 'Render cancelled.' });
    expect(q.snapshot().jobs[0]).toMatchObject({ status: 'cancelled', message: 'Render cancelled.' });
    // Nothing left to start: the queued job was cancelled.
    expect(q.startNext()).toBeNull();
  });

  it('ignores finish and progress for jobs that are not running', () => {
    const q = new RenderQueue();
    const a = q.add(job(1));
    q.finish(a.id, { ok: true, output: '/x', frames: 30, warnings: [] });
    expect(q.snapshot().jobs[0]?.status).toBe('queued');
    q.startNext();
    q.finish(a.id, { ok: true, output: '/x', frames: 30, warnings: [] });
    q.finish(a.id, { ok: false, message: 'late' });
    expect(q.snapshot().jobs[0]).toMatchObject({ status: 'done', output: '/x' });
  });

  it('clears finished jobs and keeps queued and running ones', () => {
    const q = new RenderQueue();
    const a = q.add(job(1));
    const b = q.add(job(2));
    const c = q.add(job(3));
    const d = q.add(job(4));
    q.startNext();
    q.finish(a.id, { ok: true, output: '/x', frames: 30, warnings: [] });
    q.startNext();
    q.cancel(c.id);
    q.clearFinished();
    expect(q.snapshot().jobs.map((j) => [j.id, j.status])).toEqual([
      [b.id, 'running'],
      [d.id, 'queued'],
    ]);
    expect(q.snapshot().jobs.map(isFinished)).toEqual([false, false]);
  });

  it('reports every change through onChange with detached snapshots', () => {
    const seen: RenderQueueSnapshot[] = [];
    const onChange = vi.fn((s: RenderQueueSnapshot) => seen.push(s));
    const q = new RenderQueue(onChange);
    const a = q.add(job(1));
    q.startNext();
    q.progress(a.id, 3);
    q.finish(a.id, { ok: true, output: '/x', frames: 30, warnings: [] });
    q.clearFinished();
    q.clearFinished(); // nothing to remove, no change
    expect(onChange).toHaveBeenCalledTimes(5);
    expect(seen.map((s) => s.jobs[0]?.status ?? 'empty')).toEqual(['queued', 'running', 'running', 'done', 'empty']);
    // Mutating a snapshot does not reach the queue.
    seen[0]!.jobs[0]!.status = 'failed';
    expect(seen[1]!.jobs[0]!.status).toBe('running');
  });
});
