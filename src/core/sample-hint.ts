/**
 * "N more with sample media" (milestone 34): while a category being browsed
 * has catalogue files that have not been made, the results say how many and
 * offer to make just those — quicker than the whole 626-file catalogue, and
 * the only hint anywhere that a thin-looking category is thin because nothing
 * has been generated yet, not because Pulp has nothing to offer there.
 *
 * What counts as "not made" is the main process's business (it looks in the
 * sample-media folder); this module turns that count into the line, the
 * button and the work the button asks for. Pure, so the words and the
 * arithmetic are checked without a window.
 */

import { scopeTypes } from './categories';
import type { Scope } from './app-state';

/** How many catalogue files are still to make, per taxonomy type; types with none left are absent. */
export type UnmadeByType = Readonly<Record<string, number>>;

export interface SampleHint {
  /** How many files the line offers, which is what the button would make. */
  count: number;
  /** The line under the results. */
  label: string;
  /** What the button says. */
  action: string;
  /** Why it is worth pressing, and what it costs. */
  tip: string;
  /** The taxonomy types to make: what is in view, never the whole catalogue. */
  types: readonly string[];
}

/**
 * The hint for what is being browsed, or null when there is nothing to offer:
 * a scope that is not a place in the taxonomy (a folder, Favorites, a search
 * of its own), or a category whose sample media is all made — once nothing is
 * left, the line and the button go, so nobody is offered more than there is.
 */
export function sampleHint(scope: Scope | null, unmade: UnmadeByType, label = scope?.label ?? ''): SampleHint | null {
  const types = scopeTypes(scope);
  if (types.length === 0) return null;
  const count = types.reduce((sum, type) => sum + (unmade[type] ?? 0), 0);
  if (count <= 0) return null;
  return {
    count,
    label: `${count} more with sample media`,
    action: 'Make them',
    tip: `Make ${count} original CC0 ${count === 1 ? 'file' : 'files'} for ${label || 'this category'} and add them to your library. Just these, not the whole catalogue; sounds and clips need FFmpeg.`,
    types,
  };
}

/** What a run of the generator wrote, as the line reports it when the work is done. */
export function sampleHintOutcome(written: number, failed: number): string {
  if (written === 0 && failed === 0) return 'Nothing left to make.';
  const made = `Made ${written} ${written === 1 ? 'file' : 'files'}.`;
  return failed === 0 ? made : `${made} ${failed} could not be made.`;
}
