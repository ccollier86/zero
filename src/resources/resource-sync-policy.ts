/**
 * resource-sync-policy.ts
 *
 * Adapts registered Zero resources to the WebSocket sync authorization
 * boundary. This file owns resource-policy decisions for sync only; it does
 * not mount WebSocket routes, mutate ReactiveDB, or define resource helpers.
 */

import type { UserStore } from '../auth/user-store';
import type {
  ChangeOp,
  Row,
  SyncAuthContext,
  SyncResourceMutationContext,
  SyncResourceMutationDecision,
  SyncResourcePolicyAdapter,
  SyncResourceTableAccess,
  SyncResourceTableAccessContext,
  SyncRowFilter,
} from '../sync/types';
import { createResourcePolicyUser } from './resource-auth';
import { evaluateResourcePolicy } from './resource-policy-evaluator';
import type {
  ResourceAction,
  ResourceDataConstraint,
  ResourcePolicyAuthConfig,
  ResourcePolicyDecision,
  ResourcePolicyScalar,
} from './resource-policy-types';
import type { RegisteredResourceDefinition, ResourceRegistry } from './resource-registry';

/** Configuration required to evaluate resource policy inside sync. */
export interface ResourceSyncPolicyServiceOptions {
  registry: ResourceRegistry;
  authConfig: ResourcePolicyAuthConfig;
  getUserStore?: () => UserStore | null;
}

type ResourceSyncReadDecision =
  | { ok: true; filter?: SyncRowFilter }
  | { ok: false; reason: string; code?: string };

type ResourceSyncDenyDecision = { ok: false; reason: string; code?: string };

/**
 * Resource-policy adapter used by the sync WebSocket layer.
 *
 * Row-constrained `list` policies become per-connection row filters. The sync
 * transport applies those filters to snapshots, catchup, and live changes.
 */
export class ResourceSyncPolicyService implements SyncResourcePolicyAdapter {
  constructor(private readonly options: ResourceSyncPolicyServiceOptions) {}

  /** Resolve readable tables and row filters for already sync-policy-readable tables. */
  async resolveTableAccess(
    context: SyncResourceTableAccessContext
  ): Promise<SyncResourceTableAccess> {
    const readable = new Set<string>();
    const rowFilters = new Map<string, SyncRowFilter>();

    for (const table of context.tableNames) {
      const decision = await this.evaluateSyncRead(table, context.authContext);
      if (!decision.ok) continue;
      readable.add(table);
      if (decision.filter) rowFilters.set(table, decision.filter);
    }

    return { readableTables: readable, rowFilters };
  }

  /** Authorize and optionally stamp one direct sync mutation. */
  async authorizeMutation(
    context: SyncResourceMutationContext
  ): Promise<SyncResourceMutationDecision> {
    const resource = this.options.registry.getByTable(context.table);
    if (!resource) return { ok: true };

    const action = syncOpToResourceAction(context.op);
    if (!this.supportsAction(resource, action)) {
      return {
        ok: false,
        reason: `Resource '${resource.name}' does not support ${action}`,
        code: 'resource-action-not-allowed',
      };
    }

    if (action === 'create') {
      const input = normalizeMutationInput(context.row);
      if (!input) {
        return { ok: false, reason: 'INSERT requires a row', code: 'resource-input-invalid' };
      }

      const decision = await this.evaluatePolicy(resource, action, context.authContext, {
        input,
      });
      if (!decision.allowed) return policyDenied(decision);

      return {
        ok: true,
        row: mergeStampedInput(input, decision.stampedInput),
      };
    }

    if (!context.rowId) {
      return {
        ok: false,
        reason: `${context.op} requires rowId`,
        code: 'resource-row-id-required',
      };
    }

    const row = context.loadRow(context.table, context.rowId);
    if (!row) {
      return {
        ok: false,
        reason: `Row not found: ${context.rowId}`,
        code: 'resource-row-not-found',
      };
    }

    const input = action === 'update' ? normalizeMutationInput(context.row) : undefined;
    if (action === 'update' && !input) {
      return { ok: false, reason: 'UPDATE requires row (partial)', code: 'resource-input-invalid' };
    }

    const decision = await this.evaluatePolicy(resource, action, context.authContext, {
      row,
      input: input ?? undefined,
    });
    if (!decision.allowed) return policyDenied(decision);

    if (action === 'update' && input) {
      return {
        ok: true,
        row: mergeStampedInput(input, decision.stampedInput),
      };
    }

    return { ok: true };
  }

  private async evaluateSyncRead(
    table: string,
    authContext: SyncAuthContext | null
  ): Promise<ResourceSyncReadDecision> {
    const resource = this.options.registry.getByTable(table);
    if (!resource) return { ok: true };

    if (!this.supportsAction(resource, 'list')) {
      return {
        ok: false,
        reason: `Resource '${resource.name}' does not allow WebSocket sync reads`,
        code: 'resource-list-not-allowed',
      };
    }

    const decision = await this.evaluatePolicy(resource, 'list', authContext);
    if (!decision.allowed) return policyDenied(decision);

    if (decision.constraints && decision.constraints.length > 0) {
      return { ok: true, filter: createConstraintRowFilter(decision.constraints) };
    }

    return { ok: true };
  }

  private evaluatePolicy(
    resource: RegisteredResourceDefinition,
    action: ResourceAction,
    authContext: SyncAuthContext | null,
    options: {
      row?: Row;
      input?: Record<string, unknown>;
    } = {}
  ): Promise<ResourcePolicyDecision> {
    return evaluateResourcePolicy(resource.policy[action]!, {
      action,
      user: createResourcePolicyUser(authContext, this.options.getUserStore?.() ?? null),
      resource,
      row: options.row,
      input: options.input,
      authConfig: this.options.authConfig,
    });
  }

  private supportsAction(
    resource: RegisteredResourceDefinition,
    action: ResourceAction
  ): boolean {
    return resource.actions.includes(action) && Boolean(resource.policy[action]);
  }
}

function syncOpToResourceAction(op: ChangeOp): ResourceAction {
  if (op === 'INSERT') return 'create';
  if (op === 'UPDATE') return 'update';
  return 'delete';
}

function normalizeMutationInput(row: Row | Partial<Row> | undefined): Record<string, unknown> | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  return row as Record<string, unknown>;
}

function mergeStampedInput(
  input: Record<string, unknown>,
  stampedInput: Record<string, unknown> | undefined
): Record<string, unknown> {
  return stampedInput ? { ...input, ...stampedInput } : input;
}

function policyDenied(decision: ResourcePolicyDecision): ResourceSyncDenyDecision {
  return {
    ok: false,
    reason: decision.message ?? 'Forbidden',
    code: decision.reason,
  };
}

function createConstraintRowFilter(constraints: readonly ResourceDataConstraint[]): SyncRowFilter {
  return {
    matches(row) {
      return constraints.every((constraint) => matchesConstraint(row, constraint));
    },
  };
}

function matchesConstraint(row: Row, constraint: ResourceDataConstraint): boolean {
  if (constraint.type === 'field') {
    return scalarEquals(row[constraint.field], constraint.value);
  }

  if (constraint.type === 'anyOf') {
    return constraint.constraints.some((child) => matchesConstraint(row, child));
  }

  return constraint.constraints.every((child) => matchesConstraint(row, child));
}

function scalarEquals(actual: unknown, expected: ResourcePolicyScalar): boolean {
  if (typeof expected === 'boolean') {
    return actual === expected ||
      actual === (expected ? 1 : 0) ||
      actual === (expected ? '1' : '0') ||
      actual === String(expected);
  }

  return actual === expected;
}
