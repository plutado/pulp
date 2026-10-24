# Contributing

Thanks for your interest. Pulp is in early development, so the format and internals still move. Opening an issue before a large change saves everyone time.

## Setup

```sh
npm install
npm run dev
```

Before sending a pull request:

```sh
npm run lint
npm test
npm run build
```

`npm test` includes end-to-end tests (`tests/e2e`) that build the app, render the bundled samples and drive the window over the DevTools protocol. They run when the Electron binary, ffmpeg and ffprobe are installed, take about two minutes, and are skipped otherwise (or with `PULP_E2E=0`). `PULP_E2E=1` fails instead of skipping, which CI uses on Windows. `npm run test:e2e` runs them alone.

The results region is windowed: only the cards and rows in view are in the DOM. A UI test must therefore scroll to an item before reading or clicking it — use the `scrollToResult`, `onResult`, `clickResult` and `resultNames` helpers in `tests/e2e/ui.e2e.test.ts` rather than querying `#results` directly.

## Guidelines

- Keep `src/core` free of Electron and DOM dependencies, and cover it with tests. Logic that can live in the core should.
- Regions are covered by the end-to-end test. A DOM-level component test (`tests/dom`, happy-dom) is for a region whose correctness is what the DOM holds and no pure test can see — the windowed results region is the first and so far only one (ADR 0009). `tests/dom` is typechecked by `tsconfig.web.json`, not the node project.
- Template format changes need a matching update to `docs/template-format.md` and to the validator, plus an entry in `CHANGELOG.md`.
- Larger design choices get a short record in `docs/decisions/`.
- Before investigating a capture, color or platform symptom, read `docs/platform-notes.md`: it records what was already found on Electron, ffmpeg, Windows and macOS, with causes and fixes. Add new findings there.
- Only contribute media, fonts or templates you created yourself or that carry a license compatible with redistribution (CC0, CC BY, MIT, SIL OFL for fonts). Say which license in the pull request.
- Plain, direct writing in docs and UI text.

## Commits

- **Issue references by milestone.** GitHub issues #1 to #23 are the milestones in `ROADMAP.md`, numbered the same; the roadmap lists them in planned order, which is not numeric order. A commit that advances a milestone ends its message with `Part of #N`. Use `Fixes #N` only in the commit that completes the whole milestone. Work outside the roadmap carries no issue reference.
- **Roadmap ticks and changelog entries.** When a checklist item is finished, tick it in `ROADMAP.md` and add an entry under "Unreleased" in `CHANGELOG.md`, in the same commit as the change itself.
- **Test, lint and build before committing.** `npm test`, `npm run lint` and `npm run build` must pass for every commit, not only before the pull request.
- **Only intended files.** Check `git status` before committing. No render output, scratch files or editor leftovers.
- **Small commits.** One change per commit, with a message that says what changed and why.
- **No rewriting history.** Do not amend, squash or force-push commits that have been shared. Add a new commit instead.

## Writing templates

See `docs/template-format.md`. The samples in `templates/` are small and are a good starting point. Contributed sample templates should be CC0 1.0 or MIT.

By contributing, you agree that your contributions are licensed under the project's MIT license (code) or the license stated for the template you add.
