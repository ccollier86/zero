/**
 * package-distribution.test.ts
 *
 * Verifies the Bun package tarball contains the source-export runtime and the
 * package-mode starter files required by create-zero after publication.
 */

import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { LOCAL_FRAMEWORK_DEPENDENCY } from './create-zero/local-framework-package';
import { runCreateZeroCli } from './create-zero/run';

const EXPECTED_MIGRATION_VERSIONS = Array.from(
  { length: 37 },
  (_, index) => String(index + 1).padStart(3, '0'),
);
const PACKAGE_RUNTIME_SMOKE_TIMEOUT_MS = 180_000;
const PACKAGE_RUNTIME_SMOKE_REAP_TIMEOUT_MS = 10_000;
const PACKAGE_RUNTIME_SMOKE_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const PACKAGE_RUNTIME_SMOKE_SUCCESS = '[zero-package-runtime] complete';

describe('package distribution', () => {
  // Packing, installing, typechecking, and booting a fresh consumer is a
  // deliberately heavyweight release gate. It runs beside CPU-intensive auth
  // integration tests in the full suite, so keep a bounded but realistic
  // parallel-run budget rather than treating host contention as a failure.
  test('packed package creates a reusable app with docs and working SSR', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'zero-pack-'));
    const localAppDir = join(rootDir, 'local-app');
    const extractDir = join(rootDir, 'extract');
    const appDir = join(rootDir, 'generated-app');

    try {
      await mkdir(extractDir, { recursive: true });

      expect(await runCreateZeroCli([localAppDir, '--local'])).toBe(0);

      const localPackageJson = JSON.parse(
        await readFile(join(localAppDir, 'package.json'), 'utf8')
      ) as { dependencies: Record<string, string> };
      expect(localPackageJson.dependencies['@zero/framework']).toBe(
        LOCAL_FRAMEWORK_DEPENDENCY,
      );

      const tarball = join(localAppDir, '.zero/framework/zero-framework.tgz');
      await expect(stat(tarball).then((value) => value.isFile())).resolves.toBe(true);
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
      expect(contents).toContain('package/src/migrations/index.ts');
      for (const version of EXPECTED_MIGRATION_VERSIONS) {
        expect(packagedFiles.some((file) =>
          file.startsWith(`package/src/migrations/definitions/${version}_`)
          && file.endsWith('.ts')
        )).toBe(true);
      }
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
      expect(contents).toContain('package/examples/guardian-fabric-proof/.env.example');
      expect(contents).toContain('package/examples/guardian-fabric-proof/README.md');
      expect(contents).toContain('package/examples/guardian-fabric-proof/app/server.ts');
      expect(contents).toContain(
        'package/examples/guardian-fabric-proof/app/(dashboard)/workflows/page.tsx',
      );
      expect(contents).toContain(
        'package/examples/guardian-fabric-proof/app/workflows/torrent-proof-panel.tsx',
      );
      expect(contents).toContain(
        'package/examples/guardian-fabric-proof/app/workflows/torrent-run-monitor.tsx',
      );
      expect(contents).toContain(
        'package/examples/guardian-fabric-proof/server/torrent-proof.ts',
      );
      expect(contents).toContain('package/examples/guardian-fabric-proof/server/resources/tasks.ts');
      expect(contents).toContain(
        'package/examples/guardian-fabric-proof/shared/torrent-proof.ts',
      );
      expect(contents).toContain('package/examples/guardian-fabric-proof/zero.config.ts');
      expect(contents).toContain('package/scripts/install-local-tools.sh');
      expect(packagedFiles).toContain('package/.env.example');
      expect(contents).toContain('package/README.md');
      expect(contents).toContain('package/llms.txt');
      expect(contents).toContain('package/THIRD_PARTY_NOTICES.md');
      expect(contents).toContain('package/src/components/secret-field/secret-field.tsx');
      expect(contents).toContain('package/src/components/streaming-text/streaming-text.tsx');
      expect(contents).toContain('package/docs/start-here.md');
      expect(contents).toContain('package/docs/auth/native-app-auth.md');
      expect(contents).toContain('package/tsconfig.json');
      expect(packagedFiles).not.toContain('package/.env');
      expect(packagedFiles).not.toContain('package/Cargo.toml');
      expect(packagedFiles).not.toContain('package/Cargo.lock');
      expect(packagedFiles.some((file) => file.startsWith('package/crates/'))).toBe(false);
      expect(packagedFiles.some((file) => file.startsWith('package/sdk/'))).toBe(false);
      expect(packagedFiles.some((file) =>
        file.startsWith('package/examples/fabric-tenancy/')
      )).toBe(false);
      expect(packagedFiles.some((file) =>
        file.startsWith('package/examples/guardian-fabric-proof/.build/')
        || file.startsWith('package/examples/guardian-fabric-proof/.zero/')
        || file.startsWith('package/examples/guardian-fabric-proof/data/')
      )).toBe(false);
      expect(packagedFiles).not.toContain(
        'package/examples/guardian-fabric-proof/.env',
      );
      expect(packagedFiles).not.toContain('package/docs/auth/rust-tauri-auth-sdk.md');

      await spawnChecked(['tar', '-xzf', tarball, '-C', extractDir]);

      const packageDir = join(extractDir, 'package');
      const frameworkPackageJson = JSON.parse(
        await readFile(join(packageDir, 'package.json'), 'utf8')
      ) as {
        dependencies: Record<string, string>;
        files: string[];
        imports: Record<string, string>;
      };
      expect(frameworkPackageJson.dependencies['@sinclair/typebox']).toBeDefined();
      expect(frameworkPackageJson.dependencies['file-type']).toBeDefined();
      expect(frameworkPackageJson.dependencies['openapi-types']).toBeDefined();
      expect(frameworkPackageJson.files).not.toContain('.');
      expect(frameworkPackageJson.files).not.toContain('sdk');
      expect(frameworkPackageJson.files.some((file) => file.startsWith('sdk/'))).toBe(false);
      expect(frameworkPackageJson.files.some((file) =>
        file.startsWith('examples/fabric-tenancy')
      )).toBe(false);
      expect(frameworkPackageJson.files).not.toContain('examples/guardian-fabric-proof');
      expect(Object.keys(frameworkPackageJson.imports).length).toBeGreaterThan(0);
      expect(Object.values(frameworkPackageJson.imports).every((target) =>
        /^\.\/src\/.+\.tsx?$/.test(target)
      )).toBe(true);

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
      const generatedTsconfig = JSON.parse(
        await readFile(join(appDir, 'tsconfig.json'), 'utf8')
      ) as { compilerOptions: { paths: Record<string, string[]> } };

      expect(packageJson.dependencies['@zero/framework']).toBe(`file:${tarball}`);
      expect(JSON.stringify(generatedTsconfig.compilerOptions.paths))
        .not.toContain('node_modules/@zero/framework/src');
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
        stat(join(appDir, 'node_modules/@zero/framework/THIRD_PARTY_NOTICES.md'))
          .then((value) => value.isFile())
      ).resolves.toBe(true);
      await expect(
        stat(join(appDir, 'node_modules/@zero/framework/examples/native-auth/desktop.ts'))
          .then((value) => value.isFile())
      ).resolves.toBe(true);
      await expect(
        stat(join(appDir, 'node_modules/@zero/framework/examples/native-auth/mobile.ts'))
          .then((value) => value.isFile())
      ).resolves.toBe(true);
      await expect(
        stat(join(appDir, 'node_modules/@zero/framework/examples/guardian-fabric-proof/README.md'))
          .then((value) => value.isFile())
      ).resolves.toBe(true);
      await buildInstalledNativeRecipes(appDir);
      await buildInstalledGuardianFabricProof(appDir);
      await writePackageRuntimeSmoke(appDir);
      await writePackageReleaseSmoke(appDir);
      await spawnChecked([
        'bun',
        join(appDir, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--project',
        join(appDir, 'package-runtime-smoke.tsconfig.json'),
      ], appDir);
      await spawnChecked(['bun', 'run', 'typecheck'], appDir);
      await runPackageRuntimeSmoke(appDir);
      await spawnChecked(['bun', 'package-release-smoke.ts'], appDir);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  // This gate packs, installs, and typechecks the framework plus the complete
  // Guardian/Fabric proof app. Busy CI builders can spend several minutes in
  // TypeScript without being stalled, so keep the timeout above the combined
  // subprocess budget rather than terminating a healthy compiler.
  }, 600_000);
});

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

/**
 * Run the installed-package runtime smoke with a deadline below the enclosing
 * release gate. File-backed output avoids a pipe-drain deadlock obscuring the
 * child deadline, while the final phase marker proves graceful app teardown.
 */
async function runPackageRuntimeSmoke(appDir: string): Promise<void> {
  const stdoutPath = join(appDir, '.package-runtime-smoke.stdout.log');
  const stderrPath = join(appDir, '.package-runtime-smoke.stderr.log');
  const [stdoutFile, stderrFile] = await Promise.all([
    open(stdoutPath, 'w'),
    open(stderrPath, 'w'),
  ]);
  const startedAt = Date.now();
  const proc = Bun.spawn({
    cmd: [process.execPath, 'package-runtime-smoke.ts'],
    cwd: appDir,
    stdin: 'ignore',
    stdout: stdoutFile.fd,
    stderr: stderrFile.fd,
    env: {
      ...Bun.env,
      NODE_ENV: 'test',
      PORT: '3000',
      APP_NAME: 'Zero Package Runtime Smoke',
      APP_PUBLIC_URL: 'http://localhost:3000',
      DB_MODE: 'ephemeral',
      SYSTEM_DB_MODE: 'ephemeral',
      ZERO_AUTH_ENABLED: 'false',
      ZERO_PDF_ENABLED: 'false',
      ZERO_VECTOR_ENABLED: 'false',
      RESEND_API_KEY: '',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      GEMINI_API_KEY: '',
      GOOGLE_API_KEY: '',
      GROQ_API_KEY: '',
      XAI_API_KEY: '',
      COHERE_API_KEY: '',
      META_LLAMA_API_KEY: '',
      LLAMA_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      PERPLEXITY_API_KEY: '',
      VOYAGE_API_KEY: '',
      DEEPGRAM_API_KEY: '',
    },
  });

  let timedOut = false;
  let reaped = true;
  try {
    if (!await processSettledWithin(proc, PACKAGE_RUNTIME_SMOKE_TIMEOUT_MS)) {
      timedOut = true;
      try {
        proc.kill('SIGKILL');
      } catch {
        // The child may have exited between the deadline and the signal.
      }
      reaped = await processSettledWithin(proc, PACKAGE_RUNTIME_SMOKE_REAP_TIMEOUT_MS);
    }
  } finally {
    await Promise.allSettled([stdoutFile.close(), stderrFile.close()]);
  }

  const [stdout, stderr] = await Promise.all([
    readDiagnosticOutput(stdoutPath),
    readDiagnosticOutput(stderrPath),
  ]);
  const lastPhase = [...stdout.matchAll(/^\[zero-package-runtime\] (.+)$/gm)].at(-1)?.[1]
    ?? 'child did not report a phase';
  const details = [
    `command: ${process.execPath} package-runtime-smoke.ts`,
    `duration: ${Date.now() - startedAt}ms`,
    `exit: ${String(proc.exitCode)}`,
    `signal: ${String(proc.signalCode)}`,
    `last phase: ${lastPhase}`,
    `reaped: ${String(reaped)}`,
    stdout.trim() ? `stdout:\n${stdout.trim()}` : '',
    stderr.trim() ? `stderr:\n${stderr.trim()}` : '',
  ].filter(Boolean).join('\n');

  if (timedOut) {
    throw new Error(`Installed-package runtime smoke timed out.\n${details}`);
  }
  if (proc.exitCode !== 0 || proc.signalCode !== null) {
    throw new Error(`Installed-package runtime smoke failed.\n${details}`);
  }
  if (!stdout.includes(PACKAGE_RUNTIME_SMOKE_SUCCESS)) {
    throw new Error(`Installed-package runtime smoke omitted its success marker.\n${details}`);
  }
}

async function processSettledWithin(
  proc: Bun.Subprocess,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      proc.exited.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readDiagnosticOutput(pathname: string): Promise<string> {
  const output = await readFile(pathname);
  const truncated = output.byteLength > PACKAGE_RUNTIME_SMOKE_OUTPUT_LIMIT_BYTES;
  const visible = truncated
    ? output.subarray(output.byteLength - PACKAGE_RUNTIME_SMOKE_OUTPUT_LIMIT_BYTES)
    : output;
  const text = new TextDecoder().decode(visible);
  return truncated ? `[earlier output truncated]\n${text}` : text;
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

/** Prove the shipped integration example resolves only published package files. */
async function buildInstalledGuardianFabricProof(appDir: string): Promise<void> {
  const proof = join(
    appDir,
    'node_modules/@zero/framework/examples/guardian-fabric-proof',
  );
  await spawnChecked([
    'bun',
    join(appDir, 'node_modules/typescript/bin/tsc'),
    '--noEmit',
    '--project',
    join(proof, 'tsconfig.json'),
  ], appDir);
  await spawnChecked([
    'bun',
    'build',
    join(proof, 'app/server.ts'),
    '--target=bun',
    `--outdir=${join(appDir, '.guardian-fabric-proof-smoke')}`,
  ], appDir);
}

/** Write the packed-package runtime check used by the distribution test. */
async function writePackageRuntimeSmoke(appDir: string): Promise<void> {
  const source = `import {
  createApp,
  createDataRealmReadinessPlugin as createServerDataRealmReadinessPlugin,
} from '@zero/framework/server';
import type {
  AppDatabaseTopologyConfig,
  AppMultipleDatabaseTopologyConfig,
  AppTenantDataIsolation,
  AuthAdministrationTenantConfig,
  AuthApiKeyConfig,
  AuthPermissionScope,
  DatabaseRealmDefinition,
  ResolvedAuthApiKeyConfig,
  ServerSystemDatabaseServices,
  SystemDatabaseConfig,
} from '@zero/framework/server';
import type {
  AuthAuthorizationScopeLifecycle,
  AuthClientOptions,
  AuthPasswordUpdatedResult,
  AuthPlatformAddMemberParams,
  AuthPlatformAdminSdkSurface,
  AuthPlatformIssueInvitationParams,
  AuthPlatformRoleSelection,
  AuthPlatformTenantPage,
  AuthPlatformUpdateMemberInput,
  AuthPlatformUpdateMemberParams,
  Client,
  LoginFormProps,
  PlatformUserManagementProps,
  UsePlatformAdministrationOptions,
  UsePlatformAdministrationResult,
  UsePlatformTenantsResult,
  UseTenantOnboardingAdministrationOptions,
  UseTenantOnboardingAdministrationResult,
} from '@zero/framework/react';
import type {
  UsePlatformAdministrationOptions as UsePlatformAdministrationOptionsSubpath,
  UsePlatformAdministrationResult as UsePlatformAdministrationResultSubpath,
  UseTenantOnboardingAdministrationOptions as UseTenantOnboardingAdministrationOptionsSubpath,
  UseTenantOnboardingAdministrationResult as UseTenantOnboardingAdministrationResultSubpath,
} from '@zero/framework/react/hooks';
import type {
  AssertAuthApplicationMutationAuthority,
  AssertAuthTenantMutationAuthority,
  AtomicRegistrationPolicy,
  AuthApiKeyIssueInput,
  AuthApiKeyManagementCapabilities,
  AuthPlatformCodeEmitter,
  AuthSecurityAuditContext,
  AuthTenantInvitationDeliveryMode,
  AuthTenantInvitationEmailTemplate,
  AuthTenantInvitationEmailTemplateContext,
  CreateUserInput,
  DataRealmReadinessPluginConfig,
  DataRealmReadinessRequest,
  DataRealmReadinessScope,
  DataRealmReadinessSdkSurface,
  DataRealmReadinessService,
  DataRealmReadinessSnapshot,
  DataRealmReadinessStatus,
  IdentityAnchorStoreOptions,
  IdentityProjectionErrorCode,
  IdentityProjectionLifecycleRoutes,
  IdentityProjectionOutboxStoreOptions,
  IdentityProjectionServiceOptions,
  IssuedPageSession,
  SynchronousIdentityProjectionTarget,
  UserListOptions,
  UserStoreOptions,
  WebRefreshProof,
} from '@zero/framework/auth';
import {
  createDataRealmReadinessPlugin,
  DATA_REALM_READINESS_DEFAULT_POLL_MS,
  DATA_REALM_READINESS_MAX_POLL_MS,
  DATA_REALM_READINESS_MIN_POLL_MS,
  DATA_REALM_READINESS_STATUSES,
  DataRealmReadinessContractError,
  dataRealmReadinessAllowsApplicationData,
  defineIdentityAnchorTables,
  defineIdentityProjectionSystemTables,
  IDENTITY_PROJECTION_ERROR_CODES,
  IDENTITY_PROJECTION_INSTALLATION_TABLE,
  IDENTITY_PROJECTION_OUTBOX_TABLE,
  IDENTITY_PROJECTION_RECEIPTS_TABLE,
  IDENTITY_PROJECTION_STATE_TABLE,
  IDENTITY_PROJECTION_TARGETS_TABLE,
  IdentityAnchorStore,
  IdentityProjectionError,
  IdentityProjectionOutboxStore,
  IdentityProjectionService,
  identityProjectionError,
  parseDataRealmReadinessSnapshot,
} from '@zero/framework/auth';
import {
  SYNC_ACK_ERROR_CODES,
  type SyncAckErrorCode,
  type SyncDataPlaneName,
  type SyncMutationRejection,
  type SyncSnapshotBeginMessage,
  type SyncSnapshotChunkMessage,
  type SyncSnapshotEndMessage,
} from '@zero/framework/sync';
import { createZeroNativeAuth, type ZeroNativeAuthOptions } from '@zero/framework/native';
import type {
  PlatformWorkspaceManagementProps,
  TenantMemberManagementProps,
} from '@zero/framework/components/auth';
import config from './zero.config';

type PackagedAuthUiContract =
  LoginFormProps
  | PlatformWorkspaceManagementProps
  | PlatformUserManagementProps
  | TenantMemberManagementProps;
void (null as PackagedAuthUiContract | null);

type PackagedAuthExtensionContract =
  | AuthAdministrationTenantConfig
  | AuthAuthorizationScopeLifecycle
  | AuthClientOptions
  | AuthPermissionScope
  | AuthPlatformAddMemberParams
  | AuthPlatformAdminSdkSurface
  | AuthPlatformIssueInvitationParams
  | AuthPlatformRoleSelection
  | AuthPlatformTenantPage
  | AuthPlatformUpdateMemberInput
  | AuthPlatformUpdateMemberParams
  | AssertAuthApplicationMutationAuthority
  | AssertAuthTenantMutationAuthority
  | AtomicRegistrationPolicy
  | AuthPlatformCodeEmitter
  | AuthSecurityAuditContext
  | AuthTenantInvitationDeliveryMode
  | AuthTenantInvitationEmailTemplate
  | AuthTenantInvitationEmailTemplateContext
  | CreateUserInput
  | IssuedPageSession
  | UserListOptions
  | UserStoreOptions
  | UsePlatformAdministrationOptions
  | UsePlatformAdministrationResult
  | UsePlatformAdministrationOptionsSubpath
  | UsePlatformAdministrationResultSubpath
  | UsePlatformTenantsResult
  | UseTenantOnboardingAdministrationOptions
  | UseTenantOnboardingAdministrationResult
  | UseTenantOnboardingAdministrationOptionsSubpath
  | UseTenantOnboardingAdministrationResultSubpath
  | WebRefreshProof;
void (null as PackagedAuthExtensionContract | null);

type PackagedGuardianFabricContract = readonly [
  AppDatabaseTopologyConfig,
  AppMultipleDatabaseTopologyConfig,
  AppTenantDataIsolation,
  AuthApiKeyConfig,
  ResolvedAuthApiKeyConfig,
  DatabaseRealmDefinition,
  ServerSystemDatabaseServices,
  SystemDatabaseConfig,
  AuthApiKeyIssueInput,
  AuthApiKeyManagementCapabilities,
  DataRealmReadinessPluginConfig,
  DataRealmReadinessRequest,
  DataRealmReadinessScope,
  DataRealmReadinessSdkSurface,
  DataRealmReadinessService,
  DataRealmReadinessSnapshot,
  DataRealmReadinessStatus,
  IdentityAnchorStoreOptions,
  IdentityProjectionErrorCode,
  IdentityProjectionLifecycleRoutes,
  IdentityProjectionOutboxStoreOptions,
  IdentityProjectionServiceOptions,
  SynchronousIdentityProjectionTarget,
  SyncAckErrorCode,
  SyncDataPlaneName,
  SyncMutationRejection,
  SyncSnapshotBeginMessage,
  SyncSnapshotChunkMessage,
  SyncSnapshotEndMessage,
];
void (null as PackagedGuardianFabricContract | null);

const packagedGuardianFabricRuntimeExports = {
  createDataRealmReadinessPlugin,
  createServerDataRealmReadinessPlugin,
  DATA_REALM_READINESS_DEFAULT_POLL_MS,
  DATA_REALM_READINESS_MAX_POLL_MS,
  DATA_REALM_READINESS_MIN_POLL_MS,
  DATA_REALM_READINESS_STATUSES,
  DataRealmReadinessContractError,
  dataRealmReadinessAllowsApplicationData,
  defineIdentityAnchorTables,
  defineIdentityProjectionSystemTables,
  IDENTITY_PROJECTION_ERROR_CODES,
  IDENTITY_PROJECTION_INSTALLATION_TABLE,
  IDENTITY_PROJECTION_OUTBOX_TABLE,
  IDENTITY_PROJECTION_RECEIPTS_TABLE,
  IDENTITY_PROJECTION_STATE_TABLE,
  IDENTITY_PROJECTION_TARGETS_TABLE,
  IdentityAnchorStore,
  IdentityProjectionError,
  IdentityProjectionOutboxStore,
  IdentityProjectionService,
  identityProjectionError,
  parseDataRealmReadinessSnapshot,
  SYNC_ACK_ERROR_CODES,
};
void packagedGuardianFabricRuntimeExports;

function assertPackagedAdministrationHookContracts(
  platform: UsePlatformAdministrationResult,
  onboarding: UseTenantOnboardingAdministrationResult,
) {
  const platformPolicyStatus: 'unresolved' | 'enabled' | 'disabled' | 'error' =
    platform.invitationPolicyStatus;
  const platformInvitationsEnabled: boolean | null = platform.invitationsEnabled;
  const onboardingAuthConfigStatus: 'unknown' | 'loading' | 'ready' | 'error' =
    onboarding.authConfigStatus;
  const onboardingInvitationsEnabled: boolean | null = onboarding.invitationsEnabled;
  const onboardingJoinRequestsEnabled: boolean | null = onboarding.joinRequestsEnabled;

  platform.reloadConfig();
  platform.reloadMembers();
  platform.reloadInvitations();
  platform.reload();
  void platform.isAvailable;
  void platform.isLoading;
  void platform.isMutating;
  void platform.error;
  void platform.isLoadingConfig;
  void platform.config;
  void platform.configError;
  void platform.isLoadingMembers;
  void platform.isMutatingMembers;
  void platform.membersError;
  void platform.members;
  void platform.memberPage;
  void platform.isLoadingMoreMembers;
  void platform.loadMoreMembers();
  void platform.isLoadingInvitations;
  void platform.isMutatingInvitations;
  void platform.invitationsError;
  void platform.invitations;
  void platform.invitationPage;
  void platform.isLoadingMoreInvitations;
  void platform.loadMoreInvitations();
  void platform.invitationConfigError;
  void platform.invitationDelivery;

  onboarding.reloadConfig();
  onboarding.reloadInvitations();
  onboarding.reloadJoinRequests();
  onboarding.reload();
  void onboarding.isLoading;
  void onboarding.isMutating;
  void onboarding.error;
  void onboarding.isLoadingConfig;
  void onboarding.isConfigPermissionDenied;
  void onboarding.configError;
  void onboarding.config;
  void onboarding.isLoadingInvitations;
  void onboarding.isLoadingJoinRequests;
  void onboarding.isMutatingInvitations;
  void onboarding.isMutatingJoinRequests;
  void onboarding.isInvitationsPermissionDenied;
  void onboarding.isJoinRequestsPermissionDenied;
  void onboarding.invitationsError;
  void onboarding.joinRequestsError;
  void onboarding.invitations;
  void onboarding.joinRequests;
  void onboarding.invitationPage;
  void onboarding.joinRequestPage;
  void onboarding.isLoadingMoreInvitations;
  void onboarding.isLoadingMoreJoinRequests;
  void onboarding.loadMoreInvitations();
  void onboarding.loadMoreJoinRequests();
  void onboarding.authConfigError;

  return {
    platformPolicyStatus,
    platformInvitationsEnabled,
    onboardingAuthConfigStatus,
    onboardingInvitationsEnabled,
    onboardingJoinRequestsEnabled,
  };
}
void assertPackagedAdministrationHookContracts;

function assertPackagedPlatformContract(client: Client) {
  const admin: AuthPlatformAdminSdkSurface = client.platformAdmin;
  const member: AuthPlatformAddMemberParams = {
    email: 'operator@example.test',
    roles: ['administrator'],
  };
  void admin.addMember(member);
  // @ts-expect-error Platform administration members require explicit roles.
  void admin.addMember({ email: 'operator@example.test' });
  // @ts-expect-error Platform administration roles cannot be empty.
  void admin.addMember({ email: 'operator@example.test', roles: [] });
  void admin.updateMember('member-1', {
    roles: ['administrator'],
    expectedRoleRevision: 'tenant:1',
  });
  // @ts-expect-error Direct role replacement requires a current revision fence.
  void admin.updateMember('member-1', { roles: ['administrator'] });
  // @ts-expect-error Platform administration role replacement cannot be empty.
  void admin.updateMember('member-1', { roles: [] });
  void admin.issueInvitation({
    email: 'invited@example.test',
    roles: ['administrator'],
  });
  // @ts-expect-error Platform administration invitations require roles.
  void admin.issueInvitation({ email: 'invited@example.test' });
  // @ts-expect-error Platform administration invitation roles cannot be empty.
  void admin.issueInvitation({ email: 'invited@example.test', roles: [] });
  const tenants: Promise<AuthPlatformTenantPage> = admin.listTenants({ limit: 25 });
  return tenants;
}
void assertPackagedPlatformContract;

const legacyLoginFormProps: LoginFormProps = { showRememberMe: true };
void legacyLoginFormProps;

function assertPackagedAuthContract(client: Client, result: AuthPasswordUpdatedResult) {
  void client.clearAuthAdminPasswordChangeRequirement(result.user.userId);
  return result.passwordUpdated && result.signInRequired;
}
void assertPackagedAuthContract;

function assertPackagedNativeContract(options: ZeroNativeAuthOptions) {
  return createZeroNativeAuth(options);
}
void assertPackagedNativeContract;

function phase(name: string): void {
  console.log(\`[zero-package-runtime] \${name}\`);
}

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

phase('create-app:start');
const app = await createApp({
  ...config,
  app: {
    ...config.app,
    name: 'Zero Package Runtime Smoke',
    publicUrl: 'http://localhost:3000',
  },
  db: { mode: 'ephemeral' },
  systemDb: { mode: 'ephemeral' },
  auth: false,
  stateSync: false,
  email: false,
  ai: false,
  vector: false,
  pdf: false,
  kv: false,
  observability: false,
  migrate: false,
  outDir: './custom-build',
  generatedDir: './.zero/generated',
  port: 3000,
});
phase('create-app:complete');

try {
  phase('health:start');
  const health = await app.handle(new Request('http://localhost/api/health'));
  if (health.status !== 200) {
    throw new Error(\`health failed: \${health.status} \${await readText(health)}\`);
  }
  phase('health:complete');

  phase('page:start');
  const page = await app.handle(new Request('http://localhost/'));
  const html = await page.text();
  assert(page.status === 200, \`page failed: \${page.status} \${html}\`);
  assert(html.includes('Build your app from here'), 'starter SSR content missing');
  assert(html.includes('/_build/platform.'), 'platform stylesheet was not linked into SSR HTML');
  phase('page:complete');

  phase('sitemap:start');
  const sitemap = await app.handle(new Request('http://localhost/sitemap.xml'));
  const sitemapXml = await sitemap.text();
  assert(sitemap.status === 200, \`sitemap failed: \${sitemap.status} \${sitemapXml}\`);
  assert(sitemap.headers.get('content-type')?.includes('application/xml'), 'sitemap content type missing');
  assert(sitemapXml.includes('<loc>http://localhost:3000/</loc>'), 'sitemap root route missing');
  phase('sitemap:complete');

  phase('artifacts:start');
  const jsFiles = [...new Bun.Glob('client.*.js').scanSync({ cwd: './custom-build' })];
  const cssFiles = [...new Bun.Glob('platform.*.css').scanSync({ cwd: './custom-build' })];
  assert(jsFiles.length > 0, 'client bundle missing from custom outDir');
  assert(cssFiles.length > 0, 'platform stylesheet missing from custom outDir');
  assert(
    await Bun.file('./.zero/generated/client-entry.tsx').exists(),
    'generated client entry missing',
  );
  phase('artifacts:complete');

  phase('js-asset:start');
  const jsAsset = await app.handle(new Request(\`http://localhost/_build/\${jsFiles[0]}\`));
  assert(jsAsset.status === 200, \`custom outDir JS asset failed: \${jsAsset.status}\`);
  phase('js-asset:complete');

  phase('css-asset:start');
  const cssAsset = await app.handle(new Request(\`http://localhost/_build/\${cssFiles[0]}\`));
  assert(cssAsset.status === 200, \`custom outDir CSS asset failed: \${cssAsset.status}\`);
  phase('css-asset:complete');
} finally {
  phase('stop:start');
  await app.stop(true);
  phase('stop:complete');
}

phase('complete');
`;

  await Promise.all([
    writeFile(join(appDir, 'package-runtime-smoke.ts'), source),
    writeFile(
      join(appDir, 'package-runtime-smoke.tsconfig.json'),
      `${JSON.stringify({
        extends: './tsconfig.json',
        compilerOptions: { noEmit: true },
        include: ['package-runtime-smoke.ts'],
      }, null, 2)}\n`,
    ),
  ]);
}

/**
 * Exercise release-critical behavior through the installed tarball. The smoke
 * uses only disposable local persistence and explicitly disables integrations
 * that could contact an external service.
 */
async function writePackageReleaseSmoke(appDir: string): Promise<void> {
  const source = `import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, createPlatformSQLiteService } from '@zero/framework/server';
import { Migrator, migrations } from '@zero/framework/migrations';

const expectedVersions = ${JSON.stringify(EXPECTED_MIGRATION_VERSIONS)};
const rootDir = await mkdtemp(join(tmpdir(), 'zero-packed-release-'));
const authProfiles = [
  { tenancy: 'single', authorization: 'simple' },
  { tenancy: 'single', authorization: 'advanced' },
  { tenancy: 'multi', authorization: 'simple' },
  { tenancy: 'multi', authorization: 'advanced' },
] as const;

type AuthProfile = (typeof authProfiles)[number];

try {
  await smokeCleanMigrations(rootDir);
  for (const profile of authProfiles) {
    await smokeAuthProfile(rootDir, profile);
  }
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

async function smokeCleanMigrations(root: string): Promise<void> {
  const migrationDir = join(root, 'migration');
  await mkdir(migrationDir, { recursive: true });
  const migrator = new Migrator({
    dbPath: join(migrationDir, 'platform.db'),
    migrations,
    backupDir: join(migrationDir, 'backups'),
    log: () => {},
  });

  try {
    const registered = migrations.map((migration) => migration.version);
    assertEqualList(registered, expectedVersions, 'packed migration registry');

    const applied = migrator.run();
    assertEqualList(applied, expectedVersions, 'clean migration run');
    const status = migrator.status();
    assert(status.length === expectedVersions.length, 'migration status length mismatch');
    assert(status.every((entry) => entry.applied), 'not every packed migration is applied');
    assert(status.every((entry) => entry.checksumMatches === true), 'migration checksum mismatch');
    assert(migrator.run().length === 0, 'packed migrations are not idempotent');

    const auditTable = migrator.database.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_auth_audit_events'"
    ).get() as { name?: string } | null;
    assert(auditTable?.name === '_auth_audit_events', 'migration 018 audit table is missing');

    const claimColumns = migrator.database.query(
      'PRAGMA table_info(_auth_tenant_domain_claims)'
    ).all() as Array<{ name: string }>;
    const claimColumnNames = new Set(claimColumns.map((column) => column.name));
    for (const name of ['released_at', 'released_by', 'quarantine_until']) {
      assert(claimColumnNames.has(name), 'migration 019 claim column is missing: ' + name);
    }

    const authorityRevisionTable = migrator.database.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_auth_authority_revision'"
    ).get() as { name?: string } | null;
    assert(
      authorityRevisionTable?.name === '_auth_authority_revision',
      'migration 020 authority revision table is missing',
    );
    const authorityTriggerCount = migrator.database.query(
      "SELECT COUNT(*) AS count FROM sqlite_master " +
      "WHERE type = 'trigger' AND name LIKE 'trg_zero_authority_%_v1'"
    ).get() as { count: number };
    assert(authorityTriggerCount.count > 0, 'migration 020 authority triggers are missing');

    const provenanceColumns = migrator.database.query(
      'PRAGMA table_info(_auth_domain_join_request_provenance)'
    ).all() as Array<{ name: string }>;
    const provenanceColumnNames = new Set(provenanceColumns.map((column) => column.name));
    for (const name of ['source', 'request_revision']) {
      assert(
        provenanceColumnNames.has(name),
        'migration 021 provenance column is missing: ' + name,
      );
    }

    const admissionSchema = migrator.database.query(
      "SELECT sql FROM sqlite_master " +
      "WHERE type = 'table' AND name = '_auth_request_admissions'"
    ).get() as { sql?: string } | null;
    for (const flow of [
      'bootstrap',
      'registration',
      'login',
      'invitation',
      'join-request',
      'domain-onboarding',
    ]) {
      assert(
        admissionSchema?.sql?.includes("'" + flow + "'") === true,
        'migration 022 admission flow is missing: ' + flow,
      );
    }

    const installedProfileColumns = migrator.database.query(
      'PRAGMA table_info(_auth_installed_profile)'
    ).all() as Array<{ name: string }>;
    const installedProfileColumnNames = new Set(
      installedProfileColumns.map((column) => column.name),
    );
    for (const name of [
      'singleton', 'version', 'generation', 'tenancy', 'authorization', 'updated_at',
    ]) {
      assert(
        installedProfileColumnNames.has(name),
        'migration 023 installed-profile column is missing: ' + name,
      );
    }
    const installedProfileTriggerCount = migrator.database.query(
      "SELECT COUNT(*) AS count FROM sqlite_master " +
      "WHERE type = 'trigger' " +
      "AND name LIKE 'trg_zero_authority__auth_installed_profile_%'"
    ).get() as { count: number };
    assert(
      installedProfileTriggerCount.count === 3,
      'migration 023 installed-profile authority triggers are missing',
    );

    const tenantColumns = migrator.database.query(
      'PRAGMA table_info(_auth_tenants)'
    ).all() as Array<{ name: string }>;
    assert(
      tenantColumns.some((column) => column.name === 'kind'),
      'migration 024 tenant-kind discriminator is missing',
    );
    const administrationIndex = migrator.database.query(
      "SELECT name FROM sqlite_master WHERE type = 'index' " +
      "AND name = 'idx_auth_tenants_administration'"
    ).get() as { name?: string } | null;
    assert(
      administrationIndex?.name === 'idx_auth_tenants_administration',
      'migration 024 administration uniqueness index is missing',
    );

    for (const table of [
      '_auth_sessions',
      '_auth_session_continuations',
      '_auth_native_codes',
      '_auth_native_sessions',
    ]) {
      const columns = migrator.database.query('PRAGMA table_info(' + table + ')')
        .all() as Array<{ name: string }>;
      assert(
        columns.some((column) => column.name === 'mfa_verified_at'),
        'migration 025 MFA assurance column is missing from ' + table,
      );
    }

    const invitationColumns = migrator.database.query(
      'PRAGMA table_info(_auth_tenant_invitations)'
    ).all() as Array<{ name: string }>;
    const invitationColumnNames = new Set(
      invitationColumns.map((column) => column.name),
    );
    for (const name of ['grant_snapshot_json', 'grant_snapshot_fingerprint']) {
      assert(
        invitationColumnNames.has(name),
        'migration 026 invitation grant column is missing: ' + name,
      );
    }

    const manifestColumns = migrator.database.query(
      'PRAGMA table_info(_auth_authorization_manifest)'
    ).all() as Array<{ name: string }>;
    const manifestColumnNames = new Set(manifestColumns.map((column) => column.name));
    for (const name of [
      'singleton', 'version', 'registry_version', 'fingerprint',
      'manifest_json', 'updated_at',
    ]) {
      assert(
        manifestColumnNames.has(name),
        'migration 027 authorization-manifest column is missing: ' + name,
      );
    }
    const manifestTriggerCount = migrator.database.query(
      "SELECT COUNT(*) AS count FROM sqlite_master " +
      "WHERE type = 'trigger' " +
      "AND name LIKE 'trg_zero_authority__auth_authorization_manifest_%'"
    ).get() as { count: number };
    assert(
      manifestTriggerCount.count === 3,
      'migration 027 authorization-manifest authority triggers are missing',
    );
  } finally {
    migrator.dispose();
  }
}

async function smokeAuthProfile(root: string, profile: AuthProfile): Promise<void> {
  const profileName = profile.tenancy + '/' + profile.authorization;
  const profileRoot = join(root, profile.tenancy + '-' + profile.authorization);
  const systemDbPath = await migrateFreshProfileDatabase(profileRoot, profileName);
  const appDbPath = join(profileRoot, 'app.db');
  const bootstrapSecret = 'packed-release-' + profile.tenancy + '-bootstrap-secret-000000000000';
  await mkdir(join(profileRoot, 'app'), { recursive: true });
  const appSqlite = createPlatformSQLiteService({ mode: 'file', path: appDbPath });
  initializeApplicationPlane(appSqlite.raw);

  const tenancy = profile.tenancy === 'multi'
    ? {
        mode: 'multi' as const,
        terminology: { singular: 'workspace', plural: 'workspaces' },
        creation: { mode: 'authenticated' as const },
      }
    : { mode: 'single' as const };
  const authorization = profile.authorization === 'advanced'
    ? {
        mode: 'advanced' as const,
        permissions: {
          'records:read': { label: 'Read records' },
          'records:write': { label: 'Write records' },
        },
        roles: {
          reader: { permissions: ['records:read'] },
          editor: { permissions: ['records:read', 'records:write'] },
        },
      }
    : { mode: 'simple' as const };

  const app = await createApp({
    db: { sqlite: appSqlite },
    systemDb: { mode: 'file', path: systemDbPath },
    tables: {},
    auth: {
      bootstrap: profile.tenancy === 'multi'
        ? { mode: 'secret', secret: bootstrapSecret }
        : 'public',
      registration: { mode: 'public' },
      tenancy,
      authorization,
    },
    routeAuth: 'explicit',
    stateSync: false,
    email: false,
    ai: false,
    vector: false,
    pdf: false,
    kv: false,
    observability: false,
    migrate: false,
    resourceRoutes: false,
    serverResourcesDir: false,
    serverPluginsDir: false,
    serverMiddlewareDir: false,
    serverEndpointsDir: false,
    serverRoutesDir: false,
    storageDir: join(profileRoot, 'storage'),
    appDir: join(profileRoot, 'app'),
    outDir: join(profileRoot, 'out'),
    generatedDir: join(profileRoot, 'generated'),
  });

  app.listen(0);
  try {
    const baseUrl = 'http://localhost:' + app.server!.port;
    await assertHealth(baseUrl, profileName);
    const initialConfig = await assertProfileConfig(
      baseUrl,
      profile.tenancy,
      profile.authorization,
      true,
    );
    assert(
      !JSON.stringify(initialConfig).includes(bootstrapSecret),
      profileName + ' bootstrap secret leaked in config',
    );

    const registrationBody: Record<string, string> = {
      username: 'packed-' + profile.tenancy + '-' + profile.authorization + '-owner',
      email: 'packed-' + profile.tenancy + '-' + profile.authorization + '-owner@example.test',
      password: 'password123',
    };
    if (profile.tenancy === 'multi') {
      registrationBody.organizationName = 'Packed ' + profile.authorization + ' Workspace';
      registrationBody.bootstrapSecret = bootstrapSecret;
    }

    const registration = await postJson(baseUrl + '/auth/register', registrationBody);
    assert(registration.status === 200, profileName + ' bootstrap failed: ' + registration.text);
    assert(registration.body.user?.role === 'admin', profileName + ' bootstrap owner is not admin');
    if (profile.tenancy === 'multi') {
      assert(
        registration.body.tenant?.name === registrationBody.organizationName,
        profileName + ' bootstrap workspace is missing',
      );
      assert(registration.body.tenant?.role === 'owner', profileName + ' tenant owner is missing');
      assert(
        registration.body.tenant?.kind === 'administration',
        profileName + ' bootstrap tenant is not the administration organization',
      );
    } else {
      assert(registration.body.tenant === undefined, profileName + ' returned an unexpected tenant');
    }
    assert(
      !registration.text.includes(bootstrapSecret),
      profileName + ' bootstrap secret leaked in registration',
    );

    const accessToken = requireString(registration.body.accessToken, profileName + ' access token');
    await assertAuthorization(
      baseUrl,
      accessToken,
      profile.tenancy,
      profile.authorization,
      profile.tenancy === 'multi' ? 'tenant' : 'application',
    );
    if (profile.tenancy === 'multi') {
      const tenantConfig = await getJson(baseUrl + '/auth/tenant/config', accessToken);
      assert(tenantConfig.status === 200, profileName + ' tenant config failed');
      assert(
        tenantConfig.body.terminology?.singular === 'workspace'
          && tenantConfig.body.terminology?.plural === 'workspaces',
        profileName + ' tenant terminology was not preserved',
      );
      const memberRole = tenantConfig.body.roles?.find?.(
        (role: { key?: string }) => role.key === 'member',
      );
      assert(
        memberRole?.description === 'Standard workspace membership.',
        profileName + ' framework role metadata ignored tenant terminology',
      );
    }
    await assertProfileConfig(
      baseUrl,
      profile.tenancy,
      profile.authorization,
      false,
    );
  } finally {
    await app.stop(true);
  }

  assertPersistedProfile(systemDbPath, profileRoot, profile);
  assertSeparatedApplicationPlane(appSqlite.raw, profileName);
  appSqlite.close();
}

async function migrateFreshProfileDatabase(
  profileRoot: string,
  profileName: string,
): Promise<string> {
  await mkdir(profileRoot, { recursive: true });
  const dbPath = join(profileRoot, 'platform.db');
  const migrator = new Migrator({
    dbPath,
    migrations,
    backupDir: join(profileRoot, 'migration-backups'),
    log: () => {},
  });

  try {
    assertEqualList(
      migrator.run(),
      expectedVersions,
      profileName + ' fresh migration run',
    );
    const status = migrator.status();
    assert(status.length === expectedVersions.length, profileName + ' migration status mismatch');
    assert(status.every((entry) => entry.applied), profileName + ' has unapplied migrations');
    assert(
      status.every((entry) => entry.checksumMatches === true),
      profileName + ' has a migration checksum mismatch',
    );
    assert(migrator.run().length === 0, profileName + ' migrations are not idempotent');
  } finally {
    migrator.dispose();
  }

  return dbPath;
}

function assertPersistedProfile(
  dbPath: string,
  profileRoot: string,
  profile: AuthProfile,
): void {
  const profileName = profile.tenancy + '/' + profile.authorization;
  const verifier = new Migrator({
    dbPath,
    migrations,
    backupDir: join(profileRoot, 'verification-backups'),
    log: () => {},
  });

  try {
    assert(verifier.run().length === 0, profileName + ' runtime changed migration state');
    assert(tableCount(verifier, 'users') === 1, profileName + ' bootstrap user was not persisted');
    const tenantCount = tableCount(verifier, '_auth_tenants');
    const membershipCount = tableCount(verifier, '_auth_tenant_memberships');
    assert(
      tenantCount === (profile.tenancy === 'multi' ? 1 : 0),
      profileName + ' persisted an unexpected tenant count',
    );
    assert(
      membershipCount === (profile.tenancy === 'multi' ? 1 : 0),
      profileName + ' persisted an unexpected membership count',
    );
    if (profile.tenancy === 'multi') {
      const administrationTenant = verifier.database.query(
        "SELECT kind FROM _auth_tenants WHERE kind = 'administration'"
      ).get() as { kind?: string } | null;
      assert(
        administrationTenant?.kind === 'administration',
        profileName + ' did not persist its protected administration organization',
      );
    }
    const installedProfile = verifier.database.query(\`
      SELECT version, generation, tenancy, authorization
      FROM _auth_installed_profile
      WHERE singleton = 1
    \`).get() as {
      version: number;
      generation: number;
      tenancy: string;
      authorization: string;
    } | null;
    assert(installedProfile?.version === 1, profileName + ' profile version was not persisted');
    assert(
      installedProfile?.generation === 1,
      profileName + ' initial profile generation was not persisted',
    );
    assert(
      installedProfile?.tenancy === profile.tenancy
        && installedProfile?.authorization === profile.authorization,
      profileName + ' persisted the wrong installed auth profile',
    );
    const authorizationManifest = verifier.database.query(\`
      SELECT version, registry_version, fingerprint, manifest_json
      FROM _auth_authorization_manifest
      WHERE singleton = 1
    \`).get() as {
      version: number;
      registry_version: number;
      fingerprint: string;
      manifest_json: string;
    } | null;
    assert(
      authorizationManifest?.version === 1
        && authorizationManifest.registry_version === 1
        && authorizationManifest.fingerprint.length === 64
        && authorizationManifest.manifest_json.length > 0,
      profileName + ' authorization registry manifest was not persisted',
    );
    const applicationOwnerCount = Number((verifier.database.query(\`
      SELECT COUNT(*) AS count FROM _auth_application_role_assignments
      WHERE role_key = 'owner' AND source = 'bootstrap' AND revoked_at IS NULL
    \`).get() as { count: number }).count);
    assert(
      applicationOwnerCount === (profile.tenancy === 'single' && profile.authorization === 'advanced' ? 1 : 0),
      profileName + ' persisted an unexpected application-owner count',
    );
  } finally {
    verifier.dispose();
  }
}

function assertSeparatedApplicationPlane(
  database: Database,
  profileName: string,
): void {
  const authorityTables = database.query(\`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name IN (
          '_auth_sessions', '_auth_tenants', '_auth_config',
          '_auth_api_keys', '_zero_action_tokens', '_zero_resume_tokens'
        )
    \`).all() as Array<{ name: string }>;
  assert(
    authorityTables.length === 0,
    profileName + ' leaked Guardian/Zero authority into the application DB',
  );
  const appProbe = database.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'package_release_probe'"
  ).get() as { name?: string } | null;
  assert(
    appProbe?.name === 'package_release_probe',
    profileName + ' did not preserve the application-owned database plane',
  );
  const userColumns = database.query('PRAGMA table_info("users")')
    .all() as Array<{ name: string; type: string; pk: number }>;
  assert(
    userColumns.length === 0,
    profileName + ' created an identity anchor without a declared Guardian reference',
  );
}

function initializeApplicationPlane(database: Database): void {
  database.run(\`
      CREATE TABLE package_release_probe (
        probe_id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    \`);
}

function tableCount(migrator: Migrator, table: string): number {
  const row = migrator.database.query(
    'SELECT COUNT(*) AS count FROM ' + table,
  ).get() as { count: number };
  return Number(row.count);
}

async function assertHealth(baseUrl: string, profile: string): Promise<void> {
  const response = await fetch(baseUrl + '/api/health');
  assert(response.status === 200, profile + ' health check failed');
}

async function assertProfileConfig(
  baseUrl: string,
  tenancy: 'single' | 'multi',
  authorization: 'simple' | 'advanced',
  bootstrapRequired: boolean,
): Promise<Record<string, any>> {
  const response = await getJson(baseUrl + '/auth/config');
  assert(response.status === 200, tenancy + '/' + authorization + ' config failed');
  assert(response.body.tenancy?.mode === tenancy, 'unexpected tenancy profile');
  if (tenancy === 'multi') {
    assert(
      response.body.tenancy?.terminology?.singular === 'workspace'
        && response.body.tenancy?.terminology?.plural === 'workspaces',
      'unexpected tenant terminology',
    );
  }
  assert(response.body.authorization?.mode === authorization, 'unexpected authorization profile');
  assert(
    response.body.registration?.bootstrapRequired === bootstrapRequired,
    'unexpected bootstrap-required state',
  );
  return response.body;
}

async function assertAuthorization(
  baseUrl: string,
  accessToken: string,
  tenancy: 'single' | 'multi',
  authorization: 'simple' | 'advanced',
  scopeKind: 'application' | 'tenant',
): Promise<Record<string, any>> {
  const response = await getJson(baseUrl + '/auth/authorization', accessToken);
  assert(response.status === 200, tenancy + '/' + authorization + ' authorization failed');
  assert(response.body.profile?.tenancy === tenancy, 'authorization tenancy mismatch');
  assert(response.body.profile?.authorization === authorization, 'authorization mode mismatch');
  assert(response.body.scope?.kind === scopeKind, 'authorization scope mismatch');
  assert(response.body.identity?.platformRole === 'admin', 'bootstrap admin identity is missing');
  if (tenancy === 'multi' || authorization === 'advanced') {
    assert(response.body.scope?.roles?.includes('owner') === true, 'bootstrap owner role is missing');
    assert(response.body.scope?.allPermissions === true, 'bootstrap owner lacks full authority');
  } else {
    assert(response.body.scope?.roles?.includes('admin') === true, 'compatibility admin role is missing');
  }
  if (tenancy === 'multi') {
    assert(typeof response.body.scope?.tenantId === 'string', 'active tenant scope is missing');
    assert(
      response.body.applicationScope?.kind === 'application',
      'administration application scope is missing',
    );
    assert(
      response.body.applicationScope?.roles?.includes('owner') === true
        && response.body.applicationScope?.allPermissions === true,
      'administration application owner authority is missing',
    );
  }
  return response.body;
}

async function getJson(url: string, bearer?: string) {
  const response = await fetch(url, {
    headers: bearer ? { Authorization: 'Bearer ' + bearer } : undefined,
  });
  const text = await response.text();
  return { status: response.status, text, body: parseJson(text, url) };
}

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text, body: parseJson(text, url) };
}

function parseJson(text: string, source: string): Record<string, any> {
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error('Expected JSON from ' + source + ': ' + text);
  }
}

function requireString(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, label + ' is missing');
  return value;
}

function assertEqualList(actual: string[], expected: string[], label: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    label + ' mismatch: ' + JSON.stringify(actual),
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
`;

  await writeFile(join(appDir, 'package-release-smoke.ts'), source);
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
