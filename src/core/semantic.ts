/**
 * Semantic search over the library (milestone 9's "local semantic search"):
 * "something calm for a podcast intro" finds the right templates by meaning,
 * where the word search (src/core/search.ts) matches names, words and
 * keywords. **Off by default, and nothing is sent anywhere**: the embeddings
 * run on this machine, through llama.cpp's own command-line program found on
 * PATH the way whisper.cpp and ffmpeg are, and the one thing that ever
 * travels is the model file itself, fetched from its publisher on first use
 * *after the person has said yes* and checked against the checksum below.
 * Which model and why is decision record 0024.
 *
 * Pure: the pinned model, the runner's arguments, the text an item embeds,
 * the parsing, the vectors' packing and the blend with the word search are
 * here and tested. Fetching, running and storing are
 * src/main/semantic-service.ts; the vectors live in the library database
 * beside the thumbnails and the waveforms.
 */

import { tr } from './i18n';
import type { LibraryEntry } from './library-types';
import type { SearchHit } from './search';
import { entryMoods, typeSourceLabel } from './taxonomy';

/**
 * The embedding model Pulp fetches when semantic search is turned on. `bytes`
 * and `sha256` are the published file's own, read when this entry was written:
 * the download is refused unless it hashes to exactly this. BGE small is 33 M
 * parameters quantized to eight bits — a 35 MB download that embeds a library
 * item in milliseconds on an ordinary machine — under MIT, from the GGUF
 * conversion the llama.cpp guides use (ADR 0024).
 */
export const SEMANTIC_MODEL = {
  id: 'bge-small-en-v1.5-q8',
  label: 'BGE small v1.5', // i18n-exempt(content): the model's published name
  file: 'bge-small-en-v1.5-q8_0.gguf',
  url: 'https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf',
  bytes: 36_806_944,
  sha256: 'ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514',
  license: 'MIT',
  /** The vectors' length; what the parser and the store hold every row to. */
  dims: 384,
  /** Shown in Settings beside the model's name, in the interface's language now. */
  get note(): string {
    return tr('semantic.model.note');
  },
} as const;

/** Where the runner may be, in the order tried: an override, PATH, then where Homebrew puts things. */
export function semanticRunnerPaths(env: Record<string, string | undefined>): string[] {
  const list: string[] = [];
  if (env.PULP_LLAMA_EMBEDDING_PATH) list.push(env.PULP_LLAMA_EMBEDDING_PATH);
  list.push('llama-embedding');
  // A GUI app on macOS does not inherit the shell PATH, so look where Homebrew puts things too.
  list.push('/opt/homebrew/bin/llama-embedding', '/usr/local/bin/llama-embedding');
  return [...new Set(list)];
}

/** Why semantic search cannot run here, and what to do about it: in the interface's language when it is said. */
export function semanticRunnerMissingMessage(): string {
  return tr('semantic.runner-missing');
}


/**
 * BGE models are trained with this in front of a *query* — and nothing in
 * front of what is searched — so retrieval asks the question the model knows.
 */
export const SEMANTIC_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '; // i18n-exempt(technical): the model's own query instruction

/** How many hits a semantic ask answers with, and the similarity below which a hit is noise. */
export const SEMANTIC_LIMIT = 50;
export const SEMANTIC_MIN_SCORE = 0.55;

/** Free text shorter than this asks nothing: one short word means less than its letters. */
export const SEMANTIC_MIN_QUERY = 4;

/**
 * The one line an item is embedded as: its name, what it is, what it says it
 * is for and how it looks — the words a person would reach for. One line,
 * because the runner reads one prompt per line.
 */
export function semanticTextFor(entry: LibraryEntry): string {
  const parts: string[] = [];
  if (entry.kind === 'template') {
    const m = entry.manifest;
    parts.push(m.name);
    const type = m.type ?? m.category;
    // The type's US English name whatever the interface's language: the model reads English first (ADR 0024).
    parts.push(typeSourceLabel(type) ?? type);
    if (m.description) parts.push(m.description);
    if (m.themes?.length) parts.push(`themes: ${m.themes.join(', ')}`);
    if (m.styles?.length) parts.push(`styles: ${m.styles.join(', ')}`);
  } else {
    parts.push(entry.name);
    if (entry.type) parts.push(typeSourceLabel(entry.type) ?? entry.type);
    parts.push(entry.mediaKind);
    if (entry.themes?.length) parts.push(`themes: ${entry.themes.join(', ')}`);
    const moods = entryMoods(entry);
    if (moods.length > 0) parts.push(`moods: ${moods.join(', ')}`);
  }
  if (entry.tags.length > 0) parts.push(`tags: ${entry.tags.join(', ')}`);
  return parts.join('. ').replace(/\s+/g, ' ').trim();
}

/**
 * The runner's arguments: prompts come from a file, one per line, normalized
 * vectors answered as one JSON array of arrays on stdout.
 */
export function embeddingArgs(modelPath: string, promptsFile: string): string[] {
  return ['-m', modelPath, '-f', promptsFile, '--embd-output-format', 'array', '--embd-normalize', '2'];
}

/**
 * Read what the runner printed: one vector per prompt, each of the model's
 * own length, or null when the output is not that — a crash, a truncation, a
 * model that is not the pinned one.
 */
export function parseEmbeddings(stdout: string, expected: number, dims: number): Float32Array[] | null {
  const at = stdout.indexOf('[');
  if (at < 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stdout.slice(at));
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length !== expected) return null;
  const out: Float32Array[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== dims || !row.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    out.push(Float32Array.from(row as number[]));
  }
  return out;
}

/** A vector as the database keeps it, and back. Little-endian 32-bit floats, nothing else. */
export function packVector(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer.slice(0), 0, vector.length * 4);
}

export function unpackVector(blob: Uint8Array, dims: number): Float32Array | null {
  if (blob.byteLength !== dims * 4) return null;
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

/** Both vectors are normalized, so similarity is the dot product: 1 the same direction, 0 unrelated. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length && i < b.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** One semantic hit: a library id and how close its meaning came. */
export interface SemanticHit {
  id: string;
  score: number;
}

/** What the window holds of the last ask: the free text it was about, and each id's similarity. */
export interface SemanticHits {
  text: string;
  scores: ReadonlyMap<string, number>;
}

/**
 * The word search and the meaning search, folded into one order (reciprocal
 * rank fusion, the standard k = 60): an item near the top of either list
 * rises, one strong in both rises most. `pool` is what the query's *filters*
 * leave — a semantic hit must still satisfy `tag:`, `type:` and the chips —
 * and only hits above the noise floor join. The word order stands untouched
 * when nothing semantic clears it, so turning the setting on changes nothing
 * until it has something to say.
 */
export function blendSemantic(
  lexical: readonly SearchHit[],
  pool: readonly SearchHit[],
  scores: ReadonlyMap<string, number>,
  minScore = SEMANTIC_MIN_SCORE,
): SearchHit[] {
  const eligible = pool
    .map((hit) => ({ hit, score: scores.get(hit.entry.id) ?? 0 }))
    .filter((e) => e.score >= minScore)
    .sort((a, b) => b.score - a.score);
  if (eligible.length === 0) return [...lexical];
  const k = 60;
  const fused = new Map<string, { hit: SearchHit; score: number }>();
  lexical.forEach((hit, rank) => fused.set(hit.entry.id, { hit, score: 1 / (k + rank + 1) }));
  eligible.forEach(({ hit }, rank) => {
    const had = fused.get(hit.entry.id);
    const add = 1 / (k + rank + 1);
    if (had) had.score += add;
    else fused.set(hit.entry.id, { hit, score: add });
  });
  return [...fused.values()].sort((a, b) => b.score - a.score).map((f) => f.hit);
}
