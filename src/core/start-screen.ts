/**
 * The start screen (milestone 31), the pure part: what it offers and in what
 * order. Shown at launch and from File → Home. The renderer
 * (src/renderer/start-screen.ts) draws these; nothing here touches the DOM,
 * Electron or a file, so every rule the screen follows is testable on its own.
 */

import { ASPECTS } from './aspect';
import type { Scope } from './app-state';
import type { LibraryIndex } from './library-types';
import { SAMPLE_MEDIA_FOLDER_NAME } from './sample-media';
import { typeLabel } from './display';

// ---------------------------------------------------------------- get going

/** New project by shape: every aspect the output system knows, said in words. */
export const PROJECT_SHAPES: readonly { id: string; label: string; hint: string }[] = ASPECTS.map((a) => ({
  id: a.id,
  label: a.id,
  hint: a.w > a.h ? 'Landscape' : a.w < a.h ? 'Vertical' : 'Square',
}));

// ---------------------------------------------------------------- what are you making?

/**
 * Plain starting points, each leading into the browse categories that serve it,
 * so a first-time user starts from what they want to make rather than from how
 * the library is sorted. The scopes are the browse tree's own nodes (the same
 * label and filter), so choosing one lands on a row the panel can fold to.
 */
export interface MakingChoice {
  id: string;
  label: string;
  /** What choosing it narrows the library to, in words. */
  hint: string;
  scope: Scope;
}

export const MAKING_CHOICES: readonly MakingChoice[] = [
  { id: 'interview', label: 'An interview', hint: 'Lower thirds to name who is speaking', scope: { label: 'Lower third', filter: 'type:lower-third', kind: 'type', group: 'titles' } },
  { id: 'sports', label: 'A sports opener', hint: 'Openers, score bugs and countdowns', scope: { label: 'Sports', filter: 'theme:sports', kind: 'theme' } },
  { id: 'wedding', label: 'A wedding', hint: 'Elegant titles, reveals and counters', scope: { label: 'Wedding', filter: 'theme:wedding', kind: 'theme' } },
  { id: 'social', label: 'A social clip', hint: 'Cards, handles and subscribe graphics', scope: { label: 'Social media', filter: 'theme:social-media', kind: 'theme' } },
  { id: 'news', label: 'A news package', hint: 'Openers, tickers, bugs and captions', scope: { label: 'News / broadcast', filter: 'theme:news', kind: 'theme' } },
];

// ---------------------------------------------------------------- set up and status

export interface SetupFacts {
  ffmpegOk: boolean;
  /** Library roots as scanned, with the bundled one named, so "a folder of your own" can be told apart. */
  roots: readonly string[];
  builtInRoot?: string;
}

export interface ChecklistItem {
  id: 'ffmpeg' | 'folder' | 'samples';
  label: string;
  done: boolean;
  /** What the button that does it says; empty when it is done or nothing here can do it. */
  action: string;
}

/** A root is the sample-media folder by its name, which the generator fixes (src/core/sample-media.ts). */
export function hasSampleMedia(roots: readonly string[]): boolean {
  return roots.some((r) => r.split(/[\\/]/).filter(Boolean).pop() === SAMPLE_MEDIA_FOLDER_NAME);
}

/**
 * The first-run checklist: each item is something the window can do with one
 * press. FFmpeg cannot be installed from here, so its undone action points at
 * the thing a person checks rather than pretending to a button.
 */
export function setupChecklist(facts: SetupFacts): ChecklistItem[] {
  const userFolders = facts.roots.filter((r) => r !== facts.builtInRoot);
  return [
    {
      id: 'ffmpeg',
      label: facts.ffmpegOk ? 'FFmpeg found, so rendering works' : 'FFmpeg not found — install it to render',
      done: facts.ffmpegOk,
      action: '',
    },
    {
      id: 'folder',
      label: userFolders.length > 0 ? 'A library folder of your own is added' : 'Add a library folder of your own',
      done: userFolders.length > 0,
      action: userFolders.length > 0 ? '' : 'Add folder…',
    },
    {
      id: 'samples',
      label: hasSampleMedia(facts.roots) ? 'Sample media is made' : 'Make sample media to try templates with',
      done: hasSampleMedia(facts.roots),
      action: hasSampleMedia(facts.roots) ? '' : 'Make sample media',
    },
  ];
}

/** The library at a glance: counts, favourites, and the most common template categories. */
export function libraryGlance(index: LibraryIndex | null): string {
  if (!index) return 'The library has not been scanned yet.';
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const favorites = [...index.templates, ...index.media].filter((e) => e.favorite).length;
  const byType = new Map<string, number>();
  for (const t of index.templates) {
    const type = t.manifest.type;
    if (type) byType.set(type, (byType.get(type) ?? 0) + 1);
  }
  const top = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => typeLabel(id));
  const parts = [`${plural(index.templates.length, 'template')} and ${plural(index.media.length, 'media file')}`];
  if (favorites > 0) parts.push(plural(favorites, 'favorite'));
  if (top.length > 0) parts.push(`most of all ${top.join(', ').toLowerCase()}`);
  return `${parts.join(' · ')}.`;
}

// ---------------------------------------------------------------- recent projects

export interface RecentProjectRow {
  path: string;
  /** The file's own name, without its extension. */
  name: string;
  pinned: boolean;
  /** ISO timestamp of the last open or save; empty where none was recorded. */
  lastOpened: string;
  /** The file is not where the list says it is. */
  missing: boolean;
  /** Manifest id of the project's first template, whose thumbnail stands for the project. */
  thumbTemplateId?: string;
}

/** The name a project file is shown by, the same rule the recent menu uses. */
export function projectFileName(path: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return name.replace(/\.(pulp|pulpcollection)$/i, '');
}

/** Pinned first, then newest first; what the list is for is reaching the thing you keep reaching for. */
export function orderRecents(rows: readonly RecentProjectRow[]): RecentProjectRow[] {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.lastOpened || '').localeCompare(a.lastOpened || '');
  });
}

/** "Yesterday", "3 days ago": a recent list is read relative to now, not as timestamps. */
export function lastOpenedLabel(iso: string, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

// ---------------------------------------------------------------- the tour

/**
 * The guided walkthrough: each step points at one region by its element id.
 * The renderer highlights the element and shows the words; a step whose target
 * is collapsed or missing is skipped rather than pointing at nothing.
 */
export interface TourStep {
  /** The element id the step highlights. */
  target: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: 'region-browse',
    title: 'Browse panel',
    body: 'The library, sorted by type, theme, style, pack and folder. Choose a category to narrow the results; the search box above the results narrows them further.',
  },
  {
    target: 'region-results',
    title: 'Results',
    body: 'Everything the category and the search leave. Choose an item to preview it on the stage; drag it to the collection tray to keep it for rendering.',
  },
  {
    target: 'region-stage',
    title: 'Stage',
    body: 'The preview. Play it, scrub it, set in and out points, and move or resize layers right on the picture.',
  },
  {
    target: 'tab-parameters',
    title: 'Parameters tab',
    body: 'The selected template’s own settings: its words, colors and layout. The Output tab beside it chooses the format, size and trim of a render.',
  },
  {
    target: 'region-tray',
    title: 'Collection tray',
    body: 'The items gathered for this project, each with its own settings, rendered in one go with Render all. A finished render drags straight into your editor.',
  },
];
