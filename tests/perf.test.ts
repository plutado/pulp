/**
 * The Performance section of Copy diagnostics (milestone 58): the record a
 * repeated timing keeps, and the lines the facts become.
 */

import { describe, expect, it } from 'vitest';
import { performanceLines, TimingRecord, type MainPerformance, type WindowPerformance } from '../src/core/perf';
import { diagnosticsText, type DiagnosticsFacts } from '../src/core/log';

const main: MainPerformance = {
  library: { templates: 358, media: 100_000, problems: 2 },
  lastScan: { visited: 100_358, loaded: 12, kept: 100_346, removed: 0, ms: 1771.4 },
  indexMs: 330.6,
  indexBytes: 49_751_677,
  memory: { mainHeapMB: 452.6, processes: [{ type: 'Browser', workingSetMB: 512.2 }, { type: 'Tab', workingSetMB: 388.9 }, { type: 'GPU', workingSetMB: 120.1 }] },
  uptimeSeconds: 3604.2,
};
const window: WindowPerformance = {
  searchMs: { last: 68.1, max: 112.4, count: 23 },
  windowMs: { last: 0.3, max: 2.1, count: 410 },
  receiveMs: { last: 190, max: 190, count: 1 },
  rendererHeapMB: 388.9,
};

describe('a repeated timing', () => {
  it('keeps the last, the worst and the count, and ignores what is not a time', () => {
    const t = new TimingRecord();
    expect(t.value()).toBeNull();
    t.record(12.345);
    t.record(3);
    t.record(Number.NaN);
    t.record(-1);
    expect(t.value()).toEqual({ last: 3, max: 12.35, count: 2 });
  });
});

describe('the Performance lines', () => {
  it('say how much there is, how long it took to know, how the window feels and what it weighs', () => {
    const lines = performanceLines(main, window);
    expect(lines).toEqual([
      'Library size: 100358 items (358 templates, 100000 media, 2 problems)',
      'Last scan: 1771 ms (100358 visited, 12 loaded, 100346 kept, 0 removed)',
      'Index: built in 331 ms, 50 MB as sent to the window',
      'Search per keystroke: last 68 ms, worst 112 ms over 23',
      'Results window per scroll: last 0 ms, worst 2 ms over 410',
      'Index received by the window: last 190 ms, worst 190 ms over 1',
      'Memory: main heap 453 MB, window heap 389 MB; processes: Browser 512 MB, Tab 389 MB, GPU 120 MB',
      'Up for: 3604 s',
    ]);
  });

  it('say so when nothing has been measured yet', () => {
    const lines = performanceLines(
      { ...main, lastScan: null, memory: { mainHeapMB: 10, processes: [] } },
      { searchMs: null, windowMs: null, receiveMs: null, rendererHeapMB: null },
    );
    expect(lines[1]).toBe('Last scan: none this session');
    expect(lines[3]).toBe('Search per keystroke: not yet');
    expect(lines[6]).toBe('Memory: main heap 10 MB, window heap unknown; processes: unknown');
  });

  it('sit in the diagnostics text under their own heading, before the log', () => {
    const facts: DiagnosticsFacts = {
      at: '2026-11-02T10:00:00.000Z', platform: 'darwin', version: '0.1.0', ffmpeg: '9.0.2', library: '100358 items', roots: [],
      background: 'idle', renderCache: 'empty', project: 'Untitled (not saved)', renders: 0, logPath: '/tmp/pulp.log',
      logTail: ['2026-11-02T10:00:00.000Z ERROR [window] it broke'],
      performance: performanceLines(main, window),
    };
    const text = diagnosticsText(facts);
    expect(text).toContain('\nPerformance:\n  Library size: 100358 items');
    expect(text.indexOf('Performance:')).toBeLessThan(text.indexOf('Last 1 log line:'));
    // Without the section, the text is as it was.
    expect(diagnosticsText({ ...facts, performance: undefined })).not.toContain('Performance:');
  });
});
