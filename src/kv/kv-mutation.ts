/**
 * kv-mutation.ts
 *
 * Defines durable KV mutation records and applies them to the memory engine.
 * This file owns mutation semantics only; it does not read files, write
 * checkpoints, or expose app-facing service methods.
 */

import { KvError } from './kv-errors';
import { estimateKvValueSize } from './kv-size';
import type { KvMemoryEngine } from './kv-memory-engine';
import type { ZeroKvEntry, ZeroKvKind } from './kv-types';

/** Reserved key carried by checkpoint cleanup WAL records. */
export const KV_CHECKPOINT_PRUNE_KEY = '__zero_internal__:kv:checkpoint-prune';

/** Durable mutation operations accepted by KV journal replay. */
export type KvMutation =
  | {
      op: 'set';
      key: string;
      value: unknown;
      kind?: ZeroKvKind;
      expiresAt?: number | null;
      tombstone?: boolean;
      evaluatedAt?: number;
      pruneAt?: number;
    }
  | {
      op: 'delete';
      key: string;
      /** @internal Marks a journaled checkpoint cleanup boundary. */
      maintenance?: 'prune';
      evaluatedAt?: number;
      pruneAt?: number;
    }
  | {
      op: 'expire';
      key: string;
      expiresAt: number | null;
      tombstone?: boolean;
      evaluatedAt?: number;
      pruneAt?: number;
    }
  | {
      op: 'increment';
      key: string;
      delta: number;
      /** Exact resulting value recorded by current writers. Absent in legacy records. */
      result?: number;
      expiresAt?: number | null;
      tombstone?: boolean;
      evaluatedAt?: number;
      pruneAt?: number;
    };

/** Metadata supplied by journal records when replaying a mutation. */
export interface KvMutationApplyContext {
  sequence: number;
  timestamp: number;
}

/** Apply one durable mutation to a memory engine during recovery or tests. */
export function applyKvMutation(
  engine: KvMemoryEngine,
  mutation: KvMutation,
  context: KvMutationApplyContext
): unknown {
  const result = applyKvMutationWithResult(engine, mutation, context);
  return mutation.op === 'set' ? (result as ZeroKvEntry).value : result;
}

/**
 * Apply a mutation and capture the exact entry/result produced by that
 * operation. This is internal service plumbing; the public helper above keeps
 * its established set-mutation return contract.
 */
export function applyKvMutationWithResult(
  engine: KvMemoryEngine,
  mutation: KvMutation,
  context: KvMutationApplyContext
): unknown {
  if (mutation.op === 'delete' && mutation.maintenance === 'prune') {
    assertMaintenancePruneMutation(mutation);
  }
  const pruned = mutation.pruneAt === undefined
    ? 0
    : engine.pruneExpired(mutation.pruneAt);
  if (mutation.op === 'delete' && mutation.maintenance === 'prune') return pruned;
  switch (mutation.op) {
    case 'set':
      return applySet(engine, mutation, context);
    case 'delete':
      return applyDelete(engine, mutation, context);
    case 'expire':
      return applyExpire(engine, mutation, context);
    case 'increment':
      return applyIncrement(engine, mutation, context);
  }
}

function assertMaintenancePruneMutation(
  mutation: Extract<KvMutation, { op: 'delete' }>
): void {
  if (
    mutation.key !== KV_CHECKPOINT_PRUNE_KEY
    || mutation.pruneAt === undefined
    || !Number.isFinite(mutation.pruneAt)
    || mutation.evaluatedAt !== mutation.pruneAt
  ) {
    throw new KvError('KV_VALUE_INVALID', 'KV checkpoint prune mutation is invalid.');
  }
}

function applyDelete(
  engine: KvMemoryEngine,
  mutation: Extract<KvMutation, { op: 'delete' }>,
  context: KvMutationApplyContext
): boolean {
  const evaluatedAt = mutation.evaluatedAt ?? context.timestamp;
  const existed = getMutationEntry(engine, mutation.key, evaluatedAt) !== null;
  // The durable delete is a tombstone even when the key was already logically
  // expired. Removing its retained physical state prevents clock rollback
  // from resurrecting a key after an acknowledged delete.
  engine.delete(mutation.key);
  return existed;
}

function applySet(
  engine: KvMemoryEngine,
  mutation: Extract<KvMutation, { op: 'set' }>,
  context: KvMutationApplyContext
): ZeroKvEntry {
  const evaluatedAt = mutation.evaluatedAt ?? context.timestamp;
  const current = getMutationEntry(engine, mutation.key, evaluatedAt);
  const entry: ZeroKvEntry = {
    key: mutation.key,
    kind: mutation.kind ?? 'value',
    value: mutation.value,
    expiresAt: mutation.expiresAt ?? null,
    version: context.sequence,
    createdAt: current?.createdAt ?? evaluatedAt,
    updatedAt: evaluatedAt,
    lastAccessedAt: evaluatedAt,
    sizeBytes: estimateKvValueSize(mutation.value),
  };

  // Every set replaces prior state. Current writers persist an explicit
  // tombstone when the target expiry was already due at decision time.
  engine.delete(mutation.key);
  if (!mutation.tombstone && (entry.expiresAt === null || entry.expiresAt > evaluatedAt)) {
    engine.restoreEntries([entry], { retainExpired: true, capacityTime: evaluatedAt });
  }
  return entry;
}

function applyExpire(
  engine: KvMemoryEngine,
  mutation: Extract<KvMutation, { op: 'expire' }>,
  context: KvMutationApplyContext
): boolean {
  const evaluatedAt = mutation.evaluatedAt ?? context.timestamp;
  const current = getMutationEntry(engine, mutation.key, evaluatedAt);
  if (!current) return false;

  engine.delete(mutation.key);
  if (!mutation.tombstone && (mutation.expiresAt === null || mutation.expiresAt > evaluatedAt)) {
    engine.restoreEntries([
      {
        ...current,
        expiresAt: mutation.expiresAt,
        version: context.sequence,
        updatedAt: evaluatedAt,
        lastAccessedAt: evaluatedAt,
      },
    ], { retainExpired: true, capacityTime: evaluatedAt });
  }
  return true;
}

function applyIncrement(
  engine: KvMemoryEngine,
  mutation: Extract<KvMutation, { op: 'increment' }>,
  context: KvMutationApplyContext
): number {
  const evaluatedAt = mutation.evaluatedAt ?? context.timestamp;
  if (!Number.isFinite(mutation.delta)) {
    throw new KvError('KV_VALUE_INVALID', 'KV increment mutation delta must be finite.', {
      key: mutation.key,
      delta: mutation.delta,
    });
  }

  const current = getMutationEntry<number>(engine, mutation.key, evaluatedAt);
  if (current && typeof current.value !== 'number') {
    throw new KvError('KV_COUNTER_TYPE_MISMATCH', `KV key "${mutation.key}" does not hold a numeric counter.`, {
      key: mutation.key,
      kind: current.kind,
    });
  }

  const value = mutation.result ?? (current?.value ?? 0) + mutation.delta;
  if (!Number.isFinite(value)) {
    throw new KvError('KV_VALUE_INVALID', 'KV counter mutation result must be finite.', {
      key: mutation.key,
      delta: mutation.delta,
    });
  }
  const expiresAt = mutation.expiresAt === undefined ? current?.expiresAt ?? null : mutation.expiresAt;
  engine.delete(mutation.key);
  if (!mutation.tombstone && (expiresAt === null || expiresAt > evaluatedAt)) {
    engine.restoreEntries([
      {
        key: mutation.key,
        kind: 'counter',
        value,
        expiresAt,
        version: context.sequence,
        createdAt: current?.createdAt ?? evaluatedAt,
        updatedAt: evaluatedAt,
        lastAccessedAt: evaluatedAt,
        sizeBytes: estimateKvValueSize(value),
      },
    ], { retainExpired: true, capacityTime: evaluatedAt });
  }
  return value;
}

function getMutationEntry<T = unknown>(
  engine: KvMemoryEngine,
  key: string,
  evaluatedAt: number
): ZeroKvEntry<T> | null {
  return engine.getEntryAt<T>(key, evaluatedAt);
}
