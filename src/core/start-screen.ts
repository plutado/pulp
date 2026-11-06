/**
 * The start screen (milestone 31), the pure part: what it offers and in what
 * order. Shown at launch and from File → Home. The renderer
 * (src/renderer/start-screen.ts) draws these; nothing here touches the DOM,
 * Electron or a file, so every rule the screen follows is testable on its own.
 */

import { ASPECTS } from './aspect';
import type { Scope } from './app-state';
import type { LibraryEntry, LibraryIndex, TemplateEntry } from './library-types';
import { categoryInfo, categoryScope } from './categories';
import { entryType } from './taxonomy';
import { SAMPLE_MEDIA_FOLDER_NAME } from './sample-media';
import { typeLabel } from './display';
import { tr } from './i18n';

// ---------------------------------------------------------------- get going

/** New project by shape: every aspect the output system knows, said in words — in the interface's language now (a getter, milestone 59). */
export const PROJECT_SHAPES: readonly { id: string; label: string; readonly hint: string }[] = ASPECTS.map((a) => {
  const shape = a.w > a.h ? 'landscape' : a.w < a.h ? 'vertical' : 'square';
  return {
    id: a.id,
    label: a.id,
    get hint() { return tr(`start.shape.${shape}`); },
  };
});

// ---------------------------------------------------------------- what are you making?

/**
 * Plain starting points, each opening the browse category that serves it with
 * its "For…" chip set (milestone 34): Interview → Lower thirds › For:
 * Podcast / interview. A first-time user starts from what they want to make
 * rather than from how the library is sorted.
 */
export interface MakingChoice {
  id: string;
  label: string;
  /** What choosing it narrows the library to, in words. */
  hint: string;
  /** A browse category's id (src/core/categories.ts). */
  category: string;
  /** The theme the "For…" chip is set to — when the library has anything in the category carrying it. */
  forTheme: string;
}

/** Named in the interface's language now: the label and hint are getters reading the catalog (milestone 59). */
export const MAKING_CHOICES: readonly MakingChoice[] = [
  { id: 'interview', get label() { return tr('start.making.interview'); }, get hint() { return tr('start.making.interview.hint'); }, category: 'lower-thirds', forTheme: 'podcast' },
  { id: 'sports', get label() { return tr('start.making.sports'); }, get hint() { return tr('start.making.sports.hint'); }, category: 'titles-openers', forTheme: 'sports' },
  { id: 'wedding', get label() { return tr('start.making.wedding'); }, get hint() { return tr('start.making.wedding.hint'); }, category: 'titles-openers', forTheme: 'wedding' },
  { id: 'social', get label() { return tr('start.making.social'); }, get hint() { return tr('start.making.social.hint'); }, category: 'titles-openers', forTheme: 'social-media' },
  { id: 'news', get label() { return tr('start.making.news'); }, get hint() { return tr('start.making.news.hint'); }, category: 'lower-thirds', forTheme: 'news' },
];

/**
 * Where a choice lands: the category's scope, and the theme for the "For…"
 * chip — but only when something in that category carries the theme, since a
 * chip that empties the results would be a worse start than none.
 */
export function makingChoiceLanding(choice: MakingChoice, entries: readonly LibraryEntry[]): { scope: Scope; forTheme: string | null } | null {
  const category = categoryInfo(choice.category);
  const scope = category ? categoryScope(category) : null;
  if (!scope) return null;
  const types = new Set(category!.types);
  const carried = entries.some((e) => {
    const type = entryType(e);
    return type !== undefined && types.has(type) && (e.themes ?? []).includes(choice.forTheme);
  });
  return { scope, forTheme: carried ? choice.forTheme : null };
}

// ---------------------------------------------------------------- set up and status

export interface SetupFacts {
  ffmpegOk: boolean;
  /** True where Pulp has a build it could fetch for this machine (milestone 17, ADR 0022). */
  ffmpegDownloadable?: boolean;
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
 * press. FFmpeg still cannot be *installed* from here — it is a program on
 * the machine, not a setting — but since milestone 17 Pulp can fetch a build
 * of its own, so the undone item offers the way to that, which says what it
 * would fetch before it fetches anything. Where there is no build for this
 * machine the item is a sentence again, since a button that cannot act is
 * worse than none.
 */
export function setupChecklist(facts: SetupFacts): ChecklistItem[] {
  const userFolders = facts.roots.filter((r) => r !== facts.builtInRoot);
  return [
    {
      id: 'ffmpeg',
      label: facts.ffmpegOk ? tr('start.setup.ffmpeg.done') : tr('start.setup.ffmpeg.todo'),
      done: facts.ffmpegOk,
      action: !facts.ffmpegOk && facts.ffmpegDownloadable ? tr('start.setup.ffmpeg.action') : '',
    },
    {
      id: 'folder',
      label: userFolders.length > 0 ? tr('start.setup.folder.done') : tr('start.setup.folder.todo'),
      done: userFolders.length > 0,
      action: userFolders.length > 0 ? '' : tr('start.setup.folder.action'),
    },
    {
      id: 'samples',
      label: hasSampleMedia(facts.roots) ? tr('start.setup.samples.done') : tr('start.setup.samples.todo'),
      done: hasSampleMedia(facts.roots),
      action: hasSampleMedia(facts.roots) ? '' : tr('start.setup.samples.action'),
    },
  ];
}

/**
 * First run and returning, each with its own arrangement (milestone 60). The
 * screen is arranged by two facts: whether the set-up checklist is finished,
 * and whether there is work to continue. On a first run the checklist is a
 * card near the top with its progress, and Continue gives way to a short
 * invitation; once set up, the checklist leaves the screen (Help → Set-up
 * Checklist still shows it) and Continue leads with the most recent work.
 */
export interface StartArrangement {
  /** The checklist is not finished yet: the screen leads with getting set up. */
  firstRun: boolean;
  /** Continue is shown: there is recent work and the screen is not a first run. */
  showContinue: boolean;
  /** The set-up card is shown: a first run, or asked for from Help. */
  showChecklist: boolean;
  /** "2 of 3 done", for the card's head. */
  progress: string;
}

export function checklistProgress(items: readonly ChecklistItem[]): string {
  return tr('start.setup.progress', { done: items.filter((i) => i.done).length, total: items.length });
}

export function startArrangement(items: readonly ChecklistItem[], recents: number, checklistAsked = false): StartArrangement {
  const firstRun = items.some((i) => !i.done);
  return {
    firstRun,
    showContinue: !firstRun && recents > 0,
    showChecklist: firstRun || checklistAsked,
    progress: checklistProgress(items),
  };
}

/**
 * The real picture an idea card wears (milestone 60): a template from the
 * category the choice leads into — one carrying the choice's theme where the
 * library has one, any of the category's otherwise — preferring one whose
 * thumbnail is already made, so the card shows what the idea makes rather
 * than a label on an empty well.
 */
export function ideaPicture(choice: MakingChoice, index: LibraryIndex | null, preferMade = true): TemplateEntry | undefined {
  if (!index) return undefined;
  const category = categoryInfo(choice.category);
  if (!category) return undefined;
  const types = new Set(category.types);
  const inCategory = index.templates.filter((t) => {
    const type = entryType(t);
    return type !== undefined && types.has(type);
  });
  const themed = inCategory.filter((t) => (t.themes ?? []).includes(choice.forTheme));
  const pool = themed.length > 0 ? themed : inCategory;
  // The references pin the pick to the pool's first, so a poster arriving later never moves it.
  return preferMade ? pool.find((t) => t.thumbnail) ?? pool[0] : pool[0];
}

/** The library at a glance: counts, favorites, and the most common template categories. */
export function libraryGlance(index: LibraryIndex | null): string {
  if (!index) return tr('start.glance.not-scanned');
  const favorites = [...index.templates, ...index.media].filter((e) => e.favorite).length;
  const byType = new Map<string, number>();
  for (const t of index.templates) {
    const type = t.manifest.type;
    if (type) byType.set(type, (byType.get(type) ?? 0) + 1);
  }
  const top = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => typeLabel(id));
  // One sentence per shape the line can take, the counts as phrases inside it (milestone 59).
  const values = {
    templates: tr('start.glance.templates', { count: index.templates.length }),
    media: tr('start.glance.media-files', { count: index.media.length }),
    favoriteCount: tr('start.glance.favorites', { count: favorites }),
    types: top.join(', ').toLowerCase(),
  };
  if (favorites > 0 && top.length > 0) return tr('start.glance.summary.favorites-types', values);
  if (favorites > 0) return tr('start.glance.summary.favorites', values);
  if (top.length > 0) return tr('start.glance.summary.types', values);
  return tr('start.glance.summary', values);
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
  if (days <= 0) return tr('start.recent.today');
  if (days === 1) return tr('start.recent.yesterday');
  if (days < 30) return tr('start.recent.days-ago', { count: days });
  const months = Math.floor(days / 30);
  if (months < 12) return tr('start.recent.months-ago', { count: months });
  const years = Math.floor(days / 365);
  return tr('start.recent.years-ago', { count: years });
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

/** In the interface's language now: each step's words are getters reading the catalog (milestone 59). */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: 'region-search',
    get title() { return tr('tour.step.search.title'); },
    get body() { return tr('tour.step.search.body'); },
  },
  {
    target: 'browse-tree',
    get title() { return tr('tour.step.browse.title'); },
    get body() { return tr('tour.step.browse.body'); },
  },
  {
    target: 'region-results',
    get title() { return tr('tour.step.results.title'); },
    get body() { return tr('tour.step.results.body'); },
  },
  {
    target: 'region-stage',
    get title() { return tr('tour.step.stage.title'); },
    get body() { return tr('tour.step.stage.body'); },
  },
  {
    target: 'region-transport',
    get title() { return tr('tour.step.transport.title'); },
    get body() { return tr('tour.step.transport.body'); },
  },
  {
    target: 'tab-parameters',
    get title() { return tr('tour.step.inspector.title'); },
    get body() { return tr('tour.step.inspector.body'); },
  },
  {
    target: 'region-tray',
    get title() { return tr('tour.step.tray.title'); },
    get body() { return tr('tour.step.tray.body'); },
  },
];
