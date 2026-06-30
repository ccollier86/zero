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

/** Durable mutation operations accepted by KV journal replay. */
export type KvMutation =
  | {
      op: 'set';
      key: string;
      value: unknown;
      kind?: ZeroKvKind;
      expiresAt?: number | null;
    }
  | {
      op: 'delete';
      key: string;
    }
  | {
      op: 'expire';
      key: string;
      expiresAt: number | null;
    }
  | {
      op: 'increment';
      key: string;
      delta: number;
      expiresAt?: number | null;
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
  switch (mutation.op) {
    case 'set':
      return applySet(engine, mutation, context);
    case 'delete':
      return engine.delete(mutation.key);
    case 'expire':
      return applyExpire(engine, mutation, context);
    case 'increment':
      return applyIncrement(engine, mutation, context);
  }
}

function applySet(
  engine: KvMemoryEngine,
  mutation: Extract<KvMutation, { op: 'set' }>,
  context: KvMutationApplyContext
): unknown {
  const current = engine.getEntry(mutation.key);
  const entry: ZeroKvEntry = {
    key: mutation.key,
    kind: mutation.kind ?? 'value',
    value: mutation.value,
    expiresAt: mutation.expiresAt ?? null,
    version: context.sequence,
    createdAt: current?.createdAt ?? context.timestamp,
    updatedAt: context.timestamp,
    lastAccessedAt: context.timestamp,
    sizeBytes: estimateKvValueSize(mutation.value),
  };
  engine.restoreEntries([entry]);
  return mutation.value;
}

function applyExpire(
  engine: KvMemoryEngine,
  mutation: Extract<KvMutation, { op: 'expire' }>,
  context: KvMutationApplyContext
): boolean {
  const current = engine.getEntry(mutation.key);
  if (!current) return false;

  engine.restoreEntries([
    {
      ...current,
      expiresAt: mutation.expiresAt,
      version: context.sequence,
      updatedAt: context.timestamp,
      lastAccessedAt: context.timestamp,
    },
  ]);
  return true;
}

function applyIncrement(
  engine: KvMemoryEngine,
  mutation: Extract<KvMutation, { op: 'increment' }>,
  context: KvMutationApplyContext
): number {
  if (!Number.isFinite(mutation.delta)) {
    throw new KvError('KV_VALUE_INVALID', 'KV increment mutation delta must be finite.', {
      key: mutation.key,
      delta: mutation.delta,
    });
  }

  const current = engine.getEntry<number>(mutation.key);
  if (current && typeof current.value !== 'number') {
    throw new KvError('KV_COUNTER_TYPE_MISMATCH', `KV key "${mutation.key}" does not hold a numeric counter.`, {
      key: mutation.key,
      kind: current.kind,
    });
  }

  const value = (current?.value ?? 0) + mutation.delta;
  engine.restoreEntries([
    {
      key: mutation.key,
      kind: 'counter',
      value,
      expiresAt: mutation.expiresAt === undefined ? current?.expiresAt ?? null : mutation.expiresAt,
      version: context.sequence,
      createdAt: current?.createdAt ?? context.timestamp,
      updatedAt: context.timestamp,
      lastAccessedAt: context.timestamp,
      sizeBytes: estimateKvValueSize(value),
    },
  ]);
  return value;
}
