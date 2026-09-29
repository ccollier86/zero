/**
 * Durable idempotency receipts for Resource mutations on the default database.
 *
 * Physical tenant databases keep equivalent receipts inside their writer
 * actors. This store closes the same retry boundary for global and shared-row
 * resources while keeping the application row and its canonical receipt in one
 * ReactiveDB transaction.
 */

import type { ReactiveDB, Row } from '../sync';
import {
  initializeResourceDefaultReceiptLedger,
  pruneResourceDefaultReceiptsForInsert,
  readResourceDefaultReceiptSchemaVersion,
  readResourceDefaultReceiptStats,
  resolveResourceDefaultReceiptLimits,
  RESOURCE_DEFAULT_RECEIPT_SCHEMA_VERSION,
  RESOURCE_DEFAULT_RECEIPT_STATE_EXPIRED,
  RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED,
  RESOURCE_DEFAULT_RECEIPT_TABLE,
  type ResourceDefaultReceiptLimits,
  type ResourceDefaultReceiptLimitsInput,
} from './resource-default-receipt-ledger';

export {
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
  RESOURCE_DEFAULT_RECEIPT_MAX_RESULT_BYTES,
  RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES,
  RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT,
} from './resource-default-receipt-ledger';

const RECEIPT_RESULT_VERSION = 1;
const RECEIPT_KEY_PATTERN = /^resource:v3:[0-9a-f]{64}$/u;
const RECEIPT_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const textEncoder = new TextEncoder();

export type ResourceReceiptAction = 'create' | 'update' | 'delete';

/** Private identity for one principal-scoped logical Resource mutation. */
export interface ResourceMutationReceiptIdentity {
  readonly receiptKey: string;
  readonly logicalFingerprint: `sha256:${string}`;
  readonly resource: string;
  readonly table: string;
  readonly action: ResourceReceiptAction;
  /** Create may use this marker before ReactiveDB resolves an identity key. */
  readonly id: string;
}

/** Exact database effect retained for policy-safe canonical replay. */
export interface ResourceMutationReceiptEffect {
  readonly type: ResourceReceiptAction;
  readonly table: string;
  readonly rowId: string;
  readonly row: Row | null;
  readonly previousRow: Row | null;
  readonly sequence: number;
}

export type ResourceMutationReceiptLookup =
  | Readonly<{ readonly status: 'miss' }>
  | Readonly<{
      readonly status: 'hit';
      readonly effect: ResourceMutationReceiptEffect;
    }>;

export interface ResourceMutationReceiptCompaction {
  readonly totalKeys: number;
  readonly retainedResults: number;
  readonly retainedResultBytes: number;
  readonly expiredTombstones: number;
  readonly keyLimit: number;
  readonly prunedCount: number;
  readonly prunedResultBytes: number;
  readonly retainedLimit: number;
  readonly retainedByteLimit: number;
  readonly resultByteLimit: number;
}

export interface ResourceMutationReceiptExecution {
  readonly replayed: boolean;
  readonly effect: ResourceMutationReceiptEffect;
  readonly compaction: ResourceMutationReceiptCompaction | null;
}

export type ResourceMutationReceiptFailureKind =
  | 'key-reused'
  | 'expired'
  | 'capacity'
  | 'result-too-large'
  | 'corrupt';

/** Internal closed error shape; it never includes a receipt key or fingerprint. */
export class ResourceMutationReceiptError extends Error {
  constructor(readonly kind: ResourceMutationReceiptFailureKind, cause?: unknown) {
    super(receiptFailureMessage(kind), cause === undefined ? undefined : { cause });
    this.name = 'ResourceMutationReceiptError';
  }
}

interface ReceiptRow {
  receipt_key: string;
  logical_fingerprint: string;
  receipt_state: string;
  result_json: string | null;
  final_seq: number | null;
  result_version: number;
  schema_version: number;
  created_at: number;
  insertion_ordinal: number;
  receipt_key_type: string;
  logical_fingerprint_type: string;
  receipt_state_type: string;
  result_json_type: string;
  final_seq_type: string;
  result_version_type: string;
  schema_version_type: string;
  created_at_type: string;
  insertion_ordinal_type: string;
}

type StoredLookup =
  | Readonly<{ readonly status: 'miss' }>
  | Readonly<{ readonly status: 'expired' }>
  | Readonly<{
      readonly status: 'retained';
      readonly effect: ResourceMutationReceiptEffect;
    }>;

class ResourceReceiptMutationCallbackError extends Error {
  constructor(readonly original: unknown) {
    super('Resource receipt mutation callback failed');
    this.name = 'ResourceReceiptMutationCallbackError';
  }
}

const stores = new WeakMap<ReactiveDB, ResourceDefaultReceiptStore>();

/** One lazily initialized receipt authority per default ReactiveDB handle. */
export function getResourceDefaultReceiptStore(
  db: ReactiveDB,
): ResourceDefaultReceiptStore {
  const existing = stores.get(db);
  if (existing) return existing;
  const store = new ResourceDefaultReceiptStore(db);
  stores.set(db, store);
  return store;
}

/** @internal Synchronous store used only by ResourceCrudService and focused tests. */
export class ResourceDefaultReceiptStore {
  private initialized = false;
  private validatedSchemaVersion: number | null = null;
  private readonly limits: ResourceDefaultReceiptLimits;

  constructor(
    private readonly db: ReactiveDB,
    limits: ResourceDefaultReceiptLimitsInput = {},
  ) {
    this.limits = resolveResourceDefaultReceiptLimits(limits);
  }

  /** Resolve a receipt before any row pre-read or asynchronous row policy. */
  find(identity: ResourceMutationReceiptIdentity): ResourceMutationReceiptLookup {
    this.assertIdentity(identity);
    this.ensureInitialized();
    try {
      return this.db.transaction(() => {
        this.ensureSchemaCurrent();
        const receipt = this.lookup(identity);
        if (receipt.status === 'expired') throw receiptFailure('expired');
        return receipt.status === 'retained'
          ? Object.freeze({ status: 'hit', effect: receipt.effect })
          : Object.freeze({ status: 'miss' });
      });
    } catch (error) {
      throw normalizeReceiptFailure(error);
    }
  }

  /** Atomically resolve/replay or execute and retain one canonical mutation. */
  execute(
    identity: ResourceMutationReceiptIdentity,
    mutation: () => ResourceMutationReceiptEffect,
  ): ResourceMutationReceiptExecution {
    this.assertIdentity(identity);
    if (typeof mutation !== 'function') {
      throw new TypeError('Resource receipt mutation must be a function');
    }
    this.ensureInitialized();
    try {
      return this.db.transaction(() => {
        this.ensureSchemaCurrent();
        const receipt = this.lookup(identity);
        if (receipt.status === 'expired') throw receiptFailure('expired');
        if (receipt.status === 'retained') {
          return Object.freeze({
            replayed: true,
            effect: receipt.effect,
            compaction: null,
          });
        }

        // Admission precedes application code. At permanent-key capacity an
        // unseen mutation must not run even transiently inside the transaction.
        this.assertCanInsert();

        let effect: ResourceMutationReceiptEffect;
        try {
          effect = mutation();
        } catch (error) {
          throw new ResourceReceiptMutationCallbackError(error);
        }
        assertEffect(effect, identity, this.db.currentSeq);
        const compaction = this.save(identity, effect);
        return Object.freeze({ replayed: false, effect, compaction });
      });
    } catch (error) {
      if (error instanceof ResourceReceiptMutationCallbackError) {
        throw error.original;
      }
      if (error instanceof ResourceMutationReceiptError) throw error;
      throw receiptFailure('corrupt', error);
    }
  }

  private lookup(identity: ResourceMutationReceiptIdentity): StoredLookup {
    const statement = this.db.prepare(`
      SELECT
        receipt_key,
        logical_fingerprint,
        receipt_state,
        result_json,
        final_seq,
        result_version,
        schema_version,
        created_at,
        insertion_ordinal,
        typeof(receipt_key) AS receipt_key_type,
        typeof(logical_fingerprint) AS logical_fingerprint_type,
        typeof(receipt_state) AS receipt_state_type,
        typeof(result_json) AS result_json_type,
        typeof(final_seq) AS final_seq_type,
        typeof(result_version) AS result_version_type,
        typeof(schema_version) AS schema_version_type,
        typeof(created_at) AS created_at_type,
        typeof(insertion_ordinal) AS insertion_ordinal_type
      FROM main.${RESOURCE_DEFAULT_RECEIPT_TABLE}
      WHERE receipt_key = ?
    `);
    let row: ReceiptRow | null;
    try {
      row = statement.get(identity.receiptKey) as ReceiptRow | null;
    } finally {
      statement.finalize();
    }
    if (!row) return Object.freeze({ status: 'miss' });
    assertReceiptRow(row, identity.receiptKey);
    if (row.logical_fingerprint !== identity.logicalFingerprint) {
      throw receiptFailure('key-reused');
    }
    if (row.receipt_state === RESOURCE_DEFAULT_RECEIPT_STATE_EXPIRED) {
      return Object.freeze({ status: 'expired' });
    }
    return Object.freeze({
      status: 'retained',
      effect: this.parseEffect(row, identity),
    });
  }

  private save(
    identity: ResourceMutationReceiptIdentity,
    effect: ResourceMutationReceiptEffect,
  ): ResourceMutationReceiptCompaction | null {
    const resultJson = JSON.stringify({
      version: RECEIPT_RESULT_VERSION,
      resource: identity.resource,
      action: effect.type,
      table: effect.table,
      rowId: effect.rowId,
      row: effect.row,
      previousRow: effect.previousRow,
      sequence: effect.sequence,
    });
    const resultBytes = textEncoder.encode(resultJson).byteLength;
    if (resultBytes > this.limits.resultBytes) {
      throw receiptFailure('result-too-large');
    }
    const before = readResourceDefaultReceiptStats(this.db, this.limits);
    if (before.totalKeys >= this.limits.permanentKeys) {
      throw receiptFailure('capacity');
    }
    const prune = pruneResourceDefaultReceiptsForInsert(
      this.db,
      this.limits,
      before,
      resultBytes,
    );
    const insertionOrdinal = before.totalKeys + 1;
    if (!Number.isSafeInteger(insertionOrdinal) || insertionOrdinal < 1) {
      throw receiptFailure('corrupt');
    }
    const statement = this.db.prepare(`
      INSERT INTO main.${RESOURCE_DEFAULT_RECEIPT_TABLE} (
        receipt_key,
        logical_fingerprint,
        receipt_state,
        result_json,
        final_seq,
        result_version,
        schema_version,
        created_at,
        insertion_ordinal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      statement.run(
        identity.receiptKey,
        identity.logicalFingerprint,
        RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED,
        resultJson,
        effect.sequence,
        RECEIPT_RESULT_VERSION,
        RESOURCE_DEFAULT_RECEIPT_SCHEMA_VERSION,
        Date.now(),
        insertionOrdinal,
      );
    } finally {
      statement.finalize();
    }
    const after = readResourceDefaultReceiptStats(this.db, this.limits);
    if (after.totalKeys !== insertionOrdinal
      || after.retainedResults !== prune.statsAfterPrune.retainedResults + 1
      || after.retainedResultBytes
        !== prune.statsAfterPrune.retainedResultBytes + resultBytes) {
      throw receiptFailure('corrupt');
    }
    if (prune.prunedCount === 0) return null;

    const expiredTombstones = after.totalKeys - after.retainedResults;
    if (!isSafeCount(expiredTombstones)
      || prune.prunedCount > expiredTombstones) {
      throw receiptFailure('corrupt');
    }
    return Object.freeze({
      totalKeys: after.totalKeys,
      retainedResults: after.retainedResults,
      retainedResultBytes: after.retainedResultBytes,
      expiredTombstones,
      keyLimit: this.limits.permanentKeys,
      prunedCount: prune.prunedCount,
      prunedResultBytes: prune.prunedResultBytes,
      retainedLimit: this.limits.retainedResults,
      retainedByteLimit: this.limits.retainedBytes,
      resultByteLimit: this.limits.resultBytes,
    });
  }

  private parseEffect(
    row: ReceiptRow,
    identity: ResourceMutationReceiptIdentity,
  ): ResourceMutationReceiptEffect {
    if (row.result_json === null
      || row.final_seq === null
      || row.final_seq > this.db.currentSeq
      || textEncoder.encode(row.result_json).byteLength > this.limits.resultBytes) {
      throw receiptFailure('corrupt');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.result_json);
    } catch (cause) {
      throw receiptFailure('corrupt', cause);
    }
    const value = recordValue(parsed);
    if (!value || !hasExactKeys(value, [
      'version', 'resource', 'action', 'table', 'rowId',
      'row', 'previousRow', 'sequence',
    ])
      || value.version !== RECEIPT_RESULT_VERSION
      || value.resource !== identity.resource
      || value.action !== identity.action
      || value.table !== identity.table
      || typeof value.rowId !== 'string'
      || !Number.isSafeInteger(value.sequence)
      || value.sequence !== row.final_seq) {
      throw receiptFailure('corrupt');
    }
    const effect: ResourceMutationReceiptEffect = Object.freeze({
      type: identity.action,
      table: identity.table,
      rowId: value.rowId,
      row: nullableCanonicalRow(value.row),
      previousRow: nullableCanonicalRow(value.previousRow),
      sequence: value.sequence as number,
    });
    assertEffect(effect, identity, this.db.currentSeq);
    return effect;
  }

  private assertCanInsert(): void {
    const stats = readResourceDefaultReceiptStats(this.db, this.limits);
    if (stats.totalKeys >= this.limits.permanentKeys) {
      throw receiptFailure('capacity');
    }
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    const raw = this.db.getRawDatabase();
    try {
      raw.transaction(() => {
        initializeResourceDefaultReceiptLedger(this.db, this.limits);
        this.validatedSchemaVersion = readResourceDefaultReceiptSchemaVersion(this.db);
      }).immediate();
      this.initialized = true;
    } catch (error) {
      throw normalizeReceiptFailure(error);
    }
  }

  private ensureSchemaCurrent(): void {
    const version = readResourceDefaultReceiptSchemaVersion(this.db);
    if (version === this.validatedSchemaVersion) return;
    initializeResourceDefaultReceiptLedger(this.db, this.limits);
    this.validatedSchemaVersion = readResourceDefaultReceiptSchemaVersion(this.db);
  }

  private assertIdentity(identity: ResourceMutationReceiptIdentity): void {
    if (!identity
      || !RECEIPT_KEY_PATTERN.test(identity.receiptKey)
      || !RECEIPT_FINGERPRINT_PATTERN.test(identity.logicalFingerprint)
      || !nonEmpty(identity.resource)
      || !nonEmpty(identity.table)
      || !nonEmpty(identity.id)
      || !isReceiptAction(identity.action)) {
      throw new TypeError('Resource mutation receipt identity is invalid');
    }
  }
}

function assertReceiptRow(row: ReceiptRow, receiptKey: string): void {
  if (row.receipt_key !== receiptKey
    || row.receipt_key_type !== 'text'
    || row.logical_fingerprint_type !== 'text'
    || row.receipt_state_type !== 'text'
    || row.result_version_type !== 'integer'
    || row.schema_version_type !== 'integer'
    || row.created_at_type !== 'integer'
    || row.insertion_ordinal_type !== 'integer'
    || row.result_version !== RECEIPT_RESULT_VERSION
    || row.schema_version !== RESOURCE_DEFAULT_RECEIPT_SCHEMA_VERSION
    || !Number.isSafeInteger(row.created_at)
    || row.created_at < 0
    || !Number.isSafeInteger(row.insertion_ordinal)
    || row.insertion_ordinal < 1
    || !RECEIPT_KEY_PATTERN.test(row.receipt_key)
    || !RECEIPT_FINGERPRINT_PATTERN.test(row.logical_fingerprint)) {
    throw receiptFailure('corrupt');
  }
  if (row.receipt_state === RESOURCE_DEFAULT_RECEIPT_STATE_RETAINED) {
    if (row.result_json_type !== 'text'
      || row.final_seq_type !== 'integer'
      || typeof row.result_json !== 'string'
      || !Number.isSafeInteger(row.final_seq)
      || row.final_seq! < 0) {
      throw receiptFailure('corrupt');
    }
    return;
  }
  if (row.receipt_state !== RESOURCE_DEFAULT_RECEIPT_STATE_EXPIRED
    || row.result_json_type !== 'null'
    || row.final_seq_type !== 'null'
    || row.result_json !== null
    || row.final_seq !== null) {
    throw receiptFailure('corrupt');
  }
}

function assertEffect(
  effect: ResourceMutationReceiptEffect,
  identity: ResourceMutationReceiptIdentity,
  currentSequence: number,
): void {
  const row = nullableCanonicalRow(effect?.row);
  const previousRow = nullableCanonicalRow(effect?.previousRow);
  const expectedId = identity.id === '<database-generated>'
    || effect.rowId === identity.id;
  const validShape = effect?.type === 'create'
    ? row !== null && previousRow === null
    : effect?.type === 'update'
      ? row !== null && previousRow !== null
      : effect?.type === 'delete'
        ? row === null && previousRow !== null
        : false;
  if (!validShape
    || effect.type !== identity.action
    || effect.table !== identity.table
    || !nonEmpty(effect.rowId)
    || !expectedId
    || !Number.isSafeInteger(effect.sequence)
    || effect.sequence < 1
    || effect.sequence > currentSequence) {
    throw receiptFailure('corrupt');
  }
}

function nullableCanonicalRow(value: unknown): Row | null {
  if (value === null) return null;
  const row = recordValue(value);
  if (!row || !isCanonicalJsonValue(row, new Set())) throw receiptFailure('corrupt');
  return row;
}

function isCanonicalJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (!value || typeof value !== 'object' || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  ancestors.add(value);
  try {
    return Object.keys(value).every((key) =>
      isCanonicalJsonValue((value as Record<string, unknown>)[key], ancestors));
  } finally {
    ancestors.delete(value);
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null)
    ? value as Record<string, unknown>
    : null;
}

function normalizeReceiptFailure(error: unknown): ResourceMutationReceiptError {
  return error instanceof ResourceMutationReceiptError
    ? error
    : receiptFailure('corrupt', error);
}

function receiptFailure(
  kind: ResourceMutationReceiptFailureKind,
  cause?: unknown,
): ResourceMutationReceiptError {
  return new ResourceMutationReceiptError(kind, cause);
}

function receiptFailureMessage(kind: ResourceMutationReceiptFailureKind): string {
  switch (kind) {
    case 'key-reused':
      return 'Resource idempotency key was already used for another mutation';
    case 'expired':
      return 'Resource idempotency result is no longer retained';
    case 'capacity':
      return 'Resource idempotency receipt capacity is exhausted';
    case 'result-too-large':
      return 'Resource mutation result exceeds its durable receipt limit';
    case 'corrupt':
      return 'Resource idempotency receipt storage is incompatible';
  }
}

function isReceiptAction(value: unknown): value is ResourceReceiptAction {
  return value === 'create' || value === 'update' || value === 'delete';
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
