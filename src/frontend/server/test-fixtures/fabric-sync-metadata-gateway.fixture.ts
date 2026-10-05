/** Same-entry package consumer that starts real Guardian/Fabric gateway and actor processes. */

import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import {
  allOf, authorizationPolicy, createApp, defineResource, defineZeroConfig,
  runDatabaseActorIfRequested, tenantRealm,
} from '@zero/framework/server';
import { guardianActorPolicy } from '@zero/framework/resources';
import { fixtureRealm, fixtureTables, fixtureTableNames } from './fabric-sync-metadata-realm.fixture';

if (!await runDatabaseActorIfRequested({ realm: fixtureRealm })) {
  await runGatewayProof();
}

async function runGatewayProof(): Promise<void> {
  const root = process.cwd();
  const resources = fixtureTableNames.map((name) => defineResource({
    table: name,
    primaryKey: 'id',
    realm: tenantRealm(),
    exposure: 'all',
    policy: allOf(
      authorizationPolicy({ user: 'required', tenant: 'required', permission: 'proof:read' }),
      ...(name.endsWith('_full') ? [guardianActorPolicy({ userField: 'owner_user_id' })] : []),
    ),
  }));
  const config = defineZeroConfig({
    app: { name: 'Package Fabric loading proof', publicUrl: 'http://localhost:3000' },
    db: { mode: 'file', path: join(root, 'runtime', 'application.db') },
    systemDb: { mode: 'file', path: join(root, 'runtime', 'system.db') },
    tables: fixtureTables,
    auth: {
      bootstrap: { mode: 'public' },
      registration: { mode: 'public' },
      tenancy: { mode: 'multi', creation: { mode: 'authenticated' } },
      authorization: {
        mode: 'advanced',
        permissions: { 'proof:read': { scope: 'tenant' } },
        roles: { member: { permissions: ['proof:read'] } },
      },
      accountEmails: { passwordReset: false },
    },
    databaseTopology: {
      mode: 'multiple', tenantIsolation: 'tenant-database', placement: 'file',
      rootDirectory: join(root, 'runtime', 'tenants'), realm: fixtureRealm,
      readers: true, maxDatabases: 8, maxDatabaseFiles: 16,
      maxTenantSyncDatabases: 4,
      actors: { launch: { kind: 'source', entrypoint: join(root, 'gateway.ts') } },
    },
    resources,
    stateSync: false, email: false, ai: false, vector: false, kv: false,
    pdf: false, sitemap: false, workflows: false,
    storageDir: join(root, 'runtime', 'storage'),
    appDir: join(root, 'app'), outDir: join(root, 'build'), generatedDir: join(root, 'generated'),
    serverRoutesDir: join(root, 'routes'), serverResourcesDir: false,
    serverPluginsDir: false, serverEndpointsDir: false, serverMiddlewareDir: false,
    routeAuth: 'explicit', publicPaths: ['/'], observability: { console: false, endpoint: false },
  });

  let app: Awaited<ReturnType<typeof createApp>> | null = null;
  try {
    app = await createApp(config);
    app.listen({ hostname: '127.0.0.1', port: 0 });
    const baseUrl = `http://127.0.0.1:${app.server!.port}`;
    const request = async (path: string, token?: string, body?: unknown) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(body === undefined ? {} : { 'Idempotency-Key': crypto.randomUUID() }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value = await response.json();
      assert.ok(response.ok, `Proof request ${path} failed (${response.status}): ${JSON.stringify(value)}`);
      return value as Record<string, any>;
    };
    const register = (name: string) => request('/auth/register', undefined, {
      username: name, email: `${name}@example.test`, password: 'proof-password-123', organizationName: name,
    });
    await register('platform-owner');
    const owner = await register('customer-owner');
    const other = await register('other-owner');
    for (const principal of [owner, other]) {
      const deadline = Date.now() + 15_000;
      let readiness = await request('/auth/data-realm/readiness', principal.accessToken);
      for (;;) {
        if (readiness.status === 'ready') break;
        assert.notEqual(readiness.status, 'failed', `Tenant readiness failed: ${JSON.stringify(readiness)}`);
        assert.ok(Date.now() < deadline, `Tenant readiness exceeded proof deadline: ${JSON.stringify(readiness)}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
        readiness = await request('/auth/data-realm/readiness/retry', principal.accessToken, {});
      }
    }

    for (const name of fixtureTableNames) {
      const created = await request(`/api/resources/${name}`, owner.accessToken, { id: `${name}-row`, title: name });
      assert.equal(created.row.title, name);
      if (name.endsWith('_full')) assert.equal(created.row.owner_user_id, owner.user.userId);
      const rows = await request(`/api/resources/${name}`, owner.accessToken);
      assert.equal(rows.rows.length, 1);
      assert.equal((await request(`/api/resources/${name}`, other.accessToken)).rows.length, 0);
    }
    const actor = await request('/proof/actor', owner.accessToken);
    for (const item of actor.tables) {
      const mode = item.name.split('_').at(-1);
      assert.equal(item.declaredMode, mode === 'omitted' ? null : mode);
      assert.equal(item.hasValidator, true);
      assert.equal(item.count, 1);
      assert.ok(!item.sql.includes('_sync'), 'Loading metadata must not become a SQL column.');
      assert.equal(item.guardianReferences.length, mode === 'full' ? 1 : 0);
      if (mode === 'full') assert.match(item.sql, /REFERENCES\s+users\s*\(\s*user_id\s*\)/i);
    }
    assert.equal(actor.manager.coordinator.readersEnabled, true);
    assert.ok(actor.manager.coordinator.databases.length >= 2);
    for (const database of actor.manager.coordinator.databases) {
      assert.equal(database.state, 'ready');
      assert.ok(database.writerGeneration >= 1);
      assert.ok(database.readerGeneration >= 1);
    }
    const pageResponse = await fetch(`${baseUrl}/`);
    const html = await pageResponse.text();
    assert.equal(pageResponse.status, 200, `Gateway page failed: ${html.slice(0, 800)}`);
    const serialized = html.match(/window\.__PLATFORM_CONFIG__=(.*?)<\/script>/s)?.[1];
    assert.ok(serialized, `Gateway SSR did not expose its loading contract: ${html.slice(0, 800)}`);
    const publicConfig = JSON.parse(serialized);
    for (const name of fixtureTableNames) {
      assert.equal(publicConfig.tableSyncModes[name], name.endsWith('_full') ? 'full' : 'lazy');
      assert.equal(publicConfig.tableSyncPlanes[name], 'tenant');
    }

    await app.stop(true);
    app = null;
    // Same persisted fresh fixture proves startup does not invent SQL drift and
    // the independently loaded actor realm remains compatible after restart.
    app = await createApp(config);
    app.listen({ hostname: '127.0.0.1', port: 0 });
    const restartUrl = `http://127.0.0.1:${app.server!.port}`;
    const restarted = await fetch(`${restartUrl}/proof/actor`, { headers: { Authorization: `Bearer ${owner.accessToken}` } });
    assert.equal(restarted.status, 200);
    const restartedActor = await restarted.json() as Record<string, any>;
    assert.deepEqual(restartedActor.tables, actor.tables);
    console.log('[zero-public-fabric-sync-metadata] complete');
  } finally {
    await app?.stop(true);
  }
}
