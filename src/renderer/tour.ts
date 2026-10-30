/**
 * The guided tour (milestone 31): a short walkthrough of the window — browse
 * panel, results, stage, Parameters tab, collection tray — one step at a time,
 * with the region highlighted and Next and Skip. The steps themselves are pure
 * (TOUR_STEPS in src/core/start-screen.ts); this positions and pages them.
 *
 * Offered from the start screen and replayable from Help → Take the Tour.
 * Taking it or skipping it is remembered, so the start screen stops suggesting
 * it after the first time.
 */

import { TOUR_STEPS, type TourStep } from '../core/start-screen';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

let at = -1;

/** The steps whose target is actually on screen; a collapsed region is not pointed at. */
function visibleSteps(): TourStep[] {
  return TOUR_STEPS.filter((s) => {
    const el = document.getElementById(s.target);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function place(step: TourStep): void {
  const el = document.getElementById(step.target);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const ring = $('tour-ring');
  ring.style.left = `${rect.left - 4}px`;
  ring.style.top = `${rect.top - 4}px`;
  ring.style.width = `${rect.width + 8}px`;
  ring.style.height = `${rect.height + 8}px`;
  // The card sits beside the highlight where there is room, under it otherwise, and never off screen.
  const card = $('tour-card');
  card.style.visibility = 'hidden';
  card.style.left = '0px';
  card.style.top = '0px';
  requestAnimationFrame(() => {
    const size = card.getBoundingClientRect();
    let left = rect.right + 16;
    let top = rect.top;
    if (left + size.width > window.innerWidth - 8) left = Math.max(8, rect.left - size.width - 16);
    if (left < 8 || (left < rect.right && left + size.width > rect.left && rect.width > window.innerWidth * 0.8)) {
      left = Math.max(8, Math.min(window.innerWidth - size.width - 8, rect.left));
      top = rect.bottom + 16 + size.height > window.innerHeight ? Math.max(8, rect.top - size.height - 16) : rect.bottom + 16;
    }
    card.style.left = `${Math.max(8, Math.min(window.innerWidth - size.width - 8, left))}px`;
    card.style.top = `${Math.max(8, Math.min(window.innerHeight - size.height - 8, top))}px`;
    card.style.visibility = '';
  });
}

function show(steps: TourStep[]): void {
  const step = steps[at];
  if (!step) {
    endTour();
    return;
  }
  $('tour-title').textContent = step.title;
  $('tour-body').textContent = step.body;
  $('tour-count').textContent = `${at + 1} of ${steps.length}`;
  $<HTMLButtonElement>('tour-back').disabled = at === 0;
  $('tour-next').textContent = at === steps.length - 1 ? 'Done' : 'Next';
  place(step);
}

/** Done or skipped, the answer is the same: it was offered, and need not be again. */
export function endTour(): void {
  if ($('tour-overlay').hidden) return;
  $('tour-overlay').hidden = true;
  at = -1;
  void window.pulp.setTourSeen();
}

export function tourRunning(): boolean {
  return !$('tour-overlay').hidden;
}

export function startTour(): void {
  const steps = visibleSteps();
  if (steps.length === 0) return;
  at = 0;
  $('tour-overlay').hidden = false;
  show(steps);
}

export function initTour(): void {
  $('tour-next').addEventListener('click', () => {
    const steps = visibleSteps();
    at += 1;
    if (at >= steps.length) endTour();
    else show(steps);
  });
  $('tour-back').addEventListener('click', () => {
    if (at <= 0) return;
    at -= 1;
    show(visibleSteps());
  });
  $('tour-skip').addEventListener('click', endTour);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tourRunning()) endTour();
  });
  // The window changing shape moves every region, so the highlight follows.
  window.addEventListener('resize', () => {
    if (!tourRunning()) return;
    const step = visibleSteps()[at];
    if (step) place(step);
  });
}
