/**
 * The one rule every template-relative path obeys, on its own so the manifest
 * and the fields that carry paths (src/core/template-sound.ts) share it
 * without importing each other.
 */

/** Rejects absolute paths and parent-directory traversal in template-relative paths. */
export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) return false;
  return !value.split(/[\\/]/).some((segment) => segment === '..');
}
