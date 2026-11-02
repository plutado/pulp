# Packaging

Status: milestone 17, in progress. The macOS build is here; the Windows installer, the Linux AppImage and the release workflow are the milestone's remaining items. Signing and notarization are milestone 7.

## Building

```sh
npm run package:mac      # a universal .app, a .dmg and a .zip in release/
```

It builds the app first (`npm run build`), then runs electron-builder with [`electron-builder.yml`](../electron-builder.yml), which is commented and is the place to read the detail. The output lands in `release/`, which is not committed.

The first build downloads Electron for **both** architectures — about 400 MB — and takes a few minutes; afterwards they are cached and it takes about one.

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
| `THIRD_PARTY_NOTICES.md`, `LICENSE` | What Pulp is built on, and its own licence |

**One module knows where they are**: [`src/main/resources.ts`](../src/main/resources.ts) answers for each, in a checkout and in a packaged app alike. `tests/packaging.test.ts` holds the two together — a folder renamed on either side fails there rather than in a download.

## The icon

Pulp's own mark: a lower third — the thing Pulp makes most — on a dark tile, in the window's own colours. An amber bar stands at the left, a bright bar for the name beside it, a shorter dimmer one for the title under that. At 16 px the three still read as a strap of type.

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

## Checking a build

The app's own command line is the quickest proof that a packaged build found everything:

```sh
release/mac-universal/Pulp.app/Contents/MacOS/Pulp \
  --render pulp.samples.lower-third-bar --preset png-sequence --out /tmp/check
```

A render proves the templates, the fonts and the capture pipeline; rendering a bundled Lottie by its id proves the player file as well.
