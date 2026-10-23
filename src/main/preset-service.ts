/**
 * Saved parameter presets, one JSON file per template id in the presets
 * folder of user data, written atomically. The pure rules (diff against
 * defaults, drop unknown parameters) are in core/param-presets.ts.
 */

import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../core/atomic-file';
import { presetFileName, sanitizePresetFile, type PresetFile, type PresetValues } from '../core/param-presets';

function presetsDir(): string {
  return join(app.getPath('userData'), 'presets');
}

async function readPresets(templateId: string): Promise<PresetFile> {
  try {
    return sanitizePresetFile(JSON.parse(await readFile(join(presetsDir(), presetFileName(templateId)), 'utf8')), templateId);
  } catch {
    return { templateId, presets: {} };
  }
}

async function writePresets(file: PresetFile): Promise<void> {
  await writeFileAtomic(join(presetsDir(), presetFileName(file.templateId)), JSON.stringify(file, null, 2) + '\n');
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task);
  chain = next.catch(() => undefined);
  return next;
}

export function listPresets(templateId: string): Promise<Record<string, PresetValues>> {
  return serialized(async () => (await readPresets(templateId)).presets);
}

/** Save (or replace) a preset; the renderer asks the user before replacing. */
export function savePreset(templateId: string, name: string, values: PresetValues): Promise<Record<string, PresetValues>> {
  return serialized(async () => {
    const file = await readPresets(templateId);
    const trimmed = name.trim();
    if (trimmed) file.presets[trimmed] = values;
    await writePresets(file);
    return file.presets;
  });
}

export function deletePreset(templateId: string, name: string): Promise<Record<string, PresetValues>> {
  return serialized(async () => {
    const file = await readPresets(templateId);
    delete file.presets[name.trim()];
    await writePresets(file);
    return file.presets;
  });
}
