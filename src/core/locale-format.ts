/**
 * Formats that follow the locale (milestone 59): numbers, file sizes and dates
 * written the way the interface's language writes them. German groups
 * thousands with a point and writes a decimal comma ("1.234", "2,5 MB",
 * "6. Nov. 2026, 14:05"), Chinese writes dates with its own characters
 * ("2026年11月6日"), and US English stays as it reads now.
 *
 * What editors read the same everywhere is left alone, and never passes through
 * here: timecode, frame rates ("29.97 fps"), resolutions ("1920 × 1080"),
 * aspect ratios, codecs and file formats.
 */

import { currentLocale, type LocaleId } from './i18n';

const numbers = new Map<string, Intl.NumberFormat>();
const dates = new Map<string, Intl.DateTimeFormat>();

function numberFormat(locale: LocaleId, digits: number): Intl.NumberFormat {
  const key = `${locale}|${digits}`;
  let f = numbers.get(key);
  if (!f) numbers.set(key, (f = new Intl.NumberFormat(locale, { maximumFractionDigits: digits })));
  return f;
}

/** A number in the interface's language: its grouping and its decimal mark, up to `digits` decimals. */
export function formatNumber(n: number, digits = 2, locale: LocaleId = currentLocale.value): string {
  return Number.isFinite(n) ? numberFormat(locale, digits).format(n) : String(n);
}

/** A moment, by date and time ("Nov 6, 2026, 2:05 PM"; "06.11.2026, 14:05"; "2026/11/6 14:05"). */
export function formatDateTime(ms: number, locale: LocaleId = currentLocale.value): string {
  return dateFormat(locale, 'datetime').format(new Date(ms));
}

/** A day, written out ("November 1, 2026"; "1. November 2026"; "2026年11月1日"). */
export function formatDate(ms: number, locale: LocaleId = currentLocale.value): string {
  return dateFormat(locale, 'date').format(new Date(ms));
}

function dateFormat(locale: LocaleId, kind: 'datetime' | 'date'): Intl.DateTimeFormat {
  const key = `${locale}|${kind}`;
  let f = dates.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, kind === 'date' ? { dateStyle: 'long' } : { dateStyle: 'medium', timeStyle: 'short' });
    dates.set(key, f);
  }
  return f;
}
