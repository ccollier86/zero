/**
 * database-operations.ts
 *
 * Callback-free, structured-clone-safe operations for an asynchronous Zero
 * database executor. These values are the public data-plane contract; actor
 * routing, physical paths, raw SQL, and authorization-derived database
 * selection deliberately live outside it.
 */

import { types as utilTypes } from 'node:util';
import { DatabaseError } from './database-error';

/** Maximum nesting accepted in an operation payload. */
export const DATABASE_OPERATION_MAX_DEPTH = 16;

/** Maximum total scalar/container nodes accepted in one operation. */
export const DATABASE_OPERATION_MAX_NODES = 10_000;

/** Maximum estimated UTF-8 payload size accepted in one operation. */
export const DATABASE_OPERATION_MAX_BYTES = 1_048_576;

/** Maximum UTF-8 size of one string value. */
export const DATABASE_OPERATION_MAX_STRING_BYTES = 262_144;

/** Maximum number of properties in one payload object. */
export const DATABASE_OPERATION_MAX_OBJECT_ENTRIES = 1_024;

/** Maximum number of items in one payload array. */
export const DATABASE_OPERATION_MAX_ARRAY_ITEMS = 10_000;

/** Maximum number of mutations or assertions in one atomic batch. */
export const DATABASE_OPERATION_MAX_BATCH_ITEMS = 256;

/** Maximum rows one built-in list operation may request. */
export const DATABASE_LIST_MAX_ROWS = 500;

/** Maximum UTF-8 size of a row primary-key value. */
export const DATABASE_OPERATION_MAX_ID_BYTES = 1_024;

/** Maximum length of a registry/table name. */
export const DATABASE_OPERATION_MAX_NAME_LENGTH = 128;

/** Maximum length of a write idempotency key. */
export const DATABASE_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

const REGISTRY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u;
const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RESERVED_PAYLOAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const textEncoder = new TextEncoder();

/** JSON-compatible scalar supported by the executor protocol. */
export type DatabaseSerializableScalar = string | number | boolean | null;

/**
 * Canonical payload supported by database operations and actor-local handlers.
 *
 * It is intentionally narrower than JavaScript structured clone: values which
 * are lossy in ReactiveDB's durable change/receipt representation (undefined,
 * bigint, Date, Map, Set, typed arrays, custom prototypes, and sparse arrays)
 * are rejected before dispatch.
 */
export type DatabaseSerializableValue =
  | DatabaseSerializableScalar
  | readonly DatabaseSerializableValue[]
  | { readonly [key: string]: DatabaseSerializableValue };

/** Canonical row/patch data accepted by managed ReactiveDB mutations. */
export type DatabaseOperationRow = Readonly<
  Record<string, DatabaseSerializableValue>
>;

/** Durable per-database ordering token returned by every successful operation. */
export interface DatabaseSequenceToken {
  readonly seq: number;
}

export interface DatabaseSnapshotConsistency {
  readonly mode: 'snapshot';
}

export interface DatabaseReadYourWritesConsistency {
  readonly mode: 'read-your-writes';
  readonly minSeq: DatabaseSequenceToken;
}

export interface DatabaseStrongConsistency {
  readonly mode: 'strong';
}

/** Explicit read routing and visibility guarantee. */
export type DatabaseReadConsistency =
  | DatabaseSnapshotConsistency
  | DatabaseReadYourWritesConsistency
  | DatabaseStrongConsistency;

/** Built-in primary-key lookup. */
export interface DatabaseGetOperation {
  readonly type: 'get';
  readonly table: string;
  readonly id: string;
  readonly consistency?: DatabaseReadConsistency;
}

/**
 * Built-in bounded primary-key page.
 *
 * Actors order by the declared primary key ascending and apply `after` as an
 * exclusive cursor. `limit` is required so no valid operation means "scan the
 * complete table".
 */
export interface DatabaseListOperation {
  readonly type: 'list';
  readonly table: string;
  readonly limit: number;
  readonly after?: string;
  readonly consistency?: DatabaseReadConsistency;
}

/** Invoke a named, actor-local, synchronous read handler. */
export interface DatabaseQueryOperation {
  readonly type: 'query';
  readonly name: string;
  readonly input: DatabaseSerializableValue;
  readonly consistency?: DatabaseReadConsistency;
}

/** Strict insert. The actor maps this to ReactiveDB.createStrict(). */
export interface DatabaseCreateMutation {
  readonly type: 'create';
  readonly table: string;
  readonly row: DatabaseOperationRow;
}

/** Primary-key upsert. The actor maps this to ReactiveDB.create()/insert(). */
export interface DatabaseUpsertMutation {
  readonly type: 'upsert';
  readonly table: string;
  readonly row: DatabaseOperationRow;
}

/** Partial primary-key update. */
export interface DatabaseUpdateMutation {
  readonly type: 'update';
  readonly table: string;
  readonly id: string;
  readonly patch: DatabaseOperationRow;
}

/** Primary-key delete. */
export interface DatabaseDeleteMutation {
  readonly type: 'delete';
  readonly table: string;
  readonly id: string;
}

/** Safe CRUD primitives executable by the writer actor. */
export type DatabaseMutation =
  | DatabaseCreateMutation
  | DatabaseUpsertMutation
  | DatabaseUpdateMutation
  | DatabaseDeleteMutation;

/** Require that a primary-key row exists at the batch snapshot. */
export interface DatabaseRowExistsAssertion {
  readonly type: 'row-exists';
  readonly table: string;
  readonly id: string;
}

/** Require that a primary-key row is absent at the batch snapshot. */
export interface DatabaseRowMissingAssertion {
  readonly type: 'row-missing';
  readonly table: string;
  readonly id: string;
}

/** Require exact canonical equality with the current primary-key row. */
export interface DatabaseRowEqualsAssertion {
  readonly type: 'row-equals';
  readonly table: string;
  readonly id: string;
  readonly row: DatabaseOperationRow;
}

/** Require the durable database sequence to equal a known token. */
export interface DatabaseSequenceEqualsAssertion {
  readonly type: 'sequence-equals';
  readonly sequence: DatabaseSequenceToken;
}

/** Declarative preconditions evaluated inside the batch transaction. */
export type DatabaseAssertion =
  | DatabaseRowExistsAssertion
  | DatabaseRowMissingAssertion
  | DatabaseRowEqualsAssertion
  | DatabaseSequenceEqualsAssertion;

/** Execute one managed mutation with a durable deduplication key. */
export interface DatabaseMutateOperation {
  readonly type: 'mutate';
  readonly idempotencyKey: string;
  readonly mutation: DatabaseMutation;
}

/** Evaluate assertions and mutations atomically in their declared order. */
export interface DatabaseBatchOperation {
  readonly type: 'batch';
  readonly idempotencyKey: string;
  readonly assertions?: readonly DatabaseAssertion[];
  readonly mutations: readonly DatabaseMutation[];
}

/** Invoke a named, actor-local, synchronous write handler exactly once. */
export interface DatabaseCommandOperation {
  readonly type: 'command';
  readonly name: string;
  readonly input: DatabaseSerializableValue;
  readonly idempotencyKey: string;
}

export type DatabaseReadOperation =
  | DatabaseGetOperation
  | DatabaseListOperation
  | DatabaseQueryOperation;

export type DatabaseWriteOperation =
  | DatabaseMutateOperation
  | DatabaseBatchOperation
  | DatabaseCommandOperation;

/** Complete callback-free public operation union. */
export type DatabaseOperation = DatabaseReadOperation | DatabaseWriteOperation;

/** A read value and the durable sequence represented by its SQLite snapshot. */
export interface DatabaseReadResult<T extends DatabaseSerializableValue = DatabaseSerializableValue> {
  readonly value: T;
  readonly sequence: DatabaseSequenceToken;
}

/** A committed value and its durable sequence/idempotency receipt. */
export interface DatabaseCommitResult<T extends DatabaseSerializableValue = DatabaseSerializableValue> {
  readonly value: T;
  readonly sequence: DatabaseSequenceToken;
  readonly idempotencyKey: string;
  /** True when a prior durable receipt supplied the result without re-execution. */
  readonly replayed: boolean;
}

/** One bounded built-in list page and the exclusive cursor for the next page. */
export type DatabaseListPage = Readonly<{
  readonly rows: readonly DatabaseOperationRow[];
  readonly nextCursor: string | null;
}>;

/** Public convenience input for a bounded list page. */
export interface DatabaseListPageOptions {
  readonly limit: number;
  readonly after?: string;
}

/** Low-level asynchronous executor contract used by bound public facades. */
export interface AsyncDatabaseOperationExecutor {
  execute(
    operation: DatabaseReadOperation,
    options?: DatabaseOperationExecutionOptions,
  ): Promise<DatabaseReadResult>;
  execute(
    operation: DatabaseWriteOperation,
    options?: DatabaseOperationExecutionOptions,
  ): Promise<DatabaseCommitResult>;
  execute(
    operation: DatabaseOperation,
    options?: DatabaseOperationExecutionOptions,
  ): Promise<DatabaseReadResult | DatabaseCommitResult>;
}

/** Cancellation and bounded-wait policy for one actor-backed operation. */
export interface DatabaseOperationExecutionOptions {
  /** Cancellation is honored only before actor dispatch. */
  readonly signal?: AbortSignal;
  /** Maximum time waiting for writer-lane admission. */
  readonly queueTimeoutMs?: number;
  /** Maximum time awaiting the dispatched actor result. */
  readonly operationTimeoutMs?: number;
}

/** Read consistency plus bounded-wait policy. */
export interface DatabaseReadOptions extends DatabaseOperationExecutionOptions {
  readonly consistency?: DatabaseReadConsistency;
}

/** Serializable idempotency and bounded-wait policy for a mutation/command. */
export interface DatabaseMutationOptions extends DatabaseOperationExecutionOptions {
  readonly idempotencyKey: string;
}

/** Serializable input for one atomic batch call. */
export interface DatabaseBatchInput {
  readonly assertions?: readonly DatabaseAssertion[];
  readonly mutations: readonly DatabaseMutation[];
}

/**
 * Intended bound application facade. Implementations derive database routing
 * from trusted context; no path, logical database id, or tenant id is accepted.
 */
export interface AsyncDatabaseClient {
  get(
    table: string,
    id: string,
    options?: DatabaseReadOptions,
  ): Promise<DatabaseReadResult<DatabaseOperationRow | null>>;
  list(
    table: string,
    page: DatabaseListPageOptions,
    options?: DatabaseReadOptions,
  ): Promise<DatabaseReadResult<DatabaseListPage>>;
  query(
    name: string,
    input: DatabaseSerializableValue,
    options?: DatabaseReadOptions,
  ): Promise<DatabaseReadResult<DatabaseSerializableValue>>;
  mutate(
    mutation: DatabaseMutation,
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult>;
  batch(
    input: DatabaseBatchInput,
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult>;
  command(
    name: string,
    input: DatabaseSerializableValue,
    options: DatabaseMutationOptions,
  ): Promise<DatabaseCommitResult<DatabaseSerializableValue>>;
}

/** Local registry knowledge used for admission before an actor executes work. */
export interface DatabaseOperationCatalog {
  readonly tables?: readonly string[];
  readonly queries?: readonly string[];
  readonly commands?: readonly string[];
  /** Optional actor-local column catalog for strict managed-mutation admission. */
  readonly columns?: Readonly<Record<string, readonly string[]>>;
  /** Optional actor-local primary-key catalog used to reject PK patches. */
  readonly primaryKeys?: Readonly<Record<string, string>>;
}

/** Return true for a portable realm/query/command registry name. */
export function isDatabaseRegistryName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= DATABASE_OPERATION_MAX_NAME_LENGTH
    && !RESERVED_PAYLOAD_KEYS.has(value)
    && REGISTRY_NAME_PATTERN.test(value);
}

/** Return true for a ReactiveDB-compatible SQL table/column identifier. */
export function isDatabaseTableName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= DATABASE_OPERATION_MAX_NAME_LENGTH
    && !RESERVED_PAYLOAD_KEYS.has(value)
    && TABLE_NAME_PATTERN.test(value);
}

/** Return true for a bounded opaque mutation deduplication key. */
export function isDatabaseIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= DATABASE_IDEMPOTENCY_KEY_MAX_LENGTH
    && IDEMPOTENCY_KEY_PATTERN.test(value);
}

/** Create an immutable validated sequence token. */
export function createDatabaseSequenceToken(seq: number): DatabaseSequenceToken {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw payloadInvalid('Database sequence must be a non-negative safe integer.');
  }
  return Object.freeze({ seq });
}

/**
 * Validate, detach, and deeply freeze a canonical operation payload value.
 * This function is also the actor boundary for registered handler input/output.
 */
export function cloneDatabaseSerializableValue<T extends DatabaseSerializableValue>(
  value: T,
): T;
export function cloneDatabaseSerializableValue(value: unknown): DatabaseSerializableValue;
export function cloneDatabaseSerializableValue(value: unknown): DatabaseSerializableValue {
  const state: PayloadState = {
    bytes: 0,
    nodes: 0,
    ancestors: new Set<object>(),
  };
  return clonePayload(value, state, 0);
}

/** Return true only when a value satisfies the canonical payload contract. */
export function isDatabaseSerializableValue(
  value: unknown,
): value is DatabaseSerializableValue {
  try {
    cloneDatabaseSerializableValue(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate an untrusted operation, reject extensions, and return an immutable
 * detached envelope safe to enqueue or structured-clone to an actor.
 */
export function validateDatabaseOperation(
  value: unknown,
  catalog: DatabaseOperationCatalog = {},
): DatabaseOperation {
  // Validate the complete untrusted envelope against one shared budget before
  // cloning individual rows. Otherwise a large batch could contain many
  // values which each sit just below the per-value limit.
  const detached = cloneDatabaseSerializableValue(value);
  const record = operationRecord(detached);
  const type = requireStringField(record, 'type');

  switch (type) {
    case 'get': {
      assertExactFields(record, ['type', 'table', 'id', 'consistency']);
      return finalizeOperation({
        type,
        table: validateTable(record.table, catalog),
        id: validateRowId(record.id),
        ...optionalConsistency(record, 'consistency'),
      });
    }
    case 'list': {
      assertExactFields(record, [
        'type',
        'table',
        'limit',
        'after',
        'consistency',
      ]);
      const limit = record.limit;
      if (!Number.isSafeInteger(limit)
        || (limit as number) < 1
        || (limit as number) > DATABASE_LIST_MAX_ROWS) {
        throw payloadInvalid(
          `Database list limit must be between 1 and ${DATABASE_LIST_MAX_ROWS}.`,
        );
      }
      return finalizeOperation({
        type,
        table: validateTable(record.table, catalog),
        limit: limit as number,
        ...(!hasOwnField(record, 'after')
          ? {}
          : { after: validateRowId(record.after) }),
        ...optionalConsistency(record, 'consistency'),
      });
    }
    case 'query': {
      assertExactFields(record, ['type', 'name', 'input', 'consistency']);
      requireOwnField(record, 'input');
      const name = validateHandlerName(record.name, catalog.queries, 'query');
      return finalizeOperation({
        type,
        name,
        input: cloneDatabaseSerializableValue(record.input),
        ...optionalConsistency(record, 'consistency'),
      });
    }
    case 'mutate': {
      assertExactFields(record, ['type', 'idempotencyKey', 'mutation']);
      requireOwnField(record, 'mutation');
      return finalizeOperation({
        type,
        idempotencyKey: validateIdempotencyKey(record.idempotencyKey),
        mutation: validateMutation(record.mutation, catalog),
      });
    }
    case 'batch': {
      assertExactFields(record, [
        'type',
        'idempotencyKey',
        'assertions',
        'mutations',
      ]);
      requireOwnField(record, 'mutations');
      const assertions = !hasOwnField(record, 'assertions')
        ? undefined
        : validateArray(
          record.assertions,
          'assertions',
          (entry) => validateAssertion(entry, catalog),
        );
      const mutations = validateArray(
        record.mutations,
        'mutations',
        (entry) => validateMutation(entry, catalog),
      );
      if (mutations.length === 0) {
        throw payloadInvalid('A database batch must contain at least one mutation.');
      }
      return finalizeOperation({
        type,
        idempotencyKey: validateIdempotencyKey(record.idempotencyKey),
        ...(assertions === undefined ? {} : { assertions }),
        mutations,
      });
    }
    case 'command': {
      assertExactFields(record, ['type', 'name', 'input', 'idempotencyKey']);
      requireOwnField(record, 'input');
      const name = validateHandlerName(record.name, catalog.commands, 'command');
      return finalizeOperation({
        type,
        name,
        input: cloneDatabaseSerializableValue(record.input),
        idempotencyKey: validateIdempotencyKey(record.idempotencyKey),
      });
    }
    default:
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Unsupported database operation type.',
      );
  }
}

/** Validate and detach an untrusted actor read result. */
export function validateDatabaseReadResult(
  value: unknown,
): DatabaseReadResult {
  const record = operationRecord(cloneDatabaseSerializableValue(value));
  assertExactFields(record, ['value', 'sequence']);
  requireOwnField(record, 'value');
  requireOwnField(record, 'sequence');
  return finalizeResult({
    value: cloneDatabaseSerializableValue(record.value),
    sequence: validateSequenceToken(record.sequence),
  });
}

/** Validate and detach an untrusted actor commit/idempotency result. */
export function validateDatabaseCommitResult(
  value: unknown,
): DatabaseCommitResult {
  const record = operationRecord(cloneDatabaseSerializableValue(value));
  assertExactFields(record, ['value', 'sequence', 'idempotencyKey', 'replayed']);
  requireOwnField(record, 'value');
  requireOwnField(record, 'sequence');
  const replayed = record.replayed;
  if (typeof replayed !== 'boolean') {
    throw payloadInvalid('Database commit replayed flag must be a boolean.');
  }
  return finalizeResult({
    value: cloneDatabaseSerializableValue(record.value),
    sequence: validateSequenceToken(record.sequence),
    idempotencyKey: validateIdempotencyKey(record.idempotencyKey),
    replayed,
  });
}

interface PayloadState {
  bytes: number;
  nodes: number;
  readonly ancestors: Set<object>;
}

type DataRecord = Record<string, unknown>;

function clonePayload(
  value: unknown,
  state: PayloadState,
  depth: number,
): DatabaseSerializableValue {
  addNode(state);
  if (depth > DATABASE_OPERATION_MAX_DEPTH) {
    throw payloadLimit('Database payload nesting limit exceeded.');
  }

  if (value === null) {
    addBytes(state, 1);
    return null;
  }
  if (typeof value === 'string') {
    validatePayloadString(value, state);
    return value;
  }
  if (typeof value === 'boolean') {
    addBytes(state, 1);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw payloadInvalid('Database payload numbers must be finite canonical values.');
    }
    addBytes(state, 8);
    return value;
  }
  if (typeof value !== 'object') {
    throw payloadInvalid('Database payload contains an unsupported value.');
  }
  if (isProxy(value)) {
    throw payloadInvalid('Database payload proxies are not supported.');
  }
  if (state.ancestors.has(value)) {
    throw payloadInvalid('Database payload must not contain cycles.');
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = safeOwnKeys(value);
      if (value.length > DATABASE_OPERATION_MAX_ARRAY_ITEMS) {
        throw payloadLimit('Database payload array limit exceeded.');
      }
      if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
        throw payloadInvalid('Database payload arrays must be dense and unextended.');
      }
      const descriptors = safeDescriptors(value);

      const clone: DatabaseSerializableValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw payloadInvalid('Database payload arrays must use data elements.');
        }
        clone.push(clonePayload(descriptor.value, state, depth + 1));
      }
      addBytes(state, value.length + 2);
      return Object.freeze(clone);
    }

    const prototype = safePrototype(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw payloadInvalid('Database payload objects must use a plain prototype.');
    }
    const ownKeys = safeOwnKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) {
      throw payloadInvalid('Database payload symbol keys are not supported.');
    }
    if (ownKeys.length > DATABASE_OPERATION_MAX_OBJECT_ENTRIES) {
      throw payloadLimit('Database payload object-property limit exceeded.');
    }
    const descriptors = safeDescriptors(value);

    const clone: Record<string, DatabaseSerializableValue> = {};
    for (const key of ownKeys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw payloadInvalid('Database payload objects must use enumerable data properties.');
      }
      validatePayloadKey(key, state);
      clone[key] = clonePayload(descriptor.value, state, depth + 1);
    }
    addBytes(state, ownKeys.length + 2);
    return Object.freeze(clone);
  } finally {
    state.ancestors.delete(value);
  }
}

function validatePayloadString(value: string, state: PayloadState): void {
  if (value.length > DATABASE_OPERATION_MAX_STRING_BYTES) {
    throw payloadLimit('Database payload string limit exceeded.');
  }
  if (!isWellFormedUnicode(value)) {
    throw payloadInvalid('Database payload strings must contain well-formed Unicode.');
  }
  const bytes = textEncoder.encode(value).byteLength;
  if (bytes > DATABASE_OPERATION_MAX_STRING_BYTES) {
    throw payloadLimit('Database payload string limit exceeded.');
  }
  addBytes(state, bytes);
}

function validatePayloadKey(key: string, state: PayloadState): void {
  if (key.length > DATABASE_OPERATION_MAX_NAME_LENGTH) {
    throw payloadLimit('Database payload object key limit exceeded.');
  }
  if (RESERVED_PAYLOAD_KEYS.has(key)
    || key.length === 0
    || !isWellFormedUnicode(key)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(key)) {
    throw payloadInvalid('Database payload contains an unsafe object key.');
  }
  const bytes = textEncoder.encode(key).byteLength;
  addBytes(state, bytes);
}

function addNode(state: PayloadState): void {
  state.nodes += 1;
  if (state.nodes > DATABASE_OPERATION_MAX_NODES) {
    throw payloadLimit('Database payload node limit exceeded.');
  }
}

function addBytes(state: PayloadState, count: number): void {
  state.bytes += count;
  if (state.bytes > DATABASE_OPERATION_MAX_BYTES) {
    throw payloadLimit('Database payload size limit exceeded.');
  }
}

function operationRecord(value: unknown): DataRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw payloadInvalid('Database operation must be a plain object.');
  }
  if (isProxy(value)) {
    throw payloadInvalid('Database operation proxies are not supported.');
  }
  const prototype = safePrototype(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw payloadInvalid('Database operation must use a plain prototype.');
  }

  const descriptors = safeDescriptors(value);
  const keys = safeOwnKeys(value);
  if (keys.some((key) => typeof key !== 'string')) {
    throw payloadInvalid('Database operation must not contain symbol fields.');
  }
  const record: DataRecord = Object.create(null) as DataRecord;
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw payloadInvalid('Database operation fields must be enumerable data properties.');
    }
    record[key] = descriptor.value;
  }
  return record;
}

function validateMutation(
  value: unknown,
  catalog: DatabaseOperationCatalog,
): DatabaseMutation {
  const record = operationRecord(value);
  const type = requireStringField(record, 'type');
  switch (type) {
    case 'create':
    case 'upsert': {
      assertExactFields(record, ['type', 'table', 'row']);
      requireOwnField(record, 'row');
      const table = validateTable(record.table, catalog);
      return Object.freeze({
        type,
        table,
        row: validateRow(record.row, table, catalog, false),
      });
    }
    case 'update': {
      assertExactFields(record, ['type', 'table', 'id', 'patch']);
      requireOwnField(record, 'patch');
      const table = validateTable(record.table, catalog);
      return Object.freeze({
        type,
        table,
        id: validateRowId(record.id),
        patch: validateRow(record.patch, table, catalog, true),
      });
    }
    case 'delete': {
      assertExactFields(record, ['type', 'table', 'id']);
      return Object.freeze({
        type,
        table: validateTable(record.table, catalog),
        id: validateRowId(record.id),
      });
    }
    default:
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Unsupported database mutation type.',
      );
  }
}

function validateAssertion(
  value: unknown,
  catalog: DatabaseOperationCatalog,
): DatabaseAssertion {
  const record = operationRecord(value);
  const type = requireStringField(record, 'type');
  switch (type) {
    case 'row-exists':
    case 'row-missing': {
      assertExactFields(record, ['type', 'table', 'id']);
      return Object.freeze({
        type,
        table: validateTable(record.table, catalog),
        id: validateRowId(record.id),
      });
    }
    case 'row-equals': {
      assertExactFields(record, ['type', 'table', 'id', 'row']);
      requireOwnField(record, 'row');
      const table = validateTable(record.table, catalog);
      return Object.freeze({
        type,
        table,
        id: validateRowId(record.id),
        row: validateRow(record.row, table, catalog, false),
      });
    }
    case 'sequence-equals': {
      assertExactFields(record, ['type', 'sequence']);
      return Object.freeze({
        type,
        sequence: validateSequenceToken(record.sequence),
      });
    }
    default:
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Unsupported database assertion type.',
      );
  }
}

function validateRow(
  value: unknown,
  table: string,
  catalog: DatabaseOperationCatalog,
  partial: boolean,
): DatabaseOperationRow {
  const clone = cloneDatabaseSerializableValue(value);
  if (clone === null || Array.isArray(clone) || typeof clone !== 'object') {
    throw payloadInvalid('Database mutation row must be a plain object.');
  }
  const registeredColumns = catalog.columns?.[table];
  for (const column of Object.keys(clone)) {
    if (!isDatabaseTableName(column)) {
      throw payloadInvalid('Database mutation row contains an invalid column name.');
    }
    if (registeredColumns && !registeredColumns.includes(column)) {
      throw payloadInvalid('Database mutation row contains an unregistered column.');
    }
  }
  const primaryKey = catalog.primaryKeys?.[table];
  if (partial && primaryKey
    && Object.prototype.hasOwnProperty.call(clone, primaryKey)) {
    throw payloadInvalid('Database update patches must not contain the primary key.');
  }
  return clone as DatabaseOperationRow;
}

function optionalConsistency(
  record: DataRecord,
  field: string,
): { consistency?: DatabaseReadConsistency } {
  return !hasOwnField(record, field)
    ? {}
    : { consistency: validateConsistency(record[field]) };
}

function validateConsistency(value: unknown): DatabaseReadConsistency {
  const record = operationRecord(value);
  const mode = requireStringField(record, 'mode');
  switch (mode) {
    case 'snapshot':
    case 'strong':
      assertExactFields(record, ['mode']);
      return Object.freeze({ mode });
    case 'read-your-writes':
      assertExactFields(record, ['mode', 'minSeq']);
      return Object.freeze({
        mode,
        minSeq: validateSequenceToken(record.minSeq),
      });
    default:
      throw payloadInvalid('Invalid database read consistency mode.');
  }
}

function validateSequenceToken(value: unknown): DatabaseSequenceToken {
  const record = operationRecord(value);
  assertExactFields(record, ['seq']);
  return createDatabaseSequenceToken(record.seq as number);
}

function validateTable(value: unknown, catalog: DatabaseOperationCatalog): string {
  if (!isDatabaseTableName(value)) {
    throw payloadInvalid('Invalid database table name.');
  }
  if (catalog.tables && !catalog.tables.includes(value)) {
    throw payloadInvalid('Database operation references an unregistered table.');
  }
  return value;
}

function validateHandlerName(
  value: unknown,
  registry: readonly string[] | undefined,
  kind: 'query' | 'command',
): string {
  if (!isDatabaseRegistryName(value)) {
    throw payloadInvalid(`Invalid database ${kind} name.`);
  }
  if (registry && !registry.includes(value)) {
    throw new DatabaseError(
      'DATABASE_OPERATION_UNSUPPORTED',
      `Database ${kind} is not registered.`,
    );
  }
  return value;
}

function validateIdempotencyKey(value: unknown): string {
  if (!isDatabaseIdempotencyKey(value)) {
    throw payloadInvalid('Invalid database idempotency key.');
  }
  return value;
}

function validateRowId(value: unknown): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > DATABASE_OPERATION_MAX_ID_BYTES
    || !isWellFormedUnicode(value)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || textEncoder.encode(value).byteLength > DATABASE_OPERATION_MAX_ID_BYTES) {
    throw payloadInvalid('Invalid database row id.');
  }
  return value;
}

function validateArray<T>(
  value: unknown,
  field: string,
  parse: (entry: unknown) => T,
): readonly T[] {
  if (!Array.isArray(value) || isProxy(value)) {
    throw payloadInvalid(`Database ${field} must be an array.`);
  }
  if (value.length > DATABASE_OPERATION_MAX_BATCH_ITEMS) {
    throw payloadLimit(`Database ${field} limit exceeded.`);
  }
  const descriptors = safeDescriptors(value);
  const ownKeys = safeOwnKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
    throw payloadInvalid(`Database ${field} must be dense and unextended.`);
  }
  const result: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw payloadInvalid(`Database ${field} must contain data elements.`);
    }
    result.push(parse(descriptor.value));
  }
  return Object.freeze(result);
}

function requireStringField(record: DataRecord, field: string): string {
  requireOwnField(record, field);
  const value = record[field];
  if (typeof value !== 'string' || !isWellFormedUnicode(value)) {
    throw payloadInvalid(`Database operation ${field} must be a safe string.`);
  }
  return value;
}

function requireOwnField(record: DataRecord, field: string): void {
  if (!hasOwnField(record, field)) {
    throw payloadInvalid(`Database operation is missing required field ${field}.`);
  }
}

function hasOwnField(record: DataRecord, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function finalizeOperation<T extends DatabaseOperation>(operation: T): T {
  // Re-validate the complete normalized envelope as one payload so arrays of
  // individually-valid rows cannot bypass the aggregate message budget.
  return cloneDatabaseSerializableValue(operation) as unknown as T;
}

function finalizeResult<
  T extends DatabaseReadResult | DatabaseCommitResult,
>(result: T): T {
  return cloneDatabaseSerializableValue(result) as unknown as T;
}

function assertExactFields(record: DataRecord, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const field of Object.keys(record)) {
    if (!allowedSet.has(field)) {
      throw payloadInvalid('Database operation contains an unknown field.');
    }
  }
}

function safePrototype(value: object): object | null {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    throw payloadInvalid('Database payload object could not be inspected.');
  }
}

function safeOwnKeys(value: object): (string | symbol)[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    throw payloadInvalid('Database payload object could not be inspected.');
  }
}

function safeDescriptors(value: object): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    throw payloadInvalid('Database payload object could not be inspected.');
  }
}

function isProxy(value: object): boolean {
  try {
    return utilTypes.isProxy(value);
  } catch {
    return true;
  }
}

function isWellFormedUnicode(value: string): boolean {
  const candidate = value as string & { isWellFormed?: () => boolean };
  if (typeof candidate.isWellFormed === 'function') return candidate.isWellFormed();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function payloadInvalid(message: string): DatabaseError {
  return new DatabaseError('DATABASE_PAYLOAD_INVALID', message);
}

function payloadLimit(message: string): DatabaseError {
  return new DatabaseError('DATABASE_PAYLOAD_LIMIT', message);
}
