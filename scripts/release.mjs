#!/usr/bin/env node
/**
 * Cut a release (milestone 8). Everything it does is local: the version in
 * `package.json`, the changelog's Unreleased section dated into a release, a
 * commit holding the two, and a tag on it. Pushing and the release page are
 * the maintainer's, and `docs/releasing.md` says what to do with what this
 * leaves behind.
 *
 *   node scripts/release.mjs patch|minor|major|<version> [--no-checks] [--dry-run]
 *
 * The arithmetic is `src/core/release.ts`, which has the tests; this is the
 * shell that reads the files, runs the checks and talks to git.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: options.quiet ? 'pipe' : 'inherit', ...options });

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const checks = !argv.includes('--no-checks');
const asked = argv.find((a) => !a.startsWith('--'));
if (!asked) fail('Usage: node scripts/release.mjs patch|minor|major|<version> [--no-checks] [--dry-run]');

// The arithmetic is src/core/release.ts, where the tests are: one copy, imported as it is. Node
// strips the types itself from 22.18; an older one says so rather than failing somewhere odd.
let core;
try {
  core = await import('../src/core/release.ts');
} catch (err) {
  fail(`This script reads src/core/release.ts directly, which needs Node 22.18 or newer (this is ${process.version}): ${err.message}`);
}
const { cutRelease, isVersion, nextVersion, tagFor, versionIn } = core;

const packagePath = join(ROOT, 'package.json');
const changelogPath = join(ROOT, 'CHANGELOG.md');
if (!['patch', 'minor', 'major'].includes(asked) && !isVersion(asked)) {
  fail(`"${asked}" is neither patch, minor, major nor a version number such as 1.2.3`);
}
// What the arithmetic refuses is said in one line, not as a stack: an empty Unreleased section
// and a version that is not one are ordinary answers here, not crashes.
const ask = (what) => {
  try {
    return what();
  } catch (err) {
    return fail(err.message);
  }
};
const current = ask(() => versionIn(readFileSync(packagePath, 'utf8')));
const version = isVersion(asked) ? asked : ask(() => nextVersion(current, asked));
const tag = tagFor(version);

// Read the notes before anything is written, so a changelog that cannot be released stops here.
const { text, notes } = ask(() => cutRelease(readFileSync(changelogPath, 'utf8'), version, new Date().toISOString().slice(0, 10)));
process.stdout.write(`Releasing ${current} → ${version} as ${tag}\n\n${notes}\n\n`);
// A dry run says what would happen and stops, whatever state the tree is in: it writes nothing.
if (dryRun) {
  process.stdout.write('Dry run: nothing written.\n');
  process.exit(0);
}

// A release is cut from a clean tree, so the commit holds the release and nothing else.
const dirty = run('git', ['status', '--porcelain'], { quiet: true }).trim();
if (dirty !== '') fail(`The working tree has changes; commit or set them aside first:\n${dirty}`);
if (run('git', ['tag', '--list', tag], { quiet: true }).trim() !== '') fail(`${tag} is already a tag: ${version} has been released.`);

if (checks) {
  process.stdout.write('Running the checks…\n');
  for (const script of ['lint', 'test', 'build']) run('npm', ['run', script]);
}

// npm writes the version into package.json and package-lock.json together; nothing else here touches them.
run('npm', ['version', version, '--no-git-tag-version'], { quiet: true });
writeFileSync(changelogPath, text);
// The lock carries the version too, where there is one to carry it.
const staged = ['package.json', 'CHANGELOG.md', ...(existsSync(join(ROOT, 'package-lock.json')) ? ['package-lock.json'] : [])];
run('git', ['add', ...staged], { quiet: true });
run('git', ['commit', '-m', `Release ${version}`], { quiet: true });
// An annotated tag carries the notes, so `git show` and the release page say the same thing.
run('git', ['tag', '-a', tag, '-m', `${version}\n\n${notes}`], { quiet: true });

process.stdout.write(`\nCommitted and tagged ${tag}. Nothing has been pushed.\nNext: git push && git push origin ${tag}, then draft the release page from the notes above (docs/releasing.md).\n`);
