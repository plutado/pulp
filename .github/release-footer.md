### These builds are unsigned

Signing and notarization are still to come, so the first open of each takes a step:

- **macOS** — the `.dmg` is quarantined until it is opened once from the Finder's context menu (Control-click → Open), or until `xattr -dr com.apple.quarantine /Applications/Pulp.app` is run on it.
- **Windows** — SmartScreen shows "Windows protected your PC"; **More info** → **Run anyway**.
- **Linux** — make the AppImage executable (`chmod +x Pulp-*.AppImage`) and run it.

Check a download against `SHA256SUMS.txt`, attached here with the files.

### FFmpeg

Pulp renders with FFmpeg and does not ship it. Install your own — `brew install ffmpeg`, `winget install Gyan.FFmpeg`, or your package manager — or let Pulp fetch a build for you: **Settings → FFmpeg → Download FFmpeg**, which says what it would fetch, from whom, how big it is and under what licence before anything is fetched (decision record 0022).
