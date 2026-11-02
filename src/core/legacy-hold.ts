/**
 * The "Hold, seconds" parameter, translated into a length (milestone 30's
 * last loose end).
 *
 * Eleven bundled templates used to offer a number called **Hold, seconds** —
 * `inOut` on nine of them, `hold` on two — which could only shorten the hold
 * inside the template's own duration, never carry the graphic past it. When
 * those templates declared their parts, the parameter went: the **length** is
 * the control now, and two ways to set the same thing would fight.
 *
 * Saved work did not go with it. A preset, a collection item, a
 * `.pulpcollection`, a `.pulp` project, a CSV row or a `--param` written
 * before the change still carries a value for a parameter that no longer
 * exists, and until now it was simply dropped — reported as an unknown
 * parameter and rendered at the template's own hold, which is not what the
 * person asked for.
 *
 * It is translated instead: **the declared entrance and exit plus the saved
 * hold**, held inside the length's own limits, written as `@length`. The
 * saved number was the seconds the graphic should sit still, and that is
 * exactly what the length then gives it — for longer than the old parameter
 * could, since it was clamped by the template's fixed duration and the length
 * is not.
 *
 * Two things are deliberately left alone. A bag that already names a
 * `@length` keeps it: a length someone chose outranks one inferred from a
 * parameter that no longer exists. And nothing outside the eleven is touched
 * — `inOut` is a live parameter ("Animate in/out") on thirty other templates,
 * and a template of someone else's that happens to use the name means
 * whatever it means.
 *
 * Pure, so every kind of saved work is translated by the one arithmetic:
 * `applyPreset` for the window, `renderTemplate` for everything that renders,
 * and `planBatch` for a CSV's column.
 */

import { LENGTH_KEY } from './params';
import type { TemplateManifest } from './manifest';
import { entranceSeconds, exitSeconds, maximumLength, minimumLength, type TemplateStructure } from './timing';

/** What a template needs to say for a saved hold to be translated against it. */
export type HoldManifest = Pick<TemplateManifest, 'id' | 'duration'> & { structure?: TemplateStructure };

/**
 * The eleven templates that lost the parameter, against the id each used for
 * it. Pinned rather than guessed: the name `inOut` still means "Animate
 * in/out" on templates that declare it, so only a template known to have lost
 * a **hold** of that name may have one translated.
 *
 * `tests/legacy-hold.test.ts` holds this table to the bundled templates — each
 * one still there, still declaring a hold to stretch, and no longer declaring
 * the parameter — so re-adding one of these parameters fails there rather
 * than quietly translating a value that is no longer legacy.
 */
export const LEGACY_HOLD_PARAMS: Readonly<Record<string, string>> = {
  'pulp.samples.citation-callout': 'inOut',
  'pulp.samples.city-lights-opener': 'inOut',
  'pulp.samples.civic-opener': 'inOut',
  'pulp.samples.donation-counter': 'inOut',
  'pulp.samples.fitness-counter': 'inOut',
  'pulp.samples.hairline-lower-third': 'hold',
  'pulp.samples.handle-card': 'inOut',
  'pulp.samples.kicker-title': 'hold',
  'pulp.samples.lap-counter': 'inOut',
  'pulp.samples.poll-strip': 'inOut',
  'pulp.samples.profile-card': 'inOut',
};

/** The label all eleven gave it, which a CSV column may be headed with instead of the id. */
export const LEGACY_HOLD_LABEL = 'Hold, seconds';

/** The parameter this template lost, or undefined for every other template. */
export function legacyHoldParam(manifestId: string): string | undefined {
  return LEGACY_HOLD_PARAMS[manifestId];
}

/** True when this CSV header names the lost parameter of this template, by its id or its old label. */
export function isLegacyHoldHeader(manifest: Pick<HoldManifest, 'id'>, header: string): boolean {
  const key = legacyHoldParam(manifest.id);
  if (key === undefined) return false;
  const h = header.trim().toLowerCase();
  return h === key.toLowerCase() || h === LEGACY_HOLD_LABEL.toLowerCase();
}

/**
 * The length a saved hold of `seconds` means: the entrance and the exit the
 * template declares, with that hold between them, held inside the limits the
 * length has anyway. Null when the number is not one, or the template has no
 * hold to stretch.
 */
export function lengthForLegacyHold(manifest: HoldManifest, seconds: unknown): number | null {
  const structure = manifest.structure;
  if (!structure || structure.kind !== 'hold') return null;
  const hold = typeof seconds === 'number' ? seconds : Number(String(seconds ?? '').trim());
  if (!Number.isFinite(hold) || hold <= 0) return null;
  const wanted = entranceSeconds(structure) + hold + exitSeconds(structure, manifest.duration);
  const held = Math.min(maximumLength(structure, manifest.duration), Math.max(minimumLength(structure, manifest.duration), wanted));
  return Math.round(held * 1000) / 1000;
}

export interface LegacyHoldResult {
  /** The bag with the lost parameter translated and taken out; the very same bag when there was nothing to do. */
  params: Record<string, unknown>;
  /** What happened, for a render's warnings; absent when nothing was translated. */
  note?: string;
}

/**
 * A bag of saved parameters with a lost "Hold, seconds" turned into the
 * length that matches it. The same object comes back, by identity, when
 * there is nothing to translate, so a caller can tell one from the other.
 */
export function withLegacyHold(manifest: HoldManifest, raw: Record<string, unknown>): LegacyHoldResult {
  const key = legacyHoldParam(manifest.id);
  if (key === undefined || !Object.prototype.hasOwnProperty.call(raw, key)) return { params: raw };
  const saved = raw[key];
  const rest = { ...raw };
  delete rest[key];
  // A length that was chosen outranks one worked out from a parameter that no longer exists.
  if (raw[LENGTH_KEY] !== undefined) {
    return { params: rest, note: `"${LEGACY_HOLD_LABEL}" is no longer a parameter; the length saved with this one is used instead.` };
  }
  const length = lengthForLegacyHold(manifest, saved);
  if (length === null) return { params: rest };
  return {
    params: { ...rest, [LENGTH_KEY]: length },
    note: `"${LEGACY_HOLD_LABEL}" is no longer a parameter: the saved ${saved} s became a length of ${length} s.`,
  };
}
