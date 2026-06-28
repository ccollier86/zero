/**
 * sync-policy.ts
 *
 * Defines the sync authorization policy contract used by the WebSocket sync
 * layer. This file owns policy types and default decisions only; it does not
 * verify JWTs, mutate SQLite, or publish WebSocket messages.
 */

import type { ChangeOp, Row, SyncAuthContext } from './types';
import { OBS_CODES } from '../observability/codes';
import { warnPlatform } from '../observability/sink';

/** Result returned by a sync policy decision callback. */
export type SyncPolicyDecision = boolean | {
  ok: boolean;
  reason?: string;
};

/** Normalized result used internally by sync policy helpers. */
export interface SyncPolicyEvaluation {
  ok: boolean;
  reason?: string;
}

/** Context passed to table read policy callbacks. */
export interface SyncReadPolicyContext {
  table: string;
  authContext: SyncAuthContext | null;
}

/** Context passed to table mutation policy callbacks. */
export interface SyncMutationPolicyContext {
  table: string;
  op: ChangeOp;
  rowId?: string;
  row?: Row | Partial<Row>;
  authContext: SyncAuthContext | null;
}

/**
 * Sync policy contract for subscription and mutation authorization.
 *
 * Missing callbacks allow by default so standalone/public sync keeps the
 * existing behavior unless an app opts into stricter policy.
 */
export interface SyncPolicy {
  /** Decide whether a connection may subscribe to and snapshot a table. */
  canReadTable?: (context: SyncReadPolicyContext) => SyncPolicyDecision;
  /** Decide whether a connection may mutate a table for any operation. */
  canMutateTable?: (context: SyncMutationPolicyContext) => SyncPolicyDecision;
  /** Optional operation-specific insert gate. */
  canInsert?: (context: SyncMutationPolicyContext) => SyncPolicyDecision;
  /** Optional operation-specific update gate. */
  canUpdate?: (context: SyncMutationPolicyContext) => SyncPolicyDecision;
  /** Optional operation-specific delete gate. */
  canDelete?: (context: SyncMutationPolicyContext) => SyncPolicyDecision;
}

/** Configuration for the default deny-list based sync policy. */
export interface DefaultSyncPolicyConfig {
  /** Tables that should not be readable over sync subscriptions. */
  readProtectedTables?: Iterable<string>;
  /** Tables that should not be mutated directly over the sync WebSocket. */
  writeProtectedTables?: Iterable<string>;
}

/** A policy that preserves legacy standalone sync behavior. */
export const allowAllSyncPolicy: SyncPolicy = {};

/**
 * Create a simple deny-list sync policy.
 *
 * Read-protected tables are removed from snapshots/subscriptions. Write-
 * protected tables remain readable but direct `sync.mutate` writes are rejected.
 */
export function createDefaultSyncPolicy(config: DefaultSyncPolicyConfig = {}): SyncPolicy {
  const readProtectedTables = new Set(config.readProtectedTables ?? []);
  const writeProtectedTables = new Set(config.writeProtectedTables ?? []);

  return {
    canReadTable({ table }) {
      if (readProtectedTables.has(table)) {
        return { ok: false, reason: `Not allowed: ${table}` };
      }
      return true;
    },
    canMutateTable({ table }) {
      if (writeProtectedTables.has(table)) {
        return { ok: false, reason: `Table is read-only over sync: ${table}` };
      }
      return true;
    },
  };
}

/**
 * Combine multiple sync policies using deny-wins semantics.
 *
 * This lets platform defaults and app-level rules compose without allowing a
 * later policy to reopen a table denied by an earlier one.
 */
export function combineSyncPolicies(...policies: Array<SyncPolicy | undefined>): SyncPolicy {
  const activePolicies = policies.filter((policy): policy is SyncPolicy => Boolean(policy));

  if (activePolicies.length === 0) return allowAllSyncPolicy;
  if (activePolicies.length === 1) return activePolicies[0];

  return {
    canReadTable(context) {
      return evaluateCallbacks(
        activePolicies.map((policy) => policy.canReadTable),
        context,
        `Not allowed: ${context.table}`
      );
    },
    canMutateTable(context) {
      return evaluateCallbacks(
        activePolicies.map((policy) => policy.canMutateTable),
        context,
        `Not allowed: ${context.table}`
      );
    },
    canInsert(context) {
      return evaluateCallbacks(
        activePolicies.map((policy) => policy.canInsert),
        context,
        `Not allowed: ${context.table}`
      );
    },
    canUpdate(context) {
      return evaluateCallbacks(
        activePolicies.map((policy) => policy.canUpdate),
        context,
        `Not allowed: ${context.table}`
      );
    },
    canDelete(context) {
      return evaluateCallbacks(
        activePolicies.map((policy) => policy.canDelete),
        context,
        `Not allowed: ${context.table}`
      );
    },
  };
}

/**
 * Return the subset of table names the connection may read over sync.
 */
export function getReadableSyncTables(
  tableNames: Iterable<string>,
  authContext: SyncAuthContext | null,
  policy: SyncPolicy = allowAllSyncPolicy
): Set<string> {
  const readable = new Set<string>();

  for (const table of tableNames) {
    const decision = evaluateSyncReadPolicy(policy, { table, authContext });
    if (decision.ok) readable.add(table);
  }

  return readable;
}

/**
 * Evaluate read authorization for one table and normalize policy errors to deny.
 */
export function evaluateSyncReadPolicy(
  policy: SyncPolicy,
  context: SyncReadPolicyContext
): SyncPolicyEvaluation {
  return safelyEvaluate(
    () => normalizeDecision(policy.canReadTable?.(context), `Not allowed: ${context.table}`),
    `Not allowed: ${context.table}`
  );
}

/**
 * Evaluate mutation authorization for one operation and normalize errors to deny.
 */
export function evaluateSyncMutationPolicy(
  policy: SyncPolicy,
  context: SyncMutationPolicyContext
): SyncPolicyEvaluation {
  const tableDecision = safelyEvaluate(
    () => normalizeDecision(policy.canMutateTable?.(context), `Not allowed: ${context.table}`),
    `Not allowed: ${context.table}`
  );
  if (!tableDecision.ok) return tableDecision;

  const operationCallback =
    context.op === 'INSERT'
      ? policy.canInsert
      : context.op === 'UPDATE'
        ? policy.canUpdate
        : policy.canDelete;

  return safelyEvaluate(
    () => normalizeDecision(operationCallback?.(context), `Not allowed: ${context.table}`),
    `Not allowed: ${context.table}`
  );
}

function evaluateCallbacks<TContext>(
  callbacks: Array<((context: TContext) => SyncPolicyDecision) | undefined>,
  context: TContext,
  defaultReason: string
): SyncPolicyEvaluation {
  for (const callback of callbacks) {
    if (!callback) continue;
    const decision = normalizeDecision(callback(context), defaultReason);
    if (!decision.ok) return decision;
  }
  return { ok: true };
}

function normalizeDecision(
  decision: SyncPolicyDecision | undefined,
  defaultReason: string
): SyncPolicyEvaluation {
  if (decision === undefined || decision === true) return { ok: true };
  if (decision === false) return { ok: false, reason: defaultReason };
  return decision.ok ? { ok: true } : { ok: false, reason: decision.reason ?? defaultReason };
}

function safelyEvaluate(
  evaluate: () => SyncPolicyEvaluation,
  defaultReason: string
): SyncPolicyEvaluation {
  try {
    return evaluate();
  } catch (err) {
    const message = err instanceof Error ? err.message : defaultReason;
    warnPlatform(OBS_CODES.SYNC_POLICY_CALLBACK_FAILED, {
      error: err,
      metadata: { defaultReason },
    });
    return { ok: false, reason: message };
  }
}
