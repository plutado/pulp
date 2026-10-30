import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { latestRelease } from '../src/core/changelog';

const sample = `# Changelog

## [Unreleased]

### Added

- Something not yet shipped.

## [0.2.0] - 2026-11-01

### Added

- A start screen with examples and recent projects. It also has a tour.
- Wrapped bullets continue
  onto the next line.

### Fixed

- A [link](https://example.com) reads as its text, and *emphasis* is unwrapped.

## [0.1.0] - 2026-10-18

### Added

- The first release.
`;

describe("what's new reads the changelog (milestone 31)", () => {
  it('takes the newest released version, not Unreleased', () => {
    const notes = latestRelease(sample)!;
    expect(notes.version).toBe('0.2.0');
    expect(notes.date).toBe('2026-11-01');
    expect(notes.sections.map((s) => s.title)).toEqual(['Added', 'Fixed']);
  });

  it('keeps one sentence per bullet, joined across wrapped lines and unwrapped of markdown', () => {
    const notes = latestRelease(sample)!;
    expect(notes.sections[0]!.items).toEqual([
      'A start screen with examples and recent projects.',
      'Wrapped bullets continue onto the next line.',
    ]);
    expect(notes.sections[1]!.items).toEqual(['A link reads as its text, and emphasis is unwrapped.']);
  });

  it('falls back to Unreleased only when nothing has shipped, and to null on no headings', () => {
    const early = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Work in progress.\n`;
    expect(latestRelease(early)!.version).toBe('Unreleased');
    expect(latestRelease('# Changelog\n\nNothing yet.')).toBeNull();
  });

  it("reads the repository's own changelog", async () => {
    const text = await readFile(join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
    const notes = latestRelease(text)!;
    expect(notes).not.toBeNull();
    expect(notes.version).not.toBe('');
    expect(notes.sections.length).toBeGreaterThan(0);
    for (const section of notes.sections) expect(section.items.length).toBeGreaterThan(0);
  });
});
