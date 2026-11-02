/**
 * Renders that outlive the app (milestone 58): the staged name a render
 * writes to until it is whole, and the ledger the queue keeps of what it was
 * in the middle of.
 */

import { describe, expect, it } from 'vitest';
import { EMPTY_LEDGER, interruptedFiles, parseLedger, serializeLedger, stagedOutputPath, withJob, withoutJob, type InterruptedRender } from '../src/core/render-recovery';

describe('the staged output name', () => {
  it('puts .partial before the extension, and leaves a sequence pattern alone', () => {
    expect(stagedOutputPath('/out/show.mp4')).toBe('/out/show.partial.mp4');
    expect(stagedOutputPath('C:\\out\\show.title.mov')).toBe('C:\\out\\show.title.partial.mov');
    expect(stagedOutputPath('/out/noext')).toBe('/out/noext.partial');
    expect(stagedOutputPath('/out.d/noext')).toBe('/out.d/noext.partial');
    expect(stagedOutputPath('/out/seq_%05d.png')).toBe('/out/seq_%05d.png');
  });
});

describe('the ledger', () => {
  const job: InterruptedRender = {
    templateId: 'pulp.samples.lower-third-bar', presetId: 'h264-mp4', outputPath: '/out/a.mp4', params: { name: 'Ada' },
    options: { fps: 30 }, totalFrames: 300, firstFrame: 0, startedAt: '2026-11-02T10:00:00.000Z', label: 'Lower Third Bar',
  };

  it('round-trips, keeps one job per output, and drops a finished one', () => {
    const two = withJob(withJob(EMPTY_LEDGER, job), { ...job, outputPath: '/out/b.mov', presetId: 'prores-4444' });
    expect(parseLedger(serializeLedger(two))).toEqual(two);
    // The same output again replaces rather than doubles.
    expect(withJob(two, { ...job, params: { name: 'Grace' } }).jobs.map((j) => j.outputPath)).toEqual(['/out/b.mov', '/out/a.mp4']);
    expect(withoutJob(two, '/out/a.mp4').jobs.map((j) => j.outputPath)).toEqual(['/out/b.mov']);
  });

  it('reads anything at all, keeping only what could be rendered again', () => {
    expect(parseLedger('not json')).toEqual(EMPTY_LEDGER);
    expect(parseLedger('{"jobs": 3}')).toEqual(EMPTY_LEDGER);
    const read = parseLedger(JSON.stringify({ jobs: [
      { presetId: 'h264-mp4', outputPath: '/out/x.mp4' },
      { mediaId: 'abc', presetId: 'h264-mp4', outputPath: '/out/y.mp4', totalFrames: 12.7, firstFrame: -1 },
      { templateId: 't', presetId: 'png-sequence', outputPath: '' },
    ] }));
    expect(read.jobs).toHaveLength(1);
    expect(read.jobs[0]).toMatchObject({ mediaId: 'abc', totalFrames: 12, firstFrame: 0, params: {}, label: '/out/y.mp4' });
  });

  it('names the files a killed render may have left: the staged file, or a sequence\'s frames', () => {
    expect(interruptedFiles(job, false)).toEqual(['/out/a.partial.mp4']);
    expect(interruptedFiles({ ...job, outputPath: '/out/s_%05d.png', totalFrames: 3, firstFrame: 10 }, true))
      .toEqual(['/out/s_00010.png', '/out/s_00011.png', '/out/s_00012.png']);
  });
});
