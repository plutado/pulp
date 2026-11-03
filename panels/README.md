# Panels

The Pulp panel inside the editing apps (milestone 54). `shared/` is the panel
page both hosts load; `premiere/` and `resolve/` are the host wrappers — a CEP
manifest for Premiere Pro, a Workflow Integration plugin for DaVinci Resolve
Studio. `node scripts/install-panels.mjs` assembles and installs them.

How they are installed and how the connection works: [docs/editor-panels.md](../docs/editor-panels.md).
