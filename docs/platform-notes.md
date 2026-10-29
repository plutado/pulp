# Platform notes

Findings about Electron, Chromium, ffmpeg, macOS and Windows that cost real time to establish. Check here before re-investigating a symptom; each entry says what was seen, what the cause was, and what the code does about it. Dates are when the finding was made; versions are what it was made on (Electron 44, Chromium 152, ffmpeg 8.0 and 9.0.2, macOS 26.5.1 on Apple Silicon, `windows-latest` on GitHub Actions).

## Offscreen rendering and capture

### The capture can be one frame stale (fixed, October 2026)

**Seen.** On Windows CI, a trimmed PNG sequence was numbered correctly (00060 onward) but the first file held the start of the template, and a flattened H.264 render's first frame was pure background with no markers. macOS never showed it.

**Cause.** `capturePage()` on an offscreen window returns the last *painted* frame, not a fresh one. The template bridge resolved inside the first `requestAnimationFrame` callback, which runs *before* Chromium commits the frame that contains the draw. On a slow machine the capture could grab the previous, empty surface. It stayed invisible for the four days between the first renderer and the first-frame tests because most tests read later frames, and the size fixtures draw the same picture every frame, so a one-frame shift changes nothing they check. Only tests that look at frame content at the very first frame can see it.

**Fix.** Two parts, both in place: the bridge resolves on the *second* animation frame (after the commit), and `captureFrame` calls `webContents.invalidate()` and waits for one `paint` event before `capturePage()`, with a 500 ms fallback so a window that never paints degrades to the old behavior rather than hanging. The paint event is used only as a sync signal; frames still come from `capturePage()` (ADR 0003).

**Side effect and its fix.** The two waits ran at the offscreen window's default begin-frame cadence of 60 Hz and cost two intervals per frame, halving renders to about 28 frames/s. Measured per phase, the paint wait itself is 0.1 ms; the interval was the whole cost. `webContents.setFrameRate(240)` (Electron's maximum) raises the cadence and brings the waits down to about 4 ms; `webPreferences.offscreen.frameRate` has no effect, `setFrameRate` does. Renders are now faster than before the fix (lower third 1080p: 67 frames/s raw against 54). The higher cadence applies only to the hidden render window, which is destroyed when the render ends, so CPU use is higher only while a render runs.

### A paint left over from the page load can satisfy the first frame's wait (fixed, October 2026)

**Seen.** On macOS CI only (run 40232422746, `render-macos`), the CSV batch test's second row came out blank: `expect(badge[1]).toBeGreaterThan(200)` read 0 at (199, 891) in `Sam_00090.png`. It passed on a Mac locally, on Windows CI, and alone. The pixel was read as a missing logo badge, which is how the issue was first written up, but it is not: measured on a good render, the panel covers x 96 onward and y 834 to 984 at that row, and the badge covers x 158 to 246 and y 870 to 950. The sampled point sits about 40 px inside the badge on every side, so nothing about fonts or layout can move it off. Fully transparent there means the whole frame was blank, which is what the other row — rendered from the same template moments earlier and checked at two other points — proves did not happen generally.

**Cause.** `paintComposited` resolves on the *next* `paint` event after its `invalidate()`, taking that paint to be the frame it asked for. That only holds when nothing else is in flight. Loading the page queues paints of its own, and so does handing a template its image-slot bytes; on a slow machine one of those can still be travelling when the first frame's wait begins, satisfy it immediately, and leave `capturePage()` returning the surface from *before* the draw. The two rows differ by exactly this: the row with a logo is the one that calls `window.__pulp.prepare(...)`, an extra round trip and an extra image decode between the load and the first capture, so it has the most to be still in flight. Both rows render a single frame (`--in-point 90 --out-point 90`), so the first capture is the only capture and there is no later frame to cover for it. This is the same family as "The capture can be one frame stale" above: that fix ordered the *draw* against the capture, and this is the one place where a paint that predates the draw can still be mistaken for it.

**Fix.** `drainPaints` in `src/main/render.ts`: after the page is loaded and prepared, and before the first frame, paints are counted until none has arrived for 48 ms (capped at 2 s). The last one is by definition the newest state, so from then on a paint can only be the frame that was asked for. It costs one quiet period per render, not per frame — the batch test's wall time is unchanged — and it is applied at every place that loads an offscreen page and then captures: `renderTemplate`, `captureTemplateFrames`, `captureStillPage`, `captureAssetFrames` and the visual-regression service, where a stale paint would hash the blank page instead of the template.

**Still not closed, and now guarded (October 2026).** After the drain was tightened the macOS job failed the same way again (run 40925965805 on `92704ea`): `set-board_00090.png`, the first frame of a three-frame render, read alpha 0 where the backing tint is. Every instance so far — this one, the 9:16 lower third, the trimmed render, the CSV batch row — is the **first captured frame of a render**, which is the one with no earlier frame to have painted the surface before it.

It would not reproduce here: twenty runs of the failing render on an idle Mac and under twelve CPU hogs, with the page reporting how each draw settled, never produced a blank frame and never once settled by the timeout. Nothing the host can ask proves that a given paint carries a given draw, so rather than guess at more ordering, the capture now **checks itself**: the first capture of a render is read, and if every pixel is transparent it is taken again a paint cycle later, up to three times (`captureSettled` and `isBlankCapture`). A frame that really is blank — which is most templates' frame 0 — answers the same way each time and is believed, so this costs a few milliseconds once per render and can never write a wrong frame. When a retry does change the answer it says so on stderr, which is how a CI log will show whether the guard is earning its keep.

The page also now reports how its after-draw wait ended (`drawn: 'raf' | 'timeout'`). `timeout` means the renderer never ran an animation frame, so the ordering the capture relies on was never established; the host spends an extra paint cycle in that case. It has not been seen to happen on a render window, which is itself worth knowing.

**Earlier, and still true: the drain tightened (October 2026).** The drain made the macOS job green three runs out of four, and the fourth (run 40244410162) failed the same way at two other single-frame renders — the Boardroom lower third at 16:9 and 9:16, frame 90, the backing tint read as alpha 0 — so the stale-paint cause is right and the first drain left a hole. It started its quiet period the moment it asked for its repaint, so a paint that took longer than 48 ms to arrive, which a 1080p surface can on a loaded two-core runner, let the drain finish *before* its own paint did; that paint then satisfied the first frame's wait. Measured locally with the paint stream logged: a paint from the load was still being delivered at the instant the drain attached its listener, and the drain's own paint came 8 ms after its `invalidate()`; on the runner those figures are what stretch. The drain now waits for the paint that answers its invalidate before the quiet period counts at all — paints are delivered in the order viz produced them, so when that one is in, every paint the load queued is in too — and the quiet period after it takes a straggler. The 2 s cap still bounds a window that never paints. The cost is unchanged: the in-render timer reads 0.5 s for a single-frame lower third before and after.

Each frame, for the record, produces two paints: one when the renderer commits the draw, and one answering `paintComposited`'s invalidate. The wait takes whichever comes first; both hold the draw. What remains unordered is the renderer compositor's submission of the drawn frame against the capture, which the bridge's double `requestAnimationFrame` makes very likely but cannot prove from the page; a frame token in the composited output would close it, and there is nowhere to put one without touching the template's pixels.

### Device scale factor

- The offscreen window's scale comes from `webPreferences.offscreen.deviceScaleFactor`, default 1 "for consistent behavior". It is set to 1 explicitly so the intent is in the code, not in a default. `--force-device-scale-factor` changes what `screen` reports but not the offscreen window, which is why the 150% scaling test can use that switch to simulate a Windows desktop.
- A capture that is not exactly the template's size fails the render with a message naming both sizes. Frames are never resampled; that would hide a platform problem by softening every frame. `PULP_OFFSCREEN_SCALE` renders at another scale so a test can prove the refusal.
- `enableDeviceEmulation` *before* the page loads segfaults Electron. After load it changes only the page's `devicePixelRatio`, not the capture size, so it is no use for this.

### Windows enforces a minimum window size

A 16x16 offscreen probe window came back as 32x39 on `windows-latest`, and a 64x36 fixture template failed its capture-size check there the same way. Even frameless offscreen windows are subject to the minimum. The capture-format probe is 256x256 and every fixture template is at least 320x180 for that reason; keep any probe or fixture window at or above 320x180.

### Bitmap layout of `toBitmap()`

Electron documents the layout as platform-dependent. Measured: BGRA, premultiplied, tightly packed (width x height x 4 bytes) on macOS and on Windows CI. The renderer does not rely on that: a probe page with half-transparent red and opaque blue is captured once per process and classified (`src/core/capture-format.ts`), the measured byte order and premultiplication go to ffmpeg, and an unknown layout falls back to PNG frames with a warning. Headless mode prints the answer as `frames: raw (bgra, premultiplied alpha)`.

### The color input has no alpha

Chromium's `<input type=color>` holds `#rrggbb` only. An 8-digit value collapses to six, and the `alpha` attribute is not supported in Electron 44. Color parameters therefore use a composite control: native picker for RGB, a slider for alpha, a text field for the whole value (`colorField` in the renderer).

## ffmpeg

### 8.1 and later negotiate an alpha mode (fixed, October 2026)

**Seen.** Identical failures on ffmpeg 8.1.2 and 9.0.2 (Windows CI), reproduced on macOS with a static 9.0.2 build: every opaque color one step low (254 for 255) and semi-transparent pixels dark (a white panel at 85% read 216 instead of 255, 39 steps). ffmpeg 8.0 was fine.

**Cause.** From 8.1, filter links carry an alpha mode. Untagged raw input counts as straight, and because `unpremultiply` asks for premultiplied input, the graph auto-inserts `premultiply_dynamic` first. The frames get premultiplied a second time, the filter undoes only that, and the output stays premultiplied with ffmpeg's `(v * a + 128) >> 8` rounding on top. The arithmetic matches exactly: 217 to 184 to 216, 255 to 254 to 254, green 64 at alpha 128 to 32 to 63.

**Fix.** `detectFfmpeg` checks whether `ffmpeg -h filter=setparams` lists `alpha_mode`; when it does, the first filter is `setparams=alpha_mode=premultiplied` (or `straight`), matching the probe's measurement. 8.0 rejects that option, so it is a detected capability. Pinning CI to 8.1.2 was a useful experiment: it ruled out "ffmpeg 9" as the cause.

**Not the cause.** An earlier guess blamed a Y'CbCr intermediate in format negotiation. It was wrong for this symptom. The explicit `format=gbrap` before `unpremultiply` stays as a guard, because the filter is planar-only and negotiation is free to choose otherwise.

### Color tags must be set on frames

ffmpeg 7 and later take color properties from the frames leaving the filter graph. `-color_primaries`, `-color_trc` and `-colorspace` as output options left transfer and primaries unknown in the files; `setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv` on the frames set all four in every container, and the MOV `colr` atom appeared without the experimental `write_colr` flag. Put `setparams` *before* the final `format` filter: with `range=tv` immediately before an `[out]` label the graph fails to parse.

### VideoToolbox from BGRA leaves the matrix untagged

`hevc_videotoolbox` accepts BGRA and converts internally with BT.709, but writes `colr` with matrix 0 (unspecified). A decoder falling back to BT.601 then reads pure red as (233, 0, 1). Feeding `ayuv` (4:4:4 Y'CbCr with alpha) that the Rec.709 steps converted and tagged gives `nclc` 1/1/1 and an exact round trip (ADR 0005). The encoder exists only in macOS builds.

### Small things that bit

- `tile` flushes a **padded, part-blank** tile at end of input when the last row is short. Feeding it exactly as many frames as the row holds is therefore a coin flip: `fps=N/duration` can yield N-1 frames on a clip that ends a hair early, and the strip comes out with a blank cell. The hover-scrub strip asks for 8% more frames than it needs, so a full row is emitted mid-stream and `-frames:v 1` takes it.
- `crop=1:1` on 4:2:0 video rounds the crop to zero and fails; convert with `format=rgba` first when reading single pixels.
- The rawvideo demuxer's option is `-pixel_format`; using `-pix_fmt` for input would collide with the output `-pix_fmt` when scanning arguments.
- `-start_number` is an image2 *output* option and sets the first file's number; it does not affect timestamps or content.
- ffmpeg 8.0 and later decode the HEVC alpha layer; older builds return the base layer only (reads as fully opaque). The e2e test skips its alpha assertion in that case and says so.
- **An HEVC alpha file does not say so in its pixel format.** The alpha is an auxiliary *layer* of the same track, so ffprobe reports `pix_fmt=yuv420p`, byte for byte what an opaque H.264 reports — a library scan reading pixel formats alone calls such a clip opaque. What gives it away is `view_ids_available`, which ffmpeg exports for a multilayer HEVC stream: `"0,0"` for base plus alpha, empty for a single-layer file (measured on `hevc_videotoolbox` output with and without alpha, and on libx265). Decoding agrees — ffmpeg 8.0 hands back `yuva420p` frames for the multilayer file. Multiview (stereo) HEVC is multilayer too, so `view_pos_available` must be empty as well: ffmpeg fills it with left/right for a stereo pair and leaves it empty for an alpha layer, which has no position. `hevcAlpha` in `src/core/media-meta.ts`; the fields come from the one ffprobe call the scan already makes.
- Versions seen: Homebrew formula 8.0 then 9.0.2; Chocolatey `ffmpeg` has 8.0.0 through 8.1.2 and 9.0.0 through 9.0.2 and installs 9.0.2 by default. Local Mac testing of another version: a static build from `ffmpeg.martin-riedl.de` in a scratch folder, pointed to with `PULP_FFMPEG_PATH`, and deleted afterwards.

## Node and Electron

- `node:sqlite` is available in Electron 44 (Node 24.22) and in Node 22.13 and later; the tests run on 22.19. It prints an ExperimentalWarning on some versions; the API used (`DatabaseSync`: exec, prepare, run, get, all) has been stable in practice. It needs no native module and nothing extra at packaging time.
- Recursive `fs.watch` works on macOS and Windows, and on Linux with Node 20 or later. `watchRoot` returns null where it throws, and the app falls back to rescans on focus and on demand.
- Vitest 5 hides console output from passing tests by default; run with `--silent=false` to see lines such as the library benchmark's timings.

## Electron custom protocols

- A scheme used by `<video>` or `<audio>` needs the `stream: true` privilege in `registerSchemesAsPrivileged`, and `protocol.handle` responses can carry a Node stream converted with `Readable.toWeb`. Byte ranges must be answered by the handler (206, `Content-Range`), or seeking stalls.
- `registerSchemesAsPrivileged` may be called once, before `ready`, with every custom scheme; `pulp-template` and `pulp-media` are registered together.
- A privileged scheme enforces CORS by default: `fetch` from the app page (origin `file://`) to it fails with "Failed to fetch" unless responses carry `Access-Control-Allow-Origin`, while `<img>`, `<video>` and `<audio>` load fine (no-cors). `pulp-media` keeps it that way on purpose and has `supportFetchAPI: false`.

## Editing apps (measured 2026-10-23, macOS)

- **Premiere Pro 2026** does not read HEVC alpha layers at all and decodes those files with video levels; it cannot import WebM; image sequences import at 29.97 fps by default; new sequences composite in linear color by default, which changes blended values of semi-transparent pixels (expected, not a file fault).
- **DaVinci Resolve Studio 20.2.3** defaults HEVC alpha to Premultiplied (Straight fixes it); offers only None and Premultiplied for VP9 and decodes its alpha badly; its Data Levels Auto scaled QuickTime Animation alpha by about 255/235 when the file had no `colr` atom. QuickTime's `colr` atom has no range field for RGB codecs; declaring the GBR matrix is how full-range RGB is signalled, and ffprobe will still report `color_range` unknown for such files.
- Both apps link to dropped files rather than copying them; deleting the file takes the clip offline.

## Drag out of the window

- `webContents.startDrag({ file, icon })` must be called from the main process in response to the renderer's `dragstart` (which calls `preventDefault`); the drag is native from then on. The `icon` must be a non-empty `NativeImage` on macOS and Windows, or the call throws; Pulp uses the template thumbnail or a generated 48x48 PNG.
- The file must exist when the drag starts; a render cannot be awaited inside the gesture. Hence "Prepare for drag" first, then drag.
- A PNG sequence is dragged as its first frame file; Premiere Pro and Resolve offer to import the sequence from a frame when the file names are numbered. Recorded as a quirk to confirm in `docs/nle-verification.md`.
- Dragging is not observable from the DevTools protocol; the UI test checks the arming of the handle, the allowed-file rule and the cache, not the drop.

## Files written by the app

- **Settings were written in place and a test read a half-written file.** The recent-colors UI test read `settings.json` right after a color was committed; on one Windows run the read landed while `writeFile` was still replacing the content and `JSON.parse` failed. The same read had passed on earlier runs: a timing race, not a platform rule. Two fixes, both kept: `settings.json` is now written atomically (`src/core/atomic-file.ts`: temporary file in the same folder, `fsync`, `rename` over the target, so any reader or a crash sees the old file or the new one, never a partial or empty one), and the test retries until the file parses and carries the value instead of reading once. Settings changes also go through a queue (`updateSettings`), so two changes close together cannot overwrite each other's work.
- **Windows and `rename` over an open file.** On Windows, renaming over a file another process has open fails with EPERM, EBUSY or EACCES, where macOS and Linux replace it. The atomic writer retries the rename for about two seconds. Keep the temporary file in the same folder as the target: a rename across volumes is a copy, not an atomic replace.
- A `.tmp` file left behind in user data means the app died between writing and renaming; it is harmless and can be deleted.

## CI on every platform

Four jobs run on every push and pull request: `check` (Ubuntu: dependency audit, lint and type check, unit tests, build) and a full render job per platform, `render-windows`, `render-macos` and `render-linux`, each running the whole suite with `PULP_E2E=1` so a missing Electron, ffmpeg or ffprobe fails rather than skips.

- **macOS** (`macos-latest`, Apple silicon) takes ffmpeg from Homebrew. The HEVC-with-alpha test skips itself when ffmpeg lists no `hevc_videotoolbox` encoder, so a runner without VideoToolbox passes without pretending to cover it.
- **Linux** runs under a virtual display (`xvfb-run`, 8192 × 4608: larger than any render, since Linux keeps an offscreen window inside the screen) and a D-Bus session (`dbus-run-session`). It uses a pinned static ffmpeg 9.0 (BtbN/FFmpeg-Builds, checksum-verified) rather than Ubuntu's 6.1, which rounds the colour conversion a step differently and failed the exact colour checks. The runner's kernel blocks unprivileged user namespaces, which Chromium's sandbox needs, so the job gives Electron's setuid `chrome-sandbox` helper root ownership and mode 4755, the supported alternative to turning the sandbox off.
- **The dependency audit** counts development dependencies too: Electron is one, and it is the runtime Pulp ships.

## Windows CI

### The job

- GitHub's `windows-latest` runner has a desktop session; Electron offscreen rendering works there without extra setup. It has two cores and a small desktop — about 1024 px wide for the app window, which matters more than the CPU (see "A sliver of a results list" below).
- `PULP_E2E=1` makes the end-to-end suite fail instead of skipping when a tool is missing, so the job cannot go green by skipping. Verified by pointing detection at a fake ffmpeg with no ffprobe beside it.
- `choco install ffmpeg -y --no-progress` installs the current version; `--version=8.1.2` pins when a comparison is needed.
- The job has an always-run step that prints the ffmpeg version and the `frames:` line, so a log says which ffmpeg produced the bytes and what the capture bitmap looked like even when tests fail.
- PowerShell pipes are text streams and corrupt binary output. Write ffmpeg's raw pixels to a file and `Format-Hex` the file.
- Both jobs have `timeout-minutes` (20 for the checks, 60 for the Windows render job). A healthy Windows run takes about 6.5 minutes (run 40123690231; the 20-minute figure that stood here briefly came from failing runs waiting out their own timeouts), so the limit is nine times a healthy run: a job that reaches it is stuck, not slow, and fails within the hour instead of running to GitHub's six-hour limit.

### Paths and line endings

Three Windows-only failures, all the same shape: the app was fine and a test compared a string. **The shortcut: Windows-only, and it touches a path or a file read from the repo — look at the separator or the line endings first.**

- **Checkouts were CRLF, and a test that matched on `\n` found nothing (fixed, October 2026).** `tests/ui-style.test.ts` anchors a regex on the newline after a code fence in `docs/ui-style.md`; Git on `windows-latest` converts LF to CRLF on checkout by default, so the match failed. Both fixes are kept: `.gitattributes` declares `* text=auto eol=lf` (binary assets marked), and the test's file reader normalizes `\r\n` to `\n` anyway.
- **A fixture path was edited as a string with "/" (fixed, October 2026).** A store test built `join(root, 'broken', 'pack.json')` and then `.replace('broken/pack.json', …)`; `join` uses `\` on Windows, so the replace matched nothing and `writeFile` hit a folder that did not exist. Build fixture paths with `join` from their parts; never string-edit a joined path with a hard-coded separator.
- **A location shown in the window came out with backslashes (fixed, October 2026).** The Info tab's Location row read `boardroom\lower-third` where the test expected `boardroom/lower-third`. A string a person reads is a breadcrumb, not a path: `fileRows` splits on either separator and joins with `/` on every platform, and only the tooltip keeps the native path (the pack reader already did the same). **Rule:** anything derived from a path that is *displayed* or *compared in a test* is normalized to `/` where it stops being a path; anything handed back to the filesystem stays native.

### A sliver of a results list (fixed, October 2026)

Eleven UI end-to-end tests failed on `windows-latest` and nowhere else, over several runs, while the app was idle and answering at every failure. **The cause was the layout, not the machine.** The runner's window is about 1024 px wide, which wraps the search bar's chips to two lines and drops the results grid to two columns; once the collection tray opened, the stage's 60% share of what was left squeezed the results list to a few dozen pixels — about 25 at the window's minimum height. The tests sweep the windowed results by scrolling 0.8 of the viewport at a time, so each sweep of a 6,400 px list ran its full cap of 200 steps and still stopped short of the last rows. Every failing wait named an item that sorts to the end of the list.

- **App.** The results region keeps a minimum height (`--results-min-h`, 160 px); the stage shrinks first (`flex-shrink: 1`, clipped rather than painting over the results); the tray body is capped so the centre column keeps `--center-min-h` (440 px: the wrapped search bar, the results at their minimum and about 180 px of stage). A UI test emulates a 1024 × 697 and a 1024 × 600 window with the tray open and checks the three heights and that a sweep reaches the last item.
- **Test.** Sweeps step by at least 40 px, are bounded by how many steps the list actually holds rather than a fixed 200, and treat "within a pixel of the end" as the end — a fractional layout can leave `scrollTop` just under `scrollHeight - clientHeight` for ever.

**Shortcut for next time:** when a wait on a result times out, read the checks-to-seconds ratio before anything else. Three checks in 19 s means each check took about 6 s, and a check that slow is a sweep that ran long — which happens when the list is a sliver or the end is never recognized. The `results box` line in the failure dump gives the box's height, the row pitch and the column count. **A region a person could not use is a region a test cannot drive:** the fix belongs in the window, not in the test's patience.

### Hover-scrub strips (fixed, October 2026)

The strip test timed out on `windows-latest` only. Several causes, each enough on its own, and the fixes are all worth keeping:

- **Failures say why.** `hoverStrip` returns `{ url, reason?, transient? }` instead of a bare URL or null, logs the reason in the main process, and the test asks over the same IPC and fails with that reason.
- **Transient failures are not cached.** A load or frame timeout marks the capture `timedOut` and the item is not written off for it; only a definite failure (ffmpeg refused it, the template threw) is remembered. "Can have a strip" (`canHaveStrip`: a template or a video, ever) is separate from "can have one now" (`wantsStrip`: reachable and probed); only the first is a settled no.
- **Heavy work takes turns.** The poster queue and a hover strip were two offscreen 1080p renders competing for two cores. Both go through one chain in `library-service.ts`, the queue taking a turn per item.
- **No scratch folder, no numbered pattern.** The frames are piped to ffmpeg as one PNG stream (`-f image2pipe -c:v png -i pipe:0`) instead of going to a `mkdtemp` folder as `f-%03d.png` — a Windows path, a `%` pattern and an EBUSY-prone cleanup, all on the failing path.
- **Per-card dwell timers, and asking twice.** One shared dwell timer meant entering or leaving any card cancelled the request for the card the pointer had been on; and after a "not ready" the card waited for a `pointerenter` that, in a test that hovers once, never came. Each card has its own timer and asks again every second while the pointer stays on it.

Worth knowing for anything driven by hover on CI: a test dispatches one synthetic `pointerenter`, but the **real** cursor sits somewhere over the window, and scrolling content under it makes Chromium fire genuine `pointerleave` and `pointerenter` at whatever passes beneath. Shared state keyed to "the hovered card" gets cancelled by events the test never sent. `tests/dom/results.test.ts` covers the retry and the per-card timers without a browser.

### What a failing run says now

A Windows job was twice cancelled after about fifteen minutes having printed nothing, which reads as a stall; they were most likely slow failing runs, since Vitest's default reporter prints a file's results only when the file finishes and the end-to-end files take minutes each. A run that is merely slow and a run that is stuck look identical from such a log. The reporting was the problem, and these are the parts that make the next failure legible:

- **CI runs a reporter that names each test as it starts** (`tests/ci-reporter.ts`: the verbose reporter plus a `▶ hh:mm:ss file › test` line from `onTestCaseReady`), so a log ends on the test it is inside, not on the last one that finished. Locally the default reporter stays.
- **Waits are wall-clock budgets that name their condition.** 15 s by default, longer only where background work is expected; a wait that gives up says what it wanted, how long it waited and how many checks it made (`timed out waiting for the add button (15.0 s, 48 checks)`). A try count is not a budget: a slow check stretches it past the test's own timeout, and the test then dies without saying what never came true. Each DevTools eval has its own 10 s limit and fails with the call and expression named.
- **A failure dumps the app's state**: the window's visibility, size and whether its frame callbacks run; the results box's geometry; the library's background-queue diagnostics (`libraryDiagnostics`: what is being thumbnailed or probed, how much is waiting, which heavy job runs and for how long); the render queue; and the last 40 lines of the app's own output, which goes to a file kept for the run. A main-process exception is then in the log rather than discarded — that is how an unhandled `ENOENT … realpath 'D:\etc\hosts'` came out, from a `realpath` started before its cache folder was awaited.
- **Every process a test starts goes through one bounded runner** (`tests/e2e/process.ts`): stdin is `ignore`, never a pipe; every run has a time limit, and on reaching it the whole process tree is killed (`taskkill /T /F` on Windows, where `kill()` reaches only the direct child and Electron is several processes); a run whose child has exited but whose pipes are still held by a grandchild is given two seconds and then returned. `execFile` with `timeout` does neither of the last two. The UI suite's teardown kills the tree as well.
- **ffmpeg is always started with `-nostdin`.** It polls its input for commands, so a probe spawned with stdin as a pipe nobody writes to is never allowed to be what the suite waits on.

### A test that emulates a window size, on a display smaller than the sizes it emulates (fixed, October 2026)

The runner's desktop is about 1024 px wide, and three UI tests failed there in a chain that starts with one wrong wait.

- **`Emulation.clearDeviceMetricsOverride` restores the *window*, not the size you emulated.** The preview-distortion test emulated 1400 × 900 and then waited for `window.innerWidth > 1024` to confirm it was back. On a 1024-px display that is never true, and the test timed out having already put everything back. **Rule: read the window's own size before emulating, and wait for exactly that.** The short-window test does the same.
- **A frame with no room on screen runs no animation frames**, and the preview is drawn on a reply that needs two of them (`BRIDGE_SCRIPT`). Collapse the stage, squeeze it to nothing, or shrink the window until the preview box has no height, and the page never answers `pulp:render`. The host's `inFlight` flag then stuck for the rest of the session: **every later frame was parked and the preview showed one stale picture**, which is what made the two layers tests fail — one waiting for a line it had added, the other for the card to be drawn tall. Reproduced locally by collapsing the stage: a layer added while collapsed does not appear until the stage has room again. The stage now gives each request a four-second watchdog, drops the one in flight when no reply comes, and asks again, so the preview catches up by itself.
- **A test that leaves the window, the selection or the Output tab somewhere unusual breaks the tests after it**, and a test that fails leaves them there. Put all of it back in the `finally`, not after the last assertion.
- **Reading a canvas is reading the *last* frame drawn, not the current state.** A wait for what the picture should become says, when it gives up, what it last was; a bare assertion a moment after a change is a race on a slow machine.

### A font the template page could not load, and a frame that waited for it (fixed, October 2026)

Four layers tests failed on `windows-latest` and nowhere else: one waiting 30 s for a bundled font to load in a template page, two for a line that never appeared in the preview, and one finding a layer an earlier test had left behind.

- **A font load is a CORS request, even to the page's own origin.** Traced on macOS: the request for `/__pulp/fonts/…` carries an `Origin:` header, and a privileged custom scheme enforces CORS (see "Electron custom protocols"). Same-origin passed on macOS with no `Access-Control-Allow-Origin` in the answer; it did not on Windows. Two custom-scheme origins comparing equal is not something to rely on: the bundled fonts now answer with `Access-Control-Allow-Origin: *` on both routes, and `font-src` names `pulp-template:` as well as `'self'` so the reserved path is reachable however the origin is computed. This widens nothing — a template page can already read its own folder.
- **One font that will not load must not stop the drawing.** The bridge loads a text layer's face before the frame that uses it, because canvas text never triggers a load; it waited on `document.fonts.load` with no bound, so a face that never settled meant no frame was ever drawn, and every added line was invisible. The wait is now three seconds, after which the frame is drawn in the fallback face and a later frame picks the real one up. **Anything a frame waits for needs a bound**; the preview's own reply watchdog (above) is the same lesson.
- **A test that fails part way leaves its edits behind.** The fourth failure was only the wreckage of the second: a layer added and never removed. Every layers test now puts the template's own layers back in a `finally`.

### A canvas read after a guessed wait shows the previous frame (fixed, October 2026)

Four layers tests failed on `windows-latest` with pictures that were one change behind: "expected 2 bands and saw 3" right after a scrub to an earlier frame, a lower third at its first frame still showing the three lines of the frame before, a title still set in Georgia after Oswald had loaded. Each read the canvas after a fixed sleep — 800 ms after a scrub — which a Mac meets with time to spare and a two-core runner does not: a Title Card frame measures its text through up to eleven shrink steps, the lower third lays its stack out twice, and the first frame after a font change waits for the face. **The removal, the hide and the font all reached the preview; the test looked before the frame landed.**

- **The page now says what it has drawn.** After its two animation frames the bridge sets `window.__pulp.drawn = { frame, at, layers }`, and the tests' `scrubAndWait` waits for *that frame* rather than for a number of milliseconds, with the layer count as a direct check that the stack a frame carried is the one the test built. The stage puts its own state on `#preview-frame` (`data-frame`, `data-in-flight`, `data-pending`, `data-watchdog`), and a failing test prints both, with the template page's font statuses, so the next log says whether a frame was asked for, answered, or let go.
- **Rule:** never read a canvas after a sleep. Wait for the frame you changed, by its number; a sleep is a guess about a machine you are not on.
- The one failure that was not a race — the leftover layer that made "organises the tab" find an extra card — was the wreckage of a test that failed before its cleanup. Every layers test puts the template's own layers back in a `finally`.

### A throttled renderer runs no animation frames at all (fixed, October 2026)

Once the tests waited for `window.__pulp.drawn` (above), five layers tests timed out on `windows-latest` with the frame never drawn: `data-in-flight` stuck at true, the watchdog count climbing with every request, `drawn` still null — and in most dumps **no fonts even requested**, so the page had not reached the draw. The window reported itself visible and focused, yet the renderer behaved exactly as the "no room on screen" case: no animation frame ever ran. Chromium throttles rendering for a window it believes occluded — which a CI runner's desktop, with no one watching it, can be — and for an offscreen cross-origin frame, and `requestAnimationFrame` then never fires, however visible the DOM says it is. Two fixes, each sufficient for the preview:

- **`backgroundThrottling: false` on the window.** The preview answers frame requests through animation frames; a window that stops running them cannot answer. Pulp is a tool whose window may well be occluded while it renders, so this is right beyond CI.
- **The bridge's two-frame wait is bounded**, like every other wait in a frame's path: the draw itself has already happened synchronously when the wait starts, so after 250 ms the frame is declared drawn rather than held forever. A healthy page resolves on the second animation frame long before that; an in-page `getImageData` reads the canvas's backing store, which holds the draw whether or not a compositor frame ever carried it.

### A squeezed stage left the picture 2 px tall (fixed, October 2026)

The sequel to the entry below, and the real cause. With the collection tray open on the CI window — 1008 × 655 — the stage region is about 178 px tall, and its own chrome took all of it: the transport 34 px, the tools 68, the item row 58. The picture was left **0 px**, so `.preview` fell under its "no room" rule and went `visibility: hidden`, the layer overlay measured 0 × 0, and a click on the stage had nothing to hit. Everything upstream looked healthy — the frame drew, the overlay was active, the report matched — which is why the first fix aimed at hit-testing and missed.

The picture is why the stage is there, so it now keeps a floor of 96 px and the chrome gives way first (`.stage > .stage-tools, .stage > .item-row` shrink and clip). Below even that the stage says so rather than showing nothing. The overlay also refuses to be active when its box has no width, so a click cannot silently do nothing.

**Rule: when a region runs out of room, decide what it is for and let the rest yield.** A flex column whose main content has `min-height: 0` will give every pixel to its chrome without a word.

The end-to-end test now runs this interaction at that exact geometry — small window, tray open — so the squeeze is a case the suite covers rather than a surprise CI finds.

### Clicking a layer on the stage missed it on Windows (fixed, October 2026)

The stage's handles (milestone 25) worked on macOS and Ubuntu and failed on `windows-latest`: the end-to-end test clicked the drawn title and nothing was selected. Two things were wrong, and the runner's window — 1008 × 655, so a 1920-pixel frame previewed about 157 px wide — is what exposed both.

- **The overlay hit-tests the last report the page sent it, which can lag the frame on screen.** The bridge sets `window.__pulp.drawn` and *then* posts `pulp:rendered` with what it laid, so a test (or a person) that acts the moment `drawn` says the frame is there can click while the overlay still holds the previous frame's boxes. The report now carries the frame it describes, the overlay publishes it as `data-laid-frame`, and the test waits for the overlay to catch up. **Rule: a reply that two parties must agree on has to say which frame it is about.**
- **A pixel-exact hit is an aim nobody has.** At 157 px wide, a line of type is a few screen pixels tall and a thin one is barely one. Hit-testing now forgives four screen pixels' worth of frame pixels, which is the difference between selecting a subtitle and not, on any small window.

The test also assumed the frame was 1920 wide when mapping a click; it reads the preview's real size now, so a portrait aspect cannot throw the mapping off.

### A VP9 alpha file reports `yuv420p`, and always will

Checking a transparent WebM with `ffprobe -show_entries stream=pix_fmt` says `yuv420p`, on every build, for a file that carries a perfectly good alpha channel — including the ones Pulp's own verified `webm-vp9-alpha` preset writes. VP9 keeps alpha as a **separate layer in the container**, not in the coded frame's pixel format, so the frame's own format never says `yuva420p` however the encoder was asked.

Two things do say it, and the tests use both:

- the container's tag, `alpha_mode=1` (`ffprobe -show_entries stream_tags=alpha_mode`);
- decoding with **libvpx-vp9** explicitly (`-c:v libvpx-vp9`) and reading the alpha out. The native VP9 decoder ignores the alpha layer and hands back opaque pixels, so a check that forgets the decoder quietly passes on a file with no transparency at all.

Milestone 26's generated assets are checked that way. (`-pix_fmt yuva420p` on the command line is not the lever either; it is accepted and changes nothing.)

### Deleting a folder a process just used fails with EBUSY

Windows refuses to delete a file or folder while any process holds a handle open; macOS and Linux unlink immediately and let the process keep its handle. The UI test's cleanup killed the app and deleted its scratch user data folder in the next statement, and the job failed on `EBUSY: resource busy or locked` with every test green. `child.kill()` returns before the process is gone, and Chromium's GPU and renderer helpers can outlive the main process by a moment, each holding profile files (LevelDB, caches, the lock file). Fix in both end-to-end files: wait for the child's `exit` event (with a timeout), then `fs.rm` with `maxRetries` and `retryDelay`, which Node retries on EBUSY, ENOTEMPTY and EPERM. Apply the same to any folder a just-finished ffmpeg or Electron process wrote into.

## macOS

- A Retina display reports scale 2 while the offscreen window stays at 1; this is the implicit default made explicit above.
- GUI apps do not inherit the shell `PATH`; `detectFfmpeg` checks the Homebrew locations as well.
- QuickTime's documented `nclc` transfer values are 1 (BT.709), 7 (SMPTE 240M) and 2 (unknown), with 8 and above reserved (Apple TN2162). An sRGB transfer tag is handled unevenly, which is why video output is tagged BT.709 (ADR 0004).
- `hevc_videotoolbox` and `prores_videotoolbox` exist only here.

## Test design lessons

- Read pixels from the *first* frame somewhere, not only from later ones, and use at least one fixture whose frames differ. The stale-capture bug hid for four days behind tests that read `frames[1]` and fixtures that draw the same picture every frame.
- When a job passes unexpectedly, check that the path under test actually ran: the first "fixed" Windows run had silently fallen back to PNG frames because the capture probe failed. The `frames:` line and the raw-path assertion exist for that.
- Generate binary fixtures, do not hand-write them. A base64 "2x2 PNG" typed into a test had a damaged zlib stream; Chromium's image decoder showed it anyway, ffmpeg refused it, and the thumbnail test waited for a file that was correctly recorded as failed. Build fixtures with code (`zlib`, ffmpeg) and let a strict reader check them.
- **A screenshot or probe script that throws leaves its Electron app running.** A capture helper used a fixed `--remote-debugging-port`; when it crashed before its `kill`, the next run's `fetch(/json)` found the *old* app on that port and drove it, showing state nobody had set in this run (a stale search term) and looking for all the world like a startup bug. Kill the child in a `finally`, or use a random port like the end-to-end tests do, and `pkill -f remote-debugging-port` before believing a surprising screenshot.
- Do not share fixed scratch paths between sessions. Several git worktrees of this repo can run tests at the same time on one machine, and a fixed name such as `/tmp/pulp-test.log` is then written by all of them: one gate here read another worktree's failing run and showed a test that did not exist in this tree. Use `mktemp` for logs, commit-message files **and throwaway helper scripts**, and gate commits on the test process's exit status, never on grepping a log. A screenshot helper left at `/tmp/pulp-shot/shoot.mjs` was overwritten by another worktree's between two runs; the second screenshot showed a library nobody in this session had configured, which reads exactly like an application bug.
- **Wait for the things a test asserts on, not for a count of anything.** The thumbnail test waited for "at least five loaded thumbnails" and then checked five named items. That held while the library had about five visual items; after ten more templates arrived, a slow Windows runner finished five *other* posters first and the check ran too early, while macOS was fast enough to pass. Background work completes in its own order and at the machine's pace: name the items in the wait, and size the budget for the slowest runner, not the local one.
- Reproduce a platform failure locally before theorizing. The static ffmpeg 9 build settled "ffmpeg or Windows" in minutes both times; once it was ffmpeg, once it was not.
