# 0022. FFmpeg fetched on request, not bundled in the installers

Date: 2026-11-02
Status: Accepted. Amended by [0026](0026-features-ask-one-table-of-what-the-ffmpeg-can-do.md): the fetch is also offered where the ffmpeg in use lacks a feature, and the person can choose which ffmpeg Pulp uses.

## Context

Pulp encodes every render with FFmpeg, run as a separate program found on
PATH. That has been fine for a repository people build themselves: a
developer has FFmpeg or can `brew install` one. Milestone 17 makes installers,
and an installer goes to someone who has never heard of FFmpeg, for whom
"renders are off until you install another program" is the end of the trial.

So the question is what a Pulp installer should do about FFmpeg, and it is a
licensing question as much as a packaging one. FFmpeg is LGPL-2.1-or-later as
configured by default and **GPL-2.0-or-later once it is built with GPL
components** — which x264, the H.264 encoder everyone's deliverables need, is.
Pulp itself is MIT.

Three answers were on the table: bundle an LGPL build, bundle a GPL build, or
ship none and fetch one when asked.

## Decision

**Pulp ships no FFmpeg. "Use your own" stays the first answer, and where
there is none, Pulp offers to fetch one — after saying what it would fetch,
from whom, how big it is and under what license.**

The fetch is the pattern ADR 0021 set for the speech model, for the same
reason: a download is only acceptable when what arrives is pinned to the byte.

| Machine | Build | Download | Publisher |
|---|---|---|---|
| macOS (Apple Silicon) | FFmpeg 9.0.2, static | 57 MB | Martin Riedl's build server |
| macOS (Intel) | FFmpeg 9.0.2, static | 68 MB | Martin Riedl's build server |
| Windows (x64) | FFmpeg 9.0.2 release essentials | 115 MB | Gyan Doshi's builds for Windows |
| Linux (x64) | FFmpeg 9.0.2, static | 67 MB | Martin Riedl's build server |
| Linux (ARM64) | FFmpeg 9.0.2, static | 57 MB | Martin Riedl's build server |

The URLs, byte counts and SHA-256 checksums are in
`src/core/ffmpeg-download.ts`, which is the one place they live; the table
above is the record of what was chosen and when. Both publishers are listed
on ffmpeg.org's own download page, and every URL is a **versioned** one: the
rolling "latest" names the same publishers also offer would break the
checksum the first time they rebuilt.

**What arrives is GPL**, in all five cases, and the dialog says so before the
button is pressed. The two programs — `ffmpeg` and the `ffprobe` beside it,
which Pulp reads media with — go into `ffmpeg/` beside the settings, and
`candidatePaths` looks there **last**: an FFmpeg of your own, on PATH or at
`PULP_FFMPEG_PATH`, still wins.

## Reasons

- **An LGPL build in the installers would be a worse Pulp, quietly.** An
  LGPL-only FFmpeg has no x264, so every H.264 render — the MP4 preset and
  every platform preset, which is most of what people export — would fall
  back on whatever hardware encoder the machine happens to have, or fail where
  there is none. A renderer whose main format depends on the graphics card is
  not one to ship on purpose.
- **A GPL build in the installers would mean distributing GPL software.** The
  GPL's terms are not onerous and Pulp could meet them — the license text, the
  offer of source, the notices — but the result is an MIT application whose
  installer carries GPL software, which is a thing to explain on every page
  that mentions the license, and a thing anyone repackaging Pulp inherits.
  Fetching at the person's request keeps the two apart: Pulp distributes
  nothing of FFmpeg, and what is fetched is fetched by the person who asked,
  from FFmpeg's own publisher, over their own connection.
- **It is a separate program either way.** Pulp links nothing of FFmpeg into
  itself: it runs the binary as a child process and reads its output, which is
  the arrangement the license question is easiest about and the one Pulp has
  always had. Nothing in this decision changes how a render works — only where
  the binary came from.
- **A checksum is what makes "fetched from the internet" acceptable.** Each
  archive is hashed as it arrives, and anything that is not the published
  bytes is thrown away rather than kept. The fetched build is then run once
  (`ffmpeg -version`) before it is moved into place, so a build that cannot
  start on this machine is said here rather than at the end of a first render.
- **Not Homebrew, winget or apt.** Driving a package manager means asking for
  an administrator password, inheriting whatever that manager does next, and
  having nothing to say on a machine without one. A file in the app's own
  folder is Pulp's to check, replace and delete.

## Consequences

- The checksums age. A publisher who replaces a file breaks the fetch rather
  than silently fetching something else, which is the failure wanted; moving
  to a newer FFmpeg means new URLs, sizes and checksums here and in
  `src/core/ffmpeg-download.ts`, and `tests/ffmpeg-download.test.ts` holds the
  shape of every entry.
- A fetched build is **per machine, not per project**, and is not uninstalled
  with Pulp on Windows (`deleteAppDataOnUninstall: false`): it is beside the
  settings, with the library index and the render cache.
- The macOS builds are signed with their publisher's Developer ID, so a
  fetched FFmpeg is not itself something Gatekeeper has to be argued with.
  Pulp's own ad-hoc signature disables library validation, which is what lets
  a differently-signed binary run as its child (`docs/packaging.md`).
- Pulp still runs with no FFmpeg at all: everything but rendering works, which
  is what the Render button has always said. The helper adds a way out of
  that, not a requirement.
- `THIRD_PARTY_NOTICES.md` records FFmpeg as what it is here — not shipped,
  fetched on request, GPL — so the acknowledgements in the app say the same
  thing as this record.
