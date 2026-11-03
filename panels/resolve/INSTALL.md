# Installing the Pulp panel in DaVinci Resolve Studio

This folder is a Workflow Integration plugin: Resolve **Studio** lists it as
**Workspace → Workflow Integrations → Pulp**. Workflow Integrations are a Studio feature;
the free edition does not load them. The panel talks only to the Pulp app running on this
machine (127.0.0.1), and nothing leaves it.

## Install

1. Put this folder, named `com.pulp.panel`, in Resolve's plugins folder (the zip unpacks
   to that name already; the folder may need creating, and writing to it may need an
   administrator — `sudo` on macOS):
   - macOS: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/`
   - Windows: `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\`
2. Copy Resolve's own `WorkflowIntegration.node` into the folder. It is Blackmagic's and is
   not in this package; Resolve ships it with its developer sample:
   - macOS: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node`
   - Windows: `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node`
   (Help → Documentation → Developer in Resolve opens the folder.) Without it the panel still
   lists, searches, opens items in Pulp and drags files; the Bin and Append buttons need it.
3. Restart Resolve: **Workspace → Workflow Integrations → Pulp**.

## Then, in Pulp

Open Pulp and turn on **Settings → Serve the editor panel (local)**. The panel finds Pulp by
itself; **Reconnect** in its header reads the connection again after Pulp restarts.

## Uninstall

Remove the folder. Pulp needs nothing undone.

The full guide, with what each button does: `docs/editor-panels.md` in Pulp's repository.
