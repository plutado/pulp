/**
 * The one dispatcher, shared (milestone 39). A command named by the
 * application menu and one named by the stage's right-click menu are the same
 * command and must do the same thing, so there is one function that runs them
 * — `run` in ./menu.ts, which presses the very buttons the window offers.
 *
 * It is registered here rather than imported, for the reason the layer editor
 * is (./layer-edit.ts): the right-click menu is built by a module ./menu.ts
 * itself imports, so reaching the other way would be a cycle — and would drag
 * the whole window into anything that wanted to run a command.
 */

import type { MenuCommand } from '../core/menu';

type Runner = (command: MenuCommand, arg: string | null) => void;

let runner: Runner | null = null;

export function registerCommandRunner(fn: Runner): void {
  runner = fn;
}

/** Run a command, wherever it was asked for. Nothing happens before the window has wired itself up. */
export function runCommand(command: MenuCommand, arg: string | null = null): void {
  runner?.(command, arg);
}
