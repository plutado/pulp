# 0012. Templates declare aspect ratios; the pixel size is chosen at render time

Date: 2026-10-24
Status: Accepted

## Context

Milestone 19 brings vertical and square output. Until now a manifest declared `width` and `height`, which pinned every template to one resolution: a vertical version of a lower third was a second template to write, test and keep in step with the first, and a 4K render of a 1080p template was not possible at all. Yet nothing in a template is inherently 1920 × 1080. The frame state already carried `width` and `height`, and the sample templates and the size fixtures already drew from them; what the manifest's size did was decide the offscreen window and the capture check.

Milestone 20's platform presets depend on this: a preset is mostly an aspect, a resolution and a frame rate, and none of those are choices while templates fix a pixel size.

## Decision

**A template is defined by the shapes it draws for, not by a pixel size.**

- The manifest declares `aspects`, one or more of `16:9`, `9:16`, `1:1` and `4:5`. The list is closed and the ids are permanent, like the taxonomy's (ADR 0010); a shape outside it is a validation error.
- The output size is chosen per render, in `src/core/aspect.ts`: one of the template's aspects, then a standard resolution for it (720p, 1080p, 1440p, 4K; 8K for 16:9) or an exact size that must be of that aspect. With no choice a template renders at its first aspect's 1080-class size. The choice travels in the render options (`aspect`, `width`, `height`), so the queue, the cache key, collections and the headless flags carry it without new plumbing.
- The frame state's `width` and `height` are the render's, passed in by whoever asks for the frame. A template sizes its canvas from them on every call.
- The renderer sizes its offscreen window from the plan, not the manifest; the capture-size check, the raw byte count and ffmpeg's `-video_size` all read the same numbers. Thumbnails, hover-scrub strips and the preview use the template's default size.
- **Manifests with `width` and `height` keep working.** The aspect is inferred: a built-in one when the size is within 1% of it (1366 × 768 is 16:9), otherwise the reduced ratio (`4:3`), which the template then renders at that one size. The declared size becomes the template's default resolution for that aspect, so an existing template renders exactly as it did. Declaring both `aspects` and a size is allowed when the size is of one of the aspects.

## Reasons

- One template per look, not one per shape. The matched sets gain vertical versions by laying out differently for a tall canvas, not by duplicating files.
- Resolution is a property of the delivery, not of the graphic. Choosing it at render time is what every other render option already does (frame rate, trim, background).
- Keeping the inferred aspect and the default size means no bundled, imported or user template has to change to keep rendering; the format change is additive in effect even though a field became optional.
- A closed aspect list keeps the Output tab, the orientation filter and the platform presets on one vocabulary. A reduced ratio for unusual legacy sizes keeps those templates honest about their shape without widening the list.

## Costs

- A template that hard-codes 1920 × 1080 in its drawing code renders wrongly at any other size. Nothing can detect that from the manifest; the authoring guide (milestone 8) says to draw from the state, and the samples test will check that the bundled templates do.
- The library database re-reads every template once (schema 5) so stored manifests carry their aspects.
- A declared size is still a single default. A template that wants a different default per aspect has no way to say so; none has asked yet.

## Revisit if

- A platform preset needs an aspect outside the four (2:3, 21:9). Add it to the list; never rename or remove an id.
- Templates want per-aspect defaults or per-aspect parameters (a different layout parameter set for tall frames). That would be a `layouts` structure in the manifest, not a change to this decision.
