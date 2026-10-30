import { describe, expect, it } from 'vitest';
import { itemFor, parseCollection, serializeCollection, type Collection } from '../src/core/collection';
import {
  emptyProject, hasUnsavedChanges, missingPaths, parseProject, pathShift, projectFromCollection, PROJECT_FORMAT_VERSION,
  relinkItem, sameProject, serializeProject, shiftPath, type Project,
} from '../src/core/project';
import type { MediaEntry } from '../src/core/library-types';

const media = (over: Partial<MediaEntry> = {}): MediaEntry => ({
  kind: 'media', key: 'k', id: 'a'.repeat(24), path: '/Volumes/Old/Assets/fire.mov', root: '/Volumes/Old',
  name: 'fire', mediaKind: 'video', ext: '.mov', size: 10, mtimeMs: 1, tags: [], ...over,
});

const project = (over: Partial<Project> = {}): Project => ({
  collection: { items: [itemFor(media(), 'png-sequence')] },
  libraryFolders: ['/Volumes/Old'],
  ...over,
});

describe('the .pulp project file (milestone 27)', () => {
  it('holds a collection, the folders it draws from and where it renders', () => {
    const p = project({ renderFolder: '/Users/me/Renders' });
    const text = serializeProject(p);
    expect(JSON.parse(text)).toMatchObject({ formatVersion: PROJECT_FORMAT_VERSION, libraryFolders: ['/Volumes/Old'], renderFolder: '/Users/me/Renders' });
    const read = parseProject(text);
    expect(read.ok && read.project).toEqual(p);
    // A render folder nobody set is not written, so a project that has none says nothing about one.
    expect(JSON.parse(serializeProject(project()))).not.toHaveProperty('renderFolder');
  });

  it('refuses a file it cannot vouch for, by name, rather than half-reading it', () => {
    expect(parseProject('not json')).toEqual({ ok: false, error: 'That file is not a project: it is not readable JSON.' });
    expect(parseProject('[]')).toEqual({ ok: false, error: 'That file is not a project.' });
    const later = parseProject(JSON.stringify({ formatVersion: 99, items: [] }));
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.error).toContain(`this version of Pulp reads ${PROJECT_FORMAT_VERSION}`);
  });

  it('ignores a field a later Pulp added, and fills in one an earlier one left out', () => {
    const read = parseProject(JSON.stringify({ formatVersion: PROJECT_FORMAT_VERSION, items: [], mood: 'blue' }));
    expect(read.ok && read.project).toEqual(emptyProject);
    // Folders that are not strings, or empty, are not folders.
    const odd = parseProject(JSON.stringify({ formatVersion: PROJECT_FORMAT_VERSION, items: [], libraryFolders: ['/a', 7, '  '], renderFolder: ' ' }));
    expect(odd.ok && odd.project).toEqual({ collection: { items: [] }, libraryFolders: ['/a'] });
  });

  it('opens a collection file as a project, and holds items a collection would', () => {
    const c: Collection = { items: [itemFor(media(), 'png-sequence')] };
    const asProject = projectFromCollection(c);
    expect(asProject).toEqual({ collection: c, libraryFolders: [] });
    // The items are read by the collection's own reader, so the two cannot drift.
    const read = parseProject(serializeProject(asProject));
    expect(read.ok && read.project.collection.items[0]).toMatchObject({ id: 'a'.repeat(24), presetId: 'png-sequence', path: '/Volumes/Old/Assets/fire.mov' });
    // And a collection written by this build carries the path too, so an older file simply has none.
    expect(parseCollection(serializeCollection(c)).ok).toBe(true);
    const older = parseCollection(JSON.stringify({ formatVersion: 1, items: [{ id: 'b'.repeat(24), presetId: 'png-sequence' }] }));
    expect(older.ok && older.collection.items[0]).not.toHaveProperty('path');
  });

  it('knows whether there is anything unsaved: what would be written, not what is in memory', () => {
    const p = project();
    expect(sameProject(p, { ...p, collection: { items: [...p.collection.items] } })).toBe(true);
    expect(sameProject(p, { ...p, libraryFolders: ['/elsewhere'] })).toBe(false);
    expect(sameProject(p, { ...p, renderFolder: '/Renders' })).toBe(false);
    expect(sameProject(emptyProject, emptyProject)).toBe(true);
  });
});

describe('media that moved (milestone 27)', () => {
  it('names what is missing by where it used to be, and passes over what never said', () => {
    const withPath = itemFor(media(), 'png-sequence');
    const noPath = { ...itemFor(media({ id: 'b'.repeat(24) }), 'png-sequence') };
    delete noPath.path;
    expect(missingPaths([withPath, noPath], new Set([withPath.uid, noPath.uid]))).toEqual([{ uid: withPath.uid, path: '/Volumes/Old/Assets/fire.mov' }]);
    expect(missingPaths([withPath], new Set())).toEqual([]);
  });

  it('works out where a folder went from one file found again, and follows it for the rest', () => {
    const shift = pathShift('/Volumes/Old/Assets/fire.mov', '/Users/me/Media/Assets/fire.mov')!;
    expect(shift).toMatchObject({ from: '/Volumes/Old', to: '/Users/me/Media' });
    // Everything else under the old folder moves the same way, whatever it is nested in.
    expect(shiftPath('/Volumes/Old/Clips/x.mov', shift)).toBe('/Users/me/Media/Clips/x.mov');
    expect(shiftPath('/Volumes/Old', shift)).toBe('/Users/me/Media');
    // Something that was never under it is left alone rather than guessed at.
    expect(shiftPath('/Volumes/Other/x.mov', shift)).toBeNull();
    // A near-miss on the name is not a match: "/Volumes/Older" is a different folder.
    expect(shiftPath('/Volumes/Older/x.mov', shift)).toBeNull();
  });

  it('says nothing about the neighbours when the file was renamed rather than moved', () => {
    // Nothing trails in common, so where the folder went cannot be told from this; that one item
    // is relinked and the rest are left to be relinked themselves rather than bound to the wrong files.
    expect(pathShift('/Volumes/Old/Assets/fire.mov', '/Users/me/Media/Assets/flame.mov')).toBeNull();
    expect(pathShift('/a/x.mov', '/b/y.mov')).toBeNull();
  });

  it('relinks across the two kinds of separator, so a project written on Windows opens on a Mac', () => {
    const shift = pathShift('D:\\Stock\\Assets\\fire.mov', '/Users/me/Media/Assets/fire.mov')!;
    expect(shift).toMatchObject({ from: 'D:/Stock', to: '/Users/me/Media', separator: '/' });
    expect(shiftPath('D:\\Stock\\Clips\\x.mov', shift)).toBe('/Users/me/Media/Clips/x.mov');
    const back = pathShift('/Volumes/Old/Assets/fire.mov', 'D:\\Media\\Assets\\fire.mov')!;
    expect(back.separator).toBe('\\');
    expect(shiftPath('/Volumes/Old/Clips/x.mov', back)).toBe('D:\\Media\\Clips\\x.mov');
  });

  it('rebinds an item to the file it was found at, id and path together', () => {
    const item = itemFor(media(), 'png-sequence');
    const c: Collection = { items: [item] };
    const next = relinkItem(c, item.uid, { id: 'c'.repeat(24), path: '/Users/me/Media/Assets/fire.mov' });
    expect(next.items[0]).toMatchObject({ id: 'c'.repeat(24), path: '/Users/me/Media/Assets/fire.mov', uid: item.uid });
    // Its settings are untouched: relinking says where the file is, not how it renders.
    expect(next.items[0]!.presetId).toBe(item.presetId);
    // An item that is not there changes nothing, so nothing re-renders.
    expect(relinkItem(c, 'nope', { id: 'd'.repeat(24), path: '/x' })).toBe(c);
  });
});

describe('unsaved changes (milestone 27)', () => {
  const base = project();

  it('is what a person edited, not what the machine happens to have', () => {
    expect(hasUnsavedChanges(base, base)).toBe(false);
    // The library folders are a record of the computer, not of the work: a project opened where
    // the folders differ, or one saved after a folder was added, has nothing unsaved in it.
    expect(hasUnsavedChanges({ ...base, libraryFolders: ['/elsewhere'] }, base)).toBe(false);
    expect(hasUnsavedChanges({ ...base, libraryFolders: [] }, base)).toBe(false);
    // What was collected, and where it renders, are the work.
    expect(hasUnsavedChanges({ ...base, collection: { items: [] } }, base)).toBe(true);
    expect(hasUnsavedChanges({ ...base, renderFolder: '/Renders' }, base)).toBe(true);
    // A change inside an item counts: the parameters are the point of saving a project.
    const edited = { ...base, collection: { items: [{ ...base.collection.items[0]!, params: { title: 'Hello' } }] } };
    expect(hasUnsavedChanges(edited, base)).toBe(true);
  });

  it('is not fooled by a new object holding the same thing', () => {
    const copy: Project = JSON.parse(JSON.stringify(base)) as Project;
    expect(copy).not.toBe(base);
    expect(hasUnsavedChanges(copy, base)).toBe(false);
  });
});
