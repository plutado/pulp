import { describe, expect, it } from 'vitest';
import { dragFileFor, queueCard } from '../src/core/queue-card';
import type { RenderQueueJob } from '../src/core/render-queue';

const job = (over: Partial<RenderQueueJob> = {}): RenderQueueJob => ({
  id: 7,
  templateId: 'pulp.samples.lower-third-bar',
  templateName: 'Lower Third Bar',
  presetId: 'prores-4444',
  outputPath: '/Users/dana/Movies/lower-third-bar.mov',
  totalFrames: 180,
  status: 'done',
  frame: 180,
  warnings: [],
  ...over,
});

describe('what a card shows', () => {
  it('names the item and badges the preset, never the file', () => {
    const card = queueCard(job());
    expect(card.name).toBe('Lower Third Bar');
    expect(card.preset).toBe('ProRes 4444 (alpha)');
    expect(card.status.text).toBe('Done · 180 frames');
    // The path is reachable, but not by reading the card.
    expect(card.file).toBe('/Users/dana/Movies/lower-third-bar.mov');
    expect(card.tip).toContain('/Users/dana/Movies/lower-third-bar.mov');
    expect(card.draggable).toBe(true);
  });

  it('uses the job label where there is one, as a batch row has', () => {
    expect(queueCard(job({ label: 'Lower Third Bar · Alex' })).name).toBe('Lower Third Bar · Alex');
  });

  it('says where a render has got to', () => {
    expect(queueCard(job({ status: 'queued', frame: 0 })).status).toEqual({ kind: 'queued', text: 'Queued · 180 frames' });
    expect(queueCard(job({ status: 'running', frame: 90 })).status).toEqual({ kind: 'running', text: 'Frame 90 of 180', progress: 0.5 });
    expect(queueCard(job({ status: 'cancelled' })).status.text).toBe('Cancelled');
    // A failure is the one place detail beats brevity: it has to be actionable.
    expect(queueCard(job({ status: 'failed', message: 'ffmpeg exited with 1' })).status.text).toBe('ffmpeg exited with 1');
    expect(queueCard(job({ status: 'failed', message: undefined })).status.text).toBe('The render did not finish.');
  });

  it('counts warnings on the card and spells them out in the tooltip', () => {
    const card = queueCard(job({ warnings: ['Odd size rounded up'] }));
    expect(card.status.text).toBe('Done · 180 frames · 1 warning');
    expect(card.tip).toContain('Odd size rounded up');
    expect(queueCard(job({ warnings: ['a', 'b'] })).status.text).toContain('2 warnings');
  });

  it('is draggable only once there is a file', () => {
    for (const status of ['queued', 'running', 'failed', 'cancelled'] as const) {
      const card = queueCard(job({ status }));
      expect(card.draggable, status).toBe(false);
      expect(card.file, status).toBeUndefined();
    }
  });

  it('drags a sequence as its first frame, which is how an editor imports the rest', () => {
    expect(dragFileFor(job({ output: '/out/x.mov', outputPath: '/out/x.mov' }))).toBe('/out/x.mov');
    expect(dragFileFor(job({ output: '/out/x_%05d.png' }))).toBe('/out/x_00000.png');
    expect(dragFileFor(job({ output: '/out/x_%05d.png', firstFrame: 60 }))).toBe('/out/x_00060.png');
    expect(queueCard(job({ output: '/out/x_%05d.png', firstFrame: 60 })).file).toBe('/out/x_00060.png');
  });
});
