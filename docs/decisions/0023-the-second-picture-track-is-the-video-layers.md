# 0023. The second picture track is the project's video layers

Date: 2026-11-02
Status: Accepted

## Context

Milestone 49 gave a project one picture track: the cut track, clips end to end
under the layers, the shots of a short. Milestone 57 asks for a second one
above it — a reaction in a corner over an interview, a cutaway over a
sentence, b-roll over a voice — whose clips sit anywhere on the timeline with
gaps between them, each placed, sized, cropped and bordered on the picture,
with its sound in the mix and a lane of its own in the edit exported for an
editing app.

An editing app models that as a second video track with its own clip objects.
Pulp already has something very like it.

## Decision

**The second picture track is the project's video layers, shown as a lane.**
There is no second track model.

A video layer (milestone 26) is already a library clip at a moment of the
graphic — a start delay, a span with both ends draggable on its bar, an in and
out point, a speed and keys — placed, scaled and turned on the stage by the
stage's own handles (milestone 25), with its own sound in the mix, the
loudness meter and the leveling (milestone 48). That is a clip anywhere on
the timeline, gaps allowed, with position and size: four of the milestone's
six words.

What was missing is added to that model rather than beside it:

- **A lane** (`src/renderer/overlay-track.ts`), between the layer bars and the
  cut track, that shows the video layers as a track — a block per clip at its
  span — and **takes a drop at a moment**: the clip becomes a video layer
  starting there, running once for its own length, at picture-in-picture size
  in the top right corner, where the handles take over.
- **A crop and a border on the clip value** (`ClipCrop`, `ClipBorder` in
  `src/core/video-layer.ts`), beside the in point, the speed and the LUT, so
  they ride wherever a clip's settings already go — projects, presets,
  collections, the text form and `@layers` on the command line — and the page
  draws them in the preview and the render by one path (`src/core/runtime.ts`).
- **A lane in the exported edit** (`EditOverlay` in `src/core/edit-export.ts`):
  each video layer with a clip as a connected clip in FCPXML with its transform
  and crop, and as a V2 event in the EDL, with the graphics rendered
  **without** them so the editor gets the clips in place.

## Reasons

- **One thing with one set of gestures.** A second clip model would need its
  own drag, trim, split, selection, keys, sound and undo — all of which a layer
  has, and all of which a person already knows from the layers. A clip over the
  shots that behaves differently from a clip placed from the right-click menu
  would be two things that look the same.
- **The stage's handles are the right tool for a picture-in-picture**, and they
  work on layers. Giving a track model handles would mean a second placement
  arithmetic (`src/core/stage-place.ts` is pure and tested once).
- **Everything downstream already understands a video layer**: the render
  composites it, the preview plays it, the mix hears it, the export and the
  CSV batch carry it. A new model would have to be taught to each.
- **The cut track stays a cut track.** Its whole shape — end to end, no gaps,
  ripple by construction — is what makes it good at shots. Clips with gaps
  between them are the other shape, and layers already have it.

## Consequences

- A clip dropped on the **stage** still lands on the cut track (milestone 49):
  the shots. A clip dropped on the **picture track's lane** lands over them.
  The right-click menu's Add Asset Here still makes a layer, as it did.
- The lane shows while the project has a cut track to sit over or a clip
  already on it, so there is something to drop on; without either it takes no
  room from the stage.
- Crop and border are on the clip value, so a video layer placed from the
  menu can have them too, which is right: it is the same thing.
- The exported transform is as near as the format says it: position in pixels
  of the project's frame from its center, scale against a clip fitted to the
  frame's height, the crop as pixels trimmed. An editor's own fit of a clip of
  another shape lands near rather than exactly, and the EDL's comment says
  the numbers in words.
- A video layer's stack position still decides what it draws over: a clip in
  an open block below the titles sits under them, as b-roll should.
