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
|  - render controls + queue        |   injects bridge, sets CSP          |
|        |                          - library service (scan, settings)    |
|        | window.pulp (preload)    - render queue, one job at a time     |
|        +------------ IPC -------->  - renderer: offscreen window -> raw |
|                                       BGRA frames -> ffmpeg stdin       |
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
| `tags.ts`, `search.ts` | yes | Tag normalization, query parsing and scoring over an index; metadata filters (`duration:`, `width:`, `height:`, `fps:`, `res:`, `codec:`, `alpha:`) that read manifests for templates and probed metadata for media; `favorite:` and `recent:`. |
| `library-types.ts` | yes | Index data types (shared over IPC). |
| `render-plan.ts` | yes | Output presets and `buildRenderPlan`, which returns the exact ffmpeg arguments. |
| `render-guard.ts` | yes | Render loop guards: `withTimeout`, the frame call script, template error messages, which partial files to remove. |
| `capture-format.ts` | yes | The probe page and `classifyCapture`: byte order and premultiplication of `toBitmap()` output, measured rather than assumed. |
| `render-queue.ts` | yes | `RenderQueue`: job list with status and progress, one running at a time; snapshots go to the UI unchanged. |
| `library-scan.ts` | Node | Media kinds, folder tags, loading one template folder. |
| `library-store.ts` | Node | `LibraryStore` over `node:sqlite`: incremental scans, offline roots, per-item user data, `toIndex()`. |
| `library-watch.ts` | Node | `watchRoot`: recursive `fs.watch` with coalescing, or null where unsupported. |
| `library.ts` | Node | `scanLibrary`: one-shot scan through a throwaway in-memory store. |
| `media-meta.ts` | yes | `MediaMetadata`, `parseFfprobe`, resolution labels and aliases. |
| `media-probe.ts` | Node | `probeMedia` through the injectable runner, `ffprobePathFor`. |
| `thumbnails.ts` | yes | Which items get thumbnails, ffmpeg arguments for frame and poster, cache file names, `pulp-thumb` URLs. |
| `atomic-file.ts` | Node | `writeFileAtomic`: temp file in the same folder, fsync, rename over the target, rename retried while Windows holds it busy. |
| `ffmpeg.ts` | Node | `detectFfmpeg` with an injectable process runner, encoder checks. |

### src/main

- `index.ts`: app lifecycle, main window, IPC handlers, headless `--render` mode.
- `protocol.ts`: `pulp-template://<template-id>/<path>` handler. Resolves paths inside the template folder only (rejects traversal), injects the bridge into the entry page, sets the CSP and `no-store`.
- `library-service.ts`: owns the persistent `LibraryStore`, serializes scans, keeps one watcher per online root, rescans on focus and when an offline root returns, and pushes `library:changed`. Headless mode switches it to an in-memory store.
- `settings.ts`: `settings.json` in Electron's `userData` folder: library folders and recent colors. Saved atomically (`core/atomic-file.ts`: temp file, fsync, rename) and changed through a queue (`updateSettings`) so concurrent changes are not lost. `PULP_USER_DATA` overrides the folder (tests).
- `render.ts`: the render loop (below).
- `render-queue-service.ts`: shows the save dialog when a render is requested, adds the job to a `RenderQueue`, runs queued jobs one after another through `renderTemplate`, and sends the whole queue to the UI on every change (`queue:changed`).

### src/renderer and src/preload

The preload exposes a small `window.pulp` API (`src/shared/api.ts`). The UI is plain TypeScript and DOM; it imports pure core modules directly for search, parameter resolution, frame timing, timecode and color values. Number parameters with a range get a slider with a direct-entry field beside it, kept in sync; text parameters with `maxLength` show a live character counter. Edits are recorded in a per-template undo history (`src/core/history.ts`, pure): live edits redraw the preview at once and become one history step after a short pause or when the field commits (blur, slider release), so typing a word is one step rather than one per keystroke. Undo and Redo buttons and Ctrl/Cmd+Z act on the selected template's history; inside a text or number field the shortcut is left to the field's own undo. Each field shows a Reset when its value differs from the default, and Reset all clears every parameter; both are history steps and so undoable. Each template keeps its edits and history for the session, so switching templates and back resumes where you left off; nothing is persisted. Saved presets ("Show A", "Show B") are: one JSON file per template id in `presets/` in user data, written atomically, holding only the values that differ from the template's defaults (`core/param-presets.ts`), so later default changes flow through untouched fields; applying one is an undoable step and drops parameters the template no longer declares without comment; saving over an existing name asks first, inline. Batch rendering takes CSV text (pasted or chosen as a file): headers match a parameter id or label ignoring case, a `name`/`file`/`filename`/`output` column that is not a parameter names the jobs and files (else the first text parameter, else the row number), unknown columns are listed as a warning in the preview before anything is queued, and Queue asks for one folder and adds one job per row, labelled "Template · Name" with the file named from the row (`core/batch-csv.ts`). Headless mode has the same through `--batch file.csv` with `--out` as the folder. Color parameters use a composite control (`colorField`): the native color input edits the RGB part (Chromium's input holds `#rrggbb` only and has no alpha support), a slider edits the alpha as a percentage, a text field shows and accepts the whole `#rrggbb[aa]` value, and a swatch over a checkerboard previews the result. `src/core/color.ts` splits and joins the parts; opaque values are written without a suffix. Below each color field is a row of up to eight recently used colors, shared across templates and stored in `settings.json` (`recentColors`); a committed color edit (picker close, slider release, text entry, or picking a recent swatch) moves it to the front. `PULP_USER_DATA` points the app at another user data folder, which the UI test uses so it never touches the real settings. ADR 0006 keeps it that way through milestone 3 and names the library milestone as the point to re-evaluate.

## Data flow

### Library index

1. Roots = bundled templates + user folders from settings (+ `--library` folders in headless mode, for that run only).
2. The index lives in `library.sqlite` in the user data folder (`LibraryStore`, `node:sqlite`; ADR 0007). Headless mode uses an in-memory store.
3. A scan walks each root (depth limit 12, file limit 100,000, skips hidden entries, symlinks, `node_modules`) and is incremental: a media file whose size and mtime match its row is kept without being read; a template folder whose `template.json` is unchanged and whose entry file still exists keeps its parsed entry; only new or changed items are loaded. Rows for files that are gone from an online root are deleted.
4. A folder containing `template.json` is a template: validated, entry file checked, not descended into further. Problems are collected per root, not thrown.
5. Other files are indexed as media by extension. Folder names between the root and the file become tags (`Stock/City Night/clip.mov` gets `stock`, `city-night`).
6. A root that cannot be reached is marked offline. Its items stay in the index flagged `offline`, listed dimmed and not loadable, so tags and favorites attached to them (`user_items`, a table independent of scan results) survive until the root is back. Roots removed from settings are dropped with their items; their user data stays for a later return.
7. After each scan, media without metadata for its current size and mtime is probed with ffprobe in the background (two at a time, results pushed to the UI every 25 files; skipped in headless mode and without ffmpeg). `src/core/media-meta.ts` parses duration, picture size, frame rate, codecs and alpha (from the pixel format, or VP9's `alpha_mode` tag); `media-probe.ts` runs ffprobe; the store keeps results in `media_meta` keyed with the stat signature, so a changed file is probed again and a file ffprobe cannot read is not retried until it changes. The list and details show size, timecode duration, frame rate, codec and alpha once probed.
8. After metadata, thumbnails: one at a time in the background, for templates and visual media that have none for their current size and mtime. A media thumbnail is one ffmpeg frame (a tenth into a video, the only frame of an image) fitted into 240 px without enlarging, alpha kept; a template poster is one frame at mid-progress with default parameters, rendered through the normal renderer into a scratch folder and shrunk the same way. Files live in `thumbnails/` in user data, named by item id; the store records each with the stat signature, so a changed item gets a new one and a failure is not retried until the item changes. The list shows them over a checkerboard at `pulp-thumb://<id>/`, a scheme with the media rules: by id, only the store's current file for that id, which must really lie in the cache folder, bare 404 otherwise, no fetch, not for template pages.
9. User data (`user_items`: tags, favorite, last used) is merged into the index: user tags join the folder and manifest tags (so `tag:` finds them) and are also listed as `userTags` so the UI knows which are removable; `favorite` and `lastUsed` are set when present. The stage shows a favorite toggle and tag chips with an input for the shown item; selecting an item or queuing a render marks it used. Search adds `favorite:yes` and `recent:yes` or `recent:10` (used items, newest first). All of it survives offline roots and rescans, since it never lives in scan results.
10. The UI gets the stored index at once on start (`library:get`), and every scan result afterwards as `library:changed`. Scans run on demand (Rescan, Add folder), when a watched root changes (`fs.watch` recursive, coalesced into one rescan of that root per quiet period; absent where unsupported), when the window regains focus and the last scan is older than 5 s, and every 15 s if an offline root exists again. Scans are serialized.

Measured on a synthetic library of 5,100 items (5,000 tiny media files in 100 folders, 100 templates), Apple M3 Max, macOS, file-backed database: first scan 145 ms, unchanged rescan 105 ms, rescan with 10 changed and 10 new files 93 ms, building the index for the UI 12 ms. Target: a library of 5,000 items should scan from cold in under 1 s and rescan unchanged in under 500 ms on a laptop; the test in `tests/library-perf.test.ts` prints the numbers on every run (`--silent=false` to see them) and fails only above loose CI ceilings (15 s, 5 s).

### Preview

1. UI sets the iframe `src` to `pulp-template://<id>/<entry>`.
2. The bridge posts `pulp:ready` after `load` and `document.fonts.ready`.
3. On play, scrub or parameter change, the UI computes `frameState` and posts `pulp:render`. Only one frame is in flight; newer requests replace queued ones, so slow templates drop frames instead of lagging.

### Media preview

Selecting a media item shows it in the stage with `<video>`, `<img>` or `<audio>`, loaded from `pulp-media://<item-id>/`. The handler (`src/core/media-serve.ts`, adapted in `src/main/protocol.ts`) follows the same pattern as `pulp-template://` and applies these rules on every request: items are addressed by library id, never by path; the file's real location is resolved (following symlinks) and must still lie inside the item's registered root, so a symlink planted in a library folder cannot reach the rest of the disk; the real file's extension must be one of the library's media extensions and of the item's kind; only GET and HEAD are answered, no folder listings; byte ranges are honored with 206 and `Content-Range` so video can seek; an unknown id, a template id, an offline root, or a file that is gone all get a bare 404 with no file system detail. Template pages cannot use it: the template CSP lists no `pulp-media:` source, so the browser stops the request, and the handler refuses any request whose referrer is a `pulp-template://` page as a second line. Unit tests cover every refusal and the range arithmetic; an end-to-end render has a fixture template try `fetch` and `<audio>` against a valid id and checks that it painted "refused"; the UI test loads an image and a video through the scheme, seeks the video (which needs ranges), and checks through `<img>` that an unknown id and a path on the URL are refused while a known id loads. The scheme has no Fetch support and enforces CORS, so even the app window can only play or show media from it, not read it as data.

### Render

Clicking Render opens the save dialog at once; the job is queued as soon as a path is chosen, so several renders can be lined up while the first one runs. The queue runs one job at a time (two offscreen windows plus two ffmpeg processes would compete for the same cores and memory), reports progress per job, and keeps finished jobs with their output path or error until the user clears them. Cancel on a queued job marks it cancelled; on the running job it aborts the render below. Render options travel with the job: a frame-rate override, the background for flattening, and in/out points (`RenderOptions`, set in the inspector or with the headless flags `--fps`, `--background`, `--in-point`, `--out-point`). `resolveTiming` turns template timing plus options into the sampling rate, the first frame and the frame count, and rejects impossible values with a message; the UI shows that message under the fields and disables Render, the queue checks before opening the save dialog. Frame indices stay on the template's timeline, so a trimmed render shows the same picture at a given second as a full one, a frame-rate override resamples time rather than changing the clip's speed, and PNG sequences are numbered with the indices they hold (`-start_number`). Each job:

1. `detectFfmpeg` checks `PULP_FFMPEG_PATH`, `ffmpeg` on PATH, then the Homebrew locations (GUI apps on macOS do not inherit the shell PATH). If none works, the user gets an actionable message.
2. `buildRenderPlan` produces the ffmpeg arguments and output path from the preset, the template and the render options; `checkPresetSupport` confirms the encoder exists.
3. An offscreen, transparent `BrowserWindow` loads the template at its declared size. Its device scale factor is set to 1 on purpose (Electron's `offscreen.deviceScaleFactor`), so a 1920x1080 template is captured as 1920x1080 pixels on any display and `window.devicePixelRatio` is 1 inside the template.
4. Once per process, before the first raw render: a 256x256 offscreen probe page (large enough to clear the minimum window size Windows enforces) draws half-transparent red and opaque blue, and `classifyCapture` reads the bitmap to learn the byte order (BGRA or RGBA) and whether colors are premultiplied. Electron documents the bitmap layout as platform-dependent, so this is measured, not assumed. If the bytes fit no known layout the render falls back to PNG frames and adds a warning. Headless mode prints the answer as `frames: raw (bgra, premultiplied alpha)` or `frames: png`.
5. For each frame: `executeJavaScript(window.__pulp.render(state))`, then `invalidate()` and one `paint` event, then `capturePage()`, `toBitmap()`, write to ffmpeg stdin with backpressure. The paint wait exists because `capturePage()` on an offscreen window returns the last painted frame: the bridge resolves two animation frames after drawing (the first rAF callback runs before the draw is committed), and the forced repaint confirms the browser process holds that frame before it is captured. Without this, Windows CI captured a blank or one-frame-stale first frame; the stall was invisible mid-render because neighboring frames differ little, and invisible to the size fixtures because they draw the same picture every frame. A capture that is not exactly the declared size fails the render with a message naming both sizes; frames are never resampled, because that would soften every frame to hide a platform problem. The bitmap must be exactly width x height x 4 bytes, so misaligned rows can never reach ffmpeg.
6. ffmpeg reads `-f rawvideo -pixel_format <measured> -video_size WxH -i pipe:0` and encodes. With ffmpeg 8.1 or later (detected from `ffmpeg -h filter=setparams` listing `alpha_mode`), the first filter is `setparams=alpha_mode=premultiplied` or `straight`, matching the measured layout. Those versions negotiate an alpha mode on filter links and treat untagged raw input as straight: without the tag, ffmpeg premultiplied our already premultiplied frames before the unpremultiply step, which left the output premultiplied (a white 85% panel read 216 instead of 255) and one step low everywhere, on every platform. Premultiplied frames from alpha templates then pass through `format=gbrap,unpremultiply=inplace=1`; the PNG encoder used to do this implicitly, and the explicit planar RGB keeps format negotiation away from a lossy Y'CbCr intermediate. Verified with ffmpeg 8.0 (no alpha mode) and 9.0.2. Video presets then convert to Rec.709 and tag the frames (see Output presets). `--frame-format png` switches to the former `-f image2pipe -c:v png` input, kept so both paths can be timed on the same template (ADR 0003). Exit code and the tail of stderr are reported.

Failure handling (`src/core/render-guard.ts`, applied in `render.ts`):

- Loading the page has 30 seconds; each frame (render call plus capture) has 10 seconds by default. A frame that runs over is reported with its number, and the template's renderer process is crashed on purpose, because a synchronous infinite loop would otherwise block it forever.
- The frame call catches errors inside the page and returns them as data (`executeJavaScript` alone only reports "Script failed to execute"). The message names the template, the frame, the error type and the first location inside the template, for example `index.html:42:7`. The bridge is injected on a single line so these line numbers match the author's file.
- On cancel or any failure, ffmpeg is killed and the files this render wrote are removed: the output file, or for sequences only the frame numbers this render covers. Without overwrite, files that existed before the render are left alone.

Frame transport measurements, raw BGRA pipe against the PNG pipe it replaced. Apple M3 Max, 64 GiB, Electron 44, ffmpeg 8.0. Headless `--render`, time from the start of `renderTemplate` to ffmpeg exit, so window load, template drawing, capture and encoding are included and app startup is not. Two runs each, shown as a range; the 4K and 8K rows use copies of the size-probe fixtures with `duration` raised to 2 s (60 frames).

| Template | Size | Frames | Preset | PNG frames | Raw frames |
|---|---|---|---|---|---|
| Lower Third Bar | 1920x1080 | 180 | ProRes 4444 | 4.1-5.3 s (34-44 fps) | 3.3-3.4 s (53-54 fps) |
| Lower Third Bar | 1920x1080 | 180 | H.264, flattened | 3.5 s (52 fps) | 3.3 s (54 fps) |
| Title Card, opaque | 1920x1080 | 150 | H.264 | 3.1 s (49 fps) | 2.8 s (53 fps) |
| size-4k fixture | 3840x2160 | 60 | ProRes 4444 | 4.9-5.7 s (11-12 fps) | 2.5-2.6 s (23-24 fps) |
| size-8k fixture | 7680x4320 | 60 | ProRes 4444 | 14.6-17.6 s (3.4-4.1 fps) | 8.6-9.5 s (6.3-7.0 fps) |

The table predates the paint-synchronized capture. That change first halved throughput (each frame waited two 60 Hz begin-frame intervals), then more than recovered it by raising the offscreen begin-frame rate with `setFrameRate(240)`: the 180-frame lower third now measures 2.7 s (67 frames/s) raw and 4.6 s (39 frames/s) PNG on the same machine, slightly faster than the table.

At 1080p the PNG round trip was a small part of the frame time. At 4K the raw path halves the render time, and at 8K it saves about 40%, where encoding 33-megapixel ProRes frames is now the larger cost. Both paths produce the same pixels within one step per channel (checked by the alpha comparison test), so the ProRes files differ slightly in size. No benchmark suite exists yet; the numbers come from the `frames/s` line that headless mode prints.

### Output presets

| Id | Container | Codec / pixel format | Alpha | Notes |
|---|---|---|---|---|
| `prores-4444` | .mov | prores_ks profile 4444, yuva444p10le | yes | Default for NLE use. |
| `prores-422hq` | .mov | prores_ks profile hq, yuv422p10le | no | Alpha templates flattened over a background color. |
| `png-sequence` | .png | png, rgba | yes | `name_%05d.png` starting at 0. |
| `webm-vp9-alpha` | .webm | libvpx-vp9, yuva420p, `-auto-alt-ref 0` | yes | Alpha support in NLEs varies. |
| `h264-mp4` | .mp4 | libx264 CRF 18, yuv420p, faststart | no | Review and delivery copies. |
| `qt-animation` | .mov | qtrle, argb | yes | Lossless RLE for older workflows. Full-range sRGB like PNG. Small with lots of transparency (lower third: 2 MB vs 15.7 MB ProRes 4444), large for full-frame content. |
| `hevc-alpha` | .mov | hevc_videotoolbox, quality 80, alpha quality 0.9, `hvc1` | yes | macOS only (Apple VideoToolbox). Fed 4:4:4 Y'CbCr with alpha (`ayuv`) that the Rec.709 steps convert and tag; ADR 0005. About 0.3 MB for the 180-frame lower third at 54 dB PSNR. |

Non-alpha presets flatten alpha templates with `color=...[bg];[bg][0:v]overlay=format=rgb`, compositing in RGB. Chroma-subsampled presets reject odd frame sizes before ffmpeg starts.

Presets whose encoder the detected ffmpeg lacks are listed as unavailable in the UI with the reason (`presetUnavailableReason`), for example HEVC on Windows and Linux; `checkPresetSupport` refuses them at render time as well.

Frame rates and in/out points follow editing-app conventions (`src/core/timecode.ts`). The frame rate is picked from a fixed list covering film (24, 48), PAL/SECAM (25, 50, 100), NTSC (23.976, 29.97, 59.94, 47.952, 119.88, as exact 1001 rationals for ffmpeg) and 30, 60, 120; a template's own non-standard rate is allowed when not overridden. In and out points are inclusive frames, as in Premiere Pro and Resolve, where setting the same in and out gives a one-frame duration. They are entered as SMPTE timecode `HH:MM:SS:FF` (shorter forms allowed), a plain frame number, or seconds with an `s` suffix. Above 99 fps the frames field has three digits, which is how Resolve and Premiere display high-frame-rate timecode and why older two-digit metadata cannot carry it. Drop-frame timecode (semicolons) is accepted for 29.97 and 59.94 (and 119.88 by the same rule) with the SMPTE rule of skipping frame numbers 0-1 (0-3, 0-7) in the first second of every minute except each tenth; the picture never loses frames, only numbers are skipped, and plain frame numbers are the unambiguous form the apps themselves recommend for frame-accurate work. Sources: Wikipedia on [SMPTE timecode](https://en.wikipedia.org/wiki/SMPTE_timecode) and [frame rate](https://en.wikipedia.org/wiki/Frame_rate); Adobe on [entering timecode](https://helpx.adobe.com/in/premiere-pro/using/timecode.html) and [timecode display options](https://helpx.adobe.com/premiere/desktop/organize-media/apply-labeling/timecode-display-options.html); Blackmagic forum threads on [119.88 fps timelines with and without drop-frame](https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=175297) and [frame-number display](https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=84421).

Color (ADR 0004): templates draw in sRGB, the Canvas default. The Y'CbCr video presets convert to Y'CbCr with the BT.709 matrix at limited range (`scale=out_color_matrix=bt709:out_range=tv`) and tag every frame BT.709 primaries, transfer and matrix, limited range (`setparams`), which lands as the `colr` atom and H.264 VUI in .mov/.mp4 and the Colour element in WebM. The conversion runs after an alpha template is composited over its background, so background and template pixels take the same path. PNG sequences stay full-range sRGB RGBA, untouched. The transfer tag is BT.709 by convention rather than the strictly accurate sRGB tag, which QuickTime's documented color atom vocabulary does not include. This is fixed, not a setting.

## Security model

- Templates are untrusted content. They run in a sandboxed renderer with no Node integration, cannot reach the network (CSP `connect-src 'none'`, `default-src 'self'`), and can only read files inside their own folder through the protocol handler. They cannot load `pulp-media://` (not in their CSP, and the handler refuses template referrers), so a downloaded template pack cannot read the user's media library.
- The preview iframe uses its own origin (`pulp-template://<id>`), separate from the UI. It has `allow-same-origin` so templates can load their own fonts and images; because the origin differs from the UI's, this does not give access to the UI or to `window.pulp`.
- The main window denies new windows and navigation; `https://` links open in the system browser.
- Manifest paths (`entry`, `thumbnail`) are checked for traversal at validation time and again at serve time.

Open questions: whether to run templates in a separate session partition, and whether to restrict CSS features that can fingerprint or exfiltrate (moot while the network is blocked).

## Error handling

- Validation and scanning collect issues and keep going. The UI shows the first few problems with details on hover.
- Parameter problems never stop a render; they fall back to defaults and are listed as warnings.
- Render failures return a message rather than throwing across IPC, and stay visible on the job in the queue. Cancel and failures kill ffmpeg and remove partial output (see Render above). A failed job does not stop the jobs behind it.

Findings about Electron, ffmpeg and the two platforms that shaped this pipeline, with their causes and fixes, are collected in `docs/platform-notes.md`; check it before re-investigating a capture or color symptom.

## Testing

- `tests/` runs with Vitest in Node. It covers validation, parameter resolution, frame timing, bridge injection, scanning on temporary folders, search, ffmpeg detection with a fake process runner, and the ffmpeg arguments for every preset. It also validates every bundled sample. The library store is tested for incremental behavior (kept, loaded and removed counts after changes), a template losing its entry file, a root going missing and coming back with user data intact, dropping unconfigured roots, and persistence across close and reopen; the watcher for coalescing; and scan timing on a synthetic 5,100-item library.
- Unit tests do not need Electron or ffmpeg, so the Linux CI job skips the Electron binary download. A second job on `windows-latest` installs ffmpeg, downloads Electron and runs the whole suite with `PULP_E2E=1`, which fails instead of skipping if a tool is missing.
- `tests/e2e/render.e2e.test.ts` covers the Electron render path. It builds the app, renders samples through the headless `--render` mode to ProRes 4444, VP9 WebM, a PNG sequence and H.264, and checks frame count, size, pixel format and decoded alpha values with ffprobe and ffmpeg. Two fixture templates in `tests/e2e/templates` check the error report for a template that throws and the frame timeout for one that hangs, and that neither leaves output behind. Three more fixtures (`size-4k`, `size-8k`, `size-portrait`) cover frame sizes the 1920x1080 samples cannot: each draws corner markers and a 1px checkerboard from `state.width`/`state.height`, and the test reads single pixels back with ffmpeg to confirm the output is the declared size, the right way up, and was never rescaled; 8K ProRes 4444 and portrait H.264 cover the video presets at those sizes. The size fixtures also mark their center when `devicePixelRatio` is not 1, so on a Retina display the pixel checks prove the template saw scale 1. One test sets `PULP_OFFSCREEN_SCALE=2`, a diagnostic environment variable that renders the offscreen window at 2x, and expects the render to fail with the capture-size message instead of producing resized frames. Another renders the lower-third sample through both frame paths (`--frame-format raw` and `png`) with a white 85% panel and compares a panel pixel: premultiplied pixels reaching the encoder would read 217 instead of 255, so the raw path must match the PNG path within one step. A color test renders the portrait size probe to H.264 and ProRes 4444, checks with ffprobe that the stream is tagged BT.709 (and limited range for the MP4), and decodes the pure red, green, blue and white corner markers back within a few steps, which the untagged BT.601 default would fail. Render options are checked end to end with ffprobe: a 0.1 s fixture at `--fps 60` yields 6 frames at 60/1, an in point of `00:00:02:00` and out point of `00:00:02:29` on the lower third yield 30 files numbered 00060 to 00089 whose first frame already shows the panel, `--background #336699` decodes at the center of a flattened H.264 render, and a non-standard rate, a malformed point and a frames field at the nominal rate are refused before anything is written. A display-scaling test renders with Chromium's `--force-device-scale-factor=1.5`, which makes the primary display report scale 1.5 as Windows does at 150%, and checks the frames stay pixel-exact; on the Windows CI job this stands in for a 150% desktop. The suite runs when the Electron binary, ffmpeg and ffprobe are available (and a display on Linux) and is skipped otherwise; the Linux CI job skips it, the Windows job requires it.
- `tests/e2e/ui.e2e.test.ts` drives the real app. It starts Electron with a remote debugging port, selects the lower third through the library list over the DevTools protocol, and reads pixels back from the preview's canvas (in the template frame's own execution context). It checks that the panel's 85% alpha survives a color change through the native picker, that the alpha slider changes the preview's alpha and the text field, that a full `#RRGGBBAA` value typed into the text field updates picker, slider and preview, and that garbage is marked and ignored. It also checks saved presets (the file holds only the changed value, applying is undoable, replacing asks first, delete) and the batch preview (columns, names, the unknown-column warning, nothing queued by previewing), and that a number slider and its entry stay in sync, that a text counter follows the length, that undo and redo work by button and by Ctrl+Z while a shortcut sent to a text field leaves the history alone, that per-field and whole-template reset restore the defaults and are themselves undoable, and that edits and history survive switching to another template and back. Recent colors are checked too: committed colors appear most-recent-first on every color field, clicking one on another field applies it, the list lands in `settings.json` of a scratch user data folder (`PULP_USER_DATA`), and another template shows the same list. It needs only Electron, not ffmpeg. The two end-to-end files each build the app, so Vitest runs test files one at a time.

## Packaging (planned)

electron-builder for signed and notarized macOS builds (universal), Windows NSIS with code signing, and Linux AppImage. Bundled templates go to `resources/templates`, which `bundledTemplatesDir()` already expects. ffmpeg will not be bundled at first; see roadmap milestone 7 for the trade-off.
