# Third-party notices

Pulp's own code is MIT (see `LICENSE`). It is built on and ships with the work below, each under its own licence. Versions are the ones pinned in `package-lock.json` at the time of a build; the licence texts travel in each package's own folder under `node_modules/`, and in a packaged build under the application's resources. `tests/notices.test.ts` holds this file to the lock file, so a dependency cannot ship unlisted.

Nothing here is a service: everything runs on the machine, and nothing phones home.

## Runtime

| Component | Licence | Notes |
|---|---|---|
| **Electron** | MIT | The application shell: windows, menus, dialogs, the offscreen renderer that captures frames. Copyright (c) Electron contributors and GitHub Inc. |
| **Chromium** | BSD-3-Clause, with components under their own licences | The browser engine inside Electron, which draws every template page and the window itself. Its own notices (Blink, V8, Skia, FFmpeg's decoders as Chromium builds them, and many more) are the `LICENSES.chromium.html` file Electron ships beside its binary. |
| **Node.js** | MIT | The runtime of Pulp's main process, bundled by Electron; its own third-party notices are in the Node.js `LICENSE` file. |

## npm dependencies in the application

| Package | Licence | What Pulp uses it for |
|---|---|---|
| **preact** | MIT | The UI regions that are components (ADR 0009). Copyright (c) Jason Miller. |
| **@preact/signals** and **@preact/signals-core** | MIT | The shared state those regions and the plain-DOM regions read. Copyright (c) Preact team. |
| **lottie-web** | MIT | Playing and rasterising Lottie animations (milestone 35). Copyright (c) Airbnb, Inc. |
| **pdfjs-dist** (pdf.js) | Apache-2.0 | Reading PDF pages as layered stills (milestone 33). Copyright Mozilla Foundation. |
| **@napi-rs/canvas** | MIT | An optional dependency of pdf.js for drawing outside a browser; Pulp rasterises in a sandboxed page instead and does not call it, but the package and its per-platform builds (`@napi-rs/canvas-*`) are installed with pdf.js. |

Development dependencies (TypeScript, Vite, electron-vite, ESLint, Vitest, happy-dom, ajv, the Phosphor icon source) are used to build and test Pulp and are not shipped in it. The Phosphor icons that are drawn into the window come from `@phosphor-icons/core` (MIT, copyright (c) Phosphor Icons) and are inlined at build time.

## Bundled fonts

Ten families under the **SIL Open Font License 1.1**, each shipped as its upstream files with its own licence file beside it: Inter, Montserrat, Oswald, Bebas Neue, Source Serif 4, Playfair, JetBrains Mono, Caveat, Dancing Script and Noto Sans. Versions, sources, reserved font names and the hashes a test holds them to are in [`docs/font-credits.md`](docs/font-credits.md). The OFL lets the fonts be bundled and passed on with their licence and forbids selling them on their own.

## Not bundled, but used where installed

| Program | Licence | Notes |
|---|---|---|
| **FFmpeg** | LGPL-2.1-or-later, or GPL-2.0-or-later depending on how the build was configured | Pulp does not ship FFmpeg, and no installer carries it. It finds the one you installed and runs it as a separate program to probe and encode media; nothing of FFmpeg is linked into Pulp. Where you have none, **Settings → FFmpeg** offers to fetch a build for you — it says which build, from which publisher, how big it is and under what licence before anything is fetched, checks what arrives against the checksums in `src/core/ffmpeg-download.ts`, and keeps it beside your settings. Those builds are configured with x264 and so are **GPL-3.0-or-later**; they are fetched at your request from their own publishers (Martin Riedl's build server, and Gyan Doshi's builds on Windows) and are not part of Pulp. Decision record 0022 has the reasoning. |
| **whisper.cpp** | MIT | Pulp does not ship whisper.cpp. It finds `whisper-cli` on your machine and runs it as a separate program to transcribe speech (milestone 50, ADR 0021). |
| **Whisper models** (`ggml-tiny`, `ggml-base`, `ggml-small`) | MIT | The speech model weights, published by OpenAI and converted by the whisper.cpp project, are fetched from that project's repository only when you ask, checked against the checksums in `src/core/speech.ts`, and kept beside your settings. They are not part of Pulp. |

## Bundled templates, examples and sample media

The templates in `templates/`, the example projects in `examples/` and the generated sample-media catalogue are Pulp's own work, released under **CC0 1.0**: no rights reserved.
