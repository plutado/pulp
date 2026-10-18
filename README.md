# Pulp

Pulp is a desktop app for video editors who use motion-graphics templates: lower thirds, titles, transitions and overlays. You browse a library of templates, preview them, change their text, colors and fonts, and render them to files your editing software can use, including formats that keep the alpha channel so the graphic sits on top of your footage.

Templates use an open, documented format: a folder with a `template.json` manifest and an HTML/Canvas animation. Anyone can write one with a text editor, and there is no lock-in to a store or a subscription. Pulp also indexes your own media folders so templates and footage can be searched together.

"Pulp" is a working name and may change.

**Status: early development.** The core library, the template format, a basic UI and a first working renderer exist. Expect breaking changes to the format and the app until 1.0. See [ROADMAP.md](ROADMAP.md).

## Who it is for

- Solo editors and YouTubers who need clean, consistent graphics without opening a motion-design app for every name strap.
- Small studios that want a shared, versionable library of house-style templates.
- Anyone who writes HTML/Canvas and wants to make templates for editors.

## What works today

- Library scan of the bundled samples and any folders you add: templates are validated, media files (video, image, audio) are indexed with tags derived from folder names.
- Search with free text plus `tag:`, `type:` and `category:` filters.
- Live preview with play and scrub, and a parameter form generated from the manifest.
- Rendering through ffmpeg to ProRes 4444 (alpha), ProRes 422 HQ, PNG sequence (alpha), WebM VP9 (alpha) and H.264 MP4. Verified on macOS with the bundled samples; see the roadmap for what is not yet verified.
- A headless command-line render mode (below).

Not yet: drag-out to editing apps, template pack import, media preview, user tags, installers. These are on the [roadmap](ROADMAP.md).

## Template format

The format is specified in [docs/template-format.md](docs/template-format.md). Three original sample templates live in [`templates/`](templates/) and are released under CC0 1.0.

## Built with

- Electron and TypeScript, built with electron-vite (Vite)
- A pure TypeScript core in `src/core` (manifest validation, parameter resolution, library indexer, search, render planning), tested with Vitest without Electron
- ffmpeg for encoding (installed separately)

Design notes: [docs/system-design.md](docs/system-design.md). Decisions: [docs/decisions/](docs/decisions/).

## Running it

Requirements: Node.js 22 or newer, npm 10 or newer, and ffmpeg on your PATH for rendering (macOS: `brew install ffmpeg`; Windows: `winget install Gyan.FFmpeg`; Linux: your package manager). The app runs without ffmpeg, but the Render button stays disabled and explains why.

```sh
npm install
npm run dev        # start the app with hot reload
npm test           # unit tests (no Electron or ffmpeg needed)
npm run lint       # eslint + TypeScript type checks
npm run build      # production build into out/
```

The first `npm run dev` downloads the Electron binary.

If ffmpeg is installed somewhere unusual, set `PULP_FFMPEG_PATH` to the full path of the executable.

### Headless rendering

After `npm run build`, templates can be rendered without the UI:

```sh
npx electron . --render pulp.samples.lower-third-bar --preset prores-4444 \
  --out renders/lower-third.mov --param "name=Sam Okafor" --param side=right
```

Preset ids: `prores-4444`, `prores-422hq`, `png-sequence`, `webm-vp9-alpha`, `h264-mp4`.

## Project layout

```
src/core/       pure TypeScript: format, params, library, search, render planning, ffmpeg detection
src/main/       Electron main process: window, IPC, template protocol, renderer
src/preload/    the window.pulp API exposed to the UI
src/renderer/   UI (plain TypeScript and DOM)
src/shared/     types shared by preload and UI
templates/      bundled sample templates (CC0)
tests/          Vitest tests for src/core and the samples
docs/           specification, design, decisions
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code: MIT, see [LICENSE](LICENSE). Sample templates: CC0 1.0, see [templates/LICENSE-CC0.txt](templates/LICENSE-CC0.txt). Pulp does not ship third-party media; templates and media you add stay under their own licenses.
