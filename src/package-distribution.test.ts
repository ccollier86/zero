/**
 * package-distribution.test.ts
 *
 * Verifies the Bun package tarball contains the source-export runtime and the
 * package-mode starter files required by create-zero after publication.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

describe('package distribution', () => {
  test('packed package creates a reusable app with docs and working SSR', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-pack-'));
    const packDir = join(rootDir, 'pack');
    const extractDir = join(rootDir, 'extract');
    const appDir = join(rootDir, 'generated-app');

    try {
      await mkdir(packDir, { recursive: true });
      await mkdir(extractDir, { recursive: true });

      await spawnChecked([
        'bun',
        'pm',
        'pack',
        '--destination',
        packDir,
        '--ignore-scripts',
        '--quiet',
      ]);

      const tarball = await findPackedTarball(packDir);
      const contents = await spawnText(['tar', '-tzf', tarball]);
      const packagedFiles = contents.split('\n');
      expect(contents).toContain('package/src/create-zero/run.ts');
      expect(contents).toContain('package/src/create-zero/scaffold.ts');
      expect(contents).toContain('package/src/update/run.ts');
      expect(contents).toContain('package/src/auth/admin-lifecycle-email-service.ts');
      expect(contents).toContain('package/src/auth/admin-password-recovery-service.ts');
      expect(contents).toContain('package/src/auth/auth-action-token-delivery.ts');
      expect(contents).toContain('package/src/auth/auth-email-identity.ts');
      expect(contents).toContain('package/src/auth/auth-email-outbox.ts');
      expect(contents).toContain('package/src/auth/auth-email-outbox-failure-classification.ts');
      expect(contents).toContain('package/src/auth/auth-stop-lifecycle.ts');
      expect(contents).toContain('package/src/email/email-failure-policy.ts');
      expect(contents).toContain('package/src/frontend/server/app-signal-dispatcher.ts');
      expect(contents).toContain('package/src/frontend/server/app-signal-lifecycle.ts');
      expect(contents).toContain('package/src/auth/native/trusted-proxy-source.ts');
      expect(contents).toContain('package/src/auth/oidc/auth-native.plugin.ts');
      expect(contents).toContain('package/src/auth/oidc/native-access-session.ts');
      expect(contents).toContain('package/src/auth/native/config.ts');
      expect(contents).toContain('package/src/migrations/definitions/005_native_app_auth.ts');
      expect(contents).toContain('package/src/migrations/definitions/006_native_auth_hardening.ts');
      expect(contents).toContain('package/src/migrations/definitions/007_auth_email_outbox.ts');
      expect(contents).toContain('package/src/native/index.ts');
      expect(contents).toContain('package/src/native/zero-native-auth.ts');
      expect(contents).toContain('package/src/native/zero-native-auth-broker.ts');
      expect(contents).toContain('package/examples/native-auth/desktop.ts');
      expect(contents).toContain('package/examples/native-auth/mobile.ts');
      expect(contents).toContain('package/examples/native-auth/broker.ts');
      expect(contents).toContain('package/examples/native-auth/README.md');
      expect(contents).toContain('package/src/sync/sync-socket-auth.ts');
      expect(contents).toContain('package/src/frontend/client/auth-types.ts');
      expect(contents).toContain('package/examples/package-mode/app/server.ts');
      expect(contents).toContain('package/examples/package-mode/app/layout.tsx');
      expect(contents).toContain('package/examples/package-mode/app/page.tsx');
      expect(contents).toContain('package/examples/package-mode/db/schema.ts');
      expect(contents).toContain('package/examples/package-mode/zero.config.ts');
      expect(contents).toContain('package/scripts/install-local-tools.sh');
      expect(packagedFiles).toContain('package/.env.example');
      expect(contents).toContain('package/README.md');
      expect(contents).toContain('package/llms.txt');
      expect(contents).toContain('package/docs/start-here.md');
      expect(contents).toContain('package/docs/auth/native-app-auth.md');
      expect(contents).toContain('package/tsconfig.json');
      expect(packagedFiles).not.toContain('package/.env');
      expect(packagedFiles).not.toContain('package/Cargo.toml');
      expect(packagedFiles).not.toContain('package/Cargo.lock');
      expect(packagedFiles.some((file) => file.startsWith('package/crates/'))).toBe(false);
      expect(packagedFiles.some((file) => file.startsWith('package/sdk/'))).toBe(false);
      expect(packagedFiles).not.toContain('package/docs/auth/rust-tauri-auth-sdk.md');

      await spawnChecked(['tar', '-xzf', tarball, '-C', extractDir]);

      const packageDir = join(extractDir, 'package');
      const frameworkPackageJson = JSON.parse(
        await readFile(join(packageDir, 'package.json'), 'utf8')
      ) as {
        dependencies: Record<string, string>;
        files: string[];
      };
      expect(frameworkPackageJson.dependencies['@sinclair/typebox']).toBeDefined();
      expect(frameworkPackageJson.dependencies['file-type']).toBeDefined();
      expect(frameworkPackageJson.dependencies['openapi-types']).toBeDefined();
      expect(frameworkPackageJson.files).not.toContain('.');
      expect(frameworkPackageJson.files).not.toContain('sdk');
      expect(frameworkPackageJson.files.some((file) => file.startsWith('sdk/'))).toBe(false);

      await spawnChecked([
        'bun',
        join(packageDir, 'src/create-zero/run.ts'),
        appDir,
        '--zero',
        `file:${tarball}`,
        '--force',
      ]);

      const packageJson = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
      };

      expect(packageJson.dependencies['@zero/framework']).toBe(`file:${tarball}`);
      await expect(stat(join(appDir, 'app/server.ts')).then((value) => value.isFile())).resolves.toBe(true);
      await expect(stat(join(appDir, 'app/layout.tsx')).then((value) => value.isFile())).resolves.toBe(true);
      await expect(stat(join(appDir, 'app/page.tsx')).then((value) => value.isFile())).resolves.toBe(true);
      await expect(stat(join(appDir, 'db/schema.ts')).then((value) => value.isFile())).resolves.toBe(true);
      await expect(stat(join(appDir, 'zero.config.ts')).then((value) => value.isFile())).resolves.toBe(true);
      await expect(stat(join(appDir, 'server/resources')).then((value) => value.isDirectory())).resolves.toBe(true);
      await expect(pathExists(join(appDir, 'sdk'))).resolves.toBe(false);
      await expect(pathExists(join(appDir, 'Cargo.toml'))).resolves.toBe(false);
      await expect(pathExists(join(appDir, 'Cargo.lock'))).resolves.toBe(false);
      await expect(pathExists(join(appDir, 'crates'))).resolves.toBe(false);

      await spawnChecked(['bun', 'install', '--ignore-scripts'], appDir);
      await expect(
        stat(join(appDir, 'node_modules/@zero/framework/docs/start-here.md')).then((value) => value.isFile())
      ).resolves.toBe(true);
      await expect(
        stat(join(appDir, 'node_modules/@zero/framework/llms.txt')).then((value) => value.isFile())
      ).resolves.toBe(true);
      await expect(
        stat(join(appDir, 'node_modules/@zero/framework/examples/native-auth/desktop.ts'))
          .then((value) => value.isFile())
      ).resolves.toBe(true);
      await expect(
        stat(join(appDir, 'node_modules/@zero/framework/examples/native-auth/mobile.ts'))
          .then((value) => value.isFile())
      ).resolves.toBe(true);
      await buildInstalledNativeRecipes(appDir);
      await writePackageRuntimeSmoke(appDir);
      await spawnChecked(['bun', 'run', 'typecheck'], appDir);
      await spawnChecked(['bun', 'package-runtime-smoke.ts'], appDir);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 120_000);
});

async function findPackedTarball(packDir: string): Promise<string> {
  const entries = await readdir(packDir);
  const tarball = entries.find((entry) => entry.endsWith('.tgz'));
  if (!tarball) throw new Error(`No package tarball was written to ${packDir}`);
  return join(packDir, tarball);
}

async function pathExists(pathname: string): Promise<boolean> {
  return stat(pathname).then(() => true, () => false);
}

/** Run a subprocess and include captured output when it fails. */
async function spawnChecked(cmd: string[], cwd = process.cwd()): Promise<void> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: Bun.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Command failed (${cmd.join(' ')}):\n${stdout}\n${stderr}`);
  }
}

async function buildInstalledNativeRecipes(appDir: string): Promise<void> {
  const recipes = join(appDir, 'node_modules/@zero/framework/examples/native-auth');
  await spawnChecked([
    'bun', 'build', join(recipes, 'desktop.ts'), '--target=bun',
    `--outdir=${join(appDir, '.native-desktop-smoke')}`,
  ], appDir);
  await spawnChecked([
    'bun', 'build', join(recipes, 'mobile.ts'), '--target=browser',
    `--outdir=${join(appDir, '.native-mobile-smoke')}`,
  ], appDir);
  await spawnChecked([
    'bun', 'build', join(recipes, 'broker.ts'), '--target=browser',
    `--outdir=${join(appDir, '.native-broker-smoke')}`,
  ], appDir);
}

/** Write the packed-package runtime check used by the distribution test. */
async function writePackageRuntimeSmoke(appDir: string): Promise<void> {
  const source = `import { createApp } from '@zero/framework/server';
import type { AuthPasswordUpdatedResult, Client } from '@zero/framework/react';
import { createZeroNativeAuth, type ZeroNativeAuthOptions } from '@zero/framework/native';
import config from './zero.config';

function assertPackagedAuthContract(client: Client, result: AuthPasswordUpdatedResult) {
  void client.clearAuthAdminPasswordChangeRequirement(result.user.userId);
  return result.passwordUpdated && result.signInRequired;
}
void assertPackagedAuthContract;

function assertPackagedNativeContract(options: ZeroNativeAuthOptions) {
  return createZeroNativeAuth(options);
}
void assertPackagedNativeContract;

const app = await createApp({
  ...config,
  db: { mode: 'ephemeral' },
  auth: false,
  stateSync: false,
  email: false,
  ai: false,
  vector: false,
  migrate: false,
});

const health = await app.handle(new Request('http://localhost/api/health'));
if (health.status !== 200) throw new Error(\`health failed with status \${health.status}\`);

const page = await app.handle(new Request('http://localhost/'));
const html = await page.text();
if (page.status !== 200) throw new Error(\`page failed with status \${page.status}: \${html}\`);
if (!html.includes('Build your app from here')) throw new Error('starter SSR content missing');
`;

  await writeFile(join(appDir, 'package-runtime-smoke.ts'), source);
}

async function spawnText(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    env: Bun.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Command failed (${cmd.join(' ')}):\n${stdout}\n${stderr}`);
  }

  return stdout;
}
