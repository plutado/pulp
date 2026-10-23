/**
 * Color parameter values: `#rrggbb` or `#rrggbbaa`, lowercase. The native
 * color input cannot hold alpha, so the editor splits a value into the RGB
 * part it can show and an alpha the user edits separately, and joins them back.
 */

export interface SplitColor {
  /** `#rrggbb`, lowercase. */
  rgb: string;
  /** 0 (transparent) to 255 (opaque). */
  alpha: number;
}

const COLOR = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i;

/** Normalize `#RRGGBB` / `#RRGGBBAA` (with or without `#`) to lowercase with `#`, or null if it is not a color. */
export function parseColorText(text: string): string | null {
  const m = COLOR.exec(text.trim());
  if (!m) return null;
  return `#${m[1]!}${m[2] ?? ''}`.toLowerCase();
}

export function splitColor(hex: string): SplitColor {
  const normalized = parseColorText(hex) ?? '#000000';
  return { rgb: normalized.slice(0, 7), alpha: normalized.length === 9 ? parseInt(normalized.slice(7), 16) : 255 };
}

/** `#rrggbb` when opaque, `#rrggbbaa` otherwise. */
export function joinColor(rgb: string, alpha: number): string {
  const a = Math.min(255, Math.max(0, Math.round(alpha)));
  const base = (parseColorText(rgb) ?? '#000000').slice(0, 7);
  return a === 255 ? base : `${base}${a.toString(16).padStart(2, '0')}`;
}

export function alphaToPercent(alpha: number): number {
  return Math.round((alpha / 255) * 100);
}

export function percentToAlpha(percent: number): number {
  return Math.round((Math.min(100, Math.max(0, percent)) / 100) * 255);
}

/** CSS color for a swatch preview. */
export function toCssRgba(hex: string): string {
  const { rgb, alpha } = splitColor(hex);
  const r = parseInt(rgb.slice(1, 3), 16);
  const g = parseInt(rgb.slice(3, 5), 16);
  const b = parseInt(rgb.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${(alpha / 255).toFixed(3)})`;
}
