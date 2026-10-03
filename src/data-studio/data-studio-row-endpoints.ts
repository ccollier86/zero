/** Logical-row and schema-history HTTP endpoints. */

import { t } from 'elysia';
import { defineEndpoint } from '../frontend/server/server-extensions';
import {
  DATA_STUDIO_READ_PERMISSION,
  DATA_STUDIO_WRITE_PERMISSION,
} from './data-studio-access';
import {
  DATA_STUDIO_MAX_PAGE_SIZE,
  DATA_STUDIO_MAX_ROWS_PER_TABLE,
  DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE,
} from './data-studio-operation-contracts';
import {
  dataStudioPermissionAuth,
  dataStudioRequestService,
  dataStudioRouteRead,
  dataStudioRouteWrite,
  parseDataStudioFilters,
} from './data-studio-router-runtime';
import {
  DATA_STUDIO_ID_SCHEMA,
  DATA_STUDIO_MUTATION_FIELDS,
  DATA_STUDIO_REVISION_SCHEMA,
  DATA_STUDIO_VALUES_SCHEMA,
} from './data-studio-router-schemas';

export function createDataStudioRowEndpoints() {
  return [
    defineEndpoint({
      name: 'data-studio-list-rows',
      method: 'GET',
      path: '/tables/:tableId/rows',
      auth: dataStudioPermissionAuth(DATA_STUDIO_READ_PERMISSION),
      params: t.Object({ tableId: DATA_STUDIO_ID_SCHEMA }, {
        additionalProperties: false,
      }),
      query: t.Object({
        limit: t.Optional(t.Numeric({
          minimum: 1,
          maximum: DATA_STUDIO_MAX_PAGE_SIZE,
        })),
        offset: t.Optional(t.Numeric({
          minimum: 0,
          maximum: DATA_STUDIO_MAX_ROWS_PER_TABLE,
        })),
        search: t.Optional(t.String({ maxLength: 200 })),
        filter: t.Optional(t.String({ maxLength: 8_192 })),
        sortColumnId: t.Optional(DATA_STUDIO_ID_SCHEMA),
        sortDirection: t.Optional(t.Union([
          t.Literal('asc'),
          t.Literal('desc'),
        ])),
      }, { additionalProperties: false }),
      handler: (context) => dataStudioRouteRead(context, 'rows.list', async () => (
        await dataStudioRequestService(context).listRows({
          tableId: context.params.tableId,
          ...(context.query.limit === undefined ? {} : { limit: context.query.limit }),
          ...(context.query.offset === undefined ? {} : { offset: context.query.offset }),
          ...(context.query.search === undefined ? {} : { search: context.query.search }),
          ...(context.query.filter === undefined
            ? {}
            : { filters: parseDataStudioFilters(context.query.filter) }),
          ...(context.query.sortColumnId === undefined
            ? {}
            : { sortColumnId: context.query.sortColumnId }),
          ...(context.query.sortDirection === undefined
            ? {}
            : { sortDirection: context.query.sortDirection }),
          signal: context.request.signal,
        })
      )),
    }),
    defineEndpoint({
      name: 'data-studio-get-row',
      method: 'GET',
      path: '/tables/:tableId/rows/:rowId',
      auth: dataStudioPermissionAuth(DATA_STUDIO_READ_PERMISSION),
      params: t.Object({
        tableId: DATA_STUDIO_ID_SCHEMA,
        rowId: DATA_STUDIO_ID_SCHEMA,
      }, { additionalProperties: false }),
      handler: (context) => dataStudioRouteRead(context, 'rows.get', async () => ({
        row: await dataStudioRequestService(context).getRow(
          context.params.tableId,
          context.params.rowId,
          context.request.signal,
        ),
      })),
    }),
    defineEndpoint({
      name: 'data-studio-create-row',
      method: 'POST',
      path: '/tables/:tableId/rows',
      auth: dataStudioPermissionAuth(DATA_STUDIO_WRITE_PERMISSION),
      params: t.Object({ tableId: DATA_STUDIO_ID_SCHEMA }, {
        additionalProperties: false,
      }),
      body: t.Object({
        ...DATA_STUDIO_MUTATION_FIELDS,
        values: DATA_STUDIO_VALUES_SCHEMA,
      }, { additionalProperties: false }),
      handler: (context) => dataStudioRouteWrite(context, 'rows.create', async () => ({
        row: await dataStudioRequestService(context).createRow(
          context.params.tableId,
          context.body.values,
          {
            operationId: context.body.operationId,
            signal: context.request.signal,
          },
        ),
      })),
    }),
    defineEndpoint({
      name: 'data-studio-replace-row',
      method: 'PUT',
      path: '/tables/:tableId/rows/:rowId',
      auth: dataStudioPermissionAuth(DATA_STUDIO_WRITE_PERMISSION),
      params: t.Object({
        tableId: DATA_STUDIO_ID_SCHEMA,
        rowId: DATA_STUDIO_ID_SCHEMA,
      }, { additionalProperties: false }),
      body: t.Object({
        ...DATA_STUDIO_MUTATION_FIELDS,
        expectedRevision: DATA_STUDIO_REVISION_SCHEMA,
        values: DATA_STUDIO_VALUES_SCHEMA,
      }, { additionalProperties: false }),
      handler: (context) => dataStudioRouteWrite(context, 'rows.replace', async () => ({
        row: await dataStudioRequestService(context).replaceRow(
          context.params.tableId,
          context.params.rowId,
          context.body.expectedRevision,
          context.body.values,
          {
            operationId: context.body.operationId,
            signal: context.request.signal,
          },
        ),
      })),
    }),
    defineEndpoint({
      name: 'data-studio-delete-row',
      method: 'DELETE',
      path: '/tables/:tableId/rows/:rowId',
      auth: dataStudioPermissionAuth(DATA_STUDIO_WRITE_PERMISSION),
      params: t.Object({
        tableId: DATA_STUDIO_ID_SCHEMA,
        rowId: DATA_STUDIO_ID_SCHEMA,
      }, { additionalProperties: false }),
      body: t.Object({
        ...DATA_STUDIO_MUTATION_FIELDS,
        expectedRevision: DATA_STUDIO_REVISION_SCHEMA,
      }, { additionalProperties: false }),
      handler: (context) => dataStudioRouteWrite(context, 'rows.delete', async () => (
        await dataStudioRequestService(context).deleteRow(
          context.params.tableId,
          context.params.rowId,
          context.body.expectedRevision,
          {
            operationId: context.body.operationId,
            signal: context.request.signal,
          },
        )
      )),
    }),
    defineEndpoint({
      name: 'data-studio-list-schema-versions',
      method: 'GET',
      path: '/tables/:tableId/schema-versions',
      auth: dataStudioPermissionAuth(DATA_STUDIO_READ_PERMISSION),
      params: t.Object({ tableId: DATA_STUDIO_ID_SCHEMA }, {
        additionalProperties: false,
      }),
      query: t.Object({
        limit: t.Optional(t.Numeric({
          minimum: 1,
          maximum: DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE,
        })),
        beforeRevision: t.Optional(t.Numeric({ minimum: 1 })),
      }, { additionalProperties: false }),
      handler: (context) => dataStudioRouteRead(
        context,
        'schema-versions.list',
        async () => ({
          versions: await dataStudioRequestService(context).listSchemaVersions(
            context.params.tableId,
            {
              ...(context.query.limit === undefined
                ? {}
                : { limit: context.query.limit }),
              ...(context.query.beforeRevision === undefined
                ? {}
                : { beforeRevision: context.query.beforeRevision }),
              signal: context.request.signal,
            },
          ),
        }),
      ),
    }),
  ];
}
