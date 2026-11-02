/**
 * A project file handed over by the system (milestone 17): what the three
 * platforms send, read down to one path.
 */

import { describe, expect, it } from 'vitest';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COLLECTION_EXTENSION, isProjectFile, PROJECT_EXTENSION, projectFileArg } from '../src/core/open-file';

describe('the file double-clicked, as the main process sees it', () => {
  it('finds a project or a collection among the arguments, whatever else is there', () => {
    expect(projectFileArg(['/Applications/Pulp.app/Contents/MacOS/Pulp', '/Users/me/show.pulp'], '/')).toBe('/Users/me/show.pulp');
    expect(projectFileArg(['Pulp.exe', 'C:\\work\\show.PULP'], 'C:\\')).toBe('C:\\work\\show.PULP');
    // Resolved the way the platform resolves it: on Windows a rooted path takes the drive.
    expect(projectFileArg(['pulp', 'gathered.pulpcollection'], '/home/me')).toBe(resolve('/home/me', 'gathered.pulpcollection'));
    // Electron in a checkout: the app folder is an argument too, and is not a file.
    expect(projectFileArg(['electron', '.', '--remote-debugging-port=9222', 'a.pulp'], '/w')).toBe(resolve('/w', 'a.pulp'));
  });

  it('passes over flags and the values that follow them', () => {
    // `--out` names a render's output, which happens to end the same way.
    expect(projectFileArg(['pulp', '--render', 'x', '--out', '/tmp/a.pulp'], '/')).toBeNull();
    expect(projectFileArg(['pulp', '--collection', '/tmp/c.pulpcollection'], '/')).toBeNull();
    // An inline value is one argument, so the next is read on its own merits.
    expect(projectFileArg(['pulp', '--param=a=b', '/tmp/a.pulp'], '/')).toBe('/tmp/a.pulp');
  });

  it('reads a file URL back to its path, which is how a Linux launcher may hand one over', () => {
    // The URL of a path on this platform, since Windows reads a file URL only with its drive.
    const target = resolve('/home/me/my show.pulp');
    const found = projectFileArg(['pulp', pathToFileURL(target).href], '/');
    expect(pathToFileURL(target).href).toContain('my%20show.pulp');
    expect(found).toBe(target);
    expect(isAbsolute(found!)).toBe(true);
    // A URL that is not a file's is not a path to open.
    expect(projectFileArg(['pulp', 'https://example.com/a.pulp'], '/')).toBeNull();
  });

  it('names nothing when nothing is there', () => {
    expect(projectFileArg(['pulp'], '/')).toBeNull();
    expect(projectFileArg(['pulp', 'notes.txt', 'clip.mp4'], '/')).toBeNull();
  });

  it('knows the two files by their extension, in any case', () => {
    expect(isProjectFile(`a.${PROJECT_EXTENSION}`)).toBe(true);
    expect(isProjectFile(`a.${COLLECTION_EXTENSION}`)).toBe(true);
    expect(isProjectFile('a.Pulp')).toBe(true);
    expect(isProjectFile('a.pulp.bak')).toBe(false);
    expect(isProjectFile('pulp')).toBe(false);
  });
});
