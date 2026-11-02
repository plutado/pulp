import { describe, expect, it } from 'vitest';
import { noticeSections } from '../src/core/notices';

describe('reading notices', () => {
  it('separates sections, paragraphs and tables, and takes the marks off', () => {
    const text = '# Title\n\nIntro with **bold** and `code` and [a link](x).\n\n## One\n\n| A | B |\n|---|---|\n| **x** | y |\n| p | q |\n\nAfter.\nSame paragraph.\n';
    expect(noticeSections(text)).toEqual([
      { title: 'Title', blocks: ['Intro with bold and code and a link.'] },
      { title: 'One', blocks: [{ header: ['A', 'B'], rows: [['x', 'y'], ['p', 'q']] }, 'After. Same paragraph.'] },
    ]);
  });
});
