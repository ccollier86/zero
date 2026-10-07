/**
 * guardian-fabric-proof-fixture.test.ts
 *
 * Keeps the shipped Guardian + Fabric proof application executable as Zero's
 * public contracts evolve. Browser behavior belongs to acceptance coverage;
 * this fixture owns deterministic Doctor and server-build smoke checks only.
 */

import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { tasksResource } from '../../../examples/guardian-fabric-proof/server/resources/tasks';
import type { ResourcePolicy } from '../../resources';

const REPOSITORY_ROOT = process.cwd();
const PROOF_ROOT = join(REPOSITORY_ROOT, 'examples', 'guardian-fabric-proof');
const PROOF_CONFIG_FACTORY = new URL('../../../examples/guardian-fabric-proof/server/proof-config.ts', import.meta.url).href;
const PROOF_SERVER = join(PROOF_ROOT, 'app', 'server.ts');
const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
const COMMAND_TIMEOUT_MS = 45_000;

interface DoctorFinding {
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
}

interface DoctorReport {
  readonly ok: boolean;
  readonly findings: readonly DoctorFinding[];
}

describe('Guardian + Fabric proof fixture', () => {
  test('keeps the shipped task Resource physically tenant-bound and customer-only', () => {
    expect(tasksResource).toMatchObject({
      table: 'tasks',
      exposure: 'all',
      realm: { kind: 'tenant' },
    });

    for (const [action, kind, permissions, tenantBranches] of [
      ['list', 'any-of', ['tasks:read:any', 'tasks:read'], 2],
      ['get', 'any-of', ['tasks:read:any', 'tasks:read'], 2],
      ['create', 'all-of', ['tasks:create'], 1],
      ['update', 'any-of', ['tasks:manage', 'tasks:update:own'], 2],
      ['delete', 'all-of', ['tasks:manage'], 1],
    ] as const) {
      const policy = tasksResource.policy[action];
      expect(policy?.kind).toBe(kind);

      const authorizationPolicies = policyDescendants(policy, 'authorization');
      expect(authorizationPolicies.map((item) =>
        item.diagnostics?.authorizationRequirement?.allPermissions?.[0],
      )).toEqual([...permissions]);
      for (const authorizationPolicy of authorizationPolicies) {
        expect(authorizationPolicy.diagnostics?.authorizationRequirement?.credentialKinds)
          .toEqual(['api-key', 'session']);
      }

      const tenantPolicies = policyDescendants(policy, 'tenant-kind');
      expect(tenantPolicies).toHaveLength(tenantBranches);
      for (const tenantPolicy of tenantPolicies) {
        expect(tenantPolicy.diagnostics?.tenantKinds).toEqual(['organization']);
      }
    }
  });

  test('passes configuration-only Doctor with isolated nonexistent physical-tenant data paths', async () => {
    await mkdir(SCRATCH, { recursive: true });
    const temporaryRoot = await mkdtemp(join(SCRATCH, 'guardian-proof-doctor-'));
    const configPath = join(temporaryRoot, 'zero.config.ts');
    const paths = {
      applicationDatabase: join(temporaryRoot, 'data', 'application.db'),
      systemDatabase: join(temporaryRoot, 'data', 'system.db'),
      tenantDatabases: join(temporaryRoot, 'data', 'tenant-databases'),
      app: join(PROOF_ROOT, 'app'),
      storage: join(temporaryRoot, 'data', 'storage'),
      generated: join(temporaryRoot, '.zero', 'generated'),
      output: join(temporaryRoot, '.build'),
    };
    const absentPaths = [join(temporaryRoot, 'data'), join(temporaryRoot, '.zero'),
      paths.output, paths.applicationDatabase, paths.systemDatabase, paths.tenantDatabases, paths.storage];
    // The pure factory preserves the shipped contract; only fixture-owned paths
    // change. Never inspect or migrate the runnable proof's retained databases.
    const wrapper = `
      import { createGuardianFabricProofConfig } from ${JSON.stringify(PROOF_CONFIG_FACTORY)};
      export default {
        ...createGuardianFabricProofConfig({
          port: 3100,
          publicUrl: 'http://127.0.0.1:3100',
          bootstrap: { mode: 'secret', secret: 'guardian-fabric-proof-smoke-secret-32-bytes' },
          paths: ${JSON.stringify(paths)},
        }),
        projectRoot: ${JSON.stringify(temporaryRoot)},
      };
    `;

    try {
      await Bun.write(configPath, wrapper);
      await expectMissingPaths(absentPaths);
      const result = await spawnBounded([
        process.execPath,
        '--no-env-file',
        join(REPOSITORY_ROOT, 'src', 'doctor', 'run.ts'),
        '--config', configPath,
        '--no-usage-audit',
        '--json',
      ], { NODE_ENV: 'test', TMPDIR: SCRATCH });
      const report = JSON.parse(result.stdout) as DoctorReport;

      expect(result.exitCode).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
      expect(
        report.findings
          .filter((finding) => finding.severity === 'warning')
          .filter((finding) => finding.code !== 'database.receipts.permanent_key_capacity'),
      ).toEqual([]);

      const findingCodes = report.findings.map((finding) => finding.code);
      expect(findingCodes).toContain('database.topology.multiple_enabled');
      expect(findingCodes).toContain('database.tenant_isolation.physical');
      expect(findingCodes).toContain('database.sync.actor_capacity_reserved');
      expect(findingCodes).toContain('resource.tenant_database.physical_boundary');
      await expectMissingPaths(absentPaths);
      expect(await readdir(temporaryRoot)).toEqual(['zero.config.ts']);
      expect(await Bun.file(configPath).text()).toBe(wrapper);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);

  test('bundles the proof server through public package exports', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'zero-guardian-fabric-proof-'));
    const outdir = join(temporaryRoot, 'build');

    try {
      const result = await spawnBounded([
        process.execPath,
        'build',
        PROOF_SERVER,
        '--target',
        'bun',
        '--outdir',
        outdir,
      ], Bun.env);

      expect(result.exitCode).toBe(0);
      await expect(
        stat(join(outdir, 'server.js')).then((entry) => entry.isFile()),
      ).resolves.toBe(true);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);
});

async function expectMissingPaths(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}

function policyDescendants(
  policy: ResourcePolicy | undefined,
  kind: ResourcePolicy['kind'],
): ResourcePolicy[] {
  if (!policy) return [];
  return [
    ...(policy.kind === kind ? [policy] : []),
    ...(policy.diagnostics?.children ?? []).flatMap((child) =>
      policyDescendants(child, kind)),
  ];
}

async function spawnBounded(
  command: readonly string[],
  env: Record<string, string | undefined>,
): Promise<{ exitCode: number; stdout: string }> {
  const process = Bun.spawn([...command], {
    cwd: REPOSITORY_ROOT,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    process.kill();
  }, COMMAND_TIMEOUT_MS);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);

    if (timedOut) {
      throw new Error(`Command exceeded ${COMMAND_TIMEOUT_MS}ms: ${command.join(' ')}`);
    }
    if (exitCode !== 0) {
      throw new Error(
        `Command failed (${command.join(' ')}):\n${stdout}\n${stderr}`,
      );
    }
    return { exitCode, stdout };
  } finally {
    clearTimeout(timeout);
  }
}
