# 0026. Features ask one table of what the ffmpeg can do, and the person chooses which ffmpeg

Date: 2026-11-10
Status: Accepted. Amends [0022](0022-ffmpeg-fetched-on-request-rather-than-bundled.md): a fetched build is no longer offered only where there is no ffmpeg, nor always looked for last.

## Context

Pulp runs the person's own ffmpeg (ADR 0022), and builds differ. Homebrew's
macOS build has no zimg, so HDR clips cannot be converted (milestone 81);
vid.stab (milestone 78) and libwebp (milestone 82) are add-ons a build may or
may not carry; VideoToolbox is Apple's. Each feature checked for itself: the
HDR code read the filter list, the stabilize dialog read it again on every
opening, the presets read the encoder list. A feature added without a check
failed inside ffmpeg, at the end of somebody's render.

And the way out did not reach the people who needed it. ADR 0022 offered the
fetch only where there was no ffmpeg at all, and put the fetched build last
among the candidates — so someone whose own ffmpeg lacked zimg was told to
"let Pulp fetch one", and could not: no offer was made, and a fetched build
would have lost to theirs anyway.

## Decision

**One table, one reading, one choice.**

- **One table** (`src/core/ffmpeg-needs.ts`): each feature that depends on the
  build names the filters, encoders and decoders it needs, and the library a
  build is configured with to carry them. The plumbing every build has is
  listed too, so the table is whole.
- **One reading** (`detectFfmpeg`): the version, the encoders, the decoders,
  the filters and the alpha mode, read once per build and kept while the file
  is unchanged. Every feature asks that answer (`src/main/ffmpeg-caps.ts`).
- **The table is held to the code** (`tests/ffmpeg-needs.test.ts`): every
  filter and codec in the argument lists the planners write must be named in
  it, and so must every library-backed filter or codec anywhere in the
  source. The core list is held to being used.
- **Missing stays visible**: a feature this build lacks says so where it is
  met — the stabilize dialog, an HDR clip's Range row, the preset list, the
  Output tab — in one sentence naming the library and the way to the fix.
- **The person chooses which ffmpeg**: the first one found (the default, in
  0022's order), the build Pulp fetched, or a file of their own.
  `PULP_FFMPEG_PATH` still comes first, for scripts and CI.
- **The fetch is offered where a feature needs it**, not only where there is
  none, and a fetched build is used from then on; switching back is one click.
  A fetched build is read like any other when it lands, and what it lacks is
  said then.
- **The command line refuses** a render that needs what the ffmpeg lacks —
  an HDR shot with no zimg — with the table's sentence and exit code 1, where
  the window renders without the conversion and says so first.

## Reasons

- One answer means the dialog, the render and Settings cannot disagree, and
  five processes run once per build rather than on every clip read.
- A table held to the code is the only way a new feature's dependency is not
  forgotten: the test fails on the developer's machine rather than in the
  field.
- The fetched build exists to give someone a working ffmpeg. For someone whose
  ffmpeg cannot do what they asked for, that is exactly what it is for; 0022's
  "only where there is none" served the person with nothing and stranded the
  person with the wrong thing.
- "Use your own" is kept as the default, not abolished: nothing changes for
  anyone who does not choose.

## Consequences

- A pinned build declares what its publisher's configure line says it
  carries (`carries` in `src/core/ffmpeg-download.ts`), and a test holds each
  to every feature of its platform. **That declaration was not measured when
  it was written**: it is the publishers' documentation, and the fetch's own
  reading of the build is what checks it. Fetching each pinned build once and
  comparing is an open item.
- A source scan cannot see a filter written only at run time from data it
  does not contain; the planner test covers what the planners can be asked to
  write, the scan covers names in strings, and neither is a proof.
