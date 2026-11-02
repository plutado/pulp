/**
 * A project file handed to Pulp by the system (milestone 17): the one
 * double-clicked in a file manager, dropped on the Dock icon, or named on the
 * command line. What arrives differs by platform — macOS sends an `open-file`
 * event with a path; Windows and Linux start a second copy of the app with
 * the path among its arguments, and a Linux launcher may spell it as a
 * `file://` URL — and this is the one place that reads all of them down to a
 * path the project opener takes.
 *
 * Pure: the argument list in, a path or nothing out. The events, the single
 * instance and the hand-over to the window are src/main/index.ts.
 */

import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The two files Pulp opens as a project: its own, and a collection read as one (milestone 27). */
export const PROJECT_EXTENSION = 'pulp';
export const COLLECTION_EXTENSION = 'pulpcollection';

/** True for a path or URL naming one of the files Pulp opens, by its extension alone. */
export function isProjectFile(candidate: string): boolean {
  return new RegExp(`\\.(${PROJECT_EXTENSION}|${COLLECTION_EXTENSION})$`, 'i').test(candidate.trim());
}

/**
 * The project file among a process's arguments, as an absolute path, or null.
 * Flags and the values that follow them are passed over — `--out a.pulp` is a
 * render's output, not a file to open — and a `file://` URL, which is how a
 * desktop's `%U` may hand a file over, is read back to its path. Relative
 * paths are resolved against `cwd`, which a second instance reports as the
 * folder it was started from.
 */
export function projectFileArg(argv: readonly string[], cwd: string): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      // A flag with its value in the next argument, unless the value is inline (`--flag=x`).
      if (!arg.includes('=')) i += 1;
      continue;
    }
    if (!isProjectFile(arg)) continue;
    // Any other scheme names something Pulp does not open; it is not a relative path either.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]+:\/\//.test(arg) && !/^file:\/\//i.test(arg)) continue;
    if (/^file:\/\//i.test(arg)) {
      try {
        return fileURLToPath(arg);
      } catch {
        continue;
      }
    }
    // A drive-letter path is absolute wherever it is read, including a test on another platform.
    return isAbsolute(arg) || /^[a-zA-Z]:[\\/]/.test(arg) ? arg : resolve(cwd, arg);
  }
  return null;
}
