/**
 * Roving keyboard focus (milestone 8): the arithmetic the tabs, the chips, the
 * results grid and the tray's cards all move by.
 */

import { describe, expect, it } from 'vitest';
import { isRovingKey, rovingTarget } from '../src/core/roving';

const row = (key: string, index: number, count = 3) => rovingTarget(key, { count, index, shape: 'row' });
const list = (key: string, index: number, count = 4) => rovingTarget(key, { count, index, shape: 'list' });
const grid = (key: string, index: number, count = 10, columns = 3, page = 2) => rovingTarget(key, { count, index, shape: 'grid', columns, page });

describe('a row of controls: tabs, chips', () => {
  it('moves on Left and Right and wraps at both ends', () => {
    expect(row('ArrowRight', 0)).toBe(1);
    expect(row('ArrowRight', 2)).toBe(0);
    expect(row('ArrowLeft', 0)).toBe(2);
    expect(row('ArrowLeft', 1)).toBe(0);
  });

  it('goes to the ends on Home and End, and ignores the vertical keys', () => {
    expect(row('Home', 2)).toBe(0);
    expect(row('End', 0)).toBe(2);
    expect(row('ArrowDown', 0)).toBeNull();
    expect(row('ArrowUp', 0)).toBeNull();
  });
});

describe('a list: the tray\'s cards', () => {
  it('moves on Up and Down and stops at the ends rather than wrapping', () => {
    expect(list('ArrowDown', 0)).toBe(1);
    expect(list('ArrowDown', 3)).toBe(3);
    expect(list('ArrowUp', 3)).toBe(2);
    expect(list('ArrowUp', 0)).toBe(0);
    expect(list('ArrowRight', 0)).toBeNull();
  });
});

describe('a grid: the results', () => {
  // Ten items, three across: rows are 0-2, 3-5, 6-8, 9.
  it('moves one item across and one row down', () => {
    expect(grid('ArrowRight', 0)).toBe(1);
    expect(grid('ArrowLeft', 4)).toBe(3);
    expect(grid('ArrowDown', 1)).toBe(4);
    expect(grid('ArrowUp', 4)).toBe(1);
  });

  it('keeps the top row and the last item rather than falling off either end', () => {
    expect(grid('ArrowUp', 1), 'the top row stays put').toBe(1);
    expect(grid('ArrowDown', 9), 'the last item stays put').toBe(9);
    // A step down from above a short last row lands on what is there.
    expect(grid('ArrowDown', 8)).toBe(9);
    expect(grid('ArrowRight', 9)).toBe(9);
  });

  it('pages by whole screens of rows, and goes to the ends', () => {
    expect(grid('PageDown', 0)).toBe(6);
    expect(grid('PageDown', 6)).toBe(9);
    expect(grid('PageUp', 9)).toBe(3);
    expect(grid('PageUp', 0)).toBe(0);
    expect(grid('Home', 7)).toBe(0);
    expect(grid('End', 0)).toBe(9);
  });
});

describe('what it answers for', () => {
  it('lands on an end when focus is nowhere yet', () => {
    expect(row('ArrowRight', -1)).toBe(0);
    expect(row('ArrowLeft', -1)).toBe(2);
    expect(list('ArrowDown', -1)).toBe(0);
    expect(grid('ArrowDown', -1)).toBe(0);
    expect(grid('ArrowUp', -1)).toBe(9);
  });

  it('answers for the navigation keys and nothing else, and does nothing with no items', () => {
    expect(isRovingKey('ArrowLeft')).toBe(true);
    expect(isRovingKey('Enter')).toBe(false);
    expect(rovingTarget('Enter', { count: 5, index: 0, shape: 'list' })).toBeNull();
    expect(rovingTarget('ArrowDown', { count: 0, index: -1, shape: 'list' })).toBeNull();
  });

  it('reads a stale index as nowhere rather than stepping from it', () => {
    expect(rovingTarget('ArrowDown', { count: 3, index: 9, shape: 'list' })).toBe(0);
  });
});
