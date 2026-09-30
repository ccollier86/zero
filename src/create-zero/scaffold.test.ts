/**
 * scaffold.test.ts
 *
 * Verifies create-zero project generation. These tests exercise filesystem
 * output, generated package metadata, and one outside-source-tree runtime
 * smoke path for the package-mode starter.
 */

import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { LOCAL_FRAMEWORK_DEPENDENCY } from './local-framework-package';
import { runCreateZeroCli } from './run';
import { scaffoldZeroApp } from './scaffold';

async function createTempRoot(): Promise<string> {
  const baseDir = join(process.cwd(), '.zero');
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(join(baseDir, 'test-create-zero-'));
}

describe('scaffoldZeroApp', () => {
  test('create-zero --local installs a publish-style framework archive', async () => {
    const rootDir = await createTempRoot();
    const targetDir = join(rootDir, 'local-app');

    try {
      const exitCode = await runCreateZeroCli([targetDir, '--local']);
      expect(exitCode).toBe(0);

      const packageJson = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
      };

      expect(packageJson.dependencies['@zero/framework']).toBe(LOCAL_FRAMEWORK_DEPENDENCY);
      await expect(
        stat(join(targetDir, '.zero/framework/zero-framework.tgz')).then((value) => value.isFile())
      ).resolves.toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

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

      const build = await Bun.build({
        entrypoints: [join(targetDir, 'app/server.ts')],
        outdir,
        target: 'bun',
      });
      expect(build.success).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  test('generated app starts outside the framework source tree', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-outside-app-'));
    const targetDir = join(rootDir, 'outside-zero-app');

    try {
      await scaffoldZeroApp({
        targetDir,
        packageName: 'outside-zero-app',
        zeroDependency: `file:${process.cwd()}`,
      });
      await linkRuntimeDependencies(targetDir);
      await writeOutsideTreeSmokeTest(targetDir);

      const proc = Bun.spawn({
        cmd: ['bun', 'zero-smoke.ts'],
        cwd: targetDir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...Bun.env,
          NODE_ENV: 'test',
          RESEND_API_KEY: '',
          OPENAI_API_KEY: '',
          ANTHROPIC_API_KEY: '',
          GEMINI_API_KEY: '',
          GOOGLE_API_KEY: '',
          GROQ_API_KEY: '',
          META_LLAMA_API_KEY: '',
          LLAMA_API_KEY: '',
          ZERO_VECTOR_ENABLED: 'false',
        },
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

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
}

async function linkRuntimeDependencies(targetDir: string): Promise<void> {
  await linkFrameworkPackage(targetDir);
  await Promise.all([
    linkPackageDependency(targetDir, 'elysia'),
    linkPackageDependency(targetDir, 'react'),
    linkPackageDependency(targetDir, 'react-dom'),
  ]);
}

async function linkPackageDependency(targetDir: string, packageName: string): Promise<void> {
  const source = join(process.cwd(), 'node_modules', ...packageName.split('/'));
  const target = join(targetDir, 'node_modules', ...packageName.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await symlink(source, target, 'dir');
}

async function writeOutsideTreeSmokeTest(targetDir: string): Promise<void> {
  await writeFile(join(targetDir, 'zero-smoke.ts'), `import { createApp } from '@zero/framework/server';
import config from './zero.config';

async function readText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const app = await createApp({
  ...config,
  db: { mode: 'ephemeral' },
  auth: false,
  stateSync: false,
  email: false,
  ai: false,
  vector: false,
  migrate: false,
  outDir: './custom-build',
  generatedDir: './.zero/generated',
});

try {
  const health = await app.handle(new Request('http://localhost/api/health'));
  if (health.status !== 200) {
    throw new Error(\`health failed: \${health.status} \${await readText(health)}\`);
  }

  const page = await app.handle(new Request('http://localhost/'));
  const html = await page.text();
  assert(page.status === 200, \`page failed: \${page.status} \${html}\`);
  assert(html.includes('Build your app from here'), 'starter page content missing');
  assert(html.includes('/_build/platform.'), 'platform stylesheet was not linked into SSR HTML');

  const sitemap = await app.handle(new Request('http://localhost/sitemap.xml'));
  const sitemapXml = await sitemap.text();
  assert(sitemap.status === 200, \`sitemap failed: \${sitemap.status} \${sitemapXml}\`);
  assert(sitemap.headers.get('content-type')?.includes('application/xml'), 'sitemap content type missing');
  assert(sitemapXml.includes('<loc>http://localhost:3000/</loc>'), 'sitemap root route missing');

  const jsFiles = [...new Bun.Glob('client.*.js').scanSync({ cwd: './custom-build' })];
  const cssFiles = [...new Bun.Glob('platform.*.css').scanSync({ cwd: './custom-build' })];
  assert(jsFiles.length > 0, 'client bundle missing from custom outDir');
  assert(cssFiles.length > 0, 'platform stylesheet missing from custom outDir');

  const entryExists = await Bun.file('./.zero/generated/client-entry.tsx').exists();
  assert(entryExists, 'generated client entry missing');

  const jsAsset = await app.handle(new Request(\`http://localhost/_build/\${jsFiles[0]}\`));
  assert(jsAsset.status === 200, \`custom outDir JS asset failed: \${jsAsset.status}\`);

  const cssAsset = await app.handle(new Request(\`http://localhost/_build/\${cssFiles[0]}\`));
  assert(cssAsset.status === 200, \`custom outDir CSS asset failed: \${cssAsset.status}\`);
} finally {
  if (app.server) await app.stop();
}
`);
}
