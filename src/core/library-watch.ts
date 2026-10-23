/**
 * Folder watching for library roots. Recursive fs.watch works on macOS and
 * Windows, and on Linux with Node 20 or later; where it is not available the
 * watcher is simply absent and the app falls back to rescans on focus and on
 * demand. Events are coalesced: one callback per quiet period. Uses node:fs only.
 */

import { watch, type FSWatcher } from 'node:fs';

export interface RootWatcher {
  close(): void;
}

/** Watch a root for any change; returns null where recursive watching is not supported. */
export function watchRoot(root: string, onChange: () => void, quietMs = 750): RootWatcher | null {
  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true, persistent: false });
  } catch {
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, quietMs);
  };
  watcher.on('change', fire);
  // A watcher error (for example the root being removed) is reported as a change so the owner rescans.
  watcher.on('error', fire);
  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    },
  };
}
