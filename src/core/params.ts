/**
 * Parameter resolution: merge user-supplied values with manifest defaults.
 *
 * Input values come from the parameter form, saved presets, or the command
 * line, so they are treated as untrusted. Every resolved value is guaranteed
 * to match its declared type; anything that cannot be used falls back to the
 * default and is reported as an issue rather than throwing.
 */

import { sanitizeImageValue, type ImageValue } from './image-slot';
import { isValidColor, type TemplateManifest, type TemplateParameter } from './manifest';

export type ParamValue = string | number | boolean | ImageValue | null;
export type ResolvedParams = Record<string, ParamValue>;

export interface ParamIssue {
  id: string;
  message: string;
}

export interface ResolveResult {
  values: ResolvedParams;
  issues: ParamIssue[];
}

function resolveOne(param: TemplateParameter, input: unknown, issues: ParamIssue[]): ParamValue {
  const fallback = (message: string): ParamValue => {
    issues.push({ id: param.id, message: `${message}; using default` });
    return param.default;
  };

  switch (param.type) {
    case 'text': {
      if (typeof input !== 'string') return fallback('expected a string');
      let value = param.multiline ? input : input.replace(/[\r\n]+/g, ' ');
      if (param.maxLength !== undefined && value.length > param.maxLength) {
        issues.push({ id: param.id, message: `truncated to ${param.maxLength} characters` });
        value = value.slice(0, param.maxLength);
      }
      return value;
    }
    case 'color': {
      if (!isValidColor(input)) return fallback('expected #RRGGBB or #RRGGBBAA');
      return input.toLowerCase();
    }
    case 'number': {
      const n = typeof input === 'string' && input.trim() !== '' ? Number(input) : input;
      if (typeof n !== 'number' || !Number.isFinite(n)) return fallback('expected a finite number');
      let value = n;
      if (param.step !== undefined) {
        const base = param.min ?? 0;
        value = base + Math.round((value - base) / param.step) * param.step;
        // Avoid float noise such as 0.30000000000000004.
        value = Number(value.toFixed(10));
      }
      if (param.min !== undefined && value < param.min) value = param.min;
      if (param.max !== undefined && value > param.max) value = param.max;
      if (value !== n) issues.push({ id: param.id, message: `adjusted from ${n} to ${value}` });
      return value;
    }
    case 'boolean': {
      if (typeof input === 'boolean') return input;
      if (input === 'true') return true;
      if (input === 'false') return false;
      return fallback('expected a boolean');
    }
    case 'select': {
      if (typeof input !== 'string' || !param.options.some((o) => o.value === input)) {
        return fallback('not one of the allowed options');
      }
      return input;
    }
    case 'font': {
      if (typeof input !== 'string' || input.trim() === '') return fallback('expected a font family');
      if (param.options && !param.options.includes(input)) return fallback('not one of the allowed fonts');
      return input;
    }
    case 'image': {
      // A library id (with its treatment), or nothing; never a path.
      const value = sanitizeImageValue(input);
      if (value === undefined) return fallback('expected a library image id');
      return value;
    }
  }
}

/**
 * Resolve the full parameter set for a template.
 *
 * - Missing values use the manifest default (not an issue).
 * - Invalid values use the default and produce an issue.
 * - Values for unknown parameter ids are ignored and produce an issue.
 */
export function resolveParams(
  manifest: Pick<TemplateManifest, 'parameters'>,
  input: Record<string, unknown> = {},
): ResolveResult {
  const values: ResolvedParams = {};
  const issues: ParamIssue[] = [];
  const known = new Set<string>();

  for (const param of manifest.parameters) {
    known.add(param.id);
    values[param.id] = Object.prototype.hasOwnProperty.call(input, param.id) && input[param.id] !== undefined
      ? resolveOne(param, input[param.id], issues)
      : param.default;
  }
  for (const key of Object.keys(input)) {
    if (!known.has(key)) issues.push({ id: key, message: 'unknown parameter; ignored' });
  }
  return { values, issues };
}

/** Default values only; convenient for previews and thumbnails. */
export function defaultParams(manifest: Pick<TemplateManifest, 'parameters'>): ResolvedParams {
  return resolveParams(manifest).values;
}
