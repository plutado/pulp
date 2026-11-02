/**
 * A documentation page as a dialog shows it (milestone 8): a markdown file
 * read into sections — a heading with its paragraphs, lists and tables — so
 * the dialog **is** the file and cannot drift from it.
 *
 * Two pages are read this way: `THIRD_PARTY_NOTICES.md` under Help →
 * Acknowledgements, and `docs/user-guide.md` under Help → User Guide. Both
 * are inlined at build time, so the window needs nothing from disk and says
 * exactly what the repository says.
 *
 * As much markdown as those two pages use and no more: headings at two
 * levels, paragraphs, bullet lists and tables, with the inline marks taken
 * off, since a dialog sets its words plainly. The files are the record; this
 * only reads them. Pure, like the changelog reader beside it.
 */

export interface DocTable {
  header: string[];
  rows: string[][];
}

export interface DocList {
  items: string[];
}

export interface DocSection {
  title: string;
  /** 1 for a page or section heading, 2 for a heading inside one (`###`). */
  level: 1 | 2;
  /** What is under the heading, in the order it appears; a string is a paragraph. */
  blocks: (string | DocTable | DocList)[];
}

/** A table is the one with a header row; a list is the one with items. */
export function isDocTable(block: string | DocTable | DocList): block is DocTable {
  return typeof block !== 'string' && 'header' in block;
}

export function isDocList(block: string | DocTable | DocList): block is DocList {
  return typeof block !== 'string' && 'items' in block;
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

/**
 * The page as sections, in the order they appear: the text before the first
 * `##` is the introduction, titled by the `#` line. A `###` heading is a
 * section too, marked `level: 2`, so a dialog can set it smaller and leave it
 * out of a contents list while still showing it in its place.
 */
export function docSections(markdown: string): DocSection[] {
  const sections: DocSection[] = [];
  let current: DocSection | null = null;
  let paragraph: string[] = [];
  let table: DocTable | null = null;
  let list: DocList | null = null;

  const closeParagraph = (): void => {
    if (paragraph.length > 0 && current) current.blocks.push(plain(paragraph.join(' ')));
    paragraph = [];
  };
  const closeTable = (): void => {
    if (table && current) current.blocks.push(table);
    table = null;
  };
  const closeList = (): void => {
    if (list && current) current.blocks.push(list);
    list = null;
  };
  const closeAll = (): void => {
    closeParagraph();
    closeTable();
    closeList();
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeAll();
      current = { title: plain(heading[2]!), level: heading[1]!.length >= 3 ? 2 : 1, blocks: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    if (/^\|/.test(line)) {
      closeParagraph();
      closeList();
      if (/^\|\s*-+/.test(line)) continue; // the rule under the header
      const cells = tableRow(line);
      if (!table) table = { header: cells, rows: [] };
      else table.rows.push(cells);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      closeParagraph();
      closeTable();
      if (!list) list = { items: [] };
      list.items.push(plain(bullet[1]!));
      continue;
    }
    if (line.trim() === '') {
      closeAll();
      continue;
    }
    // A line under an open bullet continues it; anything else is a paragraph.
    if (list) list.items[list.items.length - 1] += ` ${plain(line)}`;
    else {
      closeTable();
      paragraph.push(line.trim());
    }
  }
  closeAll();
  return sections;
}
