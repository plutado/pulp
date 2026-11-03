# Spelling

Pulp is written in **US English**: color, center, gray, license, behavior,
favorite, catalog, canceled. That covers everything a person reads — the
window's labels and notes, the template names and descriptions, the docs, the
changelog and roadmap, the comments in the code — and the tests that quote
those words.

Some **internal names** were written with UK spellings before this rule and
keep them, because changing them would break saved work, generated files or
the code that reads them. They are values, not words, and are documented here
so nobody "corrects" one by accident. Revisiting them — with a migration for
the saved forms — is a separate decision.

## Values kept with their UK spelling

| Where | Value | Why it stays |
|---|---|---|
| Render queue status | `'cancelled'` (`RenderJobStatus`, src/core/render-queue.ts) | Carried in the queue snapshot over IPC, in the editor panel's `GET /v1/queue` answer and as the panel's `.badge.cancelled` class. What is *said* about it is "canceled". |
| Result fields | `cancelled: true` on `RenderResult`, `CollectionFileResult`, `PrepareDragResult` and friends (src/shared/api.ts) | The preload contract between the window and the main process. |
| Template ids and folders | `pulp.samples.carbon-fibre` in `templates/carbon-fibre/`, `pulp.samples.paper-fibre` in `templates/paper-fibre/` | Ids are referenced by projects, collections, presets and the visual references; folders are the ids' homes. The display names are Carbon Fiber and Paper Fiber. |
| Parameter ids | `programme` (Newsdesk opener and end card, where `fallbackText` names it too), `fibre` (Paper Fiber), `centre` (Split-tone vignette overlay) | Parameter ids are keys in saved presets, projects, collection cards and `--param` on the command line. Their labels read Program, Fiber and Center. |
| Select option values | `centre` as a value and default in the Festival iris matte | Saved as the parameter's value wherever parameters are saved. The option's label reads Center. |
| Sample-media file names | `racing-tyre…` and `aeroplane-fly…` object assets (src/core/sample-media.ts and the asset catalogs) | Written into the person's sample-media folder; renaming would generate a second copy beside the first. Their notes read in US English. |
| Code identifiers | `centre` (points and fields in src/core/stage-place.ts, src/core/poster.ts, src/renderer/stage-layers.ts and their tests), `colour`/`colours` (src/core/lottie.ts, src/core/layer-look.ts, src/renderer/guided-setup.ts), `grey` (src/core/png.ts), `normalise` (src/core/media-render.ts), and a few test locals (`labelled`, `coloured`, `centred`, `levelled`, `asked.cancelled`) | Not read by anyone outside the code. Rename freely when touching that code; nothing saved depends on them. |

## Not changed, for a different reason

- The bundled fonts' license files in `fonts/`, `THIRD_PARTY_NOTICES.md`'s
  quoted license texts, `LICENSE`, `templates/LICENSE-CC0.txt` and
  `CODE_OF_CONDUCT.md` are other people's words and stay as published.
- Lottie, PSD, FCPXML, EDL and ffmpeg vocabulary is whatever those formats and
  tools call things.

## How the sweep was done

Prose was converted with word boundaries and case kept; code identifiers were
never touched (only comments and string literals in code files), JSON keys,
ids, select values and file names were skipped, and inline code spans in the
docs were left alone. The leftovers were read one by one and are the table
above. A new UK spelling in prose is a mistake; one in a value is a decision
to add to the table.
