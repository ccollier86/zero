/**
 * run.test.ts
 *
 * Safety regressions for `zero update`. The updater is deliberately exercised
 * through injected package-manager and pack operations so these tests can
 * prove its filesystem boundaries without contacting a registry or running
 * application-owned scripts.
 */

import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { LOCAL_FRAMEWORK_DEPENDENCY } from '../create-zero/local-framework-package';
import { runZeroUpdateCli } from './run';

type UpdateDependencies = NonNullable<Parameters<typeof runZeroUpdateCli>[1]>;

interface TestProject {
  projectDir: string;
  frameworkDir: string;
  archivePath: string;
  packagePath: string;
  lockPath: string;
  appSentinelPath: string;
  dataSentinelPath: string;
}

interface CapturedLogger {
  output: string[];
  logger: NonNullable<UpdateDependencies['logger']>;
}

const LOCAL_UPDATE_COMMAND = [
  'bun',
  'update',
  '@zero/framework',
  '--force',
  '--no-cache',
  '--ignore-scripts',
  '--no-progress',
];

const REGISTRY_UPDATE_COMMAND = [
  'bun',
  'update',
  '@zero/framework',
  '--ignore-scripts',
  '--no-progress',
];

const FROZEN_ROLLBACK_COMMAND = [
  'bun',
  'install',
  '--frozen-lockfile',
  '--force',
  '--no-cache',
  '--ignore-scripts',
  '--no-progress',
];

describe('zero update safety', () => {
  test('refuses a missing project path without creating it or spawning commands', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-missing-'));
    const missingProjectDir = join(rootDir, 'does-not-exist');
    const frameworkDir = await createFrameworkCheckout(rootDir);
    const commands: string[][] = [];
    let packCalls = 0;
    const captured = captureLogger();

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', missingProjectDir, '--local', frameworkDir],
        {
          logger: captured.logger,
          packLocalFramework: async () => {
            packCalls += 1;
            throw new Error('pack must not run');
          },
          runCommand: async (argv) => {
            commands.push([...argv]);
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(await Bun.file(missingProjectDir).exists()).toBe(false);
      expect(packCalls).toBe(0);
      expect(commands).toEqual([]);
      expect(captured.output.join('\n')).toMatch(/project|directory|exist/i);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('refuses a non-project directory without modifying it', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-non-project-'));
    const projectDir = join(rootDir, 'not-a-project');
    const frameworkDir = await createFrameworkCheckout(rootDir);
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'keep.txt'), 'do not touch\n');
    const before = await snapshotTree(projectDir);
    const commands: string[][] = [];

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', projectDir, '--local', frameworkDir],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => {
            throw new Error('pack must not run');
          },
          runCommand: async (argv) => {
            commands.push([...argv]);
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(await snapshotTree(projectDir)).toEqual(before);
      expect(commands).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('refuses a project missing @zero/framework without modifying it', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-no-dependency-'));
    const project = await createProject(rootDir, null);
    const before = await snapshotTree(project.projectDir);
    const commands: string[][] = [];
    let packCalls = 0;

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => {
            packCalls += 1;
            throw new Error('pack must not run');
          },
          runCommand: async (argv) => {
            commands.push([...argv]);
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(await snapshotTree(project.projectDir)).toEqual(before);
      expect(packCalls).toBe(0);
      expect(commands).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('local mode refuses a registry dependency instead of silently changing its source', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-wrong-mode-'));
    const project = await createProject(rootDir, '^1.3.0');
    const before = await snapshotTree(project.projectDir);
    let packCalls = 0;
    const commands: string[][] = [];

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => {
            packCalls += 1;
            throw new Error('pack must not run');
          },
          runCommand: async (argv) => {
            commands.push([...argv]);
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(await snapshotTree(project.projectDir)).toEqual(before);
      expect(packCalls).toBe(0);
      expect(commands).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('refuses a mutating update without a lockfile so rollback stays deterministic', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-no-lock-'));
    const project = await createProject(rootDir);
    await rm(project.lockPath);
    const before = await snapshotTree(project.projectDir);
    let packCalls = 0;
    const commands: string[][] = [];

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => {
            packCalls += 1;
            throw new Error('pack must not run');
          },
          runCommand: async (argv) => {
            commands.push([...argv]);
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(await snapshotTree(project.projectDir)).toEqual(before);
      expect(packCalls).toBe(0);
      expect(commands).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('refuses ambiguous dual Bun lockfiles before packing or spawning commands', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-dual-lock-'));
    const project = await createProject(rootDir);
    await writeFile(join(project.projectDir, 'bun.lockb'), 'legacy binary lock sentinel\n');
    const before = await snapshotTree(project.projectDir);
    let packCalls = 0;
    const commands: string[][] = [];

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => {
            packCalls += 1;
            throw new Error('pack must not run');
          },
          runCommand: async (argv) => {
            commands.push([...argv]);
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(packCalls).toBe(0);
      expect(commands).toEqual([]);
      expect(await snapshotTree(project.projectDir)).toEqual(before);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('refuses a legacy binary lock before a local archive mutation', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-binary-lock-'));
    const project = await createProject(rootDir);
    const lockBytes = await readFile(project.lockPath);
    await rm(project.lockPath);
    await writeFile(join(project.projectDir, 'bun.lockb'), lockBytes);
    const before = await snapshotTree(project.projectDir);
    const captured = captureLogger();
    let packCalls = 0;

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captured.logger,
          packLocalFramework: async () => {
            packCalls += 1;
            throw new Error('pack must not run');
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(packCalls).toBe(0);
      expect(captured.output.join('\n')).toContain('text bun.lock');
      expect(await snapshotTree(project.projectDir)).toEqual(before);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  for (const symlinkTarget of ['package.json', 'bun.lock', 'archive', 'archive-ancestor'] as const) {
    test(`refuses a symlinked ${symlinkTarget} boundary without writing outside the project`, async () => {
      const rootDir = await mkdtemp(join(tmpdir(), `zero-update-symlink-${symlinkTarget}-`));
      const project = await createProject(rootDir);
      const outsidePath = join(rootDir, `outside-${symlinkTarget.replace('.', '-')}`);
      let outsideSentinelPath: string;

      if (symlinkTarget === 'package.json') {
        const packageContents = await readFile(project.packagePath, 'utf8');
        await writeFile(outsidePath, packageContents);
        await rm(project.packagePath);
        await symlink(outsidePath, project.packagePath);
        outsideSentinelPath = outsidePath;
      } else if (symlinkTarget === 'bun.lock') {
        const lockContents = await readFile(project.lockPath, 'utf8');
        await writeFile(outsidePath, lockContents);
        await rm(project.lockPath);
        await symlink(outsidePath, project.lockPath);
        outsideSentinelPath = outsidePath;
      } else if (symlinkTarget === 'archive') {
        await writeFile(outsidePath, 'outside archive must survive\n');
        await rm(project.archivePath);
        await symlink(outsidePath, project.archivePath);
        outsideSentinelPath = outsidePath;
      } else {
        await mkdir(outsidePath, { recursive: true });
        outsideSentinelPath = join(outsidePath, 'zero-framework.tgz');
        await writeFile(outsideSentinelPath, 'outside archive ancestor must survive\n');
        const frameworkCacheDir = join(project.projectDir, '.zero', 'framework');
        await rm(frameworkCacheDir, { recursive: true, force: true });
        await symlink(outsidePath, frameworkCacheDir, 'dir');
      }

      const outsideBefore = await readFile(outsideSentinelPath, 'utf8');
      const projectBefore = await snapshotTree(project.projectDir);
      const commands: string[][] = [];
      let packCalls = 0;

      try {
        const exitCode = await runZeroUpdateCli(
          ['--project', project.projectDir, '--local', project.frameworkDir],
          {
            logger: captureLogger().logger,
            packLocalFramework: async () => {
              packCalls += 1;
              throw new Error('pack must not run');
            },
            runCommand: async (argv) => {
              commands.push([...argv]);
              return { exitCode: 0 };
            },
          }
        );

        expect(exitCode).toBe(1);
        expect(await readFile(outsideSentinelPath, 'utf8')).toBe(outsideBefore);
        expect(await snapshotTree(project.projectDir)).toEqual(projectBefore);
        expect(packCalls).toBe(0);
        expect(commands).toEqual([]);
      } finally {
        await rm(rootDir, { recursive: true, force: true });
      }
    });
  }

  test('dry-run reports a local update without packing, spawning, or editing any file', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-dry-run-'));
    const project = await createProject(rootDir);
    const before = await snapshotTree(project.projectDir);
    let packCalls = 0;
    const commands: string[][] = [];

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir, '--dry-run'],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => {
            packCalls += 1;
            throw new Error('dry-run must not pack');
          },
          runCommand: async (argv) => {
            commands.push([...argv]);
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(0);
      expect(packCalls).toBe(0);
      expect(commands).toEqual([]);
      expect(await snapshotTree(project.projectDir)).toEqual(before);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('dry-run accepts a missing managed archive without creating its directories', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-missing-archive-dry-run-'));
    const project = await createProject(rootDir);
    await rm(join(project.projectDir, '.zero'), { recursive: true, force: true });
    const before = await snapshotTree(project.projectDir);
    const captured = captureLogger();
    let packCalls = 0;
    const commands: string[][] = [];

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir, '--dry-run'],
        {
          logger: captured.logger,
          packLocalFramework: async () => {
            packCalls += 1;
            throw new Error('dry-run must not pack');
          },
          runCommand: async (argv) => {
            commands.push([...argv]);
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(0);
      expect(packCalls).toBe(0);
      expect(commands).toEqual([]);
      expect(captured.output.join('\n')).toContain('Archive:    pending -> pending');
      expect(await snapshotTree(project.projectDir)).toEqual(before);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('creates a missing managed archive and directories during a local update', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-missing-archive-success-'));
    const project = await createProject(rootDir);
    const installedFramework = join(project.projectDir, 'node_modules', '@zero', 'framework');
    await Promise.all([
      rm(join(project.projectDir, '.zero'), { recursive: true, force: true }),
      rm(installedFramework, { recursive: true, force: true }),
    ]);
    const packageBefore = await readFile(project.packagePath, 'utf8');
    const appBefore = await readFile(project.appSentinelPath, 'utf8');
    const dataBefore = await readFile(project.dataSentinelPath, 'utf8');
    const preparedArchive = join(rootDir, 'bootstrap-zero-framework.tgz');
    await writeFile(preparedArchive, 'bootstrapped local framework archive\n');
    const commands: string[][] = [];
    let verifyCalls = 0;

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => ({
            archivePath: preparedArchive,
            cleanup: async () => {},
          }),
          verifyLocalInstall: async (archivePath, projectDir) => {
            verifyCalls += 1;
            expect(archivePath).toBe(await realpath(project.archivePath));
            expect(projectDir).toBe(await realpath(project.projectDir));
          },
          runCommand: async (argv) => {
            commands.push([...argv]);
            await mkdir(installedFramework, { recursive: true });
            await writeFile(
              join(installedFramework, 'package.json'),
              `${JSON.stringify({ name: '@zero/framework', version: '9.9.9' }, null, 2)}\n`
            );
            await simulateResolvedLocalArchive(project);
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(0);
      expect(commands).toEqual([LOCAL_UPDATE_COMMAND, LOCAL_UPDATE_COMMAND]);
      expect(verifyCalls).toBe(1);
      expect(await readFile(project.archivePath, 'utf8')).toBe(
        'bootstrapped local framework archive\n'
      );
      expect(await readFile(project.packagePath, 'utf8')).toBe(packageBefore);
      expect(await readFile(project.appSentinelPath, 'utf8')).toBe(appBefore);
      expect(await readFile(project.dataSentinelPath, 'utf8')).toBe(dataBefore);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('rollback restores a missing archive and managed directories to absence', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-missing-archive-rollback-'));
    const project = await createProject(rootDir);
    const installedFramework = join(project.projectDir, 'node_modules', '@zero', 'framework');
    await Promise.all([
      rm(join(project.projectDir, '.zero'), { recursive: true, force: true }),
      rm(installedFramework, { recursive: true, force: true }),
    ]);
    const before = await snapshotTree(project.projectDir);
    const preparedArchive = join(rootDir, 'failed-bootstrap-zero-framework.tgz');
    await writeFile(preparedArchive, 'failed bootstrapped framework archive\n');
    const commands: string[][] = [];
    const captured = captureLogger();

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captured.logger,
          packLocalFramework: async () => ({
            archivePath: preparedArchive,
            cleanup: async () => {},
          }),
          runCommand: async (argv) => {
            commands.push([...argv]);
            await mkdir(installedFramework, { recursive: true });
            await writeFile(
              join(installedFramework, 'package.json'),
              `${JSON.stringify({ name: '@zero/framework', version: '9.9.9' }, null, 2)}\n`
            );
            await writeFile(project.lockPath, 'failed bootstrap lock state\n');
            return { exitCode: 41, stderr: 'bootstrap install failed' };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(commands).toEqual([LOCAL_UPDATE_COMMAND]);
      expect(captured.output.join('\n')).toContain('The previous framework state was restored.');
      expect(await snapshotTree(project.projectDir)).toEqual(before);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('missing-archive rollback never follows a managed directory replaced by a symlink', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-missing-archive-race-'));
    const project = await createProject(rootDir);
    await rm(join(project.projectDir, '.zero'), { recursive: true, force: true });
    const preparedArchive = join(rootDir, 'raced-bootstrap-zero-framework.tgz');
    const outsideDir = join(rootDir, 'outside-bootstrap-boundary');
    const outsideArchive = join(outsideDir, 'zero-framework.tgz');
    const managedArchiveDir = join(project.projectDir, '.zero', 'framework');
    await Promise.all([
      writeFile(preparedArchive, 'raced bootstrap framework archive\n'),
      mkdir(outsideDir, { recursive: true }),
    ]);
    await writeFile(outsideArchive, 'outside archive must remain unchanged\n');
    const outsideBefore = await snapshotTree(outsideDir);
    const dataBefore = await readFile(project.dataSentinelPath, 'utf8');
    const captured = captureLogger();
    let preservedBackup: string | null = null;

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captured.logger,
          packLocalFramework: async () => ({
            archivePath: preparedArchive,
            cleanup: async () => {},
          }),
          runCommand: async () => {
            await rm(managedArchiveDir, { recursive: true, force: true });
            await symlink(outsideDir, managedArchiveDir, 'dir');
            return { exitCode: 43, stderr: 'simulated bootstrap path race' };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(await snapshotTree(outsideDir)).toEqual(outsideBefore);
      expect(await readFile(project.dataSentinelPath, 'utf8')).toBe(dataBefore);
      const backupMatch = captured.output.join('\n').match(/Recovery backup preserved at ([^\n]+)/);
      expect(backupMatch).not.toBeNull();
      preservedBackup = backupMatch?.[1] ?? null;
    } finally {
      if (preservedBackup) await rm(preservedBackup, { recursive: true, force: true });
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('refuses a second updater while the project update lock exists', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-locked-'));
    const project = await createProject(rootDir);
    const preparedArchive = join(rootDir, 'locked-zero-framework.tgz');
    await writeFile(preparedArchive, 'packed while another updater owns the lock\n');
    await writeFile(join(project.projectDir, '.zero-update.lock'), 'existing updater\n');
    const before = await snapshotTree(project.projectDir);
    const commands: string[][] = [];
    let cleanupCalls = 0;
    const captured = captureLogger();

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captured.logger,
          packLocalFramework: async () => ({
            archivePath: preparedArchive,
            cleanup: async () => {
              cleanupCalls += 1;
            },
          }),
          runCommand: async (argv) => {
            commands.push([...argv]);
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(cleanupCalls).toBe(1);
      expect(commands).toEqual([]);
      expect(captured.output.join('\n')).toMatch(/another update|lock/i);
      expect(await snapshotTree(project.projectDir)).toEqual(before);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('updates only the managed local archive and install state while preserving app-owned files and data', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-local-success-'));
    const project = await createProject(rootDir);
    const treeBefore = await snapshotTree(project.projectDir);
    const packageBefore = await readFile(project.packagePath, 'utf8');
    const appBefore = await readFile(project.appSentinelPath, 'utf8');
    const dataBefore = await readFile(project.dataSentinelPath, 'utf8');
    const preparedArchive = join(rootDir, 'new-zero-framework.tgz');
    await writeFile(preparedArchive, 'new local framework archive\n');
    const commands: string[][] = [];
    let cleanupCalls = 0;
    let verifyCalls = 0;
    const captured = captureLogger();

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captured.logger,
          packLocalFramework: async (frameworkDir) => {
            expect(frameworkDir).toBe(await realpath(project.frameworkDir));
            return {
              archivePath: preparedArchive,
              cleanup: async () => {
                cleanupCalls += 1;
              },
            };
          },
          verifyLocalInstall: async (archivePath, projectDir) => {
            verifyCalls += 1;
            expect(archivePath).toBe(await realpath(project.archivePath));
            expect(projectDir).toBe(await realpath(project.projectDir));
          },
          runCommand: async (argv) => {
            commands.push([...argv]);
            await writeFile(
              join(project.projectDir, 'node_modules', '@zero', 'framework', 'package.json'),
              `${JSON.stringify({ name: '@zero/framework', version: '9.9.9' }, null, 2)}\n`
            );
            await mkdir(join(project.projectDir, 'node_modules', '.cache'), { recursive: true });
            await writeFile(
              join(project.projectDir, 'node_modules', '.cache', 'zero-update'),
              'installed\n'
            );
            await simulateResolvedLocalArchive(project);
            return { exitCode: 0 };
          },
        }
      );

      if (exitCode !== 0) throw new Error(captured.output.join('\n'));
      expect(exitCode).toBe(0);
      expect(commands).toEqual([LOCAL_UPDATE_COMMAND, LOCAL_UPDATE_COMMAND]);
      expect(commands[0]).toContain('--ignore-scripts');
      expect(commands.flat()).not.toContain('migrate:plan');
      expect(commands.flat()).not.toContain('typecheck');
      expect(commands.flat()).not.toContain('doctor');
      expect(cleanupCalls).toBe(1);
      expect(verifyCalls).toBe(1);
      expect(await readFile(project.archivePath, 'utf8')).toBe('new local framework archive\n');
      expect(await readFile(project.packagePath, 'utf8')).toBe(packageBefore);
      expect(await readFile(project.appSentinelPath, 'utf8')).toBe(appBefore);
      expect(await readFile(project.dataSentinelPath, 'utf8')).toBe(dataBefore);
      expect(projectOwnedSnapshot(await snapshotTree(project.projectDir))).toEqual(
        projectOwnedSnapshot(treeBefore)
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('atomically restores the archive, package manifest, and lockfile after install failure', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-install-rollback-'));
    const project = await createProject(rootDir);
    const treeBefore = await snapshotTree(project.projectDir);
    const packageBefore = await readFile(project.packagePath, 'utf8');
    const lockBefore = await readFile(project.lockPath, 'utf8');
    const archiveBefore = await readFile(project.archivePath, 'utf8');
    const dataBefore = await readFile(project.dataSentinelPath, 'utf8');
    const preparedArchive = join(rootDir, 'failed-zero-framework.tgz');
    await writeFile(preparedArchive, 'new archive that must roll back\n');
    const commands: string[][] = [];
    let cleanupCalls = 0;
    let exactRestoreObserved = false;

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => ({
            archivePath: preparedArchive,
            cleanup: async () => {
              cleanupCalls += 1;
            },
          }),
          runCommand: async (argv) => {
            commands.push([...argv]);
            if (commands.length === 1) {
              await writeFile(
                project.packagePath,
                packageBefore.replace('safety fixture', 'mutated by failed install')
              );
              await writeFile(project.lockPath, 'mutated lock from failed install\n');
              return { exitCode: 23, stderr: 'install failed' };
            }

            exactRestoreObserved =
              (await readFile(project.packagePath, 'utf8')) === packageBefore &&
              (await readFile(project.lockPath, 'utf8')) === lockBefore &&
              (await readFile(project.archivePath, 'utf8')) === archiveBefore;
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(commands).toEqual([LOCAL_UPDATE_COMMAND, FROZEN_ROLLBACK_COMMAND]);
      expect(commands.every((command) => command.includes('--ignore-scripts'))).toBe(true);
      expect(exactRestoreObserved).toBe(true);
      expect(cleanupCalls).toBe(1);
      expect(await readFile(project.packagePath, 'utf8')).toBe(packageBefore);
      expect(await readFile(project.lockPath, 'utf8')).toBe(lockBefore);
      expect(await readFile(project.archivePath, 'utf8')).toBe(archiveBefore);
      expect(await readFile(project.dataSentinelPath, 'utf8')).toBe(dataBefore);
      expect(await snapshotTree(project.projectDir)).toEqual(treeBefore);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('rolls back when the canonical install changes the freshly resolved lock', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-canonical-lock-drift-'));
    const project = await createProject(rootDir);
    const treeBefore = await snapshotTree(project.projectDir);
    const packageBefore = await readFile(project.packagePath, 'utf8');
    const lockBefore = await readFile(project.lockPath, 'utf8');
    const archiveBefore = await readFile(project.archivePath, 'utf8');
    const preparedArchive = join(rootDir, 'canonical-lock-drift-framework.tgz');
    await writeFile(preparedArchive, 'framework paired with drifting canonical lock\n');
    const commands: string[][] = [];
    let exactRestoreObserved = false;

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => ({
            archivePath: preparedArchive,
            cleanup: async () => {},
          }),
          verifyLocalInstall: async () => {},
          runCommand: async (argv) => {
            commands.push([...argv]);
            if (commands.length === 1) {
              await writeFile(
                join(project.projectDir, 'node_modules', '@zero', 'framework', 'package.json'),
                `${JSON.stringify({ name: '@zero/framework', version: '9.9.9' }, null, 2)}\n`
              );
              await simulateResolvedLocalArchive(project);
              return { exitCode: 0 };
            }
            if (commands.length === 2) {
              await writeFile(project.lockPath, 'unexpected canonical lock drift\n');
              return { exitCode: 0 };
            }

            exactRestoreObserved =
              (await readFile(project.packagePath, 'utf8')) === packageBefore &&
              (await readFile(project.lockPath, 'utf8')) === lockBefore &&
              (await readFile(project.archivePath, 'utf8')) === archiveBefore;
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(commands).toEqual([
        LOCAL_UPDATE_COMMAND,
        LOCAL_UPDATE_COMMAND,
        FROZEN_ROLLBACK_COMMAND,
      ]);
      expect(exactRestoreObserved).toBe(true);
      expect(await snapshotTree(project.projectDir)).toEqual(treeBefore);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('rollback removes a framework install that did not exist before the update', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-missing-install-rollback-'));
    const project = await createProject(rootDir);
    const installedFramework = join(project.projectDir, 'node_modules', '@zero', 'framework');
    await rm(installedFramework, { recursive: true, force: true });
    const treeBefore = await snapshotTree(project.projectDir);
    const preparedArchive = join(rootDir, 'missing-install-zero-framework.tgz');
    await writeFile(preparedArchive, 'new archive that must roll back\n');
    const commands: string[][] = [];

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => ({
            archivePath: preparedArchive,
            cleanup: async () => {},
          }),
          runCommand: async (argv) => {
            commands.push([...argv]);
            if (commands.length === 1) {
              await mkdir(installedFramework, { recursive: true });
              await writeFile(
                join(installedFramework, 'package.json'),
                `${JSON.stringify({ name: '@zero/framework', version: '9.9.9' }, null, 2)}\n`
              );
              await writeFile(project.lockPath, 'failed install from absent state\n');
              return { exitCode: 29, stderr: 'simulated install failure' };
            }
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(commands).toEqual([LOCAL_UPDATE_COMMAND, FROZEN_ROLLBACK_COMMAND]);
      expect(await Bun.file(join(installedFramework, 'package.json')).exists()).toBe(false);
      expect(await snapshotTree(project.projectDir)).toEqual(treeBefore);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('detects and rolls back unrelated package.json edits made by the package manager', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-manifest-scope-'));
    const project = await createProject(rootDir);
    const treeBefore = await snapshotTree(project.projectDir);
    const packageBefore = await readFile(project.packagePath, 'utf8');
    const lockBefore = await readFile(project.lockPath, 'utf8');
    const archiveBefore = await readFile(project.archivePath, 'utf8');
    const preparedArchive = join(rootDir, 'manifest-scope-zero-framework.tgz');
    await writeFile(preparedArchive, 'archive paired with an invalid manifest edit\n');
    const commands: string[][] = [];
    let exactRestoreObserved = false;

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => ({
            archivePath: preparedArchive,
            cleanup: async () => {},
          }),
          verifyLocalInstall: async () => {},
          runCommand: async (argv) => {
            commands.push([...argv]);
            if (commands.length === 1) {
              const mutatedPackage = JSON.parse(packageBefore) as Record<string, unknown>;
              mutatedPackage.unrelatedPackageManagerEdit = 'must be rejected';
              await writeFile(project.packagePath, `${JSON.stringify(mutatedPackage, null, 2)}\n`);
              await writeFile(project.lockPath, 'lock paired with invalid manifest edit\n');
              return { exitCode: 0 };
            }

            exactRestoreObserved =
              (await readFile(project.packagePath, 'utf8')) === packageBefore &&
              (await readFile(project.lockPath, 'utf8')) === lockBefore &&
              (await readFile(project.archivePath, 'utf8')) === archiveBefore;
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(commands).toEqual([LOCAL_UPDATE_COMMAND, FROZEN_ROLLBACK_COMMAND]);
      expect(exactRestoreObserved).toBe(true);
      expect(await snapshotTree(project.projectDir)).toEqual(treeBefore);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('never follows a managed archive ancestor symlink introduced after the update starts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-raced-symlink-'));
    const project = await createProject(rootDir);
    const preparedArchive = join(rootDir, 'raced-zero-framework.tgz');
    const outsideDir = join(rootDir, 'outside-managed-boundary');
    const outsideArchive = join(outsideDir, 'zero-framework.tgz');
    const outsideData = join(outsideDir, 'production.sqlite');
    const managedArchiveDir = join(project.projectDir, '.zero', 'framework');
    await writeFile(preparedArchive, 'new archive before raced symlink\n');
    await mkdir(outsideDir, { recursive: true });
    await Promise.all([
      writeFile(outsideArchive, 'outside archive must never be overwritten\n'),
      writeFile(outsideData, 'outside production data must never be touched\n'),
    ]);
    const outsideBefore = await snapshotTree(outsideDir);
    const dataBefore = await readFile(project.dataSentinelPath, 'utf8');
    const commands: string[][] = [];
    const captured = captureLogger();
    let preservedBackup: string | null = null;

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir],
        {
          logger: captured.logger,
          packLocalFramework: async () => ({
            archivePath: preparedArchive,
            cleanup: async () => {},
          }),
          verifyLocalInstall: async () => {},
          runCommand: async (argv) => {
            commands.push([...argv]);
            if (commands.length === 1) {
              await rm(managedArchiveDir, { recursive: true, force: true });
              await symlink(outsideDir, managedArchiveDir, 'dir');
              return { exitCode: 31, stderr: 'simulated install race' };
            }
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(commands[0]).toEqual(LOCAL_UPDATE_COMMAND);
      expect(commands.every((command) => command.includes('--ignore-scripts'))).toBe(true);
      expect(await snapshotTree(outsideDir)).toEqual(outsideBefore);
      expect(await readFile(project.dataSentinelPath, 'utf8')).toBe(dataBefore);
      const backupMatch = captured.output.join('\n').match(/Recovery backup preserved at ([^\n]+)/);
      expect(backupMatch).not.toBeNull();
      preservedBackup = backupMatch?.[1] ?? null;
    } finally {
      if (preservedBackup) await rm(preservedBackup, { recursive: true, force: true });
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('--check rolls back when doctor fails and never invokes migration or app commands', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-check-rollback-'));
    const project = await createProject(rootDir);
    const treeBefore = await snapshotTree(project.projectDir);
    const packageBefore = await readFile(project.packagePath, 'utf8');
    const lockBefore = await readFile(project.lockPath, 'utf8');
    const archiveBefore = await readFile(project.archivePath, 'utf8');
    const dataBefore = await readFile(project.dataSentinelPath, 'utf8');
    const preparedArchive = join(rootDir, 'verification-zero-framework.tgz');
    await writeFile(preparedArchive, 'archive rejected by verification\n');
    const commands: string[][] = [];
    let exactRestoreObserved = false;

    try {
      const exitCode = await runZeroUpdateCli(
        ['--project', project.projectDir, '--local', project.frameworkDir, '--check'],
        {
          logger: captureLogger().logger,
          packLocalFramework: async () => ({
            archivePath: preparedArchive,
            cleanup: async () => {},
          }),
          verifyLocalInstall: async () => {},
          runCommand: async (argv) => {
            commands.push([...argv]);
            if (commands.length === 1) {
              await writeFile(
                join(project.projectDir, 'node_modules', '@zero', 'framework', 'package.json'),
                `${JSON.stringify({ name: '@zero/framework', version: '9.9.9' }, null, 2)}\n`
              );
              await simulateResolvedLocalArchive(project);
              return { exitCode: 0 };
            }
            if (commands.length === 2) return { exitCode: 0 };
            if (argv.join(' ') === 'bun run typecheck') return { exitCode: 0 };
            if (argv.join(' ') === 'bun run doctor') {
              return { exitCode: 9, stderr: 'doctor rejected update' };
            }

            exactRestoreObserved =
              (await readFile(project.packagePath, 'utf8')) === packageBefore &&
              (await readFile(project.lockPath, 'utf8')) === lockBefore &&
              (await readFile(project.archivePath, 'utf8')) === archiveBefore;
            return { exitCode: 0 };
          },
        }
      );

      expect(exitCode).toBe(1);
      expect(commands).toEqual([
        LOCAL_UPDATE_COMMAND,
        LOCAL_UPDATE_COMMAND,
        ['bun', 'run', 'typecheck'],
        ['bun', 'run', 'doctor'],
        FROZEN_ROLLBACK_COMMAND,
      ]);
      expect(commands.flat()).not.toContain('migrate');
      expect(commands.flat()).not.toContain('migrate:plan');
      expect(exactRestoreObserved).toBe(true);
      expect(await readFile(project.packagePath, 'utf8')).toBe(packageBefore);
      expect(await readFile(project.lockPath, 'utf8')).toBe(lockBefore);
      expect(await readFile(project.archivePath, 'utf8')).toBe(archiveBefore);
      expect(await readFile(project.dataSentinelPath, 'utf8')).toBe(dataBefore);
      expect(await snapshotTree(project.projectDir)).toEqual(treeBefore);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('registry mode scopes Bun update to @zero/framework and disables dependency scripts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-registry-'));
    const project = await createProject(rootDir, '^1.3.0');
    const commands: string[][] = [];
    let packCalls = 0;

    try {
      const exitCode = await runZeroUpdateCli(['--project', project.projectDir], {
        logger: captureLogger().logger,
        packLocalFramework: async () => {
          packCalls += 1;
          throw new Error('registry mode must not pack');
        },
        runCommand: async (argv) => {
          commands.push([...argv]);
          return { exitCode: 0 };
        },
      });

      expect(exitCode).toBe(0);
      expect(packCalls).toBe(0);
      expect(commands).toEqual([REGISTRY_UPDATE_COMMAND]);
      expect(commands[0]).toContain('@zero/framework');
      expect(commands[0]).toContain('--ignore-scripts');
      expect(commands[0]).not.toContain('migrate');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('registry mode accepts a compound semver range but refuses path, URL, and Git sources', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-registry-specs-'));
    const accepted = await createProject(rootDir, '>=1.3.0 <2.0.0');
    const acceptedCommands: string[][] = [];

    try {
      const acceptedExit = await runZeroUpdateCli([`--project=${accepted.projectDir}`], {
        logger: captureLogger().logger,
        runCommand: async (argv) => {
          acceptedCommands.push([...argv]);
          return { exitCode: 0 };
        },
      });
      expect(acceptedExit).toBe(0);
      expect(acceptedCommands).toEqual([REGISTRY_UPDATE_COMMAND]);

      for (const [index, specifier] of [
        'owner/repository',
        'ssh://git.example/zero.git',
        'git@example:zero.git',
        'https://example.test/zero.tgz',
        'file:../zero.tgz',
      ].entries()) {
        const unsafeRoot = join(rootDir, `unsafe-${index}`);
        await mkdir(unsafeRoot, { recursive: true });
        const unsafe = await createProject(unsafeRoot, specifier);
        const commands: string[][] = [];
        const before = await snapshotTree(unsafe.projectDir);
        const exitCode = await runZeroUpdateCli(['--project', unsafe.projectDir], {
          logger: captureLogger().logger,
          runCommand: async (argv) => {
            commands.push([...argv]);
            return { exitCode: 0 };
          },
        });
        expect(exitCode).toBe(1);
        expect(commands).toEqual([]);
        expect(await snapshotTree(unsafe.projectDir)).toEqual(before);
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('registry failure restores exact state with a frozen, script-free install', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-registry-rollback-'));
    const project = await createProject(rootDir, '^1.3.0');
    const treeBefore = await snapshotTree(project.projectDir);
    const packageBefore = await readFile(project.packagePath, 'utf8');
    const lockBefore = await readFile(project.lockPath, 'utf8');
    const commands: string[][] = [];
    let exactRestoreObserved = false;

    try {
      const exitCode = await runZeroUpdateCli(['--project', project.projectDir], {
        logger: captureLogger().logger,
        runCommand: async (argv) => {
          commands.push([...argv]);
          if (commands.length === 1) {
            const mutatedPackage = JSON.parse(packageBefore) as {
              dependencies: Record<string, string>;
            };
            mutatedPackage.dependencies['@zero/framework'] = '^9.9.9';
            await writeFile(project.packagePath, `${JSON.stringify(mutatedPackage, null, 2)}\n`);
            await writeFile(project.lockPath, 'failed registry update lock\n');
            await writeFile(
              join(project.projectDir, 'node_modules', '@zero', 'framework', 'package.json'),
              `${JSON.stringify({ name: '@zero/framework', version: '9.9.9' }, null, 2)}\n`
            );
            return { exitCode: 47, stderr: 'simulated registry failure' };
          }

          exactRestoreObserved =
            (await readFile(project.packagePath, 'utf8')) === packageBefore &&
            (await readFile(project.lockPath, 'utf8')) === lockBefore;
          return { exitCode: 0 };
        },
      });

      expect(exitCode).toBe(1);
      expect(commands).toEqual([
        REGISTRY_UPDATE_COMMAND,
        FROZEN_ROLLBACK_COMMAND,
      ]);
      expect(commands.every((command) => command.includes('--ignore-scripts'))).toBe(true);
      expect(exactRestoreObserved).toBe(true);
      expect(await snapshotTree(project.projectDir)).toEqual(treeBefore);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('rejects conflicting source and verification flags before doing work', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-update-conflicts-'));
    const frameworkDir = await createFrameworkCheckout(rootDir);

    try {
      for (const args of [
        ['--local', frameworkDir, '--latest'],
        ['--check', '--skip-checks'],
      ]) {
        const captured = captureLogger();
        let packCalls = 0;
        const commands: string[][] = [];
        const exitCode = await runZeroUpdateCli(args, {
          cwd: () => rootDir,
          logger: captured.logger,
          packLocalFramework: async () => {
            packCalls += 1;
            throw new Error('pack must not run');
          },
          runCommand: async (argv) => {
            commands.push([...argv]);
            return { exitCode: 0 };
          },
        });

        expect(exitCode).toBe(1);
        expect(packCalls).toBe(0);
        expect(commands).toEqual([]);
        expect(captured.output.join('\n')).toMatch(/cannot|conflict|together/i);
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('prints help without inspecting, packing, or updating a project', async () => {
    const captured = captureLogger();
    let cwdCalls = 0;
    let packCalls = 0;
    const commands: string[][] = [];

    const exitCode = await runZeroUpdateCli(['--help'], {
      cwd: () => {
        cwdCalls += 1;
        return '/path/that/does/not/exist';
      },
      logger: captured.logger,
      packLocalFramework: async () => {
        packCalls += 1;
        throw new Error('pack must not run');
      },
      runCommand: async (argv) => {
        commands.push([...argv]);
        return { exitCode: 0 };
      },
    });

    expect(exitCode).toBe(0);
    expect(cwdCalls).toBe(0);
    expect(packCalls).toBe(0);
    expect(commands).toEqual([]);
    expect(captured.output.join('\n')).toContain('Usage: zero update');
    expect(captured.output.join('\n')).toContain('--dry-run');
    expect(captured.output.join('\n')).toContain('--check');
    expect(captured.output.join('\n')).toContain('creates a missing managed .zero/framework cache');
  });
});

async function createProject(
  rootDir: string,
  zeroDependency: string | null = LOCAL_FRAMEWORK_DEPENDENCY
): Promise<TestProject> {
  const projectDir = join(rootDir, 'app');
  const frameworkDir = await createFrameworkCheckout(rootDir);
  const archivePath = join(projectDir, '.zero', 'framework', 'zero-framework.tgz');
  const packagePath = join(projectDir, 'package.json');
  const lockPath = join(projectDir, 'bun.lock');
  const appSentinelPath = join(projectDir, 'app', 'page.tsx');
  const dataSentinelPath = join(projectDir, 'data', 'production.sqlite');

  await Promise.all([
    mkdir(join(projectDir, '.zero', 'framework'), { recursive: true }),
    mkdir(join(projectDir, 'app'), { recursive: true }),
    mkdir(join(projectDir, 'data'), { recursive: true }),
    mkdir(join(projectDir, 'node_modules', '@zero', 'framework'), { recursive: true }),
  ]);

  const dependencies = zeroDependency ? { '@zero/framework': zeroDependency, react: '^19.0.0' } : {
    react: '^19.0.0',
  };
  await writeFile(
    packagePath,
    `${JSON.stringify(
      {
        name: 'zero-update-safety-fixture',
        private: true,
        description: 'safety fixture',
        scripts: {
          typecheck: 'tsc --noEmit',
          doctor: 'zero doctor',
          'migrate:plan': 'zero migrate --dry-run',
          deploy: 'dangerous-deploy-command',
        },
        dependencies,
      },
      null,
      2
    )}\n`
  );
  await Promise.all([
    writeFile(
      lockPath,
      [
        '{',
        '  "packages": {',
        '    "@zero/framework": ["@zero/framework@./.zero/framework/zero-framework.tgz", {}, "sha512-b2xk"],',
        '    "react": ["react@19.0.0", "", {}, "sha512-a2VlcA=="]',
        '  }',
        '}',
        '',
      ].join('\n')
    ),
    writeFile(archivePath, 'original local framework archive\n'),
    writeFile(appSentinelPath, 'export default function Page() { return <main>keep me</main>; }\n'),
    writeFile(dataSentinelPath, 'production-like data: never execute migrations\n'),
    writeFile(join(projectDir, '.env'), 'APP_SECRET=must-stay-unchanged\n'),
    writeFile(join(projectDir, 'zero.config.ts'), 'export default { migrate: false };\n'),
    writeFile(
      join(projectDir, 'node_modules', '@zero', 'framework', 'package.json'),
      `${JSON.stringify({ name: '@zero/framework', version: '1.3.0' }, null, 2)}\n`
    ),
  ]);

  return {
    projectDir,
    frameworkDir,
    archivePath,
    packagePath,
    lockPath,
    appSentinelPath,
    dataSentinelPath,
  };
}

async function createFrameworkCheckout(rootDir: string): Promise<string> {
  const frameworkDir = join(rootDir, 'zero-framework-source');
  await mkdir(frameworkDir, { recursive: true });
  await writeFile(
    join(frameworkDir, 'package.json'),
    `${JSON.stringify({ name: '@zero/framework', version: '9.9.9' }, null, 2)}\n`
  );
  return frameworkDir;
}

async function simulateResolvedLocalArchive(project: TestProject): Promise<void> {
  const packageJson = JSON.parse(await readFile(project.packagePath, 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const stagedSpecifier = packageJson.dependencies['@zero/framework'];
  if (stagedSpecifier === LOCAL_FRAMEWORK_DEPENDENCY) return;
  if (!stagedSpecifier.startsWith('file:./.zero/framework/zero-framework-update-')) {
    throw new Error(`Expected staged framework specifier, found ${stagedSpecifier}`);
  }
  const stagedResolution = stagedSpecifier.slice('file:'.length);
  await writeFile(
    project.lockPath,
    [
      '{',
      '  "workspaces": {',
      '    "": {',
      '      "dependencies": {',
      `        "@zero/framework": ${JSON.stringify(stagedSpecifier)},`,
      '        "react": "^19.0.0"',
      '      }',
      '    }',
      '  },',
      '  "packages": {',
      `    "@zero/framework": ["@zero/framework@${stagedResolution}", {}, "sha512-b2xk"],`,
      '    "react": ["react@19.0.0", "", {}, "sha512-a2VlcA=="]',
      '  }',
      '}',
      '',
    ].join('\n')
  );
}

function captureLogger(): CapturedLogger {
  const output: string[] = [];
  return {
    output,
    logger: {
      log: (...values: unknown[]) => output.push(values.map(String).join(' ')),
      error: (...values: unknown[]) => output.push(values.map(String).join(' ')),
    },
  };
}

async function snapshotTree(rootDir: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};

  async function visit(path: string): Promise<void> {
    const info = await lstat(path);
    const key = relative(rootDir, path) || '.';
    if (info.isSymbolicLink()) {
      snapshot[key] = `symlink:${await readlink(path)}`;
      return;
    }
    if (info.isDirectory()) {
      snapshot[`${key}/`] = 'directory';
      const entries = (await readdir(path)).sort();
      for (const entry of entries) await visit(join(path, entry));
      return;
    }
    snapshot[key] = `file:${Buffer.from(await readFile(path)).toString('base64')}`;
  }

  await visit(rootDir);
  return snapshot;
}

function projectOwnedSnapshot(snapshot: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(snapshot).filter(([path]) => {
      if (path === 'bun.lock' || path === 'bun.lockb') return false;
      if (path === '.zero/framework/zero-framework.tgz') return false;
      if (path === 'node_modules/' || path.startsWith('node_modules/')) return false;
      return true;
    })
  );
}
