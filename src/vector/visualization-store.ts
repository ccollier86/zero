/**
 * visualization-store.ts
 *
 * Persists public-safe operation snapshots through Zero's bound asynchronous
 * database facade. Actor routing, migrations and authorization are supplied by
 * the owner; this store never opens a database or executes provider/index work.
 */

import type { AsyncDatabaseClient, DatabaseFindFilter, DatabaseOperationRow } from '../databases/database-operation-contracts';
import { DatabaseError } from '../databases/database-error';
import { VectorError } from './vector-error';
import { VECTOR_VISUALIZATION_FEED_TABLE, VECTOR_VISUALIZATION_OPERATIONS_TABLE } from './visualization-schema';
import type { VectorVisualizationFailure, VectorVisualizationSnapshot } from './visualization-types';

const MAX_SNAPSHOT_BYTES = 240_000;
const MAX_LIST = 100;
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/** Minimal durable snapshot boundary implemented by actor-backed and test stores. */
export interface VectorVisualizationStore {
  /** Atomic admission required for distributed custom stores; only a fresh claim may own effects. */
  claim?(snapshot: VectorVisualizationSnapshot): Promise<VectorVisualizationClaim>;
  create(snapshot: VectorVisualizationSnapshot): Promise<VectorVisualizationSnapshot>;
  get(id: string): Promise<VectorVisualizationSnapshot | null>;
  list(index: string, limit?: number): Promise<readonly VectorVisualizationSnapshot[]>;
  compareAndSwap(id: string, expectedRevision: number,
    next: VectorVisualizationSnapshot): Promise<VectorVisualizationSnapshot>;
}

/** A winning admission receives only an ID-bound terminal cleanup capability. */
export interface VectorVisualizationClaim {
  snapshot: VectorVisualizationSnapshot;
  created: boolean;
  /** Retire this accepted operation without reading/returning corpus data or choosing another ID. */
  retire?: (failure: VectorVisualizationFailure) => Promise<void>;
}

/** Exact owner/tenant/corpus-scoped persistence, compatible with standard and Fabric clients. */
export class AsyncVectorVisualizationStore implements VectorVisualizationStore {
  private readonly filters: readonly DatabaseFindFilter[];

  constructor(private readonly client: AsyncDatabaseClient,
    private readonly scopeId: string, private readonly ownerUserId: string,
    private readonly tenantId: string | null) {
    requireIdentity(scopeId, 'scope');
    requireIdentity(ownerUserId, 'owner');
    if (tenantId !== null) requireIdentity(tenantId, 'tenant');
    this.filters = [field('scope_id', scopeId), field('owner_user_id', ownerUserId),
      field('tenant_id', tenantId)];
  }

  /** Claim effect ownership atomically; concurrent/retried admissions attach to the winner. */
  async claim(snapshot: VectorVisualizationSnapshot): Promise<VectorVisualizationClaim> {
    const row = this.row(snapshot);
    if (snapshot.revision !== 1) throw invalid('Initial operation revision must be one.');
    const claimId = crypto.randomUUID();
    try {
      // Each logical admission has its own receipt. The row-missing assertion,
      // not matching request timestamps, selects the single execution owner.
      await this.client.batch({
        assertions: [{ type: 'row-missing', table: VECTOR_VISUALIZATION_OPERATIONS_TABLE, id: snapshot.id }],
        mutations: [{ type: 'create', table: VECTOR_VISUALIZATION_OPERATIONS_TABLE, row },
          { type: 'upsert', table: VECTOR_VISUALIZATION_FEED_TABLE, row: this.feedRow(snapshot, claimId) }],
      }, { idempotencyKey: receipt(snapshot.id, `claim:${claimId}`) });
      const accepted = decode(row);
      return { snapshot: detach(accepted), created: true,
        retire: failure => this.retireClaim(accepted, failure) };
    } catch (error) {
      if (!(error instanceof DatabaseError) || error.code !== 'DATABASE_CONFLICT') throw error;
      const accepted = await this.get(snapshot.id);
      if (!accepted) throw conflict();
      return { snapshot: accepted, created: false };
    }
  }

  /** Strict creation does not replace a previous operation with the same identifier. */
  async create(snapshot: VectorVisualizationSnapshot): Promise<VectorVisualizationSnapshot> {
    const row = this.row(snapshot);
    if (snapshot.revision !== 1) throw invalid('Initial operation revision must be one.');
    await this.client.batch({
      assertions: [{ type: 'row-missing', table: VECTOR_VISUALIZATION_OPERATIONS_TABLE, id: snapshot.id }],
      mutations: [{ type: 'create', table: VECTOR_VISUALIZATION_OPERATIONS_TABLE, row },
        { type: 'upsert', table: VECTOR_VISUALIZATION_FEED_TABLE, row: this.feedRow(snapshot, receipt(snapshot.id, 'create')) }],
    }, { idempotencyKey: receipt(snapshot.id, 'create') });
    return detach(snapshot);
  }

  /** Hidden operation identifiers return null, never another owner's snapshot. */
  async get(id: string): Promise<VectorVisualizationSnapshot | null> {
    const row = await this.readRow(id);
    return row ? decode(row) : null;
  }

  /** Bounded owner-scoped history ordered by accepted time with stable identity ties. */
  async list(index: string, limit = 20): Promise<readonly VectorVisualizationSnapshot[]> {
    requireIdentity(index, 'index');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST) {
      throw invalid('Operation history limit is invalid.');
    }
    const result = await this.client.find(VECTOR_VISUALIZATION_OPERATIONS_TABLE, {
      filters: [...this.filters, field('index_name', index)],
      order: [{ field: 'created_at', direction: 'desc' }, { field: 'operation_id', direction: 'asc' }],
      limit,
    }, { consistency: { mode: 'strong' } });
    return result.value.map(row => {
      if (!this.owns(row) || row.index_name !== index) throw invalid('Operation store returned an invalid scope.');
      return decode(row);
    });
  }

  /** Compare the complete accepted row inside the writer transaction; stale writers cannot win. */
  async compareAndSwap(id: string, expectedRevision: number,
    next: VectorVisualizationSnapshot): Promise<VectorVisualizationSnapshot> {
    const before = await this.readRow(id);
    if (!before) throw conflict();
    const current = decode(before);
    if (!Number.isSafeInteger(expectedRevision) || current.revision !== expectedRevision
      || next.id !== id || next.index !== current.index || next.kind !== current.kind
      || next.createdAt !== current.createdAt || next.revision !== expectedRevision + 1
      || terminal.has(current.status)) throw conflict();
    const row = this.row(next);
    try {
      await this.client.batch({
        assertions: [{ type: 'row-equals', table: VECTOR_VISUALIZATION_OPERATIONS_TABLE, id, row: before }],
        mutations: [{ type: 'update', table: VECTOR_VISUALIZATION_OPERATIONS_TABLE, id, patch: {
          status: row.status!, revision: row.revision!, snapshot_json: row.snapshot_json!, updated_at: row.updated_at!,
        } }, { type: 'upsert', table: VECTOR_VISUALIZATION_FEED_TABLE,
          row: this.feedRow(next, receipt(id, `revision:${next.revision}`)) }],
      }, { idempotencyKey: receipt(id, `revision:${next.revision}`) });
    } catch (error) {
      if (error instanceof DatabaseError && error.code === 'DATABASE_CONFLICT') throw conflict();
      throw error;
    }
    return detach(next);
  }

  private async readRow(id: string): Promise<DatabaseOperationRow | null> {
    requireIdentity(id, 'operation');
    const result = await this.client.get(VECTOR_VISUALIZATION_OPERATIONS_TABLE, id,
      { consistency: { mode: 'strong' } });
    return result.value && this.owns(result.value) ? result.value : null;
  }

  /** Operation-owned lifecycle cleanup cannot choose another row or return private state. */
  private async retireClaim(accepted: VectorVisualizationSnapshot,
    failure: VectorVisualizationFailure): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.get(accepted.id);
      if (!current || terminal.has(current.status)) return;
      if (current.createdAt !== accepted.createdAt || current.index !== accepted.index
        || current.kind !== accepted.kind) throw conflict();
      const updatedAt = new Date().toISOString();
      const next: VectorVisualizationSnapshot = { ...current, revision: current.revision + 1,
        updatedAt, status: 'interrupted', error: { code: 'VECTOR_OPERATION_INTERRUPTED',
          message: 'The operation was retired before completion.', retryable: false,
          ...(failure.outcomeUnknown ? { outcomeUnknown: true } : {}) },
        stages: current.stages.map(stage => terminal.has(stage.status) || ['completed', 'skipped'].includes(stage.status)
          ? stage : { ...stage, status: 'interrupted', completedAt: updatedAt }) };
      if (next.ingestion) next.ingestion = { ...next.ingestion,
        chunks: next.ingestion.chunks.map(chunk => chunk.storedAt ? chunk : { ...chunk, status: 'interrupted' }) };
      try { await this.compareAndSwap(current.id, current.revision, next); return; }
      catch (error) { if (attempt === 7 || !(error instanceof VectorError) || error.metadata.conflict !== true) throw error; }
    }
  }

  private owns(row: DatabaseOperationRow): boolean {
    return row.scope_id === this.scopeId && row.owner_user_id === this.ownerUserId
      && row.tenant_id === this.tenantId;
  }

  private row(snapshot: VectorVisualizationSnapshot): DatabaseOperationRow {
    const json = encode(snapshot);
    return { operation_id: snapshot.id, scope_id: this.scopeId, owner_user_id: this.ownerUserId,
      tenant_id: this.tenantId, index_name: snapshot.index, kind: snapshot.kind,
      status: snapshot.status, revision: snapshot.revision, snapshot_json: json,
      created_at: snapshot.createdAt, updated_at: snapshot.updatedAt };
  }

  /** One metadata-only invalidation slot per owner/corpus/index/kind, never a history snapshot. */
  private feedRow(snapshot: VectorVisualizationSnapshot, changeIdentity: string): DatabaseOperationRow {
    const identity = JSON.stringify([this.scopeId, this.ownerUserId, this.tenantId, snapshot.index, snapshot.kind]);
    const digest = new Bun.CryptoHasher('sha256').update(identity).digest('hex');
    const token = new Bun.CryptoHasher('sha256').update(JSON.stringify([identity, changeIdentity])).digest('hex');
    // A name-derived opaque UUID keeps receipt replays byte-for-byte stable,
    // while each newly committed operation/progress revision changes the token.
    const changeToken = `${token.slice(0, 8)}-${token.slice(8, 12)}-8${token.slice(13, 16)}-a${token.slice(17, 20)}-${token.slice(20, 32)}`;
    return { feed_id: `vvfeed_${digest}`, scope_id: this.scopeId, owner_user_id: this.ownerUserId,
      tenant_id: this.tenantId, index_name: snapshot.index, kind: snapshot.kind,
      change_token: changeToken, updated_at: snapshot.updatedAt };
  }
}

function field(name: string, value: string | null): DatabaseFindFilter {
  return { type: 'field', field: name, operator: 'eq', value, match: 'exact' };
}

function encode(snapshot: VectorVisualizationSnapshot): string {
  requireSnapshot(snapshot);
  try {
    const json = JSON.stringify(snapshot);
    if (new TextEncoder().encode(json).byteLength > MAX_SNAPSHOT_BYTES) {
      throw invalid('Operation snapshot exceeds its bounded storage limit.');
    }
    return json;
  } catch (error) {
    if (error instanceof VectorError) throw error;
    throw invalid('Operation snapshot is not serializable.');
  }
}

function decode(row: DatabaseOperationRow): VectorVisualizationSnapshot {
  if (typeof row.snapshot_json !== 'string') throw invalid('Operation snapshot is malformed.');
  let snapshot: VectorVisualizationSnapshot;
  try { snapshot = JSON.parse(row.snapshot_json); }
  catch { throw invalid('Operation snapshot is malformed.'); }
  requireSnapshot(snapshot);
  if (snapshot.id !== row.operation_id || snapshot.index !== row.index_name
    || snapshot.kind !== row.kind || snapshot.status !== row.status
    || snapshot.revision !== row.revision || snapshot.createdAt !== row.created_at
    || snapshot.updatedAt !== row.updated_at) throw invalid('Operation snapshot identity is inconsistent.');
  return snapshot;
}

function detach(snapshot: VectorVisualizationSnapshot): VectorVisualizationSnapshot {
  return JSON.parse(encode(snapshot));
}

function requireSnapshot(value: VectorVisualizationSnapshot): void {
  if (!value || typeof value !== 'object') throw invalid('Operation snapshot is invalid.');
  const stack: unknown[] = [value];
  let nodes = 0;
  while (stack.length) {
    if (++nodes > 10_000) throw invalid('Operation snapshot has too many fields.');
    const child = stack.pop();
    if (typeof child === 'number' && !Number.isFinite(child)) throw invalid('Operation snapshot contains invalid numbers.');
    if (typeof child === 'object' && child !== null) {
      const proto = Object.getPrototypeOf(child);
      const array = Array.isArray(child);
      if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw invalid('Operation snapshot contains invalid objects.');
      const descriptors = Object.getOwnPropertyDescriptors(child);
      if (array && Object.keys(descriptors).length !== child.length + 1) throw invalid('Operation snapshot contains invalid arrays.');
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string') throw invalid('Operation snapshot contains invalid fields.');
        const descriptor = descriptors[key]!;
        if (array && key === 'length') continue;
        if (!descriptor.enumerable || !('value' in descriptor) || ['__proto__', 'constructor', 'prototype'].includes(key)
          || array && (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= child.length)) throw invalid('Operation snapshot contains invalid fields.');
        stack.push(descriptor.value);
      }
    } else if (!['undefined', 'number', 'string', 'boolean'].includes(typeof child) && child !== null) {
      throw invalid('Operation snapshot contains invalid values.');
    }
  }
  // Read known fields only after the complete data-only boundary has rejected
  // accessors, hidden identity properties and custom serialization hooks.
  requireIdentity(value.id, 'operation'); requireIdentity(value.index, 'index');
  if (!['search', 'ingestion'].includes(value.kind)
    || !['pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'skipped', 'interrupted'].includes(value.status)
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))
    || !Array.isArray(value.stages)) throw invalid('Operation snapshot is invalid.');
}

function requireIdentity(value: string, kind: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001f]/u.test(value)) {
    throw invalid(`Operation ${kind} identity is invalid.`);
  }
}

function receipt(id: string, action: string): string {
  return `vv:${new Bun.CryptoHasher('sha256').update(`${id}:${action}`).digest('hex')}`;
}

function invalid(message: string): VectorError { return new VectorError('VECTOR_OPERATION_FAILED', message); }
function conflict(): VectorError {
  return new VectorError('VECTOR_OPERATION_FAILED', 'Operation snapshot changed before this update.', { conflict: true });
}
