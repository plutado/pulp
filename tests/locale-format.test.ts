/**
 * Formats that follow the locale (milestone 59, src/core/locale-format.ts): numbers, sizes and
 * dates written as the interface's language writes them, and what editors read the same left alone.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { setCurrentLocale, SOURCE_LOCALE, translator } from '../src/core/i18n';
import { formatDate, formatDateTime, formatNumber } from '../src/core/locale-format';
import { dimensionsLabel, durationLabel, frameRateLabel, sizeLabel } from '../src/core/display';
import { dateLabel } from '../src/core/item-info';
import { limitsCheckedDate } from '../src/core/platform-presets';
import { shownTemplateName } from '../src/core/library-words';
import type { LibraryIndex } from '../src/core/library-types';

afterEach(() => setCurrentLocale(SOURCE_LOCALE));

describe('numbers, sizes and dates in the interface\'s language', () => {
  it('writes numbers with the locale\'s grouping and decimal mark', () => {
    expect(formatNumber(1234.5, 1, 'en-US')).toBe('1,234.5');
    expect(formatNumber(1234.5, 1, 'de')).toBe('1.234,5');
    expect(formatNumber(1234.5, 1, 'zh-CN')).toBe('1,234.5');
  });

  it('writes file sizes and durations the same way', () => {
    setCurrentLocale('de');
    expect(sizeLabel(1.5 * 1024 * 1024)).toBe('1,5 MB');
    expect(sizeLabel(2.25 * 1024 ** 3)).toBe('2,25 GB');
    expect(sizeLabel(512)).toBe('512 B');
    expect(durationLabel(1.5)).toBe('1,5 s');
    setCurrentLocale('en-US');
    expect(sizeLabel(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(sizeLabel(3 * 1024 * 1024)).toBe('3 MB');
  });

  it('writes a count in a message as the locale writes numbers', () => {
    expect(translator('de')('display.item-count', { count: 12345 })).toContain('12.345');
    expect(translator('en-US')('display.item-count', { count: 12345 })).toContain('12,345');
  });

  it('leaves frame rates and resolutions as editors read them, in every language', () => {
    setCurrentLocale('de');
    expect(frameRateLabel(29.97)).toContain('29.97');
    expect(dimensionsLabel(1920, 1080)).toContain('1920');
  });

  it('writes dates as each language does', () => {
    const day = new Date(2026, 10, 1, 12).getTime();
    expect(formatDate(day, 'en-US')).toBe('November 1, 2026');
    expect(formatDate(day, 'en-GB')).toBe('1 November 2026');
    expect(formatDate(day, 'de')).toBe('1. November 2026');
    expect(formatDate(day, 'zh-CN')).toBe('2026年11月1日');
    expect(formatDateTime(new Date(2026, 9, 24, 14, 5).getTime(), 'de')).toBe('24.10.2026, 14:05');
    setCurrentLocale('zh-CN');
    expect(limitsCheckedDate('2026-11-01')).toBe('2026年11月1日');
    expect(dateLabel(new Date(2026, 9, 24, 14, 5).getTime())).toMatch(/^2026年10月24日/);
  });
});

describe('a template\'s stored name, shown in the window\'s language', () => {
  const index = { templates: [{ manifest: { id: 'pulp.samples.airliner', name: 'Verkehrsflugzeug' }, source: { name: 'Airliner', description: '' } }] } as unknown as LibraryIndex;
  it('shows the translated name for the English one, keeps a detail after it, and leaves a person\'s own name', () => {
    expect(shownTemplateName('Airliner', 'pulp.samples.airliner', index)).toBe('Verkehrsflugzeug');
    expect(shownTemplateName('Airliner · Alex', 'pulp.samples.airliner', index)).toBe('Verkehrsflugzeug · Alex');
    expect(shownTemplateName('My plane', 'pulp.samples.airliner', index)).toBe('My plane');
    expect(shownTemplateName('Airliner', undefined, index)).toBe('Airliner');
    expect(shownTemplateName('Airliner', 'pulp.samples.airliner', null)).toBe('Airliner');
  });
});
