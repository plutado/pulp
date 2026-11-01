/**
 * Pulp's own log, which never leaves the machine (milestone 8). A crash or an
 * error that nobody saw is a bug report nobody can write, so what went wrong
 * is written to a file beside the settings and offered back through Copy
 * diagnostics. Nothing is sent anywhere: there is no reporting service, no
 * network call, and no identifier of any kind.
 *
 * Pure: the line's shape, what is trimmed out of it, and how the file is kept
 * from growing without end are decided here and checked without a disk.
 */

/** How serious a line is. `crash` is a process that went; `error` is one that carried on. */
export type LogLevel = 'crash' | 'error' | 'warn' | 'info';

export interface LogEntry {
  /** When it happened, ISO 8601. */
  at: string;
  level: LogLevel;
  /** Which part said it: `main`, `window`, `stage-window`, `render`, a service's name. */
  source: string;
  message: string;
  /** A stack, a command's output, whatever else was known. */
  detail?: string;
}

/** The file never grows past this; the oldest lines go first. */
export const LOG_MAX_BYTES = 256 * 1024;

/** What Copy diagnostics carries of the log, and what the clipboard text is held under. */
export const LOG_TAIL_LINES = 30;
export const DIAGNOSTICS_MAX_CHARS = 8000;

/**
 * A home directory in a path says who the person is, and a log that is read
 * aloud in an issue should not. Paths under it read as `~` instead; the rest
 * of a line is left exactly as it was, since a stack with the wrong text in
 * it is worse than none.
 */
export function redactHome(text: string, home: string | undefined): string {
  if (!home || home.length < 4) return text;
  // Both separators: a Windows stack carries backslashes, and the same path may arrive either way.
  const forward = home.split('\\').join('/');
  return text.split(home).join('~').split(forward).join('~');
}

/** One line of the log: the time, how serious, who said it, and what they said. */
export function formatLogLine(entry: LogEntry, home?: string): string {
  const detail = entry.detail ? ` | ${entry.detail.split('\n').join(' ⏎ ')}` : '';
  const line = `${entry.at} ${entry.level.toUpperCase()} [${entry.source}] ${entry.message}${detail}`;
  // One line per entry, always: a stack with newlines in it would read as many.
  return redactHome(line.split('\n').join(' ⏎ '), home);
}

/** Bytes a string takes as UTF-8. `TextEncoder` rather than `Buffer`: this module is the web's too. */
const encoder = new TextEncoder();
function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * The file's new contents once a line is added: bounded by dropping whole
 * lines from the front, so the newest are always the ones kept and the file
 * is never half a line.
 */
export function appendBounded(existing: string, line: string, maxBytes = LOG_MAX_BYTES): string {
  // A single line longer than the whole budget is cut rather than looped on forever.
  if (byteLength(line) + 1 > maxBytes) return `${line.slice(0, Math.max(0, maxBytes - 1))}\n`;
  const lines = existing === '' ? [] : existing.split('\n').filter((l) => l !== '');
  lines.push(line);
  let first = 0;
  let out = `${lines.join('\n')}\n`;
  while (byteLength(out) > maxBytes && first < lines.length - 1) {
    first++;
    out = `${lines.slice(first).join('\n')}\n`;
  }
  return out;
}

/** The last lines of the log, newest last, for the diagnostics text. */
export function logTail(contents: string, lines = LOG_TAIL_LINES): string[] {
  return contents.split('\n').filter((l) => l !== '').slice(-lines);
}

// ---------------------------------------------------------------- diagnostics

/** What Copy diagnostics says about the machine and the session. */
export interface DiagnosticsFacts {
  at: string;
  platform: string;
  version: string;
  ffmpeg: string;
  library: string;
  roots: string[];
  background: string;
  renderCache: string;
  project: string;
  renders: number;
  /** Where the log file is, so it can be opened; and its last lines. */
  logPath: string;
  logTail: string[];
}

/**
 * What Pulp knows about itself, as text for the clipboard: enough for someone
 * to say what went wrong without being asked three questions first. No paths
 * beyond the library roots the person chose themselves and the log's own
 * place, and the home directory is taken out of both.
 */
export function diagnosticsText(facts: DiagnosticsFacts, home?: string): string {
  const lines = [
    `Pulp diagnostics — ${facts.at}`,
    `Version: ${facts.version}`,
    `Platform: ${facts.platform}`,
    `ffmpeg: ${facts.ffmpeg}`,
    `Library: ${facts.library}`,
    `Roots: ${facts.roots.length > 0 ? facts.roots.join(', ') : 'none'}`,
    `Background: ${facts.background}`,
    `Render cache: ${facts.renderCache}`,
    `Project: ${facts.project}`,
    `Renders this session: ${facts.renders}`,
    `Log: ${facts.logPath}`,
  ];
  if (facts.logTail.length > 0) lines.push('', `Last ${facts.logTail.length} log ${facts.logTail.length === 1 ? 'line' : 'lines'}:`, ...facts.logTail);
  else lines.push('', 'Log: nothing recorded this session.');
  const text = redactHome(lines.join('\n'), home);
  // Bounded, so the clipboard gets the head of it rather than the whole of a long log.
  return text.length <= DIAGNOSTICS_MAX_CHARS ? text : `${text.slice(0, DIAGNOSTICS_MAX_CHARS - 20)}\n… (truncated)`;
}
