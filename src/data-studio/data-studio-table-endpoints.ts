/** Catalog, schema, capability, and lifecycle HTTP endpoints. */

import { t } from 'elysia';
import { defineEndpoint } from '../frontend/server/server-extensions';
import { OBS_CODES } from '../observability/codes';
import {
  DATA_STUDIO_MANAGE_PERMISSION,
  DATA_STUDIO_READ_PERMISSION,
  DATA_STUDIO_WRITE_PERMISSION,
} from './data-studio-access';
import {
  DATA_STUDIO_MAX_COLUMNS,
  DATA_STUDIO_MAX_ROW_VALUES_BYTES,
  type DataStudioSchema,
} from './data-studio-contracts';
import {
  DATA_STUDIO_MAX_PAGE_SIZE,
  DATA_STUDIO_MAX_ROWS_PER_TABLE,
  DATA_STUDIO_MAX_TABLES,
} from './data-studio-operation-contracts';
import {
  dataStudioPermissionAuth,
  dataStudioRequestService,
  dataStudioRouteRead,
  dataStudioRouteWrite,
  DATA_STUDIO_TENANT_AUTH,
  requireDataStudioOrganizationContext,
} from './data-studio-router-runtime';
import {
  DATA_STUDIO_ID_SCHEMA,
  DATA_STUDIO_LOGICAL_SCHEMA,
  DATA_STUDIO_MUTATION_FIELDS,
  DATA_STUDIO_REVISION_SCHEMA,
  DATA_STUDIO_STATUS_SCHEMA,
} from './data-studio-router-schemas';

export function createDataStudioTableEndpoints() {
  return [
    defineEndpoint({
      name: 'data-studio-capabilities',
      method: 'GET',
      path: '/capabilities',
      auth: DATA_STUDIO_TENANT_AUTH,
      handler: (context) => dataStudioRouteRead(context, 'capabilities', async () => {
        const { access, zero } = requireDataStudioOrganizationContext(context);
        return Object.freeze({
          enabled: zero.data !== null,
          scope: 'organization' as const,
          permissions: Object.freeze({
            read: access.hasPermission(DATA_STUDIO_READ_PERMISSION),
            write: access.hasPermission(DATA_STUDIO_WRITE_PERMISSION),
            manage: access.hasPermission(DATA_STUDIO_MANAGE_PERMISSION),
          }),
          limits: Object.freeze({
            maxTables: DATA_STUDIO_MAX_TABLES,
            maxRowsPerTable: DATA_STUDIO_MAX_ROWS_PER_TABLE,
            maxColumns: DATA_STUDIO_MAX_COLUMNS,
            maxPageSize: DATA_STUDIO_MAX_PAGE_SIZE,
            maxRowBytes: DATA_STUDIO_MAX_ROW_VALUES_BYTES,
          }),
        });
      }),
    }),
    defineEndpoint({
      name: 'data-studio-list-tables',
      method: 'GET',
      path: '/tables',
      auth: dataStudioPermissionAuth(DATA_STUDIO_READ_PERMISSION),
      query: t.Object({
        status: t.Optional(t.Union([
          DATA_STUDIO_STATUS_SCHEMA,
          t.Literal('all'),
        ])),
      }, { additionalProperties: false }),
      handler: (context) => dataStudioRouteRead(context, 'tables.list', async () => ({
        tables: await dataStudioRequestService(context).listTables(
          context.query.status ?? 'active',
          context.request.signal,
        ),
      })),
    }),
    defineEndpoint({
      name: 'data-studio-get-table',
      method: 'GET',
      path: '/tables/:tableId',
      auth: dataStudioPermissionAuth(DATA_STUDIO_READ_PERMISSION),
      params: t.Object({ tableId: DATA_STUDIO_ID_SCHEMA }, {
        additionalProperties: false,
      }),
      handler: (context) => dataStudioRouteRead(context, 'tables.get', async () => ({
        table: await dataStudioRequestService(context).getTable(
          { tableId: context.params.tableId },
          context.request.signal,
        ),
      })),
    }),
    defineEndpoint({
      name: 'data-studio-create-table',
      method: 'POST',
      path: '/tables',
      auth: dataStudioPermissionAuth(DATA_STUDIO_MANAGE_PERMISSION),
      body: t.Object({
        ...DATA_STUDIO_MUTATION_FIELDS,
        name: t.String({ minLength: 1, maxLength: 120 }),
        key: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
        description: t.Optional(t.Union([
          t.String({ minLength: 1, maxLength: 2_000 }),
          t.Null(),
        ])),
        schema: DATA_STUDIO_LOGICAL_SCHEMA,
      }, { additionalProperties: false }),
      handler: (context) => dataStudioRouteWrite(context, 'tables.create', async () => {
        const result = await dataStudioRequestService(context).createTableWithReceipt({
          name: context.body.name,
          ...(context.body.key === undefined ? {} : { key: context.body.key }),
          ...(context.body.description === undefined
            ? {}
            : { description: context.body.description }),
          schema: context.body.schema as DataStudioSchema,
        }, {
          operationId: context.body.operationId,
          signal: context.request.signal,
        });
        if (!result.replayed) {
          context.zero.observability.emitCode(OBS_CODES.DATA_STUDIO_SCHEMA_CREATED, {
            metadata: {
              operation: 'tables.create',
              schemaRevision: result.value.schemaRevision,
            },
          });
        }
        return { table: result.value };
      }),
    }),
    defineEndpoint({
      name: 'data-studio-update-table',
      method: 'PATCH',
      path: '/tables/:tableId',
      auth: dataStudioPermissionAuth(DATA_STUDIO_MANAGE_PERMISSION),
      params: t.Object({ tableId: DATA_STUDIO_ID_SCHEMA }, {
        additionalProperties: false,
      }),
      body: t.Object({
        ...DATA_STUDIO_MUTATION_FIELDS,
        expectedRevision: DATA_STUDIO_REVISION_SCHEMA,
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        description: t.Optional(t.Union([
          t.String({ minLength: 1, maxLength: 2_000 }),
          t.Null(),
        ])),
        schema: t.Optional(DATA_STUDIO_LOGICAL_SCHEMA),
      }, { additionalProperties: false }),
      handler: (context) => dataStudioRouteWrite(context, 'tables.update', async () => {
        const service = dataStudioRequestService(context);
        const previous = context.body.schema === undefined
          ? null
          : await service.getTable(
              { tableId: context.params.tableId },
              context.request.signal,
            );
        const result = await service.updateTableWithReceipt(
          context.params.tableId,
          {
            expectedRevision: context.body.expectedRevision,
            ...(context.body.name === undefined ? {} : { name: context.body.name }),
            ...(context.body.description === undefined
              ? {}
              : { description: context.body.description }),
            ...(context.body.schema === undefined
              ? {}
              : { schema: context.body.schema as DataStudioSchema }),
          },
          {
            operationId: context.body.operationId,
            signal: context.request.signal,
          },
        );
        if (!result.replayed
          && previous
          && result.value.schemaRevision > previous.schemaRevision) {
          context.zero.observability.emitCode(OBS_CODES.DATA_STUDIO_SCHEMA_UPDATED, {
            metadata: {
              operation: 'tables.update',
              schemaRevision: result.value.schemaRevision,
            },
          });
        }
        return { table: result.value };
      }),
    }),
    defineEndpoint({
      name: 'data-studio-set-table-status',
      method: 'POST',
      path: '/tables/:tableId/status',
      auth: dataStudioPermissionAuth(DATA_STUDIO_MANAGE_PERMISSION),
      params: t.Object({ tableId: DATA_STUDIO_ID_SCHEMA }, {
        additionalProperties: false,
      }),
      body: t.Object({
        ...DATA_STUDIO_MUTATION_FIELDS,
        expectedRevision: DATA_STUDIO_REVISION_SCHEMA,
        status: DATA_STUDIO_STATUS_SCHEMA,
      }, { additionalProperties: false }),
      handler: (context) => dataStudioRouteWrite(context, 'tables.status', async () => {
        const result = await dataStudioRequestService(context).setTableStatusWithReceipt(
          context.params.tableId,
          context.body.expectedRevision,
          context.body.status,
          {
            operationId: context.body.operationId,
            signal: context.request.signal,
          },
        );
        if (!result.replayed && result.value.revision > context.body.expectedRevision) {
          context.zero.observability.emitCode(
            result.value.status === 'archived'
              ? OBS_CODES.DATA_STUDIO_SCHEMA_ARCHIVED
              : OBS_CODES.DATA_STUDIO_SCHEMA_RESTORED,
            {
              metadata: {
                operation: 'tables.status',
                schemaRevision: result.value.schemaRevision,
              },
            },
          );
        }
        return { table: result.value };
      }),
    }),
  ];
}
