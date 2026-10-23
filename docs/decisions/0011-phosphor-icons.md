# 0011. Phosphor as the icon set, inlined at build time

Date: 2026-10-23
Status: Accepted

## Context

The window grew an icon-shaped hole: collapse and clear controls are Unicode stand-ins (`⟨`, `⌃`, `⌄`, `×`), favorite is `★`/`☆`, thumbnail placeholders are `T` and `♫`, and David wants an icon-led interface where labels can step back (tooltips on hover and focus) and the app reads as polished and modern. The repo's asset rule (CONTRIBUTING) allows CC0 or MIT material, so the set's license decides as much as its coverage.

## Decision

**Phosphor Icons**, confirmed **MIT** on the npm registry on 2026-10-23 (`@phosphor-icons/core` 2.1.1 and `@phosphor-icons/web` 2.1.2 both declare `license: MIT`); the packaged `LICENSE` file was read on install (`@phosphor-icons/core` 2.1.1: "MIT License, Copyright (c) 2023 Phosphor Icons") before the dependency was committed.

Usage, per `docs/ui-style.md`:

- Only the icons we use, imported **as inline SVG at build time** from `@phosphor-icons/core` — no icon font, no runtime fetch, no CSP change, and tree-shaking keeps the bundle honest (the ADR 0009 budget thinking applies).
- One `Icon` helper (16, 20, 24 px) that inherits `currentColor`, so icons follow text roles and states without per-icon styling.
- Phosphor's weights express state: **regular** off, **fill** on — favorite, pressed chips, the active tab — instead of color-only state.

## Alternatives considered

- **Tabler Icons** (MIT): the largest set (~5,000) with strong media coverage, but one outline weight only, so on/off states need color or swapped glyphs rather than weight.
- **Lucide** (ISC): popular and clean, but ISC is not literally MIT; the asset rule says CC0 or MIT, and bending it for icons invites bending it for media. Rejected on license.
- **Keep Unicode glyphs**: free and dependency-less, but they render inconsistently across platforms and fonts, can't carry state, and are the opposite of the polish asked for.

## Costs

- A new dependency to track; mitigated by build-time inlining (only used icons ship) and the MIT license matching the asset rule.
- SVGs inherit `currentColor` but not automatically the right size; the single `Icon` helper with three sizes is the discipline.
- Icon-only buttons shift the accessibility burden to `aria-label`s and focus tooltips; the enforcement test in `docs/ui-style.md` fails any icon-only button without one.
