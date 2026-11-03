# 0021. Whisper base, fetched on first use, as the on-device speech model

Date: 2026-11-01
Status: Accepted

## Context

Milestone 50 makes captions from what is said in a project. Something has to
turn sound into words with timings, and the choice has three parts: which
model, how it is run, and how it gets onto the machine. The milestone's own
rule is that nothing leaves the machine, which rules out every hosted
transcription API before the comparison starts.

A model is also not like the rest of Pulp's dependencies. It is a hundred
megabytes or more of weights, it has a license of its own, and it comes from
somebody else's server. Those three facts are what this record pins down, so
that what Pulp fetches, how big it is and under what terms is written
somewhere other than a constant in the source.

## Decision

**The model is OpenAI's Whisper, in the GGML form whisper.cpp reads, and the
default size is `base`.** Three sizes are offered, and `base` is what a
project gets unless it asks for another:

| Model | File | Size | SHA-256 | Languages | License |
|---|---|---|---|---|---|
| Whisper tiny | `ggml-tiny.bin` | 77,691,713 B (78 MB) | `be07e048…c6e1b21` | 99 | MIT |
| **Whisper base** (default) | `ggml-base.bin` | 147,951,465 B (148 MB) | `60ed5bc3…5fba2efe` | 99 | MIT |
| Whisper small | `ggml-small.bin` | 487,601,967 B (465 MB) | `1be3a9b2…fffea987b` | 99 | MIT |

The full checksums are in `src/core/speech.ts`, which is the one place they
live; the table above is the record of what was chosen and when.

**The license is MIT, twice over.** The Whisper models are released by OpenAI
under the MIT license, and the GGML conversions Pulp fetches are published
under the MIT license by the whisper.cpp project
(`huggingface.co/ggerganov/whisper.cpp`). Nothing about redistribution, output
ownership or commercial use is restricted, which matters for a tool whose
output people publish.

**It is fetched on first use, after asking.** Pulp ships no weights: the
repository holds no binaries, and a 148 MB file in an installer is a cost
every person pays whether or not they ever caption anything. The captions
dialog says which model it would fetch, how big it is and under what license,
and fetches nothing until the button is pressed. What arrives is hashed as it
is written and is only moved into place — `speech-models/` beside the
settings — when it hashes to exactly the published SHA-256; anything else is
thrown away with a message that says so.

**The model is run by whisper.cpp's own program, found on PATH**
(`whisper-cli`, or `whisper-cpp` as Homebrew installs it, or
`PULP_WHISPER_PATH`), exactly as ffmpeg is found. Pulp bundles no inference
engine.

## Reasons

- **It is the only family that is small, multilingual and permissively
  licensed.** Whisper is MIT, runs on a laptop CPU, and covers 99 languages
  in one file, which is what milestone 50's languages item needs.
- **`base` is the smallest size worth editing.** `tiny` mishears enough that
  a person rewrites the captions rather than correcting them, which defeats
  the feature; `small` is three times the download and several times the
  listening time for an accuracy gain that matters most in noisy recordings.
  `base` is offered as the default and the other two are there for the people
  whose work needs them.
- **whisper.cpp rather than a Node binding or a bundled runtime.** A native
  addon would have to be built per platform and per Electron version, and an
  ONNX runtime is another large dependency with the same model problem. The
  command-line program is one process, one JSON file, and a dependency people
  can install, audit and update themselves — the same shape as ffmpeg, which
  Pulp already treats this way and documents.
- **A checksum is what makes "fetched from the internet" acceptable.** The
  fetch is the one network request Pulp makes. Pinning the bytes means a
  mirror, a captive portal or a transfer that stopped half way cannot leave
  something runnable on disk.

## Consequences

- Transcription needs two things installed that Pulp does not ship: ffmpeg,
  to read the sound, and whisper.cpp, to listen to it. The dialog says which
  is missing and how to get it, and the rest of Pulp is unaffected by either.
- The checksums age: a publisher who replaces a file breaks the fetch rather
  than silently fetching something else, which is the failure wanted. Adding
  a model means adding its size and checksum here and in `src/core/speech.ts`.
- A model is per machine, not per project: a project carries its captions,
  never its weights, and opens on a machine with no model at all.
- If a later Pulp ever wants to ship weights — for an offline installer, say —
  it is a packaging decision (milestone 17), not a change to this one: the
  catalog, the checksum check and the folder stay as they are, and the
  fetch simply finds the file already there.
