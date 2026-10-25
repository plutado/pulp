import { describe, expect, it } from 'vitest';
import { noteAfterChange, noteFades, NO_NOTE, sayNote } from '../src/core/tray-note';

describe('the collection tray\'s status line', () => {
  const ok = sayNote('Every item now has those output settings.');
  const bad = sayNote('Could not write the file.', true);

  it('tells a confirmation from an error, and an empty text clears it', () => {
    expect(ok.kind).toBe('ok');
    expect(bad.kind).toBe('error');
    expect(sayNote('')).toEqual(NO_NOTE);
    expect(noteFades(ok)).toBe(true);
    expect(noteFades(bad), 'an error waits to be read').toBe(false);
    expect(noteFades(NO_NOTE)).toBe(false);
  });

  it('drops a confirmation the moment the collection changes under it', () => {
    expect(noteAfterChange(ok, 3, true)).toEqual(NO_NOTE);
    // Unchanged, it stands: the message still describes what is there.
    expect(noteAfterChange(ok, 3, false)).toEqual(ok);
  });

  it('keeps an error across a change, so it is not missed', () => {
    expect(noteAfterChange(bad, 3, true)).toEqual(bad);
  });

  it('says nothing at all over an empty collection', () => {
    // The summary beside it already reads "Nothing collected yet."
    expect(noteAfterChange(ok, 0, true)).toEqual(NO_NOTE);
    expect(noteAfterChange(ok, 0, false)).toEqual(NO_NOTE);
    expect(noteAfterChange(bad, 0, true), 'clearing the collection is the action that answered the error').toEqual(NO_NOTE);
  });

  it('leaves an empty line alone', () => {
    expect(noteAfterChange(NO_NOTE, 0, true)).toEqual(NO_NOTE);
    expect(noteAfterChange(NO_NOTE, 5, true)).toEqual(NO_NOTE);
  });
});
