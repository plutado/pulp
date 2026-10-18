/** Tag helpers shared by the indexer and search. Pure; safe to use in the renderer. */

/** Turn a folder name or user input into a tag: "Lower Thirds" -> "lower-thirds". */
export function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
