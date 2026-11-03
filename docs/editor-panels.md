# The editor panels

A Pulp panel inside Premiere Pro and inside DaVinci Resolve Studio
(milestone 54): the library and the collection of the Pulp running on this
machine, browsed and searched without leaving the editing app. Today the
panels list; rendering from the panel and dropping into the edit are the
milestone's later items.

Nothing leaves the machine. The panels talk to Pulp over `127.0.0.1` only,
and every request carries a token Pulp writes to a file beside its settings —
readable only by you — while the setting is on (decision record
[0025](decisions/0025-panel-bridge-loopback-http-with-a-file-held-token.md)).

## Turning it on in Pulp

Open **Settings** and tick **Serve the editor panel (local)**. The line under
it says where Pulp is listening. It is off by default, and nothing listens
while it is off. Pulp must be running for the panels to have anything to show.

## Installing the panels

From a checkout:

```sh
npm run panels:install              # both panels
npm run panels:install -- --premiere
npm run panels:install -- --resolve
npm run panels:install -- --uninstall
```

The script assembles each panel from `panels/shared` (the page itself, shared
by both hosts) plus the host's wrapper, and copies it where the host looks.

### Premiere Pro

The panel is a CEP extension, installed per user:

- macOS: `~/Library/Application Support/Adobe/CEP/extensions/com.pulp.panel`
- Windows: `%APPDATA%\Adobe\CEP\extensions\com.pulp.panel`

It is unsigned, so CEP must be told once (per CEP major version) to load
unsigned extensions — the same PlayerDebugMode every unsigned panel needs:

```sh
# macOS — Premiere 2024 uses CEP 11, Premiere 2025 uses CEP 12; setting both is harmless
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

```bat
:: Windows
reg add HKCU\SOFTWARE\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\SOFTWARE\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

Restart Premiere Pro, then **Window → Extensions → Pulp**. A signed `.zxp`,
which needs none of this, comes with the milestone's packaging item.

### DaVinci Resolve

The panel is a Workflow Integration plugin — a **Resolve Studio** feature; the
free edition does not load them. It installs machine-wide, which may need
elevation (the script says so rather than half-installing):

- macOS: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.pulp.panel`
  (run the script with `sudo` if that folder is not yours to write)
- Windows: `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.pulp.panel`

Restart Resolve, then **Workspace → Workflow Integrations → Pulp**.

`WorkflowIntegration.node` is Resolve's own native module, shipped with its
developer sample and not something Pulp may redistribute; the install script
copies it into the panel where it finds the sample installed. Listing needs
none of it — the panel says nothing about it either way — but the milestone's
later items (dropping onto the timeline at the playhead) will use it.

## Using the panel

The panel connects to the running Pulp by itself and says so in its header;
**Reconnect** reads the discovery file again after Pulp restarts. The search
field speaks Pulp's own query syntax — `type:lower-third`, `mood:calm`,
`alpha:yes`, free text — because it *is* Pulp's own search, answered by the
app over the bridge. The collection section mirrors the tray in Pulp's
window, with items the library has lost marked missing rather than dropped.

If the panel says Pulp is not reachable: Pulp is not running, or the setting
is off, or Pulp was restarted (the port and token change each start —
Reconnect). The bridge file it reads is `panel-bridge.json` beside Pulp's
settings; Pulp's Settings window names the exact path.

## How it connects

Pulp's main process listens on a loopback-only HTTP port chosen by the
system. Port and token are written to `panel-bridge.json` (mode 0600) while
the setting is on, and removed when it goes off or Pulp quits. Every request
must carry the token in the `x-pulp-token` header; anything without it — for
instance a web page, which can reach 127.0.0.1 but cannot read your files —
gets a 401 and nothing else. Answers name items by library id and never carry
paths. The protocol is versioned; `src/core/panel-bridge.ts` is its one
definition, and `tests/panel-bridge.test.ts` speaks it end to end over a real
socket.
