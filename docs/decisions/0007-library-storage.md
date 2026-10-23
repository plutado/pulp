# 0007. Library index in one SQLite database in user data

Date: 2026-10-23
Status: Accepted

## Context

Until now the library was rebuilt from scratch on every start and every rescan, held only in memory, and sent whole to the UI. Milestone 4 needs it to persist: remember scanned items so the app opens with a library, rescan only what changed, keep user tags and favorites attached to items, and survive a root (an external drive, a network share) being unplugged without losing that user data. Two storage shapes were on the table: one database in the app's user data folder, or a JSON file in each library root.

## Decision

One SQLite database, `library.sqlite` in Electron's user data folder, through `node:sqlite`, the SQLite binding built into Node 22.13 and later (Electron 44 ships Node 24). Tables: `roots` (configured roots, order, online flag), `items` (one row per template folder or media file with the stat signature and the parsed entry as JSON), `problems`, and `user_items` (tags, favorite, last used) keyed like `items` but independent of it. WAL journal mode. Nothing is written into library folders.

## Reasons

- **Nothing to build or ship.** `node:sqlite` needs no native module, so no per-platform rebuild for Electron and nothing extra for packaging. It was checked in Electron 44 and in the Node the tests run on.
- **Incremental by nature.** A rescan upserts the rows that changed and deletes the rows for files that are gone; the rest of the database is untouched. A single JSON file would be rewritten whole on every change, and grows unwieldy well before SQLite does.
- **User data outlives scan data.** Tags and favorites sit in their own table keyed by item. Items of a missing root are kept and flagged offline, so the user data stays attached and the item returns intact when the root does; items of a root the user removes from the library are deleted, and their user data stays in case the root is added again.
- **No writes into library folders.** JSON per root would travel with the folder, which is attractive for shared libraries, but it means writing into folders the user may not own, that may be read-only, or that are synchronized by other tools. Deferred, not rejected: an export/import of tags per root can be added later without changing this layout.
- **Queries later.** Filters by metadata (duration, resolution, alpha), favorites and recently used are a `WHERE` clause away once those columns exist.

## Costs

- `node:sqlite` is marked experimental in Node; its API (`DatabaseSync`) has been stable in practice since 22.13 and prints a warning on older Node. The surface used here is small (exec, prepare, run, get, all).
- One more file in user data, and a database the user cannot read with a text editor. A "rescan everything" is a delete of the database.
- The store runs in the main process only; the UI keeps receiving the index as plain data over IPC, so nothing changes for it.

## Alternatives not taken

- **`better-sqlite3`**: a native module that must be rebuilt per Electron version and bundled per platform. Nothing it offers over `node:sqlite` is needed here.
- **One JSON file in user data**: simplest, but every change rewrites the whole index, and incremental updates and queries would be reimplemented by hand.
- **JSON per root**: writes into library folders; see above.

## Revisit if

- Libraries reach hundreds of thousands of items and scan or query times fall behind the targets in the system design, or
- shared libraries want tags that travel with the folder, which argues for an export per root alongside this database.
