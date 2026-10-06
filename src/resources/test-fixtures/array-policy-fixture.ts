/** Isolated HTTP/Fabric/Sync fixture. Tokens and trusted properties emulate live Guardian lookups, never row filtering. */
import { Elysia } from 'elysia';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAuthBehaviorConfig } from '../../auth/auth-config';
import { authContextMatchesAuthorityReference } from '../../auth/auth-context-authority';
import { trustedSystemServiceDataScope } from '../../auth/service-data-scope';
import type { AuthContext, AuthContextAuthorityReference } from '../../auth/types';
import type { TokenService } from '../../auth/token-service';
import type { UserStore } from '../../auth/user-store';
import { AuthorityCommitCoordinator } from '../../databases/authority-commit-coordinator';
import { DatabaseCoordinator } from '../../databases/database-coordinator';
import { DatabaseManager } from '../../databases/database-manager';
import { DatabaseRuntime } from '../../databases/database-runtime';
import { SubprocessDatabaseExecutor } from '../../databases/subprocess-database-executor';
import type { DatabaseExecutorExecuteOptions, DatabaseExecutorRequest, DatabaseExecutorValue } from '../../databases/database-executor';
import { createPlatformSQLiteService } from '../../persistence';
import { installAppStopBarrier } from '../../frontend/server/app-stop-lifecycle';
import { createRequestDatabaseClient, createResourceTenantDatabaseAccess } from '../../frontend/server/request-database-client';
import { createManagedTenantSyncDataPlane } from '../../frontend/server/tenant-sync-data-plane';
import { createDataQueryPlugin } from '../../sync/data-query.plugin';
import { createSyncPlugin } from '../../sync/sync.plugin';
import { createSyncClient } from '../../sync/client/sync-client';
import type { SyncClient } from '../../sync/client/sync-client-types';
import type { Row, ServerMessage, SyncTokenVerifier } from '../../sync/types';
import { createResourceCrudPlugin } from '../resource-crud.plugin';
import { defineResource, tenantRealm } from '../resource-definition';
import { customPolicy } from '../resource-policy-helpers';
import { createResourceRegistry } from '../resource-registry';
import { ResourceSyncPolicyService } from '../resource-sync-policy';
import { arrayPolicyRealm, arrayPolicyTables } from './array-policy-realm';

export const arrayPolicyOrganizations = ['organization-one', 'organization-two'] as const;
export const arrayPolicyScopes = { a: ['A'], b: ['B'], both: ['A', 'B'], none: [] } as const;
export type ArrayPolicyScope = keyof typeof arrayPolicyScopes;
export const arrayPolicyExpected = {
  a: ['01-a', '03-ab', '04-second', '05-duplicates'],
  b: ['02-b', '03-ab', '04-second'],
  both: ['01-a', '02-b', '03-ab', '04-second', '05-duplicates'],
  none: [],
} as const;
export const arrayPolicyEscapedGroup = 'g"quoted\\tail';

export async function createArrayPolicyFixture() {
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'array-policy-'));
  const systemRuntime = DatabaseRuntime.open({ id: 'system', role: 'system', sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }), ownsSQLite: true });
  const appRuntime = DatabaseRuntime.open({ id: 'default', role: 'default', sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }), ownsSQLite: true });
  const authority = new AuthorityCommitCoordinator();
  const executorRoles: string[] = [];
  const executorDispatches: Array<{ role: 'writer' | 'reader'; type: string }> = [];
  const childPath = fileURLToPath(new URL('./array-policy-actor-child.ts', import.meta.url));
  const coordinator = new DatabaseCoordinator({
    rootDirectory: root, realm: arrayPolicyRealm, maxDatabases: 3, maxTenantSyncDatabases: 2,
    sweepIntervalMs: false, operationTimeoutMs: 5_000, authorityCommitCoordinator: authority, requireCommitAuthority: true,
    createExecutor: ({ role, slot }) => {
      executorRoles.push(role);
      return new ArrayPolicyExecutor({ command: [process.execPath, '--no-env-file', childPath, role, String(slot)], env: {}, role, slot,
        maxInFlight: 1, startupTimeoutMs: 5_000, operationTimeoutMs: 5_000,
        // This suite validates authorization, not executor deadline policy;
        // allow bounded IPC teardown under parallel integration-test load.
        shutdownAckTimeoutMs: 3_000, shutdownExitTimeoutMs: 3_000, sigtermTimeoutMs: 500, sigkillTimeoutMs: 500 }, executorDispatches, role);
    },
  });
  const manager = new DatabaseManager({ systemRuntime, appRuntime,
    multiple: { coordinator, authorityCommitCoordinator: authority, tenantDatabases: true } });
  manager.start();
  const members = new Map<string, { auth: AuthContext; groups: readonly string[]; token: string; active: boolean }>();
  const tokens = new Map<string, string>();
  const resolutionBarriers = new Map<string, { entered: () => void; pending: Promise<void> }>();
  const resolutionCounts = new Map<string, number>();
  let tokenRevision = 0;
  for (const organization of arrayPolicyOrganizations) for (const [scope, groups] of Object.entries(arrayPolicyScopes)) {
    const userId = `${organization}-${scope}`, token = `token-${userId}-${++tokenRevision}`;
    members.set(userId, { auth: { userId, email: `${userId}@example.test`, role: 'user', authGeneration: 0,
      sessionKind: 'web', sessionId: `session-${userId}`, sessionGeneration: 0,
      sessionScopeKind: 'tenant', sessionScopeId: organization, tenantId: organization, tenantKind: 'organization',
      membershipId: `membership-${userId}`, tenantRole: 'member', tenantAuthorizationGeneration: 0, membershipAuthorizationGeneration: 0 }, groups, token, active: true });
    tokens.set(token, userId);
  }
  const tokenService = {
    async resolveAuthContext(token: string) {
      const userId = tokens.get(token) ?? '', barrier = resolutionBarriers.get(userId);
      resolutionCounts.set(userId, (resolutionCounts.get(userId) ?? 0) + 1);
      if (barrier) { resolutionBarriers.delete(userId); barrier.entered(); await barrier.pending; }
      const member = members.get(userId); return member?.active ? member.auth : null;
    },
    async verifyAccessToken() { return null; },
    captureAuthContextAuthority(context: AuthContext) { return authorityReference(context); },
    resolveAuthContextAuthority(reference: AuthContextAuthorityReference) {
      const member = members.get(reference.userId);
      return member?.active && authContextMatchesAuthorityReference(member.auth, reference) ? member.auth : null;
    },
  };
  const userStore = {
    getUserById(userId: string) {
      const member = members.get(userId); if (!member?.active) return null;
      return { userId, email: member.auth.email, role: 'user', status: 'active', passwordChangeRequired: false,
        emailVerificationRequired: false, emailVerifiedAt: null, properties: { allowed_groups: JSON.stringify(member.groups) } };
    },
  } as unknown as UserStore;
  const authConfig = resolveAuthBehaviorConfig({ tenancy: 'multi', userProperties: {
    allowed_groups: { type: 'string', editableBy: 'admin', useInPolicies: true },
  } });
  const policy = customPolicy(({ user, action }) => {
    if (!user || action === 'create') return false;
    return { allowed: true, constraints: [{ type: 'allOf', constraints: [
      { type: 'field', field: 'access_groups', operator: 'arrayOverlaps', value: JSON.parse(user.properties.allowed_groups ?? '[]') },
      { type: 'anyOf', constraints: [
        { type: 'field', field: 'state', operator: 'eq', value: 'published' },
        { type: 'field', field: 'state', operator: 'eq', value: 'review' },
      ] },
    ] }] };
  }, { name: 'trusted-group-overlap' });
  const registry = createResourceRegistry({ resources: Object.keys(arrayPolicyTables).map(table => defineResource({
    table, exposure: 'all', realm: tenantRealm(), policy,
    fields: { read: Object.keys(arrayPolicyTables[table as keyof typeof arrayPolicyTables]), update: ['title'] },
  })), tables: arrayPolicyTables, authConfig, tenancyMode: 'multi', tenantIsolation: 'tenant-database', managedTables: Object.keys(arrayPolicyTables) });
  const getTenantClient = (tenantId: string) => {
    const client = createRequestDatabaseClient({ manager, scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId }), assertCurrentAuthoritySync: () => undefined });
    if (!client) throw new Error('Expected physical tenant client');
    return client;
  };
  for (const organization of arrayPolicyOrganizations) {
    const rows = retainedRows(organization);
    await getTenantClient(organization).batch({ mutations: rows.flatMap(row => [
      { type: 'create' as const, table: 'records', row },
      { type: 'create' as const, table: 'record_children', row: { ...row, id: `child-${row.id}`, parent_id: row.id } },
    ]) }, { idempotencyKey: `seed-${organization}` });
  }
  const resourcePolicy = new ResourceSyncPolicyService({ registry, authConfig, getUserStore: () => userStore,
    tenancyMode: 'multi', managedTables: new Set(Object.keys(arrayPolicyTables)) });
  const tenantDataPlane = createManagedTenantSyncDataPlane({ manager, tables: Object.fromEntries(Object.entries(arrayPolicyTables)
    .map(([table, columns]) => [table, { primaryKey: 'id', columns: Object.keys(columns) }])) });
  const app = new Elysia()
    .use(createResourceCrudPlugin({ registry, tables: arrayPolicyTables, authConfig, tenancyMode: 'multi',
      getDB: () => appRuntime.db, getTokenService: () => tokenService as unknown as TokenService, getUserStore: () => userStore,
      getTenantDatabaseClient: ({ scope, assertCurrentAuthoritySync }) => createResourceTenantDatabaseAccess({ manager,
        scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: scope.tenantId }), assertCurrentAuthoritySync }) }))
    .use(createDataQueryPlugin({ queryableTables: new Set(Object.keys(arrayPolicyTables)),
      tableColumns: new Map(Object.entries(arrayPolicyTables).map(([name, columns]) => [name, Object.keys(columns)])),
      getDB: () => appRuntime.db, getDatabaseManager: () => manager, getTokenService: () => tokenService as unknown as TokenService,
      getUserStore: () => userStore, resourceRegistry: registry, resourceAuthConfig: authConfig,
      tenancyMode: 'multi', managedTables: new Set(Object.keys(arrayPolicyTables)) }))
    .use(createSyncPlugin({ db: { mode: 'memory' }, reactiveDB: appRuntime.db, tables: arrayPolicyTables, tenancyMode: 'multi',
      auth: { required: true, getTokenVerifier: () => tokenService as SyncTokenVerifier, revalidateIntervalMs: 20 }, resourcePolicy, tenantDataPlane }))
    .listen({ hostname: '127.0.0.1', port: 0 });
  const clients = new Set<SyncClient>();
  const baseUrl = `http://127.0.0.1:${app.server!.port}`;
  const member = (organization: string, scope: ArrayPolicyScope) => {
    const value = members.get(`${organization}-${scope}`); if (!value) throw new Error('Unknown test member'); return value;
  };
  const request = async (organization: string, scope: ArrayPolicyScope, path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers); headers.set('Authorization', `Bearer ${member(organization, scope).token}`);
    headers.set('Content-Type', 'application/json');
    if (init?.method && init.method !== 'GET') headers.set('Idempotency-Key', `request-${crypto.randomUUID()}`);
    return fetch(baseUrl + path, { ...init, headers });
  };
  return { manager, coordinator, executorRoles, executorDispatches, registry, resourcePolicy, baseUrl, getTenantClient, request,
    setGroups(organization: string, scope: ArrayPolicyScope, groups: readonly string[]) {
      const current = member(organization, scope); current.groups = [...groups];
      current.token = `token-${current.auth.userId}-${++tokenRevision}`; tokens.set(current.token, current.auth.userId);
    },
    revoke(organization: string, scope: ArrayPolicyScope) { member(organization, scope).active = false; },
    resolutionCount(organization: string, scope: ArrayPolicyScope) { return resolutionCounts.get(member(organization, scope).auth.userId) ?? 0; },
    holdNextResolution(organization: string, scope: ArrayPolicyScope) {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const pending = new Promise<void>(resolve => { release = resolve; });
      resolutionBarriers.set(member(organization, scope).auth.userId, { entered, pending });
      return { started, release };
    },
    async sync(organization: string, scope: ArrayPolicyScope, mode: 'full' | 'lazy') {
      let invalidations = 0; const messages: ServerMessage[] = [], authFailures: string[] = [];
      const currentToken = () => { const current = member(organization, scope); return current.active ? current.token : null; };
      const client = createSyncClient({ url: baseUrl.replace('http:', 'ws:') + '/sync', autoConnect: false,
        tables: Object.fromEntries(Object.entries(arrayPolicyTables).map(([name, columns]) => [name, { ...columns, _pk: 'id', _sync: mode }])),
        tableSyncPlanes: { records: 'tenant', record_children: 'tenant' }, getToken: currentToken, refreshAuth: currentToken,
        onAuthorizationDataInvalidated: () => { invalidations++; }, onAuthFailure: message => authFailures.push(message), maxReconnectAttempts: 0 });
      client.onMessage(message => messages.push(message as unknown as ServerMessage)); clients.add(client); client.connect();
      await client.waitForAuthorizationBaseline(5_000);
      return { client, messages, authFailures, get invalidations() { return invalidations; },
        async load(table: string) {
          const response = await request(organization, scope, `/api/data?table=${table}&limit=100&order=id`);
          if (!response.ok) throw new Error(`Lazy load failed ${response.status}: ${await response.text()}`);
          const body = await response.json() as { rows: Row[] };
          client.store.send({ type: 'sync.load', table, rows: Object.fromEntries(body.rows.map(row => [String(row.id), row])), replace: true });
          return body;
        },
      };
    },
    async close() {
      for (const client of clients) client.disconnect();
      await installAppStopBarrier(app, async () => {}).stop(true);
      await manager.close(); await authority.close(); await rm(root, { recursive: true, force: true });
    },
  };
}

export type ArrayPolicyFixture = Awaited<ReturnType<typeof createArrayPolicyFixture>>;
export function syncedIds(client: SyncClient, table = 'records'): string[] {
  return Object.keys(client.store.getSnapshot().context[table] as Record<string, Row>).sort();
}
export async function waitForArrayPolicy(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`); await Bun.sleep(10); }
}

function authorityReference(auth: AuthContext): AuthContextAuthorityReference {
  return { version: 1, userId: auth.userId, platformRole: auth.role, authGeneration: auth.authGeneration ?? 0,
    sessionKind: 'web', sessionId: auth.sessionId!, mfaVerifiedAt: null, sessionGeneration: 0, clientId: null,
    identityScopes: [], sessionScopeKind: 'tenant', sessionScopeId: auth.tenantId!, tenantId: auth.tenantId!, tenantKind: 'organization',
    membershipId: auth.membershipId!, tenantRole: auth.tenantRole!, tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0, authorizationAssignmentRevision: null };
}
function retainedRows(organization: string) {
  const rows: Array<[string, string | null, string?]> = [
    ['01-a', '["A"]'], ['02-b', '["B"]'], ['03-ab', '["A","B"]'], ['04-second', '["B","A"]'], ['05-duplicates', '["A","A"]'],
    ['06-empty', '[]'], ['07-null', null], ['08-malformed', '{bad'], ['09-object', '{"0":"A"}'], ['10-nested', '[["A"]]'],
    ['11-mixed', '["A",1]'], ['12-number', '[1]'], ['13-prefix', '["A10"]'], ['14-case', '["a"]'], ['15-sentinel', '[""]'],
    ['16-escaped', JSON.stringify([arrayPolicyEscapedGroup])], ['17-disabled', '["A"]', 'disabled'],
  ];
  return rows.map(([id, access_groups, state = 'published']) => ({ id, title: `${organization} Needle ${id}`, access_groups, state }));
}

/** Observes actual IPC dispatch roles while leaving actor execution unmodified. */
class ArrayPolicyExecutor extends SubprocessDatabaseExecutor {
  private readonly role: 'writer' | 'reader';
  constructor(options: ConstructorParameters<typeof SubprocessDatabaseExecutor>[0], private readonly dispatches: Array<{ role: 'writer' | 'reader'; type: string }>, role: 'writer' | 'reader') {
    super(options); this.role = role;
  }
  override execute<Result extends DatabaseExecutorValue = DatabaseExecutorValue, Payload extends DatabaseExecutorValue = DatabaseExecutorValue>(
    request: DatabaseExecutorRequest<Payload>, options?: DatabaseExecutorExecuteOptions,
  ): Promise<Result> {
    if (request.operation === 'database.execute') {
      const payload = request.payload as unknown as { operation: { type: string } };
      this.dispatches.push({ role: this.role, type: payload.operation.type });
    }
    return super.execute<Result, Payload>(request, options);
  }
}
