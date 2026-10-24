import { effect } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { setIndex, setJobs, setQuery, setSelection } from '../src/core/app-state';
import type { LibraryIndex } from '../src/core/library-types';
import { appState, dispatch, results, selectedKey } from '../src/renderer/store';
import { validManifest } from './fixtures';

/** The signal wiring (no DOM): a queue or selection update must not wake the results. */
describe('store', () => {
  const manifest = validManifest();
  const index: LibraryIndex = {
    roots: ['/lib'],
    templates: [{ kind: 'template', key: 'basic', id: 'id-basic', dir: '/lib/basic', root: '/lib', manifest, tags: [...manifest.tags], warnings: [] }],
    media: [],
    problems: [],
    builtAt: new Date().toISOString(),
  };

  it('results notify only when index, query or scope change', () => {
    dispatch((s) => setIndex(s, index));
    let resultRuns = 0;
    let selectionRuns = 0;
    const stopResults = effect(() => {
      void results.value;
      resultRuns++;
    });
    const stopSelection = effect(() => {
      void selectedKey.value;
      selectionRuns++;
    });
    expect(resultRuns).toBe(1);

    dispatch((s) => setJobs(s, { jobs: [{ id: 1, templateId: 't', templateName: 'T', presetId: 'prores-4444', outputPath: '/x.mov', totalFrames: 60, status: 'running', frame: 10, warnings: [] }] }));
    expect(resultRuns).toBe(1);
    expect(selectionRuns).toBe(1);

    dispatch((s) => setSelection(s, 'basic'));
    expect(resultRuns).toBe(1);
    expect(selectionRuns).toBe(2);

    dispatch((s) => setQuery(s, 'zebra'));
    expect(resultRuns).toBe(2);
    expect(results.value.entries).toEqual([]);

    stopResults();
    stopSelection();
    appState.value = setQuery(appState.value, '');
  });
});
