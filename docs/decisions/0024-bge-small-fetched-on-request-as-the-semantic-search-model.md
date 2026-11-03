# 0024. BGE small, fetched on request, as the local semantic search model

Date: 2026-11-02
Status: Accepted

## Context

The library search matches words: names, tags, types, themes, the text of a
description. "Something calm for a podcast intro" matches none of them on the
very templates it means, because no template says "calm" or "something". The
roadmap's answer (milestone 9) is an optional semantic search — embeddings on
this machine, off by default, nothing sent anywhere — and this record pins
down the same three parts ADR 0021 pinned for speech: which model, how it is
run, and how it gets onto the machine.

The privacy rule shapes everything. A hosted embedding API would make every
keystroke of a search leave the machine, which is the opposite of what a
library browser should do; it is ruled out before the comparison starts. So
is telemetry of any kind: the feature must be able to say, truthfully and
completely, that the one thing that ever travels is the model file itself,
once, after the person says yes.

## Decision

**The model is BGE small v1.5 (BAAI), quantized to eight bits in the GGUF
form llama.cpp reads.** One model, not a menu: embeddings have no quality
knob a person should have to reason about.

| Model | File | Size | SHA-256 | Dimensions | License |
|---|---|---|---|---|---|
| BGE small en v1.5 Q8_0 | `bge-small-en-v1.5-q8_0.gguf` | 36,806,944 B (37 MB) | `ec38e8da…60c2f514` | 384 | MIT |

Fetched from the GGUF conversion the llama.cpp guides themselves use
(`huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf`), checked against the
checksum above before it is kept, exactly as the speech model is. The full
checksum is in `src/core/semantic.ts`, which is also where a different pick
would be made.

**It is run by llama.cpp's own `llama-embedding`, found on PATH** the way
ffmpeg and whisper-cli are (macOS: `brew install llama.cpp`;
`PULP_LLAMA_EMBEDDING_PATH` overrides). Pulp bundles no binaries, and an
inference engine is the same kind of dependency as an encoder. The
alternative — an embedding runtime as an npm dependency, onnxruntime or
similar — was turned down for the same reason it was for speech: a
hundred-megabyte native module in every install, for a feature that is off by
default.

**Why this model.** The candidates were the small retrieval models with
permissive licenses that llama.cpp runs well: BGE small (33 M parameters,
MIT), all-MiniLM-L6-v2 (22 M, Apache-2.0), nomic-embed-text (137 M,
Apache-2.0), EmbeddingGemma (300 M, Gemma terms). BGE small is the smallest
of them trained for retrieval with a stated query prefix, it places well
above MiniLM on the retrieval benchmarks it was built for, and at 37 MB
quantized it embeds a library item in milliseconds on an ordinary machine.
nomic and Gemma answer better still, at four to eight times the download and
none of the difference this feature needs: the library's texts are a name, a
type and a sentence, not documents. English first is a real limit of the
pick, and is said in Settings.

**What is embedded, and where it lives.** Each item embeds as one line — its
name, its type's label, its description, its themes, styles and tags — and
the query embeds with BGE's own retrieval prefix. Vectors are 384 32-bit
floats in an `embeddings` table of `library.sqlite`, keyed by the item and
its stat signature like every other derived thing there, so a changed file
re-embeds and nothing is recomputed on a whim. The word search and the
meaning search fold together by reciprocal rank fusion with a similarity
floor, and only under the relevance sort: meaning widens the words but never
the fences — a semantic hit must still satisfy `tag:`, `type:`, the chips and
the scope.

## Consequences

- Off by default. Turned on, Settings says what would be fetched, from whom,
  how big and under what license, before the button exists to press; the
  fetch is the person's own press, and it is the only network request the
  feature ever makes. Queries, item texts and vectors never leave the machine.
- No llama.cpp, no semantic search: the Settings line says how to install it,
  and the word search is exactly what it always was. The same when the
  setting is off — `deriveResults` takes the identical path it took before
  the feature existed.
- The model file sits beside the settings in `semantic-models/`, like the
  speech models; deleting the folder undoes the download.
- A library indexes in the background after the setting turns on and after
  every scan, in batches, under the item's stat signature. The bundled
  three-hundred-odd templates index in well under a minute on an ordinary
  machine; a hundred-thousand-item library is hours of embedding, which is a
  real cost the setting's off-by-default stands in front of.
- The pinned conversion is community-published (as whisper.cpp's own
  converted weights are); the checksum is what stands between Pulp and the
  publisher changing the bytes.
