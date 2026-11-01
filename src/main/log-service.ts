/**
 * The log file, and the handlers that fill it (milestone 8).
 *
 * Everything stays on the machine: the file sits beside `settings.json` in
 * user data, nothing is sent anywhere, and the only way out of it is the
 * person copying their own diagnostics or opening the file themselves.
 *
 * What lands here: an exception or a rejection nobody caught in the main
 * process, a renderer or a helper process that went, and whatever the window
 * reports of its own errors. The shape of a line, the bound on the file and
 * the redaction of the home directory are `src/core/log.ts`.
 */

import { app, ipcMain, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { appendBounded, formatLogLine, logTail, LOG_TAIL_LINES, type LogEntry, type LogLevel } from '../core/log';

let filePath: string | null = null;

/** Where the log is written; under user data, so a scratch `PULP_USER_DATA` keeps its own. */
export function logPath(): string {
  filePath ??= join(app.getPath('userData'), 'logs', 'pulp.log');
  return filePath;
}

/**
 * Write one line. Synchronous and swallowing its own failures on purpose:
 * this is called from an uncaught-exception handler, where the process may be
 * on its way out and an async write would never land — and a logger that
 * throws while logging a crash turns one problem into two.
 */
export function logLine(level: LogLevel, source: string, message: string, detail?: string): void {
  const entry: LogEntry = { at: new Date().toISOString(), level, source, message, ...(detail ? { detail } : {}) };
  const line = formatLogLine(entry, homedir());
  try {
    const path = logPath();
    mkdirSync(dirname(path), { recursive: true });
    let existing = '';
    try {
      existing = readFileSync(path, 'utf8');
    } catch {
      // No file yet, or one that cannot be read: this line starts a new one.
    }
    writeFileSync(path, appendBounded(existing, line));
  } catch {
    // Nowhere to write: say it on the console, which a packaged build drops and a dev build shows.
    console.error(line);
  }
}

/** The log's last lines, for the diagnostics text; empty when there is no file yet. */
export function readLogTail(lines = LOG_TAIL_LINES): string[] {
  try {
    return logTail(readFileSync(logPath(), 'utf8'), lines);
  } catch {
    return [];
  }
}

/**
 * Catch what would otherwise be lost. The process handlers are installed
 * before anything else runs, so a failure while the app is still coming up is
 * recorded too.
 */
export function initCrashLog(): void {
  process.on('uncaughtException', (err) => {
    logLine('crash', 'main', err.message || String(err), err.stack);
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : undefined;
    logLine('error', 'main', err?.message ?? `unhandled rejection: ${String(reason)}`, err?.stack);
  });
  app.on('render-process-gone', (_event, _contents, details) => {
    logLine('crash', 'window', `the window's process went: ${details.reason}`, `exit code ${details.exitCode}`);
  });
  app.on('child-process-gone', (_event, details) => {
    logLine('crash', details.type, `a helper process went: ${details.reason}`, `${details.name ?? 'unnamed'}, exit code ${details.exitCode}`);
  });
  logLine('info', 'main', `Pulp ${app.getVersion()} started on ${process.platform}`);
}

/** What the window asks of the log: to record what it caught, to read it back, and to open it. */
export function registerLogIpc(): void {
  ipcMain.handle('log:record', (_event, level: unknown, source: unknown, message: unknown, detail: unknown) => {
    const kind: LogLevel = level === 'crash' || level === 'error' || level === 'warn' ? level : 'info';
    // Bounded: a runaway page cannot fill the disk one report at a time.
    logLine(kind, String(source ?? 'window').slice(0, 40), String(message ?? '').slice(0, 2000), detail === undefined ? undefined : String(detail).slice(0, 4000));
  });
  ipcMain.handle('log:tail', (_event, lines: unknown) => ({
    path: logPath(),
    lines: readLogTail(typeof lines === 'number' && lines > 0 ? Math.min(200, Math.round(lines)) : LOG_TAIL_LINES),
  }));
  ipcMain.handle('log:reveal', () => {
    try {
      // The file may not exist yet; showing its folder is still the right answer.
      shell.showItemInFolder(logPath());
      return true;
    } catch {
      return false;
    }
  });
}
