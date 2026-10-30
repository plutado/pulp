/**
 * Example projects for the start screen (milestone 31): a handful of ready-made
 * `.pulp` files shipped beside the bundled templates, each showing something
 * Pulp does well. Opening one hands its contents to the window with no path,
 * so what the person gets is a copy and the example stays as it was.
 *
 * The files hold bundled-template items only, named by manifest id, which is
 * the one name that travels between machines (src/core/collection.ts).
 */

import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { parseProject, type Project } from '../core/project';

/** Folder of example projects shipped with the app, beside the bundled templates. */
export function bundledExamplesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'examples') : join(app.getAppPath(), 'examples');
}

export interface ExampleProject {
  /** Where the file is, which is also the key readExample accepts. */
  path: string;
  name: string;
  /** One line on what it shows. */
  description: string;
  /** Manifest id of its first template, whose thumbnail stands for it. */
  thumbTemplateId?: string;
}

interface ExampleIndexEntry {
  file: string;
  name: string;
  description: string;
}

/**
 * The examples, as `examples/index.json` lists them: name, one-line
 * description and file. One that cannot be read is left out rather than
 * offered and refused — a broken example is a packaging defect, not the
 * user's problem.
 */
export async function listExamples(): Promise<ExampleProject[]> {
  const dir = bundledExamplesDir();
  let entries: ExampleIndexEntry[];
  try {
    const raw = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as unknown;
    entries = Array.isArray(raw) ? (raw as ExampleIndexEntry[]) : [];
  } catch {
    return [];
  }
  const out: ExampleProject[] = [];
  for (const entry of entries) {
    if (typeof entry?.file !== 'string' || typeof entry?.name !== 'string') continue;
    const path = join(dir, entry.file);
    try {
      const parsed = parseProject(await readFile(path, 'utf8'));
      if (!parsed.ok) continue;
      const thumb = parsed.project.collection.items.find((i) => i.kind === 'template' && i.templateId)?.templateId;
      out.push({ path, name: entry.name, description: typeof entry.description === 'string' ? entry.description : '', ...(thumb ? { thumbTemplateId: thumb } : {}) });
    } catch {
      // Listed but not readable: left out.
    }
  }
  return out;
}

export type ExampleReadResult = { ok: true; name: string; project: Project } | { ok: false; message: string };

/** Read one example back. Only files inside the examples folder are read: the path came from the window. */
export async function readExample(path: string): Promise<ExampleReadResult> {
  const normal = normalize(path);
  // Membership in the list is the whole check: the list's paths are built here, from the index file.
  const examples = await listExamples();
  const found = examples.find((e) => normalize(e.path) === normal);
  if (!found) return { ok: false, message: 'That is not one of the example projects.' };
  try {
    const parsed = parseProject(await readFile(normal, 'utf8'));
    if (!parsed.ok) return { ok: false, message: parsed.error };
    return { ok: true, name: found.name, project: parsed.project };
  } catch (err) {
    return { ok: false, message: `Could not read the example: ${(err as Error).message}` };
  }
}
