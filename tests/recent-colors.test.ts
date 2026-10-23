import { describe, expect, it } from 'vitest';
import { addRecentColor, RECENT_COLORS_MAX, sanitizeRecentColors } from '../src/core/recent-colors';

describe('recent colors', () => {
  it('puts the newest first, drops duplicates and keeps eight', () => {
    expect(RECENT_COLORS_MAX).toBe(8);
    let list: string[] = [];
    for (let i = 0; i < 10; i++) list = addRecentColor(list, `#0000${i.toString(16).padStart(2, '0')}`);
    expect(list).toHaveLength(8);
    expect(list[0]).toBe('#000009');
    expect(list.at(-1)).toBe('#000002');
    list = addRecentColor(list, '#000005');
    expect(list[0]).toBe('#000005');
    expect(list.filter((c) => c === '#000005')).toHaveLength(1);
    expect(list).toHaveLength(8);
  });

  it('normalizes case and keeps alpha', () => {
    expect(addRecentColor([], '#111827D9')).toEqual(['#111827d9']);
    expect(addRecentColor(['#111827d9'], '#111827')).toEqual(['#111827', '#111827d9']);
  });

  it('ignores invalid colors', () => {
    expect(addRecentColor(['#ff0000'], 'teal')).toEqual(['#ff0000']);
  });

  it('sanitizes a stored list', () => {
    expect(sanitizeRecentColors(['#FF0000', 'junk', 3, '#ff0000', '#00ff0080'])).toEqual(['#ff0000', '#00ff0080']);
    expect(sanitizeRecentColors('nope')).toEqual([]);
    expect(sanitizeRecentColors(Array.from({ length: 12 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`))).toHaveLength(8);
  });
});
