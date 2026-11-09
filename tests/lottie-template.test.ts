/**
 * A Lottie saved as an editable template folder (milestone 35's last item):
 * the files builder is pure, so what the folder holds is checked here; that
 * the written folder actually draws is the end-to-end render test's job.
 */

import { describe, expect, it } from 'vitest';
import { lottieEditables, lottieInfo, lottieManifest, parseLottie } from '../src/core/lottie';
import { LOTTIE_TEMPLATE_PLAYER, lottieTemplateFiles } from '../src/core/lottie-template';
import { validateManifest } from '../src/core/manifest';
import { itemId } from '../src/core/library-scan';
import { lottieFixture } from './lottie-fixture';

function built(name = 'My Badge') {
  const doc = parseLottie(JSON.stringify(lottieFixture({ width: 500, height: 500, fps: 25, frames: 50 })));
  const editables = lottieEditables(doc.data);
  const result = lottieManifest(doc, { id: itemId('lottie:/lib/badge.json'), name: 'Badge', format: 'json', editables, limits: [] });
  if (!result.ok) throw new Error('fixture manifest invalid');
  const info = lottieInfo(doc, '/lib/badge.json', 'json', editables.bindings, []);
  return { files: lottieTemplateFiles({ name, manifest: result.manifest, info, data: doc.data }), manifest: result.manifest };
}

describe('lottieTemplateFiles', () => {
  it('writes a valid template manifest under a custom id, the item\'s own settings carried over', () => {
    const { files, manifest } = built();
    expect(files.templateId).toBe('custom.my-badge');
    expect(files.folder).toBe('my-badge');
    const read = validateManifest(JSON.parse(files.manifest));
    expect(read.ok, JSON.stringify(!read.ok ? read.errors : [])).toBe(true);
    if (!read.ok) return;
    expect(read.manifest).toMatchObject({ id: 'custom.my-badge', name: 'My Badge', fps: 25, duration: 2, alpha: true, entry: 'index.html' });
    // The parameters are the item's: its texts, colors, fonts and the Fit setting.
    expect(read.manifest.parameters.map((p) => p.id)).toEqual(manifest.parameters.map((p) => p.id));
    expect(read.manifest.structure).toEqual(manifest.structure);
  });

  it('writes the generated page, which inlines the animation and looks for the player beside itself', () => {
    const { files } = built();
    expect(files.page).toContain(`<script src="${LOTTIE_TEMPLATE_PLAYER}"></script>`);
    expect(files.page).not.toContain('__pulp/lottie');
    expect(files.page).toContain('window.pulpRender = function');
    // The parameters' defaults ride along, so a chosen theme and an edit meet as they do in the library.
    expect(files.page).toContain('"defaults":');
  });
});
