/**
 * What's new (milestone 31): the latest release of CHANGELOG.md, read for the
 * start screen's Learn section. The changelog is Keep a Changelog form —
 * `## [version] - date` headings, `### Added` groups, `- item` bullets — and
 * this reads exactly that, so the notes people see are the notes the release
 * shipped with rather than a second copy that drifts.
 *
 * Pure: the caller hands the file's text in.
 */

export interface ReleaseNotes {
  /** "0.1.0"; "Unreleased" counts only when no release exists yet. */
  version: string;
  /** "2026-10-18", or empty where the heading carries none. */
  date: string;
  /** "Added", "Fixed" … in the file's order. */
  sections: { title: string; items: string[] }[];
}

/** A bullet's first sentence, markdown links and emphasis unwrapped: a start screen is a list, not a changelog. */
function firstSentence(item: string): string {
  const plain = item
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const end = plain.search(/(?<=[.!?])\s/);
  return end === -1 ? plain : plain.slice(0, end);
}

/**
 * The newest *released* version's notes: the first `## [x.y.z]` heading and
 * everything under it. The Unreleased block is offered only when there has
 * never been a release, so "What's new" never promises what has not shipped —
 * except to someone running ahead of every release, for whom it is the truth.
 */
export function latestRelease(text: string): ReleaseNotes | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headings: { at: number; version: string; date: string }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^## \[([^\]]+)\](?:\s*-\s*(\S+))?/.exec(lines[i]!);
    if (m) headings.push({ at: i, version: m[1]!, date: m[2] ?? '' });
  }
  if (headings.length === 0) return null;
  const released = headings.find((h) => h.version.toLowerCase() !== 'unreleased');
  const chosen = released ?? headings[0]!;
  const next = headings.find((h) => h.at > chosen.at);
  const body = lines.slice(chosen.at + 1, next ? next.at : lines.length);

  const sections: { title: string; items: string[] }[] = [];
  let current: { title: string; items: string[] } | null = null;
  let item: string[] = [];
  const closeItem = () => {
    if (item.length > 0 && current) current.items.push(firstSentence(item.join(' ')));
    item = [];
  };
  for (const line of body) {
    const head = /^### (.+)$/.exec(line);
    if (head) {
      closeItem();
      current = { title: head[1]!.trim(), items: [] };
      sections.push(current);
      continue;
    }
    const bullet = /^- (.*)$/.exec(line);
    if (bullet) {
      closeItem();
      item = [bullet[1]!];
      continue;
    }
    // A wrapped bullet continues until a blank line or the next bullet or heading.
    if (item.length > 0 && line.trim() !== '' && /^\s/.test(line)) item.push(line.trim());
    else closeItem();
  }
  closeItem();
  return { version: chosen.version, date: chosen.date, sections: sections.filter((s) => s.items.length > 0) };
}
