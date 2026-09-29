/**
 * resource-mutation-receipt.ts
 *
 * Owns canonical identity and commit-effect decoding for generated Resource
 * mutation receipts on both database planes. It performs no receipt lookup or
 * write; each storage engine must keep receipt persistence atomic with its
 * protected mutation.
 */

import { createHash, randomUUID } from 'node:crypto';

import type {
  DatabaseCommitResult,
} from '../databases/database-operations';
import type {
  DatabaseLogicalReceiptFingerprint,
} from '../databases/database-trusted-writer';
import type { Row } from '../sync';
import type {
  ResourceMutationReceiptEffect,
  ResourceMutationReceiptIdentity,
} from './resource-default-receipt-store';
import type { ResourceAction } from './resource-policy-types';
import type { RegisteredResourceDefinition } from './resource-registry';
import {
  isResourceTenantRowScope,
  type ResourceTenantScope,
} from './resource-realm';

const RESOURCE_RECEIPT_MAX_DEPTH = 16;
const RESOURCE_RECEIPT_MAX_NODES = 10_000;
const RESOURCE_RECEIPT_MAX_BYTES = 1_048_576;

/** Canonical actor/default commit effect used for receipt reauthorization. */
export interface ResourceMutationCommitEffect {
  readonly type: 'create' | 'update' | 'delete' | 'upsert';
  readonly table: string;
  readonly rowId: string;
  readonly row: Row | null;
  readonly previousRow: Row | null;
}

/** Build the default-plane receipt identity for one logical mutation. */
export function createDefaultResourceReceiptIdentity(input: Readonly<{
  resource: RegisteredResourceDefinition;
  action: Extract<ResourceAction, 'create' | 'update' | 'delete'>;
  id: string;
  mutationInput: Readonly<Record<string, unknown>> | null;
  requestKey: string | undefined;
  principalFingerprint: string;
  scope: ResourceTenantScope | null;
}>): ResourceMutationReceiptIdentity {
  return Object.freeze({
    receiptKey: resourceMutationIdempotencyKey(
      input.requestKey,
      input.principalFingerprint,
      defaultResourceReceiptNamespace(input.scope),
    ),
    logicalFingerprint: resourceLogicalReceiptFingerprint(
      input.resource,
      input.action,
      input.id,
      input.mutationInput,
    ),
    resource: input.resource.name,
    table: input.resource.table,
    action: input.action,
    id: input.id,
  });
}

/** Convert a synchronous ReactiveDB change into its exact receipt effect. */
export function defaultResourceMutationEffect(
  change: Readonly<{
    seq: number;
    table: string;
    rowId: string;
    row: Row | null;
    previousRow?: Row | null;
  }>,
  action: Extract<ResourceAction, 'create' | 'update' | 'delete'>,
): ResourceMutationReceiptEffect {
  return Object.freeze({
    type: action,
    table: change.table,
    rowId: change.rowId,
    row: change.row,
    previousRow: change.previousRow ?? null,
    sequence: change.seq,
  });
}

/** Resolve the logical row identity included in a create receipt fingerprint. */
export function mutationReceiptResourceId(
  resource: RegisteredResourceDefinition,
  row: Readonly<Record<string, unknown>>,
): string {
  const primaryKey = row[resource.primaryKey];
  return primaryKey === undefined || primaryKey === null || primaryKey === ''
    ? '<database-generated>'
    : String(primaryKey);
}

/** Derive the private receipt key from request, principal, and verified realm. */
export function resourceMutationIdempotencyKey(
  requestKey: string | undefined,
  principalFingerprint: string,
  realmNamespace: string,
): string {
  const requestIdentity = requestKey ?? `r_${randomUUID()}`;
  const digest = createHash('sha256')
    .update('zero.resource-mutation.v3\0', 'utf8')
    .update(JSON.stringify([
      requestIdentity,
      principalFingerprint,
      realmNamespace,
    ]), 'utf8')
    .digest('hex');
  return `resource:v3:${digest}`;
}

/** Derive the canonical logical mutation fingerprint stored by either plane. */
export function resourceLogicalReceiptFingerprint(
  resource: RegisteredResourceDefinition,
  action: Extract<ResourceAction, 'create' | 'update' | 'delete'>,
  id: string,
  input: Readonly<Record<string, unknown>> | null,
): DatabaseLogicalReceiptFingerprint {
  const digest = createHash('sha256')
    .update('zero.resource-logical-request.v1\0', 'utf8')
    .update(canonicalizeResourceReceiptPayload({
      resource: resource.name,
      table: resource.table,
      action,
      id,
      input,
    }), 'utf8')
    .digest('hex');
  return `sha256:${digest}`;
}

/** @internal Canonical JSON encoding used by logical Resource receipts. */
export function canonicalizeResourceReceiptPayload(value: unknown): string {
  let nodes = 0;
  const active = new WeakSet<object>();

  const encode = (current: unknown, depth: number): string => {
    nodes += 1;
    if (nodes > RESOURCE_RECEIPT_MAX_NODES || depth > RESOURCE_RECEIPT_MAX_DEPTH) {
      throw new TypeError('Resource receipt payload exceeds canonicalization limits');
    }
    if (current === null || typeof current === 'string'
      || typeof current === 'boolean') {
      return JSON.stringify(current);
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new TypeError('Resource receipt payload contains a non-finite number');
      }
      return JSON.stringify(current);
    }
    if (!current || typeof current !== 'object') {
      throw new TypeError('Resource receipt payload is not canonical JSON');
    }
    if (active.has(current)) {
      throw new TypeError('Resource receipt payload contains a cycle');
    }
    active.add(current);
    try {
      if (Array.isArray(current)) {
        for (let index = 0; index < current.length; index += 1) {
          if (!Object.hasOwn(current, index)) {
            throw new TypeError('Resource receipt payload contains a sparse array');
          }
        }
        return `[${current.map((entry) => encode(entry, depth + 1)).join(',')}]`;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Resource receipt payload contains a non-plain object');
      }
      const record = current as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort(compareText)
        .map((key) => `${JSON.stringify(key)}:${encode(record[key], depth + 1)}`)
        .join(',')}}`;
    } finally {
      active.delete(current);
    }
  };

  const canonical = encode(value, 0);
  if (Buffer.byteLength(canonical, 'utf8') > RESOURCE_RECEIPT_MAX_BYTES) {
    throw new TypeError('Resource receipt payload exceeds canonicalization limits');
  }
  return canonical;
}

/** Decode and strictly bind an actor receipt/commit result to its mutation. */
export function resourceMutationEffect(
  result: DatabaseCommitResult,
  resource: RegisteredResourceDefinition,
  action: Extract<ResourceAction, 'create' | 'update' | 'delete'>,
  expectedId?: string,
): ResourceMutationCommitEffect | null {
  const value = recordValue(result.value);
  if (!value) return null;
  const candidate = action === 'create'
    ? (value.kind === 'mutation' ? value.mutation : null)
    : (value.kind === 'batch'
      && Array.isArray(value.mutations)
      && value.mutations.length === 1
      ? value.mutations[0]
      : null);
  const effect = recordValue(candidate);
  const effectSequence = recordValue(effect?.sequence)?.seq;
  const resultSequence = recordValue(result.sequence)?.seq;
  const expectedOp = action === 'create'
    ? 'INSERT'
    : action === 'update' ? 'UPDATE' : 'DELETE';
  if (!effect
    || effect.type !== action
    || effect.table !== resource.table
    || effect.changed !== true
    || effect.op !== expectedOp
    || !Number.isSafeInteger(effectSequence)
    || (effectSequence as number) < 1
    || effectSequence !== resultSequence
    || typeof effect.rowId !== 'string'
    || effect.rowId.length === 0
    || (expectedId !== undefined && effect.rowId !== expectedId)) {
    return null;
  }
  const row = nullableRow(effect.row);
  const previousRow = nullableRow(effect.previousRow);
  if (row === undefined
    || previousRow === undefined
    || (action === 'create' && (row === null || previousRow !== null))
    || (action === 'update' && (row === null || previousRow === null))
    || (action === 'delete' && (row !== null || previousRow === null))
    || !rowIdentityMatches(row, resource.primaryKey, effect.rowId)
    || !rowIdentityMatches(previousRow, resource.primaryKey, effect.rowId)) {
    return null;
  }
  return {
    type: action,
    table: resource.table,
    rowId: effect.rowId,
    row,
    previousRow,
  };
}

function defaultResourceReceiptNamespace(scope: ResourceTenantScope | null): string {
  return isResourceTenantRowScope(scope)
    ? `shared-row:${scope.field}:${scope.tenantId}`
    : 'default:global';
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableRow(value: unknown): Row | null | undefined {
  if (value === null) return null;
  return recordValue(value) ?? undefined;
}

function rowIdentityMatches(
  row: Row | null,
  primaryKey: string,
  expectedId: string,
): boolean {
  if (row === null) return true;
  const value = row[primaryKey];
  return ((typeof value === 'string' && value.length > 0)
    || (typeof value === 'number' && Number.isSafeInteger(value)))
    && String(value) === expectedId;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
