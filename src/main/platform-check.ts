/**
 * The finished file against the platform it was aimed at (milestone 20).
 *
 * Before a render the Output tab warns from the trim and the preset's bitrate
 * target; this is the other half, read from the file that was actually
 * written, so a job that came out larger than the platform takes says so on
 * its card. Never blocking and never fatal: a render that cannot be measured
 * is a render that still happened.
 */

import { stat } from 'node:fs/promises';
import { platformPreset, platformWarningsAfter } from '../core/platform-presets';

/**
 * What the written file says against its platform's limits, or nothing: no
 * platform was named, the id is not one Pulp knows, the output is a sequence
 * rather than one file, or the file could not be read.
 */
export async function finishedFileWarnings(input: {
  platform: string | undefined;
  output: string;
  /** Seconds the written file runs for. */
  seconds: number;
  sequence: boolean;
}): Promise<string[]> {
  const preset = platformPreset(input.platform);
  if (!preset || input.sequence) return [];
  try {
    const { size } = await stat(input.output);
    return platformWarningsAfter(preset, input.seconds, size);
  } catch {
    return [];
  }
}
