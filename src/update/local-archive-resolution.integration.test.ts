import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

import { LOCAL_FRAMEWORK_DEPENDENCY } from '../create-zero/local-framework-package';
import { updateZeroProject } from './run';
import {
  createLocalArchiveFixtureBun, expectFixtureFrameworkArchive, type LocalArchiveFixtureBun,
} from './test-support/local-archive-fixture-bun';

interface PackedFixture {
  archivePath: string;
  sourceDir: string;
}

test('real Bun updates a root local archive override with a workspace peer', async () => {
  const scratchRoot = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratchRoot, { recursive: true });
  const rootDir = await mkdtemp(join(scratchRoot, 'zero-update-override-peer-'));
  const bun = createLocalArchiveFixtureBun(rootDir);
  const suffix = crypto.randomUUID().slice(0, 8);
  try {
    const oldFramework = await packFixture(rootDir, '@zero/framework', `1.0.0-${suffix}`, {}, bun);
    const newFramework = await packFixture(rootDir, '@zero/framework', `2.0.0-${suffix}`, {}, bun);
    const appDir = join(rootDir, 'app');
    const workspaceDir = join(appDir, 'packages', 'bridge');
    const archiveDir = join(appDir, '.zero', 'framework');
    await Promise.all([mkdir(workspaceDir, { recursive: true }), mkdir(archiveDir, { recursive: true })]);
    await copyFile(oldFramework.archivePath, join(archiveDir, 'zero-framework.tgz'));
    const manifest = `${JSON.stringify({
      name: 'root-override-peer-fixture', private: true, workspaces: ['packages/*'],
      dependencies: { '@zero/framework': LOCAL_FRAMEWORK_DEPENDENCY },
      overrides: { '@zero/framework': LOCAL_FRAMEWORK_DEPENDENCY },
    }, null, 2)}\n`;
    const peerManifest = `${JSON.stringify({ name: '@fixture/bridge', version: '1.0.0', peerDependencies: { '@zero/framework': '*' } }, null, 2)}\n`;
    await Promise.all([
      Bun.write(join(appDir, 'package.json'), manifest),
      Bun.write(join(workspaceDir, 'package.json'), peerManifest),
      Bun.write(join(appDir, 'bunfig.toml'), '[install]\nlinker = "hoisted"\n'),
      Bun.write(join(appDir, 'user-data-sentinel.txt'), 'app data is untouched\n'),
    ]);
    await bun.run(appDir, ['install', '--force', '--no-cache', '--ignore-scripts', '--no-progress']);
    expect(await installedVersion(appDir, '@zero/framework')).toBe(`1.0.0-${suffix}`);
    await expectFixtureFrameworkArchive(appDir, oldFramework.archivePath);
    const result = await updateZeroProject({ projectDir: appDir, mode: 'local', localFrameworkDir: newFramework.sourceDir }, {
      runCommand: bun.runCommand,
    });
    expect(result.versionBefore).toBe(`1.0.0-${suffix}`);
    expect(result.versionAfter).toBe(`2.0.0-${suffix}`);
    expect(await Bun.file(join(appDir, 'package.json')).text()).toBe(manifest);
    expect(await Bun.file(join(workspaceDir, 'package.json')).text()).toBe(peerManifest);
    expect(await Bun.file(join(appDir, 'user-data-sentinel.txt')).text()).toBe('app data is untouched\n');
    const lock = await Bun.file(join(appDir, 'bun.lock')).text();
    expect(lock).not.toContain('zero-framework-update-');
    expect(lock).toContain('"@zero/framework": "*"');
    expect(await installedVersion(appDir, '@zero/framework')).toBe(`2.0.0-${suffix}`);
    expect(await readdir(archiveDir)).toEqual(['zero-framework.tgz']);
    await bun.run(appDir, ['install', '--frozen-lockfile', '--force', '--no-cache', '--ignore-scripts', '--no-progress']);
    expect(await installedVersion(appDir, '@zero/framework')).toBe(`2.0.0-${suffix}`);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}, 120_000);

test(
  'real Bun refreshes a changed local archive graph without moving app pins',
  async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-real-archive-refresh-'));
    const bun = createLocalArchiveFixtureBun(rootDir);
    const suffix = crypto.randomUUID().slice(0, 8);
    const oldFrameworkVersion = `1.0.0-${suffix}`;
    const newFrameworkVersion = `2.0.0-${suffix}`;

    try {
      const oldFramework = await packFixture(rootDir, '@zero/framework', oldFrameworkVersion, {
        picocolors: '1.1.1',
        zod: '3.25.76',
      }, bun);
      const newFramework = await packFixture(rootDir, '@zero/framework', newFrameworkVersion, {
        'json-schema': '0.4.0',
        zod: '4.2.1',
      }, bun);

      const appDir = join(rootDir, 'app');
      const archiveDir = join(appDir, '.zero', 'framework');
      await mkdir(archiveDir, { recursive: true });
      await copyFile(oldFramework.archivePath, join(archiveDir, 'zero-framework.tgz'));
      const packagePath = join(appDir, 'package.json');
      await writeFile(
        packagePath,
        `${JSON.stringify(
          {
            name: 'real-bun-update-fixture',
            private: true,
            dependencies: {
              '@zero/framework': LOCAL_FRAMEWORK_DEPENDENCY,
              react: '19.2.4',
              zod: '3.25.76',
            },
          },
          null,
          2
        )}\n`
      );
      await bun.run(appDir, [
        'install',
        '--force',
        '--no-cache',
        '--ignore-scripts',
        '--no-progress',
      ]);

      const packageBefore = await readFile(packagePath, 'utf8');
      const lockBefore = await readFile(join(appDir, 'bun.lock'), 'utf8');
      const unrelatedBefore = packageTuple(lockBefore, 'react');
      expect(await installedVersion(appDir, 'zod')).toBe('3.25.76');
      expect(await installedVersion(appDir, '@zero/framework')).toBe(oldFrameworkVersion);
      await expectFixtureFrameworkArchive(appDir, oldFramework.archivePath);

      const result = await updateZeroProject({
        projectDir: appDir,
        mode: 'local',
        localFrameworkDir: newFramework.sourceDir,
      }, { runCommand: bun.runCommand });
      expect(result.versionBefore).toBe(oldFrameworkVersion);

      expect(result.versionAfter).toBe(newFrameworkVersion);
      expect(await readFile(packagePath, 'utf8')).toBe(packageBefore);
      expect(await installedVersion(appDir, '@zero/framework')).toBe(newFrameworkVersion);
      expect(await installedVersion(appDir, 'zod')).toBe('3.25.76');
      expect(
        await installedVersion(
          join(appDir, 'node_modules', '@zero', 'framework'),
          'zod'
        )
      ).toBe('4.2.1');

      const lockAfter = await readFile(join(appDir, 'bun.lock'), 'utf8');
      expect(lockAfter).toContain('"json-schema"');
      expect(lockAfter).not.toContain('"picocolors"');
      expect(packageTuple(lockAfter, 'react')).toBe(unrelatedBefore);
      expect(await readdir(archiveDir)).toEqual(['zero-framework.tgz']);

      await rm(join(appDir, 'node_modules'), { recursive: true, force: true });
      await bun.run(appDir, [
        'install',
        '--frozen-lockfile',
        '--force',
        '--no-cache',
        '--ignore-scripts',
        '--no-progress',
      ]);
      expect(await installedVersion(appDir, '@zero/framework')).toBe(newFrameworkVersion);
      expect(await installedVersion(appDir, 'zod')).toBe('3.25.76');
      expect(await installedVersion(appDir, 'json-schema')).toBe('0.4.0');
      expect(
        await installedVersion(
          join(appDir, 'node_modules', '@zero', 'framework'),
          'zod'
        )
      ).toBe('4.2.1');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  },
  120_000
);

async function packFixture(
  rootDir: string,
  name: string,
  version: string,
  dependencies: Record<string, string>,
  bun: LocalArchiveFixtureBun,
): Promise<PackedFixture> {
  const safeName = name.replaceAll('@', '').replaceAll('/', '-');
  const sourceDir = join(rootDir, `${safeName}-${version}`);
  const destination = join(rootDir, 'archives', `${safeName}-${version}`);
  await Promise.all([
    mkdir(sourceDir, { recursive: true }),
    mkdir(destination, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(sourceDir, 'package.json'),
      `${JSON.stringify({ name, version, type: 'module', dependencies }, null, 2)}\n`
    ),
    writeFile(join(sourceDir, 'index.js'), `export const fixtureVersion = ${JSON.stringify(version)};\n`),
  ]);
  await bun.run(sourceDir, [
    'pm',
    'pack',
    '--destination',
    destination,
    '--ignore-scripts',
    '--quiet',
  ]);
  const archiveName = (await readdir(destination)).find((entry) => entry.endsWith('.tgz'));
  if (!archiveName) throw new Error(`No archive created for ${name}@${version}`);
  return { archivePath: join(destination, archiveName), sourceDir };
}

async function installedVersion(projectDir: string, packageName: string): Promise<string> {
  const components = packageName.split('/');
  const packageJson = await Bun.file(
    join(projectDir, 'node_modules', ...components, 'package.json')
  ).json();
  return String(packageJson.version);
}

function packageTuple(lockText: string, packageName: string): string {
  const prefix = `    ${JSON.stringify(packageName)}: [`;
  const line = lockText.split('\n').find((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`Missing ${packageName} package tuple`);
  return line;
}
