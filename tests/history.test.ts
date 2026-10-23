import { describe, expect, it } from 'vitest';
import { History } from '../src/core/history';

describe('History', () => {
  it('undoes and redoes in order', () => {
    const h = new History<string>();
    expect(h.canUndo).toBe(false);
    h.push('a'); // a -> b
    h.push('b'); // b -> c
    expect(h.canUndo).toBe(true);
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBe('a');
    expect(h.undo('a')).toBeUndefined();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(h.redo('a')).toBe('b');
    expect(h.redo('b')).toBe('c');
    expect(h.redo('c')).toBeUndefined();
  });

  it('discards redo states when a new edit is pushed', () => {
    const h = new History<number>();
    h.push(1);
    h.push(2);
    expect(h.undo(3)).toBe(2);
    h.push(2); // new edit from 2 to 4
    expect(h.canRedo).toBe(false);
    expect(h.undo(4)).toBe(2);
    expect(h.undo(2)).toBe(1);
  });

  it('keeps only the newest states up to the limit', () => {
    const h = new History<number>(3);
    for (let i = 0; i < 5; i++) h.push(i);
    expect(h.undo(5)).toBe(4);
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeUndefined();
  });

  it('clears both stacks', () => {
    const h = new History<number>();
    h.push(1);
    h.undo(2);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
