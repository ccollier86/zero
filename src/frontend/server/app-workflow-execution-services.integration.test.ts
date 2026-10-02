import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createApp } from './app-factory';

describe('managed workflow execution services', () => {
  test('installs a tenant-scoped ctx.zero facade without raw service escape', async () => {
    const baseDir = join(process.cwd(), '.zero');
    await mkdir(baseDir, { recursive: true });
    const root = await mkdtemp(join(baseDir, 'test-workflow-services-'));
    const appDir = join(root, 'app');
    const pluginsDir = join(root, 'server', 'plugins');
    await mkdir(appDir, { recursive: true });
    await mkdir(pluginsDir, { recursive: true });
    const serverImport = pathToFileURL(
      join(process.cwd(), 'src/frontend/server.ts'),
    ).href;
    await writeFile(join(pluginsDir, 'workflow-proof.ts'), [
      `import { defineZeroPlugin } from '${serverImport}';`,
      'export default defineZeroPlugin({',
      "  name: 'test.workflow-execution-services',",
      '  setup({ zero }) {',
      '    const registry = zero.workflowRegistry;',
      "    if (!registry) throw new Error('workflow registry unavailable');",
      "    registry.registerHandler('managed-zero-proof', async (context) => {",
      '      const services = context.zero;',
      "      if (!services) throw new Error('ctx.zero unavailable');",
      '      let unsafeBlocked = false;',
      '      let dbBlocked = false;',
      '      try { void services.unsafe; } catch { unsafeBlocked = true; }',
      '      try { void services.db; } catch { dbBlocked = true; }',
      "      if (!unsafeBlocked || !dbBlocked) throw new Error('unsafe workflow service escape');",
      '      const drive = services.storage.createDrive(context.execution.userId, {',
      "        name: 'Workflow drive',",
      '      });',
      '      const notice = services.notifications.create({',
      "        title: 'Workflow notice',",
      '      }, context.execution.userId);',
      '      return {',
      '        tenantId: services.scope.tenantId,',
      '        executionTenantId: context.execution.tenantId,',
      '        driveTenantId: drive.tenant_id,',
      '        notificationTenantId: notice.tenant_id,',
      '        unsafeBlocked,',
      '        dbBlocked,',
      '      };',
      '    });',
      '    registry.create({',
      "      name: 'managed-zero-proof',",
      "      steps: [{ name: 'Proof', handler: 'managed-zero-proof' }],",
      '    });',
      '  },',
      '});',
      '',
    ].join('\n'));

    let app: Awaited<ReturnType<typeof createApp>> | null = null;
    try {
      app = await createApp({
        db: { mode: 'memory' },
        migrate: false,
        tables: {},
        auth: {
          tenancy: 'multi',
          bootstrap: 'public',
          registration: { mode: 'public' },
          accountEmails: { passwordReset: false },
        },
        appDir,
        outDir: join(root, 'out'),
        storageDir: join(root, 'storage'),
        serverResourcesDir: false,
        serverPluginsDir: pluginsDir,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: false,
        resourceRoutes: false,
        observability: false,
        email: false,
        ai: false,
        vector: false,
        pdf: false,
        kv: false,
      });
      app.listen(0);
      const baseUrl = `http://localhost:${app.server!.port}`;
      const registration = await jsonRequest(baseUrl, 'POST', '/auth/register', {
        username: 'workflow-owner',
        email: 'workflow-owner@example.test',
        password: 'password123',
        organizationName: 'Workflow Organization',
      });
      expect(registration.status).toBe(200);
      const accessToken = String(registration.body.accessToken);
      const tenantId = String((registration.body.tenant as { tenantId?: string }).tenantId);

      const started = await jsonRequest(
        baseUrl,
        'POST',
        '/workflows',
        { name: 'managed-zero-proof', input: {} },
        accessToken,
      );
      expect(started.status).toBe(200);
      const instanceId = String(started.body.instanceId);
      const instance = await jsonRequest(
        baseUrl,
        'GET',
        `/workflows/${instanceId}`,
        undefined,
        accessToken,
      );
      expect(instance.status).toBe(200);
      expect(instance.body).toMatchObject({ status: 'completed', output: null });

      const drives = await jsonRequest<Array<Record<string, unknown>>>(
        baseUrl,
        'GET',
        '/storage/drives',
        undefined,
        accessToken,
      );
      expect(drives.status).toBe(200);
      expect(drives.body).toEqual([
        expect.objectContaining({ name: 'Workflow drive', tenant_id: tenantId }),
      ]);

      const notifications = await jsonRequest(
        baseUrl,
        'GET',
        '/notifications',
        undefined,
        accessToken,
      );
      expect(notifications.status).toBe(200);
      expect((notifications.body.notifications as Array<Record<string, unknown>>)).toEqual([
        expect.objectContaining({ title: 'Workflow notice', tenant_id: tenantId }),
      ]);
    } finally {
      await app?.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});

async function jsonRequest<TBody = Record<string, unknown>>(
  baseUrl: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  token?: string,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as TBody,
  };
}
