/**
 * The collection tray's one line of status. A confirmation is brief: it says
 * what just happened and then gets out of the way, because a line that stays
 * reads as a description of what is there now — "Every item now has those
 * output settings." over an empty collection is simply false. An error is the
 * exception: it waits for the next action rather than vanishing unread.
 *
 * Pure: the rules live here, the tray owns the element and the clock.
 */

/** How long a confirmation stays before it fades. */
export const NOTE_MS = 6000;

export interface TrayNote {
  text: string;
  kind: 'none' | 'ok' | 'error';
}

export const NO_NOTE: TrayNote = { text: '', kind: 'none' };

/** What the line becomes when an action reports. An empty text clears it. */
export function sayNote(text: string, bad = false): TrayNote {
  if (text === '') return NO_NOTE;
  return { text, kind: bad ? 'error' : 'ok' };
}

/**
 * What the line becomes when the collection changes under it.
 *
 * - Nothing collected: the summary beside it already says so, and nothing else
 *   belongs there — even an error, since clearing is what the person just did.
 * - The collection changed and the line was a confirmation: it described the
 *   collection as it was, so it goes.
 * - An error survives a change, to be read before the next action replaces it.
 */
export function noteAfterChange(note: TrayNote, items: number, changed: boolean): TrayNote {
  if (note.kind === 'none') return note;
  if (items === 0) return NO_NOTE;
  if (!changed) return note;
  return note.kind === 'error' ? note : NO_NOTE;
}

/** Whether a note should be timed out; only a confirmation fades. */
export function noteFades(note: TrayNote): boolean {
  return note.kind === 'ok';
}
