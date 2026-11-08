/**
 * Mounting a stock library's disc image (milestone 32), in the main process:
 * the platform's own tool run read-only, the mount point remembered so the
 * image can be unmounted when the library is removed and when Pulp quits, and
 * every failure said plainly. The commands and the parsing are pure
 * (src/core/disc-image.ts); the runner is injectable, so tests mount nothing.
 */

import { existsSync } from 'node:fs';
import { tr } from '../core/i18n';
import { type Command, type MountPlatform, type MountProblem, discImageKind, mountCommand, mountLinuxCommand, parseLoopDevice, parseMountOutput, platformMounts, toolDetail, unmountCommands } from '../core/disc-image';
import { nodeRunner, type ProcessRunner } from '../core/ffmpeg';

export type MountResult = { ok: true; path: string } | { ok: false; problem: MountProblem };

/** What Pulp mounted this session, by image: where, and the loop device on Linux. */
const mounted = new Map<string, { path: string; device?: string }>();

const platform = (): MountPlatform => (process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux');

async function runCommand(run: ProcessRunner, command: Command): Promise<{ code: number; stdout: string; stderr: string } | { missing: true }> {
  try {
    return await run(command.program, command.args);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { missing: true };
    return { code: 1, stdout: '', stderr: (err as Error).message };
  }
}

/**
 * Mount an image read-only and answer its mount point. An image this platform's tool does not
 * mount, a tool that is not there, an image that is not there, and a tool that refuses are each a
 * problem of their own kind, said in the person's language by `mountProblemMessage`.
 */
export async function mountDiscImage(image: string, run: ProcessRunner = nodeRunner, on: MountPlatform = platform()): Promise<MountResult> {
  const known = mounted.get(image);
  if (known && existsSync(known.path)) return { ok: true, path: known.path };
  if (!existsSync(image)) return { ok: false, problem: { kind: 'missing' } };
  if (!platformMounts(image, on)) return { ok: false, problem: { kind: 'format', ext: discImageKind(image) } };
  const first = mountCommand(image, on);
  const result = await runCommand(run, first);
  if ('missing' in result) return { ok: false, problem: { kind: 'no-tool', program: first.program } };
  if (result.code !== 0) return { ok: false, problem: { kind: 'refused', detail: toolDetail(result.stderr, result.stdout) } };
  if (on === 'linux') {
    const device = parseLoopDevice(result.stdout);
    if (!device) return { ok: false, problem: { kind: 'refused', detail: toolDetail(result.stderr, result.stdout) } };
    const second = await runCommand(run, mountLinuxCommand(device));
    if ('missing' in second || second.code !== 0) {
      await runCommand(run, { program: 'udisksctl', args: ['loop-delete', '-b', device] });
      // i18n-exempt(technical): the tool's name, as the message names what is missing
      return { ok: false, problem: { kind: 'refused', detail: 'missing' in second ? 'udisksctl' : toolDetail(second.stderr, second.stdout) } };
    }
    const path = parseMountOutput(second.stdout, on);
    if (!path) return { ok: false, problem: { kind: 'refused', detail: toolDetail(second.stderr, second.stdout) } };
    mounted.set(image, { path, device });
    return { ok: true, path };
  }
  const path = parseMountOutput(result.stdout, on);
  if (!path) return { ok: false, problem: { kind: 'refused', detail: toolDetail(result.stderr, result.stdout) || tr('stock.image.no-mount-point') } };
  mounted.set(image, { path });
  return { ok: true, path };
}

/** Unmount an image Pulp mounted; one Pulp did not mount is left alone. True when it was Pulp's. */
export async function unmountDiscImage(image: string, run: ProcessRunner = nodeRunner, on: MountPlatform = platform()): Promise<boolean> {
  const known = mounted.get(image);
  if (!known) return false;
  for (const command of unmountCommands(image, known.path, on, known.device)) {
    const result = await runCommand(run, command);
    if ('missing' in result || result.code !== 0) console.warn(`disc image: ${command.program} ${command.args.join(' ')} failed: ${'missing' in result ? 'not found' : result.stderr.trim()}`);
  }
  mounted.delete(image);
  return true;
}

/** Unmount everything Pulp mounted this session: for quitting. */
export async function unmountAllDiscImages(run: ProcessRunner = nodeRunner, on: MountPlatform = platform()): Promise<void> {
  for (const image of [...mounted.keys()]) await unmountDiscImage(image, run, on);
}

/** Where Pulp mounted an image this session, if it did. */
export function mountedAt(image: string): string | undefined {
  return mounted.get(image)?.path;
}

/** For tests: forget what was mounted without running anything. */
export function forgetMounts(): void {
  mounted.clear();
}

/** The problem in the person's words. */
export function mountProblemMessage(problem: MountProblem, image: string): string {
  const file = image.split(/[\\/]/).pop() ?? image;
  switch (problem.kind) {
    case 'format':
      return tr('stock.image.cannot-mount.format', { file, ext: problem.ext });
    case 'no-tool':
      return tr('stock.image.cannot-mount.no-tool', { file, program: problem.program });
    case 'missing':
      return tr('stock.image.cannot-mount.missing', { path: image });
    case 'refused':
      return tr('stock.image.cannot-mount.refused', { file, detail: problem.detail });
  }
}
