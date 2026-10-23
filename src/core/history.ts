/**
 * Linear undo history over snapshots. Pure. The caller keeps the current
 * state; the history keeps what came before (and, after an undo, what came
 * after). `push` records the state being replaced, so an edit is:
 * `history.push(previous); current = next`.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly limit = 200) {}

  /** Record the state an edit replaces. Any redo states are discarded. */
  push(previous: T): void {
    this.past.push(previous);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** The state before the last edit, or undefined if there is none. `current` becomes redoable. */
  undo(current: T): T | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.push(current);
    return previous;
  }

  /** The state undone last, or undefined if there is none. `current` becomes undoable. */
  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
