/**
 * scaffold.test.ts
 *
 * Verifies create-zero project generation. These tests exercise filesystem
 * output, generated package metadata, and public package imports. The packed
 * package runtime boundary is exercised by package-distribution.test.ts.
 */

import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { scaffoldZeroApp } from './scaffold';
import { buildZeroApp } from '../build/build-app';

async function createTempRoot(): Promise<string> {
  const baseDir = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(join(baseDir, 'test-create-zero-'));
}

describe('scaffoldZeroApp', () => {
  test('creates a package-mode app that builds through public imports', async () => {
    const rootDir = await createTempRoot();
    const targetDir = join(rootDir, 'acme-crm');
    const outdir = join(rootDir, 'build');

    try {
      const result = await scaffoldZeroApp({
        targetDir,
        packageName: 'acme-crm',
        zeroDependency: 'file:../zero-framework',
      });

      expect(result.packageName).toBe('acme-crm');
      expect(result.filesWritten).toContain('zero.config.ts');
      expect(result.filesWritten).toContain('app/page.tsx');
      expect(result.filesWritten).toContain('app/layout.tsx');
      expect(result.filesWritten).toContain('db/schema.ts');
      expect(result.filesWritten).toContain('tsconfig.json');
      expect(result.filesWritten).toContain('.gitignore');
      await expect(stat(join(targetDir, 'components')).then((value) => value.isDirectory())).resolves.toBe(true);
      await expect(stat(join(targetDir, 'hooks')).then((value) => value.isDirectory())).resolves.toBe(true);
      await expect(stat(join(targetDir, 'lib')).then((value) => value.isDirectory())).resolves.toBe(true);
      await expect(stat(join(targetDir, 'server', 'plugins')).then((value) => value.isDirectory())).resolves.toBe(true);
      await expect(stat(join(targetDir, 'server', 'middleware')).then((value) => value.isDirectory())).resolves.toBe(true);
      await expect(stat(join(targetDir, 'server', 'endpoints')).then((value) => value.isDirectory())).resolves.toBe(true);
      await expect(stat(join(targetDir, 'server', 'resources')).then((value) => value.isDirectory())).resolves.toBe(true);

      const packageJson = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
        scripts: Record<string, string>;
      };
      expect(packageJson.dependencies['@zero/framework']).toBe('file:../zero-framework');
      expect(packageJson.scripts.doctor).toBe('zero doctor --config ./zero.config.ts');
      expect(packageJson.scripts.build).toBe('zero build --config ./zero.config.ts --entry ./app/server.ts --outdir ./dist');
      expect(packageJson.scripts.migrate)
        .toBe('zero migrate --db ./data/zero.system.db');
      expect(packageJson.scripts['migrate:status'])
        .toBe('zero migrate --status --db ./data/zero.system.db');
      expect(packageJson.scripts['migrate:plan'])
        .toBe('zero migrate --plan --schema ./db/schema.ts --db ./data/app.db');
      expect(packageJson.scripts['pdf:install']).toBe('zero pdf install');
      expect(packageJson.scripts['pdf:status']).toBe('zero pdf status');

      const generatedConfig = await readFile(join(targetDir, 'zero.config.ts'), 'utf8');
      expect(generatedConfig).toContain('systemDb: resolveSystemDatabaseConfig()');
      expect(generatedConfig).toContain("'./data/zero.system.db'");
      const generatedEnv = await readFile(join(targetDir, '.env.example'), 'utf8');
      expect(generatedEnv).toContain('SYSTEM_DB_MODE=file');
      expect(generatedEnv).toContain('SYSTEM_DB_PATH=./data/zero.system.db');
      expect(generatedEnv).toContain('SYSTEM_DB_SNAPSHOT_PATH=');

      const tsconfig = JSON.parse(await readFile(join(targetDir, 'tsconfig.json'), 'utf8')) as {
        compilerOptions: {
          paths: Record<string, string[]>;
          preserveSymlinks: boolean;
        };
      };
      expect(tsconfig.compilerOptions.preserveSymlinks).toBe(true);
      expect(tsconfig.compilerOptions.paths['@app/*']).toEqual(['./app/*']);
      expect(tsconfig.compilerOptions.paths['@/components/*'])
        .toEqual(['./components/*']);
      expect(tsconfig.compilerOptions.paths['@/hooks/*'])
        .toEqual(['./hooks/*']);
      expect(tsconfig.compilerOptions.paths['@/lib/*'])
        .toEqual(['./lib/*']);
      expect(JSON.stringify(tsconfig.compilerOptions.paths))
        .not.toContain('node_modules/@zero/framework/src');
      expect(tsconfig.compilerOptions.paths.react).toEqual(['./node_modules/@types/react']);

      const gitignore = await readFile(join(targetDir, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.zero');
      expect(gitignore).toContain('*.db-wal');
      expect(gitignore).toContain('*.db-journal');
      expect(gitignore).toContain('*.sqlite');
      expect(gitignore).toContain('*.sqlite-wal');
      expect(gitignore).toContain('*.sqlite-shm');
      expect(gitignore).toContain('*.sqlite-journal');

      const readme = await readFile(join(targetDir, 'README.md'), 'utf8');
      expect(readme).toContain('cp .env.example .env');
      expect(readme).toContain('node_modules/@zero/framework/docs/start-here.md');
      expect(readme).toContain('server/middleware/');
      expect(readme).toContain('package saved from committed local `main`');
      expect(readme).toContain('zero update --project . --local');
      expect(readme).toContain("it never\npacks the checkout's live working tree");
      expect(readme).toContain('Zero-owned state and application data always use separate SQLite planes');
      expect(readme).toContain('`migrate:plan` targets the application database');

      await linkFrameworkPackage(targetDir);

      const build = await buildZeroApp({
        configPath: join(targetDir, 'zero.config.ts'),
        entryPath: './app/server.ts',
        outDir: outdir,
      });
      expect(await Bun.file(build.serverPath).exists()).toBe(true);
      expect(build.publicAssetCount).toBeGreaterThan(0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  test('rejects non-empty target directories unless force is enabled', async () => {
    const rootDir = await createTempRoot();
    const targetDir = join(rootDir, 'existing');

    try {
      await mkdir(targetDir, { recursive: true });
      await writeFile(join(targetDir, 'README.md'), 'existing\n');
      await writeFile(join(targetDir, 'stale.txt'), 'delete me\n');

      await expect(scaffoldZeroApp({ targetDir })).rejects.toThrow('Target directory is not empty');

      await expect(scaffoldZeroApp({ targetDir, force: true })).resolves.toMatchObject({
        packageName: 'existing',
      });
      expect(await Bun.file(join(targetDir, 'stale.txt')).exists()).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

async function linkFrameworkPackage(targetDir: string): Promise<void> {
  const scopeDir = join(targetDir, 'node_modules/@zero');
  await mkdir(scopeDir, { recursive: true });
  await symlink(process.cwd(), join(scopeDir, 'framework'), 'dir');
  // Simulate the app-owned peer dependencies that a real scaffold install
  // provides, instead of relying on a fixture nested beneath repo node_modules.
  for (const dependency of ['react', 'react-dom']) {
    await symlink(join(process.cwd(), 'node_modules', dependency), join(targetDir, 'node_modules', dependency), 'dir');
  }
}
