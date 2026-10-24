/**
 * The ui-style guide, enforced (docs/ui-style.md): ALL CAPS display text,
 * three-dot ellipses, raw ids in the label tables, icon-only buttons without an
 * accessible name, and font sizes outside the token block are defects, not style.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILTER_CHIPS } from '../src/core/app-state';
import { audioLabel, codecLabel, durationLabel, frameRateLabel, sizeLabel } from '../src/core/display';
import { STYLES, THEME_GROUPS, TYPE_GROUPS, TYPES } from '../src/core/taxonomy';
import { queueCard } from '../src/core/queue-card';
import type { RenderQueueJob } from '../src/core/render-queue';

const ROOT = join(__dirname, '..');
/** Repo files, with line endings normalized: a Windows checkout may hand back CRLF, and the
 * fence regex below must still see the "\n" it anchors on (docs/platform-notes.md). */
const read = async (p: string) => (await readFile(join(ROOT, p), 'utf8')).replace(/\r\n?/g, '\n');

/** The official-styling list in docs/ui-style.md is the one source of exceptions. */
async function officialStyling(): Promise<string[]> {
  const doc = await read('docs/ui-style.md');
  const block = /```official-styling\n([\s\S]*?)```/.exec(doc);
  if (!block) throw new Error('docs/ui-style.md has no official-styling list');
  return block[1]!.split('\n').map((l) => l.trim()).filter(Boolean);
}

describe('stylesheet', () => {
  it('has no uppercase transforms and no font sizes outside the tokens', async () => {
    const css = await read('src/renderer/styles.css');
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    const literals = css.match(/font-size:\s*[0-9][^;]*/g) ?? [];
    expect(literals).toEqual([]);
  });
});

describe('markup', () => {
  it('uses the ellipsis character, never three dots', async () => {
    const html = await read('src/renderer/index.html');
    expect(html.includes('...')).toBe(false);
  });

  it('shows no ALL CAPS text outside the official-styling list', async () => {
    const official = new Set(await officialStyling());
    const html = await read('src/renderer/index.html');
    const text = html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' '); // attributes go with their tags; what remains is what the user reads
    const shouting = [...text.matchAll(/\b[A-Z]{3,}\b/g)].map((m) => m[0]).filter((w) => !official.has(w));
    expect(shouting).toEqual([]);
  });

  it('gives every icon-only button an accessible name', async () => {
    const html = await read('src/renderer/index.html');
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const offenders = buttons.filter((b) => {
      const open = b.slice(0, b.indexOf('>') + 1);
      if (!open.includes('data-icon')) return false;
      const hasLabelSpan = b.includes('class="label"');
      const inner = b.slice(b.indexOf('>') + 1, b.lastIndexOf('</button>')).replace(/<[^>]*>/g, '').trim();
      return !hasLabelSpan && inner === '' && !open.includes('aria-label');
    });
    expect(offenders).toEqual([]);
  });
});

describe('what the window says', () => {
  /** Visible text: attributes go with their tags, so what is left is what a user reads. */
  const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ');

  it('talks about the thing, not about itself', async () => {
    // "Drag me into your editor" — the interface referring to itself in the first person.
    const text = visible(await read('src/renderer/index.html'));
    expect([...text.matchAll(/\b(me|my|I)\b/g)].map((m) => m[0])).toEqual([]);
  });

  it('shows no raw path or file name', async () => {
    const text = visible(await read('src/renderer/index.html'));
    // A Windows path, a POSIX path of two or more segments, or something with a file extension.
    const paths = [...text.matchAll(/[A-Za-z]:\\[^\s<]+|\/[\w.-]+\/[\w.-]+|\b[\w-]+\.(?:mov|mp4|png|webm|wav|json|zip)\b/g)].map((m) => m[0]);
    expect(paths).toEqual([]);
  });

  it('keeps paths and file names out of a render card', () => {
    const job: RenderQueueJob = {
      id: 1,
      templateId: 'pulp.samples.lower-third-bar',
      templateName: 'Lower Third Bar',
      presetId: 'prores-4444',
      outputPath: '/Users/dana/Movies/lower-third-bar.mov',
      totalFrames: 180,
      status: 'done',
      frame: 180,
      warnings: ['something to say'],
    };
    for (const status of ['queued', 'running', 'done', 'cancelled'] as const) {
      const card = queueCard({ ...job, status });
      const shown = `${card.name} ${card.preset} ${card.status.text}`;
      expect(shown, status).not.toContain('/');
      expect(shown, status).not.toMatch(/\.(mov|mp4|png|webm|wav)\b/);
      expect(shown, status).not.toMatch(/\b(me|my)\b/);
    }
    // The path is still reachable — in the tooltip, and behind Reveal and Copy path.
    expect(queueCard(job).tip).toContain('/Users/dana/Movies/lower-third-bar.mov');
  });
});

describe('display formatter', () => {
  it('emits sentence case except for the official-styling list', async () => {
    const official = await officialStyling();
    const officialWords = new Set(official.flatMap((entry) => entry.split(/\s+/)));
    const sentenceWord = /^[A-Z]?[a-z0-9]*(-[a-z0-9]+)*$/;
    const outputs = [
      ...['prores', 'h264', 'hevc', 'vp9', 'vp8', 'av1', 'qtrle', 'png', 'mjpeg', 'dnxhd', 'aac', 'mp3', 'opus', 'flac', 'vorbis', 'alac', 'pcm_s16le', 'pcm_f32le'].map(codecLabel),
      audioLabel('pcm_s24le', 2, 48000),
      sizeLabel(512), sizeLabel(2048), sizeLabel(12.4 * 1024 ** 2), sizeLabel(2048 * 1024 ** 2),
      frameRateLabel(29.97),
      durationLabel(6),
    ];
    for (const output of outputs) {
      for (const word of output.split(/[\s·,]+/).filter(Boolean)) {
        const ok = officialWords.has(word) || sentenceWord.test(word) || /^[0-9][0-9.:x×-]*(-bit|ch|s)?$/.test(word);
        expect(ok, `"${word}" in "${output}" is neither sentence case nor on the official-styling list`).toBe(true);
      }
    }
  });
});

describe('label tables', () => {
  it('holds display labels, not raw ids', () => {
    const labeled = [
      ...TYPES,
      ...TYPE_GROUPS,
      ...STYLES,
      ...THEME_GROUPS,
      ...THEME_GROUPS.flatMap((g) => g.themes),
      ...FILTER_CHIPS,
    ];
    for (const entry of labeled) {
      expect(entry.label, entry.label).toMatch(/^[A-Z0-9]/);
      expect(entry.label, entry.label).not.toMatch(/^[a-z0-9-]+$/);
    }
  });
});
