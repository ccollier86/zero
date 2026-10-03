/** Scope-closed Data Studio service over one Fabric database capability. */

import type { AsyncDatabaseClient } from '../databases/database-operations';
import { normalizeDataStudioSchema } from './data-studio-codec';
import type {
  DataStudioRow,
  DataStudioSchemaVersion,
  DataStudioTable,
  DataStudioTableSummary,
  DataStudioTableStatus,
} from './data-studio-contracts';
import { mapDataStudioDatabaseFailure } from './data-studio-database-error';
import {
  DATA_STUDIO_COMMAND_NAMES,
  DATA_STUDIO_DEFAULT_PAGE_SIZE,
  DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE,
  DATA_STUDIO_QUERY_NAMES,
  type DataStudioRowDeleteResult,
  type DataStudioRowPage,
} from './data-studio-operation-contracts';
import {
  normalizeDataStudioActorId,
  normalizeDataStudioDescription,
  normalizeDataStudioId,
  normalizeDataStudioRevision,
  normalizeDataStudioTableKey,
  normalizeDataStudioTableName,
} from './data-studio-operation-validation';
import {
  readDataStudioCommandOutput,
  readDataStudioOperationResult,
  readDataStudioRow,
  readDataStudioRowDeleteResult,
  readDataStudioRowPage,
  readDataStudioSchemaVersions,
  readDataStudioTable,
  readDataStudioTables,
} from './data-studio-service-result';
import {
  dataStudioOperationIdentity,
  dataStudioOperationPayload,
  dataStudioRequestValues,
  deriveDataStudioTableKey,
} from './data-studio-service-operation';
import type {
  DataStudioMutationOptions,
  DataStudioMutationReceipt,
  DataStudioRowsRequest,
  DataStudioServiceActor,
  DataStudioServiceOptions,
  DataStudioTableCreateRequest,
  DataStudioTableUpdateRequest,
} from './data-studio-service-contracts';

export type {
  DataStudioMutationOptions,
  DataStudioMutationReceipt,
  DataStudioRowsRequest,
  DataStudioServiceActor,
  DataStudioServiceOptions,
  DataStudioServiceRowFilter,
  DataStudioTableCreateRequest,
  DataStudioTableUpdateRequest,
} from './data-studio-service-contracts';

/**
 * A service instance is permanently bound to one already-scoped database and
 * one projected Guardian actor. It accepts no tenant id, database id, or path.
 */
export class DataStudioService {
  readonly #data: AsyncDatabaseClient;
  readonly #actor: DataStudioServiceActor;

  constructor(options: DataStudioServiceOptions) {
    this.#data = options.data;
    this.#actor = Object.freeze({
      userId: normalizeDataStudioActorId(options.actor.userId, 'Data Studio actor user id'),
      membershipId: normalizeDataStudioActorId(
        options.actor.membershipId,
        'Data Studio actor membership id',
      ),
    });
  }

  async listTables(
    status: DataStudioTableStatus | 'all' = 'active',
    signal?: AbortSignal,
  ): Promise<readonly DataStudioTableSummary[]> {
    return await this.#query(
      DATA_STUDIO_QUERY_NAMES.listTables,
      { status },
      readDataStudioTables,
      signal,
    );
  }

  async getTable(
    selector: { readonly tableId: string } | { readonly key: string },
    signal?: AbortSignal,
  ): Promise<DataStudioTable> {
    const input = 'tableId' in selector
      ? { tableId: normalizeDataStudioId(selector.tableId, 'Data Studio table id') }
      : { key: normalizeDataStudioTableKey(selector.key) };
    return await this.#query(
      DATA_STUDIO_QUERY_NAMES.getTable,
      input,
      readDataStudioTable,
      signal,
    );
  }

  async createTable(
    request: DataStudioTableCreateRequest,
    options: DataStudioMutationOptions,
  ): Promise<DataStudioTable> {
    return (await this.createTableWithReceipt(request, options)).value;
  }

  /** Create a logical table and retain Fabric's durable replay signal. */
  async createTableWithReceipt(
    request: DataStudioTableCreateRequest,
    options: DataStudioMutationOptions,
  ): Promise<DataStudioMutationReceipt<DataStudioTable>> {
    const operation = dataStudioOperationIdentity(
      options.operationId,
      this.#actor,
      'table',
    );
    const name = normalizeDataStudioTableName(request.name);
    return await this.#commandWithReceipt(
      DATA_STUDIO_COMMAND_NAMES.createTable,
      {
        ...this.#actor,
        tableId: operation.entityId,
        name,
        key: request.key === undefined
          ? deriveDataStudioTableKey(name)
          : normalizeDataStudioTableKey(request.key),
        description: normalizeDataStudioDescription(request.description),
        schema: normalizeDataStudioSchema(dataStudioOperationPayload(request.schema)),
      },
      operation.receiptKey,
      readDataStudioTable,
      options.signal,
    );
  }

  async updateTable(
    tableId: string,
    request: DataStudioTableUpdateRequest,
    options: DataStudioMutationOptions,
  ): Promise<DataStudioTable> {
    return (await this.updateTableWithReceipt(tableId, request, options)).value;
  }

  /** Update table metadata/schema and retain Fabric's durable replay signal. */
  async updateTableWithReceipt(
    tableId: string,
    request: DataStudioTableUpdateRequest,
    options: DataStudioMutationOptions,
  ): Promise<DataStudioMutationReceipt<DataStudioTable>> {
    const patch = {
      ...this.#actor,
      tableId: normalizeDataStudioId(tableId, 'Data Studio table id'),
      expectedRevision: normalizeDataStudioRevision(request.expectedRevision),
      ...(request.name === undefined
        ? {}
        : { name: normalizeDataStudioTableName(request.name) }),
      ...(request.description === undefined
        ? {}
        : { description: normalizeDataStudioDescription(request.description) }),
      ...(request.schema === undefined
        ? {}
        : { schema: normalizeDataStudioSchema(dataStudioOperationPayload(request.schema)) }),
    };
    return await this.#commandWithReceipt(
      DATA_STUDIO_COMMAND_NAMES.updateTable,
      patch,
      dataStudioOperationIdentity(options.operationId, this.#actor).receiptKey,
      readDataStudioTable,
      options.signal,
    );
  }

  async setTableStatus(
    tableId: string,
    expectedRevision: number,
    status: DataStudioTableStatus,
    options: DataStudioMutationOptions,
  ): Promise<DataStudioTable> {
    return (await this.setTableStatusWithReceipt(
      tableId,
      expectedRevision,
      status,
      options,
    )).value;
  }

  /** Change archive status and retain Fabric's durable replay signal. */
  async setTableStatusWithReceipt(
    tableId: string,
    expectedRevision: number,
    status: DataStudioTableStatus,
    options: DataStudioMutationOptions,
  ): Promise<DataStudioMutationReceipt<DataStudioTable>> {
    return await this.#commandWithReceipt(
      DATA_STUDIO_COMMAND_NAMES.setTableStatus,
      {
        ...this.#actor,
        tableId: normalizeDataStudioId(tableId, 'Data Studio table id'),
        expectedRevision: normalizeDataStudioRevision(expectedRevision),
        status,
      },
      dataStudioOperationIdentity(options.operationId, this.#actor).receiptKey,
      readDataStudioTable,
      options.signal,
    );
  }

  async listRows(request: DataStudioRowsRequest): Promise<DataStudioRowPage> {
    const input = {
      tableId: normalizeDataStudioId(request.tableId, 'Data Studio table id'),
      limit: request.limit ?? DATA_STUDIO_DEFAULT_PAGE_SIZE,
      offset: request.offset ?? 0,
      ...(request.search === undefined ? {} : { search: request.search }),
      ...(request.filters === undefined ? {} : { filters: request.filters }),
      ...(request.sortColumnId === undefined
        ? {}
        : { sortColumnId: request.sortColumnId }),
      ...(request.sortDirection === undefined
        ? {}
        : { sortDirection: request.sortDirection }),
    };
    return await this.#query(
      DATA_STUDIO_QUERY_NAMES.listRows,
      input,
      readDataStudioRowPage,
      request.signal,
    );
  }

  async getRow(
    tableId: string,
    rowId: string,
    signal?: AbortSignal,
  ): Promise<DataStudioRow> {
    return await this.#query(
      DATA_STUDIO_QUERY_NAMES.getRow,
      {
        tableId: normalizeDataStudioId(tableId, 'Data Studio table id'),
        rowId: normalizeDataStudioId(rowId, 'Data Studio row id'),
      },
      readDataStudioRow,
      signal,
    );
  }

  async createRow(
    tableId: string,
    values: Readonly<Record<string, unknown>>,
    options: DataStudioMutationOptions,
  ): Promise<DataStudioRow> {
    const operation = dataStudioOperationIdentity(options.operationId, this.#actor, 'row');
    return await this.#command(
      DATA_STUDIO_COMMAND_NAMES.createRow,
      {
        ...this.#actor,
        tableId: normalizeDataStudioId(tableId, 'Data Studio table id'),
        rowId: operation.entityId,
        values: dataStudioRequestValues(values),
      },
      operation.receiptKey,
      readDataStudioRow,
      options.signal,
    );
  }

  async replaceRow(
    tableId: string,
    rowId: string,
    expectedRevision: number,
    values: Readonly<Record<string, unknown>>,
    options: DataStudioMutationOptions,
  ): Promise<DataStudioRow> {
    return await this.#command(
      DATA_STUDIO_COMMAND_NAMES.replaceRow,
      {
        ...this.#actor,
        tableId: normalizeDataStudioId(tableId, 'Data Studio table id'),
        rowId: normalizeDataStudioId(rowId, 'Data Studio row id'),
        expectedRevision: normalizeDataStudioRevision(expectedRevision),
        values: dataStudioRequestValues(values),
      },
      dataStudioOperationIdentity(options.operationId, this.#actor).receiptKey,
      readDataStudioRow,
      options.signal,
    );
  }

  async deleteRow(
    tableId: string,
    rowId: string,
    expectedRevision: number,
    options: DataStudioMutationOptions,
  ): Promise<DataStudioRowDeleteResult> {
    return await this.#command(
      DATA_STUDIO_COMMAND_NAMES.deleteRow,
      {
        ...this.#actor,
        tableId: normalizeDataStudioId(tableId, 'Data Studio table id'),
        rowId: normalizeDataStudioId(rowId, 'Data Studio row id'),
        expectedRevision: normalizeDataStudioRevision(expectedRevision),
      },
      dataStudioOperationIdentity(options.operationId, this.#actor).receiptKey,
      readDataStudioRowDeleteResult,
      options.signal,
    );
  }

  async listSchemaVersions(
    tableId: string,
    options: {
      readonly limit?: number;
      readonly beforeRevision?: number;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<readonly DataStudioSchemaVersion[]> {
    return await this.#query(
      DATA_STUDIO_QUERY_NAMES.listSchemaVersions,
      {
        tableId: normalizeDataStudioId(tableId, 'Data Studio table id'),
        limit: options.limit ?? DATA_STUDIO_MAX_SCHEMA_PAGE_SIZE,
        ...(options.beforeRevision === undefined
          ? {}
          : { beforeRevision: normalizeDataStudioRevision(options.beforeRevision) }),
      },
      readDataStudioSchemaVersions,
      options.signal,
    );
  }

  async #query<T>(
    name: string,
    input: unknown,
    reader: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      const result = await this.#data.query(
        name,
        dataStudioOperationPayload(input),
        { signal },
      );
      return readDataStudioOperationResult(result.value, reader);
    } catch (error) {
      throw mapDataStudioDatabaseFailure(error, 'read');
    }
  }

  async #command<T>(
    name: string,
    input: unknown,
    idempotencyKey: string,
    reader: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    return (await this.#commandWithReceipt(
      name,
      input,
      idempotencyKey,
      reader,
      signal,
    )).value;
  }

  async #commandWithReceipt<T>(
    name: string,
    input: unknown,
    idempotencyKey: string,
    reader: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<DataStudioMutationReceipt<T>> {
    try {
      const result = await this.#data.command(name, dataStudioOperationPayload(input), {
        idempotencyKey,
        signal,
      });
      return Object.freeze({
        value: readDataStudioOperationResult(
          readDataStudioCommandOutput(result.value, name),
          reader,
        ),
        replayed: result.replayed,
      });
    } catch (error) {
      throw mapDataStudioDatabaseFailure(error, 'write');
    }
  }
}

/** Create a service while preserving its scope-closed runtime capability. */
export function createDataStudioService(
  options: DataStudioServiceOptions,
): DataStudioService {
  return new DataStudioService(options);
}
