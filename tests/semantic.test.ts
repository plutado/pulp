/**
 * Semantic search (milestone 9, ADR 0024): the pinned model, the runner's
 * arguments and parsing, the text an item embeds, the vectors' packing, the
 * blend with the word search — and, where llama.cpp is on this machine with
 * the model beside it, the real runner run over real text, so the contract is
 * proved against the program itself rather than against a transcript.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveResults, initialAppState, setSemanticHits } from '../src/core/app-state';
import type { LibraryIndex, MediaEntry, TemplateEntry } from '../src/core/library-types';
import { parseQuery, splitFreeText, type SearchHit } from '../src/core/search';
import {
  blendSemantic, cosine, embeddingArgs, packVector, parseEmbeddings, SEMANTIC_MODEL, SEMANTIC_QUERY_PREFIX,
  semanticRunnerMissingMessage, semanticRunnerPaths, semanticTextFor, unpackVector,
} from '../src/core/semantic';
import { validManifest } from './fixtures';

const template = (id: string, over: Record<string, unknown> = {}): TemplateEntry => ({
  kind: 'template', key: `template:${id}`, id, dir: `/t/${id}`, size: 0, mtimeMs: 0, root: '/t',
  manifest: validManifest({ id, name: id, ...over }), tags: ['sample'], warnings: [],
});

const hit = (entry: TemplateEntry): SearchHit => ({ entry, score: 1 } as unknown as SearchHit);

describe('the pinned model', () => {
  it('is one file from one publisher, checksummed, sized and licensed before anything is fetched', () => {
    expect(SEMANTIC_MODEL.url.startsWith('https://')).toBe(true);
    expect(SEMANTIC_MODEL.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(SEMANTIC_MODEL.bytes).toBeGreaterThan(1_000_000);
    expect(SEMANTIC_MODEL.license).toBe('MIT');
    expect(SEMANTIC_MODEL.dims).toBe(384);
    expect(SEMANTIC_MODEL.url.endsWith(SEMANTIC_MODEL.file)).toBe(true);
  });

  it('is run from PATH like ffmpeg and whisper.cpp, with an override and the Homebrew paths', () => {
    const paths = semanticRunnerPaths({ PULP_LLAMA_EMBEDDING_PATH: '/x/llama-embedding' });
    expect(paths[0]).toBe('/x/llama-embedding');
    expect(paths).toContain('llama-embedding');
    expect(paths).toContain('/opt/homebrew/bin/llama-embedding');
    expect(semanticRunnerMissingMessage()).toContain('brew install llama.cpp');
    expect(semanticRunnerMissingMessage()).toContain('PULP_LLAMA_EMBEDDING_PATH');
  });
});

describe('what an item embeds', () => {
  it('is one line: the name, what it is, what it says it is for, how it looks, its tags', () => {
    const text = semanticTextFor(template('sunrise-opener', {
      type: 'opener', description: 'A slow sunrise\nwith soft light.', themes: ['wellness'], styles: ['organic'],
    }));
    expect(text).toContain('sunrise-opener');
    expect(text).toContain('Opener');
    expect(text).toContain('A slow sunrise with soft light.');
    expect(text).toContain('themes: wellness');
    expect(text).toContain('styles: organic');
    expect(text).toContain('tags: sample');
    expect(text.includes('\n')).toBe(false);
  });

  it('says a media item by its name, type, kind and themes', () => {
    const media = {
      kind: 'media', id: 'm1', key: 'media:/m/whoosh.wav', name: 'whoosh soft', mediaKind: 'audio',
      type: 'whoosh', themes: ['sports'], tags: ['transitions'], path: '/m/whoosh.wav', root: '/m', ext: '.wav', size: 1, mtimeMs: 0,
    } as unknown as MediaEntry;
    const text = semanticTextFor(media);
    expect(text).toContain('whoosh soft');
    expect(text).toContain('audio');
    expect(text).toContain('themes: sports');
  });
});

describe('the runner contract', () => {
  it('asks for prompts from a file, normalized vectors as one JSON array', () => {
    expect(embeddingArgs('/m/model.gguf', '/tmp/p.txt')).toEqual([
      '-m', '/m/model.gguf', '-f', '/tmp/p.txt', '--embd-output-format', 'array', '--embd-normalize', '2',
    ]);
  });

  it('reads vectors back, refusing the wrong count, the wrong width and noise', () => {
    const two = JSON.stringify([Array(384).fill(0.1), Array(384).fill(0.2)]);
    expect(parseEmbeddings(`load notes\n${two}`, 2, 384)).toHaveLength(2);
    expect(parseEmbeddings(two, 1, 384)).toBeNull();
    expect(parseEmbeddings(JSON.stringify([Array(383).fill(0.1)]), 1, 384)).toBeNull();
    expect(parseEmbeddings('not json at all', 1, 384)).toBeNull();
    expect(parseEmbeddings(JSON.stringify([['a']]), 1, 1)).toBeNull();
  });

  it('packs a vector for the database and back, byte for byte', () => {
    const vec = Float32Array.from({ length: 384 }, (_, i) => Math.sin(i));
    const back = unpackVector(packVector(vec), 384);
    expect(back).not.toBeNull();
    expect([...back!]).toEqual([...vec]);
    expect(unpackVector(new Uint8Array(10), 384)).toBeNull();
  });

  it('scores normalized vectors by their dot product', () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([1, 0]))).toBe(1);
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBe(0);
  });
});

describe('free text apart from the filters', () => {
  it('keeps the words and leaves the syntax, and agrees with parseQuery about which is which', () => {
    const query = 'something Calm for a podcast intro tag:opener type:wipe duration:>5 alpha:yes show: on';
    const { text, filters } = splitFreeText(query);
    expect(text).toBe('something calm for a podcast intro show: on');
    expect(filters).toBe('tag:opener type:wipe duration:>5 alpha:yes');
    // The same reading parseQuery makes: every filter token lands outside terms, every text token inside.
    const parsed = parseQuery(query);
    expect(parsed.terms.join(' ')).toBe(text);
    expect(splitFreeText('')).toEqual({ text: '', filters: '' });
  });
});

describe('the blend with the word search', () => {
  const a = template('a');
  const b = template('b');
  const c = template('c');
  const d = template('d');

  it('leaves the word order untouched when nothing semantic clears the floor', () => {
    const lexical = [hit(a), hit(b)];
    const blended = blendSemantic(lexical, [hit(a), hit(b), hit(c)], new Map([['c', 0.2]]));
    expect(blended.map((h) => h.entry.id)).toEqual(['a', 'b']);
  });

  it('folds strong meaning in: a hit in both lists rises, a semantic-only hit joins', () => {
    const lexical = [hit(a), hit(b)];
    const scores = new Map([['b', 0.9], ['c', 0.8], ['d', 0.1]]);
    const blended = blendSemantic(lexical, [hit(a), hit(b), hit(c), hit(d)], scores);
    expect(blended[0]!.entry.id).toBe('b');
    expect(blended.map((h) => h.entry.id)).toContain('c');
    expect(blended.map((h) => h.entry.id)).not.toContain('d');
  });

  it('answers meaning alone when the words matched nothing', () => {
    const blended = blendSemantic([], [hit(a), hit(c)], new Map([['c', 0.8], ['a', 0.6]]));
    expect(blended.map((h) => h.entry.id)).toEqual(['c', 'a']);
  });

  it('a semantic hit outside the filters\' pool never joins', () => {
    const blended = blendSemantic([hit(a)], [hit(a)], new Map([['c', 0.99]]));
    expect(blended.map((h) => h.entry.id)).toEqual(['a']);
  });
});

describe('the results with meaning folded in', () => {
  const calm = template('sunrise-opener', { name: 'Sunrise Opener', category: 'other', type: 'opener' });
  const glitch = template('tech-glitch', { name: 'Tech Glitch', category: 'overlay', type: 'glitch' });
  const index = { templates: [calm, glitch], media: [], problems: [], roots: [] } as unknown as LibraryIndex;
  const base = { ...initialAppState, index };

  it('blends only its own text, on relevance, and never past the filters', () => {
    const scores = new Map([['sunrise-opener', 0.8]]);
    const s = setSemanticHits({ ...base, query: 'calm podcast intro' }, { text: 'calm podcast intro', scores });
    expect(deriveResults(s).entries.map((e) => e.id)).toEqual(['sunrise-opener']);
    // A stale answer about other words says nothing.
    const stale = setSemanticHits({ ...base, query: 'loud party' }, { text: 'calm podcast intro', scores });
    expect(deriveResults(stale).entries).toHaveLength(0);
    // Another sort order is that order; meaning only reorders relevance.
    const sorted = { ...s, sort: 'name' as const };
    expect(deriveResults(sorted).entries).toHaveLength(0);
    // A filter the hit does not satisfy keeps it out, however strong the meaning.
    const fenced = setSemanticHits({ ...base, query: 'calm podcast intro type:glitch' }, { text: 'calm podcast intro', scores });
    expect(deriveResults(fenced).entries.map((e) => e.id)).toEqual([]);
  });
});

/**
 * The real thing, where it is installed: llama.cpp from PATH and the pinned
 * model from PULP_SEMANTIC_TEST_MODEL (a local copy of the very file the
 * catalog names). CI has neither and says so; this machine ran it.
 */
describe('the runner itself', () => {
  it('embeds a calm-podcast query nearer the calm opener and the podcast card than the glitch', async () => {
    const runner = process.env.PULP_LLAMA_EMBEDDING_PATH ?? 'llama-embedding';
    const model = process.env.PULP_SEMANTIC_TEST_MODEL ?? '';
    const there = model !== '' && existsSync(model) && spawnSync(runner, ['--help'], { timeout: 30_000 }).status === 0;
    if (!there) {
      console.info('llama-embedding or PULP_SEMANTIC_TEST_MODEL not available; the real-runner check ran where it is.');
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), 'pulp-semantic-'));
    try {
      const prompts = [
        `${SEMANTIC_QUERY_PREFIX}something calm for a podcast intro`,
        semanticTextFor(template('morning-rays', { name: 'Morning Rays Opener', type: 'opener', description: 'A slow sunrise opener with soft warm light.', themes: ['wellness'], styles: ['organic', 'elegant'] })),
        semanticTextFor(template('listen-next', { name: 'Listen Next End Card', type: 'end-card', description: 'An end card pointing to the next episode, with podcast artwork.', themes: ['podcast'] })),
        semanticTextFor(template('tech-glitch', { name: 'Tech Glitch', type: 'glitch', description: 'Hard digital glitch burst with scanlines.', themes: ['gaming'], styles: ['tech', 'high-energy'] })),
      ];
      const file = join(dir, 'prompts.txt');
      await writeFile(file, prompts.join('\n'));
      const run = spawnSync(runner, embeddingArgs(model, file), { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
      expect(run.status, String(run.stderr)).toBe(0);
      const vectors = parseEmbeddings(String(run.stdout), prompts.length, SEMANTIC_MODEL.dims);
      expect(vectors).not.toBeNull();
      const [query, opener, podcast, glitch] = vectors!;
      expect(cosine(query!, opener!)).toBeGreaterThan(cosine(query!, glitch!));
      expect(cosine(query!, podcast!)).toBeGreaterThan(cosine(query!, glitch!));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
