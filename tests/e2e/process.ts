/**
 * Processes the end-to-end tests start — ffmpeg, ffprobe, Electron, the build —
 * all go through one runner that cannot hang the suite (docs/platform-notes.md,
 * "Windows CI"): stdin is never a pipe, every run has a time limit, and a run
 * that overstays is killed as a whole process tree, which on Windows means
 * Chromium's helper processes too. A run that was cut short says so instead
 * of never returning.
 */

import { spawn, spawnSync } from 'node:child_process';

export interface BoundedResult<T extends string | Buffer = string> {
  /** The exit code, or null when the process was killed. */
  code: number | null;
  stdout: T;
  stderr: string;
  /** True when the time limit cut the run short; `code` is then null. */
  timedOut: boolean;
}

export interface BoundedOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Hard limit on the run. Required: an unbounded wait is how a CI job stalls for hours. */
  timeoutMs: number;
  /** Most output kept per stream. */
  maxBuffer?: number;
}

/** Kill a process and everything it started. Windows kills only the one process by default, and Electron is many. */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

function runBoundedWith<T extends string | Buffer>(command: string, args: string[], opts: BoundedOptions, encoding: 'utf8' | 'buffer'): Promise<BoundedResult<T>> {
  const maxBuffer = opts.maxBuffer ?? 16 * 1024 * 1024;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      // No stdin: a tool that polls its input (ffmpeg does) sees a closed handle, not a pipe nobody writes to.
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let settled = false;
    const keep = (chunks: Buffer[], bytes: number, chunk: Buffer): number => {
      if (bytes < maxBuffer) chunks.push(chunk.subarray(0, Math.max(0, maxBuffer - bytes)));
      return bytes + chunk.length;
    };
    child.stdout?.on('data', (c: Buffer) => (outBytes = keep(out, outBytes, c)));
    child.stderr?.on('data', (c: Buffer) => (errBytes = keep(err, errBytes, c)));
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err).toString('utf8') + (timedOut ? `\n[${command} killed after ${opts.timeoutMs} ms]` : '');
      resolve({ code: timedOut ? null : code, stdout: (encoding === 'buffer' ? stdout : stdout.toString('utf8')) as T, stderr, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, opts.timeoutMs);
    let grace: ReturnType<typeof setTimeout> | undefined;
    child.on('error', () => finish(null));
    // 'close' waits for the pipes, which a surviving grandchild can hold open after the child has exited;
    // once the child itself has exited, give the pipes a moment and then stop waiting for them.
    child.on('exit', (code) => {
      grace = setTimeout(() => finish(code), 2_000);
    });
    child.on('close', (code) => finish(code));
  });
}

/** Run to completion or to the time limit, with text output. */
export function runBounded(command: string, args: string[], opts: BoundedOptions): Promise<BoundedResult<string>> {
  return runBoundedWith<string>(command, args, opts, 'utf8');
}

/** The same, keeping stdout as bytes (raw pixels). */
export function runBoundedBuffer(command: string, args: string[], opts: BoundedOptions): Promise<BoundedResult<Buffer>> {
  return runBoundedWith<Buffer>(command, args, opts, 'buffer');
}

/** ffmpeg arguments with `-nostdin` first: it never waits on, or reads commands from, its standard input. */
export function ffmpegArgs(args: string[]): string[] {
  return ['-nostdin', ...args];
}
