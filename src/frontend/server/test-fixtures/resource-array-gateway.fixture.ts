/** Installed-package proof: public resource constraints through real Guardian/Fabric startup. */
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import {
  authenticatedOnly, createApp, customPolicy, defineResource, defineZeroConfig,
  runDatabaseActorIfRequested, tenantRealm, type ResourceArrayOverlapConstraint,
} from '@zero/framework/server';
import { realm, tasks } from './resource-array-realm.fixture';

if (!await runDatabaseActorIfRequested({ realm })) await gatewayProof();

async function gatewayProof(): Promise<void> {
  const root = process.cwd();
  const constraint = {
    type: 'field', field: '_access_groups_json', operator: 'arrayOverlaps', value: ['A'],
  } satisfies ResourceArrayOverlapConstraint;
  const read = customPolicy(({ user }) => user
    ? { allowed: true, constraints: [constraint] }
    : false, { name: 'package-exact-array-read' });
  const config = defineZeroConfig({
    app: { name: 'Package array policy proof', publicUrl: 'http://localhost:3000' },
    db: { mode: 'file', path: join(root, 'runtime', 'application.db') },
    systemDb: { mode: 'file', path: join(root, 'runtime', 'system.db') },
    tables: { tasks: tasks.serverTable },
    resources: [defineResource({
      table: tasks, exposure: 'all', realm: tenantRealm(), actions: ['list', 'get', 'create'],
      policy: { list: read, get: read, create: authenticatedOnly() },
    })],
    auth: {
      bootstrap: { mode: 'public' }, registration: { mode: 'public' },
      tenancy: { mode: 'multi', creation: { mode: 'authenticated' } },
      authorization: {
        mode: 'advanced', permissions: { 'proof:read': { scope: 'tenant' } },
        roles: { member: { permissions: ['proof:read'] } },
      }, accountEmails: { passwordReset: false },
    },
    databaseTopology: {
      mode: 'multiple', tenantIsolation: 'tenant-database', placement: 'file', realm,
      rootDirectory: join(root, 'runtime', 'tenants'), readers: true,
      maxDatabases: 8, maxDatabaseFiles: 16, maxTenantSyncDatabases: 4,
      actors: { launch: { kind: 'source', entrypoint: join(root, 'gateway.ts') } },
    },
    stateSync: false, email: false, ai: false, vector: false, kv: false,
    pdf: false, sitemap: false, workflows: false,
    storageDir: join(root, 'runtime', 'storage'),
    appDir: join(root, 'app'), outDir: join(root, 'build'), generatedDir: join(root, 'generated'),
    serverRoutesDir: join(root, 'routes'), serverResourcesDir: false,
    serverPluginsDir: false, serverEndpointsDir: false, serverMiddlewareDir: false,
    routeAuth: 'explicit', publicPaths: ['/'], observability: { console: false, endpoint: false },
  });
  const app = await createApp(config);
  try {
    app.listen({ hostname: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${app.server!.port}`;
    async function request(path: string, token?: string, body?: unknown, status = 200) {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : {
            'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(),
          }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value = await response.json() as Record<string, any>;
      assert.equal(response.status, status, `Package request ${path}: ${JSON.stringify(value)}`);
      return value;
    }
    async function register(name: string, provision = true) {
      const principal = await request('/auth/register', undefined, {
        username: name, email: `${name}@example.test`, password: 'array-proof-password-123', organizationName: name,
      });
      if (!provision) return principal;
      const deadline = Date.now() + 15_000;
      for (;;) {
        const readiness = await request('/auth/data-realm/readiness', principal.accessToken);
        // This realm has no Guardian FK anchors. No identity projection is
        // required; Fabric itself opens its file on the first bound operation.
        if (readiness.status === 'ready' || readiness.status === 'not-required') return principal;
        assert.notEqual(readiness.status, 'failed', 'Tenant realm failed to provision.');
        assert.ok(Date.now() < deadline, `Tenant realm readiness deadline exceeded: ${JSON.stringify(readiness)}`);
        await request('/auth/data-realm/readiness/retry', principal.accessToken, {});
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    await register('platform-owner', false);
    const first = await register('first-organization');
    const second = await register('second-organization');
    for (const [id, groups] of [
      ['a', ['B', 'A']], ['b', ['B']], ['c', ['A', 'A']], ['d', []], ['e', ['a']],
    ] as const) {
      await request('/api/resources/tasks', first.accessToken, {
        id, title: id, _access_groups_json: JSON.stringify(groups),
      }, 201);
    }
    await request('/api/resources/tasks', second.accessToken, {
      id: 'second-only', title: 'Other organization', _access_groups_json: JSON.stringify(['A']),
    }, 201);
    const visible = await request('/api/resources/tasks?sort=id:asc', first.accessToken);
    assert.deepEqual(visible.rows.map((row: { id: string }) => row.id), ['a', 'c']);
    assert.equal(visible.page.count, 2);
    const lazy = await request('/api/data?table=tasks&sort=id:asc', first.accessToken);
    assert.deepEqual(lazy.rows.map((row: { id: string }) => row.id), ['a', 'c']);
    const proof = await request('/proof/arrays', first.accessToken);
    assert.deepEqual(proof.reader.map((row: { id: string }) => row.id), ['a', 'c']);
    assert.deepEqual(proof.writer, proof.reader);
    assert.deepEqual(proof.first.rows.map((row: { id: string }) => row.id), ['a']);
    assert.deepEqual(proof.next.rows.map((row: { id: string }) => row.id), ['c']);
    assert.equal(proof.next.nextCursor, null);
    const other = await request('/api/resources/tasks', second.accessToken);
    assert.deepEqual(other.rows.map((row: { id: string }) => row.id), ['second-only']);
    await request('/api/resources/tasks/b', first.accessToken, undefined, 403);
    console.log('[zero-public-resource-array] complete');
  } finally {
    await app.stop(true);
  }
}
