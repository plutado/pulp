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
```

`npm test` includes an end-to-end render test (`tests/e2e`) that builds the app and renders the bundled samples. It runs when the Electron binary, ffmpeg and ffprobe are installed, takes about 15 seconds, and is skipped otherwise (or with `PULP_E2E=0`). `npm run test:e2e` runs it alone.

## Guidelines

- Keep `src/core` free of Electron and DOM dependencies, and cover it with tests. Logic that can live in the core should.
- Template format changes need a matching update to `docs/template-format.md` and to the validator, plus an entry in `CHANGELOG.md`.
- Larger design choices get a short record in `docs/decisions/`.
- Only contribute media, fonts or templates you created yourself or that carry a license compatible with redistribution (CC0, CC BY, MIT, SIL OFL for fonts). Say which license in the pull request.
- Plain, direct writing in docs and UI text.

## Writing templates

See `docs/template-format.md`. The samples in `templates/` are small and are a good starting point. Contributed sample templates should be CC0 1.0 or MIT.

By contributing, you agree that your contributions are licensed under the project's MIT license (code) or the license stated for the template you add.
