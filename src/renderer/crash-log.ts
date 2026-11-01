/**
 * What the window catches, written to Pulp's own log (milestone 8): an error
 * nobody handled, a promise nobody caught, and a template page that threw
 * while drawing. Local only — the line goes to the file beside the settings
 * and nowhere else (`src/main/log-service.ts`).
 *
 * The stage's own window is watched too when the stage pops out there
 * (milestone 43): its errors reach no other document, so it is given the same
 * two listeners the moment it opens.
 */

import { onStageWindow } from './stage-window';

/** Said once per message in a run: a loop that throws every frame must not fill the log with one line. */
const said = new Set<string>();

function record(source: string, message: string, detail?: string): void {
  const key = `${source}|${message}`;
  if (said.has(key)) return;
  said.add(key);
  void window.pulp.recordLog('error', source, message, detail);
}

/** Watch a window for what it would otherwise drop on the floor. */
function watch(view: Window, source: string): void {
  view.addEventListener('error', (event) => {
    const e = event as ErrorEvent;
    const where = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '';
    record(source, `${e.message}${where}`, e.error instanceof Error ? e.error.stack : undefined);
  });
  view.addEventListener('unhandledrejection', (event) => {
    const reason = (event as PromiseRejectionEvent).reason as unknown;
    const err = reason instanceof Error ? reason : undefined;
    record(source, err?.message ?? `unhandled rejection: ${String(reason)}`, err?.stack);
  });
}

export function initCrashLog(): void {
  watch(window, 'window');
  // The stage in a window of its own: its errors reach no other document.
  onStageWindow((doc) => {
    const view = doc?.defaultView;
    if (view) watch(view, 'stage-window');
  });
}

/** A template page said it could not draw: worth the log, since the stage only says it in passing. */
export function logTemplateError(templateId: string, message: string): void {
  record('template', `${templateId}: ${message}`);
}
