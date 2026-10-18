# 0002. Templates are HTML/Canvas pages driven by time

Date: 2026-10-18
Status: Accepted

## Context

Pulp needs a template format that is open, easy to write, previewable in real time, and renderable frame-accurately with alpha. Options considered:

1. **HTML page with a `pulpRender(state)` function** (Canvas 2D, optionally DOM/SVG/WebGL).
2. **Lottie JSON**, exported from After Effects through Bodymovin.
3. **A custom declarative scene format** (layers, keyframes, easing) with Pulp's own renderer.
4. **Project files from existing motion-design apps.**

## Decision

Option 1. A template is a folder with `template.json` and an HTML entry page that defines `window.pulpRender(state)`. The host calls it with the frame time and resolved parameters, then captures the page.

## Reasons

- **Open and approachable.** Any web developer can write a template with a text editor; Canvas 2D is well documented and stable.
- **Deterministic by contract.** Rendering is a pure function of `state`, so frames can be produced in any order, at any speed, and re-rendered identically. Real-time preview uses the same function.
- **Expressive enough.** Text layout, shapes, gradients, images and WebGL are all available. Parameters map directly to JavaScript values.
- **No proprietary dependency.** Option 4 ties templates to commercial software formats. Option 2 is open but practically requires After Effects to author, has limited text editing, and would still need a player; it can be supported later as a template that embeds a Lottie player.
- **Smallest first step.** Option 3 means designing and maintaining a scene graph, renderer and eventually an editor before the first useful template exists. It may be worth building later as an authoring layer that compiles to option 1.

## Costs

- Templates are code. A malicious or buggy template can hang or misbehave, so templates run sandboxed, offline and with a CSP (see system-design.md, Security model).
- Determinism is a rule the author must follow (no wall-clock timers or unseeded randomness). The validator cannot fully enforce it; the sample tests check for the common mistakes.
- Font availability differs across machines. Templates should bundle fonts or use widely available families.
- No visual authoring tool at first.

## Consequences

- The format spec (docs/template-format.md) defines the manifest and the runtime contract.
- The host injects a bridge script; templates do not import any Pulp library.
- A future `formatVersion` can add features (image parameters, audio) without changing the core contract.
