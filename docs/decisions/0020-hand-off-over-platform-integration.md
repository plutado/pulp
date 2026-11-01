# 0020. Social export hands the file over; it never posts through a platform's API

Date: 2026-11-01
Status: Accepted

## Context

Milestone 20 makes a render the right shape, size, rate and codec for a
platform, warns when it runs past the platform's limits, and writes the cover
image the platform asks for separately. The last step is getting the file
there. Two designs were on the table:

1. **Integration:** sign in to each platform and post through its API —
   one-click publishing from the tray.
2. **Hand-off:** give the finished file to the system — the share sheet, the
   file manager and the browser — and let the person post it themselves.

Integration is the feature people ask for first, which is why this record
exists: the reasoning has to survive the first request for one-click posting.

## Decision

Pulp hands the file over and stops there. A finished render's card offers:

- **Share…** — the system share sheet with the rendered file, on macOS, the
  one desktop platform Electron has a share sheet for (`ShareMenu`). The card
  does not show the button elsewhere; a control that cannot work is worse
  than one that is not there.
- **Open upload page** — the platform's own upload page in the default
  browser, with the file shown in the file manager beside it, ready to drop.
  Offered when the render was aimed at a platform preset. The page is read
  off the built-in preset by its id in the main process; the window sends an
  id, never a URL, and the preset list's validator holds every page to https.

Both act only on files in the same allow-list the drag, Reveal and Copy path
use: renders this app made, never an arbitrary path the window asks for.

## Reasons

- **Nothing to store.** Posting through an API means OAuth tokens on disk,
  refresh flows, and a keychain story. Pulp keeps no accounts and no secrets;
  there is nothing to leak and nothing to revoke.
- **Nothing to re-certify.** Every platform gates its upload API behind app
  review, developer agreements and rate tiers, re-approved on their schedule,
  per platform. That is a treadmill for a team; for a small open-source tool
  it is a way to ship broken buttons.
- **Nothing that breaks remotely.** An API integration fails when the
  platform changes its API, its terms or its mind, and the failure lands in
  Pulp's issue tracker. A browser upload page is the platform's own front
  door, maintained by the platform for everyone.
- **The person stays in charge.** Captions, hashtags, covers, audiences and
  scheduling live in the platform's own composer, which is better at them
  than any embedded form, and the person sees exactly what is posted.
- **It matches what Pulp is.** Pulp makes files for other tools — editors by
  drag-out, platforms by hand-off. "The file, not the account" is the
  milestone's own rule.

## Consequences

- Posting is two clicks and a drop rather than one click. That is the cost,
  and it is accepted.
- Share… is macOS-only until Electron (or Pulp, through a native module)
  offers a Windows share sheet; "Open upload page" works everywhere and
  carries the feature on those platforms.
- Upload page URLs are data that ages, like the limits beside them: they are
  checked with `PLATFORM_LIMITS_CHECKED` and held to https by the preset
  validator and its unit test.
- If one-click posting is ever reconsidered, it should be as a separate,
  optional companion that owns the account problem end to end — not as a
  quiet growth of the render tray.
