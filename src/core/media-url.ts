/** The app-window media scheme and its URL form. Pure; shared with the renderer. */

export const MEDIA_SCHEME = 'pulp-media';

/** pulp-media://<item-id>/ — items are addressed by library id, never by path. */
export function mediaUrlFor(id: string): string {
  return `${MEDIA_SCHEME}://${id}/`;
}
