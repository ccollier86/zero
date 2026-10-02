import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { databaseActorFixtureRealm } from '../../databases/test-fixtures/database-actor-realm';
import { createApp } from './app-factory';

const DATABASE_ACTOR_ENTRYPOINT = fileURLToPath(new URL(
  '../../databases/test-fixtures/database-actor-same-entry.ts',
  import.meta.url,
));

type CapabilityTopology = 'single' | 'multiple-shared-row';

interface CapabilityProbe {
  readonly dataIsNull: boolean;
  readonly unsafeVisible: boolean;
  readonly databasesVisible: boolean;
  readonly unsafeReadBlocked: boolean;
  readonly databasesReadBlocked: boolean;
  readonly managerAvailableAtSetup: boolean;
  readonly multipleEnabledAtSetup: boolean;
  readonly tenantDatabasesEnabledAtSetup: boolean;
}

describe('managed workflow capability topology', () => {
  test('keeps the strict workflow surface closed in shared single-database mode', async () => {
    expect(await runCapabilityProof('single')).toEqual({
      dataIsNull: true,
      unsafeVisible: false,
      databasesVisible: false,
      unsafeReadBlocked: true,
      databasesReadBlocked: true,
      managerAvailableAtSetup: true,
      multipleEnabledAtSetup: false,
      tenantDatabasesEnabledAtSetup: false,
    });
  }, 60_000);

  test('keeps named/multiple infrastructure privileged in shared-row mode', async () => {
    expect(await runCapabilityProof('multiple-shared-row')).toEqual({
      dataIsNull: true,
      unsafeVisible: false,
      databasesVisible: false,
      unsafeReadBlocked: true,
      databasesReadBlocked: true,
      managerAvailableAtSetup: true,
      multipleEnabledAtSetup: true,
      tenantDatabasesEnabledAtSetup: false,
    });
  }, 60_000);
});

async function runCapabilityProof(
  topology: CapabilityTopology,
): Promise<CapabilityProbe> {
  const base = join(process.cwd(), '.zero');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, `workflow-capability-${topology}-`));
  const appDir = join(root, 'app');
  const pluginsDir = join(root, 'server', 'plugins');
  await Promise.all([
    mkdir(appDir, { recursive: true }),
    mkdir(pluginsDir, { recursive: true }),
  ]);
  await writeCapabilityPlugin(pluginsDir);

  let app: Awaited<ReturnType<typeof createApp>> | null = null;
  try {
    app = await createApp({
      db: { mode: 'memory' },
      tables: {},
      auth: {
        tenancy: 'multi',
        bootstrap: 'public',
        registration: { mode: 'public' },
        accountEmails: { passwordReset: false },
      },
      ...(topology === 'multiple-shared-row'
        ? {
            databaseTopology: {
              mode: 'multiple' as const,
              rootDirectory: join(root, 'fabric'),
              realm: databaseActorFixtureRealm,
              actors: {
                launch: {
                  kind: 'source' as const,
                  entrypoint: DATABASE_ACTOR_ENTRYPOINT,
                },
              },
              tenantIsolation: 'shared-row' as const,
            },
          }
        : {}),
      workflows: {},
      resourceRoutes: false,
      appDir,
      outDir: join(root, 'out'),
      storageDir: join(root, 'storage'),
      serverResourcesDir: false,
      serverPluginsDir: pluginsDir,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      observability: false,
      email: false,
      ai: false,
      vector: false,
      pdf: false,
      kv: false,
    });
    app.listen(0);
    const url = `http://localhost:${app.server!.port}`;
    const registration = await requestJson(url, 'POST', '/auth/register', {
      username: `capability-${topology}`,
      email: `capability-${topology}@example.test`,
      password: 'password123',
      organizationName: `Capability ${topology}`,
    });
    expect(registration.status).toBe(200);
    const token = String(registration.body.accessToken);
    const started = await requestJson(
      url,
      'POST',
      '/workflows',
      { name: 'workflow-capability-proof', input: {} },
      token,
    );
    expect(started.status).toBe(200);
    const instance = await requestJson(
      url,
      'GET',
      `/workflows/${String(started.body.instanceId)}`,
      undefined,
      token,
    );
    expect(instance).toMatchObject({
      status: 200,
      body: { status: 'completed', input: null, output: null, error: null },
    });
    const notifications = await requestJson(
      url,
      'GET',
      '/notifications',
      undefined,
      token,
    );
    expect(notifications.status).toBe(200);
    const proof = (notifications.body.notifications as Array<Record<string, unknown>>)
      .find((notification) => typeof notification.title === 'string'
        && notification.title.startsWith('capability:'));
    expect(proof?.title).toBeString();
    return JSON.parse(String(proof!.title).slice('capability:'.length)) as CapabilityProbe;
  } finally {
    await app?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}

async function writeCapabilityPlugin(pluginsDir: string): Promise<void> {
  const serverImport = pathToFileURL(
    join(process.cwd(), 'src/frontend/server.ts'),
  ).href;
  await writeFile(join(pluginsDir, 'workflow-capability-proof.ts'), [
    `import { defineZeroPlugin } from ${JSON.stringify(serverImport)};`,
    'export default defineZeroPlugin({',
    "  name: 'test.workflow-capability-proof',",
    '  setup({ zero }) {',
    '    const managerAvailableAtSetup = Boolean(zero.databases);',
    '    const managerDiagnostics = zero.databases?.diagnostics();',
    '    const registry = zero.workflowRegistry;',
    "    if (!registry) throw new Error('workflow registry unavailable');",
    "    registry.registerHandler('workflow-capability-proof', async (context) => {",
    '      const services = context.zero;',
    "      if (!services) throw new Error('managed workflow services unavailable');",
    '      let unsafeReadBlocked = false;',
    '      let databasesReadBlocked = false;',
    '      try { void services.unsafe; } catch { unsafeReadBlocked = true; }',
    '      try { void services.databases; } catch { databasesReadBlocked = true; }',
    '      const proof = {',
    '        dataIsNull: services.data === null,',
    "        unsafeVisible: 'unsafe' in services || Object.keys(services).includes('unsafe'),",
    "        databasesVisible: 'databases' in services || Object.keys(services).includes('databases'),",
    '        unsafeReadBlocked,',
    '        databasesReadBlocked,',
    '        managerAvailableAtSetup,',
    '        multipleEnabledAtSetup: managerDiagnostics?.multipleEnabled ?? false,',
    '        tenantDatabasesEnabledAtSetup: managerDiagnostics?.tenantDatabasesEnabled ?? false,',
    '      };',
    '      services.notifications.create({',
    "        title: 'capability:' + JSON.stringify(proof),",
    '      }, context.execution.userId);',
    '      return proof;',
    '    });',
    '    registry.create({',
    "      name: 'workflow-capability-proof',",
    "      steps: [{ name: 'Probe capabilities', handler: 'workflow-capability-proof' }],",
    '    });',
    '  },',
    '});',
    '',
  ].join('\n'));
}

async function requestJson(
  url: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Record<string, any>,
  };
}
