# Releasing

Status: the process milestone 8 settles. Pulp has not reached 1.0; these are the steps a release takes whenever one is cut.

## What a release is

Three things that have to agree, and one command that makes them agree:

- the version in `package.json` (and `package-lock.json`),
- a dated section in `CHANGELOG.md` where **Unreleased** was,
- a tag, `v<version>`, on the commit holding both.

```sh
npm run release -- patch        # 0.1.0 → 0.1.1
npm run release -- minor        # 0.1.0 → 0.2.0
npm run release -- major        # 0.9.3 → 1.0.0
npm run release -- 1.0.0-rc.1   # or say the number outright
npm run release -- minor --dry-run   # the notes and the version, nothing written
```

The arithmetic is `src/core/release.ts`, which the tests pin; `scripts/release.mjs` is the shell that reads the files, runs the checks and talks to git.

## Version numbers

Semantic versioning, counted from what a person using Pulp would notice:

- **Patch** — fixes and small improvements that change nothing about how Pulp is used.
- **Minor** — a feature, a new template or preset, a setting that was not there before. Every release before 1.0 is one of these, since 0.x makes no compatibility promise.
- **Major** — after 1.0, something that breaks what worked: a template format change needing a new `formatVersion`, a project file an older build cannot open, a command-line flag removed.

A release candidate is `1.0.0-rc.1`; `npm run release -- patch` from a candidate settles it to `1.0.0`, which is what shipping the thing that was being tested means.

## The notes are the changelog

Release notes are never written twice. Every change adds its entry under **Unreleased** as it lands (CONTRIBUTING.md), so by the time a release is cut the notes are already written and reviewed. The script moves that section under a dated heading, leaves a fresh empty Unreleased above it, and puts the same text in the tag's own message — so `git show v0.2.0`, the changelog and the release page all say one thing.

A release with an empty Unreleased section is refused: nothing has landed, and a release that says nothing is a mistake every time.

## The steps

1. **Be on the main branch, with a clean tree.** The script refuses a tree with changes, so the release commit holds the release and nothing else.
2. **Read the Unreleased section.** It is what people will read. Fix the wording now, in a commit of its own, rather than in the release.
3. **Run it.** `npm run release -- minor`. It runs `npm run lint`, `npm test` and `npm run build` first — a release is exactly when the whole suite is worth the wait — then writes the version and the changelog, commits as `Release <version>` and makes an annotated tag. `--no-checks` skips the suite, for a release whose checks were run a moment ago.
4. **Nothing has been pushed.** Look at the commit and the tag, then `git push && git push origin v<version>`.
5. **The tag does the rest.** Pushing it starts [`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds the macOS app, the Windows installer and the Linux AppImage on their own runners and **drafts** a release carrying them, their checksums, and these same notes with a footer on what an unsigned build asks of a person. It takes about ten minutes.
6. **Read the draft and publish it.** Nothing is published until someone presses the button: that is the point at which the notes, the artifacts and the version are one person's responsibility rather than a workflow's. A build that failed can be re-run from the Actions tab — the second run attaches to the same draft rather than making another.

## What the version touches

- The window's About panel and `Copy diagnostics` report it, so a bug report says which build it came from.
- `CHANGELOG.md`'s newest *released* section is what the start screen's **What's new** shows; it reads the file rather than a copy, so a release's notes appear there the moment the release is cut.
- Nothing in a project file, preset or template carries the app's version: those carry their own `formatVersion`, which moves on its own schedule (`docs/template-format.md`).

## The editor panels

A release can carry the editor panels (milestone 54) beside the installers:
`npm run panels:package` writes `release/panels/pulp-panel-premiere-<version>.zip`
and `pulp-panel-resolve-<version>.zip`, deterministic for the same files, and
— with Adobe's ZXPSignCmd on the machine and a certificate in `PULP_ZXP_CERT`
and `PULP_ZXP_PASSWORD` — a signed `pulp-panel-premiere-<version>.zxp`. The
version inside the archives is `package.json`'s, so bump it first; the test
holds the three manifests to the same number. Attach the archives to the
release; each carries its own `INSTALL.md`. Details: [editor-panels.md](editor-panels.md).
