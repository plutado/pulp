/**
 * The third-party notices as the Acknowledgements dialog shows them
 * (milestone 8): `THIRD_PARTY_NOTICES.md` read into sections, each a heading
 * with its paragraphs and tables, so the dialog is the file and cannot drift
 * from it. The file is the record; this only reads it. Pure, like the
 * changelog reader beside it.
 */

export interface NoticeTable {
  header: string[];
  rows: string[][];
}

export interface NoticeSection {
  title: string;
  /** Paragraphs and tables in the order they appear; a string is a paragraph. */
  blocks: (string | NoticeTable)[];
}

/** Markdown's inline marks taken off: the dialog sets the words plainly. */
function plain(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

function tableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => plain(cell));
}

/** The notices as sections: the text before the first `##` is the introduction, titled by the `#` line. */
export function noticeSections(markdown: string): NoticeSection[] {
  const sections: NoticeSection[] = [];
  let current: NoticeSection | null = null;
  let paragraph: string[] = [];
  let table: NoticeTable | null = null;
  const flush = (): void => {
    if (!current) return;
    if (paragraph.length > 0) current.blocks.push(plain(paragraph.join(' ')));
    paragraph = [];
    if (table) current.blocks.push(table);
    table = null;
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    if (/^#\s/.test(line)) {
      flush();
      current = { title: plain(line.slice(2)), blocks: [] };
      sections.push(current);
      continue;
    }
    if (/^##\s/.test(line)) {
      flush();
      current = { title: plain(line.replace(/^##\s+/, '')), blocks: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    if (/^\|/.test(line)) {
      if (/^\|\s*-+/.test(line)) continue; // the rule under the header
      const cells = tableRow(line);
      if (!table) table = { header: cells, rows: [] };
      else table.rows.push(cells);
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (table) {
      current.blocks.push(table);
      table = null;
    }
    paragraph.push(line.trim());
  }
  flush();
  return sections;
}
