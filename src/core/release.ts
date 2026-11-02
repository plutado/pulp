/**
 * Cutting a release (milestone 8): the version number, and the notes the
 * changelog's Unreleased section already holds.
 *
 * Releasing is three edits that have to agree — the version in `package.json`,
 * a dated heading in `CHANGELOG.md` where "Unreleased" was, and a tag named
 * after it — so the arithmetic is here, pure and tested, and
 * `scripts/release.mjs` is the thin shell that writes the files, commits and
 * tags. The notes are never written twice: what ships is what the Unreleased
 * section already says, which is why every change adds its entry there as it
 * lands (CONTRIBUTING.md).
 *
 * Pure: the caller hands the files' text in and writes what comes back.
 */

export type ReleaseKind = 'patch' | 'minor' | 'major';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function isVersion(value: string): boolean {
  return SEMVER.test(value.trim());
}

/** The tag a version is released under: `v` and the number, which is what the release workflow looks for. */
export function tagFor(version: string): string {
  return `v${version.trim()}`;
}

/**
 * The next version up from this one. A pre-release settles to its own release
 * on a patch — 1.0.0-rc.1 becomes 1.0.0 — which is what "release what we have
 * been testing" means; minor and major count from the numbers either way.
 */
export function nextVersion(current: string, kind: ReleaseKind): string {
  const m = SEMVER.exec(current.trim());
  if (!m) throw new Error(`"${current}" is not a version number such as 1.2.3`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const pre = m[4] !== undefined;
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return pre ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
}

export interface ReleaseCut {
  /** The changelog with the Unreleased section dated and a fresh empty one above it. */
  text: string;
  /** What that section said, as the release notes: the `### Added` groups and their bullets, verbatim. */
  notes: string;
}

/** The empty section every release leaves behind for the next change to write into. */
const UNRELEASED_HEADING = '## [Unreleased]';

/**
 * The changelog with this release cut from its Unreleased section: the heading
 * becomes `## [version] - date`, and a fresh empty Unreleased goes above it.
 * The notes come back as they were written, so the tag, the release page and
 * the file all say the same thing.
 *
 * Refuses rather than writing a release with nothing in it: an empty Unreleased
 * section means nothing has landed since the last one, and a release that says
 * nothing is a mistake every time.
 */
export function cutRelease(changelog: string, version: string, date: string): ReleaseCut {
  if (!isVersion(version)) throw new Error(`"${version}" is not a version number such as 1.2.3`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`"${date}" is not a date such as 2026-11-01`);
  const text = changelog.replace(/\r\n?/g, '\n');
  const at = text.indexOf(UNRELEASED_HEADING);
  if (at === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section to release from');
  const rest = text.slice(at + UNRELEASED_HEADING.length);
  const nextHeading = rest.search(/\n## \[/);
  const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).replace(/^\n+/, '').trimEnd();
  if (body === '') throw new Error('The Unreleased section is empty: there is nothing to release');
  const tail = nextHeading === -1 ? '' : rest.slice(nextHeading + 1);
  const dated = `## [${version}] - ${date}`;
  return {
    text: `${text.slice(0, at)}${UNRELEASED_HEADING}\n\n${dated}\n\n${body}\n\n${tail}`,
    notes: body,
  };
}

/**
 * The version the package file declares, for the script to count from. Writing
 * the new one back is `npm version --no-git-tag-version`'s job rather than a
 * function here: it keeps `package-lock.json` in step, which a replacement in
 * the text would not — the lock holds the version twice, and a dependency of
 * its own may carry the same number.
 */
export function versionIn(packageJson: string): string {
  const parsed = JSON.parse(packageJson) as { version?: unknown };
  if (typeof parsed.version !== 'string' || !isVersion(parsed.version)) {
    throw new Error('package.json has no version number such as 1.2.3');
  }
  return parsed.version;
}

