# 0025. The editor panels talk to Pulp over loopback HTTP, opened by a token held in a user-only file

Date: 2026-11-03
Status: Accepted

## Context

Milestone 54 puts Pulp's library inside the editing apps: a panel in Premiere
Pro and one in DaVinci Resolve, listing what Pulp has, with rendering and
dropping into the edit to follow. The panels run inside other people's
processes — Premiere's CEP is its own Chromium, Resolve's Workflow
Integrations are its own Electron — so Pulp's IPC, preload and custom
protocols reach none of them. They need a connection that crosses processes
on one machine, and the project's standing promise has to survive it:
everything stays on the machine, and the app can say so truthfully.

Two things can reach a local listener that should get nothing: other local
processes, and — because browsers happily fetch `http://127.0.0.1` — any web
page open in any browser. A plain local port would hand either of them the
library's names the moment they guessed the number.

The candidates: a WebSocket or HTTP server on loopback; a Unix domain
socket / named pipe; files written and polled; or each host's own extensibility
talking to Pulp's CLI. Sockets with real access control (domain sockets,
named pipes) are the strongest fence, but CEP's page cannot open one — it has
`fetch` and, optionally, Node; Node in CEP panels is a per-version debug flag
away from not existing, and the shared panel would need two transports.
Files polled both ways are a protocol nobody can debug. Driving the CLI
re-scans the library per keystroke.

## Decision

**One HTTP server in Pulp's main process, bound to 127.0.0.1 and nothing
else, speaking a versioned JSON protocol** (`src/core/panel-bridge.ts`; the
answers are built from the same index and the same `searchLibrary` the app's
own window uses, so the panel's search syntax is the app's). Items are
addressed by library id and the answers carry no file system paths, the rule
the app's own protocols already follow (ADR 0013).

**Every request must carry a token that lives only in a file the user can
read.** The bridge starts with a fresh 256-bit token and writes
`panel-bridge.json` — port, token, versions — beside the settings, mode 0600,
removed when the bridge stops. The panels read that file (CEP through
`cep.fs`, Resolve through the plugin's preload) and send the token on every
request, compared in constant time. This is the whole fence, and it is the
right shape: a local process running as the user could read the user's files
anyway, while a web page — the attacker loopback actually exposes — cannot
read files at all, and is answered 401. The discovery file doubles as
discovery: the port is the system's pick, never configured, never guessed.

**Off by default.** A listener is surface, however fenced; it exists only
while Settings → "Serve the editor panel (local)" is on, which is also where
the app says what is listening and where. Headless runs never start it.

**One shared panel page, two thin hosts** (`panels/shared`, `panels/premiere`,
`panels/resolve`): the host wrappers contribute only the manifest and the way
to read the discovery file, so the panel is written once and the later
milestone items land in one place.

## Consequences

- Nothing leaves the machine, and the claim stays checkable: one listener on
  127.0.0.1, no other network use, and the token never travels except to the
  loopback it opens.
- A browser page can still *send* requests at the port (CORS cannot stop a
  request from leaving, only answers from being read); without the token every
  answer is 401 with nothing in it. The CORS headers the bridge does send
  only let the hosts' non-http pages carry the token header — worthless
  without the token itself.
- Restarting Pulp mints a new token and may move the port; panels reread the
  file and reconnect, and a stale file from a crash is removed at launch.
- The protocol carries a version so a panel older than its Pulp says "update
  me" instead of misreading answers.
- The bridge is plain HTTP, so the milestone's "stand-in host" test needs no
  host at all: the unit tests already speak the connection end to end.
- Premiere's CEP loads unsigned extensions only with PlayerDebugMode on, and
  Resolve's Workflow Integrations are Studio-only; both limits are the hosts'
  and are documented in `docs/editor-panels.md`, to be revisited when the
  panels are packaged (milestone 54's last item).
