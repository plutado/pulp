# Packaging

Status: milestone 17. All three platforms build, a workflow drafts a release from a tag, and Pulp can fetch an FFmpeg for the machine that has none. Signing and notarization are milestone 7, and the builds say so where a person meets them.

## Building

```sh
npm run package:mac      # a universal .app, a .dmg and a .zip in release/
npm run package:win      # an NSIS installer, on Windows
npm run package:linux    # an AppImage, on Linux
```

Each builds the app first (`npm run build`), then runs electron-builder with [`electron-builder.yml`](../electron-builder.yml), which is commented and is the place to read the detail. The output lands in `release/`, which is not committed.

**Each platform is built on itself.** Cross-building is possible for some targets and is not done here: a Windows installer wants Windows to sign and stamp it when milestone 7 arrives, and an AppImage wants a Linux tool chain rather than a container to borrow one. The release workflow runs the three in parallel on their own runners.

Every artifact is named the same way — `Pulp-<version>-<os>-<arch>.<ext>`, with `Setup` in the installer's — since they all land on one release page together.

The first build downloads Electron for **both** macOS architectures — about 400 MB — and takes a few minutes; afterwards they are cached and it takes about one.

## What is in the app, and what is not

The app bundle holds `out/` — everything the main, preload and renderer code imports, bundled by electron-vite — and **no `node_modules`**. The built main process requires nothing but `electron` and Node's own modules, so there is nothing to carry. That has to be said outright in the config, because electron-builder copies the production dependency tree unless told not to: here that meant pdf.js's native canvas, which Pulp never calls, and which stopped the universal build outright by differing between the two architectures.

What Pulp reads at run time is copied into the application's `Resources/` instead:

| In `Resources/` | What it is |
|---|---|
| `templates/` | The bundled CC0 templates, shown in the library as "Built-in templates" |
| `fonts/` | The ten OFL families every template page is given (ADR 0014) |
| `examples/` | The example projects the start screen opens as copies |
| `pdfjs/` | pdf.js's `pdf.min.mjs` and `pdf.worker.min.mjs`, read as text into the sandboxed rasterizer (milestone 33) |
| `lottie/` | lottie-web's `lottie_light.min.js`, served to a Lottie's own page (milestone 35) |
| `THIRD_PARTY_NOTICES.md`, `LICENSE` | What Pulp is built on, and its own license |

**One module knows where they are**: [`src/main/resources.ts`](../src/main/resources.ts) answers for each, in a checkout and in a packaged app alike. `tests/packaging.test.ts` holds the two together — a folder renamed on either side fails there rather than in a download.

## The icon

Pulp's own mark: a lower third — the thing Pulp makes most — on a dark tile, in the window's own colors. An amber bar stands at the left, a bright bar for the name beside it, a shorter dimmer one for the title under that. At 16 px the three still read as a strap of type.

```sh
npm run icon     # redraws build/icon.icns, build/icon.ico and build/icons/*.png
```

`scripts/make-icon.mjs` draws it on a canvas in a hidden page and writes the three containers; the files are committed, since a build cannot draw them. Change the drawing there and run it again.

## macOS: universal, hardened, unsigned

One build runs on both Intel and Apple Silicon: electron-builder packs each architecture and merges them (`arch: [universal]`).

**Unsigned here means ad-hoc.** `identity: "-"` is a real signature over the bundle with no identity behind it — nothing Apple issued, no team — which is the least Apple Silicon will launch. It is also what lets the **hardened runtime** be applied: that is a signing option, so with signing skipped outright it would be written in the config and do nothing. With this it is really on:

```
$ codesign -dv --verbose=2 release/mac-universal/Pulp.app
Identifier=com.davidfugate.pulp
CodeDirectory v=20500 flags=0x10002(adhoc,runtime)
Signature=adhoc
```

The entitlements ([`build/entitlements.mac.plist`](../build/entitlements.mac.plist)) are what Electron needs under it — a JIT for V8 and the unsigned executable memory Chromium's renderers use — plus library validation off, which ad-hoc signing requires and which also lets ffmpeg and whisper.cpp run as children of the app. None of them is about the network: Pulp asks for no network entitlement.

**What a person downloading it sees.** macOS quarantines anything downloaded that is not notarized, so a `.dmg` from a release page is refused on the first open. Opening it from the Finder's context menu once, or

```sh
xattr -dr com.apple.quarantine /Applications/Pulp.app
```

gets past it. That is the cost of being unsigned, and it goes away with milestone 7.

## Windows: an NSIS installer, unsigned

`npm run package:win` makes `Pulp-<version>-windows-x64-Setup.exe`. It is the ordinary kind of installer rather than a one-click one: it asks where to go, and offers a desktop shortcut and a Start menu one, both named **Pulp** — which is also what the task bar and the task manager show, since `executableName: Pulp` names the binary rather than the project folder.

It installs **per user**, so there is no administrator prompt: Pulp writes nothing outside its own folders. Uninstalling leaves the app data behind (`deleteAppDataOnUninstall: false`) — the library index, the settings, the render cache and any FFmpeg Pulp fetched are the person's, not the installer's.

x64 only. Windows on ARM runs x64 applications under its own emulation, and a second installer to choose wrongly from is worse than the emulation.

**What a person downloading it sees.** Windows has no ad-hoc signature the way macOS does, so the installer is unsigned outright and SmartScreen shows "Windows protected your PC" on the first run: **More info** → **Run anyway**. A code-signing certificate is milestone 7.

## Linux: an AppImage

`npm run package:linux` makes `Pulp-<version>-linux-x64.AppImage`, which runs on any desktop distribution without being installed: `chmod +x` it and run it.

The `.desktop` entry inside it puts Pulp in the application menu with its icon (the PNG sizes in `build/icons`) under **AudioVideo / Video / AudioVideoEditing / Graphics**, with the words someone would search a launcher for. `StartupWMClass: Pulp` matches the class the window really reports, without which a dock shows the AppImage's generic icon beside the running app instead of grouping them.

## A double-clicked project opens in Pulp

`fileAssociations` registers `.pulp` and `.pulpcollection` with each build: macOS writes them into the bundle's `Info.plist`, the installer registers them for the user on Windows, and the AppImage's `.desktop` entry carries their MIME types. The two extensions live in `src/core/open-file.ts`, which the file dialogs and the reader use too, and the packaging test holds the config to them.

How the path arrives differs by platform, and the main process reads all three down to one: macOS sends an `open-file` event (before `ready`, when the file is what launched the app); Windows and Linux start a second copy of the app with the path among its arguments, so Pulp holds the **single-instance lock** — the second copy hands its arguments to the first and exits — and `projectFileArg` finds the file among them, past flags and their values and back from a `file://` URL. The window opens it through the same opener as File → Open, so unsaved changes are asked about first. A headless render (`--render`) takes no lock, so several can run at once beside an open window.

## The release workflow

[`.github/workflows/release.yml`](../.github/workflows/release.yml) builds all three on a tag `v*` — the tag `npm run release` makes — and **drafts** a release with them:

- three jobs in parallel, one per platform, each on its own runner, with the Electron binaries cached between releases;
- a check that the tag matches the version in `package.json`, since a tag and a release commit that came apart would otherwise ship a build naming the wrong version;
- `electron-builder --publish never`, so nothing uploads itself;
- a fourth job that gathers the artifacts, writes `SHA256SUMS.txt` beside them — unsigned builds are worth checking — and creates the release **as a draft**, with the notes from the changelog's own section for that version ([`scripts/release-notes.mjs`](../scripts/release-notes.mjs)) followed by [`.github/release-footer.md`](../.github/release-footer.md), which is what an unsigned build and a missing FFmpeg ask of a person.

Nothing is published: the draft waits for someone to read it over and press the button. `workflow_dispatch` runs the same thing without a tag, for a second attempt after a failed one.

## FFmpeg is not in any of them

No installer carries FFmpeg, and the first answer is still the one the README gives: install your own. Where there is none, **Settings → FFmpeg** offers to fetch a build for this machine — which build, from whom, how big and under what license, all said before the button is pressed. What arrives is hashed as it arrives, refused unless it matches the pinned checksum, run once to prove it starts, and kept in `ffmpeg/` beside the settings, where Pulp looks **last**, after your PATH and `PULP_FFMPEG_PATH`.

The catalog is `src/core/ffmpeg-download.ts` and the fetching is `src/main/ffmpeg-service.ts`; why it is a fetch rather than something in the installers — and why an LGPL build in them would be a worse Pulp, quietly — is [decision record 0022](decisions/0022-ffmpeg-fetched-on-request-rather-than-bundled.md).

## Checking a build

The app's own command line is the quickest proof that a packaged build found everything:

```sh
release/mac-universal/Pulp.app/Contents/MacOS/Pulp \
  --render pulp.samples.lower-third-bar --preset png-sequence --out /tmp/check
```

A render proves the templates, the fonts and the capture pipeline; rendering a bundled Lottie by its id proves the player file as well. On Windows and Linux the same flags work on the installed `Pulp.exe` and on the AppImage.
