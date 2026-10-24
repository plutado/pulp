# 0013. Image slots: a template is granted only the images chosen for it, by id

Date: 2026-10-24
Status: Accepted

## Context

Milestone 22 lets a template declare image slots — boxes in its layout that a chosen library still is drawn into, inside the template's own animation, so a logo follows every move the graphic makes. That needs a template page to load a file the user picked.

Templates are untrusted documents: a pack from anywhere, run inside an offscreen window with a Content Security Policy that forbids the network. Since milestone 4 the library has been off limits to them: `pulp-media://` refuses any request whose referrer is a template page, and the template CSP never listed the scheme, so a pack could not read, probe or exfiltrate the user's media. Image slots must not open that door wider than the one image.

## Decision

**A template sees exactly the images chosen for its image parameters, by library id, for as long as a preview shows them or a render runs, and nothing else. It is handed their bytes; it is never given a way to ask the library for anything.**

- The value of an image parameter is a **library id**, never a path. Files chosen from outside the library are first copied into a managed `imported` folder under user data, which is a library root, so the library stays the one thing a template can be handed.
- The **main process is the grant**: for a preview or a render it reads exactly the chosen ids — only ids that are online **stills** in the library, under the size bound — and hands the page their bytes as data URLs, once per change of the choice. Anything else is reported back as missing and not read. The preview asks again whenever the choice changes; a render reads once, before its first frame.
- The **protocol handler and the template CSP are unchanged**: `pulp-media://` refuses every request from a template page, and the template CSP lists no library scheme at all. There is no URL a template could vary to reach a neighbour, because there is no URL.
- The **host decodes the images before the first frame**. The frame state carries each slot's pixel box and chosen id; the bridge decodes the handed bytes once through an `<img>`, under the template's load timeout rather than a frame's, applies the treatment on an offscreen canvas and caches the result. A frame is never drawn with a half-loaded logo, and a frame never waits on a decode.

### Why not a grant the handler checks

The first design kept the grant in the main process and had the `pulp-media://` handler serve a template referrer the ids its template held. The end-to-end test for it failed: an `<img>` load from a template page reaches the handler **with no referrer**, so the request looked like the app window's and the neighbour loaded. The referrer is also the page's to set — a `<meta name="referrer">` in a pack would strip it on purpose — so nothing keyed on it can carry a security rule. Handing bytes over keeps the decision where a template cannot touch it and leaves the handler's rule with no exception to get wrong.

## Reasons

- Reading by id in the main process is the smallest grant that does the job. A capability per file would mean minting tokens and passing them into pages; a per-template folder would mean copying files per render. Ids already exist, are opaque, and are what the picker produces.
- A template page holds no secret and no handle: it has bytes for the images it was handed and no address for anything else.
- The handler's refusal and the CSP stay exactly as they were, so the pre-existing guarantee is unchanged for every template, slotted or not.
- Decoding up front keeps renders deterministic and gives a place to bound a user file: a file over 64 MB is refused before it is loaded, and the decoded bitmap is capped at 4096 px on its long side, so a huge PNG costs one decode within the load budget and never stalls a frame.

## What SVG and large files get

- **SVG** is loaded through an `<img>` element and drawn to a canvas. Chromium renders SVG-as-image in its isolated mode: scripts do not run, external resources (images, fonts, stylesheets, `xlink:href` to other documents) are not fetched, and the template page's CSP never sees them. The SVG is rasterised once into the capped bitmap; the template only ever draws a bitmap.
- **Large PNGs** are refused above 64 MB before loading. Below that, the decode happens in the prepare step before the first frame; the bitmap is downsampled to at most 4096 px on its long side, so per-frame drawing stays cheap at 8K output too.

## Costs

- A template that wants an image the user did not choose for one of its slots cannot have it, by design. There is no "any image from the library" slot.
- A chosen image that leaves the library makes the slot fall back; the picker says so and the render refuses with the reason rather than drawing a blank.
- A large image crosses to the page as a data URL once per preview change and once per render; the 64 MB bound keeps that reasonable, and the bitmap cap keeps what the page holds small afterwards.

## Revisit if

- Media slots (a video plate behind a title) arrive: the same grant can cover a clip, but frames must be decoded per time, which is a renderer change, not a change to this decision.
- A template needs an image at render time that the user chose elsewhere (a per-set shared logo). That would be a shared parameter, still granted by id.
