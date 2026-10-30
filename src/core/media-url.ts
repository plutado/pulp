/** The app-window media scheme and its URL form. Pure; shared with the renderer. */

export const MEDIA_SCHEME = 'pulp-media';

/** pulp-media://<item-id>/ — items are addressed by library id, never by path. */
export function mediaUrlFor(id: string): string {
  return `${MEDIA_SCHEME}://${id}/`;
}

/**
 * pulp-media://<item-id>/<frame> — one frame of a sequence item (milestone 26).
 * The number is an index into the run, not a file name: the handler turns it
 * into one, so nothing a page asks for ever reaches the file system as text.
 */
export function mediaFrameUrlFor(id: string, frame: number): string {
  return `${MEDIA_SCHEME}://${id}/${Math.max(0, Math.floor(frame))}`;
}

/**
 * pulp-media://<item-id>/composite?hide=L1+L4 — a layered file drawn as one
 * picture with some of its layers hidden (milestone 33); with no `hide`, as
 * the file shows it. The handler composites and answers a PNG.
 */
export function psdCompositeUrlFor(id: string, hidden: readonly string[] = []): string {
  const hide = hidden.length > 0 ? `?hide=${hidden.join('+')}` : '';
  return `${MEDIA_SCHEME}://${id}/composite${hide}`;
}

/** pulp-media://<item-id>/layer/L3 — one layer of a layered file alone, on the whole canvas. */
export function psdLayerUrlFor(id: string, layer: string): string {
  return `${MEDIA_SCHEME}://${id}/layer/${layer}`;
}
