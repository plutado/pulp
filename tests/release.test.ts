/**
 * Cutting a release (milestone 8): the version number, the changelog's
 * Unreleased section becoming a dated release, and the tag they are released
 * under. `scripts/release.mjs` is the shell around this.
 */

import { describe, expect, it } from 'vitest';
import { cutRelease, isVersion, nextVersion, tagFor, versionIn } from '../src/core/release';

const CHANGELOG = `# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- A thing that landed.
- Another thing.

### Fixed

- A thing that was wrong.

## [0.1.0] - 2026-10-18

### Added

- The first release.
`;

describe('version numbers', () => {
  it('counts up by patch, minor and major', () => {
    expect(nextVersion('0.1.0', 'patch')).toBe('0.1.1');
    expect(nextVersion('0.1.9', 'minor')).toBe('0.2.0');
    expect(nextVersion('0.9.3', 'major')).toBe('1.0.0');
  });

  it('settles a pre-release to its own release on a patch, which is what shipping a candidate means', () => {
    expect(nextVersion('1.0.0-rc.1', 'patch')).toBe('1.0.0');
    expect(nextVersion('1.0.0-rc.1', 'minor')).toBe('1.1.0');
  });

  it('refuses what is not a version, and names the tag after what is', () => {
    expect(isVersion('1.2.3')).toBe(true);
    expect(isVersion('1.2')).toBe(false);
    expect(isVersion('v1.2.3')).toBe(false);
    expect(() => nextVersion('soon', 'patch')).toThrow(/not a version/);
    expect(tagFor('1.2.3')).toBe('v1.2.3');
  });

  it('reads the package file\'s own version, and says so when there is none to read', () => {
    expect(versionIn('{\n  "name": "pulp",\n  "version": "0.1.0"\n}\n')).toBe('0.1.0');
    expect(() => versionIn('{"name":"pulp"}')).toThrow(/no version/);
    expect(() => versionIn('{"name":"pulp","version":"soon"}')).toThrow(/no version/);
  });
});

describe('cutting the release', () => {
  const cut = cutRelease(CHANGELOG, '0.2.0', '2026-11-02');

  it('dates the Unreleased section and leaves a fresh empty one above it', () => {
    expect(cut.text).toContain('## [Unreleased]\n\n## [0.2.0] - 2026-11-02\n\n### Added\n\n- A thing that landed.');
    // The release before it is untouched, and in order under the new one.
    expect(cut.text.indexOf('## [0.2.0]')).toBeLessThan(cut.text.indexOf('## [0.1.0]'));
    expect(cut.text).toContain('## [0.1.0] - 2026-10-18');
    expect(cut.text.endsWith('- The first release.\n')).toBe(true);
  });

  it('hands back what that section said, as the notes the release ships with', () => {
    expect(cut.notes).toBe('### Added\n\n- A thing that landed.\n- Another thing.\n\n### Fixed\n\n- A thing that was wrong.');
  });

  it('refuses a release with nothing in it, or a version or date that is not one', () => {
    const empty = CHANGELOG.replace(/### Added[\s\S]*?(?=## \[0\.1\.0\])/, '');
    expect(() => cutRelease(empty, '0.2.0', '2026-11-02')).toThrow(/nothing to release/);
    expect(() => cutRelease(CHANGELOG, '0.2', '2026-11-02')).toThrow(/not a version/);
    expect(() => cutRelease(CHANGELOG, '0.2.0', 'tomorrow')).toThrow(/not a date/);
    expect(() => cutRelease('# Changelog\n', '0.2.0', '2026-11-02')).toThrow(/no "## \[Unreleased\]"/);
  });

  it('is what the first release of a file with nothing before it does too', () => {
    const first = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Everything.\n';
    const made = cutRelease(first, '0.1.0', '2026-11-02');
    expect(made.text).toBe('# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-11-02\n\n### Added\n\n- Everything.\n\n');
    expect(made.notes).toBe('### Added\n\n- Everything.');
  });
});
