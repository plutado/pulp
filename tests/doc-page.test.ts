/**
 * Reading a documentation page for a dialog (milestone 8): the shape the
 * Acknowledgements and User guide dialogs are built from.
 */

import { describe, expect, it } from 'vitest';
import { docSections, isDocList, isDocTable } from '../src/core/doc-page';

describe('reading a page', () => {
  it('separates sections, paragraphs and tables, and takes the marks off', () => {
    const text = '# Title\n\nIntro with **bold** and `code` and [a link](x).\n\n## One\n\n| A | B |\n|---|---|\n| **x** | y |\n| p | q |\n\nAfter.\nSame paragraph.\n';
    expect(docSections(text)).toEqual([
      { title: 'Title', level: 1, blocks: ['Intro with bold and code and a link.'] },
      { title: 'One', level: 1, blocks: [{ header: ['A', 'B'], rows: [['x', 'y'], ['p', 'q']] }, 'After. Same paragraph.'] },
    ]);
  });

  it('reads a bullet list as one block, a wrapped bullet as one item', () => {
    const [section] = docSections('## Keys\n\n- **Space** plays\n- `Esc` closes,\n  wherever it is\n\nAfter the list.\n');
    expect(section!.blocks).toEqual([
      { items: ['Space plays', 'Esc closes, wherever it is'] },
      'After the list.',
    ]);
  });

  it('reads a third-level heading as a section inside one, marked as such', () => {
    const sections = docSections('## One\n\nFirst.\n\n### A part\n\nSecond.\n');
    expect(sections.map((s) => [s.title, s.level])).toEqual([['One', 1], ['A part', 2]]);
    expect(sections[1]!.blocks).toEqual(['Second.']);
  });

  it('tells a table from a list, for a dialog that draws them differently', () => {
    const [section] = docSections('## X\n\n- an item\n\n| A |\n|---|\n| b |\n');
    const [list, table] = section!.blocks;
    expect(isDocList(list!)).toBe(true);
    expect(isDocTable(table!)).toBe(true);
    expect(isDocTable(list!)).toBe(false);
  });
});
