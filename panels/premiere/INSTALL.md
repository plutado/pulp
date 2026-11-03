# Installing the Pulp panel in Premiere Pro

This folder is a CEP extension: Premiere Pro loads it as **Window → Extensions → Pulp**.
It talks only to the Pulp app running on this machine (127.0.0.1), and nothing leaves it.

## From the signed `.zxp`

Install `pulp-panel-premiere-<version>.zxp` with an extension manager — Anastasiy's
Extension Manager, or Adobe's `ExManCmd --install <file>.zxp`. Restart Premiere Pro.

## From the `.zip`, or this folder

1. Put this folder where Premiere looks for extensions, named `com.pulp.panel`:
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/com.pulp.panel`
   - Windows: `%APPDATA%\Adobe\CEP\extensions\com.pulp.panel`
2. The folder is unsigned, so tell CEP to load unsigned extensions (once per CEP version;
   Premiere 2024 is CEP 11, Premiere 2025 is CEP 12 — setting both is harmless):
   - macOS: `defaults write com.adobe.CSXS.11 PlayerDebugMode 1` and the same for `CSXS.12`
   - Windows: `reg add HKCU\SOFTWARE\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f`, and `CSXS.12`
3. Restart Premiere Pro: **Window → Extensions → Pulp**.

## Then, in Pulp

Open Pulp and turn on **Settings → Serve the editor panel (local)**. The panel finds Pulp by
itself; **Reconnect** in its header reads the connection again after Pulp restarts.

## Uninstall

Remove the folder (or uninstall the `.zxp` with the same manager). Pulp needs nothing undone.

The full guide, with what each button does: `docs/editor-panels.md` in Pulp's repository.
