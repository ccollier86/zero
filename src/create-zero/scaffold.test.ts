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

import { scaffoldZeroApp } from './scaffold';

async function createTempRoot(): Promise<string> {
  const baseDir = join(process.cwd(), '.zero');
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
      expect(result.filesWritten).toContain('server/routes/customers.ts');
      expect(result.filesWritten).toContain('tsconfig.json');
      expect(result.filesWritten).toContain('.gitignore');
      await expect(stat(join(targetDir, 'server', 'plugins')).then((value) => value.isDirectory())).resolves.toBe(true);
      await expect(stat(join(targetDir, 'server', 'middleware')).then((value) => value.isDirectory())).resolves.toBe(true);
      await expect(stat(join(targetDir, 'server', 'endpoints')).then((value) => value.isDirectory())).resolves.toBe(true);

      const packageJson = JSON.parse(await readFile(join(targetDir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
        scripts: Record<string, string>;
      };
      expect(packageJson.dependencies['@zero/framework']).toBe('file:../zero-framework');
      expect(packageJson.scripts.doctor).toBe('zero doctor --config ./zero.config.ts');

      const tsconfig = JSON.parse(await readFile(join(targetDir, 'tsconfig.json'), 'utf8')) as {
        compilerOptions: { paths: Record<string, string[]> };
      };
      expect(tsconfig.compilerOptions.paths['@app/*']).toEqual(['./app/*']);
      expect(tsconfig.compilerOptions.paths['@/components/*']).toEqual([
        './components/*',
        './node_modules/@zero/framework/src/components/*',
      ]);
      expect(tsconfig.compilerOptions.paths.react).toEqual(['./node_modules/@types/react']);

      const gitignore = await readFile(join(targetDir, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.zero');
      expect(gitignore).toContain('*.db-wal');

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

  const route = await app.handle(new Request('http://localhost/api/customers/health'));
  if (route.status !== 200) {
    throw new Error(\`route failed: \${route.status} \${await readText(route)}\`);
  }
  const routeBody = await route.json() as { ok?: boolean; feature?: string };
  assert(routeBody.ok === true && routeBody.feature === 'package-mode-routes', 'server route did not load');

  const page = await app.handle(new Request('http://localhost/'));
  const html = await page.text();
  assert(page.status === 200, \`page failed: \${page.status} \${html}\`);
  assert(html.includes('/_build/client.'), 'client bundle was not linked into SSR HTML');
  assert(html.includes('/_build/platform.'), 'platform stylesheet was not linked into SSR HTML');

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
