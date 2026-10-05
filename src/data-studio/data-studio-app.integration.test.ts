/** Authenticated full-app proof for Guardian + Fabric + Data Studio composition. */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

import type { AsyncDatabaseClient } from '../databases/database-operations';
import { dataStudioActorFixtureRealm } from '../databases/test-fixtures/data-studio-actor-realm';
import { createApp } from '../frontend/server/app-factory';
import {
  clearPlatformSQLiteService,
  getPlatformSQLiteService,
} from '../persistence';
import type { ServerMessage, SyncSnapshotMessage } from '../sync/types';
import type { DataStudioSchema } from './data-studio-contracts';
import { createDataStudioFeature } from './data-studio-feature';
import { DATA_STUDIO_QUERY_NAMES } from './data-studio-operation-contracts';
import {
  DATA_STUDIO_ROWS_TABLE_NAME,
  DATA_STUDIO_TABLES_TABLE_NAME,
} from './data-studio-tenant-schema';

const ACTOR_ENTRYPOINT = fileURLToPath(new URL(
  '../databases/test-fixtures/data-studio-actor.ts',
  import.meta.url,
));
const BASE_PATH = '/api/_zero/data-studio';
const TEST_PASSWORD = 'password123';

const CONTACT_SCHEMA: DataStudioSchema = Object.freeze({
  version: 1,
  columns: Object.freeze([
    Object.freeze({
      columnId: 'col_name',
      key: 'name',
      label: 'Name',
      type: 'text',
      required: true,
    }),
    Object.freeze({
      columnId: 'col_active',
      key: 'active',
      label: 'Active',
      type: 'boolean',
      required: true,
    }),
  ]),
});

type ManagedApp = Awaited<ReturnType<typeof createApp>>;

interface Registration {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: {
    readonly userId: string;
    readonly email: string;
  };
  readonly tenant: {
    readonly tenantId: string;
    readonly membershipId: string;
  };
}

interface JsonResponse {
  readonly status: number;
  readonly body: Record<string, any>;
}

interface SyncConnection {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[];
  waitFor(
    predicate: (message: ServerMessage) => boolean,
    description: string,
  ): Promise<ServerMessage>;
  close(): Promise<void>;
}

describe('Data Studio app composition', () => {
  test('runs the authenticated organization API through a real isolated actor', async () => {
    const root = await createTempRoot();
    const feature = createDataStudioFeature();
    let app: ManagedApp | undefined;
    let sync: SyncConnection | undefined;
    let administrationSync: SyncConnection | undefined;

    try {
      const appDir = join(root, 'app');
      await mkdir(appDir, { recursive: true });
      app = await createApp({
        db: {
          mode: 'file',
          path: join(root, 'application.db'),
        },
        systemDb: {
          mode: 'file',
          path: join(root, 'system.db'),
        },
        tables: feature.appTables,
        resources: feature.resources,
        auth: {
          tenancy: 'multi',
          bootstrap: 'public',
          registration: { mode: 'public' },
          authorization: {
            mode: 'advanced',
            permissions: feature.permissions,
            roles: {
              'data-studio-viewer': feature.roleFragments.viewer,
              'data-studio-manager': feature.roleFragments.manager,
            },
          },
          apiKeys: true,
        },
        databaseTopology: {
          mode: 'multiple',
          rootDirectory: join(root, 'tenant-databases'),
          realm: dataStudioActorFixtureRealm,
          actors: {
            launch: {
              kind: 'source',
              entrypoint: ACTOR_ENTRYPOINT,
            },
          },
          tenantIsolation: 'tenant-database',
          placement: 'file',
          readers: true,
        },
        stateSync: true,
        serverResourcesDir: false,
        serverPluginsDir: false,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: false,
        appDir,
        storageDir: join(root, 'storage'),
        outDir: join(root, 'out'),
        generatedDir: join(root, '.zero', 'generated'),
        observability: { console: false, endpoint: false },
        email: false,
        ai: false,
        vector: false,
        pdf: false,
        kv: false,
        sitemap: false,
      });

      const scopeProbe = installDataScopeProbe(app);
      app.listen(0);
      const baseUrl = `http://localhost:${app.server!.port}`;
      const syncUrl = `ws://localhost:${app.server!.port}/sync`;

      const anonymous = await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/capabilities`,
      );
      expect(anonymous.status).toBe(401);

      // The first public registration bootstraps the protected administration
      // organization. The remaining registrations create customer orgs.
      const administration = await register(
        baseUrl,
        'platform',
        'Platform Administration',
      );
      const tenantA = await register(baseUrl, 'tenant-a', 'Tenant A');
      const tenantB = await register(baseUrl, 'tenant-b', 'Tenant B');
      const viewerIdentity = await register(baseUrl, 'viewer', 'Viewer Home');

      const [
        administrationReadiness,
        tenantAReadiness,
        tenantBReadiness,
      ] = await Promise.all([
        waitForDataRealmReady(baseUrl, administration.accessToken),
        waitForDataRealmReady(baseUrl, tenantA.accessToken),
        waitForDataRealmReady(baseUrl, tenantB.accessToken),
      ]);
      expect(administrationReadiness).toMatchObject({
        status: 200,
        body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
      });
      expect(tenantAReadiness).toMatchObject({
        status: 200,
        body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
      });
      expect(tenantBReadiness).toMatchObject({
        status: 200,
        body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
      });

      const administrationCapabilities = await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/capabilities`,
        administration.accessToken,
      );
      expect(administrationCapabilities).toMatchObject({
        status: 200,
        body: {
          enabled: true,
          scope: 'organization',
          permissions: { read: true, write: true, manage: true },
        },
      });

      const administrationTable = await jsonRequest(
        baseUrl,
        'POST',
        `${BASE_PATH}/tables`,
        administration.accessToken,
        {
          operationId: 'administration-audit-table-create',
          name: 'Administration Audit Notes',
          key: 'administration_audit_notes',
          schema: CONTACT_SCHEMA,
        },
      );
      expect(administrationTable).toMatchObject({
        status: 200,
        body: {
          table: {
            key: 'administration_audit_notes',
            rowCount: 0,
          },
        },
      });
      const administrationTableId = administrationTable.body.table.tableId as string;
      const administrationRow = await jsonRequest(
        baseUrl,
        'POST',
        `${BASE_PATH}/tables/${administrationTableId}/rows`,
        administration.accessToken,
        {
          operationId: 'administration-audit-row-create',
          values: { name: 'Platform-only note', active: true },
        },
      );
      expect(administrationRow).toMatchObject({
        status: 200,
        body: {
          row: {
            tableId: administrationTableId,
            values: { col_name: 'Platform-only note', col_active: true },
          },
        },
      });

      const administrationGenericTables = await jsonRequest(
        baseUrl,
        'GET',
        `/api/data?table=${DATA_STUDIO_TABLES_TABLE_NAME}`,
        administration.accessToken,
      );
      expect(administrationGenericTables).toMatchObject({
        status: 200,
        body: {
          rows: [{
            table_id: administrationTableId,
            key: 'administration_audit_notes',
            row_count: 1,
          }],
        },
      });
      expect(JSON.stringify(administrationGenericTables.body))
        .not.toContain('schema_json');

      administrationSync = await connectSync(
        syncUrl,
        administration.accessToken,
      );
      subscribeDataStudio(administrationSync);
      const administrationSnapshot = await waitForTenantSnapshot(
        administrationSync,
      );
      expect(
        administrationSnapshot.tables[DATA_STUDIO_TABLES_TABLE_NAME]
          ?.[administrationTableId],
      ).toMatchObject({
        table_id: administrationTableId,
        key: 'administration_audit_notes',
        row_count: 1,
      });
      expect(JSON.stringify(administrationSnapshot)).not.toContain('schema_json');

      // Tenant B's owner is also a manager in Tenant A. Logging in and making
      // an explicit tenant selection proves the normal Guardian activation path.
      const managerMembership = await jsonRequest(
        baseUrl,
        'POST',
        '/auth/tenant/members',
        tenantA.accessToken,
        {
          email: tenantB.user.email,
          roles: ['data-studio-manager'],
        },
      );
      expect(managerMembership).toMatchObject({
        status: 200,
        body: {
          member: {
            identity: { userId: tenantB.user.userId },
            roles: ['data-studio-manager'],
          },
        },
      });
      const manager = await loginToTenant(
        baseUrl,
        tenantB.user.email,
        tenantA.tenant.tenantId,
      );
      expect(await waitForDataRealmReady(baseUrl, manager.accessToken)).toMatchObject({
        status: 200,
        body: { status: 'ready', scope: 'tenant', pendingOperations: 0 },
      });

      const capabilities = await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/capabilities`,
        manager.accessToken,
      );
      expect(capabilities).toMatchObject({
        status: 200,
        body: {
          enabled: true,
          scope: 'organization',
          permissions: { read: true, write: true, manage: true },
        },
      });

      const createTableBody = {
        operationId: 'contacts-table-create',
        name: 'Contacts',
        key: 'contacts',
        description: 'Tenant-scoped contacts',
        schema: CONTACT_SCHEMA,
      };
      const createdTable = await jsonRequest(
        baseUrl,
        'POST',
        `${BASE_PATH}/tables`,
        manager.accessToken,
        createTableBody,
      );
      expect(createdTable).toMatchObject({
        status: 200,
        body: {
          table: {
            key: 'contacts',
            name: 'Contacts',
            schemaRevision: 1,
            revision: 1,
            rowCount: 0,
            schema: CONTACT_SCHEMA,
          },
        },
      });
      const replayedTable = await jsonRequest(
        baseUrl,
        'POST',
        `${BASE_PATH}/tables`,
        manager.accessToken,
        createTableBody,
      );
      expect(replayedTable).toEqual(createdTable);
      const tableId = createdTable.body.table.tableId as string;
      expect(tableId).toBeString();

      // Guardian user API keys are customer-organization credentials. Their
      // Data Studio authority remains the exact live membership scope.
      const issuedCustomerKey = await jsonRequest(
        baseUrl,
        'POST',
        '/auth/api-keys',
        tenantA.accessToken,
        { label: 'Customer Data Studio regression' },
      );
      expect(issuedCustomerKey).toMatchObject({
        status: 200,
        body: {
          apiKey: {
            tenantId: tenantA.tenant.tenantId,
            membershipId: tenantA.tenant.membershipId,
            scopeKind: 'tenant',
            status: 'active',
          },
        },
      });
      expect(issuedCustomerKey.body.secret).toBeString();
      const customerApiKey = issuedCustomerKey.body.secret as string;
      expect(await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/tables/${tableId}`,
        customerApiKey,
      )).toMatchObject({
        status: 200,
        body: { table: { tableId } },
      });
      const customerGenericTables = await jsonRequest(
        baseUrl,
        'GET',
        `/api/data?table=${DATA_STUDIO_TABLES_TABLE_NAME}`,
        customerApiKey,
      );
      expect(customerGenericTables).toMatchObject({
        status: 200,
        body: {
          rows: [{
            table_id: tableId,
            key: 'contacts',
            row_count: 0,
          }],
        },
      });
      expect(customerGenericTables.body.rows).toHaveLength(1);

      // Administration membership admits only the administration database,
      // while customer membership admits only the selected customer database.
      expect((await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/tables/${administrationTableId}`,
        manager.accessToken,
      )).status).toBe(404);
      expect((await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/tables/${tableId}`,
        administration.accessToken,
      )).status).toBe(404);
      expect((await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/tables/${administrationTableId}`,
        customerApiKey,
      )).status).toBe(404);

      sync = await connectSync(syncUrl, manager.accessToken);
      subscribeDataStudio(sync);
      const snapshot = await waitForTenantSnapshot(sync);
      expect(snapshot.tables[DATA_STUDIO_TABLES_TABLE_NAME]?.[tableId]).toMatchObject({
        table_id: tableId,
        key: 'contacts',
        row_count: 0,
      });
      expect(
        snapshot.tables[DATA_STUDIO_TABLES_TABLE_NAME]?.[administrationTableId],
      ).toBeUndefined();
      expect(JSON.stringify(snapshot)).not.toContain('schema_json');
      expect(JSON.stringify(snapshot)).not.toContain('values_json');

      const createRowBody = {
        operationId: 'contacts-row-create',
        values: { name: 'Ada', active: true },
      };
      const createdRow = await jsonRequest(
        baseUrl,
        'POST',
        `${BASE_PATH}/tables/${tableId}/rows`,
        manager.accessToken,
        createRowBody,
      );
      expect(createdRow).toMatchObject({
        status: 200,
        body: {
          row: {
            tableId,
            revision: 1,
            schemaRevision: 1,
            values: { col_name: 'Ada', col_active: true },
          },
        },
      });
      const replayedRow = await jsonRequest(
        baseUrl,
        'POST',
        `${BASE_PATH}/tables/${tableId}/rows`,
        manager.accessToken,
        createRowBody,
      );
      expect(replayedRow).toEqual(createdRow);
      const rowId = createdRow.body.row.rowId as string;
      expect(rowId).toBeString();
      const insertedPage = await jsonRequest(baseUrl, 'GET', `${BASE_PATH}/tables/${tableId}/rows`, manager.accessToken);
      expect(insertedPage.status).toBe(200);
      expect(Number.isSafeInteger(insertedPage.body.readSequence)).toBe(true);
      expect(insertedPage.body.rows[0]?.revision).toBe(1);
      const stablePage = await jsonRequest(baseUrl, 'GET', `${BASE_PATH}/tables/${tableId}/rows`, manager.accessToken);
      expect(stablePage.body.readSequence).toBe(insertedPage.body.readSequence);

      const inserted = await waitForDataStudioRowChange(
        sync,
        tableId,
        rowId,
        'INSERT',
      );
      const rowRecordId = inserted.rowId;
      expect(inserted.row).toMatchObject({
        record_id: rowRecordId,
        table_id: tableId,
        row_id: rowId,
        revision: 1,
      });
      expect(JSON.stringify(inserted)).not.toContain('values_json');

      const replacedRow = await jsonRequest(
        baseUrl,
        'PUT',
        `${BASE_PATH}/tables/${tableId}/rows/${rowId}`,
        manager.accessToken,
        {
          operationId: 'contacts-row-replace',
          expectedRevision: 1,
          values: { name: 'Ada Lovelace', active: true },
        },
      );
      expect(replacedRow).toMatchObject({
        status: 200,
        body: {
          row: {
            rowId,
            tableId,
            revision: 2,
            values: { col_name: 'Ada Lovelace', col_active: true },
          },
        },
      });
      const replacedPage = await jsonRequest(baseUrl, 'GET', `${BASE_PATH}/tables/${tableId}/rows`, manager.accessToken);
      expect(replacedPage.body.readSequence).toBeGreaterThan(insertedPage.body.readSequence);
      expect(replacedPage.body.rows[0]?.revision).toBe(2);
      const updated = await waitForDataStudioRowChange(
        sync,
        tableId,
        rowRecordId,
        'UPDATE',
        true,
      );
      expect(updated.row).toMatchObject({ revision: 2 });
      expect(JSON.stringify(updated)).not.toContain('values_json');

      const readRow = await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/tables/${tableId}/rows/${rowId}`,
        manager.accessToken,
      );
      expect(readRow).toMatchObject({
        status: 200,
        body: {
          row: {
            rowId,
            revision: 2,
            values: { col_name: 'Ada Lovelace', col_active: true },
          },
        },
      });

      const genericTables = await jsonRequest(
        baseUrl,
        'GET',
        `/api/data?table=${DATA_STUDIO_TABLES_TABLE_NAME}`,
        manager.accessToken,
      );
      expect(genericTables).toMatchObject({
        status: 200,
        body: { rows: [{ table_id: tableId, key: 'contacts', row_count: 1 }] },
      });
      expect(JSON.stringify(genericTables.body)).not.toContain('schema_json');

      const rowQuery = new URLSearchParams({ table: DATA_STUDIO_ROWS_TABLE_NAME });
      rowQuery.append('filter', `table_id:eq:${tableId}`);
      const genericRows = await jsonRequest(
        baseUrl,
        'GET',
        `/api/data?${rowQuery.toString()}`,
        manager.accessToken,
      );
      expect(genericRows).toMatchObject({
        status: 200,
        body: {
          rows: [{
            record_id: rowRecordId,
            table_id: tableId,
            row_id: rowId,
            revision: 2,
          }],
        },
      });
      expect(JSON.stringify(genericRows.body)).not.toContain('values_json');

      const viewerMembership = await jsonRequest(
        baseUrl,
        'POST',
        '/auth/tenant/members',
        tenantA.accessToken,
        {
          email: viewerIdentity.user.email,
          roles: ['data-studio-viewer'],
        },
      );
      expect(viewerMembership).toMatchObject({
        status: 200,
        body: {
          member: {
            identity: { userId: viewerIdentity.user.userId },
            roles: ['data-studio-viewer'],
          },
        },
      });
      const viewer = await loginToTenant(
        baseUrl,
        viewerIdentity.user.email,
        tenantA.tenant.tenantId,
      );
      expect(await waitForDataRealmReady(baseUrl, viewer.accessToken)).toMatchObject({
        status: 200,
        body: { status: 'ready', scope: 'tenant' },
      });
      expect(await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/capabilities`,
        viewer.accessToken,
      )).toMatchObject({
        status: 200,
        body: {
          permissions: { read: true, write: false, manage: false },
        },
      });
      expect(await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/tables/${tableId}/rows/${rowId}`,
        viewer.accessToken,
      )).toMatchObject({
        status: 200,
        body: { row: { values: { col_name: 'Ada Lovelace' } } },
      });
      const viewerWrite = await jsonRequest(
        baseUrl,
        'POST',
        `${BASE_PATH}/tables/${tableId}/rows`,
        viewer.accessToken,
        {
          operationId: 'viewer-write-must-fail',
          values: { name: 'Forbidden', active: false },
        },
      );
      expect(viewerWrite.status).toBe(403);

      // Tenant B owns this manager identity, but its original session remains
      // physically bound to Tenant B and cannot observe Tenant A's catalog.
      expect(await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/tables`,
        tenantB.accessToken,
      )).toEqual({ status: 200, body: { tables: [] } });
      expect(await jsonRequest(
        baseUrl,
        'GET',
        `/api/data?table=${DATA_STUDIO_TABLES_TABLE_NAME}`,
        tenantB.accessToken,
      )).toMatchObject({ status: 200, body: { rows: [] } });

      // Capture a request-created zero.data client while the membership is
      // active, then revoke it. The old capability itself must fail closed.
      const captured = await jsonRequest(
        baseUrl,
        'GET',
        scopeProbe.path,
        viewer.accessToken,
      );
      expect(captured).toEqual({ status: 200, body: { captured: true } });
      const viewerData = scopeProbe.current();
      expect(viewerData).not.toBeNull();

      const suspended = await jsonRequest(
        baseUrl,
        'PATCH',
        `/auth/tenant/members/${viewerMembership.body.member.membershipId}`,
        tenantA.accessToken,
        { status: 'suspended' },
      );
      expect(suspended).toMatchObject({
        status: 200,
        body: { member: { status: 'suspended' } },
      });
      await expect(viewerData!.query(
        DATA_STUDIO_QUERY_NAMES.listTables,
        { status: 'active' },
      )).rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED' });
      expect((await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/tables`,
        viewer.accessToken,
      )).status).toBe(401);

      const deleted = await jsonRequest(
        baseUrl,
        'DELETE',
        `${BASE_PATH}/tables/${tableId}/rows/${rowId}`,
        manager.accessToken,
        {
          operationId: 'contacts-row-delete',
          expectedRevision: 2,
        },
      );
      expect(deleted).toEqual({
        status: 200,
        body: { rowId, deleted: true },
      });
      const removed = await waitForDataStudioRowChange(
        sync,
        tableId,
        rowRecordId,
        'DELETE',
        true,
      );
      expect(removed.row).toBeNull();
      expect((await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/tables/${tableId}/rows/${rowId}`,
        manager.accessToken,
      )).status).toBe(404);
      expect(await jsonRequest(
        baseUrl,
        'GET',
        `${BASE_PATH}/tables/${tableId}/rows`,
        manager.accessToken,
      )).toMatchObject({
        status: 200,
        body: { rows: [], total: 0 },
      });
    } finally {
      await administrationSync?.close();
      await sync?.close();
      await app?.stop(true);
      const service = getPlatformSQLiteService();
      service?.close();
      clearPlatformSQLiteService(service);
      await rm(root, { recursive: true, force: true });
    }
  }, 90_000);
});

function installDataScopeProbe(app: ManagedApp): {
  readonly path: string;
  current(): AsyncDatabaseClient | null;
} {
  const path = `/__zero_test/data-scope-${crypto.randomUUID()}`;
  let captured: AsyncDatabaseClient | null = null;
  app.get(path, (context) => {
    captured = (context as unknown as {
      zero?: { data?: AsyncDatabaseClient | null };
    }).zero?.data ?? null;
    return { captured: captured !== null };
  });
  return { path, current: () => captured };
}

async function register(
  baseUrl: string,
  label: string,
  organizationName: string,
): Promise<Registration> {
  const suffix = crypto.randomUUID();
  const response = await jsonRequest(baseUrl, 'POST', '/auth/register', undefined, {
    username: `${label}-${suffix}`,
    email: `${label}-${suffix}@example.test`,
    password: TEST_PASSWORD,
    organizationName: `${organizationName} ${suffix}`,
  });
  expect(response.status).toBe(200);
  expect(response.body.accessToken).toBeString();
  expect(response.body.tenant?.tenantId).toBeString();
  return response.body as Registration;
}

async function loginToTenant(
  baseUrl: string,
  username: string,
  tenantId: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const login = await jsonRequest(baseUrl, 'POST', '/auth/login', undefined, {
    username,
    password: TEST_PASSWORD,
  });
  expect(login).toMatchObject({
    status: 200,
    body: { tenantSelectionRequired: true },
  });
  expect(login.body.tenantSelection?.continuation).toBeString();
  const selected = await jsonRequest(
    baseUrl,
    'POST',
    '/auth/tenants/select',
    undefined,
    {
      continuation: login.body.tenantSelection.continuation,
      tenantId,
    },
  );
  expect(selected.status).toBe(200);
  expect(selected.body.accessToken).toBeString();
  return selected.body as { accessToken: string; refreshToken: string };
}

async function waitForDataRealmReady(
  baseUrl: string,
  accessToken: string,
): Promise<JsonResponse> {
  const deadline = Date.now() + 15_000;
  let response = await jsonRequest(
    baseUrl,
    'GET',
    '/auth/data-realm/readiness',
    accessToken,
  );
  do {
    if (response.status === 200
      && (response.body.status === 'ready' || response.body.status === 'failed')) {
      return response;
    }
    if (response.status !== 200
      && response.body.code !== 'DATA_REALM_NOT_READY') return response;
    const pollAfterMs = typeof response.body.pollAfterMs === 'number'
      ? response.body.pollAfterMs
      : 250;
    await Bun.sleep(pollAfterMs);
    response = await jsonRequest(
      baseUrl,
      'POST',
      '/auth/data-realm/readiness/retry',
      accessToken,
    );
  } while (Date.now() < deadline);
  return response;
}

function subscribeDataStudio(connection: SyncConnection): void {
  connection.ws.send(JSON.stringify({
    type: 'sync.subscribe',
    tables: [DATA_STUDIO_TABLES_TABLE_NAME, DATA_STUDIO_ROWS_TABLE_NAME],
    snapshot: [DATA_STUDIO_TABLES_TABLE_NAME],
    lastSeq: 0,
  }));
}

async function waitForTenantSnapshot(
  connection: SyncConnection,
): Promise<SyncSnapshotMessage> {
  const first = await connection.waitFor(
    (message) => (message.type === 'sync.snapshot'
      || message.type === 'sync.snapshot.begin')
      && message.plane === 'tenant',
    'Data Studio tenant snapshot',
  );
  if (first.type === 'sync.snapshot') return first;
  if (first.type !== 'sync.snapshot.begin') {
    throw new Error('Expected a Data Studio tenant snapshot');
  }
  const end = await connection.waitFor(
    (message) => message.type === 'sync.snapshot.end'
      && message.plane === 'tenant'
      && message.snapshotId === first.snapshotId,
    'Data Studio tenant snapshot completion',
  );
  if (end.type !== 'sync.snapshot.end') {
    throw new Error('Expected a Data Studio tenant snapshot completion');
  }
  const tables: SyncSnapshotMessage['tables'] = Object.create(null);
  for (const table of first.tables) tables[table] = Object.create(null);
  for (const message of connection.messages) {
    if (message.type !== 'sync.snapshot.chunk'
      || message.snapshotId !== first.snapshotId) continue;
    Object.assign(tables[message.table] ??= Object.create(null), message.rows);
  }
  return {
    type: 'sync.snapshot',
    plane: 'tenant',
    tables,
    seq: first.seq,
    ...(first.epoch === undefined ? {} : { epoch: first.epoch }),
    ...(first.scope === undefined ? {} : { scope: first.scope }),
    reset: first.reset,
  };
}

async function waitForDataStudioRowChange(
  connection: SyncConnection,
  tableId: string,
  rowId: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  canonicalIdentity = false,
): Promise<Extract<ServerMessage, { type: 'sync.change' }>> {
  const message = await connection.waitFor(
    (candidate) => candidate.type === 'sync.change'
      && candidate.plane === 'tenant'
      && candidate.table === DATA_STUDIO_ROWS_TABLE_NAME
      && candidate.op === operation
      && (canonicalIdentity
        ? candidate.rowId === rowId
        : candidate.row?.table_id === tableId && candidate.row?.row_id === rowId),
    `Data Studio ${operation.toLowerCase()} row change`,
  );
  if (message.type !== 'sync.change') {
    throw new Error('Expected a Data Studio Sync change');
  }
  return message;
}

async function connectSync(url: string, token: string): Promise<SyncConnection> {
  const messages: ServerMessage[] = [];
  const waiters = new Set<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as ServerMessage;
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(message);
    }
  };
  ws.addEventListener('close', (event) => {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(
        `WebSocket closed (${event.code}: ${event.reason || 'no reason'})`,
      ));
    }
    waiters.clear();
  });

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket connection failed'));
  });

  let closeTask: Promise<void> | null = null;
  const connection: SyncConnection = {
    ws,
    messages,
    waitFor(predicate, description) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<ServerMessage>((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(
              `Timed out waiting for ${description}; received ${JSON.stringify(messages)}`,
            ));
          }, 8_000),
        };
        waiters.add(waiter);
      });
    },
    close() {
      if (closeTask) return closeTask;
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('WebSocket closed'));
      }
      waiters.clear();
      if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
      closeTask = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        ws.addEventListener('close', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        ws.close();
      });
      return closeTask;
    },
  };

  ws.send(JSON.stringify({ type: 'sync.auth', token }));
  await connection.waitFor(
    (message) => message.type === 'sync.auth.ready' && message.authenticated,
    'authenticated Sync handshake',
  );
  return connection;
}

async function jsonRequest(
  baseUrl: string,
  method: string,
  path: string,
  bearer?: string,
  body?: Record<string, unknown>,
): Promise<JsonResponse> {
  const headers: Record<string, string> = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) as Record<string, any> : {},
  };
}

async function createTempRoot(): Promise<string> {
  const base = join(process.cwd(), '.zero');
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, 'test-data-studio-app-'));
}
