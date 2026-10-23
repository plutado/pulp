import { describe, expect, it } from 'vitest';
import { crc32, readZip, safeZipPath, writeZip, ZipError } from '../src/core/zip';

describe('zip', () => {
  it('round-trips entries, deflated or stored', () => {
    const big = Buffer.alloc(50_000, 'a');
    const random = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 256));
    const zip = writeZip([
      { name: 'pack.json', data: Buffer.from('{"x":1}') },
      { name: 'tpl/index.html', data: big },
      { name: 'tpl/noise.bin', data: random },
      { name: 'tpl/empty.txt', data: Buffer.alloc(0) },
    ]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['pack.json', 'tpl/index.html', 'tpl/noise.bin', 'tpl/empty.txt']);
    expect(entries[0]!.data.toString()).toBe('{"x":1}');
    expect(entries[1]!.data.equals(big)).toBe(true);
    expect(entries[2]!.data.equals(random)).toBe(true);
    expect(entries[3]!.data.length).toBe(0);
    expect(zip.length).toBeLessThan(big.length / 10); // the run of "a" compressed
  });

  it('refuses unsafe names when writing and when reading', () => {
    expect(() => writeZip([{ name: '../x', data: Buffer.alloc(1) }])).toThrow(ZipError);
    expect(safeZipPath('a/../b')).toBeNull();
    expect(safeZipPath('/abs')).toBeNull();
    expect(safeZipPath('C:\\\\win')).toBeNull();
    expect(safeZipPath('dir/')).toBeNull();
    expect(safeZipPath('ok/file.txt')).toBe('ok/file.txt');
    expect(safeZipPath('back\\slash.txt')).toBe('back/slash.txt');
    // A hand-built archive with a traversal name: patch a valid one with a same-length unsafe name.
    const zip = writeZip([{ name: 'abcd/e.txt', data: Buffer.from('x') }]);
    const patched = Buffer.from(zip);
    let at = patched.indexOf('abcd/e.txt');
    while (at !== -1) {
      patched.write('../x/e.txt', at, 'utf8');
      at = patched.indexOf('abcd/e.txt', at + 1);
    }
    expect(() => readZip(patched)).toThrow(/unsafe entry name/);
  });

  it('detects corruption and enforces limits', () => {
    const zip = writeZip([{ name: 'a.txt', data: Buffer.from('hello hello hello') }]);
    const damaged = Buffer.from(zip);
    damaged[37] = damaged[37]! ^ 0xff; // flip a byte of the compressed body (after the 30-byte header and 5-byte name)
    expect(() => readZip(damaged)).toThrow(ZipError);
    expect(() => readZip(Buffer.from('not a zip at all, really'))).toThrow(/not a zip file/);
    const many = writeZip(Array.from({ length: 3 }, (_, i) => ({ name: `f${i}`, data: Buffer.alloc(10) })));
    expect(() => readZip(many, { maxEntries: 2 })).toThrow(/too many entries/);
    expect(() => readZip(many, { maxBytes: 25 })).toThrow(/unpacked size exceeds/);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});
