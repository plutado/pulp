# System design

Status: describes the code as of the Unreleased section of CHANGELOG.md. Planned work is marked as such.

## Goals

- Editors can find a graphic, change its text and colors, and get a file that drops into Premiere Pro, DaVinci Resolve or Final Cut Pro with correct alpha, in under a minute.
- Templates are an open format that anyone can write and read without Pulp.
- Everything works offline. No accounts, no telemetry, no bundled third-party media.
- The logic that matters (format, parameters, indexing, encoding arguments) is testable without a GUI or ffmpeg.

Non-goals for 1.0: a timeline or general video editor, a visual template authoring tool, cloud sync, a template marketplace, AI features.

## Components

```
+----------------------------- Electron app ------------------------------+
|                                                                         |
|  Renderer (UI)                    Main process                          |
|  src/renderer                     src/main                              |
|  - library list + search          - window, IPC handlers                |
|  - preview iframe  <--postMessage-- pulp-template:// protocol           |
|  - parameter form                 |   serves template folders,          |
|  - render controls                |   injects bridge, sets CSP          |
|        |                          - library service (scan, settings)    |
|        | window.pulp (preload)    - renderer: offscreen window -> PNG   |
|        +------------ IPC -------->    frames -> ffmpeg stdin            |
|                                                                         |
+--------------------------------|----------------------------------------+
                                 | imports
                     +-----------v-----------+          +---------+
                     |  src/core (pure TS)   |          | ffmpeg  |
                     |  manifest, params,    |  args -> | (user-  |
                     |  runtime, library,    |          | installed)
                     |  search, render-plan, |          +---------+
                     |  ffmpeg detection     |
                     +-----------------------+
```

### src/core

No Electron and no DOM. Modules marked "pure" also avoid Node APIs so the renderer can import them.

| Module | Pure | Responsibility |
|---|---|---|
| `manifest.ts` | yes | Manifest types, `validateManifest`, `parseManifest`, `frameCount`. |
| `params.ts` | yes | `resolveParams`: merge user input with defaults, coerce, clamp, report issues. |
| `runtime.ts` | yes | `frameState` for a frame index, the bridge script, `injectBridge`, template CSP. |
| `tags.ts`, `search.ts` | yes | Tag normalization, query parsing and scoring over an index. |
| `library-types.ts` | yes | Index data types (shared over IPC). |
| `render-plan.ts` | yes | Output presets and `buildRenderPlan`, which returns the exact ffmpeg arguments. |
| `library.ts` | Node | `scanLibrary`: walk folders, load templates, index media. |
| `ffmpeg.ts` | Node | `detectFfmpeg` with an injectable process runner, encoder checks. |

### src/main

- `index.ts`: app lifecycle, main window, IPC handlers, headless `--render` mode.
- `protocol.ts`: `pulp-template://<template-id>/<path>` handler. Resolves paths inside the template folder only (rejects traversal), injects the bridge into the entry page, sets the CSP and `no-store`.
- `library-service.ts`: holds the current index; roots are the bundled `templates/` folder plus user folders from settings.
- `settings.ts`: `settings.json` in Electron's `userData` folder.
- `render.ts`: the render loop (below).

### src/renderer and src/preload

The preload exposes a small `window.pulp` API (`src/shared/api.ts`). The UI is plain TypeScript and DOM; it imports pure core modules directly for search, parameter resolution and frame timing. A UI framework can be introduced when the parameter editor grows (see ADR candidates in the roadmap).

## Data flow

### Library scan

1. Roots = bundled templates + user folders.
2. `scanLibrary` walks each root (depth limit 12, file limit 100,000, skips hidden entries, symlinks, `node_modules`).
3. A folder containing `template.json` is a template: validated, entry file checked, not descended into further. Problems are collected, not thrown.
4. Other files are indexed as media by extension. Folder names between the root and the file become tags (`Stock/City Night/clip.mov` gets `stock`, `city-night`).
5. The index is plain data, sent to the UI over IPC and searched there.

The index is rebuilt on start and on demand. Persistent caching and file watching are planned (roadmap milestone 4).

### Preview

1. UI sets the iframe `src` to `pulp-template://<id>/<entry>`.
2. The bridge posts `pulp:ready` after `load` and `document.fonts.ready`.
3. On play, scrub or parameter change, the UI computes `frameState` and posts `pulp:render`. Only one frame is in flight; newer requests replace queued ones, so slow templates drop frames instead of lagging.

### Render

1. `detectFfmpeg` checks `PULP_FFMPEG_PATH`, `ffmpeg` on PATH, then the Homebrew locations (GUI apps on macOS do not inherit the shell PATH). If none works, the user gets an actionable message.
2. `buildRenderPlan` produces the ffmpeg arguments and output path; `checkPresetSupport` confirms the encoder exists.
3. An offscreen, transparent `BrowserWindow` loads the template at its declared size.
4. For each frame: `executeJavaScript(window.__pulp.render(state))`, `capturePage()`, resize if the capture size differs (HiDPI), `toPNG()`, write to ffmpeg stdin with backpressure.
5. ffmpeg reads `-f image2pipe -c:v png -i pipe:0` and encodes. Exit code and the tail of stderr are reported.

One informal measurement on an Apple Silicon Mac: the 150-frame Title Card sample (1920x1080) rendered to H.264 in about 4 seconds, including app startup. No benchmark suite exists yet.

### Output presets

| Id | Container | Codec / pixel format | Alpha | Notes |
|---|---|---|---|---|
| `prores-4444` | .mov | prores_ks profile 4444, yuva444p10le | yes | Default for NLE use. |
| `prores-422hq` | .mov | prores_ks profile hq, yuv422p10le | no | Alpha templates flattened over a background color. |
| `png-sequence` | .png | png, rgba | yes | `name_%05d.png` starting at 0. |
| `webm-vp9-alpha` | .webm | libvpx-vp9, yuva420p, `-auto-alt-ref 0` | yes | Alpha support in NLEs varies. |
| `h264-mp4` | .mp4 | libx264 CRF 18, yuv420p, faststart | no | Review and delivery copies. |

Non-alpha presets flatten alpha templates with `color=...[bg];[bg][0:v]overlay`. Chroma-subsampled presets reject odd frame sizes before ffmpeg starts.

## Security model

- Templates are untrusted content. They run in a sandboxed renderer with no Node integration, cannot reach the network (CSP `connect-src 'none'`, `default-src 'self'`), and can only read files inside their own folder through the protocol handler.
- The preview iframe uses its own origin (`pulp-template://<id>`), separate from the UI. It has `allow-same-origin` so templates can load their own fonts and images; because the origin differs from the UI's, this does not give access to the UI or to `window.pulp`.
- The main window denies new windows and navigation; `https://` links open in the system browser.
- Manifest paths (`entry`, `thumbnail`) are checked for traversal at validation time and again at serve time.

Open questions: whether to run templates in a separate session partition, and whether to restrict CSS features that can fingerprint or exfiltrate (moot while the network is blocked).

## Error handling

- Validation and scanning collect issues and keep going. The UI shows the first few problems with details on hover.
- Parameter problems never stop a render; they fall back to defaults and are listed as warnings.
- Render failures return a message rather than throwing across IPC. Cancel kills ffmpeg and leaves a partial file (cleanup is a roadmap item).

## Testing

- `tests/` runs with Vitest in Node. It covers validation, parameter resolution, frame timing, bridge injection, scanning on temporary folders, search, ffmpeg detection with a fake process runner, and the ffmpeg arguments for every preset. It also validates every bundled sample.
- Tests do not need Electron or ffmpeg, so CI skips the Electron binary download.
- The Electron render path is checked manually with the headless `--render` mode and `ffprobe`. An automated end-to-end render test that runs when ffmpeg is present is planned.

## Packaging (planned)

electron-builder for signed and notarized macOS builds (universal), Windows NSIS with code signing, and Linux AppImage. Bundled templates go to `resources/templates`, which `bundledTemplatesDir()` already expects. ffmpeg will not be bundled at first; see roadmap milestone 7 for the trade-off.
