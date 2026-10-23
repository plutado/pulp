# 0009. Preact with signals for the UI, ported region by region

Date: 2026-10-23
Status: Proposed (criteria below are fixed; the spike has not run yet)
Supersedes: 0006

## Context

ADR 0006 kept the UI as plain DOM through milestone 3 and named the library milestone as the point to re-evaluate. The library milestone has since shipped, in plain DOM. Its "revisit if" conditions have now arrived with the layout plan (`docs/ui-layout.md`): seven regions that update incrementally and often (tree counts follow the scope, the grid re-filters per keystroke, the tray shows per-item progress), where today's one pattern is clear-and-rebuild (`replaceChildren` in `renderResults` and `renderQueue`). Rebuilding drops every `<img>`, so thumbnails re-decode on each keystroke, and the hover-scrub sprites planned for milestone 12 would too. The risk ADR 0006 named as "the thing to watch" — module-level shared state and hand-wired controls — is now one 1,592-line file with a 17-field state object and 63 listeners, and seven coordinated regions would multiply it.

## Decision

- **Preact with signals** renders the regions. Approved by David on 2026-10-23.
- **Ported region by region**, one commit each, the UI end-to-end test green at every commit. No big-bang rewrite.
- **Today's parameter controls stay as they are** (color field, sliders, undo wiring), mounted inside host components, for as long as they pull their weight.
- **Shared state, actions and derived values** (scope, query, results, selection, jobs) live in a pure module under `src/core` with unit tests; the renderer wraps it in signals. Components stay thin; the framework only turns state into elements.
- **No DOM-level unit tests** (jsdom and the like) until a region needs one; the end-to-end test remains the proof that a port lost nothing.

## Alternatives considered

- **Stay with plain DOM, write a store and region modules by hand.** Keeps zero runtime dependencies, but the store plus keyed list reconciliation is a framework written badly, and every region pays the clear-and-rebuild cost or hand-rolls diffing. This is the fallback if the spike fails.
- **Svelte.** Compiles away the runtime, but it is a second language with its own checker and lint tooling, and mixing imperative code (the parameter controls we are keeping) is awkward. Fits a greenfield rewrite, which ADR 0006 already ruled out by requiring the end-to-end test to survive.
- **React.** Larger runtime, synthetic event system between the test's dispatched events and handlers, and nothing the regions need that Preact lacks. ADR 0006 already said to prefer Preact or Svelte.
- **Web components.** Shadow roots break every selector the end-to-end test uses; no shared-state story.

## Spike: go/no-go, criteria fixed before it runs

The spike ports one region — the results list and its search filtering — to Preact. It is a **go** only if all of these hold:

1. `npm run lint` passes (ESLint and both tsc projects), with the `.tsx` sources included: types clean, no suppressions added.
2. `npm test` passes with **no edits under `tests/`**: the UI end-to-end test drives the ported region through its existing ids, classes and `data-` attributes.
3. `npm run build` passes and `index.html`'s Content-Security-Policy is byte-for-byte unchanged (Preact must need no `unsafe-eval` and no new source).
4. The renderer bundle grows by **less than 30 kB** minified over the 83.17 kB baseline.
5. The component that replaces the list-building code is **no longer in lines** than the code it replaces.

Any failure is a **no-go**: revert the port, record the result here with the decision flipped to plain DOM plus a hand-written store, and stop for David before any further UI work.

## Result

Pending.

## Costs and risks

- The first two runtime dependencies (`preact`, `@preact/signals`) enter `package.json`; milestone 7's packaging must carry them, and upgrades become our problem.
- A 5,100-item library still wants virtualization; that is an explicit milestone 12 item, and the 500-result cap stays until it lands.
- Components get only the end-to-end test as coverage until a region earns a DOM-level test; logic must keep draining into `src/core` for that to stay acceptable.
- Two rendering styles coexist during the port (signals-driven components and imperative controls inside hosts); the host-component boundary is the discipline that keeps that readable.
