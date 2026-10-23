import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaEntry } from '../src/core/library-types';
import { itemId } from '../src/core/library-scan';
import { mediaUrlFor, parseRange, serveMedia, type MediaLookup } from '../src/core/media-serve';

let dir: string;
let root: string;
const items = new Map<string, MediaLookup>();

function media(path: string, root: string, mediaKind: MediaEntry['mediaKind'], ext: string): MediaEntry {
  const key = `media:${path}`;
  return { kind: 'media', key, id: itemId(key), path, root, name: 'x', mediaKind, ext, size: 0, mtimeMs: 0, tags: [] };
}

async function body(stream: Readable | undefined): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const get = (id: string, extra: Partial<Parameters<typeof serveMedia>[0]> = {}) =>
  serveMedia({ method: 'GET', url: mediaUrlFor(id), ...extra }, (k) => items.get(k));

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pulp-media-'));
  root = join(dir, 'library');
  await mkdir(join(root, 'Audio'), { recursive: true });
  await mkdir(join(dir, 'outside'), { recursive: true });
  // 1000 bytes with a known pattern so ranges can be checked byte for byte.
  await writeFile(join(root, 'Audio', 'tone.wav'), Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251)));
  await writeFile(join(dir, 'outside', 'secret.wav'), Buffer.alloc(10, 7));
  await writeFile(join(root, 'notes.txt'), 'text');
  await symlink(join(dir, 'outside', 'secret.wav'), join(root, 'Audio', 'link.wav'));

  const tone = media(join(root, 'Audio', 'tone.wav'), root, 'audio', '.wav');
  const link = media(join(root, 'Audio', 'link.wav'), root, 'audio', '.wav');
  const wrongKind = media(join(root, 'notes.txt'), root, 'audio', '.txt');
  const offline = media(join(root, 'Audio', 'tone.wav'), root, 'audio', '.wav');
  items.set(tone.id, { entry: tone, root, online: true });
  items.set(link.id, { entry: link, root, online: true });
  items.set(wrongKind.id, { entry: wrongKind, root, online: true });
  items.set('offline0000000000000000', { entry: offline, root, online: false });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('serveMedia refusals', () => {
  it('404 for an unknown id, with no detail', async () => {
    const r = await get('deadbeefdeadbeefdeadbeef');
    expect(r.status).toBe(404);
    expect(r.body).toBeUndefined();
    expect(Object.keys(r.headers)).toEqual(['Cache-Control']);
  });

  it('404 for an item whose root is offline', async () => {
    expect((await get('offline0000000000000000')).status).toBe(404);
  });

  it('404 for a symlink inside the library that points outside the root', async () => {
    const link = [...items.values()].find((l) => l.entry.path.endsWith('link.wav'))!;
    const r = await get(link.entry.id);
    expect(r.status).toBe(404);
    expect(r.body).toBeUndefined();
  });

  it("404 when the real file is not a media type of the item's kind", async () => {
    const wrong = [...items.values()].find((l) => l.entry.path.endsWith('notes.txt'))!;
    expect((await get(wrong.entry.id)).status).toBe(404);
  });

  it('404 for a path, query or template id instead of a bare id', async () => {
    const tone = [...items.values()].find((l) => l.entry.path.endsWith('tone.wav'))!;
    expect((await serveMedia({ method: 'GET', url: `${mediaUrlFor(tone.entry.id)}tone.wav` }, (k) => items.get(k))).status).toBe(404);
    expect((await serveMedia({ method: 'GET', url: `${mediaUrlFor(tone.entry.id)}?x=1` }, (k) => items.get(k))).status).toBe(404);
    expect((await serveMedia({ method: 'GET', url: 'pulp-media://..%2F..%2Fetc/' }, (k) => items.get(k))).status).toBe(404);
    expect((await serveMedia({ method: 'GET', url: 'not a url' }, (k) => items.get(k))).status).toBe(404);
  });

  it('403 for requests made from a template page, 405 for anything but GET and HEAD', async () => {
    const tone = [...items.values()].find((l) => l.entry.path.endsWith('tone.wav'))!;
    expect((await get(tone.entry.id, { referrer: 'pulp-template://pulp.samples.title-card/' })).status).toBe(403);
    const post = await serveMedia({ method: 'POST', url: mediaUrlFor(tone.entry.id) }, (k) => items.get(k));
    expect(post.status).toBe(405);
    expect(post.headers.Allow).toBe('GET, HEAD');
  });
});

describe('serveMedia success and ranges', () => {
  const tone = () => [...items.values()].find((l) => l.entry.path.endsWith('tone.wav'))!.entry.id;

  it('serves the whole file with media headers', async () => {
    const r = await get(tone());
    expect(r.status).toBe(200);
    expect(r.headers).toMatchObject({ 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': '1000', 'X-Content-Type-Options': 'nosniff' });
    const bytes = await body(r.body);
    expect(bytes).toHaveLength(1000);
    expect(bytes[0]).toBe(0);
    expect(bytes[999]).toBe(999 % 251);
  });

  it('answers HEAD with headers only', async () => {
    const r = await serveMedia({ method: 'HEAD', url: mediaUrlFor(tone()) }, (k) => items.get(k));
    expect(r.status).toBe(200);
    expect(r.headers['Content-Length']).toBe('1000');
    expect(r.body).toBeUndefined();
  });

  it('serves byte ranges with 206 and Content-Range, so a player can seek', async () => {
    const r = await get(tone(), { range: 'bytes=100-199' });
    expect(r.status).toBe(206);
    expect(r.headers['Content-Range']).toBe('bytes 100-199/1000');
    expect(r.headers['Content-Length']).toBe('100');
    const bytes = await body(r.body);
    expect(bytes).toHaveLength(100);
    expect(bytes[0]).toBe(100);
    expect(bytes[99]).toBe(199);

    const open = await get(tone(), { range: 'bytes=990-' });
    expect(open.headers['Content-Range']).toBe('bytes 990-999/1000');
    expect(await body(open.body)).toHaveLength(10);

    const suffix = await get(tone(), { range: 'bytes=-5' });
    expect(suffix.headers['Content-Range']).toBe('bytes 995-999/1000');
    expect((await body(suffix.body))[0]).toBe(995 % 251);

    const clipped = await get(tone(), { range: 'bytes=900-5000' });
    expect(clipped.headers['Content-Range']).toBe('bytes 900-999/1000');
  });

  it('416 for an unsatisfiable range, 200 for a malformed one', async () => {
    const r = await get(tone(), { range: 'bytes=1000-' });
    expect(r.status).toBe(416);
    expect(r.headers['Content-Range']).toBe('bytes */1000');
    expect(r.body).toBeUndefined();
    expect((await get(tone(), { range: 'items=0-1' })).status).toBe(200);
    expect((await get(tone(), { range: 'bytes=5-2' })).status).toBe(416);
  });

  it('parseRange', () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange('bytes=0-0', 10)).toEqual({ start: 0, end: 0 });
    expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=-', 10)).toBeNull();
  });
});
