/** Real Bun regressions for saved archives, matching root overrides and unchanged workspace peers. */

import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

import { LOCAL_FRAMEWORK_DEPENDENCY } from '../create-zero/local-framework-package';
import { updateZeroProject, ZeroUpdateError } from './run';

interface WorkspaceFixture {
  rootDir: string;
  appDir: string;
  sourceDir: string;
  rootManifest: string;
  peerManifest: string;
  oldVersion: string;
  newVersion: string;
}

for (const override of [false, true]) {
  test(`real Bun updates a workspace peer with ${override ? 'a matching' : 'no'} root override`, async () => {
    const fixture = await createFixture(override);
    try {
      const lockBefore = await Bun.file(join(fixture.appDir, 'bun.lock')).text();
      const result = await updateZeroProject({ projectDir: fixture.appDir, mode: 'local', localFrameworkDir: fixture.sourceDir });
      expect(result.versionAfter).toBe(fixture.newVersion);
      await assertAppPreserved(fixture);
      const lockAfter = await Bun.file(join(fixture.appDir, 'bun.lock')).text();
      const lock = Bun.JSON5.parse(lockAfter) as {
        workspaces: Record<string, { peerDependencies: Record<string, string> }>;
        overrides?: Record<string, string>;
      };
      expect(lock.workspaces['packages/bridge'].peerDependencies['@zero/framework']).toBe(override ? '>=1.0.0-0 <3.0.0' : '*');
      expect(lock.overrides?.['@zero/framework']).toBe(override ? LOCAL_FRAMEWORK_DEPENDENCY : undefined);
      expect(lockAfter).not.toContain('zero-framework-update-');
      expect(lockAfter).not.toContain('"picocolors"');
      expect(lockAfter).toContain('"json-schema"');
      expect(tuple(lockAfter, 'react')).toBe(tuple(lockBefore, 'react'));
      expect(await installedVersion(fixture.appDir)).toBe(fixture.newVersion);
      await bun(join(fixture.appDir, 'packages', 'bridge'), [
        '-e', `import { version } from "@zero/framework"; if (version !== ${JSON.stringify(fixture.newVersion)}) throw new Error("Workspace consumed stale framework");`,
      ]);
      expect(await readdir(join(fixture.appDir, '.zero', 'framework'))).toEqual(['zero-framework.tgz']);
      await bun(fixture.appDir, ['install', '--frozen-lockfile', '--force', '--no-cache', '--ignore-scripts', '--no-progress']);
      expect(await installedVersion(fixture.appDir)).toBe(fixture.newVersion);
      expect(await Bun.file(join(fixture.appDir, 'bun.lock')).text()).toBe(lockAfter);
    } finally {
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  }, 120_000);
}

test('a conflicting root override is rejected before packing, installing or changing archive bytes', async () => {
  const fixture = await createFixture(true);
  try {
    const manifest = JSON.parse(fixture.rootManifest);
    manifest.overrides['@zero/framework'] = 'https://private.example.test/archive?token=DO_NOT_LOG';
    const conflictingManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    await Bun.write(join(fixture.appDir, 'package.json'), conflictingManifest);
    const archiveBefore = await Bun.file(join(fixture.appDir, '.zero', 'framework', 'zero-framework.tgz')).bytes();
    const lockBefore = await Bun.file(join(fixture.appDir, 'bun.lock')).text();
    let operations = 0;
    const failure = await updateZeroProject({ projectDir: fixture.appDir, mode: 'local', localFrameworkDir: fixture.sourceDir }, {
      packLocalFramework: async () => { operations += 1; throw new Error('must not pack'); },
      runCommand: async () => { operations += 1; return { exitCode: 0 }; },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('override must match');
    expect((failure as Error).message).not.toContain('DO_NOT_LOG');
    expect(operations).toBe(0);
    expect(await Bun.file(join(fixture.appDir, 'package.json')).text()).toBe(conflictingManifest);
    expect(await Bun.file(join(fixture.appDir, 'bun.lock')).text()).toBe(lockBefore);
    expect(await Bun.file(join(fixture.appDir, '.zero', 'framework', 'zero-framework.tgz')).bytes()).toEqual(archiveBefore);
    expect(await installedVersion(fixture.appDir)).toBe(fixture.oldVersion);
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
}, 120_000);

for (const failureStage of ['staged-install', 'canonical-manifest', 'verification'] as const) {
  test(`matching override and workspace peer roll back byte-for-byte after ${failureStage} failure`, async () => {
    const fixture = await createFixture(true);
    try {
      const lockBefore = await Bun.file(join(fixture.appDir, 'bun.lock')).text();
      const archiveBefore = await Bun.file(join(fixture.appDir, '.zero', 'framework', 'zero-framework.tgz')).bytes();
      let commands = 0;
      const failure = await updateZeroProject({ projectDir: fixture.appDir, mode: 'local', localFrameworkDir: fixture.sourceDir }, {
        runCommand: async (argv, options) => {
          commands += 1;
          await bun(options.cwd, argv.slice(1));
          if (commands === 2 && failureStage === 'canonical-manifest') {
            const manifest = await Bun.file(join(options.cwd, 'package.json')).json();
            manifest.unrelatedSetting = 'must not be accepted';
            await Bun.write(join(options.cwd, 'package.json'), JSON.stringify(manifest));
          }
          return commands === 1 && failureStage === 'staged-install'
            ? { exitCode: 1, stderr: 'intentional fixture failure after real staging install' }
            : { exitCode: 0 };
        },
        verifyLocalInstall: failureStage === 'verification'
          ? async () => { throw new Error('intentional fixture verification failure'); }
          : undefined,
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ZeroUpdateError);
      expect((failure as ZeroUpdateError).rollbackAttempted).toBe(true);
      expect((failure as ZeroUpdateError).rollbackSucceeded).toBe(true);
      expect(commands).toBe(failureStage === 'staged-install' ? 2 : 3);
      await assertAppPreserved(fixture);
      expect(await Bun.file(join(fixture.appDir, 'bun.lock')).text()).toBe(lockBefore);
      expect(await Bun.file(join(fixture.appDir, '.zero', 'framework', 'zero-framework.tgz')).bytes()).toEqual(archiveBefore);
      expect(await installedVersion(fixture.appDir)).toBe(fixture.oldVersion);
      expect(await readdir(join(fixture.appDir, '.zero', 'framework'))).toEqual(['zero-framework.tgz']);
      expect(await Bun.file(join(fixture.appDir, '.zero-update.lock')).exists()).toBe(false);
    } finally {
      await rm(fixture.rootDir, { recursive: true, force: true });
    }
  }, 120_000);
}

async function createFixture(override: boolean): Promise<WorkspaceFixture> {
  const scratchRoot = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratchRoot, { recursive: true });
  const rootDir = await mkdtemp(join(scratchRoot, 'zero-update-workspace-'));
  try {
    const suffix = crypto.randomUUID().slice(0, 8);
    const oldVersion = `1.0.0-${suffix}`;
    const newVersion = `2.0.0-${suffix}`;
    const oldArchive = await pack(rootDir, oldVersion, { picocolors: '1.1.1' });
    const newArchive = await pack(rootDir, newVersion, { 'json-schema': '0.4.0' });
    const appDir = join(rootDir, 'app');
    const workspaceDir = join(appDir, 'packages', 'bridge');
    const archiveDir = join(appDir, '.zero', 'framework');
    await Promise.all([mkdir(workspaceDir, { recursive: true }), mkdir(archiveDir, { recursive: true })]);
    await copyFile(oldArchive.archivePath, join(archiveDir, 'zero-framework.tgz'));
    const rootManifest = `${JSON.stringify({
      name: 'zero-update-workspace-fixture', private: true, workspaces: ['packages/*'],
      dependencies: { '@zero/framework': LOCAL_FRAMEWORK_DEPENDENCY, react: '19.2.4' },
      ...(override ? { overrides: { '@zero/framework': LOCAL_FRAMEWORK_DEPENDENCY, react: '19.2.4' } } : {}),
    }, null, '\t')}\n\n`;
    const peerManifest = `${JSON.stringify({
      name: '@fixture/bridge', version: '1.0.0',
      peerDependencies: { '@zero/framework': override ? '>=1.0.0-0 <3.0.0' : '*' },
      // Without an override Bun tries the registry for required peers before
      // this updater can run. The optional peer is a valid installed baseline;
      // it still consumes the framework provided by the root dependency.
      ...(override ? {} : { peerDependenciesMeta: { '@zero/framework': { optional: true } } }),
    }, null, 2)}\n`;
    await Promise.all([
      Bun.write(join(appDir, 'package.json'), rootManifest),
      Bun.write(join(workspaceDir, 'package.json'), peerManifest),
      Bun.write(join(appDir, 'bunfig.toml'), '[install]\nlinker = "hoisted"\n'),
      Bun.write(join(appDir, 'user-data-sentinel.txt'), 'app data is untouched\n'),
    ]);
    await bun(appDir, ['install', '--force', '--no-cache', '--ignore-scripts', '--no-progress']);
    return { rootDir, appDir, sourceDir: newArchive.sourceDir, rootManifest, peerManifest, oldVersion, newVersion };
  } catch (error) {
    await rm(rootDir, { recursive: true, force: true });
    throw error;
  }
}

async function pack(rootDir: string, version: string, dependencies: Record<string, string>): Promise<{ archivePath: string; sourceDir: string }> {
  const sourceDir = join(rootDir, `framework-${version}`);
  const archiveDir = join(rootDir, `archives-${version}`);
  await Promise.all([mkdir(sourceDir), mkdir(archiveDir)]);
  await Promise.all([
    Bun.write(join(sourceDir, 'package.json'), JSON.stringify({ name: '@zero/framework', version, type: 'module', dependencies })),
    Bun.write(join(sourceDir, 'index.js'), `export const version = ${JSON.stringify(version)};\n`),
  ]);
  await bun(sourceDir, ['pm', 'pack', '--destination', archiveDir, '--ignore-scripts', '--quiet']);
  const filename = (await readdir(archiveDir)).find((entry) => entry.endsWith('.tgz'));
  if (!filename) throw new Error('Fixture framework archive was not created');
  return { sourceDir, archivePath: join(archiveDir, filename) };
}

async function bun(cwd: string, args: string[]): Promise<void> {
  const child = Bun.spawn(['bun', ...args], { cwd, env: Bun.env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`Fixture bun ${args[0]} failed (${code}):\n${stdout}${stderr}`);
}

async function installedVersion(appDir: string): Promise<string> {
  const manifest = await Bun.file(join(appDir, 'node_modules', '@zero', 'framework', 'package.json')).json();
  return String(manifest.version);
}

async function assertAppPreserved(fixture: WorkspaceFixture): Promise<void> {
  expect(await Bun.file(join(fixture.appDir, 'package.json')).text()).toBe(fixture.rootManifest);
  expect(await Bun.file(join(fixture.appDir, 'packages', 'bridge', 'package.json')).text()).toBe(fixture.peerManifest);
  expect(await Bun.file(join(fixture.appDir, 'bunfig.toml')).text()).toBe('[install]\nlinker = "hoisted"\n');
  expect(await Bun.file(join(fixture.appDir, 'user-data-sentinel.txt')).text()).toBe('app data is untouched\n');
}

function tuple(lock: string, name: string): string {
  const prefix = `    ${JSON.stringify(name)}: [`;
  const entry = lock.split('\n').find((line) => line.startsWith(prefix));
  if (!entry) throw new Error('Expected pinned fixture dependency tuple');
  return entry;
}
