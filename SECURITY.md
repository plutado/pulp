# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

- Use GitHub's private vulnerability reporting on this repository: **Security → Report a vulnerability**. It reaches the maintainer and nobody else.
- Say what you found, how to reproduce it, and what it lets someone do. A template folder, a pack, a media file or a project file that triggers the problem is the most useful thing you can attach.

You will get an acknowledgement within a week. Fixes land as ordinary commits; the report is credited in the changelog unless you ask otherwise. There is no bounty program.

## What counts

Pulp runs on your machine and sends nothing anywhere, so the things worth reporting are about what a file you open can do:

- A **template or pack** that reaches outside its own folder, loads from the network, reads the library, or escapes the sandboxed page it is drawn in. Templates are untrusted code by design (`docs/template-format.md`, "What the host provides"): a page may read only its own files, and the media protocols refuse it everything else.
- A **media file, project or collection** that makes Pulp read or write a path it was not given, or that crashes the main process rather than being refused.
- Anything that leaves the machine. The one network request Pulp makes is fetching a speech model after you say yes (ADR 0021); any other is a bug.
- A dependency with a known advisory that CI's audit (`npm audit --audit-level=high`) did not catch.

## Supported versions

Pulp has not reached 1.0. Fixes go to the main branch and the next release; there are no maintained older lines.
