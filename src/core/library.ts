/**
 * Library indexer: walks user-chosen folders and builds an index of templates
 * (folders containing a template.json) and media files.
 *
 * `scanLibrary` is the one-shot form: a throwaway in-memory store scanned
 * once. The app itself keeps a persistent store (library-store.ts) and
 * rescans incrementally. Uses node:fs and node:sqlite only; no Electron.
 */

import type { LibraryIndex } from './library-types';
import { LibraryStore, type ScanOptions } from './library-store';
import { normalizeTag } from './tags';

export { normalizeTag };
export type * from './library-types';
export { MEDIA_EXTENSIONS, folderTags, loadTemplate, mediaKindForPath } from './library-scan';
export type { ScanOptions } from './library-store';

/** Scan the given roots and build a library index. Missing roots are reported as problems, not thrown. */
export async function scanLibrary(roots: string[], options: ScanOptions = {}): Promise<LibraryIndex> {
  const store = new LibraryStore(':memory:');
  try {
    store.setRoots(roots);
    await store.scanRoots(roots, options);
    return store.toIndex();
  } finally {
    store.close();
  }
}
