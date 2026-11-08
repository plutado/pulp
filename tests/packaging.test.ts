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
import { TEST_PICK_FILE, TEST_PICK_FOLDER, testPickedFile, testPickedFolder } from '../src/core/test-hooks';

const ROOT = join(__dirname, '..');

interface TargetSpec {
  target: string;
  arch: string[];
}

interface BuilderConfig {
  appId: string;
  productName: string;
  artifactName: string;
  fileAssociations: { ext: string; name: string; mimeType: string; role: string }[];
  files: string[];
  directories: { buildResources: string; output: string };
  extraResources: { from: string; to: string; filter?: string[] }[];
  mac: {
    target: TargetSpec[];
    icon: string;
    hardenedRuntime: boolean;
    identity: string | null;
    entitlements: string;
    entitlementsInherit: string;
  };
  win: { target: TargetSpec[]; icon: string; executableName: string };
  nsis: Record<string, unknown>;
  linux: {
    target: TargetSpec[];
    icon: string;
    category: string;
    syncDesktopName: boolean;
    desktop: { entry: Record<string, string> };
  };
}

const config = load(await readFile(join(ROOT, 'electron-builder.yml'), 'utf8')) as BuilderConfig;
const resources = await readFile(join(ROOT, 'src', 'main', 'resources.ts'), 'utf8');
const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string>; desktopName: string };
const releaseWorkflow = await readFile(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

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

  it('puts the licenses beside the app', () => {
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

describe('the Windows build', () => {
  it('is an installer, and the app is "Pulp" wherever Windows names it', () => {
    expect(config.win.target.map((t) => t.target)).toEqual(['nsis']);
    expect(config.win.target[0]!.arch).toEqual(['x64']);
    expect(config.win.icon).toBe('build/icon.ico');
    // The task bar, the task manager and the Start menu read the executable's own name.
    expect(config.win.executableName).toBe('Pulp');
  });

  it('offers the shortcuts and the folder, and leaves what a person made behind', () => {
    // Not a one-click installer: it asks where to go and which shortcuts to make.
    expect(config.nsis.oneClick).toBe(false);
    expect(config.nsis.allowToChangeInstallationDirectory).toBe(true);
    expect(config.nsis.createDesktopShortcut).toBe(true);
    expect(config.nsis.createStartMenuShortcut).toBe(true);
    expect(config.nsis.shortcutName).toBe('Pulp');
    // Per-user, so no administrator prompt; Pulp writes nothing outside its own folders.
    expect(config.nsis.perMachine).toBe(false);
    // The library index, the settings and the render cache survive an uninstall.
    expect(config.nsis.deleteAppDataOnUninstall).toBe(false);
    // An installer and the app itself are both .exe files; the name says which is which.
    expect(String(config.nsis.artifactName)).toContain('Setup');
  });
});

describe('the Linux build', () => {
  it('is an AppImage with the icon sizes a desktop reads', () => {
    expect(config.linux.target.map((t) => t.target)).toEqual(['AppImage']);
    expect(config.linux.target[0]!.arch).toEqual(['x64']);
    expect(config.linux.icon).toBe('build/icons');
    expect(existsSync(join(ROOT, config.linux.icon)), 'the icon folder is in the repository').toBe(true);
  });

  it('puts itself in the application menu as a video tool', () => {
    expect(config.linux.category).toBe('AudioVideo');
    const entry = config.linux.desktop.entry;
    // A desktop entry's categories are semicolon-separated and end in one.
    expect(entry.Categories).toMatch(/^(?:[A-Za-z]+;)+$/);
    expect(entry.Categories).toContain('AudioVideo;');
    expect(entry.Keywords).toMatch(/;$/);
  });

  it('names the entry what Electron calls the window, so the two belong together', () => {
    // Electron reports `desktopName` as the window's class and electron-builder writes the
    // entry (and its StartupWMClass) from the same name; with them apart, a dock shows the
    // AppImage's generic icon beside the running window instead of grouping them.
    expect(config.linux.syncDesktopName).toBe(true);
    expect(packageJson.desktopName).toBe('pulp.desktop');
  });
});

describe('what a build is called, and how one is made', () => {
  it('names every artifact the same way, since they land on one release page together', () => {
    expect(config.artifactName).toBe('${productName}-${version}-${os}-${arch}.${ext}');
  });

  it('has a command per platform, each building the app first', () => {
    for (const platform of ['mac', 'win', 'linux']) {
      const script = packageJson.scripts[`package:${platform}`];
      expect(script, `npm run package:${platform}`).toBe(`npm run build && electron-builder --${platform}`);
    }
  });
});

describe('the release workflow', () => {
  const release = load(releaseWorkflow) as {
    on: { push: { tags: string[] } };
    permissions: Record<string, string>;
    jobs: Record<string, {
      needs?: string;
      permissions?: Record<string, string>;
      strategy?: { matrix: { include: { os: string; flag: string; artifacts: string }[] } };
      steps: { name?: string; run?: string; uses?: string; with?: Record<string, unknown> }[];
    }>;
  };

  it('runs on the tag `npm run release` makes, and builds each platform on itself', () => {
    expect(release.on.push.tags).toEqual(['v*']);
    const matrix = release.jobs.build!.strategy!.matrix.include;
    expect(matrix.map((m) => m.os).sort()).toEqual(['macos-latest', 'ubuntu-latest', 'windows-latest']);
    expect(matrix.map((m) => m.flag).sort()).toEqual(['--linux', '--mac', '--win']);
    // Each job collects what its own platform builds, and fails rather than drafting nothing.
    for (const entry of matrix) expect(entry.artifacts, entry.os).toContain('release/');
  });

  it('drafts the release and publishes nothing', () => {
    // Read-only by default; the one job that writes says so for itself.
    expect(release.permissions.contents).toBe('read');
    expect(release.jobs.draft!.permissions!.contents).toBe('write');
    expect(release.jobs.draft!.needs).toBe('build');
    const steps = release.jobs.draft!.steps.map((s) => s.run ?? '').join('\n');
    expect(steps).toContain('--draft');
    expect(steps).not.toMatch(/gh release (create|edit)[^\n]*--latest/);
    // electron-builder uploads nothing of its own accord.
    expect(release.jobs.build!.steps.some((s) => (s.run ?? '').includes('--publish never'))).toBe(true);
    // The checksums go up with the files, since the builds are unsigned.
    expect(steps).toContain('sha256sum');
  });

  it('draws its notes from the changelog rather than writing them a second time', () => {
    const steps = release.jobs.draft!.steps.map((s) => s.run ?? '').join('\n');
    expect(steps).toContain('scripts/release-notes.mjs');
    expect(steps).toContain('.github/release-footer.md');
    expect(existsSync(join(ROOT, 'scripts', 'release-notes.mjs'))).toBe(true);
    expect(existsSync(join(ROOT, '.github', 'release-footer.md'))).toBe(true);
  });

  it('refuses a tag that does not match the version in package.json', () => {
    const steps = release.jobs.build!.steps.map((s) => s.run ?? '').join('\n');
    expect(steps).toContain("require('./package.json').version");
  });
});

describe('the files a double-click opens in Pulp', () => {
  it('associates exactly the two files the main process reads as a project', async () => {
    // macOS writes them into Info.plist, the installer registers them per user on Windows, and
    // the AppImage's .desktop entry carries their MIME types; src/core/open-file.ts reads the
    // path the system then hands over, by these same extensions.
    const openFile = await readFile(join(ROOT, 'src', 'core', 'open-file.ts'), 'utf8');
    const known = [...openFile.matchAll(/_EXTENSION = '([a-z]+)'/g)].map((m) => m[1]!).sort();
    expect(known).toEqual(['pulp', 'pulpcollection']);
    expect(config.fileAssociations.map((a) => a.ext).sort()).toEqual(known);
    for (const association of config.fileAssociations) {
      expect(association.role, association.ext).toBe('Editor');
      expect(association.mimeType, association.ext).toMatch(/^application\/x-pulp-/);
      expect(association.name, association.ext).toMatch(/^Pulp /);
    }
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

describe('what a packaged build ignores', () => {
  it('does not answer the folder picker from the environment: the test hook works only in a development build', async () => {
    // The hook itself: a folder in a development build, nothing in a packaged one, nothing for an empty value.
    expect(testPickedFolder({ [TEST_PICK_FOLDER]: '/Volumes/Stock' }, false)).toBe('/Volumes/Stock');
    expect(testPickedFolder({ [TEST_PICK_FOLDER]: '/Volumes/Stock' }, true)).toBeUndefined();
    expect(testPickedFolder({ [TEST_PICK_FOLDER]: '  ' }, false)).toBeUndefined();
    expect(testPickedFolder({}, false)).toBeUndefined();
    // The disc image picker's hook (milestone 32) follows the same rule.
    expect(testPickedFile({ [TEST_PICK_FILE]: '/x/Stock.dmg' }, false)).toBe('/x/Stock.dmg');
    expect(testPickedFile({ [TEST_PICK_FILE]: '/x/Stock.dmg' }, true)).toBeUndefined();
    // And the main process reads it through the hook alone, with whether the app is packaged: no
    // other line in what we ship names the variable.
    const main = await readFile(join(ROOT, 'src', 'main', 'index.ts'), 'utf8');
    expect(main).toContain('testPickedFolder(process.env, app.isPackaged)');
    expect(main).toContain('testPickedFile(process.env, app.isPackaged)');
    expect(main).not.toMatch(/process\.env\.PULP_TEST_PICK_/);
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { relative, sep } = await import('node:path');
    const naming: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && /PULP_TEST_PICK_/.test(readFileSync(full, 'utf8'))) naming.push(relative(ROOT, full).split(sep).join('/'));
      }
    };
    walk(join(ROOT, 'src'));
    expect(naming.sort(), 'the variable is named in the hook alone; what calls it does so by the constant').toEqual(['src/core/test-hooks.ts']);
  });
});
