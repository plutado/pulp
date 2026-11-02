/**
 * What a packaged build carries (milestone 17), held to what the app reads.
 *
 * Two things can drift apart without anyone noticing until a built app is
 * opened: `electron-builder.yml`, which copies folders into the application's
 * `Resources/`, and `src/main/resources.ts`, which is where the main process
 * looks for them. Everything here runs in a checkout, so a rename on either
 * side fails in CI rather than in somebody's download.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

interface BuilderConfig {
  appId: string;
  productName: string;
  files: string[];
  directories: { buildResources: string; output: string };
  extraResources: { from: string; to: string; filter?: string[] }[];
  mac: {
    target: { target: string; arch: string[] }[];
    icon: string;
    hardenedRuntime: boolean;
    identity: string | null;
    entitlements: string;
    entitlementsInherit: string;
  };
}

const config = load(await readFile(join(ROOT, 'electron-builder.yml'), 'utf8')) as BuilderConfig;
const resources = await readFile(join(ROOT, 'src', 'main', 'resources.ts'), 'utf8');

describe('what the build copies', () => {
  it('copies something that is really there, to a name of its own', () => {
    expect(config.extraResources.length).toBeGreaterThanOrEqual(5);
    const seen = new Set<string>();
    for (const { from, to } of config.extraResources) {
      expect(existsSync(join(ROOT, from)), `${from} is in the repository`).toBe(true);
      expect(seen.has(to), `${to} is copied once`).toBe(false);
      seen.add(to);
    }
  });

  it('copies every folder the main process looks for in a packaged app, under the name it looks for', () => {
    // `bundled('<name>')` in src/main/resources.ts is a folder expected at Resources/<name>.
    const wanted = [...resources.matchAll(/bundled\('([^']+)'/g)].map((m) => m[1]!);
    expect(wanted.sort()).toEqual(['examples', 'fonts', 'lottie', 'pdfjs', 'templates']);
    const copied = new Set(config.extraResources.map((r) => r.to));
    for (const name of wanted) expect(copied.has(name), `Resources/${name} is copied by the build`).toBe(true);
  });

  it('carries the two library files that are read from disk at run time, and only those', () => {
    const pdfjs = config.extraResources.find((r) => r.to === 'pdfjs')!;
    expect(pdfjs.filter).toEqual(['pdf.min.mjs', 'pdf.worker.min.mjs']);
    for (const file of pdfjs.filter!) expect(existsSync(join(ROOT, pdfjs.from, file)), file).toBe(true);
    const lottie = config.extraResources.find((r) => r.to === 'lottie')!;
    expect(lottie.filter).toEqual(['lottie_light.min.js']);
    expect(existsSync(join(ROOT, lottie.from, lottie.filter![0]!))).toBe(true);
  });

  it('ships the built app and no node_modules: everything imported is bundled into out/', () => {
    expect(config.files).toContain('out/**');
    expect(config.files).toContain('package.json');
    // Said outright, because electron-builder copies the production dependency tree otherwise —
    // which here means pdf.js's native canvas, which Pulp never calls and which differs per
    // architecture, so the universal build refuses to merge the two.
    expect(config.files).toContain('!node_modules/**');
  });

  it('puts the licences beside the app', () => {
    const copied = config.extraResources.map((r) => r.to);
    expect(copied).toContain('THIRD_PARTY_NOTICES.md');
    expect(copied).toContain('LICENSE');
  });
});

describe('the macOS build', () => {
  it('is universal, in both the formats a person downloads', () => {
    expect(config.mac.target.map((t) => t.target).sort()).toEqual(['dmg', 'zip']);
    for (const target of config.mac.target) expect(target.arch, target.target).toEqual(['universal']);
  });

  it('is ad-hoc signed with the hardened runtime, which is what "unsigned" can be and still run', () => {
    // A hardened runtime is a *signing* option: with signing skipped outright it would do
    // nothing. Ad-hoc is no identity — nothing Apple issued — but a real signature, which
    // Apple Silicon needs to launch anything at all. Signing proper is milestone 7.
    expect(config.mac.identity).toBe('-');
    expect(config.mac.hardenedRuntime).toBe(true);
  });

  it('names the entitlements the hardened runtime needs, and they are there', async () => {
    const plist = join(ROOT, config.mac.entitlements);
    expect(existsSync(plist)).toBe(true);
    // What is signed and what is inherited by the helper processes are the same file.
    expect(config.mac.entitlementsInherit).toBe(config.mac.entitlements);
    const text = await readFile(plist, 'utf8');
    for (const key of ['allow-jit', 'allow-unsigned-executable-memory', 'disable-library-validation']) {
      expect(text, key).toContain(`com.apple.security.cs.${key}`);
    }
    // Nothing here reaches outside the machine; that is the point of listing them.
    expect(text).not.toContain('com.apple.security.network');
  });
});

describe('the icon', () => {
  it('is drawn for every platform, at the sizes each asks for', async () => {
    const build = join(ROOT, config.directories.buildResources);
    expect(existsSync(join(ROOT, config.mac.icon))).toBe(true);
    // Each container is what it claims: `icns` at the head of one, the icon directory of the
    // other, so a file committed half-written fails here rather than at the end of a build.
    const icns = await readFile(join(build, 'icon.icns'));
    expect(icns.subarray(0, 4).toString('ascii'), 'an .icns').toBe('icns');
    expect(icns.readUInt32BE(4), 'its length is its own size').toBe(icns.length);
    const ico = await readFile(join(build, 'icon.ico'));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)], 'an .ico').toEqual([0, 1]);
    expect(ico.readUInt16LE(4), 'seven sizes in it').toBe(7);
    for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
      expect(existsSync(join(build, 'icons', `${size}x${size}.png`)), `Linux ${size}px`).toBe(true);
    }
  });
});
