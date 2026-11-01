import { describe, expect, it } from 'vitest';
import {
  appendBounded,
  diagnosticsText,
  DIAGNOSTICS_MAX_CHARS,
  formatLogLine,
  logTail,
  redactHome,
  type DiagnosticsFacts,
} from '../src/core/log';

const AT = '2026-10-31T21:00:00.000Z';

describe('redactHome', () => {
  it('takes the home directory out, by either separator', () => {
    expect(redactHome('at /Users/ada/pulp/out/main/index.js:12', '/Users/ada')).toBe('at ~/pulp/out/main/index.js:12');
    expect(redactHome('at C:\\Users\\Ada\\pulp\\x.js', 'C:\\Users\\Ada')).toBe('at ~\\pulp\\x.js');
    // A Windows path written with forward slashes is the same home.
    expect(redactHome('at C:/Users/Ada/pulp/x.js', 'C:\\Users\\Ada')).toBe('at ~/pulp/x.js');
  });

  it('leaves the line alone when there is no home to take out', () => {
    expect(redactHome('plain line', undefined)).toBe('plain line');
    expect(redactHome('plain line', '/')).toBe('plain line');
    expect(redactHome('/opt/pulp/x.js', '/Users/ada')).toBe('/opt/pulp/x.js');
  });
});

describe('formatLogLine', () => {
  it('writes one line: when, how serious, who said it and what', () => {
    expect(formatLogLine({ at: AT, level: 'error', source: 'window', message: 'it broke' })).toBe(`${AT} ERROR [window] it broke`);
  });

  it('keeps a stack on the one line, and takes the home directory out of it', () => {
    const line = formatLogLine(
      { at: AT, level: 'crash', source: 'main', message: 'ENOENT', detail: 'Error: ENOENT\n    at /Users/ada/pulp/x.js:1' },
      '/Users/ada',
    );
    expect(line.includes('\n'), 'one entry is one line').toBe(false);
    expect(line).toContain('CRASH [main] ENOENT');
    expect(line).toContain('~/pulp/x.js:1');
    expect(line).not.toContain('/Users/ada');
  });
});

describe('appendBounded', () => {
  it('adds a line and ends the file with a newline', () => {
    expect(appendBounded('', 'one')).toBe('one\n');
    expect(appendBounded('one\n', 'two')).toBe('one\ntwo\n');
  });

  it('drops whole lines from the front rather than letting the file grow', () => {
    // Six lines of nine characters, each costing ten bytes with its newline, into a budget of 33:
    // the three newest fit and the rest go.
    let file = '';
    for (const n of ['aaaaaaaaa', 'bbbbbbbbb', 'ccccccccc', 'ddddddddd', 'eeeeeeeee', 'fffffffff']) file = appendBounded(file, n, 33);
    expect(file).toBe('ddddddddd\neeeeeeeee\nfffffffff\n');
  });

  it('cuts a single line that is bigger than the whole budget', () => {
    const huge = 'x'.repeat(500);
    const out = appendBounded('kept\n', huge, 100);
    expect(out.length).toBe(100);
    expect(out.endsWith('\n')).toBe(true);
  });
});

describe('logTail', () => {
  it('gives the newest lines last, and nothing for an empty log', () => {
    expect(logTail('a\nb\nc\n', 2)).toEqual(['b', 'c']);
    expect(logTail('')).toEqual([]);
  });
});

describe('diagnosticsText', () => {
  const facts = (over: Partial<DiagnosticsFacts> = {}): DiagnosticsFacts => ({
    at: AT,
    platform: 'darwin',
    version: '0.1.0',
    ffmpeg: '8.0 at /opt/bin/ffmpeg',
    library: '355 templates, 0 media, 0 problems',
    roots: ['/Users/ada/Clips'],
    background: '0 thumbnails, 0 probes, 0 waiting',
    renderCache: '3 files, 12 MB of 2048 MB',
    project: 'Untitled (not saved)',
    renders: 2,
    logPath: '/Users/ada/Library/Application Support/Pulp/logs/pulp.log',
    logTail: [`${AT} ERROR [window] it broke`],
    ...over,
  });

  it('says what Pulp knows, the log file and its last lines', () => {
    const text = diagnosticsText(facts());
    expect(text).toContain('Pulp diagnostics — 2026-10-31');
    expect(text).toContain('Version: 0.1.0');
    expect(text).toContain('Platform: darwin');
    expect(text).toContain('Render cache: 3 files');
    expect(text).toContain('Last 1 log line:');
    expect(text).toContain('ERROR [window] it broke');
  });

  it('takes the home directory out of every path it carries', () => {
    const text = diagnosticsText(facts(), '/Users/ada');
    expect(text).not.toContain('/Users/ada');
    expect(text).toContain('~/Clips');
    expect(text).toContain('~/Library/Application Support/Pulp/logs/pulp.log');
  });

  it('says so plainly when nothing has been logged, and when there are no roots', () => {
    const text = diagnosticsText(facts({ logTail: [], roots: [] }));
    expect(text).toContain('Log: nothing recorded this session.');
    expect(text).toContain('Roots: none');
  });

  it('is bounded, so a long log cannot outgrow what the clipboard is given', () => {
    const text = diagnosticsText(facts({ logTail: Array.from({ length: 200 }, (_, i) => `${AT} ERROR [window] line ${i} ${'x'.repeat(200)}`) }));
    expect(text.length).toBeLessThanOrEqual(DIAGNOSTICS_MAX_CHARS);
    expect(text.endsWith('… (truncated)')).toBe(true);
  });
});
