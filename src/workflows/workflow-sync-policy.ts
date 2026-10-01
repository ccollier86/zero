/**
 * Sync authorization for framework-owned workflow records.
 *
 * Definitions describe server code and never cross the Sync transport. Runtime
 * records are visible only to the identity that started the workflow, except
 * for the stable single-tenant platform administrator role.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type {
  Row,
  SyncResourceMutationContext,
  SyncResourceMutationDecision,
  SyncResourcePolicyAdapter,
  SyncResourceTableAccess,
  SyncResourceTableAccessContext,
  SyncRowFilter,
} from '../sync/types';
import { WORKFLOW_SERVER_TABLE_NAMES } from './types';
import {
  toPublicWorkflowInstance,
  toPublicWorkflowStep,
} from './workflow-public-record';

const WORKFLOW_RUNTIME_TABLES = new Set([
  'workflow_instances',
  'workflow_steps',
  'workflow_events',
]);

export interface WorkflowSyncPolicyOptions {
  /** Resolve the current app-local ReactiveDB after Sync composition. */
  getDB: () => ReactiveDB | null;
  /** Existing app resource adapter. Its decisions remain authoritative. */
  delegate?: SyncResourcePolicyAdapter;
}

/**
 * Compose workflow row ownership with an existing resource Sync adapter.
 *
 * The adapter is deliberately deny-wins: a delegate-denied table stays denied,
 * and an existing row predicate is ANDed with workflow ownership.
 */
export function createWorkflowSyncPolicyAdapter(
  options: WorkflowSyncPolicyOptions,
): SyncResourcePolicyAdapter {
  return {
    async resolveTableAccess(
      context: SyncResourceTableAccessContext,
    ): Promise<SyncResourceTableAccess> {
      const delegated = options.delegate
        ? await options.delegate.resolveTableAccess(context)
        : unrestrictedAccess(context.tableNames);
      const readableTables = new Set(delegated.readableTables);
      const rowFilters = new Map(delegated.rowFilters);

      // Workflow definitions expose handler names and server-side topology.
      readableTables.delete('workflow_definitions');
      rowFilters.delete('workflow_definitions');

      for (const table of WORKFLOW_RUNTIME_TABLES) {
        if (!readableTables.has(table)) continue;
        const ownership = createOwnershipFilter(table, context, options.getDB);
        const delegatedFilter = rowFilters.get(table);
        rowFilters.set(table, andFilters(delegatedFilter, ownership));
      }

      return {
        readableTables,
        rowFilters,
        policyFingerprint: delegated.policyFingerprint === undefined
          && delegated.rowFilters.size > 0
          ? undefined
          : JSON.stringify({
              delegate: delegated.policyFingerprint ?? null,
              workflows: workflowFingerprint(context),
            }),
      };
    },

    async authorizeMutation(
      context: SyncResourceMutationContext,
    ): Promise<SyncResourceMutationDecision> {
      if (WORKFLOW_SERVER_TABLE_NAMES.has(context.table)) {
        return {
          ok: false,
          reason: `Table is read-only over sync: ${context.table}`,
          code: 'workflow-sync-read-only',
        };
      }
      return options.delegate?.authorizeMutation(context) ?? { ok: true };
    },
  };
}

function unrestrictedAccess(
  tableNames: Iterable<string>,
): SyncResourceTableAccess {
  return {
    readableTables: new Set(tableNames),
    rowFilters: new Map(),
    policyFingerprint: 'unrestricted',
  };
}

function createOwnershipFilter(
  table: string,
  context: SyncResourceTableAccessContext,
  getDB: () => ReactiveDB | null,
): SyncRowFilter {
  const auth = context.authContext;
  const project = table === 'workflow_instances'
    ? (row: Row): Row => toPublicWorkflowInstance(row)
    : table === 'workflow_steps'
      ? (row: Row): Row => {
          const instanceId = workflowInstanceId(row);
          const instance = instanceId
            ? getDB()?.queryOne('workflow_instances', instanceId)
            : null;
          return toPublicWorkflowStep(row, instance?.steps_json);
        }
    : undefined;
  if (auth?.role === 'admin') return { matches: () => true, project };
  if (!auth) return { matches: () => false, project };

  if (table === 'workflow_instances') {
    return {
      matches(row) {
        return row.started_by === auth.userId;
      },
      project,
    };
  }

  return {
    matches(row) {
      const instanceId = workflowInstanceId(row);
      if (!instanceId) return false;
      const instance = getDB()?.queryOne('workflow_instances', instanceId);
      return instance?.started_by === auth.userId;
    },
    project,
  };
}

function workflowInstanceId(row: Row): string | null {
  return typeof row.instance_id === 'string' && row.instance_id.length > 0
    ? row.instance_id
    : null;
}

function andFilters(
  left: SyncRowFilter | undefined,
  right: SyncRowFilter,
): SyncRowFilter {
  if (!left) return right;
  return {
    matches(row) {
      return left.matches(row) && right.matches(row);
    },
    project(row) {
      const platformSafe = right.project?.(row) ?? row;
      return left.project?.(platformSafe) ?? platformSafe;
    },
  };
}

function workflowFingerprint(
  context: SyncResourceTableAccessContext,
): string {
  const auth = context.authContext;
  if (!auth) return 'topology-v2:anonymous:none';
  return auth.role === 'admin'
    ? 'topology-v2:admin:all'
    : `topology-v2:owner:${auth.userId}`;
}
