# 0001. Electron for the desktop shell

Date: 2026-10-18
Status: Accepted

## Context

Pulp is a desktop app: it reads large local media folders, runs ffmpeg, and must work offline. The two realistic cross-platform options were Electron and Tauri.

The renderer has a hard requirement: it must render a template frame to pixels identically on every platform, headless, with alpha. Templates are HTML/Canvas (ADR 0002), so this means "a browser engine we control".

## Decision

Use Electron with TypeScript, built with electron-vite.

## Reasons

- **One engine everywhere.** Electron bundles Chromium, so preview and render output are the same on macOS, Windows and Linux. Tauri uses the system webview (WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux), which differ in Canvas text rendering, color handling and offscreen capture. For a tool whose output is pixels, that variance is a correctness problem.
- **Offscreen capture with alpha is built in.** `BrowserWindow` with `offscreen: true` and `transparent: true` plus `capturePage()` gives RGBA frames without extra native code. Tauri has no equivalent cross-platform API; it would need a separate headless browser anyway.
- **Single language.** Main process, UI, core logic and templates are all TypeScript/JavaScript. Tauri requires Rust for the backend, which the current development environment does not have and which raises the bar for contributors.
- **Mature packaging.** electron-builder covers signing, notarization and auto-update for all three platforms.

## Costs

- Larger download (about 100 MB+) and higher memory use than Tauri.
- Chromium security updates must be tracked by updating Electron regularly.
- Two Chromium instances during render (UI plus offscreen window).

## Revisit if

- Tauri or the system webviews gain reliable, identical offscreen RGBA capture, or
- the renderer moves out of the browser (for example to a native Canvas implementation), making the UI shell choice independent of output fidelity.
