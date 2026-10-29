/**
 * A graphic's length, and the parts of it that may stretch (milestone 30).
 *
 * A template is drawn against its own time — `state.time` runs from 0 to the
 * manifest's `duration`, and the template animates against that. A lower third
 * designed at six seconds has an entrance, a hold and an exit inside those six
 * seconds, and until now the only way to keep it on screen for twenty was to
 * not have one.
 *
 * A template may now say where its parts begin and end. The host then asks for
 * a different **length** and maps each moment of it back to a moment of the
 * template's own time: the entrance and the exit play at the speed they were
 * designed at, and only the hold is stretched or squeezed. A template that
 * declares no structure has nothing to stretch and keeps its fixed length,
 * exactly as before.
 *
 * Pure, and the one place the mapping is made, so the preview, the render and
 * the scrub bar cannot disagree about where a moment lands.
 */

/**
 * The parts of a template's own timeline, in seconds from its start. Both are
 * measured on the template's own clock, never on the chosen length: `holdFrom`
 * is where the entrance has finished, `holdTo` where the exit begins.
 */
export interface TemplateStructure {
  holdFrom: number;
  holdTo: number;
}

/** What a template's structure must satisfy to be usable; a manifest saying otherwise is refused. */
export const STRUCTURE_LIMITS = {
  /** The shortest hold a template may declare. Shorter than a frame or two is not a part. */
  minHold: 0.05,
} as const;

/**
 * The structure a manifest declares, or null when it declares none. Checked
 * against the template's own duration: the parts must sit inside it, in order,
 * and leave a hold worth stretching.
 */
export function readStructure(raw: unknown, duration: number): { structure: TemplateStructure | null; problem?: string } {
  if (raw === undefined || raw === null) return { structure: null };
  if (typeof raw !== 'object') return { structure: null, problem: 'must be an object with holdFrom and holdTo, in seconds' };
  const r = raw as Record<string, unknown>;
  const holdFrom = r.holdFrom;
  const holdTo = r.holdTo;
  if (typeof holdFrom !== 'number' || !Number.isFinite(holdFrom) || holdFrom < 0) {
    return { structure: null, problem: 'holdFrom must be a number of seconds from 0' };
  }
  if (typeof holdTo !== 'number' || !Number.isFinite(holdTo) || holdTo > duration) {
    return { structure: null, problem: `holdTo must be a number of seconds up to the duration (${duration})` };
  }
  if (holdTo - holdFrom < STRUCTURE_LIMITS.minHold) {
    return { structure: null, problem: `holdTo must be at least ${STRUCTURE_LIMITS.minHold} s after holdFrom, so there is a hold to stretch` };
  }
  return { structure: { holdFrom, holdTo } };
}

/** Seconds the entrance takes: the template's start up to where the hold begins. */
export function entranceSeconds(structure: TemplateStructure): number {
  return Math.max(0, structure.holdFrom);
}

/** Seconds the exit takes: where the hold ends to the template's own end. */
export function exitSeconds(structure: TemplateStructure, duration: number): number {
  return Math.max(0, duration - structure.holdTo);
}

/**
 * The shortest length a template with this structure can be asked for: its
 * entrance and its exit, plus the least hold worth the name. Below this the
 * parts would have to play faster than they were designed to, which is the one
 * thing this is meant not to do.
 */
export function minimumLength(structure: TemplateStructure, duration: number): number {
  return round(entranceSeconds(structure) + exitSeconds(structure, duration) + STRUCTURE_LIMITS.minHold);
}

/** Seconds, to the millisecond: lengths are shown and stored as tidy numbers. */
function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * The length a template will actually be rendered at: what was asked for,
 * held to what the structure allows, or the template's own duration when
 * nothing was asked for or nothing may stretch.
 */
export function resolveLength(
  duration: number,
  structure: TemplateStructure | null,
  asked: number | undefined,
): number {
  if (asked === undefined || !Number.isFinite(asked) || asked <= 0) return round(duration);
  if (!structure) return round(duration);
  return round(Math.max(minimumLength(structure, duration), asked));
}

/**
 * Where a moment of the **chosen** length lands on the template's **own**
 * timeline. The entrance and the exit keep their designed speed, so a moment
 * inside either maps across one for one; the hold takes up whatever is left,
 * stretched or squeezed to fit.
 *
 * With no structure, or at the template's own length, this is the identity —
 * which is what keeps every template that says nothing rendering exactly as it
 * did.
 */
export function templateTimeAt(time: number, duration: number, structure: TemplateStructure | null, length: number): number {
  if (!structure || length === duration || !Number.isFinite(time)) return clamp(time, 0, duration);
  const entrance = entranceSeconds(structure);
  const exit = exitSeconds(structure, duration);
  const t = clamp(time, 0, length);
  // Every branch is held inside the template's own time: the arithmetic below lands a
  // hair past the end at the last moment of a stretched graphic, and a time outside the
  // template is one it was never drawn for.
  const own = (seconds: number): number => clamp(seconds, 0, duration);
  // The entrance, played as designed from the start.
  if (t <= entrance) return own(t);
  // The exit, played as designed and ending where the template ends.
  const exitBegins = length - exit;
  if (t >= exitBegins) return own(structure.holdTo + (t - exitBegins));
  // The hold, which takes up the rest. A hold squeezed to nothing holds its first moment.
  const askedHold = exitBegins - entrance;
  const ownHold = structure.holdTo - structure.holdFrom;
  if (askedHold <= 0) return own(structure.holdFrom);
  return own(structure.holdFrom + ((t - entrance) / askedHold) * ownHold);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The three parts of a chosen length, in seconds of **that** length: what the
 * scrub bar shades, and what a drag on the hold's edges moves.
 */
export interface LengthParts {
  entrance: number;
  holdFrom: number;
  holdTo: number;
  exit: number;
  length: number;
}

export function lengthParts(duration: number, structure: TemplateStructure | null, length: number): LengthParts {
  if (!structure) return { entrance: 0, holdFrom: 0, holdTo: round(length), exit: 0, length: round(length) };
  const entrance = entranceSeconds(structure);
  const exit = exitSeconds(structure, duration);
  return {
    entrance: round(entrance),
    holdFrom: round(entrance),
    holdTo: round(Math.max(entrance, length - exit)),
    exit: round(exit),
    length: round(length),
  };
}

/** Frames a render of this length holds, at this rate. */
export function lengthFrameCount(length: number, fps: number): number {
  return Math.max(1, Math.round(length * fps));
}
