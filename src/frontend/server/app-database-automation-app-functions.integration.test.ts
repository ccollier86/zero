/**
 * Public createApp/Fabric proof for ordinary parameterized app functions.
 * Uses real Guardian registration, HTTP writes, Bun actors and durable retry;
 * the fixture dispatcher is app-owned and never calls Torrent or a fake DB.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authenticatedOnly, createApp, defineResource, tenantRealm,
  type DatabaseSerializableValue,
} from '../server';
import { deriveTenantDatabaseId } from '../../databases/database-binding-ref';
import { encodeDatabaseFileName } from '../../databases/database-file';
import { appFunctionRealm, appFunctionTables } from './test-fixtures/automation-app-functions/realm';
import {
  blockAppFunction, functionCalls, resetAppFunctionFixture, type FixtureFunctionArguments,
} from './test-fixtures/automation-app-functions/dispatcher';

type App = Awaited<ReturnType<typeof createApp>>;
interface Principal { accessToken: string; tenant: { tenantId: string } }
interface Fixture { app: App; root: string; base: string; owner: Principal; alpha: Principal; beta: Principal }
const apps = new Set<App>();
const roots = new Set<string>();

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.stop(true)));
  apps.clear();
  resetAppFunctionFixture();
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
}, 30_000);

describe('parameterized app functions from Fabric database changes', () => {
  test('captures exact arguments/version and retries one accepted effect without changing scope or identity', async () => {
    const fixture = await createFixture();
    const { alpha, beta, base } = fixture;
    const parameters = argumentsFor('published-one', 'retry-once', beta.tenant.tenantId);
    const gate = blockAppFunction(parameters.recordId);
    await request(fixture, '/api/resources/published_documents', beta, 'POST', {
      id: parameters.foreignRecordId, title: 'Beta private', labels: '[]', score: 1,
      actual_tenant_id: beta.tenant.tenantId,
    }, 201);
    await createJob(fixture, alpha, 'job-one', parameters);
    await bounded(gate.entered, 'app function admission');

    // UPDATE does not match the INSERT trigger. The pending command must keep
    // its committed snapshot rather than reread these later business values.
    await request(fixture, '/api/resources/function_jobs/job-one', alpha, 'PATCH', {
      parameters_json: JSON.stringify({ ...parameters, title: 'Changed after capture', multiplier: 999 }),
    });
    gate.release();
    const status = await eventually(async () => request(
      fixture, '/proof/function-jobs/job-one', alpha,
    ), (value) => value.status === 'completed', 'durable app function completion');
    expect(status).toMatchObject({ attempt_count: 2, source_row_id: 'job-one' });

    const calls = functionCalls.filter((call) => call.parameters.recordId === parameters.recordId);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatchObject({
        name: 'documents.publish', version: 2, parameters,
        tenantId: alpha.tenant.tenantId, foreignRecord: null, accepted: true,
        functionIdentity: 'function:jobs.invoke-app-function@1',
      });
      expect(call.signal).toBeInstanceOf(AbortSignal);
      expect(call.invocationId).toBe(status.invocation_id);
      expect('databases' in call.zero).toBe(false);
      expect('unsafe' in call.zero).toBe(false);
      expect(Object.isFrozen(call.zero.scope)).toBe(true);
    }
    expect(calls[1]!.idempotencyKey).toBe(calls[0]!.idempotencyKey);
    expect(calls[1]!.signal).not.toBe(calls[0]!.signal);
    expect(calls[0]!.errorCode).toBe('APP_FUNCTION_FAILED');
    const rows = await request(fixture, '/api/resources/published_documents', alpha);
    expect(rows.rows).toEqual([{
      id: parameters.recordId, title: parameters.title, labels: JSON.stringify(parameters.labels),
      score: parameters.multiplier * 7, actual_tenant_id: alpha.tenant.tenantId,
    }]);
    const other = await request(fixture, '/api/resources/published_documents', beta);
    expect(other.rows).toHaveLength(1);
    expect(other.rows[0].id).toBe(parameters.foreignRecordId);
    await request(fixture, `/api/resources/published_documents/${parameters.recordId}`, beta, 'GET', undefined, 404);
    await expect(calls[0]!.zero.data!.get('published_documents', parameters.recordId))
      .rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });
    expect(base).toContain('127.0.0.1');
  }, 45_000);

  test('fences a suspended source after await and aborts another app function on managed shutdown', async () => {
    const fixture = await createFixture();
    const alphaArguments = argumentsFor('revoked-write', 'blocked', fixture.beta.tenant.tenantId);
    const suspended = blockAppFunction(alphaArguments.recordId);
    await createJob(fixture, fixture.alpha, 'revocation-job', alphaArguments);
    await bounded(suspended.entered, 'revocation barrier');
    await request(fixture, `/auth/platform/tenants/${fixture.alpha.tenant.tenantId}`,
      fixture.owner, 'PATCH', { status: 'suspended', expectedAuthorizationGeneration: 0 });
    suspended.release();
    await eventually(async () => functionCalls.find((call) => call.parameters.recordId === alphaArguments.recordId),
      (call) => Boolean(call?.errorCode), 'revoked app-function rejection');
    const revokedCall = functionCalls.find((call) => call.parameters.recordId === alphaArguments.recordId)!;
    expect(revokedCall.accepted).toBe(false);
    expect(revokedCall.errorCode).toBe('DATABASE_AUTHORITY_CHANGED');

    const betaArguments = argumentsFor('shutdown-write', 'blocked', fixture.alpha.tenant.tenantId);
    const blocked = blockAppFunction(betaArguments.recordId);
    await createJob(fixture, fixture.beta, 'shutdown-job', betaArguments);
    await bounded(blocked.entered, 'shutdown barrier');
    const interrupted = functionCalls.find((call) => call.parameters.recordId === betaArguments.recordId)!;
    await bounded(fixture.app.stop(true), 'managed app shutdown');
    apps.delete(fixture.app);
    expect(interrupted.signal.aborted).toBe(true);
    expect(interrupted.accepted).toBe(false);
    await expect(interrupted.zero.data!.get('published_documents', betaArguments.recordId)).rejects.toBeDefined();
    blocked.release();

    // Independent persisted-state verification after shutdown: neither late handler
    // was able to write its physical tenant file past the live authority fence.
    for (const principal of [fixture.alpha, fixture.beta]) {
      const path = join(fixture.root, 'fabric', encodeDatabaseFileName(deriveTenantDatabaseId(principal.tenant.tenantId)));
      expect(await Bun.file(path).exists(), path).toBe(true);
      const database = new Database(path, { create: false, strict: true });
      try {
        database.exec('PRAGMA query_only = ON');
        expect(database.query('SELECT id FROM published_documents').all()).toEqual([]);
      } finally { database.close(false); }
    }
  }, 45_000);
});

async function createFixture(): Promise<Fixture> {
  resetAppFunctionFixture();
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'automation-app-functions-'));
  roots.add(root);
  await mkdir(join(root, 'app'));
  const app = await createApp({
    db: { mode: 'file', path: join(root, 'application.db') },
    systemDb: { mode: 'file', path: join(root, 'system.db') }, tables: appFunctionTables,
    resources: Object.keys(appFunctionTables).map((table) => defineResource({
      table, exposure: 'all', realm: tenantRealm(), policy: authenticatedOnly(),
    })),
    auth: { bootstrap: 'public', registration: { mode: 'public' }, tenancy: 'multi',
      accountEmails: { passwordReset: false } },
    databaseTopology: {
      mode: 'multiple', rootDirectory: join(root, 'fabric'), realm: appFunctionRealm,
      tenantIsolation: 'tenant-database', placement: 'file', readers: true, sweepIntervalMs: false,
      actors: { launch: { kind: 'source', entrypoint: fileURLToPath(new URL(
        './test-fixtures/automation-app-functions/actor.ts', import.meta.url,
      )) } },
    },
    appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'),
    storageDir: join(root, 'storage'),
    serverRoutesDir: false, serverEndpointsDir: fileURLToPath(new URL(
      './test-fixtures/automation-app-functions/endpoints', import.meta.url,
    )), serverPluginsDir: false,
    serverMiddlewareDir: false, serverResourcesDir: false,
    workflows: false, email: false, stateSync: false, ai: false, vector: false, pdf: false, kv: false,
    sitemap: false, observability: { console: false, endpoint: false },
  });
  apps.add(app);
  app.listen({ hostname: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${app.server!.port}`;
  const seed = { app, root, base } as Fixture;
  async function register(label: string): Promise<Principal> {
    const name = `${label}-${crypto.randomUUID()}`;
    const result = await request(seed, '/auth/register', undefined, 'POST', {
      username: name, email: `${name}@example.test`, password: 'app-function-proof-123', organizationName: name,
    });
    expect(result.accessToken).toBeString();
    expect(result.tenant.tenantId).toBeString();
    return result as Principal;
  }
  return { app, root, base, owner: await register('owner'), alpha: await register('alpha'), beta: await register('beta') };
}

function argumentsFor(recordId: string, behavior: FixtureFunctionArguments['behavior'], requestedTenantId: string): FixtureFunctionArguments {
  return { recordId, title: 'Captured title', labels: ['one', 'two'], multiplier: 3,
    requestedTenantId, foreignRecordId: 'other-tenant-private', behavior };
}

async function createJob(fixture: Fixture, principal: Principal, id: string, parameters: FixtureFunctionArguments) {
  await request(fixture, '/api/resources/function_jobs', principal, 'POST', {
    id, function_name: 'documents.publish', function_version: 2, parameters_json: JSON.stringify(parameters),
  }, 201);
}

async function request(
  fixture: Pick<Fixture, 'base'>, path: string, principal?: Principal,
  method = 'GET', body?: DatabaseSerializableValue, status = 200,
): Promise<Record<string, any>> {
  const response = await fetch(`${fixture.base}${path}`, {
    method, headers: {
      ...(principal ? { Authorization: `Bearer ${principal.accessToken}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json() as Record<string, any>;
  expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
  return value;
}

async function eventually<T>(read: () => Promise<T>, ready: (value: T) => boolean, description: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await read();
    if (ready(result)) return result;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function bounded<T>(operation: Promise<T>, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([operation, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}.`)), 15_000);
  })]).finally(() => clearTimeout(timer));
}
