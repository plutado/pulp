/**
 * Music and sound effects in a stock library (milestone 32), the pure part.
 *
 * - **A track in several lengths** ("Sunrise 15s", "Sunrise 30s", "Sunrise
 *   Full") is one item. When it is used, the version that fits the work is
 *   chosen: the shortest that covers the length, else the longest there is.
 * - **A song's stems** — a folder called "Stems", or files that say "stem" in
 *   their names — are one item that is placed as one audio layer whose stems
 *   switch on and off (milestone 16's stems).
 * - **A sound effect made for a transition** — "Swipe Left.mov" and
 *   "Swipe Left.wav", or "Swipe Left SFX.wav", in one folder — is paired with
 *   it, and plays with it wherever the clip plays.
 *
 * The files stay items of their own in the library (each with its own id, so
 * every grant, waveform and render reads them as it reads any sound), marked
 * as part of their group so the results show the group once.
 */

const AUDIO = /\.(wav|aiff?|mp3|m4a|aac|flac|ogg|opus)$/i;
const SEPARATORS = /[\s_\-.]+/g;

function stemOf(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/** A name as words, for matching: "Sunrise_30s (Edit)" → "sunrise 30s edit". */
function words(s: string): string {
  return s.replace(/[()[\]{}]/g, ' ').replace(SEPARATORS, ' ').trim().toLowerCase();
}

/** The original words for a matched base, so the item keeps the file's own capitals. */
function original(file: string, base: string): string {
  const w = stemOf(file).replace(/[()[\]{}]/g, ' ').replace(SEPARATORS, ' ').trim();
  const at = w.toLowerCase().indexOf(base);
  return at >= 0 ? w.slice(at, at + base.length) : base;
}

// ---------------------------------------------------------------- several lengths

/**
 * What a file's name says about its length, as stock music names its cuts: a time ("30s",
 * "30 sec", "60", ":30", "1m30", "2:14") or a word (Full, Long, Medium, Short, Main, Edit, Sting,
 * Stinger, Bumper). `seconds` is what the name says, before the file is measured.
 */
export function musicLengthOf(file: string): { base: string; label: string; seconds?: number } | null {
  const w = words(stemOf(file));
  const named: [RegExp, string][] = [[/\b(full|full length|long|main|medium|short|edit|radio edit|sting|stinger|bumper|underscore)$/, '']];
  for (const [re] of named) {
    const m = re.exec(w);
    if (m && m.index > 0) return { base: w.slice(0, m.index).trim(), label: m[1]!.replace(/\b\w/g, (c) => c.toUpperCase()) };
  }
  const time = /\b(?:(\d{1,2})\s?m(?:in)?\s?(\d{1,2})?\s?s?|(\d{1,3})\s?(?:s|sec|secs|seconds)?|(\d{1,2}):(\d{2}))$/.exec(w);
  if (time && time.index > 0) {
    const seconds = time[1] !== undefined ? Number(time[1]) * 60 + Number(time[2] ?? 0) : time[3] !== undefined ? Number(time[3]) : Number(time[4]) * 60 + Number(time[5]);
    // A bare number counts only as a cut stock music is sold in, so "Track 2" stays a track.
    const bare = time[3] !== undefined && !/(s|sec|secs|seconds)$/.test(time[0]);
    if (bare && !STANDARD_CUTS.has(seconds)) return null;
    // After a name that already ends in a number ("clip 3 5"), a bare number is a series, not a length.
    if (bare && /\d$/.test(w.slice(0, time.index).trim())) return null;
    if (seconds > 0 && seconds <= 3600) return { base: w.slice(0, time.index).trim(), label: lengthLabel(seconds), seconds };
  }
  return null;
}

/** The lengths stock music is cut to, which a bare number in a name may mean. */
const STANDARD_CUTS = new Set([5, 6, 10, 15, 20, 30, 45, 60, 90, 120]);

function lengthLabel(seconds: number): string {
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export interface FoundVersions {
  name: string;
  /** Each version's file and what its name says, longest first by what it says. */
  versions: { file: string; label: string; seconds?: number }[];
}

/** The tracks in one folder that come in several lengths: two or more files sharing a base name. */
export function groupMusicVersions(fileNames: readonly string[]): FoundVersions[] {
  const byBase = new Map<string, { file: string; label: string; seconds?: number }[]>();
  for (const file of fileNames) {
    if (!AUDIO.test(file)) continue;
    const found = musicLengthOf(file);
    if (!found || !found.base) continue;
    const list = byBase.get(found.base) ?? [];
    list.push({ file, label: found.label, ...(found.seconds !== undefined ? { seconds: found.seconds } : {}) });
    byBase.set(found.base, list);
  }
  // A plain "Sunrise.wav" beside "Sunrise 30s.wav" is the full version.
  for (const file of fileNames) {
    if (!AUDIO.test(file)) continue;
    const base = words(stemOf(file));
    const list = byBase.get(base);
    // Its label is Pulp's word for it, said in the interface's language where it is shown (`versionLabel`).
    if (list && !list.some((v) => v.file === file)) list.push({ file, label: '' });
  }
  const out: FoundVersions[] = [];
  for (const [base, versions] of byBase) {
    if (versions.length < 2) continue;
    const sorted = [...versions].sort((a, b) => (b.seconds ?? Infinity) - (a.seconds ?? Infinity) || a.file.localeCompare(b.file));
    out.push({ name: original(sorted[0]!.file, base), versions: sorted });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The version that fits a piece of work `length` seconds long: the shortest that covers it, so
 * the music ends on its own ending rather than being cut; when none is long enough, the longest.
 * `seconds` are measured lengths. A version not measured yet is passed over while a measured one
 * covers the length, and preferred to the longest when none does.
 */
export function pickVersion<T extends { seconds?: number }>(versions: readonly T[], length: number | undefined): T | undefined {
  const measured = versions.filter((v) => v.seconds !== undefined && v.seconds > 0);
  if (measured.length === 0) return versions[0];
  const longest = measured.reduce((a, b) => (b.seconds! > a.seconds! ? b : a));
  if (length === undefined || !Number.isFinite(length) || length <= 0) return longest;
  const covering = measured.filter((v) => v.seconds! >= length - 0.05);
  if (covering.length > 0) return covering.reduce((a, b) => (b.seconds! < a.seconds! ? b : a));
  // None known to be long enough: a cut whose length is not known yet ("Full") may be, and is
  // likelier the whole track than any cut known to fall short.
  return versions.find((v) => v.seconds === undefined) ?? longest;
}

// ---------------------------------------------------------------- stems

export interface FoundStems {
  name: string;
  stems: { file: string; label: string }[];
}

/** What a stem is called from its file: the words left after the song's name and "stem". */
function stemLabel(file: string, song: string): string {
  let w = words(stemOf(file)).replace(/\bstems?\b/g, ' ');
  if (song && w.startsWith(song)) w = w.slice(song.length);
  const label = w.replace(/\s+/g, ' ').trim();
  return label ? original(file, label).replace(/\b\w/g, (c) => c.toUpperCase()) : stemOf(file);
}

/** The longest run of words two names start with. */
function sharedStart(a: string, b: string): string {
  const x = a.split(' ');
  const y = b.split(' ');
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n += 1;
  return x.slice(0, n).join(' ');
}

/**
 * A song's stems in one folder. A folder whose name says "stems" ("Stems", "Sunrise Stems") holds
 * one song's: every sound in it, named after the folder or the start its files share. Elsewhere,
 * files that say "stem" and share the start of their names are one song's.
 */
export function groupStems(folderName: string, parentName: string, fileNames: readonly string[]): FoundStems[] {
  const audio = fileNames.filter((f) => AUDIO.test(f));
  if (/\bstems?\b/i.test(folderName) && audio.length >= 2) {
    const folderSong = words(folderName).replace(/\bstems?\b/g, ' ').trim();
    const shared = audio.map((f) => words(stemOf(f)).replace(/\bstems?\b/g, ' ').replace(/\s+/g, ' ').trim()).reduce(sharedStart);
    const song = folderSong || shared;
    const name = folderSong ? original(folderName, folderSong) : shared ? original(audio[0]!, shared) : parentName;
    return [{ name: name.replace(/\b\w/g, (c) => c.toUpperCase()), stems: audio.map((file) => ({ file, label: stemLabel(file, shared || song) })) }];
  }
  const tagged = audio.filter((f) => /\bstems?\b/.test(words(stemOf(f))));
  const bySong = new Map<string, string[]>();
  for (const file of tagged) {
    const song = words(stemOf(file)).split(/\bstems?\b/)[0]!.trim();
    if (!song) continue;
    bySong.set(song, [...(bySong.get(song) ?? []), file]);
  }
  return [...bySong].filter(([, files]) => files.length >= 2)
    .map(([song, files]) => ({ name: original(files[0]!, song), stems: files.map((file) => ({ file, label: stemLabel(file, song) })) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- sounds made for transitions

const SFX_WORDS = /\b(sfx|sound|sound effect|audio|whoosh)$/;

/**
 * Sounds made for a clip in the same folder: one whose name is the clip's ("Swipe Left.wav" for
 * "Swipe Left.mov"), or the clip's with SFX, Sound or Audio after it. Returns clip file → sound file.
 */
export function pairTransitionSounds(videoNames: readonly string[], audioNames: readonly string[]): Map<string, string> {
  const pairs = new Map<string, string>();
  const sounds = audioNames.filter((a) => AUDIO.test(a)).map((file) => {
    const w = words(stemOf(file));
    return { file, base: w.replace(SFX_WORDS, '').trim(), exact: w };
  });
  for (const clip of videoNames) {
    const w = words(stemOf(clip));
    const sound = sounds.find((s) => s.exact === w) ?? sounds.find((s) => s.base === w && s.exact !== s.base);
    if (sound) pairs.set(clip, sound.file);
  }
  return pairs;
}

// ---------------------------------------------------------------- placing a group

/** The library as these need it: media by id, each with its measured length. */
type MediaLookupFn = (id: string) => { meta?: { duration?: number } } | undefined;

/** A track's cuts with the lengths they really run, measured where the library has, else as named. */
export function measuredVersions(versions: readonly { id: string; label: string; seconds?: number }[], lookup: MediaLookupFn): { id: string; label: string; seconds?: number }[] {
  return versions.map((v) => {
    const measured = lookup(v.id)?.meta?.duration;
    return measured ? { ...v, seconds: measured } : v;
  });
}

/**
 * What a library sound becomes on an audio layer, for work `length` seconds long: a song's stems
 * as milestone 16's stems, every one on and at full gain, so each can be switched off on its lane;
 * a track's cuts as the cut that fits; anything else as itself.
 */
export function soundIdsFor(
  entry: { id: string; versions?: { id: string; label: string; seconds?: number }[]; stemParts?: { id: string; label: string }[] },
  length: number | undefined,
  lookup: MediaLookupFn,
): { id: string; stems?: { id: string; label: string; muted: boolean; solo: boolean; gain: number }[] } {
  if (entry.stemParts && entry.stemParts.length > 0) {
    return { id: entry.stemParts[0]!.id, stems: entry.stemParts.map((s) => ({ id: s.id, label: s.label, muted: false, solo: false, gain: 1 })) };
  }
  if (entry.versions && entry.versions.length > 0) {
    return { id: pickVersion(measuredVersions(entry.versions, lookup), length)?.id ?? entry.versions[0]!.id };
  }
  return { id: entry.id };
}

/** A cut's label as the window shows it: the length its name said, or "Full" for the track's plain file. */
export function versionLabel(label: string, full: string): string {
  return label === '' ? full : label;
}
